import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OfertaRozmowy as Dane, StanZdjeciaOferty } from "../api/typy";

/* Zdjęcie oferty (0.213.0): pobranie idzie `fetch`em, a w jsdomie nie ma dokąd
   go wysłać. Atrapa mówi „obraz jest", więc widać, czy kafel w ogóle staje. */
vi.mock("../towar/useZdjecie", () => ({
  useZdjecie: () => null,
  useZdjecieOferty: (id: string | null | undefined) => (id ? `blob:${id}` : null),
}));

const { OfertaRozmowy } = await import("./OfertaRozmowy");

const BEZ_KARTOTEKI: Dane["kartoteka"] = {
  pewnosc: "brak", twId: null, symbol: null,
  zrodlo: "Oferty jeszcze nie pobrano z Allegro", powod: "oferta_niepobrana",
};

const dane = (pobrana: Dane["pobrana"], kartoteka = BEZ_KARTOTEKI, zgodnosc: Dane["zgodnosc"] = null): Dane => ({
  externalId: "12096815384",
  link: "https://allegro.pl/oferta/12096815384",
  zrodlo: "wiadomosc",
  zgodnosc,
  pobrana,
  kartoteka,
});

describe("blok oferty przy rozmowie", () => {
  it("pokazuje tytuł, SKU i cenę, gdy snapshot jest", () => {
    render(<OfertaRozmowy oferta={dane({
      nazwa: "NÓŻ DO KOSIARKI STIGA 43cm 46S CASTELGARDEN NG464",
      sku: "NOZ-STIGA-43", cenaGrosze: 4890, waluta: "PLN", status: "ACTIVE",
      syncedAt: "2026-09-02T14:50:00Z", zdjecie: "brak" as const,
    })} />);
    expect(screen.getByText(/NÓŻ DO KOSIARKI STIGA 43cm/)).toBeInTheDocument();
    expect(screen.getByText("NOZ-STIGA-43")).toBeInTheDocument();
    expect(screen.getByText(/48,90/)).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  /* Numer jest ZAWSZE, bo mamy go z wiadomości — czekamy tylko na tytuł. */
  it("bez snapshotu mówi WPROST, że tytuł dopiero przyjedzie", () => {
    render(<OfertaRozmowy oferta={dane(null)} />);
    expect(screen.getByText("12096815384")).toBeInTheDocument();
    expect(screen.getByText(/Tytułu oferty jeszcze nie pobrano/)).toBeInTheDocument();
  });

  it("prowadzi do oferty publicznej, nie do panelu sprzedawcy", () => {
    render(<OfertaRozmowy oferta={dane(null)} />);
    expect(screen.getByRole("link", { name: /Otwórz w Allegro/ }))
      .toHaveAttribute("href", "https://allegro.pl/oferta/12096815384");
  });

  /* Cena bywa nieznana (oferta w formacie licytacji bez „kup teraz"), a wtedy
     blok pokazuje sam tytuł zamiast zera złotych. */
  it("bez ceny pokazuje sam tytuł", () => {
    render(<OfertaRozmowy oferta={dane({
      nazwa: "Szarpak", sku: null, cenaGrosze: null, waluta: null, status: null,
      syncedAt: "2026-09-02T14:50:00Z", zdjecie: "brak" as const,
    })} />);
    expect(screen.getByText("Szarpak")).toBeInTheDocument();
    expect(screen.queryByText(/zł/)).not.toBeInTheDocument();
  });
});

describe("zdjęcie listingowe oferty", () => {
  const snapshot = (zdjecie: StanZdjeciaOferty): Dane["pobrana"] => ({
    nazwa: "NÓŻ DO KOSIARKI STIGA 43cm", sku: "NOZ-STIGA-43", cenaGrosze: 4890,
    waluta: "PLN", status: "ACTIVE", syncedAt: "2026-09-02T14:50:00Z", zdjecie,
  });

  it("pokazuje zdjęcie i PODPISUJE jego źródło", () => {
    render(<OfertaRozmowy oferta={dane(snapshot("jest"))} />);
    const obraz = screen.getByAltText("NÓŻ DO KOSIARKI STIGA 43cm");
    /* Adres jest NASZ. Gdyby panel dostał `https://a.allegroimg.com/…`, każde
       otwarcie skrzynki wyprowadzałoby przeglądarkę biura poza własną sieć —
       to jest ten sam zakaz, co przy awatarze rozmówcy, i on obowiązuje dalej. */
    expect(obraz.getAttribute("src")).not.toMatch(/allegroimg/);
    /* Źródła się nie mieszają (§4.3): blok towaru niżej pokazuje zdjęcie
       z Subiekta, więc to musi się przedstawić. */
    expect(screen.getByText(/Zdjęcie z oferty Allegro/)).toBeInTheDocument();
  });

  /* ── TRZY STANY, TRZY ZDANIA (0.214.0) ────────────────────────────────────
     Właściciel przysłał zrzut: przy zwrocie stały dwa kafle „BEZ ZDJĘCIA",
     a oferta na Allegro zdjęcie miała. Snapshot był po prostu starszy niż
     kolumna z adresem — czyli ekran mówił „nie ma", gdy prawdą było „jeszcze
     nie pytaliśmy". Te dwa testy pilnują, żeby się nie zlały z powrotem.    */
  it("pytaliśmy i Allegro nie ma obrazu — kafla nie ma i trasy nie pytamy", () => {
    render(<OfertaRozmowy oferta={dane(snapshot("brak"))} />);
    expect(screen.queryByAltText("NÓŻ DO KOSIARKI STIGA 43cm")).not.toBeInTheDocument();
    expect(screen.queryByText(/Zdjęcie z oferty Allegro/)).not.toBeInTheDocument();
  });

  it("jeszcze nie pytaliśmy — ekran mówi, że obraz dopiero przyjedzie", () => {
    render(<OfertaRozmowy oferta={dane(snapshot("nieznane"))} />);
    expect(screen.queryByAltText("NÓŻ DO KOSIARKI STIGA 43cm")).not.toBeInTheDocument();
    /* Zdanie, nie milczenie: brak obrazu naprawi się sam przy najbliższej
       synchronizacji, a agent ma prawo o tym wiedzieć. */
    expect(screen.getByText(/Zdjęcie oferty dociągnie/)).toBeInTheDocument();
  });
});

/* ── Lista „Pasuje do" (23 września 2026) ────────────────────────────────────
   Zwinięta, bo bywa na dwieście pozycji. Na wierzchu stoi odpowiedź — czy
   maszyna z doboru jest na liście — a „nie ma" nie udaje „nie pasuje". */
describe("lista zgodności oferty", () => {
  const Z = (n: Partial<NonNullable<Dane["zgodnosc"]>> = {}): NonNullable<Dane["zgodnosc"]> => ({
    lista: ["Faworyt 4618", "Hecht 1803S", "Honda HRX 476"], maszyna: null, trafienia: [],
    wariantSprawdzony: true, ...n,
  });

  it("zwinięta z liczbą, rozwija się na miejscu", async () => {
    render(<OfertaRozmowy oferta={dane(null, BEZ_KARTOTEKI, Z())} />);
    const p = screen.getByRole("button", { name: /Pasuje do \(3\)/ });
    expect(screen.queryByText("Hecht 1803S")).toBeNull();
    await userEvent.click(p);
    expect(screen.getByText("Faworyt 4618")).toBeInTheDocument();
  });

  it("maszyna z doboru na liście: widać bez rozwijania, a pozycja jest podświetlona", async () => {
    render(<OfertaRozmowy oferta={dane(null, BEZ_KARTOTEKI, Z({
      maszyna: "HECHT 1803S DYM1182c", trafienia: ["Hecht 1803S"], wariantSprawdzony: false }))} />);
    expect(screen.getByText(/HECHT 1803S DYM1182c jest na liście/)).toBeInTheDocument();
    expect(screen.getByText(/wariant niesprawdzony/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Pasuje do/ }));
    expect(screen.getByText("Hecht 1803S").closest("li")).toHaveTextContent("maszyna klienta");
  });

  it("brak na liście mówi, że to nie dowód; bez listy bloku nie ma", () => {
    const { rerender } = render(<OfertaRozmowy oferta={dane(null, BEZ_KARTOTEKI, Z({ maszyna: "Stiga Combi 48" }))} />);
    expect(screen.getByText(/nie ma na liście; to nie dowód, że nie pasuje/)).toBeInTheDocument();
    rerender(<OfertaRozmowy oferta={dane(null)} />);
    expect(screen.queryByLabelText("Pasuje do")).toBeNull();
  });
});
