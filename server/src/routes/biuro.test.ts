import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Podgląd biura ───────────────────────────────────────────────────────────
   Strona pod /biuro jest jedynym interfejsem biura, więc dwa niezmienniki są
   warte testu:

   1. SAMA STRONA jest dostępna bez sesji — logowanie odbywa się na niej, więc
      gdyby bramka ją objęła, biuro nie miałoby jak wpisać badge'a.
   2. DANE za nią nie są: trasy API, z których strona czyta, odpadają bez
      tokenu. Strona bez sesji ma pokazać formularz logowania, nie dane.      */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-biuro-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;

before(async () => {
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

test("strona /biuro jest serwowana bez sesji", async () => {
  const r = await app.inject({ method: "GET", url: "/biuro" });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"] as string, /text\/html/);
  assert.match(r.body, /Podgląd biura/);
});

test("korzeń przekierowuje do podglądu", async () => {
  const r = await app.inject({ method: "GET", url: "/" });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "/biuro");
});

test("trasa /sw.js wyszła razem z pogrzebem starej PWA", async () => {
  // jednorazowe sprzątanie po PWA z 0.3.0 skończyło się w 0.25.0
  const r = await app.inject({ method: "GET", url: "/sw.js" });
  assert.equal(r.statusCode, 404);
});

test("dane strony zostają za bramką sesji", async () => {
  // dokładnie trasy, z których strona czyta — regresja w którejkolwiek
  // otworzyłaby dane magazynu każdemu w LAN
  for (const url of [
    "/api/delivery/documents",
    "/api/problems/unresolved",
    "/api/delivery/1/problems",
    "/api/delivery/1/problems.csv",
    "/api/problems/1/photo",
  ]) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 401, url);
  }
});
