import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";

/* ── Triaż reklamacji: czy mamy i ile nas kosztuje (0.412.0) ─────────────────
   Zgłoszenie właściciela ze zrzutem: „potrzebujemy wyraźnej hierarchii, żeby
   podjąć decyzję o reklamacji". Kolumna dowodów niosła sześć równorzędnych
   poziomów cen (0.411.0) i ani jednej sztuki stanu — przy sprawie, w której
   klient żąda WYMIANY.

   Testy pilnują TEGO, co rozstrzyga decyzję, a nie wyglądu pasma:

   1. STAN JEST NA EKRANIE. Przy żądaniu wymiany to jest cała decyzja, a do
      tego wydania reklamacja nie miała tej liczby nigdzie — skrzynka ma ją
      od 0.404.0.
   2. CENA ZAKUPU TO POZIOM 0, nie „najtańszy wiersz z listy". Najtańszy
      cennik sprzedaży to nadal sprzedaż, a pomyłka w tę stronę każe odrzucić
      reklamację, którą opłacało się uznać.
   3. BRAK KARTOTEKI MÓWI O SOBIE WPROST — pusty slot po stanie czytałby się
      jak „nie mamy" (dekalog obsługi, punkt 10).
   4. NIC SIĘ NIE ODEJMUJE. Zapłacone jest brutto, zakup netto; różnica tych
      dwóch nie jest marżą, a stawki VAT ten ładunek nie niesie.            */

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({ useKartaTowaru: (twId: number | null) => karta(twId) }));

const { Dowody } = await import("./Dowody");

const CENY = [
  { poziom: 0, nazwa: "", nettoGrosze: 1864, bruttoGrosze: 0, waluta: "PLN" },
  { poziom: 1, nazwa: "Detaliczna", nettoGrosze: 2423, bruttoGrosze: 2980, waluta: "PLN" },
  { poziom: 2, nazwa: "Hurtowa", nettoGrosze: 1864, bruttoGrosze: 2293, waluta: "PLN" },
];

const KARTA = {
  id: 11, sym: "14-31051", name: "NÓŻ do kosiarki 46 cm", unit: "szt.",
  locs: ["D02-01-04"], mag: { stan: 7, rez: 0, avail: 7 }, magazyny: [], ceny: CENY,
};

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 5, externalId: "i-5", numer: "2862647/2026", orderId: "ord-5", offerId: "of-1",
  kupujacyLogin: "ekk69", prawo: "COMPLAINT", powodTyp: null, powodOpis: null,
  temat: null, opis: null, oczekiwanie: "EXCHANGE", oczekiwanaKwotaGrosze: null,
  waluta: "PLN", statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null,
  poTerminie: false, zwrotWymagany: false, czatAktywny: true, wiadomosciIle: 2,
  czatUrwany: false, ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-12T10:11:00.000Z",
  kupionoAt: "2026-09-10T10:00:00.000Z", kupionoZrodlo: "zamowienie", dniOdZakupu: null,
  prowadzi: null, prowadziId: null, prowadziAt: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, notatka: null,
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null,
  linkOferty: null, ofertaNazwa: "NÓŻ do kosiarki 46 cm", ofertaZdjecie: "brak",
  twId: 11, twSymbol: "14-31051", twZParagonu: true, ...n,
} as unknown as Reklamacja);

const props = (n: Partial<Reklamacja> = {}, zPozycja = true,
  historia: SzczegolReklamacji["historia"] = { towar: null, klient: null }) => ({
  szczegol: {
    reklamacja: rek(n), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
    droga: [], kartoteka: null, karta: null, przesylka: null, historia,
    zamowienie: zPozycja ? {
      sumaGrosze: 5990, dostawaGrosze: 1000, waluta: "PLN", dostawaMetoda: "DPD",
      kupionoAt: null,
      pozycje: [{ offerId: "of-1", sku: "14-31051", nazwa: "NÓŻ 46 cm", ilosc: 1,
        cenaGrosze: 4990, waluta: "PLN" }],
    } : null,
  } as unknown as SzczegolReklamacji,
  trwa: false, bladZapisu: "", onNotatka: vi.fn(),
});

beforeEach(() => {
  karta.mockReset();
  karta.mockReturnValue({ data: KARTA, isLoading: false, error: null });
});

describe("Triaż w kolumnie dowodów", () => {
  it("mówi, CZY MAMY — stan i półkę, bez otwierania czegokolwiek", () => {
    /* Żadnego kliknięcia przed tą asercją i to jest cały jej sens: przy
       żądaniu wymiany ta liczba rozstrzyga sprawę. */
    render(<Dowody {...props()} />);
    expect(screen.getByText("7 szt.")).toBeInTheDocument();
    expect(screen.getByText("D02-01-04")).toBeInTheDocument();
  });

  it("BRAK NA STANIE mówi o sobie wprost — to zmienia decyzję, nie tylko liczbę", () => {
    karta.mockReturnValue({ data: { ...KARTA, mag: { stan: 0, rez: 0, avail: 0 } },
      isLoading: false, error: null });
    render(<Dowody {...props()} />);
    expect(screen.getByText("brak na stanie")).toBeInTheDocument();
  });

  it("bez kartoteki mówi „nie wiadomo”, a nie zero — punkt 10 dekalogu", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Dowody {...props({ twId: null })} />);
    expect(screen.getByText("nie wiadomo")).toBeInTheDocument();
    expect(screen.getByText(/sprawa bez kartoteki/)).toBeInTheDocument();
  });

  it("KOSZT bierze z poziomu 0, bo to cena zakupu — nie z najtańszej sprzedaży", () => {
    /* Poziom 2 („Hurtowa") ma to samo netto co zakup, ale znaczy co innego.
       Bierzemy poziom 0, bo tak numeruje kolumny `tw_Cena`, a nie dlatego,
       że jakaś liczba wygląda na najniższą. */
    render(<Dowody {...props()} />);
    const kostka = screen.getByText("Nasz zakup").parentElement!;
    expect(kostka.textContent).toContain("18,64 PLN");
    expect(kostka.textContent).toContain("netto");
  });

  it("stawia obok kwotę Z PARAGONU i nie odejmuje jednej od drugiej", () => {
    /* Zapłacone jest brutto, zakup netto. Wyliczona z nich „marża" byłaby
       nieprawdą z dokładnością do stawki VAT, której ten ładunek nie niesie. */
    render(<Dowody {...props()} />);
    const kostka = screen.getByText("Klient zapłacił").parentElement!;
    expect(kostka.textContent).toContain("49,90 PLN");
    expect(screen.queryByText(/marż/i)).not.toBeInTheDocument();
  });

  it("poziom zakupu NIE wchodzi drugi raz do listy pozostałych cen", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByText("Detaliczna")).toBeInTheDocument();
    expect(screen.getByText("Hurtowa")).toBeInTheDocument();
    expect(screen.queryByText("poziom 0")).not.toBeInTheDocument();
  });

  it("bez jednej i drugiej wiedzy nie rysuje się WCALE — pasek bez treści to koszt", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    const { container } = render(<Dowody {...props({ twId: 11 }, false)} />);
    expect(container.textContent).not.toContain("Nasz zakup");
    expect(container.textContent).not.toContain("Mamy");
  });
});

describe("Wiek zakupu w triażu (0.413.0)", () => {
  /* Ta sama zamiana, co przy terminie decyzji w 0.121.0: pytanie brzmi „ile to
     już leży", nie „który to był dzień". Przy rękojmi liczba dni jest
     argumentem, a agent nie ma jej odejmować w głowie. */
  it("do dwóch miesięcy liczy DNI — przy „uszkodzone w transporcie” to cała sprawa", () => {
    render(<Dowody {...props({ dniOdZakupu: 4 })} />);
    expect(screen.getByText("4 dni temu")).toBeInTheDocument();
  });

  it("dalej liczy MIESIĄCE, bo nikt nie liczy czterystu dni w głowie", () => {
    render(<Dowody {...props({ dniOdZakupu: 430 })} />);
    expect(screen.getByText("14 miesięcy temu")).toBeInTheDocument();
  });

  it("powyżej dwóch lat mówi w LATACH i zmienia kolor, ale nie wydaje wyroku", () => {
    /* Bursztyn, nie czerwień: rękojmia biegnie dwa lata od WYDANIA rzeczy,
       a nasz zegar startuje od zamówienia albo od złożenia koszyka — obie daty
       są wcześniejsze. Kostka podaje WIEK i źródło zegara; wyroku „po
       rękojmi" nie wydaje, bo nie ma z czego. */
    render(<Dowody {...props({ dniOdZakupu: 900 })} />);
    const wartosc = screen.getByText("2 lata temu");
    expect(wartosc.className).toContain("text-ranga-uwaga");
    expect(screen.getByText("data z zamówienia")).toBeInTheDocument();
  });

  it("mówi, KTÓRY to zegar — dwie daty pod jedną etykietą to blizna 0.121.0", () => {
    render(<Dowody {...props({ dniOdZakupu: 30, kupionoZrodlo: "sprawa" })} />);
    expect(screen.getByText("data z ładunku sprawy")).toBeInTheDocument();
  });

  it("bez daty zakupu kostka nie staje wcale — brak wiedzy to nie „dziś”", () => {
    render(<Dowody {...props({ dniOdZakupu: null })} />);
    expect(screen.queryByText("Kupione")).not.toBeInTheDocument();
  });
});

describe("Ilość objęta sprawą (0.413.0)", () => {
  /* `offer.quantity` leżało w ładunku od przyrostu trzeciego i nie było go na
     ekranie ANI RAZU. „Mamy 2 szt." przy sprawie o trzy sztuki wygląda jak
     dobra wiadomość i nią nie jest. */
  it("stan czyta się PRZECIW żądaniu — dwie sztuki przy sprawie o trzy to za mało", () => {
    karta.mockReturnValue({ data: { ...KARTA, mag: { stan: 2, rez: 0, avail: 2 } },
      isLoading: false, error: null });
    render(<Dowody {...props({ ilosc: 3 })} />);
    expect(screen.getByText("sprawa o 3 szt. · D02-01-04")).toBeInTheDocument();
    expect(screen.getByText("2 szt.").className).toContain("text-ranga-zle");
  });

  it("starczy na całą sprawę — ta sama liczba czyta się wtedy inaczej", () => {
    render(<Dowody {...props({ ilosc: 3 })} />);
    expect(screen.getByText("7 szt.").className).toContain("text-ranga-ok");
  });

  it("jedna sztuka nie dokłada zdania — to domyślny przypadek", () => {
    render(<Dowody {...props({ ilosc: 1 })} />);
    expect(screen.queryByText(/sprawa o/)).not.toBeInTheDocument();
  });
});

describe("Historia towaru i klienta (0.413.0)", () => {
  it("mówi, ile razy TO SAMO już się zdarzyło i jak się skończyło", () => {
    render(<Dowody {...props({}, true, {
      towar: { ile: 3, uznanych: 2, odrzuconych: 1 },
      klient: { ile: 1, uznanych: 0, odrzuconych: 1 },
    })} />);
    expect(screen.getByText(
      /Ten towar: 3 reklamacje \(2 uznane, 1 odrzucona\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ten klient: 1 reklamacja \(1 odrzucona\)/)).toBeInTheDocument();
  });

  it("bez historii nie rysuje wiersza — pierwsza sprawa to nie informacja o towarze", () => {
    render(<Dowody {...props()} />);
    expect(screen.queryByText(/Ten towar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ten klient/)).not.toBeInTheDocument();
  });

  it("jedna strona wiedzy wystarcza — drugiej nie udaje zerem", () => {
    render(<Dowody {...props({}, true, {
      towar: null, klient: { ile: 2, uznanych: 2, odrzuconych: 0 },
    })} />);
    expect(screen.getByText(/Ten klient: 2 reklamacje \(2 uznane\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Ten towar/)).not.toBeInTheDocument();
  });
});
