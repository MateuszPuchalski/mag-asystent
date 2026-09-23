import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EtykietaInstancji } from "./Instancja";

/* ── Etykieta instancji (0.446.0) ─────────────────────────────────────────
   Gwarancja przeniesiona z ikony SYSTEM w `biuro.html` (0.69.0): instancja
   inna niż produkcja jest podpisana na każdym ekranie, a produkcja nie
   dostaje znaczka wcale — wieczny znaczek przestaje być widziany. */

const HEALTH = {
  allegroInbox: { status: "current", alarm: false, ostatniaProba: null, ostatniaUdanaSynchronizacja: null,
    kodOstatniegoBledu: null, tekstOstatniegoBledu: null, liczbaBledow: 0, watkiZBledem: 0,
    opoznienieMs: null, nastepnaProba: null, interwalMs: 60000 },
  obsluga: { rozmowyOczekujace: 0, zadaniaTerenowe: 0, najstarszeZadanieMs: null, kolejkaWysylek: "pusta", wysylkiDoSprawdzenia: 0 },
};

function pokaz(srodowisko: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...HEALTH, srodowisko }))));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><EtykietaInstancji /></QueryClientProvider>);
}
afterEach(() => vi.unstubAllGlobals());

describe("EtykietaInstancji", () => {
  it("dev jest podpisany jako nie-produkcja", async () => {
    pokaz("dev");
    const znak = await screen.findByRole("status", { name: /dev — to nie jest produkcja/ });
    expect(znak).toHaveTextContent("dev");
  });

  it("produkcja nie dostaje znaczka", async () => {
    const { container } = pokaz("produkcja");
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
  });
});
