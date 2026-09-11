import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "./db.js";

/* ── Karta Copilota na bazie sprzed 0.276.0 (0.276.2) ────────────────────────
   TO JEST TEST NA BŁĄD, KTÓRY ZGŁOSIŁ WŁAŚCICIEL, nie ćwiczenie z ostrożności.
   0.276.0 dołożyło kolumny rady do `reklamacja_karta` WYŁĄCZNIE w `schema.sql`,
   bo plan założył, że tabela z 0.275.0 „na produkcji jeszcze nie stoi". Stała.
   `CREATE TABLE IF NOT EXISTS` nie dokłada kolumn do istniejącej tabeli, więc
   każde rozpoznanie sprawy padało zdaniem:

     table reklamacja_karta has no column named rekomendacja

   Stanowisko odtwarza to wiernie: NAJPIERW tabela w kształcie 0.275.0, dopiero
   potem pełny `schema.sql`, który ją wtedy pomija — dokładnie tak, jak wygląda
   baza, na której wdrożono dwa wydania po kolei.

   Druga asercja jest OGÓLNA i pilnuje następnego razu: zbiór kolumn po
   migracji starej bazy ma być taki sam jak w bazie zbudowanej od zera. Każda
   kolumna dopisana kiedyś do `schema.sql` bez `addColumn` przewróci ten test
   przy pierwszym uruchomieniu, a nie u właściciela.                         */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/** Kształt `reklamacja_karta` z 0.275.0 — same fakty, bez rady i bez oceny. */
const KSZTALT_0_275_0 = `
  CREATE TABLE reklamacja_karta (
    reklamacja_id      INTEGER PRIMARY KEY REFERENCES reklamacja_klienta(id) ON DELETE CASCADE,
    usterka            TEXT,
    usterka_zrodlo     TEXT,
    kiedy              TEXT,
    kiedy_zrodlo       TEXT,
    oczekiwanie        TEXT,
    oczekiwanie_zrodlo TEXT,
    dowody             TEXT NOT NULL DEFAULT '[]',
    brakuje            TEXT NOT NULL DEFAULT '[]',
    model              TEXT NOT NULL DEFAULT '',
    przez              TEXT,
    przez_user_id      INTEGER REFERENCES app_user(user_id),
    at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`;

const kolumny = (d: DatabaseSync, tabela: string) =>
  (d.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>)
    .map((k) => k.name).sort();

/** Baza sprzed 0.276.0: stara tabela stoi, więc `schema.sql` jej nie tknie. */
function stara() {
  const d = new DatabaseSync(":memory:");
  d.exec(KSZTALT_0_275_0);
  d.exec(schema);
  migrate(d);
  return d;
}

test("karta zapisuje się na bazie sprzed 0.276.0 — to jest zgłoszony błąd", () => {
  const d = stara();
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','Ala','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,otwarto_at,synced_at)
    VALUES (?,'i-1','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto).lastInsertRowid);

  /* Zapis jest KOPIĄ listy kolumn z `copilot-reklamacja.ts` — gdyby tamta
     urosła bez migracji, ten test pada tak samo jak panel u właściciela. */
  d.prepare(`INSERT INTO reklamacja_karta
    (reklamacja_id, usterka, usterka_zrodlo, kiedy, kiedy_zrodlo,
     oczekiwanie, oczekiwanie_zrodlo, dowody, brakuje,
     rekomendacja, pewnosc, uzasadnienie, uzasadnienie_zrodlo, czego_nie_wiem,
     model, przez, przez_user_id, at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, "Pękła obudowa", "W1", "po tygodniu", "W1", "wymiana", "W1",
    "[]", "[]", "ACCEPTED_EXCHANGE", "srednia", "Usterka w pierwszym tygodniu", "W1",
    '["czy towar był używany zgodnie z instrukcją"]', "claude-test", "Ala", 1,
    "2026-09-11T09:00:00.000Z");

  const w = d.prepare("SELECT rekomendacja, czego_nie_wiem FROM reklamacja_karta WHERE reklamacja_id=?")
    .get(id) as { rekomendacja: string; czego_nie_wiem: string };
  assert.equal(w.rekomendacja, "ACCEPTED_EXCHANGE");
  assert.equal(w.czego_nie_wiem, '["czy towar był używany zgodnie z instrukcją"]');
});

test("stara baza po migracji ma DOKŁADNIE te kolumny, co baza zbudowana od zera", () => {
  const odZera = new DatabaseSync(":memory:");
  odZera.exec(schema);
  migrate(odZera);

  assert.deepEqual(kolumny(stara(), "reklamacja_karta"), kolumny(odZera, "reklamacja_karta"));
});

test("ocena rady przyjmuje tylko dwie wartości także po migracji", () => {
  /* `CHECK` na kolumnie dołożonej przez `ALTER TABLE` jest legalny i ma
     obowiązywać — inaczej migracja oddawałaby kolumnę słabszą niż schemat. */
  const d = stara();
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','Ala','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,otwarto_at,synced_at)
    VALUES (?,'i-2','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare("INSERT INTO reklamacja_karta(reklamacja_id, model) VALUES (?, 'claude-test')").run(id);

  assert.throws(
    () => d.prepare("UPDATE reklamacja_karta SET ocena='moze' WHERE reklamacja_id=?").run(id),
    /CHECK/i);
  d.prepare("UPDATE reklamacja_karta SET ocena='trafna' WHERE reklamacja_id=?").run(id);
});
