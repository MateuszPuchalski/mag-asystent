import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Koszyk } from "./Koszyk";
import type { KoszZwrotow } from "../api/typy";

/* ── Pasek koszyka zwrotów (0.192.0) ────────────────────────────────────────
   Obieg właściciela: pusta MM przy zasiadaniu do zwrotów, dokładanie pozycja
   po pozycji, domknięcie gdy kosz się zapełni.

   Te testy pilnują dwóch punktów dekalogu, które obowiązują panel biura:
   2 (pusty kosz nie zajmuje miejsca) i 5 (przycisku „dodaj" NIE MA, bo
   dokłada ocena „na stan").                                                 */

const { odpowiedz } = vi.hoisted(() => ({ odpowiedz: { kosz: null as KoszZwrotow | null } }));

vi.mock("../api/zwroty", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useKosz: () => ({ data: odpowiedz }),
  useZamknijKosz: () => ({ mutate: zamknij, isPending: false, error: null }),
}));

const zamknij = vi.fn();

const KOSZ = (n: Partial<KoszZwrotow> = {}): KoszZwrotow => ({
  id: 3, kod: "Z-7", pozycji: 2, sztuk: 5, otwartyOd: "2026-09-03T08:00:00Z",
  pozycje: [{ symbol: "SEK-01", nazwa: "Sekator", ilosc: 2 },
    { symbol: "LOP-02", nazwa: "Łopata", ilosc: 3 }],
  ...n,
});

const pokaz = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Koszyk /></QueryClientProvider>);
};

describe("Koszyk zwrotów", () => {
  beforeEach(() => { odpowiedz.kosz = null; zamknij.mockClear(); });

  it("pusty koszyk NIE ZAJMUJE miejsca na ekranie", () => {
    /* Punkt 2 dekalogu. Stały pasek mówiący „zero" byłby elementem, który
       operator uczy się przestać widzieć — a wtedy nie zauważy go też wtedy,
       gdy zacznie coś znaczyć. */
    expect(pokaz().container).toBeEmptyDOMElement();

    odpowiedz.kosz = KOSZ({ pozycji: 0, sztuk: 0, pozycje: [] });
    expect(pokaz().container).toBeEmptyDOMElement();
  });

  it("pokazuje kod, licznik i symbole, gdy coś w nim leży", () => {
    odpowiedz.kosz = KOSZ();
    pokaz();
    expect(screen.getByText(/Koszyk Z-7/)).toBeInTheDocument();
    expect(screen.getByText(/2 poz\. · 5 szt\./)).toBeInTheDocument();
    /* SYMBOLE, nie nazwy: przy koszu liczy się to, co stoi na opakowaniu
       i na dokumencie MM. */
    expect(screen.getByText(/SEK-01, LOP-02/)).toBeInTheDocument();
  });

  it("NIE MA przycisku dodawania — dokłada ocena „na stan\"", () => {
    /* Punkt 5 dekalogu i sedno tej zmiany: naciśnięcie, które operator i tak
       wykonuje przy towarze, JEST dołożeniem do MM. Osobny przycisk kazałby
       powiedzieć dwa razy to samo. */
    odpowiedz.kosz = KOSZ();
    pokaz();
    expect(screen.queryByRole("button", { name: /dodaj|dołóż/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Zamknij koszyk/ })).toBeInTheDocument();
  });

  it("mówi WPROST, co się stanie po domknięciu", () => {
    /* Powstaje dokument w Subiekcie i kosz jedzie na halę. Ta sama zasada co
       przy korekcie: ekran nazywa skutek, zamiast go zaskakiwać. */
    odpowiedz.kosz = KOSZ();
    pokaz();
    expect(screen.getByText(/MM z magazynu głównego na regał zwrotów/)).toBeInTheDocument();
  });
});
