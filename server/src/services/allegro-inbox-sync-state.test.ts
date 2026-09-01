import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  PROG_ALARMU, stanSynchronizacji, stanSynchronizacjiHealth, statusSynchronizacji,
} from "./allegro-inbox-sync-state.js";
import { synchronizujAllegroInbox } from "./allegro-inbox-sync.js";
import { BladLimituAllegro } from "../adapters/allegro.js";

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const mkDb = () => { const d = new DatabaseSync(":memory:"); d.exec(schema); migrate(d); return d; };

const INTERWAL = 60_000;
const TERAZ = Date.parse("2026-09-01T09:41:00.000Z");
const stan = (n: Partial<Parameters<typeof statusSynchronizacji>[0]> = {}) => ({
  cursorAt: null, cursorId: null, lastSuccessAt: null, lastAttemptAt: null,
  lastErrorCode: null, lastErrorText: null, errorCount: 0, errorThreadCount: 0, nextAttemptAt: null, ...n,
});

test("świeża instalacja bez ani jednej próby nie jest awarią", () => {
  /* Bez tego wyjątku każda instalacja bez sparowanego konta Allegro byłaby
     czerwona od pierwszego uruchomienia — i alarm przestałby cokolwiek znaczyć. */
  assert.equal(statusSynchronizacji(stan(), TERAZ, INTERWAL), "current");
});

test("kod porażki rozstrzyga przed jej liczbą", () => {
  /* 401 znaczy „zawołaj admina", 429 znaczy „poczekaj". Zlanie ich w `failed`
     kazałoby agentowi zgadywać, co z tym zrobić. */
  for (const [kod, oczekiwany] of [[401, "authentication_error"], [403, "authentication_error"],
    [429, "rate_limited"]] as const) {
    assert.equal(statusSynchronizacji(
      stan({ errorCount: 5, lastErrorCode: kod, lastAttemptAt: "2026-09-01T09:38:00.000Z" }),
      TERAZ, INTERWAL), oczekiwany, `kod ${kod}`);
  }
});

test("dwa potknięcia to opóźnienie, trzecie to awaria", () => {
  const bledny = (n: number) => stan({
    errorCount: n, lastErrorCode: 500, lastAttemptAt: "2026-09-01T09:38:00.000Z",
  });
  assert.equal(statusSynchronizacji(bledny(1), TERAZ, INTERWAL), "delayed");
  assert.equal(statusSynchronizacji(bledny(PROG_ALARMU - 1), TERAZ, INTERWAL), "delayed");
  assert.equal(statusSynchronizacji(bledny(PROG_ALARMU), TERAZ, INTERWAL), "failed");
});

test("cisza dłuższa niż dwa interwały to opóźnienie, nawet bez ani jednego błędu", () => {
  const swiezy = new Date(TERAZ - INTERWAL).toISOString();
  const stary = new Date(TERAZ - 3 * INTERWAL).toISOString();
  assert.equal(statusSynchronizacji(
    stan({ lastSuccessAt: swiezy, lastAttemptAt: swiezy }), TERAZ, INTERWAL), "current");
  assert.equal(statusSynchronizacji(
    stan({ lastSuccessAt: stary, lastAttemptAt: stary }), TERAZ, INTERWAL), "delayed");
});

test("status bierze kod z klasy błędu, nie ze zdania komunikatu", async () => {
  /* Regres z 0.147.0: kod wyłuskiwany wyrażeniem `\((\d{3})\)` łapał „(401)",
     ale nie „Allegro odpowiedziało 503: …" — czyli milczał akurat przy
     odmowach, które status ma nazywać. */
  const { BladOdpowiedziAllegro } = await import("../adapters/allegro.js");
  const database = mkDb();
  await assert.rejects(() => synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", intervalMs: INTERWAL,
    query: async () => {
      throw new BladOdpowiedziAllegro("Allegro odpowiedziało 403: {\"code\":\"UC\"}", 403);
    },
  }));

  const s = stanSynchronizacji(database);
  assert.equal(s.lastErrorCode, 403);
  assert.equal(statusSynchronizacji(s, TERAZ, INTERWAL), "authentication_error",
    "403 ma wołać administratora, nie chować się w ogólnym „nie udało się\"");
});

test("alarm jest osobny od statusu", () => {
  const database = mkDb();
  database.prepare(`INSERT INTO allegro_inbox_sync_state
    (id,error_count,last_error_code,last_attempt_at) VALUES (1,1,429,?)`)
    .run("2026-09-01T09:38:00.000Z");
  const h = stanSynchronizacjiHealth(database, TERAZ, INTERWAL);
  /* Jedna odmowa 429 to `rate_limited`, ale jeszcze nie powód, żeby przykryć
     kolejkę banerem na cały ekran. */
  assert.equal(h.status, "rate_limited");
  assert.equal(h.alarm, false);
  assert.equal(h.kodOstatniegoBledu, 429);
});

test("udany przebieg ZERUJE licznik błędów", async () => {
  const database = mkDb();
  const pusto = async () => ({ threads: [], totalCount: 0 });

  /* Najpierw dwie porażki z rzędu — Allegro prosi o przerwę. */
  for (let i = 0; i < 2; i++) {
    await assert.rejects(synchronizujAllegroInbox({
      database, apiUrl: "https://api.test", intervalMs: INTERWAL,
      query: async () => { throw new BladLimituAllegro("Allegro prosi o przerwę (429)", 900_000); },
    }));
  }
  let s = stanSynchronizacji(database);
  assert.equal(s.errorCount, 2);
  assert.equal(s.lastErrorCode, 429);

  /* Do 0.147.0 klauzula `DO UPDATE` pomijała `error_count`, więc licznik rósł
     do końca życia bazy: panel pokazywał „błędów: 2" jeszcze po tygodniu
     poprawnej pracy, a §21 nie miał z czego policzyć przebiegów Z RZĘDU. */
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test", query: pusto });
  s = stanSynchronizacji(database);
  assert.equal(s.errorCount, 0, "sukces nie wyzerował licznika");
  assert.equal(s.lastErrorCode, null);
  assert.ok(s.lastAttemptAt, "udany przebieg też jest próbą i ma swój czas");
  assert.equal(statusSynchronizacji(s, Date.parse(s.lastSuccessAt!), INTERWAL), "current");
});
