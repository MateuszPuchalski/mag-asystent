import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";
import { Glowica, stanSprawy } from "./Glowica";

/* ── Głowica sprawy ──────────────────────────────────────────────────────────
   Dwa rzędy nad drogą sprawy i rozmową. Testy pilnują tego, co głowica MA
   mówić, i tego, czego mówić już nie ma, bo ma to dom gdzie indziej.

   1. NUMER JEST DRZWIAMI DO ALLEGRO — w nowej karcie, z nazwą dla czytnika.
   2. KLIENT DA SIĘ SKOPIOWAĆ, a profil domyka drogę klienta w obie strony.
   3. JEDNA CZYNNOŚĆ NA WIERZCHU: wzięcie sprawy. Reszta pod „⋮”.
   4. BEZ POWTÓREK: etap rysuje droga, żądanie i zamówienie prawa kolumna.  */

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 5, externalId: "i-5", numer: "2743634/2026", orderId: "ord-5", offerId: "of-1",
  kupujacyLogin: "Client:43897233", prawo: "COMPLAINT",
  powodTyp: "DEFECT_FOUND_DURING_USE", powodOpis: null, temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: 6825, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: "2026-09-24T21:59:00.000Z",
  dniDoTerminu: 6, poTerminie: false, zwrotWymagany: true,
  czatAktywny: true, wiadomosciIle: 11, czatUrwany: false,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-10T06:03:00.000Z", kupionoAt: null, kupionoZrodlo: null,
  prowadzi: null, prowadziId: null, prowadziAt: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, notatka: null,
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: "https://allegro.pl/reklamacja/5",
  linkZamowienia: "https://allegro.pl/zamowienie/5", linkOferty: "https://allegro.pl/oferta/1",
  ofertaNazwa: "GAŹNIK DO STIHL MS181", ofertaZdjecie: "brak",
  twId: 11, twSymbol: "W09-0804", twZParagonu: true,
  werdykt: null, werdyktNazwa: null, werdyktStatus: null, ...n,
} as unknown as Reklamacja);

const szczegol = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {}) => ({
  reklamacja: rek(r), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
  droga: [], kartoteka: null, karta: null, zamowienie: null, przesylka: null,
  historia: { towar: null, klient: null }, ...n,
} as unknown as SzczegolReklamacji);

/* Router, bo głowica prowadzi łączem na profil klienta. */
const glowica = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {},
  inne: Partial<React.ComponentProps<typeof Glowica>> = {}) =>
  render(<MemoryRouter><Glowica szczegol={szczegol(n, r)} trwa={false} onProwadze={vi.fn()} {...inne} /></MemoryRouter>);

const PRZESYLKA = { waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null };

describe("Rząd pierwszy: która to sprawa", () => {
  it("numer jest nagłówkiem i łączem do Allegro w nowej karcie, z ikoną i nazwą dla czytnika", () => {
    glowica();
    const tytul = screen.getByRole("heading", { name: /Reklamacja 2743634\/2026/ });
    const lacze = within(tytul).getByRole("link");
    expect(lacze).toHaveAttribute("href", "https://allegro.pl/reklamacja/5");
    expect(lacze).toHaveAttribute("target", "_blank");
    expect(lacze).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(lacze).getByText("(otwiera się w Allegro)").className).toContain("sr-only");
  });

  it("bez adresu w Allegro numer stoi sam — bez martwego łącza", () => {
    glowica({}, { link: null });
    expect(screen.getByRole("heading", { name: "Reklamacja 2743634/2026" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Reklamacja/ })).not.toBeInTheDocument();
  });

  it("plakietka statusu mówi słowem, a surowy kod zostaje w podpowiedzi", () => {
    glowica();
    const p = screen.getByText("Czeka na decyzję");
    expect(p.getAttribute("title")).toMatch(/CLAIM_SUBMITTED/);
  });

  it("nasz werdykt przed potwierdzeniem Allegro wygrywa ze statusem Allegro", () => {
    expect(stanSprawy({ statusAllegro: "CLAIM_SUBMITTED", werdyktStatus: "sent", poTerminie: false }).tekst)
      .toBe("Werdykt czeka na Allegro");
    expect(stanSprawy({ statusAllegro: "CLAIM_SUBMITTED", werdyktStatus: "send_uncertain", poTerminie: false }).tekst)
      .toBe("Werdykt niepewny");
    expect(stanSprawy({ statusAllegro: "CLAIM_ACCEPTED", werdyktStatus: "send_failed", poTerminie: false }).tekst)
      .toBe("Werdykt nie przeszedł");
    expect(stanSprawy({ statusAllegro: "CLAIM_SUBMITTED", werdyktStatus: null, poTerminie: true }).tekst)
      .toBe("Po terminie decyzji");
    expect(stanSprawy({ statusAllegro: "CLAIM_ACCEPTED", werdyktStatus: null, poTerminie: false }).tekst)
      .toBe("Uznana");
  });

  it("status spoza słownika stoi surowo, zamiast zniknąć", () => {
    glowica({}, { statusAllegro: "COS_NOWEGO" });
    expect(screen.getByText("Status: COS_NOWEGO")).toBeInTheDocument();
  });
});

describe("Kto prowadzi — jedyna czynność na wierzchu", () => {
  it("niczyja sprawa daje „Prowadzę”, a klik idzie do ekranu", async () => {
    const onProwadze = vi.fn();
    glowica({}, {}, { onProwadze });
    const przycisk = screen.getByRole("button", { name: "Prowadzę" });
    expect(przycisk).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(przycisk);
    expect(onProwadze).toHaveBeenCalledTimes(1);
  });

  it("własna sprawa mówi „Prowadzisz” i jest wciśnięta — tym samym kliknięciem się ją odkłada", () => {
    glowica({}, { prowadzi: "A. Lewandowska", prowadziId: 7 }, { mojeId: 7 });
    expect(screen.getByRole("button", { name: "Prowadzisz" })).toHaveAttribute("aria-pressed", "true");
  });

  it("cudzej sprawy nie da się odebrać jednym kliknięciem — stoi imię, nie przycisk", () => {
    glowica({}, { prowadzi: "B. Nowak", prowadziId: 9 }, { mojeId: 7 });
    expect(screen.getByText("B. Nowak")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prowadz/ })).not.toBeInTheDocument();
  });
});

describe("Menu „⋮”: rzadkie czynności na jawne kliknięcie", () => {
  it("niesie odświeżenie z Allegro; nic nie woła się samo", async () => {
    const onOdswiez = vi.fn();
    glowica({ przesylka: PRZESYLKA }, {}, { onOdswiez });
    expect(onOdswiez).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Więcej działań" }));
    const menu = screen.getByRole("menu", { name: "Więcej działań" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Odśwież z Allegro" }));
    expect(onOdswiez).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("pytania o przesyłkę w menu nie ma — stoi raz, przy przesyłce", async () => {
    glowica({ przesylka: PRZESYLKA }, {}, { onOdswiez: vi.fn() });
    await userEvent.click(screen.getByRole("button", { name: "Więcej działań" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.queryByRole("menuitem", { name: /przesyłk/ })).not.toBeInTheDocument();
  });

  it("Escape zamyka menu i oddaje fokus przyciskowi", async () => {
    glowica({}, {}, { onOdswiez: vi.fn() });
    const przycisk = screen.getByRole("button", { name: "Więcej działań" });
    await userEvent.click(przycisk);
    expect(screen.getByRole("menuitem", { name: "Odśwież z Allegro" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(przycisk).toHaveFocus();
  });
});

describe("Rząd drugi: czyja to sprawa", () => {
  it("login kopiuje się kliknięciem", () => {
    glowica();
    expect(screen.getByRole("button", { name: /Client:43897233/ }))
      .toHaveAttribute("title", "Kopiuj login: Client:43897233");
  });

  it("„Profil klienta” prowadzi na profil — wiązanie drogi klienta w obie strony", () => {
    glowica();
    expect(screen.getByRole("link", { name: "Profil klienta" }))
      .toHaveAttribute("href", "/obsluga/klient/Client%3A43897233");
  });

  it("liczba innych reklamacji stoi tylko wtedy, gdy serwer ją podał — nigdy „pierwsza”", () => {
    const { unmount } = glowica({ historia: { towar: null, klient: { ile: 2, uznanych: 1, odrzuconych: 1 } } });
    expect(screen.getByText("2 inne reklamacje")).toBeInTheDocument();
    unmount();
    glowica({ historia: { towar: null, klient: null } });
    expect(screen.queryByText(/inn[ea] reklamacj/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pierwsza/)).not.toBeInTheDocument();
  });

  it("data zgłoszenia stoi cyframi z rokiem", () => {
    glowica();
    expect(screen.getByText(/^Zgłoszono \d{2}\.\d{2}\.2026$/)).toBeInTheDocument();
  });

  it("bez loginu mówi, że Allegro go nie podało — bez profilu i bez liczby", () => {
    glowica({ historia: { towar: null, klient: { ile: 2, uznanych: 0, odrzuconych: 0 } } },
      { kupujacyLogin: null });
    expect(screen.getByText("kupujący: Allegro nie podało loginu")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Profil klienta" })).not.toBeInTheDocument();
    expect(screen.queryByText(/inne reklamacje/)).not.toBeInTheDocument();
  });
});

describe("Głowica nie powtarza reszty ekranu", () => {
  it("nie ma zdań etapu, „Chce:” ani łączy zamówienia i oferty", () => {
    glowica();
    expect(screen.queryByText(/Chce:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Czeka na naszą decyzję/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /zamówienie/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /oferta/i })).not.toBeInTheDocument();
    expect(screen.queryByText("GAŹNIK DO STIHL MS181")).not.toBeInTheDocument();
  });

  it("nie ma historii klienta ani tagów — głowica trzyma tylko kto i która", () => {
    glowica();
    expect(screen.queryByRole("button", { name: "Historia" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tag/)).not.toBeInTheDocument();
  });
});
