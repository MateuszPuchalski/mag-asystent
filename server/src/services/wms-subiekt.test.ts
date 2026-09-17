import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wms-subiekt-")),
  "test.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = path.join(os.tmpdir(), "wms-subiekt-no-env.local");

let G: typeof import("./wms-subiekt.js"),
  W: typeof import("./wms.js"),
  R: typeof import("./reconcile.js"),
  config: typeof import("../config.js").config,
  db: typeof import("../db/db.js").db;

const biuro = { id: 1, name: "Biuro", role: "admin" as const };
let kolejny = 0;

before(async () => {
  G = await import("./wms-subiekt.js");
  W = await import("./wms.js");
  R = await import("./reconcile.js");
  ({ config } = await import("../config.js"));
  ({ db } = await import("../db/db.js"));
});

/** Kartoteka ze stanem w Subiekcie; `wKartotece` to stan magazynu MAG. */
function kartoteka(wKartotece: number): number {
  const twId = ++kolejny + 9000;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, `GRAN-${twId}`, "Część graniczna", `0591${twId}`);
  db()
    .prepare("INSERT INTO sgt_stan(tw_id,mag_id,stan,stan_rez) VALUES (?,?,?,0)")
    .run(twId, config.magId.MAG, wKartotece);
  return twId;
}

test("zasiew dosypuje brakującą część do miejsca nieznanego", () => {
  const twId = kartoteka(7);
  const wynik = G.zasiew(biuro, randomUUID());
  assert.ok(wynik.sztuk >= 7, "zasiew ma dosypać co najmniej siedem sztuk");
  const stan = db()
    .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
    .get(twId, G.BIN_NIEZNANE) as { on_hand: number };
  assert.equal(stan.on_hand, 7);
});

test("drugi przebieg zasiewu nie robi nic — idempotencja z arytmetyki", () => {
  kartoteka(4);
  G.zasiew(biuro, randomUUID());
  const drugi = G.zasiew(biuro, randomUUID());
  assert.equal(drugi.zasiane, 0);
  assert.equal(drugi.sztuk, 0);
});

test("po zasiewie rozjazdu nie ma", () => {
  kartoteka(3);
  G.zasiew(biuro, randomUUID());
  assert.deepEqual(
    G.rozjazdyZapasu().filter((r) => r.powod === "wms_mniej"),
    [],
  );
});

test("ułamkowy stan Subiekta wraca jako rozjazd, a nie zaokrąglenie", () => {
  const twId = kartoteka(2.5);
  const wynik = G.zasiew(biuro, randomUUID());
  const pominiety = wynik.pominiete.find((r) => r.twId === twId);
  assert.equal(pominiety?.powod, "ulamek");
  const stan = db()
    .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
    .get(twId, G.BIN_NIEZNANE);
  assert.equal(stan, undefined, "ułamek nie ma prawa wejść do zapasu");
});

test("nadmiar w WMS nie jest zdejmowany — wraca do człowieka", () => {
  const twId = kartoteka(1);
  G.zasiew(biuro, randomUUID());
  W.changeStock(biuro, randomUUID(), {
    action: "receive",
    twId,
    bin: `B-${twId}`,
    quantity: 5,
    reason: "Znalezione na półce poza zasiewem",
  });
  const wynik = G.zasiew(biuro, randomUUID());
  const pominiety = wynik.pominiete.find((r) => r.twId === twId);
  assert.equal(pominiety?.powod, "wms_wiecej");
  assert.equal(pominiety?.wms, 6);
});

test("rozjazd wchodzi do rekoncyliacji pod własnym rodzajem", () => {
  kartoteka(2.5);
  const raport = R.reconcile();
  assert.ok(raport.rozjazdy.some((r) => r.rodzaj === "zapas_vs_subiekt"));
});

test("postęp zasiewu oddziela miejsce nieznane od półek", () => {
  const twId = kartoteka(10);
  G.zasiew(biuro, randomUUID());
  const przed = G.postepZasiewu();
  W.changeStock(biuro, randomUUID(), {
    action: "transfer",
    twId,
    bin: G.BIN_NIEZNANE,
    target: `C-${twId}`,
    quantity: 4,
    reason: "Pierwszy skan półki",
  });
  const po = G.postepZasiewu();
  assert.equal(po.nieznane, przed.nieznane - 4);
  assert.equal(po.polki, przed.polki + 4);
});
