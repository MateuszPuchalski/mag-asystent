import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";

/* ── Triaż reklamacji: cztery kostki w siatce dwa na dwa ─────────────────────
   Zgłoszenie właściciela ze zrzutem: „potrzebujemy wyraźnej hierarchii, żeby
   podjąć decyzję o reklamacji". Kolumna niosła sześć równorzędnych poziomów
   cen i ani jednej sztuki stanu — przy sprawie, w której klient żąda WYMIANY.
   Dziś cztery kostki: Mamy, Kupione, Klient zapłacił, Dostawca — zawsze
   w tym samym miejscu, a brak wiedzy mówi w nich słowami.

   Testy pilnują TEGO, co rozstrzyga decyzję, a nie wyglądu pasma:

   1. STAN JEST NA EKRANIE. Przy żądaniu wymiany to jest cała decyzja, a do
      tego wydania reklamacja nie miała tej liczby nigdzie — skrzynka ma ją
      od 0.404.0.
   2. CENA ZAKUPU TO POZIOM 0, nie „najtańszy wiersz z listy". Najtańszy
      cennik sprzedaży to nadal sprzedaż, a pomyłka w tę stronę każe odrzucić
      reklamację, którą opłacało się uznać.
   3. BRAK KARTOTEKI MÓWI O SOBIE WPROST — pusty slot po stanie czytałby się
      jak „nie mamy" (zasada nadrzędna 9 projektu panelu, §27).
   4. NIC SIĘ NIE ODEJMUJE. Zapłacone jest brutto, zakup netto; różnica tych
      dwóch nie jest marżą, a stawki VAT ten ładunek nie niesie.            */

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({ useKartaTowaru: (twId: number | null) => karta(twId) }));

const { FaktySprawy } = await import("./Fakty");
/* Fakty stoją w głowicy jako pas komórek. Test patrzy na sam pas, w ramie
   routera, bo „Ten zakup u nas" niesie odnośniki do kolejek. */
const Fakty = ({ szczegol, onSprawdzPrzesylke, sprawdzaPrzesylke, bladPrzesylki }: {
  szczegol: SzczegolReklamacji; onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean; bladPrzesylki?: string;
}) => <MemoryRouter><FaktySprawy szczegol={szczegol} towar={kartotekaKolumny(szczegol)}
  onSprawdzPrzesylke={onSprawdzPrzesylke} sprawdzaPrzesylke={sprawdzaPrzesylke}
  bladPrzesylki={bladPrzesylki} /></MemoryRouter>;

const { Glowica, kartotekaKolumny } = await import("./Glowica");

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
  it("mówi, CZY MAMY bez otwierania czegokolwiek, a półka stoi w podpisie komórki", () => {
    /* Żadnego kliknięcia przed tą asercją i to jest cały jej sens: przy
       żądaniu wymiany ta liczba rozstrzyga sprawę. Półka stoi pod stanem,
       bo zwijki „Ceny i półka" już nie ma. */
    render(<Fakty {...props()} />);
    expect(screen.getByText("7 szt.")).toBeVisible();
    expect(screen.getByText("Mamy").parentElement!.textContent).toContain("półka D02-01-04");
  });

  it("BRAK NA STANIE mówi o sobie wprost — to zmienia decyzję, nie tylko liczbę", () => {
    karta.mockReturnValue({ data: { ...KARTA, mag: { stan: 0, rez: 0, avail: 0 } },
      isLoading: false, error: null });
    render(<Fakty {...props()} />);
    expect(screen.getByText("brak na stanie")).toBeInTheDocument();
  });

  it("bez kartoteki mówi „nie wiadomo”, a nie zero — i mówi to RAZ za stan i dostawcę", () => {
    /* Brak kartoteki mówi wiersz towaru w głowicy. „Mamy" i „Dostawca"
       powtarzałyby go dwa razy, więc stają jedną komórką: czego nie wiemy. */
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Fakty {...props({ twId: null })} />);
    expect(screen.getByText("nie wiadomo")).toBeInTheDocument();
    expect(screen.getByText("Mamy · dostawca").parentElement!.textContent)
      .toContain("stanu ani dostaw nie znamy");
    expect(screen.queryByText("Dostawca")).not.toBeInTheDocument();
    expect(screen.queryByText(/bez kartoteki/)).not.toBeInTheDocument();
  });

  it("KOSZT bierze z poziomu 0, bo to cena zakupu — nie z najtańszej sprzedaży", () => {
    /* Bierzemy poziom 0, bo tak numeruje kolumny `tw_Cena`, a nie dlatego,
       że jakaś liczba wygląda na najniższą. Tu „Hurtowa" jest TAŃSZA od
       zakupu i nadal nie jest kosztem. */
    karta.mockReturnValue({ data: { ...KARTA, ceny: [
      { poziom: 0, nazwa: "", nettoGrosze: 1500, bruttoGrosze: 0, waluta: "PLN" },
      { poziom: 2, nazwa: "Hurtowa", nettoGrosze: 1400, bruttoGrosze: 1722, waluta: "PLN" },
    ] }, isLoading: false, error: null });
    render(<Fakty {...props()} />);
    /* Pytamy ZDANIA o koszt, nie całej komórki: cennik sprzedaży stoi w niej
       obok i ma prawo pokazać „Hurtową" — byle nie jako nasz zakup. */
    const koszt = screen.getByText(/nasz zakup/);
    expect(koszt.textContent).toContain("nasz zakup 15,00 PLN netto");
    expect(koszt.textContent).not.toContain("14,00");
  });

  it("stawia kwotę Z PARAGONU obok naszego zakupu i nie odejmuje jednej od drugiej", () => {
    /* Zapłacone jest brutto, zakup netto. Wyliczona z nich „marża" byłaby
       nieprawdą z dokładnością do stawki VAT, której ten ładunek nie niesie. */
    render(<Fakty {...props()} />);
    const kostka = screen.getByText("Klient zapłacił").parentElement!;
    expect(kostka.textContent).toContain("49,90 PLN");
    expect(screen.getByText("brutto · nasz zakup 18,64 PLN netto")).toBeInTheDocument();
    expect(screen.queryByText(/marż/i)).not.toBeInTheDocument();
    expect(kostka.textContent).not.toContain("31,26");
  });

  it("kwota równa żądaniu stoi RAZ — w zdaniu „Chce:”, a komórka mówi, że to ta sama", () => {
    render(<Fakty {...props({ oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: 4990 })} />);
    const kostka = screen.getByText("Klient zapłacił").parentElement!;
    expect(kostka.textContent).toContain("tyle, ile żąda");
    expect(kostka.textContent).not.toContain("49,90");
    /* Nasz zakup zostaje — tej liczby zdanie „Chce:" nie niesie. */
    expect(kostka.textContent).toContain("nasz zakup 18,64 PLN netto");
  });

  it("bez zamówienia bierze cenę z PARAGONU z wiersza sprawy", () => {
    render(<Fakty {...props({ cenaParagonuGrosze: 4590 }, false)} />);
    expect(screen.getByText("Klient zapłacił").parentElement!.textContent).toContain("45,90 PLN");
  });


  it("bez wiedzy kostka mówi „nie wiemy” — nie zero i nie pustka", () => {
    /* Kostki stoją zawsze w tych samych miejscach, więc brak danych nie
       zabiera kostki, tylko mówi o sobie. Zero czytałoby się jak „nie mamy",
       a pusty slot jak awaria ekranu. */
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Fakty {...props({ twId: 11 }, false)} />);
    const mamy = screen.getByText("Mamy").parentElement!;
    expect(mamy.textContent).toContain("nie wiemy");
    expect(mamy.textContent).not.toMatch(/\b0\b/);
    expect(screen.getByText("Klient zapłacił").parentElement!.textContent).toContain("nie wiemy");
    expect(screen.queryByText(/nasz zakup/)).not.toBeInTheDocument();
  });

  it("cztery kostki w STAŁEJ kolejności: Mamy, Kupione, Klient zapłacił, Dostawca", () => {
    render(<Fakty {...props()} />);
    const etykiety = ["Mamy", "Kupione", "Klient zapłacił", "Dostawca"].map((t) => screen.getByText(t));
    for (let i = 1; i < etykiety.length; i += 1) {
      expect(etykiety[i - 1].compareDocumentPosition(etykiety[i])
        & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("Wiek zakupu w triażu (0.413.0)", () => {
  /* Ta sama zamiana, co przy terminie decyzji w 0.121.0: pytanie brzmi „ile to
     już leży", nie „który to był dzień". Przy rękojmi liczba dni jest
     argumentem, a agent nie ma jej odejmować w głowie. */
  it("do dwóch miesięcy liczy DNI — przy „uszkodzone w transporcie” to cała sprawa", () => {
    render(<Fakty {...props({ dniOdZakupu: 4 })} />);
    expect(screen.getByText("4 dni temu")).toBeInTheDocument();
  });

  it("dalej liczy MIESIĄCE, bo nikt nie liczy czterystu dni w głowie", () => {
    render(<Fakty {...props({ dniOdZakupu: 430 })} />);
    expect(screen.getByText("14 miesięcy temu")).toBeInTheDocument();
  });

  it("powyżej dwóch lat mówi w LATACH i zmienia kolor, ale nie wydaje wyroku", () => {
    /* Bursztyn, nie czerwień: rękojmia biegnie dwa lata od WYDANIA rzeczy,
       a nasz zegar startuje od zamówienia albo od złożenia koszyka — obie daty
       są wcześniejsze. Kostka podaje WIEK i źródło zegara; wyroku „po
       rękojmi" nie wydaje, bo nie ma z czego. */
    render(<Fakty {...props({ dniOdZakupu: 900 })} />);
    const wartosc = screen.getByText("2 lata temu");
    expect(wartosc.className).toContain("text-ranga-uwaga");
    expect(wartosc.parentElement).toHaveAttribute("title", expect.stringContaining("data z zamówienia"));
  });

  it("mówi, KTÓRY to zegar — dwie daty pod jedną etykietą to blizna 0.121.0", () => {
    render(<Fakty {...props({ dniOdZakupu: 30, kupionoZrodlo: "sprawa" })} />);
    expect(screen.getByText("Kupione").parentElement)
      .toHaveAttribute("title", expect.stringContaining("data z ładunku sprawy"));
  });

  it("pod wiekiem mówi, PO ILU DNIACH od zakupu klient się zgłosił", () => {
    /* „Uszkodzone w transporcie" zgłoszone po dwóch dniach i po trzech
       miesiącach to dwie różne sprawy, a z samego wieku tego nie widać. */
    const { unmount } = render(<Fakty {...props({ dniOdZakupu: 30, zgloszonoPoDniach: 12 })} />);
    /* Data zakupu stoi na widoku przed liczbą dni, nie tylko w podpowiedzi. */
    expect(screen.getByText(/^\d{1,2} \S+ \d{4} · zgłoszone 12 dni po zakupie$/)).toBeInTheDocument();
    unmount();
    /* Starszy serwer pola nie zna — liczymy je z jego własnych dwóch dat. */
    render(<Fakty {...props({ dniOdZakupu: 30 })} />);
    expect(screen.getByText(/ · zgłoszone 2 dni po zakupie$/)).toBeInTheDocument();
  });

  it("bez daty zakupu kostka mówi „nie wiemy” — brak wiedzy to nie „dziś”", () => {
    render(<Fakty {...props({ dniOdZakupu: null, kupionoAt: null })} />);
    const kostka = screen.getByText("Kupione").parentElement!;
    expect(kostka.textContent).toContain("nie wiemy");
    expect(kostka.textContent).not.toContain("dziś");
  });
});

describe("Ilość objęta sprawą (0.413.0)", () => {
  /* `offer.quantity` leżało w ładunku od przyrostu trzeciego i nie było go na
     ekranie ANI RAZU. „Mamy 2 szt." przy sprawie o trzy sztuki wygląda jak
     dobra wiadomość i nią nie jest. */
  it("stan czyta się PRZECIW żądaniu — dwie sztuki przy sprawie o trzy to za mało", () => {
    karta.mockReturnValue({ data: { ...KARTA, mag: { stan: 2, rez: 0, avail: 2 } },
      isLoading: false, error: null });
    render(<Fakty {...props({ ilosc: 3 })} />);
    expect(screen.getByText("Mamy").parentElement!.textContent).toContain("sprawa o 3 szt.");
    expect(screen.getByText("2 szt.").className).toContain("text-ranga-zle");
  });

  it("starczy na całą sprawę — ta sama liczba czyta się wtedy inaczej", () => {
    render(<Fakty {...props({ ilosc: 3 })} />);
    expect(screen.getByText("7 szt.").className).toContain("text-ranga-ok");
  });

  it("jedna sztuka nie dokłada zdania — to domyślny przypadek", () => {
    render(<Fakty {...props({ ilosc: 1 })} />);
    expect(screen.queryByText(/sprawa o/)).not.toBeInTheDocument();
  });
});

describe("Historia towaru przy towarze, klienta przy loginie", () => {
  /* Obie stoją w głowicy, każda obok tego, czego dotyczy — jeden dom na fakt. */
  const glowica = (historia: SzczegolReklamacji["historia"]) =>
    render(<MemoryRouter><Glowica szczegol={props({}, true, historia).szczegol}
      trwa={false} onProwadze={vi.fn()} /></MemoryRouter>);

  it("mówi, ile razy TEN TOWAR już się sypał i jak się skończyło — w wierszu towaru", () => {
    glowica({ towar: { ile: 3, uznanych: 2, odrzuconych: 1 }, klient: null });
    const wiersz = screen.getByText(/ten towar: 3 reklamacje \(2 uznane, 1 odrzucona\)/);
    expect(wiersz.closest("p")!.textContent).toContain("NÓŻ do kosiarki 46 cm");
  });

  it("bez historii nie rysuje nic — pierwsza sprawa to nie informacja o towarze", () => {
    glowica({ towar: null, klient: null });
    expect(screen.queryByText(/ten towar: /i)).not.toBeInTheDocument();
  });

  it("bez historii towaru jej nie ma, choć klient ją ma — nie udaje zera", () => {
    glowica({ towar: null, klient: { ile: 2, uznanych: 2, odrzuconych: 0 } });
    expect(screen.queryByText(/ten towar: /i)).not.toBeInTheDocument();
    expect(screen.getByText(/jeszcze 2 reklamacje u nas/)).toBeInTheDocument();
  });
});

describe("Jeden dom na fakt (0.414.0)", () => {
  /* Cztery wydania z rzędu dokładały nad kolumną warstwę streszczenia i każde
     obiecywało „nic nie znika pod spodem". Obietnica była za każdym razem
     dotrzymana i właśnie dlatego ten sam fakt stał w końcu w trzech miejscach.
     Te testy pilnują reguły, która z tego wynikła: liczba, która weszła do
     pasma decyzji, wychodzi z warstwy szczegółu. */

  it("cena NIE stoi przy wierszu towaru — tam pytanie brzmi „co to jest”", () => {
    /* Wiersz towaru stoi w głowicy sprawy, nad kolumnami — i tam też zostaje
       bez ceny. Kwota z paragonu ma swój dom w kostce „Klient zapłacił". */
    render(<MemoryRouter><Glowica szczegol={props().szczegol} trwa={false} onProwadze={vi.fn()} /></MemoryRouter>);
    const symbol = screen.getByText("14-31051");
    expect(symbol.parentElement!.textContent).not.toContain("49,90");
  });

  it("wiersza „Kupiono” nie ma — datę niesie wyłącznie kostka „Kupione”", () => {
    render(<Fakty {...props({ dniOdZakupu: 3 })} />);
    expect(screen.queryByText("Kupiono")).not.toBeInTheDocument();
    expect(screen.queryByText("Zamówienie złożone")).not.toBeInTheDocument();
  });

  it("przy jednej pozycji komórka zamówienia nie powtarza „Klient zapłacił”", () => {
    /* Cena spornej pozycji stoi komórkę obok. Zamówienie mówi więc, CO jest
       w środku, i dokłada tylko to, czego tamta nie niesie: dostawę i sumę. */
    render(<Fakty {...props()} />);
    const kostka = screen.getByText("Zamówienie").parentElement!;
    expect(kostka.textContent).toContain("tylko ten towar");
    expect(kostka.textContent).toContain("dostawa 10,00 PLN, DPD · razem 59,90 PLN");
    expect(kostka.textContent).not.toContain("49,90");
  });

  it("wiek zakupu staje NAWET wtedy, gdy nie wiemy o sprawie nic więcej", () => {
    /* Do 0.413.0 pasek znikał w całości, gdy nie było kartoteki ani pozycji
       paragonu — i zabierał ze sobą datę, którą mieliśmy. */
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Fakty {...props({ twId: null, dniOdZakupu: 400 }, false)} />);
    expect(screen.getByText("13 miesięcy temu")).toBeInTheDocument();
  });
});

describe("Jedna sekcja zamiast czterech (0.416.0)", () => {
  /* Zgłoszenie właściciela ze zrzutem: „widzę jeszcze trochę powtórzeń". Pod
     kolumną stały cztery sekcje o jednym zakupie, a droga zakupu jest ich
     nadzbiorem — `services/droga-klienta.ts` składa przystanki z dokładnie
     tych samych tabel. */
  const zeSpoiwem = () => {
    const p = props();
    return {
      ...p,
      szczegol: {
        ...p.szczegol,
        droga: [
          { rodzaj: "rozmowa", id: 3, at: "2026-09-19T15:48:00.000Z", opis: "pytanie" },
          { rodzaj: "reklamacja", id: 5, at: "2026-09-19T15:50:00.000Z", opis: null },
          { rodzaj: "dyskusja", id: 8, at: "2026-09-21T20:24:00.000Z", opis: null },
        ],
        zwroty: [{ id: 2, externalId: "z-2", numer: "ZW/2", utworzono: "2026-09-20T08:00:00.000Z" }],
        rozmowy: [{ id: 3, temat: "Client:111722583", status: "otwarta",
          ostatniaAt: "2026-09-19T15:48:00.000Z" }],
        sprawy: [{ id: 8, typ: "DISPUTE", numer: null, temat: "mam problem z odesłaniem",
          otwarta: true, decyzjaDo: null, prowadzi: null }],
      },
    } as unknown as React.ComponentProps<typeof Fakty>;
  };

  it("nie ma już czterech nagłówków o jednym zakupie", () => {
    render(<Fakty {...zeSpoiwem()} />);
    expect(screen.getByText("Ten zakup u nas")).toBeInTheDocument();
    for (const stary of ["Zwroty tego zamówienia", "Droga tego zakupu",
      "Rozmowy o tym zakupie", "Inne sprawy tego zakupu"]) {
      expect(screen.queryByText(stary)).not.toBeInTheDocument();
    }
  });

  it("z drogi da się wejść wszędzie tam, gdzie prowadziły tamte sekcje", () => {
    /* To jest warunek, pod którym wolno je było zdjąć: każdy przystanek
       niesie odnośnik do swojej kolejki. */
    render(<Fakty {...zeSpoiwem()} />);
    expect(screen.getByRole("link", { name: /pytanie/ }))
      .toHaveAttribute("href", "/obsluga/skrzynka/3");
    expect(screen.getByRole("link", { name: /dyskusja/ }))
      .toHaveAttribute("href", "/obsluga/dyskusje/8");
  });

  it("rodzeństwo spraw ZOSTAJE — niesie to, czego droga nie ma", () => {
    /* Przystanek mówi „dyskusja, 21 września"; wiersz mówi, czy tamta sprawa
       jest otwarta, kto ją prowadzi i o co w niej chodzi. */
    render(<Fakty {...zeSpoiwem()} />);
    expect(screen.getByText("mam problem z odesłaniem")).toBeInTheDocument();
  });
});

describe("Podpisy kostek: co jedzie, od kogo i kiedy", () => {
  it("bez stanu „Mamy” mówi, co zamówione u dostawcy i na kiedy", () => {
    karta.mockReturnValue({ data: { ...KARTA, mag: { stan: 0, rez: 0, avail: 0 },
      zamowione: [{ dokId: 1, nrPelny: "ZD 4/10", dataWyst: "2026-10-01", termin: "2026-10-15T00:00:00.000Z",
        dostawca: "HURT-OGR", ilosc: 5, szacunek: false }] }, isLoading: false, error: null });
    render(<Fakty {...props()} />);
    expect(screen.getByText(/zamówione 5 szt\. u HURT-OGR, termin 15 października 2026/)).toBeInTheDocument();
  });

  it("przy stanie „Mamy” mówi, ile z niego stoi jeszcze w przyjęciach", () => {
    karta.mockReturnValue({ data: { ...KARTA, wDostawie: [{ dokId: 2, nrPelny: "PZ 9/10",
      dataWyst: "2026-10-02", ilosc: 3, dostawca: "HURT-OGR" }] }, isLoading: false, error: null });
    render(<Fakty {...props({ ilosc: 2 })} />);
    expect(screen.getByText("sprawa o 2 szt. · w tym 3 szt. w przyjęciach, jeszcze nie na półce · półka D02-01-04"))
      .toBeInTheDocument();
  });

  it("„Dostawca” mówi, od kogo jest PARTIA sprzed zakupu", () => {
    render(<Fakty {...props()} szczegol={{ ...props().szczegol,
      dostawa: { dostawca: "HURT-OGR", data: "2026-08-20T00:00:00.000Z", numer: "FV 12/08", przedZakupem: true },
    }} />);
    const kostka = screen.getByText("Dostawca").parentElement!;
    expect(kostka.textContent).toContain("HURT-OGR");
    expect(kostka.textContent).toContain("dostawa przed zakupem 20 sierpnia 2026");
    expect(kostka).toHaveAttribute("title", expect.stringContaining("FV 12/08"));
  });

  it("bez partii sprzed zakupu ostatnia dostawa jest tylko TROPEM i tak się nazywa", () => {
    render(<Fakty {...props()} szczegol={{ ...props().szczegol,
      dostawa: { dostawca: "INNY", data: "2026-09-30T00:00:00.000Z", numer: null, przedZakupem: false },
    }} />);
    expect(screen.getByText("Dostawca").parentElement!.textContent)
      .toContain("ostatnia dostawa 30 września 2026");
  });

  it("bez dostawy „Dostawca” mówi „nie wiemy” — także na starszym serwerze", () => {
    const { unmount } = render(<Fakty {...props()} szczegol={{ ...props().szczegol, dostawa: null }} />);
    expect(screen.getByText("Dostawca").parentElement!.textContent).toContain("nie wiemy");
    unmount();
    render(<Fakty {...props()} />);
    expect(screen.getByText("Dostawca").parentElement!.textContent).toContain("nie wiemy");
  });
});

describe("Pas faktów w stałej kolejności", () => {
  /* Decyzja właściciela: fakty z prawej kolumny stoją w głowicy jednym pasem.
     Komórki mają stałe miejsca, więc oko szuka faktu tam, gdzie był, a droga
     zakupu stoi pod pasem. Werdyktu ani notatki w pasie nie ma. */
  it("Mamy, Kupione, Klient zapłacił, Dostawca, Paczka, Zamówienie, a pod nimi ten zakup", () => {
    const p = props();
    render(<Fakty {...p}
      szczegol={{ ...p.szczegol,
        przesylka: { waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null },
        sprawy: [{ id: 8, typ: "DISPUTE", numer: null, temat: "inna", otwarta: true, decyzjaDo: null, prowadzi: null }],
      } as unknown as SzczegolReklamacji} />);
    const kolejnosc = [
      ...["Mamy", "Kupione", "Klient zapłacił", "Dostawca", "Paczka do klienta", "Zamówienie"]
        .map((t) => screen.getByText(t, { selector: "span" })),
      screen.getByRole("region", { name: "Ten zakup u nas" }),
    ];
    for (let i = 1; i < kolejnosc.length; i += 1) {
      expect(kolejnosc[i - 1].compareDocumentPosition(kolejnosc[i])
        & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const nieMa of ["Praca biura", "Ceny i półka", "Werdykt"]) {
      expect(screen.queryByText(nieMa)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("reklamacja nie zleca pracy hali — ani przycisku, ani nagłówka „Hala”", () => {
    /* Decyzja właściciela przy przebudowie ekranu reklamacji. Zlecenie hali
       zostaje w zwrotach i dyskusjach; tutaj pas nie obiecuje go wcale. */
    render(<Fakty {...props()} />);
    expect(screen.queryByRole("button", { name: /Zleć hali/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Zleć hali/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hala" })).not.toBeInTheDocument();
  });
});
