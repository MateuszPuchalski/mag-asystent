import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wiedza-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Trasy bazy wiedzy (E2, E3) — trzy umowy ────────────────────────────────
   1. Bramka roli na KAŻDEJ trasie, także na odczycie; 401 przed 403.
   2. Otwarcie ekranu niczego nie zapisuje; tras zapisu jest SIEDEM i licznik
      niżej jest umową — każdy nowy zapis podnosi liczbę i dostaje zdanie.
      E3 dołożyło trzy: przerobienie i odrzucenie sekcji „Modele:" z opisu
      (człowiek wskazuje model, automat nie proponuje) oraz ręczny identyfikator.
   3. Panel woła te same adresy: strażnik czyta `panel/src/api/wiedza.ts`,
      bo strażnik ze skrzynki czyta tylko `rozmowy.ts` (blizna 0.181.1).   */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let W: typeof import("../services/wiedza.js");
let S: typeof import("../services/silniki.js");
let P: typeof import("../services/pasowania.js");
let propozycja = 0;
let zabudowa = 0;
let pasowanie = 0;
let zOpisu = 0;
const SZR = 501;
const GAZ = 502;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  W = await import("../services/wiedza.js");
  S = await import("../services/silniki.js");
  P = await import("../services/pasowania.js");
  app = await (await import("../index.js")).buildApp();
  db().prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa,opis) VALUES (?,?,?,?)")
    .run(SZR, "SZR-148/82", "Szarpak", "OEM: 41307131600 Modele: LS 46-450 LS 51 Zamiennik: X");
  db().prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa,opis) VALUES (?,?,?,?)")
    .run(GAZ, "GAZ-1", "Gaźnik", "");
});

beforeEach(() => {
  const d = db();
  for (const t of ["pasowanie_czesci", "model_z_opisu", "towar_identyfikator", "dowod_zastosowania", "zastosowanie",
    "alias_silnika", "zabudowa_silnika", "model_urzadzenia", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  zOpisu = Number(d.prepare(`INSERT INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm)
    VALUES (?,?,'LS 46-450 LS 51','ls46-450ls51')`).run(SZR, "SZR-148/82").lastInsertRowid);
  const autor = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  propozycja = W.zaproponujZastosowanie({
    twId: SZR, model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" }, polaryzacja: "pasuje",
    zrodlo: "reczne", dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024" },
  }, { userId: autor, name: "A. Lewandowska" })!.id;
  zabudowa = S.zaproponujZabudowe({
    maszyna: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" },
    silnik: { rodzaj: "silnik", marka: "Briggs & Stratton", nazwa: "450E" },
    rodzajDowodu: "producent", dowodTresc: "karta katalogowa", zrodlo: "reczne",
  }, { userId: autor, name: "A. Lewandowska" })!.id;
  pasowanie = P.zaproponujPasowanie({
    twId: SZR, doTwId: GAZ, rola: "uszczelka", polaryzacja: "pasuje",
    rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog", zrodlo: "reczne",
  }, { userId: autor, name: "A. Lewandowska" })!.id;
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token }, userId: u.userId };
}

const liczba = (tabela: string) => (db().prepare(`SELECT count(*) n FROM ${tabela}`).get() as { n: number }).n;

const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/wiedza/kolejka" },
  { method: "GET" as const, url: "/api/obsluga/wiedza/modele?q=nac" },
  { method: "GET" as const, url: `/api/obsluga/wiedza/towar/${SZR}` },
  { method: "POST" as const, url: "/api/obsluga/wiedza/propozycje",
    payload: { twId: SZR, model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 51" }, polaryzacja: "pasuje",
      dowod: { rodzaj: "producent", tresc: "x" } } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/${propozycja}/rozstrzygnij`, payload: { decyzja: "zatwierdz" } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/${propozycja}/wycofaj`, payload: { powod: "x" } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/${propozycja}/dowody`, payload: { rodzaj: "producent", tresc: "x" } },
  { method: "GET" as const, url: "/api/obsluga/wiedza/z-opisow" },
  { method: "POST" as const, url: `/api/obsluga/wiedza/z-opisow/${zOpisu}/przerob`,
    payload: { model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 51" } } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/z-opisow/${zOpisu}/odrzuc` },
  { method: "GET" as const, url: `/api/obsluga/wiedza/identyfikatory/${SZR}` },
  { method: "POST" as const, url: "/api/obsluga/wiedza/identyfikatory", payload: { twId: SZR, rodzaj: "katalog_obcy", wartosc: "AB-1234" } },
  { method: "GET" as const, url: "/api/obsluga/wiedza/silniki" },
  { method: "POST" as const, url: "/api/obsluga/wiedza/silniki",
    payload: { maszyna: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 51" },
      silnik: { rodzaj: "silnik", marka: "Briggs & Stratton", nazwa: "450E" },
      rodzajDowodu: "producent", dowodTresc: "karta katalogowa" } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/silniki/${zabudowa}/rozstrzygnij`, payload: { decyzja: "zatwierdz" } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/silniki/${zabudowa}/wycofaj`, payload: { powod: "x" } },
  { method: "POST" as const, url: "/api/obsluga/wiedza/silniki/aliasy",
    payload: { tekst: "B&S 450E", silnik: { rodzaj: "silnik", marka: "Briggs & Stratton", nazwa: "450E" } } },
  { method: "POST" as const, url: "/api/obsluga/wiedza/silniki/aliasy/1/usun" },
  { method: "POST" as const, url: "/api/obsluga/wiedza/pasowania",
    payload: { twId: GAZ, doTwId: SZR, rola: "inne", polaryzacja: "pasuje", rodzajDowodu: "producent", dowodTresc: "x" } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/pasowania/${pasowanie}/rozstrzygnij`, payload: { decyzja: "zatwierdz" } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/pasowania/${pasowanie}/wycofaj`, payload: { powod: "x" } },
];

test("bez sesji żadna trasa wiedzy nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.payload });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi wiedzy — także na odczycie", async () => {
  const m = login("magazynier", "Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: m.naglowki, payload: t.payload });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
  }
});

test("tras zapisu jest piętnaście — licznik jest umową", () => {
  /* Trzy przy zabudowie silnika (0.229.0) i trzy przy pasowaniu części:
     propozycja, rozstrzygnięcie i wycofanie. Każda z tych relacji ma ten sam
     cykl życia co zastosowanie, a bez własnego wycofania zatwierdzona pomyłka
     o uszczelce zostałaby w bazie na zawsze.

     Dwie przy słowniku silników (0.238.0): dodanie i usunięcie aliasu. Alias
     jest zapisem ręki biura, nie propozycją automatu — nie ma cyklu życia,
     więc nie ma trzeciej trasy. Osobne od zabudowy, bo alias mówi „co znaczy
     tekst z pola", a zabudowa „co stoi w maszynie". */
  assert.equal(TRASY().filter((t) => t.method !== "GET").length, 15);
});

test("otwarcie wiedzy niczego nie zapisuje", async () => {
  const b = login("biuro", "Anna");
  const stan = () => ["events", "zastosowanie", "dowod_zastosowania", "model_urzadzenia", "model_z_opisu",
    "towar_identyfikator", "zabudowa_silnika", "pasowanie_czesci", "alias_silnika"].map(liczba);
  const przed = stan();
  for (const t of TRASY().filter((t) => t.method === "GET")) {
    const r = await app.inject({ method: "GET", url: t.url, headers: b.naglowki });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.deepEqual(stan(), przed);
});

test("przerobienie sekcji z opisu tworzy propozycję `opis` z dowodem decyzji biura; drugie dostaje 409", async () => {
  const b = login("biuro", "Anna");
  let r = await app.inject({ method: "GET", url: "/api/obsluga/wiedza/z-opisow", headers: b.naglowki });
  assert.equal(r.json<{ liczba: number }>().liczba, 1);
  /* Bez modelu w ciele to 400 biznesowe (strażnik adresów woła `{}`), nie zapis. */
  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/z-opisow/${zOpisu}/przerob`, headers: b.naglowki, payload: {} });
  assert.equal(r.statusCode, 400);
  assert.equal(liczba("zastosowanie"), 1);
  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/z-opisow/${zOpisu}/przerob`, headers: b.naglowki,
    payload: { model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 51" } } });
  assert.equal(r.statusCode, 200, r.body);
  const z = r.json<{ zrodlo: string; dowody: Array<{ rodzaj: string; tresc: string }>; zaproponowal: string }>();
  assert.equal(z.zrodlo, "opis");
  assert.equal(z.zaproponowal, "Anna", "autorem jest człowiek, który wskazał model — nie automat");
  assert.equal(z.dowody[0].rodzaj, "decyzja_biura");
  assert.match(z.dowody[0].tresc, /^z opisu kartoteki „SZR-148\/82”: Modele: LS 46-450 LS 51$/);
  r = await app.inject({ method: "GET", url: "/api/obsluga/wiedza/z-opisow", headers: b.naglowki });
  assert.equal(r.json<{ liczba: number }>().liczba, 0, "przerobiony wiersz schodzi z listy");
  /* Rozstrzygnięty wiersz — 409 z tym, kto był pierwszy. */
  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/z-opisow/${zOpisu}/przerob`, headers: b.naglowki,
    payload: { model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" } } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json<{ rozstrzygnal: string }>().rozstrzygnal, "Anna");
  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/z-opisow/${zOpisu}/odrzuc`, headers: login("biuro", "Ola").naglowki });
  assert.equal(r.statusCode, 409);
});

test("odrzucenie sekcji z opisu zostawia wiersz jako `odrzucony`", async () => {
  const b = login("biuro", "Anna");
  const r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/z-opisow/${zOpisu}/odrzuc`, headers: b.naglowki });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ stan: string; rozstrzygnal: string }>().stan, "odrzucony");
  assert.equal(liczba("model_z_opisu"), 1, "wiersz zostaje, żeby nie wrócić po przebudowie");
  assert.equal(liczba("zastosowanie"), 1, "odrzucenie niczego nie proponuje");
});

test("ręczny identyfikator wchodzi raz; duplikat to 409, cudza kartoteka to 400", async () => {
  const b = login("biuro", "Anna");
  let r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/identyfikatory", headers: b.naglowki,
    payload: { twId: SZR, rodzaj: "katalog_obcy", wartosc: "AB-1234" } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ zrodlo: string; dodal: string }>().zrodlo, "reczne");
  assert.equal(r.json<{ dodal: string }>().dodal, "Anna");
  r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/identyfikatory", headers: b.naglowki,
    payload: { twId: SZR, rodzaj: "katalog_obcy", wartosc: "ab 1234" } });
  assert.equal(r.statusCode, 409, "ta sama wartość po zwinięciu");
  r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/identyfikatory", headers: b.naglowki,
    payload: { twId: 999999, rodzaj: "oem", wartosc: "AB-1234" } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: "GET", url: `/api/obsluga/wiedza/identyfikatory/${SZR}`, headers: b.naglowki });
  assert.deepEqual(r.json<Array<{ wartosc: string }>>().map((i) => i.wartosc), ["AB-1234"]);
});

test("rozstrzygnięcie idzie z sesji; drugie dostaje 409 z tym, kto był pierwszy", async () => {
  const b = login("biuro", "Anna");
  let r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/${propozycja}/rozstrzygnij`,
    headers: b.naglowki, payload: { decyzja: "zatwierdz" } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ rozstrzygnal: string }>().rozstrzygnal, "Anna");
  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/${propozycja}/rozstrzygnij`,
    headers: login("biuro", "Ola").naglowki, payload: { decyzja: "odrzuc", powod: "nie" } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json<{ rozstrzygnal: string }>().rozstrzygnal, "Anna");
  /* Duplikat ręcznej propozycji to jawna odmowa, nie cichy sukces. */
  r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/propozycje", headers: b.naglowki,
    payload: { twId: SZR, model: { rodzaj: "maszyna", marka: "nac", nazwa: "ls46450" }, polaryzacja: "pasuje",
      dowod: { rodzaj: "producent", tresc: "x" } } });
  assert.equal(r.statusCode, 409);
});

test("każdy adres wołany z panel/src/api/wiedza.ts ma trasę na serwerze", async () => {
  const zrodlo = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/api/wiedza.ts"), "utf8");
  const wywolania = [...zrodlo.matchAll(/api(?:<[^>]*>)?\(\s*`([^`]+)`(?:\s*,\s*\{[^}]*?method:\s*"(GET|POST|PUT|DELETE)")?/gs)];
  assert.ok(wywolania.length >= 12, `strażnik nie widzi hooków wiedzy (${wywolania.length})`);
  const b = login("biuro", "Biuro");
  const bledne: string[] = [];
  for (const [, adres, metoda] of wywolania) {
    const url = adres.replace(/\$\{[^}]+\}/g, "1").replace(/\?.*$/, "");
    const method = (metoda ?? "GET") as "GET" | "POST" | "PUT" | "DELETE";
    const r = await app.inject({ method, url, headers: b.naglowki, ...(method === "GET" ? {} : { payload: {} }) });
    const tresc = r.json<{ message?: string }>();
    if (r.statusCode === 404 && /^Route /.test(tresc.message ?? "")) bledne.push(`${method} ${adres}`);
  }
  assert.deepEqual(bledne, [], "panel woła adresy bez trasy na serwerze");
});

test("zabudowa przez trasę: propozycja, duplikat 409, zatwierdzenie i wycofanie tylko z powodem", async () => {
  const b = login("biuro", "Anna");
  const para = {
    maszyna: { rodzaj: "maszyna", marka: "STIGA", nazwa: "Combi 48" },
    silnik: { rodzaj: "silnik", marka: "Briggs & Stratton", nazwa: "450E" },
    rodzajDowodu: "producent", dowodTresc: "karta katalogowa 2024",
  };
  let r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/silniki", headers: b.naglowki, payload: para });
  assert.equal(r.statusCode, 200, r.body);
  const z = r.json<{ id: number; stan: string; zrodlo: string; zaproponowal: string; pewnosc: string }>();
  assert.equal(z.stan, "propozycja", "także wpis ręczny idzie do kolejki — precedens `przerobModelZOpisu`");
  assert.equal(z.zrodlo, "reczne");
  assert.equal(z.zaproponowal, "Anna", "autorem jest sesja, nigdy pole z ciała");

  /* Duplikat to odmowa ze zdaniem, nie cichy sukces. */
  r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/silniki", headers: b.naglowki, payload: para });
  assert.equal(r.statusCode, 409);

  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/silniki/${z.id}/rozstrzygnij`,
    headers: b.naglowki, payload: { decyzja: "zatwierdz" } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ stan: string }>().stan, "zatwierdzone");
  /* Drugie rozstrzygnięcie to 409 z tym, kto był pierwszy. */
  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/silniki/${z.id}/rozstrzygnij`,
    headers: login("biuro", "Ola").naglowki, payload: { decyzja: "odrzuc", powod: "jednak nie" } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json<{ rozstrzygnal: string }>().rozstrzygnal, "Anna");

  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/silniki/${z.id}/wycofaj`,
    headers: b.naglowki, payload: {} });
  assert.equal(r.statusCode, 400, "wycofanie bez powodu gasi całą gałąź po cichu");
});

test("żądanie bez ciała nie wywala się na pustym JSON-ie", async () => {
  /* Reguła klienta HTTP obowiązuje KAŻDY front z osobna. Trasa musi oddać
     błąd biznesowy, a nie gołe „Bad Request" z `FST_ERR_CTP_EMPTY_JSON_BODY`. */
  const b = login("biuro", "Anna");
  for (const url of [`/api/obsluga/wiedza/silniki/${zabudowa}/rozstrzygnij`,
    `/api/obsluga/wiedza/silniki/${zabudowa}/wycofaj`, "/api/obsluga/wiedza/silniki",
    `/api/obsluga/wiedza/pasowania/${pasowanie}/rozstrzygnij`,
    `/api/obsluga/wiedza/pasowania/${pasowanie}/wycofaj`, "/api/obsluga/wiedza/pasowania"]) {
    const r = await app.inject({ method: "POST", url, headers: b.naglowki });
    assert.equal(r.statusCode, 400, url);
    assert.doesNotMatch(r.body, /FST_ERR_CTP_EMPTY_JSON_BODY/, url);
  }
});

test("luki idą razem z kolejką jednym odczytem", async () => {
  const b = login("biuro", "Anna");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/wiedza/silniki", headers: b.naglowki });
  assert.equal(r.statusCode, 200, r.body);
  const w = r.json<{ propozycje: unknown[]; doRozstrzygniecia: number;
    luki: unknown[]; lukiRazem: number; zatwierdzone: unknown[] }>();
  assert.equal(w.propozycje.length, 1, "para z beforeEach czeka w kolejce");
  /* Dwa liczniki, dwie prawdy: propozycje to decyzje, luki to praca. Jedno
     pole `liczba` nadpisałoby drugie po cichu. */
  assert.equal(w.doRozstrzygniecia, 1);
  assert.equal(typeof w.lukiRazem, "number");
  assert.deepEqual(w.zatwierdzone, []);
  assert.ok(Array.isArray(w.luki));
});

test("pasowanie przez trasę: źródło z kontekstu, duplikat 409, kolejka i kartoteka widzą obie strony", async () => {
  const b = login("biuro", "Anna");
  /* Z rozmowy → `dobor`; z ekranu Wiedza (bez `conversationId`) → `reczne`. */
  let r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/pasowania", headers: b.naglowki,
    payload: { twId: GAZ, doTwId: SZR, rola: "lacznik", polaryzacja: "pasuje", rodzajDowodu: "producent", dowodTresc: "IPL" } });
  assert.equal(r.statusCode, 200, r.body);
  const z = r.json<{ id: number; zrodlo: string; zaproponowal: string; stan: string }>();
  assert.equal(z.zrodlo, "reczne");
  assert.equal(z.zaproponowal, "Anna", "autor z sesji, nie z ciała");
  assert.equal(z.stan, "propozycja");
  r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/pasowania", headers: b.naglowki,
    payload: { twId: GAZ, doTwId: SZR, rola: "lacznik", polaryzacja: "pasuje", rodzajDowodu: "producent", dowodTresc: "IPL" } });
  assert.equal(r.statusCode, 409);

  r = await app.inject({ method: "GET", url: "/api/obsluga/wiedza/kolejka", headers: b.naglowki });
  const k = r.json<{ liczba: number; pasowania: unknown[]; pasowanDoRozstrzygniecia: number }>();
  assert.equal(k.liczba, 1, "zastosowania liczą się osobno");
  assert.equal(k.pasowanDoRozstrzygniecia, 2, "pasowanie z beforeEach + to z trasy");
  assert.equal(k.pasowania.length, 2);

  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/pasowania/${pasowanie}/rozstrzygnij`,
    headers: b.naglowki, payload: { decyzja: "zatwierdz" } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "GET", url: `/api/obsluga/wiedza/towar/${GAZ}`, headers: b.naglowki });
  const g = r.json<{ pasowania: { pasujace: Array<{ czesc: { symbol: string } }>; pasujeDo: unknown[] } }>();
  assert.deepEqual(g.pasowania.pasujace.map((t) => t.czesc.symbol), ["SZR-148/82"]);
  r = await app.inject({ method: "GET", url: `/api/obsluga/wiedza/towar/${SZR}`, headers: b.naglowki });
  const u = r.json<{ pasowania: { pasujeDo: Array<{ doCzego: { symbol: string } }> } }>();
  assert.deepEqual(u.pasowania.pasujeDo.map((t) => t.doCzego.symbol), ["GAZ-1"]);

  /* Drugie rozstrzygnięcie → 409 z tym, kto był pierwszy. */
  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/pasowania/${pasowanie}/rozstrzygnij`,
    headers: login("biuro", "Ola").naglowki, payload: { decyzja: "odrzuc", powod: "nie" } });
  assert.equal(r.statusCode, 409);
});

test("słownik silników przez trasę: dodanie, dubel 409 ze wskazaniem, usunięcie; zabudowa z rozmowy ma źródło `dobor`", async () => {
  const b = login("biuro", "Anna");
  const alias = { tekst: "Lonci v200", silnik: { rodzaj: "silnik", marka: "Loncin", nazwa: "V200" } };
  let r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/silniki/aliasy", headers: b.naglowki, payload: alias });
  assert.equal(r.statusCode, 200, r.body);
  const a = r.json<{ id: number; silnik: { etykieta: string } }>();
  assert.equal(a.silnik.etykieta, "silnik Loncin V200");
  r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/silniki/aliasy", headers: b.naglowki,
    payload: { ...alias, tekst: "LONCI-V200" } });
  assert.equal(r.statusCode, 409);
  assert.match(r.json<{ error: string }>().error, /znaczy silnik Loncin V200/);
  r = await app.inject({ method: "GET", url: "/api/obsluga/wiedza/silniki", headers: b.naglowki });
  assert.deepEqual(r.json<{ aliasy: Array<{ tekst: string }> }>().aliasy.map((x) => x.tekst), ["Lonci v200"]);

  /* Para spod pola „Silnik" w rozmowie: źródło wynika z `conversationId`. */
  const konto = Number(db().prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s-a')").run().lastInsertRowid);
  const rozmowa = Number(db().prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-alias','klient')`).run(konto).lastInsertRowid);
  r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/silniki", headers: b.naglowki, payload: {
    maszyna: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" }, silnik: alias.silnik,
    rodzajDowodu: "rozmowa", dowodTresc: "klient podał silnik w rozmowie", conversationId: rozmowa,
  } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ zrodlo: string; pewnosc: string }>().zrodlo, "dobor");
  assert.equal(r.json<{ zrodlo: string; pewnosc: string }>().pewnosc, "prawdopodobne");

  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/silniki/aliasy/${a.id}/usun`, headers: b.naglowki });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(liczba("alias_silnika"), 0);
});
