import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Os } from "./Os";
import type { WpisOsi } from "../api/typy";

/* ── Autoodpowiedź biura na osi (0.218.0) ────────────────────────────────────
   Skrzynka odbija każdy przychodzący list potwierdzeniem „Dziękujemy za
   kontakt": kilkanaście wierszy z godzinami pracy, po polsku i po angielsku,
   zero zdań o sprawie klienta. Właściciel: „zwijaj i oznaczaj".

   Testy pilnują trzech rzeczy, na których to stoi:
   1. ZWINIĘTE, ale OZNACZONE — agent ma wiedzieć, że coś tam jest.
   2. TREŚĆ DOSTĘPNA jednym kliknięciem, bo autoodpowiedź jest dowodem, że
      list dotarł, i przy sporze musi dać się przeczytać w panelu.
   3. PRAWDZIWA ODPOWIEDŹ SIĘ NIE ZWIJA — to jest cena pomyłki w tę stronę. */

const ODBICIE = "Dziękujemy za kontakt\n\nTa wiadomość jest generowana automatycznie…";

const wpis = (n: Partial<WpisOsi> = {}): WpisOsi => ({
  id: "msg-2", rodzaj: "wiadomosc", autor: "Biuro", odKlienta: false,
  tresc: ODBICIE, at: "2026-09-01T10:00:00Z", ofertaId: null, messageId: 2,
  automatyczna: true, ...n,
});

const os = (w: WpisOsi) => render(<Os rozmowaId={1} wpisy={[w]} zrodloPomiaru={null} mozeZlecac={false}
  onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

describe("Autoodpowiedź na osi rozmowy", () => {
  it("jest zwinięta i nazwana, a nie ukryta", () => {
    os(wpis());
    expect(screen.getByText("Autoodpowiedź biura")).toBeTruthy();
    expect(screen.queryByText(/generowana automatycznie/)).toBeNull();
  });

  it("treść jest jedno kliknięcie dalej i chowa się z powrotem", async () => {
    os(wpis());
    const przelacznik = screen.getByRole("button", { name: /pokaż treść/ });
    expect(przelacznik.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(przelacznik);
    expect(screen.getByText(/generowana automatycznie/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /zwiń/ }));
    expect(screen.queryByText(/generowana automatycznie/)).toBeNull();
  });

  /* ── Stopka firmowa (0.219.1) ───────────────────────────────────────────
     Nazwa spółki, adres, NIP, KRS, REGON, telefon — siedem wierszy w każdej
     naszej wiadomości. Przy trzech odpowiedziach w wątku zajmowały na osi
     więcej miejsca niż wszystko, co naprawdę napisaliśmy.                  */
  it("stopka firmowa jest zwinięta, a treść i podpis zostają widoczne", async () => {
    os(wpis({ automatyczna: false, tresc: "Prosimy o zgłoszenie reklamacji.\n\nZ poważaniem,\nMateusz",
      stopka: "WERTIS Sp. z o.o.\nNIP: 5423444020" }));

    expect(screen.getByText(/Prosimy o zgłoszenie reklamacji/)).toBeTruthy();
    /* Podpis człowieka NIE jest stopką: mówi, z kim klient rozmawiał. */
    expect(screen.getByText(/Mateusz/)).toBeTruthy();
    expect(screen.queryByText(/NIP: 5423444020/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "stopka firmowa" }));
    expect(screen.getByText(/NIP: 5423444020/)).toBeTruthy();
  });

  it("wiadomość bez stopki nie dostaje przycisku do pustki", () => {
    os(wpis({ automatyczna: false, tresc: "Szarpak pasuje." }));
    expect(screen.queryByRole("button", { name: /stopka/ })).toBeNull();
  });

  /* ── Login w miejscu słowa „KLIENT" (0.219.2) ───────────────────────────
     Właściciel: „login klienta powinien być na miejscu napisu KLIENT".
     Słowo „klient" jest prawdziwe o KAŻDEJ wiadomości przychodzącej, więc
     nie odróżnia niczego; login odróżnia rozmówcę.                        */
  it("wiadomość klienta podpisuje się jego loginem, nie słowem „klient”", () => {
    os(wpis({ automatyczna: false, odKlienta: true, autor: "bagslublin",
      tresc: "Dzień dobry" }));

    /* Od 0.228.0 login jest PRZYCISKIEM (kopiuje się kliknięciem), a kanał
       stoi obok, poza nim — kopiujemy sam login, nie zdanie o nim. */
    expect(screen.getByRole("button", { name: /Kopiuj login/ })).toHaveTextContent("bagslublin");
    expect(screen.getByText(/· Allegro/)).toBeTruthy();
    /* Login PADA RAZ: powtórzony obok podpisu byłby szumem w tym samym wierszu. */
    expect(screen.getAllByText("bagslublin")).toHaveLength(1);
  });

  it("wątek bez loginu wygląda jak dawniej", () => {
    /* Serwer podstawia wtedy „Klient" — ekran nie udaje, że wie więcej. */
    os(wpis({ automatyczna: false, odKlienta: true, autor: "Klient", tresc: "Dzień dobry" }));
    expect(screen.getByRole("button", { name: /Kopiuj login/ })).toHaveTextContent("Klient");
    expect(screen.getByText(/· Allegro/)).toBeTruthy();
  });

  it("odpowiedź agenta zostaje pełnym kafelkiem", () => {
    /* Bez flagi z serwera wpis idzie zwykłą gałęzią — zwinięcie prawdziwej
       odpowiedzi kosztowałoby więcej niż niezwinięcie jednego odbicia. */
    os(wpis({ automatyczna: false, tresc: "Szarpak SZR-148/82 pasuje." }));
    expect(screen.getByText("Szarpak SZR-148/82 pasuje.")).toBeTruthy();
    expect(screen.queryByText("Autoodpowiedź biura")).toBeNull();
    expect(screen.getByText("Odpowiedź firmy")).toBeTruthy();
  });
});
