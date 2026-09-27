import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

/* ── Co odświeża zapis zwrotu (audyt zwrotów, 15 września 2026) ──────────────
   Dwie usterki jednej linijki. `["zwroty"]` jest przedrostkiem koszyka
   i rozjazdów, więc każdy klawisz decyzji przeładowywał trzy listy — w tym
   rozjazdy liczone z całej bazy. A szczegół, który niesie blok pieniędzy, nie
   odświeżał się po przyjęciu ani po kwocie: ekran pisał „Najpierw zaznacz, co
   oddajemy" nad już zapisaną kwotą.                                         */

vi.mock("./klient", () => ({ api: vi.fn(async () => ({ wersja: 2 })) }));
const { kluczeZwrotow, useKwota, useOdmowPlatnosci, useSledzDosylkeZwrotu, useWerdykt } = await import("./zwroty");
const { api } = await import("./klient");
const prawdziwyKlient = await vi.importActual<typeof import("./klient")>("./klient");

const ROZJAZDY = ["zwroty", "rozjazdy"] as const;

function stanowisko() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const k of [kluczeZwrotow.kolejka, kluczeZwrotow.zwrot(5), kluczeZwrotow.kosz, ROZJAZDY]) {
    qc.setQueryData(k, {});
  }
  /* Profil i „Moje” — dla zapisów, które przy okazji zmieniają sprawę klienta. */
  for (const k of [PROFIL, MOJE]) qc.setQueryData(k, {});
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const niewazne = (k: readonly unknown[]) => qc.getQueryState(k)?.isInvalidated;
  return { wrapper, niewazne };
}

/* Klucze z `spoiwo.ts` i `rozmowy.ts`, przepisane tu celowo: test ma się
   wywrócić, gdy ktoś je zmieni, a odświeżenie przestanie trafiać. */
const PROFIL = ["profil-klienta", "zielony_ogrod"] as const;
const MOJE = ["mojeSprawy"] as const;
/** Krok, który ustawia serwer — ekran go tylko przepisuje z odpowiedzi. */
const KROK = "Dosłać nowy towar (etykieta w Sellasist)";

afterEach(() => { vi.mocked(api).mockReset(); vi.mocked(api).mockImplementation(async () => ({ wersja: 2 })); vi.unstubAllGlobals(); });

describe("Odświeżenie po decyzji zwrotu", () => {
  it("kwota odświeża kolejkę i szczegół, a rozjazdów ani koszyka nie rusza", async () => {
    const s = stanowisko();
    const { result } = renderHook(() => useKwota(), { wrapper: s.wrapper });
    await result.current.mutateAsync({ id: 5, pozycjeIds: [1], dostawa: false, wersja: 1 });
    expect(s.niewazne(kluczeZwrotow.kolejka)).toBe(true);
    expect(s.niewazne(kluczeZwrotow.zwrot(5))).toBe(true);
    expect(s.niewazne(ROZJAZDY)).toBe(false);
    expect(s.niewazne(kluczeZwrotow.kosz)).toBe(false);
  });

  it("przyjęcie odświeża szczegół — to on pokazuje ODDAJ PIENIĄDZE", async () => {
    const s = stanowisko();
    const { result } = renderHook(() => useWerdykt(), { wrapper: s.wrapper });
    await result.current.mutateAsync({ id: 5, decyzja: "przyjety", powod: null, wersja: 1 });
    expect(s.niewazne(kluczeZwrotow.zwrot(5))).toBe(true);
    expect(s.niewazne(ROZJAZDY)).toBe(false);
  });
});

/* ── Dosyłka przy zwrocie (0.536.0) ─────────────────────────────────────────
   „Śledź dosyłkę” idzie BEZ CIAŁA — reguła klienta HTTP z `CLAUDE.md`: pusty
   JSON to „Bad Request” od Fastify. A zapis, który założył dosyłkę, zmienił
   też sprawę klienta, więc jej odczyty czytają się od nowa.                  */
describe("Dosyłka przy zwrocie", () => {
  it("„Śledź dosyłkę” nie niesie ciała ani typu treści", async () => {
    /* Tu idzie PRAWDZIWY klient HTTP: sprawdzamy to, co wychodzi z panelu,
       a nie tylko to, co hook podał dalej. */
    const f = vi.fn(async () => new Response(JSON.stringify(
      { zalozona: true, login: "zielony_ogrod", krokDo: "2026-09-30T06:00:00Z", krok: KROK, zastapil: null })));
    vi.stubGlobal("fetch", f);
    vi.mocked(api).mockImplementation(prawdziwyKlient.api);
    const s = stanowisko();
    const { result } = renderHook(() => useSledzDosylkeZwrotu(), { wrapper: s.wrapper });
    await result.current.mutateAsync({ id: 5 });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/obsluga/zwroty/5/dosylka");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it("założona dosyłka odświeża zwrot, profil klienta i „Moje”", async () => {
    vi.mocked(api).mockImplementation(async () =>
      ({ zalozona: true, login: "Zielony_Ogrod", krokDo: "2026-09-30T06:00:00Z", krok: KROK, zastapil: null }));
    const s = stanowisko();
    const { result } = renderHook(() => useSledzDosylkeZwrotu(), { wrapper: s.wrapper });
    await result.current.mutateAsync({ id: 5 });
    expect(s.niewazne(kluczeZwrotow.kolejka)).toBe(true);
    expect(s.niewazne(kluczeZwrotow.zwrot(5))).toBe(true);
    /* Klucz profilu jest małymi literami — login porównuje się bez wielkości. */
    expect(s.niewazne(PROFIL)).toBe(true);
    expect(s.niewazne(MOJE)).toBe(true);
  });

  it("odmowa z dosyłką odświeża sprawę klienta, odmowa bez niej — nie", async () => {
    vi.mocked(api).mockImplementation(async () => ({ kod: "NO_RETURN_RIGHT", wersja: 2 }));
    const bez = stanowisko();
    const r1 = renderHook(() => useOdmowPlatnosci(), { wrapper: bez.wrapper });
    await r1.result.current.mutateAsync({ id: 5, kod: "NO_RETURN_RIGHT", powod: null, wersja: 1 });
    expect(bez.niewazne(kluczeZwrotow.zwrot(5))).toBe(true);
    expect(bez.niewazne(PROFIL)).toBe(false);

    vi.mocked(api).mockImplementation(async () => ({ kod: "NEW_ITEM_SENT", wersja: 2,
      dosylka: { zalozona: true, login: "zielony_ogrod", krokDo: "2026-09-30T06:00:00Z", krok: KROK,
        zastapil: "czekamy na zwrot" } }));
    const z = stanowisko();
    const r2 = renderHook(() => useOdmowPlatnosci(), { wrapper: z.wrapper });
    const w = await r2.result.current.mutateAsync({ id: 5, kod: "NEW_ITEM_SENT", powod: null, wersja: 1 });
    expect(w.dosylka).toMatchObject({ zalozona: true, zastapil: "czekamy na zwrot" });
    expect(z.niewazne(PROFIL)).toBe(true);
    expect(z.niewazne(MOJE)).toBe(true);
  });
});

/* ── Zapis czeka na świeży szczegół (@wydanie) ──────────────────────────────
   Lekcja `poZapisieSprawy` ze `spoiwo.ts`: bez obietnicy zwróconej
   z `onSettled` `isPending` gasło przed odświeżeniem, a sekcja pieniędzy
   rysowała przez chwilę stan sprzed zapisu z czynnymi przyciskami. Test
   wstrzymuje drugi odczyt szczegółu i patrzy, czy mutacja na niego czeka. */
describe("Dosyłka przy zwrocie — zapis czeka na świeży szczegół", () => {
  function zWstrzymanymSzczegolem<T>(hak: () => T) {
    let pusc = () => {};
    const wstrzymanie = new Promise<void>((r) => { pusc = r; });
    let odczyty = 0;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const r = renderHook(() => {
      /* Otwarty szczegół zwrotu — aktywne zapytanie, więc unieważnienie go czyta. */
      useQuery({ queryKey: kluczeZwrotow.zwrot(5), queryFn: async () => {
        odczyty += 1;
        if (odczyty > 1) await wstrzymanie;
        return {};
      } });
      return hak();
    }, { wrapper });
    return { ...r, pusc, odczyty: () => odczyty };
  }

  it("odmowa wypłaty trwa, dopóki szczegół zwrotu się nie odświeży", async () => {
    vi.mocked(api).mockImplementation(async () => ({ kod: "ITEM_FIXED", wersja: 2 }));
    const h = zWstrzymanymSzczegolem(() => useOdmowPlatnosci());
    await waitFor(() => expect(h.odczyty()).toBe(1));
    act(() => { h.result.current.mutate({ id: 5, kod: "ITEM_FIXED", powod: null, wersja: 1 }); });
    await waitFor(() => expect(h.odczyty()).toBe(2));
    expect(h.result.current.isPending).toBe(true);
    h.pusc();
    await waitFor(() => expect(h.result.current.isPending).toBe(false));
  });

  it("„Śledź dosyłkę” trwa, dopóki szczegół zwrotu się nie odświeży", async () => {
    vi.mocked(api).mockImplementation(async () =>
      ({ zalozona: true, login: "zielony_ogrod", krokDo: "2026-09-30T06:00:00Z", krok: KROK, zastapil: null }));
    const h = zWstrzymanymSzczegolem(() => useSledzDosylkeZwrotu());
    await waitFor(() => expect(h.odczyty()).toBe(1));
    act(() => { h.result.current.mutate({ id: 5 }); });
    await waitFor(() => expect(h.odczyty()).toBe(2));
    expect(h.result.current.isPending).toBe(true);
    h.pusc();
    await waitFor(() => expect(h.result.current.isPending).toBe(false));
  });
});
