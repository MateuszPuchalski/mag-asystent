import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CenaPoziomu, DopasowanieKartoteki, KartaTowaru, OfertaRozmowy } from "../api/typy";
import { atrapaZapisow } from "../test/zapisy";
import { naruszeniaWcag } from "../test/dostepnosc";

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: (twId: number | null) => karta(twId),
  useWskazKartoteke: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock("../towar/Zdjecie", () => ({ Zdjecie: () => <div data-testid="zdjecie" /> }));
vi.mock("../towar/Powiekszenie", () => ({ Powiekszenie: () => null }));

const { TowarRozmowy, zrodloKartoteki } = await import("./TowarRozmowy");

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

  /* Opis krótszy od progu znaków bywał obcięty i tak: zawinięta linia
     zjadała szóstą, a wielokropek urywał moment dokręcenia bez przycisku. */
  it("sześć linii poniżej progu znaków też dostaje przycisk rozwijania", () => {
    const desc = ["Nóż tnący 53 cm.", "Otwór 5/8\".", "Gwint M41.", "Pasuje bez podkładki dystansowej.",
      "Hartowany.", "Montaż: śruba 5/8\" momentem 60 Nm."].join("\n");
    expect(desc.length).toBeLessThan(320);
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, desc } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.getByRole("button", { name: /pokaż cały opis/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("krótki opis obcięty w wąskiej kolumnie dostaje przycisk — rozstrzyga pomiar przeglądarki", () => {
    /* jsdom nie liczy układu, więc wysokości podstawiamy: treść wyższa niż
       sześć linii, które widać. */
    const wys = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(160);
    const widac = vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(120);
    try {
      karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, desc: "Gwint M41 x 1,5. Pasuje bez podkładki." } });
      render(<TowarRozmowy rozmowaId={1} oferta={oferta({
        pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
      })} />);
      expect(screen.getByRole("button", { name: /pokaż cały opis/ })).toBeInTheDocument();
    } finally {
      wys.mockRestore();
      widac.mockRestore();
    }
  });

  /* SKU oferty stoi w paśmie przy „Zamówił" i w karcie zakupu. Podpis źródła
     mówi więc samą regułę, a pełne zdanie serwera zostaje w dymku. */
  it("podpis źródła po SKU nie powtarza samego SKU; zdanie z dopiskiem stoi w całości", () => {
    expect(zrodloKartoteki({ pewnosc: "sku", zrodlo: 'SKU oferty „NOZ-STIGA-43"' }, "NOZ-STIGA-43"))
      .toBe("SKU oferty = symbol kartoteki");
    const zDopiskiem = 'SKU oferty „NOZ-STIGA-43" — sygnatura zmieniła się z „NOZ-43”, dawne wskazanie (Ola) nie obowiązuje';
    expect(zrodloKartoteki({ pewnosc: "sku", zrodlo: zDopiskiem }, "NOZ-STIGA-43")).toBe(zDopiskiem);
    expect(zrodloKartoteki({ pewnosc: "pamiec", zrodlo: "Wskazane wcześniej przez: Ola" }, "X"))
      .toBe("Wskazane wcześniej przez: Ola");
    expect(zrodloKartoteki({ pewnosc: "sku", zrodlo: 'SKU oferty „A"' }, null)).toBe('SKU oferty „A"');
  });

  /* Bez treści oferty serwer dopasowuje kartotekę po SKU pozycji zamówienia
     i pisze to samo zdanie. To SKU stoi w paśmie przy „Zamówił", więc podpis
     skraca się tak samo jak przy SKU oferty. */
  it("bez treści oferty podpis źródła skraca się po SKU pozycji zamówienia", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: PELNA });
    render(<TowarRozmowy rozmowaId={1} skuPozycji="NOZ-STIGA-43" oferta={oferta({
      pewnosc: "sku", twId: 7701, symbol: "NOZ-STIGA-43",
      zrodlo: 'SKU oferty „NOZ-STIGA-43"', powod: null,
    })} />);
    expect(screen.getByText("SKU oferty = symbol kartoteki")).toBeInTheDocument();
  });

  /* Brak połączenia ogłasza pasek pod nagłówkiem, a pasmo mówi przy nim
     „nie wiemy". Blok Subiektu nie dokłada trzeciego, czerwonego zapisu. */
  it("brak połączenia nie daje czerwonego komunikatu w bloku Subiektu; inny błąd — daje", async () => {
    const { BrakPolaczenia } = await import("../api/klient");
    const k = oferta({ pewnosc: "sku", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "SKU", powod: null });
    karta.mockReturnValue({ isLoading: false, error: new BrakPolaczenia(), data: undefined });
    const { unmount } = render(<TowarRozmowy rozmowaId={1} oferta={k} />);
    expect(screen.queryByText("Brak połączenia z serwerem.")).toBeNull();
    unmount();
    karta.mockReturnValue({ isLoading: false, error: new Error("Nie znaleziono towaru"), data: undefined });
    render(<TowarRozmowy rozmowaId={1} oferta={k} />);
    expect(screen.getByText("Nie znaleziono towaru")).toHaveClass("text-ranga-zle");
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

  /* Zamienniki jechały w JSON-ie od dawna i rysował je tylko kolektor. Agent
     pytany o zamiennik musi mieć skąd go wziąć bez Subiekta. */
  it("zamienniki z opisu widać w tabeli: nasze symbolem, obce licznikiem", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA,
      zamienniki: { znane: [{ id: 5, sym: "EX055", name: "Gaźnik" }, { id: 6, sym: "10-02001", name: "Gaźnik" }], obce: ["16100-ZH8-W61", "520070"] } } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.getByText("EX055 · 10-02001 (+2 numery obce w opisie)")).toBeInTheDocument();
  });

  /* ── Jedna gramatyka kolumny ─────────────────────────────────────────────
     Opis stoi przed cenami, bo w nim są wymiary i gwinty. Pismo nie jest
     większe od tytułu wiersza, a braki stoją jedną linią zamiast obrysów. */
  it("opis kartoteki stoi przed cenami, pismem nie większym od tytułu wiersza", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA,
      desc: "Korek wlewu paliwa. Gwint M41 x 1,5.",
      ceny: [{ poziom: 1, nazwa: "Detaliczna", nettoGrosze: 4062, bruttoGrosze: 4996, waluta: "PLN" }] } });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    const opis = screen.getByText(/Gwint M41/);
    expect(opis.compareDocumentPosition(screen.getByText("Ceny")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(opis).toHaveClass("text-sm");
    expect(opis).not.toHaveClass("text-tresc");
  });

  it("braki stoją jedną linią, bez przerywanych obrysów", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, ean: null } });
    const { container } = render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.getByText(/^brak: EAN · identyfikatory · zamienniki$/)).toBeInTheDocument();
    expect(container.querySelector(".border-dashed")).toBeNull();
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
   Subiekta — czyli robić to, czego §25 zabrania.

   Te testy nie podają ceny oferty (`pobrana: null`), więc blok zostaje
   listą. Bez oferty oś nie ma o co pytać, a reklamacje i rozmowa bez pobranej
   oferty mają widzieć dotychczasową listę z netto. To zarazem strażnik tej
   zasady: oś przy cenie oferty sprawdza `describe` niżej.                    */
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
    /* Brak danych nie jest informacją wartą kolumny. Tak wygląda dziś każdy towar na produkcji, dopóki import
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

/* ── Cena oferty na osi poziomów kartoteki (0.498.0) ────────────────────────
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
    /* Kwotę oferty mówi karta, dymek kropki i nazwa figury — zdanie mówi
       samo położenie. */
    expect(p?.zdanie).not.toContain("45,00");
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

  it("figura niesie kwotę oferty w nazwie dla czytnika ekranu", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, ceny: kartoteka } });
    render(<TowarRozmowy rozmowaId={1} oferta={{ ...oferta({
      pewnosc: "sku", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: 'SKU oferty „NOZ-STIGA-43"', powod: null,
    }), pobrana: { nazwa: "Nóż", sku: "NOZ-STIGA-43", cenaGrosze: 4500, waluta: "PLN", status: "ACTIVE",
      syncedAt: "2026-09-02T14:50:00Z", zdjecie: "brak" } }} />);
    expect(screen.getByRole("figure", { name: /Cena oferty 45,00/ })).toBeInTheDocument();
  });

  it("bez poziomu brutto w tej walucie nie ma osi", async () => {
    const { polozenieOferty } = await import("./TowarRozmowy");
    expect(polozenieOferty([c(0, "", 0, 1969)], { grosze: 4500, waluta: "PLN" })).toBeNull();
    expect(polozenieOferty(kartoteka, { grosze: 4500, waluta: "EUR" })).toBeNull();
  });
});

/* ── Ceny na osi przy cenie oferty ──────────────────────────────────────────
   Zgłoszenie właściciela: blok cen zajmował za dużo miejsca, bo lista, oś
   i zdanie mówiły trzy razy to samo. Z ceną oferty blok staje jedną osią
   z podpisami. jsdom nie liczy układu, więc oś stoi na szerokości zapasowej
   i na szacunku miary. Testy patrzą na treść, dostępność i zachowanie;
   niezmienniki układu pilnuje `cenyNaOsi.test.ts`.                          */
describe("ceny na osi przy cenie oferty", () => {
  const c = (poziom: number, nazwa: string, brutto: number | null, netto: number | null): CenaPoziomu =>
    ({ poziom, nazwa, bruttoGrosze: brutto, nettoGrosze: netto, waluta: "PLN" });
  const DWA = [c(1, "Detaliczna", 4996, 4062), c(2, "Hurtowa", 4400, 3577)];
  const NAZWA_OSI = "Ceny brutto na osi, od najniższej";

  const zOferta = (ceny: CenaPoziomu[], grosze: number) => {
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, ceny } });
    return render(<TowarRozmowy rozmowaId={1} oferta={{ ...oferta({
      pewnosc: "sku", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: 'SKU oferty „NOZ-STIGA-43"', powod: null,
    }), pobrana: { nazwa: "Nóż", sku: "NOZ-STIGA-43", cenaGrosze: grosze, waluta: "PLN", status: "ACTIVE",
      syncedAt: "2026-09-02T14:50:00Z", zdjecie: "brak" } }} />);
  };

  it("każdy poziom brutto ma etykietę z nazwą i kwotą, netto w tekście dla czytnika", () => {
    zOferta(DWA, 4500);
    const os = screen.getByRole("list", { name: NAZWA_OSI });
    expect(within(os).getByText("Detaliczna")).toBeInTheDocument();
    expect(within(os).getByText("49,96")).toBeInTheDocument();
    expect(within(os).getByText(/netto 40,62 PLN/)).toBeInTheDocument();
    expect(within(os).getByText("Hurtowa")).toBeInTheDocument();
    /* Rodzaj ceny i waluta stoją raz, w nagłówku, a nie przy każdej kwocie. */
    expect(screen.getByText(/Ceny brutto · PLN/)).toBeInTheDocument();
  });

  it("etykieta oferty nie powtarza kwoty z karty zakupu", () => {
    /* Kwota oferty ma dom w karcie zakupu (§10.2g). Czytnik ekranu słyszy ją
       w nazwie figury, a wzrok — w dymku pierścienia. */
    zOferta(DWA, 4500);
    expect(within(screen.getByRole("list", { name: NAZWA_OSI })).getByText("oferta")).toBeInTheDocument();
    expect(screen.queryByText(/45,00/)).toBeNull();
    expect(screen.getByRole("figure", { name: /Cena oferty 45,00/ })).toBeInTheDocument();
  });

  it("pokaż tabelę z netto: kolejność Subiekta, pamięć stanowiska, zero zapisu", async () => {
    const zapisy = atrapaZapisow(() => undefined);
    try {
      const ceny = [c(3, "Serwis", 5000, 4065), c(1, "Detaliczna", 6499, 5284), c(2, "Allegro", 6499, 5284),
        c(0, "", 0, 1864)];
      const { unmount } = zOferta(ceny, 6499);
      const przycisk = screen.getByRole("button", { name: /pokaż tabelę z netto/ });
      expect(przycisk).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("table")).toBeNull();

      await userEvent.click(przycisk);
      expect(screen.getByRole("button", { name: /zwiń tabelę/ })).toHaveAttribute("aria-expanded", "true");
      const tabela = screen.getByRole("table", { name: "Ceny kartoteki w kolejności Subiekta" });
      /* Każdy poziom osobno, także dwa o tej samej cenie, które na osi
         dzielą jedną kropkę. */
      expect(within(tabela).getAllByRole("rowheader").map((th) => th.textContent))
        .toEqual(["Serwis", "Detaliczna", "Allegro", "poziom 0"]);
      /* Wybór to nawyk stanowiska, jak zwinięcie w `Zwijka`. */
      expect(localStorage.getItem("wertis.skrzynka.ceny.tabela")).toBe("1");

      unmount();
      zOferta(ceny, 6499);
      expect(screen.getByRole("button", { name: /zwiń tabelę/ })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("table")).toBeInTheDocument();

      /* Pamięć przełącznika siedzi w przeglądarce, nie na serwerze. */
      expect(zapisy.wyslane).toEqual([]);
      expect(zapisy.nieznane).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("poziom bez brutto przy osi: netto grube, »bez ceny brutto«, nigdy 0,00", async () => {
    /* Decyzja właściciela: zero to brak, nie cena. Poziom zakupu nie wchodzi
       na oś brutto, a jedyną prawdziwą liczbą jest jego netto. */
    zOferta([c(0, "", 0, 1864), ...DWA], 4500);
    expect(screen.getByText("18,64 PLN").tagName).toBe("B");
    expect(screen.getByText(/bez ceny brutto/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: NAZWA_OSI })).queryByText(/poziom 0/)).toBeNull();
    expect(screen.queryByText(/0,00/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /pokaż tabelę z netto/ }));
    const wiersz = screen.getByRole("rowheader", { name: "poziom 0" }).closest("tr") as HTMLElement;
    expect(within(wiersz).getByText("brak")).toBeInTheDocument();
    expect(within(wiersz).getByText("18,64")).toHaveClass("font-bold");
  });

  it("fokus etykiety pokazuje dymek z netto, Escape go chowa", async () => {
    zOferta(DWA, 5200);
    const user = userEvent.setup();
    /* Cały wykres to jeden przystanek tabulatora, a wchodzi się na ofertę. */
    for (let i = 0; i < 20 && document.activeElement?.getAttribute("data-id") !== "oferta"; i++) await user.tab();
    expect(document.activeElement).toHaveAttribute("data-id", "oferta");
    const dymek = () => document.querySelector<HTMLElement>("[data-dymek]");
    expect(dymek()).toHaveTextContent("oferta Allegro");
    expect(dymek()).toHaveTextContent("52,00 PLN");
    /* Dymek powtarza etykietę, więc czytnik go nie czyta drugi raz. */
    expect(dymek()).toHaveAttribute("aria-hidden", "true");

    /* Strzałka zostaje w wykresie. Kolejka skrzynki słucha strzałek na
       `window` i przerzuciłaby rozmowę spod ręki agenta. */
    const naOknie = vi.fn();
    window.addEventListener("keydown", naOknie);
    try {
      await user.keyboard("{ArrowLeft}");
    } finally {
      window.removeEventListener("keydown", naOknie);
    }
    expect(naOknie).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveAttribute("data-id", "p1");
    expect(dymek()).toHaveTextContent(/netto 40,62 PLN/);

    await user.keyboard("{Escape}");
    expect(dymek()).toBeNull();
    expect(document.activeElement).toHaveAttribute("data-id", "p1");
    const etykiety = within(screen.getByRole("list", { name: NAZWA_OSI })).getAllByRole("listitem");
    expect(etykiety.filter((li) => li.tabIndex === 0)).toHaveLength(1);
  });

  it("oferta równa poziomowi: zdanie równości, bez kwoty", () => {
    zOferta([c(1, "Detaliczna", 4996, 4062)], 4996);
    expect(screen.getByText("Oferta równa poziomowi Detaliczna.")).toBeInTheDocument();
  });

  const dymek = () => document.querySelector<HTMLElement>("[data-dymek]");
  /** Pas wykresu: element, który łapie wskaźnik i niesie dymek. */
  const pasWykresu = () => screen.getByRole("list", { name: NAZWA_OSI }).parentElement as HTMLElement;

  it("kropka poziomu tuż przy ofercie leży nad pierścieniem, a ogonki nad każdą bielą", () => {
    /* Detaliczna 49,51 przy ofercie 49,75 stoi kilka pikseli od pierścienia.
       Biała otoczka oferty malowana po niej zjadała kropkę i ogonek, a jej
       etykieta wisiała pod pustym pierścieniem, wbrew zdaniu pod osią. */
    zOferta([c(1, "Detaliczna", 4951, 4025), c(2, "Hurtowa", 3795, 3085), c(4, "Bazowa", 3300, 2683)], 4975);
    const warstwy = [...(document.querySelector("figure svg") as SVGSVGElement).children];
    const gdzie = (sel: string) => warstwy.findIndex((el) => el.matches(sel));
    const ostatniaBiel = Math.max(...warstwy.map((el, i) => (el.classList.contains("fill-white") ? i : -1)));
    expect(gdzie('[data-znacznik="p1"]')).toBeGreaterThan(gdzie('[data-znacznik="oferta"]'));
    expect(gdzie('[data-znacznik="p1"]')).toBeGreaterThan(ostatniaBiel);
    const ogonki = warstwy.flatMap((el, i) => (el.hasAttribute("data-ogonek") ? [i] : []));
    expect(ogonki).toHaveLength(4);
    expect(Math.min(...ogonki)).toBeGreaterThan(ostatniaBiel);
  });

  it("dymek nie jest szerszy od bloku, a długie nazwy grupy łamią się w nim", async () => {
    /* Zrzut właściciela: pięć poziomów po 49,51. Wszystkie nazwy w jednej
       linii dawały dymek szerszy od kolumny 256 px i poziomy przewijak. */
    zOferta([c(1, "Detaliczna", 4951, 4025), c(2, "Hurtowa", 4951, 4025), c(3, "Specjalna", 4951, 4025),
      c(4, "Serwisanci", 4951, 4025), c(5, "Allegro", 4951, 4025), c(6, "Bazowa", 3300, 2683)], 5405);
    const user = userEvent.setup();
    for (let i = 0; i < 20 && document.activeElement?.getAttribute("data-id") !== "oferta"; i++) await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(dymek()).toHaveTextContent(/Detaliczna, Hurtowa, Specjalna, Serwisanci, Allegro/);
    expect(dymek()).toHaveClass("w-max");
    /* Szerokość zapasowa jsdom: treść kolumny 384 px. */
    expect(dymek()?.style.maxWidth).toBe("350px");
  });

  it("klik w kwotę nie przypina dymka, a strzałki zostają kolejki", async () => {
    /* Agent klika kwotę, żeby ją zaznaczyć i przepisać, i jedzie myszą do
       pola odpowiedzi. Dymek przypięty fokusem z kliknięcia zasłaniał zdanie,
       a strzałka w dół chodziła po etykietach zamiast po rozmowach. */
    zOferta(DWA, 5200);
    const user = userEvent.setup();
    const hurtowa = within(screen.getByRole("list", { name: NAZWA_OSI })).getByText("Hurtowa").closest("li") as HTMLElement;
    await user.click(hurtowa);
    expect(document.activeElement).toBe(hurtowa);
    fireEvent.pointerLeave(pasWykresu());
    expect(dymek()).toBeNull();

    const naOknie = vi.fn();
    window.addEventListener("keydown", naOknie);
    try {
      await user.keyboard("{ArrowDown}");
    } finally {
      window.removeEventListener("keydown", naOknie);
    }
    expect(naOknie).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(hurtowa);
  });

  it("dymek z najechania da się najechać i zamknąć Escape z pola odpowiedzi", async () => {
    /* WCAG 1.4.13: dymek zasłania zdanie, więc kursor może na niego wjechać,
       a Escape chowa go bez ruszania myszą i fokusem. */
    zOferta(DWA, 5200);
    const user = userEvent.setup();
    const pole = document.createElement("textarea");
    document.body.appendChild(pole);
    pole.focus();
    const naOknie = vi.fn();
    window.addEventListener("keydown", naOknie);
    try {
      /* Daleko w prawo nie ma etykiety, więc trafia najbliższy znacznik: oferta. */
      fireEvent.pointerMove(pasWykresu(), { clientX: 1000, clientY: 0 });
      expect(dymek()).toHaveTextContent("oferta Allegro");
      /* Kursor na dymku nie przelicza celu, więc treść stoi w miejscu. */
      fireEvent.pointerMove(dymek() as HTMLElement, { clientX: 0, clientY: 500 });
      expect(dymek()).toHaveTextContent("oferta Allegro");

      await user.keyboard("{Escape}");
      expect(dymek()).toBeNull();
      expect(document.activeElement).toBe(pole);
      /* Escape, który schował dymek, nie idzie dalej. Następny już tak. */
      expect(naOknie).not.toHaveBeenCalled();
      await user.keyboard("{Escape}");
      expect(naOknie).toHaveBeenCalledTimes(1);

      /* Ten sam cel nie wraca sam; nowy cel pokazuje dymek znowu. */
      fireEvent.pointerMove(pasWykresu(), { clientX: 1000, clientY: 0 });
      expect(dymek()).toBeNull();
      fireEvent.pointerMove(pasWykresu(), { clientX: 0, clientY: 0 });
      expect(dymek()).toHaveTextContent(/netto/);
      fireEvent.pointerLeave(pasWykresu());
      expect(dymek()).toBeNull();
    } finally {
      window.removeEventListener("keydown", naOknie);
      pole.remove();
    }
  });

  it("dymek staje nad wykresem, gdy pod nim kończy się widok", () => {
    /* Przy dole przewijanej kolumny przewijak ucinał drugą linię dymka, czyli
       netto i nazwy. jsdom nie liczy układu, więc położenie podajemy sami:
       wykres 700 px od góry okna wysokiego na 768 px. */
    const prostokat = (top: number, height: number) =>
      ({ x: 0, y: top, top, left: 0, bottom: top + height, right: 350, width: 350, height, toJSON: () => ({}) }) as DOMRect;
    const pomiar = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-dymek")) return prostokat(0, 40);
      if (this.querySelector(":scope > ul")) return prostokat(700, 48);
      return prostokat(0, 0);
    });
    try {
      zOferta(DWA, 5200);
      fireEvent.pointerMove(pasWykresu(), { clientX: 1000, clientY: 0 });
      expect(dymek()).toHaveClass("pb-1");
      expect(dymek()?.style.top).toBe("");
      expect(dymek()?.style.bottom).not.toBe("");
    } finally {
      pomiar.mockRestore();
    }
  });

  it("napis szerszy od policzonego miejsca: lista, nie nachodzące napisy", () => {
    /* Większe pismo przeglądarki powiększa kwotę, a układ liczył ją w 12 px.
       Etykieta wychodziłaby na sąsiada, więc blok staje dotychczasową listą. */
    const szerokosc = vi.spyOn(Element.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: Element) { return this.tagName === "LI" ? 500 : 0; });
    try {
      zOferta(DWA, 4500);
      expect(screen.queryByRole("list", { name: NAZWA_OSI })).toBeNull();
      expect(screen.queryByRole("button", { name: /pokaż tabelę z netto/ })).toBeNull();
      const figura = screen.getByRole("figure", { name: /Cena oferty 45,00/ });
      expect(within(figura).getByText("49,96 PLN")).toBeInTheDocument();
      expect(within(figura).getByText("Oferta mieści się między poziomami kartoteki.")).toBeInTheDocument();
    } finally {
      szerokosc.mockRestore();
    }
  });

  it("WCAG 2.2 A i AA w strukturze: spoczynek, dymek, tabela i lista awaryjna", async () => {
    /* Strażnik axe biegnie po testach `ekrany/` i `druk/`, a żaden z nich nie
       renderuje osi. Bez tego testu zgubiona nazwa listy albo `aria-controls`
       w próżnię przeszłyby CI. */
    const { unmount } = zOferta([c(0, "", 0, 1864), ...DWA], 5200);
    expect(await naruszeniaWcag()).toBe("");
    const user = userEvent.setup();
    for (let i = 0; i < 20 && document.activeElement?.getAttribute("data-id") !== "oferta"; i++) await user.tab();
    expect(dymek()).not.toBeNull();
    expect(await naruszeniaWcag()).toBe("");
    await user.click(screen.getByRole("button", { name: /pokaż tabelę z netto/ }));
    expect(await naruszeniaWcag()).toBe("");
    unmount();

    const szerokosc = vi.spyOn(Element.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: Element) { return this.tagName === "LI" ? 500 : 0; });
    try {
      zOferta([c(0, "", 0, 1864), ...DWA], 5200);
      expect(screen.queryByRole("list", { name: NAZWA_OSI })).toBeNull();
      expect(await naruszeniaWcag()).toBe("");
    } finally {
      szerokosc.mockRestore();
    }
  });
});
