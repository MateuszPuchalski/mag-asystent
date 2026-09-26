import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Status } from "./Status";
import type { Rozmowa } from "../api/typy";

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 4821, klient: "Kupujący 44300444",
  ostatniaWiadomosc: "Czy ten szarpak pasuje do NAC LS 46-450?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "new", odlozoneDo: null, poTerminie: false, podziekowal: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, reklamacyjna: false, nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "not_started",
  kopilot: null, ...n,
});

describe("Status rozmowy", () => {
  it("pokazuje stan bieżący po polsku, także gdy nikt go nie ruszył", () => {
    /* „Nowa" jest informacją, nie brakiem informacji: znaczy, że sprawy nikt
       nie tknął. */
    render(<Status rozmowa={rozmowa()} blad="" onPriorytet={() => {}} zapisujePriorytet={false} />);
    expect(screen.getByLabelText("Status rozmowy")).toHaveTextContent("Nowa");
  });

  /* ── Ręcznego statusu nie ma (22 września 2026) ──────────────────────────
     Decyzja właściciela: stan wynika wyłącznie z faktów. Nagłówek nie ma
     pola wyboru — test pilnuje, żeby nie wróciło. Odłożenie wróciło
     26 września 2026 (0.533.0), ale jako werdykt Z DATĄ w menu „⋯", nie
     jako pozycja listy statusów; bez `onOdloz` go nie ma — testy niżej. */
  it("status jest odczytem: bez pola wyboru i bez odłożenia", () => {
    render(<Status rozmowa={rozmowa({ status: "waiting_for_us" })} blad=""
      onPriorytet={() => {}} zapisujePriorytet={false} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /ODŁÓŻ/ })).toBeNull();
    expect(screen.getByLabelText("Status rozmowy")).toHaveTextContent("Czeka na nas");
  });

  it("werdykt zapisany przed zmianą widać dalej, bo stoi w bazie", () => {
    render(<Status rozmowa={rozmowa({ status: "closed" })} blad=""
      onPriorytet={() => {}} zapisujePriorytet={false} />);
    /* „Zamknięta" czyta się od 23 września 2026 jak „Zakończona" — jeden werdykt. */
    expect(screen.getByLabelText("Status rozmowy")).toHaveTextContent("Zakończona");
  });

  /* ── Zakończ / Otwórz ponownie (23 września 2026) ────────────────────────
     Jeden werdykt; pytanie raz, gdy klient czeka na odpowiedź — to jedyna
     pomyłka przycisku, która kosztuje klienta. */
  it("Zakończ bez pytania, gdy piłka jest u klienta", async () => {
    const onZakoncz = vi.fn();
    render(<Status rozmowa={rozmowa({ status: "waiting_for_customer" })} blad="" onPriorytet={() => {}}
      zapisujePriorytet={false} onZakoncz={onZakoncz} onOtworz={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Zakończ/ }));
    expect(onZakoncz).toHaveBeenCalledWith(false);
  });

  it("klient czeka: najpierw pytanie, potem „Zakończ mimo to”; klawisz Z idzie tą samą drogą", async () => {
    const onZakoncz = vi.fn();
    render(<Status rozmowa={rozmowa({ status: "waiting_for_us" })} blad="" onPriorytet={() => {}}
      zapisujePriorytet={false} onZakoncz={onZakoncz} onOtworz={() => {}} />);
    await userEvent.keyboard("z");
    expect(onZakoncz).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Klient czeka na odpowiedź/);
    await userEvent.click(screen.getByRole("button", { name: "Zakończ mimo to" }));
    expect(onZakoncz).toHaveBeenCalledWith(true);
  });

  it("zakończona samo: źródło słowem i „Otwórz ponownie”", async () => {
    const onOtworz = vi.fn();
    render(<Status rozmowa={rozmowa({ status: "resolved", zakonczenie: "cisza" })} blad=""
      onPriorytet={() => {}} zapisujePriorytet={false} onZakoncz={() => {}} onOtworz={onOtworz} />);
    expect(screen.getByText("2 dni bez odpowiedzi klienta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Zakończ/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Otwórz ponownie/ }));
    expect(onOtworz).toHaveBeenCalled();
  });

  it("odmowa serwera ląduje przy przełącznikach, nie w ogólnym pasku błędów", () => {
    render(<Status rozmowa={rozmowa()}
      blad="Nieznany priorytet" onPriorytet={() => {}} zapisujePriorytet={false} />);
    expect(screen.getByText(/Nieznany priorytet/)).toBeInTheDocument();
  });
});

/* ── Priorytet (§10.2, 0.181.0) ──────────────────────────────────────────── */

describe("ręczna flaga „pilne”", () => {
  it("przełącznik pokazuje stan i podnosi flagę", async () => {
    const onPriorytet = vi.fn();
    render(<Status rozmowa={rozmowa()} blad=""
      onPriorytet={onPriorytet} zapisujePriorytet={false} />);
    /* Przełącznik w spoczynku stoi w menu „⋯" od 0.506.0 — `MenuRozmowy.tsx`. */
    await userEvent.click(screen.getByRole("button", { name: "Więcej czynności rozmowy" }));
    const p = screen.getByRole("button", { name: /Oznacz jako pilne/ });
    expect(p).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(p);
    expect(onPriorytet).toHaveBeenCalledWith("pilny");
  });

  it("podniesiona flaga daje się opuścić tym samym przyciskiem", async () => {
    const onPriorytet = vi.fn();
    render(<Status rozmowa={rozmowa({ priorytet: "pilny" })} blad="" onPriorytet={onPriorytet} zapisujePriorytet={false} />);
    const p = screen.getByRole("button", { name: "PILNE" });
    expect(p).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(p);
    expect(onPriorytet).toHaveBeenCalledWith("normalny");
  });
});

/* ── Stan raz, nie dwa (0.193.0) ─────────────────────────────────────────────
   Do 0.192.0 pasek statusu rysował plakietkę ze stanem, a obok pole wyboru
   z TĄ SAMĄ wartością: jedno pasmo nagłówka mówiło „OTWARTA" dwukrotnie.
   §7 żąda, żeby nagłówek pokazywał stan zawsze — pokazuje go jedna
   plakietka.                                                            */
describe("Stan rozmowy stoi w nagłówku raz", () => {
  it("nazwa stanu bieżącego pada dokładnie jeden raz", () => {
    render(<Status rozmowa={rozmowa({ status: "open" })} blad="" onPriorytet={() => {}} zapisujePriorytet={false} />);
    /* Jedyne wystąpienie to plakietka — pola wyboru obok już nie ma. */
    expect(screen.getAllByText("Otwarta")).toHaveLength(1);
  });

  it("plakietka niesie barwę stanu, więc stan dalej czyta się rzutem oka", () => {
    render(<Status rozmowa={rozmowa({ status: "open" })} blad=""
      onPriorytet={() => {}} zapisujePriorytet={false} />);
    expect(screen.getByLabelText("Status rozmowy").className).toMatch(/bg-stan-open/);
  });

  /* ── ZNACZNIK REKLAMACYJNY (0.390.0) ───────────────────────────────────────
     Właściciel: „chcę zaznaczyć, że to jest pytanie reklamacyjne i będzie
     traktowane jako reklamacja, ale nie będzie w allegrowych reklamacjach".

     Sprawy w Allegro założyć się NIE DA — `/sale/issues` ma wyłącznie GET,
     otwiera ją kupujący. Ten przełącznik jest nasz i te testy pilnują, żeby
     ekran nie obiecywał czegoś innego.                                      */

  it("przełącza znacznik w OBIE strony, bo pomyłka jest normalna", async () => {
    const onZnacznik = vi.fn();
    const { rerender } = render(<Status rozmowa={rozmowa()} blad="" onPriorytet={vi.fn()} zapisujePriorytet={false}
      onReklamacyjna={onZnacznik} />);

    await userEvent.click(screen.getByRole("button", { name: "Więcej czynności rozmowy" }));
    await userEvent.click(screen.getByRole("button", { name: /Sprawa reklamacyjna/ }));
    expect(onZnacznik).toHaveBeenCalledWith(true);

    rerender(<Status rozmowa={rozmowa({ reklamacyjna: true })} blad="" onPriorytet={vi.fn()} zapisujePriorytet={false}
      onReklamacyjna={onZnacznik} />);
    await userEvent.click(screen.getByRole("button", { name: /REKLAMACYJNA/ }));
    expect(onZnacznik).toHaveBeenLastCalledWith(false);
  });

  it("mówi wprost, że sprawy w Allegro to NIE zakłada", async () => {
    render(<Status rozmowa={rozmowa()} blad="" onPriorytet={vi.fn()} zapisujePriorytet={false}
      onReklamacyjna={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Więcej czynności rozmowy" }));

    expect(screen.getByRole("button", { name: /Sprawa reklamacyjna/ }))
      .toHaveAttribute("title", expect.stringContaining("Allegro"));
  });

  it("bez obsługi znacznika przycisku NIE MA — obietnica bez pokrycia", async () => {
    render(<Status rozmowa={rozmowa()} blad="" onPriorytet={vi.fn()} zapisujePriorytet={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Więcej czynności rozmowy" }));

    expect(screen.queryByRole("button", { name: /reklamacyjn/i })).not.toBeInTheDocument();
  });
});

/* ── Klawiatura i odłożenie (0.533.0) ───────────────────────────────────────
   Drugie „Z" zatwierdza zakończenie bez odpowiedzi — pytanie zostaje jedno
   i w miejscu przycisku, tylko odpowiedź nie wymaga już myszy. „O" odkłada
   do następnego dnia roboczego, 8:00. Menu „⋯" ma trzy terminy i kalendarz. */
describe("Status: klawiatura i odłożenie", () => {
  it("drugie Z zatwierdza zakończenie mimo pytania, Esc je anuluje", async () => {
    const onZakoncz = vi.fn();
    render(<Status rozmowa={rozmowa({ status: "waiting_for_us" })} blad="" onPriorytet={() => {}}
      zapisujePriorytet={false} onZakoncz={onZakoncz} onOtworz={() => {}} />);
    await userEvent.keyboard("z");
    expect(screen.getByRole("alert")).toHaveTextContent("zakończyć bez odpowiedzi?");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onZakoncz).not.toHaveBeenCalled();
    await userEvent.keyboard("zz");
    expect(onZakoncz).toHaveBeenCalledWith(true);
  });

  it("O odkłada do następnego dnia roboczego na 8:00", async () => {
    const onOdloz = vi.fn();
    render(<Status rozmowa={rozmowa({ status: "waiting_for_us" })} blad="" onPriorytet={() => {}}
      zapisujePriorytet={false} onZakoncz={() => {}} onOdloz={onOdloz} />);
    await userEvent.keyboard("o");
    expect(onOdloz).toHaveBeenCalledTimes(1);
    const kiedy = new Date(onOdloz.mock.calls[0][0] as string);
    expect(kiedy.getTime()).toBeGreaterThan(Date.now());
    expect([kiedy.getHours(), kiedy.getMinutes()]).toEqual([8, 0]);
    expect([0, 6]).not.toContain(kiedy.getDay());
  });

  it("menu „⋯” ma trzy terminy i kalendarz; odłożona mówi do kiedy i ma „Wróć teraz”", async () => {
    const onOdloz = vi.fn();
    const onWroc = vi.fn();
    const { rerender } = render(<Status rozmowa={rozmowa({ status: "waiting_for_us" })} blad=""
      onPriorytet={() => {}} zapisujePriorytet={false} onOdloz={onOdloz} onWrocZOdlozenia={onWroc} />);
    await userEvent.click(screen.getByRole("button", { name: "Więcej czynności rozmowy" }));
    expect(screen.getByText("· za tydzień")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Odłóż do dnia"), "2026-10-02");
    await userEvent.click(screen.getByRole("button", { name: "Odłóż" }));
    const kiedy = new Date(onOdloz.mock.calls[0][0] as string);
    expect([kiedy.getFullYear(), kiedy.getMonth() + 1, kiedy.getDate(), kiedy.getHours()]).toEqual([2026, 10, 2, 8]);

    rerender(<Status rozmowa={rozmowa({ status: "snoozed", odlozoneDo: "2026-10-02T06:00:00.000Z" })} blad=""
      onPriorytet={() => {}} zapisujePriorytet={false} onOdloz={onOdloz} onWrocZOdlozenia={onWroc} />);
    expect(screen.getByLabelText("Status rozmowy")).toHaveTextContent(/Odłożona do/);
    await userEvent.click(screen.getByRole("button", { name: /Wróć teraz/ }));
    expect(onWroc).toHaveBeenCalled();
  });
});
