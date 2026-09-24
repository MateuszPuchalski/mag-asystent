import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { KLUCZE, problemNieznanychKluczy, type Program } from "./konfiguracja-rejestr.js";

/* Rejestr kluczy jest wart tyle, ile jego zgodność z kodem. Ten test czyta
   źródła wszystkich trzech programów i porównuje w OBIE strony: klucz czytany
   bez wpisu w rejestrze panel pokazałby jako literówkę, a wpis bez czytelnika
   udawałby ustawienie, które niczego nie zmienia. */

const KORZEN = path.resolve(import.meta.dirname, "../..");

function pliki(katalog: string, rozszerzenie: string): string[] {
  return fs.readdirSync(katalog, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(katalog, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "bin" || e.name === "obj" ? [] : pliki(p, rozszerzenie);
    return e.name.endsWith(rozszerzenie) && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

function czytaneW(katalog: string, rozszerzenie: string, wzorce: RegExp[]): Set<string> {
  const out = new Set<string>();
  for (const p of pliki(path.join(KORZEN, katalog), rozszerzenie)) {
    const zrodlo = fs.readFileSync(p, "utf8");
    for (const w of wzorce) for (const m of zrodlo.matchAll(w)) out.add(m[1]!);
  }
  return out;
}

/* C# czyta przez `env.Get("X")`, `_env.GetInt("X", …)` i — tylko ścieżkę
   pliku — przez `GetEnvironmentVariable("X")`. */
const WZORCE_CS = [/_?env\.Get(?:Int)?\("([A-Z][A-Z0-9_]*)"/g, /GetEnvironmentVariable\("([A-Z][A-Z0-9_]*)"\)/g];

const CZYTANE: Record<Program, Set<string>> = {
  serwer: czytaneW("server/src", ".ts", [/process\.env\.([A-Z][A-Z0-9_]*)/g]),
  sfera: czytaneW("sfera-worker/src", ".cs", WZORCE_CS),
  tlo: czytaneW("tlo-worker/src", ".cs", WZORCE_CS),
};

for (const program of ["serwer", "sfera", "tlo"] as const) {
  test(`rejestr zgadza się z kodem programu: ${program}`, () => {
    const wRejestrze = new Set(KLUCZE.filter((k) => (k.czyta ?? ["serwer"]).includes(program)).map((k) => k.klucz));
    const bezWpisu = [...CZYTANE[program]].filter((k) => !wRejestrze.has(k)).sort();
    const bezCzytelnika = [...wRejestrze].filter((k) => !CZYTANE[program].has(k)).sort();
    assert.ok(CZYTANE[program].size > 0, `nie znalazłem ani jednego klucza w źródłach: ${program}`);
    assert.deepEqual(bezWpisu, [], "dopisz te klucze do KLUCZE w konfiguracja-rejestr.ts");
    assert.deepEqual(bezCzytelnika, [], "te wpisy mają w `czyta` program, który ich nie czyta");
  });
}

test("każdy klucz raz, z opisem jednym zdaniem", () => {
  const nazwy = KLUCZE.map((k) => k.klucz);
  assert.equal(new Set(nazwy).size, nazwy.length, "klucz powtórzony w rejestrze");
  for (const k of KLUCZE) {
    assert.match(k.opis, /\.$/, `${k.klucz}: opis ma być zdaniem`);
    assert.ok(k.opis.length <= 120, `${k.klucz}: opis dłuższy niż wiersz panelu`);
  }
});

test("sekrety są oznaczone — nazwa z HASLO, PASSWORD, SECRET albo KEY", () => {
  /* Nowy klucz z hasłem bez `tajny` poszedłby do panelu jawnie. Ten test nie
     zna wszystkich przyszłych nazw, ale łapie te, które już się powtarzają. */
  for (const k of KLUCZE) {
    if (/HASLO|PASSWORD|SECRET|_KEY$/.test(k.klucz)) assert.equal(k.tajny, true, `${k.klucz} bez tajny`);
  }
});

test("klucz spoza rejestru zgłasza się jako literówka, znany milczy", () => {
  assert.equal(problemNieznanychKluczy(["SGT_MODE", "MSSQL_SERVER"], "C:\\wertis\\wertis.env"), null);
  const z = problemNieznanychKluczy(["SGT_MODE", "ALEGRO_CLIENT_ID"], "C:\\wertis\\wertis.env");
  assert.ok(z?.includes("ALEGRO_CLIENT_ID"), String(z));
  assert.ok(z?.includes("literówka"), String(z));
});
