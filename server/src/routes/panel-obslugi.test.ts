import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-panel-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

let app: FastifyInstance;
before(async () => { app = await (await import("../index.js")).buildApp(); });

/* Do 0.146.0 ścieżki ekranów panelu stały tu wypisane z ręki — dwie sztuki.
   Rozmowa ma od tego wydania własny adres, więc lista rosłaby bez końca,
   a każdy pominięty ekran dawał 404 po odświeżeniu strony.

   Test celowo NIE zakłada, że panel jest zbudowany: w CI `npm test` biegnie
   przed `npm run build`. Sprawdza więc rzecz, która nie zależy od builda —
   że głęboki link dostaje TO SAMO co korzeń. */
const EKRANY = ["/obsluga/", "/obsluga/skrzynka", "/obsluga/skrzynka/4821"];

test("każdy ekran panelu odpowiada tak samo jak jego korzeń", async () => {
  const odpowiedzi = [];
  for (const url of EKRANY) {
    const r = await app.inject({ method: "GET", url });
    assert.notEqual(r.statusCode, 404, `${url} dał 404 — fallback SPA go nie objął`);
    odpowiedzi.push(r.statusCode);
  }
  assert.equal(new Set(odpowiedzi).size, 1, "ekrany panelu rozjechały się odpowiedzią");
});

test("wejście bez ukośnika prowadzi do panelu, a nie w pustkę", async () => {
  const r = await app.inject({ method: "GET", url: "/obsluga" });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "/obsluga/");
});

test("zasoby nie wychodzą poza katalog builda", async () => {
  /* Gwiazdka `/obsluga/*` łapie wszystko, więc bez białej listy nazwa pliku
     z `..` czytałaby cudze pliki serwera. */
  for (const zly of ["../../../etc/passwd", "..%2f..%2fpackage.json", "nie-ma-takiego.js"]) {
    const r = await app.inject({ method: "GET", url: `/obsluga/assets/${zly}` });
    assert.ok(r.statusCode === 404 || r.statusCode === 200 && !r.body.includes("root:"),
      `zasób ${zly} nie został odrzucony`);
  }
});
