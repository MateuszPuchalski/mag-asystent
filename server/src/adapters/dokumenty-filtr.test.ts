import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budujFiltryDokumentow,
  zapytaniePozycjiMm,
  zdaniePrzyjecBezPozycji,
} from "./subiekt.mssql.js";

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

/* ── Pozycje przesunięcia MM (0.76.1) ────────────────────────────────────────
   Test na jedną kolumnę, bo przez nią zakładka ZWROTY nie działała u klienta:
   pozycje MM wiszą na dokumencie MAGAZYNOWYM. Kolumna dokumentu handlowego
   zwraca pustkę — nie błąd, więc nic o sobie nie mówi.                       */

test("pozycje MM łączą się przez dokument magazynowy, nie handlowy", () => {
  const sql = zapytaniePozycjiMm("d.dok_Typ = @typ");
  assert.match(sql, /ON d\.dok_Id = p\.ob_DokMagId/);
  assert.doesNotMatch(sql, /ob_DokHanId/);
  assert.match(sql, /WHERE d\.dok_Typ = @typ/);
});

test("nazwa towaru idzie z dokumentu, żeby kartoteka zablokowana nie znikła", () => {
  const sql = zapytaniePozycjiMm("1=1");
  assert.match(sql, /LEFT JOIN tw__Towar/);
  assert.match(sql, /tw_Symbol AS symbol/);
  assert.match(sql, /tw_Nazwa AS nazwa/);
});

test("dokumenty bez pozycji mówią o sobie, zamiast wyglądać na spokojny dzień", () => {
  /* Przesunięcie bez pozycji nie ma po co powstać, więc taki wynik zawsze
     znaczy zepsuty odczyt — i musi się o tym dowiedzieć wdrażający, a nie
     magazynier stojący z koszem przy pustym ekranie. */
  const zdanie = zdaniePrzyjecBezPozycji(6, 0);
  assert.match(zdanie ?? "", /6 przesunięć/);
  assert.match(zdanie ?? "", /ob_DokMagId/);
  // dzień bez przesunięć i normalny import milczą
  assert.equal(zdaniePrzyjecBezPozycji(0, 0), null);
  assert.equal(zdaniePrzyjecBezPozycji(6, 18), null);
});
