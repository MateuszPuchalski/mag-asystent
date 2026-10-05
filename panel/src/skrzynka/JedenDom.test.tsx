import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HistoriaKlienta, KartaTowaru, OsRozmowy } from "../api/typy";
import { Kontekst } from "./Kontekst";

/* Zdjęcia ciągnie własna kolejka `towar/useZdjecie.ts`, poza klientem zapytań,
   więc czekanie na `isFetching` ich nie widzi, a jsdom obrazu i tak nie pokaże.
   Tekstu zdjęcie nie niesie, więc atrapa niczego nie chowa przed strażnikiem. */
vi.mock("../towar/useZdjecie", () => ({ useZdjecie: () => null, useZdjecieOferty: () => null }));

/* ── FAKT MA JEDEN DOM ───────────────────────────────────────────────────────
   Wzór: `reklamacje/Triaz.test.tsx`, czyli test tego, co rozstrzyga, a nie
   wyglądu. Cztery kolejne wydania dokładały do prawej kolumny warstwę i ten
   sam fakt stawał w trzech miejscach. Agent porównywał wtedy trzy zapisy,
   zamiast przeczytać jeden, a zasada „fakt ma jeden dom" była konwencją.

   Podział domów: karta zakupu nad osią mówi, co klient KUPIŁ i KIM jest.
   Kolumna mówi, co MAMY w Subiekcie, gdzie jest paczka i co czeka na ruch.
   Fakt z karty wraca do kolumny tylko jako wyjątek opisany w `Kontekst.tsx`:
   pasmo „Zamówił" (dlatego SKU stoi raz, właśnie tam) i data doręczenia
   w bloku paczki.

   CO PILNUJE. Że fakty karty nie wracają do kolumny żadną drogą: ani przy
   otwarciu, ani po rozwinięciu każdego wiersza i każdej listy. Kolumna stoi
   na prawdziwych hakach i prawdziwym kliencie zapytań, bo `Kontekst.test.tsx`
   podmienia bloki atrapami, a fakt w treści bloku przeszedłby tam obok.
   Przy okazji liczy zapisy: rozwijanie to stan ekranu, więc zero żądań
   innych niż GET.

   CZEGO NIE PILNUJE. Zna jedną rozmowę o towarze z jednej pozycji, przy
   kliencie z historią i przy nowym. Nowy fakt karty, którego nie ma na liście
   `FAKTY_KARTY`, przejdzie. Dokładając fakt do karty, dopisz go tutaj.     */

const ZAMOWIENIE = "a7f3c2e0-1b44-11f1-9d2a-77e1c0a4b001";
const INNE_ZAMOWIENIE = "5c1d9e40-f3a2-11f0-8b11-2fa0c3d4e002";
const OFERTA = "15536250911";
const SKU = "MTD-742-0741";
const NAZWA_OFERTY = "NÓŻ DO KOSIARKI MTD SMART 53 SPO 53 cm 742-0741 ORYGINAŁ";
const TW_ID = 7701;

/** Fakty z domem poza kolumną: wzorzec i to, gdzie fakt stoi. Kolumna nie mówi żadnego. */
const FAKTY_KARTY: Array<[RegExp, string]> = [
  [/77,98/, "suma zakupu — karta"],
  [/28 września|28\.09/, "data zakupu — krok „Złożone” w karcie i linia osi"],
  [/a7f3c2e0/, "numer zamówienia — karta"],
  [/Nowy klient|Wcześniej u nas/, "historia klienta — plakietka w karcie i w pasku"],
  [/Klient pisze o/, "nazwa i SKU w bramce doboru — karta"],
  [/kupione|zapłacono/i, "kroki zakupu — karta"],
  [/NÓŻ DO KOSIARKI MTD SMART/, "tytuł oferty — karta"],
  [/\bACTIVE\b/, "surowy status oferty — słowo w streszczeniu wiersza"],
];

const KARTA: KartaTowaru = {
  id: TW_ID, sym: SKU, name: "Nóż kosiarki MTD 53 cm (oryginał)", ean: "4008423864212", unit: "szt.",
  desc: "Nóż tnący do kosiarek spalinowych z koszem, szerokość koszenia 53 cm.",
  locs: ["A-12-3"], mag: { stan: 9, rez: 2, avail: 7 }, magazyny: [],
  ceny: [
    { poziom: 0, nazwa: "Detaliczna", nettoGrosze: 5284, bruttoGrosze: 6499, waluta: "PLN" },
    { poziom: 1, nazwa: "Hurtowa", nettoGrosze: 4472, bruttoGrosze: 5501, waluta: "PLN" },
  ],
};

const WIEDZA_TOWARU = { potwierdzone: [], negatywne: [], propozycje: [],
  pasowania: { pasujeDo: [], pasujace: [], negatywne: [] }, zamiennosciOem: [] };

/* Historia tak, jak oddaje ją serwer: RAZEM z bieżącym zakupem. Wiersz
   „Klient" ma ten zakup wyciąć, a jego treść niesie nazwę oferty i sumę,
   więc przeciek byłoby widać od razu. */
const HISTORIA: HistoriaKlienta = {
  login: "ogrodnik_janusz",
  maszyny: [{ marka: "MTD", nazwa: "Smart 53 SPO", wariant: null, rocznik: "2019", silnik: null,
    rozmowaId: 4310, at: "2026-05-11T10:00:00.000Z" }],
  wpisy: [
    { rodzaj: "zakup", at: "2026-09-28T17:42:00.000Z", tresc: "NÓŻ DO KOSIARKI MTD SMART 53 SPO 53 cm · 77,98 zł",
      zamowienieId: ZAMOWIENIE, link: null, rozmowaId: null, sprawaId: null },
    { rodzaj: "zakup", at: "2026-05-12T09:10:00.000Z", tresc: "FILTR POWIETRZA BRIGGS & STRATTON · 45,98 zł",
      zamowienieId: INNE_ZAMOWIENIE, link: null, rozmowaId: null, sprawaId: null },
    { rodzaj: "rozmowa", at: "2026-05-11T10:00:00.000Z", tresc: "Pytanie o filtr powietrza do MTD Smart 53",
      zamowienieId: null, link: null, rozmowaId: 4310, sprawaId: null },
  ],
  sprawa: null,
};

/* Nowy klient: serwer oddaje historię z jednym wpisem, tym zakupem. Karta
   mówi wtedy „Nowy klient", a kolumna nie mówi o kliencie nic. */
const HISTORIA_NOWEGO: HistoriaKlienta = { ...HISTORIA, wpisy: [HISTORIA.wpisy[0]] };

const WIEDZA_DOBORU = { zastosowanie: null, zabudowa: null, pasowanie: null, silniki: [], pomiary: [] };

let zadania: Array<{ metoda: string; url: string }> = [];
let historiaSerwera: HistoriaKlienta = HISTORIA;

beforeEach(() => {
  zadania = [];
  localStorage.setItem("wertis-panel-token", "t");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    zadania.push({ metoda: init?.method ?? "GET", url });
    const json = (x: unknown) => new Response(JSON.stringify(x));
    if (url.endsWith(`/api/products/${TW_ID}`)) return json(KARTA);
    if (url.endsWith(`/api/obsluga/wiedza/towar/${TW_ID}`)) return json(WIEDZA_TOWARU);
    if (url.endsWith("/klient")) return json(historiaSerwera);
    if (url.endsWith("/dobor/wiedza")) return json(WIEDZA_DOBORU);
    return json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

const pozycja = { offerId: OFERTA, nazwa: NAZWA_OFERTY, sku: SKU, ilosc: 1, cenaGrosze: 6499, waluta: "PLN",
  zwracana: false, wracaIlosc: 0, twId: TW_ID, twSymbol: SKU, twZrodlo: "sku", ofertaZdjecie: "jest" };

const BIEZACY_ZAKUP = { externalId: ZAMOWIENIE, link: null, status: "READY_FOR_PROCESSING",
  kupionoAt: "2026-09-28T17:42:00.000Z", sumaGrosze: 7798, waluta: "PLN", pozycje: NAZWA_OFERTY, maTeOferte: true };
const INNY_ZAKUP = { externalId: INNE_ZAMOWIENIE, link: null, status: "READY_FOR_PROCESSING",
  kupionoAt: "2026-05-12T09:10:00.000Z", sumaGrosze: 4598, waluta: "PLN", pozycje: "FILTR POWIETRZA BRIGGS & STRATTON",
  maTeOferte: false };

/** Rozmowa o towarze: jedna pozycja, oferta z zamówienia, paczka doręczona, dobór za bramką. */
const dane = (kandydaci: unknown[]): OsRozmowy => ({
  rozmowa: {
    id: 4821, klient: "ogrodnik_janusz", ostatniaWiadomosc: "", ostatniaWiadomoscAt: "2026-10-04T07:43:00.000Z",
    ostatniaOdKlienta: true, nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 3,
    status: "waiting_for_us", odlozoneDo: null, poTerminie: false, podziekowal: false, oglada: null,
    priorytet: "normalny", czekaOdMs: null, reklamacyjna: false, nowychOdOdpowiedzi: 1, zadanieWToku: false,
    dobor: "otwarty",
    kopilot: { kategoria: "PRODUCT_QUESTION", dodatkowe: [], zrodlo: "MODEL", status: "SUCCESS",
      nieaktualna: false, kategoriaCzlowieka: null },
  },
  os: [], szkic: null, ofertaWskazana: null, szkicCopilota: null,
  zamowienie: {
    externalId: ZAMOWIENIE, link: `https://allegro.pl/moje-allegro/sprzedaz/zamowienia/${ZAMOWIENIE}`,
    pobrane: {
      externalId: ZAMOWIENIE, status: "READY_FOR_PROCESSING", kupujacyLogin: "ogrodnik_janusz",
      dostawaGrosze: 1299, dostawaMetoda: "InPost Paczkomaty 24/7", platnoscTyp: "ONLINE",
      platnoscAt: "2026-09-28T17:44:00.000Z", fakturaZadana: false, sumaGrosze: 7798, waluta: "PLN",
      kupionoAt: "2026-09-28T17:42:00.000Z", link: null, pozycje: [pozycja],
    },
    przesylka: { waybill: "620001234567890118765432", przewoznik: "InPost", status: "DELIVERED",
      dostarczonoAt: "2026-09-30T12:18:00.000Z", sprawdzonoAt: "2026-10-01T06:00:00.000Z" },
  },
  oferta: {
    externalId: OFERTA, link: `https://allegro.pl/oferta/${OFERTA}`, zrodlo: "zamowienie",
    zgodnosc: { lista: ["MTD Smart 53 SPO", "MTD 53 SPO"], maszyna: "MTD Smart 53 SPO",
      trafienia: ["MTD Smart 53 SPO"], wariantSprawdzony: false },
    pobrana: { nazwa: NAZWA_OFERTY, sku: SKU, cenaGrosze: 6499, waluta: "PLN", status: "ACTIVE",
      syncedAt: "2026-10-04T07:50:00.000Z", zdjecie: "jest" },
    /* Zdanie DOKŁADNIE takie, jakie pisze serwer (`dopasowanie-sku.ts`): niesie
       samo SKU. Zmyślone zdanie bez SKU przepuszczało drugi zapis w podpisie
       źródła przy towarze. */
    kartoteka: { pewnosc: "sku", twId: TW_ID, symbol: SKU, zrodlo: `SKU oferty „${SKU}"`, powod: null },
  },
  kandydaciZamowien: kandydaci,
  zwroty: [], sprawy: [],
  /* Droga zakupu przez kolejki ma dom w liniach osi. Trzy przystanki, bo
     dawny blok drogi stawał dopiero od dwóch. */
  droga: [
    { rodzaj: "rozmowa", id: 4821, at: "2026-09-29T08:00:00.000Z", opis: null },
    { rodzaj: "zwrot", id: 77, at: "2026-09-30T15:05:00.000Z", opis: "ZW/2026/10/0077" },
    { rodzaj: "dyskusja", id: 311, at: "2026-10-03T19:20:00.000Z", opis: "Zwrot pieniędzy" },
  ],
  /* Automat wpisał dane i dobór czeka za bramką: towar jest znany z zamówienia. */
  dobor: { stan: "otwarty", wynik: null, wersja: 2, wybrany: null, dopytac: null, zmienil: "automat",
    zmienilAutomat: true, zmienionoAt: "2026-10-04T07:44:00.000Z",
    dane: { marka: "MTD", model: "Smart 53 SPO", wariant: null, rocznik: "2019", nrSeryjny: null, silnik: null,
      oem: null, nazwaCzesci: "nóż" } },
} as unknown as OsRozmowy);

const kolumna = () => screen.getByRole("region", { name: "Kontekst" });

/** Domy faktów — to samo przed rozwinięciem i po rozwinięciu wszystkiego. */
function sprawdzDomy() {
  const k = kolumna();
  /* SKU stoi raz i w paśmie: to jedyny wyjątek, bo karta bywa poza kadrem,
     a „Zamówił" rozstrzyga odpowiedź. Liczymy w całym tekście kolumny, bo
     drugi zapis bywa rozbity na kilka elementów. */
  expect(k.textContent?.match(new RegExp(SKU, "g")) ?? []).toHaveLength(1);
  const sku = within(k).getAllByText(new RegExp(SKU));
  expect(sku).toHaveLength(1);
  expect(sku[0].closest("aside")).toHaveAccessibleName("Do tej odpowiedzi");

  const przecieki = FAKTY_KARTY.filter(([wzor]) => wzor.test(k.textContent ?? ""))
    .map(([wzor, dom]) => `${wzor} (${dom})`);
  expect(przecieki).toEqual([]);
  expect(within(k).queryByRole("region", { name: "Droga tego zakupu" })).toBeNull();
}

/* Dwa przypadki, bo fakt o kliencie wraca dwiema drogami: licznikami przy
   kliencie z historią i linijką „Nowy klient" przy pierwszym zakupie. */
const PRZYPADKI = [
  { nazwa: "klient z historią", historia: HISTORIA, kandydaci: [BIEZACY_ZAKUP, INNY_ZAKUP], wierszKlient: true,
    innychZakupow: 1 },
  { nazwa: "nowy klient, jedynym wpisem jest ten zakup", historia: HISTORIA_NOWEGO, kandydaci: [BIEZACY_ZAKUP],
    wierszKlient: false, innychZakupow: 0 },
];

describe("Fakt z karty zakupu nie wraca do prawej kolumny", () => {
  it.each(PRZYPADKI)("$nazwa: ani przy otwarciu, ani po rozwinięciu wszystkiego; zero zapisu",
    async ({ historia, kandydaci, wierszKlient, innychZakupow }) => {
      historiaSerwera = historia;
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(<QueryClientProvider client={qc}><MemoryRouter>
        <Kontekst dane={dane(kandydaci)} onWstawDoSzkicu={() => {}}
          onOtworzRozmowe={() => {}} />
      </MemoryRouter></QueryClientProvider>);

      /* Czekamy, aż kolumna dociągnie wszystko, co czyta przy otwarciu: kartę
         z Subiekta (pasmo), historię klienta i wiedzę. Inaczej sprawdzalibyśmy
         kolumnę, w której przeciek jeszcze nie zdążył stanąć. */
      const pasmo = await screen.findByRole("complementary", { name: "Do tej odpowiedzi" });
      expect(await within(pasmo).findByText(KARTA.name)).toBeInTheDocument();
      await waitFor(() => expect(zadania.some((z) => z.url.endsWith("/4821/klient"))).toBe(true));
      await waitFor(() => expect(qc.isFetching()).toBe(0));
      if (wierszKlient) expect(await screen.findByRole("button", { name: /^Klient/ })).toBeInTheDocument();
      else expect(screen.queryByRole("button", { name: /^Klient/ })).toBeNull();
      sprawdzDomy();

      /* ROZWIŃ WSZYSTKO: każdy wiersz, każdą listę i każdy tekst
         z `aria-expanded="false"`, aż nic nie zostanie. Fakt pod kliknięciem
         to tak samo drugi dom, tylko pierwszy rzut oka go nie widzi. Limit
         obrotów łapie przełącznik, który po kliknięciu dalej mówi „zwinięty". */
      const user = userEvent.setup();
      let obroty = 0;
      for (;;) {
        const zwiniety = kolumna().querySelector<HTMLElement>('button[aria-expanded="false"]');
        if (!zwiniety) break;
        obroty += 1;
        expect(obroty, `nie da się rozwinąć: ${zwiniety.textContent}`).toBeLessThanOrEqual(20);
        await user.click(zwiniety);
        await waitFor(() => expect(qc.isFetching()).toBe(0));
      }
      /* Pętla musiała coś rozwinąć, inaczej druga połowa testu sprawdza to samo
         co pierwsza. Blok paczki stoi wyłącznie pod rozwiniętym „Zamówieniem". */
      expect(obroty).toBeGreaterThanOrEqual(2);
      expect(within(kolumna()).getByLabelText("Paczka zamówienia")).toBeInTheDocument();
      sprawdzDomy();
      /* Inny zakup klienta stoi RAZ do czytania: w historii wiersza „Klient".
         Lista za „to nie ta paczka?" służy do przepięcia zamówienia, nie do
         czytania, więc liczymy go poza nią. Bez zamówienia rozmowy jest
         odwrotnie: lista stoi otwarta, a historia go nie powtarza
         (`historiaWierszaKlienta`, test-para w `kokpit.test.ts`). */
      const lista = within(kolumna()).queryByRole("region", { name: "Inne zakupy klienta" });
      const pozaLista = (kolumna().textContent ?? "").replace(lista?.textContent ?? "\u0000", "");
      expect(pozaLista.match(/FILTR POWIETRZA/g) ?? []).toHaveLength(innychZakupow);

      expect(zadania.filter((z) => z.metoda !== "GET")).toEqual([]);
    });
});
