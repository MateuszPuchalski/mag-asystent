import { test } from "node:test";
import assert from "node:assert/strict";
import { zWzorca } from "./allegro-linki.js";

/* Link, który trafia w 404, kosztuje kliknięcie i zaufanie do ekranu —
   a numer zwrotu bywa postaci `4R50/2026`, więc kodowanie nie jest tu
   ozdobą. */

const WZOR = "https://allegro.pl/moje-allegro/sprzedaz/zwroty/{id}";

test("identyfikator wchodzi w miejsce znacznika", () => {
  assert.equal(zWzorca(WZOR, "abc"), "https://allegro.pl/moje-allegro/sprzedaz/zwroty/abc");
});

test("ukośnik w numerze zwrotu nie robi z jednego segmentu dwóch", () => {
  /* `4R50/2026` bez kodowania rozjechałby ścieżkę i dał 404. */
  assert.equal(
    zWzorca(WZOR, "4R50/2026"),
    "https://allegro.pl/moje-allegro/sprzedaz/zwroty/4R50%2F2026"
  );
});

test("brak identyfikatora daje brak linku, nie link donikąd", () => {
  /* Ekran ma wtedy pokazać sam tekst. Odnośnik prowadzący w pustkę jest
     gorszy od jego braku. */
  for (const v of [null, undefined, ""]) assert.equal(zWzorca(WZOR, v), null);
});

test("pusty wzorzec wyłącza odnośnik", () => {
  /* Wpis `ALLEGRO_PANEL_ZWROT=` w `wertis.env` to sposób na wyłączenie
     linków, gdy adres Allegro okaże się zły, a poprawny nieznany. */
  assert.equal(zWzorca("", "abc"), null);
});

test("wzorzec z konfiguracji rządzi w całości, razem z hostem", () => {
  /* Nadpisanie w `wertis.env` podmienia też host — instancja sandboksowa nie
     ma prawa linkować do produkcji. */
  assert.equal(
    zWzorca("https://allegro.pl.allegrosandbox.pl/x/{id}", "7"),
    "https://allegro.pl.allegrosandbox.pl/x/7"
  );
});
