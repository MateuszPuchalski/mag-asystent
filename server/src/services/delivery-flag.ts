import { db } from "../db/db.js";
import { config } from "../config.js";
import { freshLock, isFresh } from "./locks.js";
import { enqueueDocFlag } from "./queue.js";
import { logEvent } from "./events.js";

/* ── Flaga sprawdzenia faktury: jedna prawda o stanie dostawy ────────────────
   W tej firmie rozkładanie JEST sprawdzaniem faktury — to jedna czynność, nie
   dwie. Subiekt ma na fakturze flagę, którą czyta biuro; aplikacja ma własny
   postęp per pozycja. Dopóki żyją osobno, magazyn i biuro widzą inny obraz tej
   samej dostawy i nikt nie dostaje sygnału, że się rozjechały.

   Dlatego stan NIE jest przechowywany drugi raz — jest WYPROWADZANY z tego, co
   aplikacja i tak wie, i rzutowany do Subiekta jako flaga. Ta funkcja jest
   jedynym miejscem, w którym ta reguła istnieje.                              */

/**
 * Klucz stanu — stała domeny. NIE jest tym, co ląduje w Subiekcie (tam idzie
 * `config.docFlag[key].sgt`) ani tym, co widzi człowiek (`.label`). Rozdział
 * jest po to, żeby zmiana nazwy albo koloru flagi w Subiekcie nie zrywała ani
 * historii `flaga_wyslana`, ani kolorów na kolektorze.
 */
export type DocFlagKey = "in_progress" | "paused" | "done" | "done_with_errors";

/** Nazwa flagi tak, jak brzmi w Subiekcie (do pokazania człowiekowi). */
export function flagLabel(key: DocFlagKey | null): string | null {
  return key ? (config.docFlag[key]?.label ?? key) : null;
}

/** Co faktycznie wpisujemy do bazy Subiekta ('' = nieskonfigurowane). */
export function flagSgtValue(key: DocFlagKey): string {
  return config.docFlag[key]?.sgt ?? "";
}

/**
 * Wartość, która realnie ląduje w `sgt_dokument.flaga`. Gdy mapowanie na wartość
 * Subiekta nie jest jeszcze skonfigurowane, adapter `dev` zapisuje sam klucz —
 * i porównanie musi to uwzględniać, inaczej wykrywanie nadpisania przez biuro
 * wyłączałoby się po cichu dokładnie wtedy, gdy env jest jeszcze pusty (pilot).
 * Adapter `sql` nigdy nie zapisuje klucza — tam pusta wartość to twardy błąd.
 */
export function flagWrittenValue(key: DocFlagKey): string {
  return flagSgtValue(key) || key;
}

/** Wejście reguły — wyciągnięte z bazy, żeby samą regułę dało się przetestować. */
export interface FlagInputs {
  /** Czy dostawa w ogóle została otwarta w aplikacji. */
  exists: boolean;
  /** `open` | `done` | `abandoned` */
  status: string;
  /** Czy ktoś pracuje TERAZ przy tej dostawie (świeży dotyk albo lock). */
  someoneWorking: boolean;
  /** Czy jest nierozwiązana rozbieżność ILOŚCIOWA (tylko qty_short/qty_over). */
  qtyMismatch: boolean;
}

/**
 * Reguła w czystej postaci: bez bazy, bez zegara, w pełni testowalna.
 * `null` = dostawa nietknięta, aplikacja nie ma nic do powiedzenia o tej fakturze.
 */
export function flagFor(i: FlagInputs): DocFlagKey | null {
  if (!i.exists) return null;
  if (i.status === "open") {
    // rozróżnienie „ktoś przy tym siedzi" od „leży zaczęte" — sygnałem jest
    // ostatni dotyk dostawy (albo świeży lock na pozycji), patrz flagInputs
    return i.someoneWorking ? "in_progress" : "paused";
  }
  // domknięte: o „z błędami" decyduje WYŁĄCZNIE rozbieżność ilościowa
  return i.qtyMismatch ? "done_with_errors" : "done";
}

/** Typy wyjątków, które psują zgodność faktury (a nie są sprawą reklamacyjną). */
const QTY_PROBLEM_TYPES = ["qty_short", "qty_over"];

/** Zebranie wejść reguły dla konkretnej dostawy. */
export function flagInputs(deliveryId: number, now: number = Date.now()): FlagInputs {
  const d = db()
    .prepare("SELECT status, active_at FROM delivery WHERE id=?")
    .get(deliveryId) as { status: string; active_at: string | null } | undefined;
  if (!d) return { exists: false, status: "", someoneWorking: false, qtyMismatch: false };

  // „Pracuje teraz" bierzemy z ostatniego dotyku dostawy ALBO ze świeżego locka
  // na pozycji. Sam lock nie wystarcza: magazynier stoi przy palecie także
  // wtedy, gdy dopiero otworzył dokument i jeszcze nic nie zeskanował.
  const touched = isFresh(d.active_at, now);
  const locks = db()
    .prepare("SELECT locked_by, locked_at FROM delivery_line WHERE delivery_id=? AND locked_by IS NOT NULL")
    .all(deliveryId) as Array<{ locked_by: string | null; locked_at: string | null }>;
  const someoneWorking =
    touched || locks.some((l) => freshLock(l.locked_by, l.locked_at, now) !== null);

  const qty = (
    db()
      .prepare(
        `SELECT COUNT(*) AS n FROM problem
         WHERE delivery_id=? AND resolved_at IS NULL
           AND typ IN (${QTY_PROBLEM_TYPES.map(() => "?").join(",")})`
      )
      .get(deliveryId, ...QTY_PROBLEM_TYPES) as { n: number }
  ).n;

  return { exists: true, status: d.status, someoneWorking, qtyMismatch: qty > 0 };
}

/** Flaga, jaką aplikacja uważa za prawdziwą dla tej dostawy. */
export function deliveryFlag(deliveryId: number, now: number = Date.now()): DocFlagKey | null {
  return flagFor(flagInputs(deliveryId, now));
}

/** Odnotuj dotyk człowieka — podstawa rozróżnienia „w trakcie" od „zaczęte". */
export function touchDelivery(deliveryId: number): void {
  db().prepare("UPDATE delivery SET active_at=? WHERE id=?").run(new Date().toISOString(), deliveryId);
}

/* ── Rzutowanie stanu do Subiekta ────────────────────────────────────────── */

interface DeliveryRow {
  id: number;
  sgt_dok_id: number;
  sgt_dok_numer: string;
  flaga_wyslana: string | null;
}

/**
 * Czy biuro ruszyło flagę poza aplikacją. Porównujemy to, co Subiekt ma TERAZ,
 * z tym, co aplikacja tam ostatnio wysłała — różnica może pochodzić tylko od
 * człowieka przy komputerze.
 *
 * Nie dotyczy dostaw, dla których jeszcze nic nie wysłaliśmy: wtedy jakakolwiek
 * flaga w Subiekcie jest po prostu stanem wyjściowym, nie sporem.
 */
export function officeOverride(d: DeliveryRow): string | null {
  if (d.flaga_wyslana == null) return null;
  const inSgt = (
    db().prepare("SELECT flaga FROM sgt_dokument WHERE dok_id=?").get(d.sgt_dok_id) as
      | { flaga: string | null }
      | undefined
  )?.flaga;
  if (inSgt == null) return null;
  // w SGT leży SUROWA wartość (dla flag wbudowanych: id koloru), więc
  // porównujemy z tym, co sami tam wysłaliśmy — nie z kluczem domeny
  const wyslana = flagWrittenValue(d.flaga_wyslana as DocFlagKey);
  return String(inSgt) !== wyslana ? String(inSgt) : null;
}

/**
 * Przelicz flagę dostawy i — jeśli się zmieniła — zakolejkuj zapis do Subiekta.
 *
 * Wołane po każdej zmianie stanu, więc **dedupe jest obowiązkowy**: bez niego
 * dwudziestoliniowa dostawa wygenerowałaby dwadzieścia identycznych zadań
 * „W trakcie sprawdzania" i zapchała kolejkę pracą bez treści.
 *
 * Zwraca id zadania albo `null`, gdy nic nie trzeba było wysyłać.
 */
export function syncFlag(deliveryId: number, user: string): number | null {
  const d = db()
    .prepare("SELECT id, sgt_dok_id, sgt_dok_numer, flaga_wyslana FROM delivery WHERE id=?")
    .get(deliveryId) as DeliveryRow | undefined;
  if (!d) return null;

  // decyzja biura wygrywa: aplikacja przestaje nadpisywać tę fakturę
  const override = officeOverride(d);
  if (override != null) {
    db().prepare("UPDATE delivery SET status='abandoned' WHERE id=? AND status='open'").run(deliveryId);
    logEvent("delivery_flag_overridden", user, null, {
      deliveryId,
      dokId: d.sgt_dok_id,
      wSubiekcie: override,
      wyslanaPrzezNas: d.flaga_wyslana,
    });
    return null;
  }

  const key = deliveryFlag(deliveryId);
  // w `flaga_wyslana` trzymamy KLUCZ, nie etykietę: przemianowanie flagi
  // w Subiekcie nie może wyglądać jak zmiana stanu dostawy
  if (key == null || key === d.flaga_wyslana) return null;

  const queueId = enqueueDocFlag(d.sgt_dok_id, key, flagSgtValue(key), {
    createdBy: user,
    twId: null,
    sourceDocId: d.sgt_dok_id,
    label: `Flaga · ${d.sgt_dok_numer}`,
    detail: flagLabel(key) ?? key,
  });
  db().prepare("UPDATE delivery SET flaga_wyslana=? WHERE id=?").run(key, deliveryId);
  logEvent("delivery_flag_set", user, null, { deliveryId, dokId: d.sgt_dok_id, flaga: key, queueId });
  return queueId;
}
