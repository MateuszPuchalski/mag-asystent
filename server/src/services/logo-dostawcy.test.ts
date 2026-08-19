import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Logo dostawcy ───────────────────────────────────────────────────────────
   Te testy pilnują JEDNEJ granicy: do bazy wchodzi wyłącznie PNG.

   Nie jest to kaprys formatu. Serwer nie ma czym przerabiać obrazów i mieć nie
   będzie, a kolektor rysuje przez `BitmapFactory`, który nie zna SVG. Logo
   w innym formacie przeszłoby więc przez cały system po cichu i zniknęło
   dopiero na ekranie magazyniera — najdalej od miejsca, w którym ktoś mógłby
   zrozumieć, co się stało. Dlatego odmowa pada TUTAJ i nazywa powód.        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-logo-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let L: typeof import("./logo-dostawcy.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  L = await import("./logo-dostawcy.js");
});

/** Najmniejszy poprawny PNG — 1×1, przezroczysty. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** JPEG po sygnaturze (FF D8 FF) — dla testu odmowy wystarczy nagłówek. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");

beforeEach(() => {
  const d = db();
  for (const t of ["dostawca_logo", "sgt_dokument", "events"]) d.prepare(`DELETE FROM ${t}`).run();
});

function dokument(dokId: number, khId: number | null, dostawca: string) {
  db()
    .prepare(
      `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, kh_id, w_buforze)
       VALUES (?, 'FZ', ?, '2026-08-19', 1, ?, ?, 0)`
    )
    .run(dokId, `FZ ${dokId}/MAG/08/2026`, dostawca, khId);
}

test("PNG przechodzi i wraca tymi samymi bajtami", () => {
  const r = L.zapiszLogo(7001, "GEKO", PNG, "Ewa z biura");
  assert.ok(r.ok, "PNG ma przejść");
  const w = L.logo(7001);
  assert.ok(w);
  assert.equal(w.nazwa, "GEKO");
  assert.deepEqual(w.obraz, Buffer.from(PNG, "base64"));
  assert.equal(w.etag, r.etag);
});

test("JPEG jest odrzucany — kolektor dostałby obraz, którego nie oczekuje", () => {
  const r = L.zapiszLogo(7002, "STIHL", JPEG, "Ewa z biura");
  assert.equal(r.ok, false);
  assert.equal(L.logo(7002), null, "odrzucone logo nie ma prawa wylądować w bazie");
});

test("SVG jest odrzucany — tego formatu kolektor nie narysuje", () => {
  // To jest przypadek ze zgłoszenia: „niektóre loga są webp, niektóre svg".
  // Konwersję robi panel; surowy SVG oznacza, że ktoś ją ominął.
  const r = L.zapiszLogo(7003, "HUSQVARNA", SVG, "Ewa z biura");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /PNG/, "odmowa ma nazwać oczekiwany format");
});

test("śmieć bez sygnatury jest odrzucany", () => {
  const r = L.zapiszLogo(7004, "X", Buffer.from("to nie obraz").toString("base64"), "Ewa z biura");
  assert.equal(r.ok, false);
});

test("puste logo to odmowa, nie pusty wpis", () => {
  assert.equal(L.zapiszLogo(7005, "X", "", "Ewa z biura").ok, false);
  assert.equal(L.logo(7005), null);
});

test("za duże logo odmawia z powodem, zamiast ciąć w ciszy", () => {
  // Nagłówek PNG, reszta wypełniona — chodzi o rozmiar, nie o treść.
  const wielkie = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(70 * 1024)]);
  const r = L.zapiszLogo(7006, "X", wielkie.toString("base64"), "Ewa z biura");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /kB/, "odmowa ma podać rozmiar i limit");
  assert.equal(L.logo(7006), null);
});

test("prefiks data: URL nie przeszkadza", () => {
  const r = L.zapiszLogo(7007, "X", `data:image/png;base64,${PNG}`, "Ewa z biura");
  assert.ok(r.ok);
  assert.ok(L.logo(7007));
});

test("powtórne wgranie podmienia i zmienia etag", () => {
  const pierwsze = L.zapiszLogo(7008, "GEKO", PNG, "Ewa z biura");
  assert.ok(pierwsze.ok);
  // ten sam nagłówek, inna treść — inny obraz, więc inny etag
  const inne = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.from([0x00])]);
  const drugie = L.zapiszLogo(7008, "GEKO SP. Z O.O.", inne.toString("base64"), "Jan z biura");
  assert.ok(drugie.ok);
  assert.notEqual(drugie.etag, pierwsze.etag, "podmiana treści MUSI unieważnić cache");

  const w = L.logo(7008);
  assert.equal(w?.nazwa, "GEKO SP. Z O.O.");
  const ile = db().prepare("SELECT COUNT(*) AS n FROM dostawca_logo").get() as { n: number };
  assert.equal(ile.n, 1, "podmiana, nie drugi wiersz");
});

test("usunięcie kasuje wpis; drugie usunięcie to false, nie błąd", () => {
  L.zapiszLogo(7009, "X", PNG, "Ewa z biura");
  assert.equal(L.usunLogo(7009, "Ewa z biura"), true);
  assert.equal(L.logo(7009), null);
  assert.equal(L.usunLogo(7009, "Ewa z biura"), false);
});

test("zapis i usunięcie zostawiają ślad w audycie", () => {
  L.zapiszLogo(7010, "GEKO", PNG, "Ewa z biura");
  L.usunLogo(7010, "Jan z biura");
  const typy = (
    db().prepare("SELECT type, user_id FROM events ORDER BY id").all() as Array<{
      type: string;
      user_id: string;
    }>
  ).filter((e) => e.type.startsWith("logo_dostawcy"));
  assert.deepEqual(
    typy.map((e) => [e.type, e.user_id]),
    [
      ["logo_dostawcy_zapis", "Ewa z biura"],
      ["logo_dostawcy_usuniecie", "Jan z biura"],
    ]
  );
});

test("lista dostawców pokazuje także tych BEZ logo", () => {
  // odpowiada na pytanie „komu jeszcze brakuje", więc bierze się z dokumentów
  dokument(9001, 500, "GEKO");
  dokument(9002, 500, "GEKO");
  dokument(9003, 501, "STIHL");
  L.zapiszLogo(500, "GEKO", PNG, "Ewa z biura");

  const lista = L.listaDostawcow();
  assert.equal(lista.length, 2);
  const geko = lista.find((d) => d.khId === 500);
  const stihl = lista.find((d) => d.khId === 501);
  assert.equal(geko?.maLogo, true);
  assert.equal(geko?.dokumentow, 2);
  assert.equal(stihl?.maLogo, false);
});

test("dokument bez płatnika nie wywraca listy ani nie robi wiersza-widma", () => {
  dokument(9004, null, "Dostawca nieznany");
  dokument(9005, 502, "FALON-TECH");
  const lista = L.listaDostawcow();
  assert.deepEqual(
    lista.map((d) => d.khId),
    [502],
    "brak identyfikatora znaczy brak wiersza — nie ma do czego przypiąć logo"
  );
});

test("ktorzyMajaLogo odpowiada jednym zapytaniem na całą listę", () => {
  L.zapiszLogo(600, "A", PNG, "Ewa z biura");
  L.zapiszLogo(602, "C", PNG, "Ewa z biura");
  const maja = L.ktorzyMajaLogo([600, 601, 602, 603]);
  assert.deepEqual([...maja].sort((a, b) => a - b), [600, 602]);
});

test("pusta lista kluczy nie idzie do bazy z pustym IN ()", () => {
  assert.equal(L.ktorzyMajaLogo([]).size, 0);
  assert.equal(L.ktorzyMajaLogo([0, -5, NaN]).size, 0);
});
