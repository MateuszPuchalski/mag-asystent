import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DopasowanieKartoteki, KartaTowaru, OfertaRozmowy } from "../api/typy";

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: (twId: number | null) => karta(twId),
  useWskazKartoteke: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock("../api/wiedza", () => ({ useWiedzaTowaru: () => ({ data: undefined }) }));
vi.mock("../towar/Zdjecie", () => ({ Zdjecie: () => <div data-testid="zdjecie" /> }));
vi.mock("../towar/Powiekszenie", () => ({ Powiekszenie: () => null }));

const { TowarRozmowy, parametryDoSzkicu } = await import("./TowarRozmowy");

const oferta = (kartoteka: DopasowanieKartoteki): OfertaRozmowy => ({
  externalId: "12096815384", link: null, pobrana: null, kartoteka,
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

  it("propozycja z SKU czeka na zatwierdzenie i mówi, skąd się wzięła", () => {
    karta.mockReturnValue(PUSTA);
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "sku", twId: 7701, symbol: "NOZ-STIGA-43",
      zrodlo: 'SKU oferty „NOZ-STIGA-43"', powod: null,
    })} />);
    expect(screen.getByRole("button", { name: /Zatwierdź/ })).toBeInTheDocument();
    expect(screen.getByText(/SKU oferty/)).toBeInTheDocument();
    /* Propozycja to jeszcze nie fakt — stanu magazynowego nie pobieramy. */
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
    expect(screen.getByText("R12-B3")).toBeInTheDocument();
    expect(screen.getByText("5 szt.")).toBeInTheDocument();
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
