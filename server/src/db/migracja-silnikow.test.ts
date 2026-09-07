import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Zabudowa silnika i dziewiąta droga doboru przeżywają migrację ───────────
   Dwie umowy naraz. Pierwsza jak przy wiedzy: nowa tabela ma przeżyć kasatę
   nakładek, a spalone nazwy dalej znikać.

   Druga jest ważniejsza i to dla niej ten plik powstał: `CHECK` na
   `dobor_rozmowy.wybrany_droga` stoi WYŁĄCZNIE w `schema.sql`, więc bazy
   sprzed tego wydania znają osiem dróg. Bez przebudowy agent kliknąłby
   „Wybierz" przy kandydacie z drogi `silnik` i dostał surowy
   `SQLITE_CONSTRAINT` — dopiero u klienta i dopiero przy pierwszym trafieniu
   nowego szczebla. Testy sprawdzają więc STARĄ bazę, nie tylko świeżą.      */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/** Baza sprzed wydania: `dobor_rozmowy` bez drogi `silnik`, reszta aktualna. */
function bazaZOsmiomaDrogami() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP TABLE dobor_rozmowy");
  d.exec(`CREATE TABLE dobor_rozmowy (
    conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
                      'not_started','extracting_data','missing_information','searching',
                      'candidates_found','requires_expert','confirmed','rejected',
                      'not_applicable')),
    wersja          INTEGER NOT NULL DEFAULT 1,
    marka TEXT, model TEXT, wariant TEXT, rocznik TEXT, nr_seryjny TEXT, silnik TEXT,
    oem TEXT, nazwa_czesci TEXT, parametry_json TEXT, brakuje TEXT,
    wybrany_tw_id   INTEGER,
    wybrany_symbol  TEXT,
    wybrany_droga   TEXT CHECK (wybrany_droga IS NULL OR wybrany_droga IN (
                      'oferta','zamiennik','symbol','ean','wyszukiwarka',
                      'zastosowanie','oem','pelnotekst')),
    wybrano_przez   TEXT,
    wybrano_user_id INTEGER REFERENCES app_user(user_id),
    wybrano_at      TEXT,
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by      TEXT,
    updated_user_id INTEGER REFERENCES app_user(user_id)
  )`);
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-2');`);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("zabudowa_silnika przeżywa kasatę nakładek, a spalona nazwa nadal znika", () => {
  const d = bazaZOsmiomaDrogami();
  migrate(d);
  assert.equal(istnieje(d, "zabudowa_silnika"), true);
  assert.equal(istnieje(d, "dopasowanie"), false, "dopasowanie to nazwa spalona");
  d.close();
});

test("stara baza po migracji przyjmuje drogę `silnik`, a wymyśloną nadal odrzuca", () => {
  const d = bazaZOsmiomaDrogami();
  d.prepare("INSERT INTO dobor_rozmowy(conversation_id,wybrany_droga) VALUES (1,'zastosowanie')").run();
  /* Przed migracją nowa droga NIE wchodzi — to jest dokładnie ten wybuch,
     który wyszedłby u klienta. */
  assert.throws(() => d.prepare("UPDATE dobor_rozmowy SET wybrany_droga='silnik' WHERE conversation_id=1").run(),
    /CHECK/);
  migrate(d);
  d.prepare("UPDATE dobor_rozmowy SET wybrany_droga='silnik' WHERE conversation_id=1").run();
  assert.equal((d.prepare("SELECT wybrany_droga w FROM dobor_rozmowy WHERE conversation_id=1")
    .get() as { w: string }).w, "silnik");
  assert.throws(() => d.prepare("UPDATE dobor_rozmowy SET wybrany_droga='semantyka' WHERE conversation_id=1").run(),
    /CHECK/, "lista zostaje zamknięta");
  d.close();
});

test("przebudowa nie gubi ANI JEDNEGO pola otwartego doboru", () => {
  const d = bazaZOsmiomaDrogami();
  const wiersz = {
    conversation_id: 1, status: "candidates_found", wersja: 7, marka: "NAC", model: "LS 46-450",
    wariant: "HS", rocznik: "2019", nr_seryjny: "SN-1", silnik: "B&S 450E", oem: "532 19 93-77",
    nazwa_czesci: "szarpak", parametry_json: '{"dlugosc":"148"}', brakuje: "numer seryjny",
    wybrany_tw_id: 501, wybrany_symbol: "SZR-148/82", wybrany_droga: "zastosowanie",
    wybrano_przez: "Ala", wybrano_at: "2026-09-01T07:00:00Z",
    updated_at: "2026-09-01T08:00:00Z", updated_by: "Ala",
  } as Record<string, string | number>;
  const kolumny = Object.keys(wiersz);
  d.prepare(`INSERT INTO dobor_rozmowy(${kolumny.join(",")})
    VALUES (${kolumny.map(() => "?").join(",")})`).run(...Object.values(wiersz));

  migrate(d);

  const po = d.prepare("SELECT * FROM dobor_rozmowy WHERE conversation_id=1").get() as Record<string, unknown>;
  for (const k of kolumny) {
    assert.equal(String(po[k]), String(wiersz[k]), `przebudowa zgubiła kolumnę ${k}`);
  }
  d.close();
});

test("przebudowa odtwarza ON DELETE CASCADE — skasowana rozmowa nie zostawia sieroty", () => {
  const d = bazaZOsmiomaDrogami();
  d.prepare("INSERT INTO dobor_rozmowy(conversation_id,marka) VALUES (2,'STIGA')").run();
  migrate(d);
  d.exec("PRAGMA foreign_keys = ON");
  d.prepare("DELETE FROM conversation WHERE id=2").run();
  assert.equal((d.prepare("SELECT count(*) n FROM dobor_rozmowy").get() as { n: number }).n, 0);
  d.close();
});

test("druga migracja nic nie robi i niczego nie psuje", () => {
  const d = bazaZOsmiomaDrogami();
  d.prepare("INSERT INTO dobor_rozmowy(conversation_id,marka) VALUES (1,'NAC')").run();
  migrate(d);
  const poPierwszej = d.prepare("SELECT sql FROM sqlite_master WHERE name='dobor_rozmowy'").get() as { sql: string };
  migrate(d);
  const poDrugiej = d.prepare("SELECT sql FROM sqlite_master WHERE name='dobor_rozmowy'").get() as { sql: string };
  assert.equal(poDrugiej.sql, poPierwszej.sql, "warunek z sqlite_master ma zatrzymać drugą przebudowę");
  assert.equal((d.prepare("SELECT marka FROM dobor_rozmowy WHERE conversation_id=1").get() as { marka: string }).marka, "NAC");
  d.close();
});

test("listy CHECK zabudowy są zamknięte dokumentem, a maszyna nie bywa własnym silnikiem", () => {
  const d = bazaZOsmiomaDrogami();
  migrate(d);
  d.exec(`INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('maszyna','NAC','LS 46-450','maszyna|nacls46450','Ala');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('silnik','Briggs','450E','silnik|briggs450e','Ala');`);
  const wstaw = (maszyna: number, silnik: number, stan: string, zrodlo: string, dowod: string) =>
    d.prepare(`INSERT INTO zabudowa_silnika(maszyna_id,silnik_id,stan,zrodlo_propozycji,
      rodzaj_dowodu,dowod_tresc,zaproponowal) VALUES (?,?,?,?,?,'karta','Ala')`)
      .run(maszyna, silnik, stan, zrodlo, dowod);

  assert.throws(() => wstaw(1, 2, "czeka", "reczne", "producent"), /CHECK/);
  assert.throws(() => wstaw(1, 2, "propozycja", "ai", "producent"), /CHECK/);
  assert.throws(() => wstaw(1, 2, "propozycja", "reczne", "przeczucie"), /CHECK/);
  assert.throws(() => wstaw(1, 1, "propozycja", "reczne", "producent"), /CHECK/, "maszyna nie jest swoim silnikiem");
  /* Wszystkie wartości z list wchodzą — także `copilot`, który nadawcy nie ma. */
  for (const zrodlo of ["reczne", "dobor", "copilot"]) wstaw(1, 2, "propozycja", zrodlo, "producent");
  for (const dowod of ["producent", "katalog_dostawcy", "pomiar_wlasny", "decyzja_biura",
    "sprzedaz_weryfikacja", "rozmowa"]) wstaw(1, 2, "propozycja", "reczne", dowod);
  d.close();
});

test("model z zabudową nie znika po cichu — ON DELETE RESTRICT", () => {
  const d = bazaZOsmiomaDrogami();
  migrate(d);
  d.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('maszyna','NAC','LS 46-450','maszyna|nacls46450','Ala');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('silnik','Briggs','450E','silnik|briggs450e','Ala');
    INSERT INTO zabudowa_silnika(maszyna_id,silnik_id,zrodlo_propozycji,rodzaj_dowodu,dowod_tresc,zaproponowal)
      VALUES (1,2,'reczne','producent','karta','Ala');`);
  assert.throws(() => d.prepare("DELETE FROM model_urzadzenia WHERE id=2").run(), /FOREIGN KEY/);
  d.close();
});
