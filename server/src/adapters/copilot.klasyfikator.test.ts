import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { nadawcaKlasyfikacji } from "./copilot.klasyfikator.js";
import { _ustawKlienta } from "./copilot.anthropic.js";
import type { TrescBezpieczna } from "../services/copilot-maskowanie.js";

/* ── Jedno wejście do rozpoznawania ──────────────────────────────────────────
   Trzy drogi rozpoznawania (takt, przebieg przed pracą, kliknięcie) mają iść
   do TEGO SAMEGO dostawcy. Pierwszy test pilnuje, że wejście woła Claude.
   Drugi pilnuje źródeł: powrót jednej trasy do `nadawcaAnthropic` przeszedłby
   CI, a pomiar zmieszałby dwa klasyfikatory, gdy pojawi się drugi dostawca. */

const TRESC = "Czy nóż pasuje?" as TrescBezpieczna;

afterEach(() => {
  _ustawKlienta(null);
});

test("rozpoznanie idzie do Claude", async () => {
  let claude = 0;
  _ustawKlienta({ messages: { parse: async () => { claude++; throw new Error("stop"); } } } as unknown as Anthropic);
  await nadawcaKlasyfikacji(TRESC).catch(() => null);
  assert.equal(claude, 1);
});

test("`nadawcaAnthropic` woła się wyłącznie przez wejście do rozpoznawania", () => {
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
