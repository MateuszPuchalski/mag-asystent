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

const { TowarRozmowy, parametryDoSzkicu } = await import("./TowarRozmowy");

const oferta = (kartoteka: DopasowanieKartoteki): OfertaRozmowy => ({
  externalId: "12096815384", link: null, zrodlo: "wiadomosc", pobrana: null, kartoteka,
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
    /* Od 0.249.0 dostępny stan jest LICZBĄ w nagłówku bloku, nie wierszem
       tabeli: to on rozstrzyga, czy odpowiedź brzmi „wysyłamy dziś". Liczba
       i jednostka są osobnymi elementami, bo mają różną wagę. */
    expect(screen.getByText("Dostępny")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
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

  it("potwierdzona kartoteka pokazuje stan, dostępny i półkę", () => {
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
    expect(screen.getByText("Nóż do kosiarki 43 cm")).toBeInTheDocument();
    /* Lokalizacja to plakietka obok liczby (0.249.0) — jedyna wartość z tej
       grupy, którą ktoś przepisuje na kartkę i niesie na halę. */
    expect(screen.getByText("R12-B3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("szt.")).toBeInTheDocument();
    /* Stan i rezerwacje ZOSTAJĄ — tłumaczą tę liczbę, więc schodzą pod nią
       drobnym drukiem, a nie znikają. */
    expect(screen.getByText((_, el) => el?.textContent === "stan 7 · rezerwacje 2"))
      .toBeInTheDocument();
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
     parametrów wybiera pola świadomie, bo szkic idzie do klienta. */
  it("opisu NIE da się wstawić do szkicu jednym kliknięciem", () => {
    karta.mockReturnValue({
      isLoading: false, error: null,
      data: { ...PELNA, desc: "Gwint M41 x 1,5. UWAGA: ostatnia sztuka z reklamacji." },
    });
    render(<TowarRozmowy rozmowaId={1} onWstawDoSzkicu={() => {}} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43", zrodlo: "Wskazane", powod: null,
    })} />);
    expect(screen.getAllByRole("button", { name: /wstaw|szkic/i }).length).toBe(1);
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

/* ── Wstawka parametrów do szkicu (§10.4, makieta `Main.dc.html`) ────────────
   Test pilnuje GRANICY, nie formatu: szkic idzie do klienta, więc półka,
   rezerwacje i rozbicie na magazyny nie mają prawa się w nim znaleźć. Format
   wolno zmienić; te trzy pola — nie.                                        */
describe("Parametry do szkicu", () => {
  const karta: KartaTowaru = {
    id: 7, sym: "W32-0203", name: "Szarpak do NAC LS 46-450", ean: "5901234567890",
    unit: "szt.",
    identyfikatory: [{ rodzaj: "oem", wartosc: "118801234/0", zrodlo: "opis" }],
    locs: ["A01-02-03"],
    mag: { stan: 9, rez: 2, avail: 7 },
    magazyny: [{ magId: 2, kod: "SERW", nazwa: "Serwis", stan: 3, rez: 0 }],
  };

  it("niesie tożsamość towaru i dostępność", () => {
    const t = parametryDoSzkicu(karta);
    expect(t).toContain("Szarpak do NAC LS 46-450");
    expect(t).toContain("W32-0203");
    expect(t).toContain("5901234567890");
    expect(t).toContain("118801234/0");
    expect(t).toContain("7 szt.");
  });

  it("NIE niesie półki, rezerwacji ani innych magazynów", () => {
    const t = parametryDoSzkicu(karta);
    expect(t).not.toContain("A01-02-03");
    expect(t).not.toContain("SERW");
    expect(t).not.toMatch(/rezerwac/i);
  });

  /* „0 szt." czyta się jak awaria systemu, a to zdanie czyta klient. */
  it("brak stanu mówi po ludzku, nie zerem", () => {
    const t = parametryDoSzkicu({ ...karta, mag: { stan: 2, rez: 2, avail: 0 } });
    expect(t).toContain("brak na stanie");
    expect(t).not.toContain("0 szt.");
  });
});
