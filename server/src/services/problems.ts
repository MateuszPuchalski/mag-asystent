import fs from "node:fs";
import path from "node:path";
import { db } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { closeIfComplete } from "./delivery.js";
import { wierszCsv, zbudujCsv } from "./csv.js";
import type { ProblemView, ProblemType } from "../types.js";

/* ── Faza 2: wyjątki jako obiekt pierwszej klasy (D8) ────────────────────────
   Wyjątek to wiersz w bazie, nie notatka w głowie magazyniera — inaczej nie da
   się zmierzyć, ile kosztują, ani zgłosić reklamacji dostawcy.               */

/* ── Kategorie niezgodności ─────────────────────────────────────────────────
   Lista jest ZAMKNIĘTA i od 0.21.0 jest to DOSŁOWNIE lista z firmowego
   formularza „Niezgodność w dostawie". Powód jest prosty: zgłoszenie
   z kolektora i formularz wysyłany dostawcy to dotąd były dwa różne zestawy
   pól, a różnicę uzupełniało biuro z pamięci.

   ZGŁASZALNE i NAZYWALNE to dwie różne listy, i to jest zamierzone. Wyjątki
   sprzed 0.21.0 zostają w bazie na zawsze — historii się nie kasuje — więc
   muszą mieć etykietę, inaczej protokół dla dostawcy pokazałby surowy klucz
   `qty_short`. Zgłosić ich już jednak nie sposób: formularz ich nie zna.

   Kolektor trzyma własną kopię tej listy i tak ma być: etykiety muszą być na
   ekranie także wtedy, gdy Wi-Fi padło w połowie hali.                       */

/** Kategorie z formularza — tylko te oferuje dziś kolektor. */
export const PROBLEM_TYPES: ProblemType[] = [
  "wrong_item",
  "missing_item",
  "damaged",
  "qty_mismatch",
  "extra_item",
];

/**
 * Czy taki wyjątek wolno dziś zapisać — wyłącznie kategorie formularza.
 *
 * Do 0.26.0 przechodziły też klucze sprzed 0.21.0 (okno wdrożenia APK przez
 * MDM); wszystkie kolektory mają już nowe APK, więc okno się zamknęło.
 * Stare klucze zostają wyłącznie NAZYWALNE (etykiety niżej) — historia
 * w bazie musi mieć etykietę na protokole dla dostawcy.
 */
export const typZapisywalny = (typ: string): boolean =>
  PROBLEM_TYPES.includes(typ as ProblemType);

export const PROBLEM_TYPES_LABELS: Readonly<Record<ProblemType, string>> = {
  // pięć kategorii formularza
  wrong_item: "Błędny artykuł",
  missing_item: "Brak w przesyłce",
  damaged: "Uszkodzone w transporcie",
  qty_mismatch: "Zła ilość",
  extra_item: "Artykuł niezamówiony",
  // sprzed 0.21.0 — do nazwania, nie do zgłoszenia
  qty_short: "Za mało",
  qty_over: "Za dużo",
  no_space: "Brak miejsca",
  unknown_barcode: "Nieznany kod",
  ean_conflict: "Kolizja EAN",
};

/**
 * Zakres kategorii — lustro `ZakresProblemu` w `:core` (0.57.0).
 *
 * Kategoria spoza tej listy dotyczy POZYCJI. Zapisujemy tu wyjątki od reguły,
 * a nie całą tabelę, bo nowy typ ma domyślnie wymagać pozycji — to bezpieczna
 * strona pomyłki: wyjątek bez wskazanej pozycji nie mówi dostawcy, czego
 * dotyczy, więc protokół wychodzi pusty.
 */
const ZAKRES_DOSTAWA: ReadonlySet<string> = new Set<string>(["extra_item"]);

/**
 * Ile NIEROZWIĄZANYCH wyjątków ma każdy z podanych dokumentów (0.57.0).
 *
 * Jedno zapytanie na całą listę dostaw, nie jedno na wiersz. Powstało, bo
 * panel biura był na wyjątki ŚLEPY: wyjątek liczy się jako pozycja domknięta
 * (D8, świadomie), więc dostawa z trzema reklamacjami pokazywała zielony pasek
 * 100% i wyglądała jak bezproblemowa.
 *
 * Liczymy wyjątki, nie linie: dwa zgłoszenia na jednej pozycji to dwie sprawy
 * do załatwienia, a nie jedna.
 */
export function wyjatkiOtwarteWgDokumentu(
  dokIds: ReadonlyArray<number>
): Map<number, number> {
  const czyste = [...new Set(dokIds.filter((d) => Number.isFinite(d) && d > 0))];
  if (czyste.length === 0) return new Map();
  const luki = czyste.map(() => "?").join(",");
  const wiersze = db()
    .prepare(
      `SELECT d.sgt_dok_id AS dokId, COUNT(*) AS ile
         FROM problem p
         JOIN delivery d ON d.id = p.delivery_id
        WHERE p.resolved_at IS NULL AND d.sgt_dok_id IN (${luki})
        GROUP BY d.sgt_dok_id`
    )
    .all(...czyste) as Array<{ dokId: number; ile: number }>;
  return new Map(wiersze.map((w) => [w.dokId, w.ile]));
}

/** Etykieta typu; nieznany klucz pokazujemy surowo, zamiast udawać, że go znamy. */
export const etykietaTypu = (typ: string): string =>
  PROBLEM_TYPES_LABELS[typ as ProblemType] ?? typ;

/**
 * Zdjęcie OBOWIĄZKOWE — dowód do reklamacji.
 *
 * Formularz żąda go wprost przy uszkodzeniu w transporcie (`type=file
 * required`). Przy błędnym artykule jest u niego opcjonalne, ale zostaje
 * wymagane u nas: „przyszło co innego" bez zdjęcia jest nie do obrony,
 * gdy dostawca zapyta, co dokładnie przyjechało.
 */
const PHOTO_REQUIRED: ReadonlySet<string> = new Set(["damaged", "wrong_item"]);

/** Ilość wymagana. Formularz żąda jej w KAŻDEJ z pięciu kategorii. */
const QTY_REQUIRED: ReadonlySet<string> = new Set(PROBLEM_TYPES);

const nowIso = () => new Date().toISOString();

let photoDirGotowy = false;

function photoDir(): string {
  const dir = path.resolve(path.dirname(config.dbPath), "photos");
  if (!photoDirGotowy) {
    fs.mkdirSync(dir, { recursive: true });
    photoDirGotowy = true;
  }
  return dir;
}

/** Zapis zdjęcia (base64 z aparatu kolektora) na dysk; zwraca nazwę pliku. */
function savePhoto(base64: string): string {
  const clean = base64.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(clean, "base64");
  const name = `p${Date.now()}-${Math.round(buf.length / 1024)}kb.jpg`;
  fs.writeFileSync(path.join(photoDir(), name), buf);
  return name;
}

/** Referencja zdjęcia po id problemu (null = brak zdjęcia albo brak problemu). */
export function photoRefOf(id: number): string | null {
  const r = db().prepare("SELECT foto_ref FROM problem WHERE id=?").get(id) as
    | { foto_ref: string | null }
    | undefined;
  return r?.foto_ref ?? null;
}

export function photoPath(ref: string): string | null {
  // bez ../ w nazwie — ref pochodzi z bazy, ale nie ufamy mu na ścieżce
  const safe = path.basename(ref);
  const p = path.join(photoDir(), safe);
  return fs.existsSync(p) ? p : null;
}

export interface RaiseProblemInput {
  deliveryId: number;
  lineId?: number | null;
  typ: string;
  qty?: number | null;
  /** Numer katalogowy artykułu, którego NIE MA na dokumencie. */
  symObcy?: string | null;
  /** Ile miało przyjść tego, co zamówiono, a nie dostarczono (`wrong_item`). */
  zamiastIlosc?: number | null;
  opis?: string | null;
  photoBase64?: string | null;
  /**
   * Zostaw linii jej dotychczasowy status zamiast ustawiać `problem`.
   *
   * Jedyny klient to automatyczne zgłoszenie NADMIARU przy zamknięciu dostawy
   * (0.64.0). Tam towar fizycznie leży na półce, więc pozycja JEST odłożona —
   * przestawienie jej na `problem` kazałoby magazynierowi wrócić do roboty,
   * której nie ma. Nadmiar jest sprawą biura wobec dostawcy, nie zadaniem hali.
   *
   * Pomija też `closeIfComplete`: wywołanie idzie już Z WNĘTRZA zamykania.
   */
  zachowajStatusLinii?: boolean;
}

/**
 * Kategorie opisujące artykuł SPOZA dokumentu — numer katalogowy trzeba wtedy
 * podać, bo nie ma linii, z której dałoby się go odczytać.
 *
 * `wrong_item`: przyszło coś, czego nie zamawialiśmy, w miejsce zamówionego.
 * `extra_item`: przyszło dodatkowo, obok wszystkiego, co miało przyjść.
 */
const SYM_OBCY_REQUIRED: ReadonlySet<string> = new Set(["wrong_item", "extra_item"]);

/**
 * Zgłoszenie wyjątku. Waliduje regułę domenową: uszkodzenie / zły towar /
 * nieznany kod bez zdjęcia nie jest zgłoszeniem, tylko opinią.
 */
export function raiseProblem(
  input: RaiseProblemInput,
  user: string
): { id: number } | { error: string } {
  if (!typZapisywalny(input.typ)) {
    return { error: `Nieznany typ problemu: ${input.typ}` };
  }
  if (PHOTO_REQUIRED.has(input.typ) && !input.photoBase64) {
    return { error: "Ten typ problemu wymaga zdjęcia" };
  }
  if (QTY_REQUIRED.has(input.typ) && (input.qty == null || !Number.isFinite(input.qty))) {
    return { error: "Podaj ilość faktyczną" };
  }
  if (SYM_OBCY_REQUIRED.has(input.typ) && !input.symObcy?.trim()) {
    return { error: "Podaj numer katalogowy artykułu spoza dokumentu" };
  }
  /* ZAKRES W OBIE STRONY (0.57.0). Do tej wersji stała tu tylko połowa reguły
     i tylko dla „złej ilości". Druga połowa jest nowa i to ona zamyka dziurę:
     „artykuł niezamówiony" — z definicji towar SPOZA dokumentu — dawało się
     przypiąć do dowolnej pozycji faktury i ustawić jej status `problem`. */
  const dotyczyDostawy = ZAKRES_DOSTAWA.has(input.typ);
  if (!dotyczyDostawy && !input.lineId) {
    return {
      error: `„${etykietaTypu(input.typ)}" dotyczy pozycji z dokumentu — wskaż ją`,
    };
  }
  if (dotyczyDostawy && input.lineId) {
    return {
      error: `„${etykietaTypu(input.typ)}" dotyczy całej dostawy, nie pojedynczej pozycji`,
    };
  }

  /* Snapshot ilości z dokumentu. Odczyt „na żywo" przy druku protokołu
     pokazywałby stan PO ewentualnej korekcie faktury w Subiekcie, a protokół
     ma mówić, co widzieliśmy przy palecie.

     Sprawdzenie linii idzie PRZED zapisem zdjęcia — inaczej odrzucone
     zgłoszenie zostawiałoby na dysku plik, którego nic już nie wskazuje. */
  let iloscDok: number | null = null;
  if (input.lineId) {
    const linia = db()
      .prepare("SELECT ilosc_dok FROM delivery_line WHERE id = ?")
      .get(input.lineId) as { ilosc_dok: number } | undefined;
    // bez tego nieistniejąca linia leci w klucz obcy i wraca jako 500 — a to
    // jest zdanie o bazie, nie o zgłoszeniu, więc nikt się z nim nie policzy
    if (!linia) return { error: "Nie ma takiej pozycji w dokumencie" };
    iloscDok = linia.ilosc_dok;
  }

  let fotoRef: string | null = null;
  if (input.photoBase64) {
    try {
      fotoRef = savePhoto(input.photoBase64);
    } catch {
      return { error: "Nie udało się zapisać zdjęcia" };
    }
  }

  const id = Number(
    db()
      .prepare(
        `INSERT INTO problem(delivery_id, line_id, typ, ilosc, sym_obcy, zamiast_ilosc,
                             ilosc_dok, opis, foto_ref, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        input.deliveryId,
        input.lineId ?? null,
        input.typ,
        input.qty ?? null,
        input.symObcy?.trim() || null,
        input.zamiastIlosc ?? null,
        iloscDok,
        input.opis ?? null,
        fotoRef,
        nowIso(),
        user
      ).lastInsertRowid
  );

  // linia z problemem wypada z rutyny — nie blokuje zamknięcia reszty dostawy
  if (input.lineId && !input.zachowajStatusLinii) {
    db().prepare("UPDATE delivery_line SET status='problem' WHERE id=?").run(input.lineId);
    // jeśli to była ostatnia otwarta pozycja, dostawa domyka się tak samo jak
    // po zwykłym odłożeniu — wyjątek żyje dalej na liście nierozwiązanych
    closeIfComplete(input.deliveryId, user);
  }
  logEvent("problem_raised", user, null, { problemId: id, typ: input.typ, lineId: input.lineId ?? null });
  return { id };
}

function mapRow(r: any): ProblemView {
  return {
    id: r.id,
    deliveryId: r.delivery_id,
    lineId: r.line_id,
    typ: r.typ,
    typLabel: etykietaTypu(r.typ),
    qty: r.ilosc,
    symObcy: r.sym_obcy ?? null,
    zamiastIlosc: r.zamiast_ilosc ?? null,
    qtyDok: r.ilosc_dok ?? null,
    opis: r.opis,
    hasPhoto: !!r.foto_ref,
    createdAt: r.created_at,
    createdBy: r.created_by,
    resolvedAt: r.resolved_at,
    resolvedNote: r.resolved_note,
    docNumber: r.doc_number ?? null,
    sym: r.sym ?? null,
    name: r.name ?? null,
    unit: r.unit ?? "",
  };
}

/* Jednostka dochodzi z kartoteki przez pozycję dostawy — wyjątek niesie ilość
   („brakuje 3"), a bez jednostki kolektor dopisywał do niej „szt" z palca.
   Wszystkie złączenia LEWE: wyjątek zgłoszony luzem nie ma pozycji, a pozycja
   przeżywa zniknięcie kartoteki z read-modelu. */
const SELECT_JOIN = `
  SELECT p.*, d.sgt_dok_numer AS doc_number, l.tw_symbol AS sym, l.tw_nazwa AS name, t.unit
  FROM problem p
  LEFT JOIN delivery d ON d.id = p.delivery_id
  LEFT JOIN delivery_line l ON l.id = p.line_id
  LEFT JOIN sgt_towar t ON t.tw_id = l.tw_id`;

/** Nierozwiązane wyjątki — ekran na starcie aplikacji, inaczej nikt się nimi nie zajmie. */
export function listUnresolved(): ProblemView[] {
  return (db().prepare(`${SELECT_JOIN} WHERE p.resolved_at IS NULL ORDER BY p.id DESC`).all() as any[]).map(
    mapRow
  );
}

export function listByDelivery(deliveryId: number): ProblemView[] {
  return (
    db().prepare(`${SELECT_JOIN} WHERE p.delivery_id = ? ORDER BY p.id`).all(deliveryId) as any[]
  ).map(mapRow);
}

/**
 * Numer przesyłki i odpowiedź o protokole kuriera — dane CAŁEJ paczki.
 *
 * `kurierProtokol` ma trzy stany, nie dwa: `tak`, `nie` i NULL („nie pytano").
 * Zwinięcie NULL-a do „nie" kłamałoby w formularzu reklamacyjnym, a to on
 * jedzie do przewoźnika.
 */
export function zapiszPrzesylke(
  deliveryId: number,
  nrPrzesylki: string | null,
  kurierProtokol: string | null,
  user: string
): { ok: true } | { error: string } {
  if (kurierProtokol != null && !["tak", "nie"].includes(kurierProtokol)) {
    return { error: "Protokół z kurierem: tak albo nie" };
  }
  const r = db()
    .prepare(
      `UPDATE delivery SET nr_przesylki = ?, kurier_protokol = ?, przesylka_at = ?, przesylka_by = ?
       WHERE id = ?`
    )
    .run(nrPrzesylki?.trim() || null, kurierProtokol, nowIso(), user, deliveryId);
  if (r.changes === 0) return { error: "Nie ma takiej dostawy" };
  logEvent("przesylka_zapisana", user, null, { deliveryId, kurierProtokol });
  return { ok: true };
}

export function resolveProblem(id: number, note: string | undefined, user: string): { ok: true } | { error: string } {
  const r = db()
    .prepare("UPDATE problem SET resolved_at=?, resolved_note=? WHERE id=? AND resolved_at IS NULL")
    .run(nowIso(), note ?? null, id);
  if (r.changes === 0) return { error: "Problem nie istnieje albo jest już rozwiązany" };
  logEvent("problem_resolved", user, null, { problemId: id });
  return { ok: true };
}

/** CSV do reklamacji u dostawcy (§4.6). Separator `;` — Excel PL. */
export function exportCsv(deliveryId: number): string {
  const rows = listByDelivery(deliveryId);
  const head = [
    "id",
    "dokument",
    "symbol",
    "nazwa",
    "typ",
    "ilosc",
    "opis",
    "zdjecie",
    "zgloszono",
    "zglosil",
    "rozwiazano",
    "notatka",
  ].join(";");
  const lines = rows.map((p) =>
    wierszCsv(
      [
        p.id,
        p.docNumber,
        p.sym,
        p.name,
        p.typ,
        p.qty,
        p.opis,
        p.hasPhoto ? "tak" : "nie",
        p.createdAt,
        p.createdBy,
        p.resolvedAt,
        p.resolvedNote,
      ],
      ";"
    )
  );
  return zbudujCsv([head, ...lines]);
}

