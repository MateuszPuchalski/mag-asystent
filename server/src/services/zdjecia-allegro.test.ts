import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* ── Zdjęcia kartotek z naszych ofert Allegro ────────────────────────────────
   Testy pilnują decyzji, nie detali: reguły wyboru oferty, dopasowania po
   sygnaturze bez wielkości liter, zapisu snapshotu z wyborem, przepuszczenia 429 w górę,
   sufitu stu symboli, ciszy wobec Allegro przy wyłączonej funkcji
   i zasady właściciela, że duże zdjęcie daje wyłącznie nasza oferta. */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdja-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "mssql";
process.env.MSSQL_SERVER = "127.0.0.1";
process.env.MSSQL_DATABASE = "nieuzywana";
process.env.MSSQL_USER = "wertis";
process.env.MSSQL_PASSWORD = "nieuzywane";
process.env.ZDJECIA_ZRODLO = "blob";
process.env.ZDJECIA_TABELA = "tw_ZdjecieTw";
process.env.ZDJECIA_KOLUMNA_KLUCZA = "zd_IdTowar";
process.env.ZDJECIA_KOLUMNA = "zd_Zdjecie";
process.env.ZDJECIA_KOLUMNA_KOLEJNOSC = "zd_Id";
process.env.ZDJECIA_DODAWANIE = "wertis";
process.env.TLO_URL = "";

type Modul = typeof import("./zdjecia-allegro.js");
let m: Modul;
let migrate: typeof import("../db/db.js").migrate;
let config: typeof import("../config.js").config;
let BladLimituAllegro: typeof import("../adapters/allegro.js").BladLimituAllegro;

before(async () => {
  m = await import("./zdjecia-allegro.js");
  ({ migrate } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ BladLimituAllegro } = await import("../adapters/allegro.js"));
});

afterEach(() => {
  config.zdjecia.zrodlo = "blob";
  config.zdjecia.dodawanie = "wertis";
});

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

const ZDJ = "https://a.allegroimg.com/original/abc/zdjecie.jpg";

function oferta(id: string, sygnatura: string, o: { status?: string; startedAt?: string; zdjecie?: boolean } = {}) {
  return {
    id, name: `Oferta ${id}`,
    external: { id: sygnatura },
    publication: { status: o.status ?? "ACTIVE", ...(o.startedAt ? { startedAt: o.startedAt } : {}) },
    primaryImage: o.zdjecie === false ? null : { url: `${ZDJ}?${id}` },
    sellingMode: { price: { amount: "10.00", currency: "PLN" } },
  };
}

/* Subiekt atrapą: domyślnie żadna sygnatura nie jest symbolem kartoteki. */
const deps = (d: DatabaseSync, odpowiedz: (url: string) => unknown, adresy: string[] = [],
  towary: (symbole: string[]) => Promise<Array<{ symbol: string }>> = async () => []) => ({
  database: d, apiUrl: "https://api.test", accountId: "konto-1", towary,
  now: () => new Date("2026-10-21T10:00:00.000Z"),
  query: async (url: string) => { adresy.push(url); return odpowiedz(url); },
});

test("wybór: najpierw zdjęcie, potem ACTIVE, potem świeższa aktywacja, remis w kolejności", () => {
  const bez = oferta("1", "S", { zdjecie: false, startedAt: "2026-10-01T00:00:00Z" });
  const zakonczona = oferta("2", "S", { status: "ENDED", startedAt: "2026-10-10T00:00:00Z" });
  const stara = oferta("3", "S", { startedAt: "2025-01-01T00:00:00Z" });
  const nowa = oferta("4", "S", { startedAt: "2026-01-01T00:00:00Z" });
  const bezDaty = oferta("5", "S");
  assert.equal(m.wybierzOferte([bez, zakonczona, stara, nowa, bezDaty])?.id, "4");
  assert.equal(m.wybierzOferte([bez, zakonczona])?.id, "2", "zdjęcie wygrywa ze statusem");
  assert.equal(m.wybierzOferte([bezDaty, stara])?.id, "3", "brak daty liczy się jak najstarsza");
  const a = oferta("6", "S", { startedAt: "2026-01-01T00:00:00Z" });
  const b = oferta("7", "S", { startedAt: "2026-01-01T00:00:00Z" });
  assert.equal(m.wybierzOferte([a, b])?.id, "6", "remis zostaje w kolejności odpowiedzi");
  assert.equal(m.wybierzOferte([]), null);
});

test("dopasowanie bez wielkości liter, jedna pozycja na symbol, w kolejności wejścia", async () => {
  const d = baza();
  const adresy: string[] = [];
  const wynik = await m.dopasujOfertyAllegro(["W08-0501", "NIE-MA", "ab 12"], "Ala", deps(d, () => ({
    offers: [
      oferta("10", "w08-0501", { startedAt: "2026-01-01T00:00:00Z" }),
      oferta("11", "W08 0501", { status: "ENDED", startedAt: "2026-05-01T00:00:00Z" }),
      oferta("12", "AB 12", { zdjecie: false }),
      { id: "13", name: "Bez sygnatury", external: null },
    ],
  }), adresy));

  assert.equal(adresy.length, 1, "jedna strona, jedno żądanie");
  assert.match(adresy[0], /external\.id=W08-0501/);
  assert.match(adresy[0], /publication\.status=ACTIVE&publication\.status=ENDED/);
  assert.match(adresy[0], /limit=1000&offset=0/);
  assert.deepEqual(wynik, {
    wlaczone: true,
    pozycje: [
      { symbol: "W08-0501", ofert: 1, oferta: {
        id: "10", nazwa: "Oferta 10", status: "ACTIVE", startedAt: "2026-01-01T00:00:00Z", zdjecie: true }, po: "sygnatura", niejednoznaczny: false },
      { symbol: "NIE-MA", ofert: 0, oferta: null, po: null, niejednoznaczny: false },
      { symbol: "ab 12", ofert: 1, oferta: {
        id: "12", nazwa: "Oferta 12", status: "ACTIVE", startedAt: null, zdjecie: false }, po: "sygnatura", niejednoznaczny: false },
    ],
  });
  d.close();
});

test("symbole różne tylko kreską to dwie kartoteki, nie jedna oferta", async () => {
  const d = baza();
  const wynik = await m.dopasujOfertyAllegro(["LS51-139", "LS51139"], "Ala", deps(d, () => ({
    offers: [oferta("20", "LS51-139")],
  })));
  assert.ok(wynik.wlaczone);
  assert.deepEqual(wynik.pozycje.map((p) => [p.symbol, p.oferta?.id ?? null]), [["LS51-139", "20"], ["LS51139", null]]);
  const wiersze = d.prepare("SELECT symbol, offer_id FROM zdjecie_oferty_wybor ORDER BY symbol").all().map((w) => ({ ...w }));
  assert.deepEqual(wiersze, [{ symbol: "LS51-139", offer_id: "20" }, { symbol: "LS51139", offer_id: null }]);
  d.close();
});

test("zapis: snapshot każdej oferty, wybór na symbol i jeden wpis w dzienniku", async () => {
  const d = baza();
  await m.dopasujOfertyAllegro(["W08-0501", "NIE-MA"], "Ala", deps(d, () => ({
    offers: [oferta("10", "W08-0501"), oferta("11", "W08-0501", { status: "ENDED" })],
  })));
  const snap = d.prepare("SELECT external_id FROM offer_snapshot ORDER BY external_id").all()
    .map((w) => (w as { external_id: string }).external_id);
  assert.deepEqual(snap, ["10", "11"]);
  const wybor = d.prepare("SELECT symbol_klucz, symbol, offer_id, status, ofert, wybrano_przez FROM zdjecie_oferty_wybor ORDER BY symbol_klucz").all()
    .map((w) => ({ ...w }));
  assert.deepEqual(wybor, [
    { symbol_klucz: "nie-ma", symbol: "NIE-MA", offer_id: null, status: null, ofert: 0, wybrano_przez: "Ala" },
    { symbol_klucz: "w08-0501", symbol: "W08-0501", offer_id: "10", status: "ACTIVE", ofert: 2, wybrano_przez: "Ala" },
  ]);
  const zdarzenia = d.prepare("SELECT type, payload FROM events").all() as Array<{ type: string; payload: string }>;
  assert.equal(zdarzenia.length, 1);
  assert.equal(zdarzenia[0].type, "zdjecia_allegro_dopasowane");
  assert.deepEqual(JSON.parse(zdarzenia[0].payload), {
    symboli: 2, ofert: 2, wybranych: 1, zeZdjeciem: 1, poKodzieProducenta: 0, niejednoznacznych: 0,
  });
  d.close();
});

test("oferta z kwotą spoza schematu nie zabiera zapisu pozostałym", async () => {
  const d = baza();
  const zla = { ...oferta("20", "X-1"), sellingMode: { price: { amount: "dziesięć", currency: "PLN" } } };
  await m.dopasujOfertyAllegro(["X-1"], "Ala", deps(d, () => ({ offers: [zla, oferta("21", "X-1", { status: "ENDED" })] })));
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM zdjecie_oferty_wybor").get() as { n: number }).n, 1);
  d.close();
});

test("pełna strona woła następną offsetem, niepełna kończy", async () => {
  const d = baza();
  const adresy: string[] = [];
  const pelna = Array.from({ length: 1000 }, (_, i) => oferta(`p${i}`, "INNY"));
  await m.dopasujOfertyAllegro(["S-1"], "Ala", deps(d, (url) => ({
    offers: url.includes("offset=0") ? pelna : [oferta("99", "S-1")],
  }), adresy));
  assert.equal(adresy.length, 2);
  assert.match(adresy[1], /offset=1000/);
  d.close();
});

test("429 od Allegro idzie w górę i niczego nie zapisuje", async () => {
  const d = baza();
  await assert.rejects(
    m.dopasujOfertyAllegro(["S-1"], "Ala", deps(d, () => { throw new BladLimituAllegro("limit", 30_000); })),
    (e: unknown) => e instanceof BladLimituAllegro && e.poIluMs === 30_000,
  );
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM zdjecie_oferty_wybor").get() as { n: number }).n, 0);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n, 0);
  d.close();
});

test("ponad sto symboli to odmowa, zanim cokolwiek pójdzie do Allegro", () => {
  const sto = Array.from({ length: 100 }, (_, i) => `S-${i}`);
  assert.equal(m.symboleAllegroZCiala(sto).ok, true);
  /* Duplikaty i puste nie liczą się do sufitu: Allegro widzi listę po czyszczeniu. */
  assert.equal(m.symboleAllegroZCiala([...sto, "S-0", " ", ""]).ok, true);
  const r = m.symboleAllegroZCiala([...sto, "S-100"]);
  assert.equal(r.ok, false);
  assert.equal(m.symboleAllegroZCiala("S-1").ok, false);
  assert.equal(m.symboleAllegroZCiala([1]).ok, false);
  assert.equal(m.symboleAllegroZCiala(["x".repeat(101)]).ok, false);
});

test("wyłączone dodawanie zdjęć: powód i ani jednego żądania do Allegro", async () => {
  const d = baza();
  config.zdjecia.dodawanie = "";
  let strzalow = 0;
  const wynik = await m.dopasujOfertyAllegro(["S-1"], "Ala", deps(d, () => { strzalow++; return { offers: [] }; }));
  assert.equal(strzalow, 0);
  assert.equal(wynik.wlaczone, false);
  assert.deepEqual(wynik.pozycje, []);
  d.close();
});

// ── Duże zdjęcie ───────────────────────────────────────────────────────────

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

async function zWyborem(d: DatabaseSync): Promise<void> {
  await m.dopasujOfertyAllegro(["S-1"], "Ala", deps(d, () => ({ offers: [oferta("10", "S-1")] })));
}

test("duże zdjęcie: najpierw wariant 1280 px, przy porażce oryginał", async () => {
  const d = baza();
  await zWyborem(d);
  const proby: string[] = [];
  const w = await m.duzeZdjecieOferty("10", {
    database: d, accountId: "konto-1",
    pobierz: async (url) => { proby.push(url); return url.includes("/s1280/") ? null : { bajty: JPEG, mime: "image/jpeg" }; },
  });
  assert.equal(w.ok, true);
  assert.deepEqual(proby, [`${ZDJ.replace("/original/", "/s1280/")}?10`, `${ZDJ}?10`]);
  d.close();
});

test("duże zdjęcie: oferta znana tylko ze snapshotu to 404 i zero wyjść do CDN-u", async () => {
  /* Zasada właściciela: zdjęcie tylko z NASZEJ oferty. Snapshot zna też
     cudze aukcje, pod którymi klient napisał, więc nie jest dowodem. */
  const d = baza();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','konto-1')").run().lastInsertRowid);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id, external_id, nazwa, status, primary_image_url, synced_at)
    VALUES (?, 'cudza', 'Cudza', 'ACTIVE', ?, '2026-10-21T10:00:00.000Z')`).run(konto, ZDJ);
  let strzalow = 0;
  const w = await m.duzeZdjecieOferty("cudza", {
    database: d, accountId: "konto-1",
    pobierz: async () => { strzalow++; return { bajty: JPEG, mime: "image/jpeg" }; },
  });
  assert.equal(w.ok, false);
  assert.equal(!w.ok && w.kod, 404);
  assert.equal(strzalow, 0);
  d.close();
});

test("duże zdjęcie: CDN bez obrazu albo ponad 10 MB to 502", async () => {
  const d = baza();
  await zWyborem(d);
  const nic = await m.duzeZdjecieOferty("10", { database: d, accountId: "konto-1", pobierz: async () => null });
  assert.equal(!nic.ok && nic.kod, 502);
  const duze = await m.duzeZdjecieOferty("10", {
    database: d, accountId: "konto-1",
    pobierz: async () => ({ bajty: Buffer.alloc(10 * 1024 * 1024 + 1), mime: "image/jpeg" }),
  });
  assert.equal(!duze.ok && duze.kod, 502);
  d.close();
});

// ── Kod producenta z lokalnego indeksu ─────────────────────────────────────

/** Oferta w indeksie: z naszej listy (albo cudza), z kodem producenta i sygnaturą. */
function wIndeksie(d: DatabaseSync, id: string, kod: string, o: {
  sygnatura?: string; status?: string; zdjecie?: boolean; nasza?: boolean; synced?: string;
} = {}) {
  const konto = Number((d.prepare(`INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','konto-1')
    ON CONFLICT(channel, external_account_id) DO UPDATE SET channel=channel RETURNING id`).get() as { id: number }).id);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id, external_id, nazwa, sku, status, primary_image_url,
      synced_at, nasza_lista_at, kod_producenta, kod_producenta_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(konto, id, `Oferta ${id}`, o.sygnatura ?? `SYG-${id}`, o.status ?? "ACTIVE",
    o.zdjecie === false ? "" : `${ZDJ}?${id}`, o.synced ?? "2026-10-01T00:00:00.000Z",
    o.nasza === false ? null : "2026-10-01T00:00:00.000Z", kod, "2026-10-01T00:00:00.000Z");
}

const bezOfert = () => ({ offers: [] });

test("kod producenta: symbol bez oferty po sygnaturze dostaje naszą ofertę z kodem, bez wielkości liter", async () => {
  const d = baza();
  wIndeksie(d, "k1", " ls-1 ");
  /* Cudza aukcja spod wiadomości ma ten sam kod, świeższy snapshot i zdjęcie. Nie wchodzi. */
  wIndeksie(d, "cudza", "LS-1", { nasza: false, synced: "2026-10-20T00:00:00.000Z" });
  const wynik = await m.dopasujOfertyAllegro(["LS-1"], "Ala", deps(d, bezOfert));
  assert.ok(wynik.wlaczone);
  assert.deepEqual(wynik.pozycje, [{
    symbol: "LS-1", ofert: 1, po: "kod_producenta", niejednoznaczny: false,
    oferta: { id: "k1", nazwa: "Oferta k1", status: "ACTIVE", startedAt: null, zdjecie: true },
  }]);
  const wybor = { ...d.prepare("SELECT offer_id, po FROM zdjecie_oferty_wybor").get() as object };
  assert.deepEqual(wybor, { offer_id: "k1", po: "kod_producenta" });
  const zd = d.prepare("SELECT payload FROM events").get() as { payload: string };
  assert.equal(JSON.parse(zd.payload).poKodzieProducenta, 1);
  /* Wybór po kodzie otwiera duże zdjęcie, bo strażnik patrzy na `zdjecie_oferty_wybor`. */
  const duze = await m.duzeZdjecieOferty("k1", {
    database: d, accountId: "konto-1", pobierz: async () => ({ bajty: JPEG, mime: "image/jpeg" }),
  });
  assert.equal(duze.ok, true);
  d.close();
});

test("kod producenta: sygnatura ze zdjęciem wygrywa, sygnatura bez zdjęcia ustępuje", async () => {
  const d = baza();
  wIndeksie(d, "k1", "S-1");
  wIndeksie(d, "k2", "S-2");
  const wynik = await m.dopasujOfertyAllegro(["S-1", "S-2"], "Ala", deps(d, () => ({
    offers: [oferta("10", "S-1"), oferta("20", "S-2", { zdjecie: false })],
  })));
  assert.ok(wynik.wlaczone);
  assert.deepEqual(wynik.pozycje.map((p) => [p.symbol, p.oferta?.id, p.po]), [
    ["S-1", "10", "sygnatura"],
    ["S-2", "k2", "kod_producenta"],
  ]);
  const po = d.prepare("SELECT symbol, po FROM zdjecie_oferty_wybor ORDER BY symbol").all().map((w) => ({ ...w }));
  assert.deepEqual(po, [{ symbol: "S-1", po: "sygnatura" }, { symbol: "S-2", po: "kod_producenta" }]);
  d.close();
});

test("kod producenta: kod różny tylko kreską nie trafia, a brak trafienia zapisuje po NULL", async () => {
  const d = baza();
  wIndeksie(d, "k1", "LS51-139");
  const wynik = await m.dopasujOfertyAllegro(["LS51139"], "Ala", deps(d, bezOfert));
  assert.ok(wynik.wlaczone);
  assert.deepEqual(wynik.pozycje, [{ symbol: "LS51139", ofert: 0, oferta: null, po: null, niejednoznaczny: false }]);
  assert.equal((d.prepare("SELECT po FROM zdjecie_oferty_wybor").get() as { po: string | null }).po, null);
  d.close();
});

test("kod producenta: wybór jak przy sygnaturze, zdjęcie przed statusem, potem świeższy snapshot", async () => {
  const d = baza();
  wIndeksie(d, "bez", "K-1", { zdjecie: false, synced: "2026-10-20T00:00:00.000Z" });
  wIndeksie(d, "konczona", "K-1", { status: "ENDED", synced: "2026-10-19T00:00:00.000Z" });
  wIndeksie(d, "starsza", "K-1", { synced: "2026-10-02T00:00:00.000Z" });
  wIndeksie(d, "nowsza", "K-1", { synced: "2026-10-10T00:00:00.000Z" });
  const wynik = await m.dopasujOfertyAllegro(["K-1"], "Ala", deps(d, bezOfert));
  assert.ok(wynik.wlaczone);
  assert.equal(wynik.pozycje[0].oferta?.id, "nowsza");
  assert.equal(wynik.pozycje[0].ofert, 4);
  d.close();
});

test("kod producenta: oferta trafiająca w kilka symboli wejścia nie trafia w żaden", async () => {
  const d = baza();
  /* Oferta kartoteki B-1 ma w kodzie producenta symbol A-1. Dałaby obu to samo zdjęcie. */
  wIndeksie(d, "k5", "A-1", { sygnatura: "B-1" });
  const wynik = await m.dopasujOfertyAllegro(["A-1", "B-1"], "Ala", deps(d, () => ({ offers: [oferta("k5", "B-1")] })));
  assert.ok(wynik.wlaczone);
  assert.deepEqual(wynik.pozycje.map((p) => [p.symbol, p.oferta?.id ?? null, p.po, p.niejednoznaczny]), [
    ["A-1", null, null, true],
    ["B-1", "k5", "sygnatura", false],
  ]);

  /* Dwa symbole wejścia o tym samym kluczu też dzielą jedną ofertę. */
  wIndeksie(d, "k6", "Ab-1");
  const dwa = await m.dopasujOfertyAllegro(["ab-1", "AB-1"], "Ala", deps(d, bezOfert));
  assert.ok(dwa.wlaczone);
  assert.deepEqual(dwa.pozycje.map((p) => [p.oferta, p.niejednoznaczny]), [[null, true], [null, true]]);
  const zd = d.prepare("SELECT payload FROM events ORDER BY id DESC LIMIT 1").get() as { payload: string };
  assert.equal(JSON.parse(zd.payload).niejednoznacznych, 2);
  d.close();
});

test("kod producenta: oferta z sygnaturą innej kartoteki Subiektu nie trafia, choć tamtej nie ma w wejściu", async () => {
  /* Kartoteka B-1 ma już zdjęcie albo jest w innej paczce, więc wejście jej nie zna. */
  const d = baza();
  wIndeksie(d, "k7", "A-1", { sygnatura: "B-1" });
  const pytania: string[][] = [];
  const wynik = await m.dopasujOfertyAllegro(["A-1"], "Ala", deps(d, bezOfert, [],
    async (s) => { pytania.push(s); return [{ symbol: "b-1" }]; }));
  assert.ok(wynik.wlaczone);
  assert.deepEqual(wynik.pozycje, [{ symbol: "A-1", ofert: 0, oferta: null, po: null, niejednoznaczny: false }]);
  assert.deepEqual(pytania, [["B-1"]], "jedno pytanie do Subiektu na żądanie");
  d.close();
});

test("kod producenta: pusta sygnatura albo sygnatura spoza Subiektu nie blokuje oferty", async () => {
  const d = baza();
  wIndeksie(d, "k8", "A-1", { sygnatura: "" });
  wIndeksie(d, "k9", "C-1", { sygnatura: "NIE-KARTOTEKA" });
  const pytania: string[][] = [];
  const wynik = await m.dopasujOfertyAllegro(["A-1", "C-1"], "Ala", deps(d, bezOfert, [],
    async (s) => { pytania.push(s); return []; }));
  assert.ok(wynik.wlaczone);
  assert.deepEqual(wynik.pozycje.map((p) => [p.symbol, p.oferta?.id, p.po]), [
    ["A-1", "k8", "kod_producenta"],
    ["C-1", "k9", "kod_producenta"],
  ]);
  assert.deepEqual(pytania, [["NIE-KARTOTEKA"]], "pustej sygnatury nie sprawdzamy");
  d.close();
});

test("kod producenta: błąd Subiektu odrzuca oferty z cudzą sygnaturą, nie przepuszcza ich", async () => {
  const d = baza();
  wIndeksie(d, "k10", "A-1", { sygnatura: "B-1" });
  const wynik = await m.dopasujOfertyAllegro(["A-1"], "Ala", deps(d, bezOfert, [],
    async () => { throw new Error("Subiekt nie odpowiada"); }));
  assert.ok(wynik.wlaczone);
  assert.equal(wynik.pozycje[0].oferta, null);
  d.close();
});
