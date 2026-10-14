import { urlZwrotowPlatnosci, zapytajAllegro } from "../adapters/allegro.http.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import type { Db } from "../db/db.js";

/* ── Zwroty płatności: pieniądze, które naprawdę wyszły ──────────────────────
   Zwrot klienta (`/order/customer-returns`) mówi o TOWARZE. Jego `status`
   jest punktem na osi, która biegnie dalej na statusy prowizyjne, a pole
   `refund` niesie tylko konto bankowe. Z niego nie da się odczytać, czy
   pieniądze wyszły ani za co.

   `GET /payments/refunds` jest właściwym źródłem: każdy rekord to jeden
   zwrot płatności (`RefundDetails`) z kwotą, statusem i rozbiciem na pozycje
   (`lineItems`), dostawę i kaucję — czyli to, co biuro widzi w Sales Center.
   Rekord nie wygasa i nie zależy od tego, czy ktoś zapytał w dobrej minucie.

   JEDNO ŻĄDANIE NA PRZEBIEG, nie jedno na płatność. Lista konta od ostatnio
   widzianego zwrotu (z zakładką na spóźnione rekordy) jest tańsza niż pytanie
   o każdą płatność, a lustro w bazie pozwala odpowiedzieć o dowolny zwrot bez
   żadnego żądania.

   ZWROT W TOKU SPRAWDZAMY PO `id`. Schemat nie mówi, czy zmiana statusu
   przesuwa datę rekordu, więc samo okno czasowe mogło nigdy nie zobaczyć
   przejścia z `IN_PROGRESS` na `SUCCESS`.

   `[WERYFIKUJ]` na żywym koncie: czy lista obejmuje zwroty zrobione ręką
   w Sales Center i automatyczny zwrot Allegro po terminie. Schemat tego nie
   rozstrzyga. Do czasu rozstrzygnięcia stara droga (`allegro-wyplaty.ts`)
   zostaje obok, a ten moduł tylko zatrzaskuje to, co zobaczył.            */

/** Statusy, w których zwrot płatności może się jeszcze zmienić. */
export const STATUSY_W_TOKU = ["NEW", "VALIDATED", "IN_PROGRESS"] as const;

/** Ile dni wstecz sięgamy przy pierwszym przebiegu na pustym lustrze. */
const START_DNI = 90;
/** Zakładka na rekordy, które pojawiły się z opóźnieniem względem `createdAt`. */
const ZAKLADKA_DNI = 3;
/** Bezpiecznik na liczbę stron listy w jednym przebiegu (stu rekordów każda). */
const MAKS_STRON = 5;
/** Ile zwrotów w toku odpytujemy po `id` w jednym przebiegu. */
const W_TOKU_NA_PRZEBIEG = 20;

export interface PozycjaZwrotuPlatnosci {
  /** Identyfikator pozycji zamówienia (`lineItems[].id`). */
  id: string;
  type: "QUANTITY" | "AMOUNT";
  quantity: number | null;
  kwotaGrosze: number | null;
  /**
   * Nazwa z pozycji zamówienia o tym `id`. Dokładamy ją przy odczycie, nie
   * przy zapisie lustra: zamówienie bywa dociągnięte później niż zwrot
   * płatności, a nazwa nie ma prawa utknąć w bazie jako pusta.
   */
  nazwa?: string | null;
}

export interface ZwrotPlatnosci {
  refundId: string;
  paymentId: string | null;
  orderId: string | null;
  status: string;
  reason: string | null;
  utworzonoAt: string;
  kwotaGrosze: number | null;
  waluta: string | null;
  dostawaGrosze: number | null;
  pozycje: PozycjaZwrotuPlatnosci[];
}

/**
 * Kwota Allegro (tekst) na grosze, albo `null` gdy kształt jest obcy.
 *
 * Liczymy na tekście, nie przez `number`, bo Allegro oddaje kwotę stringiem
 * właśnie po to, żeby uniknąć błędu zaokrągleń. Obcy kształt nie wywraca
 * lustra: brak kwoty jest lepszy niż zmyślona.
 */
export function groszeZKwoty(amount: unknown): number | null {
  if (typeof amount !== "string") return null;
  const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(amount.trim());
  if (!m) return null;
  const grosze = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] === "-" ? -grosze : grosze;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" ? v as Obj : null);
const tekst = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const kwota = (v: unknown) => groszeZKwoty(obj(v)?.amount);

/**
 * Rekord `RefundDetails` ze schematu na nasz kształt. `null`, gdy brakuje
 * któregoś z pól wymaganych, na których stoi klucz lustra: `id`, `status`
 * i `createdAt`. Reszta jest opcjonalna i brak jej niczego nie psuje.
 */
export function zwrotZOdpowiedzi(raw: unknown): ZwrotPlatnosci | null {
  const r = obj(raw);
  const refundId = tekst(r?.id);
  const status = tekst(r?.status);
  const utworzonoAt = tekst(r?.createdAt);
  if (!r || !refundId || !status || !utworzonoAt) return null;

  const pozycje: PozycjaZwrotuPlatnosci[] = [];
  for (const p of Array.isArray(r.lineItems) ? r.lineItems : []) {
    const l = obj(p);
    const id = tekst(l?.id);
    if (!l || !id) continue;
    const ilosc = typeof l.quantity === "number" ? l.quantity : null;
    pozycje.push(l.type === "AMOUNT"
      ? { id, type: "AMOUNT", quantity: null, kwotaGrosze: kwota(l.value) }
      : { id, type: "QUANTITY", quantity: ilosc, kwotaGrosze: null });
  }
  return {
    refundId, status, utworzonoAt, pozycje,
    paymentId: tekst(obj(r.payment)?.id),
    /* `order` nie jest wymagane w schemacie — bez niego łączymy po płatności. */
    orderId: tekst(obj(r.order)?.id),
    reason: tekst(r.reason),
    kwotaGrosze: kwota(r.totalValue),
    waluta: tekst(obj(r.totalValue)?.currency),
    dostawaGrosze: kwota(obj(r.delivery)?.value),
  };
}

/** Zapis do lustra. Ten sam `refund_id` nadpisuje stan, więc zmiana statusu dochodzi. */
export function zapiszZwrotyPlatnosci(
  database: Db, konto: number, zwroty: readonly ZwrotPlatnosci[], teraz = new Date(),
): number {
  const zapis = database.prepare(`INSERT INTO zwrot_platnosci
      (channel_account_id, refund_id, payment_id, order_id, status, reason, utworzono_at,
       kwota_grosze, waluta, dostawa_grosze, pozycje_json, sprawdzono_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, refund_id) DO UPDATE SET
      payment_id=excluded.payment_id,
      order_id=COALESCE(excluded.order_id, zwrot_platnosci.order_id),
      status=excluded.status, reason=excluded.reason,
      utworzono_at=excluded.utworzono_at, kwota_grosze=excluded.kwota_grosze,
      waluta=excluded.waluta, dostawa_grosze=excluded.dostawa_grosze,
      pozycje_json=excluded.pozycje_json, sprawdzono_at=excluded.sprawdzono_at`);
  /* Rekord bez `order` (pole nie jest wymagane w schemacie) łączymy z zamówieniem
     po płatności już przy zapisie, żeby zatrzask i ekran widziały to samo. */
  const poPlatnosci = database.prepare(`SELECT external_id FROM zamowienie_klienta
      WHERE channel_account_id = ? AND platnosc_id = ?`);
  const kiedy = teraz.toISOString();
  for (const z of zwroty) {
    const zamowienie = z.orderId
      ?? (z.paymentId
        ? (poPlatnosci.get(konto, z.paymentId) as { external_id: string } | undefined)?.external_id
        : undefined) ?? null;
    zapis.run(konto, z.refundId, z.paymentId, zamowienie, z.status, z.reason, z.utworzonoAt,
      z.kwotaGrosze, z.waluta, z.dostawaGrosze, JSON.stringify(z.pozycje), kiedy);
  }
  return zwroty.length;
}

/**
 * Zwroty płatności jednego zwrotu klienta — po numerze zamówienia, z zapasem
 * na płatność, gdy rekord nie niósł zamówienia. Najnowsze pierwsze.
 */
export function zwrotyPlatnosciZwrotu(database: Db, zwrotId: number): Array<ZwrotPlatnosci> {
  const wiersze = database.prepare(`
    SELECT DISTINCT p.refund_id, p.payment_id, p.order_id, p.status, p.reason, p.utworzono_at,
           p.kwota_grosze, p.waluta, p.dostawa_grosze, p.pozycje_json
      FROM zwrot_klienta z
      LEFT JOIN zamowienie_klienta m
        ON m.channel_account_id = z.channel_account_id AND m.external_id = z.order_id
      JOIN zwrot_platnosci p
        ON p.channel_account_id = z.channel_account_id
       AND (p.order_id = z.order_id
            OR (p.order_id IS NULL AND m.platnosc_id IS NOT NULL AND p.payment_id = m.platnosc_id))
     WHERE z.id = ? AND z.order_id IS NOT NULL
     ORDER BY p.utworzono_at DESC, p.refund_id`)
    .all(zwrotId) as Array<Record<string, unknown>>;
  const nazwy = new Map(
    (database.prepare(`SELECT p.external_id AS id, p.nazwa AS nazwa
        FROM zwrot_klienta z
        JOIN zamowienie_klienta m
          ON m.channel_account_id = z.channel_account_id AND m.external_id = z.order_id
        JOIN zamowienie_klienta_pozycja p ON p.zamowienie_id = m.id
       WHERE z.id = ? AND p.external_id IS NOT NULL`)
      .all(zwrotId) as Array<{ id: string; nazwa: string }>).map((n) => [n.id, n.nazwa]));
  return wiersze.map((w) => ({
    refundId: String(w.refund_id),
    paymentId: (w.payment_id as string | null) ?? null,
    orderId: (w.order_id as string | null) ?? null,
    status: String(w.status),
    reason: (w.reason as string | null) ?? null,
    utworzonoAt: String(w.utworzono_at),
    kwotaGrosze: w.kwota_grosze == null ? null : Number(w.kwota_grosze),
    waluta: (w.waluta as string | null) ?? null,
    dostawaGrosze: w.dostawa_grosze == null ? null : Number(w.dostawa_grosze),
    pozycje: (JSON.parse(String(w.pozycje_json ?? "[]")) as PozycjaZwrotuPlatnosci[])
      .map((x) => ({ ...x, nazwa: nazwy.get(x.id) ?? null })),
  }));
}

/**
 * Zatrzask rozliczenia z lustra: zwrot klienta, za który wyszedł zwrot
 * płatności `SUCCESS`, dostaje `rozliczony_allegro_at`.
 *
 * KONSERWATYWNIE, bo zatrzask zdejmuje sprawę z kolejki, a niezatrzaśnięty
 * zwrot tylko zostaje w pracy. Dlatego:
 * - tylko `reason = REFUND` (zwrot towaru); `COMPLAINT` to reklamacje, a te
 *   chodzą u nas osobną drogą i nie zamykają zwrotu;
 * - zwrot płatności musi być NOWSZY od zgłoszenia zwrotu — wcześniejszy
 *   dotyczył czegoś innego na tym samym zamówieniu;
 * - tylko gdy zamówienie ma JEDEN zwrot klienta z Allegro. Przy dwóch nie
 *   wiadomo, któremu należy się dany przelew, a zgadywanie zamknęłoby oba.
 *   Paczka nieodebrana, dodana ręcznie, nie liczy się: Allegro nie zna jej
 *   i nie ma dla niej zwrotu płatności, więc o przelew nie konkuruje;
 * - `PARTIAL` nie zatrzaskuje: wyszła część, a nie całość.
 *
 * Zatrzask trzyma PIERWSZĄ datę (`rozliczony_allegro_at IS NULL`), tak jak
 * ten z operacji płatniczych.
 */
export function zatrzaskZLustra(database: Db, konto: number, tylkoZwrot: number | null = null): number {
  const kandydaci = database.prepare(`
    SELECT z.id AS zwrot_id, MIN(p.utworzono_at) AS kiedy, MIN(p.refund_id) AS refund_id
      FROM zwrot_klienta z
      LEFT JOIN zamowienie_klienta m
        ON m.channel_account_id = z.channel_account_id AND m.external_id = z.order_id
      JOIN zwrot_platnosci p
        ON p.channel_account_id = z.channel_account_id
       AND (p.order_id = z.order_id
            OR (p.order_id IS NULL AND m.platnosc_id IS NOT NULL AND p.payment_id = m.platnosc_id))
     WHERE z.channel_account_id = ?
       AND (? IS NULL OR z.id = ?)
       AND z.rozliczony_allegro_at IS NULL
       AND z.order_id IS NOT NULL
       AND z.external_id NOT LIKE 'nieodebrana:%'
       AND (z.werdykt IS NULL OR z.werdykt <> 'odrzucony')
       AND p.status = 'SUCCESS' AND p.reason = 'REFUND'
       AND p.utworzono_at >= z.created_at
       AND (SELECT COUNT(*) FROM zwrot_klienta d
             WHERE d.channel_account_id = z.channel_account_id
               AND d.order_id = z.order_id
               AND d.external_id NOT LIKE 'nieodebrana:%') = 1
     GROUP BY z.id`)
    .all(konto, tylkoZwrot, tylkoZwrot) as Array<{ zwrot_id: number; kiedy: string; refund_id: string }>;

  let zatrzasniete = 0;
  for (const k of kandydaci) {
    const r = database.prepare(`UPDATE zwrot_klienta SET rozliczony_allegro_at=?
        WHERE id=? AND rozliczony_allegro_at IS NULL`).run(k.kiedy, k.zwrot_id);
    if (Number(r.changes) === 0) continue;
    zatrzasniete++;
    logEvent("zwrot_wyplata_potwierdzona", "automat (zwroty płatności)", null,
      { zwrotId: k.zwrot_id, wyplataAt: k.kiedy, refundId: k.refund_id,
        zrodlo: "payments/refunds" }, undefined, database);
  }
  return zatrzasniete;
}

/**
 * Dlaczego zwrot płatności `SUCCESS` NIE zatrzasnął zwrotu klienta — jedno
 * zdanie po polsku, albo `null`, gdy nie ma czego tłumaczyć.
 *
 * Zatrzask jest ostrożny celowo, ale ostrożność bez wyjaśnienia wygląda jak
 * błąd: agent widzi „Wypłacone 308 zł", a zwrot dalej stoi w kolejce.
 * Sprawdzamy te same warunki, w tej samej kolejności co `zatrzaskZLustra`,
 * i oddajemy pierwszy, który zatrzymał.
 */
export function powodBrakuZatrzasku(database: Db, zwrotId: number): string | null {
  const z = database.prepare(`SELECT z.channel_account_id AS konto, z.order_id, z.created_at,
      z.werdykt, z.rozliczony_allegro_at AS rozliczony, m.platnosc_id
      FROM zwrot_klienta z
      LEFT JOIN zamowienie_klienta m
        ON m.channel_account_id = z.channel_account_id AND m.external_id = z.order_id
     WHERE z.id = ?`).get(zwrotId) as
    { konto: number; order_id: string | null; created_at: string; werdykt: string | null;
      rozliczony: string | null; platnosc_id: string | null } | undefined;
  if (!z || z.rozliczony || !z.order_id) return null;

  const udane = database.prepare(`SELECT reason, utworzono_at FROM zwrot_platnosci
      WHERE channel_account_id = ? AND status = 'SUCCESS'
        AND (order_id = ? OR (order_id IS NULL AND ? IS NOT NULL AND payment_id = ?))`)
    .all(z.konto, z.order_id, z.platnosc_id, z.platnosc_id) as
    Array<{ reason: string | null; utworzono_at: string }>;
  if (!udane.length) return null;

  if (z.werdykt === "odrzucony") {
    return "zwrot jest u nas odrzucony, więc wypłaty nie zatrzaskujemy samoczynnie";
  }
  const zwrotu = udane.filter((u) => u.reason === "REFUND");
  if (!zwrotu.length) {
    const powody = [...new Set(udane.map((u) => u.reason ?? "brak powodu"))].join(", ");
    return `Allegro podaje powód ${powody}, a zatrzask uznaje tylko zwrot towaru (REFUND)`;
  }
  if (!zwrotu.some((u) => u.utworzono_at >= z.created_at)) {
    return "wypłata jest wcześniejsza niż zgłoszenie tego zwrotu, więc dotyczy czegoś innego";
  }
  const innych = Number((database.prepare(`SELECT COUNT(*) AS n FROM zwrot_klienta
      WHERE channel_account_id = ? AND order_id = ? AND id <> ?
        AND external_id NOT LIKE 'nieodebrana:%'`).get(z.konto, z.order_id, zwrotId) as { n: number }).n);
  if (innych > 0) {
    return "to zamówienie ma więcej niż jeden zwrot klienta i nie wiadomo, któremu należy się wypłata";
  }
  return "zwrot nie spełnił warunków zatrzasku z powodu, którego nie umiem nazwać";
}

export interface ZwrotyPlatnosciDeps {
  query?: (url: string) => Promise<unknown | null>;
  apiUrl?: string;
}

const lista = (odp: unknown): unknown[] => {
  const refunds = obj(odp)?.refunds;
  return Array.isArray(refunds) ? refunds : [];
};

/**
 * Przebieg: lista konta od ostatnio widzianego zwrotu, odświeżenie zwrotów
 * w toku po `id`, zatrzask. Błąd sieci idzie wyżej — wołający ma własny
 * parasol, a 429 musi dotrzeć do taktu.
 */
export async function synchronizujZwrotyPlatnosci(
  database: Db, konto: number, deps: ZwrotyPlatnosciDeps = {}, teraz = new Date(),
): Promise<{ zapisane: number; zatrzasniete: number }> {
  const query = deps.query ?? zapytajAllegro;
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;

  const ostatni = (database.prepare(
    "SELECT MAX(utworzono_at) AS m FROM zwrot_platnosci WHERE channel_account_id = ?")
    .get(konto) as { m: string | null }).m;
  const od = ostatni
    ? new Date(Date.parse(ostatni) - ZAKLADKA_DNI * 86_400_000).toISOString()
    : new Date(teraz.getTime() - START_DNI * 86_400_000).toISOString();

  let zapisane = 0;
  for (let strona = 0; strona < MAKS_STRON; strona++) {
    const odp = await query(urlZwrotowPlatnosci(apiUrl, { od, offset: strona * 100 }));
    const surowe = lista(odp);
    const zwroty = surowe.map(zwrotZOdpowiedzi).filter((z): z is ZwrotPlatnosci => z !== null);
    zapisane += zapiszZwrotyPlatnosci(database, konto, zwroty, teraz);
    if (surowe.length < 100) break;
  }

  const wToku = database.prepare(`SELECT refund_id FROM zwrot_platnosci
      WHERE channel_account_id = ? AND status IN (${STATUSY_W_TOKU.map(() => "?").join(",")})
      ORDER BY sprawdzono_at ASC LIMIT ?`)
    .all(konto, ...STATUSY_W_TOKU, W_TOKU_NA_PRZEBIEG) as Array<{ refund_id: string }>;
  for (const { refund_id } of wToku) {
    const odp = await query(urlZwrotowPlatnosci(apiUrl, { refundId: refund_id }));
    const zwroty = lista(odp).map(zwrotZOdpowiedzi).filter((z): z is ZwrotPlatnosci => z !== null);
    zapisane += zapiszZwrotyPlatnosci(database, konto, zwroty, teraz);
    /* Stempel także przy pustej odpowiedzi: zwrot, o którym Allegro milczy,
       nie ma prawa blokować kolejki pytań przed młodszymi. */
    database.prepare(`UPDATE zwrot_platnosci SET sprawdzono_at=?
        WHERE channel_account_id=? AND refund_id=?`).run(teraz.toISOString(), konto, refund_id);
  }

  return { zapisane, zatrzasniete: zatrzaskZLustra(database, konto) };
}

export class SprawdzenieZwrotuBlad extends Error {}

export interface WynikSprawdzenia {
  /** Ile zwrotów płatności Allegro oddało dla tego zamówienia. */
  znaleziono: number;
  /** Czy zwrot ma po tym sprawdzeniu potwierdzoną wypłatę. */
  wyplacone: boolean;
  platnosci: ZwrotPlatnosci[];
  /** Gdy Allegro oddało pieniądze, a zwrot nie został zatrzaśnięty: dlaczego. */
  powodBraku: string | null;
}

/**
 * Sprawdzenie JEDNEGO zwrotu na żądanie człowieka.
 *
 * Takt zwrotów patrzy na całe konto co kilka minut, a agent ma przed sobą
 * konkretny zwrot i chce znać odpowiedź teraz. Pytamy o zamówienie, a gdy
 * Allegro o nim milczy, o płatność — rekord zwrotu płatności nie musi nieść
 * `order`. Wynik ląduje w tym samym lustrze co z taktu, więc ekran i kolejka
 * mówią jedno.
 *
 * ODPOWIEDŹ „NIC NIE ZNALEZIONO" JEST WYNIKIEM, nie błędem: mówi, że Allegro
 * nie ma dla tego zamówienia zwrotu płatności, czyli że wypłatę trzeba
 * rozstrzygnąć inaczej. Ekran ma to powiedzieć wprost, zamiast milczeć.
 */
export async function sprawdzZwrotPlatnosci(
  database: Db, zwrotId: number, kto: { id: number; name: string },
  deps: ZwrotyPlatnosciDeps = {}, teraz = new Date(),
): Promise<WynikSprawdzenia> {
  const query = deps.query ?? zapytajAllegro;
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;

  const z = database.prepare(`SELECT z.channel_account_id AS konto, z.order_id, z.external_id,
      m.platnosc_id FROM zwrot_klienta z
      LEFT JOIN zamowienie_klienta m
        ON m.channel_account_id = z.channel_account_id AND m.external_id = z.order_id
     WHERE z.id = ?`).get(zwrotId) as
    { konto: number; order_id: string | null; external_id: string; platnosc_id: string | null } | undefined;
  if (!z) throw new SprawdzenieZwrotuBlad("Nie znaleziono zwrotu");
  if (String(z.external_id).startsWith("nieodebrana:")) {
    throw new SprawdzenieZwrotuBlad("Paczki nieodebranej Allegro nie zna — nie ma czego sprawdzać.");
  }
  if (!z.order_id) {
    throw new SprawdzenieZwrotuBlad("Zwrot nie ma numeru zamówienia, a Allegro szuka zwrotu płatności po nim.");
  }

  let rekordy = lista(await query(urlZwrotowPlatnosci(apiUrl, { orderId: z.order_id })));
  if (!rekordy.length && z.platnosc_id) {
    rekordy = lista(await query(urlZwrotowPlatnosci(apiUrl, { paymentId: z.platnosc_id })));
  }
  const zwroty = rekordy.map(zwrotZOdpowiedzi).filter((r): r is ZwrotPlatnosci => r !== null);
  zapiszZwrotyPlatnosci(database, z.konto, zwroty, teraz);
  const zatrzasniete = zatrzaskZLustra(database, z.konto, zwrotId);

  const wyplacone = Boolean((database.prepare(
    "SELECT rozliczony_allegro_at AS r FROM zwrot_klienta WHERE id = ?").get(zwrotId) as { r: string | null }).r);
  logEvent("zwrot_platnosci_sprawdzone", kto.name, null,
    { zwrotId, znaleziono: zwroty.length, zatrzasniete, wyplacone }, kto.id, database);
  return {
    znaleziono: zwroty.length, wyplacone, platnosci: zwrotyPlatnosciZwrotu(database, zwrotId),
    powodBraku: wyplacone ? null : powodBrakuZatrzasku(database, zwrotId),
  };
}
