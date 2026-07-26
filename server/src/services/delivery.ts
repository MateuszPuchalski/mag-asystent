import { db } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { enqueueMM, enqueueSetLocation } from "./queue.js";
import { logEvent } from "./events.js";
import { validateLocationCode } from "./locations.js";
import { parseLocs, pickingLoc } from "../locs.js";
import { matchesLocPattern } from "../scan.js";
import { recordEanConflict } from "./ean.js";
import { lockedByOther } from "./locks.js";
import { deliveryFlag, flagLabel, syncFlag, touchDelivery } from "./delivery-flag.js";
import type { MmItem } from "../adapters/sfera.js";
import type {
  DeliveryDocument,
  DeliveryLineView,
  DeliveryView,
  KoszykView,
  ScanResolution,
} from "../types.js";

/* ── Tryb A: rozkładanie dostaw krajowych i zwrotów (redesign v2.0) ──────────
   Jednostką pracy jest DOKUMENT (D2), nie sesja.

   Dostawa krajowa: skutek magazynowy niesie sam dokument w Subiekcie
   (księgowany wprost na MAG), więc zapisujemy WYŁĄCZNIE lokalizację (D1) —
   zero MM, zero waiting_for_doc, zero zależności od bufora; dostawę można
   rozkładać, zanim księgowość zaksięguje FZ.

   Zwrot: biuro wystawia JEDEN zbiorczy dokument na magazyn Zwroty, a towar
   fizycznie leży w koszykach opisanych numerem zwrotu. Koszyk nie istnieje
   nigdzie w Subiekcie — dla aplikacji jest to po prostu grupa linii domkniętych
   za jednym podejściem, otagowana numerem. Po rozłożeniu całego koszyka
   powstaje JEDEN dokument MM Zwroty→MAG (patrz `closeBasket`).                */

const nowIso = () => new Date().toISOString();

/** Statusy linii, które nie wracają już do rutyny alejkowej. */
const TERMINAL_LINE: ReadonlySet<string> = new Set(["done", "skipped", "problem"]);

/**
 * Walidacja kodu lokalizacji w trybie A — twarda (§9, §16). Poza bazowymi
 * regułami (pusty / spacja / EAN) kod MUSI pasować do jednego ze wzorców:
 * regał `A01-02-03` albo miejsce paletowe `PAL-042`. Literówka w kartotece
 * („paletq29", „lA03-04-01") nigdy nie dopasuje się do skanu — ma być błędem
 * przy odkładaniu, a nie cichym zapisem fikcyjnego adresu.
 *
 * Wzorzec jest ten sam co w `validateLocationCode` (plan §3, jedno źródło);
 * różni się WYMUSZENIE: tu bezwarunkowe, tam sterowane `LOC_STRICT`, bo skan
 * lokalizacji jest w trybie A jedynym dowodem odłożenia (D3).
 */
export function validateDeliveryLocation(code: string): string | null {
  const base = validateLocationCode(code);
  if (base) return base;
  if (matchesLocPattern(code)) return null;
  return `Kod „${code}" nie jest poprawnym adresem (regał A01-02-03 albo paleta PAL-042)`;
}

/** Czy dokument o tym magazynie skutku wymaga MM strefa→MAG (zwrot). */
function requiresMm(magId: number | null | undefined): boolean {
  return magId != null && magId !== config.magId.MAG;
}

/** Lista dostaw FZ/PZ i zwrotów (N dni) z postępem liczonym z delivery_line. */
export function listDocuments(days = 14): DeliveryDocument[] {
  const docs = subiekt.listDeliveryDocuments(days);
  const progress = db()
    .prepare(
      `SELECT d.id AS deliveryId,
              d.sgt_dok_id AS dokId,
              COUNT(l.id) AS total,
              SUM(CASE WHEN l.status IN ('done','skipped','problem') THEN 1 ELSE 0 END) AS done,
              d.status AS status
       FROM delivery d LEFT JOIN delivery_line l ON l.delivery_id = d.id
       GROUP BY d.id`
    )
    .all() as Array<{ deliveryId: number; dokId: number; total: number; done: number; status: string }>;
  const byDoc = new Map(progress.map((p) => [p.dokId, p]));

  // Przejście „W trakcie sprawdzania" → „Do sprawdzenia z zapisanym postępem"
  // nie ma własnego zdarzenia — dzieje się przez UPŁYW CZASU (wygasa lock).
  // Doganiamy je tutaj, przy odczycie listy, zamiast trzymać osobny scheduler
  // dla jednej przemiany. Dedupe w syncFlag pilnuje, żeby nie generować pracy.
  for (const p of progress) {
    if (p.status === "open") syncFlag(p.deliveryId, "system");
  }

  return docs.map((d) => {
    const p = byDoc.get(d.dok_id);
    const positions = subiekt.getDocumentPositions(d.dok_id).length;
    return {
      dokId: d.dok_id,
      typ: d.typ,
      nrPelny: d.nr_pelny,
      dataWyst: d.data_wyst,
      dostawca: d.dostawca ?? "",
      positions,
      /** dokument w buforze jest normalnie dostępny do pracy (D1) */
      wBuforze: !!d.w_buforze,
      linesTotal: p?.total ?? 0,
      linesDone: p?.done ?? 0,
      status: p?.status ?? null,
      /** stan sprawdzenia faktury — to samo, co widzi biuro w Subiekcie */
      flaga: p ? flagLabel(deliveryFlag(p.deliveryId)) : null,
      flagaKey: p ? deliveryFlag(p.deliveryId) : null,
      /** zwrot rozkłada się koszykami i kończy MM-em; dostawa krajowa nie */
      zwrot: requiresMm(d.mag_id),
    };
  });
}

/**
 * Otwórz (lub wznów) rozkładanie dokumentu. Pozycje są snapshotowane w chwili
 * otwarcia — jeśli księgowość zmieni FZ w trakcie, praca się nie rozjeżdża.
 */
export function openDelivery(dokId: number, user: string): number {
  const existing = db()
    .prepare("SELECT id FROM delivery WHERE sgt_dok_id = ?")
    .get(dokId) as { id: number } | undefined;
  if (existing) return existing.id;

  const doc = subiekt.getDocument(dokId);
  if (!doc) throw new Error("Nie znaleziono dokumentu");

  // Magazyn skutku jest SNAPSHOTOWANY razem z pozycjami: decyduje o tym, czy
  // po rozłożeniu potrzebny jest MM. Gdyby czytać go na bieżąco z read-modelu,
  // przeksięgowanie dokumentu w połowie pracy zmieniałoby reguły w jej trakcie.
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, source_mag_id, status, opened_at)
         VALUES (?,?,?,?,?, 'open', ?)`
      )
      .run(doc.dok_id, doc.nr_pelny, doc.dostawca ?? "", doc.data_wyst, doc.mag_id, nowIso())
      .lastInsertRowid
  );

  // agregacja tego samego towaru (różne partie/ceny → jedna linia robocza)
  const agg = new Map<number, number>();
  for (const p of subiekt.getDocumentPositions(dokId)) {
    agg.set(p.tw_id, (agg.get(p.tw_id) ?? 0) + p.ilosc);
  }
  const ins = db().prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, lok_oczekiwana)
     VALUES (?,?,?,?,?,?)`
  );
  db().transaction(() => {
    for (const [twId, qty] of agg) {
      const t = subiekt.getProductById(twId);
      ins.run(id, twId, t?.symbol ?? String(twId), t?.nazwa ?? "", qty, pickingLoc(t?.lokalizacja));
    }
  })();

  logEvent("delivery_open", user, null, { deliveryId: id, dokId });
  // otwarcie dokumentu to już początek sprawdzania — magazynier stoi przy palecie
  touchDelivery(id);
  syncFlag(id, user);
  return id;
}

/**
 * Widok dostawy. Linie sortowane po lokalizacji docelowej (magazynier chodzi
 * alejkami, nie w kolejności z faktury), pozycje BEZ lokalizacji na końcu —
 * to są SKU wymagające decyzji, nie rutyny.
 */
export function getDelivery(id: number): DeliveryView | undefined {
  const d = db().prepare("SELECT * FROM delivery WHERE id = ?").get(id) as
    | {
        id: number;
        sgt_dok_id: number;
        sgt_dok_numer: string;
        dostawca: string | null;
        data_dok: string | null;
        source_mag_id: number | null;
        status: string;
      }
    | undefined;
  if (!d) return undefined;

  const rows = db()
    .prepare("SELECT * FROM delivery_line WHERE delivery_id = ?")
    .all(id) as Array<any>;

  const lines: DeliveryLineView[] = rows
    .map((r) => ({
      id: r.id,
      twId: r.tw_id,
      sym: r.tw_symbol,
      name: r.tw_nazwa,
      qtyDoc: r.ilosc_dok,
      qtyDone: r.ilosc_odlozona,
      locExpected: r.lok_oczekiwana,
      locActual: r.lok_faktyczna,
      status: r.status,
      /** litera alejki — nagłówek sekcji na liście */
      aisle: r.lok_oczekiwana ? String(r.lok_oczekiwana)[0] : null,
      koszyk: r.koszyk ?? null,
    }))
    // faza 1: sort alfabetyczny po kodzie (A→J odpowiada układowi alejek);
    // zamiana na trasę = zmiana tego komparatora (§5)
    .sort((a, b) => {
      if (!a.locExpected && !b.locExpected) return a.sym.localeCompare(b.sym);
      if (!a.locExpected) return 1;
      if (!b.locExpected) return -1;
      return a.locExpected.localeCompare(b.locExpected) || a.sym.localeCompare(b.sym);
    });

  // linia z problemem wychodzi z rutyny alejkowej (żyje dalej na liście wyjątków),
  // więc nie trzyma dostawy otwartej — inaczej zgłoszenie problemu karałoby
  // zgłaszającego i nikt by go nie zgłaszał (D8)
  const done = lines.filter((l) => TERMINAL_LINE.has(l.status)).length;
  const problems = lines.filter((l) => l.status === "problem").length;
  const zwrot = requiresMm(d.source_mag_id);
  return {
    id: d.id,
    dokId: d.sgt_dok_id,
    nrPelny: d.sgt_dok_numer,
    dostawca: d.dostawca ?? "",
    dataWyst: d.data_dok ?? "",
    status: d.status,
    flaga: flagLabel(deliveryFlag(d.id)),
    flagaKey: deliveryFlag(d.id),
    progress: { total: lines.length, done, remaining: lines.length - done, problems },
    zwrot,
    koszyki: zwrot ? openBaskets(id) : [],
    lines,
  };
}

/**
 * Koszyki rozłożone, ale jeszcze nieprzesunięte na MAG.
 *
 * To jedyny sygnał, że praca została wykonana tylko w połowie: towar leży już
 * na półce, ale w Subiekcie wisi dalej na magazynie Zwroty, czyli jest
 * NIESPRZEDAWALNY. Bez tej listy zapomniany koszyk nie dawałby żadnego objawu —
 * a właśnie tak wygląda najkosztowniejszy błąd w tym procesie.
 */
export function openBaskets(deliveryId: number): KoszykView[] {
  return db()
    .prepare(
      `SELECT koszyk AS numer, COUNT(*) AS lines, SUM(ilosc_odlozona - mm_ilosc) AS qty
       FROM delivery_line
       WHERE delivery_id = ? AND koszyk IS NOT NULL AND ilosc_odlozona > mm_ilosc
       GROUP BY koszyk
       ORDER BY koszyk`
    )
    .all(deliveryId) as KoszykView[];
}

/**
 * Skan towaru w kontekście dostawy → rozstrzygnięcie na linię.
 *
 * Niejednoznaczny EAN ZATRZYMUJE operację (D7): kod wskazujący >1 kartotekę
 * nigdy nie wybiera „pierwszego dopasowania". Jedyne automatyczne zawężenie:
 * gdy dokładnie jeden kandydat występuje w otwartym dokumencie.
 */
export function resolveScan(deliveryId: number, rawCode: string, user: string): ScanResolution {
  const code = rawCode.trim();
  const lines = db()
    .prepare("SELECT * FROM delivery_line WHERE delivery_id = ?")
    .all(deliveryId) as Array<any>;
  const lineByTw = new Map<number, any>(lines.map((l) => [l.tw_id, l]));

  // kandydaci: po EAN (może być wiele!) albo po symbolu
  let candidates = subiekt.findProductsByEan(code);
  if (candidates.length === 0) {
    const bySym = subiekt.getProductBySymbol(code);
    if (bySym) candidates = [bySym];
  }
  if (candidates.length === 0) return { kind: "unknown", code };

  if (candidates.length > 1) {
    const inDoc = candidates.filter((c) => lineByTw.has(c.tw_id));
    if (inDoc.length === 1) {
      // zawężenie kontekstem dokumentu — kolizja zostaje w logu jako dług w kartotece
      logEvent("ean_conflict_autoresolved", user, inDoc[0].tw_id, {
        ean: code,
        candidates: candidates.map((c) => c.tw_id),
      });
      recordEanConflict(code, candidates.map((c) => c.tw_id), inDoc[0].tw_id, true);
      return toResolution(inDoc[0], lineByTw.get(inDoc[0].tw_id));
    }
    logEvent("ean_conflict", user, null, {
      ean: code,
      candidates: candidates.map((c) => c.tw_id),
    });
    recordEanConflict(code, candidates.map((c) => c.tw_id), null, false);
    return {
      kind: "conflict",
      code,
      candidates: candidates.map((c) => {
        const l = lineByTw.get(c.tw_id);
        return {
          twId: c.tw_id,
          sym: c.symbol,
          name: c.nazwa,
          inDocument: !!l,
          qtyDoc: l?.ilosc_dok ?? null,
          locExpected: l ? l.lok_oczekiwana : pickingLoc(c.lokalizacja),
        };
      }),
    };
  }

  const p = candidates[0];
  const line = lineByTw.get(p.tw_id);
  if (!line) {
    return { kind: "off_document", code, twId: p.tw_id, sym: p.symbol, name: p.nazwa };
  }
  // Przy natłoku dostawę robi kilka osób. Nie odbieramy linii koledze po cichu:
  // druga osoba dowiaduje się, kto ją trzyma, i idzie dalej po alejce.
  const holder = lockedByOther(line.locked_by, line.locked_at, user);
  if (holder) return { kind: "locked", code, lockedBy: holder, sym: p.symbol, name: p.nazwa };

  claimLine(line.id, user);
  touchDelivery(deliveryId);
  syncFlag(deliveryId, user);
  return toResolution(p, line);
}

/** Zajęcie linii na czas odkładania (TTL — patrz services/locks.ts). */
export function claimLine(lineId: number, user: string): void {
  db()
    .prepare("UPDATE delivery_line SET locked_by=?, locked_at=? WHERE id=?")
    .run(user, nowIso(), lineId);
}

/** Zwolnienie linii (anulowanie karty odkładania albo zakończenie operacji). */
export function releaseLine(lineId: number, user: string): { ok: true } {
  db()
    .prepare("UPDATE delivery_line SET locked_by=NULL, locked_at=NULL WHERE id=? AND locked_by=?")
    .run(lineId, user);
  return { ok: true };
}

function toResolution(p: { tw_id: number; symbol: string; nazwa: string }, line: any): ScanResolution {
  return {
    kind: "line",
    line: {
      id: line.id,
      twId: line.tw_id,
      sym: p.symbol,
      name: p.nazwa,
      qtyDoc: line.ilosc_dok,
      qtyDone: line.ilosc_odlozona,
      locExpected: line.lok_oczekiwana,
      locActual: line.lok_faktyczna,
      status: line.status,
      aisle: line.lok_oczekiwana ? String(line.lok_oczekiwana)[0] : null,
      koszyk: line.koszyk ?? null,
    },
  };
}

export interface PutawayLineOpts {
  /** Ile sztuk odłożono; brak = cała reszta z dokumentu. */
  qty?: number;
  /**
   * Co zrobić z dotychczasowymi lokalizacjami, gdy magazynier odłożył gdzie
   * indziej (§4.3): 'replace' = towar przeniesiony, 'add' = druga lokalizacja.
   * Domyślnie 'replace' — zgodność ze ścieżką bez rozjazdu.
   */
  locAction?: "add" | "replace";
  /** Zwroty: numer koszyka, z którego wzięto towar (obowiązkowy dla zwrotu). */
  koszyk?: string;
}

/**
 * Odłożenie linii: skan lokalizacji jest OBOWIĄZKOWY (D3) — to jedyny dowód,
 * że towar trafił tam, gdzie system myśli. Zapis lokalizacji idzie do kolejki
 * jako `set_location`; ŻADNEGO dokumentu MM (D1).
 *
 * Przy zwrocie MM też tu nie powstaje — dopiero przy zamknięciu koszyka
 * (`closeBasket`). Dzięki temu niezmiennik „ADRES ZAWSZE PRZED
 * SPRZEDAWALNOŚCIĄ" trzyma się sam: `set_location` każdej pozycji jest
 * zakolejkowany wcześniej niż MM, a worker bierze zadania po `id` rosnąco.
 */
export function putawayLine(
  lineId: number,
  location: string,
  user: string,
  opts: PutawayLineOpts = {}
): { ok: true; queueId?: number; mismatch: boolean; status: string } | { error: string; status?: number } {
  const line = db().prepare("SELECT * FROM delivery_line WHERE id = ?").get(lineId) as any;
  if (!line) return { error: "Brak pozycji" };
  const locAction = opts.locAction ?? "replace";

  const code = location.trim().toUpperCase();
  const locErr = validateDeliveryLocation(code);
  if (locErr) return { error: locErr };

  // Zwrot bez numeru koszyka byłby sierotą: adres na półce zapisany, ale nic
  // nie powie, którym MM-em towar ma zjechać z magazynu Zwroty — i zostałby
  // tam niesprzedawalny, bez żadnego objawu. Dlatego twardy błąd, nie domysł.
  const koszyk = (opts.koszyk ?? "").trim();
  const zwrot = requiresMm(deliveryMagId(line.delivery_id));
  if (zwrot && !koszyk) return { error: "Podaj numer koszyka" };

  const putQty = opts.qty ?? Math.max(line.ilosc_dok - line.ilosc_odlozona, 0);
  if (!Number.isFinite(putQty) || putQty <= 0) return { error: "Ilość musi być większa od zera" };

  const doneQty = line.ilosc_odlozona + putQty;
  const status = doneQty >= line.ilosc_dok ? "done" : "partial";
  const mismatch = !!line.lok_oczekiwana && line.lok_oczekiwana !== code;

  // zapis lokalizacji do SGT — tylko gdy faktycznie się zmienia
  const t = subiekt.getProductById(line.tw_id);
  const current = parseLocs(t?.lokalizacja);
  let queueId: number | undefined;
  if (current[0] !== code) {
    const newLocs =
      locAction === "add"
        ? Array.from(new Set([code, ...current]))
        : // 'replace' — towar przeniesiony: nowa lokalizacja zastępuje pickingową
          Array.from(new Set([code, ...current.slice(1)]));
    queueId = enqueueSetLocation(line.tw_id, newLocs.join(" ").slice(0, config.locFieldLimit), {
      createdBy: user,
      twId: line.tw_id,
      label: "Lokalizacja · " + (t?.symbol ?? line.tw_id),
      detail: `${code} (dostawa)`,
    });
  }

  // skan półki jest zarazem potwierdzeniem POLICZONEJ ilości: w tej firmie
  // rozkładanie JEST sprawdzaniem faktury i liczy się każdą pozycję. Rozbieżność
  // zgłasza się osobno („INNA ILOŚĆ" → wyjątek ilościowy), więc dojście tutaj
  // znaczy „policzyłem, zgadza się".
  db()
    .prepare(
      `UPDATE delivery_line
       SET ilosc_odlozona=?, lok_faktyczna=?, status=?, done_at=?, done_by=?,
           koszyk=COALESCE(?, koszyk), locked_by=NULL, locked_at=NULL
       WHERE id=?`
    )
    .run(doneQty, code, status, nowIso(), user, koszyk || null, lineId);

  logEvent("putaway_line_done", user, line.tw_id, {
    lineId,
    qty: putQty,
    location: code,
    expected: line.lok_oczekiwana,
    status,
    koszyk: koszyk || null,
  });
  if (mismatch) {
    // częstotliwość per lokalizacja = raport o przepełnionych gniazdach
    logEvent("location_mismatch", user, line.tw_id, {
      lineId,
      expected: line.lok_oczekiwana,
      actual: code,
    });
  }

  closeIfComplete(line.delivery_id, user);
  touchDelivery(line.delivery_id);
  syncFlag(line.delivery_id, user);
  return { ok: true, queueId, mismatch, status };
}

/** Magazyn skutku dostawy (snapshot z chwili otwarcia). */
function deliveryMagId(deliveryId: number): number | null {
  const d = db()
    .prepare("SELECT source_mag_id FROM delivery WHERE id=?")
    .get(deliveryId) as { source_mag_id: number | null } | undefined;
  return d?.source_mag_id ?? null;
}

/**
 * Ile sztuk tej dostawy jest już na półkach, ale wciąż na magazynie źródłowym.
 *
 * Liczy się WYŁĄCZNIE tam, gdzie MM w ogóle występuje. Przy dostawie krajowej
 * `mm_ilosc` zostaje zerem na zawsze (skutek niesie sam dokument w Subiekcie),
 * więc licznik „odłożone − objęte MM" pokazywałby całą dostawę jako zaległość
 * i żadna krajówka nigdy by się nie domknęła.
 */
function pendingMmQty(deliveryId: number): number {
  if (!requiresMm(deliveryMagId(deliveryId))) return 0;
  return (
    (
      db()
        .prepare(
          "SELECT SUM(ilosc_odlozona - mm_ilosc) AS q FROM delivery_line WHERE delivery_id=? AND ilosc_odlozona > mm_ilosc"
        )
        .get(deliveryId) as { q: number | null }
    ).q ?? 0
  );
}

/**
 * Dostawa zamyka się sama, gdy nie ma już czego rozkładać.
 *
 * Przy zwrocie „nie ma czego rozkładać" to za mało: dopóki ostatni koszyk nie
 * pojechał MM-em, towar leży na półce, ale w Subiekcie wisi na magazynie
 * Zwroty — czyli jest niesprzedawalny. Domknięcie dostawy przestawiłoby flagę
 * na „Sprawdzone" i biuro zobaczyłoby robotę skończoną, choć połowa skutku
 * jeszcze nie istnieje.
 */
export function closeIfComplete(deliveryId: number, user: string): void {
  const left = (
    db()
      .prepare(
        "SELECT COUNT(*) AS n FROM delivery_line WHERE delivery_id=? AND status NOT IN ('done','skipped','problem')"
      )
      .get(deliveryId) as { n: number }
  ).n;
  if (left > 0) return;
  if (pendingMmQty(deliveryId) > 0) return;
  db()
    .prepare("UPDATE delivery SET status='done', closed_at=? WHERE id=? AND status='open'")
    .run(nowIso(), deliveryId);
  logEvent("delivery_done", user, null, { deliveryId });
}

/**
 * Zamknięcie koszyka zwrotu: jeden dokument MM Zwroty→MAG na wszystko, co z
 * tego koszyka trafiło na półki i jeszcze nie pojechało.
 *
 * Rozliczamy ILOŚCIAMI (`ilosc_odlozona − mm_ilosc`), nie statusem linii, bo:
 *  • ten sam towar bywa w dwóch koszykach (dokument zbiorczy agreguje go w jedną
 *    linię), więc „linia objęta MM" gubiłoby resztę,
 *  • ponowne zamknięcie tego samego koszyka daje wtedy zero do przeniesienia —
 *    dedupe wychodzi z arytmetyki, nie z osobnej flagi,
 *  • linia zgłoszona jako uszkodzona wciąż mogła mieć część odłożoną na półkę:
 *    te sztuki MUSZĄ pojechać, a te, których nie odłożono, zostają na Zwrotach.
 */
export function closeBasket(
  deliveryId: number,
  numer: string,
  user: string
): { ok: true; queueId: number; lines: number; qty: number } | { error: string; status?: number } {
  const koszyk = numer.trim();
  if (!koszyk) return { error: "Podaj numer koszyka" };
  const srcMag = deliveryMagId(deliveryId);
  if (srcMag == null) return { error: "Brak dostawy", status: 404 };
  if (!requiresMm(srcMag)) return { error: "Ta dostawa nie wymaga przesunięcia magazynowego" };

  const rows = db()
    .prepare(
      `SELECT id, tw_id, tw_symbol, ilosc_odlozona, mm_ilosc
       FROM delivery_line
       WHERE delivery_id=? AND koszyk=? AND ilosc_odlozona > mm_ilosc`
    )
    .all(deliveryId, koszyk) as Array<{
    id: number;
    tw_id: number;
    tw_symbol: string;
    ilosc_odlozona: number;
    mm_ilosc: number;
  }>;
  if (!rows.length) return { error: `Koszyk ${koszyk}: nie ma czego przenosić` };

  // agregacja per towar — jeden wiersz MM na kartotekę, nie na linię
  const perTw = new Map<number, number>();
  for (const r of rows) {
    const delta = r.ilosc_odlozona - r.mm_ilosc;
    perTw.set(r.tw_id, (perTw.get(r.tw_id) ?? 0) + delta);
  }
  const items: MmItem[] = [...perTw].map(([twId, qty]) => ({ twId, qty }));
  const qty = items.reduce((s, i) => s + i.qty, 0);

  let queueId = 0;
  db().transaction(() => {
    queueId = enqueueMM(srcMag, config.magId.MAG, items, {
      createdBy: user,
      twId: null,
      sourceDocId: (db().prepare("SELECT sgt_dok_id FROM delivery WHERE id=?").get(deliveryId) as {
        sgt_dok_id: number;
      }).sgt_dok_id,
      label: `MM koszyk ${koszyk} · ${items.length} poz.`,
      detail: `${qty} szt ZWROTY→MAG (zwrot)`,
    });
    const upd = db().prepare("UPDATE delivery_line SET mm_ilosc=ilosc_odlozona, mm_queue_id=? WHERE id=?");
    for (const r of rows) upd.run(queueId, r.id);
  })();

  logEvent("koszyk_zamkniety", user, null, { deliveryId, koszyk, queueId, items: items.length, qty });
  touchDelivery(deliveryId);
  // ostatni koszyk mógł być tym, który trzymał dostawę otwartą
  closeIfComplete(deliveryId, user);
  syncFlag(deliveryId, user);
  return { ok: true, queueId, lines: rows.length, qty };
}
