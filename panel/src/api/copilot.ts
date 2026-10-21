import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { miniaturaJpeg, naBase64 } from "./plik";
import { klucze } from "./rozmowy";
import type {
  Kategoria, OcenaSzkicu, PomiarCopilota, PropozycjaPrzeplywu, StanCopilota, SzkicCopilota,
  WymianaCopilota, WynikPartii, ZdjeciePytania,
} from "./typy";

/* ── Copilot: rozpoznanie, o co pyta klient (§14, etap F) ────────────────────
   Osobny plik, nie dopisek do `rozmowy.ts`: tamten ma już ponad dwadzieścia
   haków, a Copilot będzie rósł o kolejne zadania etapu F. Klucze cache
   dokładamy do JEDNEJ mapy w `rozmowy.ts` — druga mapa rozjechałaby się
   z pierwszą przy pierwszym unieważnieniu.                                   */

export const kluczeCopilota = {
  stan: ["copilot"] as const,
  pomiar: ["copilot-pomiar"] as const,
  pytania: (rozmowaId: number) => ["copilot-pytania", rozmowaId] as const,
};

/**
 * Czy da się kliknąć i ile bierze jedno kliknięcie.
 *
 * `staleTime: Infinity`, bo to jest odczyt KONFIGURACJI — zmienia się przy
 * restarcie usługi, nie w trakcie zmiany agenta. Odpytywanie tego zegarem
 * byłoby ruchem po nic.
 */
export function useCopilot() {
  return useQuery({
    queryKey: kluczeCopilota.stan,
    queryFn: () => api<StanCopilota>("/api/obsluga/copilot"),
    staleTime: Infinity,
  });
}

/** Pomiar zza zębatki. Odpytywany dopiero, gdy ktoś otworzy ustawienia. */
export function usePomiarCopilota(wlaczone = true) {
  return useQuery({
    queryKey: kluczeCopilota.pomiar,
    queryFn: () => api<PomiarCopilota>("/api/obsluga/copilot/pomiar"),
    enabled: wlaczone,
  });
}

/**
 * Partia rozpoznania.
 *
 * Unieważnia LISTĘ, nie pojedyncze rozmowy: partia dotyka kilkunastu wierszy
 * naraz, a plakietki siedzą właśnie na liście. Unieważnienie leci także po
 * przerwaniu limitem — wcześniejsze wyniki zostały zapisane i zapłacone,
 * więc ekran ma je pokazać, a nie wyrzucić.
 */
export function useKlasyfikuj() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowyId: number[] }) =>
      api<WynikPartii>("/api/obsluga/copilot/klasyfikacja",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
      /* Otwarta rozmowa ma własny klucz i własną plakietkę w nagłówku. Bez
         tego agent widziałby świeżą etykietę na liście i pustkę obok tekstu,
         który właśnie czyta. */
      for (const id of v.rozmowyId) qc.invalidateQueries({ queryKey: klucze.rozmowa(id) });
    },
  });
}

/**
 * Etykieta człowieka: potwierdzenie albo poprawka kategorii. Unieważnia
 * rozmowę, listę I pomiar — etykieta jest pomiarem, a plakietka stoi w obu
 * miejscach ekranu.
 */
export function usePoprawKlasyfikacje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; kategoria: Kategoria }) =>
      api<{ kategoria: Kategoria; decyzjaId: number }>(
        `/api/obsluga/copilot/klasyfikacja/${v.rozmowaId}/korekta`,
        { method: "POST", body: JSON.stringify({ kategoria: v.kategoria }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}

/* ── Szkic odpowiedzi z faktów (§14.6, 0.231.0) ──────────────────────────────
   Jedna rozmowa na kliknięcie. Unieważnia ROZMOWĘ, bo propozycja jedzie
   w `osRozmowy` obok szkicu agenta — i pomiar, bo każde wywołanie kosztuje. */

export function useUlozSzkic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number }) =>
      api<{ szkic: SzkicCopilota }>("/api/obsluga/copilot/szkic",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}

/** Werdykt agenta o szkicu: wstawił, zastąpił, odrzucił. To jest miernik. */
export function useOcenSzkic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; ocena: OcenaSzkicu }) =>
      api<{ ocena: OcenaSzkicu }>(`/api/obsluga/copilot/szkic/${v.rozmowaId}/ocena`,
        { method: "POST", body: JSON.stringify({ ocena: v.ocena }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}

/* ── Dopytanie Copilota ──────────────────────────────────────────────────────
   Agent wydaje polecenie albo zadaje pytanie o tekst z pola odpowiedzi.
   Polecenie daje nową wersję szkicu, pytanie samą odpowiedź dla agenta.
   Nowa wersja wchodzi do pola po stronie ekranu, jako stan, nie zapis.

   Wymiany trzymamy pod WŁASNYM kluczem, nie w `rozmowa(id)`. Wymiana nie
   zmienia osi rozmowy ani zapisanego szkicu Copilota. Doklejenie jej do
   tamtego klucza kazałoby przy każdym pytaniu odświeżać całą oś, z migotaniem
   listy wiadomości pod ręką agenta. */

/**
 * Ile znaków może mieć pytanie.
 *
 * DRUGA KOPIA `LIMIT_PYTANIA` z serwera i to jest świadome, nie przeoczenie.
 * Ta gasi przycisk, zanim żądanie poleci; tamta odrzuca żądanie, zanim
 * poleci do dostawcy. Panel bez własnej liczby musiałby pytać serwer o to,
 * czy wolno zapytać.
 */
export const LIMIT_PYTANIA = 600;

/**
 * Zdjęcia agenta przy jednym pytaniu: ile, jak duże i jakie.
 *
 * DRUGA KOPIA granic serwera, z tego samego powodu co `LIMIT_PYTANIA`.
 * Ta mówi agentowi zdaniem, czemu plik nie wszedł, ZANIM poleci kilka
 * megabajtów. Tamta sprawdza typ po sygnaturze pliku, bo typ podany przez
 * przeglądarkę wynika z rozszerzenia. Rozjazd liczb kończy się odmową
 * serwera z jego zdaniem, a nie zdjęciem zgubionym po cichu.
 */
export const ZDJECIA_PYTANIA = {
  najwiecej: 3,
  /* Megabajt dziesiętny, jak w `SUFIT_ZDJEC` serwera. Binarny przepuściłby
     tu zdjęcie, którego serwer nie przyjmie. */
  bajtow: 7_000_000,
  /* Suma sprawdzana tu, bo „Zapytaj” czyści listę przed odpowiedzią serwera:
     jego odmowa sumy kazałaby wybierać wszystkie pliki od nowa. */
  lacznie: 20_000_000,
  typy: ["image/jpeg", "image/png", "image/webp", "image/gif"] as readonly string[],
};

/**
 * Pliki agenta w kształcie ciała pytania: oryginał base64 dla modelu
 * i miniatura JPEG do historii. Miniatura bywa `null`, bo pytanie bez
 * miniatury jest lepsze niż pytanie, które nie poszło.
 */
export async function zdjeciaPytania(pliki: File[]): Promise<ZdjeciePytania[]> {
  return Promise.all(pliki.map(async (plik) => ({
    nazwa: plik.name,
    dane: await naBase64(plik),
    miniatura: await miniaturaJpeg(plik),
  })));
}

export function useWymianyCopilota(rozmowaId: number) {
  return useQuery({
    queryKey: kluczeCopilota.pytania(rozmowaId),
    queryFn: () => api<WymianaCopilota[]>(`/api/obsluga/copilot/pytania/${rozmowaId}`),
    staleTime: 30_000,
    /* Bez rozmowy nie ma czego pobierać — inaczej ekran bez wybranej rozmowy
       strzelałby po `/pytania/0` przy każdym wejściu. */
    enabled: rozmowaId > 0,
  });
}

/**
 * Polecenie albo pytanie do Copilota, z tekstem pola odpowiedzi.
 *
 * `szkic` to pole w chwili kliknięcia, także puste. Model poprawia TEN tekst,
 * z ręcznymi zmianami agenta, a nie zapisany szkic Copilota. Inaczej
 * poprawka kasowałaby to, co agent dopisał przed zadaniem polecenia.
 */
export function useZadajPytanie() {
  const qc = useQueryClient();
  return useMutation({
    /* `zdjecia` tylko wtedy, gdy są. Pytanie bez nich ma to samo ciało co
       dotąd, więc starszy serwer przyjmie je bez zmian. */
    mutationFn: (v: { rozmowaId: number; pytanie: string; szkic: string; zdjecia?: ZdjeciePytania[] }) =>
      api<{ wymiana: WymianaCopilota }>("/api/obsluga/copilot/pytanie",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeCopilota.pytania(v.rozmowaId) });
      /* Pomiar TAK, oś rozmowy NIE. Każde wywołanie kosztuje i ma stanąć
         w rachunku. Zapisany szkic Copilota zostaje bez zmian, bo nowa
         wersja żyje w wymianie i w polu agenta. */
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}

/* ── Werdykt o propozycji przepływu ──────────────────────────────────────────
   Agent mówi „tak" albo „nie" temu, co automat BY zrobił. Zgoda wykonuje krok
   po stronie serwera: zleca weryfikację hali albo oznacza rozmowę jako pilną.
   Przy szkicu, który automat wysłał sam, werdykt jest tylko oceną po fakcie.
   Unieważniamy więc wszystko, co ten krok zmienia na ekranie: rozmowę, listę
   z priorytetem, zadania hali i pomiar zgodności. `onSettled`, a nie
   `onSuccess`, bo przy 409 („rozpoznanie się zmieniło") karta ma pokazać
   propozycje nowej decyzji, a nie zostać przy starych. */
export function useWerdyktPrzeplywu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; propozycjaId: number; werdykt: "zgoda" | "sprzeciw" }) =>
      api<{ propozycja: PropozycjaPrzeplywu }>(
        `/api/obsluga/rozmowy/${v.rozmowaId}/przeplyw/${v.propozycjaId}`,
        { method: "POST", body: JSON.stringify({ werdykt: v.werdykt }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.zadania });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}
