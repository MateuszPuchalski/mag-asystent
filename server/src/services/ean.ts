import { db } from "../db/db.js";

/* ── Rejestr kolizji kodów kreskowych (§4.5) ──────────────────────────────────
   Ten sam EAN na kilku kartotekach zatrzymuje pracę w alejce (D7). Zamiast
   znosić to w nieskończoność, zapisujemy każde trafienie: aplikacja staje się
   instrumentem pomiaru jakości danych, a biuro dostaje listę kodów do naprawy.

   Osobny moduł, żeby `delivery` (który zapisuje kolizje) i `problems` (który
   domyka dostawę po zgłoszeniu wyjątku) nie zapętliły się na imporcie.        */

const nowIso = () => new Date().toISOString();

export function recordEanConflict(
  ean: string,
  twIds: number[],
  auto: boolean
): void {
  db()
    .prepare("INSERT INTO ean_conflict(ean, tw_ids, auto, seen_at) VALUES (?,?,?,?)")
    .run(ean, JSON.stringify(twIds), auto ? 1 : 0, nowIso());
}

/** Kartoteka z kolizji — surowe tw_Id nie mówi człowiekowi nic. */
export interface KolizjaTowar {
  twId: number;
  sym: string;
  name: string;
}

/** Zagregowany raport — ile razy który kod zatrzymał pracę. */
export function eanConflictReport(): Array<{
  ean: string;
  hits: number;
  autoResolved: number;
  twIds: number[];
  towary: KolizjaTowar[];
  lastSeen: string;
}> {
  const rows = db()
    .prepare(
      `SELECT ean, COUNT(*) AS hits, SUM(auto) AS autoResolved,
              MAX(seen_at) AS lastSeen, MAX(tw_ids) AS twIds
       FROM ean_conflict GROUP BY ean ORDER BY hits DESC, ean`
    )
    .all() as Array<{ ean: string; hits: number; autoResolved: number; lastSeen: string; twIds: string }>;

  /* Symbole i nazwy jednym zapytaniem dla wszystkich kolizji naraz. Kartoteka
     skasowana po zapisaniu kolizji wraca z pustym symbolem — identyfikator
     zostaje w `twIds`, więc informacja nie znika, tylko traci wygodną formę. */
  const wszystkieIds = new Set<number>();
  const parsed = rows.map((r) => {
    const ids = JSON.parse(r.twIds || "[]") as number[];
    for (const id of ids) wszystkieIds.add(id);
    return { r, ids };
  });
  const znane = new Map<number, { sym: string; name: string }>();
  if (wszystkieIds.size > 0) {
    const dziury = [...wszystkieIds].map(() => "?").join(",");
    const towary = db()
      .prepare(`SELECT tw_id, symbol, nazwa FROM sgt_towar WHERE tw_id IN (${dziury})`)
      .all(...wszystkieIds) as unknown as Array<{ tw_id: number; symbol: string; nazwa: string }>;
    for (const t of towary) znane.set(t.tw_id, { sym: t.symbol, name: t.nazwa });
  }

  return parsed.map(({ r, ids }) => ({
    ean: r.ean,
    hits: r.hits,
    autoResolved: r.autoResolved ?? 0,
    twIds: ids,
    towary: ids.map((id) => ({
      twId: id,
      sym: znane.get(id)?.sym ?? "",
      name: znane.get(id)?.name ?? "",
    })),
    lastSeen: r.lastSeen,
  }));
}
