import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  BladTagu, MAKS_AKTYWNYCH, przelaczTag, slownikTagow, utworzTag, zmienNazweTagu,
} from "./tagi-spraw.js";

/* ── Słownik tagów spraw ─────────────────────────────────────────────────────
   Słownik jest OTWARTY, bo właściciel wybrał „dodatkowo edytowalne". Cena tej
   swobody jest znana: pasek z czterdziestoma pigułkami przestaje filtrować.
   Płacą ją trzy ograniczenia i każde ma tu swój test:

   1. JEDNOZNACZNOŚĆ PO MAŁYCH LITERACH. „Gwarancja" po „gwarancja" to jeden
      tag w głowie i dwie pigułki w filtrze.
   2. SUFIT AKTYWNYCH, ze zdaniem, które mówi liczbę i drogę wyjścia.
   3. WYŁĄCZANIE ZAMIAST KASOWANIA. Skasowany tag zniknąłby ze spraw
      historycznych, a wtedy „dlaczego to stało trzy tygodnie" traci odpowiedź. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const ALA = { id: 1, name: "Ala" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','Ala','biuro')").run();
  return { d };
}

const nazwy = (d: DatabaseSync) => slownikTagow(d).map((t) => t.nazwa);

test("ziarno wsiewa TRZY słowa właściciela i tylko do pustego słownika", () => {
  const { d } = stanowisko();
  assert.deepEqual(nazwy(d).sort(),
    ["czeka na część", "do decyzji właściciela", "u producenta / u dostawcy"]);

  /* Biuro zmienia nazwę i wyłącza jeden tag — restart procesu nie ma prawa
     przywrócić wartości fabrycznych. */
  const [pierwszy] = slownikTagow(d);
  zmienNazweTagu(d, pierwszy.id, "u serwisu", ALA);
  migrate(d);
  assert.ok(nazwy(d).includes("u serwisu"));
  assert.equal(slownikTagow(d).length, 3, "ziarno nie wsiało się drugi raz");
});

test("„Gwarancja” po „gwarancja” to TEN SAM tag, a nie druga pigułka w filtrze", () => {
  const { d } = stanowisko();
  const a = utworzTag(d, "gwarancja", ALA);
  const b = utworzTag(d, "  GWARANCJA  ", ALA);
  assert.equal(b.id, a.id, "duplikat oddaje istniejący wiersz zamiast odmowy");
  assert.equal(slownikTagow(d).filter((t) => t.nazwa === "gwarancja").length, 1);

  /* Polskie znaki też: `COLLATE NOCASE` w SQLite ich nie zna, dlatego indeks
     stoi na `lower(nazwa)`. */
  const c = utworzTag(d, "Część zamienna", ALA);
  assert.equal(utworzTag(d, "część zamienna", ALA).id, c.id);
});

test("nazwa pusta i nazwa dłuższa od czipa odpadają ze zdaniem, nie po cichu", () => {
  const { d } = stanowisko();
  assert.throws(() => utworzTag(d, "   ", ALA), BladTagu);
  assert.throws(() => utworzTag(d, "x".repeat(31), ALA), /31 znaków.*30/);
  /* Ciche przycięcie byłoby gorsze: agent zobaczyłby na ekranie inny tag,
     niż wpisał, i nie dowiedziałby się dlaczego. */
  assert.equal(utworzTag(d, "  dwa   odstępy  ", ALA).nazwa, "dwa odstępy");
});

test("sufit aktywnych mówi LICZBĘ i drogę wyjścia, a wyłączenie zwalnia miejsce", () => {
  const { d } = stanowisko();
  while (slownikTagow(d).filter((t) => t.aktywny).length < MAKS_AKTYWNYCH) {
    utworzTag(d, `tag ${slownikTagow(d).length}`, ALA);
  }
  assert.throws(() => utworzTag(d, "jeszcze jeden", ALA), (e: unknown) => {
    assert.ok(e instanceof BladTagu);
    assert.match(e.message, new RegExp(String(MAKS_AKTYWNYCH)));
    assert.match(e.message, /wyłącz nieużywany/, "sufit bez drogi wyjścia jest ścianą");
    return true;
  });

  const [pierwszy] = slownikTagow(d);
  przelaczTag(d, pierwszy.id, false, ALA);
  assert.ok(utworzTag(d, "jeszcze jeden", ALA).id > 0);
});

test("tag się WYŁĄCZA, nigdy nie kasuje — zostaje w słowniku", () => {
  const { d } = stanowisko();
  const tag = utworzTag(d, "u producenta", ALA);
  przelaczTag(d, tag.id, false, ALA);
  assert.deepEqual(slownikTagow(d).find((t) => t.id === tag.id),
    { id: tag.id, nazwa: "u producenta", aktywny: false },
    "ekran ustawień musi go pokazać, żeby dało się go włączyć z powrotem");
});

test("wpisanie nazwy tagu wyłączonego WRACA go do użytku", () => {
  /* Skoro ktoś wpisał tę nazwę z palca przy sprawie, to jest mu potrzebna.
     Zdanie „ten tag jest wyłączony, idź do Ustawień" byłoby ścianą w połowie
     czynności. */
  const { d } = stanowisko();
  const tag = utworzTag(d, "u producenta", ALA);
  przelaczTag(d, tag.id, false, ALA);

  const znowu = utworzTag(d, "U Producenta", ALA);
  assert.equal(znowu.id, tag.id);
  assert.equal(znowu.aktywny, true);
});

test("zmiana nazwy zostawia ten sam wiersz, a kolizja nazw jest odmową", () => {
  const { d } = stanowisko();
  const tag = utworzTag(d, "u producenta", ALA);
  const inny = utworzTag(d, "czeka na część", ALA);

  zmienNazweTagu(d, tag.id, "u serwisu", ALA);
  assert.equal(slownikTagow(d).find((t) => t.id === tag.id)?.nazwa, "u serwisu",
    "to ten sam tag, inaczej nazwany");

  assert.throws(() => zmienNazweTagu(d, tag.id, "Czeka Na Część", ALA), /już jest w słowniku/);
  assert.equal(slownikTagow(d).find((t) => t.id === inny.id)?.nazwa, "czeka na część");
});
