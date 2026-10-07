import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KartaAllegro } from "./Allegro";
import { atrapaZapisow } from "../test/zapisy";
import { czas } from "../ui";

/* ── Karta Allegro: Problemy z zakupem nie dochodzą ──────────────────────────
   Stan systemu mówi administratorowi, DLACZEGO skrzynka nie widzi Problemów
   z zakupem: wyłączona beta w konfiguracji albo odmowa Allegro z terminem
   następnej próby. Testy pilnują obu przyczyn, ciszy przy `null` i przy
   starszym serwerze bez pola oraz zera zapisu przy otwarciu karty. */

afterEach(() => { vi.unstubAllGlobals(); });

const POLACZONE = { stan: "polaczone", srodowisko: "produkcja", wygasa: "2026-10-08T06:00:00.000Z" };

function pokaz(status: Record<string, unknown>) {
  const zapisy = atrapaZapisow((url) => (url === "/api/biuro/allegro/status" ? status : undefined));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><KartaAllegro admin={false} /></QueryClientProvider>);
  return zapisy;
}

const plakietka = () => screen.queryByText("Problemy z zakupem nie dochodzą");

describe("karta Allegro — Problemy z zakupem", () => {
  it("`null`: karta mówi o koncie i nic o Problemach", async () => {
    const zapisy = pokaz({ ...POLACZONE, problemyZakupu: null });
    expect(await screen.findByText("połączone")).toBeInTheDocument();
    expect(plakietka()).toBeNull();
    expect(zapisy.wyslane).toEqual([]);
    expect(zapisy.nieznane).toEqual([]);
  });

  it("starszy serwer bez pola: milczy, jak przy `null`", async () => {
    pokaz(POLACZONE);
    expect(await screen.findByText("połączone")).toBeInTheDocument();
    expect(plakietka()).toBeNull();
  });

  it("wyłączona: jeden wiersz z nazwą przełącznika w konfiguracji", async () => {
    const zapisy = pokaz({ ...POLACZONE,
      problemyZakupu: { przyczyna: "wylaczona", doKiedy: null, szczegol: null } });
    const wiersz = (await screen.findByText("Problemy z zakupem nie dochodzą")).closest("p")!;
    expect(wiersz).toHaveTextContent(
      "Beta Centrum Wiadomości wyłączona w konfiguracji (ALLEGRO_WATKI_BETA=0).");
    expect(wiersz).not.toHaveTextContent(/beta\.v1/);
    expect(zapisy.wyslane).toEqual([]);
  });

  it("wstrzymana: odmowa beta.v1, termin następnej próby i zdanie Allegro", async () => {
    const doKiedy = "2026-10-07T12:30:00.000Z";
    pokaz({ ...POLACZONE, problemyZakupu: { przyczyna: "wstrzymana", doKiedy,
      szczegol: "Access to beta resource denied" } });
    const wiersz = (await screen.findByText("Problemy z zakupem nie dochodzą")).closest("p")!;
    expect(wiersz).toHaveTextContent(`Allegro odmówiło beta.v1, następna próba ${czas(doKiedy)}.`);
    expect(wiersz).toHaveTextContent("Allegro: „Access to beta resource denied”");
    expect(wiersz).not.toHaveTextContent(/ALLEGRO_WATKI_BETA/);
  });

  it("wiersz stoi także przy niepołączonym koncie, bo beta to osobna sprawa", async () => {
    pokaz({ stan: "niepolaczone", srodowisko: "produkcja", wygasa: null,
      problemyZakupu: { przyczyna: "wylaczona", doKiedy: null, szczegol: null } });
    expect(await screen.findByText("niepołączone")).toBeInTheDocument();
    expect(plakietka()).toBeInTheDocument();
  });
});
