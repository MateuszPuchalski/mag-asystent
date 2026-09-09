import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Edytor } from "./Edytor";
import type { PropsSzkicuCopilota } from "./SzkicCopilota";
import type { SzkicCopilota } from "../api/typy";

/* ── Szkic z Copilota w edytorze (§14.6, 0.231.0) ────────────────────────────
   Pilnujemy granic, nie wyglądu: propozycja NIE wchodzi do pola sama;
   „Wstaw" dopisuje, „Zastąp" istnieje tylko, gdy jest co nadpisać; wyłączony
   Copilot daje zdanie zamiast martwego przycisku; w trybie komentarza nic
   z tego nie ma w drzewie; nieświeżość jest nazwana.                        */

const szkic = (n: Partial<SzkicCopilota> = {}): SzkicCopilota => ({
  tresc: "Dzień dobry, do gaźnika W09-0211 pasuje uszczelka LC170430140-0001 (F3).",
  zastrzezenia: [], uzyteFakty: ["F3"], messageId: 41, model: "claude-opus-5",
  at: "2026-09-07T10:00:00Z", przez: "A. Lewandowska", ocena: null,
  daneDoboru: null, daneOcena: null, doborWersja: 1, pasowanie: null, pasowanieOcena: null, ...n,
});

const copilot = (n: Partial<PropsSzkicuCopilota> = {}): PropsSzkicuCopilota => ({
  stan: { wlaczony: true, powod: null, model: "claude-opus-5", maxPartia: 20 },
  szkic: null, nieswiezy: false, doborWersja: 1, nowePolaDoboru: [], paraPasowania: null,
  uklada: false, blad: "", maSzkicAgenta: false, wylaczony: false,
  onUloz: vi.fn(), onWstaw: vi.fn(), onZastap: vi.fn(), onOdrzuc: vi.fn(), ...n,
});

const props = {
  szkic: "", cudza: false, wlasciciel: null as string | null, zapisuje: false, wysyla: false,
  onZmiana: vi.fn(), onZapisz: vi.fn(), onWyslij: vi.fn(),
  komentarz: "", onKomentarz: vi.fn(), onDodajKomentarz: vi.fn(),
  komentuje: false, agenci: [] as Array<{ userId: number; name: string }>, wzmianki: [] as number[],
  onWzmianki: vi.fn(),
  zalaczniki: [] as import("../api/rozmowy").ZalacznikSzkicu[],
  dodajeZalacznik: false, bladZalacznika: "",
  onDodajZalacznik: vi.fn(), onUsunZalacznik: vi.fn(),
};
const edytor = (c: PropsSzkicuCopilota, n: Partial<typeof props> = {}) =>
  render(<Edytor {...props} {...n} copilot={c} />);

describe("Szkic Copilota w edytorze", () => {
  it("przycisk woła ułożenie; wyłączony Copilot daje zdanie zamiast przycisku", async () => {
    const c = copilot();
    const { unmount } = edytor(c);
    await userEvent.click(screen.getByRole("button", { name: /Ułóż odpowiedź/ }));
    expect(c.onUloz).toHaveBeenCalledTimes(1);
    unmount();

    edytor(copilot({ stan: { wlaczony: false, powod: "Copilot jest wyłączony. Włącz go w wertis.env (COPILOT_MODE=anthropic).",
      model: "claude-opus-5", maxPartia: 20 } }));
    expect(screen.queryByRole("button", { name: /Ułóż odpowiedź/ })).toBeNull();
    expect(screen.getByText(/COPILOT_MODE=anthropic/)).toBeInTheDocument();
  });

  it("w trakcie układania przycisk jest nieaktywny i mówi, co robi", () => {
    edytor(copilot({ uklada: true }));
    expect(screen.getByRole("button", { name: /Układam szkic z faktów/ })).toBeDisabled();
  });

  it("propozycja NIE wchodzi do pola sama — stoi w karcie, „Wstaw” dopisuje", async () => {
    const c = copilot({ szkic: szkic() });
    edytor(c);
    expect(screen.getByLabelText("Szkic odpowiedzi")).toHaveValue("");
    const karta = screen.getByRole("region", { name: "Szkic Copilota" });
    expect(karta).toHaveTextContent("LC170430140-0001");
    await userEvent.click(screen.getByRole("button", { name: "Wstaw do szkicu" }));
    expect(c.onWstaw).toHaveBeenCalledTimes(1);
    /* Bez szkicu agenta nie ma czego zastępować — przycisku nie ma w drzewie. */
    expect(screen.queryByRole("button", { name: "Zastąp szkic" })).toBeNull();
  });

  /* Zrzut właściciela z 8.09.2026: długi szkic rozpychał edytor, oś rozmowy
     zwijała się do jednej linii, a przyciski ginęły pod krawędzią kolumny.
     Przyciski stoją nad treścią, a treść przewija się we własnym pojemniku. */
  it("przyciski stoją PRZED treścią, a treść ma własny przewijany pojemnik", () => {
    edytor(copilot({ szkic: szkic({ tresc: "linia\n".repeat(60) }) }));
    const wstaw = screen.getByRole("button", { name: "Wstaw do szkicu" });
    const tresc = screen.getByTestId("szkic-copilota-tresc");
    expect(wstaw.compareDocumentPosition(tresc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tresc.className).toMatch(/max-h-\d+/);
    expect(tresc.className).toMatch(/overflow-y-auto/);
  });

  it("„Zastąp szkic” pojawia się tylko przy niepustym szkicu agenta", async () => {
    const c = copilot({ szkic: szkic(), maSzkicAgenta: true });
    edytor(c, { szkic: "Dzień dobry," });
    await userEvent.click(screen.getByRole("button", { name: "Zastąp szkic" }));
    expect(c.onZastap).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    expect(c.onOdrzuc).toHaveBeenCalledTimes(1);
  });

  it("zastrzeżenia modelu stoją nad treścią, a nieświeżość jest nazwana", () => {
    edytor(copilot({ szkic: szkic({ zastrzezenia: ["brak dowodu na dopasowanie do LS 46-450"] }), nieswiezy: true }));
    expect(screen.getByLabelText("Czego model nie znalazł w faktach")).toHaveTextContent("brak dowodu");
    expect(screen.getByText(/powstał przed nową wiadomością klienta/)).toBeInTheDocument();
  });

  /* Dane doboru z rozmowy (przyrost trzeci): karta w edytorze tylko MÓWI, że
     są — wpisuje je zakładka Dobór. Druga nieświeżość: fakty się zmieniły. */
  it("mówi, jakie dane rozpoznał, bez drugiego przycisku; zmiana doboru po szkicu jest nazwana", () => {
    edytor(copilot({ szkic: szkic({ doborWersja: 1 }), doborWersja: 2, nowePolaDoboru: ["Marka", "Model", "Silnik"] }));
    expect(screen.getByText(/Copilot rozpoznał w rozmowie: Marka, Model, Silnik/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Wpisz do danych/ })).toBeNull();
    expect(screen.getByText(/dane doboru zmieniły się od szkicu/)).toBeInTheDocument();
  });

  it("szkic sprzed migracji (wersja doboru 0) nie udaje nieświeżego, a bez nowych pól nie ma zdania", () => {
    edytor(copilot({ szkic: szkic({ doborWersja: 0 }), doborWersja: 3 }));
    expect(screen.queryByText(/dane doboru zmieniły się/)).toBeNull();
    expect(screen.queryByText(/Copilot rozpoznał w rozmowie/)).toBeNull();
  });

  it("oceniony szkic znika z ekranu — wiersz zostaje dla pomiaru", () => {
    edytor(copilot({ szkic: szkic({ ocena: "odrzucony" }) }));
    expect(screen.queryByRole("region", { name: "Szkic Copilota" })).toBeNull();
  });

  it("w trybie komentarza nie ma ani przycisku, ani karty — szkic jest dla klienta", async () => {
    edytor(copilot({ szkic: szkic() }));
    await userEvent.click(screen.getByRole("button", { name: /Komentarz wewnętrzny/ }));
    expect(screen.queryByRole("button", { name: /Ułóż odpowiedź/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Szkic Copilota" })).toBeNull();
  });

  it("cudza rozmowa blokuje układanie i wstawianie, tak jak pole szkicu", () => {
    edytor(copilot({ szkic: szkic(), wylaczony: true }), { cudza: true, wlasciciel: "M. Wójcik" });
    expect(screen.getByRole("button", { name: /Ułóż odpowiedź/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Wstaw do szkicu" })).toBeDisabled();
  });

  it("błąd układania stoi obok przycisku zdaniem", () => {
    edytor(copilot({ blad: "Model użył numeru XYZ-9999, którego nie ma w faktach — szkic odrzucony." }));
    expect(screen.getByText(/XYZ-9999/)).toBeInTheDocument();
  });
});
