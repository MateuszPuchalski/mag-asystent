import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zadania-serwis-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Umowa SERWISU, nie tej jednej trasy (0.352.0) ───────────────────────────
   `routes/zadania-terenowe.test.ts` sprawdza zadania przez HTTP i tak ma
   zostać. Ten plik istnieje dla jednej rzeczy, której tamtędy sprawdzić SIĘ
   NIE DA: limitu rozmiaru zdjęcia w `dodajZalacznik`.

   Powód jest zmierzony, nie wydumany. `bodyLimit` trasy stoi na 4 MiB, a to
   po odjęciu narzutu base64 daje ~3 MB obrazu — czyli dokładnie próg serwisu.
   Zdjęcie ponad próg odpada więc na trasie kodem 413 i do serwisu nie
   dociera; pierwsza wersja tej zmiany twierdziła w komentarzu, że to „dwa
   różne progi", i próba na żywym serwerze to obaliła.

   Sprawdzenie w serwisie zostaje, bo `bodyLimit` obowiązuje WYŁĄCZNIE tam,
   a funkcja zawoła się z każdego następnego miejsca, które ktoś dopisze. Bez
   tego testu byłaby nie do odróżnienia od martwego kodu i wyleciałaby przy
   pierwszym sprzątaniu.                                                     */

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zadania-terenowe.js");
let ala = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zadania-terenowe.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["zwrot_zdarzenie", "zadanie_zalacznik", "zadanie_terenowe", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  ala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro')")
    .run().lastInsertRowid);
});

const autor = () => ({ id: ala, name: "Ala" });
const noweZadanie = () => Z.utworzZadanie(
  { rodzaj: "zdjecie", tytul: "Sfotografuj tabliczkę", instrukcja: "Cała, ostro." }, autor());

/** Base64 o zadanej liczbie kilobajtów po zdekodowaniu. */
const base64oKb = (kb: number) => Buffer.alloc(kb * 1024, 0x41).toString("base64");

test("serwis odrzuca zdjęcie ponad próg, choć trasa nigdy mu takiego nie poda", () => {
  const z = noweZadanie();
  assert.throws(() => Z.dodajZalacznik(z.id, base64oKb(3100), undefined, autor()),
    /najwyżej 3072 kB/);
  assert.equal((db().prepare("SELECT count(*) n FROM zadanie_zalacznik").get() as { n: number }).n, 0,
    "odrzucone zdjęcie NIE ZOSTAWIA pliku ani wiersza");
});

test("zdjęcie tuż pod progiem przechodzi — próg ma przepuszczać, nie blokować", () => {
  const z = noweZadanie();
  const po = Z.dodajZalacznik(z.id, base64oKb(3000), "Tabliczka", autor());
  assert.equal(po.zalaczniki.length, 1);
  assert.equal(po.zalaczniki[0].opis, "Tabliczka");
});

test("podpis jest nieobowiązkowy, ale nie bywa powieścią", () => {
  const z = noweZadanie();
  assert.equal(Z.dodajZalacznik(z.id, base64oKb(1), undefined, autor()).zalaczniki[0].opis, null,
    "kciuk w rękawicy ma zrobić zdjęcie, a nie opisać je zdaniem");
  assert.throws(() => Z.dodajZalacznik(z.id, base64oKb(1), "x".repeat(501), autor()),
    /najwyżej 500 znaków/);
});

test("skasowanie zadania zabiera jego zdjęcia — załącznik bez zadania nic nie znaczy", () => {
  const z = noweZadanie();
  Z.dodajZalacznik(z.id, base64oKb(1), undefined, autor());
  db().prepare("DELETE FROM zadanie_terenowe WHERE id=?").run(z.id);
  assert.equal((db().prepare("SELECT count(*) n FROM zadanie_zalacznik").get() as { n: number }).n, 0,
    "CASCADE ze `schema.sql` działa — inaczej retencja zostawiałaby sieroty");
});

/* ── Zadanie ze sprawy: skąd i dokąd wraca (0.502.0) ───────────────────────
   Zwrot, reklamacja, dyskusja i dostawa zlecają hali z numerem sprawy.
   Karta zadania prowadzi z powrotem, wynik i odesłanie wracają na oś zwrotu,
   a odesłane zadanie staje w Do zrobienia.                                */
const zwrot = () => {
  const d = db();
  d.prepare("DELETE FROM zwrot_zdarzenie").run();
  d.prepare("DELETE FROM zwrot_klienta").run();
  const k = Number(d.prepare("INSERT OR IGNORE INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-z')")
    .run().lastInsertRowid) || Number((d.prepare("SELECT id FROM channel_account WHERE external_account_id='seller-z'").get() as { id: number }).id);
  return Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,created_at,synced_at)
    VALUES (?,'z-1','Z-1','ord-1','2026-09-20T08:00:00Z','2026-09-20')`).run(k).lastInsertRowid);
};

test("zadanie ze zwrotu ma odnośnik, a wynik i odesłanie wracają na oś zwrotu", () => {
  const idZwrotu = zwrot();
  const z = Z.utworzZadanie({ rodzaj: "weryfikacja", tytul: "Zwrot Z-1", instrukcja: "Sprawdź stan noża z kosza.",
    zrodlo: "zwrot", zrodloRef: String(idZwrotu) }, autor());
  assert.equal(z.cel, `/obsluga/zwroty/${idZwrotu}`);
  Z.wezZadanie(z.id, autor());
  Z.wykonajZadanie(z.id, "bez śladów użycia", autor());

  const z2 = Z.utworzZadanie({ rodzaj: "zdjecie", tytul: "Zwrot Z-1", instrukcja: "Zdjęcie pudełka.",
    zrodlo: "zwrot", zrodloRef: String(idZwrotu) }, autor());
  Z.odeslijZadanie(z2.id, "brak_towaru", null, autor());
  const os = db().prepare("SELECT rodzaj, tresc FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY id").all(idZwrotu) as
    Array<{ rodzaj: string; tresc: string }>;
  assert.deepEqual(os.map((w) => w.rodzaj), ["zadanie_wynik", "zadanie_odeslane"]);
  assert.equal(os[0].tresc, "Hala: bez śladów użycia");
  assert.match(os[1].tresc, /brak towaru/);
});

test("zadanie ze sprawy, której nie ma, nie powstaje; ręczne nie ma odnośnika", () => {
  assert.throws(() => Z.utworzZadanie({ rodzaj: "inne", tytul: "x", instrukcja: "y", zrodlo: "zwrot", zrodloRef: "999999" },
    autor()), /Nie znaleziono sprawy/);
  assert.throws(() => Z.utworzZadanie({ rodzaj: "inne", tytul: "x", instrukcja: "y", zrodlo: "reklamacja" }, autor()),
    /wymaga jej numeru/);
  assert.equal(noweZadanie().cel, null);
});

test("odesłane zadanie staje w Do zrobienia i prowadzi do Zadań", async () => {
  const { doDecyzji } = await import("./do-decyzji.js");
  const z = noweZadanie();
  Z.odeslijZadanie(z.id, "nie_da_sie", "tabliczka zatarta", autor());
  const w = doDecyzji().pozycje.find((p) => p.zrodlo === "zadania");
  assert.ok(w);
  assert.equal(w.cel.panel, "/obsluga/zadania");
  assert.match(w.co, /Sfotografuj tabliczkę · nie da się · tabliczka zatarta/);
});
