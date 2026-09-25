import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb, transaction } from "../db/db.js";
import { config } from "../config.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { pobierzZalacznik, urlSprawy, urlWatkow, zapytajAllegro } from "../adapters/allegro.http.js";
import { logEvent } from "./events.js";
import {
  przygotujZdjecia, przygotujZdjeciaRozmowy, pobierzZdjecieRozmowy, type Pobieracz, type WynikZdjec,
} from "./copilot-zdjecia.js";

/* ── Test na żywym Allegro (24 września 2026) ────────────────────────────────
   Zgłoszenie właściciela po rozmowie o metodzie Feynmana: „build it”. Zasada
   stamtąd: natury nie da się oszukać. Nasze bramki sprawdzają kod wobec kodu,
   nie wobec Allegro. Copilot „widział zdjęcia” od 0.330.0, a pierwsze zdjęcie
   doszło do modelu w 0.484.6 — testy podstawiały pobieracz, więc przechodziły.

   RAZ DZIENNIE te same drogi co produkcja, BEZ ATRAP. Każdy krok woła tę samą
   funkcję, którą woła Copilot albo synchronizacja, z jej domyślnym
   pobieraczem. Atrapa wolno wstrzyknąć wyłącznie w teście tego pliku.

   WSZYSTKO TYLKO CZYTA Z ALLEGRO. Zapisujemy wynik kroku u siebie, nic tam.
   Sprawa idzie `GET`, nie przez `odswiezSprawe`, bo test nie ma prawa
   zmieniać stanu, który sprawdza.

   CZEGO NIE ZAPISUJEMY: treści, nazw plików, adresów. Zdanie o błędzie
   przechodzi przez `bezAdresow`, bo odmowa Allegro bywa z adresem pliku.

   Limit 429 to nie wada kodu, więc krok zostaje „pominięty”, a nie „błąd”.
   Czerwień na ekranie ma znaczyć jedno: droga produkcji nie działa. */

export type KrokSondy = "watki" | "sprawa" | "zdjecie_rozmowy" | "zdjecie_reklamacji" | "zdjecia_copilota";
export type WynikKroku = "ok" | "blad" | "pominiety";

export const KROKI_SONDY: readonly KrokSondy[] =
  ["watki", "sprawa", "zdjecie_rozmowy", "zdjecie_reklamacji", "zdjecia_copilota"];

export interface WynikSondy { krok: KrokSondy; wynik: WynikKroku; szczegol: string | null; ms: number }

export interface StanSondy {
  /** Start ostatniego przebiegu; `null`, gdy sonda jeszcze nie szła. */
  przebieg: string | null;
  kroki: WynikSondy[];
}

export interface ZaleznosciSondy {
  database?: DatabaseSync;
  zapytaj?: (url: string) => Promise<unknown>;
  pobierzZdjecieRozmowy?: Pobieracz;
  pobierzZalacznikSprawy?: Pobieracz;
  apiUrl?: string;
  teraz?: () => Date;
}

const RETENCJA_DNI = 90;
const OBRAZ = `(lower(nazwa) LIKE '%.jpg' OR lower(nazwa) LIKE '%.jpeg'
  OR lower(nazwa) LIKE '%.png' OR lower(nazwa) LIKE '%.webp' OR lower(nazwa) LIKE '%.gif')`;

/** Zdanie bez adresów, krótkie — idzie do bazy i na ekran. */
export function bezAdresow(tekst: string): string {
  return tekst.replace(/https?:\/\/\S+/g, "[adres]").slice(0, 300);
}

/** Pobieracz, który zapamiętuje OSTATNI powód odmowy, a dalej rzuca jak zwykle. */
function zPowodem(p: Pobieracz): { pobierz: Pobieracz; powod: () => string | null } {
  let powod: string | null = null;
  return {
    pobierz: async (url, o) => {
      try { return await p(url, o); } catch (e) {
        powod = e instanceof Error ? e.message : String(e);
        throw e;
      }
    },
    powod: () => powod,
  };
}

function ocenZdjecia(w: WynikZdjec, powod: string | null): Omit<WynikSondy, "krok" | "ms"> {
  if (w.bledow > 0) {
    return { wynik: "blad", szczegol: bezAdresow(
      `${w.bledow} z ${w.bledow + w.zdjecia.length} zdjęć nie pobrało się${powod ? `: ${powod}` : ""}`) };
  }
  if (w.zdjecia.length === 0) return { wynik: "pominiety", szczegol: "Brak obrazu do sprawdzenia" };
  return { wynik: "ok", szczegol: `${w.zdjecia.length} zdjęć doszło do bramki Copilota` };
}

export async function sondujRzeczywistosc(z: ZaleznosciSondy = {}): Promise<StanSondy> {
  const database = z.database ?? defaultDb();
  const zapytaj = z.zapytaj ?? zapytajAllegro;
  const apiUrl = z.apiUrl ?? config.allegro.apiUrl;
  const teraz = z.teraz ?? (() => new Date());
  const przebieg = teraz().toISOString();

  const kroki: Array<[KrokSondy, () => Promise<Omit<WynikSondy, "krok" | "ms">>]> = [
    ["watki", async () => {
      const b = await zapytaj(urlWatkow(apiUrl, 0)) as { threads?: unknown } | null;
      return Array.isArray(b?.threads)
        ? { wynik: "ok", szczegol: `${(b!.threads as unknown[]).length} wątków na pierwszej stronie` }
        : { wynik: "blad", szczegol: "Lista wątków bez pola threads — kształt inny, niż czyta synchronizacja" };
    }],
    ["sprawa", async () => {
      const w = database.prepare(`SELECT external_id FROM reklamacja_klienta
        ORDER BY otwarto_at DESC, id DESC LIMIT 1`).get() as { external_id: string } | undefined;
      if (!w) return { wynik: "pominiety", szczegol: "Brak sprawy posprzedażowej w bazie" };
      const b = await zapytaj(urlSprawy(apiUrl, String(w.external_id))) as { id?: unknown } | null;
      return typeof b?.id === "string"
        ? { wynik: "ok", szczegol: "Najnowsza sprawa czyta się tak, jak czyta ją odświeżenie" }
        : { wynik: "blad", szczegol: "Sprawa bez pola id — kształt inny, niż czyta odświeżenie" };
    }],
    ["zdjecie_rozmowy", async () => {
      const w = database.prepare(`SELECT m.conversation_id AS rozmowa FROM message_attachment a
        JOIN message m ON m.id = a.message_id
        WHERE m.direction = 'incoming' AND a.status = 'SAFE' AND a.url IS NOT NULL
          AND (a.mime_type LIKE 'image/%' OR ${OBRAZ.replaceAll("nazwa", "a.file_name")})
        ORDER BY m.sent_at DESC, a.id DESC LIMIT 1`).get() as { rozmowa: number } | undefined;
      if (!w) return { wynik: "pominiety", szczegol: "Brak zdjęcia od klienta w rozmowach" };
      const p = zPowodem(z.pobierzZdjecieRozmowy ?? pobierzZdjecieRozmowy);
      return ocenZdjecia(await przygotujZdjeciaRozmowy(database, Number(w.rozmowa), p.pobierz), p.powod());
    }],
    ["zdjecie_reklamacji", async () => {
      const w = database.prepare(`SELECT reklamacja_id AS id FROM reklamacja_zalacznik
        WHERE ${OBRAZ} ORDER BY id DESC LIMIT 1`).get() as { id: number } | undefined;
      if (!w) return { wynik: "pominiety", szczegol: "Brak zdjęcia w sprawach posprzedażowych" };
      const p = zPowodem(z.pobierzZalacznikSprawy ?? pobierzZalacznik);
      return ocenZdjecia(await przygotujZdjecia(database, Number(w.id), p.pobierz), p.powod());
    }],
    /* Krok BEZ SIECI: co mówi dziennik o prawdziwych szkicach z ostatniej
       doby. Sonda sprawdza jedną rozmowę, a dziennik — wszystkie. */
    ["zdjecia_copilota", async () => {
      const od = new Date(Date.parse(przebieg) - 86_400_000).toISOString();
      let zdjec = 0;
      let bledow = 0;
      for (const e of database.prepare(`SELECT payload FROM events
          WHERE type IN ('copilot_szkic','copilot_pytanie') AND created_at >= ?`)
        .all(od) as Array<{ payload: string | null }>) {
        try {
          const p = JSON.parse(e.payload ?? "{}") as { zdjec?: number; zdjecBledow?: number };
          zdjec += Number(p.zdjec ?? 0);
          bledow += Number(p.zdjecBledow ?? 0);
        } catch { /* ładunek spoza kształtu nic tu nie wnosi */ }
      }
      if (bledow > 0) {
        return { wynik: "blad", szczegol: `W ostatniej dobie ${bledow} zdjęć klienta nie doszło do modelu` };
      }
      return zdjec > 0
        ? { wynik: "ok", szczegol: `W ostatniej dobie ${zdjec} zdjęć doszło do modelu` }
        : { wynik: "pominiety", szczegol: "W ostatniej dobie Copilot nie dostał żadnego zdjęcia" };
    }],
  ];

  const wyniki: WynikSondy[] = [];
  for (const [krok, f] of kroki) {
    const start = Date.now();
    try {
      wyniki.push({ krok, ...(await f()), ms: Date.now() - start });
    } catch (e) {
      const limit = e instanceof BladLimituAllegro;
      wyniki.push({
        krok, wynik: limit ? "pominiety" : "blad", ms: Date.now() - start,
        szczegol: limit ? "Limit Allegro — kolejna próba w następnym przebiegu"
          : bezAdresow(e instanceof Error ? e.message : String(e)),
      });
    }
  }

  transaction(database, () => {
    const ins = database.prepare(`INSERT INTO sonda_rzeczywistosci(przebieg,krok,wynik,szczegol,ms)
      VALUES (?,?,?,?,?)`);
    for (const w of wyniki) ins.run(przebieg, w.krok, w.wynik, w.szczegol, w.ms);
    database.prepare("DELETE FROM sonda_rzeczywistosci WHERE przebieg < ?")
      .run(new Date(Date.parse(przebieg) - RETENCJA_DNI * 86_400_000).toISOString());
  })();
  const ile = (w: WynikKroku) => wyniki.filter((x) => x.wynik === w).length;
  logEvent("sonda_rzeczywistosci", "system", null,
    { ok: ile("ok"), blad: ile("blad"), pominiety: ile("pominiety") }, null, database);
  return { przebieg, kroki: wyniki };
}

/** Ostatni przebieg — odczyt, bez zapisu. */
export function stanSondy(database: DatabaseSync = defaultDb()): StanSondy {
  const ost = database.prepare("SELECT max(przebieg) AS p FROM sonda_rzeczywistosci")
    .get() as { p: string | null };
  if (!ost.p) return { przebieg: null, kroki: [] };
  const kroki = (database.prepare(`SELECT krok, wynik, szczegol, ms FROM sonda_rzeczywistosci
    WHERE przebieg = ? ORDER BY id`).all(ost.p) as Array<Record<string, unknown>>)
    .map((r) => ({ krok: String(r.krok) as KrokSondy, wynik: String(r.wynik) as WynikKroku,
      szczegol: r.szczegol == null ? null : String(r.szczegol), ms: Number(r.ms) }));
  return { przebieg: ost.p, kroki };
}
