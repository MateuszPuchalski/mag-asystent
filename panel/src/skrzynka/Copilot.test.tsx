import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OcenaKategorii, PasekCopilota, doRozpoznania } from "./Copilot";
import type { Kopilot, Rozmowa, StanCopilota } from "../api/typy";

/* Trzy rzeczy, po których poznaje się, że pasek nadaje się do hali biurowej:
   przycisk MÓWI LICZBĘ, stan wyłączony nie daje kliknąć i tłumaczy dlaczego,
   a etykieta dotycząca starszej wiadomości jest przygaszona. Czwarta —
   potwierdzenie nazywa koszt — bo bez niej agent klika w ciemno.            */

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 1, klient: "Kupujący 44300444", ostatniaWiadomosc: "Czy pasuje?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "new", odlozoneDo: null, poTerminie: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, nowychOdOdpowiedzi: 0,
  zadanieWToku: false, dobor: "not_started", kopilot: null, ...n,
});

const kopilot = (n: Partial<Kopilot> = {}): Kopilot => ({
  kategoria: "dostepnosc", pewnosc: "wysoka", nieaktualna: false, ocena: null, ...n,
});

const WLACZONY: StanCopilota = {
  wlaczony: true, powod: null, model: "claude-opus-5", maxPartia: 20,
};

describe("pasek Copilota nad kolejką", () => {
  it("do partii idą nierozpoznane ORAZ te z etykietą po dopisku klienta", () => {
    const lista = [
      rozmowa({ id: 1 }),
      rozmowa({ id: 2, kopilot: kopilot() }),
      rozmowa({ id: 3, kopilot: kopilot({ nieaktualna: true }) }),
      /* `nie_wiadomo` NIE wraca do partii: wiersz w bazie istnieje, więc
         drugie kliknięcie byłoby drugą zapłatą za tę samą odpowiedź. */
      rozmowa({ id: 4, kopilot: kopilot({ kategoria: "nie_wiadomo" }) }),
    ];
    expect(doRozpoznania(lista).map((r) => r.id)).toEqual([1, 3]);
  });

  it("przycisk niesie LICZBĘ, a potwierdzenie mówi, że to kosztuje", async () => {
    const onRozpoznaj = vi.fn();
    render(<PasekCopilota stan={WLACZONY} onRozpoznaj={onRozpoznaj}
      kandydaci={[rozmowa({ id: 7 }), rozmowa({ id: 9 })]} />);

    await userEvent.click(screen.getByRole("button", { name: /Rozpoznaj 2 rozmów/ }));
    /* „Rozpoznam N" bez zdania o koszcie byłoby zaproszeniem bez ceny. */
    expect(screen.getByText(/to kosztuje/)).toBeTruthy();
    expect(onRozpoznaj).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Rozpoznaj" }));
    expect(onRozpoznaj).toHaveBeenCalledWith([7, 9]);
  });

  it("wyłączony Copilot daje ZDANIE zamiast przycisku", () => {
    const onRozpoznaj = vi.fn();
    render(<PasekCopilota onRozpoznaj={onRozpoznaj} kandydaci={[rozmowa()]}
      stan={{ ...WLACZONY, wlaczony: false, powod: "Copilot nie ma klucza." }} />);
    /* Przycisk, który nie może zadziałać, uczy nie klikać — a ta nauka
       zostaje także wtedy, gdy zacznie działać. */
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Copilot nie ma klucza.")).toBeTruthy();
  });

  it("nie ma czego rozpoznawać — przycisk martwy i mówi to wprost", () => {
    render(<PasekCopilota stan={WLACZONY} kandydaci={[]} onRozpoznaj={vi.fn()} />);
    const b = screen.getByRole("button", { name: /Wszystkie rozmowy w tym kubełku/ });
    expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("limit partii nie zjada reszty kubełka po cichu", () => {
    const kandydaci = Array.from({ length: 5 }, (_, i) => rozmowa({ id: i + 1 }));
    render(<PasekCopilota stan={{ ...WLACZONY, maxPartia: 2 }} kandydaci={kandydaci}
      onRozpoznaj={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Rozpoznaj 2 rozmów/ })).toBeTruthy();
    expect(screen.getByText(/pozostanie 3/)).toBeTruthy();
  });

  it("partia przerwana limitem dostawcy pokazuje zdanie, nie znika bez śladu", () => {
    render(<PasekCopilota stan={WLACZONY} kandydaci={[]} onRozpoznaj={vi.fn()}
      wynik={{
        sklasyfikowane: 8, pominiete: [], bledy: [], przerwane: "Dostawca poprosił o przerwę.",
        zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0, kosztUsd: 0 },
      }} />);
    expect(screen.getByText("Dostawca poprosił o przerwę.")).toBeTruthy();
  });
});

describe("plakietka i werdykt człowieka", () => {
  it("etykieta ze starszej wiadomości jest PRZYGASZONA i mówi dlaczego", () => {
    const { container } = render(<OcenaKategorii onOcen={vi.fn()}
      kopilot={kopilot({ nieaktualna: true })} />);
    const plakietka = container.querySelector("[title]") as HTMLElement;
    expect(plakietka.getAttribute("title")).toMatch(/starszą wiadomość/);
    expect(plakietka.className).toContain("text-slate-400");
  });

  it("świeża etykieta jest wyraźna, a dwa kciuki są jedynym pomiarem", async () => {
    const onOcen = vi.fn();
    const { container } = render(<OcenaKategorii kopilot={kopilot()} onOcen={onOcen} />);
    expect((container.querySelector("[title]") as HTMLElement).className)
      .toContain("text-violet-800");
    await userEvent.click(screen.getByRole("button", { name: "Nietrafna" }));
    expect(onOcen).toHaveBeenCalledWith("nietrafna");
  });

  it("po ocenie kciuków nie ma — ocena zostaje, bo to ona jest pomiarem", () => {
    render(<OcenaKategorii kopilot={kopilot({ ocena: "nietrafna" })} onOcen={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/ocena: nietrafna/)).toBeTruthy();
  });
});
