import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type {
  DaneDoboru, Dobor, DrogaDoboru, KandydaciDoboru, KartaTowaru, OsRozmowy, PokrycieSygnatur, PokrycieWiedzy,
  SkutecznoscDoboru,
  PowodNegatywny,
  DokumentySprzedazy, HistoriaKlienta, MiesiacEskalacji, MojaSprawa,
  Rozmowa, StanPrzesylki, StanSkrzynki, StatusDoboru, StatusRozmowy, WiedzaDoboru, WpisWzmianki,
  WpisAutomatu,
  WynikWysylki, Zadanie, Zastosowanie, Zdrowie,
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
  moje: ["mojeSprawy"] as const,
  sygnatury: ["sygnatury"] as const,
  pokrycieWiedzy: ["pokrycie-wiedzy"] as const,
  skutecznoscDoboru: (dni: number) => ["skutecznosc-doboru", dni] as const,
  eskalacja: ["eskalacja"] as const,
  wiedzaAutomat: ["wiedza-automat"] as const,
  towar: (twId: number) => ["towar", twId] as const,
  zalaczniki: (id: number) => ["zalaczniki", id] as const,
  kandydaci: (id: number) => ["kandydaci", id] as const,
  wiedzaDoboru: (id: number) => ["wiedzaDoboru", id] as const,
  historiaKlienta: (id: number) => ["historiaKlienta", id] as const,
  dokumentySprzedazy: (id: number) => ["dokumentySprzedazy", id] as const,
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

/**
 * Jedno „Moje" ponad kolejkami (S4 spoiwa, `docs/obsluga-klienta-calosc.md`).
 *
 * Tożsamość bierze SERWER z sesji — parametru tu nie ma i mieć nie będzie.
 * `?userId=` pozwalałby czytać listę pracy kolegi, czyli monitoring
 * pracowniczy pod inną nazwą.
 *
 * Ten sam rytm co przy wzmiankach: sprawa z terminem ma dojechać do agenta,
 * który akurat siedzi na innym ekranie.
 */
/** Miara eskalacji za zębatką (S5 spoiwa) — odczyt bez osi osobowej. */
export function useEskalacja() {
  return useQuery({
    queryKey: klucze.eskalacja,
    queryFn: () => api<{ miesiace: MiesiacEskalacji[] }>("/api/obsluga/eskalacja"),
  });
}

export function useMojeSprawy() {
  return useQuery({
    queryKey: klucze.moje,
    queryFn: () => api<{ sprawy: MojaSprawa[] }>("/api/obsluga/moje"),
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

export function useZadania() {
  return useQuery({
    queryKey: klucze.zadania,
    queryFn: () => api<{ zadania: Zadanie[] }>("/api/zadania-terenowe"),
  });
}

/* PRZEJĘCIA Z PANELU NIE MA OD 0.395.0. Hak `usePrzejmij` wołał
   `POST /api/conversations/:id/claim` dla jedynego przycisku „PRZEJMIJ
   ROZMOWĘ"; przycisk zszedł na zgłoszenie właściciela, bo wysyłka odpowiedzi
   przypisuje rozmowę niczyją sama od 0.159.0. Trasa na serwerze ZOSTAJE
   z własnymi testami — niesie też przejście `new` → `open` — ale panel jej
   już nie woła. Wracając do niej, przywróć hak, a nie wołaj `api()` z ekranu. */

/* Szkic jest współdzielony, więc zapis jest jawny i niesie wersję. Cicha
   autozapisywarka gubiłaby cudzą pracę przy dwóch agentach na jednej sprawie. */
/* ── Załączniki do odpowiedzi (0.195.0) ──────────────────────────────────────
   Plik idzie do Allegro OD RAZU przy dodaniu, nie przy wysyłce: odmowę typu
   albo rozmiaru agent ma zobaczyć, gdy jeszcze da się wybrać inny plik.
   Serwer trzyma potem sam numer deklaracji, bajtów u siebie nie zostawia.

   Lista jest osobnym zapytaniem, a nie polem `useRozmowa`: tamten odczyt
   odświeża się przy KAŻDYM zdarzeniu szyny, a załączniki zmieniają się
   wyłącznie wtedy, gdy ktoś je doda albo zdejmie.                          */
export interface ZalacznikSzkicu {
  id: number;
  allegroId: string;
  nazwa: string;
  typ: string;
  rozmiar: number;
  dodal: string | null;
}

export function useZalaczniki(id: number | null) {
  return useQuery({
    queryKey: klucze.zalaczniki(id ?? 0),
    queryFn: () => api<{ zalaczniki: ZalacznikSzkicu[] }>(`/api/conversations/${id}/zalaczniki`),
    enabled: id !== null,
  });
}

export function useDodajZalacznik() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; nazwa: string; typ: string; dane: string }) =>
      api<ZalacznikSzkicu>(`/api/conversations/${v.id}/zalaczniki`, {
        method: "POST",
        body: JSON.stringify({ nazwa: v.nazwa, typ: v.typ, dane: v.dane }),
      }),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: klucze.zalaczniki(v.id) }),
  });
}

export function useUsunZalacznik() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; zalacznikId: number }) =>
      api(`/api/conversations/${v.id}/zalaczniki/${v.zalacznikId}`, { method: "DELETE" }),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: klucze.zalaczniki(v.id) }),
  });
}

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

/**
 * Dwie odpowiedzi biura na zadanie odesłane przez halę (0.352.0).
 *
 * `ponow` i `anuluj` — trzeciej nie ma i to jest celowe. Zadanie odesłane
 * leży po stronie biura i musi z tej strony zejść, bo inaczej odesłanie
 * zamieniłoby jedną ślepą uliczkę (`w_toku` na zawsze) w drugą.
 *
 * Instrukcja jedzie z ponowieniem, bo najczęstszą reakcją na „nie da się"
 * jest przeformułowanie zlecenia. Osobne, nowe zadanie zerwałoby powiązanie
 * z rozmową, a razem z nim wynik przestałby wracać na jej oś.
 */
export function usePonowZadanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; instrukcja?: string }) =>
      api(`/api/zadania-terenowe/${v.id}/ponow`, {
        method: "POST", body: JSON.stringify({ instrukcja: v.instrukcja }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: klucze.zadania }),
  });
}

export function useAnulujZadanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api(`/api/zadania-terenowe/${v.id}/anuluj`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: klucze.zadania }),
  });
}

export function useNoweZadanie() {
  const qc = useQueryClient();
  return useMutation({
    /* Źródło domyślnie „panel" (ręczne z ekranu Zadań). Zlecenie ze sprawy
       podaje własne `zrodlo` i `zrodloRef` (0.502.0) — `sprawy/ZlecHali.tsx`. */
    mutationFn: (v: Record<string, unknown>) =>
      api<{ zadanie: Zadanie }>("/api/zadania-terenowe",
        { method: "POST", body: JSON.stringify({ zrodlo: "panel", ...v }) }),
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

/**
 * Znacznik „sprawa reklamacyjna" (0.390.0) — NASZ, nie Allegro.
 *
 * Sprawy posprzedażowej sprzedawca nie może założyć: `/sale/issues` ma
 * wyłącznie GET. Ta mutacja mówi wyłącznie, jak biuro prowadzi rozmowę.
 *
 * Unieważnia KOLEJKĘ i rozmowę, jak priorytet: plakietka stoi w obu miejscach,
 * a znacznik widoczny tylko w otwartej rozmowie nie zmieniałby wyboru pracy.
 */
export function useUstawReklamacyjna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; reklamacyjna: boolean }) =>
      api(`/api/obsluga/rozmowy/${v.id}/reklamacyjna`, {
        method: "POST", body: JSON.stringify({ reklamacyjna: v.reklamacyjna }),
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
 * Gdzie jest paczka zamówienia tej rozmowy (23 września 2026).
 *
 * Bliźniak `useSprawdzPrzesylke` z reklamacji: dwa żądania u Allegro, więc
 * na jawne kliknięcie. Unieważniamy samą rozmowę — stan paczki stoi w jej
 * bloku zamówienia, nie w kolejce.
 */
export function useSprawdzPrzesylkeRozmowy() {
  const qc = useQueryClient();
  return useMutation({
    /* Bez ciała — i dlatego bez `body`: pusty JSON to `FST_ERR_CTP_EMPTY_JSON_BODY`. */
    mutationFn: (v: { id: number }) =>
      api<StanPrzesylki>(`/api/conversations/${v.id}/przesylka`, { method: "POST" }),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) }),
  });
}

/**
 * Ręczne wskazanie ZAMÓWIENIA dla rozmowy (0.397.0).
 *
 * Bliźniak `useWskazOferte` i z tego samego powodu: numeru, którego Allegro
 * nie przysłało, panel nie zgaduje. Unieważniamy samą rozmowę — powiązanie
 * zmienia jej kolumnę kontekstu, a nie kolejkę.
 *
 * Błędu NIE łapiemy tutaj: serwer odbija numer spoza zakupów tego kupującego,
 * a to zdanie ma stanąć przy liście, nie w pasku na górze ekranu.
 */
export function useWskazZamowienie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; externalId: string }) =>
      api(`/api/conversations/${v.id}/zamowienie`, {
        method: "POST", body: JSON.stringify({ externalId: v.externalId }),
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
/**
 * Zakończ / Otwórz ponownie (23 września 2026). Jeden werdykt zamiast menu
 * statusów. Zakończenie przy pytaniu bez odpowiedzi serwer odbija 409
 * (`pytanieBezOdpowiedzi`), dopóki nie przyjdzie `mimoPytania`.
 */
export function useZakoncz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; mimoPytania?: boolean }) =>
      api(`/api/conversations/${v.id}/zakoncz`, {
        method: "POST", body: JSON.stringify({ mimoPytania: Boolean(v.mimoPytania) }),
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
    },
  });
}

/**
 * Odłóż do terminu (@wydanie) — powód przy `odlozRozmowe` na serwerze.
 * `doKiedy: null` zdejmuje odłożenie („Cofnij", „Wróć teraz"). Pole idzie
 * zawsze, także jako `null`: serwer odbija ciało bez niego, żeby literówka
 * nie budziła rozmowy po cichu.
 */
export function useOdloz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; doKiedy: string | null }) =>
      api<{ status: StatusRozmowy; snoozedUntil: string | null }>(`/api/conversations/${v.id}/odloz`, {
        method: "POST", body: JSON.stringify({ doKiedy: v.doKiedy }),
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
    },
  });
}

/**
 * Następna rozmowa czeka w pamięci, zanim agent do niej przejdzie (@wydanie).
 *
 * Po wysyłce ekran sam przechodzi dalej (0.443.0), ale do tej pory dopiero
 * wtedy pytał serwer o treść — środek kolumny mówił przez tę chwilę „Wybierz
 * rozmowę z listy", a prawa kolumna znikała. Czekanie na każdą rozmowę to
 * czekanie pomnożone przez całą kolejkę.
 *
 * To jest ODCZYT (GET), więc reguła „zero zapisu przy patrzeniu" stoi.
 * `staleTime` jak domyślny w kliencie zapytań: świeższej treści szuka i tak
 * szyna zdarzeń, a wczytana za wcześnie rozmowa odświeży się przy wejściu.
 */
export function usePrzygotujRozmowe() {
  const qc = useQueryClient();
  return (id: number) => void qc.prefetchQuery({
    queryKey: klucze.rozmowa(id),
    queryFn: () => api<OsRozmowy>(`/api/obsluga/rozmowy/${id}`),
    staleTime: 10_000,
  });
}

export function useOtworz() {
  const qc = useQueryClient();
  return useMutation({
    /* Bez ciała — i dlatego bez `body`: pusty JSON to `FST_ERR_CTP_EMPTY_JSON_BODY`.
       Ciało idzie WYŁĄCZNIE z paska „Cofnij" (0.500.0): serwer liczy to
       otwarcie jako cofnięte zakończenie w pomiarze tarcia. */
    mutationFn: (v: { id: number; zCofniecia?: boolean }) => api(`/api/conversations/${v.id}/otworz`, {
      method: "POST", ...(v.zCofniecia ? { body: JSON.stringify({ zCofniecia: true }) } : {}),
    }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
    },
  });
}

export function useWyslij() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number; body: string; expectedVersion: number;
      expectedLastMessageId: number | null;
      mimoNowejWiadomosci?: boolean; mimoObecnosci?: boolean;
      /** „Wyślij i zakończ" (23 września 2026) — werdykt w tej samej transakcji co wiadomość. */
      zakoncz?: boolean;
      /** Ms od otwarcia rozmowy do kliknięcia „Wyślij" — pomiar tarcia (0.500.0). */
      msOdOtwarcia?: number;
    }) => api<WynikWysylki>(`/api/conversations/${v.id}/send`, {
      method: "POST",
      body: JSON.stringify({
        body: v.body, expectedVersion: v.expectedVersion,
        expectedLastMessageId: v.expectedLastMessageId,
        mimoNowejWiadomosci: Boolean(v.mimoNowejWiadomosci),
        mimoObecnosci: Boolean(v.mimoObecnosci),
        zakoncz: Boolean(v.zakoncz),
        msOdOtwarcia: v.msOdOtwarcia,
      }),
    }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      /* Serwer KONSUMUJE załączniki przy udanej wysyłce (znikają razem ze
         szkicem), więc lista na ekranie jest po niej nieaktualna. */
      qc.invalidateQueries({ queryKey: klucze.zalaczniki(v.id) });
    },
  });
}

/**
 * Cofnięta wysyłka (0.500.0) — sam wpis do pomiaru tarcia. Czekanie
 * dziesięciu sekund mieszka w przeglądarce, więc bez tego serwer nie wie,
 * że agent zawrócił odpowiedź. Porażka wpisu nie ma prawa zatrzymać
 * cofnięcia — agent już zdecydował, a pomiar to nie jego sprawa.
 */
export function zglosCofnietaWysylke(id: number, msOdKolejki?: number): void {
  /* Bez czasu — bez ciała, bo pusty JSON to `FST_ERR_CTP_EMPTY_JSON_BODY`.
     Z czasem (0.532.0) — ms od odłożenia wysyłki do „Cofnij", do pytania
     właściciela, czy dziesięć sekund to za długo. Serwer przycina liczbę. */
  /* `method` jako pierwsze pole literału, nie w gałęzi warunku: strażnik
     tras w `routes/skrzynka.test.ts` czyta metodę ze źródła tego pliku. */
  void api(`/api/conversations/${id}/wysylka-cofnieta`, { method: "POST",
    ...(msOdKolejki === undefined ? {} : { body: JSON.stringify({ msOdKolejki }) }) }).catch(() => {});
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

/* ── „Pisze" (§6.3, makieta `Main.dc.html`) ──────────────────────────────────

   Serwer obsługuje ten sygnał od 0.159.0 i nikt go dotąd nie wysyłał: trasa
   `presence` przyjmowała `typing`, a panel meldował wyłącznie obecność. Znak
   „pisze" nie mógł się więc pojawić na żadnym ekranie, bo nie powstawał.

   RYTM JEST INNY NIŻ BICIE SERCA UCHWYTU. Serwer gasi „pisze" po 12 s
   (`TYPING_TTL_MS`), więc odświeżamy co 5 s. Po 3 s ciszy mówimy WPROST, że
   agent przestał — bez tego znak wisiałby do wygaśnięcia i przez kilka sekund
   kłamałby o człowieku, który już nie pisze.

   Zgłoszenie idzie z klawisza, ale NIE z każdego: między odświeżeniami wpada
   do dławika. Żądanie na znak zrobiłoby z pisania odpowiedzi pętlę HTTP. */
const PISZE_ODSTEP_MS = 5_000;
const PISZE_CISZA_MS = 3_000;

export function usePisze(id: number | null) {
  const ostatnie = useRef(0);
  const cisza = useRef<ReturnType<typeof setTimeout> | null>(null);
  const biezaca = useRef<number | null>(id);
  biezaca.current = id;

  const melduj = (rozmowaId: number, typing: boolean) =>
    api(`/api/conversations/${rozmowaId}/presence`, {
      method: "POST", body: JSON.stringify({ typing }),
    }).catch(() => {});

  /* Zmiana rozmowy gasi znak w TAMTEJ rozmowie. Bez tego agent zostawiałby za
     sobą „pisze" wiszące do wygaśnięcia w każdym pytaniu, przez które przeszedł. */
  useEffect(() => () => {
    if (cisza.current) clearTimeout(cisza.current);
    if (ostatnie.current && biezaca.current !== null) void melduj(biezaca.current, false);
    ostatnie.current = 0;
  }, [id]);

  return () => {
    if (id === null) return;
    const teraz = Date.now();
    if (teraz - ostatnie.current > PISZE_ODSTEP_MS) {
      ostatnie.current = teraz;
      void melduj(id, true);
    }
    if (cisza.current) clearTimeout(cisza.current);
    cisza.current = setTimeout(() => {
      ostatnie.current = 0;
      void melduj(id, false);
    }, PISZE_CISZA_MS);
  };
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

/**
 * Co automat dopisał do wiedzy (0.331.0) — lista do prostowania.
 *
 * Bez `refetchInterval`: takt chodzi co pół godziny, a karta jest miejscem,
 * do którego się ZAGLĄDA, nie licznikiem do patrzenia. `staleTime` krótszy
 * niż przy pokryciu, bo tu liczy się świeżość: im wcześniej ktoś zobaczy zły
 * wpis, tym mniej doborów zdąży on nakarmić.
 */
export function useWiedzaAutomat() {
  return useQuery({
    queryKey: klucze.wiedzaAutomat,
    queryFn: () => api<WpisAutomatu[]>("/api/obsluga/wiedza-automat"),
    staleTime: 30_000,
  });
}

/** Pokrycie wiedzy z opisów (E3) — ten sam rytm, co sygnatury: zmienia się po imporcie. */
export function usePokrycieWiedzy() {
  return useQuery({
    queryKey: klucze.pokrycieWiedzy,
    queryFn: () => api<PokrycieWiedzy>("/api/obsluga/pokrycie-wiedzy"),
    staleTime: 60_000,
  });
}

/**
 * Skuteczność doboru (0.267.0) — obraz PRACY, nie katalogu, ale i tak bez
 * `refetchInterval`: to jest tabela czytana raz na tydzień, a nie licznik,
 * który ma drgać pod okiem. Okno w kluczu cache, bo przełączenie selektora
 * ma pobrać inne dane, a nie podmienić te same.
 */
export function useSkutecznoscDoboru(dni: number) {
  return useQuery({
    queryKey: klucze.skutecznoscDoboru(dni),
    queryFn: () => api<SkutecznoscDoboru>(`/api/obsluga/skutecznosc-doboru?dni=${dni}`),
    staleTime: 60_000,
  });
}

/* ── Dobór części (§11, etap E1) ─────────────────────────────────────────────
   Sam dobór jedzie w `useRozmowa` (jeden wiersz). KANDYDACI mają własne
   zapytanie: to wyszukiwarka i parser opisu, a rozmowa odświeża się na każde
   zdarzenie szyny, także `presence`. Każda mutacja unieważnia rozmowę, listę
   (plakietka statusu w kolejce) i kandydatów (dane wejściowe zmieniają, co
   automat ma sprawdzać). */
export function useKandydaci(id: number | null) {
  return useQuery({
    queryKey: klucze.kandydaci(id ?? 0),
    queryFn: () => api<KandydaciDoboru>(`/api/obsluga/rozmowy/${id}/dobor/kandydaci`),
    enabled: id !== null,
  });
}

function poDoborze(qc: ReturnType<typeof useQueryClient>, id: number) {
  qc.invalidateQueries({ queryKey: klucze.rozmowa(id) });
  qc.invalidateQueries({ queryKey: klucze.rozmowy });
  qc.invalidateQueries({ queryKey: klucze.kandydaci(id) });
}

/**
 * Dane wejściowe niosą WERSJĘ doboru. Konflikt (409) NIE jest tu łapany:
 * `Konflikt` leci do zakładki, bo to ona ma powiedzieć „ktoś zmienił dane —
 * odśwież" i ZOSTAWIĆ wpisane wartości, zamiast zamienić je w komunikat.
 */
export function useZapiszDaneDoboru() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; dane: Partial<DaneDoboru>; expectedVersion: number }) =>
      api<Dobor>(`/api/obsluga/rozmowy/${v.id}/dobor/dane`, {
        method: "PUT", body: JSON.stringify({ dane: v.dane, expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => poDoborze(qc, v.id),
  });
}

export function useStatusDoboru() {
  const qc = useQueryClient();
  return useMutation({
    /* `silnikModelId` jedzie tą samą trasą co status: to jedno pole przy JEDNEJ
       czynności („zatwierdź dobór"), a wskazuje, czy wiedza ma urosnąć przy
       maszynie, czy przy jej silniku. */
    mutationFn: (v: { id: number; status: StatusDoboru; brakuje?: string | null; silnikModelId?: number | null }) =>
      api<Dobor>(`/api/obsluga/rozmowy/${v.id}/dobor/status`, {
        method: "POST", body: JSON.stringify({
          status: v.status, brakuje: v.brakuje ?? null, silnikModelId: v.silnikModelId ?? null,
        }),
      }),
    onSettled: (_d, _e, v) => poDoborze(qc, v.id),
  });
}

/** Wybór kandydata; `twId: null` zdejmuje. Symbol bierze SERWER z bazy. */
export function useWybierzKandydata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; twId: number | null; droga: DrogaDoboru; expectedVersion: number }) =>
      api<Dobor>(`/api/obsluga/rozmowy/${v.id}/dobor/wybor`, {
        method: "POST",
        body: JSON.stringify({ twId: v.twId, droga: v.droga, expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => poDoborze(qc, v.id),
  });
}

/* ── Wiedza przy doborze (E2) ────────────────────────────────────────────────
   Dowody wybranej kartoteki i pomiary z tej rozmowy — osobno od rozmowy
   z tego samego powodu co kandydaci. Wynik pomiaru idzie do bazy wiedzy
   WYŁĄCZNIE na kliknięcie (§13.4). */
export function useWiedzaDoboru(id: number | null) {
  return useQuery({
    queryKey: klucze.wiedzaDoboru(id ?? 0),
    queryFn: () => api<WiedzaDoboru>(`/api/obsluga/rozmowy/${id}/dobor/wiedza`),
    enabled: id !== null,
  });
}

/* ── Historia klienta (§10.1, zakładka KLIENT) ───────────────────────────────
   Osobne zapytanie, nie pole rozmowy: dwa złączenia po loginie i przegląd
   doborów kosztują, a oś rozmowy przeładowuje się przy każdym zdarzeniu
   szyny. Zakładkę otwiera się rzadziej niż rozmowę, więc płaci za siebie
   dopiero wtedy, gdy ktoś na nią patrzy. */
export function useHistoriaKlienta(id: number | null) {
  return useQuery({
    queryKey: klucze.historiaKlienta(id ?? 0),
    queryFn: () => api<HistoriaKlienta>(`/api/obsluga/rozmowy/${id}/klient`),
    enabled: id !== null,
  });
}

/**
 * Faktura i paragon zamówienia rozmowy (0.499.0) — tylko dokumenty z jego
 * numerem. `wlaczone`, bo woła to wyłącznie soczewka „Faktura": pytanie
 * o dokumenty przy każdej rozmowie byłoby pracą, której nikt nie ogląda.
 */
export function useDokumentySprzedazy(id: number | null, wlaczone: boolean) {
  return useQuery({
    queryKey: klucze.dokumentySprzedazy(id ?? 0),
    queryFn: () => api<DokumentySprzedazy>(`/api/obsluga/rozmowy/${id}/dokumenty-sprzedazy`),
    enabled: id !== null && wlaczone,
  });
}

export function usePomiarDoWiedzy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; zadanieId: number; twId?: number | null; polaryzacja: "pasuje" | "nie_pasuje"; powodNegatywny?: PowodNegatywny | null }) =>
      api<Zastosowanie>(`/api/obsluga/rozmowy/${v.id}/dobor/pomiar-do-wiedzy`, {
        method: "POST",
        body: JSON.stringify({ zadanieId: v.zadanieId, twId: v.twId ?? null, polaryzacja: v.polaryzacja,
          powodNegatywny: v.powodNegatywny ?? null }),
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
      qc.invalidateQueries({ queryKey: klucze.kandydaci(v.id) });
      qc.invalidateQueries({ queryKey: klucze.wiedzaDoboru(v.id) });
      qc.invalidateQueries({ queryKey: ["wiedza"] });
    },
  });
}
