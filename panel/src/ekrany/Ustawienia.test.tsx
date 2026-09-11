import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import type { Zdrowie } from "../api/typy";
/* Źródło jako tekst (`?raw`) — Vite umie to podać bez typów Node'a. */
import zrodloSkrzynki from "./Skrzynka.tsx?raw";
import zrodloRamy from "../main.tsx?raw";

/* ── Stan integracji za zębatką (0.168.0) ────────────────────────────────────
   Decyzja właściciela: trzynastowierszowa tabela z `/api/health` schodzi
   z ekranu pracy. Test pilnuje OBU stron tej zmiany — że tabela jest tam,
   gdzie ma być, i że alarm NIE poszedł razem z nią. Zasada 10 projektu mówi
   „awaria integracji musi być widoczna", a §21 żąda trwałego alarmu; ekran
   bez tabeli jest w porządku, ekran bez ostrzeżenia już nie.               */

const zdrowie: Zdrowie = {
  allegro: { stan: "polaczone" },
  allegroInbox: {
    status: "current", alarm: false,
    ostatniaProba: "2026-09-02T09:38:00.000Z",
    ostatniaUdanaSynchronizacja: "2026-09-02T09:38:00.000Z",
    kodOstatniegoBledu: null, tekstOstatniegoBledu: null, liczbaBledow: 0,
    watkiZBledem: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 60_000,
  },
  obsluga: { rozmowyOczekujace: 0, zadaniaTerenowe: 0, najstarszeZadanieMs: null,
    kolejkaWysylek: "pusta — nic jeszcze nie poszło", wysylkiDoSprawdzenia: 0 },
};

vi.mock("../api/rozmowy", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/rozmowy")>("../api/rozmowy");
  return {
    ...rzeczywisty,
    useZdrowie: () => ({ data: zdrowie, dataUpdatedAt: 0 }),
    /* Ekran od 0.169.0 niesie drugą kartę. Atrapa jest tu, a nie w osobnym
       teście, bo ten sprawdza SKŁAD ekranu — dane obu kart mają własne testy. */
    usePokrycieSygnatur: () => ({
      data: { pozycji: 0, bezSygnatury: 0, trafia: 0, sygnatur: 0, pudla: [], zdublowane: [] },
    }),
    usePokrycieWiedzy: () => ({
      data: { kartotek: 3200, zOpisem: 1400, zIdentyfikatorem: 460, identyfikatorow: 1900, identyfikatorowRecznych: 0,
        modeleZOpisu: { nowych: 37, przerobionych: 0, odrzuconych: 0 },
        zastosowania: { zatwierdzonych: 0, negatywnych: 0, propozycji: 0 },
        tokeny: { tokenow: 0, nowych: 0, zatwierdzonych: 0 }, wymiary: { kartotek: 0, wymiarow: 0 },
        fts: { dostepne: false, wpisow: 0 } },
    }),
    /* Skuteczność doboru (0.267.0): jedenaście dróg i dziewięć statusów, bo
       karta wypisuje je co do jednego — także te z zerem. */
    useSkutecznoscDoboru: () => ({
      data: {
        dni: 30, granicaHistorii: "2026-08-31T22:00:00Z", wyborow: 4,
        drogi: ["oferta", "zamiennik", "symbol", "ean", "wyszukiwarka", "zastosowanie",
          "silnik", "pasowanie", "oem", "pelnotekst", "wymiar"]
          .map((droga) => ({ droga, wybranych: droga === "oem" ? 4 : 0, zatwierdzonych: 0 })),
        medianaDoWyboruMin: 12, wyborowZCzasem: 4,
        osoby: [], bezKonta: 0,
        naStole: { doborow: 0, statusy: [] },
        progWiarygodnosci: 20, podstawaPrawna: "Monitoring pracowniczy (Kodeks pracy art. 22² i nast.).",
      },
    }),
  };
});

/* Czwarta karta (etap F). Copilot WYŁĄCZONY, bo to jest stan domyślny wdrożenia
   i ten ekran ma się w nim otwierać — karta pomiaru wtedy milczy, a nie
   pokazuje tabeli zer, którą łatwo wziąć za „model nic nie trafia". */
vi.mock("../api/copilot", () => ({
  useCopilot: () => ({ data: { wlaczony: false, powod: "Copilot jest wyłączony.",
    model: "claude-opus-5", maxPartia: 20 } }),
  usePomiarCopilota: () => ({ data: undefined }),
}));

/* Piąta karta (0.279.0): słownik tagów. To jedyne miejsce na tym ekranie,
   które coś ZMIENIA, więc atrapa niesie także mutację — bez niej `useMutation`
   szuka klienta zapytań, którego ten test świadomie nie stawia. */
vi.mock("../api/tagi", () => ({
  useTagi: () => ({ data: { tagi: [
    { id: 1, nazwa: "u producenta / u dostawcy", aktywny: true },
    { id: 2, nazwa: "stary tag", aktywny: false },
  ] } }),
  useZmienTag: () => ({ mutate: () => {}, isPending: false }),
}));

const { Ustawienia } = await import("./Ustawienia");

describe("Ustawienia obsługi", () => {
  it("niosą tabelę stanu integracji", () => {
    render(<MemoryRouter><Ustawienia /></MemoryRouter>);
    expect(screen.getByText("Stan integracji")).toBeInTheDocument();
    expect(screen.getByText("Połączenie Allegro")).toBeInTheDocument();
    expect(screen.getByText("Sygnatura → kartoteka Subiekta")).toBeInTheDocument();
    /* Trzecia karta (E3): brak FTS5 ma być widoczny, nie cicho pominięty. */
    expect(screen.getByText("Wiedza z opisów kartotek i ofert")).toBeInTheDocument();
    /* Ekran bez drzwi to ekran, którego nie ma — nagłówek nowej karty
       jest jedynym dowodem, że wpięcie doszło do skutku. */
    expect(screen.getByText(/Skuteczność doboru/)).toBeInTheDocument();
    expect(screen.getByText(/SQLite bez FTS5/)).toBeInTheDocument();
    /* Wyłączony Copilot nie zostawia po sobie pustej karty na ekranie. */
    expect(screen.queryByText(/Copilot — rozpoznawanie kategorii/)).not.toBeInTheDocument();
    /* Piąta karta (0.279.0) — słownik tagów. */
    expect(screen.getByText("Tagi spraw")).toBeInTheDocument();
  });

  it("słownik tagów pokazuje WYŁĄCZONE i mówi, że kasowania nie ma", () => {
    /* Skasowany tag zniknąłby po cichu ze spraw historycznych, a wtedy
       pytanie „dlaczego ta sprawa stała trzy tygodnie" traci odpowiedź. */
    render(<MemoryRouter><Ustawienia /></MemoryRouter>);
    expect(screen.getByText("stary tag")).toBeInTheDocument();
    expect(screen.getByText("wyłączony")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Włącz z powrotem" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Usuń|Skasuj/ })).not.toBeInTheDocument();
    expect(screen.getByText(/nie ma kasowania/)).toBeInTheDocument();
  });

  it("sufit aktywnych jest WIDOCZNY, nie tylko pilnowany przez serwer", () => {
    /* Odmowa przy dwudziestym pierwszym tagu, wpisanym w biegu przy sprawie,
       byłaby ścianą w połowie czynności. */
    render(<MemoryRouter><Ustawienia /></MemoryRouter>);
    expect(screen.getByText(/Aktywnych:/)).toBeInTheDocument();
    expect(screen.getByText(/z 20/)).toBeInTheDocument();
  });

  it("SKRZYNKA już jej nie renderuje, ale alarm na niej ZOSTAJE", () => {
    /* Sprawdzenie po źródle, nie po renderze: postawienie całej Skrzynki
       wymaga atrapy siedmiu zapytań, a pytanie jest o jedną rzecz — czy
       tabela ma dokładnie jedno miejsce w panelu. */
    const skrzynka = zrodloSkrzynki;
    /* Szukamy IMPORTU i ZNACZNIKA, nie samej nazwy: komentarz w Skrzynce
       nazywa ten komponent celowo, bo mówi następnemu czytelnikowi, dokąd
       tabela poszła. Dopasowanie po fragmencie kasowałoby ten trop. */
    expect(skrzynka).not.toContain('from "../skrzynka/StanIntegracji"');
    expect(skrzynka).not.toContain("<StanIntegracji");
    expect(skrzynka).toContain("<AlarmSynchronizacji");
  });

  it("zębatka i trasa istnieją — ekran bez drzwi to ekran, którego nie ma", () => {
    const rama = zrodloRamy;
    expect(rama).toContain('const USTAWIENIA = "/obsluga/ustawienia"');
    expect(rama).toContain("<Route path={USTAWIENIA}");
    expect(rama).toContain("<Link to={USTAWIENIA}");
    /* Zębatka NIE wchodzi na pasek zakładek: pasek niesie pracę, a ustawienia
       otwiera się razy kilka w miesiącu. Ten sam podział co w biurze. */
    const zakladki = rama.slice(rama.indexOf("const ZAKLADKI"), rama.indexOf("]", rama.indexOf("const ZAKLADKI")));
    expect(zakladki).not.toContain("ustawienia");
    /* Wiedza (E2) to PRACA — kolejka propozycji do rozstrzygnięcia — więc
       stoi na pasku, z trasą, jak wzmianki. */
    expect(zakladki).toContain('"/obsluga/wiedza"');
    expect(rama).toContain('<Route path="/obsluga/wiedza"');
  });
});
