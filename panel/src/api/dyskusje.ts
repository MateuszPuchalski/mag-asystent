import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, pobierzPlik } from "./klient";
import type {
  Dyskusja, KolejkaDyskusji, SzczegolDyskusji,
  WynikOdpowiedziReklamacji, WynikZakonczenia,
} from "./typy";

/* Dyskusje jadą JEDNYM zapytaniem razem z licznikami — ten sam wybór co przy
   zwrotach i reklamacjach. Spraw w pracy są dziesiątki, nie tysiące, więc
   przełączenie kubełka nie kosztuje ani jednego strzału do serwera.

   SYNCHRONIZACJI TU NIE MA i to jest decyzja, nie brak. Dyskusje i reklamacje
   przyjeżdżają JEDNĄ listą `/sale/issues`, więc drugi przycisk „synchronizuj
   teraz" byłby drugim żądaniem o to samo i drugą drogą w limit 429. Ekran
   dyskusji pokazuje stan tej samej synchronizacji i odsyła po odświeżenie
   do reklamacji.

   ZAŁĄCZNIKI POBIERAJĄ SIĘ TRASĄ REKLAMACJI. Klucz jest tym samym wierszem
   tej samej tabeli, a bramka roli identyczna; własna trasa zdublowałaby też
   rozpoznawanie typu pliku po sygnaturze. */

export const kluczeDyskusji = {
  kolejka: ["dyskusje"] as const,
  dyskusja: (id: number) => ["dyskusja", id] as const,
};

export function useDyskusje() {
  return useQuery({
    queryKey: kluczeDyskusji.kolejka,
    queryFn: () => api<KolejkaDyskusji>("/api/obsluga/dyskusje"),
  });
}

export function useDyskusja(id: number | null) {
  return useQuery({
    queryKey: kluczeDyskusji.dyskusja(id ?? 0),
    queryFn: () => api<SzczegolDyskusji>(`/api/obsluga/dyskusje/${id}`),
    enabled: id !== null,
  });
}

/** Znacznik „prowadzę" — ponowne kliknięcie go zdejmuje. */
export function useProwadzeDyskusje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ dyskusja: Dyskusja }>(`/api/obsluga/dyskusje/${v.id}/prowadze`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.kolejka });
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.dyskusja(v.id) });
    },
  });
}

export function useNotatkaDyskusji() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; notatka: string | null; wersja: number }) =>
      api<{ dyskusja: Dyskusja }>(`/api/obsluga/dyskusje/${v.id}/notatka`,
        { method: "POST", body: JSON.stringify({ notatka: v.notatka, wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.kolejka });
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.dyskusja(v.id) });
    },
  });
}

/** Cofnięcie zmiany notatki — powód przy `useCofnijNotatke` w reklamacjach. */
export function useCofnijNotatkeDyskusji() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ dyskusja: Dyskusja }>(`/api/obsluga/dyskusje/${v.id}/notatka/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.kolejka });
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.dyskusja(v.id) });
    },
  });
}

/**
 * Odpowiedź w rozmowie.
 *
 * Konfliktu 409 hook CELOWO nie łapie: rozróżnia je ekran, bo każdy każe co
 * innego zrobić — dopisek otwiera dialog z jawną zgodą, zamknięta rozmowa
 * kończy temat, a rozjazd wersji każe odświeżyć. Ten sam podział co
 * w skrzynce i przy reklamacjach.
 *
 * `expectedLastMessageId` to identyfikator ostatniej NIE naszej wiadomości —
 * liczy go panel z osi, a serwer sprawdza po swojemu i rozstrzyga.
 */
export function useOdpowiedzWDyskusji() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number; tresc: string; expectedWersja: number;
      expectedLastMessageId: number | null; mimoNowejWiadomosci?: boolean;
    }) => api<WynikOdpowiedziReklamacji>(`/api/obsluga/dyskusje/${v.id}/odpowiedz`, {
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
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.dyskusja(v.id) });
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.kolejka });
    },
  });
}

/**
 * Prośba o zakończenie dyskusji (`END_REQUEST`).
 *
 * NIE JEST TO ZAMKNIĘCIE i hook nie udaje, że jest: w odpowiedzi wraca los
 * NASZEJ próby, a stan dyskusji przynosi dopiero synchronizacja. Dlatego po
 * `onSettled` dociągamy sprawę — `zakonczenie_*` stoi na wierszu, nie w wyniku.
 *
 * 409 nie łapiemy: „już poproszono" i „ktoś dopisał wiadomość" to dwa różne
 * zdania, a rozstrzyga je ekran.
 */
export function useZakoncz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number; tresc: string; wersja: number;
      expectedLastMessageId: number | null; mimoNowejWiadomosci?: boolean;
    }) => api<WynikZakonczenia>(`/api/obsluga/dyskusje/${v.id}/zakoncz`, {
      method: "POST",
      body: JSON.stringify({
        tresc: v.tresc, wersja: v.wersja,
        expectedLastMessageId: v.expectedLastMessageId,
        mimoNowejWiadomosci: Boolean(v.mimoNowejWiadomosci),
      }),
    }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.dyskusja(v.id) });
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.kolejka });
    },
  });
}

/**
 * Pobranie załącznika — trasą REKLAMACJI, świadomie.
 *
 * Idzie przez `pobierzPlik`, a nie przez `<a href>`: sesja jedzie nagłówkiem
 * `x-session`, którego odnośnik nie niesie.
 */
export const pobierzZalacznikDyskusji = (
  dyskusjaId: number, zalacznikId: number, nazwa: string,
) => pobierzPlik(`/api/obsluga/reklamacje/${dyskusjaId}/zalaczniki/${zalacznikId}`, nazwa);
