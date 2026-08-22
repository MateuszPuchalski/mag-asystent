import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Zapis zdjęcia do kartoteki Subiekta (0.88.0) ────────────────────────────
   Do 0.87.0 zdjęcia były WYŁĄCZNIE do odczytu i tak to opisywał
   `docs/subiekt-gt-struktura.md`. To jest pierwszy INSERT tej aplikacji do bazy
   firmy, więc bramkujemy tu wszystko, co da się zbramkować bez serwera MSSQL:
   KSZTAŁT ZAPYTANIA i to, że nazwy tabel i kolumn przechodzą przez
   `assertSafeColumn`. Wzorzec i powód — `budujZapytanieBlob` w zdjecia.sgt.ts.

   Czego ten plik NIE DOWODZI: że Subiekt taki wiersz przyjmie. Suma kontrolna
   `zd_CRC` i sposób rysowania przezroczystości są `[WERYFIKUJ]` i rozstrzyga
   je kartoteka próbna (DEPLOY §6).                                            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjz-")), "t.db");
process.env.SGT_MODE = "seeded";

let budujZapytanieInsert: typeof import("./sfera.sql.js").budujZapytanieInsert;
let budujZapytanieLiczby: typeof import("./sfera.sql.js").budujZapytanieLiczby;
let db: typeof import("../db/db.js").db;
let adapter: import("./sfera.js").SferaAdapter;
let zapiszWlasne: typeof import("../services/zdjecia-wlasne.js").zapiszWlasne;
let wlasneZdjecie: typeof import("../services/zdjecia-wlasne.js").wlasneZdjecie;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const NAZWY = {
  tabela: "tw_ZdjecieTw",
  kolumna: "zd_Zdjecie",
  klucz: "zd_IdTowar",
  glowne: "zd_Glowne",
};

before(async () => {
  ({ budujZapytanieInsert, budujZapytanieLiczby } = await import("./sfera.sql.js"));
  ({ db } = await import("../db/db.js"));
  ({ zapiszWlasne, wlasneZdjecie } = await import("../services/zdjecia-wlasne.js"));
  const { DevSferaAdapter } = await import("./sfera.dev.js");
  adapter = new DevSferaAdapter();
});

beforeEach(() => {
  for (const t of ["zdjecie_wlasne", "zdjecie_cache"]) db().prepare(`DELETE FROM ${t}`).run();
});

// ── Kształt zapytania ───────────────────────────────────────────────────────

test("INSERT nazywa tabelę, klucz, obraz i flagę głównego", () => {
  const q = budujZapytanieInsert(NAZWY);
  assert.match(q, /INSERT INTO tw_ZdjecieTw \(zd_IdTowar, zd_Zdjecie, zd_Glowne\)/);
  assert.match(q, /VALUES \(@id, @obraz, @glowne\)/);
});

/* Algorytmu `zd_CRC` repozytorium NIE ZNA. Własna liczba w tej kolumnie byłaby
   zgadywaniem zapisanym do bazy firmy, więc bez nazwy kolumny nie dotykamy jej
   w ogóle — a to znaczy, że nie ma jej też w liście kolumn INSERT-u. */
test("bez ZDJECIA_KOLUMNA_CRC suma kontrolna NIE wchodzi do zapytania", () => {
  const q = budujZapytanieInsert(NAZWY);
  assert.ok(!/crc/i.test(q), q);
});

test("podana kolumna sumy kontrolnej dochodzi jako parametr", () => {
  const q = budujZapytanieInsert({ ...NAZWY, crc: "zd_CRC" });
  assert.match(q, /zd_CRC/);
  assert.match(q, /@crc/);
});

test("liczenie zdjęć kartoteki idzie po kluczu obcym", () => {
  const q = budujZapytanieLiczby({ tabela: "tw_ZdjecieTw", klucz: "zd_IdTowar" });
  assert.match(q, /SELECT COUNT\(\*\) AS ile FROM tw_ZdjecieTw WHERE zd_IdTowar = @id/);
});

/* Nazwy pochodzą z pliku konfiguracyjnego, czyli z WEJŚCIA. Bez tej bramki
   literówka w wertis.env byłaby wstrzyknięciem SQL do bazy firmy. */
test("nazwa spoza wzorca identyfikatora jest odrzucana, nie cytowana", () => {
  assert.throws(() => budujZapytanieInsert({ ...NAZWY, tabela: "tw_Zdjecie; DROP TABLE tw__Towar" }));
  assert.throws(() => budujZapytanieInsert({ ...NAZWY, kolumna: "zd_Zdjecie)" }));
  assert.throws(() => budujZapytanieInsert({ ...NAZWY, crc: "zd_CRC--" }));
});

// ── Adapter demo ────────────────────────────────────────────────────────────

test("adapter demo oddaje zdjęcie cache'owi zamiast udawać zapis do Subiekta", async () => {
  zapiszWlasne({
    twId: 7, obraz: PNG, mime: "image/png", tloUsuniete: true,
    dodaneBy: "Jan", dodaneByRef: null,
  });
  await adapter.applySetZdjecie(7);
  assert.equal(wlasneZdjecie(7), null, "kopia zapasowa schodzi dopiero po wykonaniu zadania");
});

/* Zdjęcie podmienione między zakolejkowaniem a wykonaniem: zadanie tamtego
   zapisu zrobi to samo, więc cichy sukces jest poprawny. Błąd kazałby
   człowiekowi ponawiać coś, co jest już nieaktualne. */
test("brak zdjęcia w chwili wykonania nie jest błędem", async () => {
  await assert.doesNotReject(() => adapter.applySetZdjecie(999));
});
