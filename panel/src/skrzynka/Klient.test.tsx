import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import type { DosylkaSprawy, HistoriaKlienta, SprawaKlienta } from "../api/typy";

/* ── Zakładka KLIENT (§10.1) ─────────────────────────────────────────────────
   Zakładka jest ODCZYTEM i te testy pilnują tego, co o niej stanowi.

   BRAK LOGINU TO NIE BRAK HISTORII. Wątek bez rozmówcy znaczy „nie wiemy,
      czyja to historia". Pokazanie wtedy pustej osi byłoby kłamstwem
      o kliencie, który kupuje u nas od lat.                                 */

const historia = vi.fn();
vi.mock("../api/rozmowy", () => ({ useHistoriaKlienta: (id: number | null) => historia(id) }));

const { Klient, WidokHistorii } = await import("./Klient");

const dane = (n: Partial<HistoriaKlienta> = {}): HistoriaKlienta =>
  ({ login: "zielony_ogrod", wpisy: [], ...n });

const pokaz = (d: HistoriaKlienta, onOtworz = vi.fn()) => {
  historia.mockReturnValue({ data: d, isLoading: false, error: null });
  render(<MemoryRouter><Klient rozmowaId={4821} onOtworzRozmowe={onOtworz} /></MemoryRouter>);
  return onOtworz;
};

beforeEach(() => vi.clearAllMocks());

describe("zakładka klienta", () => {
  it("oś rozdziela zakup od rozmowy i prowadzi w dwa różne miejsca", async () => {
    const onOtworz = pokaz(dane({ wpisy: [
      { rodzaj: "zakup", at: "2024-06-14T12:00:00Z", tresc: "Szarpak SZR-148/82",
        zamowienieId: "2024/06/1183", link: "https://allegro.pl/zam/2024-06-1183", rozmowaId: null,
        sprawaId: null },
      { rodzaj: "rozmowa", at: "2024-06-14T09:00:00Z", tresc: "ustalono model kosiarki",
        zamowienieId: null, link: null, rozmowaId: 3140, sprawaId: null },
    ] }));

    /* Zakup wychodzi z aplikacji do panelu Allegro — to jedyne miejsce, gdzie
       stoi całe zamówienie. Rozmowa zostaje u nas. */
    const zamowienie = screen.getByRole("link", { name: /2024\/06\/1183/ });
    expect(zamowienie).toHaveAttribute("href", "https://allegro.pl/zam/2024-06-1183");
    expect(screen.getByText(/Szarpak SZR-148\/82/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /ustalono model kosiarki/ }));
    expect(onOtworz).toHaveBeenCalledWith(3140);
  });

  it("wątek bez loginu mówi, że nie wiemy — nie pokazuje pustej historii", () => {
    pokaz(dane({ login: null }));
    expect(screen.getByText(/nie niesie loginu kupującego/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Oś historii klienta")).not.toBeInTheDocument();
  });

  it("wątek bez loginu i tak pokazuje sprawę kupującego z zamówienia rozmowy", () => {
    /* S6, 0.535.0: sprawa budzi się z rozmowy dowiązanej numerem zamówienia
       i do niej odsyła — więc ta rozmowa pokazuje sprawę, choć historii nie
       zna. Login linijki to login SPRAWY, bo historia go nie ma. */
    pokaz(dane({ login: null, sprawa: {
      id: 7, login: "Kupujacy55", wersja: 1, stan: "w_toku", krok: "czekamy na zwrot",
      krokDo: "2026-09-28T06:00:00Z", dzis: false, poTerminie: false, prowadzi: "Ola", prowadziId: 1,
      zakonczonoAt: null, zakonczyl: null, odcisk: "{}", nowe: [], dosylki: [] } }));
    expect(screen.getByText(/nie niesie loginu kupującego/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sprawa klienta: czekamy na zwrot/ }))
      .toHaveAttribute("href", "/obsluga/klient/Kupujacy55");
    expect(screen.queryByLabelText("Oś historii klienta")).not.toBeInTheDocument();
  });

  it("login nie stoi trzeci raz — profil klienta zostaje o klik", () => {
    /* Zeszło (0.513.0): w skrzynce login stoi w nagłówku rozmowy i przy
       wiadomościach, a kopiuje się go stamtąd. Odnośnik do profilu zostaje. */
    pokaz(dane());
    expect(screen.queryByText("zielony_ogrod")).toBeNull();
    expect(screen.getByRole("link", { name: "Profil klienta" }))
      .toHaveAttribute("href", "/obsluga/klient/zielony_ogrod");
  });

  it("klient znany, ale bez historii, dostaje zdanie zamiast pustki", () => {
    pokaz(dane());
    expect(screen.getByText(/Pierwszy kontakt/)).toBeInTheDocument();
  });

  it("zwrot, reklamacja i dyskusja stoją na osi i prowadzą do swoich kolejek", async () => {
    /* S2 spoiwa: zakładka obiecywała historię, a pokazywała jej połowę.
       Wiersz prowadzi na ekran właściwej kolejki, bo tam stoją bramki sprawy. */
    pokaz(dane({ wpisy: [
      { rodzaj: "zwrot", at: "2026-08-10T12:00:00Z", tresc: "Z-77",
        zamowienieId: "ord-1", link: null, rozmowaId: null, sprawaId: 11 },
      { rodzaj: "reklamacja", at: "2026-08-09T12:00:00Z", tresc: "Nie działa",
        zamowienieId: "ord-1", link: null, rozmowaId: null, sprawaId: 22 },
      { rodzaj: "dyskusja", at: "2026-08-08T12:00:00Z", tresc: "Gdzie paczka",
        zamowienieId: "ord-1", link: null, rozmowaId: null, sprawaId: 33 },
    ] }));

    expect(screen.getByRole("link", { name: /Z-77/ })).toHaveAttribute("href", "/obsluga/zwroty/11");
    expect(screen.getByRole("link", { name: /Nie działa/ }))
      .toHaveAttribute("href", "/obsluga/reklamacje/22");
    expect(screen.getByRole("link", { name: /Gdzie paczka/ }))
      .toHaveAttribute("href", "/obsluga/dyskusje/33");
  });

  it("historia przy źródle niesie sprawę klienta i prowadzi do profilu", () => {
    /* S6, 0.535.0: wiązanie w obie strony. Profil prowadzi do rozmowy, więc
       rozmowa mówi, że klienta ktoś prowadzi i na co czeka — inaczej drugi
       agent odpisałby klientowi, nie wiedząc o kroku kolegi. */
    const sprawa: SprawaKlienta = {
      id: 5, login: "zielony_ogrod", wersja: 2, stan: "w_toku", krok: "czekamy na zwrot",
      krokDo: "2026-09-25T06:00:00Z", dzis: false, poTerminie: true, prowadzi: "Bartek", prowadziId: 2,
      zakonczonoAt: null, zakonczyl: null, odcisk: "{}", dosylki: [],
      nowe: [{ rodzaj: "rozmowa", tekst: "Klient napisał 26.09 14:10", at: null, cel: "/obsluga/skrzynka/41" }],
    };
    pokaz(dane({ sprawa }));
    const linia = screen.getByRole("link", { name: /Sprawa klienta: czekamy na zwrot/ });
    expect(linia).toHaveAttribute("href", "/obsluga/klient/zielony_ogrod");
    expect(linia).toHaveTextContent("prowadzi Bartek");
    expect(linia).toHaveTextContent("Klient napisał 26.09 14:10");
    expect(screen.getByText("po terminie").className).toContain("text-ranga-zle");
  });

  /* Wpisy tego zakupu mają dom w karcie zakupu, w ramie „Wymaga Ciebie",
     w „Zamkniętych sprawach" i w osi. Historia w kolumnie mówi resztę. */
  it("w kolumnie rozmowy historia nie powtarza tego zakupu; rozmowy zostają", () => {
    historia.mockReturnValue({ isLoading: false, error: null, data: dane({ wpisy: [
      { rodzaj: "zakup", at: "2026-09-14T12:00:00Z", tresc: "Szarpak SZR-148/82",
        zamowienieId: "z-1", link: null, rozmowaId: null, sprawaId: null },
      { rodzaj: "rozmowa", at: "2026-09-14T09:00:00Z", tresc: "ustalono model kosiarki",
        zamowienieId: null, link: null, rozmowaId: 3140, sprawaId: null },
    ] }) });
    render(<MemoryRouter><Klient rozmowaId={4821} onOtworzRozmowe={vi.fn()} zamowienieId="z-1" /></MemoryRouter>);
    expect(screen.queryByText(/Zakup:/)).toBeNull();
    expect(screen.getByRole("button", { name: /ustalono model kosiarki/ })).toBeInTheDocument();
  });

  /* Rozmowa bez zamówienia: lista „Zakupy tego klienta" stoi otwarta
     w wierszu „Zamówienie" i to jej dom. W historii zakup stał drugi raz,
     z inną walutą i innym zapisem numeru. */
  it("bez zamówienia zakupy z otwartej listy nie stoją drugi raz w historii; zwrot i rozmowa zostają", () => {
    historia.mockReturnValue({ isLoading: false, error: null, data: dane({ wpisy: [
      { rodzaj: "zakup", at: "2026-05-12T09:10:00Z", tresc: "Filtr powietrza",
        zamowienieId: "z-2", link: null, rozmowaId: null, sprawaId: null },
      { rodzaj: "zwrot", at: "2026-05-20T09:10:00Z", tresc: "ZW/2026/05/0003",
        zamowienieId: "z-2", link: null, rozmowaId: null, sprawaId: 3 },
      { rodzaj: "rozmowa", at: "2026-05-11T09:00:00Z", tresc: "ustalono model kosiarki",
        zamowienieId: null, link: null, rozmowaId: 3140, sprawaId: null },
    ] }) });
    render(<MemoryRouter><Klient rozmowaId={4821} onOtworzRozmowe={vi.fn()} zamowienieId={null}
      pomin={new Set(["z-2"])} /></MemoryRouter>);
    expect(screen.queryByText(/Filtr powietrza/)).toBeNull();
    expect(screen.getByText("ZW/2026/05/0003")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ustalono model kosiarki/ })).toBeInTheDocument();
    /* Tytuł wiersza mówi już „Klient", więc drugiego nagłówka nie ma. */
    expect(screen.queryByText("Historia u nas")).toBeNull();
  });

  it("gdy oś opróżniły zakupy z listy, mówi, gdzie stoją — nie „pierwszy kontakt”", () => {
    historia.mockReturnValue({ isLoading: false, error: null, data: dane({ wpisy: [
      { rodzaj: "zakup", at: "2026-05-12T09:10:00Z", tresc: "Filtr powietrza",
        zamowienieId: "z-2", link: null, rozmowaId: null, sprawaId: null },
    ] }) });
    render(<MemoryRouter><Klient rozmowaId={4821} onOtworzRozmowe={vi.fn()} zamowienieId={null}
      pomin={new Set(["z-2"])} /></MemoryRouter>);
    expect(screen.getByText("Zakupy tego klienta stoją w wierszu „Zamówienie”.")).toBeInTheDocument();
    expect(screen.queryByText(/Pierwszy kontakt/)).toBeNull();
    expect(screen.getByRole("link", { name: "Profil klienta" })).toBeInTheDocument();
  });

  /* Przy powiązanym zamówieniu lista innych zakupów chowa się za „to nie ta
     paczka?", bo służy do przepięcia. Wycięty zakup nie stałby wtedy nigdzie
     na widoku — więc zostaje w historii, nawet gdy ktoś poda `pomin`. */
  it("przy zamówieniu rozmowy inny zakup zostaje w historii", () => {
    historia.mockReturnValue({ isLoading: false, error: null, data: dane({ wpisy: [
      { rodzaj: "zakup", at: "2026-05-12T09:10:00Z", tresc: "Filtr powietrza",
        zamowienieId: "z-2", link: null, rozmowaId: null, sprawaId: null },
    ] }) });
    render(<MemoryRouter><Klient rozmowaId={4821} onOtworzRozmowe={vi.fn()} zamowienieId="z-1"
      pomin={new Set(["z-2"])} /></MemoryRouter>);
    expect(screen.getByText(/Filtr powietrza/)).toBeInTheDocument();
    expect(screen.queryByText(/stoją w wierszu „Zamówienie”/)).toBeNull();
  });

  it("przy samej sprawie i zakupie pusta oś nie mówi „pierwszy kontakt”", () => {
    historia.mockReturnValue({ isLoading: false, error: null, data: dane({ sprawa: {
      id: 5, login: "zielony_ogrod", wersja: 2, stan: "w_toku", krok: "czekamy na zwrot",
      krokDo: "2026-09-25T06:00:00Z", dzis: false, poTerminie: false, prowadzi: "Bartek", prowadziId: 2,
      zakonczonoAt: null, zakonczyl: null, odcisk: "{}", nowe: [], dosylki: [] } }) });
    render(<MemoryRouter><Klient rozmowaId={4821} onOtworzRozmowe={vi.fn()} zamowienieId="z-1" /></MemoryRouter>);
    expect(screen.queryByText(/Pierwszy kontakt/)).toBeNull();
    expect(screen.getByText(/Poza tym zakupem nie mamy/)).toBeInTheDocument();
  });

  it("bez sprawy i na samym profilu linijki sprawy nie ma", () => {
    pokaz(dane({ sprawa: null }));
    expect(screen.queryByRole("link", { name: /Sprawa klienta/ })).toBeNull();

    /* Profil ma własną kartę sprawy — druga, w historii, mówiłaby to samo. */
    render(<MemoryRouter><WidokHistorii bezProfilu onOtworzRozmowe={vi.fn()}
      historia={{ login: "zielony_ogrod", wpisy: [], sprawa: {
        id: 5, login: "zielony_ogrod", wersja: 2, stan: "zakonczona", krok: "dosłać",
        krokDo: "2026-09-25T06:00:00Z", dzis: false, poTerminie: false, prowadzi: "Bartek", prowadziId: 2,
        zakonczonoAt: "2026-09-24T12:00:00Z", zakonczyl: "Bartek", odcisk: "{}", nowe: [], dosylki: [] } }} />
    </MemoryRouter>);
    expect(screen.queryByText(/Sprawa klienta/)).toBeNull();
  });
});

/* ── Dosyłka w linijce sprawy (0.536.0) ─────────────────────────────────────
   Linijka stoi przy każdej kolejce i niesie JEDNO zdanie o dosyłce —
   najpilniejsze, nie najświeższe: kłopot, brak numeru, w drodze, doręczona.
   Reszta stoi na profilu. Zakończona sprawa przychodzi z pustą listą
   dosyłek, więc takiego przypadku tu nie ma.                                 */
describe("dosyłka w linijce sprawy", () => {
  const d = (n: Partial<DosylkaSprawy>): DosylkaSprawy => ({
    zamowienie: "z-1", zwrotId: null, waybill: "620111", przewoznik: "DPD", przewoznikZamowienia: "DPD",
    zrodlo: "allegro",
    status: "IN_TRANSIT", dostarczonoAt: null, sprawdzonoAt: "2026-09-27T12:10:00Z",
    zalozonoAt: "2026-09-24T10:00:00Z", bezNumeru: false, opis: "Dosyłka w drodze (stan z 14:10)", ton: null, ...n,
  });
  const sprawa = (dosylki: DosylkaSprawy[], n: Partial<SprawaKlienta> = {}): SprawaKlienta => ({
    id: 5, login: "zielony_ogrod", wersja: 2, stan: "w_toku", krok: "dosłać",
    krokDo: "2026-09-30T06:00:00Z", dzis: false, poTerminie: false, prowadzi: "Bartek", prowadziId: 2,
    zakonczonoAt: null, zakonczyl: null, odcisk: "{}", nowe: [], dosylki, ...n,
  });
  const DOREC = d({ zamowienie: "z-3", status: "DELIVERED", dostarczonoAt: "2026-09-26T10:00:00Z",
    opis: "Dosyłka doręczona 26.09", ton: "ok" });
  const PROBLEM = d({ zamowienie: "z-2", status: "ISSUE", opis: "Przewoźnik zgłosił problem z dosyłką", ton: "zle" });
  /* Bez numeru serwer zeruje numer i jego źródło naraz. */
  const BEZ = d({ zamowienie: "z-4", waybill: null, zrodlo: null, przewoznik: null, status: null, sprawdzonoAt: null,
    opis: "Czekamy na numer dosyłki z Allegro" });
  /* Tak przychodzi dosyłka w HISTORII kolejek: numer idzie tylko na profil. */
  const wHistorii = (x: DosylkaSprawy): DosylkaSprawy => ({ ...x, waybill: null });

  it("dokleja zdanie dosyłki do tej samej linijki, w barwie tonu", () => {
    pokaz(dane({ sprawa: sprawa([PROBLEM]) }));
    const linia = screen.getByRole("link", { name: /Sprawa klienta: dosłać/ });
    expect(linia).toHaveTextContent("prowadzi Bartek · Przewoźnik zgłosił problem z dosyłką");
    expect(screen.getByText("Przewoźnik zgłosił problem z dosyłką").className).toContain("text-ranga-zle");
  });

  it.each([
    { nazwa: "kłopot przed doręczoną, choć ta jest nowsza", lista: [DOREC, PROBLEM], jest: PROBLEM },
    { nazwa: "brak numeru przed paczką w drodze", lista: [d({}), BEZ], jest: BEZ },
    { nazwa: "paczka w drodze przed doręczoną", lista: [DOREC, d({ zamowienie: "z-5" })], jest: d({}) },
    { nazwa: "sama doręczona", lista: [DOREC], jest: DOREC },
    { nazwa: "w drodze przed doręczoną także bez numerów, jak w historii kolejek",
      lista: [wHistorii(DOREC), wHistorii(d({ zamowienie: "z-5" }))], jest: d({}) },
    { nazwa: "brak numeru dalej wygrywa bez numerów w odpowiedzi",
      lista: [wHistorii(d({})), wHistorii(BEZ)], jest: BEZ },
  ])("wybiera najpilniejszą: $nazwa", ({ lista, jest }) => {
    pokaz(dane({ sprawa: sprawa(lista) }));
    const linia = screen.getByRole("link", { name: /Sprawa klienta: dosłać/ });
    expect(linia).toHaveTextContent(jest.opis);
    for (const inna of lista.filter((x) => x.opis !== jest.opis)) expect(linia).not.toHaveTextContent(inna.opis);
  });
});
