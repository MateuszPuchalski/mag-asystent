import { test } from "node:test";
import assert from "node:assert/strict";
import { dojrzaleKorekty } from "./korekty-dojrzale.js";

/* ── Korekta z wycofanego zapisu nie ma prawa zamknąć zwrotu (0.350.1) ──────
   Produkcja, 15 września 2026: import złapał ZW 463/MAG/09/2026 w trakcie
   zapisu, który Subiekt wycofał, i zwrot dostał numer nieistniejącego
   dokumentu. Te testy pilnują, że korekta potrzebuje DWÓCH odczytów. */

const PA = 21;
const ZW = 14;
const KFS = 6;
const TYPY = new Set([KFS, ZW]);

const dok = (dok_Id: number, dok_Typ: number) => ({ dok_Id, dok_Typ, nr: `D${dok_Id}` });

test("korekta widziana PIERWSZY raz czeka na następny import — sprzedaż wchodzi od razu", () => {
  const faktury = [dok(1, PA), dok(2, ZW)];
  const w = dojrzaleKorekty(faktury, TYPY, new Set([99]));
  assert.deepEqual(w.doZapisu.map((f) => f.dok_Id), [1]);
  assert.deepEqual(w.korekty, [2], "zapamiętana, żeby następny import ją wpuścił");
});

test("korekta widziana drugi raz wchodzi do read-modelu", () => {
  const faktury = [dok(1, PA), dok(2, ZW), dok(3, KFS)];
  const w = dojrzaleKorekty(faktury, TYPY, new Set([2, 3]));
  assert.deepEqual(w.doZapisu.map((f) => f.dok_Id), [1, 2, 3]);
});

test("wycofany zapis znika przed drugim odczytem — i nie zostaje w pamięci", () => {
  /* Pierwszy import zobaczył dokument 463, drugi już nie. Lista widzianych
     budowana od nowa z BIEŻĄCEGO odczytu, więc fantom nie wraca później. */
  const drugi = dojrzaleKorekty([dok(1, PA)], TYPY, new Set([463]));
  assert.deepEqual(drugi.doZapisu.map((f) => f.dok_Id), [1]);
  assert.deepEqual(drugi.korekty, []);
});

test("pierwszy import po wdrożeniu wpuszcza wszystkie korekty", () => {
  const w = dojrzaleKorekty([dok(1, PA), dok(2, ZW)], TYPY, new Set());
  assert.deepEqual(w.doZapisu.map((f) => f.dok_Id), [1, 2]);
});
