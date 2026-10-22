import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* ── Indeks kodów producenta naszych ofert ───────────────────────────────────
   Bez sieci: atrapa `query`. Pilnujemy wyciągania kodu z obu miejsc odpowiedzi,
   stronicowania listy, partii dziesięciu ofert, świeżości miesiąca, zapisu
   przed 429 i tego, że stan indeksu niczego nie zapisuje. */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjidx-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";

type Modul = typeof import("./zdjecia-allegro-indeks.js");
let m: Modul;
let migrate: typeof import("../db/db.js").migrate;
let BladLimituAllegro: typeof import("../adapters/allegro.js").BladLimituAllegro;

before(async () => {
  m = await import("./zdjecia-allegro-indeks.js");
  ({ migrate } = await import("../db/db.js"));
  ({ BladLimituAllegro } = await import("../adapters/allegro.js"));
});

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

const TERAZ = new Date("2026-10-21T10:00:00.000Z");

const deps = (d: DatabaseSync, odpowiedz: (url: string) => unknown, adresy: string[] = [], now = TERAZ) => ({
  database: d, apiUrl: "https://api.test", accountId: "konto-1",
  now: () => now,
  query: async (url: string) => { adresy.push(url); return odpowiedz(url); },
});

const oferta = (id: string, status = "ACTIVE") => ({
  id, name: `Oferta ${id}`, external: { id: `SYG-${id}` },
  publication: { status }, primaryImage: { url: `https://a.allegroimg.com/original/${id}.jpg` },
  sellingMode: { price: { amount: "10.00", currency: "PLN" } },
});

const wiersz = (d: DatabaseSync, id: string) => ({
  ...(d.prepare(`SELECT nasza_lista_at, kod_producenta, kod_producenta_at, tresc_synced_at, opis
    FROM offer_snapshot WHERE external_id=?`).get(id) as Record<string, unknown>),
});

const zdarzenia = (d: DatabaseSync) =>
  (d.prepare("SELECT type, payload FROM events ORDER BY id").all() as Array<{ type: string; payload: string }>)
    .map((z) => ({ type: z.type, payload: JSON.parse(z.payload) }));

// ── Kod producenta z odpowiedzi ────────────────────────────────────────────

test("kod producenta: po id w parametrach oferty i produktu, zapasowo po nazwie, pusty przy braku", () => {
  assert.equal(m.kodProducenta({ parameters: [
    { id: "11323", name: "Stan", values: ["Nowy"] },
    { id: "224017", name: "Cokolwiek", values: [" W08-0501 ", "drugi"] },
  ] }), "W08-0501");
  assert.equal(m.kodProducenta({
    parameters: [{ id: "11323", name: "Stan", values: ["Nowy"] }],
    productSet: [{ product: { id: "p1", parameters: [{ id: "224017", name: "Manufacturer code", values: ["AB-12"] }] } }],
  }), "AB-12");
  /* Id wygrywa z nazwą, nawet gdy nazwa stoi wcześniej. */
  assert.equal(m.kodProducenta({
    parameters: [{ id: "999", name: "Kod producenta", values: ["Z-NAZWY"] }],
    productSet: [{ product: { parameters: [{ id: "224017", values: ["Z-ID"] }] } }],
  }), "Z-ID");
  assert.equal(m.kodProducenta({ parameters: [{ id: "1", name: "Manufacturer Code", values: ["MC-1"] }] }), "MC-1");
  assert.equal(m.kodProducenta({ parameters: [{ id: "1", name: "kod producenta", values: [] }] }), "");
  assert.equal(m.kodProducenta({ parameters: [{ id: "11323", name: "Stan", values: ["Nowy"] }] }), "");
  assert.equal(m.kodProducenta(null), "");
  assert.equal(m.kodProducenta({ parameters: "śmieć", productSet: [null] }), "");
});

// ── Lista naszych ofert ────────────────────────────────────────────────────

test("lista: jedna strona do snapshotu ze znacznikiem, nastepny przy pełnej stronie", async () => {
  const d = baza();
  const adresy: string[] = [];
  const pelna = Array.from({ length: 1000 }, (_, i) => oferta(`p${i}`));
  const w = await m.odswiezListeOfert(0, "Ala", deps(d, () => ({ offers: pelna, totalCount: 1500 }), adresy));
  assert.deepEqual(w, { ofert: 1000, razem: 1500, nastepny: 1000 });
  assert.equal(adresy.length, 1);
  assert.equal(adresy[0],
    "https://api.test/sale/offers?publication.status=ACTIVE&publication.status=ENDED&limit=1000&offset=0");
  assert.equal(wiersz(d, "p7").nasza_lista_at, TERAZ.toISOString());
  assert.deepEqual(zdarzenia(d), [{ type: "zdjecia_allegro_indeks_lista",
    payload: { offset: 0, ofert: 1000, zapisanych: 1000, razem: 1500 } }]);
  d.close();
});

test("lista: koniec przy niepełnej stronie i przy totalCount równym następnemu offsetowi", async () => {
  const d = baza();
  const adresy: string[] = [];
  const w1 = await m.odswiezListeOfert(1000, "Ala", deps(d, () => ({ offers: [oferta("1")], totalCount: 1001 }), adresy));
  assert.deepEqual(w1, { ofert: 1, razem: 1001, nastepny: null });
  assert.match(adresy[0], /offset=1000$/);
  const pelna = Array.from({ length: 1000 }, (_, i) => oferta(`q${i}`));
  assert.equal((await m.odswiezListeOfert(0, "Ala", deps(d, () => ({ offers: pelna, totalCount: 1000 })))).nastepny, null);
  /* Bez totalCount pełna strona to jedyna wskazówka, że jest dalej. */
  assert.equal((await m.odswiezListeOfert(0, "Ala", deps(d, () => ({ offers: pelna })))).nastepny, 1000);
  d.close();
});

test("lista: oferta spoza schematu nie zabiera znacznika pozostałym, 429 idzie w górę", async () => {
  const d = baza();
  const zla = { ...oferta("z"), sellingMode: { price: { amount: "dziesięć", currency: "PLN" } } };
  await m.odswiezListeOfert(0, "Ala", deps(d, () => ({ offers: [zla, oferta("ok")] })));
  assert.equal(wiersz(d, "ok").nasza_lista_at, TERAZ.toISOString());
  await assert.rejects(
    m.odswiezListeOfert(0, "Ala", deps(d, () => { throw new BladLimituAllegro("limit", 5000); })),
    (e: unknown) => e instanceof BladLimituAllegro,
  );
  d.close();
});

// ── Parametry ofert ────────────────────────────────────────────────────────

/** Snapshot oferty z naszej listy albo spoza niej (cudza aukcja spod wiadomości). */
function wstaw(d: DatabaseSync, id: string, o: { status?: string; nasza?: boolean; kodAt?: string | null } = {}) {
  const konto = Number((d.prepare(`INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','konto-1')
    ON CONFLICT(channel, external_account_id) DO UPDATE SET channel=channel RETURNING id`).get() as { id: number }).id);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id, external_id, nazwa, status, primary_image_url, synced_at,
      nasza_lista_at, kod_producenta, kod_producenta_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(konto, id, `Oferta ${id}`, o.status ?? "ACTIVE", "", TERAZ.toISOString(),
    o.nasza === false ? null : TERAZ.toISOString(), o.kodAt ? "STARY" : null, o.kodAt ?? null);
}

const zKodem = (kod: string) => ({
  parameters: [{ id: "224017", name: "Kod producenta", values: [kod] }],
  description: { sections: [{ items: [{ type: "TEXT", content: "<p>Opis</p>" }] }] },
});

test("parametry: dziesięć ofert na krok, najpierw aktywne, zapis kodu i treści", async () => {
  const d = baza();
  for (let i = 0; i < 12; i++) wstaw(d, `e${String(i).padStart(2, "0")}`, { status: "ENDED" });
  wstaw(d, "a1");
  wstaw(d, "cudza", { nasza: false });
  const adresy: string[] = [];
  const w = await m.pobierzParametryOfert("Ala", deps(d, (url) => zKodem(`K-${url.split("/").pop()}`), adresy));
  assert.deepEqual(w, { pobrano: 10, zostalo: 3 });
  assert.equal(adresy.length, 10);
  assert.equal(adresy[0], "https://api.test/sale/product-offers/a1", "aktywna pierwsza");
  assert.ok(!adresy.some((u) => u.endsWith("/cudza")), "oferta spoza naszej listy nie idzie do indeksu");
  assert.deepEqual(wiersz(d, "a1"), {
    nasza_lista_at: TERAZ.toISOString(), kod_producenta: "K-a1", kod_producenta_at: TERAZ.toISOString(),
    tresc_synced_at: TERAZ.toISOString(), opis: "Opis",
  });
  assert.deepEqual(zdarzenia(d), [{ type: "zdjecia_allegro_indeks_parametry", payload: { pobrano: 10, bledow: 0 } }]);
  d.close();
});

test("parametry: świeży kod nie wraca przez trzydzieści dni, starszy wraca", async () => {
  const d = baza();
  wstaw(d, "swiezy", { kodAt: "2026-09-30T10:00:00.000Z" });
  wstaw(d, "stary", { kodAt: "2026-09-20T10:00:00.000Z" });
  const adresy: string[] = [];
  const w = await m.pobierzParametryOfert("Ala", deps(d, () => ({ parameters: [] }), adresy));
  assert.deepEqual(adresy, ["https://api.test/sale/product-offers/stary"]);
  assert.deepEqual(w, { pobrano: 1, zostalo: 0 });
  assert.equal(wiersz(d, "stary").kod_producenta, "", "pytaliśmy, kodu nie ma");
  d.close();
});

test("parametry: 404 zapisuje pusty kod bez ruszania treści", async () => {
  const d = baza();
  wstaw(d, "znikla");
  await m.pobierzParametryOfert("Ala", deps(d, () => null));
  const w = wiersz(d, "znikla");
  assert.equal(w.kod_producenta, "");
  assert.equal(w.kod_producenta_at, TERAZ.toISOString());
  assert.equal(w.tresc_synced_at, null);
  d.close();
});

test("parametry: 429 w połowie kroku zostawia zapisane oferty i wpis w dzienniku", async () => {
  const d = baza();
  for (const id of ["a", "b", "c"]) wstaw(d, id);
  let n = 0;
  await assert.rejects(
    m.pobierzParametryOfert("Ala", deps(d, () => {
      if (++n === 3) throw new BladLimituAllegro("limit", 7000);
      return zKodem(`K${n}`);
    })),
    (e: unknown) => e instanceof BladLimituAllegro && e.poIluMs === 7000,
  );
  assert.equal(wiersz(d, "a").kod_producenta, "K1");
  assert.equal(wiersz(d, "b").kod_producenta, "K2");
  assert.equal(wiersz(d, "c").kod_producenta_at, null);
  assert.deepEqual(zdarzenia(d), [{ type: "zdjecia_allegro_indeks_parametry", payload: { pobrano: 2, bledow: 0 } }]);
  d.close();
});

test("parametry: błąd jednej oferty ją pomija, błąd każdej to błąd kroku", async () => {
  const d = baza();
  wstaw(d, "a");
  wstaw(d, "b");
  const w = await m.pobierzParametryOfert("Ala", deps(d, (url) => {
    if (url.endsWith("/a")) throw new Error("ECONNRESET");
    return zKodem("KB");
  }));
  assert.deepEqual(w, { pobrano: 1, zostalo: 1 });
  assert.equal(wiersz(d, "a").kod_producenta_at, null, "bez kodu, więc wróci po przerwie");
  const poPrzerwie = new Date(TERAZ.getTime() + 2 * 3_600_000);
  await assert.rejects(
    m.pobierzParametryOfert("Ala", deps(d, () => { throw new Error("ECONNRESET"); }, [], poPrzerwie)),
    /ECONNRESET/,
  );
  d.close();
});

test("parametry: oferta po błędzie idzie na koniec kolejki i wraca dopiero po godzinie", async () => {
  const d = baza();
  for (let i = 0; i < 12; i++) wstaw(d, `o${String(i).padStart(2, "0")}`);
  const zle = new Set(["o00", "o01", "o02"]);
  const odp = (url: string) => {
    if (zle.has(url.split("/").pop()!)) throw new Error("500");
    return zKodem("K");
  };
  const pierwszy = await m.pobierzParametryOfert("Ala", deps(d, odp));
  assert.deepEqual(pierwszy, { pobrano: 7, zostalo: 5 }, "złe liczą się dalej w zostało");

  /* Drugi krok pięć minut później nie bierze złych, tylko dwie pozostałe. */
  const adresy: string[] = [];
  const zaChwile = new Date(TERAZ.getTime() + 5 * 60_000);
  const drugi = await m.pobierzParametryOfert("Ala", deps(d, odp, adresy, zaChwile));
  assert.deepEqual(adresy.map((u) => u.split("/").pop()), ["o10", "o11"]);
  assert.deepEqual(drugi, { pobrano: 2, zostalo: 3 });

  /* Gdy zostały same świeżo złe, krok nic nie bierze i nie woła Allegro. */
  const trzeci: string[] = [];
  assert.deepEqual(await m.pobierzParametryOfert("Ala", deps(d, odp, trzeci, zaChwile)), { pobrano: 0, zostalo: 3 });
  assert.equal(trzeci.length, 0);

  /* Po godzinie wracają, a udany odczyt zdejmuje znacznik błędu. */
  zle.clear();
  const poGodzinie = new Date(TERAZ.getTime() + 61 * 60_000);
  assert.deepEqual(await m.pobierzParametryOfert("Ala", deps(d, odp, [], poGodzinie)), { pobrano: 3, zostalo: 0 });
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM offer_snapshot WHERE kod_producenta_blad_at IS NOT NULL")
    .get() as { n: number }).n, 0);
  d.close();
});

// ── Stan indeksu ───────────────────────────────────────────────────────────

test("stan indeksu: liczby z bazy i ani jednego zapisu, także bez konta kanału", () => {
  const pusta = baza();
  assert.deepEqual(m.stanIndeksu({ database: pusta, accountId: "konto-1", now: () => TERAZ }),
    { ofert: 0, zKodem: 0, doPobrania: 0, listaAt: null });
  assert.equal((pusta.prepare("SELECT COUNT(*) AS n FROM channel_account").get() as { n: number }).n, 0);
  pusta.close();

  const d = baza();
  wstaw(d, "a");
  wstaw(d, "b", { kodAt: "2026-10-20T10:00:00.000Z" });
  wstaw(d, "c", { kodAt: "2026-10-20T10:00:00.000Z" });
  d.prepare("UPDATE offer_snapshot SET kod_producenta='' WHERE external_id='c'").run();
  wstaw(d, "cudza", { nasza: false });
  const przed = d.prepare("SELECT total_changes() AS n").get() as { n: number };
  assert.deepEqual(m.stanIndeksu({ database: d, accountId: "konto-1", now: () => TERAZ }),
    { ofert: 3, zKodem: 1, doPobrania: 1, listaAt: TERAZ.toISOString() });
  assert.deepEqual(d.prepare("SELECT total_changes() AS n").get(), przed);
  d.close();
});

test("parametry: krok z samymi błędami też zostawia wpis w dzienniku", async () => {
  const d = baza();
  wstaw(d, "a");
  await assert.rejects(m.pobierzParametryOfert("Ala", deps(d, () => { throw new Error("500"); })), /500/);
  assert.deepEqual(zdarzenia(d), [{ type: "zdjecia_allegro_indeks_parametry", payload: { pobrano: 0, bledow: 1 } }]);
  d.close();
});
