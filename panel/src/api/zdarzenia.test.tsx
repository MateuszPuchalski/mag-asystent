import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useSzynaZdarzen } from "./zdarzenia";
import { klucze } from "./rozmowy";
import type { Rozmowa } from "./typy";

/* ── Szyna zdarzeń a kolejka (0.196.0) ───────────────────────────────────────
   Zdarzenie OBECNOŚCI (wejście, wyjście, „pisze") zmienia w kolejce jedną
   rzecz: znacznik „ktoś tu siedzi". Do 0.195.0 ściągało po to CAŁĄ listę
   rozmów, a `listaRozmow()` nie ma `LIMIT`-u: pomiar dał 537 kB przy tysiącu
   rozmów i 2688 kB przy pięciu tysiącach. „Pisze" jest dławione co pięć
   sekund, więc kolega redagujący odpowiedź ściągał to wszystkim co 5 s.

   Te testy pilnują obu połów umowy naraz: obecność NIE pobiera listy,
   a znacznik i tak się zmienia. Sama pierwsza połowa dałaby się spełnić
   przez skasowanie obsługi, a to jest regres, nie oszczędność.             */

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 1, klient: "Kupujący 44300444", ostatniaWiadomosc: "Czy pasuje?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "open", priorytet: "normalny", czekaOdMs: null, nowychOdOdpowiedzi: 0,
  zadanieWToku: false, dobor: "not_started", odlozoneDo: null, poTerminie: false,
  kopilot: null, oglada: null, ...n,
});

/**
 * Szyna, która oddaje ramki DOPIERO na żądanie testu.
 *
 * Kolejność ma znaczenie: `setQueryData` na pustym cache'u nie ma czego łatać,
 * a w pracy lista jest wczytana na długo przed pierwszym zdarzeniem obecności.
 * Test wysyłający ramkę przed pierwszym pobraniem mierzyłby wyścig, nie regułę.
 *
 * Odpowiedź jest RĘCZNA, nie `new Response(ReadableStream)`: w środowisku
 * testowym `Response.body.getReader()` bywa niedostępne, a wtedy `polacz()`
 * rzuca i wchodzi w pętlę ponowień — test milczałby o czymś innym, niż bada.
 */
function podstawSzyne() {
  let oddaj: ((v: { done: boolean; value?: Uint8Array }) => void) | null = null;
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () => new Promise<{ done: boolean; value?: Uint8Array }>((r) => { oddaj = r; }),
      }),
    },
  })));
  return (zdarzenia: object[]) => {
    const ramki = zdarzenia.map((z) => `data: ${JSON.stringify(z)}\n\n`).join("");
    oddaj?.({ done: false, value: new TextEncoder().encode(ramki) });
  };
}

/** Kolejka w cache'u plus podpięta szyna. `pobran` liczy odczyty listy. */
function stanowisko(lista: Rozmowa[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pobran = { ile: 0 };
  const wyslij = podstawSzyne();

  function Ekran() {
    useSzynaZdarzen(1, () => {});
    const q = useQuery({
      queryKey: klucze.rozmowy,
      queryFn: async () => { pobran.ile += 1; return { rozmowy: lista, stan: {} }; },
    });
    return <span data-testid="oglada">{q.data?.rozmowy[0]?.oglada?.name ?? "nikt"}</span>;
  }

  const widok = render(<QueryClientProvider client={qc}><Ekran /></QueryClientProvider>);
  return {
    widok, pobran,
    /* Ramki idą dopiero, gdy lista stoi w cache'u — jak w pracy. */
    wyslij: async (z: object[]) => {
      await waitFor(() => expect(pobran.ile).toBe(1));
      wyslij(z);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Szyna zdarzeń a kolejka rozmów", () => {
  it("obecność NIE ściąga listy rozmów", async () => {
    const { pobran, widok, wyslij } = stanowisko([rozmowa()]);
    await wyslij([{ id: 1, type: "presence", conversationId: 1,
      obecni: [{ userId: 9, name: "M. Wójcik", typing: true }] }]);

    await waitFor(() => expect(widok.getByTestId("oglada").textContent).toBe("M. Wójcik"));
    /* Jedno pobranie to pierwsze wejście na ekran — zdarzenie nie dołożyło drugiego. */
    expect(pobran.ile).toBe(1);
  });

  it("…ale znacznik obecności i tak się zmienia", async () => {
    const { widok, wyslij } = stanowisko([rozmowa({ oglada: null })]);
    await wyslij([{ id: 1, type: "presence", conversationId: 1,
      obecni: [{ userId: 9, name: "M. Wójcik", typing: false }] }]);

    await waitFor(() => expect(widok.getByTestId("oglada").textContent).toBe("M. Wójcik"));
  });

  it("wyjście ostatniego zdejmuje znacznik", async () => {
    /* Pusta lista obecnych to `null`, nie „zostaw jak było" — inaczej znacznik
       wisiałby po kimś, kto dawno wyszedł. */
    const { widok, wyslij } = stanowisko([rozmowa({ oglada: { userId: 9, name: "M. Wójcik" } })]);
    await wyslij([{ id: 1, type: "presence", conversationId: 1, obecni: [] }]);

    await waitFor(() => expect(widok.getByTestId("oglada").textContent).toBe("nikt"));
  });

  it("trzyma PIERWSZY, który wszedł — porządek bierzemy z serwera", async () => {
    /* `uchwyty()` na serwerze bierze najwcześniejsze wejście, a `przyRozmowie`
       oddaje listę już posortowaną po czasie. Klient bierze pierwszy element
       zamiast wyprowadzać tę regułę drugi raz. */
    const { widok, wyslij } = stanowisko([rozmowa()]);
    await wyslij([{ id: 1, type: "presence", conversationId: 1, obecni: [
      { userId: 9, name: "M. Wójcik", typing: false },
      { userId: 4, name: "A. Lewandowska", typing: true },
    ] }]);

    await waitFor(() => expect(widok.getByTestId("oglada").textContent).toBe("M. Wójcik"));
  });

  it("obecność przy INNEJ rozmowie nie rusza tego wiersza", async () => {
    const { widok, wyslij } = stanowisko([rozmowa({ id: 1, oglada: null })]);
    await wyslij([{ id: 1, type: "presence", conversationId: 77,
      obecni: [{ userId: 9, name: "M. Wójcik", typing: true }] }]);

    await waitFor(() => expect(widok.getByTestId("oglada").textContent).toBe("nikt"));
  });

  it("nowa wiadomość DALEJ ściąga listę — zmienia kolejność i treść wiersza", async () => {
    /* Oszczędność dotyczy obecności, nie wszystkiego. Zdarzenia rzadkie mają
       odświeżać natychmiast, bo od nich zależy, za co agent się bierze. */
    const { pobran, wyslij } = stanowisko([rozmowa()]);
    await wyslij([{ id: 1, type: "message.created", conversationId: 1 }]);

    await waitFor(() => expect(pobran.ile).toBe(2));
  });
});
