import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Dyskusja, KubelekDyskusji, WiadomoscReklamacji } from "../api/typy";

/* ── Ekran dyskusji (0.245.0) ────────────────────────────────────────────────
   Cztery rzeczy warte testu, bo żadnej nie widać w serwisie:

   1. ZERO ZAPISU PRZY PATRZENIU (blizna 0.18.0).
   2. PRZEŁĄCZENIE KUBEŁKA PRZESTAWIA KURSOR — ta sama usterka znaleziona
      okiem przy zwrotach.
   3. PUNKT ODNIESIENIA ŚWIEŻOŚCI liczy się z osi i przesuwa go TAKŻE DORADCA
      Allegro: rozmowa bywa trójstronna, a własna odpowiedź go nie rusza.
   4. NIE MA PRZYCISKU SYNCHRONIZACJI, a pasek mówi dlaczego. Dyskusje
      i reklamacje jadą jedną listą; drugi przycisk byłby drugą drogą
      w limit 429, a jego brak bez zdania czytałoby się jak usterka.        */

const dys = (id: number, kubelek: KubelekDyskusji, temat: string): Dyskusja => ({
  id, externalId: `d-${id}`, orderId: `ord-${id}`, kupujacyLogin: `klient${id}`,
  temat, opis: `Opis sprawy ${id}`,
  statusAllegro: kubelek === "zamknieta" ? "DISPUTE_CLOSED" : "DISPUTE_ONGOING",
  czatAktywny: kubelek !== "zamknieta", wiadomosciIle: 1, czatUrwany: false,
  ostatniaWiadomoscStatus: kubelek === "klient" ? "SELLER_REPLIED" : "BUYER_REPLIED",
  ostatniaWiadomoscAt: "2026-09-04T10:00:00.000Z",
  ruchNasz: kubelek === "odpowiedz", czekaOdDni: kubelek === "odpowiedz" ? 5 : null,
  dlugoCzeka: kubelek === "odpowiedz",
  otwartoAt: "2026-09-01T10:00:00.000Z", prowadzi: null, prowadziId: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, prowadziAt: null, notatka: null,
  zakonczenieStatus: null, zakonczenieAt: null, zakonczeniePrzez: null,
  wersja: 1, kubelek, sygnaly: [], linkZamowienia: null,
});

const DYSKUSJE = [
  dys(1, "odpowiedz", "Przesyłka nie dotarła"),
  dys(2, "zamknieta", "Sprawa wyjaśniona"),
  /* Pod sito „Moje": obie prowadzi „A. Lewandowska”, ale tylko sprawa 4
     należy do zalogowanego konta (7). Sprawę 5 ma IMIENNICZKA o numerze 9. */
  { ...dys(4, "odpowiedz", "Towar inny niż w opisie"),
    prowadzi: "A. Lewandowska", prowadziId: 7, tagi: [{ id: 11, nazwa: "czeka na część" }] },
  { ...dys(5, "odpowiedz", "Reklamacja ceny"),
    prowadzi: "A. Lewandowska", prowadziId: 9 },
  /* Sprawa z NUMEREM ALLEGRO W NOTATCE (0.394.0) — powód przy tej samej
     atrapie w `ekrany/Reklamacje.test.tsx`. */
  { ...dys(6, "odpowiedz", "Paczka zaginęła"),
    notatka: "zgłoszone do Allegro, sprawa ALG-98765" },
];

/* `vi.hoisted`, bo fabryka `vi.mock` jedzie przed resztą pliku. */
const scena = vi.hoisted(() => ({
  mutacje: [] as string[],
  stan: {} as Record<string, unknown>,
  czat: [] as unknown[],
}));

/* Tożsamość zalogowanego — bez niej sita „Moje" nie ma w drzewie. */
vi.mock("../api/rozmowy", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/rozmowy")>("../api/rozmowy");
  return {
    ...rzeczywisty,
    useJa: () => ({ data: { user: { userId: 7, name: "A. Lewandowska", role: "biuro" } } }),
  };
});

vi.mock("../api/tagi", () => ({
  useTagi: () => ({ data: { tagi: [{ id: 11, nazwa: "czeka na część", aktywny: true }] } }),
  useNowyTag: () => ({ mutate: () => {}, isPending: false }),
  usePrzypnijTag: () => ({ mutate: () => {}, isPending: false }),
  useOdepnijTag: () => ({ mutate: () => {}, isPending: false }),
}));

/* Załączniki wychodzące dyskusji idą trasami reklamacji (0.486.0). Atrapa
   notuje wywołania w tej samej scenie, więc „zero zapisu przy otwarciu”
   liczy także je. */
vi.mock("../api/reklamacje", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/reklamacje")>("../api/reklamacje");
  const mutacja = (nazwa: string) => () => ({
    mutate: (...a: unknown[]) => { scena.mutacje.push(`${nazwa}:${JSON.stringify(a[0])}`); },
    isPending: false, error: null,
  });
  return {
    ...rzeczywisty,
    useZalacznikiSprawy: (id: number | null) => ({
      data: id === null ? undefined : { zalaczniki: [
        { id: 5, allegroId: "att-5", nazwa: "list-przewozowy.jpg", typ: "image/jpeg", rozmiar: 900, dodal: "Ala" },
      ] },
    }),
    useDodajZalacznikSprawy: mutacja("dodajZalacznik"),
    useUsunZalacznikSprawy: mutacja("usunZalacznik"),
  };
});

vi.mock("../api/dyskusje", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/dyskusje")>("../api/dyskusje");
  const mutacja = (nazwa: string) => () => ({
    mutate: (...a: unknown[]) => {
      scena.mutacje.push(`${nazwa}:${JSON.stringify(a[0])}`);
      /* Wysyłka i prośba kończą się sukcesem, żeby test widział, co ekran
         robi PO nich (odświeżenie). Reszta procedur ma tylko `onError`. */
      (a[1] as { onSuccess?: (w: unknown) => void } | undefined)?.onSuccess?.({ status: "sent" });
    },
    isPending: false, error: null,
  });
  return {
    ...rzeczywisty,
    useDyskusje: () => ({
      data: {
        dyskusje: DYSKUSJE,
        liczniki: { odpowiedz: 3, klient: 0, zamknieta: 1 },
        stan: scena.stan,
      },
      isLoading: false, error: null,
    }),
    useDyskusja: (id: number | null) => ({
      data: id === null ? undefined : {
        dyskusja: DYSKUSJE.find((d) => d.id === id) ?? DYSKUSJE[0],
        czat: scena.czat,
        zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [], droga: [],
      },
    }),
    useProwadzeDyskusje: mutacja("prowadze"),
    useNotatkaDyskusji: mutacja("notatka"),
    useOdpowiedzWDyskusji: mutacja("odpowiedz"),
    useZakoncz: mutacja("zakoncz"),
    useOdswiezDyskusje: mutacja("odswiez"),
  };
});

const { Dyskusje } = await import("./Dyskusje");

const wiad = (n: Partial<WiadomoscReklamacji> = {}): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "klient1", autorRola: "BUYER",
  tresc: "Przesyłka nie dotarła", utworzonoAt: "2026-09-04T10:01:00.000Z",
  zalaczniki: [], ...n,
});

function pokaz(adres = "/obsluga/dyskusje", czat: WiadomoscReklamacji[] = [wiad()]) {
  scena.mutacje = [];
  scena.czat = czat;
  scena.stan = {
    status: "current", alarm: false, ostatniaProba: null,
    ostatniaUdanaSynchronizacja: "2026-09-09T11:00:00.000Z", kodOstatniegoBledu: null,
    liczbaBledow: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 180000,
    pozostaloDoPobrania: 0, dyskusjiPominietych: 35,
  };
  const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={klient}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path="/obsluga/dyskusje" element={<Dyskusje />} />
          <Route path="/obsluga/dyskusje/:id" element={<Dyskusje />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>);
}

/* Sito „Moje" pamięta wybór w przeglądarce — bez sprzątania jeden test
   włączałby filtr następnemu. */
afterEach(() => { try { localStorage.clear(); } catch { /* prywatne okno */ } });

describe("Ekran dyskusji", () => {
  /* ── ZERO ZAPISU PRZY PATRZENIU, Z TYM SAMYM WYJĄTKIEM CO REKLAMACJE ─────
     Do 24 września 2026 ten test pilnował, że wybranie sprawy nie wysyła
     niczego. Właściciel rozszerzył wyjątek z 0.410.0 na dyskusje: wejście
     w sprawę ją odświeża, bo przebieg czyta najwyżej tysiąc spraw.

     TEST ZAWĘŻA SIĘ DO JEDNEJ DOZWOLONEJ MUTACJI, nie znika. Druga mutacja
     dołożona „przy okazji” do wejścia ma go wywrócić. Samo otwarcie EKRANU
     nadal nie wysyła niczego. */
  it("otwarcie ekranu nie wywołuje mutacji, a wejście w sprawę TYLKO ją odświeża", async () => {
    pokaz();
    expect(scena.mutacje).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Przesyłka nie dotarła/ }));
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
  });

  it("powrót do TEJ SAMEJ sprawy nie pyta Allegro drugi raz", async () => {
    pokaz("/obsluga/dyskusje/1");
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
    await userEvent.click(screen.getByRole("button", { name: /Przesyłka nie dotarła/, current: true }));
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
  });

  it("przycisk odświeża na żądanie, a wysyłka i prośba dociągają sprawę", async () => {
    pokaz("/obsluga/dyskusje/1", [wiad()]);
    const ile = () => scena.mutacje.filter((m) => m.startsWith("odswiez:")).length;
    expect(ile()).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: /Odśwież z Allegro/ }));
    expect(ile()).toBe(2);
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Odpisuję");
    await userEvent.click(screen.getByRole("button", { name: /wyślij odpowiedź/i }));
    expect(ile()).toBe(3);
    await userEvent.click(screen.getByRole("button", { name: /Poproś o zakończenie/ }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /Wyślij prośbę/ }));
    expect(ile()).toBe(4);
  });

  it("prowadzący, odświeżenie i prośba o zakończenie stoją w JEDNYM wierszu", () => {
    /* Do 0.520.0 trzy osobne rzędy nad rozmową, każdy z jednym przyciskiem.
       „Odśwież z Allegro" zostaje decyzją właściciela — przeniesiony, nie
       zdjęty — więc test pilnuje obu rzeczy naraz. */
    pokaz("/obsluga/dyskusje/1", [wiad()]);
    const odswiez = screen.getByRole("button", { name: /Odśwież z Allegro/ });
    const wiersz = odswiez.parentElement!;
    expect(wiersz).toContainElement(screen.getByRole("button", { name: /Prowadzę tę sprawę/ }));
    expect(wiersz).toContainElement(screen.getByRole("button", { name: /Poproś o zakończenie/ }));
  });

  it("odpowiedź w dyskusji niesie załączniki: spinacz i zdjęcie pliku z tej sprawy", async () => {
    /* Do 0.486.0 edytor dyskusji nie miał spinacza, choć specyfikacja
       przyjmuje załącznik w wiadomości każdej sprawy. */
    pokaz("/obsluga/dyskusje/1", [wiad()]);
    expect(screen.getByRole("button", { name: "Dołącz plik" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zdejmij list-przewozowy.jpg" }));
    expect(scena.mutacje).toContain('usunZalacznik:{"id":1,"zalacznikId":5}');
  });

  it("kubełki niosą pytanie i licznik, a pytanie stoi nad listą", () => {
    pokaz();
    expect(screen.getByRole("button", { name: /Do odpowiedzi\s*3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Czeka na klienta\s*0/ })).toBeInTheDocument();
    expect(screen.getByText("Co odpisać?")).toBeInTheDocument();
  });

  it("przełączenie kubełka przestawia kursor na jego pierwszą sprawę", async () => {
    pokaz("/obsluga/dyskusje/1");
    /* Zamknięte stoją od 0.522.0 pod „Więcej", z tym samym licznikiem. */
    await userEvent.selectOptions(screen.getByLabelText("Więcej kubełków"),
      screen.getByRole("option", { name: "Zamknięte · 1" }));
    expect(screen.getByRole("button", { name: /Sprawa wyjaśniona/ }))
      .toHaveAttribute("aria-current", "true");
  });

  it("NIE MA przycisku synchronizacji, a pasek mówi, gdzie jej szukać", () => {
    /* Obie sprawy przyjeżdżają jedną listą; drugi przycisk byłby drugim
       żądaniem o to samo i drugą drogą w limit 429 (§25c.9). Od 0.392.0 zdanie
       stoi w cichym wierszu tła, więc jest krótsze — ale dalej odsyła. */
    pokaz();
    expect(screen.queryByRole("button", { name: /synchronizuj/i })).not.toBeInTheDocument();
    expect(screen.getByText(/odświeżasz ją w reklamacjach/i)).toBeInTheDocument();
  });

  it("punkt świeżości bierze ostatnią NIE naszą wiadomość, także doradcy", async () => {
    /* Rozmowa jest TRÓJSTRONNA: doradca Allegro (`ADMIN`) przesuwa punkt
       odniesienia tak samo jak kupujący, a nasza własna odpowiedź nie. */
    pokaz("/obsluga/dyskusje/1", [
      wiad({ id: 1, autorRola: "BUYER" }),
      wiad({ id: 2, autorRola: "ADMIN", tresc: "Doradca Allegro" }),
      wiad({ id: 3, autorRola: "SELLER", tresc: "Nasza odpowiedź" }),
    ]);
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Odpisuję");
    await userEvent.click(screen.getByRole("button", { name: /wyślij odpowiedź/i }));
    const wyslane = scena.mutacje.find((m) => m.startsWith("odpowiedz:"));
    expect(wyslane).toBeTruthy();
    expect(JSON.parse(wyslane!.slice("odpowiedz:".length)).expectedLastMessageId).toBe(2);
  });

  it("prośba o zakończenie idzie z wersją sprawy z ekranu", async () => {
    pokaz("/obsluga/dyskusje/1", [wiad()]);
    await userEvent.click(screen.getByRole("button", { name: /Poproś o zakończenie/ }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /Wyślij prośbę/ }));
    const wyslane = scena.mutacje.find((m) => m.startsWith("zakoncz:"));
    expect(wyslane).toBeTruthy();
    const ladunek = JSON.parse(wyslane!.slice("zakoncz:".length));
    expect(ladunek.wersja).toBe(1);
    expect(ladunek.expectedLastMessageId).toBe(1);
  });

  it("przy zamkniętej dyskusji nie ma ani edytora, ani prośby o zakończenie", () => {
    pokaz("/obsluga/dyskusje/2", [wiad()]);
    /* Pola odpowiedzi NIE MA — nie jest wyłączone. Notatka biura i wyszukiwarka
       zostają, bo dotyczą naszej pracy, nie rozmowy z kupującym. */
    expect(screen.queryByLabelText("Odpowiedź w sprawie")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Poproś o zakończenie/ })).not.toBeInTheDocument();
    expect(screen.getByText(/nowej wiadomości nie przyjmie/)).toBeInTheDocument();
  });

  /* ── Sito „Moje" (0.278.0) ────────────────────────────────────────────────
     Dyskusja i reklamacja to jeden wiersz i jedno sito. Ekran dyskusji dostaje
     je tym samym ruchem, bo „czyje to" jest tym samym pytaniem. */
  it("sito zawęża kubełek do MOICH spraw, po numerze konta, nie po imieniu", async () => {
    pokaz();
    expect(screen.getByRole("button", { name: /Towar inny niż w opisie/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reklamacja ceny/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));

    expect(screen.getByRole("button", { name: /Towar inny niż w opisie/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reklamacja ceny/ })).not.toBeInTheDocument();
  });

  it("sito mówi, ile chowa, a klawisz `m` je przełącza", async () => {
    pokaz();
    await userEvent.keyboard("m");
    expect(screen.getByText(/chowa 3 sprawy/)).toBeInTheDocument();
    await userEvent.keyboard("m");
    expect(screen.queryByText(/chowa/)).not.toBeInTheDocument();
  });

  it("szuka po TREŚCI NOTATKI — numer sprawy Allegro nie ma innego pola", async () => {
    pokaz();
    await userEvent.type(screen.getByLabelText("Szukaj dyskusji"), "ALG-98765");
    expect(screen.getByRole("button", { name: /Paczka zaginęła/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Przesyłka nie dotarła/ })).not.toBeInTheDocument();
  });

  it("szukanie po PROWADZĄCYM działa też w dyskusjach", async () => {
    pokaz();
    await userEvent.type(screen.getByLabelText("Szukaj dyskusji"), "lewandowsk");
    expect(screen.getByRole("button", { name: /Towar inny niż w opisie/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Przesyłka nie dotarła/ })).not.toBeInTheDocument();
  });

  it("tag zawęża listę także w dyskusjach — jeden słownik na oba ekrany", async () => {
    pokaz();
    expect(screen.getByTitle("Tag biura: czeka na część")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Sprawy z tagiem „czeka na część”"));
    expect(screen.getByRole("button", { name: /Towar inny niż w opisie/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reklamacja ceny/ })).not.toBeInTheDocument();
  });

  it("czip „Ty” i sito „Niczyje” działają tak samo w dyskusjach", async () => {
    /* Dyskusja i reklamacja to jeden wiersz i jedno pytanie „czyje to" —
       dwa mechanizmy byłyby dwoma nawykami zamiast jednego. */
    pokaz();
    expect(screen.getByTitle(/Prowadzisz tę sprawę/)).toHaveTextContent("Ty");

    await userEvent.click(screen.getByRole("button", { name: /^Niczyje/ }));
    expect(screen.getByRole("button", { name: /Przesyłka nie dotarła/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Towar inny niż w opisie/ }))
      .not.toBeInTheDocument();
  });

  it("skróty klawiszowe są do znalezienia także tutaj", async () => {
    pokaz();
    /* Skróty siedzą pod „?" od 0.402.0 — reguła została ta sama: pokazane
       klawisze mają być TYMI, które naprawdę działają. */
    await userEvent.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));
    expect(screen.getByText("n", { selector: "kbd" })).toBeInTheDocument();
    expect(screen.getByText(/kubełek$/)).toBeInTheDocument();
  });
});
