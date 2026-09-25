import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DopasowanieKartoteki, KartaTowaru, OfertaRozmowy, PasowaniaTowaru, TrafieniePasowania } from "../api/typy";

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: (twId: number | null) => karta(twId),
  useWskazKartoteke: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
type WiedzaAtrapa = { data: undefined | { potwierdzone: never[]; negatywne: never[]; propozycje: never[]; pasowania: PasowaniaTowaru } };
const wiedza = vi.fn<() => WiedzaAtrapa>(() => ({ data: undefined }));
vi.mock("../api/wiedza", () => ({ useWiedzaTowaru: () => wiedza() }));
vi.mock("../towar/Zdjecie", () => ({ Zdjecie: () => <div data-testid="zdjecie" /> }));
vi.mock("../towar/Powiekszenie", () => ({ Powiekszenie: () => null }));

const { TowarRozmowy } = await import("./TowarRozmowy");

const oferta = (kartoteka: DopasowanieKartoteki): OfertaRozmowy => ({
  externalId: "12096815384", link: null, zrodlo: "wiadomosc", zgodnosc: null, pobrana: null, kartoteka,
});

const PUSTA = { data: undefined, isLoading: false, error: null };

/** Kartoteka jak z Subiekta — testy opisu podmieniają w niej jedno pole. */
const PELNA: KartaTowaru = {
  id: 7701, sym: "NOZ-STIGA-43", name: "Nóż do kosiarki 43 cm", ean: "5901234567890",
  unit: "szt.", locs: ["R12-B3"], mag: { stan: 7, rez: 2, avail: 5 }, magazyny: [],
  identyfikatory: [],
};

describe("towar przy rozmowie", () => {
  it("brak kartoteki niesie POWÓD, nie samo „bez kartoteki”", () => {
    karta.mockReturnValue(PUSTA);
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "brak", twId: null, symbol: null,
      zrodlo: "Oferty jeszcze nie pobrano z Allegro", powod: "oferta_niepobrana",
    })} />);
    expect(screen.getByText(/Oferty jeszcze nie pobrano/)).toBeInTheDocument();
    /* Bez kartoteki nie pytamy Subiekta — nie ma o co. */
    expect(karta).toHaveBeenCalledWith(null);
  });

  it("jedno trafienie po SKU jest powiązaniem: stan od razu, bez „Zatwierdź”, z podpisem źródła", () => {
    /* Decyzja właściciela (0.219.0): sygnatura jeden do jednego łączy sama.
       Do 0.218.0 stał tu przycisk, a stanu nie pobierano przed kliknięciem. */
    karta.mockReturnValue({ isLoading: false, error: null, data: PELNA });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "sku", twId: 7701, symbol: "NOZ-STIGA-43",
      zrodlo: 'SKU oferty „NOZ-STIGA-43"', powod: null,
    })} />);
    expect(karta).toHaveBeenCalledWith(7701);
    expect(screen.queryByRole("button", { name: /Zatwierdź/ })).toBeNull();
    expect(screen.getByText(/SKU oferty/)).toBeInTheDocument();
    /* Liczba „dostępny" stoi od 23 września 2026 WYŁĄCZNIE w paśmie
       odpowiedzi nad zakładkami (`PasmoOdpowiedzi.test.tsx`). Tu zostaje
       proporcja wolne–zarezerwowane, której pasmo nie pokazuje. */
    expect(screen.getByTitle("stan 7: 5 wolnych, 2 w rezerwacji")).toBeInTheDocument();
    expect(screen.queryByText("Dostępny")).toBeNull();
    /* Powiązania po sygnaturze nie da się „zdjąć" — wróciłoby; można wskazać inną. */
    expect(screen.queryByTitle("Zdejmij powiązanie")).toBeNull();
    expect(screen.getByRole("button", { name: /wskaż inną kartotekę/ })).toBeInTheDocument();
  });

  it("propozycja spoza sygnatury dalej czeka na zatwierdzenie", () => {
    karta.mockReturnValue(PUSTA);
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "jedyna_pozycja", twId: 7701, symbol: "NOZ-STIGA-43",
      zrodlo: 'SKU „NOZ-STIGA-43" z jedynej pozycji zamówienia', powod: null,
    })} />);
    expect(screen.getByRole("button", { name: /Zatwierdź/ })).toBeInTheDocument();
    expect(karta).toHaveBeenCalledWith(null);
  });

  /* ── JEDEN RAZ KAŻDY FAKT (23 września 2026) ────────────────────────────
     Zrzut właściciela: nazwa towaru trzy razy w kolumnie, symbol cztery, stan
     i półka dwa. Nazwę, liczbę i półkę mówi pasmo odpowiedzi nad zakładkami —
     pod tym samym warunkiem, pod którym stoi ta sekcja. Test pilnuje, że
     sekcja ich NIE powtarza, a mówi to, czego pasmo nie ma. */
  it("potwierdzona kartoteka nie powtarza pasma: bez nazwy, liczby i półki", () => {
    karta.mockReturnValue({
      isLoading: false, error: null,
      data: {
        id: 7701, sym: "NOZ-STIGA-43", name: "Nóż do kosiarki 43 cm", ean: "5901234567890",
        unit: "szt.", locs: ["R12-B3"],
        mag: { stan: 7, rez: 2, avail: 5 }, magazyny: [],
        identyfikatory: [{ rodzaj: "oem", wartosc: "181004341/0", zrodlo: "opis" },
          { rodzaj: "katalog_obcy", wartosc: "AB-1234", zrodlo: "reczne" }],
      },
    });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43",
      zrodlo: "Wskazane wcześniej przez: A. Lewandowska", powod: null,
    })} />);
    expect(karta).toHaveBeenCalledWith(7701);
    expect(screen.queryByText("Nóż do kosiarki 43 cm")).toBeNull();
    expect(screen.queryByText("R12-B3")).toBeNull();
    expect(screen.queryByText("5")).toBeNull();
    /* Stan i rezerwacje ZOSTAJĄ — od 23 września 2026 jako pasek, z liczbami
       w dymku i dla czytnika ekranu, a nie jako drugie zdanie. */
    expect(screen.getByTitle("stan 7: 5 wolnych, 2 w rezerwacji")).toBeInTheDocument();
    /* Identyfikatory z opisu (E3) — po nich klient pyta, gdy nie zna naszego symbolu. */
    expect(screen.getByText("181004341/0 · AB-1234")).toBeInTheDocument();
    /* Wskazanie człowieka jest podpisane człowiekiem (§4.3). */
    expect(screen.getByText(/A\. Lewandowska/)).toBeInTheDocument();
  });

  /* ── Opis kartoteki (0.198.0) ────────────────────────────────────────────
     `desc` jechał w odpowiedzi `/api/products/:twId` od dawna i nie był
     pokazywany NIGDZIE. A to w nim ta firma trzyma gwinty, wymiary i sekcje
     „Modele:" — czyli odpowiedzi na najczęstsze pytania. Test pilnuje, że
     treść dojechała na ekran; jak długi jest fragment, wolno zmienić. */
  it("opis kartoteki widać przy towarze — tam stoją wymiary i gwinty", () => {
    karta.mockReturnValue({
      isLoading: false, error: null,
      data: { ...PELNA, desc: "Korek wlewu paliwa. Gwint M41 x 1,5. Zamiennik 490425." },
    });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.getByText(/Gwint M41 x 1,5/)).toBeInTheDocument();
  });

  it("pusty opis nie zostawia nagłówka nad niczym", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, desc: "   " } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.queryByText(/Opis kartoteki/)).not.toBeInTheDocument();
  });

  /* Rozwinięcie dostaje przycisk tylko wtedy, gdy jest co rozwijać — inaczej
     kolumna niosłaby martwy odnośnik pod każdym jednozdaniowym opisem. */
  it("krótki opis nie dostaje przycisku rozwijania", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, desc: "Gwint M41." } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.queryByRole("button", { name: /pokaż cały opis/ })).not.toBeInTheDocument();
  });

  /* Rozwinięcie jest stanem komponentu — nie idzie po sieć i nie otwiera
     nowego widoku, bo opis czyta się w biegu, w trakcie pisania odpowiedzi. */
  it("długi opis rozwija się na miejscu, jednym kliknięciem", async () => {
    karta.mockReturnValue({
      isLoading: false, error: null, data: { ...PELNA, desc: "Zamiennik 490425. ".repeat(30) },
    });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    await userEvent.click(screen.getByRole("button", { name: /pokaż cały opis/ }));
    expect(screen.getByRole("button", { name: /zwiń opis/ })).toBeInTheDocument();
  });

  /* Opis to WOLNY TEKST, w którym bywa notatka dla magazynu. Wstawka
     parametrów wybiera pola świadomie, bo szkic idzie do klienta.

     Od 0.404.0 ta sekcja nie ma ŻADNEJ wstawki: parametry przeniosły się do
     pasma odpowiedzi nad zakładkami (`PasmoOdpowiedzi.tsx`), bo przycisk po
     sześciu sekcjach przewijania stał poza zasięgiem wzroku. Test pilnuje
     tego, co pilnował: opisu nie da się wstawić jednym kliknięciem — a teraz
     nie da się stąd wstawić niczego. */
  it("opisu NIE da się wstawić do szkicu jednym kliknięciem", () => {
    karta.mockReturnValue({
      isLoading: false, error: null,
      data: { ...PELNA, desc: "Gwint M41 x 1,5. UWAGA: ostatnia sztuka z reklamacji." },
    });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.queryAllByRole("button", { name: /wstaw|szkic/i })).toHaveLength(0);
  });

  /* ── Pasowania część↔część (0.230.0) ───────────────────────────────────
     Blok jest WYŁĄCZNIE odczytem: przy gaźniku „do tej części pasują", przy
     uszczelce „ta część pasuje do". Trafienie przez zamiennik nosi dopisek,
     bo pewność „prawdopodobne" bez powodu wygląda jak brak dowodu. */
  const trafienie = (n: Partial<TrafieniePasowania> = {}): TrafieniePasowania => ({
    czesc: { twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" },
    doCzego: { twId: 7701, symbol: "NOZ-STIGA-43", nazwa: "Nóż do kosiarki 43 cm" },
    pasowanie: { id: 5, czesc: { twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" },
      doCzego: { twId: 7701, symbol: "NOZ-STIGA-43", nazwa: "Nóż do kosiarki 43 cm" },
      rola: "uszczelka", nazwaRoli: "uszczelka", pozycja: "od strony filtra", polaryzacja: "pasuje",
      powodNegatywny: null, zdaniePowodu: null, stan: "zatwierdzone", zrodlo: "reczne",
      rodzajDowodu: "katalog_dostawcy", nazwaRodzajuDowodu: "katalog dostawcy", dowodTresc: "katalog, str. 12",
      dowodLink: null, komentarz: null, conversationId: null, zastepujeId: null, zaproponowal: "Anna",
      zaproponowanoAt: "2026-09-07T08:00:00Z", rozstrzygnal: "Anna", rozstrzygnietoAt: "2026-09-07T09:00:00Z",
      powodRozstrzygniecia: null, pewnosc: "potwierdzone",
      zdanieZrodla: "uszczelka (od strony filtra) LC170430140-0001 pasuje do NOZ-STIGA-43 — katalog dostawcy, 7.09.2026, Anna" },
    przezZamiennik: null, pewnosc: "potwierdzone",
    zdanie: "uszczelka (od strony filtra) LC170430140-0001 pasuje do NOZ-STIGA-43 — katalog dostawcy, 7.09.2026, Anna",
    ...n,
  });

  it("pasowania z wiedzy stoją przy kartotece z obu stron, przechodnie z dopiskiem", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: PELNA });
    /* `mockReturnValue`, nie `Once`: hook woła się przy każdym renderze. */
    wiedza.mockReturnValue({ data: { potwierdzone: [], negatywne: [], propozycje: [], pasowania: {
      pasujace: [trafienie(), trafienie({
        czesc: { twId: 812, symbol: "06-12038", nazwa: "Uszczelka gaźnika" }, pewnosc: "prawdopodobne",
        przezZamiennik: "LC170430140-0001 podaje 06-12038 jako zamiennik w opisie",
        zdanie: "06-12038 to zamiennik LC170430140-0001, która pasuje do NOZ-STIGA-43 — prawdopodobne",
      })],
      pasujeDo: [trafienie({
        czesc: { twId: 7701, symbol: "NOZ-STIGA-43", nazwa: "Nóż do kosiarki 43 cm" },
        doCzego: { twId: 900, symbol: "W09-0211", nazwa: "Gaźnik GX160" },
        zdanie: "NOZ-STIGA-43 pasuje do W09-0211 — katalog dostawcy",
      })],
      negatywne: [], propozycje: [],
    } } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.getByText("Do tej części pasują")).toBeInTheDocument();
    expect(screen.getByText("LC170430140-0001")).toBeInTheDocument();
    expect(screen.getByText("06-12038")).toBeInTheDocument();
    expect(screen.getByText("przez zamiennik")).toBeInTheDocument();
    expect(screen.getByText("Ta część pasuje do")).toBeInTheDocument();
    expect(screen.getByText("W09-0211")).toBeInTheDocument();
    /* Odczyt, nie edycja: dopisuje się w Doborze albo w Wiedza → Sprawdź kartotekę. */
    expect(screen.queryByRole("button", { name: /Zaproponuj pasowanie/ })).toBeNull();
  });

  it("bez pasowań blok wiedzy nie zajmuje kolumny", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: PELNA });
    wiedza.mockReturnValue({ data: { potwierdzone: [], negatywne: [], propozycje: [],
      pasowania: { pasujace: [], pasujeDo: [], negatywne: [], propozycje: [] } } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.queryByText(/pasowania części/i)).toBeNull();
  });

  /* Zamienniki jechały w JSON-ie od dawna i rysował je tylko kolektor. Agent,
     który widzi kandydata „przez zamiennik EX055", musi mieć skąd ten EX055 wziąć. */
  it("zamienniki z opisu widać w tabeli: nasze symbolem, obce licznikiem", () => {
    wiedza.mockReturnValue({ data: undefined });
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA,
      zamienniki: { znane: [{ id: 5, sym: "EX055", name: "Gaźnik" }, { id: 6, sym: "10-02001", name: "Gaźnik" }], obce: ["16100-ZH8-W61", "520070"] } } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.getByText("EX055 · 10-02001 (+2 numery obce w opisie)")).toBeInTheDocument();
  });

  it("każdy fakt magazynowy jest podpisany źródłem", () => {
    karta.mockReturnValue(PUSTA);
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "brak", twId: null, symbol: null, zrodlo: "Oferta bez SKU", powod: "oferta_bez_sku",
    })} />);
    expect(screen.getByText(/Subiekt GT/)).toBeInTheDocument();
  });
});

/* ── Ceny z kartoteki Subiekta (0.396.0) ─────────────────────────────────────
   Zgłoszenie właściciela: „nie widzę cen z Subiekta przy towarach". Kolumna
   mówiła CZY MAMY i GDZIE, a na „ile to kosztuje" agent musiał otwierać
   Subiekta — czyli robić to, czego §25 zabrania.                             */
describe("ceny kartoteki", () => {
  const zKartoteka = (ceny: KartaTowaru["ceny"]) => {
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, ceny } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "sku", twId: 7701, symbol: "NOZ-STIGA-43",
      zrodlo: 'SKU oferty „NOZ-STIGA-43"', powod: null,
    })} />);
  };

  it("pokazuje WSZYSTKIE poziomy, brutto grubo i netto obok", () => {
    /* Decyzja właściciela: wszystkie poziomy, nie jeden wybrany. Brutto to
       kwota, którą agent przepisuje klientowi detalicznemu; netto stoi obok
       dla firmy proszącej o fakturę, żeby nie liczyć w głowie. */
    zKartoteka([
      { poziom: 1, nazwa: "Detaliczna", nettoGrosze: 4062, bruttoGrosze: 4996, waluta: "PLN" },
      { poziom: 2, nazwa: "Hurtowa", nettoGrosze: 3577, bruttoGrosze: 4400, waluta: "PLN" },
    ]);
    expect(screen.getByText("Detaliczna")).toBeInTheDocument();
    expect(screen.getByText("Hurtowa")).toBeInTheDocument();
    expect(screen.getByText("49,96 PLN")).toBeInTheDocument();
    expect(screen.getByText("netto 40,62 PLN")).toBeInTheDocument();
  });

  it("poziom BEZ NAZWY dostaje numer, a nie wymyśloną nazwę", () => {
    /* Wymyślona nazwa byłaby gorsza od numeru: agent uwierzyłby, że to
       detaliczna, i podał klientowi cenę hurtową. */
    zKartoteka([{ poziom: 4, nazwa: "", nettoGrosze: 7317, bruttoGrosze: 9000, waluta: "PLN" }]);
    expect(screen.getByText("poziom 4")).toBeInTheDocument();
  });

  it("BEZ CEN nie rysuje pustego bloku", () => {
    /* Ta sama zasada, co przy pasowaniach: brak wiedzy nie jest informacją
       wartą kolumny. Tak wygląda dziś każdy towar na produkcji, dopóki import
       nie dostanie nazw cennika. */
    zKartoteka([]);
    expect(screen.queryByText(/Ceny . Subiekt GT/)).toBeNull();
  });

  it("ZERO BRUTTO to brak ceny, a nie najgłośniejsza liczba bloku (0.412.0)", () => {
    /* Poziom zakupu Subiekt wypełnia wyłącznie po stronie netto, a drugą
       stronę pary zostawia zerem. Do 0.411.0 wiersz krzyczał więc `0,00 PLN`
       grubym drukiem i wyciszał jedyną prawdziwą liczbę jako „netto" — przy
       triażu reklamacji, gdzie właśnie ta liczba rozstrzyga. */
    zKartoteka([{ poziom: 0, nazwa: "", nettoGrosze: 1864, bruttoGrosze: 0, waluta: "PLN" }]);
    expect(screen.getByText("18,64 PLN")).toBeInTheDocument();
    expect(screen.queryByText(/0,00/)).toBeNull();
    expect(screen.getByText(/bez ceny brutto/)).toBeInTheDocument();
  });

  it("brak kwoty pokazuje się jako BRAK, nigdy jako zero", () => {
    /* Zero znaczyłoby „za darmo" i agent podałby je klientowi. */
    zKartoteka([
      { poziom: 1, nazwa: "Detaliczna", nettoGrosze: null, bruttoGrosze: 4996, waluta: "PLN" },
    ]);
    expect(screen.getByText("netto —")).toBeInTheDocument();
    expect(screen.queryByText(/netto 0,00/)).toBeNull();
  });
});

/* ── Ceny równe co do grosza sklejone (23 września 2026) ─────────────────────
   Zrzut właściciela: sześć poziomów, pięć takich samych. Grupa zachowuje
   kolejność Subiekta i nie gubi nazw — stoją w dymku. */
describe("grupowanie cen", () => {
  it("skleja równe poziomy, a różny zostawia osobno", async () => {
    const { grupujCeny } = await import("./TowarRozmowy");
    const c = (poziom: number, nazwa: string, brutto: number | null, netto: number) =>
      ({ poziom, nazwa, bruttoGrosze: brutto, nettoGrosze: netto, waluta: "PLN" });
    const g = grupujCeny([c(0, "", null, 622), c(1, "Detaliczna", 765, 622),
      c(2, "Hurtowa", 765, 622), c(3, "Specjalna", 765, 622)]);
    expect(g.map((x) => x.nazwy)).toEqual([["poziom 0"], ["Detaliczna", "Hurtowa", "Specjalna"]]);
  });
});

/* ── Cena oferty na osi poziomów kartoteki (@wydanie) ────────────────────────
   Nagranie właściciela: oferta 45,00 zł przy detalicznej 29,06 zł, a tabela
   tego nie mówiła. Zdanie ma nazwać kierunek i skalę rozjazdu, a poziom bez
   ceny brutto (zakupowy) nie może udawać najniższej ceny. */
describe("położenie ceny oferty", () => {
  const c = (poziom: number, nazwa: string, brutto: number | null, netto: number) =>
    ({ poziom, nazwa, bruttoGrosze: brutto, nettoGrosze: netto, waluta: "PLN" });
  const kartoteka = [c(0, "", 0, 1969), c(1, "Detaliczna", 2906, 2363), c(6, "Serwisanci", 3149, 2560),
    c(5, "Bazowa", 2422, 1969)];

  it("nad najwyższym poziomem — z procentem i nazwą poziomu", async () => {
    const { polozenieOferty } = await import("./TowarRozmowy");
    const p = polozenieOferty(kartoteka, { grosze: 4500, waluta: "PLN" });
    expect(p?.zdanie).toMatch(/43% nad najwyższym poziomem \(Serwisanci 31,49/);
    /* Poziom zakupowy (brutto 0) nie wchodzi na oś: zero to brak, nie cena. */
    expect(p?.min).toBe(2422);
    expect(p?.max).toBe(4500);
  });

  it("pod najniższym i pomiędzy poziomami", async () => {
    const { polozenieOferty } = await import("./TowarRozmowy");
    expect(polozenieOferty(kartoteka, { grosze: 2000, waluta: "PLN" })?.zdanie)
      .toMatch(/17% pod najniższym poziomem \(Bazowa 24,22/);
    expect(polozenieOferty(kartoteka, { grosze: 3000, waluta: "PLN" })?.zdanie)
      .toMatch(/mieści się między poziomami/);
  });

  it("bez poziomu brutto w tej walucie nie ma osi", async () => {
    const { polozenieOferty } = await import("./TowarRozmowy");
    expect(polozenieOferty([c(0, "", 0, 1969)], { grosze: 4500, waluta: "PLN" })).toBeNull();
    expect(polozenieOferty(kartoteka, { grosze: 4500, waluta: "EUR" })).toBeNull();
  });
});
