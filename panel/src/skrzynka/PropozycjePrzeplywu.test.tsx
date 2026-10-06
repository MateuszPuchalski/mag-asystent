import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropozycjaPrzeplywu } from "../api/typy";
import { czas } from "../ui";
import { atrapaZapisow } from "../test/zapisy";
import { naruszeniaWcag } from "../test/dostepnosc";
import { PropozycjePrzeplywu } from "./PropozycjePrzeplywu";

/* ── „Automat by…" w rozmowie (tryb cienia) ──────────────────────────────────
   Pilnuje czterech rzeczy, w kolejności, w jakiej agent je przechodzi:

   1. Otwarcie rozmowy nic nie zapisuje — werdykt stoi za kliknięciem.
   2. Przyciski stoją tylko tam, gdzie agent jest sędzią: przy kroku i pilnym
      bez werdyktu. „Wysłałby szkic" ocenia wysyłka.
   3. Kliknięcie wysyła jeden POST z ciałem `{ werdykt }` na trasę propozycji.
   4. Po werdykcie wiersz mówi, co rozstrzygnięto i kto, już bez przycisków.

   Na żywo dochodzi piąta: szkic wysłany przez automat ma chwilę wysyłki
   i ocenę po fakcie, a nieudana wysyłka nie ma czego oceniać. */

afterEach(() => vi.unstubAllGlobals());

const prop = (n: Partial<PropozycjaPrzeplywu>): PropozycjaPrzeplywu => ({
  id: 1, rodzaj: "pilne", kategoria: "WRONG_PRODUCT", instrukcja: null,
  at: "2026-10-06T08:00:00.000Z", werdykt: null, werdyktZrodlo: null,
  werdyktPrzez: null, werdyktAt: null, wykonanaAt: null, wykonanieBlad: null, ...n,
});

const TRZY = [
  prop({ id: 11, rodzaj: "wyslij" }),
  prop({ id: 12, rodzaj: "krok", instrukcja: "Sprawdź na półce, czy towar zgadza się z etykietą." }),
  prop({ id: 13, rodzaj: "pilne" }),
];

function rysuj(propozycje: PropozycjaPrzeplywu[] | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>
    <PropozycjePrzeplywu rozmowaId={5} propozycje={propozycje} />
  </QueryClientProvider>);
}

const wiersz = (rodzaj: string) =>
  document.querySelector<HTMLElement>(`li[data-rodzaj="${rodzaj}"]`)!;

describe("PropozycjePrzeplywu", () => {
  it("rysuje trzy rodzaje z nagłówkiem trybu cienia i nic nie zapisuje przy otwarciu", async () => {
    const zapisy = atrapaZapisow(() => undefined);
    rysuj(TRZY);
    const karta = screen.getByRole("region", { name: "Automat by" });
    expect(karta.textContent).toContain("Automat by…");
    expect(karta.textContent).toContain("tryb cienia — nic nie dzieje się samo");
    /* Kategoria po polsku, ze słownika skrzynki, nie kod z serwera. */
    expect(karta.textContent).toContain("Inny towar");
    expect(karta.textContent).not.toContain("WRONG_PRODUCT");

    expect(wiersz("wyslij").textContent).toContain("wysłał szkic bez zmian");
    expect(wiersz("krok").textContent).toContain("zlecił hali: Sprawdź na półce");
    expect(wiersz("pilne").textContent).toContain("oznaczył jako pilne");

    expect(zapisy.wyslane).toEqual([]);
    expect(zapisy.nieznane).toEqual([]);
    expect(await naruszeniaWcag()).toBe("");
  });

  it("przyciski tylko przy kroku i pilnym bez werdyktu; wysyłka ocenia się sama", () => {
    atrapaZapisow(() => undefined);
    rysuj(TRZY);
    expect(within(wiersz("wyslij")).queryAllByRole("button")).toEqual([]);
    expect(wiersz("wyslij").textContent).toContain("oceni to wysyłka");
    expect(within(wiersz("krok")).getByRole("button", { name: "Zleć" })).toBeInTheDocument();
    expect(within(wiersz("krok")).getByRole("button", { name: "Nie zlecaj hali" })).toBeInTheDocument();
    expect(within(wiersz("pilne")).getByRole("button", { name: "Oznacz" })).toBeInTheDocument();
    expect(within(wiersz("pilne")).getByRole("button", { name: "Nie oznaczaj jako pilne" })).toBeInTheDocument();
  });

  it("zgoda i sprzeciw wysyłają jeden POST z ciałem werdyktu na trasę propozycji", async () => {
    const zapisy = atrapaZapisow(() => undefined);
    rysuj(TRZY);
    await userEvent.click(screen.getByRole("button", { name: "Zleć" }));
    await waitFor(() => expect(zapisy.wyslane).toEqual(["POST /api/obsluga/rozmowy/5/przeplyw/12"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Nie oznaczaj jako pilne" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Nie oznaczaj jako pilne" }));
    await waitFor(() => expect(zapisy.wyslane).toHaveLength(2));
    expect(zapisy.wyslane[1]).toBe("POST /api/obsluga/rozmowy/5/przeplyw/13");

    const posty = (fetch as Mock).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posty.map(([, init]) => JSON.parse(init.body))).toEqual([
      { werdykt: "zgoda" }, { werdykt: "sprzeciw" }]);
  });

  it("po werdykcie wiersz mówi wynik i kto, bez przycisków", () => {
    atrapaZapisow(() => undefined);
    rysuj([
      prop({ id: 21, rodzaj: "wyslij", werdykt: "zgoda", werdyktZrodlo: "wysylka", werdyktPrzez: "Ola" }),
      prop({ id: 22, rodzaj: "krok", instrukcja: "Sprawdź stan.", werdykt: "zgoda",
        werdyktZrodlo: "agent", werdyktPrzez: "Ola", werdyktAt: "2026-10-06T09:00:00.000Z" }),
      prop({ id: 23, rodzaj: "pilne", werdykt: "sprzeciw", werdyktZrodlo: "agent", werdyktPrzez: "Jan" }),
    ]);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(wiersz("wyslij").textContent).toContain("zgoda — wysłany bez zmian · Ola");
    expect(wiersz("krok").textContent).toContain("zgoda — zlecone hali · Ola");
    expect(wiersz("pilne").textContent).toContain("sprzeciw · Jan");
  });

  it("szkic poprawiony przy wysyłce to sprzeciw wobec automatu", () => {
    atrapaZapisow(() => undefined);
    rysuj([prop({ id: 31, rodzaj: "wyslij", werdykt: "sprzeciw", werdyktZrodlo: "wysylka", werdyktPrzez: "Ola" })]);
    expect(wiersz("wyslij").textContent).toContain("sprzeciw — poprawiony albo odrzucony · Ola");
  });

  it("pusta lista i brak pola nic nie rysują", () => {
    atrapaZapisow(() => undefined);
    const { container, unmount } = rysuj([]);
    expect(container).toBeEmptyDOMElement();
    unmount();
    const drugi = rysuj(undefined);
    expect(drugi.container).toBeEmptyDOMElement();
  });

  /* Odmowa serwera (409: rozpoznanie się zmieniło) dochodzi zdaniem serwera,
     a nie gołym kodem — agent ma wiedzieć, czemu karta się przestawia. */
  it("odmowa serwera dochodzi zdaniem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Rozpoznanie się zmieniło — propozycja nieaktualna" }), { status: 409 })));
    rysuj(TRZY);
    await userEvent.click(screen.getByRole("button", { name: "Oznacz" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rozpoznanie się zmieniło");
  });

  /* ── Na żywo ────────────────────────────────────────────────────────────── */
  const WYSLANA = "2026-10-06T10:04:00.000Z";

  it("szkic wysłany przez automat: chwila wysyłki, nagłówek na żywo, dwa przyciski oceny", async () => {
    const zapisy = atrapaZapisow(() => undefined);
    rysuj([prop({ id: 51, rodzaj: "wyslij", kategoria: "ORDER_STATUS", wykonanaAt: WYSLANA })]);
    const karta = screen.getByRole("region", { name: "Automat by" });
    expect(karta.textContent).toContain("na żywo — automat odpisał sam");
    expect(karta.textContent).not.toContain("tryb cienia");
    expect(wiersz("wyslij").textContent).toContain(`Automat wysłał szkic · ${czas(WYSLANA)}`);
    expect(wiersz("wyslij").textContent).not.toContain("oceni to wysyłka");
    expect(within(wiersz("wyslij")).getByRole("button", { name: "W porządku" })).toBeInTheDocument();
    expect(within(wiersz("wyslij")).getByRole("button", { name: "Źle wysłane" })).toBeInTheDocument();
    /* Otwarcie karty z wysłanym szkicem też nic nie zapisuje. */
    expect(zapisy.wyslane).toEqual([]);
    expect(zapisy.nieznane).toEqual([]);
    expect(await naruszeniaWcag()).toBe("");
  });

  it("„W porządku” to zgoda, „Źle wysłane” to sprzeciw, oba jednym POST-em na trasę propozycji", async () => {
    const zapisy = atrapaZapisow(() => undefined);
    rysuj([
      prop({ id: 52, rodzaj: "wyslij", kategoria: "ORDER_STATUS", wykonanaAt: WYSLANA }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "W porządku" }));
    await waitFor(() => expect(zapisy.wyslane).toEqual(["POST /api/obsluga/rozmowy/5/przeplyw/52"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Źle wysłane" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Źle wysłane" }));
    await waitFor(() => expect(zapisy.wyslane).toHaveLength(2));
    const posty = (fetch as Mock).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posty.map(([, init]) => JSON.parse(init.body))).toEqual([
      { werdykt: "zgoda" }, { werdykt: "sprzeciw" }]);
  });

  it("po ocenie wysłanego wiersz mówi wynik i kto, bez przycisków", () => {
    atrapaZapisow(() => undefined);
    rysuj([
      prop({ id: 53, rodzaj: "wyslij", kategoria: "ORDER_STATUS", wykonanaAt: WYSLANA,
        werdykt: "zgoda", werdyktZrodlo: "agent", werdyktPrzez: "Ola" }),
      prop({ id: 54, rodzaj: "wyslij", kategoria: "ORDER_STATUS", wykonanaAt: WYSLANA,
        werdykt: "sprzeciw", werdyktZrodlo: "agent", werdyktPrzez: "Jan" }),
    ]);
    expect(screen.queryAllByRole("button")).toEqual([]);
    const [dobry, zly] = document.querySelectorAll<HTMLElement>('li[data-rodzaj="wyslij"]');
    expect(dobry.textContent).toContain("w porządku · Ola");
    expect(zly.textContent).toContain("źle wysłane · Jan");
    expect(dobry.textContent).not.toContain("wysłany bez zmian");
  });

  it("nieudana wysyłka mówi błąd, bez przycisków, a nagłówek nie udaje cienia", () => {
    atrapaZapisow(() => undefined);
    rysuj([prop({ id: 55, rodzaj: "wyslij", kategoria: "ORDER_STATUS",
      wykonanieBlad: "Allegro odrzuciło wiadomość (422)" })]);
    expect(wiersz("wyslij").textContent).toContain("Automat nie wysłał: Allegro odrzuciło wiadomość (422)");
    expect(within(wiersz("wyslij")).queryAllByRole("button")).toEqual([]);
    expect(wiersz("wyslij").textContent).not.toContain("oceni to wysyłka");
    const karta = screen.getByRole("region", { name: "Automat by" });
    expect(karta.textContent).toContain("na żywo — wysyłka automatu się nie udała");
    expect(karta.textContent).not.toContain("tryb cienia");
  });

  /* Niepewna wysyłka mogła dojść. „Nie wysłał" namówiłoby agenta na drugi list. */
  it("niepewna wysyłka nie mówi „nie wysłał”, tylko każe sprawdzić oś", () => {
    atrapaZapisow(() => undefined);
    rysuj([prop({ id: 56, rodzaj: "wyslij", kategoria: "ORDER_STATUS", wykonanieBlad: "niepewna" })]);
    expect(wiersz("wyslij").textContent).toContain("Automat nie wie, czy szkic doszedł — sprawdź oś rozmowy");
    expect(wiersz("wyslij").textContent).not.toContain("nie wysłał");
    expect(within(wiersz("wyslij")).queryAllByRole("button")).toEqual([]);
  });
});
