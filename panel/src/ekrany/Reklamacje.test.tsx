import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Konflikt } from "../api/klient";
import { atrapaZapisow } from "../test/zapisy";
import type {
  KubelekReklamacji, OstatniaDostawaReklamacji, Reklamacja, StatystykiReklamacji,
  WiadomoscReklamacji, WynikWerdyktu,
} from "../api/typy";

/* ── Ekran reklamacji ────────────────────────────────────────────────────────
   Rzeczy warte testu, bo żadnej nie widać w serwisie:

   1. ZERO ZAPISU PRZY PATRZENIU. Otwarcie ekranu nie wywołuje ani jednej
      mutacji, a wejście w sprawę — dokładnie jedno odświeżenie z Allegro.
   2. PRZEŁĄCZENIE KUBEŁKA PRZESTAWIA KURSOR. Inaczej lista się zmienia,
      a zaznaczenie zostaje na sprawie z poprzedniego kubełka.
   3. LICZBA ODSIANYCH DYSKUSJI jest do znalezienia. Bez niej ktoś szukałby
      reklamacji, która nigdy reklamacją nie była.
   4. PUNKT ODNIESIENIA ŚWIEŻOŚCI liczy się z osi, a własna odpowiedź go NIE
      przesuwa — inaczej druga wiadomość z rzędu wyglądałaby na spóźnioną.
   5. BRAK DANYCH TO „—”, nie zero: przy awarii serwera kafle i pigułki
      kubełków nie mówią „nic nie czeka”.                                            */

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
  /* Sprawa z NUMEREM ALLEGRO W NOTATCE. Zgłoszenie paczki, która nie
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
  /* Ostatnia dostawa w szczególe sprawy. */
  dostawa: null as OstatniaDostawaReklamacji | null,
  /* Kafle w kolejce; `undefined` udaje starszy serwer. */
  statystyki: undefined as StatystykiReklamacji | undefined,
  /* Lista padła: `Error` zamiast danych, jak przy braku połączenia. */
  bladListy: null as Error | null,
  /* Czym kończy się zapis notatki: `Error` do `onError`, inaczej `onSuccess`. */
  wynikNotatki: null as unknown,
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

vi.mock("../api/reklamacje", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/reklamacje")>("../api/reklamacje");
  const mutacja = (nazwa: string) => () => ({
    mutate: (...a: unknown[]) => { scena.mutacje.push(`${nazwa}:${JSON.stringify(a[0])}`); },
    isPending: false, error: null,
  });
  /* Podrabiacz z losem: `Error` idzie do `onError`, cokolwiek innego do
     `onSuccess`, `null` nie woła żadnego. Tak oddaje sterowanie prawdziwy hak. */
  const zLosem = (nazwa: string, los: () => unknown) => () => ({
    mutate: (v: unknown, opcje?: { onSuccess?: (w: unknown) => void; onError?: (e: unknown) => void }) => {
      scena.mutacje.push(`${nazwa}:${JSON.stringify(v)}`);
      const w = los();
      if (w instanceof Error) opcje?.onError?.(w);
      else if (w) opcje?.onSuccess?.(w);
    },
    isPending: false, error: null,
  });
  return {
    ...rzeczywisty,
    useReklamacje: () => (scena.bladListy
      ? { data: undefined, isLoading: false, error: scena.bladListy }
      : {
        data: {
          reklamacje: REKLAMACJE,
          liczniki: { decyzja: 4, odpowiedz: 0, zamknieta: 1, bez_ruchu: 0 },
          stan: scena.stan,
          prog: { od: "2026-07-01T00:00:00.000Z", ukrytych: 4, ukrytychZTerminem: 0, zdjety: false },
          statystyki: scena.statystyki,
        },
        isLoading: false, error: null,
      }),
    useReklamacja: (id: number | null) => ({
      data: id === null ? undefined : {
        reklamacja: REKLAMACJE.find((r) => r.id === id) ?? REKLAMACJE[0],
        czat: scena.czat,
        zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [], droga: [], kartoteka: null,
        zamowienie: null, przesylka: null, historia: { towar: null, klient: null },
        dostawa: scena.dostawa,
      },
    }),
    useOdpowiedz: zLosem("odpowiedz", () => scena.wynikWysylki),
    useOdswiez: mutacja("odswiez"),
    useProwadze: mutacja("prowadze"),
    /* Błąd synchronizacji wraca do ekranu przez `onError`, a test pilnuje,
       że go widać. */
    useSynchronizuj: () => ({
      mutate: (v: unknown, opcje?: { onError?: (e: unknown) => void }) => {
        scena.mutacje.push(`synchronizuj:${JSON.stringify(v)}`);
        if (scena.bladSynchronizacji) opcje?.onError?.(scena.bladSynchronizacji);
      },
      isPending: false, error: null,
    }),
    /* Werdykt ma własny podrabiacz: los stanowiska o towarze wraca do ekranu
       w `onSuccess`, a `poWerdykcie` udaje dociągnięcie sprawy przed nim. */
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
    useSprawdzPrzesylke: mutacja("przesylka"),
    /* Notatka to nasz zapis — test zera zapisu ma ją widzieć. */
    useNotatkaReklamacji: zLosem("notatka", () => scena.wynikNotatki),
    useCofnijNotatkeReklamacji: mutacja("cofnij-notatke"),
  };
});

const { Reklamacje } = await import("./Reklamacje");
const { zapamietajSzkic } = await import("../sprawy/useSzkicSprawy");

const wiad = (n: Partial<WiadomoscReklamacji> = {}): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "klient1", autorRola: "BUYER",
  tresc: "Kosiarka przestała ciąć", utworzonoAt: "2026-09-06T10:01:00.000Z",
  zalaczniki: [{ id: 9, wiadomoscId: 1, nazwa: "usterka.jpg", podglad: true, pdf: false }], ...n,
});

const STATYSTYKI: StatystykiReklamacji = {
  doDecyzji: { teraz: 18, tydzienTemu: 12 },
  doOdpowiedzi: { teraz: 11, tydzienTemu: null },
  poTerminie: { teraz: 1, tydzienTemu: null },
  sredniDniDoWerdyktu: { teraz: 2.4, poprzednio: 3.3, okresDni: 30 },
};

function pokaz(adres = "/obsluga/reklamacje", czat: WiadomoscReklamacji[] = [wiad()],
  stan: Record<string, unknown> = {}) {
  scena.mutacje = [];
  scena.czat = czat;
  scena.wynikWysylki = null;
  scena.wynikWerdyktu = null;
  scena.wynikNotatki = null;
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
          {/* Profil klienta jako sam znacznik: test pyta, DOKĄD prowadzi łącze. */}
          <Route path="/obsluga/klient/:login" element={<p>ekran profilu klienta</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>);
}

/* Sito „Moje" PAMIĘTA wybór w przeglądarce, więc bez tego sprzątania jeden
   test włączałby filtr następnemu. */
afterEach(() => { try { localStorage.clear(); } catch { /* prywatne okno */ } });
/* Scenę ustawia test PRZED renderem, więc sprząta się ją po nim. */
afterEach(() => {
  scena.dostawa = null; scena.poWerdykcie = null; scena.statystyki = undefined; scena.bladListy = null;
});

/* ── MUTACJE BEZ ODŚWIEŻENIA WEJŚCIOWEGO ─────────────────────────────────────
   Wejście w sprawę wysyła JEDNĄ mutację: `odswiez` (decyzja właściciela).
   Testy pytające „co wysłał TEN przycisk” odsiewają ją tu, w jednym miejscu.
   ODSIEW JEST WĄSKI CELOWO: druga mutacja dołożona kiedyś „przy okazji” do
   otwarcia sprawy wywali te testy, zamiast przejść niezauważona. */
const bezOdswiezenia = () => scena.mutacje.filter((m) => !m.startsWith("odswiez:"));

/** Kafle-filtry i wąski rząd pozostałych kubełków w kolejce. */
const kafle = () => screen.getByRole("group", { name: "Reklamacje w liczbach" });
const pozostale = () => screen.getByRole("group", { name: "Pozostałe kubełki" });

/** Otwiera okno filtra przy tytule kolejki. */
const otworzFiltr = async () => {
  await userEvent.click(screen.getByRole("button", { name: /^Filtr tagów i sortowanie/ }));
  return screen.getByRole("dialog", { name: "Filtr i porządek kolejki" });
};

describe("Ekran reklamacji", () => {
  /* ── ZERO ZAPISU PRZY PATRZENIU, Z JEDNYM WYJĄTKIEM ───────────────────────
     Decyzja właściciela: „możesz po prostu odświeżyć reklamację, jak w nią
     wejdę?”. Przebieg synchronizacji czyta najwyżej tysiąc spraw, więc ogona
     archiwum nie odświeża nigdy.

     TEST ZAWĘŻA SIĘ DO JEDNEJ DOZWOLONEJ MUTACJI. Gdyby ktoś dołożył drugą,
     ten plik ma odmówić. Samo otwarcie EKRANU nadal nie wysyła niczego. */
  it("otwarcie ekranu nie wywołuje mutacji, a wejście w sprawę TYLKO ją odświeża", async () => {
    scena.statystyki = STATYSTYKI;
    pokaz();
    expect(scena.mutacje).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /111\/2026/ }));
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
  });

  it("otwarcie sprawy na samym `fetch` nie wysyła zapisu poza odświeżeniem — profil to łącze", async () => {
    /* Zero zapisu liczone na samym `fetch`: atrapa haków reklamacji nie widzi
       zapisu wołanego z pominięciem haka. Jedyną mutacją zostaje
       udokumentowane odświeżenie przy wejściu w sprawę. */
    const odczyty: Record<string, unknown> = {
      "/api/obsluga/reklamacje/1/zalaczniki-wysylki": { zalaczniki: [] },
      "/api/obsluga/reklamacje/1/zalaczniki/9/podglad": {},
    };
    const zapisy = atrapaZapisow((url) => odczyty[url]);
    try {
      pokaz("/obsluga/reklamacje/1");
      await userEvent.click(screen.getByRole("link", { name: "Profil klienta" }));
      expect(screen.getByText("ekran profilu klienta")).toBeInTheDocument();
      expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
      expect(zapisy.wyslane).toEqual([]);
      expect(zapisy.nieznane).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("powrót do TEJ SAMEJ sprawy nie pyta Allegro drugi raz", async () => {
    pokaz("/obsluga/reklamacje/1");
    const wiersz = await screen.findByRole("button", { name: /111\/2026/, current: true });
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
    await userEvent.click(wiersz);
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
  });

  it("bez wybranej sprawy środek zaprasza do kolejki, zamiast świecić pustką", () => {
    pokaz();
    expect(screen.getByText(/Wybierz reklamację z kolejki/)).toBeInTheDocument();
  });
});

describe("Kafle w kolejce zamiast przełącznika", () => {
  it("kafle stoją W KOLEJCE pod szukaniem, a nad kolumnami nie ma rzędu", () => {
    scena.statystyki = STATYSTYKI;
    pokaz();
    const kolejka = screen.getByRole("region", { name: "Kolejka reklamacji" });
    expect(within(kolejka).getByRole("group", { name: "Reklamacje w liczbach" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Reklamacje w liczbach" })).not.toBeInTheDocument();
    /* Kolejność z makiety: szukanie, kafle, pozostałe kubełki, sito. */
    const szukaj = screen.getByLabelText("Szukaj reklamacji");
    const sito = screen.getByRole("button", { name: /^Moje/ });
    expect(szukaj.compareDocumentPosition(kafle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kafle().compareDocumentPosition(pozostale()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pozostale().compareDocumentPosition(sito) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("przełącznika kubełków z „Więcej” już nie ma — liczby stoją raz", () => {
    scena.statystyki = STATYSTYKI;
    pokaz();
    expect(screen.queryByRole("group", { name: "Kubełek" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Więcej kubełków" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Do decyzji/ })).toHaveLength(1);
  });

  it("cztery liczby z serwera, a kafel kubełka przestawia kolejkę i kursor", async () => {
    scena.statystyki = STATYSTYKI;
    pokaz("/obsluga/reklamacje/1");
    expect(within(kafle()).getByText("18")).toBeInTheDocument();
    expect(within(kafle()).getByText("+6 od zeszłego tygodnia")).toBeInTheDocument();
    expect(within(kafle()).getByText("2,4 dnia")).toBeInTheDocument();
    expect(within(kafle()).getByRole("button", { name: /Do decyzji/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(kafle()).getByRole("button", { name: /Do odpowiedzi/ }));
    /* „Do odpowiedzi” jest w atrapie pusty, więc kursor schodzi ze sprawy. */
    expect(screen.getByText(/Ten kubełek jest pusty/)).toBeInTheDocument();
    expect(within(kafle()).getByRole("button", { name: /Do odpowiedzi/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(kafle()).getByRole("button", { name: /Do decyzji/ })).toHaveAttribute("aria-pressed", "false");
    expect(bezOdswiezenia()).toEqual([]);
  });

  it("„Po terminie” to DO DECYZJI zawężone do spóźnionych, z kursorem na pierwszej", async () => {
    scena.statystyki = STATYSTYKI;
    await zmienionymi([[3, { poTerminie: true, dniDoTerminu: -3 }]], async () => {
      pokaz("/obsluga/reklamacje/1");
      await userEvent.click(within(kafle()).getByRole("button", { name: /Po terminie/ }));
      expect(numeryWierszy()).toEqual(["555/2026"]);
      expect(await screen.findByRole("button", { name: /555\/2026/, current: true })).toBeInTheDocument();
      expect(within(kafle()).getByRole("button", { name: /Po terminie/ })).toHaveAttribute("aria-pressed", "true");
      expect(within(kafle()).getByRole("button", { name: /Do decyzji/ })).toHaveAttribute("aria-pressed", "false");
      /* Drugi klik zdejmuje zawężenie, jak każdy przełącznik z `aria-pressed`. */
      await userEvent.click(within(kafle()).getByRole("button", { name: /Po terminie/ }));
      expect(numeryWierszy()).toEqual(["555/2026", "111/2026", "444/2026", "666/2026"]);
      expect(within(kafle()).getByRole("button", { name: /Do decyzji/ })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("cyfra po „Po terminie” wraca do całego kubełka, nie do zawężenia", async () => {
    scena.statystyki = STATYSTYKI;
    await zmienionymi([[3, { poTerminie: true, dniDoTerminu: -3 }]], async () => {
      pokaz();
      await userEvent.click(within(kafle()).getByRole("button", { name: /Po terminie/ }));
      await userEvent.keyboard("1");
      expect(numeryWierszy()).toEqual(["555/2026", "111/2026", "444/2026", "666/2026"]);
    });
  });

  it("wejście w sprawę spoza zawężenia zdejmuje „Po terminie”, zamiast chować ją z listy", async () => {
    scena.statystyki = STATYSTYKI;
    await zmienionymi([[3, { poTerminie: true, dniDoTerminu: -3 }]], async () => {
      pokaz();
      await userEvent.click(within(kafle()).getByRole("button", { name: /Po terminie/ }));
      /* Szukanie przebija kubełek, więc tędy wchodzi się w sprawę w terminie. */
      const pole = screen.getByLabelText("Szukaj reklamacji");
      await userEvent.type(pole, "111/2026");
      await userEvent.click(screen.getByRole("button", { name: /111\/2026/ }));
      await userEvent.clear(pole);
      expect(screen.getByRole("button", { name: /111\/2026/, current: true })).toBeInTheDocument();
      expect(within(kafle()).getByRole("button", { name: /Do decyzji/ })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("pozostałe kubełki to wąski rząd pigułek z liczbą: Bez ruchu, Rozstrzygnięte, Wszystkie", async () => {
    pokaz();
    const g = pozostale();
    expect(within(g).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Bez ruchu 0", "Rozstrzygnięte 1", "Wszystkie 5"]);
    expect(within(g).getByTitle("Tylko wgląd. (klawisz 3)")).toBeInTheDocument();
    await userEvent.click(within(g).getByRole("button", { name: /Wszystkie/ }));
    expect(within(g).getByRole("button", { name: /Wszystkie/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(kafle()).getByRole("button", { name: /Do decyzji/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("starszy serwer bez statystyk: kafle mówią „—”, nie zero", () => {
    pokaz();
    expect(within(kafle()).getAllByText("—")).toHaveLength(4);
    expect(within(kafle()).queryByText("0")).not.toBeInTheDocument();
  });

  it("BRAK POŁĄCZENIA: błąd zamiast listy, a kafle i pigułki mówią „—”, nie „nic nie czeka”", () => {
    scena.bladListy = new Error("Brak połączenia z serwerem");
    pokaz();
    expect(screen.getByText("Brak połączenia z serwerem")).toBeInTheDocument();
    expect(screen.queryByText(/Ten kubełek jest pusty/)).not.toBeInTheDocument();
    expect(within(kafle()).getAllByText("—")).toHaveLength(4);
    expect(within(kafle()).queryByText("0")).not.toBeInTheDocument();
    expect(within(pozostale()).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Bez ruchu —", "Rozstrzygnięte —", "Wszystkie —"]);
    /* Sito liczyłoby z pustej listy i mówiłoby „Moje 0”. */
    expect(screen.queryByRole("button", { name: /^Moje/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Wybierz reklamację z kolejki/)).not.toBeInTheDocument();
  });
});

describe("Synchronizacja przy tytule kolejki", () => {
  const rzadTytulu = () => screen.getByRole("heading", { name: "Reklamacje", level: 1 }).parentElement!;

  it("przycisk-ikona stoi obok tytułu, jest JEDEN i działa na jawne kliknięcie", async () => {
    pokaz();
    expect(scena.mutacje).toEqual([]);
    expect(screen.getAllByRole("button", { name: /synchronizuj/i })).toHaveLength(1);
    const przycisk = within(rzadTytulu()).getByRole("button", { name: "Synchronizuj z Allegro" });
    expect(screen.getByText(/^Allegro: \d{2}:\d{2}$/)).toBeInTheDocument();
    await userEvent.click(przycisk);
    expect(scena.mutacje).toEqual(["synchronizuj:undefined"]);
  });

  it("w ALARMIE zdanie mówi stan i kod czerwienią, a przycisk dalej jest jeden", () => {
    pokaz("/obsluga/reklamacje", [wiad()], { status: "failed", kodOstatniegoBledu: 503 });
    expect(screen.getByText("Synchronizacja Allegro: nie działa, kod 503").className).toMatch(/text-ranga-zle/);
    expect(screen.getAllByRole("button", { name: /synchronizuj/i })).toHaveLength(1);
  });

  it("niekompletna lista woła pełnym zdaniem pod tytułem", () => {
    pokaz("/obsluga/reklamacje", [wiad()], { pozostaloDoPobrania: 12 });
    const kolejka = screen.getByRole("region", { name: "Kolejka reklamacji" });
    expect(within(kolejka).getByText(/Ta kolejka nie jest kompletna: 12 spraw/)).toBeInTheDocument();
  });

  it("błąd synchronizacji widać pod tytułem", async () => {
    pokaz();
    scena.bladSynchronizacji = new Error("Allegro odmówiło: limit zapytań");
    await userEvent.click(screen.getByRole("button", { name: "Synchronizuj z Allegro" }));
    expect(screen.getByText("Allegro odmówiło: limit zapytań").className).toMatch(/text-ranga-zle/);
  });

  it("starej stopki kolejki nie ma", () => {
    pokaz();
    expect(screen.queryByRole("group", { name: "Zakres i synchronizacja kolejki" })).not.toBeInTheDocument();
  });
});

describe("Kubełki i skróty", () => {
  it("kubełek DO DECYZJI pokazuje tylko sprawy przed werdyktem", () => {
    pokaz();
    expect(screen.getByRole("button", { name: /111\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /222\/2026/ })).not.toBeInTheDocument();
  });

  it("przełączenie kubełka przestawia KURSOR na jego pierwszą sprawę", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(within(pozostale()).getByRole("button", { name: /^Rozstrzygnięte/ }));
    const wiersz = await screen.findByRole("button", { name: /222\/2026/, current: true });
    expect(wiersz).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
  });

  it("cyfry idą za kubełkami: 2 „Do odpowiedzi”, 3 „Rozstrzygnięte”, 4 „Bez ruchu”, 5 „Wszystkie”", async () => {
    pokaz();
    await userEvent.keyboard("2");
    expect(within(kafle()).getByRole("button", { name: /Do odpowiedzi/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("3");
    expect(within(pozostale()).getByRole("button", { name: /Rozstrzygnięte/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("4");
    expect(within(pozostale()).getByRole("button", { name: /Bez ruchu/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("5");
    expect(within(pozostale()).getByRole("button", { name: /Wszystkie/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /111\/2026/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /222\/2026/ }).length).toBeGreaterThan(0);
    await userEvent.keyboard("1");
    expect(within(kafle()).getByRole("button", { name: /Do decyzji/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("cyfra przełącza kubełek, ale NIE wtedy, gdy piszesz w polu", async () => {
    pokaz("/obsluga/reklamacje/1");
    const pole = screen.getByLabelText("Szukaj reklamacji");
    await userEvent.type(pole, "3");
    expect(pole).toHaveValue("3");
    /* Gdyby cyfra przeszła do skrótów, ekran stałby w ROZSTRZYGNIĘTYCH. */
    expect(screen.getByText(/nie pasuje do tego, czego szukasz/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /222\/2026/ })).not.toBeInTheDocument();
  });

  it("podpowiedzi skrótów nie ma na ekranie, a skróty działają", async () => {
    /* Decyzja właściciela: miejsce po podpowiedziach oddane liście. Odruch
       zostaje, więc j/k dalej chodzą po kolejce. */
    pokaz("/obsluga/reklamacje/1");
    expect(screen.queryByRole("button", { name: /Skróty klawiszowe/ })).not.toBeInTheDocument();
    expect(document.querySelector("kbd")).toBeNull();
    await userEvent.keyboard("j");
    expect(await screen.findByRole("button", { name: /444\/2026/, current: true })).toBeInTheDocument();
    await userEvent.keyboard("k");
    expect(await screen.findByRole("button", { name: /111\/2026/, current: true })).toBeInTheDocument();
  });

  it("rzędu z pytaniem kubełka nad listą już nie ma", () => {
    pokaz();
    expect(screen.queryByText("Uznać czy odrzucić?")).not.toBeInTheDocument();
  });
});

describe("Filtr za przyciskiem przy tytule", () => {
  it("tytuł „Reklamacje”, a obok przycisk filtra; tagi i porządek nie stoją w osobnym rzędzie", () => {
    pokaz();
    expect(screen.getByRole("heading", { level: 1, name: "Reklamacje" })).toBeInTheDocument();
    expect(screen.queryByTitle(/^Sprawy z tagiem/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Termin$/ })).not.toBeInTheDocument();
    expect(screen.getByText("Najpilniejsze na górze")).toBeInTheDocument();
  });

  it("okno filtra niesie porządek, tagi i zakres z liczbą odsianych dyskusji", async () => {
    pokaz();
    const okno = await otworzFiltr();
    expect(within(okno).getByTitle(/^Kolejność:/)).toBeInTheDocument();
    expect(within(okno).getByTitle("Sprawy z tagiem „czeka na część”")).toHaveTextContent("1");
    expect(within(okno).getByText(/pominiętych dyskusji 35/)).toBeInTheDocument();
    expect(within(okno).getByRole("button", { name: "pokaż starsze" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Filtr i porządek kolejki" })).not.toBeInTheDocument();
    expect(scena.mutacje).toEqual([]);
  });

  it("tag zawęża listę, a schowany filtr MÓWI o sobie nad wierszami", async () => {
    pokaz();
    const okno = await otworzFiltr();
    await userEvent.click(within(okno).getByTitle("Sprawy z tagiem „czeka na część”"));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /555\/2026/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtr tagów i sortowanie (włączony)" })).toBeInTheDocument();
    expect(screen.getByText("Tylko sprawy z tagiem „czeka na część”.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pokaż wszystkie" }));
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
  });

  it("porządek „kwota” idzie po kwocie serwera, choć wiersz kwoty nie pokazuje", async () => {
    await zmienionymi([
      [0, { kwotaGrosze: null }],
      [2, { kwotaGrosze: 9000, kwotaZrodlo: "paragon" }],
      [4, { kwotaGrosze: 7000, kwotaZrodlo: "paragon" }],
    ], () => {
      localStorage.setItem("wertis.reklamacje.porzadek", "kwota");
      pokaz();
      expect(screen.getByText("Najdroższe na górze")).toBeInTheDocument();
      expect(screen.queryByText("90,00 PLN")).not.toBeInTheDocument();
      /* `null` od serwera to „kwoty nie znamy” i spada na koniec, nie na zero. */
      expect(numeryWierszy()).toEqual(["444/2026", "666/2026", "555/2026", "111/2026"]);
    });
  });

  it("TAG NIE PRZESTAWIA KOLEJKI — kolejność liczy się z faktów o pilności", () => {
    pokaz();
    expect(numeryWierszy()).toEqual(["111/2026", "444/2026", "555/2026", "666/2026"]);
  });

  it("tag NAKŁADA SIĘ na sito „Moje”, zamiast je zastępować", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    const okno = await otworzFiltr();
    await userEvent.click(within(okno).getByTitle("Sprawy z tagiem „czeka na część”"));
    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
  });
});

describe("Sito i szukanie", () => {
  it("sito zawęża kubełek do MOICH spraw, po numerze konta, nie po imieniu", async () => {
    pokaz();
    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /555\/2026/ })).not.toBeInTheDocument();
  });

  it("sito MÓWI, ile chowa, i oddaje drogę powrotną", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    expect(screen.getByText(/chowa 3 sprawy/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pokaż wszystkie" }));
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
  });

  it("sito „Niczyje” pokazuje sprawy, których nikt nie wziął", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /^Niczyje/ }));
    expect(screen.getByRole("button", { name: /111\/2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /444\/2026/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Niczyje.*chowa 2 sprawy/)).toBeInTheDocument();
  });

  it("klawisz `m` przełącza sito, ale MILCZY w polu tekstowym", async () => {
    pokaz();
    await userEvent.keyboard("m");
    expect(screen.queryByRole("button", { name: /555\/2026/ })).not.toBeInTheDocument();
    await userEvent.keyboard("m");
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Szukaj reklamacji"), "m");
    expect(screen.queryByText(/chowa/)).not.toBeInTheDocument();
  });

  it("klawisz `n` przełącza „Niczyje”, a `m` je ZASTĘPUJE, nie dokłada", async () => {
    pokaz();
    await userEvent.keyboard("n");
    expect(screen.getByRole("button", { name: /^Niczyje/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("m");
    expect(screen.getByRole("button", { name: /^Moje/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Niczyje/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("szukanie PRZEBIJA sito — numer znajduje też cudzą sprawę", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    await userEvent.type(screen.getByLabelText("Szukaj reklamacji"), "555");
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
  });

  it("szuka po TREŚCI NOTATKI — tam stoi numer sprawy Allegro", async () => {
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

  it("szukanie trafia po LOGINIE, po NUMERZE i po NAZWIE TOWARU", async () => {
    await zmienionymi([[3, { ofertaNazwa: "Gaźnik do Stihl MS181" }]], async () => {
      pokaz();
      const pole = screen.getByLabelText("Szukaj reklamacji");
      expect(pole).toHaveAttribute("placeholder", "Login, numer, zamówienie, towar, notatka");
      await userEvent.type(pole, "klient4");
      expect(screen.getByRole("button", { name: /444\/2026/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /555\/2026/ })).not.toBeInTheDocument();
      await userEvent.clear(pole);
      await userEvent.type(pole, "gaźnik stihl");
      expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
    });
  });
});

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

describe("Wiersz kolejki", () => {
  it("niesie numer i datę zgłoszenia na widoku, prowadzącego inicjałami, bez żądania i kwoty", () => {
    pokaz();
    const wiersz = screen.getByRole("button", { name: /444\/2026/ });
    expect(within(wiersz).getByText("444/2026")).toBeVisible();
    expect(within(wiersz).getByText(/^zgłoszono \d{2}\.09\.2026$/)).toBeInTheDocument();
    expect(within(wiersz).getByTitle(/Prowadzisz tę sprawę/)).toHaveTextContent(/AL/);
    expect(within(wiersz).queryByText(/PLN/)).not.toBeInTheDocument();
    expect(within(wiersz).queryByText(/zwrot pieniędzy/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /555\/2026/ })).getByTitle("Prowadzi: A. Lewandowska"))
      .toBeInTheDocument();
  });

  it("czip tagu i sygnały stoją na wierszu", async () => {
    await zmienionymi([[0, { sygnaly: ["klient_czeka"] }]], () => {
      pokaz();
      expect(screen.getByTitle("Tag biura: czeka na część")).toBeInTheDocument();
      expect(screen.getByTitle("Ostatnie słowo było klienta — ruch należy do nas")).toBeInTheDocument();
    });
  });

  it("sprawy PO TERMINIE stoją pierwsze pod nagłówkiem, a strzałki idą tą samą drogą", async () => {
    await zmienionymi([[3, { poTerminie: true, dniDoTerminu: -3 }]], async () => {
      pokaz("/obsluga/reklamacje/5");
      expect(screen.getByRole("heading", { name: "Po terminie" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Do decyzji" })).toBeInTheDocument();
      expect(numeryWierszy()).toEqual(["555/2026", "111/2026", "444/2026", "666/2026"]);
      await userEvent.keyboard("j");
      expect(await screen.findByRole("button", { name: /111\/2026/, current: true })).toBeInTheDocument();
      await userEvent.keyboard("k");
      expect(await screen.findByRole("button", { name: /555\/2026/, current: true })).toBeInTheDocument();
    });
  });
});

describe("Środek: głowica, droga i rozmowa", () => {
  it("głowica stoi NAD rozmową: numer z łączem do Allegro, status i klient", async () => {
    await zmienionymi([[0, { link: "https://allegro.pl/reklamacja/1" }]], () => {
      pokaz("/obsluga/reklamacje/1");
      const tytul = screen.getByRole("heading", { name: /Reklamacja 111\/2026/ });
      expect(within(tytul).getByRole("link")).toHaveAttribute("href", "https://allegro.pl/reklamacja/1");
      expect(within(tytul).getByRole("link")).toHaveAttribute("target", "_blank");
      expect(screen.getByText("Czeka na decyzję")).toBeInTheDocument();
      /* Login stoi też w wierszu kolejki, więc szukamy przycisku kopiowania. */
      expect(screen.getByTitle("Kopiuj login: klient1").tagName).toBe("BUTTON");
      expect(tytul.compareDocumentPosition(screen.getByText("Opis sprawy 1"))
        & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it("czat reklamacji: nagłówek, a zgłoszenie jest pierwszym dymkiem z powodem", () => {
    pokaz("/obsluga/reklamacje/1");
    expect(screen.getByRole("heading", { name: "Czat reklamacji" })).toBeInTheDocument();
    const zgloszenie = screen.getByText("Opis sprawy 1").closest("li")!;
    expect(zgloszenie).toHaveTextContent(/klient1 · .* · zgłoszenie/);
    expect(within(zgloszenie).getByText("Powód: niezgodny z opisem · chce zwrotu pieniędzy"))
      .toBeInTheDocument();
  });

  it("droga sprawy stoi między głowicą a rozmową", () => {
    pokaz("/obsluga/reklamacje/1");
    const droga = screen.getByRole("list", { name: "Droga sprawy" });
    expect(screen.getByRole("heading", { name: /Reklamacja 111\/2026/ }).compareDocumentPosition(droga)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(droga.compareDocumentPosition(screen.getByText("Opis sprawy 1"))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("„prowadzę” jedzie z WERSJĄ rekordu — inaczej nadpisałoby pracę kolegi", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByRole("button", { name: "Prowadzę" }));
    expect(bezOdswiezenia()).toEqual([`prowadze:${JSON.stringify({ id: 1, wersja: 1 })}`]);
  });

  it("„Odśwież z Allegro” z menu „⋮” to drugie odświeżenie, na jawne kliknięcie", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByRole("button", { name: "Więcej działań" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Odśwież z Allegro" }));
    expect(scena.mutacje).toEqual(['odswiez:{"id":1}', 'odswiez:{"id":1}']);
  });

  it("kolumny dowodów, faktów i sztuki do dostawcy nie ma — zdjęcie stoi w rozmowie", () => {
    scena.dostawa = { dostawca: "HURT-OGR", data: "2026-08-20T00:00:00.000Z", numer: "FV 12/08", przedZakupem: true };
    pokaz("/obsluga/reklamacje/1");
    expect(screen.queryByText("Dowody")).not.toBeInTheDocument();
    expect(screen.queryByText("Wysłaliśmy")).not.toBeInTheDocument();
    expect(screen.queryByText("Klient zapłacił")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Zdjęcia/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Dalej: sztuka do dostawcy" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/usterka\.jpg/).length).toBeGreaterThan(0);
  });
});

describe("Odpowiedź w rozmowie", () => {
  it("odpowiedź jedzie z WERSJĄ i z ostatnią NIE naszą wiadomością", async () => {
    /* Własna odpowiedź NIE przesuwa punktu odniesienia. */
    pokaz("/obsluga/reklamacje/1", [
      wiad(),
      wiad({ id: 2, externalId: "w-2", autorRola: "SELLER", tresc: "Proszę o zdjęcie" }),
    ]);
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    expect(bezOdswiezenia()).toEqual([`odpowiedz:${JSON.stringify({
      id: 1, tresc: "Wysyłam nowy nóż", expectedWersja: 1,
      expectedLastMessageId: 1, mimoNowejWiadomosci: false,
    })}`]);
  });

  it("dopisek DORADCY otwiera dialog zgody i nazywa go po imieniu", async () => {
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = new Konflikt("Ktoś dopisał wiadomość", {
      lastMessageId: 7, kluczIdempotencji: "rek-1-7-ab12",
      nowaWiadomosc: { id: 7, tresc: "Proszę o zdjęcie noża", at: null, rola: "ADMIN" },
    });
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    expect(screen.getByRole("dialog", { name: "Wysyłka zatrzymana" })).toBeInTheDocument();
    expect(screen.getByText(/doradca Allegro dopisał wiadomość/)).toBeInTheDocument();
    expect(screen.getByLabelText("Odpowiedź w sprawie")).toHaveValue("Wysyłam nowy nóż");
  });

  it("po j edytor nowej sprawy liczy zwłokę od nowa: szybkie Ctrl+Enter nie wysyła jej szkicu", async () => {
    for (const r of REKLAMACJE) zapamietajSzkic("reklamacja", r.id, `Szkic sprawy ${r.id}`);
    pokaz("/obsluga/reklamacje/1");
    const zegar = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    await userEvent.keyboard("j");
    expect(screen.getByLabelText("Odpowiedź w sprawie")).not.toHaveValue("Szkic sprawy 1");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    zegar.mockRestore();
    expect(bezOdswiezenia().filter((m) => m.startsWith("odpowiedz:"))).toEqual([]);
  });

  it("okno konfliktu bierze fokus: pisanie nie idzie w szkic pod nakładką", async () => {
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
  });

  it("„WYŚLIJ MIMO TO” jest martwy do jawnej zgody, a potem niesie flagę", async () => {
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = new Konflikt("Ktoś dopisał wiadomość", {
      lastMessageId: 7, kluczIdempotencji: "rek-1-7-ab12",
      nowaWiadomosc: { id: 7, tresc: "Dopisuję", at: null, rola: "BUYER" },
    });
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    expect(screen.getByText(/klient dopisał wiadomość/)).toBeInTheDocument();
    const mimoTo = screen.getByRole("button", { name: "WYŚLIJ MIMO TO" });
    expect(mimoTo).toBeDisabled();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox"));
    scena.mutacje = [];
    await userEvent.click(mimoTo);
    expect(bezOdswiezenia()).toEqual([`odpowiedz:${JSON.stringify({
      id: 1, tresc: "Wysyłam nowy nóż", expectedWersja: 1,
      expectedLastMessageId: 1, mimoNowejWiadomosci: true,
    })}`]);
  });

  it("po wysłaniu pole się czyści, a po niejednoznacznym wyniku — NIE", async () => {
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = { status: "sent" };
    const pole = screen.getByLabelText("Odpowiedź w sprawie");
    await userEvent.type(pole, "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    expect(pole).toHaveValue("");
    scena.wynikWysylki = { status: "send_uncertain" };
    await userEvent.type(pole, "Druga próba");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    expect(pole).toHaveValue("Druga próba");
    expect(screen.getByText(/nie dała jednoznacznej odpowiedzi/)).toBeInTheDocument();
  });

  it("odmowa BEZ dopisku to jedno zdanie pod polem, nie dialog", async () => {
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = new Konflikt(
      "Allegro zamknęło rozmowę w tej sprawie i nie przyjmie nowej wiadomości.", {});
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/Allegro zamknęło rozmowę/)).toBeInTheDocument();
  });

  it("zamknięta rozmowa nie daje pola do pisania — ani wyłączonego, ani żadnego", () => {
    REKLAMACJE[1].czatAktywny = false;
    try {
      pokaz("/obsluga/reklamacje/2");
      expect(screen.queryByLabelText("Odpowiedź w sprawie")).not.toBeInTheDocument();
    } finally {
      REKLAMACJE[1].czatAktywny = true;
    }
  });

  it("po udanej wysyłce ekran DOCIĄGA sprawę, zamiast czekać na takt", async () => {
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = { status: "sent" };
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    expect(scena.mutacje.filter((m) => m.startsWith("odswiez:"))).toHaveLength(2);
  });

  it("nieudana wysyłka NIE dociąga sprawy — nie ma czego dociągać", async () => {
    pokaz("/obsluga/reklamacje/1");
    const przed = scena.mutacje.filter((m) => m.startsWith("odswiez:")).length;
    scena.wynikWysylki = new Konflikt("Allegro zamknęło rozmowę w tej sprawie", {});
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    expect(scena.mutacje.filter((m) => m.startsWith("odswiez:")).length).toBe(przed);
  });
});

describe("Prawa kolumna: decyzja, produkt, notatka", () => {
  it("kolejność: decyzja, potem produkt, potem notatka — wszystko za rozmową", () => {
    pokaz("/obsluga/reklamacje/1");
    const kolumna = screen.getByRole("complementary", { name: "Decyzja i produkt" });
    const produkt = within(kolumna).getByRole("region", { name: "Produkt" });
    const notatka = within(kolumna).getByRole("region", { name: "Notatka wewnętrzna" });
    expect(produkt.compareDocumentPosition(notatka) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Opis sprawy 1").compareDocumentPosition(kolumna)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* Decyzja stoi PIERWSZA w kolumnie: jej przyciski są przed produktem. */
    const pierwszy = within(kolumna).getAllByRole("button")[0];
    expect(pierwszy.compareDocumentPosition(produkt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(produkt).queryByText("Paragon")).not.toBeInTheDocument();
  });

  it("notatka: Edytuj otwiera pole, Zapisz jedzie z WERSJĄ i zamyka pole po sukcesie", async () => {
    await zmienionymi([[0, { notatka: "Wada fabryczna", notatkaPrzez: "Tomasz Nowak",
      notatkaAt: "2026-10-08T09:10:00.000Z" }]], async () => {
      pokaz("/obsluga/reklamacje/1");
      const notatka = screen.getByRole("region", { name: "Notatka wewnętrzna" });
      expect(within(notatka).getByText("Wada fabryczna")).toBeInTheDocument();
      expect(within(notatka).getByText(/Tomasz Nowak · .* · klient jej nie widzi/)).toBeInTheDocument();
      expect(bezOdswiezenia()).toEqual([]);
      await userEvent.click(within(notatka).getByRole("button", { name: "Edytuj" }));
      const pole = within(notatka).getByLabelText("Notatka wewnętrzna");
      await userEvent.clear(pole);
      await userEvent.type(pole, "Uznać i wysłać nowy");
      scena.wynikNotatki = { reklamacja: {} };
      await userEvent.click(within(notatka).getByRole("button", { name: "Zapisz" }));
      expect(bezOdswiezenia()).toEqual([`notatka:${JSON.stringify({ id: 1, notatka: "Uznać i wysłać nowy", wersja: 1 })}`]);
      expect(within(notatka).queryByLabelText("Notatka wewnętrzna")).not.toBeInTheDocument();
    });
  });

  it("notatka: Anuluj nie zapisuje niczego, a 409 zostawia tekst i mówi zdanie serwera", async () => {
    pokaz("/obsluga/reklamacje/1");
    const notatka = screen.getByRole("region", { name: "Notatka wewnętrzna" });
    await userEvent.click(within(notatka).getByRole("button", { name: "Dodaj" }));
    await userEvent.type(within(notatka).getByLabelText("Notatka wewnętrzna"), "Coś");
    await userEvent.click(within(notatka).getByRole("button", { name: "Anuluj" }));
    expect(bezOdswiezenia()).toEqual([]);
    expect(within(notatka).getByText("Brak notatki.")).toBeInTheDocument();

    await userEvent.click(within(notatka).getByRole("button", { name: "Dodaj" }));
    await userEvent.type(within(notatka).getByLabelText("Notatka wewnętrzna"), "Moja wersja");
    scena.wynikNotatki = new Konflikt("Ktoś zmienił tę sprawę — odśwież i spróbuj jeszcze raz.", { wersja: 2 });
    await userEvent.click(within(notatka).getByRole("button", { name: "Zapisz" }));
    expect(within(notatka).getByText(/Ktoś zmienił tę sprawę/)).toBeInTheDocument();
    expect(within(notatka).getByLabelText("Notatka wewnętrzna")).toHaveValue("Moja wersja");
  });

  it("notatka: „Cofnij zmianę” stoi tylko przy poprzedniej wersji i jedzie z wersją sprawy", async () => {
    await zmienionymi([[0, { notatka: "Nowa", notatkaPrzez: "Ala", notatkaAt: "2026-10-08T09:10:00.000Z",
      maPoprzedniaNotatke: true, wersja: 3 }]], async () => {
      pokaz("/obsluga/reklamacje/1");
      await userEvent.click(screen.getByRole("button", { name: "Cofnij zmianę" }));
      expect(bezOdswiezenia()).toEqual([`cofnij-notatke:${JSON.stringify({ id: 1, wersja: 3 })}`]);
    });
  });
});

/* ── Werdykt z ekranu ────────────────────────────────────────────────────────
   Uznanie niesie stanowisko o towarze TYM SAMYM żądaniem, a serwer oddaje
   jego los obok werdyktu. Werdykt jest nieodwracalny, więc porażka towaru
   nie może go cofnąć: dopisek otwiera ten sam dialog co przy odpowiedzi,
   a reszta to zdanie w karcie. Sprawę „dociągniętą” po werdykcie udaje
   `poWerdykcie`, bo atrapa szczegółu czyta tablicę spraw przy każdym renderze. */
describe("Werdykt z ekranu", () => {
  const WYNIK: WynikWerdyktu = {
    werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy", status: "sent", blad: null, wersja: 2,
  };
  /* Sprawa po werdykcie, tak jak przyjdzie z serwera po odświeżeniu. */
  const uznana = (n: Partial<Reklamacja> = {}): Partial<Reklamacja> => ({
    werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy", werdyktStatus: "sent",
    werdyktWiadomosc: "Zwracamy.", wersja: 2, ...n,
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
  const formularz = () => screen.getByRole("form", { name: "Werdykt" });

  const uznaj = async (towar: RegExp) => {
    await userEvent.click(screen.getByRole("button", { name: /Uznaj reklamację/ }));
    await userEvent.click(within(formularz()).getByRole("radio", { name: towar }));
    await userEvent.type(within(formularz()).getByLabelText(/Wiadomość do klienta/), "Zwracamy.");
    await userEvent.click(within(formularz()).getByRole("checkbox"));
    await userEvent.click(within(formularz()).getByRole("button", { name: "Uznaj i wyślij do Allegro" }));
  };

  it("werdykt niesie WERSJĘ sprawy i idzie dopiero po zgodzie", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByRole("button", { name: /Odrzuć reklamację/ }));
    await userEvent.click(within(formularz()).getByRole("radio", { name: "Towar zgodny z umową" }));
    await userEvent.type(within(formularz()).getByLabelText(/Wiadomość do klienta/), "Towar sprawny.");
    const wyslij = within(formularz()).getByRole("button", { name: "Odrzuć i wyślij do Allegro" });
    expect(wyslij).toBeDisabled();
    await userEvent.click(within(formularz()).getByRole("checkbox"));
    await userEvent.click(wyslij);
    expect(bezOdswiezenia()).toEqual([
      `werdykt:${JSON.stringify({
        id: 1, werdykt: "REJECTED_PRODUCT_CONFORMS_TO_CONTRACT",
        wiadomosc: "Towar sprawny.", kwotaGrosze: null, wersja: 1,
      })}`,
    ]);
  });

  it("uznanie niesie TOWAR tym samym żądaniem, z ostatnią NIE naszą wiadomością", async () => {
    pokaz("/obsluga/reklamacje/1");
    await uznaj(/Towar do odesłania/);
    expect(bezOdswiezenia()).toEqual([`werdykt:${JSON.stringify({
      id: 1, werdykt: "ACCEPTED_REFUND", wiadomosc: "Zwracamy.", kwotaGrosze: null, wersja: 1,
      towar: {
        decyzja: "wymagany",
        tresc: "Prosimy o odesłanie reklamowanego towaru na adres sklepu. Po otrzymaniu paczki zrealizujemy uznaną reklamację.",
        expectedLastMessageId: 1,
      },
    })}`]);
  });

  it("porażka towaru po werdykcie stoi zdaniem w karcie — werdykt do formularza nie wraca", async () => {
    pokaz("/obsluga/reklamacje/1");
    await zSprawa({}, async () => {
      scena.wynikWerdyktu = { ...WYNIK, towar: { blad: "Allegro nie przyjęło wiadomości o towarze" } };
      scena.poWerdykcie = () => Object.assign(REKLAMACJE[0], uznana());
      await uznaj(/Towar zostaje u klienta/);
      expect(screen.getByText(/Allegro nie przyjęło wiadomości o towarze/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Uznaj reklamację/ })).not.toBeInTheDocument();
      /* Kroku „Towar do odesłania?” po werdykcie nie ma — decyzja właściciela. */
      expect(screen.queryByText("Towar do odesłania?")).not.toBeInTheDocument();
    });
  });

  it("niepewny los towaru wskazuje Centrum Sprzedaży, nie synchronizację", async () => {
    pokaz("/obsluga/reklamacje/1");
    await zSprawa({}, async () => {
      scena.wynikWerdyktu = { ...WYNIK, towar: { status: "send_uncertain" } };
      scena.poWerdykcie = () => Object.assign(REKLAMACJE[0], uznana({ zwrotTowaru: "wymagany" }));
      await uznaj(/Towar do odesłania/);
      expect(screen.getByText(/mogło nie dojść do kupującego.*Centrum Sprzedaży/)).toBeInTheDocument();
      expect(screen.queryByText(/zsynchronizuj/)).not.toBeInTheDocument();
    });
  });

  it("werdykt niepewny pomija towar i MÓWI to, a „Sprawdź w Allegro” tylko odświeża sprawę", async () => {
    pokaz("/obsluga/reklamacje/1");
    await zSprawa({}, async () => {
      scena.wynikWerdyktu = { ...WYNIK, status: "send_uncertain",
        towar: { pominiety: "Werdykt mógł nie dojść do Allegro, więc stanowiska o towarze nie wysłaliśmy" } };
      scena.poWerdykcie = () => Object.assign(REKLAMACJE[0], uznana({ werdyktStatus: "send_uncertain" }));
      await uznaj(/Towar do odesłania/);
      expect(screen.getByText(/stanowiska o towarze nie wysłaliśmy/)).toBeInTheDocument();
      scena.mutacje = [];
      await userEvent.click(screen.getByRole("button", { name: "Sprawdź w Allegro teraz" }));
      expect(scena.mutacje).toEqual(['odswiez:{"id":1}']);
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
      await uznaj(/Towar zostaje u klienta/);
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

  it("sztuki do dostawcy nie ma na ekranie także po uznaniu z odesłaniem — otwarcie nie zapisuje", async () => {
    scena.dostawa = { dostawca: "HURT-OGR", data: "2026-08-20T00:00:00.000Z", numer: "FV 12/08", przedZakupem: true };
    await zSprawa(uznana({ zwrotTowaru: "wymagany", kubelek: "decyzja" }), async () => {
      pokaz("/obsluga/reklamacje/1");
      expect(bezOdswiezenia()).toEqual([]);
      expect(screen.queryByRole("group", { name: "Dalej: sztuka do dostawcy" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Zgłoś u dostawcy" })).not.toBeInTheDocument();
    });
  });
});
