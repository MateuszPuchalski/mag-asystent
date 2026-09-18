import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Reklamacja, SzczegolReklamacji, Zamowienie } from "../api/typy";
import { Dowody } from "./Dowody";

/* ── Hierarchia prawej kolumny (0.403.0) ─────────────────────────────────────
   Zgłoszenie właściciela ze zrzutem całego panelu: „wygląda chaotycznie".
   Kolumna dowodów miała dwadzieścia jeden wierszy W JEDNEJ WADZE — „Tytuł:
   rękojmia" ważyło dokładnie tyle, co kwota żądania i termin decyzji.

   Te testy pilnują TRZECH rzeczy, bo one same tłumaczą zmianę, a nie jej
   wygląd:

   1. GŁOWICA NIESIE WERDYKT. Kwota i termin stoją na wierzchu, bez otwierania
      czegokolwiek. Termin mówi „za ile", nie „którego" — odejmowanie dat
      w głowie to praca, którą kolumna ma zdjąć (ta sama zamiana co 0.121.0).
   2. RESZTA SCHODZI DO ZWIJEK, a ich PODPISY mówią, co w środku. Zwijka,
      której nie trzeba otwierać, żeby wiedzieć, czy warto — to jedyny powód,
      dla którego zwijanie w ogóle się opłaca.
   3. SYGNATURA MÓWI, SKĄD JEST. Po 0.400.0 symbol bywa z paragonu, a bywa
      z dzisiejszego mapowania oferty. To dwie różne rzeczy i ekran je
      rozróżnia, zamiast kazać ufać jednakowo.                              */

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
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null,
  linkOferty: null, ofertaNazwa: "GAŹNIK DO STIHL MS181", ofertaZdjecie: "brak",
  twId: 11, twSymbol: "W09-0804", twZParagonu: true, ...n,
} as unknown as Reklamacja);

const ZAMOWIENIE = {
  externalId: "ord-5", dostawaGrosze: 0, dostawaMetoda: "Allegro Paczkomaty InPost",
  sumaGrosze: 7874, waluta: "PLN", kupionoAt: "2026-09-03T05:57:00.000Z",
  pozycje: [
    { offerId: "of-9", sku: null, nazwa: "FILTR PALIWA", ilosc: 1, cenaGrosze: 1049, waluta: "PLN" },
    { offerId: "of-1", sku: "W09-0804", nazwa: "GAŹNIK DO STIHL MS181", ilosc: 1,
      cenaGrosze: 6825, waluta: "PLN" },
  ],
} as unknown as Zamowienie;

const props = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {}) => ({
  szczegol: {
    reklamacja: rek(r), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
    droga: [], kartoteka: null, karta: null, zamowienie: null, przesylka: null, ...n,
  } as unknown as SzczegolReklamacji,
  trwa: false, bladZapisu: "", onNotatka: vi.fn(),
});

describe("Głowica prawej kolumny niesie werdykt", () => {
  it("kwota żądania stoi NA WIERZCHU, bez otwierania czegokolwiek", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByText("68,25 PLN")).toBeInTheDocument();
  });

  it("termin mówi ZA ILE, a datę zostawia pod spodem", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByText("za 6 dni")).toBeInTheDocument();
    expect(screen.getByText(/24\.09\.2026/)).toBeInTheDocument();
  });

  it("PO TERMINIE mówi o sobie wprost — to nie jest „za −1 dzień”", () => {
    render(<Dowody {...props({}, { poTerminie: true, dniDoTerminu: -1 })} />);
    expect(screen.getByText("po terminie")).toBeInTheDocument();
  });

  it("bez kwoty w głowicy staje SŁOWO oczekiwania, a nie puste miejsce", () => {
    render(<Dowody {...props({}, { oczekiwanaKwotaGrosze: null })} />);
    expect(screen.getByText("zwrot pieniędzy")).toBeInTheDocument();
  });

  it("tytuł prawny, powód i status stoją jako znaczniki — bez własnych wierszy", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByText("rękojmia")).toBeInTheDocument();
    /* JEDEN raz, nie dwa: status zszedł z wiersza „Sprawy" do znacznika. */
    expect(screen.getAllByText("CLAIM_SUBMITTED")).toHaveLength(1);
  });
});

describe("Wiersz towaru mówi, skąd jest sygnatura", () => {
  it("sygnatura Z PARAGONU jest tak podpisana (0.400.0)", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByText("W09-0804")).toBeInTheDocument();
    expect(screen.getByText("z paragonu")).toBeInTheDocument();
  });

  it("sygnatura z dzisiejszego mapowania NIE udaje paragonu", () => {
    render(<Dowody {...props({}, { twZParagonu: false })} />);
    expect(screen.getByText("z mapowania oferty")).toBeInTheDocument();
    expect(screen.queryByText("z paragonu")).not.toBeInTheDocument();
  });

  it("ilość i cenę bierze z POZYCJI tej oferty, nie z sumy zamówienia", () => {
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE })} />);
    /* Dwa trafienia i oba są w porządku: wiersz towaru i lista paragonu.
       Lista pokazuje CAŁY zakup, wiersz — rzecz sporną. */
    expect(screen.getAllByText("1 × 68,25 PLN").length).toBeGreaterThan(0);
  });
});

describe("Zwijki mówią, co w środku", () => {
  it("podpis ZAKUPU niesie kwotę i dzień — nie trzeba go otwierać", () => {
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE })} />);
    /* Suma stoi i w podpisie zwiniętej zwijki, i w wierszu „Razem" w środku —
       o to właśnie chodzi: podpis ma odpowiedzieć bez otwierania. */
    expect(screen.getAllByText(/78,74 PLN/).length).toBeGreaterThan(1);
  });

  it("podpis SPRAWY niesie numer, kupującego i długość rozmowy", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByRole("button",
      { name: /Sprawa.*2743634\/2026.*Client:43897233.*11 wiadomości/ })).toBeInTheDocument();
  });

  it("SPRAWA jest zwinięta domyślnie — głowica powiedziała już to, co pilne", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByRole("button", { name: /Sprawa/ }))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("ZAKUP jest otwarty domyślnie — kwoty rozstrzygają spór o zwrot pieniędzy", () => {
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE })} />);
    expect(screen.getByRole("button", { name: /Zakup/ }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("otwarta SPRAWA pokazuje identyfikatory, po które się ją otwiera", async () => {
    render(<Dowody {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /Sprawa/ }));
    expect(screen.getByText("Kupujący")).toBeInTheDocument();
    expect(screen.getByText("Zgłoszono")).toBeInTheDocument();
  });
});
