import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { zwin } from "../tekst.js";
import { naszeSymbole, przerobModelZOpisu } from "./identyfikatory.js";
import { markaNaPoczatku, markaZKontekstu, jedynyModelPoNazwie } from "./wiedza-automat.js";
import { rozstrzygnijZastosowanie } from "./wiedza.js";
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

/** Podpis maszyny składającej klucz przy zbieraniu z oferty (0.339.0). */
const AUTOMAT_OFERTY = { automat: "oferta" } as const;

/** Kartoteka, do której wolno pisać — wraz z ofertą, z której wiedza pochodzi. */
export interface CelZapisu { twId: number; symbol: string; ofertaId: string }

export interface PokwitowanieZapisu {
  /** Numery dopisane do kartoteki PRZY TYM wywołaniu. */
  numery: Array<{ rodzaj: string; wartosc: string }>;
  /** Pozycje listy zgodności odłożone do kolejki PRZY TYM wywołaniu. */
  modele: string[];
  /** Ile pozycji TEJ kartoteki czeka w kolejce Wiedzy — łącznie, nie tylko z tego szkicu. */
  czeka: number;
  /**
   * Pozycje, które weszły do wiedzy OD RAZU, bez kolejki i bez agenta (0.339.0).
   * Podzbiór rozłączny z `modele`: wiersz albo dostał klucz tutaj, albo czeka.
   */
  wpisane: string[];
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
  /* `id: null` znaczy „zrobił to takt, nie człowiek" (0.317.0). Wiersz
     identyfikatora i tak ma `dodal_user_id` puste — kto kliknął, mówi
     dziennik — więc jedyne, co się zmienia, to autor ZDARZENIA. */
  cel: CelZapisu, wiedza: WiedzaZOferty, kto: { id: number | null; name: string },
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

    /* ── KLUCZ SKŁADANY OD RAZU (0.339.0) ───────────────────────────────────
       Właściciel: „wiedza z ofert powinna wskakiwać bez potwierdzania przez
       agenta". Numery wskakiwały tak od 0.264.0; pozycje listy zgodności
       czekały w kolejce, bo w wierszu stoi goły tekst bez marki.

       TU JEST NAJLEPSZY MOMENT NA ZŁOŻENIE KLUCZA, lepszy niż takt z 0.331.0:
       ofertę mamy w ręku razem z jej tytułem, czyli z materiałem, z którego
       marka się wyczytuje. Takt musiałby po nią wracać, a przede wszystkim
       przyszedłby pół godziny później.

       ŹRÓDŁA TE SAME, nie druga kopia — trzy funkcje z `wiedza-automat`.
       Model językowego tu NIE ma i to jest decyzja: ta droga ma nie kosztować
       ani grosza i nie zgadywać. Wiersz, przy którym źródła milczą, zostaje
       w kolejce i tam czeka na takt albo na człowieka, jak dotąd. */
    const wpisane: string[] = [];
    let nieudanych = 0;
    if (modele.length) {
      const marki = (database.prepare(
        "SELECT DISTINCT marka FROM model_urzadzenia").all() as Array<{ marka: string }>)
        .map((w) => w.marka);
      const swieze = database.prepare(
        `SELECT id, tekst FROM model_z_opisu WHERE tw_id=? AND stan='nowy' AND oferta_id=?`)
        .all(cel.twId, cel.ofertaId) as Array<{ id: number; tekst: string }>;
      for (const w of swieze) {
        if (!modele.includes(w.tekst)) continue;
        const model = markaNaPoczatku(w.tekst, marki)
          ?? jedynyModelPoNazwie(database, w.tekst)
          ?? markaZKontekstu(database, cel.twId, cel.ofertaId, w.tekst, marki);
        if (!model) continue;
        try {
          const z = przerobModelZOpisu(w.id, model, AUTOMAT_OFERTY, database);
          rozstrzygnijZastosowanie(z.id, "zatwierdz", null, AUTOMAT_OFERTY, database);
          wpisane.push(w.tekst);
        } catch {
          /* NIE PRZERYWA zbierania: najczęstszy powód to „ta para już czeka
             w kolejce albo jest zatwierdzona", czyli stan zastany.

             Liczbę odnotowujemy w dzienniku i to nie jest ozdoba. Pierwsza
             wersja tego bloku milczała, a pod spodem KAŻDY wpis wywracał się
             na „cannot start a transaction within a transaction" — z zewnątrz
             wyglądało to identycznie jak „marki nie dało się odczytać".
             Cicha obsługa błędu ukryła wadę, której szukałem w złym miejscu. */
          nieudanych += 1;
        }
      }
    }

    /* Dziennik TYLKO przy niezerowym zapisie. Dziesiąte kliknięcie pod tą samą
       ofertą nic nie dopisuje, a zdarzenie „zapisano 0 i 0" zaśmiecałoby
       księgę zdaniem bez treści. */
    if (numery.length || modele.length) {
      logEvent("wiedza_z_oferty_zapisana", kto.name, cel.twId,
        { ofertaId: cel.ofertaId, symbol: cel.symbol, numerow: numery.length,
          modeli: modele.length, wpisanych: wpisane.length, nieudanych },
        kto.id, database);
    }

    /* `modele` niesie już tylko to, co ZOSTAŁO w kolejce — wiersz wpisany nie
       jest „odłożony do kolejki" i ekran nie ma prawa tak o nim mówić. */
    return {
      numery,
      modele: modele.filter((m) => !wpisane.includes(m)),
      wpisane,
      czeka: czekaWKolejce(cel.twId, database),
    };
  })();
}

/** Ile pozycji tej kartoteki czeka na człowieka — z OBU źródeł, bo kolejka jest jedna. */
export function czekaWKolejce(twId: number, database: DatabaseSync = db()): number {
  return Number((database.prepare(
    "SELECT count(*) n FROM model_z_opisu WHERE tw_id=? AND stan='nowy'").get(twId) as { n: number }).n);
}
