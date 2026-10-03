import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { modelKlasyfikatora, nadawcaKlasyfikacji } from "./copilot.klasyfikator.js";
import { _ustawKlienta } from "./copilot.anthropic.js";
import { _ustawFetch, MODEL_JEV } from "./copilot.jev.js";
import { config } from "../config.js";
import type { TrescBezpieczna } from "../services/copilot-maskowanie.js";

/* ── Jedno wejście do rozpoznawania ──────────────────────────────────────────
   Trzy drogi rozpoznawania (takt, przebieg przed pracą, kliknięcie) mają iść
   do TEGO SAMEGO dostawcy, a wybiera go sam klucz TypeSafe. Ostatni test
   pilnuje źródeł: powrót jednej trasy do konkretnego nadawcy przeszedłby CI,
   a pomiar zmieszałby dwa klasyfikatory. */

const TRESC = "Czy nóż pasuje?" as TrescBezpieczna;

const kluczJev = config.copilot.kluczJev;
const kluczTs = process.env.TYPESAFE_API_KEY;
afterEach(() => {
  _ustawKlienta(null);
  _ustawFetch(null);
  config.copilot.kluczJev = kluczJev;
  if (kluczTs === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = kluczTs;
});

/** Liczniki wywołań obu dostawców; żaden nie sięga do sieci. */
function dostawcy() {
  const n = { claude: 0, jev: 0 };
  _ustawKlienta({ messages: { parse: async () => { n.claude++; throw new Error("stop"); } } } as unknown as Anthropic);
  _ustawFetch((async () => { n.jev++; throw new Error("stop"); }) as unknown as typeof fetch);
  return n;
}

test("bez klucza TypeSafe rozpoznaje Claude", async () => {
  config.copilot.kluczJev = false;
  const n = dostawcy();
  await nadawcaKlasyfikacji(TRESC).catch(() => null);
  assert.deepEqual(n, { claude: 1, jev: 0 });
  assert.equal(modelKlasyfikatora(), config.copilot.modelKlasyfikacji);
});

test("z kluczem TypeSafe rozpoznaje Jev, a Claude nie dostaje nic", async () => {
  config.copilot.kluczJev = true;
  process.env.TYPESAFE_API_KEY = "tsk-test";
  const n = dostawcy();
  await nadawcaKlasyfikacji(TRESC).catch(() => null);
  assert.deepEqual(n, { claude: 0, jev: 1 });
  assert.equal(modelKlasyfikatora(), MODEL_JEV, "ekran pokazuje model, który naprawdę rozpoznaje");
});

test("konkretnych nadawców rozpoznawania woła się wyłącznie przez wspólne wejście", () => {
  const src = path.resolve(import.meta.dirname, "..");
  const pliki = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? pliki(p) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
  const dozwolone = new Set([
    "adapters/copilot.anthropic.ts", "adapters/copilot.jev.ts", "adapters/copilot.klasyfikator.ts",
  ]);
  const naruszenia = pliki(src)
    .map((p) => path.relative(src, p).split(path.sep).join("/"))
    .filter((p) => !dozwolone.has(p))
    .filter((p) => /\bnadawca(Anthropic|Jev)\b/.test(fs.readFileSync(path.join(src, p), "utf8")));
  assert.deepEqual(naruszenia, [],
    "klasyfikację woła się przez `nadawcaKlasyfikacji`, nie przez konkretnego dostawcę");
});
