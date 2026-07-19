import { db } from "../db/db.js";
import { config } from "../config.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import type { ProductCard, StockView } from "../types.js";

/**
 * Suma oczekujących przesunięć MM per towar, z kolejki Sfery.
 * Uwzględnia zadania typu mm/combo w statusach pending/processing/waiting_for_doc
 * (spec §5.1 — „korekta o kolejkę"). `magFrom` zawęża do MM z danego magazynu
 * źródłowego (MGP lub Zwroty); bez argumentu — wszystkie MM w drodze na MAG.
 */
export function pendingMmByTw(magFrom?: number): Map<number, number> {
  const rows = db()
    .prepare(
      `SELECT payload FROM sfera_queue
       WHERE type IN ('mm','combo')
         AND status IN ('pending','processing','waiting_for_doc')`
    )
    .all() as Array<{ payload: string }>;
  const map = new Map<number, number>();
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload) as {
        magFrom?: number;
        items?: Array<{ twId: number; qty: number }>;
      };
      // starsze zadania bez magFrom traktujemy jak MGP (jedyne dawne źródło)
      if (magFrom != null && (p.magFrom ?? config.magId.MGP) !== magFrom) continue;
      for (const it of p.items ?? []) {
        map.set(it.twId, (map.get(it.twId) ?? 0) + it.qty);
      }
    } catch {
      /* pomiń uszkodzony payload */
    }
  }
  return map;
}

function stockView(stan: number, rez: number, pendingOut: number, pendingIn: number): StockView {
  return {
    stan,
    rez,
    avail: stan - rez,
    pendingOut,
    pendingIn,
    effective: stan - pendingOut + pendingIn,
  };
}

/** Karta towaru ze stanami MAG/MGP skorygowanymi o kolejkę. */
export function buildProductCard(
  adapter: SubiektAdapter,
  twId: number
): ProductCard | undefined {
  const t = adapter.getProductById(twId);
  if (!t) return undefined;
  const magRaw = adapter.getStock(twId, config.magId.MAG);
  const mgpRaw = adapter.getStock(twId, config.magId.MGP);
  const zwRaw = adapter.getStock(twId, config.magId.ZWROTY);
  const pendingMgp = pendingMmByTw(config.magId.MGP).get(twId) ?? 0;
  const pendingZw = pendingMmByTw(config.magId.ZWROTY).get(twId) ?? 0;

  return {
    id: t.tw_id,
    sym: t.symbol,
    name: t.nazwa,
    ean: t.ean ?? "",
    unit: t.unit,
    ordered: t.ordered,
    desc: t.opis ?? "",
    locs: t.lokalizacja ? t.lokalizacja.split(" ").filter(Boolean) : [],
    // strefy źródłowe tracą to, co w kolejce do przeniesienia; MAG zyskuje (⏳ w drodze)
    mgp: stockView(mgpRaw.stan, mgpRaw.stan_rez, pendingMgp, 0),
    zwroty: stockView(zwRaw.stan, zwRaw.stan_rez, pendingZw, 0),
    mag: stockView(magRaw.stan, magRaw.stan_rez, 0, pendingMgp + pendingZw),
  };
}
