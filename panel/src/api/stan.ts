import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── Stan systemu (0.441.0) ─────────────────────────────────────────────
   Przeniesiony z NADZORU w `biuro.html`. Trasy są TE SAME, którymi jeździło
   biuro — przeprowadzka zmienia front, nie umowę z serwerem. Wzory typów
   leżą na serwerze obok funkcji, które je liczą: `routes/queue.ts`,
   `services/reconcile.ts`, `services/ean.ts`, `services/wymiana.ts`,
   `routes/allegro.ts` i `services/lokalizacje-masowe.ts`.

   Zapisy wołają `api()` BEZ CIAŁA tam, gdzie trasa go nie czyta. Biuro
   wysyłało `"{}"`; panel ma regułę pustego żądania bez typu treści
   (`klient.test.ts`) i trzyma się jej także tutaj. */

/* ── Kolejka zapisów do Subiekta ───────────────────────────────────────── */

export interface ZadanieKolejki {
  id: number;
  time: string;
  status: "pending" | "processing" | "waiting_for_doc" | "done" | "error" | "cancelled" | string;
  label: string;
  detail: string;
  errMsg: string | null;
}

export interface Kolejka {
  items: ZadanieKolejki[];
  summary: { pending: number; error: number; done: number };
}

/* Rytm 30 s, jak cykl biura: kolejka to stan TERAZ, a zadanie w błędzie ma
   się pojawić bez przeładowania strony. */
export const useKolejka = () => useQuery({
  queryKey: ["kolejkaSfery"],
  queryFn: () => api<Kolejka>("/api/queue"),
  refetchInterval: 30_000,
});

export function useRuchKolejki() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ruch }: { id: number; ruch: "retry" | "cancel" }) =>
      api<{ ok: boolean }>(`/api/queue/${id}/${ruch}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kolejkaSfery"] });
      /* Zadanie w błędzie stoi też w DO DECYZJI — ponowione ma stamtąd zejść. */
      qc.invalidateQueries({ queryKey: ["do-decyzji"] });
    },
  });
}

/* ── Rekoncyliacja ─────────────────────────────────────────────────────── */

export type RodzajRozjazdu = "lokalizacja" | "zadanie_w_bledzie" | "utknelo_w_buforze" | "mm_czeka"
  | "kosz_czeka_na_korekte" | "kosz_bez_powrotu" | "zwrot_bez_przelewu"
  | "zwrot_po_terminie" | "zwrot_rozliczony_bez_korekty";

export interface Rekoncyliacja {
  at: string;
  sprawdzono: { kartotek: number; zadan: number };
  rozjazdy: Array<{ rodzaj: RodzajRozjazdu; klucz: string; opis: string; odKiedy: string | null }>;
}

/**
 * Rekoncyliacja NA ŻĄDANIE, nigdy przy otwarciu ekranu. Porównuje całą
 * kartotekę z Subiektem — to najdroższy odczyt tej zakładki, a jego wynik
 * zwykle brzmi „bez rozjazdów". Nocny przebieg i tak ją liczy.
 */
export const useRekoncyliacja = () => useQuery({
  queryKey: ["rekoncyliacja"],
  queryFn: () => api<Rekoncyliacja>("/api/reconcile"),
  enabled: false,
  retry: false,
});

/* ── Kolizje kodów kreskowych ───────────────────────────────────────────── */

export interface KolizjaKodu {
  ean: string;
  hits: number;
  autoResolved: number;
  twIds: number[];
  lastSeen: string | null;
  rozstrzygniecie: { rodzaj: "poprawione" | "dopuszczone"; notatka: string | null; at: string; przez: string | null } | null;
  trafienPoDecyzji: number;
}

export const useKolizje = () => useQuery({
  queryKey: ["kolizjeKodow"],
  queryFn: () => api<{ conflicts: KolizjaKodu[] }>("/api/ean-conflicts").then((d) => d.conflicts ?? []),
});

export function useRozstrzygnijKolizje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ean, rodzaj, notatka }: { ean: string; rodzaj: "poprawione" | "dopuszczone"; notatka: string }) =>
      api(`/api/ean-conflicts/${encodeURIComponent(ean)}/rozstrzygnij`, {
        method: "POST", body: JSON.stringify({ rodzaj, notatka: notatka || undefined }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kolizjeKodow"] });
      qc.invalidateQueries({ queryKey: ["do-decyzji"] });
    },
  });
}

/* ── Wymiana z halą ────────────────────────────────────────────────────── */

export type KanalWymiany = "zadanie" | "niezgodnosc" | "pominiecie" | "kolizja" | "notatka";

export interface WierszWymiany {
  kanal: KanalWymiany;
  kierunek: string;
  zamknietych: number;
  medianaMin: number | null;
  p90Min: number | null;
  otwartych: number;
  najstarszaOtwartaMin: number | null;
}

export interface AlarmWymiany {
  dni: number;
  minSpraw: number;
  spoznionychRazem: number;
  kanaly: Array<{ kanal: KanalWymiany; spoznionych: number; progMin: number | null;
    podstawa: "p90" | "podloga" | "za_malo_spraw"; n: number; najstarszaSpoznionaMin: number | null }>;
}

export const useWymiana = (dni: number) => useQuery({
  queryKey: ["wymiana", dni],
  queryFn: () => api<{ wiersze: WierszWymiany[] }>(`/api/biuro/wymiana?dni=${dni}`).then((d) => d.wiersze ?? []),
  placeholderData: (poprzednie) => poprzednie,
});

/* Okno alarmu jest STAŁE (30 dni, bez parametru) — suwak przy tabeli rządzi
   tabelą, a sygnał, który zmienia treść przy przestawieniu listy, przestaje
   być sygnałem. Powód stoi przy trasie w `routes/biuro.ts`. */
export const useAlarmWymiany = () => useQuery({
  queryKey: ["alarmWymiany"],
  queryFn: () => api<AlarmWymiany>("/api/biuro/alarm-wymiany"),
});

/* ── Konto Allegro ─────────────────────────────────────────────────────── */

export interface StanAllegro {
  stan: "polaczone" | "niepolaczone" | "zle_srodowisko" | "dev" | "wylaczone" | string;
  srodowisko: string;
  wygasa: string | null;
}

export const useStanAllegro = () => useQuery({
  queryKey: ["stanAllegro"],
  queryFn: () => api<StanAllegro>("/api/biuro/allegro/status"),
});

export function useRozlaczAllegro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/biuro/allegro", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stanAllegro"] }),
  });
}

/* ── Serwer: operacje ratunkowe ─────────────────────────────────────────── */

export const useResync = () => useMutation({
  mutationFn: () => api<{ stats?: Record<string, unknown> }>("/api/admin/resync", { method: "POST" }),
});

export const useOdswiezZdjecia = () => useMutation({
  mutationFn: () => api<{ zapomniano?: number }>("/api/admin/zdjecia/odswiez", { method: "POST" }),
});

/* ── Masowa zmiana lokalizacji z arkusza ────────────────────────────────── */

export interface ZmianaAdresu {
  symbol: string;
  twId: number;
  nazwa: string;
  przed: string;
  po: string;
  znikaja: string[];
  zachowane: string[];
}

export interface RaportArkusza {
  wierszy: number;
  doZmiany: ZmianaAdresu[];
  bezZmian: number;
  nieznane: string[];
  odrzucone: Array<{ symbol: string; powod: string }>;
  wKolejce: number;
  zakolejkowano: number | null;
}

/** Treść żądania: pary z .xlsx rozbiera przeglądarka, CSV — serwer. */
export type TrescArkusza = { wiersze: Array<{ symbol: string; lokalizacja: string }> } | { csv: string };

/**
 * Jedna trasa na podgląd i zapis — `zastosuj` odróżnia jedno od drugiego.
 * Nie da się więc zastosować czegoś innego, niż się widziało na ekranie.
 */
export function useArkuszLokalizacji() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (x: { tresc: TrescArkusza; zachowaj: Record<string, string[]>; zastosuj: boolean }) =>
      api<RaportArkusza>("/api/biuro/lokalizacje/arkusz", {
        method: "POST", body: JSON.stringify({ ...x.tresc, zachowaj: x.zachowaj, zastosuj: x.zastosuj }),
      }),
    onSuccess: (_r, x) => { if (x.zastosuj) qc.invalidateQueries({ queryKey: ["kolejkaSfery"] }); },
  });
}
