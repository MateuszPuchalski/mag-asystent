import fs from "node:fs";
import { db, nowIso } from "./db.js";
import { config } from "../config.js";

/**
 * Zasila read-model sgt_* prawdziwymi danymi z web/public/data/products.json
 * (eksport magmat.xlsx:
 *  [symbol,nazwa,ean,mag,rez,mgp,unit,ordered,lokalizacja,opis,dostawca]).
 *
 * Dodatkowo syntetyzuje dokumenty FZ/PZ na magazyn MGP (eksport to płaski
 * stan, bez dokumentów przyjęć), aby moduł rozkładania miał realną zawartość:
 * pozycjami są towary z bieżącym stanem na MGP (fizycznie czekają na
 * rozłożenie), POGRUPOWANE po prawdziwym dostawcy z eksportu — jeden dostawca
 * = jeden dokument dostawy. Dodatkowo kilka pozycji bez lokalizacji trafia do
 * dokumentów (ścieżka BRAK LOK).
 */

type Row = [
  string, string, string, number, number, number,
  string, number, string, string, string,
];

const DOSTAWCA_FALLBACK = "Dostawca nieznany";

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
  d.prepare("INSERT INTO sgt_magazyn(mag_id, kod) VALUES (?,?)").run(config.magId.ZWROTY, "ZWROTY");

  const insTowar = d.prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, ordered, opis, lokalizacja)
     VALUES (@tw_id,@symbol,@nazwa,@ean,@unit,@ordered,@opis,@lokalizacja)`
  );
  const insStan = d.prepare(
    "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,?)"
  );

  const mgpProducts: Array<{ tw_id: number; mgp: number; dostawca: string }> = [];
  const noLocProducts: number[] = [];

  const insertAll = d.transaction((data: Row[]) => {
    data.forEach((r, i) => {
      const tw_id = i + 1;
      const [symbol, nazwa, ean, mag, rez, mgp, unit, ordered, lokalizacja, opis, dostawca] = r;
      insTowar.run({
        tw_id, symbol, nazwa, ean: ean || "", unit: unit || "szt.",
        ordered: ordered || 0, opis: opis || "", lokalizacja: lokalizacja || "",
      });
      insStan.run(tw_id, config.magId.MAG, mag || 0, rez || 0);
      insStan.run(tw_id, config.magId.MGP, mgp || 0, 0);
      if (mgp > 0) mgpProducts.push({ tw_id, mgp, dostawca: dostawca || DOSTAWCA_FALLBACK });
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

  // grupowanie towarów z MGP po prawdziwym dostawcy; duże grupy (np. własne
  // przyjęcia WERTIS) dzielimy na kilka mniejszych, dających się rozłożyć
  // dokumentów — jak realne, rozłożone w czasie dostawy (spec §5.4).
  const MAX_POZ = 20; // maks. pozycji na dokument
  const byDostawca = new Map<string, Array<{ tw_id: number; mgp: number }>>();
  for (const p of mgpProducts) {
    const g = byDostawca.get(p.dostawca) ?? [];
    g.push({ tw_id: p.tw_id, mgp: p.mgp });
    byDostawca.set(p.dostawca, g);
  }
  // paczki (dostawca, pozycje) — deterministycznie: dostawcy alfabetycznie
  const paczki: Array<{ dostawca: string; items: Array<{ tw_id: number; mgp: number }> }> = [];
  for (const dostawca of [...byDostawca.keys()].sort()) {
    const items = byDostawca.get(dostawca)!;
    for (let i = 0; i < items.length; i += MAX_POZ) {
      paczki.push({ dostawca, items: items.slice(i, i + MAX_POZ) });
    }
  }
  const baseDate = new Date("2026-07-16T00:00:00Z");

  const buildDocs = d.transaction(() => {
    paczki.forEach((paczka, k) => {
      const dok_id = k + 1;
      const typ = k % 2 === 0 ? "FZ" : "PZ";
      const nr = `${typ} ${120 + k}/07/2026`;
      const date = new Date(baseDate.getTime() - k * 86400_000).toISOString().slice(0, 10);
      // ostatni dokument w buforze → test ścieżki waiting_for_doc (spec §8 D8)
      const wBuforze = k === paczki.length - 1 ? 1 : 0;
      insDok.run(dok_id, typ, nr, date, config.magId.MGP, paczka.dostawca, wBuforze);

      for (const p of paczka.items) insPoz.run(dok_id, p.tw_id, p.mgp);

      // dorzuć 2 nowe SKU bez lokalizacji (ścieżka BRAK LOK, §5.4 pkt 4)
      for (const twId of noLocProducts.slice(k * 2, k * 2 + 2)) {
        insPoz.run(dok_id, twId, 12);
      }
    });
  });
  buildDocs();

  // ── syntetyczny karton zwrotów od klientów (magazyn Zwroty) ──────────────
  // Biuro kompletuje zwroty w kartony (~20 szt.) i wystawia dokument; kolektor
  // otwiera go w rozkładaniu i robi MM Zwroty→MAG. Pozycje: towary z MAG
  // z lokalizacją (wróciły od klientów) + jeden bez lokalizacji (BRAK LOK).
  const zwrotItems: Array<{ tw_id: number; qty: number }> = [];
  rows.forEach((r, i) => {
    const mag = r[3];
    const lokalizacja = r[8];
    if (zwrotItems.length < 7 && mag > 0 && lokalizacja) {
      zwrotItems.push({ tw_id: i + 1, qty: (zwrotItems.length % 3) + 1 });
    }
  });
  if (noLocProducts.length) zwrotItems.push({ tw_id: noLocProducts[0], qty: 2 });

  if (zwrotItems.length) {
    const zwDokId = paczki.length + 1;
    const buildZwrot = d.transaction(() => {
      insDok.run(zwDokId, "ZW", `ZW 7/07/2026`, baseDate.toISOString().slice(0, 10), config.magId.ZWROTY, "Zwroty klienckie", 0);
      const insZwStan = d.prepare(
        "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,0) ON CONFLICT(tw_id, mag_id) DO UPDATE SET stan = stan + excluded.stan"
      );
      for (const it of zwrotItems) {
        insPoz.run(zwDokId, it.tw_id, it.qty);
        insZwStan.run(it.tw_id, config.magId.ZWROTY, it.qty);
      }
    });
    buildZwrot();
    console.log(`[seed] karton zwrotów: ZW 7/07/2026, pozycji=${zwrotItems.length}`);
  }

  const docs = d.prepare("SELECT dok_id, nr_pelny, w_buforze FROM sgt_dokument").all();
  console.log(`[seed] dokumenty FZ/PZ:`, docs);
  console.log(`[seed] gotowe (${nowIso()}).`);
}

seed();
