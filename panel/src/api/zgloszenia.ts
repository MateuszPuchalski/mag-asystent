import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── ZGŁOSZENIA PRACOWNIKÓW — kontrakt w `docs/zgloszenia-pracownikow.md` ──
   Pracownik zgłasza z każdego ekranu, co mu przeszkadza albo czego brakuje.
   Listę czyta wyłącznie `admin`, bo uwaga o koledze albo o szefie ma być
   bezpieczna. Autor widzi tylko własne zgłoszenia, z odpowiedzią właściciela.

   `method` STOI PIERWSZE w `init`, a adres w każdym wywołaniu w całości.
   Strażnik adresów panelu (`server/src/routes/panel-adresy.test.ts`) czyta
   metodę wyrażeniem urywanym na pierwszym `}` i pomija adresy składane. */

export type RodzajZgloszenia = "pomysl" | "przeszkadza" | "blad";
export type StatusZgloszenia = "nowe" | "przyjete" | "zrobione" | "odrzucone";
export type FiltrZgloszen = StatusZgloszenia | "wszystkie";

export interface Zgloszenie {
  id: number;
  rodzaj: RodzajZgloszenia;
  opis: string;
  /** Ścieżka ekranu panelu albo nazwa ekranu kolektora, zawsze bez zapytania. */
  ekran: string;
  zrodlo: "panel" | "kolektor";
  wersja: string | null;
  /** Nazwa kolektora; przy panelu `null`. */
  urzadzenie: string | null;
  at: string;
  autor: string;
  status: StatusZgloszenia;
  odpowiedz: string | null;
  statusAt: string | null;
  statusPrzez: string | null;
  /** Same identyfikatory; adres zdjęcia składa klient. */
  zdjecia: Array<{ id: number }>;
}

export interface NoweZgloszenie {
  rodzaj: RodzajZgloszenia;
  opis: string;
  ekran: string;
  zrodlo: "panel";
  wersja?: string;
  /** Base64 JPEG z prefiksem `data:`, najwyżej cztery. */
  zdjecia: string[];
}

export interface ListaZgloszen {
  zgloszenia: Zgloszenie[];
  liczniki: Record<StatusZgloszenia, number>;
}

/** Najwięcej zdjęć przy jednym zgłoszeniu — ten sam próg co na serwerze. */
export const NAJWIECEJ_ZDJEC = 4;

/** Prefiks wszystkich odczytów: moje, lista właściciela i licznik. */
export const KLUCZ_ZGLOSZEN = "zgloszenia";

/* Moje zgłoszenia czyta się przy otwarciu okna, nie w tle. Autor zagląda
   tam kilka razy w tygodniu, a odpytywanie z każdego ekranu kosztowałoby
   serwer żądanie co minutę od każdego biurka. */
export function useMojeZgloszenia() {
  return useQuery({
    queryKey: [KLUCZ_ZGLOSZEN, "moje"] as const,
    queryFn: () => api<{ zgloszenia: Zgloszenie[] }>("/api/zgloszenia/moje"),
  });
}

/** Lista właściciela. `wlaczone: false` dla każdej innej roli, bo serwer i tak odda 403. */
export function useZgloszenia(filtr: FiltrZgloszen, wlaczone: boolean) {
  return useQuery({
    queryKey: [KLUCZ_ZGLOSZEN, "lista", filtr] as const,
    queryFn: () => filtr === "wszystkie"
      ? api<ListaZgloszen>("/api/obsluga/zgloszenia")
      : api<ListaZgloszen>(`/api/obsluga/zgloszenia?status=${encodeURIComponent(filtr)}`),
    enabled: wlaczone,
    /* Poprzednia odpowiedź zostaje przy zmianie filtra, bo niesie liczniki.
       Bez niej pigułki gasłyby na chwilę przy każdym kliknięciu. */
    placeholderData: (poprzednie) => poprzednie,
  });
}

/* Licznik nowych przy pozycji menu „Więcej”. Ten sam klucz co lista
   z domyślnym filtrem, więc wejście na ekran nie pyta drugi raz. Pięć minut,
   bo zgłoszenie nie pali się jak pytanie klienta. */
export function useLicznikZgloszen(wlaczone: boolean) {
  return useQuery({
    queryKey: [KLUCZ_ZGLOSZEN, "lista", "nowe"] as const,
    queryFn: () => api<ListaZgloszen>("/api/obsluga/zgloszenia?status=nowe"),
    enabled: wlaczone,
    refetchInterval: 5 * 60_000,
    select: (d) => d.liczniki.nowe,
  });
}

/** Złożenie zgłoszenia. Po zapisie odświeżają się moje i lista właściciela. */
export function useWyslijZgloszenie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NoweZgloszenie) => api<{ zgloszenie: Zgloszenie }>("/api/zgloszenia",
      { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => qc.invalidateQueries({ queryKey: [KLUCZ_ZGLOSZEN] }),
  });
}

/**
 * Decyzja właściciela. Serwer czyta brak `odpowiedz` jako „zostaw, co było”,
 * a pusty napis jako „skasuj”. `undefined` nie jedzie więc wcale.
 */
export function useZmienStatusZgloszenia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, odpowiedz }: { id: number; status: StatusZgloszenia; odpowiedz?: string }) =>
      api<{ zgloszenie: Zgloszenie }>(`/api/obsluga/zgloszenia/${id}/status`, {
        method: "POST",
        body: JSON.stringify(odpowiedz === undefined ? { status } : { status, odpowiedz: odpowiedz.trim() }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: [KLUCZ_ZGLOSZEN] }),
  });
}

/** Napisy rodzajów — jedno miejsce dla okna, listy i testów. */
export const RODZAJE: Array<{ klucz: RodzajZgloszenia; etykieta: string }> = [
  { klucz: "pomysl", etykieta: "Pomysł" },
  { klucz: "przeszkadza", etykieta: "Przeszkadza mi" },
  { klucz: "blad", etykieta: "Nie działa" },
];

export const NAZWA_RODZAJU: Record<RodzajZgloszenia, string> =
  Object.fromEntries(RODZAJE.map((r) => [r.klucz, r.etykieta])) as Record<RodzajZgloszenia, string>;

export const NAZWA_STATUSU: Record<StatusZgloszenia, string> = {
  nowe: "Nowe", przyjete: "Przyjęte", zrobione: "Zrobione", odrzucone: "Odrzucone",
};

/* Barwy plakietek pożyczone ze stanów spraw (`KLASA_STATUSU`), bo znaczą to
   samo: nowe czeka, przyjęte jest w toku, zrobione zamknięte dobrze. */
export const PLAKIETKA_STATUSU: Record<StatusZgloszenia, string> = {
  nowe: "new", przyjete: "open", zrobione: "resolved", odrzucone: "closed",
};
