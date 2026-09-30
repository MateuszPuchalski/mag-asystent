import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { dataLokalna } from "../czas.js";
import { mediana } from "./raporty.js";
import { czasOdpowiedzi } from "./czas-odpowiedzi.js";

/* ── Trzy wskaźniki, po których ocenia się zmianę ────────────────────────────
   WERTIS istnieje, żeby towar szybciej trafiał na półkę, żeby dało się go
   znaleźć i żeby klient szybciej dostawał odpowiedź. Każda z tych trzech
   liczb odpowiada na jedno z tych pytań. Liczba bez porównania nie mówi, czy
   jest lepiej, więc obok każdej stoi ten sam okres bezpośrednio wcześniej.

   DOSTAWA: od daty faktury do rozłożenia, w dniach kalendarza. Chwili
   przyjazdu towaru system nie zna. Data faktury jest najbliższym faktem,
   który zna, i zawyża wynik o czas transportu. Obok stoi sam czas pracy,
   od otwarcia dostawy na kolektorze do jej zamknięcia.

   SZUKANIE: odsetek wyszukiwań z kolektora, które skończyły się wynikiem
   z adresem półki. Oba fronty szukają w trakcie pisania, więc jedno
   szukanie to kilka zdarzeń. Liczy się ostatnie zapytanie serii z jednego
   urządzenia, reguła w `sesjeSzukania`. Szukania z panelu nie wchodzą, bo
   biuro szuka towaru do rozmowy, nie na półce, a panel nie wysyła urządzenia.

   ODPOWIEDŹ: mediana czekania klienta Allegro na naszą odpowiedź. Regułę
   próbki trzyma `czasOdpowiedzi`, a tu jej nie powtarzamy, bo druga kopia
   rozjechałaby się z zakresem „Obsługa klienta".

   Odczyt niczego nie zapisuje. Brak próbki to `null`, nie zero. */

/** Przerwa, po której następne zapytanie z urządzenia jest nowym szukaniem. */
export const PRZERWA_SZUKANIA_MS = 15_000;

export type WynikSzukania = "adres" | "bez_adresu" | "brak";

export interface ZdarzenieSzukania {
  urzadzenie: string;
  at: string;
  wynikow: number;
  /** `null` w zdarzeniach, które nie niosą liczby wyników z adresem. */
  zAdresem: number | null;
}

/**
 * Wynik każdego szukania: ostatnie zdarzenie serii z jednego urządzenia.
 *
 * Seria to zdarzenia, między którymi mija mniej niż `PRZERWA_SZUKANIA_MS`.
 * Dwa różne szukania w tym czasie zlewają się w jedno, co zaniża liczbę
 * szukań, ale nie przekłamuje wyniku. Seria, której ostatnie zdarzenie nie
 * niesie `zAdresem`, nie ma wyniku i do odsetka nie wchodzi.
 * Czysta funkcja — wejście w kolejności czasu.
 */
export function sesjeSzukania(zdarzenia: ZdarzenieSzukania[]): WynikSzukania[] {
  const ostatnie = new Map<string, ZdarzenieSzukania>();
  const wyniki: WynikSzukania[] = [];
  const zamknij = (z: ZdarzenieSzukania) => {
    if (z.zAdresem === null) return;
    wyniki.push(z.wynikow === 0 ? "brak" : z.zAdresem > 0 ? "adres" : "bez_adresu");
  };
  for (const z of zdarzenia) {
    const p = ostatnie.get(z.urzadzenie);
    if (p && Date.parse(z.at) - Date.parse(p.at) >= PRZERWA_SZUKANIA_MS) zamknij(p);
    ostatnie.set(z.urzadzenie, z);
  }
  for (const z of ostatnie.values()) zamknij(z);
  return wyniki;
}

/** Różnica dat kalendarza `RRRR-MM-DD` w dniach. */
function dniMiedzy(od: string, doDnia: string): number {
  const d = (s: string) => {
    const [r, m, dz] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(r, m - 1, dz);
  };
  return Math.round((d(doDnia) - d(od)) / 86_400_000);
}

export interface OkresWskaznikow {
  od: string;
  do: string;
  dostawy: {
    /** Dostawy rozłożone w WERTIS i zamknięte w okresie. */
    n: number;
    /** Mediana dni od daty faktury do zamknięcia. */
    medianaDni: number | null;
    /** Mediana minut od otwarcia na kolektorze do zamknięcia. */
    medianaMinPracy: number | null;
  };
  szukanie: {
    n: number;
    zAdresem: number;
    bezAdresu: number;
    bezWyniku: number;
    /** Odsetek szukań z adresem półki, zaokrąglony do całości. */
    odsetekZAdresem: number | null;
  };
  odpowiedz: { n: number; medianaMin: number | null; p90Min: number | null };
}

export interface Wskazniki {
  dni: number;
  teraz: OkresWskaznikow;
  poprzednio: OkresWskaznikow;
}

const zaokragl = (x: number | null) => (x === null ? null : Math.round(x));

function okres(database: DatabaseSync, dni: number, koniecMs: number): OkresWskaznikow {
  const od = new Date(koniecMs - dni * 86_400_000).toISOString();
  const doChwili = new Date(koniecMs).toISOString();

  /* `external` to dostawa rozłożona poza WERTIS i bez skanów, więc czasu
     pracy nie ma z czego policzyć. Wchodzi tylko `done`. */
  const dostawy = database.prepare(`SELECT data_dok, opened_at, closed_at FROM delivery
     WHERE status = 'done' AND julianday(closed_at) >= julianday(?) AND julianday(closed_at) < julianday(?)`)
    .all(od, doChwili) as Array<{ data_dok: string | null; opened_at: string; closed_at: string }>;
  const dniDostaw = dostawy
    .filter((r) => r.data_dok && /^\d{4}-\d{2}-\d{2}/.test(r.data_dok))
    .map((r) => dniMiedzy(r.data_dok!, dataLokalna(r.closed_at)))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const minutyPracy = dostawy
    .map((r) => (Date.parse(r.closed_at) - Date.parse(r.opened_at)) / 60_000)
    .filter((m) => Number.isFinite(m) && m >= 0);

  /* `events.created_at` ma zawsze kształt ISO z `Z`, więc granice porównują
     się tekstowo i trafiają w indeks czasu zdarzeń. */
  const szukania = database.prepare(`SELECT device_id AS urzadzenie, created_at AS at,
       json_extract(payload, '$.wynikow') AS wynikow, json_extract(payload, '$.zAdresem') AS zAdresem
       FROM events
      WHERE type = 'search' AND device_id IS NOT NULL AND json_valid(payload)
        AND created_at >= ? AND created_at < ?
      ORDER BY created_at, id`).all(od, doChwili) as unknown as ZdarzenieSzukania[];
  const wyniki = sesjeSzukania(szukania.map((z) => ({
    ...z, wynikow: Number(z.wynikow ?? 0), zAdresem: z.zAdresem == null ? null : Number(z.zAdresem),
  })));
  const ile = (w: WynikSzukania) => wyniki.filter((x) => x === w).length;
  const zAdresem = ile("adres");

  const odp = czasOdpowiedzi(dni, false, database, koniecMs).ogolem;

  return {
    od, do: doChwili,
    dostawy: {
      n: dostawy.length,
      medianaDni: mediana(dniDostaw),
      medianaMinPracy: zaokragl(mediana(minutyPracy)),
    },
    szukanie: {
      n: wyniki.length, zAdresem, bezAdresu: ile("bez_adresu"), bezWyniku: ile("brak"),
      odsetekZAdresem: wyniki.length === 0 ? null : Math.round((100 * zAdresem) / wyniki.length),
    },
    odpowiedz: odp,
  };
}

/** Trzy wskaźniki za `dni` wstecz od `teraz` i za tyle samo dni wcześniej. */
export function wskazniki(dni: number, database: DatabaseSync = defaultDb(), teraz = Date.now()): Wskazniki {
  return {
    dni,
    teraz: okres(database, dni, teraz),
    poprzednio: okres(database, dni, teraz - dni * 86_400_000),
  };
}
