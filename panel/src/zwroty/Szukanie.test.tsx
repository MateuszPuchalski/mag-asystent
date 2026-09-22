import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Szukanie } from "./Szukanie";
import type { PaczkaKlienta, WynikSkanu } from "../api/zwroty";

/* Pole mówi, CZEGO szukało. Przy czytniku „nie znalazłem" bez tej informacji
   wygląda identycznie jak zepsuty czytnik — a operator stoi wtedy z paczką
   i nie wie, czy skanować jeszcze raz, czy szukać ręcznie. */

const ETYKIETA = "600000367616070023174201";

/** Historia zakupów jednego klienta — najnowsza paczka pierwsza, jak z serwera. */
const PACZKI: PaczkaKlienta[] = [
  { orderId: "ord-nowy", kupionoAt: "2026-08-20T10:00:00Z", sumaGrosze: 20496,
    waluta: "PLN", pozycji: 1, zawartosc: "Sekator ×1", maZwrot: false,
    odbiorcaNazwa: "Jan Kowalski", kupujacyLogin: "jan_k",
    /* Dwie paczki tego samego nazwiska z RÓŻNYCH ulic — tak wygląda przypadek,
       dla którego adres wszedł do wiersza w 0.422.0. */
    odbiorcaTelefon: "++48 663 509 353", odbiorcaUlica: "Polna 7",
    odbiorcaMiasto: "Poznań", odbiorcaKod: "61-001" },
  { orderId: "ord-stary", kupionoAt: "2026-06-01T10:00:00Z", sumaGrosze: 9900,
    waluta: "PLN", pozycji: 2, zawartosc: "Wąż 20 m ×1 · Złączka ×2", maZwrot: true,
    odbiorcaNazwa: "Jan Kowalski", kupujacyLogin: "jan_k",
    /* Bez telefonu — `phoneNumber` nie stoi w `required` schematu Allegro,
       więc wiersz musi to znieść i nie pokazać samego separatora. */
    odbiorcaTelefon: null, odbiorcaUlica: "Leśna 2",
    odbiorcaMiasto: "Poznań", odbiorcaKod: "61-002" },
];

const pokaz = (wynik: WynikSkanu | null, n: Partial<React.ComponentProps<typeof Szukanie>> = {}) => {
  const p = {
    wynik, kod: ETYKIETA, fraza: "", ile: null, szuka: false, dociaga: false, blad: "",
    onFraza: vi.fn(), onSzukaj: vi.fn(), onDociagnij: vi.fn(), onWybierz: vi.fn(),
    onNieodebrana: vi.fn(), onLogin: vi.fn(), ...n,
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

  it("brak pasujących odsyła do SPACJI i do Entera", () => {
    /* Tytuł mówił „bo numeru listu filtr nie widzi" — nieprawda od 0.344.0.
       Zero trafień jest teraz miejscem na dwie podpowiedzi: drugi człon frazy
       zawęża dalej, a Enter pyta serwer o numery spoza modelu pracy. */
    pokaz(null, { fraza: "600000", ile: 0 });
    expect(screen.getByText(/Spacja zawęża dalej/)).toBeInTheDocument();
    expect(screen.getByText(/Enter pyta o numer listu/)).toBeInTheDocument();
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
    expect(p.onNieodebrana).toHaveBeenCalledWith(expect.objectContaining({
      waybill: ETYKIETA, orderId: "ord-9", notatka: "awizo dwa razy" }));
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
    expect(p.onNieodebrana).toHaveBeenCalledWith(expect.objectContaining({
      waybill: "PACZ-1", orderId: "ord-4" }));
  });

  it("uchwyt człowieka to JEDNO pole: login albo nazwisko z naklejki", async () => {
    /* Zgłoszenie właściciela: „szukanie nieodebranych paczek odbywa się głównie
       za pomocą loginu użytkownika i innych informacji na przesyłce". Przy
       paczce, której klient nie odebrał, loginu najczęściej NIE MA — jest
       karton, a na nim nazwisko. Dwa pola kazałyby operatorowi najpierw
       rozstrzygnąć, czym jest to, co przepisuje. */
    const p = pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    await userEvent.type(screen.getByLabelText("Numer listu przewozowego"), "PACZ-7");
    await userEvent.type(screen.getByLabelText("Login, nazwisko albo telefon"), "Kowalski");
    await userEvent.click(screen.getByRole("button", { name: /Zarejestruj paczkę/ }));
    expect(p.onNieodebrana).toHaveBeenCalledWith(expect.objectContaining({
      waybill: "PACZ-7", login: "Kowalski" }));
  });

  it("wiersz paczki niesie ULICĘ — bez niej dwaj Kowalscy są nierozróżnialni", async () => {
    /* Szukanie po fragmencie nazwiska świadomie pokazuje cudze zakupy przy
       zbieżności nazwisk (0.367.0). Do 0.421.1 operator nie miał czym tych
       dwoje rozróżnić: wiersz niósł samą nazwę. Z tego ekranu wychodzi się
       z czyimś numerem zamówienia w ręku, więc to nie jest ozdoba. */
    pokaz(null, { paczki: PACZKI });
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    expect(screen.getByText(/Polna 7/)).toBeInTheDocument();
    expect(screen.getByText(/Leśna 2/)).toBeInTheDocument();
  });

  it("paczka BEZ telefonu nie pokazuje samego separatora", async () => {
    /* `phoneNumber` nie stoi w `required` schematu `CheckoutFormDeliveryAddress`,
       więc brak numeru to normalny stan, nie usterka synchronizacji. */
    pokaz(null, { paczki: PACZKI });
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    const wiersz = screen.getByText(/Leśna 2/).textContent ?? "";
    expect(wiersz).toBe("Leśna 2 · 61-002 Poznań");
    expect(screen.getByText(/Polna 7/).textContent)
      .toBe("Polna 7 · 61-001 Poznań · ++48 663 509 353");
  });

  it("przewoźnik z naklejki idzie z LISTY, nie z pisania", async () => {
    /* Przy nieodebranej Allegro nie zna przewoźnika wcale, a operator ma logo
       przed oczami. Wpisane „inpost" i „InPost" byłyby dwiema firmami. */
    const p = pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    await userEvent.type(screen.getByLabelText("Numer listu przewozowego"), "PACZ-8");
    await userEvent.selectOptions(screen.getByLabelText("Przewoźnik"), "INPOST");
    await userEvent.click(screen.getByRole("button", { name: /Zarejestruj paczkę/ }));
    expect(p.onNieodebrana).toHaveBeenCalledWith(expect.objectContaining({
      waybill: "PACZ-8", przewoznik: "INPOST" }));
  });

  it("Enter w polu uchwytu PYTA o paczki tego klienta", async () => {
    /* Pytamy po dopisaniu uchwytu, nie po każdym znaku: zapytanie na znak
       byłoby dwunastoma odczytami na jedno nazwisko — i dwunastoma wpisami
       w dzienniku odczytów cudzych danych. */
    const p = pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    const pole = screen.getByLabelText("Login, nazwisko albo telefon");
    await userEvent.type(pole, "Kowalski");
    expect(p.onLogin).not.toHaveBeenCalled();
    await userEvent.type(pole, "{Enter}");
    expect(p.onLogin).toHaveBeenCalledWith("Kowalski");
  });

  it("wybrana paczka WPISUJE numer zamówienia, a ten jedzie do rejestracji", async () => {
    /* Wybór wpisuje numer do pola wyżej, zamiast trzymać go osobno: operator
       ma widzieć, co pojedzie na serwer, a nie ufać, że klik się zapamiętał. */
    const p = pokaz(null, { paczki: PACZKI });
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    await userEvent.type(screen.getByLabelText("Numer listu przewozowego"), "PACZ-9");
    await userEvent.click(screen.getByRole("button", { name: /ord-nowy/ }));
    expect(screen.getByLabelText("Numer zamówienia")).toHaveValue("ord-nowy");

    await userEvent.click(screen.getByRole("button", { name: /Zarejestruj paczkę/ }));
    /* Klik USTALA TRZY RZECZY naraz (0.367.0): numer, login i nazwę odbiorcy.
       Paczkę znalezioną po nazwisku trzeba zapisać z loginem, a operator go
       wtedy nie zna — zna go serwer, który tę paczkę właśnie wskazał. */
    expect(p.onNieodebrana).toHaveBeenCalledWith(expect.objectContaining({
      waybill: "PACZ-9", orderId: "ord-nowy",
      login: "jan_k", odbiorcaNazwa: "Jan Kowalski" }));
  });

  it("paczka ze zwrotem jest OZNACZONA, ale wybieralna", async () => {
    /* Jedno zamówienie bywa dwiema paczkami, a klient potrafi nie odebrać
       drugiej po zwrocie pierwszej. Blokada kazałaby wtedy kłamać. */
    pokaz(null, { paczki: PACZKI });
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    expect(screen.getByText("ma już zwrot")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /ord-stary/ }));
    expect(screen.getByLabelText("Numer zamówienia")).toHaveValue("ord-stary");
  });

  it("klient bez historii dostaje ZDANIE, nie pustkę", async () => {
    /* Pusta lista wygląda jak zepsute szukanie. Operator ma wiedzieć, że może
       iść dalej bez numeru zamówienia. */
    pokaz(null, { paczki: [] });
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    expect(screen.getByText(/Nie mam paczek tego klienta/)).toBeInTheDocument();
  });

  it("ekran mówi, PO CO ten login", async () => {
    /* Pole bez powodu wygląda na kolejną rubrykę do wypełnienia. To zdanie
       jest całą różnicą między „wypełnij" a „to się przyda tobie". */
    pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Nieodebrana/ }));
    expect(screen.getByText(/znajdziesz paczkę później/)).toBeInTheDocument();
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
