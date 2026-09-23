import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { BladFirmy, MAKS_ZNAKOW, daneFirmy, zapiszDaneFirmy } from "./firma.js";

/* ── Dane firmy (0.444.0) ──────────────────────────────────────────────────
   Trzy obietnice serwisu, każda z własnym testem: pusta baza nie jest błędem
   (panel na niej opiera propozycję przeniesienia z przeglądarki), zapis
   podmienia całość i zostawia ślad, a śmieci nie wchodzą.                   */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

test("pusta baza: sześć pustych pól i brak znacznika zmiany", () => {
  const s = daneFirmy(baza());
  assert.deepEqual(s.dane, { nazwa: "", nip: "", adres: "", miejscowosc: "", osoba: "", telefon: "" });
  assert.equal(s.zmieniono, null);
});

test("zapis przycina, podmienia całość i zostawia ślad bez treści pól", () => {
  const d = baza();
  zapiszDaneFirmy({ nazwa: "  WERTIS Sp. z o.o. ", nip: "1234567890", telefon: "600 100 200" }, "Ala", d);
  zapiszDaneFirmy({ nazwa: "WERTIS", adres: "ul. Polna 1" }, "Ola", d);
  const s = daneFirmy(d);
  /* Drugi zapis nie wysłał NIP-u — i NIP zniknął. Tak ma być: formularz
     wysyła komplet, więc brak pola znaczy „wyczyszczone". */
  assert.deepEqual(s.dane, { nazwa: "WERTIS", nip: "", adres: "ul. Polna 1", miejscowosc: "", osoba: "", telefon: "" });
  assert.equal(s.zmieniono?.przez, "Ola");
  assert.equal((d.prepare("SELECT COUNT(*) n FROM firma").get() as { n: number }).n, 1);
  const zdarzenia = d.prepare("SELECT payload FROM events WHERE type = 'firma_zapis' ORDER BY id").all() as Array<{ payload: string }>;
  assert.equal(zdarzenia.length, 2);
  assert.deepEqual(JSON.parse(zdarzenia[1].payload), { wypelnione: ["nazwa", "adres"] });
  assert.ok(!zdarzenia[0].payload.includes("1234567890"), "treść pól nie trafia do dziennika");
});

test("za długie pole i nie-tekst odrzucone, baza nietknięta", () => {
  const d = baza();
  assert.throws(() => zapiszDaneFirmy({ nazwa: "x".repeat(MAKS_ZNAKOW + 1) }, "Ala", d), BladFirmy);
  assert.throws(() => zapiszDaneFirmy({ nip: 123 as unknown as string }, "Ala", d), BladFirmy);
  assert.equal(daneFirmy(d).zmieniono, null);
});

test("drugi wiersz tabeli jest niemożliwy — firma jest jedna", () => {
  const d = baza();
  assert.throws(() => d.prepare(
    "INSERT INTO firma (id, zmieniono_at, zmieniono_przez) VALUES (2, 'x', 'y')").run());
});
