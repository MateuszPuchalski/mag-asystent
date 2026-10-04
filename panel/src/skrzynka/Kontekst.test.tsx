import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { HistoriaKlienta, OsRozmowy } from "../api/typy";

vi.mock("./TowarRozmowy", () => ({
  TowarRozmowy: () => <div data-testid="towar">blok towaru</div>,
}));
vi.mock("./OfertaRozmowy", () => ({
  OfertaRozmowy: () => <div data-testid="oferta">blok oferty</div>,
}));
/* Lista pozycji ma własne testy w `ZamowienieRozmowy.test.tsx`; tu liczy się
   tylko, GDZIE stoi. Paczka biegnie prawdziwa, bo jej jedno miejsce
   w kolumnie to treść tego pliku. */
vi.mock("./ZamowienieRozmowy", () => ({
  ZamowienieRozmowy: () => <div data-testid="zamowienie" />,
}));
vi.mock("./ZwrotRozmowy", () => ({
  ZwrotRozmowy: ({ zwrot }: { zwrot: { id: number } }) => <div data-testid="zwrot">zwrot {zwrot.id}</div>,
}));
/* Blok zakupów klienta woła hak zapytania, a ten plik nie stawia klienta
   TanStacka — pilnuje UKŁADU kolumny, nie wiązania zamówień. Własne testy
   blok ma w `ZamowieniaKlienta.test.tsx`. */
vi.mock("./ZamowieniaKlienta", () => ({
  ZamowieniaKlienta: ({ kandydaci }: { kandydaci: unknown[] }) =>
    <div data-testid="zakupy-klienta">zakupy {kandydaci.length}</div>,
}));
vi.mock("./Dobor", () => ({
  Dobor: () => <div data-testid="dobor">blok doboru</div>,
}));
/* Pasmo odpowiedzi woła kartotekę z Subiekta, a ten plik nie stawia klienta
   TanStacka. Własne testy pasmo ma w `PasmoOdpowiedzi.test.tsx`. */
vi.mock("./PasmoOdpowiedzi", () => ({
  PasmoOdpowiedzi: () => <div data-testid="pasmo">pasmo odpowiedzi</div>,
}));

/* Wiersze „Klient" i „Wiedza" czytają historię klienta i wiedzę. Ten plik
   pilnuje UKŁADU, więc hak oddaje stałe dane. */
const historia = { data: undefined as unknown };
const wiedza = { data: undefined as unknown };
/* Blok paczki woła hak sprawdzenia; tu tylko liczymy, że samo rysowanie
   kolumny go nie odpala. */
const sprawdz = { mutate: vi.fn(), isPending: false, error: null };
vi.mock("../api/rozmowy", () => ({
  useHistoriaKlienta: () => historia,
  useWiedzaDoboru: () => wiedza,
  useSprawdzPrzesylkeRozmowy: () => sprawdz,
}));
/* Wiersze Klient i Wiedza stają tylko z treścią. */
const zHistoria = { login: "pasikonik5", maszyny: [], wpisy: [{ rodzaj: "zakup" }, { rodzaj: "zwrot" }] };
const zWiedza = { zastosowanie: null, pomiary: [{ zadanieId: 1 }], silniki: [] };

afterEach(() => { historia.data = undefined; wiedza.data = undefined; });

const { Kontekst } = await import("./Kontekst");

const dane = (n: Partial<OsRozmowy> = {}): OsRozmowy => ({
  rozmowa: {
    id: 4821, klient: "Kupujący 44300444", ostatniaWiadomosc: "", ostatniaWiadomoscAt: "",
    ostatniaOdKlienta: true, nieprzeczytana: false, wlascicielId: null, wlasciciel: null,
    wersja: 1, status: "open", odlozoneDo: null, poTerminie: false, podziekowal: false, oglada: null,
    priorytet: "normalny", czekaOdMs: null, reklamacyjna: false, nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "pusty",
    kopilot: null,
  },
  os: [], szkic: null, ofertaWskazana: null, zamowienie: null, zwroty: [],
  sprawy: [], droga: [], szkicCopilota: null, kandydaciZamowien: [],
  dobor: { stan: "pusty", wynik: null, wersja: 1, wybrany: null, dopytac: null, zmienil: null,
    zmienilAutomat: false, zmienionoAt: null,
    dane: { marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null,
      oem: null, nazwaCzesci: null } },
  oferta: { externalId: "12096815384", link: null, zrodlo: "wiadomosc", zgodnosc: null, pobrana: null,
    kartoteka: { pewnosc: "brak", twId: null, symbol: null, zrodlo: "—", powod: null } },
  ...n,
});

const kopilot = (kategoria: string) => ({ kategoria, dodatkowe: [], zrodlo: "MODEL",
  status: "SUCCESS", nieaktualna: false, kategoriaCzlowieka: null }) as never;

const pozycja = (n: Record<string, unknown> = {}) => ({ offerId: "1", nazwa: "A", sku: null, ilosc: 1,
  cenaGrosze: 100, waluta: "PLN", zwracana: false, wracaIlosc: 0, twId: null, twSymbol: null, twZrodlo: null,
  ofertaZdjecie: "nieznane" as const, ...n });
const pobrane = (n: Record<string, unknown> = {}) => ({
  externalId: "zam-77", status: null, kupujacyLogin: null, dostawaGrosze: null, dostawaMetoda: null,
  platnoscTyp: null, platnoscAt: null, fakturaZadana: null, sumaGrosze: 200, waluta: "PLN", kupionoAt: null,
  link: null, pozycje: [], ...n,
}) as never;

const pusteZamowienie = { externalId: "zam-77", link: null, pobrane: null, przesylka: null };
const uklad = (d: OsRozmowy) => <MemoryRouter><Kontekst dane={d} onWstawDoSzkicu={() => {}}
  onZlecPomiar={() => {}} onOtworzRozmowe={() => {}} /></MemoryRouter>;
const rysuj = (d: OsRozmowy) => render(uklad(d));
const wiersz = (nazwa: RegExp) => screen.getByRole("button", { name: nazwa });
const swieci = () => screen.getByRole("region", { name: "Wymaga Ciebie" });

describe("kolumna kontekstu", () => {
  /* Oferta i kartoteka stoją RAZEM, bez klikania. Zrzut z pracy pokazał
     zakładkę „Oferta" na jedenaście linijek w kolumnie na osiemset pikseli,
     a zdjęcie, stan i parametry towaru leżały schowane obok. Klient pytał
     wtedy o wymiar gwintu; parametr stał w niewidocznej zakładce.

     Test sprawdza WIDOCZNOŚĆ NARAZ, nie liczbę zakładek: gdyby ktoś rozbił
     to z powrotem na dwie karty, oba `getByTestId` nie mogłyby przejść. */
  it("oferta i towar widać naraz, bez klikania w zakładkę", () => {
    rysuj(dane());
    expect(screen.getByTestId("oferta")).toBeInTheDocument();
    expect(screen.getByTestId("towar")).toBeInTheDocument();
  });

  /* ── Ciemny kokpit ────────────────────────────────────────────────────────
     W normie temat to jedna linia ze streszczeniem, a treść czeka pod
     kliknięciem. Świeci tylko to, co ma zegar albo czeka na ruch agenta. */
  it("zamówienie w normie to jedna linia; paczka po kliknięciu", async () => {
    rysuj(dane({ zamowienie: pusteZamowienie }));
    expect(wiersz(/^Zamówienie/)).toHaveAttribute("aria-expanded", "false");
    expect(wiersz(/^Zamówienie/)).toHaveTextContent("paczki nie sprawdzano · treść jeszcze nie pobrana");
    expect(screen.queryByLabelText("Paczka zamówienia")).toBeNull();
    await userEvent.click(wiersz(/^Zamówienie/));
    expect(screen.getByLabelText("Paczka zamówienia")).toHaveTextContent(/Zamówienia jeszcze nie pobraliśmy/);
    /* Nic nie świeci, więc nie ma ramy „Wymaga Ciebie". */
    expect(screen.queryByRole("region", { name: "Wymaga Ciebie" })).toBeNull();
  });

  it("zwrot w toku świeci nad resztą, zamknięty czeka w swoim wierszu, a oferta się zwija", async () => {
    rysuj(dane({
      zamowienie: pusteZamowienie,
      zwroty: [{ id: 5, kubelek: "decyzja" } as never, { id: 9, kubelek: "zamkniety" } as never],
    }));
    expect(within(swieci()).getAllByTestId("zwrot")).toHaveLength(1);
    expect(within(swieci()).getAllByTestId("zwrot").map((e) => e.textContent)).toEqual(["zwrot 5"]);
    expect(within(swieci()).getByText(/Wymaga Ciebie · 1/)).toBeInTheDocument();
    expect(screen.queryByText("zwrot 9")).toBeNull();
    /* Nagłówka „W normie” nie ma: rama oddziela świecące, a wiersze mówią
       o sobie streszczeniem. */
    expect(screen.queryByText("W normie")).toBeNull();
    /* Decyzja z terminem jest tematem — karta towaru schodzi pod kliknięcie. */
    expect(screen.queryByTestId("oferta")).toBeNull();
    await userEvent.click(wiersz(/^Zamknięte sprawy/));
    expect(screen.getByText("zwrot 9")).toBeInTheDocument();
  });

  it("paczka z awizo świeci w ramie, a wiersz zamówienia mówi tylko „paczka wyżej”", () => {
    rysuj(dane({ zamowienie: { ...pusteZamowienie, pobrane: pobrane(), przesylka: {
      waybill: null, przewoznik: "DPD", status: "NOTICE_LEFT", dostarczonoAt: null, sprawdzonoAt: null } } }));
    expect(within(swieci()).getByLabelText("Paczka zamówienia")).toHaveTextContent(/Nie pytaliśmy jeszcze Allegro/);
    expect(within(swieci()).getByText(/Wymaga Ciebie · 1/)).toBeInTheDocument();
    /* Pod wierszem nie ma nic: paczka stoi wyżej, pozycji nie ma, innych
       zakupów też. Wiersz nie udaje więc przycisku. */
    const tytul = screen.getByText("Zamówienie");
    expect(tytul.parentElement).toHaveTextContent("Zamówieniepaczka wyżej");
    expect(tytul.parentElement!.tagName).not.toBe("BUTTON");
    expect(screen.queryByRole("button", { name: /^Zamówienie/ })).toBeNull();
    expect(screen.getAllByLabelText("Paczka zamówienia")).toHaveLength(1);
  });

  /* ── Brak oferty mówi się RAZ ─────────────────────────────────────────────
     Decyzja właściciela z 28 września 2026. Baner nad rozmową mówi o braku
     z czynnościami, więc kolumna nie powtarza go dwoma akapitami. Gwarancja
     „nie milczy" zostaje: wiersz stoi i mówi brak streszczeniem. */
  it("bez oferty kolumna mówi brak streszczeniem, bez powtórzenia banera", () => {
    rysuj(dane({ oferta: null }));
    const tytul = screen.getByText("Oferta i towar");
    expect(tytul.parentElement).toHaveTextContent("Oferta i towarbez oferty");
    expect(screen.queryByText(/nie jest powiązana z ofertą/)).toBeNull();
    expect(screen.queryByText(/nie ma z czego wywieść kartoteki/)).toBeNull();
    /* Pod wierszem nic nie leży, więc wiersz nie udaje przycisku: klik
       rozwijający pustkę byłby klikiem bez odpowiedzi. */
    expect(screen.queryByRole("button", { name: /^Oferta i towar/ })).toBeNull();
    expect(screen.queryByTestId("towar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("oferta")).not.toBeInTheDocument();
  });

  it("zamówienie bez oferty i nie z kilku pozycji: wiersz mówi, co zrobić, bo baner wtedy milczy", async () => {
    /* `brakPowiazania` gasi baner, gdy zamówienie jest znane. Bez tego zdania
       kolumna zostawiała samo „bez oferty”, bez drogi dalej. */
    rysuj(dane({ oferta: null, zamowienie: pusteZamowienie }));
    /* Wiersz bywa otwarty na starcie (pamięć rozwinięć), więc klikamy tylko zwinięty. */
    if (wiersz(/^Oferta i towar/).getAttribute("aria-expanded") === "false") {
      await userEvent.click(wiersz(/^Oferta i towar/));
    }
    expect(wiersz(/^Oferta i towar/)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Wskaż ofertę przy rozmowie, a towar pojawi się tutaj/)).toBeInTheDocument();
  });

  /* Prośba jest tytułem pozycji w ramie, a liczba pozycji stoi przy niej.
     Osobne „Zamówienie ma N pozycje" mówiło to samo drugi raz i nie
     odmieniało się przy pięciu. */
  it.each([[2, "2 pozycje"], [5, "5 pozycji"]])(
    "zamówienie z %i pozycji bez oferty świeci i każe wskazać pozycję („%s”)", (n, slowo) => {
      rysuj(dane({ oferta: null, zamowienie: { externalId: "zam-77", link: null, przesylka: null,
        pobrane: pobrane({ pozycje: Array.from({ length: n }, (_, i) =>
          pozycja({ offerId: String(i + 1), nazwa: `Pozycja ${i + 1}` })) }) } }));
      expect(within(swieci()).getByText("Wskaż pozycję, o którą pyta klient")).toBeInTheDocument();
      expect(within(swieci()).getByText(new RegExp(`· ${slowo}`))).toBeInTheDocument();
      expect(within(swieci()).getByTestId("zamowienie")).toBeInTheDocument();
      expect(screen.queryByText(/Zamówienie ma/)).toBeNull();
      /* Wiersz oferty mówi prośbę streszczeniem, nie drugim zdaniem o tym samym. */
      expect(screen.getByText("Oferta i towar").parentElement).toHaveTextContent("do wskazania w zamówieniu");
      expect(screen.queryByText(/Wskaż pozycję zamówienia wyżej/)).toBeNull();
      expect(screen.queryByText(/nie jest powiązana z ofertą/)).toBeNull();
    });

  /* „Oferta" i „Towar" zostają JEDNYM tematem, a dobór, klient i wiedza mają
     własne wiersze. */
  it("każdy temat ma wiersz, a dobór działa nawet bez oferty", async () => {
    historia.data = zHistoria; wiedza.data = zWiedza;
    const { unmount } = rysuj(dane({ oferta: null }));
    for (const nazwa of ["Oferta", "Towar"]) {
      expect(screen.queryByRole("button", { name: nazwa })).not.toBeInTheDocument();
    }
    /* Bez oferty wiersz „Oferta i towar" stoi samym streszczeniem, nie
       przyciskiem — ale STOI, bo temat ma wiersz zawsze. */
    expect(screen.getByText("Oferta i towar")).toBeInTheDocument();
    /* Bez zamówienia i bez zakupów klienta „Zamówienie" nie ma czego rozwinąć. */
    expect(screen.getByText("Zamówienie").parentElement).toHaveTextContent("Zamówienieniepowiązane");
    expect(screen.queryByRole("button", { name: /^Zamówienie/ })).toBeNull();
    for (const nazwa of [/^Dobór/, /^Klient/, /^Wiedza/]) {
      expect(wiersz(nazwa)).toBeInTheDocument();
    }
    /* Bez oferty dobór ISTNIEJE: klient bywa bez numeru oferty, a maszynę
       i część wpisuje agent. */
    await userEvent.click(wiersz(/^Dobór/));
    expect(screen.getByTestId("dobor")).toBeInTheDocument();
    unmount();
    /* Zakup klienta do wskazania to treść: wiersz staje się przyciskiem. */
    rysuj(dane({ oferta: null, kandydaciZamowien: [{ externalId: "k-1" } as never] }));
    expect(wiersz(/^Zamówienie/)).toHaveAttribute("aria-expanded", "false");
  });

  /* „Dobór" to robota z krokami i przyciskami, nie karta faktów. Doklejony
     pod kartotekę zepchnąłby stan magazynowy z ekranu. */
  it("dobór nie stoi rozwinięty pod towarem", () => {
    rysuj(dane());
    expect(screen.queryByTestId("dobor")).not.toBeInTheDocument();
  });

  /* Zakładka z zerem kosztowała klik, żeby usłyszeć „tu nic nie ma". Pusty
     wiersz nie staje wcale (decyzja właściciela z 26 września) — ani przed
     odczytem, ani po pustym wyniku. Z treścią mówi to, czego karta nie ma. */
  it("Klient i Wiedza stają tylko z treścią; Klient mówi maszynę i ostatni kontakt, nie liczniki", () => {
    const { rerender } = rysuj(dane());
    expect(screen.queryByRole("button", { name: /^Klient/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Wiedza/ })).toBeNull();
    historia.data = {
      login: "k",
      maszyny: [{ marka: "MTD", nazwa: "Smart 53 SPO", wariant: null, rocznik: "2019", silnik: null,
        rozmowaId: 4310, at: "2026-05-12T10:00:00Z" }],
      wpisy: [{ rodzaj: "zakup", at: "2026-05-12T10:00:00Z", tresc: "Nóż", zamowienieId: "inne",
        link: null, rozmowaId: null, sprawaId: null }],
    } satisfies HistoriaKlienta;
    wiedza.data = zWiedza;
    rerender(uklad(dane()));
    expect(wiersz(/^Klient/)).toHaveTextContent("MTD Smart 53 SPO (2019)");
    expect(wiersz(/^Klient/)).toHaveTextContent("ostatnio 12 maja 2026");
    /* Liczniki mówi karta zakupu jako „Wcześniej u nas". */
    expect(wiersz(/^Klient/)).not.toHaveTextContent(/1 zakup/);
    expect(wiersz(/^Klient/)).toHaveAttribute("aria-expanded", "false");
    expect(wiersz(/^Wiedza/)).toHaveTextContent("1 dowód");
  });

  /* „Nowy klient" i „Wcześniej u nas" mają jeden dom: kartę zakupu, także
     zwiniętą i w pasku nad osią. Linijka pod pasmem była drugim. */
  it("pusta historia nie stawia ani wiersza, ani linijki „Nowy klient” — mówi to karta zakupu", () => {
    historia.data = { login: "pasikonik5", maszyny: [], wpisy: [] };
    wiedza.data = { zastosowanie: null, pomiary: [], silniki: [] };
    const { rerender } = rysuj(dane());
    const kolumna = screen.getByRole("region", { name: "Kontekst" });
    expect(within(kolumna).queryByText(/Nowy klient|Wcześniej u nas/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Klient/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Wiedza/ })).toBeNull();
    historia.data = { login: null, maszyny: [], wpisy: [] };
    rerender(uklad(dane()));
    expect(within(kolumna).queryByText(/Nowy klient|Wcześniej u nas/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Klient/ })).toBeNull();
  });

  /* Serwer pomija w historii tylko bieżącą rozmowę, więc zakup tej rozmowy
     przychodzi jako wpis. Wiersz z samym nim mówiłby o tym, co mówi karta. */
  it("historia z samym tym zakupem nie stawia wiersza „Klient”; inny zakup go stawia", () => {
    const wpis = (zamowienieId: string, at: string) => ({ rodzaj: "zakup" as const, at, tresc: "Nóż",
      zamowienieId, link: null, rozmowaId: null, sprawaId: null });
    historia.data = { login: "k", maszyny: [], wpisy: [wpis("zam-77", "2026-09-28T10:00:00Z")] };
    const { rerender } = rysuj(dane({ zamowienie: pusteZamowienie }));
    expect(screen.queryByRole("button", { name: /^Klient/ })).toBeNull();
    historia.data = { login: "k", maszyny: [],
      wpisy: [wpis("zam-77", "2026-09-28T10:00:00Z"), wpis("inne", "2026-09-20T10:00:00Z")] };
    rerender(uklad(dane({ zamowienie: pusteZamowienie })));
    expect(wiersz(/^Klient/)).toHaveTextContent("ostatnio 20 września 2026");
  });

  /* Serwer bierze login sprawy z zamówienia, więc sprawa bywa znana przy
     wątku bez loginu. Rozmowa ma do niej odsyłać — w obie strony. */
  it("sprawa klienta stawia wiersz także bez loginu i mówi krok z terminem", () => {
    historia.data = { login: null, wpisy: [], maszyny: [], sprawa: { id: 1, login: "k", wersja: 1,
      stan: "w_toku", krok: "Oddzwonić", krokDo: "2026-10-02T08:00:00Z", dzis: false, poTerminie: true,
      prowadzi: null, prowadziId: null, zakonczonoAt: null, zakonczyl: null, nowe: [], odcisk: "o",
      dosylki: [] } } satisfies HistoriaKlienta;
    rysuj(dane());
    expect(wiersz(/^Klient/)).toHaveTextContent(/sprawa: Oddzwonić/);
    expect(screen.getByText(/po terminie/)).toHaveClass("text-ranga-zle");
  });

  /* ── Soczewka nad kolumną ────────────────────────────────────────────────
     Odpowiedź na pytanie klienta stoi PRZED tym, co ma termin — i niczego
     nie chowa: „Wymaga Ciebie" i każdy wiersz stoją pod nią jak bez niej. */
  it("soczewka stoi nad „Wymaga Ciebie” i niczego nie chowa", () => {
    rysuj(dane({
      rozmowa: { ...dane().rozmowa, kopilot: kopilot("CANCEL_ORDER") },
      zamowienie: pusteZamowienie,
      zwroty: [{ id: 5, kubelek: "decyzja" } as never],
    }));
    const soczewka = screen.getByRole("region", { name: "Pytanie klienta" });
    expect(soczewka.compareDocumentPosition(swieci()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* Klient i Wiedza bez treści nie stają wcale — z soczewką czy bez. */
    for (const nazwa of [/^Oferta i towar/, /^Zamówienie/, /^Dobór/]) {
      expect(wiersz(nazwa)).toBeInTheDocument();
    }
  });

  /* ── Soczewka paczki ─────────────────────────────────────────────────────
     Paczka stoi RAZ: w soczewce. Awizo nie zapala drugiej pozycji w „Wymaga
     Ciebie", a wiersz zamówienia nie ma jej ani w streszczeniu, ani pod sobą.
     Samo rysowanie niczego nie sprawdza. */
  it("paczka stoi raz — w soczewce; wiersz zamówienia jej nie powtarza", () => {
    sprawdz.mutate.mockClear();
    rysuj(dane({
      rozmowa: { ...dane().rozmowa, kopilot: kopilot("DELIVERY_DELAY") },
      zamowienie: { ...pusteZamowienie, przesylka: { waybill: "6800123", przewoznik: "DPD",
        status: "NOTICE_LEFT", dostarczonoAt: null, sprawdzonoAt: null } },
    }));
    const soczewka = screen.getByRole("region", { name: "Pytanie klienta" });
    expect(within(soczewka).getByText(/Nie pytaliśmy jeszcze Allegro/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Wymaga Ciebie" })).toBeNull();
    const tytul = screen.getByText("Zamówienie");
    expect(tytul.parentElement).toHaveTextContent("treść jeszcze nie pobrana");
    expect(tytul.parentElement).not.toHaveTextContent(/awizo/);
    expect(screen.getAllByLabelText("Paczka zamówienia")).toHaveLength(1);
    expect(sprawdz.mutate).not.toHaveBeenCalled();
  });

  /* ── Bramka doboru ───────────────────────────────────────────────────────
     Nagranie: klient zwracał kupiony nóż 14-25001, a dobór szukał po wymiarach
     i pokazał świecę, sprężynę i przewody paliwa — bez kupionego towaru. */
  const znany = (n: Partial<OsRozmowy["dobor"]> = {}) => dane({
    zamowienie: pusteZamowienie,
    oferta: { ...dane().oferta!, zrodlo: "zamowienie" },
    dobor: { ...dane().dobor, stan: "otwarty", zmienil: "automat (szkic)", zmienilAutomat: true, ...n },
  });

  it("towar znany z zamówienia chowa dobór za bramką, a „mimo to” otwiera go tuż pod nią", async () => {
    rysuj(znany());
    expect(screen.queryByRole("region", { name: "Wymaga Ciebie" })).toBeNull();
    /* Wiersza „Dobór: zbędny" nie ma — bramka stoi w „Oferta i towar". */
    expect(screen.queryByRole("button", { name: /^Dobór/ })).toBeNull();
    expect(screen.getByText(/Towar znany z zamówienia\./)).toBeInTheDocument();
    /* Nazwę i SKU kupionego towaru mówi karta zakupu. */
    expect(screen.queryByText(/Klient pisze o/)).toBeNull();
    expect(screen.queryByTestId("dobor")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Szukaj innego towaru mimo to" }));
    expect(wiersz(/^Dobór/)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("dobor")).toBeInTheDocument();
    /* Dobór otwarty ręką nie świeci: agent sam po niego sięgnął. */
    expect(screen.queryByRole("region", { name: "Wymaga Ciebie" })).toBeNull();
    /* Stoi zaraz pod towarem, czyli w miejscu klikniętego przycisku. */
    expect(wiersz(/^Oferta i towar/).parentElement!.nextElementSibling).toContainElement(wiersz(/^Dobór/));
  });

  it("bramka ustępuje, gdy dane zapisał człowiek, a nie automat", () => {
    rysuj(znany({ zmienil: "A. Lewandowska", zmienilAutomat: false }));
    expect(within(swieci()).getByRole("button", { name: /^Dobór/ })).toHaveTextContent("Otwarty");
  });

  it("bramka nie mówi już, że automat zaczął szukać", () => {
    rysuj(znany());
    expect(screen.queryByText(/Automat zaczął szukać/)).toBeNull();
  });

  /* Pasowanie rozpoznane przez Copilota przeszło z Doboru do Wiedzy
     (`docs/dobor-od-zera.md` §6), więc samo stawia wiersz Wiedza. */
  it("pasowanie Copilota stawia wiersz Wiedza, także bez dowodów", () => {
    rysuj(dane({ szkicCopilota: { pasowanie: { czesc: { symbol: "A" }, doCzego: { symbol: "B" } },
      pasowanieOcena: null } as never }));
    expect(wiersz(/^Wiedza/)).toHaveTextContent("pasowanie od Copilota");
  });

  /* Drogę zakupu przez kolejki mówią linie zakupu w osi rozmowy. Czipy
     w kolumnie były drugim zapisem tej samej drogi. */
  it("droga zakupu nie stoi w kolumnie", () => {
    const at = "2026-09-28T10:00:00Z";
    rysuj(dane({ droga: [{ rodzaj: "rozmowa", id: 4821, at, opis: null },
      { rodzaj: "dyskusja", id: 7, at, opis: null }, { rodzaj: "zwrot", id: 9, at, opis: null }] }));
    expect(screen.queryByRole("region", { name: "Droga tego zakupu" })).toBeNull();
  });

  /* Dwie sprawy pod jedną pozycją dawały licznik „1", a agent szukał drugiej. */
  it("licznik „Wymaga Ciebie” liczy każdą pozycję osobno", () => {
    const sprawa = (id: number) => ({ id, typ: "CLAIM", numer: `R-${id}`, temat: "Uszkodzony nóż",
      statusAllegro: null, decyzjaDo: null, otwartoAt: "2026-09-28T10:00:00Z", prowadzi: null, otwarta: true });
    rysuj(dane({ zamowienie: pusteZamowienie, sprawy: [sprawa(1), sprawa(2)],
      zwroty: [{ id: 5, kubelek: "decyzja" } as never] }));
    expect(within(swieci()).getByRole("heading", { name: "Wymaga Ciebie · 3" })).toBeInTheDocument();
    expect(within(swieci()).getAllByRole("link", { name: "Otwórz" })).toHaveLength(2);
  });

  /* Dobór stoi pod towarem, bo „Szukaj mimo to" otwiera go w miejscu
     przycisku. Klient i Wiedza nie zmieniają miejsca względem siebie. */
  it("wiersze stoją w stałej kolejności", () => {
    historia.data = { login: "k", wpisy: [], maszyny: [{ marka: "MTD", nazwa: "Smart 53 SPO", wariant: null,
      rocznik: "2019", silnik: null, rozmowaId: 4310, at: "2026-05-12T10:00:00Z" }] } satisfies HistoriaKlienta;
    wiedza.data = zWiedza;
    rysuj(dane({ zamowienie: pusteZamowienie, zwroty: [{ id: 9, kubelek: "zamkniety" } as never] }));
    const nazwy = screen.getAllByRole("button",
      { name: /^(Oferta i towar|Dobór|Zamówienie|Zamknięte sprawy|Klient|Wiedza)/ })
      .map((b) => b.querySelector("b")?.textContent);
    expect(nazwy).toEqual(["Oferta i towar", "Dobór", "Zamówienie", "Zamknięte sprawy", "Klient", "Wiedza"]);
  });
});

/* ── Rozstrzygające słowo na początku ─────────────────────────────────────────
   Oko czyta początek wiersza i pomija resztę (NN/g, wzorzec F, 2006 i 2017).
   O zamówieniu pyta się „gdzie paczka", więc paczka stoi pierwsza. Datę
   zakupu, sumę i datę doręczenia mówi karta zakupu i oś. */
describe("streszczenie zamówienia", () => {
  const przesylka = (n: Record<string, unknown> = {}) => ({ waybill: null, przewoznik: "DPD",
    status: "IN_TRANSIT", dostarczonoAt: null, sprawdzonoAt: null, ...n });
  const zamowienie = (p: Record<string, unknown>, pob: Record<string, unknown> = {}) => ({
    externalId: "z", link: null, przesylka: przesylka(p),
    pobrane: { kupionoAt: "2026-09-22T10:00:00Z", sumaGrosze: 5549, waluta: "PLN", pozycje: [], ...pob } as never,
  });

  it("zaczyna od paczki słowem, bez daty zakupu i kwoty", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    const s = streszczenieZamowienia(dane({ zamowienie: zamowienie({}) }));
    expect(s.startsWith("w drodze do klienta")).toBe(true);
    expect(s).not.toMatch(/55,49|kupione/);
  });

  it("za paczką stoi metoda dostawy", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    expect(streszczenieZamowienia(dane({ zamowienie: zamowienie({}, { dostawaMetoda: "Kurier DPD" }) })))
      .toBe("w drodze do klienta · Kurier DPD");
  });

  it("doręczona paczka bez daty — datę mówi karta i blok paczki", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    const s = streszczenieZamowienia(dane({ zamowienie: zamowienie({
      status: "DELIVERED", dostarczonoAt: "2026-09-24T10:00:00Z", sprawdzonoAt: "2026-09-24T11:00:00Z" }) }));
    expect(s.startsWith("doręczona")).toBe(true);
    expect(s).not.toMatch(/2026/);
  });

  it("sprawdzona paczka bez numeru mówi to wprost", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    expect(streszczenieZamowienia(dane({ zamowienie: zamowienie({
      status: null, sprawdzonoAt: "2026-09-24T11:00:00Z" }) }))).toMatch(/^bez numeru przesyłki/);
  });

  it("przy soczewce paczki nie mówi paczki — stoi wyżej", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    const rozmowa = { ...dane().rozmowa, kopilot: kopilot("ORDER_STATUS") };
    expect(streszczenieZamowienia(dane({ rozmowa, zamowienie: zamowienie({}) }))).toBe("paczka wyżej");
    const s = streszczenieZamowienia(dane({ rozmowa, zamowienie: zamowienie({}, { dostawaMetoda: "Kurier DPD" }) }));
    expect(s).toBe("Kurier DPD");
    expect(s).not.toMatch(/w drodze|kupione/);
  });

  it("liczy pozycje, gdy ich lista stoi pod wierszem", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    const s = streszczenieZamowienia(dane({ zamowienie: { externalId: "z", link: null, przesylka: null,
      pobrane: pobrane({ pozycje: [pozycja({ offerId: "12096815384" }), pozycja({ offerId: "2" }),
        pozycja({ offerId: "3" })] }) } }));
    expect(s).toContain("3 pozycje");
  });

  it("bez zamówienia mówi, ilu zakupów klienta dotyczy wskazanie", async () => {
    const { streszczenieZamowienia } = await import("./Kontekst");
    expect(streszczenieZamowienia(dane({ kandydaciZamowien: [{ externalId: "a" }, { externalId: "b" }] as never })))
      .toBe("niepowiązane · 2 zakupy klienta");
  });
});

/* Streszczenie oferty mówi stan oferty i skąd mamy kartotekę. Cenę mówi
   karta zakupu, a „kartoteka, ceny, opis" było spisem treści, nie daną. */
describe("streszczenie oferty", () => {
  const zOferta = (status: string | null, kartoteka: Record<string, unknown>) => dane({ oferta: {
    ...dane().oferta!,
    pobrana: { nazwa: "Nóż", sku: "N-1", cenaGrosze: 4890, waluta: "PLN", status,
      syncedAt: "2026-09-28T10:00:00Z", zdjecie: "brak" as never },
    kartoteka: { ...dane().oferta!.kartoteka, ...kartoteka },
  } });

  it("mówi stan słowem i pewność kartoteki, bez ceny", async () => {
    const { streszczenieOferty } = await import("./Kontekst");
    const s = streszczenieOferty(zOferta("ACTIVE", { pewnosc: "sku", twId: 7 }));
    expect(s).toBe("aktywna · kartoteka po SKU");
    expect(s).not.toMatch(/PLN|ceny, opis/);
    expect(streszczenieOferty(zOferta("ENDED", { pewnosc: "pamiec", twId: 7 })))
      .toBe("zakończona · kartoteka wskazana");
    expect(streszczenieOferty(zOferta("ACTIVE", { pewnosc: "jedyna_pozycja", twId: 7 })))
      .toMatch(/propozycja kartoteki$/);
    expect(streszczenieOferty(zOferta("ACTIVE", { pewnosc: "brak", twId: null }))).toMatch(/bez kartoteki$/);
  });

  it("bez pobranej treści mówi to jednym zdaniem", async () => {
    const { streszczenieOferty } = await import("./Kontekst");
    expect(streszczenieOferty(dane())).toBe("treść oferty jeszcze nie pobrana");
  });
});

describe("streszczenie doboru", () => {
  it("mówi stan, a przy wybranej części jej symbol zamiast danych", async () => {
    const { streszczenieDoboru } = await import("./Kontekst");
    const d = dane();
    const zDanymi = { ...d.dobor, stan: "otwarty" as const,
      dane: { ...d.dobor.dane, nazwaCzesci: "szarpak", marka: "NAC", model: "LS 46" } };
    expect(streszczenieDoboru(d)).toBe("Nie zaczęty");
    expect(streszczenieDoboru({ ...d, dobor: zDanymi })).toBe("Otwarty · szarpak NAC LS 46");
    expect(streszczenieDoboru({ ...d, dobor: { ...zDanymi, stan: "czesc", wynik: "czesc",
      wybrany: { twId: 1, symbol: "532199377", podstawa: "numer", zdanieDoSzkicu: "…" } } }))
      .toBe("Wybrano część · 532199377");
  });
});
