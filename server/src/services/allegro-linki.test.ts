import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { linkReklamacji, zWzorca } from "./allegro-linki.js";

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

/* ── Zakres dat w adresie Centrum Sprzedaży (0.207.0) ───────────────────────
   Lista zwrotów filtruje po zakresie, więc numer w `search` sam nie wystarcza:
   zwrot spoza okna nie pokaże się mimo trafionego numeru.                   */

const CENTRUM = "https://salescenter.allegro.com/returns?page=1&limit=25&from={od}&search={id}";

test("data zgłoszenia wchodzi w zakres i jest zakodowana", () => {
  assert.equal(
    zWzorca(CENTRUM, "N4QZ/2026", "2026-08-20T00:00:00.000Z"),
    "https://salescenter.allegro.com/returns?page=1&limit=25" +
    "&from=2026-08-20T00%3A00%3A00.000Z&search=N4QZ%2F2026"
  );
});

test("brak daty zostawia zakres PUSTY, nie goły znacznik", () => {
  /* `from={od}` wysłane dosłownie byłoby błędem po tamtej stronie; bez
     wartości lista pokazuje własne domyślne okno. */
  assert.equal(
    zWzorca(CENTRUM, "abc"),
    "https://salescenter.allegro.com/returns?page=1&limit=25&from=&search=abc"
  );
});

test("wzorzec bez znacznika daty działa dalej — sandboks go nie ma", () => {
  assert.equal(zWzorca(WZOR, "abc", "2026-08-20T00:00:00.000Z"),
    "https://allegro.pl/moje-allegro/sprzedaz/zwroty/abc");
});

/* ── Adres sprawy reklamacyjnej (0.226.1) ───────────────────────────────────
   Wzorzec z 0.222.0 był zgadnięty z analogii do zwrotu i mylił się w OBU
   członach: sprawa ma własną stronę `/claims/{uuid}`, nie wiersz na liście
   z wyszukiwaniem, a adresuje się identyfikatorem zasobu, nie numerem
   czytelnym. Kliknięcie właściciela dawało 404.

   Testy porównują PEŁNY łańcuch, nie wzorzec — dowodzą, że budujemy dokładnie
   ten adres, który u właściciela się otworzył.                              */

const UUID = "067de4cd-015e-4cae-a091-8fb92cb5a558";

/** Podmiana konfiguracji na czas jednego sprawdzenia; `config` to zwykły obiekt. */
function zKonfiguracja<T>(wzorzec: string, sprzedawca: string, f: () => T): T {
  const b = { w: config.allegro.panelReklamacja, s: config.allegro.sellerId };
  config.allegro.panelReklamacja = wzorzec;
  config.allegro.sellerId = sprzedawca;
  try { return f(); } finally {
    config.allegro.panelReklamacja = b.w;
    config.allegro.sellerId = b.s;
  }
}

const CLAIMS = "https://salescenter.allegro.com/claims/{id}";

test("sprawa otwiera się pod własnym adresem, z zakresem konta", () => {
  zKonfiguracja(CLAIMS, "37755893", () => {
    assert.equal(linkReklamacji(UUID),
      `https://salescenter.allegro.com/claims/${UUID}?sellerId=37755893`);
  });
});

test("bez identyfikatora sprzedawcy zostaje sam adres sprawy", () => {
  /* Goły `?sellerId=` na końcu byłby zgadywaniem drugi raz: nie wiemy, jak
     strona sprawy zachowa się przy pustym zakresie konta. */
  zKonfiguracja(CLAIMS, "", () => {
    assert.equal(linkReklamacji(UUID), `https://salescenter.allegro.com/claims/${UUID}`);
  });
});

test("wzorzec z własnym parametrem dokleja przez „&”, nie drugie „?”", () => {
  /* Wpis w `wertis.env` może nieść własne pytanie w adresie — drugi znak
     zapytania rozwaliłby zapytanie po tamtej stronie. */
  zKonfiguracja("https://przyklad/claims/{id}?tab=chat", "7", () => {
    assert.equal(linkReklamacji(UUID), `https://przyklad/claims/${UUID}?tab=chat&sellerId=7`);
  });
});

test("brak sprawy to brak odnośnika, mimo znanego sprzedawcy", () => {
  zKonfiguracja(CLAIMS, "37755893", () => {
    for (const v of [null, undefined, ""]) assert.equal(linkReklamacji(v), null);
  });
});
