import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OsRozmowy } from "../api/typy";

vi.mock("./TowarRozmowy", () => ({
  TowarRozmowy: () => <div data-testid="towar">blok towaru</div>,
}));
vi.mock("./OfertaRozmowy", () => ({
  OfertaRozmowy: () => <div data-testid="oferta">blok oferty</div>,
}));
vi.mock("./ZamowienieRozmowy", () => ({
  ZamowienieRozmowy: ({ bezPaczki }: { bezPaczki?: boolean }) =>
    <div data-testid="zamowienie" data-bez-paczki={String(Boolean(bezPaczki))}>blok zamówienia</div>,
  /* Słownik paczki jedzie z modułu zamówienia, bo streszczenie wiersza mówi
     tymi samymi słowami co karta. */
  STATUS: { NOTICE_LEFT: "awizo — nieudana próba doręczenia", IN_TRANSIT: "w drodze do klienta" },
}));
vi.mock("./ZwrotRozmowy", () => ({
  ZwrotRozmowy: ({ zwrot }: { zwrot: { id: number } }) => <div data-testid="zwrot">zwrot {zwrot.id}</div>,
}));
/* Blok zakupów klienta woła hak zapytania (0.397.0), a ten plik nie stawia
   klienta TanStacka — pilnuje UKŁADU kolumny, nie wiązania zamówień. Własne
   testy blok ma w `ZamowieniaKlienta.test.tsx`. */
vi.mock("./ZamowieniaKlienta", () => ({
  ZamowieniaKlienta: ({ kandydaci }: { kandydaci: unknown[] }) =>
    <div data-testid="zakupy-klienta">zakupy {kandydaci.length}</div>,
}));
vi.mock("./Dobor", () => ({
  Dobor: () => <div data-testid="dobor">blok doboru</div>,
}));
/* Pasmo odpowiedzi (0.404.0) woła kartotekę z Subiekta, a ten plik nie stawia
   klienta TanStacka — pilnuje UKŁADU kolumny. Własne testy pasmo ma
   w `PasmoOdpowiedzi.test.tsx`; tutaj sprawdzamy tylko, że stoi NAD zakładkami. */
vi.mock("./PasmoOdpowiedzi", () => ({
  PasmoOdpowiedzi: () => <div data-testid="pasmo">pasmo odpowiedzi</div>,
}));

/* Liczniki zakładek (23 września 2026) czytają historię klienta i wiedzę.
   Ten plik pilnuje UKŁADU, więc hak oddaje stałe dane. */
const historia = { data: undefined as unknown };
const wiedza = { data: undefined as unknown };
/* Soczewka paczki (0.531.0) woła hak sprawdzenia; tu tylko liczymy, że
   samo rysowanie kolumny go nie odpala. */
const sprawdz = { mutate: vi.fn(), isPending: false, error: null };
vi.mock("../api/rozmowy", () => ({
  useHistoriaKlienta: () => historia,
  useWiedzaDoboru: () => wiedza,
  useSprawdzPrzesylkeRozmowy: () => sprawdz,
}));
/* Wiersze Klient i Wiedza stają tylko z treścią (0.531.0). */
const zHistoria = { login: "pasikonik5", maszyny: [], wpisy: [{ rodzaj: "zakup" }, { rodzaj: "zwrot" }] };
const zWiedza = { zastosowanie: null, pomiary: [{ zadanieId: 1 }], silniki: [] };

const { Kontekst } = await import("./Kontekst");

const dane = (n: Partial<OsRozmowy> = {}): OsRozmowy => ({
  rozmowa: {
    id: 4821, klient: "Kupujący 44300444", ostatniaWiadomosc: "", ostatniaWiadomoscAt: "",
    ostatniaOdKlienta: true, nieprzeczytana: false, wlascicielId: null, wlasciciel: null,
    wersja: 1, status: "open", odlozoneDo: null, poTerminie: false, podziekowal: false, oglada: null,
    priorytet: "normalny", czekaOdMs: null, reklamacyjna: false, nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "not_started",
    kopilot: null,
  },
  os: [], szkic: null, ofertaWskazana: null, zamowienie: null, zwroty: [],
  sprawy: [], droga: [], szkicCopilota: null, kandydaciZamowien: [],
  dobor: { status: "not_started", wersja: 1, brakuje: null, wybrany: null, updatedBy: null, updatedAt: null,
    dane: { marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null,
      oem: null, nazwaCzesci: null, parametry: {} } },
  oferta: { externalId: "12096815384", link: null, zrodlo: "wiadomosc", zgodnosc: null, pobrana: null,
    kartoteka: { pewnosc: "brak", twId: null, symbol: null, zrodlo: "—", powod: null } },
  ...n,
});

describe("kolumna kontekstu", () => {
  /* ── Umowa 0.198.0 ─────────────────────────────────────────────────────────
     Oferta i kartoteka stoją RAZEM, bez klikania. Zrzut z pracy pokazał
     zakładkę „Oferta" na jedenaście linijek w kolumnie na osiemset pikseli,
     a zdjęcie, stan i parametry towaru leżały schowane obok. Klient pytał
     wtedy o wymiar gwintu; parametr stał w niewidocznej zakładce.

     Test sprawdza WIDOCZNOŚĆ NARAZ, nie liczbę zakładek: gdyby ktoś rozbił
     to z powrotem na dwie karty, oba `getByTestId` nie mogłyby przejść. */
  it("oferta i towar widać naraz, bez klikania w zakładkę", () => {
    render(<Kontekst dane={dane()} onWstawDoSzkicu={() => {}} onZlecPomiar={() => {}} onOtworzRozmowe={() => {}} />);
    expect(screen.getByTestId("oferta")).toBeInTheDocument();
    expect(screen.getByTestId("towar")).toBeInTheDocument();
  });

  const pusteZamowienie = { externalId: "zam-77", link: null, pobrane: null, przesylka: null };
  const rysuj = (d: OsRozmowy) => render(<Kontekst dane={d} onWstawDoSzkicu={() => {}}
    onZlecPomiar={() => {}} onOtworzRozmowe={() => {}} />);
  const wiersz = (nazwa: RegExp) => screen.getByRole("button", { name: nazwa });

  /* ── Ciemny kokpit (0.498.0) ──────────────────────────────────────────────
     W normie temat to jedna linia ze streszczeniem, a treść czeka pod
     kliknięciem. Świeci tylko to, co ma zegar albo czeka na ruch agenta. */
  it("zamówienie w normie to jedna linia; treść po kliknięciu", async () => {
    rysuj(dane({ zamowienie: pusteZamowienie }));
    expect(wiersz(/^Zamówienie/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("zamowienie")).not.toBeInTheDocument();
    await userEvent.click(wiersz(/^Zamówienie/));
    expect(screen.getByTestId("zamowienie")).toBeInTheDocument();
    /* Nic nie świeci, więc nie ma nagłówka „Wymaga Ciebie". */
    expect(screen.queryByRole("region", { name: "Wymaga Ciebie" })).toBeNull();
  });

  it("zwrot w toku świeci nad resztą, zamknięty czeka w swoim wierszu, a oferta się zwija", async () => {
    rysuj(dane({
      zamowienie: pusteZamowienie,
      zwroty: [{ id: 5, kubelek: "decyzja" } as never, { id: 9, kubelek: "zamkniety" } as never],
    }));
    const swieci = screen.getByRole("region", { name: "Wymaga Ciebie" });
    expect(within(swieci).getAllByTestId("zwrot").map((e) => e.textContent)).toEqual(["zwrot 5"]);
    expect(within(swieci).getByText(/Wymaga Ciebie · 1/)).toBeInTheDocument();
    expect(screen.queryByText("zwrot 9")).toBeNull();
    /* Nagłówek „W normie” zszedł (0.513.0): rama oddziela świecące,
       a wiersze mówią o sobie streszczeniem. */
    expect(screen.queryByText("W normie")).toBeNull();
    /* Decyzja z terminem jest tematem — karta towaru schodzi pod kliknięcie. */
    expect(screen.queryByTestId("oferta")).toBeNull();
    await userEvent.click(wiersz(/^Zamknięte sprawy/));
    expect(screen.getByText("zwrot 9")).toBeInTheDocument();
  });

  it("paczka z awizo świeci, a zamówienie nie stoi drugi raz w swoim wierszu", async () => {
    rysuj(dane({ zamowienie: { ...pusteZamowienie, przesylka: {
      waybill: null, przewoznik: "DPD", status: "NOTICE_LEFT", dostarczonoAt: null, sprawdzonoAt: null } } }));
    const swieci = screen.getByRole("region", { name: "Wymaga Ciebie" });
    expect(within(swieci).getByTestId("zamowienie")).toBeInTheDocument();
    await userEvent.click(wiersz(/^Zamówienie/));
    expect(screen.getAllByTestId("zamowienie")).toHaveLength(1);
  });

  it("bez oferty kolumna mówi, czego brakuje, zamiast milczeć", () => {
    rysuj(dane({ oferta: null }));
    expect(screen.getByText(/nie jest powiązana z ofertą/)).toBeInTheDocument();
    /* Drugie zdanie mówi osobno o kartotece, bo to osobny brak: numer oferty
       bywa, a przypisania do Subiekta nie ma. */
    expect(screen.getByText(/nie ma z czego wywieść kartoteki/)).toBeInTheDocument();
    expect(screen.queryByTestId("towar")).not.toBeInTheDocument();
  });

  it("zamówienie z kilku pozycji bez oferty świeci i każe wskazać pozycję", () => {
    const pozycja = { offerId: "1", nazwa: "A", sku: null, ilosc: 1, cenaGrosze: 100, waluta: "PLN",
      zwracana: false, wracaIlosc: 0, twId: null, twSymbol: null, twZrodlo: null, ofertaZdjecie: "nieznane" as const };
    rysuj(dane({ oferta: null, zamowienie: { externalId: "zam-77", link: null, przesylka: null, pobrane: {
      externalId: "zam-77", status: null, kupujacyLogin: null, dostawaGrosze: null, dostawaMetoda: null,
      platnoscTyp: null, platnoscAt: null, fakturaZadana: null, sumaGrosze: 200, waluta: "PLN", kupionoAt: null,
      link: null, pozycje: [pozycja, { ...pozycja, offerId: "2", nazwa: "B" }],
    } } }));
    const swieci = screen.getByRole("region", { name: "Wymaga Ciebie" });
    expect(within(swieci).getByText(/Zamówienie ma 2 pozycje — wskaż tę/)).toBeInTheDocument();
    expect(within(swieci).getByTestId("zamowienie")).toBeInTheDocument();
    expect(screen.getByText(/Wskaż pozycję zamówienia wyżej/)).toBeInTheDocument();
    expect(screen.queryByText(/nie jest powiązana z ofertą/)).toBeNull();
  });

  /* Zakładek nie ma od 0.498.0. „Oferta" i „Towar" zostają JEDNYM tematem
     (0.198.0), a dobór, klient i wiedza mają własne wiersze. */
  it("każdy temat ma wiersz, a dobór działa nawet bez oferty", async () => {
    historia.data = zHistoria; wiedza.data = zWiedza;
    rysuj(dane({ oferta: null }));
    for (const nazwa of ["Oferta", "Towar"]) {
      expect(screen.queryByRole("button", { name: nazwa })).not.toBeInTheDocument();
    }
    for (const nazwa of [/^Oferta i towar/, /^Zamówienie/, /^Dobór/, /^Klient/, /^Wiedza/]) {
      expect(wiersz(nazwa)).toBeInTheDocument();
    }
    /* Bez oferty dobór ISTNIEJE: klient bywa bez numeru oferty, a maszynę
       i część wpisuje agent. */
    await userEvent.click(wiersz(/^Dobór/));
    expect(screen.getByTestId("dobor")).toBeInTheDocument();
    historia.data = undefined; wiedza.data = undefined;
  });

  /* „Dobór" to robota z krokami i przyciskami, nie karta faktów. Doklejony
     pod kartotekę zepchnąłby stan magazynowy z ekranu. */
  it("dobór nie stoi rozwinięty pod towarem", () => {
    rysuj(dane());
    expect(screen.queryByTestId("dobor")).not.toBeInTheDocument();
  });

  /* Zakładka z zerem kosztowała klik, żeby usłyszeć „tu nic nie ma".
     Od 0.531.0 (decyzja właściciela z 26 września) pusty wiersz nie staje
     wcale — ani przed odczytem, ani po pustym wyniku. Z treścią mówi
     streszczeniem, jak dotąd. */
  it("Klient i Wiedza stają tylko z treścią i mówią streszczeniem", () => {
    const { rerender } = rysuj(dane());
    expect(screen.queryByRole("button", { name: /^Klient/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Wiedza/ })).toBeNull();
    historia.data = zHistoria; wiedza.data = zWiedza;
    rerender(<Kontekst dane={dane()} onWstawDoSzkicu={() => {}}
      onZlecPomiar={() => {}} onOtworzRozmowe={() => {}} />);
    expect(wiersz(/^Klient/)).toHaveTextContent("1 zakup · 1 zwrot");
    expect(wiersz(/^Klient/)).toHaveAttribute("aria-expanded", "false");
    expect(wiersz(/^Wiedza/)).toHaveTextContent("1 dowód");
    expect(screen.queryByText(/Nowy klient/)).toBeNull();
    historia.data = undefined; wiedza.data = undefined;
  });

  it("pusta historia przy znanym loginie to jedna linijka „Nowy klient”, bez wiersza", () => {
    historia.data = { login: "pasikonik5", maszyny: [], wpisy: [] };
    wiedza.data = { zastosowanie: null, pomiary: [], silniki: [] };
    const { rerender } = rysuj(dane());
    expect(screen.getByText(/Nowy klient — pierwszy kontakt u nas/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Klient/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Wiedza/ })).toBeNull();
    /* Bez loginu nie wiemy, kto pisze — „nowy" byłoby zgadywaniem. */
    historia.data = { login: null, maszyny: [], wpisy: [] };
    rerender(<Kontekst dane={dane()} onWstawDoSzkicu={() => {}}
      onZlecPomiar={() => {}} onOtworzRozmowe={() => {}} />);
    expect(screen.queryByText(/Nowy klient/)).toBeNull();
    historia.data = undefined; wiedza.data = undefined;
  });

  /* ── Soczewka nad kolumną (0.499.0) ──────────────────────────────────────
     Odpowiedź na pytanie klienta stoi PRZED tym, co ma termin — i niczego
     nie chowa: „Wymaga Ciebie" i każdy wiersz stoją pod nią jak bez niej. */
  it("soczewka stoi nad „Wymaga Ciebie” i niczego nie chowa", () => {
    rysuj(dane({
      rozmowa: { ...dane().rozmowa, kopilot: { kategoria: "CANCEL_ORDER", dodatkowe: [], zrodlo: "MODEL",
        status: "SUCCESS", nieaktualna: false, kategoriaCzlowieka: null } as never },
      zamowienie: pusteZamowienie,
      zwroty: [{ id: 5, kubelek: "decyzja" } as never],
    }));
    const soczewka = screen.getByRole("region", { name: "Pytanie klienta" });
    const swieci = screen.getByRole("region", { name: "Wymaga Ciebie" });
    expect(soczewka.compareDocumentPosition(swieci) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* Klient i Wiedza bez treści nie stają wcale (0.531.0) — z soczewką czy bez. */
    for (const nazwa of [/^Oferta i towar/, /^Zamówienie/, /^Dobór/]) {
      expect(wiersz(nazwa)).toBeInTheDocument();
    }
  });

  /* ── Soczewka paczki (0.531.0) ──────────────────────────────────────────
     Paczka stoi RAZ: w soczewce. Awizo nie zapala drugiej karty w „Wymaga
     Ciebie", streszczenie wiersza jej nie powtarza, a karta zamówienia pod
     wierszem dostaje `bezPaczki`. Samo rysowanie niczego nie sprawdza. */
  it("paczka stoi raz — w soczewce; wiersz zamówienia jej nie powtarza", async () => {
    sprawdz.mutate.mockClear();
    rysuj(dane({
      rozmowa: { ...dane().rozmowa, kopilot: { kategoria: "DELIVERY_DELAY", dodatkowe: [], zrodlo: "MODEL",
        status: "SUCCESS", nieaktualna: false, kategoriaCzlowieka: null } as never },
      zamowienie: { ...pusteZamowienie, przesylka: { waybill: "6800123", przewoznik: "DPD",
        status: "NOTICE_LEFT", dostarczonoAt: null, sprawdzonoAt: null } },
    }));
    const soczewka = screen.getByRole("region", { name: "Pytanie klienta" });
    expect(within(soczewka).getByText(/Nie pytaliśmy jeszcze Allegro/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Wymaga Ciebie" })).toBeNull();
    expect(wiersz(/^Zamówienie/)).not.toHaveTextContent(/awizo/);
    await userEvent.click(wiersz(/^Zamówienie/));
    expect(screen.getByTestId("zamowienie")).toHaveAttribute("data-bez-paczki", "true");
    expect(sprawdz.mutate).not.toHaveBeenCalled();
  });

  /* ── Bramka doboru (0.498.0, E z kanwy) ───────────────────────────────────
     Nagranie: klient zwracał kupiony nóż 14-25001, a dobór szukał po wymiarach
     i pokazał świecę, sprężynę i przewody paliwa — bez kupionego towaru. */
  const znany = (n: Partial<OsRozmowy["dobor"]> = {}) => dane({
    zamowienie: pusteZamowienie,
    oferta: { ...dane().oferta!, zrodlo: "zamowienie" },
    dobor: { ...dane().dobor, status: "searching", updatedBy: "automat (szkic)", ...n },
  });

  it("towar znany z zamówienia chowa dobór automatu za bramką", async () => {
    rysuj(znany());
    expect(screen.queryByRole("region", { name: "Wymaga Ciebie" })).toBeNull();
    /* Od 0.506.0 wiersza „Dobór: zbędny" nie ma — bramka stoi w „Oferta
       i towar", otwartym, bo rozmowa nie ma rozpoznania. */
    expect(screen.queryByRole("button", { name: /^Dobór/ })).toBeNull();
    expect(screen.getByText(/Towar znany z zamówienia\./)).toBeInTheDocument();
    expect(screen.queryByTestId("dobor")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Szukaj innego towaru mimo to" }));
    expect(screen.getByTestId("dobor")).toBeInTheDocument();
  });

  it("bramka ustępuje, gdy szukać zaczął człowiek, a nie automat", () => {
    rysuj(znany({ updatedBy: "A. Lewandowska" }));
    const swieci = screen.getByRole("region", { name: "Wymaga Ciebie" });
    expect(within(swieci).getByRole("button", { name: /^Dobór/ })).toHaveTextContent("Szukamy");
  });
});

/* ── Rozstrzygające słowo na początku (0.500.0) ─────────────────────────────
   Oko czyta początek wiersza i pomija resztę (NN/g, wzorzec F, 2006 i 2017).
   O zamówieniu pyta się „gdzie paczka", więc paczka stoi pierwsza. */
describe("streszczenie zamówienia", () => {
  it("zaczyna od paczki, dopiero potem data i kwota", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    const s = streszczenieZamowienia(dane({ zamowienie: { externalId: "z", link: null,
      przesylka: { waybill: null, przewoznik: "DPD", status: "IN_TRANSIT", dostarczonoAt: null, sprawdzonoAt: null },
      pobrane: { kupionoAt: "2026-09-22T10:00:00Z", sumaGrosze: 5549, waluta: "PLN" } as never } }));
    expect(s.startsWith("w drodze do klienta")).toBe(true);
    expect(s).toMatch(/55,49/);
    /* Data zakupu z nazwą (0.506.0): obok „doręczona" goła data czytała się
       jak druga data dostawy. */
    expect(s).toMatch(/kupione 22 września 2026/);
  });

  it("przy soczewce paczki zaczyna od daty zakupu — paczka stoi wyżej", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    const s = streszczenieZamowienia(dane({
      rozmowa: { ...dane().rozmowa, kopilot: { kategoria: "ORDER_STATUS", dodatkowe: [], zrodlo: "MODEL",
        status: "SUCCESS", nieaktualna: false, kategoriaCzlowieka: null } as never },
      zamowienie: { externalId: "z", link: null,
        przesylka: { waybill: null, przewoznik: "DPD", status: "IN_TRANSIT", dostarczonoAt: null, sprawdzonoAt: null },
        pobrane: { kupionoAt: "2026-09-22T10:00:00Z", sumaGrosze: 5549, waluta: "PLN" } as never } }));
    expect(s.startsWith("kupione 22 września 2026")).toBe(true);
    expect(s).not.toMatch(/w drodze/);
  });
});
