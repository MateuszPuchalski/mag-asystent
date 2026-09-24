import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── Wgląd biura: dziennik i analiza (0.440.0) ──────────────────────────
   Przeniesione z DZIENNIKA i ANALIZY w `biuro.html`. Trasy są TE SAME, którymi
   jeździło biuro — przeprowadzka zmienia front, nie umowę z serwerem. Typy
   stoją tutaj, a nie w `typy.ts`, z powodu podanego przy `api/dostawy.ts`:
   to kształty tylko dla biura, nie kontrakt z kolektorem. Wzór każdego z nich
   leży na serwerze obok funkcji, która go liczy — przy rozjeździe wygrywa
   serwer, a `panel-adresy.test.ts` pilnuje przynajmniej samych adresów. */

/* ── Dziennik (`routes/audyt.ts`) ─────────────────────────────────────────── */

export interface WpisAudytu {
  id: number;
  typ: string;
  czas: string;
  uzytkownik: string;
  userRef: number | null;
  device: string | null;
  twId: number | null;
  payload: string | null;
}

export interface Dziennik {
  wpisy: WpisAudytu[];
  /** Wszystkie pasujące, nie długość strony — stąd „pokazano N z M". */
  razem: number;
  typy: string[];
}

/** Filtr dziennika tak, jak go trzyma ekran — daty jako „2026-09-22" z pola. */
export interface FiltrDziennika {
  od: string;
  do: string;
  typ: string;
  twId: string;
  device: string;
  userRef: string;
  limit: number;
}

export const FILTR_PUSTY: FiltrDziennika = { od: "", do: "", typ: "", twId: "", device: "", userRef: "", limit: 100 };

/**
 * Doba LOKALNA jako przedział w UTC.
 *
 * Biuro wysyłało gołe „2026-09-22", a serwer porównuje je napisowo ze
 * znacznikami w UTC (`created_at` ma kształt `toISOString()`). Wpis z 00:30
 * czasu polskiego to 22:30 dnia poprzedniego w UTC — więc filtr „od 22.09"
 * gubił pierwsze dwie godziny doby, a „do 22.09" łapał dwie godziny
 * z następnej. Tu doba zaczyna się o północy PRZEGLĄDARKI, tak jak czyta ją
 * człowiek, a serwer dostaje pełny znacznik i nic nie musi zgadywać.
 */
export function granicaDoby(data: string, koniec: boolean): string {
  const [r, m, d] = data.split("-").map(Number);
  if (!r || !m || !d) return "";
  return (koniec ? new Date(r, m - 1, d, 23, 59, 59, 999) : new Date(r, m - 1, d)).toISOString();
}

/** Query string filtra — puste pola znikają, jak w biurze. */
export function paramyDziennika(f: FiltrDziennika): string {
  const p = new URLSearchParams();
  const dodaj = (k: string, v: string) => { if (v) p.set(k, v); };
  dodaj("od", f.od ? granicaDoby(f.od, false) : "");
  dodaj("do", f.do ? granicaDoby(f.do, true) : "");
  dodaj("typ", f.typ);
  dodaj("twId", f.twId.trim());
  dodaj("device", f.device.trim());
  dodaj("userRef", f.userRef);
  p.set("limit", String(f.limit));
  return p.toString();
}

export function useDziennik(f: FiltrDziennika) {
  return useQuery({
    queryKey: ["dziennik", f],
    queryFn: () => api<Dziennik>(`/api/events?${paramyDziennika(f)}`),
    /* Poprzedni wynik stoi, dopóki nowy nie dojdzie — tabela nie mruga przy
       każdym znaku w polu urządzenia. */
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* ── Analiza śladu audytowego (`services/raporty.ts`) ─────────────────────── */

export interface WierszWydajnosci {
  userId: number | null;
  osoba: string;
  pozycje: number;
  minutyAktywne: number;
  tempo: number | null;
  zgloszoneProblemy: number;
  recznePrzepisania: number;
  wiarygodne: boolean;
}

export interface RaportWydajnosci {
  days: number;
  podstawaPrawna: string;
  progWiarygodnosci: number;
  wiersze: WierszWydajnosci[];
  nieprzypisanychZdarzen: number;
}

export interface AnalizaAudytu {
  days: number;
  dni: Array<{ data: string; pozycje: number; zdarzen: number }>;
  godziny: number[];
  rytm: {
    dostawZamknietych: number;
    medianaMinutDostawy: number | null;
    pozycjiNaDostawe: number | null;
    problemyZgloszone: number;
    problemyRozwiazane: number;
    problemyOtwarte: number;
  };
  szukania: { top: Array<{ q: string; ile: number }>; bezWynikow: Array<{ q: string; ile: number }> };
  urzadzenia: Array<{ device: string; upadki: number; niskieBaterie: number; odrzucone: number; zdarzen: number }>;
  /** `null` dla każdego poza administratorem — serwer tego raportu wtedy NIE LICZY. */
  wydajnosc: RaportWydajnosci | null;
  szczyt: { data: string; pozycje: number; medianaPozostalych: number } | null;
  daneDo: string | null;
}

export function useAnaliza(dni: number, wlaczona: boolean) {
  return useQuery({
    queryKey: ["analiza", dni],
    queryFn: () => api<AnalizaAudytu>(`/api/analiza?days=${dni}`),
    /* Zakres, na który nikt nie patrzy, nie jest pobierany — ta sama reguła
       co w biurze (`odswiezAnalize`). */
    enabled: wlaczona,
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* ── Czas odpowiedzi klientowi (`services/czas-odpowiedzi.ts`, 23.09.2026) ── */

export interface WierszCzasu { klucz: string; n: number; medianaMin: number | null }

export interface CzasOdpowiedzi {
  dni: number;
  daneDo: string | null;
  ogolem: { n: number; medianaMin: number | null; p90Min: number | null };
  wgKategorii: WierszCzasu[];
  /** `null` dla roli biuro — rozbicie na ludzi liczy serwer wyłącznie adminowi. */
  wgOsoby: WierszCzasu[] | null;
  czekaTeraz: { n: number; najdluzejMin: number | null };
}

export function useCzasOdpowiedzi(dni: number, wlaczona: boolean) {
  return useQuery({
    queryKey: ["analiza", "obsluga", dni],
    queryFn: () => api<CzasOdpowiedzi>(`/api/analiza/obsluga?days=${dni}`),
    enabled: wlaczona,
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* ── Użycie (`services/uzycie.ts`, 23 września 2026) ────────────────────── */

export interface WpisUzycia { typ: string; ile: number; ostatnio: string | null }

export interface RaportUzycia {
  dni: number;
  obszary: Array<{ obszar: string; nieuzywane: WpisUzycia[]; uzywane: WpisUzycia[] }>;
  spozaRejestru: WpisUzycia[];
}

export function useUzycie(dni: number, wlaczona: boolean) {
  return useQuery({
    queryKey: ["analiza", "uzycie", dni],
    queryFn: () => api<RaportUzycia>(`/api/analiza/uzycie?days=${dni}`),
    enabled: wlaczona,
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* ── Raport tygodnia (`services/raport-tygodnia.ts`, @wydanie) ───────────
   Zamrożony przy zapisie przez takt serwera. Ekran tylko czyta: tygodnia
   niepoliczonego nie ma na liście, więc nie ma też o co zapytać 404. */

export interface NaglowekRaportu { tydzien: string; od: string; do: string; wersja: number; utworzono: string }

export interface Migawka {
  doDecyzji: { wszystko: number; magazyn: number; obsluga: number; pilne: number; najstarszaGodz: number | null } | null;
  problemyOtwarte: number | null;
  kolejka: { bledy: number; wDrodze: number } | null;
  klientCzeka: { n: number; najdluzejMin: number | null } | null;
  zwroty: Record<string, number> | null;
  reklamacje: Record<string, number> | null;
}

export interface RaportTygodnia {
  wersja: number;
  tydzien: string;
  od: string;
  do: string;
  dni: string[];
  magazyn: {
    pozycje: number; pozycjeWgDnia: number[]; dostawZamknietych: number; medianaMinutDostawy: number | null;
    problemyZgloszone: number; problemyRozwiazane: number; dotknieciaNaPozycje: number | null;
    p95SkanuMs: number | null; etykietyDoPrzedruku: Array<{ kod: string; reczne: number }>;
    szukaniaBezWynikow: Array<{ q: string; ile: number }>; upadkiKolektorow: number; odrzuconeOperacje: number;
  };
  obsluga: {
    wiadomosciOdKlientow: number; odpowiedzi: number; medianaMin: number | null; p90Min: number | null;
    klientCzekaNaKoniec: { n: number; najdluzejMin: number | null };
    zwrotyNowe: number; zwrotyZamkniete: number; reklamacjeNowe: number; reklamacjeRozstrzygniete: number;
  };
  copilot: { wywolan: number; bledow: number; kosztUsd: number };
  system: { kopieNocne: number; rozjazdyRekoncyliacji: number | null; zapisyNieudane: number; odrzuconeZadaniaHttp: number };
  migawki: Array<{ data: string; at: string; stan: Migawka }>;
}

export function useTygodnie(wlaczona: boolean) {
  return useQuery({
    queryKey: ["analiza", "tygodnie"],
    queryFn: () => api<{ tygodnie: NaglowekRaportu[] }>("/api/analiza/tygodnie"),
    enabled: wlaczona,
  });
}

export function useRaportTygodnia(tydzien: string | null) {
  return useQuery({
    queryKey: ["analiza", "tygodnie", tydzien],
    queryFn: () => api<{ raport: RaportTygodnia; poprzedni: RaportTygodnia | null }>(
      `/api/analiza/tygodnie/${tydzien}`),
    enabled: tydzien != null,
    /* Raport jest zamrożony — ten sam tydzień nie zmieni się do końca
       sesji, więc ponowne pobranie przy powrocie na kartę nic nie wnosi. */
    staleTime: Infinity,
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* ── Metryki (`services/raporty.ts` `metrics`) ─────────────────────────────── */

export interface Metryki {
  days: number;
  dotknieciaNaPozycje: number | null;
  p95OdpowiedziMs: number | null;
  etykietyDoPrzedruku: Array<{ code: string; reczne: number; razem: number; udzial: number }>;
  towaryBezCzytelnegoKodu: Array<{ code: string; reczne: number }>;
  zdarzen: number;
}

export function useMetryki(dni: number, wlaczona: boolean) {
  return useQuery({
    queryKey: ["metryki", dni],
    queryFn: () => api<Metryki>(`/api/metrics?days=${dni}`),
    enabled: wlaczona,
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* ── Ergonomia w liczbach (`services/ergonomia.ts`) ──────────────────────── */

export interface Kubelki { n: number; powyzejProgu: number; udzialPowyzejProgu: number; p95: string | null }
export interface CzasySkanu { n: number; p50: number | null; p95: number | null }

export interface Ergonomia {
  days: number;
  daneDo: string | null;
  progMs: number;
  czasy: Kubelki & {
    wgTrasy: Array<Kubelki & { ekran: string; trasa: string }>;
    wgKolektora: Array<Kubelki & { device: string | null; etykieta: string }>;
  };
  skanGlowny: CzasySkanu & { wgKolektora: Array<CzasySkanu & { device: string | null; etykieta: string }> };
  powtorzoneSkany: Array<{ device: string | null; etykieta: string; skanow: number; powtorzonych: number; udzial: number }>;
  odrzucenia: Array<{ trasa: string; status: number | null; powod: string; ile: number; urzadzen: number }>;
  przerwy: Array<{ device: string | null; etykieta: string; przerw: number; minutRazem: number; najdluzszaMin: number }>;
  poprawki: Array<{ czynnosc: string; wykonane: number; poprawek: number; udzial: number | null; rozbicie: Record<string, number> }>;
}

export function useErgonomia(dni: number, wlaczona: boolean) {
  return useQuery({
    queryKey: ["analiza", "ergonomia", dni],
    queryFn: () => api<Ergonomia>(`/api/analiza/ergonomia?days=${dni}`),
    enabled: wlaczona,
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* ── Analiza dostaw (`services/podglad-dostawy.ts`) ───────────────────────── */

export interface AnalizaDostaw {
  dni: number;
  zamknietych: number;
  pozaWertis: number;
  pozycjiRozlozonych: number;
  udzialWyjatkow: number | null;
  medianaDni: number | null;
  dostawcy: Array<{ dostawca: string; dostaw: number; pozycji: number; udzialWyjatkow: number | null; medianaDni: number | null }>;
  wyjatki: Array<{ typ: string; nazwa: string; otwartych: number; rozwiazanych: number }>;
  tygodnie: Array<{ tydzien: string; ile: number }>;
  szczyt: { tydzien: string; ile: number; medianaPozostalych: number } | null;
  daneDo: string | null;
}

export function useAnalizaDostaw(dni: number, wlaczona: boolean) {
  return useQuery({
    queryKey: ["analizaDostaw", dni],
    queryFn: () => api<{ analiza: AnalizaDostaw }>(`/api/biuro/dostawy/analiza?dni=${dni}`)
      .then((d) => d.analiza),
    enabled: wlaczona,
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* ── Strefa złota (`routes/zbiorki.ts`) ───────────────────────────────────── */

export interface KandydatStrefy {
  twId: number;
  sym: string;
  nazwa: string;
  zbiorki: number;
  zbiorekNaDzien: number;
  adres: string | null;
  poziomy: string;
}

export interface RaportKandydatow {
  okno: { od: string; do: string; dni: number } | null;
  prog: number;
  kandydaci: KandydatStrefy[];
  juzWStrefie: number;
  bezReguly: number;
}

export interface WynikImportuZbiorek {
  wierszy: number;
  nowych: number;
  pominietychDuplikatow: number;
  dopasowanych: number;
  niedopasowanych: number;
  przykladyNiedopasowanych: string[];
  odrzuconychWierszy: number;
  okres: { od: string; do: string } | null;
}

export function useKandydaci(wlaczona: boolean) {
  return useQuery({
    queryKey: ["kandydaciStrefy"],
    queryFn: () => api<RaportKandydatow>("/api/biuro/zbiorki/kandydaci"),
    enabled: wlaczona,
  });
}

/**
 * Wgranie CSV zbiórek — zwykły POST `{ csv }`, bez multipart. Powód z biura:
 * ten sam POST ma w przyszłości wołać integracja z Sellasist.
 */
export function useImportZbiorek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) => api<WynikImportuZbiorek>("/api/biuro/zbiorki/import", {
      method: "POST", body: JSON.stringify({ csv }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kandydaciStrefy"] }),
  });
}
