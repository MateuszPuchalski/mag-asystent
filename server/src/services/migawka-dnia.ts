import { db as defaultDb, type Db } from "../db/db.js";
import { dataLokalna } from "../czas.js";
import { logEvent } from "./events.js";
import { doDecyzji } from "./do-decyzji.js";
import { czasOdpowiedzi } from "./czas-odpowiedzi.js";
import { licznikiKubelkow as kubelkiZwrotow, listaZwrotow, type Kubelek as KubelekZwrotu } from "./zwroty.js";
import {
  licznikiKubelkow as kubelkiReklamacji, listaReklamacji, type Kubelek as KubelekReklamacji,
} from "./reklamacje.js";

/* ── Migawka stanu raz na dobę (@wydanie, raport tygodnia) ───────────────────
   Pytanie właściciela: „co śledzić automatycznie". Czynności śledzi dziennik
   `events` od pierwszego dnia — ponad dwieście typów. Nie śledzi go nic, co
   jest STANEM: ile spraw czeka DO DECYZJI, od kiedy najstarsza, ile zwrotów
   stoi w którym kubełku, jak długo klient czeka teraz. Każdy z tych ekranów
   liczy stan w chwili otwarcia i zapomina go przy następnym. Po tygodniu nie
   da się powiedzieć, czy zaległość rosła, bo nikt jej nie zapisał.

   ŹRÓDŁEM SĄ TE SAME FUNKCJE, KTÓRE LICZĄ EKRANY. Migawka woła `doDecyzji`,
   `listaZwrotow` i `czasOdpowiedzi`, a nie własne zapytania. Druga kopia
   reguły kubełka rozjechałaby się z ekranem przy pierwszej poprawce, a wtedy
   raport mówiłby o innych zwrotach niż kolejka, na którą patrzy biuro.

   SEKCJA, KTÓRA PADNIE, JEST `null`, NIE ZEREM. Zero znaczy „nic nie czekało",
   a brak odczytu znaczy „nie wiemy". Jedna sekcja z wyjątkiem nie zabiera
   pozostałych — migawka bez reklamacji jest lepsza niż żadna.

   ŻADNYCH LUDZI. Rozbicie czasu odpowiedzi na osoby liczy się tylko dla
   administratora i tylko na żywo (0.431.0). Zapisane co dobę zrobiłoby
   z bazy teczkę monitoringu pracowniczego, na którą nikt nie dał zgody. */

export interface Migawka {
  doDecyzji: {
    wszystko: number; magazyn: number; obsluga: number; pilne: number;
    /** Wiek najstarszej sprawy w godzinach; `null`, gdy żadna nie zna daty. */
    najstarszaGodz: number | null;
  } | null;
  /** Wyjątki dostaw bez rozstrzygnięcia — źródło listy wyjątków biura. */
  problemyOtwarte: number | null;
  /** Zapisy do Subiekta w błędzie i w drodze. Błąd czeka na człowieka. */
  kolejka: { bledy: number; wDrodze: number } | null;
  /** Rozmowy, w których ostatnie słowo należy do klienta — ta sama reguła co Analiza. */
  klientCzeka: { n: number; najdluzejMin: number | null } | null;
  zwroty: Record<KubelekZwrotu, number> | null;
  reklamacje: Record<KubelekReklamacji, number> | null;
}

export interface WpisMigawki {
  data: string;
  at: string;
  stan: Migawka;
}

/** Jedna sekcja — wyjątek zostaje w logu, a sekcja dostaje `null`. */
function sekcja<T>(nazwa: string, licz: () => T): T | null {
  try {
    return licz();
  } catch (e) {
    console.error(`[migawka] ${nazwa}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export function policzMigawke(database: Db = defaultDb(), teraz = Date.now()): Migawka {
  return {
    doDecyzji: sekcja("do decyzji", () => {
      const d = doDecyzji(teraz);
      const najstarsza = d.pozycje.map((p) => p.od).filter((x): x is string => !!x).sort()[0];
      return {
        wszystko: d.liczniki.wszystko,
        magazyn: d.liczniki.magazyn,
        obsluga: d.liczniki.obsluga,
        pilne: d.pozycje.filter((p) => p.pilne).length,
        najstarszaGodz: najstarsza
          ? Math.max(0, Math.round((teraz - Date.parse(najstarsza)) / 3_600_000)) : null,
      };
    }),
    problemyOtwarte: sekcja("problemy", () => (database
      .prepare("SELECT COUNT(*) AS n FROM problem WHERE resolved_at IS NULL").get() as { n: number }).n),
    kolejka: sekcja("kolejka", () => {
      const r = database.prepare(`SELECT
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS bledy,
          SUM(CASE WHEN status IN ('pending','processing','waiting_for_doc') THEN 1 ELSE 0 END) AS wDrodze
        FROM sfera_queue`).get() as { bledy: number | null; wDrodze: number | null };
      return { bledy: r.bledy ?? 0, wDrodze: r.wDrodze ?? 0 };
    }),
    /* Okno siedmiu dni wystarcza: czekanie liczy się od pierwszej wiadomości
       po naszej odpowiedzi, a `czasOdpowiedzi` sięga tydzień dalej wstecz. */
    klientCzeka: sekcja("klient czeka", () => czasOdpowiedzi(7, false, database, teraz).czekaTeraz),
    zwroty: sekcja("zwroty", () => kubelkiZwrotow(listaZwrotow(database, teraz))),
    reklamacje: sekcja("reklamacje", () => kubelkiReklamacji(listaReklamacji(database, teraz))),
  };
}

/**
 * Migawka dnia, jeśli tej doby lokalnej jeszcze jej nie ma.
 *
 * Pierwsza wygrywa, bo późniejsza nie jest „dokładniejsza" — jest z innej
 * pory. Serwer chodzący całą noc zrobi ją tuż po północy, czyli stan na
 * koniec poprzedniego dnia. Serwer włączany rano zrobi ją rano. Godzinę
 * trzyma `at`, żeby nikt nie porównywał jednej z drugą na ślepo.
 */
export function zrobMigawke(database: Db = defaultDb(), teraz = Date.now()): WpisMigawki | null {
  const at = new Date(teraz).toISOString();
  const data = dataLokalna(at);
  if (database.prepare("SELECT 1 FROM migawka_dnia WHERE data = ?").get(data)) return null;
  const stan = policzMigawke(database, teraz);
  const zapis = database.prepare(
    "INSERT OR IGNORE INTO migawka_dnia(data, at, stan) VALUES (?,?,?)"
  ).run(data, at, JSON.stringify(stan));
  /* Dwa procesy nie liczą migawki, ale test i ticker mogą — przegrany
     wyścig to nie błąd, tylko migawka, która już jest. */
  if (Number(zapis.changes) === 0) return null;
  logEvent("migawka_dnia", "system", null, { data }, null, database);
  return { data, at, stan };
}

/** Migawki z przedziału dat lokalnych [od, do] — rosnąco. */
export function migawki(odData: string, doData: string, database: Db = defaultDb()): WpisMigawki[] {
  return (database.prepare(
    "SELECT data, at, stan FROM migawka_dnia WHERE data >= ? AND data <= ? ORDER BY data"
  ).all(odData, doData) as Array<{ data: string; at: string; stan: string }>)
    .map((r) => ({ data: r.data, at: r.at, stan: JSON.parse(r.stan) as Migawka }));
}
