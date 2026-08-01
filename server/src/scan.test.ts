import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyScan, matchesLocPattern, normalizeLoc } from "./scan.js";
import { config } from "./config.js";

/* Klasyfikator jest jedynym miejscem, w którym system decyduje, CZYM jest
   zeskanowany kod. Pomyłka tutaj nie kończy się komunikatem — kończy się
   zapisem widmowej lokalizacji o nazwie symbolu towaru. Stąd tabela, a nie
   kilka luźnych asercji: każdy realny kształt kodu z magazynu ma tu wiersz.  */

const TABELA: Array<[string, "LOC" | "EAN" | "TEXT", string]> = [
  // regały — jedyny kształt, który JEST lokalizacją
  ["A01-02-03", "LOC", "regał, wzorzec podstawowy"],
  ["J14-05-02", "LOC", "regał, ostatnia alejka"],
  ["a01-02-03", "LOC", "małe litery — normalizowane"],
  ["  A01-02-03  ", "LOC", "spacje z wedge'a obcinane"],
  ["PAL-042", "LOC", "miejsce paletowe"],
  ["LOC:A01-02-03", "LOC", "prefiks z QR rozstrzyga"],

  // symbole towarów — TO jest błąd, który ta zmiana naprawia
  ["w32-0203", "TEXT", "symbol z literą i myślnikiem"],
  ["W32-0203", "TEXT", "ten sam symbol wielkimi literami"],
  ["50-111", "TEXT", "symbol bez litery"],
  ["W43-2002-1M", "TEXT", "symbol z dwoma myślnikami, ale nie w kształcie regału"],

  // kody kreskowe
  ["5901234567890", "EAN", "EAN-13"],
  ["59012345", "EAN", "EAN-8"],

  // kształty bliskie regałowi, ale niepoprawne — muszą wypaść z LOC
  ["A1-2-3", "TEXT", "za mało cyfr w segmentach"],
  ["A01-02-03X", "TEXT", "ogon po wzorcu"],
  ["C07A-06-01", "TEXT", "literówka z kartoteki (znany dług danych)"],
  ["", "TEXT", "pusty skan"],
];

for (const [kod, oczekiwany, po] of TABELA) {
  test(`classifyScan("${kod}") → ${oczekiwany} — ${po}`, () => {
    assert.equal(classifyScan(kod).kind, oczekiwany);
  });
}

test("LOC jest kategorią ZAMKNIĘTĄ, nie domyślną", () => {
  // istota poprawki: kod nieznanego kształtu NIE staje się lokalizacją
  for (const dziwny of ["ABC", "X", "TOWAR/2026", "@#$", "A01_02_03"]) {
    assert.equal(classifyScan(dziwny).kind, "TEXT", dziwny);
  }
});

test("prefiks i wzorzec dają ten sam znormalizowany kod", () => {
  assert.equal(classifyScan("LOC:a01-02-03").code, "A01-02-03");
  assert.equal(classifyScan("a01-02-03").code, "A01-02-03");
});

test("normalizeLoc obcina prefiks i podnosi wielkość liter", () => {
  assert.equal(normalizeLoc(" loc:a01-02-03 "), "A01-02-03");
  assert.equal(normalizeLoc("A01-02-03"), "A01-02-03");
});

test("matchesLocPattern nie pyta o słownik — tylko o kształt", () => {
  // pusty regał nie występuje w kartotece, a mimo to jest poprawnym adresem
  assert.equal(matchesLocPattern("Z99-99-99"), true);
  assert.equal(matchesLocPattern("W32-0203"), false);
});

/* ── Strażnik audytu kolizji kodów (plan §2) ────────────────────────────────
   Cały klasyfikator stoi na jednym założeniu: ŻADEN symbol towaru ani kod
   kreskowy nie ma kształtu adresu. Audyt z 2026-07-26 potwierdził je na pełnej
   kartotece (3415 pozycji, zero trafień) — ale jednorazowe zapytanie chroni
   przez jeden dzień.

   Ten test chroni zawsze: wywali się w chwili, gdy ktoś założy kartotekę
   o symbolu w kształcie regału. Margines jest cienki — najbliżej stoi rodzina
   akumulatorów `B20-40-S` (8 znaków; wzorzec wymaga 9), więc wariant nazwany
   `B20-40-01` byłby już kolizją.                                             */

/** Ta sama kartoteka, z której powstaje seed — plik jest w repo. */
function kartoteka(): string[][] {
  return JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
}

const SYMBOL = 0;
const EAN = 2;

test("żaden symbol ani kod kreskowy w kartotece nie ma kształtu adresu", () => {
  const rows = kartoteka();
  // brak danych to NIE jest wynik „zero kolizji" — strażnik bez danych milczy
  assert.ok(rows.length > 3000, `kartoteka wygląda na niekompletną: ${rows.length} pozycji`);

  const kolizje = rows
    .flatMap((r) => [r[SYMBOL], r[EAN]])
    .filter((v) => v && matchesLocPattern(String(v).trim().toUpperCase()));

  assert.deepEqual(kolizje, [], `kod o kształcie adresu w kartotece: ${kolizje.join(", ")}`);
});

test("strażnik faktycznie wykrywa kolizję, a nie tylko przechodzi", () => {
  // Bez tej asercji zepsuty strażnik jest zielony i wygląda jak dowód —
  // czyli dokładnie ta klasa cichej awarii, którą audyt miał wykluczyć.
  const podstawione = [
    ["B20-40-01", "Akumulator 20V — hipotetyczny wariant", "5901234567890"],
    ["W32-0203", "Symbol, który kolizją nie jest", "5901234567891"],
  ];
  const kolizje = podstawione
    .flatMap((r) => [r[SYMBOL], r[EAN]])
    .filter((v) => v && matchesLocPattern(String(v).trim().toUpperCase()));

  assert.deepEqual(kolizje, ["B20-40-01"]);
});
