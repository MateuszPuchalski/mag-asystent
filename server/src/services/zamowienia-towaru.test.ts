import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── „Nie ma go, ale jest zamówiony" ─────────────────────────────────────────
   Sedno tych testów: zamówienie znika z karty dokładnie wtedy, gdy CAŁOŚĆ już
   przyjechała — nie wcześniej i nie później. Odwrotna reguła daje błąd bez
   objawu: albo magazynier czeka na towar, którego nikt już nie wyśle, albo nie
   dowiaduje się o dostawie, która jest w drodze.

   Drugie sedno to KOLEJNOŚĆ. Lista odpowiada na pytanie „kiedy to będzie",
   więc rządzi nią termin realizacji, a nie data wystawienia zamówienia.       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zam-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zamowienia-towaru.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zamowienia-towaru.js");
});

const TOWAR = 7;
const INNY_TOWAR = 8;

beforeEach(() => {
  const d = db();
  d.prepare("DELETE FROM sgt_zam_pozycja").run();
  d.prepare("DELETE FROM sgt_zamowienie").run();
});

/** Zamówienie z jedną pozycją naszego towaru. */
function zamowienie(opts: {
  dokId: number;
  ilosc: number;
  zreal?: number;
  termin?: string | null;
  dataWyst?: string;
  twId?: number;
}) {
  const d = db();
  d.prepare(
    `INSERT INTO sgt_zamowienie(dok_id, nr_pelny, data_wyst, termin, dostawca)
     VALUES (?,?,?,?,?)`
  ).run(
    opts.dokId,
    `ZD ${opts.dokId}/2026`,
    opts.dataWyst ?? "2026-07-01",
    opts.termin === undefined ? "2026-08-01" : opts.termin,
    "HURT-AB"
  );
  d.prepare(
    "INSERT INTO sgt_zam_pozycja(dok_id, tw_id, ilosc, zreal) VALUES (?,?,?,?)"
  ).run(opts.dokId, opts.twId ?? TOWAR, opts.ilosc, opts.zreal ?? 0);
}

test("otwarte zamówienie z resztą do dostarczenia trafia na kartę", () => {
  zamowienie({ dokId: 100, ilosc: 20, zreal: 5 });
  const r = Z.zamowioneUDostawcy(TOWAR);
  assert.equal(r.length, 1);
  assert.equal(r[0].ilosc, 15, "pokazujemy POZOSTAŁO, nie zamówiono");
  assert.equal(r[0].nrPelny, "ZD 100/2026");
  assert.equal(r[0].dostawca, "HURT-AB");
});

test("zrealizowane w całości ZNIKA — nie ma na co czekać", () => {
  zamowienie({ dokId: 101, ilosc: 20, zreal: 20 });
  assert.deepEqual(Z.zamowioneUDostawcy(TOWAR), []);
});

test("nadrealizacja też znika i NIE daje liczby ujemnej", () => {
  /* Dostawca przysłał więcej, niż zamówiono. To nie jest „minus w drodze",
     tylko zero do czekania — a ujemna liczba na karcie byłaby bezsensowna. */
  zamowienie({ dokId: 102, ilosc: 20, zreal: 25 });
  assert.deepEqual(Z.zamowioneUDostawcy(TOWAR), []);
});

test("kolejność idzie po TERMINIE, nie po dacie wystawienia", () => {
  // starsze zamówienie z dalszym terminem — po dacie wystawienia byłoby pierwsze
  zamowienie({ dokId: 200, ilosc: 5, dataWyst: "2026-06-01", termin: "2026-09-30" });
  zamowienie({ dokId: 201, ilosc: 5, dataWyst: "2026-07-20", termin: "2026-08-05" });
  assert.deepEqual(
    Z.zamowioneUDostawcy(TOWAR).map((z) => z.dokId),
    [201, 200],
    "u góry ma stać to, co przyjedzie NAJWCZEŚNIEJ"
  );
});

test("zamówienie bez terminu ląduje na KOŃCU, nie na początku", () => {
  zamowienie({ dokId: 300, ilosc: 5, termin: null });
  zamowienie({ dokId: 301, ilosc: 5, termin: "2026-12-31" });
  assert.deepEqual(
    Z.zamowioneUDostawcy(TOWAR).map((z) => z.dokId),
    [301, 300],
    "brak terminu nie może wypchnąć znanej daty z pierwszego miejsca"
  );
});

test("cudze zamówienie nie wchodzi na kartę tego towaru", () => {
  zamowienie({ dokId: 400, ilosc: 5, twId: INNY_TOWAR });
  assert.deepEqual(Z.zamowioneUDostawcy(TOWAR), []);
});

test("towar bez zamówień daje pustą listę", () => {
  assert.deepEqual(Z.zamowioneUDostawcy(999), []);
});

test("ten sam towar w kilku pozycjach jednego ZD sumuje się do jednej linii", () => {
  const d = db();
  zamowienie({ dokId: 500, ilosc: 3 });
  d.prepare(
    "INSERT INTO sgt_zam_pozycja(dok_id, tw_id, ilosc, zreal) VALUES (?,?,?,?)"
  ).run(500, TOWAR, 4, 1);
  const r = Z.zamowioneUDostawcy(TOWAR);
  assert.equal(r.length, 1, "jedno zamówienie to jedna linia na karcie");
  assert.equal(r[0].ilosc, 6, "(3+4) zamówione minus (0+1) zrealizowane");
});

test("bez degradacji importu ilość NIE jest oznaczona jako szacunek", () => {
  /* W trybie demo i przy sprawnej kolumnie `zreal` liczba jest dokładna.
     Gdyby `szacunek` było stale `true`, ostrzeżenie spowszedniałoby i przestało
     cokolwiek znaczyć wtedy, gdy naprawdę jest potrzebne. */
  zamowienie({ dokId: 600, ilosc: 10 });
  assert.equal(Z.zamowioneUDostawcy(TOWAR)[0].szacunek, false);
});
