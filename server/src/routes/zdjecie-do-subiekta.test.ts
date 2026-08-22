import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Zatwierdzenie przy ZDJECIA_DODAWANIE=subiekt ─────────────────────────────
   Osobny plik, bo ten wariant wymaga INNEJ konfiguracji procesu: `subiekt`
   nie przechodzi walidacji przy SGT_MODE=seeded, a konfiguracja powstaje raz,
   przy imporcie. Dwa warianty w jednym pliku nie mają jak zamieszkać.

   MSSQL nie jest tu ruszany i nie ma go czym ruszyć: `buildApp` nie otwiera
   połączenia, a zadanie kończy się na WEJŚCIU DO KOLEJKI. Co robi z nim worker,
   mierzy `worker/kolejka.test.ts`; jak wygląda INSERT — `adapters/zdjecie-zapis.test.ts`.

   Stawka tego pliku: zdjęcie ma trafić do kolejki ORAZ zostać widoczne na
   karcie. Gdyby powstawało tylko zadanie, zdjęcie znikałoby na czas między
   zatwierdzeniem a wykonaniem — a to bywa doba, gdy brakuje GRANT-u.          */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjs-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "mssql";
process.env.MSSQL_SERVER = "127.0.0.1";
process.env.MSSQL_DATABASE = "nieuzywana";
/* Poświadczenia są WYMAGANE przez walidację konfiguracji, ale nikt się nimi
   nie loguje: `buildApp` nie otwiera połączenia, a zadanie kończy się na
   wejściu do kolejki. */
process.env.MSSQL_USER = "wertis";
process.env.MSSQL_PASSWORD = "nieuzywane";
process.env.ZDJECIA_ZRODLO = "blob";
process.env.ZDJECIA_TABELA = "tw_ZdjecieTw";
process.env.ZDJECIA_KOLUMNA_KLUCZA = "zd_IdTowar";
process.env.ZDJECIA_KOLUMNA = "zd_Zdjecie";
process.env.ZDJECIA_KOLUMNA_GLOWNE = "zd_Glowne";
process.env.ZDJECIA_KOLUMNA_KOLEJNOSC = "zd_Id";
process.env.ZDJECIA_DODAWANIE = "subiekt";
process.env.TLO_URL = "";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let token: string;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zdjecie_wlasne", "zdjecie_podglad", "sfera_queue", "device_session", "app_user", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Kosa','590','')"
  ).run();
  const u = createUser("Jan Testowy", "magazynier");
  token = "tok-subiekt";
  const teraz = new Date().toISOString();
  d.prepare(
    "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
  ).run(token, u.userId, "test-device", teraz, teraz);
});

const naglowki = () => ({ "x-session": token });

async function dodajZdjecie(): Promise<Record<string, unknown>> {
  const w = await app.inject({
    method: "POST",
    url: "/api/products/1/zdjecie/wstepne",
    headers: naglowki(),
    payload: { zdjecie: JPEG.toString("base64") },
  });
  assert.equal(w.statusCode, 200, w.payload);
  const r = await app.inject({
    method: "POST",
    url: "/api/products/1/zdjecie",
    headers: naglowki(),
    payload: { podgladId: w.json().podgladId, zTlem: true, zrodlo: "galeria" },
  });
  assert.equal(r.statusCode, 200, r.payload);
  return r.json();
}

test("zatwierdzenie zakłada zadanie set_zdjecie z samym twId w payloadzie", async () => {
  const odp = await dodajZdjecie();
  assert.equal(odp.wSubiekcie, true);
  assert.ok(odp.queueId);

  const z = db()
    .prepare("SELECT id, type, payload, status, tw_id, label FROM sfera_queue")
    .all() as Array<{ id: number; type: string; payload: string; status: string; tw_id: number; label: string }>;
  assert.equal(z.length, 1);
  assert.equal(z[0].type, "set_zdjecie");
  assert.equal(z[0].status, "pending");
  assert.equal(z[0].tw_id, 1);
  assert.match(z[0].label, /W32-0203/);

  /* Payload to SAM `twId`. Bajty zostają w `zdjecie_wlasne`: kolumna `payload`
     jest czytana przy każdym obrocie pętli workera, a 300 kB w niej to 300 kB
     odczytu co sekundę przez cały czas życia zadania. */
  assert.deepEqual(JSON.parse(z[0].payload), { twId: 1 });
  assert.ok(z[0].payload.length < 200, `payload ma ${z[0].payload.length} znaków — bajty tam nie wchodzą`);
});

test("zdjęcie jest na karcie OD RAZU, nie dopiero po wykonaniu zadania", async () => {
  await dodajZdjecie();
  const g = await app.inject({ method: "GET", url: "/api/products/1/zdjecie", headers: naglowki() });
  assert.equal(g.statusCode, 200);
  assert.equal(g.rawPayload.length, JPEG.length);
  assert.equal(
    (db().prepare("SELECT status FROM sfera_queue").get() as { status: string }).status,
    "pending",
    "karta rysuje kopię zapasową, a nie skutek zadania"
  );
});

test("wiersz kopii zapasowej niesie numer swojego zadania", async () => {
  const odp = await dodajZdjecie();
  const w = db().prepare("SELECT queue_id, tlo_usuniete, dodane_by FROM zdjecie_wlasne WHERE tw_id = 1").get() as
    | { queue_id: number; tlo_usuniete: number; dodane_by: string }
    | undefined;
  assert.ok(w);
  assert.equal(w.queue_id, odp.queueId);
  // zatwierdzono przyciskiem „ZOSTAW TŁO"
  assert.equal(w.tlo_usuniete, 0);
  assert.equal(w.dodane_by, "Jan Testowy");
});

test("ślad audytowy niesie numer zadania i źródło kadru", async () => {
  const odp = await dodajZdjecie();
  const e = db()
    .prepare("SELECT payload FROM events WHERE type = 'zdjecie_dodane'")
    .get() as { payload: string };
  const p = JSON.parse(e.payload);
  assert.equal(p.queueId, odp.queueId);
  assert.equal(p.zrodlo, "galeria");
  assert.equal(p.tloUsuniete, false);
});
