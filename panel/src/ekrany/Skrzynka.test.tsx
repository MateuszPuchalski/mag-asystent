import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Skrzynka } from "./Skrzynka";

/* ── ZERO ZAPISU PRZY PATRZENIU — SKRZYNKA ───────────────────────────────────
   Do 0.446.0 tę regułę trzymały też liczniki `method:` po źródle
   `biuro.html`. Plik odszedł, a skrzynka nie miała testu ekranu wcale — więc
   zapis dołożony do otwarcia przeszedłby wszystkie bramki na zielono.

   Skrzynka ma JEDEN znany zapis przy wejściu w ROZMOWĘ: zgłoszenie obecności,
   które trzyma pytanie dla agenta (decyzja właściciela, 0.159.0). Jest zapisem
   tylko z nazwy — stan żyje w pamięci procesu i do bazy nie idzie nic (patrz
   trasa `presence` w `server/src/routes/skrzynka.ts`). Samo otwarcie EKRANU,
   bez wybranej rozmowy, nie wysyła niczego.

   Atrapa `fetch` stoi pod prawdziwymi hakami, a nie pod podmienionymi.
   Podmieniony hak nie zobaczy mutacji dołożonej „przy okazji" do efektu —
   a właśnie takiej ten plik ma szukać. */

let zapisy: string[] = [];
let odczyty: string[] = [];

const ROZMOWA = {
  id: 4821, klient: "Andrzej8216A", ostatniaWiadomosc: "Czy ten szarpak pasuje do NAC LS 46-450?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "waiting_for_us", odlozoneDo: null, poTerminie: false, podziekowal: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, reklamacyjna: false,
  nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "not_started", kopilot: null,
};

/* Kształt osi jak w `skrzynka/Kontekst.test.tsx` — pełny, bo prawa kolumna
   renderuje się od razu po wczytaniu rozmowy i czyta każde z tych pól. */
const OS = {
  rozmowa: ROZMOWA,
  os: [], szkic: null, ofertaWskazana: null, zamowienie: null, zwroty: [],
  sprawy: [], droga: [], szkicCopilota: null, kandydaciZamowien: [],
  dobor: { status: "not_started", wersja: 1, brakuje: null, wybrany: null, updatedBy: null, updatedAt: null,
    dane: { marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null,
      oem: null, nazwaCzesci: null, parametry: {} } },
  oferta: null,
};

const ZDROWIE = {
  allegroInbox: { status: "current", alarm: false, ostatniaProba: null, ostatniaUdanaSynchronizacja: null,
    kodOstatniegoBledu: null, tekstOstatniegoBledu: null, liczbaBledow: 0, watkiZBledem: 0,
    opoznienieMs: null, nastepnaProba: null, interwalMs: 60000 },
  obsluga: { rozmowyOczekujace: 1, zadaniaTerenowe: 0, najstarszeZadanieMs: null,
    kolejkaWysylek: "pusta", wysylkiDoSprawdzenia: 0 },
};

beforeEach(() => {
  zapisy = []; odczyty = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    const odp = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
    if (metoda !== "GET") {
      zapisy.push(`${metoda} ${url}${init?.body !== undefined ? ` ${init.body}` : ""}`);
      return odp({ presence: [], trzyma: null });
    }
    odczyty.push(url);
    /* Szyna zdarzeń to strumień, który trwa. Zamykamy go na przerwanie
       sygnału, inaczej hak po odmontowaniu wisiałby na odczycie w nieskończoność. */
    if (url === "/api/conversations/events") {
      return new Response(new ReadableStream({ start(c) {
        init?.signal?.addEventListener("abort", () => c.error(new DOMException("przerwano", "AbortError")));
      } }), { status: 200 });
    }
    if (url === "/api/auth/me") return odp({ user: { userId: 7, name: "Anna", role: "agent" } });
    if (url === "/api/obsluga/rozmowy") return odp({ rozmowy: [ROZMOWA],
      stan: { ostatniaSynchronizacja: "2026-09-23T06:00:00.000Z", bledy: 0 } });
    if (url === "/api/obsluga/rozmowy/4821") return odp(OS);
    if (url === "/api/health") return odp(ZDROWIE);
    if (url === "/api/users") return odp({ users: [] });
    if (url === "/api/conversations/4821/zalaczniki") return odp({ zalaczniki: [] });
    if (url === "/api/obsluga/copilot/pytania/4821") return odp([]);
    /* Odczyty bloków prawej kolumny (historia klienta, dobór, kartoteka) nie
       są pytaniem tego pliku. Odmowa zamiast wymyślonego kształtu: blok pokaże
       błąd, a zapis przy patrzeniu i tak zostanie złapany wyżej. */
    return odp({ error: "poza tym testem" }, 404);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

function pokaz(adres = "/obsluga/skrzynka") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={[adres]}>
      <Routes>
        <Route path="/obsluga/skrzynka" element={<Skrzynka />} />
        <Route path="/obsluga/skrzynka/:id" element={<Skrzynka />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

describe("Skrzynka — zero zapisu przy patrzeniu", () => {
  it("otwarcie ekranu to same odczyty", async () => {
    pokaz();
    await screen.findByText("Andrzej8216A");
    expect(odczyty).toContain("/api/obsluga/rozmowy");
    expect(zapisy).toEqual([]);
  });

  it("wejście w rozmowę wysyła WYŁĄCZNIE zgłoszenie obecności", async () => {
    /* Zawężenie jest celowe: druga mutacja dołożona do wejścia — odczytanie,
       przypisanie, szkic z Copilota — wywali ten test, zamiast przejść
       niezauważona obok dozwolonej obecności. */
    pokaz();
    await userEvent.click(await screen.findByText("Andrzej8216A"));
    await waitFor(() => expect(odczyty).toContain("/api/obsluga/rozmowy/4821"));
    await waitFor(() => expect(zapisy).toEqual(['POST /api/conversations/4821/presence {"obecny":true}']));
  });
});
