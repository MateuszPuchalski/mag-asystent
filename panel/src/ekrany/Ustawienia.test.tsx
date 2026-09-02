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
    kolejkaWysylek: "wysyłka wyłączona" },
};

vi.mock("../api/rozmowy", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/rozmowy")>("../api/rozmowy");
  return { ...rzeczywisty, useZdrowie: () => ({ data: zdrowie, dataUpdatedAt: 0 }) };
});

const { Ustawienia } = await import("./Ustawienia");

describe("Ustawienia obsługi", () => {
  it("niosą tabelę stanu integracji", () => {
    render(<MemoryRouter><Ustawienia /></MemoryRouter>);
    expect(screen.getByText("Stan integracji")).toBeInTheDocument();
    expect(screen.getByText("Połączenie Allegro")).toBeInTheDocument();
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
  });
});
