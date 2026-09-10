import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Wiedza z ofert: dwie przebudowy tabel (0.264.0) ─────────────────────────
   Wydanie dokłada źródło `oferta` do `towar_identyfikator.zrodlo` i do
   `zastosowanie.zrodlo_propozycji`. SQLite nie rozszerza CHECK-a w miejscu,
   więc obie tabele idą przez przepisanie — a przepisanie `zastosowanie` jest
   JEDYNYM krokiem tego wydania bez odwrotu.

   Powód: do `zastosowanie` prowadzą cztery klucze obce, w tym
   `dowod_zastosowania … ON DELETE CASCADE`. `DROP TABLE` przy włączonych
   kluczach zabrałby kaskadowo rejestr dowodów — tabelę APPEND-ONLY, której
   nie ma z czego odtworzyć. Pierwszy test tego pliku jest po to i tylko po to. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/* Kształt `zastosowanie` sprzed 0.264.0: sześć wartości źródła zamiast
   siedmiu. Reszta kolumn co do jednej jak w schemacie, bo przebudowa kopiuje
   po NAZWACH — test na okrojonej kopii sprawdzałby coś innego niż produkcja. */
const STARE_ZASTOSOWANIE = `CREATE TABLE zastosowanie (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tw_id                 INTEGER NOT NULL,
  tw_symbol             TEXT NOT NULL,
  model_id              INTEGER NOT NULL REFERENCES model_urzadzenia(id) ON DELETE RESTRICT,
  polaryzacja           TEXT NOT NULL CHECK (polaryzacja IN ('pasuje','nie_pasuje')),
  powod_negatywny       TEXT CHECK (powod_negatywny IS NULL OR powod_negatywny IN (
                          'nie_pasuje','tylko_inny_wariant','niewlasciwy_rozstaw',
                          'srednica_ok_inne_mocowanie','mylace_oznaczenie','wymaga_pomiaru')),
  stan                  TEXT NOT NULL DEFAULT 'propozycja'
                          CHECK (stan IN ('propozycja','zatwierdzone','odrzucone','wycofane')),
  zrodlo_propozycji     TEXT NOT NULL
                          CHECK (zrodlo_propozycji IN ('dobor','pomiar','reczne','opis','copilot')),
  komentarz             TEXT,
  conversation_id       INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
  zastepuje_id          INTEGER REFERENCES zastosowanie(id),
  zaproponowal          TEXT NOT NULL,
  zaproponowal_user_id  INTEGER REFERENCES app_user(user_id),
  zaproponowano_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  rozstrzygnal          TEXT,
  rozstrzygnal_user_id  INTEGER REFERENCES app_user(user_id),
  rozstrzygnieto_at     TEXT,
  powod_rozstrzygniecia TEXT,
  CHECK ((polaryzacja = 'nie_pasuje') = (powod_negatywny IS NOT NULL))
);`;

const STARY_IDENTYFIKATOR = `CREATE TABLE towar_identyfikator (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tw_id INTEGER NOT NULL, tw_symbol TEXT NOT NULL,
  rodzaj TEXT NOT NULL CHECK (rodzaj IN ('oem','nr_oryg','katalog_obcy','stare_sku','zamiennik')),
  wartosc TEXT NOT NULL, wartosc_norm TEXT NOT NULL,
  zrodlo TEXT NOT NULL CHECK (zrodlo IN ('opis','reczne')),
  dodal TEXT NOT NULL, dodal_user_id INTEGER REFERENCES app_user(user_id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tw_id, rodzaj, wartosc_norm));`;

/* Pełny schemat, a POTEM tabele cofnięte do dawnego kształtu — ta sama droga
   co przy piątym rodzaju identyfikatora w 0.234.0. Migracje wołane przez
   `migrate()` zakładają obecność sąsiednich tabel, stare mają być te dwie. */
function bazaSprzed(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP TABLE zastosowanie");
  d.exec(STARE_ZASTOSOWANIE);
  d.exec("DROP TABLE towar_identyfikator");
  d.exec(STARY_IDENTYFIKATOR);
  d.exec(`INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('maszyna','HUSQVARNA','TC 38','maszyna|husqvarnatc38','Ala');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('maszyna','STIHL','FS 250','maszyna|stihlfs250','Ala');
    INSERT INTO token_silnika(token,token_norm,silnik_id,dodal)
      VALUES ('GX160','gx160',1,'Ala');`);
  return d;
}

/* Dwa zastosowania, drugie POPRAWIA pierwsze (`zastepuje_id`), do tego trzy
   dowody, wiersz kolejki Wiedzy i para token–kartoteka. Czyli wszystkie cztery
   klucze obce prowadzące do `zastosowanie`, każdy z osobna. */
function zapelnij(d: DatabaseSync) {
  d.exec(`INSERT INTO zastosowanie(id,tw_id,tw_symbol,model_id,polaryzacja,stan,
      zrodlo_propozycji,zaproponowal,zaproponowal_user_id)
      VALUES (11,7,'20-05006',1,'pasuje','zatwierdzone','opis','Ala',1);
    INSERT INTO zastosowanie(id,tw_id,tw_symbol,model_id,polaryzacja,powod_negatywny,stan,
      zrodlo_propozycji,zastepuje_id,zaproponowal)
      VALUES (12,7,'20-05006',2,'nie_pasuje','niewlasciwy_rozstaw','propozycja','copilot',11,'Ola');
    INSERT INTO dowod_zastosowania(zastosowanie_id,rodzaj,tresc,autor)
      VALUES (11,'producent','katalog Husqvarna','Ala'),
             (11,'decyzja_biura','zmierzone na miejscu','Ala'),
             (12,'rozmowa','klient odesłał','Ola');
    INSERT INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm,stan,zastosowanie_id)
      VALUES (7,'20-05006','TC 38','tc38','przerobiony',11);
    INSERT INTO token_silnika_kartoteka(token_id,tw_id,tw_symbol,stan,zastosowanie_id)
      VALUES (1,7,'20-05006','zatwierdzona',11);
    INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal)
      VALUES (7,'20-05006','oem','197473','197473','opis','import'),
             (7,'20-05006','katalog_obcy','HQ-12345','hq12345','reczne','Ala');`);
}

const licz = (d: DatabaseSync, sql: string) =>
  Number((d.prepare(sql).get() as { ile: number }).ile);

test("przebudowa zastosowania NIE zabiera dowodów — kaskada nie ma jak zadziałać", () => {
  /* To jest test, dla którego całe wydanie warto pisać ostrożnie. Gdyby
     klucze obce zostały włączone, `DROP TABLE zastosowanie` skasowałby trzy
     dowody i migracja przeszłaby na zielono, bo nikt by ich nie policzył. */
  const d = bazaSprzed();
  zapelnij(d);
  const dowodowPrzed = licz(d, "SELECT COUNT(*) AS ile FROM dowod_zastosowania");
  assert.equal(dowodowPrzed, 3);

  migrate(d);

  assert.equal(licz(d, "SELECT COUNT(*) AS ile FROM dowod_zastosowania"), 3,
    "rejestr dowodów jest append-only — migracja nie ma prawa go uszczuplić");
  assert.equal(licz(d, "SELECT COUNT(*) AS ile FROM zastosowanie"), 2);
  d.close();
});

test("identyfikatory `id` przeżywają przebudowę, więc odnośniki dalej trafiają", () => {
  /* Przenumerowanie zerwałoby historię poprawek wiedzy: `zastepuje_id`,
     `model_z_opisu.zastosowanie_id` i `token_silnika_kartoteka.zastosowanie_id`
     wskazują na konkretne wiersze, a to jedyny zapis tego, kto co rozstrzygnął. */
  const d = bazaSprzed();
  zapelnij(d);
  migrate(d);

  const poprawka = d.prepare(
    "SELECT zastepuje_id, zrodlo_propozycji FROM zastosowanie WHERE id=12").get() as
    { zastepuje_id: number; zrodlo_propozycji: string } | undefined;
  assert.equal(poprawka?.zastepuje_id, 11, "poprawka dalej wskazuje wiersz, który poprawia");
  assert.equal(poprawka?.zrodlo_propozycji, "copilot");
  assert.equal(licz(d,
    "SELECT COUNT(*) AS ile FROM dowod_zastosowania WHERE zastosowanie_id=11"), 2);
  assert.equal(licz(d,
    "SELECT COUNT(*) AS ile FROM model_z_opisu WHERE zastosowanie_id=11"), 1);
  assert.equal(licz(d,
    "SELECT COUNT(*) AS ile FROM token_silnika_kartoteka WHERE zastosowanie_id=11"), 1);

  for (const tabela of ["dowod_zastosowania", "model_z_opisu",
                        "token_silnika_kartoteka", "zastosowanie"]) {
    assert.deepEqual(d.prepare(`PRAGMA foreign_key_check(${tabela})`).all(), [],
      `${tabela} ma zwisający odnośnik po przebudowie`);
  }
  d.close();
});

test("klucze obce wracają WŁĄCZONE — także wtedy, gdy przebudowa się wywróci", () => {
  /* Gdyby `PRAGMA foreign_keys = ON` stało w środku transakcji, a nie
     w `finally`, jeden wyjątek zostawiłby proces z wyłączonymi kluczami na
     resztę życia. Kaskady i `RESTRICT` przestałyby działać po cichu. */
  const d = bazaSprzed();
  /* Wiersz nie do przepisania: stara tabela dopuszcza pusty `tw_symbol`, nowa
     ma tam NOT NULL, więc INSERT … SELECT musi paść. */
  d.exec("DROP TABLE zastosowanie");
  d.exec(STARE_ZASTOSOWANIE.replace("tw_symbol             TEXT NOT NULL",
                                    "tw_symbol             TEXT"));
  d.exec(`INSERT INTO zastosowanie(tw_id,tw_symbol,model_id,polaryzacja,zrodlo_propozycji,
    zaproponowal) VALUES (7,NULL,1,'pasuje','opis','Ala')`);

  assert.throws(() => migrate(d), /NOT NULL/);
  assert.equal(Number((d.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number })
    .foreign_keys), 1, "klucze obce muszą wrócić nawet po wyjątku");
  d.close();
});

test("po migracji wchodzi źródło `oferta`, a stare wiersze zostają przy swoim", () => {
  const d = bazaSprzed();
  zapelnij(d);
  assert.throws(() => d.prepare(`INSERT INTO zastosowanie(tw_id,tw_symbol,model_id,
    polaryzacja,zrodlo_propozycji,zaproponowal) VALUES (7,'20-05006',1,'pasuje','oferta','Ala')`)
    .run(), /CHECK/, "przed migracją źródła `oferta` nie ma");

  migrate(d);

  d.prepare(`INSERT INTO zastosowanie(tw_id,tw_symbol,model_id,polaryzacja,
    zrodlo_propozycji,zaproponowal) VALUES (7,'20-05006',1,'pasuje','oferta','Ala')`).run();
  d.prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,
    zrodlo,dodal,oferta_id) VALUES (7,'20-05006','oem','698083','698083','oferta','oferta','14023867457')`)
    .run();
  const reczny = d.prepare(
    "SELECT dodal, zrodlo, oferta_id FROM towar_identyfikator WHERE wartosc_norm='hq12345'")
    .get() as { dodal: string; zrodlo: string; oferta_id: string | null } | undefined;
  assert.equal(reczny?.dodal, "Ala", "wpis biura przeżywa drugą przebudowę tej tabeli");
  assert.equal(reczny?.zrodlo, "reczne");
  assert.equal(reczny?.oferta_id, null, "wpisu ręcznego nie przypisujemy żadnej ofercie");

  /* Indeksy wracają razem z tabelami — bez nich szukanie po numerze i po
     kartotece schodzi do skanu przy każdym pytaniu klienta. */
  const indeksy = (d.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN " +
    "('towar_identyfikator','zastosowanie')").all() as Array<{ name: string }>)
    .map((i) => i.name);
  for (const ix of ["ix_towar_identyfikator_norm", "ix_towar_identyfikator_tw",
                    "ix_zastosowanie_towar", "ix_zastosowanie_model", "ix_zastosowanie_stan"]) {
    assert.ok(indeksy.includes(ix), `brak indeksu ${ix}; są: ${indeksy.join(", ")}`);
  }
  d.close();
});

test("kolejka Wiedzy dostaje źródło, a zastane wiersze `opis` — bo to o nich prawda", () => {
  const d = bazaSprzed();
  zapelnij(d);
  migrate(d);
  const stary = d.prepare("SELECT zrodlo, oferta_id FROM model_z_opisu WHERE tekst_norm='tc38'")
    .get() as { zrodlo: string; oferta_id: string | null } | undefined;
  assert.equal(stary?.zrodlo, "opis", "zastane wiersze powstały z opisów kartotek");
  assert.equal(stary?.oferta_id, null);
  d.prepare(`INSERT INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm,zrodlo,oferta_id)
    VALUES (7,'20-05006','STIHL FS250','stihlfs250','oferta','14023867457')`).run();
  assert.throws(() => d.prepare(`INSERT INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm,zrodlo)
    VALUES (7,'20-05006','X','x','copilot')`).run(), /CHECK/, "lista źródeł jest zamknięta");
  d.close();
});

test("drugi przebieg `migrate()` nie rusza już niczego", () => {
  /* `db()` woła migrację w KAŻDYM procesie, a `npm run seed` potrafi chodzić
     przy żywym serwerze. Przebudowa wykonana po raz drugi przepisałaby tabele
     bez powodu — i to pod otwartym panelem. */
  const d = bazaSprzed();
  zapelnij(d);
  migrate(d);
  const ksztalt = () => d.prepare(
    "SELECT group_concat(sql,'|') AS s FROM sqlite_master WHERE name IN " +
    "('zastosowanie','towar_identyfikator','model_z_opisu')").get() as { s: string };
  const przed = ksztalt().s;
  const dowodowPrzed = licz(d, "SELECT COUNT(*) AS ile FROM dowod_zastosowania");

  migrate(d);

  assert.equal(ksztalt().s, przed, "drugi przebieg zmienił kształt tabel");
  assert.equal(licz(d, "SELECT COUNT(*) AS ile FROM dowod_zastosowania"), dowodowPrzed);
  d.close();
});

test("baza ze świeżego schematu przechodzi migrację bez przebudowy", () => {
  /* Strażnik warunków wejścia: gdyby były błędne, każdy start przepisywałby
     obie tabele — i każdy start byłby okazją do utraty rejestru dowodów. */
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('maszyna','HUSQVARNA','TC 38','maszyna|husqvarnatc38','Ala');
    INSERT INTO zastosowanie(id,tw_id,tw_symbol,model_id,polaryzacja,zrodlo_propozycji,
      zaproponowal) VALUES (11,7,'20-05006',1,'pasuje','opis','Ala');
    INSERT INTO dowod_zastosowania(zastosowanie_id,rodzaj,tresc,autor)
      VALUES (11,'producent','katalog','Ala');`);
  const przed = (d.prepare(
    "SELECT sql FROM sqlite_master WHERE name='zastosowanie'").get() as { sql: string }).sql;

  migrate(d);

  assert.equal((d.prepare(
    "SELECT sql FROM sqlite_master WHERE name='zastosowanie'").get() as { sql: string }).sql,
    przed, "świeży schemat nie wymaga przebudowy");
  assert.equal(licz(d, "SELECT COUNT(*) AS ile FROM dowod_zastosowania"), 1);
  d.close();
});
