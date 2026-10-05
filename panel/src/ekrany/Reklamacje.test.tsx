import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Konflikt } from "../api/klient";
import type {
  DowodReklamacji, KubelekReklamacji, OstatniaDostawaReklamacji, Reklamacja, ReklamacjaUDostawcy,
  WiadomoscReklamacji, WynikWerdyktu,
} from "../api/typy";

/* ── Ekran reklamacji ────────────────────────────────────────────────────────
   Trzy rzeczy warte testu, bo żadnej nie widać w serwisie:

   1. ZERO ZAPISU PRZY PATRZENIU (blizna 0.18.0). Otwarcie ekranu i wybranie
      sprawy nie mają prawa wywołać ani jednej mutacji.
   2. PRZEŁĄCZENIE KUBEŁKA PRZESTAWIA KURSOR. Ta sama usterka znaleziona okiem
      przy zwrotach: lista się zmienia, a zaznaczenie zostaje na sprawie
      z poprzedniego kubełka.
   3. LICZBA ODSIANYCH DYSKUSJI jest widoczna. Bez niej ktoś szukałby kiedyś
      reklamacji, która nigdy reklamacją nie była.
   4. PUNKT ODNIESIENIA ŚWIEŻOŚCI (0.224.0) liczy się z osi, a własna
      odpowiedź go NIE przesuwa — inaczej druga wiadomość z rzędu wyglądałaby
      na spóźnioną i ekran pytałby o zgodę bez powodu.                      */

const rek = (id: number, kubelek: KubelekReklamacji, numer: string): Reklamacja => ({
  id, externalId: `i-${id}`, numer, orderId: `ord-${id}`, offerId: null,
  kupujacyLogin: `klient${id}`, prawo: "COMPLAINT",
  powodTyp: "NOT_AS_DESCRIBED", powodOpis: `Opis sprawy ${id}`, temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: 5000, waluta: "PLN",
  statusAllegro: kubelek === "decyzja" ? "CLAIM_SUBMITTED" : "CLAIM_ACCEPTED",
  decyzjaDo: "2026-09-20T10:00:00.000Z", dniDoTerminu: 13, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 1, czatUrwany: false,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", kupionoAt: null, kupionoZrodlo: null, dniOdZakupu: null,
  prowadzi: null, prowadziId: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, prowadziAt: null,
  notatka: null, wersja: 1, kubelek, sygnaly: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: `Towar ${id}`, ofertaZdjecie: "brak", twId: null, twSymbol: null, twZParagonu: false,
  werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktWiadomosc: null,
  werdyktKwotaGrosze: null, werdyktAt: null, werdyktPrzez: null, werdyktBlad: null,
  zwrotTowaru: null, zwrotTowaruAt: null, ilosc: 1,
});

const REKLAMACJE = [
  rek(1, "decyzja", "111/2026"),
  rek(2, "zamknieta", "222/2026"),
  /* Dwie sprawy pod sito „Moje": obie prowadzi „A. Lewandowska”, ale tylko
     444 należy do zalogowanego konta (7). 555 ma IMIENNICZKA o numerze 9
     i to jest cały sens kolumny `prowadzi_user_id`.

     NUMERY BEZ TRÓJKI I BEZ JEDYNKI są tu celowe: sąsiedni test wpisuje
     w pole szukania samą cyfrę i sprawdza, że NIC nie pasuje. Sprawa
     „333/2026” cicho by mu to zabrała. */
  { ...rek(4, "decyzja", "444/2026"), prowadzi: "A. Lewandowska", prowadziId: 7,
    tagi: [{ id: 11, nazwa: "czeka na część" }] },
  { ...rek(5, "decyzja", "555/2026"), prowadzi: "A. Lewandowska", prowadziId: 9 },
  /* Sprawa z NUMEREM ALLEGRO W NOTATCE (0.394.0). Zgłoszenie paczki, która nie
     dotarła, wraca z numerem, dla którego nie mamy własnego pola — biuro pisze
     go w notatce i potem po nim szuka. */
  { ...rek(6, "decyzja", "666/2026"), notatka: "zgłoszone do Allegro, sprawa ALG-98765" },
];

/* `vi.hoisted`, bo fabryka `vi.mock` jedzie przed resztą pliku. */
const scena = vi.hoisted(() => ({
  mutacje: [] as string[],
  stan: {} as Record<string, unknown>,
  czat: [] as unknown[],
  /* Czym kończy się wysyłka w danym teście: `Error` idzie do `onError`,
     cokolwiek innego do `onSuccess`, `null` nie woła żadnego z nich. */
  wynikWysylki: null as unknown,
  /* Błąd ręcznej synchronizacji — `null` znaczy, że przycisk nie zawiódł. */
  bladSynchronizacji: null as Error | null,
  /* Dowody biura w szczególe sprawy; domyślnie żadnych. */
  dowody: [] as DowodReklamacji[],
  /* Ostatnia dostawa i nasze zgłoszenie u dostawcy w szczególe sprawy. */
  dostawa: null as OstatniaDostawaReklamacji | null,
  uDostawcy: null as ReklamacjaUDostawcy | null,
  /* Czym kończy się werdykt: `Error` do `onError`, wynik do `onSuccess`,
     `null` nie woła żadnego. `poWerdykcie` udaje dociągnięcie sprawy, zanim
     ekran dostanie wynik — tak jak robi to `onSettled` prawdziwego haka. */
  wynikWerdyktu: null as unknown,
  poWerdykcie: null as null | (() => void),
}));

/* Tożsamość zalogowanego: bez niej sita „Moje" nie ma w drzewie, bo filtr
   dający zawsze pustkę byłby gorszy od braku filtru. */
vi.mock("../api/rozmowy", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/rozmowy")>("../api/rozmowy");
  return {
    ...rzeczywisty,
    useJa: () => ({ data: { user: { userId: 7, name: "A. Lewandowska", role: "biuro" } } }),
  };
});

/* Tagi: atrapa bez klienta zapytań, bo ten ekran stawia własny `QueryClient`
   tylko dla haków reklamacji. */
vi.mock("../api/tagi", () => ({
  useTagi: () => ({ data: { tagi: [
    { id: 11, nazwa: "czeka na część", aktywny: true },
    { id: 12, nazwa: "u producenta", aktywny: true },
  ] } }),
  useNowyTag: () => ({ mutate: () => {}, isPending: false }),
  usePrzypnijTag: () => ({ mutate: () => {}, isPending: false }),
  useOdepnijTag: () => ({ mutate: () => {}, isPending: false }),
}));

vi.mock("../api/reklamacje", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/reklamacje")>("../api/reklamacje");
  const mutacja = (nazwa: string) => () => ({
    mutate: (...a: unknown[]) => { scena.mutacje.push(`${nazwa}:${JSON.stringify(a[0])}`); },
    isPending: false, error: null,
  });
  return {
    ...rzeczywisty,
    useReklamacje: () => ({
      data: {
        reklamacje: REKLAMACJE,
        liczniki: { decyzja: 3, odpowiedz: 0, zamknieta: 1 },
        stan: scena.stan,
      },
      isLoading: false, error: null,
    }),
    useReklamacja: (id: number | null) => ({
      data: id === null ? undefined : {
        reklamacja: REKLAMACJE.find((r) => r.id === id) ?? REKLAMACJE[0],
        czat: scena.czat,
        zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [], droga: [], kartoteka: null,
        dowody: scena.dowody, dostawa: scena.dostawa, uDostawcy: scena.uDostawcy,
      },
    }),
    /* Wysyłka ma WŁASNY podrabiacz, bo jako jedyna oddaje sterowanie z
       powrotem do ekranu: to `onSuccess`/`onError` rozstrzygają, czy pole się
       wyczyści i czy otworzy się dialog konfliktu. */
    useOdpowiedz: () => ({
      mutate: (v: unknown, opcje?: {
        onSuccess?: (w: unknown) => void; onError?: (e: unknown) => void;
      }) => {
        scena.mutacje.push(`odpowiedz:${JSON.stringify(v)}`);
        const w = scena.wynikWysylki;
        if (w instanceof Error) opcje?.onError?.(w);
        else if (w) opcje?.onSuccess?.(w);
      },
      isPending: false, error: null,
    }),
    useOdswiez: mutacja("odswiez"),
    useProwadze: mutacja("prowadze"),
    useNotatka: mutacja("notatka"),
    /* Synchronizacja ma własny podrabiacz z tego samego powodu co wysyłka:
       błąd wraca do ekranu przez `onError`, a test pilnuje, że go widać. */
    useSynchronizuj: () => ({
      mutate: (v: unknown, opcje?: { onError?: (e: unknown) => void }) => {
        scena.mutacje.push(`synchronizuj:${JSON.stringify(v)}`);
        if (scena.bladSynchronizacji) opcje?.onError?.(scena.bladSynchronizacji);
      },
      isPending: false, error: null,
    }),
    /* Werdykt ma własny podrabiacz: los stanowiska o towarze wraca do ekranu
       w `onSuccess` i to on rozstrzyga, czy staje krok zapasowy albo dialog. */
    useWerdykt: () => ({
      mutate: (v: unknown, opcje?: {
        onSuccess?: (w: unknown) => void; onError?: (e: unknown) => void;
      }) => {
        scena.mutacje.push(`werdykt:${JSON.stringify(v)}`);
        const w = scena.wynikWerdyktu;
        if (w instanceof Error) opcje?.onError?.(w);
        else if (w) { scena.poWerdykcie?.(); opcje?.onSuccess?.(w); }
      },
      isPending: false, error: null,
    }),
    useZwrotTowaru: mutacja("zwrot-towaru"),
    /* Zgłoszenie u dostawcy to nasz zapis — test zera zapisu ma je widzieć. */
    useZapiszUDostawcy: mutacja("u-dostawcy"),
    /* Dowody biura to zapisy, więc test zera zapisu ma je WIDZIEĆ — prawdziwy
       hak wysłałby żądanie obok licznika `mutacje`. */
    useDodajDowod: mutacja("dodaj-dowod"),
    useUsunDowod: mutacja("usun-dowod"),
  };
});

const { Reklamacje } = await import("./Reklamacje");
const { zapamietajSzkic } = await import("../sprawy/useSzkicSprawy");

const wiad = (n: Partial<WiadomoscReklamacji> = {}): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "klient1", autorRola: "BUYER",
  tresc: "Kosiarka przestała ciąć", utworzonoAt: "2026-09-06T10:01:00.000Z",
  zalaczniki: [{ id: 9, wiadomoscId: 1, nazwa: "usterka.jpg", podglad: true }], ...n,
});

function pokaz(adres = "/obsluga/reklamacje", czat: WiadomoscReklamacji[] = [wiad()],
  stan: Record<string, unknown> = {}) {
  scena.mutacje = [];
  scena.czat = czat;
  scena.wynikWysylki = null;
  scena.wynikWerdyktu = null;
  scena.bladSynchronizacji = null;
  scena.stan = {
    status: "current", alarm: false, ostatniaProba: null,
    ostatniaUdanaSynchronizacja: "2026-09-07T11:00:00.000Z", kodOstatniegoBledu: null,
    liczbaBledow: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 180000,
    pozostaloDoPobrania: 0, dyskusjiPominietych: 35, ...stan,
  };
  const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={klient}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path="/obsluga/reklamacje" element={<Reklamacje />} />
          <Route path="/obsluga/reklamacje/:id" element={<Reklamacje />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>);
}

/* Sito „Moje" PAMIĘTA wybór w przeglądarce, więc bez tego sprzątania jeden
   test włączałby filtr następnemu — a objawem byłaby lista, która „gubi"
   sprawy w teście nie mającym z sitem nic wspólnego. */
afterEach(() => { try { localStorage.clear(); } catch { /* prywatne okno */ } });
/* Dowody ustawia test PRZED renderem, więc sprząta się je po nim. */
afterEach(() => {
  scena.dowody = []; scena.dostawa = null; scena.uDostawcy = null; scena.poWerdykcie = null;
});

/* ── MUTACJE BEZ ODŚWIEŻENIA WEJŚCIOWEGO (0.410.0) ──────────────────────────
   Od tego wydania wejście w sprawę wysyła JEDNĄ mutację: `odswiez` (decyzja
   właściciela, uzasadnienie przy teście „otwarcie ekranu…"). Testy pytające
   „co wysłał TEN przycisk" mają pytać dalej o to samo, więc odsiewają ją tu —
   w jednym miejscu, a nie ośmioma poprawkami rozsypanymi po pliku.

   ODSIEW JEST WĄSKI CELOWO: filtruje wyłącznie `odswiez`, więc druga mutacja
   dołożona kiedyś „przy okazji" do otwarcia sprawy wywali te testy, zamiast
   przejść niezauważona. */
const bezOdswiezenia = () => scena.mutacje.filter((m) => !m.startsWith("odswiez:"));

/** Stopka karty kolejki: próg, stan synchronizacji i jej przycisk. */
const stopka = () => screen.getByRole("group", { name: "Zakres i synchronizacja kolejki" });

describe("Ekran reklamacji", () => {
  /* ── ZERO ZAPISU PRZY PATRZENIU, Z JEDNYM WYJĄTKIEM (0.410.0) ──────────────
     Do 0.409.0 ten test pilnował, że otwarcie ekranu i wybranie sprawy nie
     wywołują ŻADNEJ mutacji. Decyzja właściciela z 19 września 2026 wprowadza
     dokładnie jeden wyjątek: „możesz po prostu odświeżyć reklamację, jak w nią
     wejdę?".

     Powód jest mierzalny, a nie estetyczny. Przebieg synchronizacji czyta
     najwyżej tysiąc spraw, więc ogona archiwum nie odświeża NIGDY — agent
     patrzył na status sprzed tygodni, nie sprzed trzech minut.

     TEST NIE ZNIKA, TYLKO ZAWĘŻA SIĘ DO JEDNEJ DOZWOLONEJ MUTACJI. To jest
     cała jego wartość: gdyby ktoś dołożył drugą (a „przy okazji" kusi), ten
     plik ma odmówić. Samo otwarcie EKRANU, bez wybranej sprawy, nadal nie
     wysyła niczego.                                                        */
  it("otwarcie ekranu nie wywołuje mutacji, a wejście w sprawę TYLKO ją odświeża", async () => {
    pokaz();
    expect(scena.mutacje).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /111\/2026/ }));
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
  });

  it("powrót do TEJ SAMEJ sprawy nie pyta Allegro drugi raz", async () => {
    /* Odświeżenie kosztuje żądanie u dostawcy, więc należy się wejściu
       w sprawę, a nie każdemu renderowi ekranu. */
    pokaz("/obsluga/reklamacje/1");
    /* Numer stoi i w kolejce, i w kolumnie dowodów — bierzemy WIERSZ, czyli
       ten z kursorem. */
    const wiersz = await screen.findByRole("button", { name: /111\/2026/, current: true });
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
    await userEvent.click(wiersz);
    /* Drugie wejście w tę samą sprawę nie pyta Allegro znowu. */
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
  });

  it("kubełki niosą pytanie i licznik, a pytanie stoi nad listą", () => {
    pokaz();
    expect(screen.getByTitle(/Uznać czy odrzucić\? \(klawisz 1\)/)).toBeInTheDocument();
    expect(screen.getByTitle(/Co odpisać klientowi\? \(klawisz 2\)/)).toBeInTheDocument();
    /* Pytanie zastępuje menu akcji — dekalog, punkt 5. */
    expect(screen.getByText("Uznać czy odrzucić?")).toBeInTheDocument();
  });

  it("kubełki „tylko wgląd” stoją pod „Więcej” z licznikiem, a cyfra dalej je wybiera", async () => {
    pokaz();
    expect(screen.queryByRole("button", { name: /Rozstrzygnięte/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Rozstrzygnięte · \d+$/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Bez ruchu · \d+$/ })).toBeInTheDocument();
    await userEvent.keyboard("3");
    const lista = screen.getByLabelText("Więcej kubełków") as HTMLSelectElement;
    expect(lista.selectedOptions[0].textContent).toMatch(/^Rozstrzygnięte/);
  });

  it("kubełek DO DECYZJI pokazuje tylko sprawy przed werdyktem", () => {
    pokaz();
    expect(screen.getByText("111/2026")).toBeInTheDocument();
    expect(screen.queryByText("222/2026")).not.toBeInTheDocument();
  });

  it("przełączenie kubełka przestawia KURSOR na jego pierwszą sprawę", async () => {
    pokaz("/obsluga/reklamacje/1");
    /* Rozstrzygnięte stoją od 0.522.0 pod „Więcej" — wybór z listy jest tym
       samym przełączeniem kubełka co klik w pigułkę. */
    await userEvent.selectOptions(screen.getByLabelText("Więcej kubełków"),
      screen.getByRole("option", { name: /^Rozstrzygnięte/ }));
    /* Bez przestawienia kursora środkowa kolumna pokazywałaby rozmowę ze
       sprawy z poprzedniego kubełka. Wiersz kolejki JEST wybrany — a numer
       stoi też w kolumnie dowodów, i od 0.403.0 w PRZYCISKU: nagłówek zwijki
       „Sprawa" niesie go w podpisie. Szukamy więc po `aria-current`, czyli po
       tym, co test naprawdę sprawdza — który wiersz jest kursorem. */
    const wiersz = await screen.findByRole("button", { name: /222\/2026/, current: true });
    expect(wiersz).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
  });

  it("liczba odsianych dyskusji stoi na pasku — to zakres panelu, nie błąd", () => {
    /* Od 0.392.0 tło pracy mieści się w JEDNYM cichym wierszu, więc zdanie
       jest krótsze — ale liczba zostaje. Nikt nie ma szukać „zaginionej"
       reklamacji, która nigdy reklamacją nie była. */
    pokaz();
    expect(within(stopka()).getByText(/pominiętych dyskusji 35/)).toBeInTheDocument();
  });

  /* ── TŁO PRACY W STOPCE KOLEJKI ───────────────────────────────────────────
     Decyzja właściciela: rząd progu i synchronizacji stoi pod ostatnim
     wierszem kolejki, bo mówi o zakresie tej listy, a sprawie oddaje pełną
     wysokość. Teksty są te same co w paskach strony; testy niżej pilnują
     MIEJSCA. */
  it("stopka stoi W KARCIE KOLEJKI, pod ostatnim wierszem, a nie nad kolumnami", () => {
    pokaz();
    const pasek = stopka();
    /* Ta sama karta co pole szukania — czyli kolejka, nie pas strony. */
    expect(pasek.parentElement).toContainElement(screen.getByLabelText("Szukaj reklamacji"));
    const wiersze = screen.getAllByRole("button", { name: /\/2026/ });
    expect(wiersze[wiersze.length - 1].compareDocumentPosition(pasek)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* Nad siatką kolumn nie zostało nic z dawnego rzędu. */
    expect(screen.getAllByText(/pominiętych dyskusji/)).toHaveLength(1);
  });

  it("w ALARMIE stopka niesie głośny pasek i dalej JEDEN przycisk synchronizacji", async () => {
    pokaz("/obsluga/reklamacje", [wiad()], { status: "failed", kodOstatniegoBledu: 503 });
    const pasek = stopka();
    expect(within(pasek).getByText(/Synchronizacja reklamacji:/)).toBeInTheDocument();
    expect(within(pasek).getByText("nie działa")).toBeInTheDocument();
    expect(within(pasek).getByText(/dyskusji pominiętych:/)).toBeInTheDocument();
    /* Cichy wiersz ustępuje głośnemu — dwa przyciski to dwie drogi do 429. */
    expect(screen.getAllByRole("button", { name: /synchronizuj/i })).toHaveLength(1);
    expect(scena.mutacje).toEqual([]);
    await userEvent.click(within(pasek).getByRole("button", { name: /synchronizuj/i }));
    expect(scena.mutacje).toEqual(["synchronizuj:undefined"]);
  });

  it("niekompletna lista woła w stopce pełnym zdaniem", () => {
    pokaz("/obsluga/reklamacje", [wiad()], { pozostaloDoPobrania: 12 });
    expect(within(stopka()).getByText(/Ta kolejka nie jest kompletna: 12 spraw/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /synchronizuj/i })).toHaveLength(1);
  });

  it("w pełnej ciszy przycisk synchronizacji zostaje — dyskusje odsyłają tutaj", () => {
    /* Bez progu i bez odsianych dyskusji cichy wiersz nie ma nic do
       powiedzenia. Ekran dyskusji nie ma własnego przycisku i mówi, że
       synchronizację odświeża się w reklamacjach — więc tu nie może zniknąć. */
    pokaz("/obsluga/reklamacje", [wiad()], { dyskusjiPominietych: 0 });
    expect(within(stopka()).getAllByRole("button", { name: /synchronizuj/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /synchronizuj/i })).toHaveLength(1);
  });

  it.each([["w ciszy", {}], ["w alarmie", { status: "delayed" }]])(
    "błąd synchronizacji widać zawsze — %s", async (_opis, stan) => {
      pokaz("/obsluga/reklamacje", [wiad()], stan);
      scena.bladSynchronizacji = new Error("Allegro odmówiło: limit zapytań");
      await userEvent.click(screen.getByRole("button", { name: /synchronizuj/i }));
      expect(within(stopka()).getByText("Allegro odmówiło: limit zapytań")).toBeInTheDocument();
    });

  it("pasek werdyktu stoi ZA rozmową i pod faktami, bo nieodwracalne pyta po dowodach", () => {
    /* Od przyrostu trzeciego werdykt wychodzi STĄD. Napis odsyłający do
       Centrum Sprzedaży byłby nieprawdą — tak samo jak w 0.224.0 napis
       o odpowiedzi.

       KOLEJNOŚĆ JEST UMOWĄ. Pasek będący pierwszym elementem kolumny pytał
       „uznać czy odrzucić", zanim ekran pokazał treść zgłoszenia. Dekalog
       obsługi, punkt 9: nieodwracalne pyta — a pytanie zadaje się PO
       dowodach, nie przed nimi. Stoi w kolumnie faktów, zaraz pod liczbami,
       z których się go wydaje, i nad zwijkami ze szczegółem. */
    pokaz("/obsluga/reklamacje/1");
    const pasek = screen.getByRole("region", { name: "Werdykt" });
    expect(pasek).toBeInTheDocument();
    const rozmowa = screen.getByText("Opis sprawy 1");
    /* `DOCUMENT_POSITION_FOLLOWING` liczone OD rozmowy: pasek ma stać za nią. */
    expect(rozmowa.compareDocumentPosition(pasek)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const fakty = screen.getByText("Klient zapłacił");
    expect(fakty.compareDocumentPosition(pasek) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pasek.compareDocumentPosition(screen.getByRole("button", { name: /Zakup i oferta/ }))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Uznaję/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Odrzucam/ })).toBeInTheDocument();
    expect(screen.queryByText(/Centrum Sprzedaży/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Odpowiedź .* wysyła się/)).not.toBeInTheDocument();
  });

  it("werdykt z ekranu niesie WERSJĘ sprawy i idzie dopiero po zgodzie", async () => {
    /* Wersja z ekranu jest obowiązkowa po stronie serwera: werdykt bez
       wiedzy, na co agent patrzył, to werdykt w ciemno. Ekran ją dokłada sam. */
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByRole("button", { name: /Odrzucam/ }));
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), "Towar sprawny.");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /Wyślij werdykt/ }));
    expect(bezOdswiezenia()).toEqual([
      `werdykt:${JSON.stringify({
        id: 1, werdykt: "REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED",
        wiadomosc: "Towar sprawny.", kwotaGrosze: null, wersja: 1,
      })}`,
    ]);
  });

  it("bez wybranej sprawy środek zaprasza do kolejki, zamiast świecić pustką", () => {
    pokaz();
    expect(screen.getByText(/Wybierz reklamację z kolejki/)).toBeInTheDocument();
  });

  it("„synchronizuj teraz” jest JAWNYM kliknięciem, nie skutkiem otwarcia", async () => {
    pokaz();
    expect(scena.mutacje).toEqual([]);
    /* Przycisk jest jeden na ekran i stoi w stopce kolejki. */
    expect(within(stopka()).getByRole("button", { name: /synchronizuj/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /synchronizuj/i }));
    expect(scena.mutacje).toEqual(["synchronizuj:undefined"]);
  });

  it("„prowadzę” jedzie z WERSJĄ rekordu — inaczej nadpisałoby pracę kolegi", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByRole("button", { name: /Prowadzę tę sprawę/ }));
    expect(bezOdswiezenia()).toEqual([`prowadze:${JSON.stringify({ id: 1, wersja: 1 })}`]);
  });

  it("cyfra przełącza kubełek, ale NIE wtedy, gdy piszesz w polu", async () => {
    pokaz("/obsluga/reklamacje/1");
    const pole = screen.getByLabelText("Szukaj reklamacji");
    await userEvent.type(pole, "3");
    expect(pole).toHaveValue("3");
    /* Kubełek się NIE przełączył: gdyby cyfra przeszła do skrótów, ekran
       stałby w kubełku ROZSTRZYGNIĘTE i pokazywał sprawę 222/2026. Zamiast
       tego stoi filtr, który do niczego nie pasuje. */
    expect(screen.getByText(/nie pasuje do tego, czego szukasz/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /222\/2026/ })).not.toBeInTheDocument();
  });

  it("odpowiedź jedzie z WERSJĄ i z ostatnią NIE naszą wiadomością", async () => {
    /* Własna odpowiedź NIE przesuwa punktu odniesienia. Gdyby przesuwała,
       druga wiadomość z rzędu wyglądałaby na spóźnioną i ekran pytałby
       o zgodę, mimo że po naszej stronie nic się nie zmieniło. */
    pokaz("/obsluga/reklamacje/1", [
      wiad(),
      wiad({ id: 2, externalId: "w-2", autorRola: "SELLER", tresc: "Proszę o zdjęcie" }),
    ]);
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odpowiedź/ }));
    expect(bezOdswiezenia()).toEqual([`odpowiedz:${JSON.stringify({
      id: 1, tresc: "Wysyłam nowy nóż", expectedWersja: 1,
      expectedLastMessageId: 1, mimoNowejWiadomosci: false,
    })}`]);
  });

  it("dopisek DORADCY otwiera dialog zgody i nazywa go po imieniu", async () => {
    /* 409 z `nowaWiadomosc` to jedyny konflikt wymagający decyzji człowieka.
       Autorem bywa doradca Allegro, nie kupujący — dialog, który nazwałby go
       klientem, mówiłby nieprawdę o tym, na co agent patrzy. */
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = new Konflikt("Ktoś dopisał wiadomość", {
      lastMessageId: 7, kluczIdempotencji: "rek-1-7-ab12",
      nowaWiadomosc: { id: 7, tresc: "Proszę o zdjęcie noża", at: null, rola: "ADMIN" },
    });
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odpowiedź/ }));
    expect(screen.getByRole("dialog", { name: "Wysyłka zatrzymana" })).toBeInTheDocument();
    expect(screen.getByText(/doradca Allegro dopisał wiadomość/)).toBeInTheDocument();
    /* Szkic zostaje NIETKNIĘTY: serwer odrzucił wysyłkę przed strzałem. */
    expect(screen.getByLabelText("Odpowiedź w sprawie")).toHaveValue("Wysyłam nowy nóż");
  });

  it("po j edytor nowej sprawy liczy zwłokę od nowa: szybkie Ctrl+Enter nie wysyła jej szkicu", async () => {
    /* Ekran nie montuje się od nowa przy przejściu, więc edytor dostaje klucz
       sprawy. Bez niego zegar zwłoki szedłby od otwarcia POPRZEDNIEJ sprawy,
       a podwójne Ctrl+Enter wysłałoby szkic nowej bez jednego spojrzenia. */
    for (const r of REKLAMACJE) zapamietajSzkic("reklamacja", r.id, `Szkic sprawy ${r.id}`);
    pokaz("/obsluga/reklamacje/1");
    const zegar = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    await userEvent.keyboard("j");
    expect(screen.getByLabelText("Odpowiedź w sprawie")).not.toHaveValue("Szkic sprawy 1");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    zegar.mockRestore();
    expect(bezOdswiezenia().filter((m) => m.startsWith("odpowiedz:"))).toEqual([]);
  });

  it("okno konfliktu bierze fokus: pisanie nie idzie w szkic pod nakładką (0.546.0)", async () => {
    /* Ctrl+Enter wysyła z pola, więc okno otwierało się z kursorem dalej
       w polu. Pisanie szło w szkic, którego pod nakładką nie widać, a drugie
       Ctrl+Enter próbowało wysłać znowu. Fokus startuje na POPRAW SZKIC,
       a Escape oddaje go polu z nietkniętym szkicem. */
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = new Konflikt("Ktoś dopisał wiadomość", {
      lastMessageId: 7, kluczIdempotencji: "rek-1-7-ab12",
      nowaWiadomosc: { id: 7, tresc: "Dopisuję", at: null, rola: "BUYER" },
    });
    const pole = screen.getByLabelText("Odpowiedź w sprawie");
    await userEvent.type(pole, "Wysyłam nowy nóż");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByRole("dialog", { name: "Wysyłka zatrzymana" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "POPRAW SZKIC" }));
    await userEvent.keyboard("x");
    expect(pole).toHaveValue("Wysyłam nowy nóż");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(pole);
    expect(pole).toHaveValue("Wysyłam nowy nóż");
  });

  it("„WYŚLIJ MIMO TO” jest martwy do jawnej zgody, a potem niesie flagę", async () => {
    /* Blizna 0.110.0: do niej odpowiedź szła na starą wersję pytania po cichu.
       Flaga MUSI dojechać — w skrzynce gubi ją trasa i nikt tego nie zauważył
       przez cztery wydania. */
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = new Konflikt("Ktoś dopisał wiadomość", {
      lastMessageId: 7, kluczIdempotencji: "rek-1-7-ab12",
      nowaWiadomosc: { id: 7, tresc: "Dopisuję", at: null, rola: "BUYER" },
    });
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odpowiedź/ }));
    expect(screen.getByText(/klient dopisał wiadomość/)).toBeInTheDocument();
    const mimoTo = screen.getByRole("button", { name: "WYŚLIJ MIMO TO" });
    expect(mimoTo).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    scena.mutacje = [];
    await userEvent.click(mimoTo);
    expect(bezOdswiezenia()).toEqual([`odpowiedz:${JSON.stringify({
      id: 1, tresc: "Wysyłam nowy nóż", expectedWersja: 1,
      expectedLastMessageId: 1, mimoNowejWiadomosci: true,
    })}`]);
  });

  it("po wysłaniu pole się czyści, a po niejednoznacznym wyniku — NIE", async () => {
    /* Wyczyszczone pole po timeoucie znaczyłoby, że agent napisze tekst
       drugi raz, nie wiedząc, czy pierwszy poszedł. */
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = { status: "sent" };
    const pole = screen.getByLabelText("Odpowiedź w sprawie");
    await userEvent.type(pole, "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odpowiedź/ }));
    expect(pole).toHaveValue("");

    scena.wynikWysylki = { status: "send_uncertain" };
    await userEvent.type(pole, "Druga próba");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odpowiedź/ }));
    expect(pole).toHaveValue("Druga próba");
    expect(screen.getByText(/nie dała jednoznacznej odpowiedzi/)).toBeInTheDocument();
  });

  it("odmowa BEZ dopisku to jedno zdanie pod polem, nie dialog", async () => {
    /* Zamknięta rozmowa i rozjazd wersji nie wymagają decyzji — wymagają
       przeczytania. Dialog nad ekranem byłby tu kosztem bez zysku. */
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = new Konflikt(
      "Allegro zamknęło rozmowę w tej sprawie i nie przyjmie nowej wiadomości.", {});
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odpowiedź/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/Allegro zamknęło rozmowę/)).toBeInTheDocument();
  });

  it("zamknięta rozmowa nie daje pola do pisania — ani wyłączonego, ani żadnego", () => {
    /* `czatAktywny` idzie z rekordu przez ekran do edytora. Test stoi tutaj,
       a nie tylko przy edytorze, bo gubi się właśnie na tej drodze. */
    REKLAMACJE[1].czatAktywny = false;
    try {
      pokaz("/obsluga/reklamacje/2");
      expect(screen.queryByLabelText("Odpowiedź w sprawie")).not.toBeInTheDocument();
      expect(screen.getByText(/nowej wiadomości nie przyjmie/)).toBeInTheDocument();
    } finally {
      REKLAMACJE[1].czatAktywny = true;
    }
  });

  it("po udanej wysyłce ekran DOCIĄGA sprawę, zamiast czekać na takt", async () => {
    /* Stan sprawy po stronie Allegro zmienił się przed chwilą, a takt przyjdzie
       za trzy minuty (0.273.0). Przy wyniku niejednoznacznym to jedno żądanie
       rozstrzyga, czy wiadomość poszła — czyli dokładnie to, po co pasek
       odsyłał do Centrum Sprzedaży. */
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = { status: "sent" };
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odpowiedź/ }));
    expect(scena.mutacje).toContain(`odswiez:${JSON.stringify({ id: 1 })}`);
  });

  it("nieudana wysyłka NIE dociąga sprawy — nie ma czego dociągać", async () => {
    pokaz("/obsluga/reklamacje/1");
    /* Wejście w sprawę odświeża ją raz (0.410.0). Pytanie tego testu brzmi:
       czy NIEUDANA WYSYŁKA dokłada drugie odświeżenie — i ma nie dokładać. */
    const przed = scena.mutacje.filter((m) => m.startsWith("odswiez:")).length;
    scena.wynikWysylki = new Konflikt("Allegro zamknęło rozmowę w tej sprawie", {});
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odpowiedź/ }));
    expect(scena.mutacje.filter((m) => m.startsWith("odswiez:")).length).toBe(przed);
  });

  /* ── Sito „Moje" (0.278.0) ────────────────────────────────────────────────
     Powstało z jednego zdania właściciela: „chodziło mi, abym łatwiej mógł
     znaleźć reklamacje, którymi się zajmuję". */
  it("sito zawęża kubełek do MOICH spraw, po numerze konta, nie po imieniu", async () => {
    pokaz();
    /* Obie sprawy w kubełku „Do decyzji" prowadzi „A. Lewandowska” — tyle że
       jedna z nich to imienniczka o innym numerze konta. */
    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));

    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /555\/2026/ })).not.toBeInTheDocument();
  });

  it("sito MÓWI, ile chowa, i oddaje drogę powrotną", async () => {
    /* Wybór jest pamiętany między otwarciami ekranu, więc milczące sito
       zagłodziłoby sprawy nieprzypisane — ta sama klasa błędu co rozmowa
       urwana bez znaku w 0.273.0. */
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    /* Kubełek „Do decyzji" ma cztery sprawy, moja jest jedna — sito chowa trzy.
       Liczebnik w formie 2–4, bo „chowa 3 spraw" czyta się jak usterka. */
    expect(screen.getByText(/chowa 3 sprawy/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "pokaż wszystkie" }));
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
  });

  it("cyfry idą za kubełkami: 4 to „Bez ruchu”, 5 to „Wszystkie”", async () => {
    /* 0.525.1: 1–3 i „4 = Wszystkie" stały na sztywno, choć kubełki są
       cztery — „Bez ruchu" nie miał klawisza, a podpowiedzi obiecywały 4 i 5. */
    pokaz();
    await userEvent.keyboard("4");
    expect(screen.getByText("Nic tu nie zrobimy.")).toBeInTheDocument();
    expect(screen.queryByText("111/2026")).not.toBeInTheDocument();
    await userEvent.keyboard("5");
    /* Numer stoi też w kolumnie dowodów wybranej sprawy — liczy się, że
       oba wiersze są na liście, więc `getAll`. */
    expect(screen.getAllByRole("button", { name: /111\/2026/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /222\/2026/ }).length).toBeGreaterThan(0);
    await userEvent.keyboard("1");
    expect(screen.getByText("Uznać czy odrzucić?")).toBeInTheDocument();
  });

  it("klawisz `m` przełącza sito, ale MILCZY w polu tekstowym", async () => {
    pokaz();
    await userEvent.keyboard("m");
    expect(screen.queryByRole("button", { name: /555\/2026/ })).not.toBeInTheDocument();
    await userEvent.keyboard("m");
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();

    /* Litera wpisana w pole szukania ma szukać, a nie przestawiać sito —
       ta sama zasada co cyfry kubełków. */
    await userEvent.type(screen.getByLabelText("Szukaj reklamacji"), "m");
    expect(screen.queryByText(/chowa/)).not.toBeInTheDocument();
  });

  it("szukanie PRZEBIJA sito — numer znajduje też cudzą sprawę", async () => {
    /* §25a.9: szukanie przebija kubełek. Sito rządzi się tą samą regułą,
       bo pole, które kłamie pustką przy sprawie tuż obok, jest gorsze
       od braku pola. */
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    await userEvent.type(screen.getByLabelText("Szukaj reklamacji"), "555");
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
  });

  it("szuka po TREŚCI NOTATKI — tam stoi numer sprawy Allegro", async () => {
    /* 0.394.0. Numer zgłoszenia niedostarczonej paczki nie ma u nas własnego
       pola; ląduje w notatce biura. Pole, które go nie znajduje, kłamie
       pustką przy sprawie stojącej obok. */
    pokaz();
    await userEvent.type(screen.getByLabelText("Szukaj reklamacji"), "ALG-98765");
    expect(screen.getByRole("button", { name: /666\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
  });

  it("szukanie po PROWADZĄCYM znajduje sprawę, której numeru nikt nie pamięta", async () => {
    pokaz();
    await userEvent.type(screen.getByLabelText("Szukaj reklamacji"), "lewandowsk");
    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /222\/2026/ })).not.toBeInTheDocument();
  });

  /* ── Tagi (0.279.0) ───────────────────────────────────────────────────────
     Trzecie sito na tę samą listę: kubełek mówi „na jakim to etapie", „Moje"
     — „czyje to", tag — „o czym to". */
  it("czip tagu stoi na wierszu, a pasek filtra liczy skład KUBEŁKA", async () => {
    pokaz();
    /* Czip wiersza i pigułka filtra noszą TEN SAM napis, więc rozróżnia je
       podpowiedź: czip mówi „Tag biura", pigułka „Sprawy z tagiem". */
    expect(screen.getByTitle("Tag biura: czeka na część")).toBeInTheDocument();
    const pigulka = screen.getByTitle("Sprawy z tagiem „czeka na część”");
    expect(pigulka).toHaveTextContent("1");

    await userEvent.click(pigulka);
    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /555\/2026/ })).not.toBeInTheDocument();
  });

  it("TAG NIE PRZESTAWIA KOLEJKI — to jest linia z §14.5", async () => {
    /* Kolejność liczy serwer z terminu i czasu czekania, czyli z FAKTÓW
       o pilności. Gdyby tag ją podnosił, jedna pomyłka biura zakopałaby
       sprawę z zegarem na dole listy tak, że nikt by tego nie zauważył. */
    pokaz();
    const kolejnosc = () => screen.getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((t) => /\d{3}\/2026/.test(t))
      .map((t) => t.match(/\d{3}\/2026/)![0]);
    const przed = kolejnosc();

    /* Otagowana jest 444, czyli NIE pierwsza w kubełku. Gdyby tag ruszał
       kolejność, wskoczyłaby na górę. */
    expect(przed).toEqual(["111/2026", "444/2026", "555/2026", "666/2026"]);
    expect(przed.indexOf("444/2026")).toBeGreaterThan(0);
  });

  it("tag NAKŁADA SIĘ na sito „Moje”, zamiast je zastępować", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    await userEvent.click(screen.getByTitle("Sprawy z tagiem „czeka na część”"));
    /* 444 jest i moja, i otagowana — jedyna, która przechodzi oba sita. */
    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
  });

  /* ── „Które są moje" bez włączania filtru (0.281.0) ───────────────────────
     Właściciel pytał wprost. Sito odpowiada po włączeniu; czip odpowiada
     od razu, przy przeglądaniu całej kolejki. */
  it("wiersz mówi „prowadzisz”, gdy sprawa jest moja, i IMIĘ, gdy cudza", () => {
    pokaz();
    /* 444 prowadzę ja (konto 7), 555 — imienniczka o koncie 9. Obie noszą
       to samo imię, więc imię na wierszu na to pytanie nie odpowiada. */
    expect(screen.getByTitle(/Prowadzisz tę sprawę/)).toHaveTextContent("prowadzisz");
    expect(screen.getByTitle("Prowadzi: A. Lewandowska")).toHaveTextContent("A. Lewandowska");
  });

  it("sito „Niczyje” pokazuje sprawy, których nikt nie wziął", async () => {
    /* Druga połowa pytania: sprawa nieprzypisana nie trafia do nikogo sama.
       Sito pokazujące wyłącznie moje robiło z niej ślepą plamkę. */
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /^Niczyje/ }));
    expect(screen.getByRole("button", { name: /111\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /444\/2026/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Niczyje.*chowa 2 sprawy/)).toBeInTheDocument();
  });

  it("klawisz `n` przełącza „Niczyje”, a `m` je ZASTĘPUJE, nie dokłada", async () => {
    /* Trzy stany, nie dwa przełączniki: „moje i niczyje naraz" nie znaczy nic. */
    pokaz();
    await userEvent.keyboard("n");
    expect(screen.getByRole("button", { name: /^Niczyje/ })).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("m");
    expect(screen.getByRole("button", { name: /^Moje/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Niczyje/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("skróty klawiszowe są DO ZNALEZIENIA i wymieniają te, które działają", async () => {
    pokaz();
    /* Dekalog p. 2: rozpoznanie jest tańsze od pamiętania. Skrót, o którym
       nikt nie wie, nie skraca niczyjej pracy.

       OD 0.402.0 SKRÓTY SIEDZĄ POD „?" i test je stamtąd wyjmuje. Reguła
       została ta sama i jest tu ważniejsza od miejsca: pokazane klawisze mają
       być TYMI, które naprawdę działają. Pomoc otwiera się na najechanie —
       zarzut z 0.281.0 („dwa kliknięcia przy każdym przypomnieniu") jest
       odpowiedziany, a nie odrzucony. */
    await userEvent.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));
    for (const k of ["j", "k", "m", "n"]) {
      expect(screen.getByText(k, { selector: "kbd" })).toBeInTheDocument();
    }
    expect(screen.getByText("ruch po liście")).toBeInTheDocument();
  });
});


/* ── Przebudowa ekranu: kolejka, głowica, dowody ─────────────────────────────
   Decyzja właściciela z projektu ekranu. Testy niżej pilnują tego, co
   zmieniło się CELOWO — każdy razem z regułą, która za zmianą stoi. */

/** Zmienia fikstury na czas jednego testu i oddaje je w `finally`. */
async function zmienionymi(zmiany: Array<[number, Partial<Reklamacja>]>, test: () => Promise<void> | void) {
  const kopie = zmiany.map(([i]) => ({ ...REKLAMACJE[i] }));
  zmiany.forEach(([i, z]) => Object.assign(REKLAMACJE[i], z));
  try { await test(); } finally { zmiany.forEach(([i], k) => { REKLAMACJE[i] = kopie[k]; }); }
}

/** Numery spraw z wierszy kolejki w kolejności DOM. */
const numeryWierszy = () => screen.getAllByRole("button")
  .filter((b) => b.hasAttribute("data-wiersz-kolejki"))
  .map((b) => b.textContent!.match(/\d{3}\/2026/)![0]);

describe("Kolejka po przebudowie", () => {
  it("sygnał wspólny CAŁEMU kubełkowi schodzi z wierszy i staje raz nad listą", async () => {
    /* Jedenaście identycznych czipów nie rozróżnia niczego. Sygnał, który ma
       tylko część spraw, zostaje na wierszu — tylko on coś mówi. */
    const czeka = "Ostatnie słowo było klienta — ruch należy do nas";
    await zmienionymi([
      [0, { sygnaly: ["klient_czeka"] }],
      [2, { sygnaly: ["klient_czeka", "doradca"] }],
      [3, { sygnaly: ["klient_czeka"] }],
      [4, { sygnaly: ["klient_czeka"] }],
    ], async () => {
      pokaz();
      expect(screen.queryByTitle(czeka)).not.toBeInTheDocument();
      expect(screen.getByTitle("W rozmowie jest doradca Allegro")).toBeInTheDocument();
      expect(screen.getByText("Na każdej sprawie tutaj: klient czeka")).toBeInTheDocument();
      /* Szukanie miesza kubełki — wspólnego wtedy nie ma i wiersz mówi swoje. */
      await userEvent.type(screen.getByLabelText("Szukaj reklamacji"), "444");
      expect(screen.getByTitle(czeka)).toBeInTheDocument();
      expect(screen.queryByText(/Na każdej sprawie tutaj/)).not.toBeInTheDocument();
    });
  });

  it("sprawy PO TERMINIE stoją pierwsze pod nagłówkiem, a strzałki idą tą samą drogą", async () => {
    /* 555 jest trzecia w porządku terminu, ale jedyna po terminie — staje
       pierwsza. Strzałka w dół z niej prowadzi do 111, nie do 666: kursor
       chodzi po liście, którą widać, a nie po kolejności sprzed grupowania. */
    await zmienionymi([[3, { poTerminie: true, dniDoTerminu: -3 }]], async () => {
      pokaz("/obsluga/reklamacje/5");
      expect(screen.getByRole("heading", { name: "Po terminie decyzji" })).toBeInTheDocument();
      expect(numeryWierszy()).toEqual(["555/2026", "111/2026", "444/2026", "666/2026"]);
      await userEvent.keyboard("j");
      expect(await screen.findByRole("button", { name: /111\/2026/, current: true })).toBeInTheDocument();
      await userEvent.keyboard("k");
      expect(await screen.findByRole("button", { name: /555\/2026/, current: true })).toBeInTheDocument();
    });
  });

  it("kwota stoi z prawej i porządek „kwota” idzie po TEJ SAMEJ liczbie", async () => {
    /* Wszystkie fikstury żądają 50 zł. Gdyby porządek szedł po żądaniu,
       a wiersz pokazywał kwotę z paragonu, lista stałaby w kolejności,
       której na ekranie nie widać. */
    await zmienionymi([
      [0, { kwotaGrosze: null }],
      [2, { kwotaGrosze: 9000, kwotaZrodlo: "paragon" }],
      [4, { kwotaGrosze: 7000, kwotaZrodlo: "paragon" }],
    ], () => {
      localStorage.setItem("wertis.reklamacje.porzadek", "kwota");
      pokaz();
      expect(screen.getByText("90,00 PLN")).toBeInTheDocument();
      /* `null` od serwera to „kwoty nie znamy" i spada na koniec, nie na zero. */
      expect(numeryWierszy()).toEqual(["444/2026", "666/2026", "555/2026", "111/2026"]);
    });
  });

  it("szukanie znajduje sprawę po NAZWIE TOWARU — to tytuł wiersza", async () => {
    await zmienionymi([[3, { ofertaNazwa: "Gaźnik do Stihl MS181" }]], async () => {
      pokaz();
      await userEvent.type(screen.getByLabelText("Szukaj reklamacji"), "gaźnik stihl");
      expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
    });
  });
});

describe("Sprawa po przebudowie", () => {
  it("głowica stoi NAD rozmową: towar, czego klient chce i kto ma ostatnie słowo", () => {
    pokaz("/obsluga/reklamacje/1");
    const tytul = screen.getByRole("heading", { name: "Towar 1" });
    expect(screen.getByText(/Ostatnie słowo: klient/)).toBeInTheDocument();
    /* Głowica przed rozmową w DOM — czyta się ją pierwszą. */
    expect(tytul.compareDocumentPosition(screen.getByText("Opis sprawy 1"))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("zdjęcie klienta stoi w kolumnie dowodów jako Z1, a w wątku zostaje odnośnik", () => {
    pokaz("/obsluga/reklamacje/1");
    expect(screen.getByRole("region", { name: /^Zdjęcia: Klient · / })).toHaveTextContent("Z1");
    expect(screen.getByRole("button", { name: "Z1 usterka.jpg — pokaż zdjęcie w kolumnie" }))
      .toHaveTextContent("Z1");
  });

  it("dowód biura dopisuje się i usuwa JAWNYM kliknięciem, z wybranym zdjęciem", async () => {
    scena.dowody = [{ id: 3, tresc: "Tabliczka znamionowa nieczytelna", zalacznikId: 9,
      autor: "A. Lewandowska", utworzonoAt: "2026-09-07T09:00:00.000Z" }];
    pokaz("/obsluga/reklamacje/1");
    /* Otwarcie sprawy z dowodami nie zapisuje niczego poza odświeżeniem. */
    expect(bezOdswiezenia()).toEqual([]);
    expect(screen.getByText("Tabliczka znamionowa nieczytelna")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pokaż zdjęcie Z1" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Nowy dowód"), "Bok szczotki krzywy");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Powiąż ze zdjęciem" }), "9");
    await userEvent.click(screen.getByRole("button", { name: "Dodaj" }));
    expect(bezOdswiezenia()).toEqual([
      `dodaj-dowod:${JSON.stringify({ id: 1, tresc: "Bok szczotki krzywy", zalacznikId: 9 })}`,
    ]);

    scena.mutacje = [];
    await userEvent.click(screen.getByRole("button", { name: /^Usuń dowód: Tabliczka/ }));
    /* Kosz chowa wpis i daje „Cofnij"; żądanie czeka, aż okno się zamknie. */
    expect(bezOdswiezenia()).toEqual([]);
    const pasek = screen.getByText("Wpis usunięty.").closest<HTMLElement>("[role=status]")!;
    expect(screen.queryByText("Tabliczka znamionowa nieczytelna")).not.toBeInTheDocument();
    await userEvent.click(within(pasek).getByRole("button", { name: "Zamknij" }));
    expect(bezOdswiezenia()).toEqual([`usun-dowod:${JSON.stringify({ id: 1, dowodId: 3 })}`]);
  });
});

/* ── Werdykt z towarem i sztuka do dostawcy ─────────────────────────────────
   Uznanie niesie stanowisko o towarze TYM SAMYM żądaniem, a serwer oddaje
   jego los obok werdyktu. Werdykt jest nieodwracalny, więc porażka towaru
   nie może go cofnąć — ekran zostawia krok zapasowy albo dialog dopisku,
   ten sam co przy osobnym kroku. Sprawę „dociągniętą" po werdykcie udaje
   `poWerdykcie`, bo atrapa szczegółu czyta tablicę spraw przy każdym renderze. */
describe("Werdykt z towarem i sztuka do dostawcy", () => {
  const WYNIK: WynikWerdyktu = {
    werdykt: "ACCEPTED_REPAIR", werdyktNazwa: "Uznana — naprawa", status: "sent", blad: null, wersja: 2,
  };
  /* Sprawa po werdykcie, tak jak przyjdzie z serwera po odświeżeniu. */
  const uznana = (n: Partial<Reklamacja> = {}): Partial<Reklamacja> => ({
    werdykt: "ACCEPTED_REPAIR", werdyktNazwa: "Uznana — naprawa", werdyktStatus: "sent",
    werdyktWiadomosc: "Naprawimy.", wersja: 2, ...n,
  });
  /** Podmienia pola sprawy 111 na czas jednego testu. */
  const zSprawa = async (n: Partial<Reklamacja>, test: () => Promise<void>) => {
    const r = REKLAMACJE[0];
    const kopia = { ...r };
    Object.assign(r, n);
    try { await test(); } finally {
      for (const k of Object.keys(r)) delete (r as unknown as Record<string, unknown>)[k];
      Object.assign(r, kopia);
    }
  };

  const uznaj = async (towar: RegExp) => {
    await userEvent.click(screen.getByRole("button", { name: /Uznaję/ }));
    await userEvent.click(screen.getByRole("button", { name: towar }));
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), "Naprawimy.");
    await userEvent.click(within(screen.getByRole("region", { name: "Werdykt" })).getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /Wyślij werdykt/ }));
  };

  it("uznanie niesie TOWAR tym samym żądaniem, z ostatnią NIE naszą wiadomością", async () => {
    pokaz("/obsluga/reklamacje/1");
    await uznaj(/Do odesłania/);
    expect(bezOdswiezenia()).toEqual([`werdykt:${JSON.stringify({
      id: 1, werdykt: "ACCEPTED_REPAIR", wiadomosc: "Naprawimy.", kwotaGrosze: null, wersja: 1,
      towar: {
        decyzja: "wymagany",
        tresc: "Prosimy o odesłanie reklamowanego towaru na adres sklepu. Po otrzymaniu paczki zrealizujemy uznaną reklamację.",
        expectedLastMessageId: 1,
      },
    })}`]);
  });

  it("porażka towaru zostawia KROK ZAPASOWY z tą samą treścią i zdaniem serwera", async () => {
    pokaz("/obsluga/reklamacje/1");
    await zSprawa({}, async () => {
      scena.wynikWerdyktu = { ...WYNIK, towar: { blad: "Allegro nie przyjęło wiadomości o towarze" } };
      scena.poWerdykcie = () => Object.assign(REKLAMACJE[0], uznana());
      await uznaj(/Zostaje u klienta/);
      expect(screen.getByText("Allegro nie przyjęło wiadomości o towarze")).toBeInTheDocument();
      expect(screen.getByText("Towar do odesłania?")).toBeInTheDocument();
      /* Werdykt NIE wraca do formularza — wyszedł i drugi raz nie poleci. */
      expect(screen.queryByRole("button", { name: /Uznaję/ })).not.toBeInTheDocument();
      expect(screen.getByLabelText("Wiadomość o towarze")).toHaveValue(
        "Towaru nie trzeba odsyłać. Uznaną reklamację zrealizujemy bez zwrotu przesyłki.");
    });
  });

  it("niepewny los towaru wskazuje Centrum Sprzedaży i nie proponuje drugiego stanowiska", async () => {
    /* Serwer zapisuje decyzję przy „mogło dojść”, więc sprawa wraca z nią,
       a krok zapasowy nie ma czego proponować. Synchronizacja blokady nie
       zdejmuje, więc zdanie o niej nie pada. */
    pokaz("/obsluga/reklamacje/1");
    await zSprawa({}, async () => {
      scena.wynikWerdyktu = { ...WYNIK, towar: { status: "send_uncertain" } };
      scena.poWerdykcie = () => Object.assign(REKLAMACJE[0], uznana({ zwrotTowaru: "wymagany" }));
      await uznaj(/Do odesłania/);
      expect(screen.getByText(/mogło nie dojść do kupującego.*Centrum Sprzedaży/)).toBeInTheDocument();
      expect(screen.queryByText(/zsynchronizuj/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Towar do odesłania$/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Bez odsyłania$/ })).not.toBeInTheDocument();
    });
  });

  it("werdykt niepewny pomija towar i MÓWI to, zamiast milczeć", async () => {
    pokaz("/obsluga/reklamacje/1");
    await zSprawa({}, async () => {
      scena.wynikWerdyktu = { ...WYNIK, status: "send_uncertain",
        towar: { pominiety: "Werdykt mógł nie dojść do Allegro, więc stanowiska o towarze nie wysłaliśmy." } };
      scena.poWerdykcie = () => Object.assign(REKLAMACJE[0], uznana({ werdyktStatus: "send_uncertain" }));
      await uznaj(/Do odesłania/);
      expect(screen.getByText(/stanowiska o towarze nie wysłaliśmy/)).toBeInTheDocument();
    });
  });

  it("dopisek klienta przy towarze otwiera TEN SAM dialog, a „wyślij mimo to” idzie krokiem o towarze", async () => {
    pokaz("/obsluga/reklamacje/1");
    await zSprawa({}, async () => {
      scena.wynikWerdyktu = { ...WYNIK, towar: { konflikt: {
        error: "Ktoś dopisał wiadomość", lastMessageId: 7,
        nowaWiadomosc: { id: 7, tresc: "A co z paczką?", at: null, rola: "BUYER" },
      } } };
      scena.poWerdykcie = () => Object.assign(REKLAMACJE[0], uznana());
      await uznaj(/Zostaje u klienta/);
      const dialog = screen.getByRole("dialog", { name: "Wysyłka zatrzymana" });
      expect(within(dialog).getByText(/klient dopisał wiadomość/)).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole("checkbox"));
      scena.mutacje = [];
      await userEvent.click(within(dialog).getByRole("button", { name: "WYŚLIJ MIMO TO" }));
      expect(bezOdswiezenia()).toEqual([`zwrot-towaru:${JSON.stringify({
        id: 1, decyzja: "niewymagany",
        tresc: "Towaru nie trzeba odsyłać. Uznaną reklamację zrealizujemy bez zwrotu przesyłki.",
        expectedWersja: 2, expectedLastMessageId: 1, mimoNowejWiadomosci: true,
      })}`]);
    });
  });

  it("po uznaniu z odesłaniem sztuka idzie do dostawcy — otwarcie nie zapisuje niczego", async () => {
    scena.dostawa = { dostawca: "HURT-OGR", data: "2026-08-20T00:00:00.000Z", numer: "FV 12/08", przedZakupem: true };
    await zSprawa(uznana({ zwrotTowaru: "wymagany", kubelek: "decyzja" }), async () => {
      pokaz("/obsluga/reklamacje/1");
      expect(bezOdswiezenia()).toEqual([]);
      const krok = screen.getByRole("group", { name: "Dalej: sztuka do dostawcy" });
      await userEvent.click(within(krok).getByRole("button", { name: "Zgłoś u dostawcy" }));
      expect(within(krok).getByLabelText("Dostawca")).toHaveValue("HURT-OGR");
      await userEvent.type(within(krok).getByLabelText(/Nr u dostawcy/), "RK-77");
      await userEvent.click(within(krok).getByRole("button", { name: "Zapisz" }));
      expect(bezOdswiezenia()).toEqual([`u-dostawcy:${JSON.stringify({
        id: 1, dostawca: "HURT-OGR", nrUDostawcy: "RK-77", wersja: 0,
      })}`]);
    });
  });

  it("wynik u dostawcy zapisuje się z WERSJĄ rekordu, nie sprawy", async () => {
    scena.uDostawcy = { dostawca: "HURT-OGR", nrUDostawcy: "RK-77", zgloszonoAt: "2026-09-08T10:00:00.000Z",
      wynik: null, wynikAt: null, autor: "A. Lewandowska", wersja: 4 };
    await zSprawa(uznana({ zwrotTowaru: "wymagany", kubelek: "decyzja" }), async () => {
      pokaz("/obsluga/reklamacje/1");
      expect(bezOdswiezenia()).toEqual([]);
      await userEvent.click(screen.getByRole("button", { name: /Dostawca uznał/ }));
      expect(bezOdswiezenia()).toEqual([`u-dostawcy:${JSON.stringify({
        id: 1, dostawca: "HURT-OGR", wynik: "uznal", wersja: 4,
      })}`]);
    });
  });
});

describe("Szyna listy: kubełki pracy na wierzchu, widoki pod „Więcej”", () => {
  /* Trzy pigułki wypełniały całą szerokość kolumny, więc zwarte „Więcej”
     zawsze spadało do osobnego rzędu nad sprawami. „Wszystkie” to widok, nie
     kubełek pracy, i leży pod „Więcej” razem z pozostałymi widokami. */
  const wiecej = () => screen.getByLabelText("Więcej kubełków") as HTMLSelectElement;
  const opcje = () => Array.from(wiecej().options).map((o) => o.textContent ?? "");

  it("„Wszystkie” nie jest pigułką, tylko opcją listy „Więcej”", () => {
    pokaz();
    expect(screen.queryByRole("button", { name: /^Wszystkie/ })).not.toBeInTheDocument();
    expect(opcje().some((t) => /^Wszystkie · \d+$/.test(t))).toBe(true);
  });

  it("lista „Więcej” ma szerokość treści, nie resztę rzędu", () => {
    /* Bez trybu zwartego rozciąga się na resztę rzędu i po zawinięciu robi się
       pełnoszerokim paskiem nad sprawami. */
    pokaz();
    expect(wiecej().className).toMatch(/field-sizing:content/);
  });

  it("wybór „Wszystkie” z listy działa i lista pokazuje wybraną nazwę", async () => {
    pokaz();
    await userEvent.selectOptions(wiecej(), opcje().find((t) => /^Wszystkie/.test(t))!);
    expect(wiecej().selectedOptions[0].textContent).toMatch(/^Wszystkie/);
  });

  it("kreska oddziela sita od tagów", () => {
    pokaz();
    const tag = screen.getByTitle(/^Sprawy z tagiem/);
    expect(tag.closest(".border-l")).not.toBeNull();
  });
});
