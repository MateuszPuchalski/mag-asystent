import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── KARTON: rozkładanie od zera (0.122.0) ───────────────────────────────────
   Karton to towar źle zebrany, odłożony przez pakujących do jednego pudła.
   Testy pilnują trzech rzeczy, z których każda jest osobną obietnicą:

     1. zbieranie sumuje skany, a nie mnoży pozycje,
     2. po ZATWIERDŹ karton jest zwykłym koszem — rozkładają go ISTNIEJĄCE
        trasy /api/kosze/*,
     3. ZAKOŃCZ nie wystawia ŻADNEGO dokumentu, bo towar nie opuścił magazynu.

   Punkt trzeci jest tu najważniejszy: MM ZWROTY→MAG zdjęłoby z bufora zwrotów
   stan, którego na tym buforze nigdy nie było.                               */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-karton-")), "t.db");
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
    "sgt_towar", "sfera_queue", "events", "device_session", "app_user",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("UPDATE counters SET value = 0 WHERE name = 'karton'").run();
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,?)");
  ins.run(900_101, "KAR-A", "Towar z półki A", "5901000001010", "A01-02-03");
  ins.run(900_102, "KAR-B", "Towar bez adresu", "5901000001027", "");
});

function zalogowany(rola: Rola): Record<string, string> {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "kolektor-1", teraz, teraz);
  return { "x-session": token };
}

test("cała droga kartonu: pusty → skany → ZATWIERDŹ → półki → ZAKOŃCZ bez dokumentu", async () => {
  const magazynier = zalogowany("magazynier");

  let r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);
  const karton = r.json().kosz;
  assert.equal(karton.status, "otwarty");
  assert.equal(karton.rodzaj, "karton");
  assert.equal(karton.kod, "K-1", "kod nadaje aplikacja — w Subiekcie nie ma go skąd wziąć");
  assert.deepEqual(karton.pozycje, [], "panel otwiera się PUSTY i to jest cały pomysł");

  // dwa skany tego samego towaru = jedna pozycja o ilości 2
  for (let i = 0; i < 2; i++) {
    r = await app.inject({
      method: "POST", url: `/api/kartony/${karton.id}/pozycje`,
      payload: { code: "5901000001010" }, headers: magazynier,
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal(r.json().ilosc, 2);
  assert.equal(r.json().symbol, "KAR-A");

  // symbol z klawiatury działa tak samo jak skan — etykieta bywa zdarta
  r = await app.inject({
    method: "POST", url: `/api/kartony/${karton.id}/pozycje`,
    payload: { code: "KAR-B", ilosc: 100 }, headers: magazynier,
  });
  assert.equal(r.statusCode, 200, r.body);
  const bId = r.json().pozycjaId;
  assert.equal(r.json().ilosc, 100, "sto sztuk wpisuje się, a nie klika sto razy");

  r = await app.inject({ method: "GET", url: `/api/kosze/${karton.id}`, headers: magazynier });
  assert.equal(r.json().kosz.pozycje.length, 2);

  // przed ZATWIERDŹ odkładanie ODMAWIA — nie ma jeszcze czego rozkładać
  r = await app.inject({
    method: "POST", url: `/api/kosze/pozycje/${bId}/odloz`,
    payload: { lokalizacja: "B01-01-01" }, headers: magazynier,
  });
  assert.equal(r.statusCode, 400);

  r = await app.inject({ method: "POST", url: `/api/kartony/${karton.id}/zatwierdz`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().kosz.status, "zamkniety");

  // od tej chwili karton jest zwykłym koszem: te same trasy, ten sam skan
  r = await app.inject({
    method: "POST", url: `/api/kosze/${karton.id}/skan`,
    payload: { code: "5901000001010" }, headers: magazynier,
  });
  assert.ok(r.json().pozycjaId);

  for (const p of r.json().pozycjaId ? (await app.inject({
    method: "GET", url: `/api/kosze/${karton.id}`, headers: magazynier,
  })).json().kosz.pozycje : []) {
    r = await app.inject({
      method: "POST", url: `/api/kosze/pozycje/${p.id}/odloz`,
      payload: { lokalizacja: p.lokOczekiwana ?? "B01-01-01" }, headers: magazynier,
    });
    assert.equal(r.statusCode, 200, r.body);
  }

  r = await app.inject({ method: "POST", url: `/api/kosze/${karton.id}/zakoncz`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().kosz.status, "rozlozony");

  /* SEDNO. Towar wrócił na półkę, z której ktoś go wcześniej zdjął — magazyn
     przez cały ten czas miał go u siebie. Jedyny ślad w kolejce to zapis
     adresu towaru, który dotąd adresu nie miał. */
  const zadania = db()
    .prepare("SELECT type, COUNT(*) AS n FROM sfera_queue GROUP BY type")
    .all() as Array<{ type: string; n: number }>;
  assert.deepEqual(
    zadania.map((z) => [z.type, z.n]),
    [["set_location", 1]],
    "karton nie wystawia ŻADNEGO dokumentu — jedyny zapis to adres towaru, który go nie miał"
  );
});

test("karton i kosz zwrotów nie mieszają się na listach kolektora", async () => {
  const magazynier = zalogowany("magazynier");
  const d = db();
  d.prepare(
    "INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez) VALUES ('KZ-99','zamkniety','zwroty',?,'biuro')"
  ).run(new Date().toISOString());

  let r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
  const kartonId = r.json().kosz.id;
  await app.inject({
    method: "POST", url: `/api/kartony/${kartonId}/pozycje`,
    payload: { code: "KAR-A" }, headers: magazynier,
  });
  await app.inject({ method: "POST", url: `/api/kartony/${kartonId}/zatwierdz`, headers: magazynier });

  r = await app.inject({ method: "GET", url: "/api/kosze", headers: magazynier });
  assert.deepEqual(r.json().kosze.map((k: { kod: string }) => k.kod), ["KZ-99"]);

  r = await app.inject({ method: "GET", url: "/api/kartony", headers: magazynier });
  assert.deepEqual(r.json().kartony.map((k: { kod: string }) => k.kod), ["K-1"]);

  /* Kolektor skanujący kartkę z kosza NIE ma trafiać w karton: kartonu nikt
     nie opisał długopisem, więc trafienie byłoby pomyłką udającą sukces. */
  r = await app.inject({ method: "GET", url: "/api/kosze/kod/K-1", headers: magazynier });
  assert.equal(r.statusCode, 404);
});

test("otwarty karton wolno poprawiać, zatwierdzonego już nie", async () => {
  const magazynier = zalogowany("magazynier");
  let r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
  const id = r.json().kosz.id;

  r = await app.inject({
    method: "POST", url: `/api/kartony/${id}/pozycje`, payload: { code: "KAR-A", ilosc: 3 }, headers: magazynier,
  });
  const pozycjaId = r.json().pozycjaId;

  // wpis NADPISUJE: ktoś policzył zawartość i mówi, ile jej jest
  r = await app.inject({
    method: "POST", url: `/api/kartony/pozycje/${pozycjaId}/ilosc`, payload: { ilosc: 7 }, headers: magazynier,
  });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "GET", url: `/api/kosze/${id}`, headers: magazynier });
  assert.equal(r.json().kosz.pozycje[0].ilosc, 7);

  // pomyłka palca odpada zamiast zostać przycięta
  r = await app.inject({
    method: "POST", url: `/api/kartony/pozycje/${pozycjaId}/ilosc`, payload: { ilosc: 1_000_000 }, headers: magazynier,
  });
  assert.equal(r.statusCode, 400);

  // nieznany kod nie zakłada pozycji-widma
  r = await app.inject({
    method: "POST", url: `/api/kartony/${id}/pozycje`, payload: { code: "NIE-MA-TAKIEGO" }, headers: magazynier,
  });
  assert.equal(r.json().nieznany, true);

  r = await app.inject({ method: "DELETE", url: `/api/kartony/pozycje/${pozycjaId}`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);

  // pusty karton nie ma czego rozkładać
  r = await app.inject({ method: "POST", url: `/api/kartony/${id}/zatwierdz`, headers: magazynier });
  assert.equal(r.statusCode, 400);

  r = await app.inject({
    method: "POST", url: `/api/kartony/${id}/pozycje`, payload: { code: "KAR-A" }, headers: magazynier,
  });
  const drugaId = r.json().pozycjaId;
  await app.inject({ method: "POST", url: `/api/kartony/${id}/zatwierdz`, headers: magazynier });

  /* Po ZATWIERDŹ lista jest zapisem tego, co leży w pudle. Znika z niej przez
     odłożenie albo pominięcie z powodem — nigdy przez skasowanie wiersza. */
  r = await app.inject({ method: "DELETE", url: `/api/kartony/pozycje/${drugaId}`, headers: magazynier });
  assert.equal(r.statusCode, 400);
  r = await app.inject({
    method: "POST", url: `/api/kartony/${id}/pozycje`, payload: { code: "KAR-B" }, headers: magazynier,
  });
  assert.equal(r.statusCode, 400);
});

test("kolejne kartony dostają kolejne kody i nie zderzają się z koszem", async () => {
  const magazynier = zalogowany("magazynier");
  db()
    .prepare("INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez) VALUES ('K-2','otwarty','zwroty',?,'biuro')")
    .run(new Date().toISOString());

  const kody: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
    kody.push(r.json().kosz.kod);
  }
  // K-2 zajęte przez cudzy wiersz, więc licznik idzie dalej zamiast się rozbić
  assert.deepEqual(kody, ["K-1", "K-3", "K-4"]);
});
