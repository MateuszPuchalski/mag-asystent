import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { klucze } from "./rozmowy";
import type { DosylkaSprawy, HistoriaKlienta, MaszynaKlienta, SprawaKlienta, WpisHistorii } from "./typy";

export type { DosylkaSprawy, NoweZdarzenie, SprawaKlienta } from "./typy";

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
  /**
   * DLACZEGO podpowiedź stoi (@wydanie). Doręczona dosyłka to drugi powód
   * obok terminu kroku, a każdy mówi agentowi co innego. Wartość logiczna
   * wyżej zostaje, bo starsza karta czyta tylko ją.
   */
  podpowiedzPowod: "termin" | "dosylka" | null;
  /**
   * Odmowa wypłaty z kodem dosyłki, której nikt nie śledzi (@wydanie). To
   * droga ZAPASOWA: zwykle śledzenie zakłada sama odmowa na ekranie zwrotu.
   * Tu trafia odmowa, przy której zapis u nas się nie udał, i kod złożony
   * poza panelem, który przyszedł synchronizacją.
   */
  propozycjaDosylki: {
    zwrotId: number; zamowienie: string; kod: "NEW_ITEM_SENT" | "MISSING_PART_SENT";
    odmowaAt: string | null;
  } | null;
  /** Identyfikatory przewoźników znane z naszej bazy — lista w formularzu numeru dosyłki. */
  przewoznicy: string[];
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
 *
 * EKSPORT dla ekranu zwrotów (@wydanie). Odmowa wypłaty z kodem dosyłki
 * zmienia sprawę klienta, a szuflada historii przy tym samym zwrocie rysuje
 * jej linijkę. Bez odświeżenia stał tam stary krok zamiast „dosłać”.
 */
export function poZapisieSprawy(qc: QueryClient, login: string) {
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

/* ── Dosyłka sprawy klienta (@wydanie) — trasy z `routes/spoiwo.ts` ──────────
   Dwa zapisy z profilu, oba na kliknięcie i oba Z CIAŁEM, z wersją i odciskiem
   sprawy narysowanej na ekranie — ta sama kontrola świeżości co przy kroku.
   Reguły `method` na pierwszym miejscu i pełnego adresu obowiązują tu z tego
   samego powodu co wyżej: strażnik adresów panelu czyta je wyrażeniem. */

/**
 * „Śledź dosyłkę” z propozycji na profilu — droga zapasowa za odmową wypłaty.
 * `wersja: 0` znaczy „sprawy jeszcze nie ma”, dokładnie jak przy kroku:
 * trasa zakłada wtedy sprawę z krokiem „dosłać”.
 */
export function useSledzDosylke(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { zwrotId: number; wersja: number; odcisk: string }) =>
      api<OdpowiedzSprawy>(`/api/obsluga/klient/${encodeURIComponent(login)}/sprawa/dosylka`,
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poZapisieSprawy(qc, login),
  });
}

/**
 * Numer dosyłki wpisany ręcznie z Sellasist. Automat szuka go w przesyłkach
 * zamówienia, ale nowej etykiety Allegro bywa nie zna — wtedy wpisuje go
 * człowiek. Ten sam zapis poprawia numer przekręcony przy przepisywaniu.
 */
export function useNumerDosylki(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { zamowienie: string; waybill: string; przewoznik: string; wersja: number; odcisk: string }) =>
      api<OdpowiedzSprawy>(`/api/obsluga/klient/${encodeURIComponent(login)}/sprawa/dosylka/numer`,
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poZapisieSprawy(qc, login),
  });
}

/**
 * Dosyłka, o której mówi JEDNA linijka sprawy przy historii kolejek.
 *
 * Kolejność jest kolejnością serwera przy `MojaSprawa.dosylka`, żeby „Moje”
 * i historia mówiły o tej samej paczce: kłopot u przewoźnika, potem brak
 * numeru, potem paczka w drodze, na końcu doręczona. Pierwsze dwa każą coś
 * zrobić, trzecie każe czekać, czwarte mówi, że czekanie się skończyło. Przy
 * remisie wygrywa najnowsza, bo tak serwer układa listę. Linijka pokazuje
 * jedno zdanie, więc pokazuje najpilniejsze, nie najświeższe.
 */
export function najwazniejszaDosylka(dosylki: readonly DosylkaSprawy[] | undefined): DosylkaSprawy | null {
  const lista = dosylki ?? [];
  return lista.find((d) => d.ton === "zle")
    ?? lista.find((d) => d.waybill === null)
    ?? lista.find((d) => d.dostarczonoAt === null)
    ?? lista[0]
    ?? null;
}
