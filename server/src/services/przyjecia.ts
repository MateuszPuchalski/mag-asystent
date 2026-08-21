import { db, nowIso, transaction } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { BladKosza, szczegolKosza, type SzczegolKosza } from "./kosze.js";

/* ── Przyjęcia na regał zwrotów — kosz z dokumentu Subiekta ──────────────────
   Obieg magazynu jest starszy niż ta aplikacja i wygląda tak:

     1. Biuro składa koszyk ze zwróconym towarem i wystawia w Subiekcie
        przesunięcie MM z magazynu głównego NA regał zwrotów.
     2. Numer tego dokumentu — SAMĄ LICZBĘ — pisze odręcznie na kartce
        przypiętej do kosza: „1209".
     3. Kosz jedzie na halę, magazynier rozkłada zawartość na regały.
     4. Dokument powrotny (ZWR→MAG) wystawia BIURO, nie kolektor.

   Aplikacja wchodzi w ten obieg, zamiast zapraszać do nowego: jednostką pracy
   jest dokument, listę towarów bierzemy z jego pozycji, a po rozłożeniu
   kolektor NIE tworzy żadnego dokumentu. Kosz z dokumentu poznaje się po
   `kosz.mm_dok_id` — i to ta kolumna rozstrzyga w `zakonczKosz`, czy cokolwiek
   idzie do kolejki zapisów.                                                  */

export interface WierszPrzyjecia {
  dokId: number;
  /** Liczba z numeru — ta z kartki przy koszu. */
  numer: string;
  nrPelny: string;
  data: string;
  pozycji: number;
  /** nietkniety | w_rozkladaniu | rozlozony | poza_aplikacja */
  stan: string;
  /** Kosz, jeśli ktoś już otworzył ten dokument na kolektorze. */
  koszId: number | null;
  odlozonych: number;
}

/**
 * Liczba z numeru dokumentu: `„MM 1240/MAG/2026" → „1240"`.
 *
 * Kartka przy koszu nosi samą liczbę, więc to ona jest kluczem wyszukiwania.
 * Numer bez rozpoznawalnego kształtu zwraca same cyfry, jakie się w nim
 * znajdą — lepiej dopasować za szeroko niż nie dopasować wcale, bo drugie
 * kończy się magazynierem stojącym z koszem przy niedziałającym ekranie.
 */
export function numerKosza(nrPelny: string): string {
  const m = /(\d+)\s*\//.exec(nrPelny ?? "");
  if (m) return m[1];
  const cyfry = (nrPelny ?? "").replace(/\D/g, "");
  return cyfry;
}

/** To, co magazynier wpisał albo zeskanował, sprowadzone do samej liczby. */
export function numerZKartki(raw: string): string {
  return numerKosza(String(raw ?? "").trim());
}

/**
 * Przyjęcia z okna importu wraz ze stanem pracy po naszej stronie.
 *
 * Rozłożone i zdjęte ręką zostają na liście — magazynier ma widzieć, że
 * dokument jest znany i zrobiony, zamiast szukać go w nieskończoność.
 */
export function listaPrzyjec(): WierszPrzyjecia[] {
  const wiersze = db()
    .prepare(
      `SELECT m.dok_id, m.numer, m.nr_pelny, m.data_wyst,
              (SELECT COUNT(*) FROM sgt_mm_zwrot_pozycja p WHERE p.dok_id = m.dok_id) AS pozycji,
              k.id AS kosz_id, k.status AS kosz_status,
              (SELECT COUNT(*) FROM kosz_pozycja kp
                WHERE kp.kosz_id = k.id AND kp.status = 'done') AS odlozonych,
              (SELECT 1 FROM przyjecie_pominiete pp WHERE pp.dok_id = m.dok_id) AS pominiete
       FROM sgt_mm_zwrot m
       LEFT JOIN kosz k ON k.mm_dok_id = m.dok_id
       ORDER BY m.data_wyst DESC, m.dok_id DESC
       LIMIT 200`
    )
    .all() as Array<Record<string, unknown>>;

  return wiersze.map((w) => {
    const koszStatus = (w.kosz_status as string) ?? null;
    const stan = w.pominiete
      ? "poza_aplikacja"
      : koszStatus === "rozlozony"
        ? "rozlozony"
        : koszStatus
          ? "w_rozkladaniu"
          : "nietkniety";
    return {
      dokId: w.dok_id as number,
      numer: w.numer as string,
      nrPelny: w.nr_pelny as string,
      data: w.data_wyst as string,
      pozycji: w.pozycji as number,
      stan,
      koszId: (w.kosz_id as number) ?? null,
      odlozonych: (w.odlozonych as number) ?? 0,
    };
  });
}

/**
 * Otwarcie kosza po numerze z kartki — materializacja dokumentu jako kosza.
 *
 * IDEMPOTENTNE po `mm_dok_id`: drugi skan tej samej kartki (albo drugi
 * kolektor przy tym samym koszu) dostaje TEN SAM kosz, nie drugi. Kosz rodzi
 * się od razu `zamkniety`, bo nie ma czego do niego dokładać — zawartość
 * ustalił dokument.
 */
export function otworzPrzyjecie(raw: string, autor: string): SzczegolKosza {
  const numer = numerZKartki(raw);
  if (!numer) throw new BladKosza(400, "Podaj numer z kartki przy koszu, np. 1209");

  const d = db();
  const dok = d
    .prepare("SELECT dok_id, nr_pelny, numer FROM sgt_mm_zwrot WHERE numer = ? ORDER BY dok_id DESC")
    .get(numer) as { dok_id: number; nr_pelny: string; numer: string } | undefined;
  if (!dok) {
    throw new BladKosza(
      404,
      `Nie znam przyjęcia o numerze ${numer} — sprawdź kartkę albo poczekaj na ` +
        "synchronizację z Subiektem"
    );
  }

  const istniejacy = d.prepare("SELECT id FROM kosz WHERE mm_dok_id = ?").get(dok.dok_id) as
    | { id: number }
    | undefined;
  if (istniejacy) return szczegolKosza(istniejacy.id);

  const pozycje = d
    .prepare(
      /* Kartoteka ma pierwszeństwo, bo bywa poprawiana po wystawieniu
         dokumentu. Snapshot z MM jest drugi i ratuje towar ZABLOKOWANY
         w Subiekcie: takiego importer kartotek nie zna, a leży w koszu. */
      `SELECT p.tw_id, p.ilosc,
              COALESCE(NULLIF(t.symbol, ''), p.symbol, '') AS symbol,
              COALESCE(NULLIF(t.nazwa, ''), p.nazwa, '') AS nazwa
       FROM sgt_mm_zwrot_pozycja p
       LEFT JOIN sgt_towar t ON t.tw_id = p.tw_id
       WHERE p.dok_id = ? ORDER BY p.id`
    )
    .all(dok.dok_id) as Array<{ tw_id: number; ilosc: number; symbol: string; nazwa: string }>;
  if (pozycje.length === 0) {
    throw new BladKosza(400, `Przyjęcie ${dok.nr_pelny} nie ma pozycji — nie ma czego rozkładać`);
  }

  let koszId = 0;
  transaction(d, () => {
    const teraz = nowIso();
    const wynik = d
      .prepare(
        `INSERT INTO kosz(kod, status, mm_dok_id, mm_numer,
                          utworzono_at, utworzono_przez, zamknieto_at, zamknieto_przez)
         VALUES (?, 'zamkniety', ?, ?, ?, ?, ?, ?)`
      )
      .run(dok.numer, dok.dok_id, dok.numer, teraz, autor, teraz, autor);
    koszId = Number(wynik.lastInsertRowid);
    const ins = d.prepare(
      `INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc)
       VALUES (?,?,?,?,?)`
    );
    for (const p of pozycje) {
      /* Nazwa z kartoteki, a gdy towar z niej wypadł — z pustki. Snapshot
         wystarcza do pracy: liczy się symbol na opakowaniu i ilość. */
      ins.run(koszId, p.tw_id, p.symbol, p.nazwa || p.symbol || String(p.tw_id), p.ilosc);
    }
    logEvent("przyjecie_otwarte", autor, null, {
      dokId: dok.dok_id,
      numer: dok.numer,
      koszId,
      pozycji: pozycje.length,
    });
  })();
  return szczegolKosza(koszId);
}

/**
 * „Już rozłożony" — dokument sprzed wdrożenia, którego towar dawno leży na
 * regałach. Decyzja człowieka i tylko admina: to jedyny sposób, żeby zdjąć
 * z listy pracę, której aplikacja nie widziała. Idempotentne.
 */
export function oznaczRozlozonePozaAplikacja(dokId: number, autor: string): void {
  const d = db();
  const dok = d.prepare("SELECT numer FROM sgt_mm_zwrot WHERE dok_id = ?").get(dokId) as
    | { numer: string }
    | undefined;
  if (!dok) throw new BladKosza(404, `Przyjęcie ${dokId} nie istnieje`);
  d.prepare(
    "INSERT OR IGNORE INTO przyjecie_pominiete(dok_id, at, przez) VALUES (?,?,?)"
  ).run(dokId, nowIso(), autor);
  logEvent("przyjecie_poza_aplikacja", autor, null, { dokId, numer: dok.numer });
}

/** Ile przyjęć czeka na rozłożenie — liczba na kafel raportu i do diagnozy. */
export function liczbaPrzyjecDoRozlozenia(): number {
  return listaPrzyjec().filter((p) => p.stan === "nietkniety" || p.stan === "w_rozkladaniu").length;
}

/** Magazyn zwrotów, z którego przychodzą przyjęcia — do komunikatów i diagnozy. */
export const MAGAZYN_ZWROTOW = config.magId.ZWROTY;
