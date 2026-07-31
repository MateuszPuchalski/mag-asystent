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
 *
 * Lista i typ mają JEDNO źródło, bo odczyt flagi z powrotem (`flagKeyFromSgt`)
 * musi po tych kluczach przejść. Dwa źródła znaczyłyby, że piąta flaga dopisana
 * do typu jest wysyłana, ale nigdy nierozpoznawana z powrotem.
 */
export const DOC_FLAG_KEYS = ["in_progress", "paused", "done", "done_with_errors"] as const;
export type DocFlagKey = (typeof DOC_FLAG_KEYS)[number];

/** Nazwa flagi tak, jak brzmi w Subiekcie (do pokazania człowiekowi). */
export function flagLabel(key: DocFlagKey | null): string | null {
  return key ? (config.docFlag[key]?.label ?? key) : null;
}

/** Co faktycznie wpisujemy do bazy Subiekta ('' = nieskonfigurowane). */
export function flagSgtValue(key: DocFlagKey): string {
  return config.docFlag[key]?.sgt ?? "";
}

/**
 * Czy jest DOKĄD wysłać flagę.
 *
 * Wersja edu Subiekta nie ma flag dokumentów w ogóle, a na produkcji para
 * (grupa flag, typ obiektu) bywa jeszcze nieustalona. W obu przypadkach
 * kolejkowanie zadania nic nie daje: worker odbije je trzy razy i zostawi
 * w statusie `error`. Przy dostawie z dwudziestoma pozycjami to seria czerwonych
 * zadań i stale czerwona pastylka Sfery na kolektorze — a w tym szumie ginie
 * realny błąd zapisu lokalizacji, czyli jedyna rzecz, którą trzeba tam zobaczyć.
 *
 * Dlatego brak konfiguracji znaczy „flagi wyłączone", a nie „flagi zepsute".
 * Cisza nie jest myląca, bo stan widać w `/api/health` (pole `docFlag`).
 */
export function docFlagAvailable(): boolean {
  // adapter dev (tryb seeded) pisze do sgt_dokument i działa zawsze
  if (config.sferaMode !== "sql") return true;
  return !!(config.mssql.flagGrupa && config.mssql.flagTypObiektu);
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

/* ── Druga strona flagi: to, co na fakturze postawiło BIURO ───────────────────
   Flaga szła dotąd w jedną stronę. Aplikacja wyprowadzała stan i wpisywała go
   do Subiekta, ale czytała stamtąd wyłącznie po to, żeby wykryć nadpisanie —
   i tylko dla dostaw, które sama wcześniej oznaczyła.

   Skutek widać było na kolektorze: faktura oznaczona w Subiekcie jako
   sprawdzona, ale w aplikacji nigdy nieotwarta, nie miała żadnej pastylki.
   Wyglądała identycznie jak nietknięta i stała na górze listy pracy. Magazynier
   dostawał do rozłożenia dostawę, którą ktoś już rozłożył.

   Dlatego flaga z Subiekta jest teraz PEŁNOPRAWNYM źródłem stanu, a nie tylko
   materiałem do porównania. Pierwszeństwo rozstrzyga `widokFlagi` niżej.      */

/**
 * Etykieta flagi, której nie znamy z konfiguracji.
 *
 * Firma ma w `fl__Flagi` więcej flag niż nasze cztery. Nazwę bierzemy ze
 * słownika zaimportowanego z Subiekta, a gdy go nie ma (brak `GRANT SELECT` na
 * `fl__Flagi`, tryb seeded) — mówimy tylko tyle, ile wiemy na pewno. Zmyślona
 * nazwa byłaby gorsza od pustki, bo magazynier nie miałby jak jej podważyć.
 */
export const OBCA_FLAGA = "Flaga w Subiekcie";

/**
 * Odwrotność `flagWrittenValue`: surowa wartość z Subiekta → klucz stanu.
 *
 * `null` znaczy „to nie jest żadna z naszych czterech flag" — czyli flaga
 * firmowa spoza tego procesu. Taka flaga NIE dostaje koloru stanu, bo nic o niej
 * nie wiemy poza nazwą.
 */
export function flagKeyFromSgt(raw: string | null | undefined): DocFlagKey | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  return DOC_FLAG_KEYS.find((k) => flagWrittenValue(k) === v) ?? null;
}

/** Nazwa flagi ze słownika Subiekta (`fl__Flagi`), o ile go zaimportowano. */
export function nazwaFlagiZeSlownika(raw: string | null): string | null {
  if (raw == null) return null;
  const id = Number(String(raw).trim());
  if (!Number.isInteger(id)) return null;
  const r = db().prepare("SELECT nazwa FROM sgt_flaga WHERE flg_id=?").get(id) as
    | { nazwa: string }
    | undefined;
  return r?.nazwa?.trim() || null;
}

/** Co pokazać człowiekowi przy dokumencie. */
export interface WidokFlagi {
  /** Klucz stanu albo `null` przy fladze spoza tego procesu (i przy braku flagi). */
  key: DocFlagKey | null;
  /** Nazwa do pokazania; `null` = brak flagi, pastylki nie ma. */
  label: string | null;
}

const BRAK: WidokFlagi = { key: null, label: null };

/**
 * Czyja flaga wygrywa na ekranie — czysta reguła, bez bazy i bez zegara.
 *
 * Aplikacja RZĄDZI dokumentem tylko wtedy, gdy sama go prowadzi. Wtedy jej stan
 * jest świeższy niż Subiekt: między policzeniem flagi a zapisem stoi kolejka,
 * więc czekanie na Subiekta cofałoby pastylkę o kilka sekund przy każdym skanie.
 *
 * Poza tym wygrywa Subiekt, i to w dwóch różnych sytuacjach:
 *  • dokumentu nikt tu nie otwierał — jedyne, co o nim wiadomo, jest z Subiekta,
 *  • biuro nadpisało flagę (`officeOverride` porzucił dostawę) — decyzja biura
 *    wygrywa, więc pokazywanie dalej naszego wyliczenia byłoby kłamstwem.
 *
 * @param app        flaga wyprowadzona przez aplikację (`deliveryFlag`)
 * @param sgtRaw     surowa wartość z `sgt_dokument.flaga`
 * @param nazwaObca  nazwa ze słownika Subiekta dla flagi spoza naszych czterech
 * @param appRzadzi  czy aplikacja prowadzi ten dokument
 */
export function widokFlagi(
  app: DocFlagKey | null,
  sgtRaw: string | null,
  nazwaObca: string | null,
  appRzadzi: boolean
): WidokFlagi {
  if (appRzadzi && app != null) return { key: app, label: flagLabel(app) };
  const zSubiekta = flagKeyFromSgt(sgtRaw);
  if (zSubiekta) return { key: zSubiekta, label: flagLabel(zSubiekta) };
  if (sgtRaw != null && String(sgtRaw).trim() !== "") {
    return { key: null, label: nazwaObca ?? OBCA_FLAGA };
  }
  return BRAK;
}

/**
 * Flaga dokumentu gotowa do pokazania — złożenie reguły z odczytami z bazy.
 *
 * @param sgtRaw          `sgt_dokument.flaga` (read-model, import z Subiekta)
 * @param deliveryId      dostawa w aplikacji albo `null`, gdy nikt jej nie otwierał
 * @param deliveryStatus  `open` | `done` | `abandoned`
 */
export function flagaDokumentu(
  sgtRaw: string | null,
  deliveryId: number | null,
  deliveryStatus: string | null
): WidokFlagi {
  const app = deliveryId != null ? deliveryFlag(deliveryId) : null;
  const appRzadzi = deliveryId != null && deliveryStatus !== "abandoned";
  return widokFlagi(app, sgtRaw, nazwaFlagiZeSlownika(sgtRaw), appRzadzi);
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
 * z tym, co aplikacja tam ostatnio wysłała — gdy nic naszego nie jest w drodze,
 * różnica może pochodzić tylko od człowieka przy komputerze.
 *
 * Nie dotyczy dostaw, dla których jeszcze nic nie wysłaliśmy: wtedy jakakolwiek
 * flaga w Subiekcie jest po prostu stanem wyjściowym, nie sporem.
 */
/**
 * Czy NASZ zapis flagi dla tego dokumentu jeszcze nie doszedł do Subiekta.
 *
 * `flaga_wyslana` ustawiamy w chwili kolejkowania, a read-model dogania Subiekta
 * dopiero wtedy, gdy worker zadanie wykona. Między jednym a drugim `sgt_dokument`
 * niesie POPRZEDNIĄ wartość — i wygląda dokładnie jak nadpisanie przez biuro.
 *
 * Bez tego warunku wystarczał zwolniony worker albo faktura z flagą postawioną
 * wcześniej przez biuro, żeby aplikacja porzuciła własną dostawę zaraz po jej
 * otwarciu. Dostawa zostawała w `abandoned`, a flaga nie zmieniała się już nigdy.
 */
function zapisWDrodze(sgtDokId: number): boolean {
  const r = db()
    .prepare(
      `SELECT 1 FROM sfera_queue
       WHERE type='set_doc_flag' AND status IN ('pending','processing','waiting_for_doc')
         AND source_doc_id=? LIMIT 1`
    )
    .get(sgtDokId);
  return r !== undefined;
}

export function officeOverride(d: DeliveryRow): string | null {
  if (d.flaga_wyslana == null) return null;
  if (zapisWDrodze(d.sgt_dok_id)) return null;
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
/**
 * Cofnięcie zapisu „ta flaga poszła", gdy zadanie ostatecznie NIE poszło.
 *
 * `flaga_wyslana` ustawiamy w chwili kolejkowania, bo `syncFlag` musi na czymś
 * oprzeć dedupe — inaczej ten sam stan wchodziłby do kolejki w kółko. Cena
 * jest taka, że zadanie zakończone błędem albo anulowane zostawia pole
 * mówiące nieprawdę, a wtedy `syncFlag` NIGDY już tej flagi nie ponowi
 * (`key === d.flaga_wyslana` ucina wejście) i faktura zostaje nieoznaczona
 * bez śladu.
 *
 * Rekoncyliacja łapie zadania w stanie `error`, ale nie `cancelled` — a to
 * jeden klik na ekranie kolejki. Dlatego czyścimy pole u ŹRÓDŁA: przy każdym
 * terminalnym niepowodzeniu. Następny `syncFlag` policzy stan od nowa.
 */
export function cofnijFlage(sgtDokId: number, powod: string): void {
  const r = db()
    .prepare("UPDATE delivery SET flaga_wyslana=NULL WHERE sgt_dok_id=? AND flaga_wyslana IS NOT NULL")
    .run(sgtDokId);
  if (r.changes > 0) {
    logEvent("delivery_flag_reverted", "system", null, { dokId: sgtDokId, powod });
  }
}

export function syncFlag(deliveryId: number, user: string): number | null {
  // brak miejsca zapisu (edu / nieustalona grupa flag) — nie produkujemy zadań,
  // które i tak skończą się błędem; stan widać w /api/health
  if (!docFlagAvailable()) return null;
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
