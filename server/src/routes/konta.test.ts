import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Zakładanie i odbieranie kont: dwa stopnie, nie jeden ────────────────────
   Do 0.24.0 „zarządzanie kontami" było jedną operacją zastrzeżoną dla biura.
   Wyglądało to na zamknięte, a nie było: biuro zakładało konto o roli `biuro`
   z własnym hasłem, czyli rola strzegąca tożsamości rozdawała ją sama sobie.

   Gorsze było to obok. `POST /api/users` brał `role` prosto z ciała żądania,
   `createUser` wkładał je do `INSERT`, a kolumna `role` nie ma `CHECK` — więc
   do bazy wchodziło DOWOLNE słowo. Rola nieznana `WYMAGANA_ROLA` nie dostawała
   żadnych uprawnień, ale samo `{"role":"admin"}` po 0.24.0 dałoby wszystko.

   Ten plik opisuje obie granice od strony TRASY, bo `services/auth.test.ts`
   sprawdza samą mapę uprawnień i nie widzi, czy trasa o nią w ogóle pyta.    */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-konta-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
type Rola = import("../services/users.js").Rola;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  for (const t of ["events", "device_session", "app_user"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

/** Konto danej roli + gotowa sesja; zwraca nagłówki do `app.inject`. */
function jako(rola: Rola): { headers: { "x-session": string }; userId: number } {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "kolektor-7", teraz, teraz);
  return { headers: { "x-session": token }, userId: u.userId };
}

/** Założenie konta cudzą sesją — zwraca surową odpowiedź, nie rzuca. */
const zaloz = (
  sesja: { headers: { "x-session": string } },
  body: Record<string, unknown>
) =>
  app.inject({
    method: "POST",
    url: "/api/users",
    headers: sesja.headers,
    payload: { name: "Nowa Osoba", login: "nowa", haslo: "tajnehaslo", ...body },
  });

/* ── Walidacja roli ──────────────────────────────────────────────────────── */

test("rola spoza listy odpada z 400, zanim ktokolwiek sprawdzi uprawnienia", async () => {
  /* NAJWAŻNIEJSZY test tego pliku. Bez niego cała rola `admin` jest dekoracją:
     wystarczyłoby jedno żądanie z rolą wpisaną z palca. 400, a nie 403, bo to
     odpowiedź na KSZTAŁT żądania — sprawdzenie stoi przed autoryzacją. */
  const admin = jako("admin");
  for (const zla of ["administrator", "ADMIN", "root", "", "biuro ", "magazynier;--"]) {
    const r = await zaloz(admin, { role: zla });
    assert.equal(r.statusCode, 400, zla);
    assert.match(r.json().error, /Rola musi być/);
  }
  const puste = db().prepare("SELECT COUNT(*) n FROM app_user WHERE login = 'nowa'").get() as {
    n: number;
  };
  assert.equal(puste.n, 0, "żadna z prób nie zostawiła wiersza");
});

test("pominięta rola znaczy magazynier, a nie „cokolwiek”", async () => {
  const r = await zaloz(jako("biuro"), {});
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().user.role, "magazynier");
});

/* ── Pierwszy stopień: biuro zakłada halę ────────────────────────────────── */

test("biuro zakłada magazyniera i brygadzistę", async () => {
  const biuro = jako("biuro");
  for (const rola of ["magazynier", "brygadzista"] as const) {
    const r = await zaloz(biuro, { role: rola, login: `nowa-${rola}` });
    assert.equal(r.statusCode, 200, rola);
    assert.equal(r.json().user.role, rola);
  }
});

/* ── Drugi stopień: konta biura i adminów ────────────────────────────────── */

test("biuro NIE założy konta biura ani admina", async () => {
  const biuro = jako("biuro");
  for (const rola of ["biuro", "admin"] as const) {
    const r = await zaloz(biuro, { role: rola, login: `nowa-${rola}` });
    assert.equal(r.statusCode, 403, rola);
    assert.match(r.json().error, /administratora/i);
  }
});

test("admin założy oba", async () => {
  const admin = jako("admin");
  for (const rola of ["biuro", "admin"] as const) {
    const r = await zaloz(admin, { role: rola, login: `nowa-${rola}` });
    assert.equal(r.statusCode, 200, rola);
    assert.equal(r.json().user.role, rola);
  }
});

test("biuro nie wyłączy konta i nie odbierze hasła", async () => {
  /* Cena tej granicy jest jawna i właściciel ją wybrał: biuro nie zresetuje
     hasła magazynierowi, który je zapomniał — musi poprosić admina. */
  const ofiara = createUser("Jan Testowy", "magazynier", "jtestowy", "tajnehaslo");
  const biuro = jako("biuro");
  for (const [url, payload] of [
    [`/api/users/${ofiara.userId}/active`, { active: false }],
    [`/api/users/${ofiara.userId}/haslo`, { haslo: null }],
  ] as const) {
    const r = await app.inject({ method: "POST", url, headers: biuro.headers, payload });
    assert.equal(r.statusCode, 403, url);
  }
  const po = db()
    .prepare("SELECT active, haslo_hash FROM app_user WHERE user_id = ?")
    .get(ofiara.userId) as { active: number; haslo_hash: string | null };
  assert.equal(po.active, 1, "konto dalej czynne");
  assert.ok(po.haslo_hash, "hasło nietknięte");
});

test("admin wyłącza konto i odbiera hasło, a audyt notuje KTO", async () => {
  const ofiara = createUser("Jan Testowy", "magazynier", "jtestowy", "tajnehaslo");
  const admin = jako("admin");
  for (const [url, payload] of [
    [`/api/users/${ofiara.userId}/active`, { active: false }],
    [`/api/users/${ofiara.userId}/haslo`, { haslo: null }],
  ] as const) {
    const r = await app.inject({ method: "POST", url, headers: admin.headers, payload });
    assert.equal(r.statusCode, 200, url);
  }
  const po = db()
    .prepare("SELECT active, haslo_hash FROM app_user WHERE user_id = ?")
    .get(ofiara.userId) as { active: number; haslo_hash: string | null };
  assert.equal(po.active, 0);
  assert.equal(po.haslo_hash, null, "hasło odebrane, konto zostaje dla historii");

  /* Do 0.24.0 audyt wpisywał tu słowo „biuro" niezależnie od tego, kto zmieniał.
     Reklamacja „ktoś mi wyłączył konto" nie miała wtedy odpowiedzi. */
  const kto = db()
    .prepare("SELECT user_id FROM events WHERE type = 'user_active_changed'")
    .all() as Array<{ user_id: string }>;
  assert.equal(kto.length, 1);
  assert.equal(kto[0].user_id, "Ktoś admin");
});

/* ── Lista kont ──────────────────────────────────────────────────────────── */

test("listę kont widzą biuro i admin, hala nie", async () => {
  for (const rola of ["biuro", "admin"] as const) {
    const r = await app.inject({ method: "GET", url: "/api/users", headers: jako(rola).headers });
    assert.equal(r.statusCode, 200, rola);
  }
  for (const rola of ["magazynier", "brygadzista"] as const) {
    const r = await app.inject({ method: "GET", url: "/api/users", headers: jako(rola).headers });
    assert.equal(r.statusCode, 403, rola);
  }
});
