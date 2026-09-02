import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StanIntegracji } from "./StanIntegracji";
import type { Zdrowie } from "../api/typy";

/* ── Ekran ma nazwać powód, a nie tylko go ocenić (0.152.0) ──────────────────
   Skrzynka stała 62 przebiegi, bo konto nie było sparowane. Serwer znał to
   zdanie i wysyłał je w tej samej odpowiedzi `/api/health`, którą ten panel
   już czytał. Na ekranie stało `failed` — słowo, które nie mówi ani co jest
   zepsute, ani co kliknąć. Właściciel szukał przyczyny w dzienniku usługi. */

const zdrowie = (n: Partial<Zdrowie> = {}): Zdrowie => ({
  allegro: { stan: "polaczone" },
  allegroInbox: {
    status: "current", alarm: false,
    ostatniaProba: "2026-09-01T09:38:00.000Z",
    ostatniaUdanaSynchronizacja: "2026-09-01T09:38:00.000Z",
    kodOstatniegoBledu: null, tekstOstatniegoBledu: null, liczbaBledow: 0,
    watkiZBledem: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 60_000,
  },
  obsluga: { rozmowyOczekujace: 0, zadaniaTerenowe: 0, najstarszeZadanieMs: null,
    kolejkaWysylek: "pusta — nic jeszcze nie poszło", wysylkiDoSprawdzenia: 0 },
  ...n,
});

const wiersz = (nazwa: string) => screen.getByText(nazwa).parentElement?.textContent ?? "";

describe("StanIntegracji", () => {
  it("wiersz o połączeniu pokazuje POŁĄCZENIE, nie status synchronizacji", () => {
    /* Do 0.152.0 etykieta „Połączenie Allegro" była podpięta pod
       `allegroInbox.status`. Ekran nazywał rzecz, której nie pokazywał —
       i dlatego niesparowane konto wyglądało jak awaria synchronizacji. */
    render(<StanIntegracji zdrowie={zdrowie({
      allegro: { stan: "niepolaczone" },
      allegroInbox: { ...zdrowie().allegroInbox, status: "failed" },
    })} odczyt={null} />);

    expect(wiersz("Połączenie Allegro")).toContain("niepolaczone");
    expect(wiersz("Synchronizacja")).toContain("failed");
  });

  it("pokazuje ZDANIE o błędzie, gdy porażka nie ma kodu HTTP", () => {
    render(<StanIntegracji zdrowie={zdrowie({
      allegroInbox: {
        ...zdrowie().allegroInbox, status: "failed", kodOstatniegoBledu: null,
        tekstOstatniegoBledu: "Konto Allegro niepołączone — /biuro → POŁĄCZ.",
      },
    })} odczyt={null} />);

    expect(wiersz("Ostatni błąd")).toContain("niepołączone");
  });

  it("bez błędu nie ma wiersza o błędzie", () => {
    render(<StanIntegracji zdrowie={zdrowie()} odczyt={null} />);
    expect(screen.queryByText("Ostatni błąd")).toBeNull();
  });
});
