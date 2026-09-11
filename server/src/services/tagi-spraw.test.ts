import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  BladTagu, MAKS_AKTYWNYCH, odepnijTag, przelaczTag, przypnijTag, slownikTagow,
  tagiSprawy, tagiWszystkichSpraw, utworzTag, zmienNazweTagu,
} from "./tagi-spraw.js";

/* ── Tagi spraw (0.279.0) ────────────────────────────────────────────────────
   Słownik jest OTWARTY, bo właściciel wybrał „dodatkowo edytowalne". Cena tej
   swobody jest znana: pasek z czterdziestoma pigułkami przestaje filtrować.
   Płacą ją trzy ograniczenia i każde ma tu swój test:

   1. JEDNOZNACZNOŚĆ PO MAŁYCH LITERACH. „Gwarancja" po „gwarancja" to jeden
      tag w głowie i dwie pigułki w filtrze.
   2. SUFIT AKTYWNYCH, ze zdaniem, które mówi liczbę i drogę wyjścia.
   3. WYŁĄCZANIE ZAMIAST KASOWANIA. Skasowany tag zniknąłby ze spraw
      historycznych, a wtedy „dlaczego to stało trzy tygodnie" traci odpowiedź.

   Czwarta rzecz nie jest ograniczeniem, tylko granicą modułu: tag NIE
   przestawia kolejki. Tego pilnuje test kolejki, nie ten plik.              */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const ALA = { id: 1, name: "Ala" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','Ala','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const sprawa = (ext: string, typ: "CLAIM" | "DISPUTE" = "CLAIM") => Number(d.prepare(
    `INSERT INTO reklamacja_klienta (channel_account_id,external_id,typ,otwarto_at,synced_at)
     VALUES (?,?,?,'2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto, ext, typ).lastInsertRowid);
  return { d, sprawa };
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
  assert.equal(b.id, a.id, "duplikat oddaje istniejący wiersz, bo agent chce go PRZYPIĄĆ");
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

test("tag się WYŁĄCZA, nigdy nie kasuje — na starej sprawie zostaje", () => {
  const { d, sprawa } = stanowisko();
  const id = sprawa("i-1");
  const tag = utworzTag(d, "u producenta", ALA);
  przypnijTag(d, id, tag.id, ALA);

  przelaczTag(d, tag.id, false, ALA);
  assert.deepEqual(tagiSprawy(d, id).map((t) => t.nazwa), ["u producenta"],
    "historia sprawy nie ma prawa zniknąć razem z tagiem");

  /* Ale NOWEJ sprawie wyłączonego już nie przypniemy — inaczej „wyłączony"
     nie znaczyłoby nic. */
  const druga = sprawa("i-2");
  assert.throws(() => przypnijTag(d, druga, tag.id, ALA), /wyłączony/);
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

test("drugie kliknięcie w ten sam tag nie jest drugim faktem ani drugim śladem", () => {
  const { d, sprawa } = stanowisko();
  const id = sprawa("i-1");
  const tag = utworzTag(d, "czeka na część", ALA);

  assert.equal(przypnijTag(d, id, tag.id, ALA), true);
  assert.equal(przypnijTag(d, id, tag.id, ALA), false);
  assert.equal(tagiSprawy(d, id).length, 1);

  const sladow = d.prepare(
    "SELECT count(*) n FROM events WHERE type='sprawa_tag_przypiety'").get() as { n: number };
  assert.equal(Number(sladow.n), 1, "dziennik mówi, co się zmieniło, a nie ile razy kliknięto");
});

test("zdjęcie tagu jest całym cofnięciem, jakiego tag potrzebuje", () => {
  const { d, sprawa } = stanowisko();
  const id = sprawa("i-1");
  const tag = utworzTag(d, "czeka na część", ALA);
  przypnijTag(d, id, tag.id, ALA);

  assert.equal(odepnijTag(d, id, tag.id, ALA), true);
  assert.equal(tagiSprawy(d, id).length, 0);
  assert.equal(odepnijTag(d, id, tag.id, ALA), false, "nie ma czego zdejmować drugi raz");

  /* I z powrotem, tym samym ruchem — na tym stoi decyzja o braku `/cofnij`. */
  assert.equal(przypnijTag(d, id, tag.id, ALA), true);
});

test("sprawy nieistniejącej nie da się otagować, a numer tagu nie jest przepustką", () => {
  const { d, sprawa } = stanowisko();
  const id = sprawa("i-1");
  const tag = utworzTag(d, "czeka na część", ALA);

  assert.throws(() => przypnijTag(d, 9999, tag.id, ALA), /Sprawa 9999 nie istnieje/);
  assert.throws(() => przypnijTag(d, id, 9999, ALA), /Tag 9999 nie istnieje/);
});

test("dyskusja i reklamacja mają własne tagi mimo JEDNEJ tabeli", () => {
  const { d, sprawa } = stanowisko();
  const rek = sprawa("i-1", "CLAIM");
  const dys = sprawa("d-1", "DISPUTE");
  const a = utworzTag(d, "czeka na część", ALA);
  const b = utworzTag(d, "do decyzji właściciela", ALA);
  przypnijTag(d, rek, a.id, ALA);
  przypnijTag(d, dys, b.id, ALA);

  assert.deepEqual(tagiSprawy(d, rek).map((t) => t.nazwa), ["czeka na część"]);
  assert.deepEqual(tagiSprawy(d, dys).map((t) => t.nazwa), ["do decyzji właściciela"]);
});

test("tagi całej kolejki jadą JEDNYM zapytaniem, alfabetycznie", () => {
  /* Zapytanie per sprawa dałoby przy pięćdziesięciu sprawach pięćdziesiąt
     jeden zapytań na każde odświeżenie ekranu. */
  const { d, sprawa } = stanowisko();
  const jedna = sprawa("i-1");
  const druga = sprawa("i-2");
  const zet = utworzTag(d, "zebrać dowody", ALA);
  const ce = utworzTag(d, "czeka na część", ALA);
  przypnijTag(d, jedna, zet.id, ALA);
  przypnijTag(d, jedna, ce.id, ALA);
  przypnijTag(d, druga, ce.id, ALA);

  const mapa = tagiWszystkichSpraw(d);
  assert.deepEqual(mapa.get(jedna)?.map((t) => t.nazwa), ["czeka na część", "zebrać dowody"]);
  assert.deepEqual(mapa.get(druga)?.map((t) => t.nazwa), ["czeka na część"]);
  assert.equal(mapa.get(9999), undefined);
});

test("zmiana nazwy nie gubi przypięć, a kolizja nazw jest odmową", () => {
  const { d, sprawa } = stanowisko();
  const id = sprawa("i-1");
  const tag = utworzTag(d, "u producenta", ALA);
  const inny = utworzTag(d, "czeka na część", ALA);
  przypnijTag(d, id, tag.id, ALA);

  zmienNazweTagu(d, tag.id, "u serwisu", ALA);
  assert.deepEqual(tagiSprawy(d, id).map((t) => t.nazwa), ["u serwisu"],
    "to ten sam tag, inaczej nazwany");

  assert.throws(() => zmienNazweTagu(d, tag.id, "Czeka Na Część", ALA), /już jest w słowniku/);
  assert.equal(slownikTagow(d).find((t) => t.id === inny.id)?.nazwa, "czeka na część");
});
