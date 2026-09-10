import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { zwin } from "../tekst.js";
import { naszeSymbole } from "./identyfikatory.js";
import type { WiedzaZOferty } from "./copilot-szkic.js";

/**
 * Zbieranie wiedzy z NASZYCH ofert Allegro (0.264.0).
 *
 * ── SKĄD TO WYDANIE ─────────────────────────────────────────────────────────
 * Właściciel: „w jaki sposób można lepiej wykorzystać wiedzę, która jest
 * zapisana w ofertach w doborze części". Odpowiedź brzmiała: dziś prawie
 * wcale. Lista zgodności miała w całym repozytorium JEDNEGO czytelnika —
 * `faktyZTresciOferty` — i trafiała stamtąd do polecenia modelu, obcięta do
 * trzydziestu pozycji. Treść oferty jest cache'em na tydzień, nadpisywanym.
 * `przebudujIdentyfikatory` czyta wyłącznie `sgt_towar`, więc numer wpisany
 * przez sprzedawcę w opisie OFERTY nie był wyszukiwalny wcale.
 *
 * `lukiZOferty` (0.254.0) wykrywało oznaczenia nieznane kartotece, wypisywało
 * je paskiem pod szkicem i przy następnym szkicu liczyło TĘ SAMĄ listę od zera.
 * System zauważał lukę za każdym razem i za każdym razem o niej zapominał.
 *
 * ── DLACZEGO OSOBNY PLIK, A NIE `identyfikatory.ts` ─────────────────────────
 * Tamten ma jedną tezę w nagłówku i jeden wyzwalacz: import z Subiekta.
 * Ten ma inny wyzwalacz (kliknięcie „Ułóż odpowiedź"), inne źródło (Allegro)
 * i inny cykl życia (wiersze, których żadna przebudowa nie odtworzy). Ten sam
 * rozdział co `allegro-oferta-tresc.ts` obok `allegro-oferty-sync.ts`.
 *
 * ── CO GDZIE IDZIE ──────────────────────────────────────────────────────────
 * Numer → `towar_identyfikator` OD RAZU: jest wyszukiwalny sam z siebie,
 * szczeblem OEM, który stoi TRZECI z jedenastu. Pozycja listy zgodności →
 * kolejka Wiedzy, bo klucz modelu składa CZŁOWIEK — automat nie zgaduje
 * marki od 0.186.0, a `STIHL FS250` bez marki jest nie do złożenia.
 */

/**
 * Ile numerów i ile pozycji zgodności bierzemy z JEDNEGO kliknięcia.
 *
 * Lista zgodności bywa na dwieście pozycji. Wrzucenie ich wszystkich do
 * kolejki jednym kliknięciem zamieniłoby ekran Wiedzy w ścianę z jednej
 * oferty, a kolejka jest wspólna dla całego magazynu. Reszta dochodzi przy
 * następnym szkicu pod tą ofertą: zapisane przestają być lukami, więc porcja
 * sama przesuwa się dalej. Wygaszanie zamiast paska postępu.
 */
export const PORCJA_Z_OFERTY = 20;

/** Kartoteka, do której wolno pisać — wraz z ofertą, z której wiedza pochodzi. */
export interface CelZapisu { twId: number; symbol: string; ofertaId: string }

export interface PokwitowanieZapisu {
  /** Numery dopisane do kartoteki PRZY TYM wywołaniu. */
  numery: Array<{ rodzaj: string; wartosc: string }>;
  /** Pozycje listy zgodności odłożone do kolejki PRZY TYM wywołaniu. */
  modele: string[];
  /** Ile pozycji TEJ kartoteki czeka w kolejce Wiedzy — łącznie, nie tylko z tego szkicu. */
  czeka: number;
}

/**
 * Zapis wiedzy z oferty do kartoteki. Jedna transakcja, `INSERT OR IGNORE`.
 *
 * `dodal='oferta'`, `dodal_user_id` NULL — i to jest decyzja o źródle wyrażona
 * w danych, nie niedopatrzenie. Numeru nie napisał agent; agent kliknął
 * „Ułóż odpowiedź". KTO kliknął, mówi zdarzenie w `events`, gdzie takie
 * pytanie się zadaje. Podpisanie wpisu agentem zrównałoby deklarację
 * sprzedawcy z katalogiem, który biuro sprawdziło.
 *
 * Wywołanie jest IDEMPOTENTNE z natury: drugi przebieg trafia w te same
 * wiersze i `INSERT OR IGNORE` je odrzuca, więc pokwitowanie jest puste,
 * a dziennik milczy.
 */
export function zapiszWiedzeZOferty(
  cel: CelZapisu, wiedza: WiedzaZOferty, kto: { id: number; name: string },
  database: DatabaseSync = db(),
): PokwitowanieZapisu {
  return transaction(database, () => {
    const nasze = naszeSymbole(database);
    /* Odfiltrowanie po SAMEJ WARTOŚCI, bez względu na rodzaj. `UNIQUE` jest
       po trójce `(tw_id, rodzaj, wartosc_norm)`, więc nie broni przed tym
       samym numerem raz jako `oem`, raz jako `nr_oryg` — a to jeden numer
       i dwa wiersze przy jednej kartotece kłamią o jego wadze. */
    const juz = new Set((database.prepare(
      "SELECT wartosc_norm FROM towar_identyfikator WHERE tw_id=?").all(cel.twId) as
      Array<{ wartosc_norm: string }>).map((w) => w.wartosc_norm));

    const insNumer = database.prepare(`INSERT OR IGNORE INTO towar_identyfikator
      (tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,dodal_user_id,oferta_id)
      VALUES (?,?,?,?,?,'oferta','oferta',NULL,?)`);
    const numery: PokwitowanieZapisu["numery"] = [];
    for (const n of wiedza.numery) {
      if (numery.length >= PORCJA_Z_OFERTY) break;
      const norm = zwin(n.wartosc);
      if (!norm || juz.has(norm) || nasze.has(norm)) continue;
      if (Number(insNumer.run(cel.twId, cel.symbol, n.rodzaj, n.wartosc, norm, cel.ofertaId).changes) === 0) continue;
      juz.add(norm);
      numery.push({ rodzaj: n.rodzaj, wartosc: n.wartosc });
    }

    const insModel = database.prepare(`INSERT OR IGNORE INTO model_z_opisu
      (tw_id,tw_symbol,tekst,tekst_norm,zrodlo,oferta_id) VALUES (?,?,?,?,'oferta',?)`);
    const modele: string[] = [];
    for (const tekst of wiedza.modele) {
      if (modele.length >= PORCJA_Z_OFERTY) break;
      const norm = zwin(tekst);
      if (!norm) continue;
      if (Number(insModel.run(cel.twId, cel.symbol, tekst, norm, cel.ofertaId).changes) === 0) continue;
      modele.push(tekst);
    }

    /* Dziennik TYLKO przy niezerowym zapisie. Dziesiąte kliknięcie pod tą samą
       ofertą nic nie dopisuje, a zdarzenie „zapisano 0 i 0" zaśmiecałoby
       księgę zdaniem bez treści. */
    if (numery.length || modele.length) {
      logEvent("wiedza_z_oferty_zapisana", kto.name, cel.twId,
        { ofertaId: cel.ofertaId, symbol: cel.symbol, numerow: numery.length, modeli: modele.length },
        kto.id, database);
    }

    return { numery, modele, czeka: czekaWKolejce(cel.twId, database) };
  })();
}

/** Ile pozycji tej kartoteki czeka na człowieka — z OBU źródeł, bo kolejka jest jedna. */
export function czekaWKolejce(twId: number, database: DatabaseSync = db()): number {
  return Number((database.prepare(
    "SELECT count(*) n FROM model_z_opisu WHERE tw_id=? AND stan='nowy'").get(twId) as { n: number }).n);
}
