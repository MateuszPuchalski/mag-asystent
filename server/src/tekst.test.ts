import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  LITERY,
  naLike,
  odlegloscOgraniczona,
  progLiterowki,
  sqlZloz,
  sqlZwin,
  tokeny,
  zloz,
  zwin,
} from "./tekst.js";

/* ── Składanie tekstu ────────────────────────────────────────────────────────
   Te funkcje są czyste, więc testują się bez bazy — poza JEDNYM przypadkiem,
   który jest tu najważniejszy: zgodnością strony JS ze stroną SQL. Zapytanie
   składa JavaScript, kolumnę składa SQLite, a rozjazd o jedną literę wyłącza
   wyszukiwanie dla tej litery BEZ ŻADNEGO OBJAWU. Dlatego ten jeden test
   otwiera prawdziwą bazę w pamięci i porównuje oba wyniki znak po znaku.     */

/** Baza w pamięci — bez pliku, bez konfiguracji aplikacji. */
const sqlite = new DatabaseSync(":memory:");
const przezSql = (wyrazenie: string, wejscie: string): string =>
  (sqlite.prepare(`SELECT ${wyrazenie} AS v`).get(wejscie) as { v: string }).v;

// ── Poziom pierwszy: litery i wielkość ──────────────────────────────────────

test("polskie znaki schodzą do ASCII, wielkość liter znika", () => {
  assert.equal(zloz("GAŹNIK"), "gaznik");
  assert.equal(zloz("Gaźnik"), "gaznik");
  assert.equal(zloz("ŻARÓWKA"), "zarowka");
  assert.equal(zloz("Świeca zapłonowa"), "swieca zaplonowa");
});

test("ł i Ł też — a to jest ta litera, na której NFD milczy", () => {
  /* `"ł".normalize("NFD").length === 1` — ta litera NIE MA rozkładu
     kanonicznego. Gotowe „usuń znaki łączące" przepuściłoby ją nietkniętą,
     a błąd zostałby uznany za naprawiony. Stąd jawna mapa i ten test. */
  assert.equal(zloz("ŁAŃCUCH"), "lancuch");
  assert.equal(zloz("łożysko"), "lozysko");
  assert.equal(zloz("Łódź"), "lodz");
});

test("znak spoza mapy zostaje nietknięty", () => {
  // Świadomie NIE składamy niemieckich przegłosów: strona SQL też ich nie zna,
  // a asymetria znaczyłaby, że wpisane „Müller" nie trafia w „Müller".
  assert.equal(zloz("Müller"), "müller");
});

// ── Poziom drugi: oddzielacze ───────────────────────────────────────────────

test("myślniki, spacje i kropki znikają z formy zwiniętej", () => {
  assert.equal(zwin("LS51-139-HSD-LI-068"), "ls51139hsdli068");
  assert.equal(zwin("W08 0502"), "w080502");
  assert.equal(zwin("SW-40"), "sw40");
});

test("forma złożona ZOSTAWIA spacje — na niej pracuje furtka literówkowa", () => {
  assert.equal(zloz("Gaźnik do kosy"), "gaznik do kosy");
});

// ── Zgodność JS ↔ SQL ───────────────────────────────────────────────────────

test("dla KAŻDEJ litery z mapy SQL składa dokładnie tak samo jak JS", () => {
  /* Iterujemy po tablicy, a nie po wypisanej liście — dopisanie litery do
     `LITERY` automatycznie obejmuje ten test. Bez tego nowa litera wchodziłaby
     do jednej strony i cicho psuła drugą. */
  for (const [z] of LITERY) {
    const probka = `X${z}Y`;
    assert.equal(przezSql(sqlZloz("?"), probka), zloz(probka), `zloz rozjechało się na „${z}"`);
    assert.equal(przezSql(sqlZwin("?"), probka), zwin(probka), `zwin rozjechało się na „${z}"`);
  }
});

test("zgodność JS ↔ SQL na prawdziwych łańcuchach z kartoteki", () => {
  for (const p of ["Gaźnik kompletny", "ŚWIECA ZAPŁONOWA NGK", "LS51-139-HSD", "W08-0502", "Łódź żółw"]) {
    assert.equal(przezSql(sqlZloz("?"), p), zloz(p), `zloz: ${p}`);
    assert.equal(przezSql(sqlZwin("?"), p), zwin(p), `zwin: ${p}`);
  }
});

// ── Tokeny ──────────────────────────────────────────────────────────────────

test("zapytanie rozpada się na słowa, każde zwinięte", () => {
  assert.deepEqual(tokeny("  gaźnik   ssanie "), ["gaznik", "ssanie"]);
  assert.deepEqual(tokeny("GAŹNIK"), ["gaznik"]);
});

test("wejście bez ani jednego słowa daje PUSTĄ tablicę", () => {
  /* Ten wynik jest istotny, a nie pusty: koniunkcja po pustym zbiorze jest
     prawdziwa, więc bez sprawdzenia go przez wywołującego wyszukiwarka
     oddałaby całą kartotekę na zapytanie „-". */
  assert.deepEqual(tokeny("-"), []);
  assert.deepEqual(tokeny("///"), []);
  assert.deepEqual(tokeny("   "), []);
  assert.deepEqual(tokeny(""), []);
});

test("wklejony opis nie zamienia się w trzydzieści tokenów", () => {
  const dlugie = Array.from({ length: 30 }, (_, i) => `slowo${i}`).join(" ");
  assert.equal(tokeny(dlugie).length, 6);
});

// ── Metaznaki LIKE ──────────────────────────────────────────────────────────

test("procent i podkreślenie przestają być wieloznacznikami", () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE t(n TEXT)");
  for (const v of ["filtr 100%", "filtr 1005", "wal_korbowy", "walxkorbowy"]) {
    d.prepare("INSERT INTO t VALUES (?)").run(v);
  }
  const ile = (q: string) =>
    (d.prepare("SELECT COUNT(*) AS n FROM t WHERE n LIKE '%' || ? || '%' ESCAPE '\\'").get(naLike(q)) as {
      n: number;
    }).n;
  assert.equal(ile("100%"), 1, "procent ma być zwykłym znakiem, nie „cokolwiek dalej\"");
  assert.equal(ile("wal_"), 1, "podkreślenie ma być zwykłym znakiem, nie „dowolny znak\"");
  assert.equal(ile("filtr"), 2, "zwykłe zapytanie działa jak dotąd");
});

// ── Odległość edycyjna ──────────────────────────────────────────────────────

test("liczy odległość do progu i nie liczy dalej", () => {
  assert.equal(odlegloscOgraniczona("gaznik", "gaznik", 2), 0);
  assert.equal(odlegloscOgraniczona("gaznik", "gaznk", 2), 1, "brakująca litera");
  assert.equal(odlegloscOgraniczona("gaznik", "gzanik", 2), 2, "przestawione litery");
  assert.equal(odlegloscOgraniczona("gaznik", "swieca", 2), 3, "ponad progiem wraca max+1, nie prawda");
});

test("różnica długości większa od progu ucina bez liczenia", () => {
  assert.equal(odlegloscOgraniczona("kosa", "kosaspalinowadohondy", 2), 3);
});

test("wynik nie zależy od kolejności argumentów", () => {
  assert.equal(odlegloscOgraniczona("gaznk", "gaznik", 2), odlegloscOgraniczona("gaznik", "gaznk", 2));
});

test("przypadki brzegowe nie wywracają liczenia", () => {
  assert.equal(odlegloscOgraniczona("", "", 2), 0);
  assert.equal(odlegloscOgraniczona("a", "", 2), 1);
  assert.equal(odlegloscOgraniczona("kosa", "kosb", 0), 1, "przy zerowym progu każda różnica to max+1");
});

test("krótkie słowa nie dostają prawa do literówki", () => {
  // jeden błąd na trzech znakach zrównuje kos = kot = koc = kod
  assert.equal(progLiterowki(3), null);
  assert.equal(progLiterowki(4), 1);
  assert.equal(progLiterowki(5), 1);
  assert.equal(progLiterowki(6), 2);
  assert.equal(progLiterowki(20), 2);
});
