import { db } from "../db/db.js";
import { wierszCsv, zbudujCsv } from "./csv.js";

/* ── Odczyt śladu audytowego ─────────────────────────────────────────────────
   `events` zbiera 27 typów zdarzeń od pierwszego dnia instalacji i nic ich nie
   kasuje — tyle że do sierpnia 2026 jedynym sposobem, żeby cokolwiek stamtąd
   wyjąć, było `sqlite3` na serwerze. Reklamacja „aplikacja zjadła mi 30 sztuk"
   miała więc odpowiedź w bazie i nie miała jej w rękach człowieka, który
   odpowiada klientowi.

   Ten moduł jest WYŁĄCZNIE odczytem. Nie liczy wskaźników (to `raporty.ts`)
   i niczego nie interpretuje — zwraca wiersze takie, jakie są, bo audyt,
   który po drodze coś „porządkuje", przestaje być dowodem.                  */

/** Twardy sufit strony. Filtr po dacie potrafi objąć całą historię. */
const MAX_LIMIT = 1000;
const DOMYSLNY_LIMIT = 100;

export interface FiltrAudytu {
  od?: string | null;
  do?: string | null;
  typy?: string[] | null;
  userRef?: number | null;
  twId?: number | null;
  device?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export interface WpisAudytu {
  id: number;
  typ: string;
  czas: string;
  uzytkownik: string;
  userRef: number | null;
  device: string | null;
  twId: number | null;
  payload: string | null;
}

/** Parametry zapytania — typy, które SQLite faktycznie przyjmuje. */
type Param = string | number;

interface Warunki {
  where: string;
  params: Param[];
}

/**
 * Warunki wspólne dla listy i zliczania — jedno źródło, bo rozjazd między
 * „ile jest" a „co widać" jest błędem bez objawu: strona 3 z 2 istniejących.
 */
function warunki(f: FiltrAudytu): Warunki {
  const w: string[] = [];
  const p: Param[] = [];
  if (f.od) {
    w.push("created_at >= ?");
    p.push(f.od);
  }
  if (f.do) {
    /* Domknięcie do KOŃCA podanego dnia. `do=2026-07-29` z porównaniem `<=`
       po samej dacie odcięłoby wszystko od 00:00:00.001 tego dnia, czyli
       praktycznie cały dzień, o który człowiek właśnie pytał. */
    w.push("created_at <= ?");
    p.push(f.do.length === 10 ? `${f.do}T23:59:59.999Z` : f.do);
  }
  if (f.typy?.length) {
    w.push(`type IN (${f.typy.map(() => "?").join(",")})`);
    p.push(...f.typy);
  }
  if (f.userRef != null) {
    w.push("user_ref = ?");
    p.push(f.userRef);
  }
  if (f.twId != null) {
    w.push("tw_id = ?");
    p.push(f.twId);
  }
  if (f.device) {
    w.push("device_id = ?");
    p.push(f.device);
  }
  return { where: w.length ? `WHERE ${w.join(" AND ")}` : "", params: p };
}

/**
 * Ile historii już mamy i ile miejsca zajmuje.
 *
 * Nie czyścimy `events` i to jest decyzja — reklamacja przychodzi po
 * miesiącach, a skasowana odpowiedź nie wraca. Ale rosnąca bez kontroli baza
 * kończy się pełnym dyskiem, więc rozmiar jest widoczny w `/api/health`
 * i decyzję o archiwum podejmie się na liczbach, a nie na przeczuciu.
 */
export function statystykiAudytu(): {
  zdarzen: number;
  najstarsze: string | null;
  bazaBajtow: number;
} {
  const d = db();
  const r = d
    .prepare("SELECT COUNT(*) AS n, MIN(created_at) AS naj FROM events")
    .get() as { n: number; naj: string | null };
  /* Rozmiar z metadanych stron, nie ze `stat()` pliku: baza chodzi w WAL,
     więc świeże zapisy siedzą jeszcze poza plikiem głównym i sam `stat()`
     potrafi pokazać rozmiar sprzed godzin. */
  const strony = d.prepare("PRAGMA page_count").get() as Record<string, number>;
  const rozmiar = d.prepare("PRAGMA page_size").get() as Record<string, number>;
  const liczba = (o: Record<string, number>): number => Object.values(o)[0] ?? 0;
  return { zdarzen: r.n, najstarsze: r.naj, bazaBajtow: liczba(strony) * liczba(rozmiar) };
}

export function policzZdarzenia(f: FiltrAudytu): number {
  const { where, params } = warunki(f);
  return (db().prepare(`SELECT COUNT(*) AS n FROM events ${where}`).get(...params) as { n: number })
    .n;
}

/**
 * Zdarzenia od najnowszego. `limit` jest PRZYCINANY do `MAX_LIMIT`, a nie
 * odrzucany błędem: żądanie miliona wierszy to zwykle pomyłka w skrypcie,
 * a nie atak, i nie ma powodu, żeby kończyła się pustą odpowiedzią.
 */
export function zdarzenia(f: FiltrAudytu): WpisAudytu[] {
  const { where, params } = warunki(f);
  const limit = Math.min(Math.max(1, Math.trunc(f.limit || DOMYSLNY_LIMIT)), MAX_LIMIT);
  const offset = Math.max(0, Math.trunc(f.offset || 0));
  return db()
    .prepare(
      `SELECT id, type AS typ, created_at AS czas, user_id AS uzytkownik,
              user_ref AS userRef, device_id AS device, tw_id AS twId, payload
       FROM events ${where}
       ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as unknown as WpisAudytu[];
}

/** Typy obecne w bazie — do podpowiedzi filtra, żeby nie zgadywać z pamięci. */
export function typyZdarzen(): string[] {
  return (
    db().prepare("SELECT DISTINCT type AS t FROM events ORDER BY t").all() as Array<{ t: string }>
  ).map((r) => r.t);
}

const KOLUMNY = ["id", "czas", "typ", "uzytkownik", "userRef", "device", "twId", "payload"] as const;

/**
 * CSV do arkusza. Separator to przecinek (RFC 4180), a nie średnik — Excel
 * w polskiej lokalizacji potrzebuje wtedy kroku „Dane → Tekst jako kolumny",
 * ale plik zostaje przenośny i czytelny dla każdego innego narzędzia.
 * Payload to JSON — ma i przecinki, i cudzysłowy, więc cytowanie jest tu
 * regułą, nie przypadkiem brzegowym.
 */
export function csv(wiersze: WpisAudytu[]): string {
  const linie = [KOLUMNY.join(",")];
  for (const w of wiersze) {
    linie.push(wierszCsv(KOLUMNY.map((k) => (w as unknown as Record<string, unknown>)[k]), ","));
  }
  return zbudujCsv(linie);
}
