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

   Czego ten plik NIE DOWODZI: że Subiekt taki wiersz przyjmie. Algorytm sumy
   `zd_CRC` i rysowanie przezroczystości są `[WERYFIKUJ]` i rozstrzyga je
   kartoteka próbna (DEPLOY §6).                                            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjz-")), "t.db");
process.env.SGT_MODE = "seeded";
/* Nazwy bazy firmy — atrapa transakcji niżej czyta je z konfiguracji. */
process.env.ZDJECIA_TABELA = "tw_ZdjecieTw";
process.env.ZDJECIA_KOLUMNA = "zd_Zdjecie";
process.env.ZDJECIA_KOLUMNA_KLUCZA = "zd_IdTowar";
process.env.ZDJECIA_KOLUMNA_GLOWNE = "zd_Glowne";
process.env.ZDJECIA_KOLUMNA_KOLEJNOSC = "zd_Id";

let budujZapytanieInsert: typeof import("./sfera.sql.js").budujZapytanieInsert;
let budujZapytanieLiczby: typeof import("./sfera.sql.js").budujZapytanieLiczby;
let budujZapytanieZdjeGlowne: typeof import("./sfera.sql.js").budujZapytanieZdjeGlowne;
let zapiszZdjecieWTransakcji: typeof import("./sfera.sql.js").zapiszZdjecieWTransakcji;
let opiszBladZdjecia: typeof import("./sfera.sql.js").opiszBladZdjecia;
let sumaZdjecia: typeof import("./sfera.sql.js").sumaZdjecia;
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
  idWiersza: "zd_Id",
};

before(async () => {
  ({ budujZapytanieInsert, budujZapytanieLiczby, budujZapytanieZdjeGlowne, zapiszZdjecieWTransakcji, opiszBladZdjecia, sumaZdjecia } =
    await import("./sfera.sql.js"));
  ({ db } = await import("../db/db.js"));
  ({ zapiszWlasne, wlasneZdjecie } = await import("../services/zdjecia-wlasne.js"));
  const { DevSferaAdapter } = await import("./sfera.dev.js");
  adapter = new DevSferaAdapter();
});

beforeEach(() => {
  for (const t of ["zdjecie_wlasne", "zdjecie_cache"]) db().prepare(`DELETE FROM ${t}`).run();
});

// ── Kształt zapytania ───────────────────────────────────────────────────────

test("INSERT nazywa klucz wiersza, tabelę, klucz obcy, obraz i flagę głównego", () => {
  const q = budujZapytanieInsert(NAZWY);
  assert.ok(q.includes("INSERT INTO tw_ZdjecieTw (zd_Id, zd_IdTowar, zd_Zdjecie, zd_Glowne)"), q);
  assert.ok(q.includes("VALUES (@nowe, @id, @obraz, @glowne)"), q);
});

/* `zd_Id` nie jest IDENTITY i jest NOT NULL — bez numeru z licznika Subiekta
   INSERT padał na bazie firmy. Numer bierze się pod blokadą, w tym samym
   wsadzie, a licznik przesuwa się za wydanym numerem. */
test("numer wiersza idzie z licznika ins_ident pod blokadą i licznik rośnie", () => {
  const q = budujZapytanieInsert(NAZWY);
  assert.ok(q.includes("SELECT @maks = ISNULL(MAX(zd_Id), 0) FROM tw_ZdjecieTw WITH (UPDLOCK, HOLDLOCK)"), q);
  assert.ok(q.includes("SELECT @nowe = ido_wartosc FROM ins_ident WITH (UPDLOCK, HOLDLOCK) WHERE ido_nazwa = @licznik"), q);
  assert.ok(q.includes("UPDATE ins_ident SET ido_wartosc = @nowe + 1 WHERE ido_nazwa = @licznik"), q);
  const odczyt = q.indexOf("FROM ins_ident");
  assert.ok(q.indexOf("UPDATE ins_ident") > odczyt && q.indexOf("INSERT INTO") > odczyt);
});

/* Licznik spóźniony względem tabeli wydałby numer zajęty, a dwa zdjęcia
   dzieliłyby wtedy klucz wiersza. */
test("licznik nie wyda numeru zajętego w tabeli", () => {
  const q = budujZapytanieInsert(NAZWY);
  assert.ok(q.includes("IF @nowe IS NULL OR @nowe <= @maks SET @nowe = @maks + 1"), q);
});

test("bez kolumny sumy kontrolnej suma NIE wchodzi do zapytania", () => {
  const q = budujZapytanieInsert(NAZWY);
  assert.ok(!/crc/i.test(q), q);
});

test("podana kolumna sumy kontrolnej dochodzi jako parametr", () => {
  const q = budujZapytanieInsert({ ...NAZWY, crc: "zd_CRC" });
  assert.match(q, /zd_CRC/);
  assert.match(q, /@crc/);
});

/* Wartość referencyjna CRC32 dla "123456789" to 0xCBF43926. Kolumna jest
   `int` ze znakiem, więc liczba powyżej 2^31 musi zejść na ujemną. */
test("suma zdjęcia to CRC32 bajtów jako int ze znakiem", () => {
  assert.equal(sumaZdjecia(Buffer.from("123456789")), 0xcbf43926 | 0);
  assert.ok(sumaZdjecia(Buffer.from("123456789")) < 0);
  assert.notEqual(sumaZdjecia(PNG), sumaZdjecia(Buffer.from("inny obraz")));
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
  assert.throws(() => budujZapytanieInsert({ ...NAZWY, idWiersza: "zd_Id; --" }));
});

// ── Zamiana zdjęcia głównego ────────────────────────────────────────────────

/* Stare zdjęcie ma zostać w Subiekcie jako dodatkowe, żeby pomyłkę dało się
   cofnąć. Dlatego tylko UPDATE flagi tego jednego towaru, nigdy DELETE. */
test("zamiana zdejmuje flagę głównego tylko z tego towaru i niczego nie kasuje", () => {
  const q = budujZapytanieZdjeGlowne({ tabela: "tw_ZdjecieTw", klucz: "zd_IdTowar", glowne: "zd_Glowne" });
  assert.equal(q, "UPDATE tw_ZdjecieTw WITH (HOLDLOCK) SET zd_Glowne = 0 WHERE zd_IdTowar = @id AND zd_Glowne = 1");
  assert.ok(!/DELETE/i.test(q), q);
});

test("nazwy w zapytaniu zamiany przechodzą przez bramkę identyfikatora", () => {
  const ok = { tabela: "tw_ZdjecieTw", klucz: "zd_IdTowar", glowne: "zd_Glowne" };
  assert.throws(() => budujZapytanieZdjeGlowne({ ...ok, tabela: "tw_ZdjecieTw; DROP TABLE tw__Towar" }));
  assert.throws(() => budujZapytanieZdjeGlowne({ ...ok, klucz: "zd_IdTowar OR 1=1" }));
  assert.throws(() => budujZapytanieZdjeGlowne({ ...ok, glowne: "zd_Glowne--" }));
});

/** Atrapa transakcji `mssql`: zapisuje zapytania i parametry w kolejności. */
function atrapaTransakcji(ileZdjec: number) {
  const wywolania: Array<{ q: string; p: Record<string, unknown> }> = [];
  return {
    wywolania,
    request() {
      const p: Record<string, unknown> = {};
      const r = {
        input(nazwa: string, _typ: unknown, wartosc: unknown) {
          p[nazwa] = wartosc;
          return r;
        },
        async query(q: string) {
          wywolania.push({ q, p });
          return { recordset: q.startsWith("SELECT COUNT") ? [{ ile: ileZdjec }] : [] };
        },
      };
      return r;
    },
  };
}

test("bez zamiany: liczenie, potem INSERT jako dodatkowe, gdy zdjęcie już jest", async () => {
  const t = atrapaTransakcji(2);
  await zapiszZdjecieWTransakcji(t, 7, PNG);
  assert.equal(t.wywolania.length, 2);
  assert.match(t.wywolania[0].q, /^SELECT COUNT\(\*\) AS ile FROM tw_ZdjecieTw WHERE zd_IdTowar = @id$/);
  assert.match(t.wywolania[1].q, /INSERT INTO tw_ZdjecieTw/);
  assert.equal(t.wywolania[1].p.glowne, false);
  assert.ok(!t.wywolania.some((w) => w.q.startsWith("UPDATE tw_ZdjecieTw")), "bez zamiany flaga starego zostaje");
});

test("bez zamiany: pierwsze zdjęcie kartoteki wchodzi jako główne", async () => {
  const t = atrapaTransakcji(0);
  await zapiszZdjecieWTransakcji(t, 7, PNG, {});
  assert.equal(t.wywolania[1].p.glowne, true);
});

/* Kolejność ma znaczenie: UPDATE po INSERT zdjąłby flagę także z nowego wiersza. */
test("zamiana: najpierw stare główne schodzi na dodatkowe, potem nowe wchodzi jako główne", async () => {
  const t = atrapaTransakcji(3);
  await zapiszZdjecieWTransakcji(t, 7, PNG, { zamien: true });
  assert.equal(t.wywolania.length, 2);
  assert.equal(
    t.wywolania[0].q,
    "UPDATE tw_ZdjecieTw WITH (HOLDLOCK) SET zd_Glowne = 0 WHERE zd_IdTowar = @id AND zd_Glowne = 1",
  );
  assert.equal(t.wywolania[0].p.id, 7);
  assert.match(t.wywolania[1].q, /INSERT INTO tw_ZdjecieTw/);
  assert.equal(t.wywolania[1].p.glowne, true);
  assert.equal(t.wywolania[1].p.id, 7);
  assert.ok(!t.wywolania.some((w) => /DELETE/i.test(w.q)));
});

/* Odmowa prawa przy zamianie ma podać gotową linię GRANT-a na flagę głównego.
   Bez niej człowiek nadałby prawa z podpowiedzi i dostał tę samą odmowę. */
test("odmowa przy zamianie podpowiada prawo do flagi głównego, przy dopisaniu nie", () => {
  const odmowa = new Error("The UPDATE permission was denied on the column 'zd_Glowne'");
  const zamiana = opiszBladZdjecia(odmowa, "tw_ZdjecieTw", "zd_Glowne");
  assert.ok(zamiana.includes("GRANT UPDATE ON dbo.tw_ZdjecieTw (zd_Glowne) TO wertis;"), zamiana);
  assert.ok(zamiana.includes("GRANT INSERT ON dbo.tw_ZdjecieTw TO wertis;"), zamiana);
  const dopisanie = opiszBladZdjecia(odmowa, "tw_ZdjecieTw");
  assert.ok(!dopisanie.includes("zd_Glowne) TO"), dopisanie);
  assert.ok(dopisanie.startsWith("Konto SQL nie ma prawa dopisania zdjęcia."), dopisanie);
  assert.equal(opiszBladZdjecia(new Error("timeout"), "tw_ZdjecieTw", "zd_Glowne"), "timeout");
});

test("zamien: false zachowuje się jak zwykłe dopisanie", async () => {
  const t = atrapaTransakcji(1);
  await zapiszZdjecieWTransakcji(t, 7, PNG, { zamien: false });
  assert.match(t.wywolania[0].q, /^SELECT COUNT/);
  assert.equal(t.wywolania[1].p.glowne, false);
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

test("adapter demo przy zamianie oddaje zdjęcie cache'owi tak samo", async () => {
  zapiszWlasne({
    twId: 8, obraz: PNG, mime: "image/png", tloUsuniete: false,
    dodaneBy: "Jan", dodaneByRef: null,
  });
  await adapter.applySetZdjecie(8, { zamien: true });
  assert.equal(wlasneZdjecie(8), null);
});
