import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* Wpięcie kopii w `db()` — osobny plik, bo `db()` to singleton na proces,
   a ten test potrzebuje bazy ISTNIEJĄCEJ przed pierwszym otwarciem.

   Pilnuje jednego zdania z DEPLOY.md, które do 0.487.0 było prośbą: kopia
   bazy powstaje PRZED migracją, bo migracje kasują tabele. Kopia zrobiona
   po migracji wyglądałaby tak samo i nie chroniłaby przed niczym. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-start-"));
process.env.DB_PATH = path.join(dir, "wertis.db");
process.env.KOPIE_KATALOG = path.join(dir, "kopie");
process.env.SGT_MODE = "seeded";

/* Tabela, której `migrate()` nie zna i której nie ruszy. Jej obecność
   w kopii dowodzi danych sprzed startu. Brak `events` w kopii — tabeli,
   którą zakłada `schema.sql` — dowodzi, że kopia powstała przed migracją. */
const stara = new DatabaseSync(process.env.DB_PATH);
stara.exec("CREATE TABLE z_poprzedniej_wersji (v TEXT)");
stara.prepare("INSERT INTO z_poprzedniej_wersji VALUES (?)").run("dane sprzed aktualizacji");
stara.close();

test("pierwszy start nowej wersji robi kopię sprzed migracji", async () => {
  const { db } = await import("./db.js");
  const { WERSJA } = await import("../wersja.js");
  db();

  const kopie = fs.readdirSync(process.env.KOPIE_KATALOG!).filter((p) => p.startsWith("przed-"));
  assert.equal(kopie.length, 1, kopie.join(","));
  assert.ok(kopie[0]!.endsWith(`-nieznana-do-${WERSJA}.db`), kopie[0]);

  const k = new DatabaseSync(path.join(process.env.KOPIE_KATALOG!, kopie[0]!), { readOnly: true });
  const tabele = (k.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
    Array<{ name: string }>).map((t) => t.name);
  k.close();
  assert.ok(tabele.includes("z_poprzedniej_wersji"), tabele.join(","));
  assert.ok(!tabele.includes("events"), "kopia powstała PO migracji — nie chroni przed niczym");

  const stan = JSON.parse(fs.readFileSync(path.join(process.env.KOPIE_KATALOG!, "stan.json"), "utf8"));
  assert.equal(stan.wersja, WERSJA, "znacznik po udanej migracji — bez niego każdy restart to kopia");
});
