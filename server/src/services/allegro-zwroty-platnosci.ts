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
  const kiedy = teraz.toISOString();
  for (const z of zwroty) {
    zapis.run(konto, z.refundId, z.paymentId, z.orderId, z.status, z.reason, z.utworzonoAt,
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
    pozycje: JSON.parse(String(w.pozycje_json ?? "[]")) as PozycjaZwrotuPlatnosci[],
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
 * - tylko gdy zamówienie ma JEDEN zwrot klienta. Przy dwóch nie wiadomo,
 *   któremu z nich należy się dany przelew, a zgadywanie zamknęłoby oba;
 * - `PARTIAL` nie zatrzaskuje: wyszła część, a nie całość.
 *
 * Zatrzask trzyma PIERWSZĄ datę (`rozliczony_allegro_at IS NULL`), tak jak
 * ten z operacji płatniczych.
 */
export function zatrzaskZLustra(database: Db, konto: number): number {
  const kandydaci = database.prepare(`
    SELECT z.id AS zwrot_id, MIN(p.utworzono_at) AS kiedy, MIN(p.refund_id) AS refund_id
      FROM zwrot_klienta z
      JOIN zwrot_platnosci p
        ON p.channel_account_id = z.channel_account_id AND p.order_id = z.order_id
     WHERE z.channel_account_id = ?
       AND z.rozliczony_allegro_at IS NULL
       AND z.order_id IS NOT NULL
       AND z.external_id NOT LIKE 'nieodebrana:%'
       AND (z.werdykt IS NULL OR z.werdykt <> 'odrzucony')
       AND p.status = 'SUCCESS' AND p.reason = 'REFUND'
       AND p.utworzono_at >= z.created_at
       AND (SELECT COUNT(*) FROM zwrot_klienta d
             WHERE d.channel_account_id = z.channel_account_id
               AND d.order_id = z.order_id) = 1
     GROUP BY z.id`)
    .all(konto) as Array<{ zwrot_id: number; kiedy: string; refund_id: string }>;

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
