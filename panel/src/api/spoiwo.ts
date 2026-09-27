import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { klucze } from "./rozmowy";
import type { HistoriaKlienta, MaszynaKlienta, SprawaKlienta, WpisHistorii } from "./typy";

export type { NoweZdarzenie, SprawaKlienta } from "./typy";

/* ── Ponad kolejkami (23 września 2026) ─────────────────────────────────────
   Kształty z `server/src/services/szukaj-wszedzie.ts` i `klient-historia.ts`.
   Oba odczyty są GET — ani szukanie, ani otwarcie historii niczego nie
   zapisuje. */

export type RodzajTrafienia =
  | "klient" | "rozmowa" | "zwrot" | "reklamacja" | "dyskusja" | "dostawa" | "towar" | "zamowienie";

export interface Trafienie {
  rodzaj: RodzajTrafienia;
  id: string;
  tytul: string;
  dlaczego: string;
  cel: string | null;
  link: string | null;
}

/** Fraza krótsza niż trzy znaki nie odpytuje serwera — i tak by nic nie oddał. */
export function useSzukajWszedzie(fraza: string) {
  return useQuery({
    queryKey: ["szukaj", fraza],
    queryFn: () => api<{ trafienia: Trafienie[] }>(`/api/obsluga/szukaj?q=${encodeURIComponent(fraza)}`),
    enabled: fraza.trim().length >= 3,
    placeholderData: (poprzednie) => poprzednie,
    staleTime: 30_000,
  });
}

/* Człon klucza w stałej, bo unieważnia go też zapis sprawy klienta niżej —
   literał w dwóch miejscach rozjechałby się o jedną literę bez objawu. */
const HISTORIA_SPRAWY = "historia-sprawy";

/**
 * Historia kupującego ze zwrotu albo ze sprawy. Pobiera się dopiero po
 * otwarciu szuflady (`wlaczona`) — sama sprawa na ekranie jej nie potrzebuje.
 */
export function useHistoriaSprawy(rodzaj: "zwrot" | "sprawa", id: number, wlaczona: boolean) {
  return useQuery({
    queryKey: [HISTORIA_SPRAWY, rodzaj, id],
    queryFn: () => api<HistoriaKlienta>(rodzaj === "zwrot"
      ? `/api/obsluga/zwroty/${id}/klient` : `/api/obsluga/sprawy/${id}/klient`),
    enabled: wlaczona,
  });
}

/* ── Profil klienta (24 września 2026) — kształt z `services/profil-klienta.ts` */

export type RodzajSprawyKlienta = "rozmowa" | "zwrot" | "reklamacja" | "dyskusja";

export interface ProfilKlienta {
  login: string;
  liczby: {
    zamowien: number; wydanoGrosze: number; waluta: string | null;
    zwrotow: number; reklamacji: number; dyskusji: number; rozmow: number;
    pierwszyZakup: string | null; ostatniZakup: string | null;
  };
  sygnaly: Array<{ ton: "zle" | "uwaga"; tekst: string; cel: string | null }>;
  otwarte: Array<{ rodzaj: RodzajSprawyKlienta; id: number; opis: string; od: string; stan: string; cel: string }>;
  zamowienia: Array<{
    id: string; kupionoAt: string | null; status: string | null; sumaGrosze: number | null;
    waluta: string | null; pozycje: Array<{ nazwa: string; ilosc: number; cenaGrosze: number }>;
    przesylka: string | null; link: string | null;
  }>;
  maszyny: MaszynaKlienta[];
  os: WpisHistorii[];
  notatka: { tresc: string; at: string; przez: string; cofalna: boolean } | null;
  /** Sprawa klienta (S6, 0.535.0); `null`, dopóki nikt nie ustawił kroku. */
  sprawa: SprawaKlienta | null;
  /** Nic nie czeka w kolejkach, a dzień kroku nadszedł — liczy serwer. */
  podpowiedzZakonczenia: boolean;
}

const kluczProfilu = (login: string) => ["profil-klienta", login.toLowerCase()] as const;

export function useProfilKlienta(login: string) {
  return useQuery({
    queryKey: kluczProfilu(login),
    queryFn: () => api<ProfilKlienta>(`/api/obsluga/klient/${encodeURIComponent(login)}`),
    retry: false,
  });
}

/** Zapis notatki; `tresc: null` zdejmuje. Po zapisie profil czyta się od nowa. */
export function useNotatkaKlienta(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tresc: string | null) => api(`/api/obsluga/klient/${encodeURIComponent(login)}/notatka`,
      { method: "POST", body: JSON.stringify({ tresc }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczProfilu(login) }),
  });
}

/* Cofnięcie idzie BEZ ciała — reguła klienta HTTP (`CLAUDE.md`): pusty JSON
   to „Bad Request" od Fastify. */
export function useCofnijNotatkeKlienta(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/obsluga/klient/${encodeURIComponent(login)}/notatka/cofnij`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczProfilu(login) }),
  });
}

/* ── Sprawa klienta (S6, 0.535.0) — trasy z `routes/spoiwo.ts` ─────────────
   Cztery zapisy, każdy na kliknięcie i każdy Z CIAŁEM: wszystkie niosą
   `wersja`, więc reguła klienta HTTP (pusty JSON to 400) nie ma tu okazji.

   `method` STOI PIERWSZE w obiekcie `init`. Strażnik adresów panelu
   (`server/src/routes/panel-adresy.test.ts`) czyta metodę wyrażeniem, które
   urywa się na pierwszym `}`. `JSON.stringify({…})` postawione przed nią
   zamieniłoby mu POST w GET, a on szukałby trasy, której nie ma. Z tego
   samego powodu adres stoi w każdym wywołaniu W CAŁOŚCI: składany z pomocnika
   nie zaczynałby się od `/api/` i strażnik pominąłby go bez słowa.

   Konflikt (409) przychodzi jako `Konflikt` ze świeżą sprawą w `szczegoly`.
   Ekran pokazuje jego zdanie, a świeżą sprawę i tak przynosi odświeżenie
   profilu — dopiero wtedy agent widzi to, co klient dopisał, i decyduje. */

export type OdpowiedzSprawy = { sprawa: SprawaKlienta };

/**
 * Po każdym zapisie sprawy — udanym czy nie — trzy odczyty czytają się od nowa.
 * Profil, bo tam stoi karta. „Moje", bo sprawa w toku i obudzona stoi na
 * liście prowadzącego. Historie przy źródłach, bo niosą linijkę sprawy.
 * Historie idą PREFIKSEM: która rozmowa czy zwrot są otwarte obok, tego stąd
 * nie widać, a nieaktywne zapytanie tylko się unieważnia, bez sieci.
 *
 * OBIETNICA WRACA do `onSettled`, więc mutacja czeka na świeży profil.
 * Bez tego `isPending` gasło przed odświeżeniem, a karta rysowała starą
 * sprawę z czynnymi przyciskami. Drugie kliknięcie szło ze starą wersją
 * i dostawało 409 po udanym przejęciu — jak przy notatce wyżej, która czeka.
 */
function poZapisieSprawy(qc: QueryClient, login: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: kluczProfilu(login) }),
    qc.invalidateQueries({ queryKey: klucze.moje }),
    qc.invalidateQueries({ queryKey: klucze.historiaKlienta(0).slice(0, 1) }),
    qc.invalidateQueries({ queryKey: [HISTORIA_SPRAWY] }),
  ]);
}

/**
 * Ustawienie kroku — JEDYNA droga do założenia i wznowienia sprawy.
 * `wersja: 0` znaczy „wiersza jeszcze nie ma"; `odcisk` to fakty, które ekran
 * narysował, więc serwer odmówi, gdy klient dopisał coś po otwarciu.
 */
export function useKrokSprawy(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { krok: string; krokDo: string; wersja: number; odcisk: string }) =>
      api<OdpowiedzSprawy>(`/api/obsluga/klient/${encodeURIComponent(login)}/sprawa/krok`,
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poZapisieSprawy(qc, login),
  });
}

/** Zakończenie sprawy — werdykt człowieka, z tą samą kontrolą świeżości co krok. */
export function useZakonczSprawe(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { wersja: number; odcisk: string }) =>
      api<OdpowiedzSprawy>(`/api/obsluga/klient/${encodeURIComponent(login)}/sprawa/zakoncz`,
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poZapisieSprawy(qc, login),
  });
}

/**
 * „Cofnij" z paska po zakończeniu — i nic więcej; ponowne otwarcie to nowy krok.
 * Wersja i odcisk przychodzą z ODPOWIEDZI zakończenia: wiadomość klienta
 * z tych ośmiu sekund daje 409, zamiast zgasnąć razem z cofnięciem.
 */
export function useWznowSprawe(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { wersja: number; odcisk: string }) =>
      api<OdpowiedzSprawy>(`/api/obsluga/klient/${encodeURIComponent(login)}/sprawa/wznow`,
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poZapisieSprawy(qc, login),
  });
}

/**
 * Przejęcie sprawy prowadzonej przez kogoś innego. `wersja` robi z niego
 * decyzję jawną: kto przejmuje, przejmuje sprawę w tym stanie, który widział.
 * `odcisk` pilnuje tego samego po stronie klienta — przejęcie potwierdza
 * „nowe", więc tylko to, co ekran narysował.
 */
export function usePrzejmijSprawe(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { wersja: number; odcisk: string }) =>
      api<OdpowiedzSprawy>(`/api/obsluga/klient/${encodeURIComponent(login)}/sprawa/przejmij`,
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poZapisieSprawy(qc, login),
  });
}
