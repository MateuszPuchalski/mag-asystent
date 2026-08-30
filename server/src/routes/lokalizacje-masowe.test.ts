import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasa masowej zmiany lokalizacji ────────────────────────────────────────
   Rachunek jest przedmiotem `services/lokalizacje-masowe.test.ts`; tutaj
   BRAMKA i granica między patrzeniem a zapisem.

   To jest jedyna trasa w aplikacji, która jednym żądaniem zapisuje do bazy
   firmy setki kartotek — więc pilnujemy dwóch rzeczy ponad zwykłą rolę:

     - podgląd NIE kolejkuje ani jednego zadania i nie zostawia wpisu
       `privileged` (reguła „zero zapisu przy patrzeniu"),
     - zapis przechodzi przez `autoryzuj()`, czyli zostawia ślad z nazwą
       operacji, a nie samą nazwą osoby.                                      */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-lokmr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

const URL = "/api/biuro/lokalizacje/arkusz";

beforeEach(() => {
  const d = db();
  for (const t of ["sfera_queue", "sgt_towar", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const t = d.prepare(
    "INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,lokalizacja) VALUES (?,?,?,?,?)"
  );
  t.run(1, "W32-0203", "Kosa spalinowa", "5901234567890", "A01-01-05");
  t.run(2, "19-25031", "Pasek napędu noży", "", "A01-01-01");
});

function zalogowany(rola: Rola): string {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "biurko-1", teraz, teraz);
  return token;
}

async function wyslij(token: string | null, payload: Record<string, unknown>) {
  return await app.inject({
    method: "POST",
    url: URL,
    headers: token ? { "x-session": token } : {},
    payload,
  });
}

const zadan = (): number =>
  (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue").get() as { n: number }).n;

const wpisow = (typ: string): number =>
  (db().prepare("SELECT COUNT(*) AS n FROM events WHERE type = ?").get(typ) as { n: number }).n;

const ARKUSZ = [{ symbol: "W32-0203", lokalizacja: "A10-06-01" }];

/* ── Bramka ──────────────────────────────────────────────────────────────── */

test("bez sesji 401 — arkusz przestawia adresy całego regału", async () => {
  const r = await wyslij(null, { wiersze: ARKUSZ });
  assert.equal(r.statusCode, 401);
  assert.equal(zadan(), 0);
});

test("magazynier i biuro dostają 403 — to operacja administratora", async () => {
  /* Biuro celowo NIE ma tu wstępu, choć ma go do importu zbiórek i reguł
     strefy. Tamte zmieniają dane, z których liczą się PODPOWIEDZI; ta zmienia
     adresy w bazie firmy, a magazynier przy regale znajdzie towar tam, gdzie
     ten arkusz powiedział. */
  for (const rola of ["magazynier", "biuro"] as Rola[]) {
    const r = await wyslij(zalogowany(rola), { wiersze: ARKUSZ });
    assert.equal(r.statusCode, 403, rola);
    assert.match(r.json().error, /administrator/);
  }
  assert.equal(zadan(), 0);
});

/* ── Podgląd niczego nie zapisuje ────────────────────────────────────────── */

test("podgląd liczy raport i NIE kolejkuje ani jednego zadania", async () => {
  const r = await wyslij(zalogowany("admin"), { wiersze: ARKUSZ });
  assert.equal(r.statusCode, 200);
  const raport = r.json();
  assert.equal(raport.doZmiany.length, 1);
  assert.equal(raport.zakolejkowano, null);
  assert.equal(zadan(), 0);
});

test("podgląd nie zostawia wpisu `privileged` — wybranie pliku to nie operacja", async () => {
  /* `autoryzuj()` pisze do dziennika przy każdym wywołaniu. Wołane przy
     podglądzie zamieniłoby audyt w zapis tego, ile razy ktoś otworzył plik —
     dokładnie ten szum, który 0.52.3 z dziennika usuwało. */
  await wyslij(zalogowany("admin"), { wiersze: ARKUSZ });
  assert.equal(wpisow("privileged"), 0);
});

/* ── Zapis ───────────────────────────────────────────────────────────────── */

test("zastosuj kolejkuje zmiany i zostawia ślad operacji uprzywilejowanej", async () => {
  const r = await wyslij(zalogowany("admin"), { wiersze: ARKUSZ, zastosuj: true });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().zakolejkowano, 1);
  assert.equal(zadan(), 1);
  assert.equal(wpisow("privileged"), 1);
  assert.equal(wpisow("location_set"), 1);
});

test("zastosuj liczy raport PONOWNIE, na świeżym stanie kartoteki", async () => {
  /* Między obejrzeniem podglądu a kliknięciem ktoś przy regale mógł przestawić
     ten sam adres z kolektora. Gdyby trasa ufała raportowi z podglądu,
     zapisałaby stan, którego już nie ma. */
  const token = zalogowany("admin");
  const podglad = await wyslij(token, { wiersze: ARKUSZ });
  assert.equal(podglad.json().doZmiany.length, 1);

  db().prepare("UPDATE sgt_towar SET lokalizacja = ? WHERE tw_id = 1").run("A10-06-01");

  const zapis = await wyslij(token, { wiersze: ARKUSZ, zastosuj: true });
  assert.equal(zapis.json().bezZmian, 1);
  assert.equal(zapis.json().zakolejkowano, 0);
  assert.equal(zadan(), 0);
});

/* ── Wejście CSV ─────────────────────────────────────────────────────────── */

test("CSV daje ten sam raport, co wiersze z przeglądarki", async () => {
  const csv = [
    "S,Rodzaj,Symbol,Nazwa,Lokalizacja SIE",
    ",towar,W32-0203,Kosa spalinowa,A10-06-01",
  ].join("\r\n");
  const r = await wyslij(zalogowany("admin"), { csv });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().doZmiany.length, 1);
  assert.equal(r.json().doZmiany[0].po, "A10-06-01");
});

test("CSV bez kolumny Lokalizacja odmawia i wypisuje znalezione nagłówki", async () => {
  /* Komunikat ma nazwać to, co widział — bez tego „zły plik" zostawia
     człowieka przed pytaniem, którego pliku dotyczy problem. */
  const csv = ["Symbol,Nazwa", "W32-0203,Kosa"].join("\r\n");
  const r = await wyslij(zalogowany("admin"), { csv });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /nazwa/i);
});

test("body bez wierszy i bez csv odmawia, zamiast liczyć pusty raport", async () => {
  const r = await wyslij(zalogowany("admin"), {});
  assert.equal(r.statusCode, 400);
});
