import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy spraw — jedna kolejka obsługi klienta ─────────────────────────────
   Logika jest przedmiotem `services/sprawy.test.ts`; tutaj bramka ról
   i kształt odpowiedzi przez HTTP. Najważniejsze do sprawdzenia: wszystkie
   trasy są ODCZYTEM za bramką biura, a zły parametr wraca jako 400 ze
   zdaniem, nie jako pusta lista udająca „nic nie ma".                        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sprr-")), "t.db");
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
    "dyskusja", "pytanie", "zwrot_pozycja", "zwrot",
    "events", "device_session", "app_user",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
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

function daneSpraw(): { dyskusjaId: number; zwrotId: number; pytanieId: number; pozycjaId: number } {
  const d = db();
  const teraz = new Date().toISOString();
  const py = d.prepare(
    `INSERT INTO pytanie(zrodlo, kupujacy_login, tresc, otrzymano_at, status,
       produkty_json, utworzono_at, utworzono_przez)
     VALUES ('allegro', 'jan', 'Czy pasuje?', ?, 'nowe', '[]', ?, 'Test')`
  ).run(teraz, teraz);
  const z = d
    .prepare(
      `INSERT INTO zwrot(kupujacy_login, waybill, status, allegro_order_id,
         utworzono_allegro, utworzono_at, utworzono_przez)
       VALUES ('jan', 'WB-1', 'nowy', 'zam-1', ?, ?, 'Test')`
    )
    .run(teraz, teraz);
  const poz = d.prepare(
    `INSERT INTO zwrot_pozycja(zwrot_id, nazwa, ilosc, decyzja, decyzja_at, decyzja_przez)
     VALUES (?, 'Pęknięty nóż', 1, 'reklamacja', ?, 'Test')`
  ).run(Number(z.lastInsertRowid), teraz);
  const dy = d.prepare(
    `INSERT INTO dyskusja(allegro_id, typ, status, temat, kupujacy_login, order_id,
       utworzono_allegro, widziano_at, utworzono_at)
     VALUES ('iss-1', 'CLAIM', 'nowa', 'Pęknięta obudowa', 'jan', 'zam-1', ?, ?, ?)`
  ).run(teraz, teraz, teraz);
  /* Id z bazy, nie „1": rowid nie startuje od zera po DELETE w beforeEach. */
  return {
    dyskusjaId: Number(dy.lastInsertRowid),
    zwrotId: Number(z.lastInsertRowid),
    pytanieId: Number(py.lastInsertRowid),
    pozycjaId: Number(poz.lastInsertRowid),
  };
}

const TRASY = [
  "/api/biuro/sprawy",
  "/api/biuro/sprawy/licznik",
  "/api/biuro/sprawy/klient?login=jan",
  "/api/biuro/sprawy/klienci?q=jan",
  "/api/biuro/sprawy/powiazane?rodzaj=zwrot&id=1",
];

test("bez sesji 401, magazynier 403 — sprawy klientów prowadzi biuro", async () => {
  const token = zalogowany("magazynier");
  for (const url of TRASY) {
    const bez = await app.inject({ method: "GET", url });
    assert.equal(bez.statusCode, 401, url);
    const hala = await app.inject({ method: "GET", url, headers: { "x-session": token } });
    assert.equal(hala.statusCode, 403, url);
  }
});

test("kolejka: cztery rodzaje w jednej liście, filtr rodzaju, zły rodzaj = 400", async () => {
  daneSpraw();
  const naglowki = { "x-session": zalogowany("biuro") };

  const r = await app.inject({ method: "GET", url: "/api/biuro/sprawy", headers: naglowki });
  assert.equal(r.statusCode, 200);
  const rodzaje = r.json().sprawy.map((s: { rodzaj: string }) => s.rodzaj).sort();
  assert.deepEqual(rodzaje, ["dyskusja", "pytanie", "reklamacja", "zwrot"]);
  assert.ok("allegro" in r.json(), "stan połączenia dla banera zakładki");

  const filtr = await app.inject({
    method: "GET", url: "/api/biuro/sprawy?rodzaj=pytanie", headers: naglowki,
  });
  assert.deepEqual(filtr.json().sprawy.map((s: { rodzaj: string }) => s.rodzaj), ["pytanie"]);

  const zly = await app.inject({
    method: "GET", url: "/api/biuro/sprawy?rodzaj=faktura", headers: naglowki,
  });
  assert.equal(zly.statusCode, 400);
  assert.match(zly.json().error, /dozwolone/);
});

test("licznik: pigułka zgodna z długością kolejki", async () => {
  daneSpraw();
  const naglowki = { "x-session": zalogowany("biuro") };
  const licznik = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/licznik", headers: naglowki,
  });
  const kolejka = await app.inject({ method: "GET", url: "/api/biuro/sprawy", headers: naglowki });
  assert.equal(licznik.json().otwartych, kolejka.json().sprawy.length);
});

test("wyszukiwarka klientów: liczba otwartych zgadza się z Klientem 360", async () => {
  /* To jest właściwy niezmiennik tej funkcji, nie kształt odpowiedzi.
     Wyszukiwarka mówi „N spraw czeka", a klik prowadzi do karty, która te
     sprawy wypisuje. Gdyby liczby liczyły się osobno — dwa zestawy warunków
     „otwartości" w dwóch miejscach — rozjechałyby się przy pierwszym nowym
     statusie i wyszłoby to dopiero komuś przy biurku. Dlatego `szukajKlientow`
     woła tych samych budowniczych, co `sprawyKlienta`, a ten test tego pilnuje.

     `daneSpraw()` daje klientowi `jan` po jednej sprawie w KAŻDYM z czterech
     rejestrów — więc test przechodzi przez wszystkie, nie przez jeden. */
  daneSpraw();
  const naglowki = { "x-session": zalogowany("biuro") };

  const szukaj = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klienci?q=ja", headers: naglowki,
  });
  assert.equal(szukaj.statusCode, 200);
  const znaleziony = szukaj.json().klienci.find((k: { login: string }) => k.login === "jan");
  assert.ok(znaleziony, "fragment loginu znajduje klienta");

  const karta = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klient?login=jan", headers: naglowki,
  });
  assert.equal(
    znaleziony.otwartych,
    karta.json().aktywne.length,
    "wyszukiwarka i Klient 360 liczą otwarte sprawy tak samo"
  );
  assert.equal(znaleziony.wszystkich, 4, "po jednej sprawie z każdego rejestru");
});

test("wyszukiwarka klientów znajduje TEŻ tego, kto nie ma nic otwartego", async () => {
  /* Cały powód istnienia tej funkcji. Do Klienta 360 wchodziło się klikiem
     w login NA otwartej sprawie — więc klient bez otwartych spraw był
     nieosiągalny, a to właśnie wtedy się go szuka („dzwonił, co u niego").

     Bez tego testu pierwsza „optymalizacja" zawęzi zapytanie do otwartych
     spraw, wyszukiwarka dalej będzie działać na demo i przestanie robić to
     jedno, po co powstała. */
  const d = db();
  const teraz = new Date().toISOString();
  d.prepare(
    `INSERT INTO pytanie(zrodlo, kupujacy_login, tresc, otrzymano_at, status,
       produkty_json, utworzono_at, utworzono_przez)
     VALUES ('allegro', 'ewa-cicha', 'Dziękuję', ?, 'wyslane', '[]', ?, 'Test')`
  ).run(teraz, teraz);
  const naglowki = { "x-session": zalogowany("biuro") };

  const r = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klienci?q=ewa", headers: naglowki,
  });
  const k = r.json().klienci.find((x: { login: string }) => x.login === "ewa-cicha");
  assert.ok(k, "klient z samą historią jest znajdowalny");
  assert.equal(k.otwartych, 0, "i widać, że nic nie czeka");
  assert.equal(k.wszystkich, 1);
});

test("wyszukiwarka klientów: próg dwóch znaków i cisza o sprawach bez loginu", async () => {
  const d = db();
  const teraz = new Date().toISOString();
  /* Wklejka ze screenshota nie niesie loginu. Kubełek „bez klienta" istnieje
     w `sprawyKlienta(null)`, ale nie ma nazwy, po której dałoby się go
     szukać — więc nie ma prawa wypłynąć w wynikach jako pusty wiersz. */
  d.prepare(
    `INSERT INTO pytanie(zrodlo, kupujacy_login, tresc, otrzymano_at, status,
       produkty_json, utworzono_at, utworzono_przez)
     VALUES ('wklejka', NULL, 'Bez loginu', ?, 'nowe', '[]', ?, 'Test')`
  ).run(teraz, teraz);
  daneSpraw();
  const naglowki = { "x-session": zalogowany("biuro") };

  const krotkie = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klienci?q=j", headers: naglowki,
  });
  assert.equal(krotkie.statusCode, 200, "za krótka fraza to pusty wynik, nie błąd");
  assert.deepEqual(krotkie.json().klienci, []);

  const bezQ = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klienci", headers: naglowki,
  });
  assert.deepEqual(bezQ.json().klienci, [], "brak parametru też jest pusty");

  const szerokie = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klienci?q=an", headers: naglowki,
  });
  for (const k of szerokie.json().klienci) {
    assert.ok(k.login, "żaden wynik nie jest sprawą bez klienta");
  }
});

test("Klient 360 i powiązania: login z querystring, kubełek bez parametru", async () => {
  const { dyskusjaId } = daneSpraw();
  const naglowki = { "x-session": zalogowany("biuro") };

  const jan = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klient?login=jan", headers: naglowki,
  });
  assert.equal(jan.json().login, "jan");
  assert.equal(jan.json().aktywne.length, 4);
  assert.ok(Array.isArray(jan.json().historia));

  const kubelek = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klient", headers: naglowki,
  });
  assert.equal(kubelek.json().login, null);
  assert.deepEqual(kubelek.json().aktywne, [], "jan nie przecieka do kubełka");

  const powiazane = await app.inject({
    method: "GET", url: `/api/biuro/sprawy/powiazane?rodzaj=dyskusja&id=${dyskusjaId}`, headers: naglowki,
  });
  assert.equal(powiazane.statusCode, 200);
  assert.deepEqual(
    powiazane.json().zamowienie.map((s: { rodzaj: string }) => s.rodzaj).sort(),
    ["reklamacja", "zwrot"],
    "ciąg jednego zamówienia"
  );

  const bezId = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/powiazane?rodzaj=dyskusja", headers: naglowki,
  });
  assert.equal(bezId.statusCode, 400);
});

test("przejęcie sprawy stempluje WŁAŚCIWY rejestr — każdy z czterech", async () => {
  /* Jedna trasa, cztery rejestry: kolejka nie wie, do którego należy wiersz,
     i to jest właśnie wiedza, którą niesie moduł spraw. Test sprawdza, że
     rozdzielenie po rodzaju trafia tam, gdzie powinno — bo pomyłka byłaby
     cicha: stempel na cudzym rejestrze wygląda z kolejki tak samo. */
  const token = zalogowany("biuro");
  const d = daneSpraw();
  const przypadki: Array<[string, number]> = [
    ["pytanie", d.pytanieId],
    ["zwrot", d.zwrotId],
    ["dyskusja", d.dyskusjaId],
    ["reklamacja", d.pozycjaId],
  ];
  for (const [rodzaj, id] of przypadki) {
    const r = await app.inject({
      method: "POST",
      url: `/api/biuro/sprawy/${rodzaj}/${id}/prowadzi`,
      headers: { "x-session": token },
      payload: {},
    });
    assert.equal(r.statusCode, 200, rodzaj);
  }

  /* Liczy się WIDOK, nie tabela: kolejka ma po tym pokazać cztery sprawy
     z nazwiskiem, a nie cztery zapisy w czterech miejscach. */
  const kolejka = await app.inject({
    method: "GET", url: "/api/biuro/sprawy", headers: { "x-session": token },
  });
  const sprawy = kolejka.json().sprawy as Array<{ rodzaj: string; prowadzi: string | null }>;
  for (const rodzaj of ["pytanie", "zwrot", "dyskusja", "reklamacja"]) {
    const s = sprawy.find((x) => x.rodzaj === rodzaj);
    assert.ok(s, `${rodzaj} jest w kolejce`);
    assert.ok(s!.prowadzi, `${rodzaj} niesie znacznik prowadzenia do kolejki`);
  }
});

test("przejęcie sprawy: bramka biura i odmowa dla złego rodzaju", async () => {
  const d = daneSpraw();
  const url = `/api/biuro/sprawy/pytanie/${d.pytanieId}/prowadzi`;
  const bez = await app.inject({ method: "POST", url, payload: {} });
  assert.equal(bez.statusCode, 401, "bez sesji 401");
  const hala = await app.inject({
    method: "POST", url, headers: { "x-session": zalogowany("magazynier") }, payload: {},
  });
  assert.equal(hala.statusCode, 403, "magazynier nie prowadzi spraw klientów");

  const token = zalogowany("biuro");
  const zly = await app.inject({
    method: "POST", url: "/api/biuro/sprawy/wymyslony/1/prowadzi",
    headers: { "x-session": token }, payload: {},
  });
  assert.equal(zly.statusCode, 400, "zły rodzaj to literówka w kliencie, nie pusty skutek");
});

test("rozliczony zwrot nie ma kogo prowadzić", async () => {
  /* Sprawa zamknięta z nazwiskiem przy sobie sugeruje, że ktoś jeszcze przy
     niej siedzi. Odmowa jest tu lepsza od cichego braku skutku: klik w kolejce
     po odświeżeniu inaczej by kłamał. */
  const token = zalogowany("biuro");
  const d = daneSpraw();
  db().prepare("UPDATE zwrot SET status='rozliczony' WHERE id=?").run(d.zwrotId);
  const r = await app.inject({
    method: "POST", url: `/api/biuro/sprawy/zwrot/${d.zwrotId}/prowadzi`,
    headers: { "x-session": token }, payload: {},
  });
  assert.equal(r.statusCode, 400);
});
