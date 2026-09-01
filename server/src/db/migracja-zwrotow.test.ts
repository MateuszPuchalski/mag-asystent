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
