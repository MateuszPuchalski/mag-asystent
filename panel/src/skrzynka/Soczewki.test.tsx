import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DokumentySprzedazy, KandydatZamowienia, Kopilot, OsRozmowy, PozycjaZamowienia } from "../api/typy";

/* ── Soczewki na górze kolumny kontekstu (0.499.0) ──────────────────────────
   Pilnujemy odpowiedzi, nie wyglądu: podwójny zakup jest nazwany ze statusem
   słowem, „inny towar" pokazuje, co miało przyjść, a zdanie do szkicu idzie
   tylko kliknięciem, faktura mówi, co jest w Subiekcie pod numerem
   zamówienia. Każda soczewka mówi też, skąd wzięła się jej kategoria.       */

const dokumenty = { data: undefined as DokumentySprzedazy | undefined, isLoading: false, error: null as unknown };
const karty = new Map<number, { locs: string[] }>();
vi.mock("../api/rozmowy", () => ({
  useDokumentySprzedazy: () => dokumenty,
  useKartaTowaru: (twId: number) => ({ data: karty.get(twId) }),
}));

const { Soczewka } = await import("./Soczewki");
const { PROSBA_O_ZDJECIE } = await import("./soczewki-reguly");

const kopilot = (n: Partial<Kopilot>): Kopilot => ({
  kategoria: "OTHER", dodatkowe: [], akcja: "HUMAN_REVIEW", akcjaModelu: null, wymagaCzlowieka: false,
  brakDanychZamowienia: false, brakDanychProduktu: false, pewnosc: null, zrodlo: "MODEL", status: "SUCCESS",
  kody: [], uzasadnienie: null, nieaktualna: false, kategoriaCzlowieka: null, kategoriaModelu: null, ...n,
} as Kopilot);

const pozycja = (n: Partial<PozycjaZamowienia> = {}): PozycjaZamowienia => ({
  offerId: "1", nazwa: "Nóż do kosiarki MTD 46 cm", sku: "14-25001", ilosc: 1, cenaGrosze: 4500, waluta: "PLN",
  zwracana: false, wracaIlosc: 0, twId: 501, twSymbol: "14-25001", twZrodlo: null, ofertaZdjecie: "nieznane", ...n,
} as PozycjaZamowienia);

const dane = (k: Partial<Kopilot>, n: Partial<OsRozmowy> = {}): OsRozmowy => ({
  rozmowa: { id: 7, kopilot: kopilot(k) },
  zamowienie: { externalId: "z1", link: null, przesylka: null, pobrane: {
    externalId: "z1", status: "READY_FOR_PROCESSING", kupujacyLogin: "k", dostawaGrosze: 1049, dostawaMetoda: null,
    platnoscTyp: null, platnoscAt: null, fakturaZadana: true, sumaGrosze: 5549, waluta: "PLN",
    kupionoAt: "2026-09-22T13:17:00Z", link: null, pozycje: [pozycja()] } },
  kandydaciZamowien: [], zwroty: [], ...n,
} as unknown as OsRozmowy);

const rysuj = (d: OsRozmowy, onWstaw = vi.fn()) => render(<Soczewka dane={d} onWstawDoSzkicu={onWstaw} />);

describe("soczewka w kolumnie kontekstu", () => {
  it("nie staje bez kategorii z soczewką", () => {
    const { container } = rysuj(dane({ kategoria: "ORDER_STATUS" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("mówi, skąd kategoria: od Copilota albo od zespołu", () => {
    const { unmount } = rysuj(dane({ kategoria: "INVOICE" }));
    /* Źródło stoi słowem; „gdzie poprawić" czeka w dymku (@wydanie), bo nad
       każdą soczewką czytało się jak instrukcja obsługi ekranu. */
    const zrodlo = screen.getByText(/kategoria wg Copilota/);
    expect(zrodlo).toBeInTheDocument();
    expect(zrodlo).not.toHaveTextContent(/poprawisz/);
    expect(zrodlo).toHaveAttribute("title", expect.stringMatching(/pod „⋯” nad rozmową/));
    unmount();
    rysuj(dane({ kategoriaCzlowieka: "INVOICE" }));
    expect(screen.getByText(/kategoria wskazana przez zespół/)).toBeInTheDocument();
  });

  it("anulowanie: podwójny zakup nazwany, statusy słowem, zamówienie rozmowy zaznaczone", () => {
    const z = (id: string, kiedy: string, status: string): KandydatZamowienia => ({
      externalId: id, link: null, status, kupionoAt: kiedy, sumaGrosze: 12900, waluta: "PLN",
      pozycje: "Nóż do kosiarki AL-KO Comfort", maTeOferte: true });
    rysuj(dane({ kategoria: "CANCEL_ORDER" }, {
      kandydaciZamowien: [z("z1", "2026-09-22T10:00:00Z", "READY_FOR_PROCESSING"),
        z("z2", "2026-09-22T12:00:00Z", "FILLED_IN")] }));
    expect(screen.getByText(/Te same pozycje kupione dwa razy/)).toHaveTextContent(/opłacone/);
    expect(screen.getByText(/Te same pozycje kupione dwa razy/)).toHaveTextContent(/nieopłacone/);
    expect(screen.getAllByText("te same pozycje")).toHaveLength(2);
    expect(screen.getByText("zamówienie rozmowy")).toBeInTheDocument();
  });

  it("anulowanie bez znanych zakupów mówi, skąd wziąć numer", () => {
    rysuj(dane({ kategoria: "CANCEL_ORDER" }));
    expect(screen.getByText(/Nie znamy zakupów tego klienta/)).toBeInTheDocument();
  });

  it("inny towar: co miało przyjść, z półką; prośba o zdjęcie tylko kliknięciem", async () => {
    karty.set(501, { locs: ["H01-02-03"] });
    const onWstaw = vi.fn();
    rysuj(dane({ kategoria: "WRONG_PRODUCT" }), onWstaw);
    expect(screen.getByRole("list", { name: "Pozycje zamówienia" })).toHaveTextContent("Nóż do kosiarki MTD 46 cm");
    expect(screen.getByText(/półka H01-02-03/)).toBeInTheDocument();
    expect(onWstaw).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Poproś o zdjęcie/ }));
    expect(onWstaw).toHaveBeenCalledWith(PROSBA_O_ZDJECIE);
  });

  it("brak w paczce ma swoje zdanie; bez zamówienia soczewka każe je wskazać", () => {
    const { unmount } = rysuj(dane({ kategoria: "MISSING_PRODUCT" }));
    expect(screen.getByText(/ustal z klientem, czego brakuje/)).toBeInTheDocument();
    unmount();
    rysuj(dane({ kategoria: "WRONG_PRODUCT" }, { zamowienie: null }));
    expect(screen.getByText(/Rozmowa nie ma zamówienia/)).toBeInTheDocument();
  });

  it("faktura: jest FS, jest tylko paragon albo nie ma nic — i czy kupujący ją zaznaczył", () => {
    dokumenty.data = { zamowienie: "z1", dokumenty: [{ numer: "PA 88/2026", typ: "PA", data: "2026-09-22" },
      { numer: "FS 1240/2026", typ: "FS", data: "2026-09-23" }] };
    const a = rysuj(dane({ kategoria: "INVOICE" }));
    expect(screen.getByText(/Faktura jest: FS 1240\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Kupujący zaznaczył przy zakupie/)).toBeInTheDocument();
    a.unmount();

    dokumenty.data = { zamowienie: "z1", dokumenty: [{ numer: "PA 88/2026", typ: "PA", data: "2026-09-22" }] };
    const b = rysuj(dane({ kategoria: "INVOICE" }));
    expect(screen.getByText(/Jest tylko paragon/)).toBeInTheDocument();
    b.unmount();

    dokumenty.data = { zamowienie: "z1", dokumenty: [] };
    rysuj(dane({ kategoria: "INVOICE" }));
    expect(screen.getByText(/nie ma dokumentu z numerem tego zamówienia/)).toBeInTheDocument();
    dokumenty.data = undefined;
  });

  /* Zwrot (0.506.0): soczewka mówi, że zwrotu w Allegro jeszcze nie ma;
     gdy zwrot jest, jego karta stoi w „Wymaga Ciebie" i soczewka milczy. */
  it("zwrot: bez zgłoszenia w Allegro mówi to wprost, ze zgłoszeniem milczy", () => {
    const { unmount } = rysuj(dane({ kategoria: "RETURN" }));
    expect(screen.getByText(/Zwrotu tego zamówienia w Allegro jeszcze nie ma/)).toBeInTheDocument();
    unmount();
    const { container } = rysuj(dane({ kategoria: "RETURN" }, { zwroty: [{ id: 3 }] } as unknown as Partial<OsRozmowy>));
    expect(container).toBeEmptyDOMElement();
  });
});

