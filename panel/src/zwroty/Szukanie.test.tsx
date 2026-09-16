import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Szukanie } from "./Szukanie";
import type { WynikSkanu } from "../api/zwroty";

/* Pole mówi, CZEGO szukało. Przy czytniku „nie znalazłem" bez tej informacji
   wygląda identycznie jak zepsuty czytnik — a operator stoi wtedy z paczką
   i nie wie, czy skanować jeszcze raz, czy szukać ręcznie. */

const ETYKIETA = "600000367616070023174201";

const pokaz = (wynik: WynikSkanu | null, n: Partial<React.ComponentProps<typeof Szukanie>> = {}) => {
  const p = {
    wynik, kod: ETYKIETA, fraza: "", ile: null, szuka: false, dociaga: false, blad: "",
    onFraza: vi.fn(), onSzukaj: vi.fn(), onDociagnij: vi.fn(), onWybierz: vi.fn(),
    onNieodebrana: vi.fn(), ...n,
  };
  render(<Szukanie {...p} />);
  return p;
};

/* Czytnik wysyła znaki co kilka milisekund. `userEvent` pisze z opóźnieniami
   człowieka, więc serię stukamy wprost — i sami trzymamy zegar, bo od niego
   zależy cała reguła. */
function zeskanuj(pole: HTMLElement, kod: string, fraza: string, onFraza: (v: string) => void) {
  let widziane = fraza;
  let teraz = 10_000;
  const zegar = vi.spyOn(Date, "now").mockImplementation(() => teraz);
  for (const k of kod) {
    const zdarzenie = fireEvent.keyDown(pole, { key: k });
    /* `fireEvent` oddaje false, gdy obsługa zjadła zdarzenie — wtedy pole
       dostaje nową wartość z `onFraza`, a nie doklejony znak. */
    widziane = zdarzenie ? widziane + k : widziane;
    teraz += 10;
  }
  fireEvent.keyDown(pole, { key: "Enter" });
  zegar.mockRestore();
  return widziane;
}

describe("Pole szukania zwrotu", () => {
  it("skan ZASTĘPUJE treść pola, zamiast dopisywać się na końcu", () => {
    /* Zgłoszenie właściciela (0.329.0). Kursor stojący w polu ucisza
       `useSkaner`, więc znaki czytnika lecą tu jak pisanie — druga etykieta
       doklejała się do pierwszej i szukanie po sklejeniu nie znajdowało nic. */
    const p = pokaz(null, { fraza: "N4QZ/2026" });
    const pole = screen.getByPlaceholderText(/Zeskanuj etykietę/);

    zeskanuj(pole, ETYKIETA, "N4QZ/2026", p.onFraza);
    /* Pole dostaje SAM kod — pierwsza podmiana pada na progu serii. */
    expect(p.onFraza).toHaveBeenCalledWith(ETYKIETA.slice(0, 6));
    /* A szukamy po całym kodzie, nie po sklejeniu ze starą treścią. */
    expect(p.onSzukaj).toHaveBeenCalledWith(ETYKIETA);
  });

  it("Enter po ręcznym wpisaniu szuka po CAŁEJ treści pola", () => {
    /* Reguła ma nie ruszać drogi, którą biuro chodzi od 0.165.0. */
    const p = pokaz(null, { fraza: "N4QZ/2026" });
    fireEvent.keyDown(screen.getByPlaceholderText(/Zeskanuj etykietę/), { key: "Enter" });
    expect(p.onSzukaj).toHaveBeenCalledWith("N4QZ/2026");
  });

  it("nieznany kod pokazuje SIEBIE i drogę wyjścia", async () => {
    const p = pokaz({ trafienie: null, zwrotId: null, zwroty: [] });
    /* Kod na ekranie, bo naklejka bywa pomięta i skan urwany w połowie. */
    expect(screen.getByText(ETYKIETA)).toBeInTheDocument();
    expect(screen.getByText(/Szukałem po numerze listu/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Poszukaj w Allegro/ }));
    expect(p.onDociagnij).toHaveBeenCalledWith(ETYKIETA);
  });

  it("dwa trafienia każą wybrać, zamiast otwierać pierwsze z brzegu", async () => {
    /* Przy zwrocie pomyłka znaczy cudzego klienta i cudze pieniądze. */
    const p = pokaz({
      trafienie: "wiele", zwrotId: null,
      zwroty: [{ id: 7, numer: "1111/Z04A", externalId: "a" },
        { id: 9, numer: null, externalId: "b-uuid" }],
    });
    expect(screen.getByText(/pasuje do 2 zwrotów/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1111/Z04A" }));
    expect(p.onWybierz).toHaveBeenCalledWith(7);
    /* Zwrot bez numeru referencyjnego pokazuje identyfikator, a nie pustkę. */
    expect(screen.getByRole("button", { name: "b-uuid" })).toBeInTheDocument();
  });

  it("trafienie nie zostawia po sobie żadnego komunikatu", () => {
    /* Zwrot już się otworzył — pasek z informacją byłby śmieciem na ekranie. */
    pokaz({ trafienie: "waybill", zwrotId: 4, zwroty: [] });
    expect(screen.queryByText(/Nie znam kodu/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pasuje do/)).not.toBeInTheDocument();
  });

  it("bez czytnika da się wpisać numer i zatwierdzić Enterem", async () => {
    const p = pokaz(null, { fraza: "1234/Z04A" });
    await userEvent.type(screen.getByPlaceholderText(/Zeskanuj etykietę/), "{Enter}");
    expect(p.onSzukaj).toHaveBeenCalledWith("1234/Z04A");
  });

  it("puste pole nie strzela do serwera", async () => {
    const p = pokaz(null, { fraza: "   " });
    await userEvent.type(screen.getByPlaceholderText(/Zeskanuj etykietę/), "{Enter}");
    expect(p.onSzukaj).not.toHaveBeenCalled();
  });

  it("Esc oddaje klawisze ekranowi — kursor wychodzi z pola, treść zostaje", async () => {
    /* Skróty milkną w polu tekstowym. Na nagraniu z biura `P` po skanie nie
       działało i zwrot przyjmowało kliknięcie (audyt, 15 września 2026). */
    const p = pokaz(null, { fraza: "N4QZ/2026" });
    const pole = screen.getByPlaceholderText(/Zeskanuj etykietę/);
    pole.focus();
    await userEvent.keyboard("{Escape}");
    expect(pole).not.toHaveFocus();
    expect(p.onFraza).not.toHaveBeenCalled();
    expect(p.onSzukaj).not.toHaveBeenCalled();
  });

  it("każdy znak idzie do filtru, bez czekania na Enter", async () => {
    /* Filtr liczy się w pamięci ekranu, więc opóźnianie go byłoby opóźnianiem
       tego, co i tak jest natychmiastowe. */
    const p = pokaz(null);
    await userEvent.type(screen.getByPlaceholderText(/Zeskanuj etykietę/), "56");
    expect(p.onFraza).toHaveBeenCalledTimes(2);
    expect(p.onSzukaj).not.toHaveBeenCalled();
  });

  it("mówi, ile pasuje i że szuka poza kubełkiem", () => {
    /* Bez tego zdania wynik z kubełka ZAMKNIĘTE wyglądałby jak praca. */
    pokaz(null, { fraza: "567", ile: 3 });
    expect(screen.getByText(/3 zwroty pasują — szukam po wszystkich kubełkach/))
      .toBeInTheDocument();
  });

  it("brak pasujących odsyła do Enter, bo numeru listu filtr nie widzi", () => {
    pokaz(null, { fraza: "600000", ile: 0 });
    expect(screen.getByText(/Enter zapyta jeszcze o numer listu/)).toBeInTheDocument();
  });

  it("krzyżyk czyści pole jednym kliknięciem", async () => {
    /* Kasowanie dwudziestu czterech znaków po jednym to osobna czynność. */
    const p = pokaz(null, { fraza: ETYKIETA });
    await userEvent.click(screen.getByRole("button", { name: "Wyczyść szukanie" }));
    expect(p.onFraza).toHaveBeenCalledWith("");
  });

  it("puste pole nie pokazuje ani licznika, ani krzyżyka", () => {
    pokaz(null);
    expect(screen.queryByRole("button", { name: "Wyczyść szukanie" })).not.toBeInTheDocument();
    expect(screen.queryByText(/kubełkach/)).not.toBeInTheDocument();
  });

  it("nieznany kod daje DWIE drogi wyjścia, nie jedną", async () => {
    /* Allegro nie zna zwrotu, którego klient nie zgłosił: nieodebrana
       przesyłka wraca sama i zwrotem nigdy nie zostanie. */
    const p = pokaz({ trafienie: null, zwrotId: null, zwroty: [] });
    expect(screen.getByRole("button", { name: /Poszukaj w Allegro/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /To nieodebrana paczka/ }));

    await userEvent.type(screen.getByLabelText("Numer zamówienia"), "ord-9");
    await userEvent.type(screen.getByLabelText("Notatka"), "awizo dwa razy");
    await userEvent.click(screen.getByRole("button", { name: /Zarejestruj paczkę/ }));
    expect(p.onNieodebrana).toHaveBeenCalledWith(ETYKIETA, "ord-9", "awizo dwa razy", "");
  });

  it("rejestracja mówi wprost, że to nie jest zgłoszenie klienta", async () => {
    pokaz({ trafienie: null, zwrotId: null, zwroty: [] });
    await userEvent.click(screen.getByRole("button", { name: /To nieodebrana paczka/ }));
    expect(screen.getByText(/NIE jest zwrot/)).toBeInTheDocument();
    /* Numer zamówienia jest opcjonalny, ale ekran mówi, co za niego dostaje. */
    expect(screen.getByText(/będzie co wycenić/)).toBeInTheDocument();
  });

  it("paczkę nieodebraną da się zarejestrować BEZ nieudanego skanu (0.338.0)", async () => {
    /* Zgłoszenie właściciela: „jest sporo paczek, które po prostu zostały
       nieodebrane i wracają do nas". Droga istniała od 0.172.0, ale szła przez
       ślepy zaułek — najpierw zeskanuj kod, dostań „nie znam kodu", dopiero
       wtedy zobacz przycisk. Przy paczce na krzyż to przechodzi; przy „sporo
       paczek" to codzienna praca schowana za komunikatem o błędzie. */
    const p = pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    /* Bez skanu numer listu trzeba WPISAĆ: to jedyny uchwyt takiej paczki. */
    await userEvent.type(screen.getByLabelText("Numer listu przewozowego"), "PACZ-1");
    await userEvent.type(screen.getByLabelText("Numer zamówienia"), "ord-4");
    await userEvent.click(screen.getByRole("button", { name: /Zarejestruj paczkę/ }));
    expect(p.onNieodebrana).toHaveBeenCalledWith("PACZ-1", "ord-4", "", "");
  });

  it("login kupującego idzie z formularza — po nim biuro wraca do paczki", async () => {
    /* Zgłoszenie właściciela: „nieodebrane paczki powinienem móc wyszukiwać po
       loginie klienta". Numeru zamówienia przy nieodebranej najczęściej nie
       ma, a wtedy login jest jedynym uchwytem, jaki operator ma pod ręką. */
    const p = pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    await userEvent.type(screen.getByLabelText("Numer listu przewozowego"), "PACZ-7");
    await userEvent.type(screen.getByLabelText("Login kupującego"), "jan_kowalski");
    await userEvent.click(screen.getByRole("button", { name: /Zarejestruj paczkę/ }));
    expect(p.onNieodebrana).toHaveBeenCalledWith("PACZ-7", "", "", "jan_kowalski");
  });

  it("ekran mówi, PO CO ten login", async () => {
    /* Pole bez powodu wygląda na kolejną rubrykę do wypełnienia. To zdanie
       jest całą różnicą między „wypełnij" a „to się przyda tobie". */
    pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    expect(screen.getByText(/znajdziesz tę paczkę później/)).toBeInTheDocument();
  });

  it("bez numeru listu rejestracja MILCZY", async () => {
    /* Serwer i tak odmówi („numer listu jest tu jedynym uchwytem"), a odmowa
       po kliknięciu kosztuje przejście w obie strony. */
    pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    expect(screen.getByRole("button", { name: /Zarejestruj paczkę/ })).toBeDisabled();
  });

  it("po nieudanym skanie numer BIERZE SIĘ ZE SKANU, bez drugiego pola", async () => {
    /* Dwa pola na ten sam numer byłyby pytaniem o to, co czytnik już podał. */
    pokaz({ trafienie: null, zwrotId: null, zwroty: [] });
    await userEvent.click(screen.getByRole("button", { name: /To nieodebrana paczka/ }));
    expect(screen.queryByLabelText("Numer listu przewozowego")).toBeNull();
  });

  it("bez podpiętej obsługi ekran nie proponuje rejestracji", () => {
    /* Przycisk bez działania obiecywałby drogę, której nie ma. */
    pokaz({ trafienie: null, zwrotId: null, zwroty: [] }, { onNieodebrana: undefined });
    expect(screen.queryByRole("button", { name: /nieodebrana paczka/ })).toBeNull();
  });

  it("odmowa serwera ląduje przy polu, a nie w konsoli", () => {
    pokaz(null, { blad: "Konto Allegro nie jest sparowane" });
    expect(screen.getByText(/nie jest sparowane/)).toBeInTheDocument();
  });
});
