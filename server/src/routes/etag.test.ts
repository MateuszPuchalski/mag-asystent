import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── ETag/304 dla odpytywanych odczytów ──────────────────────────────────────
   Kolektor odpytuje kartę co 2 s i kolejkę co 1,5 s; między zmianami każda
   odpowiedź jest identyczna. Hook w `routes/etag.ts` ma trzy niezmienniki:

   1. GET 200 z ciałem dostaje ETag i `no-cache` (przymus rewalidacji, nie
      zakaz cache'owania).
   2. `If-None-Match` z tym ETagiem wraca jako 304 bez ciała.
   3. Nic poza tym — błędy, POST-y i trasy z własną polityką cache przechodzą
      nietknięte.                                                             */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-etag-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;

before(async () => {
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

// /api/setup jest poza bramką sesji, więc test nie musi budować konta
const URL = "/api/setup";

test("GET 200 dostaje ETag i wymóg rewalidacji", async () => {
  const r = await app.inject({ method: "GET", url: URL });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers.etag as string, /^".+"$/);
  assert.equal(r.headers["cache-control"], "no-cache");
});

test("If-None-Match z aktualnym ETagiem wraca jako puste 304", async () => {
  const pierwsza = await app.inject({ method: "GET", url: URL });
  const r = await app.inject({
    method: "GET",
    url: URL,
    headers: { "if-none-match": pierwsza.headers.etag as string },
  });
  assert.equal(r.statusCode, 304);
  assert.equal(r.body, "");
  // ETag zostaje w 304 — po nim klient wie, KTÓRĄ kopię właśnie potwierdzono
  assert.equal(r.headers.etag, pierwsza.headers.etag);
});

test("nieaktualny ETag dostaje pełną odpowiedź", async () => {
  const r = await app.inject({
    method: "GET",
    url: URL,
    headers: { "if-none-match": '"nie-ten"' },
  });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.length > 0);
});

test("błędy i POST-y przechodzą bez ETagu", async () => {
  const bezSesji = await app.inject({ method: "GET", url: "/api/queue" });
  assert.equal(bezSesji.statusCode, 401);
  assert.equal(bezSesji.headers.etag, undefined);

  const post = await app.inject({ method: "POST", url: "/api/auth/login", payload: {} });
  assert.ok(post.statusCode >= 400);
  assert.equal(post.headers.etag, undefined);
});

test("strona biura (poza /api/) zostaje nietknięta", async () => {
  const r = await app.inject({ method: "GET", url: "/biuro" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers.etag, undefined);
});
