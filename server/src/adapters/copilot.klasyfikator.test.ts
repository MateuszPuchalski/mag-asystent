import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { nadawcaKlasyfikacji } from "./copilot.klasyfikator.js";
import { _ustawKlienta } from "./copilot.anthropic.js";
import { _ustawFetch } from "./copilot.jev.js";
import { config } from "../config.js";
import type { TrescBezpieczna } from "../services/copilot-maskowanie.js";

/* ── Wybór dostawcy klasyfikacji ─────────────────────────────────────────────
   Trzy drogi rozpoznawania (takt, przebieg przed pracą, kliknięcie) mają iść
   do TEGO SAMEGO dostawcy. Pierwszy test pilnuje gałęzi `anthropic`, którą
   test Jeva pomija. Drugi pilnuje źródeł: powrót jednej trasy do
   `nadawcaAnthropic` przeszedłby CI, a pomiar zmieszałby dwa klasyfikatory. */

const TRESC = "Czy nóż pasuje?" as TrescBezpieczna;
const klasyfikator = config.copilot.klasyfikator;

afterEach(() => {
  config.copilot.klasyfikator = klasyfikator;
  _ustawKlienta(null);
  _ustawFetch(null);
});

test("przy `anthropic` rozpoznanie idzie do Claude i ani razu do TypeSafe", async () => {
  let claude = 0;
  let typesafe = 0;
  _ustawKlienta({ messages: { parse: async () => { claude++; throw new Error("stop"); } } } as unknown as Anthropic);
  _ustawFetch((async () => { typesafe++; return new Response("{}"); }) as unknown as typeof fetch);
  config.copilot.klasyfikator = "anthropic";

  await nadawcaKlasyfikacji(TRESC).catch(() => null);
  assert.equal(claude, 1);
  assert.equal(typesafe, 0, "wątek nie ma prawa pójść do drugiego podmiotu, gdy wybrano Claude");
});

test("`nadawcaAnthropic` woła się wyłącznie przez wybór dostawcy", () => {
  const src = path.resolve(import.meta.dirname, "..");
  const pliki = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? pliki(p) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
  const dozwolone = new Set(["adapters/copilot.anthropic.ts", "adapters/copilot.klasyfikator.ts"]);
  const naruszenia = pliki(src)
    .map((p) => path.relative(src, p).split(path.sep).join("/"))
    .filter((p) => !dozwolone.has(p))
    .filter((p) => /\bnadawcaAnthropic\b/.test(fs.readFileSync(path.join(src, p), "utf8")));
  assert.deepEqual(naruszenia, [],
    "klasyfikację woła się przez `nadawcaKlasyfikacji`, nie przez konkretnego dostawcę");
});
