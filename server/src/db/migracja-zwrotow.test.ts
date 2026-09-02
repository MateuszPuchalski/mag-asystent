import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Zwroty przeżywają własną migrację (0.150.0) ─────────────────────────────
   `bezObslugiKlienta()` kasuje `zwrot`, `zwrot_pozycja`, `sgt_sprzedaz`
   i `sgt_sprzedaz_pozycja` przy KAŻDYM `migrate()`, a nie raz za znacznikiem.
   Bazy klientów wciąż mają tamte tabele i każda musi je stracić — więc lista
   zostaje, a nazwy są spalone.

   Ten test jest strażnikiem tej miny. Gdyby ktoś wskrzesił zwroty pod starą
   nazwą, tabela powstałaby ze `schema.sql` i znikała sekundę później: bez
   błędu, bez wyjątku, z pustym ekranem jako jedynym objawem. Tydzień
   szukania w złym miejscu.                                                  */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function poMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(
    d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela)
  );

test("tabele zwrotów klienckich przeżywają kasatę obsługi klienta", () => {
  const d = poMigracji();
  for (const tabela of [
    "allegro_zwrot",
    "zwrot_klienta",
    "zwrot_klienta_pozycja",
    "zwrot_zdarzenie",
    "allegro_zwroty_sync_state",
  ]) {
    assert.equal(istnieje(d, tabela), true, `${tabela} musi przeżyć migrate()`);
  }
  d.close();
});

test("stare nazwy zwrotów nadal znikają — lista kasowania jest nietknięta", () => {
  /* Druga połowa umowy: strażnik wyżej nie ma prawa kupić sobie zieleni
     przez wykreślenie nazwy z listy dropów. Baza klienta ma je stracić. */
  const d = poMigracji();
  for (const tabela of ["zwrot", "zwrot_pozycja", "sgt_sprzedaz", "sgt_sprzedaz_pozycja"]) {
    assert.equal(istnieje(d, tabela), false, `${tabela} to nazwa spalona — ma nie istnieć`);
  }
  d.close();
});

test("read-model sprzedaży wraca pod NOWĄ nazwą i migrację przeżywa", () => {
  /* Trzecia połowa tej samej umowy (0.174.0). `sgt_sprzedaz` jest na liście
     kasowania, która chodzi przy KAŻDEJ migracji — tabela nazwana tak samo
     powstałaby ze `schema.sql` i znikała sekundę później, po cichu i bez
     błędu, bo `migrate()` chodzi PO schemacie. Dlatego `sgt_faktura`. */
  const d = poMigracji();
  for (const tabela of ["sgt_faktura", "sgt_faktura_pozycja"]) {
    assert.equal(istnieje(d, tabela), true, `${tabela} musi przeżyć migrate()`);
  }
  d.close();
});

test("kubełka nie ma w kolumnie — wynika z faktów, nie z zapisu", () => {
  /* Zdenormalizowany kubełek rozjechałby się z werdyktem przy pierwszym
     zapisie, który go zapomni. Liczy go `services/zwroty.ts`. */
  const d = poMigracji();
  const kolumny = (d.prepare("PRAGMA table_info(zwrot_klienta)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  assert.equal(kolumny.includes("kubelek"), false);
  assert.equal(kolumny.includes("werdykt"), true, "werdykt jest faktem, kubełek wnioskiem");
  d.close();
});

test("adresu ani konta bankowego nie ma gdzie zapisać", () => {
  /* Prywatność stoi w KSZTAŁCIE tabeli, nie w dyscyplinie mapowania.
     Allegro oddaje przy zwrocie `refund.bankAccount` (właściciel, IBAN,
     adres) i `parcels[].sender.phoneNumber`. Kolumny na nie NIE MA, więc
     nieuważne mapowanie wywali się na SQL-u, a nie wycieknie po cichu. */
  const d = poMigracji();
  const kolumny = [
    ...(d.prepare("PRAGMA table_info(zwrot_klienta)").all() as Array<{ name: string }>),
    ...(d.prepare("PRAGMA table_info(zwrot_klienta_pozycja)").all() as Array<{ name: string }>),
  ].map((c) => c.name.toLowerCase());
  for (const zakazana of ["iban", "adres", "address", "telefon", "phone", "konto", "swift"]) {
    assert.equal(
      kolumny.some((k) => k.includes(zakazana)),
      false,
      `kolumna z „${zakazana}" otwiera drogę danym, których nie pobieramy`
    );
  }
  d.close();
});


test("potwierdzona kartoteka PRZEŻYWA import z Subiekta", () => {
  /* USTERKA 0.152.0, naprawiona w 0.154.0. `tw_id` miało klucz obcy do
     `sgt_towar`, a import kasuje CAŁY read-model i wstawia go od nowa co
     `MSSQL_SYNC_MS` — czyli co minutę zerował każdą kartotekę potwierdzoną
     przez człowieka. Cicho, bez błędu, z „Bez kartoteki" jako objawem.

     Ten test odtwarza dokładnie to, co robi import. Na schemacie sprzed
     poprawki musi paść. */
  const d = poMigracji();
  d.exec("PRAGMA foreign_keys = ON");
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (9001,'SEK-46','Sekator')").run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-1','2026-08-25T09:00:00Z','2026-09-01T09:00:00Z')`).run();
  d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,nazwa,ilosc,cena_grosze,waluta,klucz,tw_id,tw_symbol,tw_zrodlo)
    VALUES (1,'Sekator',1,4999,'PLN','|Sekator',9001,'SEK-46','reczne')`).run();

  d.exec("DELETE FROM sgt_towar");
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (9001,'SEK-46','Sekator')").run();

  const p = d.prepare("SELECT tw_id, tw_symbol, tw_zrodlo FROM zwrot_klienta_pozycja").get() as Record<string, unknown>;
  assert.equal(p.tw_id, 9001, "praca człowieka nie ma prawa zginąć razem z read-modelem");
  assert.equal(p.tw_symbol, "SEK-46");
  d.close();
});

test("pozycja zwrotu nie wisi na read-modelu, tak jak `ean_alias`", () => {
  const d = poMigracji();
  const obce = d.prepare("PRAGMA foreign_key_list(zwrot_klienta_pozycja)")
    .all() as Array<{ table: string }>;
  assert.equal(obce.some((f) => f.table === "sgt_towar"), false,
    "powiązanie nadane przez człowieka nie jest częścią read-modelu");
  assert.equal(obce.some((f) => f.table === "zwrot_klienta"), true,
    "ale kaskada po zwrocie zostaje — pozycja bez zwrotu nie ma sensu");
  d.close();
});

test("pamięć powiązań też nie wisi na read-modelu", () => {
  const d = poMigracji();
  assert.equal(istnieje(d, "oferta_kartoteka"), true);
  const obce = d.prepare("PRAGMA foreign_key_list(oferta_kartoteka)")
    .all() as Array<{ table: string }>;
  assert.equal(obce.some((f) => f.table === "sgt_towar"), false,
    "wpis ma przeżyć import — to warunek działania, nie niedopatrzenie");
  d.close();
});

test("klucz naturalny pozycji nie przepuszcza duplikatu, także bez `offer_id`", () => {
  /* SQLite traktuje NULL-e w UNIQUE jako RÓŻNE, więc `UNIQUE (zwrot_id,
     offer_id, nazwa)` przepuszczałby duplikaty dokładnie tam, gdzie bolą:
     przy pozycjach bez identyfikatora oferty. Stąd osobna kolumna `klucz`. */
  const d = poMigracji();
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-1','2026-08-25T09:00:00Z','2026-09-01T09:00:00Z')`).run();
  const wstaw = () => d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,klucz)
    VALUES (1,NULL,'Sekator',1,4999,'PLN','|Sekator')`).run();
  wstaw();
  assert.throws(wstaw, /UNIQUE/, "druga pozycja o tym samym kluczu nie wchodzi");
  d.close();
});

test("przebudowa przepisuje dane starej tabeli, nie kasuje ich", () => {
  /* Baza klienta ma już pozycje zwrotów z 0.150.0-0.153.1. Migracja ma je
     przenieść w komplecie i dorobić `klucz`, a nie zacząć od pustej. */
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  /* Kształt sprzed 0.154.0: z kluczem obcym i bez `klucz`. */
  d.exec("DROP TABLE zwrot_klienta_pozycja");
  d.exec(`CREATE TABLE zwrot_klienta_pozycja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zwrot_id INTEGER NOT NULL REFERENCES zwrot_klienta(id) ON DELETE CASCADE,
    offer_id TEXT, nazwa TEXT NOT NULL, ilosc REAL NOT NULL,
    cena_grosze INTEGER NOT NULL, waluta TEXT NOT NULL,
    powod TEXT, powod_komentarz TEXT, url TEXT,
    ocena TEXT, ocena_at TEXT, ocena_przez TEXT,
    tw_id INTEGER REFERENCES sgt_towar(tw_id) ON DELETE SET NULL,
    tw_symbol TEXT, tw_zrodlo TEXT, tw_at TEXT, tw_przez TEXT)`);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  /* Stary schemat MIAŁ klucz obcy, więc bez kartoteki ten INSERT by nie
     przeszedł — to samo w sobie pokazuje, co tam stało. */
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (9001,'SEK-46','Sekator')").run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-1','2026-08-25T09:00:00Z','2026-09-01T09:00:00Z')`).run();
  d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,ocena,tw_id,tw_symbol)
    VALUES (1,'111','Sekator',2,4999,'PLN','stan',9001,'SEK-46')`).run();

  migrate(d);

  const p = d.prepare("SELECT * FROM zwrot_klienta_pozycja").get() as Record<string, unknown>;
  assert.equal(p.nazwa, "Sekator");
  assert.equal(p.ilosc, 2);
  assert.equal(p.ocena, "stan", "ocena hali przeżywa przebudowę");
  assert.equal(p.tw_id, 9001, "i kartoteka też");
  assert.equal(p.klucz, "111|Sekator", "klucz naturalny dorabia się przy przepisaniu");
  d.close();
});

test("przebudowa przeżywa DUPLIKAT klucza naturalnego z zastanej bazy", () => {
  /* Ta awaria położyła całą instalację przy skoku 0.153.1 → 0.162.0.
     `wertis-api`, `wertis-worker` i `npm run sonda` padały tym samym:
     `UNIQUE constraint failed: zwrot_klienta_pozycja.zwrot_id, …klucz`.

     Do 0.153.1 synchronizator kasował pozycje i wstawiał od nowa BEZ żadnego
     ograniczenia, więc dwie pozycje jednego zwrotu o tej samej ofercie
     i nazwie były legalne — i w bazach klientów SĄ. Przebudowa liczyła im
     identyczny klucz, a zaraz potem zakładała na niego indeks UNIQUE. Wyjątek
     wycofywał transakcję, `db()` rzucał i tak przy KAŻDYM starcie.

     Poprzedni test przepisania wstawiał JEDEN wiersz i dlatego to przepuścił. */
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP TABLE zwrot_klienta_pozycja");
  /* Kształt sprzed 0.154.0: klucz obcy do read-modelu, bez `klucz`
     i bez `w_zwrocie` — ta druga kolumna dochodzi dopiero `addColumn`. */
  d.exec(`CREATE TABLE zwrot_klienta_pozycja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zwrot_id INTEGER NOT NULL REFERENCES zwrot_klienta(id) ON DELETE CASCADE,
    offer_id TEXT, nazwa TEXT NOT NULL, ilosc REAL NOT NULL,
    cena_grosze INTEGER NOT NULL, waluta TEXT NOT NULL,
    powod TEXT, powod_komentarz TEXT, url TEXT,
    ocena TEXT, ocena_at TEXT, ocena_przez TEXT,
    tw_id INTEGER REFERENCES sgt_towar(tw_id) ON DELETE SET NULL,
    tw_symbol TEXT, tw_zrodlo TEXT, tw_at TEXT, tw_przez TEXT)`);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-1','2026-08-25T09:00:00Z','2026-09-01T09:00:00Z')`).run();
  const wstaw = d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,ocena)
    VALUES (?,?,?,?,?,?,?)`);
  /* Ta sama oferta dwa razy w jednym zwrocie — Allegro tak potrafi, bo
     `CustomerReturnItem` NIE MA identyfikatora pozycji. */
  wstaw.run(1, "111", "Sekator", 1, 4999, "PLN", "stan");
  wstaw.run(1, "111", "Sekator", 2, 4999, "PLN", "przecena");
  /* I para bez oferty, o tej samej nazwie — drugi wariant tej kolizji. */
  wstaw.run(1, null, "Uszczelka", 1, 999, "PLN", null);
  wstaw.run(1, null, "Uszczelka", 3, 999, "PLN", null);

  migrate(d);

  const poz = d.prepare(
    "SELECT nazwa, ilosc, ocena, klucz, w_zwrocie FROM zwrot_klienta_pozycja ORDER BY id")
    .all() as Array<Record<string, unknown>>;
  assert.equal(poz.length, 4, "przebudowa nie ma prawa zgubić ani jednej pozycji");
  assert.deepEqual(poz.map((p) => p.klucz),
    ["111|Sekator", "111|Sekator|#2", "|Uszczelka", "|Uszczelka|#2"]);
  /* Pierwsze wystąpienie zostaje przy DZISIEJSZYM kluczu — instalacja już
     zmigrowana nie przekluczy ani jednego wiersza, a to do klucza przywiązana
     jest praca człowieka. */
  assert.deepEqual(poz.map((p) => p.ilosc), [1, 2, 1, 3], "ilości zostają rozdzielone");
  assert.deepEqual(poz.map((p) => p.ocena), ["stan", "przecena", null, null],
    "druga pozycja nie nadpisuje oceny pierwszej");

  /* `w_zwrocie` dochodzi `addColumn` PRZED przebudową, więc nowa tabela musi
     ją mieć — inaczej znika razem ze starą i `zapiszKwote` leci na
     nieistniejącą kolumnę aż do następnego restartu. */
  assert.equal(poz[0].w_zwrocie, 0, "zaznaczenie do kwoty przeżywa przebudowę");

  const indeksy = (d.prepare("PRAGMA index_list(zwrot_klienta_pozycja)")
    .all() as Array<{ name: string }>).map((i) => i.name);
  assert.ok(indeksy.includes("ux_zwrot_klienta_pozycja_klucz"),
    "indeks unikalny ma powstać, a nie zostać pominięty dla świętego spokoju");

  /* Drugi przebieg nie robi nic — warunek przerwania trzyma. */
  migrate(d);
  assert.equal((d.prepare("SELECT count(*) n FROM zwrot_klienta_pozycja").get() as
    { n: number }).n, 4);
  d.close();
});


test("przebudowa przeżywa nazwę, która NIESIE JUŻ przyrostek duplikatu", () => {
  /* Awaria produkcyjna 0.174.2 — druga z tej samej rodziny co 0.162.1 i z tym
     samym objawem: `UNIQUE constraint failed: zwrot_klienta_pozycja.zwrot_id,
     …klucz` przy starcie, w kółko, bo `db()` woła migrację w KAŻDYM procesie.
     API i worker wpadały w pętlę restartów NSSM, a w logu workera zostawało
     „database is locked" — objaw, nie przyczyna.

     0.162.1 dołożyło duplikatowi przyrostek `|#n` i to załatwiło duplikaty
     wprost. Nie załatwiło ZDERZENIA: pozycja, której nazwa niesie już tekst
     `|#2`, dostaje klucz identyczny z drugim wystąpieniem sąsiada. */
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP TABLE zwrot_klienta_pozycja");
  d.exec(`CREATE TABLE zwrot_klienta_pozycja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zwrot_id INTEGER NOT NULL REFERENCES zwrot_klienta(id) ON DELETE CASCADE,
    offer_id TEXT, nazwa TEXT NOT NULL, ilosc REAL NOT NULL,
    cena_grosze INTEGER NOT NULL, waluta TEXT NOT NULL,
    tw_id INTEGER REFERENCES sgt_towar(tw_id) ON DELETE SET NULL)`);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-1','2026-08-25T09:00:00Z','2026-09-01T09:00:00Z')`).run();
  const ins = d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta) VALUES (1,?,?,1,4999,'PLN')`);
  ins.run("111", "Sekator");
  ins.run("111", "Sekator");        // duplikat wprost — dostanie |#2
  ins.run("111", "Sekator|#2");     // nazwa Z przyrostkiem — zderza się z tamtym

  migrate(d);

  /* Ani jeden wiersz nie ginie: rozplatanie zmienia klucz, nie kasuje pracy. */
  const ile = d.prepare("SELECT COUNT(*) n FROM zwrot_klienta_pozycja").get() as { n: number };
  assert.equal(Number(ile.n), 3, "wszystkie trzy pozycje przeżywają");
  const roznych = d.prepare(
    "SELECT COUNT(DISTINCT klucz) n FROM zwrot_klienta_pozycja").get() as { n: number };
  assert.equal(Number(roznych.n), 3, "i każda ma własny klucz");
  /* Pierwsze wystąpienie zostaje NIETKNIĘTE — do klucza przywiązana jest praca
     człowieka, więc bazy już zmigrowane nie przekluczają się bez potrzeby. */
  const pierwszy = d.prepare("SELECT klucz FROM zwrot_klienta_pozycja WHERE id=1")
    .get() as { klucz: string };
  assert.equal(pierwszy.klucz, "111|Sekator");
  d.close();
});

test("duplikat zastany BEZ przebudowy też nie kładzie startu", () => {
  /* Baza, która przebudowę ma już za sobą, wchodzi ścieżką samego indeksu.
     Duplikat mógł do niej trafić zapisem aplikacji, zanim indeks powstał —
     i wtedy `CREATE UNIQUE INDEX` wywracał start tak samo. */
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP INDEX IF EXISTS ux_zwrot_klienta_pozycja_klucz");
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-1','2026-08-25T09:00:00Z','2026-09-01T09:00:00Z')`).run();
  const ins = d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,klucz)
    VALUES (1,?,?,1,4999,'PLN',?)`);
  ins.run("111", "Sekator", "111|Sekator");
  ins.run("111", "Sekator", "111|Sekator");

  migrate(d);

  const roznych = d.prepare(
    "SELECT COUNT(DISTINCT klucz) n FROM zwrot_klienta_pozycja").get() as { n: number };
  assert.equal(Number(roznych.n), 2);
  d.close();
});
