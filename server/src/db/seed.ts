import fs from "node:fs";
import { db, nowIso } from "./db.js";
import { config } from "../config.js";

/**
 * Zasila read-model sgt_* prawdziwymi danymi z web/public/data/products.json
 * (eksport mag.xlsx: [symbol,nazwa,ean,mag,rez,mgp,unit,ordered,lokalizacja,opis]).
 *
 * Dodatkowo syntetyzuje dokumenty FZ/PZ na magazyn MGP (w mag.xlsx nie ma
 * kontrahentów), aby moduł rozkładania miał realną zawartość: pozycjami są
 * towary z bieżącym stanem na MGP (te fizycznie czekają na rozłożenie), plus
 * kilka pozycji spoza tej puli (nowe SKU bez lokalizacji → ścieżka BRAK LOK).
 */

type Row = [string, string, string, number, number, number, string, number, string, string];

const DOSTAWCY = [
  "AGRO-TECH Sp. z o.o.",
  "GardenParts Distribution",
  "Falon-Tech S.A.",
  "Import Ogród Wrocław",
];

function seed() {
  const d = db();
  const already = (d.prepare("SELECT COUNT(*) AS n FROM sgt_towar").get() as { n: number }).n;
  if (already > 0 && process.env.FORCE_SEED !== "1") {
    console.log(`[seed] sgt_towar ma już ${already} rekordów — pomijam (FORCE_SEED=1 aby nadpisać).`);
    return;
  }

  const rows: Row[] = JSON.parse(fs.readFileSync(config.seedProducts, "utf8"));
  console.log(`[seed] wczytano ${rows.length} kartotek z ${config.seedProducts}`);

  const wipe = d.transaction(() => {
    for (const t of ["sgt_pozycja", "sgt_dokument", "sgt_stan", "sgt_towar", "sgt_magazyn"]) {
      d.prepare(`DELETE FROM ${t}`).run();
    }
  });
  wipe();

  d.prepare("INSERT INTO sgt_magazyn(mag_id, kod) VALUES (?,?)").run(config.magId.MAG, "MAG");
  d.prepare("INSERT INTO sgt_magazyn(mag_id, kod) VALUES (?,?)").run(config.magId.MGP, "MGP");

  const insTowar = d.prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, ordered, opis, lokalizacja)
     VALUES (@tw_id,@symbol,@nazwa,@ean,@unit,@ordered,@opis,@lokalizacja)`
  );
  const insStan = d.prepare(
    "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,?)"
  );

  const mgpProducts: Array<{ tw_id: number; mgp: number }> = [];
  const noLocProducts: number[] = [];

  const insertAll = d.transaction((data: Row[]) => {
    data.forEach((r, i) => {
      const tw_id = i + 1;
      const [symbol, nazwa, ean, mag, rez, mgp, unit, ordered, lokalizacja, opis] = r;
      insTowar.run({
        tw_id, symbol, nazwa, ean: ean || "", unit: unit || "szt.",
        ordered: ordered || 0, opis: opis || "", lokalizacja: lokalizacja || "",
      });
      insStan.run(tw_id, config.magId.MAG, mag || 0, rez || 0);
      insStan.run(tw_id, config.magId.MGP, mgp || 0, 0);
      if (mgp > 0) mgpProducts.push({ tw_id, mgp });
      else if (!lokalizacja) noLocProducts.push(tw_id);
    });
  });
  insertAll(rows);
  console.log(`[seed] towary=${rows.length}, na MGP=${mgpProducts.length}, bez lokalizacji=${noLocProducts.length}`);

  // ── syntetyczne dokumenty FZ/PZ (deterministyczne, bez losowości) ────────
  const insDok = d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,?,?,?,?,?,?)`
  );
  const insPoz = d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)");

  const DOC_COUNT = 4;
  const perDoc = Math.ceil(mgpProducts.length / DOC_COUNT);
  const baseDate = new Date("2026-07-16T00:00:00Z");

  const buildDocs = d.transaction(() => {
    for (let k = 0; k < DOC_COUNT; k++) {
      const dok_id = k + 1;
      const typ = k % 2 === 0 ? "FZ" : "PZ";
      const nr = `${typ} ${120 + k}/07/2026`;
      const date = new Date(baseDate.getTime() - (k * 3 + 1) * 86400_000)
        .toISOString()
        .slice(0, 10);
      const wBuforze = k === DOC_COUNT - 1 ? 1 : 0; // ostatni w buforze → test waiting_for_doc
      insDok.run(dok_id, typ, nr, date, config.magId.MGP, DOSTAWCY[k % DOSTAWCY.length], wBuforze);

      const slice = mgpProducts.slice(k * perDoc, (k + 1) * perDoc);
      for (const p of slice) insPoz.run(dok_id, p.tw_id, p.mgp);

      // dorzuć 2 nowe SKU bez lokalizacji (ścieżka BRAK LOK, §5.4 pkt 4)
      for (const twId of noLocProducts.slice(k * 2, k * 2 + 2)) {
        insPoz.run(dok_id, twId, 12);
      }
    }
  });
  buildDocs();

  const docs = d.prepare("SELECT dok_id, nr_pelny, w_buforze FROM sgt_dokument").all();
  console.log(`[seed] dokumenty FZ/PZ:`, docs);
  console.log(`[seed] gotowe (${nowIso()}).`);
}

seed();
