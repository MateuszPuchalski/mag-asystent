import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dane from "virtual:wertis-zmiany";
import { PrzyciskZgloszenia, ekranZgloszenia } from "./OknoZgloszenia";
import { atrapaZapisow } from "../test/zapisy";
import { naruszeniaWcag } from "../test/dostepnosc";
import type { Zgloszenie } from "../api/zgloszenia";

/* ── OKNO ZGŁOSZENIA PRACOWNIKA ─────────────────────────────────────────────
   Pilnujemy: otwarcie niczego nie zapisuje, ciało niesie adres ekranu bez
   zapytania, zdjęć jest najwyżej cztery, a wklejony zrzut staje się zdjęciem.
   Zmniejszanie na płótnie podmieniamy, bo jsdom nie rysuje obrazów. */

vi.mock("./zdjecie", () => {
  let n = 0;
  return { przygotujZdjecie: vi.fn(async () => `data:image/jpeg;base64,ZDJ${++n}`) };
});

const MOJE: Zgloszenie = {
  id: 3, rodzaj: "przeszkadza", opis: "Lista zwrotów skacze po odświeżeniu.", ekran: "/obsluga/zwroty",
  zrodlo: "panel", wersja: "0.617.0", urzadzenie: null, at: "2026-11-04T10:00:00.000Z", autor: "Ola",
  status: "przyjete", odpowiedz: "Poprawimy w przyszłym tygodniu.", statusAt: "2026-11-04T12:00:00.000Z",
  statusPrzez: "Mateusz", zdjecia: [],
};

const odczyt = (url: string) => (url === "/api/zgloszenia/moje" ? { zgloszenia: [MOJE] } : undefined);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

function pokaz(adres = "/obsluga/zwroty?szukaj=Kowalski#wiersz") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[adres]}>
    <PrzyciskZgloszenia />
  </MemoryRouter></QueryClientProvider>);
}

const otworz = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Zgłoś uwagę lub pomysł" }));
  return screen.getByRole("dialog", { name: "Zgłoś uwagę lub pomysł" });
};

const zdjecie = (nazwa: string) => new File(["x"], nazwa, { type: "image/png" });
const wybierz = (pliki: File[]) =>
  fireEvent.change(screen.getByLabelText("Wybierz zdjęcia"), { target: { files: pliki } });

/** Ciało POST-u złożenia z samego `fetch`, bo atrapa liczy tylko adresy. */
const cialoZlozenia = () => {
  const wywolanie = vi.mocked(fetch).mock.calls.find(([u, i]) => u === "/api/zgloszenia" && i?.method === "POST");
  return wywolanie ? JSON.parse(String(wywolanie[1]!.body)) : null;
};

describe("okno zgłoszenia", () => {
  it("otwarcie okna nie wysyła zapisu i pokazuje własne zgłoszenia z odpowiedzią", async () => {
    const stan = atrapaZapisow(odczyt);
    pokaz();
    const okno = await otworz();
    expect(await within(okno).findByText("Poprawimy w przyszłym tygodniu.")).toBeTruthy();
    expect(within(okno).getByText("Przyjęte")).toBeTruthy();
    /* Fokus czeka w opisie: okno otwiera się po to, żeby pisać. */
    expect(document.activeElement).toBe(within(okno).getByLabelText("Co się dzieje?"));
    expect(stan.nieznane).toEqual([]);
    expect(stan.wyslane).toEqual([]);
    expect(await naruszeniaWcag()).toBe("");
  });

  it("wysyłka niesie rodzaj, opis, ekran bez zapytania, wersję i zdjęcie, a potem dziękuje", async () => {
    const stan = atrapaZapisow(odczyt, () => ({ status: 200, cialo: { zgloszenie: { ...MOJE, id: 4 } } }));
    pokaz();
    const okno = await otworz();
    const wyslij = within(okno).getByRole("button", { name: "Wyślij zgłoszenie" });
    expect(wyslij).toBeDisabled();
    await userEvent.click(within(okno).getByRole("button", { name: "Nie działa" }));
    await userEvent.type(within(okno).getByLabelText("Co się dzieje?"), "  Drukarka etykiet milczy.  ");
    wybierz([zdjecie("zrzut.png")]);
    expect(await within(okno).findByRole("img", { name: "Zdjęcie 1" })).toBeTruthy();
    await userEvent.click(wyslij);

    expect(await within(okno).findByText("Dziękujemy. Zgłoszenie dotarło do właściciela.")).toBeTruthy();
    expect(stan.wyslane).toEqual(["POST /api/zgloszenia"]);
    expect(cialoZlozenia()).toEqual({
      rodzaj: "blad", opis: "Drukarka etykiet milczy.", ekran: "/obsluga/zwroty", zrodlo: "panel",
      wersja: dane.wersja, zdjecia: ["data:image/jpeg;base64,ZDJ1"],
    });
    /* Okno czyści się po wysyłce, więc drugie zgłoszenie zaczyna od zera. */
    expect((within(okno).getByLabelText("Co się dzieje?") as HTMLTextAreaElement).value).toBe("");
    expect(within(okno).queryByRole("img", { name: "Zdjęcie 1" })).toBeNull();
    expect(within(okno).getByRole("button", { name: "Nie działa" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("przyjmuje najwyżej cztery zdjęcia i mówi, co pominęło", async () => {
    atrapaZapisow(odczyt);
    pokaz();
    const okno = await otworz();
    wybierz(["a", "b", "c", "d", "e", "f"].map((n) => zdjecie(`${n}.png`)));
    expect(await within(okno).findByRole("img", { name: "Zdjęcie 4" })).toBeTruthy();
    expect(within(okno).queryByRole("img", { name: "Zdjęcie 5" })).toBeNull();
    expect(within(okno).getByText(/Najwyżej 4 zdjęcia/)).toBeTruthy();
    expect(within(okno).getByRole("button", { name: /Dodaj zdjęcie/ })).toBeDisabled();

    /* Usunięcie zwalnia miejsce na następne. */
    await userEvent.click(within(okno).getByRole("button", { name: "Usuń zdjęcie 2" }));
    expect(within(okno).getAllByRole("img")).toHaveLength(3);
    expect(within(okno).getByRole("button", { name: /Dodaj zdjęcie/ })).toBeEnabled();
  });

  it("wklejony zrzut ekranu staje się zdjęciem, a wklejony tekst idzie do opisu", async () => {
    atrapaZapisow(odczyt);
    pokaz();
    const okno = await otworz();
    fireEvent.paste(within(okno).getByLabelText("Co się dzieje?"),
      { clipboardData: { files: [zdjecie("schowek.png")], items: [] } });
    expect(await within(okno).findByRole("img", { name: "Zdjęcie 1" })).toBeTruthy();

    const tekst = fireEvent.paste(within(okno).getByLabelText("Co się dzieje?"),
      { clipboardData: { files: [], items: [] } });
    /* `true` znaczy: zdarzenie nie zostało zatrzymane, więc tekst trafia do pola. */
    expect(tekst).toBe(true);
    expect(within(okno).getAllByRole("img")).toHaveLength(1);
  });

  it("Escape zamyka puste okno, ale nie to, w którym już coś napisano", async () => {
    atrapaZapisow(odczyt);
    pokaz();
    await otworz();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    const okno = await otworz();
    await userEvent.type(within(okno).getByLabelText("Co się dzieje?"), "Coś");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("błąd serwera zostaje w oknie razem z treścią zgłoszenia", async () => {
    atrapaZapisow(odczyt, () => ({ status: 400, cialo: { error: "Opis jest za długi." } }));
    pokaz();
    const okno = await otworz();
    await userEvent.click(within(okno).getByRole("button", { name: "Pomysł" }));
    await userEvent.type(within(okno).getByLabelText("Co się dzieje?"), "Skrót do koszy");
    await userEvent.click(within(okno).getByRole("button", { name: "Wyślij zgłoszenie" }));
    expect(await within(okno).findByText("Opis jest za długi.")).toBeTruthy();
    expect((within(okno).getByLabelText("Co się dzieje?") as HTMLTextAreaElement).value).toBe("Skrót do koszy");
  });
});

describe("adres ekranu w zgłoszeniu", () => {
  it("profil klienta traci login, bo login jest kluczem kupującego", () => {
    expect(ekranZgloszenia("/obsluga/klient/jan_kowalski")).toBe("/obsluga/klient/:login");
    expect(ekranZgloszenia("/obsluga/zwroty/12")).toBe("/obsluga/zwroty/12");
  });
});
