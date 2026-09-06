import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { powiazZaleglosci } from "./wiazania.js";

/* ── Parasol nad wiązaniem (0.220.0) ─────────────────────────────────────────
   Ten plik pilnuje jednej rzeczy: żeby praca, która nie potrzebuje Allegro,
   nie ginęła razem z żądaniem, które się nie udało. Blizna była widoczna
   z ekranu jako „Bez kartoteki" przy KAŻDEJ pozycji, z gotową propozycją
   tuż obok.                                                                */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

/** Zwrot z zamówieniem: sygnatura wskazuje kartotekę, numer — dokument. */
function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.exec("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')");
  d.exec("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (10,'SEK-46','Sekator')");
  d.exec(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,nr_oryg,data_wyst)
    VALUES (500,'FS','FS 140/2026','ord-1','2026-08-30')`);
  d.exec(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (1,'ord-1','2026-08-31T10:00:00Z')`);
  d.exec(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,'111','Sekator NAC','SEK-46',1,8999,'PLN')`);
  d.exec(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,created_at,synced_at)
    VALUES (1,'zwr-1','ord-1','2026-08-31T08:00:00Z','2026-08-31T10:00:00Z')`);
  d.exec(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,offer_id,klucz,nazwa,ilosc,cena_grosze,waluta)
    VALUES (1,'111','111|Sekator NAC','Sekator NAC',1,8999,'PLN')`);
  return d as unknown as Db;
}

test("wiązanie dopina kartotekę i dokument w jednym przebiegu", () => {
  const d = stanowisko();
  const w = powiazZaleglosci(d);
  assert.equal(w.kartoteki, 1);
  assert.equal(w.faktury, 1);

  const p = d.prepare("SELECT tw_id FROM zwrot_klienta_pozycja").get() as { tw_id: number };
  assert.equal(p.tw_id, 10);
});

test("wywrócony krok NIE zabiera pozostałych", () => {
  /* Wiązanie kartotek pyta o pamięć wskazań PRZED pętlą, więc brak tej tabeli
     wywraca cały krok — a to jest dokładnie ten kształt awarii, o który
     chodzi: coś pada, a reszta ma dojść. Bez parasola padłoby wszystko. */
  const d = stanowisko();
  d.exec("DROP TABLE oferta_kartoteka");

  const w = powiazZaleglosci(d);
  assert.equal(w.kartoteki, 0, "krok z awarią oddaje zero, a nie wyjątek");
  assert.equal(w.faktury, 1, "dokument sprzedaży wiąże się mimo tamtej awarii");

  const z = d.prepare("SELECT faktura_dok_id FROM zwrot_klienta").get() as
    { faktura_dok_id: number | null };
  assert.equal(z.faktura_dok_id, 500);
});

test("takt woła wiązanie w `finally`, a nie po `await`", () => {
  /* Strażnik blizny, nie ozdoba. Do 0.220.0 wiązanie stało jako ciąg dalszy
     po `await synchronizujAllegroZwroty()` i przy każdym błędzie Allegro nie
     wykonywało się ANI RAZU. Test czyta źródło, bo `main()` nie da się
     wywołać w teście — uruchamia tickery strzelające do Allegro. */
  const zrodlo = fs.readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const wywolania = zrodlo.match(/powiazZaleglosci\(/g) ?? [];
  assert.equal(wywolania.length, 2, "oba takty (zwroty i zamówienia) mają wiązać zaległości");

  for (const takt of ["synchronizujAllegroZwroty", "uzupelnijZamowienia"]) {
    const wzor = new RegExp(
      `await ${takt}\\(\\);\\s*\\}\\s*finally\\s*\\{[^}]*powiazZaleglosci\\(`);
    assert.match(zrodlo, wzor, `${takt}: wiązanie musi stać w finally`);
  }
});
