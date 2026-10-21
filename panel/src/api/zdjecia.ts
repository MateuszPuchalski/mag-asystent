import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Konflikt, PrzerwaAllegro, api, pobierzBlob } from "./klient";
import { zapomnijObraz } from "../towar/useZdjecie";

/* ── ZDJĘCIA TOWARÓW BEZ ZDJĘCIA ───────────────────────────────────────────
   Lista kartotek Subiekta bez obrazu i trzy kroki dodania zdjęcia z biurka.
   Podgląd z usuniętym tłem robi serwer, a gotowy plik idzie do Subiekta
   tą samą kolejką co reszta zapisów. Typy stoją tutaj, bo to kształt tylko
   dla biura, nie kontrakt z kolektorem. */

export interface PozycjaBezZdjecia {
  twId: number;
  symbol: string;
  nazwa: string;
  ean: string | null;
  /** Suma stanu ze wszystkich magazynów Subiekta. */
  stan: number;
  /** Sztuki sprzedane na FS i PA w ostatnich 30 dniach. */
  sprzedaz: number;
  /** Zdjęcie już czeka w kolejce do Subiekta. */
  oczekuje: boolean;
}

export interface ListaBezZdjecia {
  /** `false`, gdy funkcja jest wyłączona na serwerze; wtedy `powod` mówi dlaczego. */
  wlaczone: boolean;
  powod?: string;
  razem: number;
  pozycje: PozycjaBezZdjecia[];
}

export const NA_STRONIE = 50;

/** Porządek listy; nazwy idą do serwera, który zna tylko te cztery. */
export type SortBezZdjecia = "sprzedaz" | "stan" | "symbol" | "nazwa" | "najnowsze";

export function useBezZdjecia(q: string, offset: number, sortuj: SortBezZdjecia = "sprzedaz",
  naStanie = false, sprzedane = false) {
  const p = new URLSearchParams({ q, limit: String(NA_STRONIE), offset: String(offset), sortuj });
  if (naStanie) p.set("naStanie", "1");
  if (sprzedane) p.set("sprzedane", "1");
  return useQuery({
    queryKey: ["zdjecia", "bez-zdjecia", q, offset, sortuj, naStanie, sprzedane],
    queryFn: () => api<ListaBezZdjecia>(`/api/zdjecia/bez-zdjecia?${p}`),
    /* Poprzednia strona zostaje na ekranie, dopóki nie przyjdzie następna.
       Pusta lista na ułamek sekundy przesuwałaby wiersze pod kursorem. */
    placeholderData: keepPreviousData,
  });
}

export interface PodgladZdjecia {
  podgladId: string;
  tlo: "usuniete" | "zostawione";
  /** PNG z przezroczystym tłem, gdy `tlo` = `usuniete`; inaczej obraz wysłany. */
  png: string;
  mime: string;
  /** Dlaczego tło zostało — zdanie z serwera dla agenta. */
  powod?: string;
}

export interface ZapisanieZdjecia {
  queueId: number | null;
  etag: string;
  bajtow: number;
  /** `true`: powstało zadanie do Subiekta. `false`: zdjęcie zostaje tylko w WERTIS. */
  wSubiekcie: boolean;
}

const sciezka = (twId: number) => `/api/products/${twId}/zdjecie`;

/* 409 znaczy: funkcję wyłączono w trakcie pracy. Lista dowie się o tym
   od serwera i zamieni ekran w wyjaśnienie, zamiast zostawić martwy przycisk. */
function useGdyWylaczone() {
  const qc = useQueryClient();
  return (e: unknown) => { if (e instanceof Konflikt) void qc.invalidateQueries({ queryKey: ["zdjecia"] }); };
}

/** Krok 1: zdjęcie z biurka → podgląd z usuniętym tłem. Nic jeszcze nie idzie do Subiekta. */
export function useWstepneZdjecie() {
  const gdyWylaczone = useGdyWylaczone();
  return useMutation({
    mutationFn: ({ twId, zdjecie }: { twId: number; zdjecie: string }) =>
      api<PodgladZdjecia>(`${sciezka(twId)}/wstepne`, { method: "POST", body: JSON.stringify({ zdjecie }) }),
    onError: gdyWylaczone,
  });
}

/** Krok 2: zatwierdzony podgląd → kolejka do Subiekta. */
export function useZapiszZdjecie() {
  const qc = useQueryClient();
  const gdyWylaczone = useGdyWylaczone();
  return useMutation({
    mutationFn: ({ twId, podgladId, zTlem, gotowy }: {
      twId: number; podgladId: string; zTlem: boolean; gotowy?: string;
    }) => api<ZapisanieZdjecia>(sciezka(twId), {
      method: "POST",
      body: JSON.stringify({ podgladId, zTlem, zrodlo: "panel", ...(gotowy ? { gotowy } : {}) }),
    }),
    onSuccess: (_w, { twId }) => {
      /* Pamięć obrazów trzyma „ten towar na pewno nie ma zdjęcia”. Bez
         zapomnienia kafel towaru w innych ekranach kłamałby do F5. */
      zapomnijObraz(sciezka(twId));
      void qc.invalidateQueries({ queryKey: ["zdjecia"] });
    },
    onError: gdyWylaczone,
  });
}

/** Porzucenie podglądu, żeby serwer nie trzymał pliku, którego nikt nie zatwierdzi. */
export function usePorzucPodglad() {
  return useMutation({
    mutationFn: ({ twId, podgladId }: { twId: number; podgladId: string }) =>
      api(`${sciezka(twId)}/wstepne/${encodeURIComponent(String(podgladId))}`, { method: "DELETE" }),
  });
}

/* ── IMPORT Z FOLDERU ──────────────────────────────────────────────────────
   Setki plików nazwanych symbolem, każdy jako gotowy biały kwadrat. Bez
   podglądu na serwerze, bo tła nie usuwamy — decyzja właściciela. */

export interface PozycjaDopasowania {
  symbol: string;
  /** `null`: w Subiekcie nie ma towaru o tym symbolu. */
  twId: number | null;
  nazwa: string | null;
  maZdjecie: boolean;
  /** Zdjęcie tego towaru już czeka w kolejce do Subiekta. */
  oczekuje: boolean;
  zablokowany: boolean;
  /** Symbol trafia w kilka aktywnych kartotek; wtedy `twId` i `nazwa` są `null`. */
  niejednoznaczny?: boolean;
}

export interface Dopasowanie { wlaczone: boolean; powod?: string; pozycje: PozycjaDopasowania[] }

/**
 * Symbole z nazw plików → towary Subiekta. To odczyt, ale w POST, bo lista
 * symboli nie mieści się w adresie. Woła go dopiero wybór plików, nigdy
 * otwarcie ekranu.
 */
export function useDopasujSymbole() {
  return useMutation({
    mutationFn: async (paczki: string[][]): Promise<Dopasowanie> => {
      const wynik: Dopasowanie = { wlaczone: true, pozycje: [] };
      /* Paczki po kolei: jedna baza Subiekta, a równoległe pytania tylko by ją dławiły. */
      for (const symbole of paczki) {
        const d = await api<Dopasowanie>("/api/zdjecia/dopasuj", { method: "POST", body: JSON.stringify({ symbole }) });
        if (!d.wlaczone) return d;
        wynik.pozycje.push(...d.pozycje);
      }
      return wynik;
    },
  });
}

/**
 * Wysyłka gotowych zdjęć importu. `wyslij` NIE unieważnia listy przy każdym
 * pliku: trzysta odświeżeń listy w minutę to trzysta pytań do bazy Subiekta.
 * Listę odświeża `zakoncz`, raz po całym przebiegu.
 */
export function useImportGotowych() {
  const qc = useQueryClient();
  const wyslij = useMutation({
    /* `zrodlo` trafia do audytu: zdjęcie z oferty i z folderu to dwie różne drogi. */
    mutationFn: ({ twId, gotowy, plik, zrodlo = "import" }: {
      twId: number; gotowy: string; plik: string; zrodlo?: "import" | "allegro";
    }) =>
      api<ZapisanieZdjecia>(`${sciezka(twId)}/gotowe`, {
        method: "POST", body: JSON.stringify({ gotowy, zrodlo, plik }),
      }),
    /* Jak przy zapisie z edytora: pamięć obrazów nie może dalej mówić „bez zdjęcia". */
    onSuccess: (_w, { twId }) => zapomnijObraz(sciezka(twId)),
  });
  return {
    wyslij: wyslij.mutateAsync,
    zakoncz: () => void qc.invalidateQueries({ queryKey: ["zdjecia"] }),
  };
}

/* ── ZDJĘCIA Z OFERT ALLEGRO ───────────────────────────────────────────────
   Towar bez zdjęcia w Subiekcie często ma ofertę ze zdjęciem na Allegro.
   Serwer wybiera ofertę po symbolu (`external.id`), a panel składa z jej
   zdjęcia biały kwadrat tą samą drogą co import z folderu. */

/** Ile symboli mieści jedno pytanie — tyle przyjmuje `external.id` w Allegro. */
export const SYMBOLI_NA_PYTANIE_ALLEGRO = 100;

/** Przerwa po 429, gdy Allegro nie podało czasu. Pół minuty wystarcza na typowy limit. */
export const PRZERWA_ALLEGRO_MS = 30_000;

/** Ile towarów bez zdjęcia na jedną stronę zbiórki — limit trasy listy. */
export const ZBIORKA_NA_STRONE = 200;

export interface OfertaZdjecia {
  id: string;
  nazwa: string;
  status: string | null;
  startedAt: string | null;
  /** `false`: oferta jest, ale żadna z ofert symbolu nie ma zdjęcia głównego. */
  zdjecie: boolean;
}

export interface PozycjaOferty { symbol: string; ofert: number; oferta: OfertaZdjecia | null }

export interface DopasowanieOfert { wlaczone: boolean; powod?: string; pozycje: PozycjaOferty[] }

/** Wynik całej zbiórki: co zdążyło przyjść i dlaczego przebieg stanął, jeśli stanął. */
export interface PrzebiegOfert {
  pozycje: PozycjaOferty[];
  /** Zdanie serwera, gdy funkcja jest wyłączona. */
  wylaczone?: string;
  /** Błąd, który zatrzymał pytanie (drugie 429 z rzędu, awaria Allegro, brak sieci). */
  blad?: unknown;
  zatrzymane?: boolean;
}

export interface SterowanieOfert {
  postep: (zrobione: number, wszystkich: number) => void;
  /** Przerwa przed ponowieniem paczki; `false`, gdy agent zatrzymał przebieg w trakcie. */
  czekaj: (ms: number) => Promise<boolean>;
  stop: () => boolean;
}

/**
 * Symbole → wybrana oferta Allegro, w paczkach po sto, po kolei.
 *
 * To odczyt w POST, bo lista symboli nie mieści się w adresie. Woła go
 * dopiero przycisk „Sprawdź oferty”, nigdy otwarcie okna. Paczki idą po
 * kolei, bo równoległe pytania szybciej wyczerpują limit Allegro.
 * Po 429 czekamy, ile prosi Allegro, i ponawiamy tę paczkę RAZ: drugie 429
 * znaczy, że limit trwa dłużej, a dalsze pytania tylko go wydłużą.
 */
export function useDopasujOferty() {
  const m = useMutation({
    mutationFn: (symbole: string[]) => api<DopasowanieOfert>("/api/zdjecia/allegro/dopasuj", {
      method: "POST", body: JSON.stringify({ symbole }),
    }),
  });
  const pytaj = m.mutateAsync;
  return async (symbole: readonly string[], s: SterowanieOfert): Promise<PrzebiegOfert> => {
    const pozycje: PozycjaOferty[] = [];
    s.postep(0, symbole.length);
    for (let i = 0; i < symbole.length; i += SYMBOLI_NA_PYTANIE_ALLEGRO) {
      if (s.stop()) return { pozycje, zatrzymane: true };
      const paczka = symbole.slice(i, i + SYMBOLI_NA_PYTANIE_ALLEGRO);
      let d: DopasowanieOfert;
      try {
        try {
          d = await pytaj(paczka);
        } catch (e) {
          if (!(e instanceof PrzerwaAllegro)) throw e;
          if (!(await s.czekaj(e.poIluMs ?? PRZERWA_ALLEGRO_MS))) return { pozycje, zatrzymane: true };
          d = await pytaj(paczka);
        }
      } catch (e) {
        return { pozycje, blad: e };
      }
      if (!d.wlaczone) {
        return { pozycje: [], wylaczone: d.powod ?? "Zdjęcia z ofert Allegro są w tej instalacji wyłączone." };
      }
      pozycje.push(...d.pozycje);
      s.postep(Math.min(i + paczka.length, symbole.length), symbole.length);
    }
    return { pozycje };
  };
}

/**
 * Wszystkie towary bez zdjęcia, strona po stronie. Sam odczyt, więc bez haka
 * mutacji. `null`, gdy agent zatrzymał zbiórkę.
 */
export async function zbierzBezZdjecia(postep: (zebrane: number, razem: number) => void,
  stop: () => boolean): Promise<ListaBezZdjecia | null> {
  const pozycje: PozycjaBezZdjecia[] = [];
  let razem = 0;
  for (let offset = 0; ; offset += ZBIORKA_NA_STRONE) {
    if (stop()) return null;
    const p = new URLSearchParams({ q: "", limit: String(ZBIORKA_NA_STRONE), offset: String(offset), sortuj: "sprzedaz" });
    const d = await api<ListaBezZdjecia>(`/api/zdjecia/bez-zdjecia?${p}`);
    if (!d.wlaczone) return d;
    razem = d.razem;
    pozycje.push(...d.pozycje);
    postep(pozycje.length, razem);
    /* Pusta strona też kończy: lista mogła się skrócić w trakcie zbiórki. */
    if (d.pozycje.length === 0 || pozycje.length >= razem) break;
  }
  return { wlaczone: true, razem, pozycje };
}

/** Duże zdjęcie oferty, z którego panel składa biały kwadrat. */
export const pobierzZdjecieOferty = (offerId: string): Promise<Blob> =>
  pobierzBlob(`/api/zdjecia/allegro/oferta/${encodeURIComponent(offerId)}/zdjecie`);
