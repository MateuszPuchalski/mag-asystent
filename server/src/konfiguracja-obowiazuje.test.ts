import { test } from "node:test";
import assert from "node:assert/strict";
import { config, type Config } from "./config.js";
import { KLUCZE } from "./konfiguracja-rejestr.js";
import { OBOWIAZUJE, wartoscObowiazujaca } from "./konfiguracja-obowiazuje.js";
import { stanKonfiguracji } from "./services/konfiguracja.js";

/* Wartość obowiązująca jest warta tyle, ile jej pokrycie. Decyzja właściciela
   bez wpisu wróciłaby w panelu do „domyślna" bez liczby — dokładnie ten stan,
   który to wydanie usuwa. Wpis przy sekrecie wyniósłby hasło z pliku. */

const czytaSerwer = (k: (typeof KLUCZE)[number]) => (k.czyta ?? ["serwer"]).includes("serwer");

test("każda decyzja właściciela czytana przez serwer ma wartość obowiązującą", () => {
  const brak = KLUCZE.filter((k) => k.kto === "wlasciciel" && !k.tajny && czytaSerwer(k) && !OBOWIAZUJE[k.klucz])
    .map((k) => k.klucz);
  assert.deepEqual(brak, [], "dopisz te klucze do OBOWIAZUJE w konfiguracja-obowiazuje.ts");
});

test("wpisy tylko przy jawnych kluczach z rejestru", () => {
  for (const klucz of Object.keys(OBOWIAZUJE)) {
    const k = KLUCZE.find((x) => x.klucz === klucz);
    assert.ok(k, `${klucz}: nie ma go w rejestrze`);
    assert.notEqual(k.tajny, true, `${klucz}: sekret nie może mieć wartości obowiązującej`);
  }
});

test("kształt jak w pliku: przełącznik 0/1, lista po przecinku, brak progu pusty", () => {
  const c = {
    ...config,
    copilot: { ...config.copilot, autoSzkic: true, szkicPoRozpoznaniu: false },
    mssql: { ...config.mssql, dokTypyDostaw: [1, 10] },
    allegro: { ...config.allegro, reklamacjeOd: null, zwrotTerminDni: 9 },
  } as Config;
  assert.equal(wartoscObowiazujaca("COPILOT_AUTO_SZKIC", c), "1");
  assert.equal(wartoscObowiazujaca("COPILOT_SZKIC_PO_ROZPOZNANIU", c), "0");
  assert.equal(wartoscObowiazujaca("DOK_TYPY_DOSTAW", c), "1,10");
  assert.equal(wartoscObowiazujaca("REKLAMACJE_OD", c), "");
  assert.equal(wartoscObowiazujaca("ZWROT_TERMIN_DNI", c), "9");
  assert.equal(wartoscObowiazujaca("MSSQL_SERVER", c), null);
});

test("stan konfiguracji niesie obowiązującą przy domyślnej, bez niej przy sekrecie", () => {
  const c = { ...config, allegro: { ...config.allegro, zwrotTerminDni: 11 } } as Config;
  const s = stanKonfiguracji({ path: "C:\\wertis\\wertis.env", applied: [], overridden: [] } as never, {}, c);
  const w = (klucz: string) => s.wiersze.find((x) => x.klucz === klucz)!;
  assert.deepEqual([w("ZWROT_TERMIN_DNI").zrodlo, w("ZWROT_TERMIN_DNI").wartosc, w("ZWROT_TERMIN_DNI").obowiazuje],
    ["domyslna", null, "11"]);
  assert.equal(w("ZWROT_TERMIN_DNI").nazwa, "Termin na zwrot");
  assert.equal(w("ANTHROPIC_API_KEY").obowiazuje, null);
  assert.equal(w("MSSQL_SYNC_MS").nazwa, null);
  /* Przykryty klucz traci edycję, ale nie rodzaj — data zostaje datą. */
  const p = stanKonfiguracji({ path: "C:\\wertis\\wertis.env", applied: [], overridden: ["REKLAMACJE_OD"] } as never,
    { REKLAMACJE_OD: "2026-07-01T00:00:00Z" }, c);
  const r = p.wiersze.find((x) => x.klucz === "REKLAMACJE_OD")!;
  assert.deepEqual([r.zrodlo, r.edycja, r.rodzaj], ["przykryte", null, "data"]);
});
