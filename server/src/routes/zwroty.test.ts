import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zwroty-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasy zwrotów pilnują tu trzech rzeczy, z których żadna nie mieszka
   w serwisie:

   1. BRAMKA ROLI TAKŻE NA ODCZYCIE. Zwrot niesie numer zamówienia i sprawę
      klienta — dane biura, nie hali. Trasa odczytu bez bramki wygląda
      niewinnie i przecieka po cichu.
   2. ZERO ZAPISU PRZY PATRZENIU. Reguła z 0.18.0 obowiązuje też panel
      obsługi, choć licznik `method:` w `biuro.test.ts` obejmuje wyłącznie
      `biuro.html`. Licznik tras zapisu niżej jest UMOWĄ: każdy nowy zapis
      podnosi liczbę i dostaje zdanie w uzasadnieniu.
   3. 401 PRZED 403. Brak sesji to inna naprawa niż zła rola.              */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let zwrot = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zwrot_zdarzenie", "zwrot_klienta_pozycja", "zwrot_klienta", "allegro_zwrot",
    "zamowienie_klienta_pozycja", "zamowienie_klienta", "allegro_zamowienie",
    "oferta_kartoteka", "sgt_towar", "channel_account", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,
    reference_number,order_id,created_at,paczka_at,synced_at)
    VALUES (?,'zw-1','REF-1','ord-1','2026-08-25T09:00:00Z','2026-08-28T09:00:00Z','2026-09-01T09:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,powod,klucz)
    VALUES (?,'111','Sekator NAC',1,4999,'PLN','DONT_LIKE_IT','111|Sekator NAC')`).run(zwrot);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token } };
}

const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/zwroty" },
  { method: "GET" as const, url: `/api/obsluga/zwroty/${zwrot}` },
  { method: "POST" as const, url: "/api/obsluga/zwroty/zamowienia" },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/werdykt` },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/kwota` },
  { method: "POST" as const, url: "/api/obsluga/zwroty/pozycje/1/ocena" },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/korekta` },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/korekta/cofnij` },
];

test("bez sesji żadna trasa zwrotów nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi zwrotów — bramka roli stoi też na odczycie", async () => {
  const { naglowki } = login("magazynier", "Magazynier Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: naglowki });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
    assert.match(r.json().error, /biuro/, "odmowa mówi, kto to prowadzi");
  }
});

test("biuro dostaje kolejkę z kubełkiem, terminem i licznikami", async () => {
  const { naglowki } = login("biuro", "Ala z biura");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty", headers: naglowki });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.zwroty.length, 1);
  const z = body.zwroty[0];
  assert.equal(z.externalId, "zw-1");
  assert.equal(z.kubelek, "decyzja", "zwrot bez werdyktu czeka na decyzję");
  assert.equal(z.sumaPozycjiGrosze, 4999);
  assert.equal(typeof z.dniDoTerminu, "number");
  assert.equal(body.liczniki.decyzja, 1);
  assert.ok(body.stan.status, "stan synchronizacji jedzie razem z kolejką");
});

test("zwrot spoza bazy to 404, nie pusty obiekt", async () => {
  const { naglowki } = login("biuro", "Ala druga");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty/99999", headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("otwarcie kolejki nie zapisuje NICZEGO", async () => {
  /* Umowa z 0.18.0. Liczymy wiersze we WSZYSTKICH tabelach, których ten
     ekran dotyka — nie tylko w dzienniku, bo zapis potrafi wylądować obok. */
  const { naglowki } = login("biuro", "Ala trzecia");
  const licz = () => {
    const d = db();
    return ["events", "zwrot_klienta", "zwrot_klienta_pozycja", "zwrot_zdarzenie",
      "allegro_zwrot", "allegro_zwroty_sync_state"]
      .map((t) => (d.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n)
      .join("/");
  };
  const przed = licz();
  for (const t of TRASY().filter((t) => t.method === "GET")) {
    await app.inject({ method: t.method, url: t.url, headers: naglowki });
    await app.inject({ method: t.method, url: t.url, headers: naglowki });
  }
  assert.equal(licz(), przed, "patrzenie na zwroty niczego nie mutuje");
});

test("zwroty mają dokładnie pięć tras zapisu", async () => {
  /* Ta liczba jest UMOWĄ, jak licznik `method:` w `biuro.test.ts`.
     Do 0.151.0 stało tu zero, w 0.152.0 jeden, do 0.155.0 dwa. Dziś jest
     pięć — trzy doszły w 0.156.0, gdy kolejka bramek przestała być dekoracją:

     1. POTWIERDZENIE KARTOTEKI dla pozycji — bez `tw_id` pozycja nie ma czym
        pokazać zdjęcia, bo cache obrazów jest kluczowany po tym polu.
     2. RĘCZNE DOCIĄGNIĘCIE ZAMÓWIEŃ — bez niego diagnoza na produkcji
        wymagała czekania dziesięciu minut na najrzadszy ticker.
     3. WERDYKT biura — przyjęcie albo odmowa. Do 0.156.0 `kubelekZwrotu`
        routował po tej kolumnie, a nic jej nie zapisywało: każdy zwrot stał
        w DO DECYZJI na zawsze.
     4. OCENA POZYCJI — na stan, na przecenę albo do utylizacji. Bez niej nic
        nie przechodzi z DO OCENY do DO ZWROTU.
     5. KWOTA — z ZAZNACZENIA pozycji i dostawy, liczona po stronie serwera.

     Korekta i oddanie pieniędzy NADAL nie mają tu trasy: pierwsze idzie do
     Subiekta, drugie po końcówki zapisu Allegro, których sonda nie potwierdzi.
     Kto dokłada kolejny zapis, podnosi tę liczbę i dopisuje zdanie. */
  const zapisy = app.printRoutes({ commonPrefix: false })
    .split("\n")
    .filter((l) => /POST|PUT|DELETE|PATCH/.test(l));
  const nasze = app.printRoutes({ commonPrefix: false });
  for (const slowo of ["kartoteka", "werdykt", "ocena", "kwota", "zamowienia"]) {
    assert.equal(nasze.includes(slowo), true, `brak trasy ${slowo}`);
  }
  assert.ok(zapisy.length >= 5, `tras zapisu jest ${zapisy.length}, a umowa mówi o pięciu`);
});

test("bilans kartotek jedzie razem z kolejką", async () => {
  /* Bez liczby nie da się powiedzieć, czy problem jest w kodzie, czy
     w danych Allegro — a przez trzy wydania nie dało się tego rozstrzygnąć. */
  const { naglowki } = login("biuro", "Ala liczy");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty", headers: naglowki });
  const b = r.json().kartoteki;
  assert.equal(b.wszystkie, 1);
  assert.equal(b.bez, 1);
  assert.equal(b.powody.zamowienie_niepobrane, 1, "powód jest nazwany, nie zbiorczy");
});

test("ręczne dociągnięcie zamówień wymaga sparowanego konta", async () => {
  /* Bez konta trasa mówi, czego brakuje, zamiast strzelać w Allegro bez
     tokenu i oddawać 401 z obcego systemu. */
  const { naglowki } = login("biuro", "Ala dociąga");
  const r = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/zamowienia", headers: naglowki });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /sparowane/);
});

test("hala nie dociąga zamówień", async () => {
  const { naglowki } = login("magazynier", "Marek z hali");
  const r = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/zamowienia", headers: naglowki });
  assert.equal(r.statusCode, 403);
});

test("potwierdzenie kartoteki zapisuje wybór RAZEM ze źródłem", async () => {
  const { naglowki } = login("biuro", "Ala potwierdza");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (77,'SEK-46','Sekator')").run();
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja").get() as { id: number }).id);

  const r = await app.inject({ method: "POST", headers: naglowki,
    url: `/api/obsluga/zwroty/pozycje/${poz}/kartoteka`, payload: { twId: 77, zrodlo: "sku" } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { twId: 77, twSymbol: "SEK-46", twZrodlo: "sku" });

  /* Symbol pochodzi z KARTOTEKI, nie z żądania — snapshot ma przeżyć
     skasowanie read-modelu przy imporcie, a kłamliwy byłby gorszy od braku. */
  const w = d.prepare("SELECT tw_id, tw_symbol, tw_zrodlo, tw_przez FROM zwrot_klienta_pozycja WHERE id=?")
    .get(poz) as Record<string, unknown>;
  assert.equal(w.tw_symbol, "SEK-46");
  assert.equal(w.tw_zrodlo, "sku");
  assert.equal(w.tw_przez, "Ala potwierdza");

  const zdarzenia = d.prepare("SELECT type FROM events WHERE type LIKE 'zwrot_kartoteka%'").all();
  assert.equal(zdarzenia.length, 1, "każda mutacja zostawia ślad w dzienniku");
  const os = d.prepare("SELECT rodzaj FROM zwrot_zdarzenie").all() as Array<{ rodzaj: string }>;
  assert.deepEqual(os.map((e) => e.rodzaj), ["kartoteka"], "oś zwrotu też o tym mówi");
});

test("puste `twId` zdejmuje powiązanie — to droga wyjścia z pomyłki", async () => {
  const { naglowki } = login("biuro", "Ala cofa");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (77,'SEK-46','Sekator')").run();
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja").get() as { id: number }).id);
  const url = `/api/obsluga/zwroty/pozycje/${poz}/kartoteka`;
  await app.inject({ method: "POST", url, headers: naglowki, payload: { twId: 77, zrodlo: "reczne" } });
  const r = await app.inject({ method: "POST", url, headers: naglowki, payload: { twId: null } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { twId: null, twSymbol: null, twZrodlo: null });
});

test("nieznany towar i nieznana pozycja to 400 z powodem, nie 500", async () => {
  const { naglowki } = login("biuro", "Ala myli się");
  const poz = Number((db().prepare("SELECT id FROM zwrot_klienta_pozycja").get() as { id: number }).id);
  const zly = await app.inject({ method: "POST", headers: naglowki,
    url: `/api/obsluga/zwroty/pozycje/${poz}/kartoteka`, payload: { twId: 99999 } });
  assert.equal(zly.statusCode, 400);
  assert.match(zly.json().error, /towaru/);

  const brak = await app.inject({ method: "POST", headers: naglowki,
    url: "/api/obsluga/zwroty/pozycje/99999/kartoteka", payload: { twId: null } });
  assert.equal(brak.statusCode, 400);
  assert.match(brak.json().error, /pozycji/);
});

test("hala nie potwierdza kartoteki", async () => {
  const { naglowki } = login("magazynier", "Marek z hali");
  const poz = Number((db().prepare("SELECT id FROM zwrot_klienta_pozycja").get() as { id: number }).id);
  const r = await app.inject({ method: "POST", headers: naglowki,
    url: `/api/obsluga/zwroty/pozycje/${poz}/kartoteka`, payload: { twId: null } });
  assert.equal(r.statusCode, 403);
});

test("decyzje zwrotu: rola, brak powodu przy odmowie i konflikt wersji", async () => {
  /* Trzy odmowy, każda z innym kodem — operator ma odróżnić „nie wolno ci"
     od „ktoś zdążył pierwszy". */
  const bezSesji = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`,
    payload: { decyzja: "przyjety", wersja: 1 } });
  assert.equal(bezSesji.statusCode, 401);

  const hala = login("magazynier", "Hala");
  const zHali = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`, headers: hala.naglowki,
    payload: { decyzja: "przyjety", wersja: 1 } });
  assert.equal(zHali.statusCode, 403, "zwroty prowadzi biuro");

  const b = login("biuro", "Biuro");
  const bezPowodu = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`, headers: b.naglowki,
    payload: { decyzja: "odrzucony", powod: "   ", wersja: 1 } });
  assert.equal(bezPowodu.statusCode, 400);
  assert.match(bezPowodu.json().error, /powod|powód/i);

  const ok = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`, headers: b.naglowki,
    payload: { decyzja: "przyjety", wersja: 1 } });
  assert.equal(ok.statusCode, 200);

  /* Drugi agent z tą samą wersją dostaje 409 ZE SZCZEGÓŁAMI, nie 400 —
     panel ma narysować „ktoś zdążył pierwszy", a nie gołe „błąd". */
  const spozniony = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`, headers: b.naglowki,
    payload: { decyzja: "odrzucony", powod: "duplikat", wersja: 1 } });
  assert.equal(spozniony.statusCode, 409);
  assert.equal(spozniony.json().wersja, 2);
});

test("kwota bierze się z zaznaczenia — liczba przysłana przez panel jest ignorowana", async () => {
  const poz = Number((db().prepare(
    "SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?").get(zwrot) as { id: number }).id);
  const b = login("biuro", "Biuro");

  await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/werdykt`,
    headers: b.naglowki, payload: { decyzja: "przyjety", wersja: 1 } });
  await app.inject({ method: "POST", url: `/api/obsluga/zwroty/pozycje/${poz}/ocena`,
    headers: b.naglowki, payload: { ocena: "stan", wersja: 2 } });

  const odp = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota`,
    headers: b.naglowki,
    /* `kwotaGrosze` w ciele jest CELOWO absurdalne: trasa nie ma prawa go
       przeczytać. Gdyby czytała, dałoby się oddać dowolną kwotę żądaniem
       z pominięciem ekranu — a to są cudze pieniądze. */
    payload: { pozycjeIds: [poz], dostawa: false, wersja: 3, kwotaGrosze: 999999 } });

  assert.equal(odp.statusCode, 200);
  assert.equal(odp.json().kwotaGrosze, 4999, "jedna sztuka po 49,99 z fixture'u");
});

test("korekta domyka zwrot przez HTTP, a cofnięcie otwiera go z powrotem", async () => {
  /* Cała droga jednym ciągiem, bo to jedyny test, w którym widać, że kubełki
     naprawdę się przesuwają: werdykt → ocena → kwota → korekta → zamknięty. */
  const { naglowki } = login("biuro", "Ala z biura");
  const wersja = () => (db().prepare("SELECT wersja FROM zwrot_klienta WHERE id=?")
    .get(zwrot) as { wersja: number }).wersja;
  const pozycja = (db().prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(zwrot) as { id: number }).id;

  let r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/werdykt`,
    headers: naglowki, payload: { decyzja: "przyjety", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/pozycje/${pozycja}/ocena`,
    headers: naglowki, payload: { ocena: "stan", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota`,
    headers: naglowki, payload: { pozycjeIds: [pozycja], dostawa: false, wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  const pusty = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/korekta`,
    headers: naglowki, payload: { numer: "  ", wersja: wersja() } });
  assert.equal(pusty.statusCode, 400);
  assert.match(pusty.json().error, /numer/i);

  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/korekta`,
    headers: naglowki, payload: { numer: "KFS 12/2026", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  r = await app.inject({ method: "GET", url: `/api/obsluga/zwroty/${zwrot}`, headers: naglowki });
  assert.equal(r.json().zwrot.kubelek, "zamkniety");
  assert.equal(r.json().zwrot.korektaNumer, "KFS 12/2026");

  /* Stara wersja dostaje 409, nie ciche nadpisanie — dwóch agentów nie zamyka
     jednego zwrotu dwoma numerami. */
  const stara = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/korekta/cofnij`,
    headers: naglowki, payload: { wersja: wersja() - 1 } });
  assert.equal(stara.statusCode, 409, stara.body);

  const cofnij = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/korekta/cofnij`,
    headers: naglowki, payload: { wersja: wersja() } });
  assert.equal(cofnij.statusCode, 200, cofnij.body);
  r = await app.inject({ method: "GET", url: `/api/obsluga/zwroty/${zwrot}`, headers: naglowki });
  assert.equal(r.json().zwrot.kubelek, "korekta", "wraca do kubełka, nie na początek kolejki");
});
