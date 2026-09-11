import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";
import { Dowody } from "./Dowody";

/* ── Karta faktów Copilota w kolumnie dowodów (0.275.0) ──────────────────────
   Trzy rzeczy warte testu:

   1. NAJPIERW BRAKI. Sprawa stoi tygodniami nie dlatego, że nikt nie umie
      zdecydować, tylko dlatego, że nikt nie zapytał o zdjęcie tabliczki.
   2. KAŻDE ZDANIE Z CYTATEM. Bez numeru wiadomości karta byłaby drugą wersją
      rozmowy, a nie skrótem tej, którą agent ma przed oczami.
   3. ROZPOZNANIE TO JAWNE KLIKNIĘCIE. Żądanie kosztuje pieniądze u dostawcy,
      więc nie ma prawa wyjść z samego otwarcia ekranu.                      */

const rek = (): Reklamacja => ({
  id: 1, externalId: "i-1", numer: "123/2026", orderId: null, offerId: null,
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT", powodTyp: "DEFECT_FOUND_DURING_USE",
  powodOpis: "Pękła obudowa", temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 2, czatUrwany: false,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", prowadzi: null, prowadziAt: null,
  notatka: null, wersja: 1, kubelek: "decyzja", sygnaly: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: null, ofertaZdjecie: "nieznane", twId: null, twSymbol: null,
} as unknown as Reklamacja);

const szczegol = (karta: SzczegolReklamacji["karta"]): SzczegolReklamacji => ({
  reklamacja: rek(), czat: [], zalaczniki: [], zwroty: [], rozmowy: [],
  kartoteka: null, karta,
} as unknown as SzczegolReklamacji);

const props = (karta: SzczegolReklamacji["karta"], n = {}) => ({
  szczegol: szczegol(karta), trwa: false, bladZapisu: "",
  onProwadze: vi.fn(), onNotatka: vi.fn(),
  onRozpoznaj: vi.fn(), rozpoznaje: false, bladRozpoznania: "", ...n,
});

const KARTA: SzczegolReklamacji["karta"] = {
  usterka: { tresc: "Kosiarka przestała ciąć", zrodlo: "W1" },
  kiedy: { tresc: "po tygodniu", zrodlo: "W1" },
  oczekiwanie: { tresc: "wymiana", zrodlo: "W1" },
  dowody: [{ tresc: "zdjęcie noża", zrodlo: "W3" }],
  brakuje: ["data zakupu", "numer seryjny"],
  rada: null, ocena: null, zdjecia: [],
  model: "claude-test", przez: "Ala", at: "2026-09-11T09:00:00.000Z",
};

/** Karta z radą — 0.276.0, gdy właściciel odwrócił regułę „maszyna nie radzi". */
const Z_RADA: SzczegolReklamacji["karta"] = {
  ...KARTA,
  rada: {
    co: "ACCEPTED_REFUND", pewnosc: "srednia",
    uzasadnienie: { tresc: "Usterka zgłoszona w pierwszym tygodniu", zrodlo: "W1" },
    czegoNieWiem: ["czy towar był używany zgodnie z instrukcją"],
  },
};

describe("Karta faktów Copilota", () => {
  it("pokazuje BRAKI, bo to one trzymają sprawę w miejscu", () => {
    render(<Dowody {...props(KARTA)} />);
    expect(screen.getByText("Brakuje do rozstrzygnięcia")).toBeInTheDocument();
    expect(screen.getByText("data zakupu")).toBeInTheDocument();
    expect(screen.getByText("numer seryjny")).toBeInTheDocument();
  });

  it("każde zdanie niesie CYTAT — numer wiadomości z rozmowy", () => {
    render(<Dowody {...props(KARTA)} />);
    expect(screen.getAllByText("W1").length).toBe(3);
    expect(screen.getByText("W3")).toBeInTheDocument();
  });

  it("bez karty zaprasza do przeczytania i mówi, że werdykt zostaje przy agencie", () => {
    render(<Dowody {...props(null)} />);
    expect(screen.getByText(/Werdykt zostaje przy Tobie/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PRZECZYTAJ SPRAWĘ" })).toBeInTheDocument();
  });

  it("rozpoznanie jest JAWNYM kliknięciem, nie skutkiem otwarcia ekranu", async () => {
    /* Żądanie kosztuje pieniądze u dostawcy — ta sama zasada, co przy całym
       Copilocie od etapu F. */
    const onRozpoznaj = vi.fn();
    render(<Dowody {...props(null, { onRozpoznaj })} />);
    expect(onRozpoznaj).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "PRZECZYTAJ SPRAWĘ" }));
    expect(onRozpoznaj).toHaveBeenCalledTimes(1);
  });

  it("bez obsługi rozpoznania karty NIE MA w drzewie", () => {
    /* Ten sam wzorzec co przy zamkniętej rozmowie i przy spinaczu: czego nie
       da się zrobić, tego nie ma na ekranie. */
    render(<Dowody {...props(KARTA, { onRozpoznaj: undefined })} />);
    expect(screen.queryByText("Co wyczytał Copilot")).not.toBeInTheDocument();
  });

  it("rada jest PODPISANA i mówi, że nie wypełnia formularza (0.276.0)", () => {
    /* Do 0.275.0 Copilot nie radził wcale — to była moja decyzja, którą
       właściciel odwrócił. Rada stoi więc na ekranie, ale w ramce z własnym
       nagłówkiem: agent ma wiedzieć, czyje to zdanie. */
    render(<Dowody {...props(Z_RADA)} />);
    expect(screen.getByText("Copilot radzi")).toBeInTheDocument();
    expect(screen.getByText("Uznana — zwrot pieniędzy")).toBeInTheDocument();
    expect(screen.getByText(/pewność srednia/)).toBeInTheDocument();
    expect(screen.getByText(/Czego nie wie/)).toBeInTheDocument();
    expect(screen.getByText(/Werdykt wydajesz Ty/)).toBeInTheDocument();
  });

  it("rada NIE dotyka formularza werdyktu — to jedyna linia, której bronię", () => {
    /* Allegro nie przyjmie drugiego werdyktu w sprawie, więc różnica między
       „przeczytaj i zdecyduj" a „potwierdź" jest tu nieodwracalna. Kolumna
       dowodów nie ma prawa zaznaczyć niczego w pasku werdyktu. */
    render(<Dowody {...props(Z_RADA)} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /UZNAJĘ|ODRZUCAM|WYŚLIJ WERDYKT/ }))
      .not.toBeInTheDocument();
  });

  it("bez rady karta pokazuje same fakty, bez pustej ramki", () => {
    render(<Dowody {...props(KARTA)} />);
    expect(screen.queryByText("Copilot radzi")).not.toBeInTheDocument();
    expect(screen.getByText("Brakuje do rozstrzygnięcia")).toBeInTheDocument();
  });

  it("karta MÓWI, ile zdjęć przeczytała (0.283.0)", () => {
    /* Bez tej liczby „Copilot nic nie zobaczył na zdjęciu" i „Copilot nie
       dostał zdjęć" wyglądają identycznie — a to dwa różne następne ruchy. */
    render(<Dowody {...props({ ...KARTA, zdjecia: [
      { numer: "Z1", zalacznikId: 11, nazwa: "tabliczka.jpg" },
      { numer: "Z2", zalacznikId: 12, nazwa: "gaznik.jpg" },
    ] })} />);
    expect(screen.getByText(/przeczytał 2 zdjęcia/)).toBeInTheDocument();
  });

  it("bez zdjęć stopka o nich MILCZY, zamiast pisać zero", () => {
    render(<Dowody {...props(KARTA)} />);
    expect(screen.queryByText(/przeczytał/)).not.toBeInTheDocument();
  });

  it("cytat ze zdjęcia niesie NAZWĘ PLIKU — inaczej jest numerem donikąd", () => {
    render(<Dowody {...props({
      ...KARTA,
      dowody: [{ tresc: "tabliczka NAC LS46-450", zrodlo: "Z1" }],
      zdjecia: [{ numer: "Z1", zalacznikId: 11, nazwa: "tabliczka.jpg" }],
    })} />);
    expect(screen.getByTitle("Zdjęcie: tabliczka.jpg")).toHaveTextContent("Z1");
    /* Cytat z ROZMOWY podpowiedzi nie potrzebuje: wiadomość jest obok.
       Karta cytuje `W1` trzykrotnie, więc bierzemy pierwszy z brzegu. */
    expect(screen.getAllByText("W1")[0]).not.toHaveAttribute("title");
  });
});
