import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type {
  KartaTowaru, OsRozmowy, PokrycieSygnatur, Rozmowa, SprawaRozmowy, StanSkrzynki, StatusRozmowy,
  WierszSprawy, WpisWzmianki, WynikWysylki, Zadanie, Zdrowie,
} from "./typy";

/* Klucze cache w jednym miejscu. Literał rozsypany po plikach kończy się tym,
   że unieważnienie mija się z zapytaniem o jedną literę — i ekran pokazuje
   stare dane bez żadnego objawu. */
export const klucze = {
  rozmowy: ["rozmowy"] as const,
  rozmowa: (id: number) => ["rozmowa", id] as const,
  zadania: ["zadania"] as const,
  ja: ["ja"] as const,
  zdrowie: ["zdrowie"] as const,
  wzmianki: ["wzmianki"] as const,
  sprawy: ["sprawy"] as const,
  sygnatury: ["sygnatury"] as const,
  towar: (twId: number) => ["towar", twId] as const,
};

export function useJa() {
  return useQuery({
    queryKey: klucze.ja,
    queryFn: () => api<{ user: { userId: number; name: string; role: string } }>("/api/auth/me"),
    staleTime: Infinity,
  });
}

export function useRozmowy() {
  return useQuery({
    queryKey: klucze.rozmowy,
    queryFn: () => api<{ rozmowy: Rozmowa[]; stan: StanSkrzynki }>("/api/obsluga/rozmowy"),
  });
}

export function useRozmowa(id: number | null) {
  return useQuery({
    queryKey: klucze.rozmowa(id ?? 0),
    queryFn: () => api<OsRozmowy>(`/api/obsluga/rozmowy/${id}`),
    enabled: id !== null,
  });
}

/**
 * Skrzynka wzmianek (§6.4).
 *
 * Odpytujemy zegarem, bo wzmianka przychodzi od KOLEGI, a nie z akcji tego
 * ekranu — panel nie ma po czym poznać, że w innej rozmowie ktoś właśnie
 * poprosił o pomoc. Trzydzieści sekund to rytm plakietki synchronizacji obok.
 */
export function useWzmianki() {
  return useQuery({
    queryKey: klucze.wzmianki,
    queryFn: () => api<{ wzmianki: WpisWzmianki[]; nowe: number }>("/api/obsluga/wzmianki"),
    refetchInterval: 30_000,
  });
}

/** Odhaczenie jest JAWNE — otwarcie listy niczego nie kasuje (§ zero zapisu). */
export function useOdhaczWzmianke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { commentId: number }) =>
      api(`/api/obsluga/wzmianki/${v.commentId}/odhacz`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: klucze.wzmianki }),
  });
}

/* ── Sprawa (§6.1) ───────────────────────────────────────────────────────────
   Trzy mutacje i ani jednej więcej: założenie klamry, dołączenie rozmowy
   i odklejenie. Każda unieważnia rozmowę ORAZ listę spraw, bo sklejenie
   zmienia obie strony naraz. */
export function useSprawy() {
  return useQuery({
    queryKey: klucze.sprawy,
    queryFn: () => api<{ sprawy: WierszSprawy[] }>("/api/obsluga/sprawy"),
  });
}

export function useZalozSprawe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { tytul: string; rozmowaId: number }) =>
      api<{ id: number; tytul: string }>("/api/obsluga/sprawy",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.sprawy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
    },
  });
}

export function useDolaczDoSprawy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { sprawaId: number; rozmowaId: number }) =>
      api<SprawaRozmowy>(`/api/obsluga/sprawy/${v.sprawaId}/rozmowy`,
        { method: "POST", body: JSON.stringify({ rozmowaId: v.rozmowaId }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.sprawy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
    },
  });
}

export function useOdlaczOdSprawy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number }) =>
      api(`/api/obsluga/rozmowy/${v.rozmowaId}/odlacz`, { method: "POST" }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.sprawy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
    },
  });
}

export function useZadania() {
  return useQuery({
    queryKey: klucze.zadania,
    queryFn: () => api<{ zadania: Zadanie[] }>("/api/zadania-terenowe"),
  });
}

/**
 * Przejęcie rozmowy.
 *
 * Konflikt NIE jest tu łapany: `Konflikt` leci do wołającego, bo ekran ma go
 * narysować kafelkami z właścicielem i wersją, a nie zamienić w komunikat.
 */
export function usePrzejmij() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; expectedVersion: number }) =>
      api(`/api/conversations/${v.id}/claim`, {
        method: "POST", body: JSON.stringify({ expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
    },
  });
}

/* Szkic jest współdzielony, więc zapis jest jawny i niesie wersję. Cicha
   autozapisywarka gubiłaby cudzą pracę przy dwóch agentach na jednej sprawie. */
export function useZapiszSzkic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: string; expectedLastMessageId: number | null; expectedVersion: number | null }) =>
      api<{ version: number }>(`/api/conversations/${v.id}/draft`, {
        method: "PUT",
        body: JSON.stringify({
          body: v.body,
          expectedLastMessageId: v.expectedLastMessageId,
          expectedVersion: v.expectedVersion,
        }),
      }),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) }),
  });
}

/**
 * Zmiana statusu rozmowy (§7).
 *
 * Bez blokady optymistycznej i to jest wybór, nie przeoczenie: status nie
 * jest treścią, którą dwoje ludzi pisze naraz. Dwa kliknięcia w tej samej
 * sekundzie dają stan tego, kto kliknął później — a oś pokazuje oba przejścia
 * z podpisami, więc nic nie ginie po cichu.
 */
export function useUstawStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; status: StatusRozmowy; doKiedy?: string | null }) =>
      api<{ status: StatusRozmowy; snoozedUntil: string | null }>(
        `/api/obsluga/rozmowy/${v.id}/status`,
        { method: "POST", body: JSON.stringify({ status: v.status, doKiedy: v.doKiedy ?? null }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
    },
  });
}

export function useZlecPomiar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; wiadomoscId: number; instrukcja: string; twId: number | null }) =>
      api("/api/obsluga/zadania/pomiar", { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: klucze.zadania });
    },
  });
}

export function useNoweZadanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      api("/api/zadania-terenowe", { method: "POST", body: JSON.stringify({ ...v, zrodlo: "panel" }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: klucze.zadania }),
  });
}

/**
 * Stan integracji z `/api/health` (§21).
 *
 * Odpytujemy zegarem, nie szyną zdarzeń: awaria synchronizacji objawia się
 * właśnie tym, że żadne zdarzenie nie przychodzi. Ekran, który czeka na
 * sygnał od zepsutego nadawcy, milczy razem z nim.
 */
export function useZdrowie() {
  return useQuery({
    queryKey: klucze.zdrowie,
    queryFn: () => api<Zdrowie>("/api/health"),
    refetchInterval: 30_000,
    staleTime: 0,
  });
}

export function useSynchronizuj() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/obsluga/synchronizuj", { method: "POST" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: klucze.zdrowie });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
    },
  });
}

/** Wymuszone przekazanie — odebranie rozmowy komuś z rąk. Powód obowiązkowy. */
export function usePrzekaz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; doUserId: number | null; powod: string; expectedVersion: number }) =>
      api(`/api/conversations/${v.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ doUserId: v.doUserId, powod: v.powod, expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
    },
  });
}

/**
 * Karta towaru z Subiekta — OSOBNO od rozmowy (0.179.0).
 *
 * Nie doklejamy jej do `useRozmowa`, bo tamten odczyt odświeża się przy każdym
 * zdarzeniu szyny, a karta ciągnie kolejkę MM, zamienniki i wszystkie
 * magazyny. Pobiera się dopiero wtedy, gdy jest czym: bez kartoteki nie ma
 * czego pytać.
 */
export function useKartaTowaru(twId: number | null) {
  return useQuery({
    queryKey: klucze.towar(twId ?? 0),
    queryFn: () => api<KartaTowaru>(`/api/products/${twId}`),
    enabled: twId !== null,
  });
}

/** Ręczne wskazanie kartoteki dla oferty z rozmowy; `twId: null` je zdejmuje. */
export function useWskazKartoteke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; ofertaId: string; twId: number | null }) =>
      api(`/api/conversations/${v.id}/kartoteka`, {
        method: "POST", body: JSON.stringify({ ofertaId: v.ofertaId, twId: v.twId }),
      }),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) }),
  });
}

/** Ręczna flaga „pilne" (§10.2). */
export function useUstawPriorytet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; priorytet: "normalny" | "pilny" }) =>
      api(`/api/obsluga/rozmowy/${v.id}/priorytet`, {
        method: "POST", body: JSON.stringify({ priorytet: v.priorytet }),
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
    },
  });
}

export function useWskazOferte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; ofertaId: string }) =>
      api(`/api/conversations/${v.id}/oferta`, {
        method: "POST", body: JSON.stringify({ ofertaId: v.ofertaId }),
      }),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) }),
  });
}

/**
 * Wysyłka odpowiedzi do klienta (§8.5).
 *
 * Konflikt świeżości NIE jest tu łapany: `Konflikt` leci do ekranu, bo to on
 * ma pokazać dopisek klienta obok szkicu i poprosić o jawną zgodę.
 */
export function useWyslij() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number; body: string; expectedVersion: number;
      expectedLastMessageId: number | null;
      mimoNowejWiadomosci?: boolean; mimoObecnosci?: boolean;
    }) => api<WynikWysylki>(`/api/conversations/${v.id}/send`, {
      method: "POST",
      body: JSON.stringify({
        body: v.body, expectedVersion: v.expectedVersion,
        expectedLastMessageId: v.expectedLastMessageId,
        mimoNowejWiadomosci: Boolean(v.mimoNowejWiadomosci),
        mimoObecnosci: Boolean(v.mimoObecnosci),
      }),
    }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
    },
  });
}

/**
 * Komentarz wewnętrzny (0.157.0).
 *
 * Do tego wydania `conversation_comment` miała w kodzie serwera jeden INSERT
 * i zero odczytów — notatka agenta przepadała. Trasa istniała, ekranu nie było.
 *
 * Od 0.157.0 do 0.181.0 hook wołał `/api/obsluga/rozmowy/:id/komentarz`,
 * którego serwer nigdy nie wystawił — komentarz ze skrzynki dostawał 404.
 * Testy tras pilnowały tras, które istnieją, a nie tego, że panel woła te same
 * adresy; od 0.181.1 pilnuje tego strażnik w `routes/skrzynka.test.ts`.
 */
export function useDodajKomentarz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; body: string; mentionedUserIds: number[] }) =>
      api<{ id: number }>(`/api/conversations/${v.rozmowaId}/comments`,
        { method: "POST", body: JSON.stringify({
          body: v.body, mentionedUserIds: v.mentionedUserIds }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
    },
  });
}

/**
 * Konta do wzmianek — z istniejącej trasy `/api/users`.
 *
 * Bez własnej końcówki: lista kont jest już wystawiona biuru i adminowi,
 * a drugi adres na te same dane znaczyłby dwa miejsca do pilnowania przy
 * zmianie ról.
 */
export function useAgenci() {
  return useQuery({
    queryKey: ["agenci"],
    queryFn: () => api<{ users: Array<{ userId: number; name: string; role: string }> }>("/api/users"),
    staleTime: 5 * 60_000,
    /* Hala nie dostaje listy kont (403) i to jest poprawne — wtedy po prostu
       nie ma kogo wzmiankować, a ekran nie ma prawa się o to wywrócić. */
    retry: false,
  });
}

/* ── Uchwyt rozmowy (0.159.0) ────────────────────────────────────────────────
   Samo wejście w pytanie przydziela je agentowi NA CZAS SIEDZENIA; odpowiedź
   przydziela na stałe. Uchwyt żyje w pamięci serwera i wygasa bez znaku
   życia, więc panel musi bić sercem i musi się wymeldować przy wyjściu.

   Odstęp jest TRZYKROTNIE krótszy od czasu życia uchwytu po stronie serwera:
   jedno zgubione żądanie nie ma prawa oddać rozmowy komuś innemu w połowie
   pisania odpowiedzi. */
const BICIE_MS = 15_000;

export function useUchwytRozmowy(id: number | null) {
  useEffect(() => {
    if (id === null) return;
    const melduj = (obecny: boolean) => api(`/api/conversations/${id}/presence`, {
      method: "POST", body: JSON.stringify({ obecny }),
      /* `keepalive` po to, żeby wymeldowanie doszło także wtedy, gdy karta
         znika. Bez niego przeglądarka przerywa żądanie w locie, a rozmowa
         zostaje zablokowana do końca czasu życia uchwytu. */
      keepalive: !obecny,
    }).catch(() => {});

    void melduj(true);
    const zegar = setInterval(() => void melduj(true), BICIE_MS);
    const naZamkniecie = () => void melduj(false);
    window.addEventListener("pagehide", naZamkniecie);

    return () => {
      clearInterval(zegar);
      window.removeEventListener("pagehide", naZamkniecie);
      void melduj(false);
    };
  }, [id]);
}

/**
 * Pokrycie sygnatur — ile ofert wiąże się z kartoteką Subiekta.
 *
 * Bez `refetchInterval`: to jest obraz KATALOGU, nie ruchu. Zmienia się, gdy
 * ktoś wypełni sygnaturę w Allegro albo doda kartotekę — czyli w rytmie
 * godzin, nie sekund. Odświeżenie przy powrocie do okna wystarczy.
 */
export function usePokrycieSygnatur() {
  return useQuery({
    queryKey: klucze.sygnatury,
    queryFn: () => api<PokrycieSygnatur>("/api/obsluga/sygnatury"),
    staleTime: 60_000,
  });
}
