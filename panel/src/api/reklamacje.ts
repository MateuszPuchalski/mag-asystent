import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, pobierzPlik } from "./klient";
import type { ZalacznikSzkicu } from "./rozmowy";
import type {
  KolejkaReklamacji, Reklamacja, SzczegolReklamacji, WynikOdpowiedziReklamacji, WynikWerdyktu,
} from "./typy";

/* Reklamacje jadą JEDNYM zapytaniem razem z licznikami — ten sam wybór co przy
   zwrotach. Spraw w pracy są dziesiątki, nie tysiące, więc przełączenie
   kubełka nie kosztuje ani jednego strzału do serwera. */

export const kluczeReklamacji = {
  kolejka: ["reklamacje"] as const,
  reklamacja: (id: number) => ["reklamacja", id] as const,
  zalacznikiWysylki: (id: number) => ["reklamacja-zalaczniki-wysylki", id] as const,
};

export function useReklamacje() {
  return useQuery({
    queryKey: kluczeReklamacji.kolejka,
    queryFn: () => api<KolejkaReklamacji>("/api/obsluga/reklamacje"),
  });
}

export function useReklamacja(id: number | null) {
  return useQuery({
    queryKey: kluczeReklamacji.reklamacja(id ?? 0),
    queryFn: () => api<SzczegolReklamacji>(`/api/obsluga/reklamacje/${id}`),
    enabled: id !== null,
  });
}

/**
 * Ręczne dociągnięcie.
 *
 * Ten sam powód co przy zwrotach: bez niego diagnoza „czemu tej reklamacji tu
 * nie ma" wymagałaby czekania trzech minut na ticker — czyli dokładnie wtedy,
 * gdy ktoś patrzy na ekran i chce wiedzieć, czy problem jest w danych, czy
 * w kodzie.
 */
export interface WynikSynchronizacji {
  reklamacji: number;
  /** Ile spraw odsialiśmy jako dyskusje. Nie jest to błąd, tylko zakres panelu. */
  dyskusji: number;
  czatow: number;
}

export function useSynchronizuj() {
  const qc = useQueryClient();
  return useMutation({
    /* Żądanie BEZ ciała nie deklaruje typu treści — pilnuje tego `api()`
       i jego test. Pusty JSON to `FST_ERR_CTP_EMPTY_JSON_BODY` i gołe
       „Bad Request" na ekranie; ta blizna kosztowała dwa razy. */
    mutationFn: () => api<WynikSynchronizacji>("/api/obsluga/reklamacje/synchronizuj",
      { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka }),
  });
}

/** Znacznik „prowadzę" — ponowne kliknięcie go zdejmuje. */
export function useProwadze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ reklamacja: Reklamacja }>(`/api/obsluga/reklamacje/${v.id}/prowadze`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka });
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.reklamacja(v.id) });
    },
  });
}

export function useNotatka() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; notatka: string | null; wersja: number }) =>
      api<{ reklamacja: Reklamacja }>(`/api/obsluga/reklamacje/${v.id}/notatka`,
        { method: "POST", body: JSON.stringify({ notatka: v.notatka, wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka });
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.reklamacja(v.id) });
    },
  });
}

/**
 * Pobranie załącznika.
 *
 * Idzie przez `pobierzPlik`, a nie przez `<a href>`: sesja jedzie nagłówkiem
 * `x-session`, którego odnośnik nie niesie. Pobranie załącznika rozmowy było
 * z tego powodu zepsute od 0.155.0 do 0.219.1 i wyglądało, jakby działało.
 */
export const pobierzZalacznik = (reklamacjaId: number, zalacznikId: number, nazwa: string) =>
  pobierzPlik(`/api/obsluga/reklamacje/${reklamacjaId}/zalaczniki/${zalacznikId}`, nazwa);

/**
 * Odpowiedź w rozmowie reklamacyjnej (0.224.0) — pierwszy zapis tego ekranu
 * wychodzący do Allegro.
 *
 * Konfliktu 409 hook CELOWO nie łapie: rozróżnia je ekran, bo każdy każe co
 * innego zrobić — dopisek otwiera dialog z jawną zgodą, zamknięta rozmowa
 * kończy temat, a rozjazd wersji każe odświeżyć. Ten sam podział co
 * w skrzynce.
 *
 * `expectedLastMessageId` to identyfikator ostatniej NIE naszej wiadomości —
 * liczy go panel z osi, a serwer sprawdza po swojemu i rozstrzyga.
 */
export function useOdpowiedz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number; tresc: string; expectedWersja: number;
      expectedLastMessageId: number | null; mimoNowejWiadomosci?: boolean;
    }) => api<WynikOdpowiedziReklamacji>(`/api/obsluga/reklamacje/${v.id}/odpowiedz`, {
      method: "POST",
      body: JSON.stringify({
        tresc: v.tresc,
        expectedWersja: v.expectedWersja,
        expectedLastMessageId: v.expectedLastMessageId,
        mimoNowejWiadomosci: Boolean(v.mimoNowejWiadomosci),
      }),
    }),
    /* `onSettled`, nie `onSuccess`: po niejednoznacznym timeoucie stan sprawy
       też mógł się zmienić, a ekran ma pokazać to, co naprawdę jest. */
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.reklamacja(v.id) });
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka });
    },
  });
}

/**
 * Werdykt reklamacji (przyrost trzeci) — uznanie albo odrzucenie do Allegro.
 *
 * Bez ponowienia i bez `onSuccess`: los próby przychodzi w odpowiedzi
 * (`sent`, `send_uncertain`, `send_failed`) i ekran pokazuje go ZDANIEM, a po
 * `onSettled` dociąga sprawę — bo `werdykt_*` stoi na wierszu, nie w wyniku.
 * 409 nie łapiemy: „już wyszedł" i „ktoś zmienił sprawę" to jedno zdanie
 * z serwera pod formularzem, nie dialog.
 */
export function useWerdykt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number; werdykt: string; wiadomosc: string; kwotaGrosze: number | null; wersja: number;
    }) => api<WynikWerdyktu>(`/api/obsluga/reklamacje/${v.id}/werdykt`, {
      method: "POST",
      body: JSON.stringify({
        werdykt: v.werdykt, wiadomosc: v.wiadomosc, kwotaGrosze: v.kwotaGrosze, wersja: v.wersja,
      }),
    }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.reklamacja(v.id) });
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka });
    },
  });
}

/**
 * Krok „towar do odesłania?" po uznaniu — zwykła wysyłka z innym `type`,
 * więc i 409 z dopiskiem klienta wraca tak samo i ekran robi ten sam triage,
 * co przy odpowiedzi. Każde pole ciała jawnie, jak przy odpowiedzi.
 */
export function useZwrotTowaru() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number; decyzja: "wymagany" | "niewymagany"; tresc: string; expectedWersja: number;
      expectedLastMessageId: number | null; mimoNowejWiadomosci?: boolean;
    }) => api<WynikOdpowiedziReklamacji>(`/api/obsluga/reklamacje/${v.id}/zwrot-towaru`, {
      method: "POST",
      body: JSON.stringify({
        decyzja: v.decyzja, tresc: v.tresc, expectedWersja: v.expectedWersja,
        expectedLastMessageId: v.expectedLastMessageId,
        mimoNowejWiadomosci: Boolean(v.mimoNowejWiadomosci),
      }),
    }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.reklamacja(v.id) });
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka });
    },
  });
}

/**
 * Odświeżenie JEDNEJ sprawy z Allegro (0.273.0).
 *
 * Do 0.272.0 świeży stan sprawy dawał wyłącznie pełny przebieg listy, czyli
 * takt trzech minut. Agent, który właśnie wysłał odpowiedź albo werdykt,
 * patrzy na ekran TERAZ — i najbardziej wtedy, gdy wysyłka skończyła się
 * niejednoznacznie: jedno żądanie rozstrzyga to, po co pasek odsyłał do
 * Centrum Sprzedaży.
 *
 * Błędu NIE pokazujemy jako porażki działania agenta: odświeżenie jest
 * dopiskiem do tego, co się właśnie udało, więc odmowa Allegro ma zostawić
 * ekran w spokoju i poczekać na takt.
 */
export function useOdswiez() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api<SzczegolReklamacji>(`/api/obsluga/reklamacje/${v.id}/odswiez`, { method: "POST" }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.reklamacja(v.id) });
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka });
    },
  });
}

/* ── Załączniki WYCHODZĄCE przy odpowiedzi (0.274.0) ─────────────────────────
   Kształt `ZalacznikSzkicu` jest wspólny ze skrzynką i to nie przypadek:
   ekran rysuje je TYM SAMYM komponentem (`skrzynka/ZalacznikiWysylki.tsx`),
   zgodnie z decyzją właściciela z 0.246.0 o wspólnym załączniku.            */

export function useZalacznikiSprawy(id: number | null) {
  return useQuery({
    queryKey: kluczeReklamacji.zalacznikiWysylki(id ?? 0),
    queryFn: () => api<{ zalaczniki: ZalacznikSzkicu[] }>(
      `/api/obsluga/reklamacje/${id}/zalaczniki-wysylki`),
    enabled: id !== null,
  });
}

export function useDodajZalacznikSprawy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; nazwa: string; typ: string; dane: string }) =>
      api<ZalacznikSzkicu>(`/api/obsluga/reklamacje/${v.id}/zalaczniki-wysylki`, {
        method: "POST",
        body: JSON.stringify({ nazwa: v.nazwa, typ: v.typ, dane: v.dane }),
      }),
    onSettled: (_d, _e, v) =>
      qc.invalidateQueries({ queryKey: kluczeReklamacji.zalacznikiWysylki(v.id) }),
  });
}

export function useUsunZalacznikSprawy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; zalacznikId: number }) =>
      api(`/api/obsluga/reklamacje/${v.id}/zalaczniki-wysylki/${v.zalacznikId}`,
        { method: "DELETE" }),
    onSettled: (_d, _e, v) =>
      qc.invalidateQueries({ queryKey: kluczeReklamacji.zalacznikiWysylki(v.id) }),
  });
}
