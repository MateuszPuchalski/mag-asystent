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

test("wskazanie z listy dodaje DOKŁADNIE ten towar, a nie ten o podobnym napisie", async () => {
  const magazynier = zalogowany("magazynier");
  let r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
  const id = r.json().kosz.id;

  /* Wyszukiwarka oddaje wiersz kartoteki, który człowiek obejrzał wzrokiem —
     symbol, nazwę i półkę. Ponowne rozwiązywanie go z napisu cofałoby tę
     decyzję, więc kolektor posyła `twId` i serwer ma go uszanować. */
  r = await app.inject({
    method: "POST", url: `/api/kartony/${id}/pozycje`,
    payload: { twId: 900_102, code: "KAR-A", ilosc: 2 }, headers: magazynier,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().symbol, "KAR-B", "twId ma pierwszeństwo przed napisem");

  // towar spoza kartoteki nie zakłada pozycji-widma, tak samo jak nieznany kod
  r = await app.inject({
    method: "POST", url: `/api/kartony/${id}/pozycje`,
    payload: { twId: 999_999 }, headers: magazynier,
  });
  assert.equal(r.json().nieznany, true);
});

test("ANULUJ: pusty karton znika, karton z zawartością zostaje ze śladem", async () => {
  const magazynier = zalogowany("magazynier");

  // pusty — pomyłka palca, nie historia
  let r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
  const pusty = r.json().kosz.id;
  r = await app.inject({ method: "POST", url: `/api/kartony/${pusty}/anuluj`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().usuniety, true);
  assert.equal(db().prepare("SELECT id FROM kosz WHERE id = ?").get(pusty), undefined);

  // z zawartością — ktoś to zeskanował i odszedł; biuro o to zapyta
  r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
  const pelny = r.json().kosz.id;
  await app.inject({
    method: "POST", url: `/api/kartony/${pelny}/pozycje`,
    payload: { code: "KAR-A", ilosc: 3 }, headers: magazynier,
  });
  r = await app.inject({ method: "POST", url: `/api/kartony/${pelny}/anuluj`, headers: magazynier });
  assert.equal(r.json().usuniety, false);
  const w = db().prepare("SELECT status, anulowano_przez FROM kosz WHERE id = ?").get(pelny) as
    | { status: string; anulowano_przez: string }
    | undefined;
  assert.equal(w?.status, "anulowany");
  assert.equal(w?.anulowano_przez, "Ktoś magazynier");
  const poz = db().prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id = ?").get(pelny) as { n: number };
  assert.equal(poz.n, 1, "pozycje zostają — to ślad po pracy, która się wydarzyła");

  // anulowany wypada z listy kolektora i nie da się go już zatwierdzić
  r = await app.inject({ method: "GET", url: "/api/kartony", headers: magazynier });
  assert.deepEqual(r.json().kartony.map((k: { id: number }) => k.id), []);
  r = await app.inject({ method: "POST", url: `/api/kartony/${pelny}/zatwierdz`, headers: magazynier });
  assert.equal(r.statusCode, 400);
});

test("ANULUJ po ZATWIERDŹ nie cofa tego, co już stoi na półce", async () => {
  const magazynier = zalogowany("magazynier");
  let r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
  const id = r.json().kosz.id;
  for (const code of ["KAR-A", "KAR-B"]) {
    await app.inject({
      method: "POST", url: `/api/kartony/${id}/pozycje`, payload: { code }, headers: magazynier,
    });
  }
  await app.inject({ method: "POST", url: `/api/kartony/${id}/zatwierdz`, headers: magazynier });

  // KAR-B nie ma adresu w kartotece, więc jego odłożenie zostawia zadanie w kolejce
  r = await app.inject({ method: "GET", url: `/api/kosze/${id}`, headers: magazynier });
  const bezAdresu = r.json().kosz.pozycje.find((p: { symbol: string }) => p.symbol === "KAR-B");
  r = await app.inject({
    method: "POST", url: `/api/kosze/pozycje/${bezAdresu.id}/odloz`,
    payload: { lokalizacja: "B01-01-01" }, headers: magazynier,
  });
  assert.equal(r.statusCode, 200, r.body);

  r = await app.inject({ method: "POST", url: `/api/kartony/${id}/anuluj`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);

  /* SEDNO. Towar naprawdę stoi na B01-01-01 i zapis tego adresu jest prawdą
     o magazynie. Anulowanie dotyczy pracy, która ZOSTAŁA do zrobienia. */
  const poz = db()
    .prepare("SELECT status FROM kosz_pozycja WHERE id = ?")
    .get(bezAdresu.id) as { status: string };
  assert.equal(poz.status, "done");
  const zad = db()
    .prepare("SELECT status FROM sfera_queue WHERE type='set_location'")
    .all() as Array<{ status: string }>;
  assert.equal(zad.length, 1);
  assert.notEqual(zad[0].status, "cancelled", "zapis adresu zostaje — półka nie kłamie");

  // dziennik niesie, ILE roboty zostało nietkniętej przy anulowaniu
  const ev = db()
    .prepare("SELECT payload FROM events WHERE type='karton_anulowany' ORDER BY id DESC LIMIT 1")
    .get() as { payload: string };
  assert.deepEqual(JSON.parse(ev.payload).odlozonych, 1);
  assert.deepEqual(JSON.parse(ev.payload).zostalo, 1);
});

test("kod anulowanego kartonu wraca do obiegu", async () => {
  const magazynier = zalogowany("magazynier");
  let r = await app.inject({ method: "POST", url: "/api/kartony", headers: magazynier });
  const id = r.json().kosz.id;
  assert.equal(r.json().kosz.kod, "K-1");
  await app.inject({
    method: "POST", url: `/api/kartony/${id}/pozycje`, payload: { code: "KAR-A" }, headers: magazynier,
  });
  await app.inject({ method: "POST", url: `/api/kartony/${id}/anuluj`, headers: magazynier });

  /* Indeks `ix_kosz_kod_aktywny` pomija anulowane od 0.123.0. Bez tego kosz
     o tym kodzie rozbiłby się o unikalność — a kod nadaje aplikacja, nie
     etykieta na pudle, więc trzymanie go w rezerwie nikomu nie służy. */
  db()
    .prepare("INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez) VALUES ('K-1','otwarty','zwroty',?,'biuro')")
    .run(new Date().toISOString());
  const ile = db().prepare("SELECT COUNT(*) AS n FROM kosz WHERE kod='K-1'").get() as { n: number };
  assert.equal(ile.n, 2);
});
