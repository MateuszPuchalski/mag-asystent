import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wymiana-trasy-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Bramki obu tras miary wymiany ───────────────────────────────────────────
   `services/wymiana.test.ts` pilnuje LICZB. Ten plik pilnuje tego, czego tamten
   nie widzi, bo stoi to na trasie: kto ma prawo je przeczytać i czy patrzenie
   na nie czegoś nie zapisuje.

   Powstał po tej samej nauczce co `routes/ean-kolizje.test.ts`: bramka bez
   testu znika przy pierwszym refaktorze i nikt się nie dowie. Trasa miary
   dostała ją w 0.361.0 i przez jedno wydanie nie miała testu wcale.

   To są liczby o TEMPIE PRACY LUDZI — ile komu zajęło domknięcie sprawy.
   Nie mają po co jeździć poza biuro i to jest cały powód bramki.           */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const m = await import("../index.js");
  app = await m.buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zadanie_terenowe", "problem", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { "x-session": token };
}

const TRASY = ["/api/biuro/wymiana", "/api/biuro/alarm-wymiany"];

test("miarę tempa pracy czyta biuro, nie hala", async () => {
  const magazynier = login("magazynier", "Marek");
  for (const url of TRASY) {
    const r = await app.inject({ method: "GET", url, headers: magazynier });
    assert.equal(r.statusCode, 403, `${url}: ${r.body}`);
  }
});

test("bez sesji nie da się przeczytać żadnej z nich", async () => {
  for (const url of TRASY) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 401, `${url}: ${r.body}`);
  }
});

test("patrzenie na miarę niczego nie zapisuje", async () => {
  /* Umowa „zero zapisu przy patrzeniu" z CLAUDE.md, sprawdzona po skutku,
     a nie po deklaracji: dwa odczyty każdej trasy i ani jednego zdarzenia
     w księdze. Licznik POST-ów w panelu pilnuje tej samej reguły od strony
     ekranu — tu chodzi o samą trasę, do której da się strzelić `curl`-em. */
  const biuro = login("biuro", "Anna");
  const ile = () =>
    (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  const przed = ile();
  for (const url of [...TRASY, ...TRASY]) {
    const r = await app.inject({ method: "GET", url, headers: biuro });
    assert.equal(r.statusCode, 200, `${url}: ${r.body}`);
  }
  assert.equal(ile(), przed, "odczyt miary dopisał zdarzenie do księgi");
});

test("alarm NIE przyjmuje okna z zewnątrz — próg nie może zależeć od pytającego", async () => {
  /* Tabela ma suwak dni i to jest w porządku: odpowiada na pytanie ZADANE.
     Alarm odpowiada na niezadane, więc jego okno jest stałe. Gdyby brał `dni`
     z żądania, ta sama sprawa byłaby spóźniona albo nie w zależności od tego,
     co ktoś wpisał w adres — a plakietka w nagłówku ma znaczyć jedno. */
  const biuro = login("biuro", "Anna");
  const a = await app.inject({ method: "GET", url: "/api/biuro/alarm-wymiany?dni=1", headers: biuro });
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(a.json().dni, 30, "okno alarmu zostaje trzydziestodniowe mimo ?dni=1");

  const t = await app.inject({ method: "GET", url: "/api/biuro/wymiana?dni=7", headers: biuro });
  assert.equal(t.json().dni, 7, "tabela nadal słucha swojego suwaka");
});

test("alarm wymienia wszystkie pięć kanałów ZAWSZE, także bez spraw", async () => {
  /* Kanał, który znika z odpowiedzi przy pustej bazie, wygląda na ekranie
     tak samo jak kanał, w którym nic nie stoi — a to są dwie różne rzeczy. */
  const biuro = login("biuro", "Anna");
  const r = await app.inject({ method: "GET", url: "/api/biuro/alarm-wymiany", headers: biuro });
  const d = r.json();
  assert.deepEqual(
    d.kanaly.map((k: { kanal: string }) => k.kanal),
    ["zadanie", "niezgodnosc", "pominiecie", "kolizja", "notatka"]
  );
  for (const k of d.kanaly) {
    assert.equal(k.progMin, null, `${k.kanal}: pusta baza nie ma z czego liczyć progu`);
    assert.equal(k.podstawa, "za_malo_spraw");
  }
  assert.equal(d.spoznionychRazem, 0);
  assert.equal(d.minSpraw, 10, "ekran ma czym powiedzieć, ILU spraw brakuje do progu");
});
