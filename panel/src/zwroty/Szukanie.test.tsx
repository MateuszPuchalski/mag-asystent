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
    odbiorcaMiasto: "Poznań", odbiorcaKod: "61-001",
    link: "https://allegro.pl/moje-allegro/sprzedaz/zamowienia/ord-nowy" },
  { orderId: "ord-stary", kupionoAt: "2026-06-01T10:00:00Z", sumaGrosze: 9900,
    waluta: "PLN", pozycji: 2, zawartosc: "Wąż 20 m ×1 · Złączka ×2", maZwrot: true,
    odbiorcaNazwa: "Jan Kowalski", kupujacyLogin: "jan_k",
    /* Bez telefonu — `phoneNumber` nie stoi w `required` schematu Allegro,
       więc wiersz musi to znieść i nie pokazać samego separatora. */
    odbiorcaTelefon: null, odbiorcaUlica: "Leśna 2",
    odbiorcaMiasto: "Poznań", odbiorcaKod: "61-002",
    /* Bez wzorca adresu serwer oddaje `null` — wiersz zostaje samym opisem. */
    link: null },
];

const pokaz = (wynik: WynikSkanu | null, n: Partial<React.ComponentProps<typeof Szukanie>> = {}) => {
  const p = {
    wynik, kod: ETYKIETA, fraza: "", ile: null, szuka: false, dociaga: false, blad: "",
    onFraza: vi.fn(), onSzukaj: vi.fn(), onDociagnij: vi.fn(), onWybierz: vi.fn(),
    onLogin: vi.fn(), ...n,
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
    /* Lista przeszukanych pól zeszła do podpowiedzi (0.479.0) — na
       ekranie zostaje zdanie, które mówi, co robić dalej. */
    expect(screen.getByTitle(/Szukałem po numerze listu/)).toHaveTextContent(/Szukaj po kliencie/);

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

  it("nieznany kod daje DWIE drogi wyjścia: Allegro albo klient", async () => {
    /* Przy nieodebranej paczce numer listu nie trafi nigdy — naklejał ją
       klient albo kurier. Login albo nazwisko z naklejki tak. */
    const p = pokaz({ trafienie: null, zwrotId: null, zwroty: [] });
    expect(screen.getByRole("button", { name: /Poszukaj w Allegro/ })).toBeInTheDocument();
    /* Od 0.479.0 pole klienta otwiera się SAMO i ma fokus — klik, który
       po chybionym skanie następował zawsze, zszedł z drogi. */
    const pole = screen.getByLabelText("Login, nazwisko albo telefon");
    expect(pole).toHaveFocus();
    await userEvent.type(pole, "jan_k{Enter}");
    expect(p.onLogin).toHaveBeenCalledWith("jan_k");
  });

  it("po Escape przycisk „Szukaj po kliencie” otwiera pole z powrotem", async () => {
    /* Samo otwarcie nie może zabrać drogi powrotnej: kto zamknął pole,
       bo szukał w Allegro, musi móc do niego wrócić bez nowego skanu. */
    pokaz({ trafienie: null, zwrotId: null, zwroty: [] });
    fireEvent.keyDown(screen.getByLabelText("Login, nazwisko albo telefon"), { key: "Escape" });
    expect(screen.queryByLabelText("Login, nazwisko albo telefon")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Szukaj po kliencie/ }));
    expect(screen.getByLabelText("Login, nazwisko albo telefon")).toHaveFocus();
  });

  it("rejestracji paczki NIE MA — decyzja właściciela (0.451.0)", async () => {
    /* „Usuń opcję rejestracji paczki — ja tylko wyszukuję ją w Allegro".
       Z formularza zostaje jedno pole; numer listu, zamówienie, przewoźnik
       i notatka odeszły razem z przyciskiem zapisu. */
    pokaz({ trafienie: null, zwrotId: null, zwroty: [] }, { paczki: PACZKI });
    expect(screen.queryByRole("button", { name: /nieodebrana/i })).toBeNull();
    /* Pole klienta stoi otwarte samo (0.479.0) — i dalej bez rejestracji. */
    expect(screen.getByLabelText("Login, nazwisko albo telefon")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zarejestruj/ })).toBeNull();
    expect(screen.queryByLabelText("Numer listu przewozowego")).toBeNull();
    expect(screen.queryByLabelText("Numer zamówienia")).toBeNull();
    expect(screen.queryByLabelText("Przewoźnik")).toBeNull();
  });

  it("paczkę bez zwrotu przyjmuje się jednym kliknięciem, a wiersz dalej prowadzi do Allegro (0.492.0)", async () => {
    /* Decyzja właściciela: nieodebrana paczka idzie drogą zwrotu. Formularz
       z 0.451.0 nie wraca — przycisk nie pyta o nic, bierze zamówienie. */
    const onPrzyjmij = vi.fn();
    pokaz(null, { paczki: PACZKI, onPrzyjmij });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    const przyciski = screen.getAllByRole("button", { name: "Przyjmij jako nieodebraną" });
    /* Tylko przy paczce bez zwrotu: drugi zwrot to druga kwota za ten sam towar. */
    expect(przyciski).toHaveLength(1);
    await userEvent.click(przyciski[0]);
    expect(onPrzyjmij).toHaveBeenCalledWith("ord-nowy");
    expect(screen.getByRole("link", { name: /ord-nowy/ })).toBeInTheDocument();
  });

  it("w trakcie przyjęcia przyciski stoją, a odmowa mówi całym zdaniem (0.492.0)", async () => {
    pokaz(null, { paczki: PACZKI, onPrzyjmij: vi.fn(), przyjmuje: "ord-nowy",
      bladPrzyjecia: "To zamówienie ma już zwrot REF-1 — pracuj na nim." });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    expect(screen.getByRole("button", { name: "Przyjmuję…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("ma już zwrot REF-1");
  });

  it("szukanie klienta otwiera się z rzędu pola, bez nieudanego skanu", async () => {
    /* Zgłoszenie właściciela (0.338.0): droga szła przez ślepy zaułek —
       najpierw zeskanuj, dostań „nie znam kodu", dopiero wtedy zobacz ją. */
    const p = pokaz(null);
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    const pole = screen.getByLabelText("Login, nazwisko albo telefon");
    expect(pole).toHaveFocus();
    /* Pytamy po dopisaniu uchwytu, nie po każdym znaku: zapytanie na znak
       byłoby dwunastoma odczytami na jedno nazwisko — i dwunastoma wpisami
       w dzienniku odczytów cudzych danych. */
    await userEvent.type(pole, "Kowalski");
    expect(p.onLogin).not.toHaveBeenCalled();
    await userEvent.type(pole, "{Enter}");
    expect(p.onLogin).toHaveBeenCalledWith("Kowalski");
  });

  it("wiersz PROWADZI do zamówienia w Allegro — tam kończy się ta praca", async () => {
    /* Biuro szukało paczki w Allegro i tam jej szuka dalej. Lista oszczędza
       tylko przepisywanie: wiersz jest odnośnikiem do strony zamówienia. */
    pokaz(null, { paczki: PACZKI });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    const link = screen.getByRole("link", { name: /ord-nowy/ });
    expect(link).toHaveAttribute("href", "https://allegro.pl/moje-allegro/sprzedaz/zamowienia/ord-nowy");
    expect(link).toHaveAttribute("target", "_blank");
    /* Bez adresu nie ma linku donikąd — wiersz zostaje opisem. */
    expect(screen.queryByRole("link", { name: /ord-stary/ })).toBeNull();
    expect(screen.getByText("ord-stary")).toBeInTheDocument();
  });

  it("wiersz paczki niesie ULICĘ — bez niej dwaj Kowalscy są nierozróżnialni", async () => {
    /* Szukanie po fragmencie nazwiska świadomie pokazuje cudze zakupy przy
       zbieżności nazwisk (0.367.0). Ulica rozstrzyga w jednym spojrzeniu. */
    pokaz(null, { paczki: PACZKI });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    expect(screen.getByText(/Polna 7/)).toBeInTheDocument();
    expect(screen.getByText(/Leśna 2/)).toBeInTheDocument();
  });

  it("paczka BEZ telefonu nie pokazuje samego separatora", async () => {
    /* `phoneNumber` nie stoi w `required` schematu `CheckoutFormDeliveryAddress`,
       więc brak numeru to normalny stan, nie usterka synchronizacji. */
    pokaz(null, { paczki: PACZKI });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    expect(screen.getByText(/Leśna 2/).textContent).toBe("Leśna 2 · 61-002 Poznań");
    expect(screen.getByText(/Polna 7/).textContent)
      .toBe("Polna 7 · 61-001 Poznań · ++48 663 509 353");
  });

  it("paczka ze zwrotem jest OZNACZONA", async () => {
    /* Jedno zamówienie bywa dwiema paczkami, a klient potrafi nie odebrać
       drugiej po zwrocie pierwszej. Ostrzeżenie, którego operator sam by nie miał. */
    pokaz(null, { paczki: PACZKI });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    expect(screen.getByText("ma już zwrot")).toBeInTheDocument();
  });

  it("klient bez historii dostaje ZDANIE, nie pustkę", async () => {
    /* Pusta lista wygląda jak zepsute szukanie. Zdanie mówi, po czym
       szuka Allegro — przy nazwisku to wyjaśnia pustkę od razu. */
    pokaz(null, { paczki: [] });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    expect(screen.getByText(/Nie mam paczek tego klienta/)).toBeInTheDocument();
    expect(screen.getByText(/pełnym loginie/)).toBeInTheDocument();
  });

  it("pytanie do Allegro WSTRZYMUJE zdanie „nie mam paczek” (0.450.0)", async () => {
    /* Nasza baza nie zna zamówienia paczki nieodebranej, więc jej lista
       przychodzi pusta pierwsza, a Allegro odpowiada chwilę później. Zdanie
       „nie mam" w tej chwili byłoby kłamstwem, które operator zdąży przeczytać. */
    pokaz(null, { paczki: [], pytaAllegro: true });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    expect(screen.getByText(/pytam też Allegro/)).toBeInTheDocument();
    expect(screen.queryByText(/Nie mam paczek tego klienta/)).not.toBeInTheDocument();
  });

  it("odmowa Allegro mówi swoje, a lista z naszej bazy stoi dalej", async () => {
    pokaz(null, { paczki: PACZKI, bladAllegro: "Allegro prosi o przerwę." });
    await userEvent.click(screen.getByRole("button", { name: /Paczki klienta/ }));
    expect(screen.getByText(/Allegro nie odpowiedziało: Allegro prosi o przerwę/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ord-nowy/ })).toBeInTheDocument();
  });

  it("bez podpiętej obsługi ekran nie proponuje szukania klienta", () => {
    /* Przycisk bez działania obiecywałby drogę, której nie ma. */
    pokaz({ trafienie: null, zwrotId: null, zwroty: [] }, { onLogin: undefined });
    expect(screen.queryByRole("button", { name: /kliencie|Paczki klienta/ })).toBeNull();
  });

  it("odmowa serwera ląduje przy polu, a nie w konsoli", () => {
    pokaz(null, { blad: "Konto Allegro nie jest sparowane" });
    expect(screen.getByText(/nie jest sparowane/)).toBeInTheDocument();
  });
});
