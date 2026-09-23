import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-automat-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Kolejka wiedzy opróżnia się sama (0.331.0) ──────────────────────────────
   Właściciel odwrócił zasadę „automat nie zatwierdza". Te testy nie pilnują
   już tamtej granicy — pilnują tego, co po niej zostało, a zostało dokładnie
   tyle, ile decyduje o tym, czy da się to cofnąć:

   1. AUTOMAT NIE WYMYŚLA MARKI. Trzy źródła deterministyczne rozstrzygają
      albo milczą; model językowy przechodzi przez to samo sito, co dane
      doboru ze szkicu. Wiersz bez marki ZOSTAJE w kolejce — pusty klucz
      byłby gorszy od braku klucza.
   2. PODPIS MASZYNY JEST ODRÓŻNIALNY. Para `rozstrzygnal` niepuste
      i `rozstrzygnal_user_id` puste to jedyny znacznik, po którym stoi lista
      do prostowania i pomiar. Zrównanie go z podpisem człowieka jest jedyną
      zmianą w tym module, której nie da się cofnąć.
   3. CZŁOWIEK DALEJ PRZECHODZI PRZEZ STRAŻNIKA. Magazynier nie zatwierdza
      wiedzy i to się nie zmieniło ani o stopień.
   4. POTKNIĘCIE NA WIERSZU NIE PRZERYWA PRZEBIEGU.                         */

let db: typeof import("../db/db.js").db;
let A: typeof import("./wiedza-automat.js");
let W: typeof import("./wiedza.js");
let P: typeof import("./pasowania.js");

let biuro = 0;
let hala = 0;
const SZR = 601;
const KOSA = 602;

before(async () => {
  ({ db } = await import("../db/db.js"));
  A = await import("./wiedza-automat.js");
  W = await import("./wiedza.js");
  P = await import("./pasowania.js");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(SZR, "SZR-148/82", "Szarpak 148 mm do NAC");
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(KOSA, "GLO-0001", "Głowica żyłkowa uniwersalna");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "pasowanie_czesci", "model_urzadzenia",
    "model_z_opisu", "offer_snapshot", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  hala = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('marek','M. Kowal','magazynier')").run().lastInsertRowid);
});

const ALA = () => ({ userId: biuro, name: "A. Lewandowska" });
/** Atrapa odpowiedzi modelu; zużycie zerowe, bo nikt tu do dostawcy nie idzie. */
const odpowiedzModelu = (model: import("./wiedza.js").DaneModelu | null) => ({
  model, zuzycie: { wej: 0, wyj: 0, cacheZapis: 0, cacheOdczyt: 0 }, ms: 1,
});
const marki = () => ["NAC", "NAC PRO", "STIHL"];

/** Wiersz kolejki `model_z_opisu`. */
const wiersz = (tekst: string, twId = SZR, ofertaId: string | null = null) => Number(db().prepare(
  `INSERT INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm,zrodlo,oferta_id)
   VALUES (?,?,?,?,?,?)`)
  .run(twId, "SZR-148/82", tekst, tekst.toLowerCase().replace(/\s/g, ""),
    ofertaId ? "oferta" : "opis", ofertaId).lastInsertRowid);

/* ── Źródło 1: marka na początku tekstu ───────────────────────────────────── */

test("dłuższa marka wygrywa — inaczej „NAC PRO 46” traci człon marki w nazwie", () => {
  const m = A.markaNaPoczatku("NAC PRO 46", marki());
  assert.equal(m?.marka, "NAC PRO");
  assert.equal(m?.nazwa, "46");
});

test("sama marka bez nazwy to nie jest model", () => {
  assert.equal(A.markaNaPoczatku("NAC", marki()), null);
});

test("tekst bez znanej marki nie dostaje marki z powietrza", () => {
  assert.equal(A.markaNaPoczatku("LS 46-450", marki()), null);
});

/* ── Źródło 2: jedyny znany model o tej nazwie ────────────────────────────── */

test("jedno trafienie rozstrzyga, dwa trafienia milczą", () => {
  W.upewnijModel({ rodzaj: "maszyna", marka: "STIHL", nazwa: "FS450" }, ALA());
  const jedno = A.jedynyModelPoNazwie(db(), "FS450");
  assert.equal(jedno?.marka, "STIHL");

  /* Druga marka z tą samą nazwą zamienia rozstrzygnięcie w zgadywanie,
     a zgadywanie kończy się częścią wysłaną do złej maszyny. */
  W.upewnijModel({ rodzaj: "maszyna", marka: "NAC", nazwa: "FS450" }, ALA());
  assert.equal(A.jedynyModelPoNazwie(db(), "FS450"), null);
});

/* ── Źródło 3: marka z kontekstu, i pułapka, której tu nie ma ─────────────── */

test("marka znaleziona w nazwie kartoteki składa klucz", () => {
  const m = A.markaZKontekstu(db(), SZR, null, "LS 46-450", marki());
  assert.equal(m?.marka, "NAC", "„Szarpak 148 mm do NAC” niesie markę maszyny");
  assert.equal(m?.nazwa, "LS 46-450");
});

test("kartoteka bez znanej marki nie daje klucza", () => {
  assert.equal(A.markaZKontekstu(db(), KOSA, null, "LS 46-450", marki()), null);
});

test("PARAMETR „Marka” naszej oferty NIE jest źródłem marki maszyny", () => {
  /* To jest pułapka, na którą wszedł pierwszy szkic tego modułu. Parametr
     niesie markę CZĘŚCI. Wzięty jako marka maszyny dałby „WERTIS LS 46-450”:
     markę sprzedawcy sklejoną z nazwą cudzej kosiarki i zatwierdzoną
     automatycznie. Tytuł oferty czytamy, parametru nie. */
  const konto = Number(db().prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  db().prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,parametry_json,synced_at)
    VALUES (?,?,?,?,?)`).run(konto, "of-9", "Głowica żyłkowa do kosy",
    JSON.stringify([{ nazwa: "Marka", wartosci: ["WERTIS"] }]), "2026-09-14T08:00:00.000Z");

  const m = A.markaZKontekstu(db(), KOSA, "of-9", "LS 46-450", [...marki(), "WERTIS"]);
  assert.equal(m, null, "żadna marka nie stoi w tytule oferty ani w nazwie kartoteki");
});

/* ── Przebieg ─────────────────────────────────────────────────────────────── */

test("wiersz kolejki przechodzi całą drogę do zatwierdzonej wiedzy, podpisany automatem", async () => {
  W.upewnijModel({ rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" }, ALA());
  wiersz("NAC LS 46-450");

  const w = await A.oproznijKolejke({ database: db() });
  assert.equal(w.zlozonych, 1);
  assert.equal(w.zastosowan, 1);
  assert.equal(w.bezMarki, 0);

  const z = db().prepare(
    `SELECT stan, rozstrzygnal, rozstrzygnal_user_id FROM zastosowanie`).get() as Record<string, unknown>;
  assert.equal(z.stan, "zatwierdzone");
  assert.equal(z.rozstrzygnal, "automat (wiedza)");
  assert.equal(z.rozstrzygnal_user_id, null, "pusty user_id to JEDYNY znacznik wpisu maszyny");
});

test("wiersz, przy którym wszystkie źródła milczą, ZOSTAJE w kolejce", async () => {
  wiersz("236; 240", KOSA);
  const w = await A.oproznijKolejke({ database: db() });

  assert.equal(w.bezMarki, 1);
  assert.equal(w.zlozonych, 0);
  assert.equal(
    (db().prepare("SELECT stan FROM model_z_opisu").get() as { stan: string }).stan, "nowy",
    "pusty klucz byłby gorszy od braku klucza");
});

test("potknięcie na jednym wierszu nie przerywa przebiegu", async () => {
  W.upewnijModel({ rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" }, ALA());
  /* Dwa wiersze prowadzące do TEGO SAMEGO klucza, różnymi źródłami: pierwszy
     ma markę w tekście, drugi trafia w jedyny znany model po nazwie. Drugi
     wywróci się na „ta para już czeka w kolejce albo jest zatwierdzona”,
     a trzeci ma mimo to przejść.

     Trzeci wiersz niesie ZNANĄ markę na czele. Do zbiórki „Pasuje do" stał
     tu „STIHL FS450" i przechodził wyłącznie dlatego, że źródło 3 doklejało
     mu markę z kontekstu — „NAC STIHL FS450". To był błąd, nie przejście. */
  wiersz("NAC LS 46-450");
  wiersz("LS 46-450");
  wiersz("NAC LS 51");

  const w = await A.oproznijKolejke({ database: db() });
  assert.ok(w.bledow >= 1, "dubel miał się wywrócić");
  assert.ok(w.zlozonych >= 2, "a reszta kolejki miała przejść mimo to");
});

test("propozycja bez dowodu nie zostaje zatwierdzona nawet przez automat", async () => {
  /* Warunek „zatwierdzenie wymaga choć jednego dowodu” zostaje także dla
     maszyny. Zniesienie go byłoby zatwierdzaniem wiedzy, która nie stoi na
     niczym — a to już nie jest przyspieszanie kolejki. */
  const z = W.zaproponujZastosowanie({
    twId: SZR, model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" },
    polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "rozmowa", tresc: "ślad rozmowy" },
  }, ALA())!;
  db().prepare("DELETE FROM dowod_zastosowania WHERE zastosowanie_id=?").run(z.id);

  const w = await A.oproznijKolejke({ database: db() });
  assert.equal(w.zastosowan, 0);
  assert.equal(w.bledow, 1);
  assert.equal((db().prepare("SELECT stan FROM zastosowanie WHERE id=?").get(z.id) as
    { stan: string }).stan, "propozycja");
});

test("pasowanie też przechodzi, a lista do prostowania pokazuje oba rodzaje", async () => {
  const p = P.zaproponujPasowanie({
    twId: SZR, doTwId: KOSA, rola: "uszczelka", pozycja: null, polaryzacja: "pasuje",
    rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog 2024", zrodlo: "reczne",
  }, ALA())!;

  const w = await A.oproznijKolejke({ database: db() });
  assert.equal(w.pasowan, 1);

  const lista = A.coAutomatDopisal(100, db());
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.rodzaj, "pasowanie");
  assert.equal(lista[0]!.id, p.id);
});

test("wpis CZŁOWIEKA nie trafia na listę „co automat dopisał”", () => {
  const z = W.zaproponujZastosowanie({
    twId: SZR, model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" },
    polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024" },
  }, ALA())!;
  W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);

  assert.deepEqual(A.coAutomatDopisal(100, db()), [],
    "lista do prostowania ma pokazywać maszynę, nie pracę biura");
});

/* ── Źródło 4: model językowy przez to samo sito ──────────────────────────── */

test("marka WYMYŚLONA przez model nie wchodzi do wiedzy", async () => {
  wiersz("236; 240", KOSA);
  const w = await A.oproznijKolejke({
    database: db(),
    /* „Husqvarna” nie stoi ani w tekście wiersza, ani w nazwie kartoteki,
       ani wśród marek, które przeszły przez człowieka. */
    nadajKlucz: async () => odpowiedzModelu({ rodzaj: "maszyna", marka: "Husqvarna", nazwa: "236" }),
  });

  assert.equal(w.zlozonych, 0);
  assert.equal(w.bezMarki, 1);
});

test("marka ZNANA, wskazana przez model, przechodzi", async () => {
  W.upewnijModel({ rodzaj: "maszyna", marka: "STIHL", nazwa: "MS 170" }, ALA());
  wiersz("MS 181", KOSA);

  const w = await A.oproznijKolejke({
    database: db(),
    nadajKlucz: async () => odpowiedzModelu({ rodzaj: "maszyna", marka: "STIHL", nazwa: "MS 181" }),
  });
  assert.equal(w.zlozonych, 1);
  assert.equal(w.zastosowan, 1);
});

/* ── Czego automat NIE zniósł ─────────────────────────────────────────────── */

test("magazynier dalej nie zatwierdza wiedzy — strażnik ludzkiej gałęzi stoi", () => {
  const z = W.zaproponujZastosowanie({
    twId: SZR, model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" },
    polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024" },
  }, ALA())!;
  assert.throws(() => W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, hala), /człowiek z biura/);
});
