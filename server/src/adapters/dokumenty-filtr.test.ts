import { test } from "node:test";
import assert from "node:assert/strict";
import { budujFiltryDokumentow } from "./subiekt.mssql.js";

/* ── Które dokumenty trafiają na listę rozkładania ──────────────────────────
   Dwie reguły, obie łatwe do napisania odwrotnie i obie kosztowne, gdy się to
   zrobi:

   1. TYPY DOSTAW. Do sierpnia 2026 para FZ/PZ była zaszyta w zapytaniu, choć
      zwroty tuż obok miały już listę z konfiguracji. Firma przyjmująca towar
      wyłącznie na FZ widziała więc na liście pracy dokumenty z zupełnie innego
      procesu.

   2. OKNO DAT Z WYJĄTKIEM. Okno obcina dokumenty po dacie wystawienia, ale
      dostawa NIEROZŁOŻONA DO KOŃCA zostaje niezależnie od wieku. Bez tego
      skrócenie okna kasowałoby z ekranu niedokończoną pracę — a brak dostawy
      na liście wygląda identycznie jak dostawa rozłożona.

   Testujemy fragmenty SQL, nie wynik zapytania: bez serwera MSSQL to jedyna
   rzecz, którą da się tu sprawdzić, i zarazem jedyna, w której siedzi logika. */

// ── Typy dostaw ─────────────────────────────────────────────────────────────

test("domyślne 1,10 wpuszczają FZ i PZ", () => {
  // regresja dla instalacji, które NIE ustawiają nowej zmiennej
  const { dostawyTypFilter } = budujFiltryDokumentow([1, 10], []);
  assert.equal(dostawyTypFilter, "d.dok_Typ IN (1,10)");
});

test("sama jedynka odcina PZ", () => {
  // firma przyjmująca towar wyłącznie na FZ — PZ jest u niej innym procesem
  const { dostawyTypFilter } = budujFiltryDokumentow([1], []);
  assert.equal(dostawyTypFilter, "d.dok_Typ IN (1)");
  assert.doesNotMatch(dostawyTypFilter, /10/);
});

test("pusta lista typów daje PUSTĄ listę pracy, nie wszystko", () => {
  /* Reguła najłatwiejsza do ustawienia odwrotnie. Literówka w ustawieniu ma
     dać pusty ekran — zauważalny natychmiast — a nie wpuścić magazynierowi
     każdy dokument leżący na magazynie. */
  const { dostawyTypFilter } = budujFiltryDokumentow([], []);
  assert.equal(dostawyTypFilter, "d.dok_Typ IN (NULL)");
});

test("liczby są obcinane do całkowitych — do zapytania nie idzie tekst", () => {
  const { dostawyTypFilter } = budujFiltryDokumentow([1.9, 10.2], []);
  assert.equal(dostawyTypFilter, "d.dok_Typ IN (1,10)");
});

// ── Okno dat i wyjątek na niedokończone ─────────────────────────────────────

test("bez otwartych dostaw zostaje samo okno dat", () => {
  /* `IN ()` jest BŁĘDEM SKŁADNI, nie zbiorem pustym — gałąź OR musi zniknąć
     w całości, inaczej wywala się cały import, a nie jeden dokument. */
  const { oknoFilter } = budujFiltryDokumentow([1], []);
  assert.equal(oknoFilter, "d.dok_DataWyst >= @cutoff");
  assert.doesNotMatch(oknoFilter, /IN \(\)/);
});

test("otwarta dostawa wchodzi OBOK okna dat, nie zamiast niego", () => {
  // to jest cała wartość tej zmiany: dostawa sprzed miesiąca, której nikt nie
  // dokończył, zostaje widoczna — a świeże dokumenty dalej wchodzą normalnie
  const { oknoFilter } = budujFiltryDokumentow([1], [4821, 4822]);
  assert.equal(oknoFilter, "(d.dok_DataWyst >= @cutoff OR d.dok_Id IN (4821,4822))");
  assert.match(oknoFilter, /@cutoff/, "okno dat NIE MOŻE zniknąć");
});

test("identyfikatory otwartych dostaw też są obcinane", () => {
  const { oknoFilter } = budujFiltryDokumentow([1], [4821.7]);
  assert.match(oknoFilter, /IN \(4821\)/);
});
