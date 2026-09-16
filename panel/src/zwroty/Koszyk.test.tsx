import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Koszyk } from "./Koszyk";
import type { KoszZwrotow } from "../api/typy";

/* ── Pasek koszyka zwrotów (0.192.0) ────────────────────────────────────────
   Obieg właściciela: pusta MM przy zasiadaniu do zwrotów, dokładanie pozycja
   po pozycji, domknięcie gdy kosz się zapełni.

   Te testy pilnują dwóch punktów dekalogu, które obowiązują panel biura:
   2 (pusty kosz nie zajmuje miejsca) i 5 (przycisku „dodaj" NIE MA, bo
   dokłada ocena „na stan").                                                 */

const { odpowiedz } = vi.hoisted(() => ({
  odpowiedz: {
    kosze: [] as KoszZwrotow[],
    czekajace: [] as Array<{
      id: number; kod: string; rodzaj: "zwroty" | "odpad"; zamknietoAt: string;
      brakuje: Array<{ zwrotId: number; numer: string }>;
      blad?: string | null;
      dolozone?: Array<{ pozycjaId: number; symbol: string; nazwa: string; ilosc: number }>;
    }>,
  },
}));

vi.mock("../api/zwroty", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useKosz: () => ({ data: odpowiedz }),
  useZamknijKosz: () => ({ mutate: zamknij, isPending: false, error: null }),
  useMmMimoKorekt: () => ({ mutate: mimo, isPending: false, error: null }),
  useZdejmijTowar: () => ({ mutate: zdejmijTowar, isPending: false, error: null }),
}));

const zamknij = vi.fn();
const mimo = vi.fn();
const zdejmijTowar = vi.fn();

const KOSZ = (n: Partial<KoszZwrotow> = {}): KoszZwrotow => ({
  rodzaj: "zwroty",
  id: 3, kod: "Z-7", pozycji: 2, sztuk: 5, otwartyOd: "2026-09-03T08:00:00Z",
  pozycje: [{ id: 91, symbol: "SEK-01", nazwa: "Sekator", ilosc: 2, zeZwrotu: true },
    /* Wiersz dołożony ręką (0.365.0) — ma własną drogę wyjścia. */
    { id: 92, symbol: "LOP-02", nazwa: "Łopata", ilosc: 3, zeZwrotu: false }],
  ...n,
});

const pokaz = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Koszyk /></QueryClientProvider>);
};

describe("Koszyk zwrotów", () => {
  beforeEach(() => {
    odpowiedz.kosze = []; odpowiedz.czekajace = [];
    zamknij.mockClear(); mimo.mockClear(); zdejmijTowar.mockClear();
  });

  it("pusty koszyk NIE ZAJMUJE miejsca na ekranie", () => {
    /* Punkt 2 dekalogu. Stały pasek mówiący „zero" byłby elementem, który
       operator uczy się przestać widzieć — a wtedy nie zauważy go też wtedy,
       gdy zacznie coś znaczyć. */
    expect(pokaz().container).toBeEmptyDOMElement();

    odpowiedz.kosze = [KOSZ({ pozycji: 0, sztuk: 0, pozycje: [] })];
    expect(pokaz().container).toBeEmptyDOMElement();
  });

  it("pokazuje kod, licznik i symbole, gdy coś w nim leży", () => {
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.getByText(/Koszyk zwrotów Z-7/)).toBeInTheDocument();
    expect(screen.getByText(/2 poz\. · 5 szt\./)).toBeInTheDocument();
    /* SYMBOLE, nie nazwy: przy koszu liczy się to, co stoi na opakowaniu
       i na dokumencie MM. */
    expect(screen.getByText(/SEK-01, LOP-02/)).toBeInTheDocument();
  });

  it("NIE MA przycisku dodawania — dokłada ocena „na stan\"", () => {
    /* Punkt 5 dekalogu i sedno tej zmiany: naciśnięcie, które operator i tak
       wykonuje przy towarze, JEST dołożeniem do MM. Osobny przycisk kazałby
       powiedzieć dwa razy to samo.

       0.365.0 tego nie rusza. Dokładanie towaru spoza zgłoszenia ma własne
       miejsce — przy OTWARTYM ZWROCIE, gdzie stoi operator z kartonem — a nie
       w tym pasku, który mówi, co już w pudle leży. */
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.queryByRole("button", { name: /dodaj|dołóż/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Zamknij koszyk/ })).toBeInTheDocument();
  });

  it("mówi WPROST, co się stanie po domknięciu", () => {
    /* Powstaje dokument w Subiekcie i kosz jedzie na halę. Ta sama zasada co
       przy korekcie: ekran nazywa skutek, zamiast go zaskakiwać. */
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.getByText(/MM z magazynu głównego na regał zwrotów/)).toBeInTheDocument();
  });

  it("koszyk czekający na korekty MÓWI, na co czeka i dlaczego", () => {
    /* Bez tego zamknięty kosz bez dokumentu wygląda na zaciętą kolejkę.
       MM zdejmuje towar z magazynu głównego, a ze zwrotu wraca on tam dopiero
       po korekcie — ekran ma to powiedzieć, nie kazać się domyślać. */
    odpowiedz.czekajace = [{
      id: 9, kod: "Z-6", rodzaj: "zwroty", zamknietoAt: "2026-09-03T09:00:00Z",
      brakuje: [{ zwrotId: 1, numer: "ZW-7" }],
    }];
    pokaz();
    expect(screen.getByText(/Koszyk zwrotów Z-6/)).toBeInTheDocument();
    expect(screen.getByText(/ZW-7/)).toBeInTheDocument();
    expect(screen.getByText(/po korekcie/)).toBeInTheDocument();
  });

  it("czekający pokazuje się BEZ otwartego koszyka", () => {
    /* To praca biura, nie tego biurka: operator może nie mieć otwartego kosza,
       a zaległość i tak jest jego do dopilnowania. */
    odpowiedz.kosze = [];
    odpowiedz.czekajace = [{
      id: 9, kod: "Z-6", rodzaj: "zwroty", zamknietoAt: "2026-09-03T09:00:00Z",
      brakuje: [{ zwrotId: 1, numer: "ZW-7" }, { zwrotId: 2, numer: "ZW-8" }],
    }];
    pokaz();
    expect(screen.getByText(/czeka na korekty/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zamknij koszyk/ })).toBeNull();
  });

  it("wymuszenie MM wymaga DRUGIEGO kliknięcia i mówi, co kosztuje", async () => {
    /* Decyzja właściciela: „dodaj opcję sforsowania zamknięcia koszyka, nawet
       jeśli nie ma wszystkich ZW". To jedyne miejsce w tym panelu, w którym
       pytamy „czy na pewno" — dekalog zabrania pytania po czynności, którą coś
       już potwierdziło, a tu potwierdzić nie ma czego: skutek widać dopiero
       w Subiekcie, gdy MM się wywróci. */
    odpowiedz.czekajace = [{
      id: 9, kod: "Z-6", rodzaj: "zwroty", zamknietoAt: "2026-09-03T09:00:00Z",
      brakuje: [{ zwrotId: 1, numer: "ZW-7" }],
    }];
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Wystaw MM mimo braku korekt/ }));
    expect(mimo).not.toHaveBeenCalled();
    /* Zdanie mówi KOSZT, nie „operacja nieodwracalna": człowiek ma wiedzieć,
       co konkretnie może pójść źle. */
    expect(screen.getByText(/stan zejdzie pod zero/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Tak, wystaw MM/ }));
    expect(mimo).toHaveBeenCalledWith(9, expect.anything());
  });

  it("wycofanie się z wymuszenia NIE wystawia dokumentu", async () => {
    odpowiedz.czekajace = [{
      id: 9, kod: "Z-6", rodzaj: "zwroty", zamknietoAt: "2026-09-03T09:00:00Z",
      brakuje: [{ zwrotId: 1, numer: "ZW-7" }],
    }];
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Wystaw MM mimo braku korekt/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nie$/ }));
    expect(mimo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Wystaw MM mimo braku korekt/ }))
      .toBeInTheDocument();
  });

  it("wiersz dołożony ręką ma krzyżyk, wiersz z oceny NIE", () => {
    /* Pomyłka przy skanie nie ma oceny, którą dałoby się cofnąć — więc musi
       mieć własną drogę wyjścia. Wiersz z oceny tej drogi mieć nie może:
       kasowanie cudzej oceny z drugiej strony ekranu rozjechałoby kartę
       zwrotu z koszykiem. */
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.queryByRole("button", { name: /Zdejmij SEK-01/ })).toBeNull();
    const krzyzyk = screen.getByRole("button", { name: /Zdejmij LOP-02 z koszyka/ });
    fireEvent.click(krzyzyk);
    expect(zdejmijTowar).toHaveBeenCalledWith(92);
  });

  it("koszyk bez wierszy dołożonych ręką nie pisze o nich ani słowa", () => {
    /* Etykieta „dołożone ręką" nad pustką byłaby napisem o braku — punkt 2
       dekalogu każe pokazywać to, co potrzebne teraz. */
    odpowiedz.kosze = [KOSZ({
      pozycje: [{ id: 91, symbol: "SEK-01", nazwa: "Sekator", ilosc: 2, zeZwrotu: true }],
      pozycji: 1, sztuk: 2,
    })];
    pokaz();
    expect(screen.queryByText(/dołożone ręką/)).toBeNull();
  });

  it("kosz z ODRZUCONĄ MM mówi, co odrzuciła Sfera, i daje krzyżyk przy pomyłce", async () => {
    /* Koszyk Z-8: skanem wszedł do niego KOSZT PRZESYŁKI — kartoteka bez stanu,
       więc Sfera odrzuciła dokument zdaniem „Brak towaru w magazynie". Do
       0.370.0 taki kosz nie pokazywał się w panelu w ogóle i nie było jak go
       poprawić; zgłoszenie właściciela: „pozwól mi edytować koszyki zwrotowe,
       z których nie zostały jeszcze utworzone MM". */
    odpowiedz.czekajace = [{
      id: 8, kod: "Z-8", rodzaj: "zwroty", zamknietoAt: "2026-09-15T09:00:00Z",
      brakuje: [], blad: "Brak towaru w magazynie",
      dolozone: [{ pozycjaId: 77, symbol: "KOSZT-PRZESYLKI", nazwa: "Koszt przesyłki", ilosc: 1 }],
    }];
    pokaz();
    expect(screen.getByText(/Brak towaru w magazynie/)).toBeInTheDocument();
    /* PRZYCISKU „wystaw" NIE MA, dopóki nieudane zadanie wisi przy koszu —
       druga MM obok pierwszej dałaby dwa papiery na jedno pudło. */
    expect(screen.queryByRole("button", { name: /Wystaw MM/ })).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: /Zdejmij KOSZT-PRZESYLKI z koszyka Z-8/ }));
    expect(zdejmijTowar).toHaveBeenCalledWith(77);
  });

  it("kosz z kompletem korekt wystawia MM JEDNYM kliknięciem", async () => {
    /* Stan po poprawce: zadanie zdjęto razem z pomyłką, a nikt go nie ponawia
       sam. Pytania „czy na pewno" tu nie ma i być nie może — zdanie wyżej mówi
       o koszcie, którego w tym stanie nie ma: stan jest na miejscu. */
    odpowiedz.czekajace = [{
      id: 8, kod: "Z-8", rodzaj: "zwroty", zamknietoAt: "2026-09-15T09:00:00Z",
      brakuje: [], blad: null, dolozone: [],
    }];
    pokaz();
    expect(screen.getByText(/komplet korekt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Wystaw MM$/ }));
    expect(mimo).toHaveBeenCalledWith(8);
  });
});
