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
  status: "new", odlozoneDo: null, poTerminie: false, oglada: null,
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
     pola wyboru ani kroku odłożenia — test pilnuje, żeby nie wróciły. */
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
    expect(screen.getByLabelText("Status rozmowy")).toHaveTextContent("Zamknięta");
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

    await userEvent.click(screen.getByRole("button", { name: /Sprawa reklamacyjna/ }));
    expect(onZnacznik).toHaveBeenCalledWith(true);

    rerender(<Status rozmowa={rozmowa({ reklamacyjna: true })} blad="" onPriorytet={vi.fn()} zapisujePriorytet={false}
      onReklamacyjna={onZnacznik} />);
    await userEvent.click(screen.getByRole("button", { name: /REKLAMACYJNA/ }));
    expect(onZnacznik).toHaveBeenLastCalledWith(false);
  });

  it("mówi wprost, że sprawy w Allegro to NIE zakłada", () => {
    render(<Status rozmowa={rozmowa()} blad="" onPriorytet={vi.fn()} zapisujePriorytet={false}
      onReklamacyjna={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Sprawa reklamacyjna/ }))
      .toHaveAttribute("title", expect.stringContaining("Allegro"));
  });

  it("bez obsługi znacznika przycisku NIE MA — obietnica bez pokrycia", () => {
    render(<Status rozmowa={rozmowa()} blad="" onPriorytet={vi.fn()} zapisujePriorytet={false} />);

    expect(screen.queryByRole("button", { name: /reklamacyjn/i })).not.toBeInTheDocument();
  });
});
