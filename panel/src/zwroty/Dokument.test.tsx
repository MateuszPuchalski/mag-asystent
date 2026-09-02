import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dokument } from "./Dokument";
import type { FakturaZwrotu, KandydatFaktury } from "../api/typy";

/* ── Dokument sprzedaży przy zwrocie (0.174.0) ───────────────────────────────
   Ekran ma odpowiadać na pytanie „pod jakim numerem stoi ta sprzedaż
   w Subiekcie" — i mówić, SKĄD tę odpowiedź wziął. Numer bez pochodzenia
   wygląda tak samo, gdy dopasował go automat i gdy zgadł go człowiek. */

const BRAK: FakturaZwrotu =
  { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null };

const KANDYDAT = (n: Partial<KandydatFaktury> = {}): KandydatFaktury => ({
  dokId: 500, numer: "FS 140/2026", typ: "FS", data: "2026-08-20",
  powody: ["wszystkie zwracane towary są na tym dokumencie"], pewny: false, ...n,
});

const pokaz = (faktura: FakturaZwrotu, kandydaci: KandydatFaktury[] = [], onWskaz = vi.fn()) => {
  render(<Dokument faktura={faktura} kandydaci={kandydaci} trwa={false} blad="" onWskaz={onWskaz} />);
  return onWskaz;
};

describe("Dokument sprzedaży przy zwrocie", () => {
  it("dopasowany automatem mówi, że numer stoi NA dokumencie", () => {
    pokaz({ dokId: 500, numer: "FS 140/2026", typ: "FS", zrodlo: "numer",
      at: "2026-09-01T10:00:00Z", przez: "automat (numer zamówienia)" });
    expect(screen.getByText("FS 140/2026")).toBeInTheDocument();
    expect(screen.getByText(/Numer zamówienia stoi na tym dokumencie/)).toBeInTheDocument();
  });

  it("wskazany ręcznie podpisuje się człowiekiem", () => {
    /* Wybór człowieka nie udaje faktu z danych — projekt panelu §4.3. */
    pokaz({ dokId: 500, numer: "PA 88/2026", typ: "PA", zrodlo: "reczne",
      at: "2026-09-01T10:00:00Z", przez: "Ala" });
    expect(screen.getByText(/Wskazał\(a\) Ala/)).toBeInTheDocument();
  });

  it("pomyłkę da się cofnąć jednym kliknięciem", async () => {
    const onWskaz = pokaz({ dokId: 500, numer: "FS 140/2026", typ: "FS",
      zrodlo: "reczne", at: null, przez: "Ala" });
    await userEvent.click(screen.getByRole("button", { name: /to nie ten dokument/ }));
    expect(onWskaz).toHaveBeenCalledWith(null);
  });

  it("kandydat niesie SWÓJ powód, a nie samą listę numerów", async () => {
    /* Wybiera człowiek, więc ma widzieć, czemu akurat te dokumenty tu stoją. */
    const onWskaz = pokaz(BRAK, [
      KANDYDAT({ dokId: 500, numer: "FS 140/2026", pewny: true,
        powody: ["numer zamówienia stoi na dokumencie"] }),
      KANDYDAT({ dokId: 501, numer: "PA 88/2026" }),
    ]);
    expect(screen.getByText("numer zamówienia stoi na dokumencie")).toBeInTheDocument();
    expect(screen.getByText("wszystkie zwracane towary są na tym dokumencie")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "PA 88/2026" }));
    expect(onWskaz).toHaveBeenCalledWith(501);
  });

  it("brak kandydatów tłumaczy się, zamiast wyglądać na awarię", () => {
    /* „Nie znalazłem" bez powodu czyta się jak zepsuty import, a bywa po
       prostu starą sprzedażą albo pozycją bez kartoteki. */
    pokaz(BRAK, []);
    expect(screen.getByText(/Nie znalazłem dokumentu sprzedaży/)).toBeInTheDocument();
    expect(screen.getByText(/starsza niż okno importu/)).toBeInTheDocument();
  });

  it("odmowa serwera ląduje przy sekcji, a nie w konsoli", () => {
    render(<Dokument faktura={BRAK} kandydaci={[KANDYDAT()]} trwa={false}
      blad="Zwrot jest zamknięty" onWskaz={vi.fn()} />);
    expect(screen.getByText(/Zwrot jest zamknięty/)).toBeInTheDocument();
  });
});
