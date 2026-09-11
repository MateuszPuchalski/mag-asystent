import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Konflikt } from "../api/klient";
import type { KubelekReklamacji, Reklamacja, WiadomoscReklamacji } from "../api/typy";

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
  otwartoAt: "2026-09-06T10:00:00.000Z", kupionoAt: null, kupionoZrodlo: null,
  prowadzi: null, prowadziId: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, prowadziAt: null,
  notatka: null, wersja: 1, kubelek, sygnaly: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: `Towar ${id}`, ofertaZdjecie: "brak", twId: null, twSymbol: null,
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
];

/* `vi.hoisted`, bo fabryka `vi.mock` jedzie przed resztą pliku. */
const scena = vi.hoisted(() => ({
  mutacje: [] as string[],
  stan: {} as Record<string, unknown>,
  czat: [] as unknown[],
  /* Czym kończy się wysyłka w danym teście: `Error` idzie do `onError`,
     cokolwiek innego do `onSuccess`, `null` nie woła żadnego z nich. */
  wynikWysylki: null as unknown,
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
        zalaczniki: [], zwroty: [], rozmowy: [], kartoteka: null,
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
    useSynchronizuj: mutacja("synchronizuj"),
    useWerdykt: mutacja("werdykt"),
    useZwrotTowaru: mutacja("zwrot-towaru"),
  };
});

const { Reklamacje } = await import("./Reklamacje");

const wiad = (n: Partial<WiadomoscReklamacji> = {}): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "klient1", autorRola: "BUYER",
  tresc: "Kosiarka przestała ciąć", utworzonoAt: "2026-09-06T10:01:00.000Z",
  zalaczniki: [{ id: 9, wiadomoscId: 1, nazwa: "usterka.jpg", podglad: true }], ...n,
});

function pokaz(adres = "/obsluga/reklamacje", czat: WiadomoscReklamacji[] = [wiad()]) {
  scena.mutacje = [];
  scena.czat = czat;
  scena.wynikWysylki = null;
  scena.stan = {
    status: "current", alarm: false, ostatniaProba: null,
    ostatniaUdanaSynchronizacja: "2026-09-07T11:00:00.000Z", kodOstatniegoBledu: null,
    liczbaBledow: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 180000,
    pozostaloDoPobrania: 0, dyskusjiPominietych: 35,
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

describe("Ekran reklamacji", () => {
  it("otwarcie ekranu i wybranie sprawy NIE wywołują żadnej mutacji", async () => {
    pokaz();
    expect(scena.mutacje).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /111\/2026/ }));
    expect(scena.mutacje).toEqual([]);
  });

  it("kubełki niosą pytanie i licznik, a pytanie stoi nad listą", () => {
    pokaz();
    expect(screen.getByTitle(/Uznać czy odrzucić\? \(klawisz 1\)/)).toBeInTheDocument();
    expect(screen.getByTitle(/Co odpisać klientowi\? \(klawisz 2\)/)).toBeInTheDocument();
    /* Pytanie zastępuje menu akcji — dekalog, punkt 5. */
    expect(screen.getByText("Uznać czy odrzucić?")).toBeInTheDocument();
  });

  it("kubełek DO DECYZJI pokazuje tylko sprawy przed werdyktem", () => {
    pokaz();
    expect(screen.getByText("111/2026")).toBeInTheDocument();
    expect(screen.queryByText("222/2026")).not.toBeInTheDocument();
  });

  it("przełączenie kubełka przestawia KURSOR na jego pierwszą sprawę", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByTitle(/Tylko wgląd\. \(klawisz 3\)/));
    /* Bez przestawienia kursora środkowa kolumna pokazywałaby rozmowę ze
       sprawy z poprzedniego kubełka. Wiersz kolejki JEST wybrany — a numer
       stoi też w kolumnie dowodów, więc szukamy po roli, nie po tekście. */
    const wiersz = await screen.findByRole("button", { name: /222\/2026/ });
    expect(wiersz).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
  });

  it("liczba odsianych dyskusji stoi na pasku — to zakres panelu, nie błąd", () => {
    pokaz();
    expect(screen.getByText(/dyskusji pominiętych/)).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
  });

  it("nad rozmową stoi pasek werdyktu z dwoma przyciskami, a zdanie o Centrum Sprzedaży zniknęło", () => {
    /* Od przyrostu trzeciego werdykt wychodzi STĄD. Napis odsyłający do
       Centrum Sprzedaży byłby nieprawdą — tak samo jak w 0.224.0 napis
       o odpowiedzi. */
    pokaz("/obsluga/reklamacje/1");
    const pasek = screen.getByRole("region", { name: "Werdykt" });
    expect(pasek).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /UZNAJĘ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ODRZUCAM/ })).toBeInTheDocument();
    expect(screen.queryByText(/Centrum Sprzedaży/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Odpowiedź .* wysyła się/)).not.toBeInTheDocument();
  });

  it("werdykt z ekranu niesie WERSJĘ sprawy i idzie dopiero po zgodzie", async () => {
    /* Wersja z ekranu jest obowiązkowa po stronie serwera: werdykt bez
       wiedzy, na co agent patrzył, to werdykt w ciemno. Ekran ją dokłada sam. */
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByRole("button", { name: /ODRZUCAM/ }));
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), "Towar sprawny.");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ WERDYKT/ }));
    expect(scena.mutacje).toEqual([
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
    await userEvent.click(screen.getByRole("button", { name: /Synchronizuj teraz/ }));
    expect(scena.mutacje).toEqual(["synchronizuj:undefined"]);
  });

  it("„prowadzę” jedzie z WERSJĄ rekordu — inaczej nadpisałoby pracę kolegi", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByRole("button", { name: /Prowadzę tę sprawę/ }));
    expect(scena.mutacje).toEqual([`prowadze:${JSON.stringify({ id: 1, wersja: 1 })}`]);
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
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODPOWIEDŹ/ }));
    expect(scena.mutacje).toEqual([`odpowiedz:${JSON.stringify({
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
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODPOWIEDŹ/ }));
    expect(screen.getByRole("dialog", { name: "Wysyłka zatrzymana" })).toBeInTheDocument();
    expect(screen.getByText(/doradca Allegro dopisał wiadomość/)).toBeInTheDocument();
    /* Szkic zostaje NIETKNIĘTY: serwer odrzucił wysyłkę przed strzałem. */
    expect(screen.getByLabelText("Odpowiedź w sprawie")).toHaveValue("Wysyłam nowy nóż");
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
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODPOWIEDŹ/ }));
    expect(screen.getByText(/klient dopisał wiadomość/)).toBeInTheDocument();
    const mimoTo = screen.getByRole("button", { name: "WYŚLIJ MIMO TO" });
    expect(mimoTo).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    scena.mutacje = [];
    await userEvent.click(mimoTo);
    expect(scena.mutacje).toEqual([`odpowiedz:${JSON.stringify({
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
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODPOWIEDŹ/ }));
    expect(pole).toHaveValue("");

    scena.wynikWysylki = { status: "send_uncertain" };
    await userEvent.type(pole, "Druga próba");
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODPOWIEDŹ/ }));
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
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODPOWIEDŹ/ }));
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
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODPOWIEDŹ/ }));
    expect(scena.mutacje).toContain(`odswiez:${JSON.stringify({ id: 1 })}`);
  });

  it("nieudana wysyłka NIE dociąga sprawy — nie ma czego dociągać", async () => {
    pokaz("/obsluga/reklamacje/1");
    scena.wynikWysylki = new Konflikt("Allegro zamknęło rozmowę w tej sprawie", {});
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Wysyłam nowy nóż");
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODPOWIEDŹ/ }));
    expect(scena.mutacje.some((m) => m.startsWith("odswiez:"))).toBe(false);
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
    /* Kubełek „Do decyzji" ma trzy sprawy, moja jest jedna — sito chowa dwie.
       Liczebnik w formie 2–4, bo „chowa 2 spraw" czyta się jak usterka. */
    expect(screen.getByText(/chowa 2 sprawy/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "pokaż wszystkie" }));
    expect(screen.getByRole("button", { name: /555\/2026/ })).toBeInTheDocument();
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
    expect(przed).toEqual(["111/2026", "444/2026", "555/2026"]);
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
  it("czip mówi „Ty”, gdy sprawa jest moja, i IMIĘ, gdy cudza", () => {
    pokaz();
    /* 444 prowadzę ja (konto 7), 555 — imienniczka o koncie 9. Obie noszą
       to samo imię, więc imię na wierszu na to pytanie nie odpowiada. */
    expect(screen.getByTitle(/Prowadzisz tę sprawę/)).toHaveTextContent("Ty");
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

  it("skróty klawiszowe SĄ WIDOCZNE, a nie tylko w podpowiedzi pod kursorem", () => {
    /* Dekalog p. 2: rozpoznanie jest tańsze od pamiętania. Skrót, o którym
       nikt nie wie, nie skraca niczyjej pracy. */
    pokaz();
    for (const k of ["j", "k", "m", "n"]) {
      expect(screen.getByText(k, { selector: "kbd" })).toBeInTheDocument();
    }
    expect(screen.getByText("ruch po liście")).toBeInTheDocument();
  });
});
