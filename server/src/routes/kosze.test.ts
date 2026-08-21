import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy koszy zwrotowych ──────────────────────────────────────────────────
   Logika jest przedmiotem `services/kosze.test.ts`; tutaj bramki i pełny
   przepływ przez HTTP: biuro przypina i zamyka, HALA rozkłada i kończy.
   Podział ról jest tu treścią: magazynier NIE zamyka koszy, ale rozkłada —
   trasy /api/kosze/* muszą działać na roli magazynier.                       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-koszr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of [
    "kosz_pozycja", "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot", "kosz",
    "sgt_sprzedaz_pozycja", "sgt_sprzedaz", "sgt_towar", "sfera_queue",
    "events", "device_session", "app_user",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,?)");
  ins.run(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta", "", "A01-02-03");
  ins.run(900_037, "TEST-LINIA-DONE", "Pozycja odłożona w całości", "5900000000037", "");
  d.prepare(
    "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, mag_id) VALUES (101,'FS','FS 101/08/2026','dev-ord-1',?, 'ALLEGRO', 1)"
  ).run(new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10));
  const poz = d.prepare("INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (101,?,?)");
  poz.run(900_036, 1);
  poz.run(900_037, 2);
});

function zalogowany(rola: Rola): Record<string, string> {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "biurko-1", teraz, teraz);
  return { "x-session": token };
}

async function zwrotWKoszu(biuro: Record<string, string>): Promise<{ zwrotId: number; koszId: number }> {
  let r = await app.inject({ method: "POST", url: "/api/biuro/zwroty/skan", payload: { kod: "DEVWB0001" }, headers: biuro });
  const zwrot = r.json().zwrot;
  for (const p of zwrot.pozycje) {
    await app.inject({
      method: "POST",
      url: `/api/biuro/zwroty/${zwrot.id}/pozycje/${p.id}/decyzja`,
      payload: { decyzja: "pelnowartosciowy" },
      headers: biuro,
    });
  }
  r = await app.inject({ method: "POST", url: `/api/biuro/zwroty/${zwrot.id}/dokumenty`, headers: biuro });
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(r.json().zwrot.dokumenty.queueId);
  r = await app.inject({ method: "POST", url: `/api/biuro/zwroty/${zwrot.id}/kosz`, payload: { kod: "KZ-07" }, headers: biuro });
  assert.equal(r.statusCode, 200);
  return { zwrotId: zwrot.id, koszId: r.json().zwrot.kosz.id };
}

test("bramki: przypinanie i zamykanie to biuro, rozkładanie działa na magazynierze", async () => {
  const magazynier = zalogowany("magazynier");
  let r = await app.inject({ method: "POST", url: "/api/biuro/zwroty/1/kosz", payload: { kod: "X" }, headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/kosze", headers: magazynier });
  assert.equal(r.statusCode, 403);
  // hala bez sesji — bramka globalna
  r = await app.inject({ method: "GET", url: "/api/kosze" });
  assert.equal(r.statusCode, 401);
  r = await app.inject({ method: "GET", url: "/api/kosze", headers: magazynier });
  assert.equal(r.statusCode, 200);
});

test("pełny przepływ: kosz na karcie, zamknięcie, rozkładanie, cofnięcie bufora", async () => {
  const biuro = zalogowany("biuro");
  const magazynier = zalogowany("magazynier");
  const { zwrotId, koszId } = await zwrotWKoszu(biuro);

  // karta zwrotu pokazuje kosz
  let r = await app.inject({ method: "GET", url: `/api/biuro/zwroty/${zwrotId}`, headers: biuro });
  assert.equal(r.json().zwrot.kosz.kod, "KZ-07");

  r = await app.inject({ method: "POST", url: `/api/biuro/kosze/${koszId}/zamknij`, headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().kosz.pozycje.length, 2);

  // hala: kosz widoczny po kodzie z etykiety
  r = await app.inject({ method: "GET", url: "/api/kosze/kod/KZ-07", headers: magazynier });
  assert.equal(r.statusCode, 200);
  const kosz = r.json().kosz;

  // skan towaru wskazuje pozycję; odkładanie po kolei
  r = await app.inject({
    method: "POST", url: `/api/kosze/${koszId}/skan`, payload: { code: "5900000000037" }, headers: magazynier,
  });
  assert.ok(r.json().pozycjaId);
  for (const p of kosz.pozycje) {
    r = await app.inject({
      method: "POST",
      url: `/api/kosze/pozycje/${p.id}/odloz`,
      payload: { lokalizacja: p.lokOczekiwana ?? "B01-01-01" },
      headers: magazynier,
    });
    assert.equal(r.statusCode, 200, r.body);
  }

  r = await app.inject({ method: "POST", url: `/api/kosze/${koszId}/zakoncz`, headers: magazynier });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().kosz.status, "rozlozony");
  const mm = db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number };
  assert.equal(mm.n, 2, "bufor cofa się sam — MM per pozycja");

  // autor zadań MM = magazynier z sesji, nie biuro
  const autorzy = db().prepare("SELECT DISTINCT created_by FROM sfera_queue WHERE type='mm'").all() as Array<{ created_by: string }>;
  assert.deepEqual(autorzy.map((a) => a.created_by), ["Ktoś magazynier"]);
});

test("reklamacje i raport odpowiadają przez HTTP z bramką biura", async () => {
  const biuro = zalogowany("biuro");
  const magazynier = zalogowany("magazynier");
  let r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/reklamacje", headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/reklamacje", headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().reklamacje, []);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/raport", headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.equal(typeof r.json().raport.zwroty.razem30dni, "number");
  // brakujące paczki (Etap 4) — ta sama bramka biura, pusta lista bez przebiegu tickera
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/zapowiedzi", headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/zapowiedzi", headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().zapowiedzi, []);
  // schowanie zapowiedzi (0.70.0) — bramka biura, a nieznane id to 404, nie 500
  r = await app.inject({ method: "POST", url: "/api/biuro/zwroty/zapowiedzi/1/pomin", payload: {}, headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "POST", url: "/api/biuro/zwroty/zapowiedzi/1/pomin", payload: {}, headers: biuro });
  assert.equal(r.statusCode, 404);
  // półka reklamacyjna i dyskusje Allegro (Etap 6) — bramka biura
  r = await app.inject({
    method: "PUT", url: "/api/biuro/zwroty/reklamacje/1/polka",
    payload: { polka: "REK-01" }, headers: magazynier,
  });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/dyskusje", headers: biuro });
  assert.equal(r.statusCode, 200);
  const dyskusje = r.json().dyskusje;
  assert.equal(dyskusje.length, 2, "adapter dev daje rozmowę i formalną reklamację");
  assert.ok(dyskusje.some((y: { typ: string }) => y.typ === "CLAIM"));
});
