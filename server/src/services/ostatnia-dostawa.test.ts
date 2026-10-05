import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { config } from "../config.js";
import { etykietyDostaw } from "../adapters/typy-dokumentow.js";
import { ostatniaDostawa } from "./ostatnia-dostawa.js";

/* Ten plik pilnuje odpowiedzi na pytanie „od kogo przyszedł towar, który
   klient reklamuje". Reguły, których na ekranie nie widać: partia sprzed
   zakupu wygrywa z nowszą, oba źródła się uzupełniają, a brak wiedzy to
   `null`, nie pusty dostawca. */
const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const TW = 501;
const TYP = etykietyDostaw()[0] ?? "FZ";

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  let dok = 100;
  /** Dokument w read-modelu Subiekta z jedną pozycją towaru. */
  const subiekt = (n: { data: string; dostawca: string | null; nr?: string | null;
    typ?: string; mag?: number; tw?: number }) => {
    dok += 1;
    d.prepare(`INSERT INTO sgt_dokument(dok_id,typ,nr_pelny,data_wyst,mag_id,dostawca,nr_oryg)
      VALUES (?,?,?,?,?,?,?)`).run(dok, n.typ ?? TYP, `FZ ${dok}/2026`, n.data,
      n.mag ?? config.magId.MAG, n.dostawca, n.nr ?? null);
    d.prepare("INSERT INTO sgt_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,1)").run(dok, n.tw ?? TW);
  };
  /** Dostawa z archiwum WERTIS — dokument dawno wypadł z okna importu. */
  const archiwum = (n: { data: string; dostawca: string; nr?: string | null }) => {
    dok += 1;
    const id = Number(d.prepare(`INSERT INTO delivery(sgt_dok_id,sgt_dok_numer,dostawca,data_dok,
      status,opened_at,nr_oryg) VALUES (?,?,?,?,'done','2026-01-01T00:00:00Z',?)`)
      .run(dok, `FZ ${dok}/2026`, n.dostawca, n.data, n.nr ?? null).lastInsertRowid);
    d.prepare(`INSERT INTO delivery_line(delivery_id,tw_id,tw_symbol,tw_nazwa,ilosc_dok)
      VALUES (?,?,'SYM','Nóż',1)`).run(id, TW);
  };
  return { d, subiekt, archiwum };
}

test("bez towaru i bez dostaw nie wiemy — `null`, nie pusty dostawca", () => {
  const { d } = baza();
  assert.equal(ostatniaDostawa(d, null, "2026-09-01T10:00:00Z"), null);
  assert.equal(ostatniaDostawa(d, TW, "2026-09-01T10:00:00Z"), null);
});

test("partia sprzed zakupu wygrywa z nowszą — klient dostał sztukę z półki w dniu zakupu", () => {
  const { d, subiekt } = baza();
  subiekt({ data: "2026-08-10", dostawca: "AGRO", nr: " FV/123/08 " });
  subiekt({ data: "2026-09-03", dostawca: "HUSQ", nr: "F-9" });
  assert.deepEqual(ostatniaDostawa(d, TW, "2026-09-01T10:00:00Z"),
    { dostawca: "AGRO", data: "2026-08-10", numer: "FV/123/08", przedZakupem: true });
  /* Dostawa z DNIA zakupu też jest „przed": dokument ma samą datę. */
  subiekt({ data: "2026-09-01", dostawca: "STIHL" });
  assert.deepEqual(ostatniaDostawa(d, TW, "2026-09-01T18:00:00Z"),
    { dostawca: "STIHL", data: "2026-09-01", numer: null, przedZakupem: true });
});

test("bez partii sprzed zakupu oddajemy najnowszą i mówimy to flagą", () => {
  const { d, subiekt } = baza();
  subiekt({ data: "2026-09-03", dostawca: "HUSQ" });
  subiekt({ data: "2026-09-05", dostawca: "STIHL" });
  assert.deepEqual(ostatniaDostawa(d, TW, "2026-09-01T10:00:00Z"),
    { dostawca: "STIHL", data: "2026-09-05", numer: null, przedZakupem: false });
  /* Bez daty zakupu nie ma czego porównać — też najnowsza, też bez flagi. */
  assert.equal(ostatniaDostawa(d, TW, null)?.przedZakupem, false);
});

test("archiwum WERTIS uzupełnia okno importu, a filtry dostaw odsiewają resztę", () => {
  const { d, subiekt, archiwum } = baza();
  archiwum({ data: "2025-11-20", dostawca: "AGRO", nr: "FV/7/11" });
  /* Inny typ dokumentu, inny magazyn, inny towar i dokument bez kontrahenta
     nie są dostawą tego towaru do nas. */
  subiekt({ data: "2026-08-01", dostawca: "OBCY-TYP", typ: "WZ" });
  subiekt({ data: "2026-08-02", dostawca: "OBCY-MAG", mag: 999 });
  subiekt({ data: "2026-08-03", dostawca: "OBCY-TOWAR", tw: 777 });
  subiekt({ data: "2026-08-04", dostawca: null });
  assert.deepEqual(ostatniaDostawa(d, TW, "2026-09-01T10:00:00Z"),
    { dostawca: "AGRO", data: "2025-11-20", numer: "FV/7/11", przedZakupem: true });
});
