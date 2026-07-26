import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyScan, matchesLocPattern, normalizeLoc, locRulesVersion } from "./scan.js";

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

test("wersja reguły jest stabilna i krótka", () => {
  assert.match(locRulesVersion, /^[0-9a-f]{8}$/);
  assert.equal(locRulesVersion, locRulesVersion);
});
