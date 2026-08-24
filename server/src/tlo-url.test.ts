import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── TLO_URL z odwrotnymi ukośnikami ─────────────────────────────────────────
   REGRESJA NA WDROŻENIE, KTÓRE POŁOŻYŁO MAGAZYN. W `wertis.env` wpisano
   `TLO_URL=http:\\127.0.0.1:8791`, serwer odmówił startu, a `wertis-api`
   i `wertis-worker` przestały wstawać. Na ekranie było `SERVICE_PAUSED`
   z NSSM — objaw, którego nikt nie kojarzy z ukośnikiem.

   Test sprawdza DWIE rzeczy naraz i obie są istotne:
     1. import `config.ts` NIE RZUCA — czyli serwer wstaje,
     2. adres jest wyprostowany, czyli usługa tła da się naprawdę zawołać.

   Sama bramka zostaje i pilnuje jej test niżej: adres bez schematu nadal
   zatrzymuje start, bo tam nie ma czego prostować.                           */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-tlourl-")), "t.db");
process.env.LOG_LEVEL = "silent";
// dokładnie to, co człowiek wpisał na produkcji
process.env.TLO_URL = "http:\\\\127.0.0.1:8791";

let config: typeof import("./config.js").config;
let prostujUkosniki: typeof import("./config.js").prostujUkosniki;

before(async () => {
  ({ config, prostujUkosniki } = await import("./config.js"));
});

test("odwrotne ukośniki NIE zatrzymują startu serwera", () => {
  /* Gdyby zatrzymywały, `before` rzuciłby przy imporcie i ten test nigdy by
     nie ruszył — samo dojście tutaj jest połową dowodu. */
  assert.ok(config, "konfiguracja wczytała się bez rzucania");
});

test("adres jest wyprostowany, więc usługę tła da się zawołać", () => {
  assert.equal(config.tlo.url, "http://127.0.0.1:8791");
  // to, po co prostujemy: `new URL` na surowej wartości dałoby inny host
  assert.equal(new URL("/tlo", config.tlo.url).href, "http://127.0.0.1:8791/tlo");
});

test("prostowanie rusza WYŁĄCZNIE ukośniki", () => {
  assert.equal(prostujUkosniki("http://127.0.0.1:8791"), "http://127.0.0.1:8791");
  assert.equal(prostujUkosniki(""), "");
  // mieszanka też się prostuje — ręka bywa niekonsekwentna
  assert.equal(prostujUkosniki("http:\\/127.0.0.1"), "http://127.0.0.1");
});
