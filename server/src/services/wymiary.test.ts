import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Pomiar z formularza i pola własne z konfiguracji ────────────────────────
   Obie funkcje stoją między człowiekiem a UPDATE-em w bazie firmy: pierwsza
   przepuszcza tylko rozsądne liczby, druga tylko pola własne inne niż
   lokalizacja. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wym-")), "t.db");
process.env.LOG_LEVEL = "silent";

let pomiarZCiala: typeof import("./wymiary.js").pomiarZCiala;
let bledyPolWymiarow: typeof import("../config.js").bledyPolWymiarow;

before(async () => {
  ({ pomiarZCiala } = await import("./wymiary.js"));
  ({ bledyPolWymiarow } = await import("../config.js"));
});

test("pomiar przyjmuje przecinek, kropkę i liczby; puste zostawia pole", () => {
  const w = pomiarZCiala({ bruttoKg: "1,25", nettoKg: "1,1", dlugosc: 30, szerokosc: " 20.5 ", wysokosc: "" });
  assert.deepEqual(w, {
    ok: true, pomiar: { bruttoKg: 1.25, nettoKg: 1.1, dlugosc: 30, szerokosc: 20.5, wysokosc: null },
  });
});

test("waga do grama, wymiar do milimetra", () => {
  const w = pomiarZCiala({ nettoKg: "0,12345", dlugosc: "12,349" });
  assert.deepEqual(w, { ok: true, pomiar: { bruttoKg: null, nettoKg: 0.123, dlugosc: 12.3, szerokosc: null, wysokosc: null } });
});

test("śmieci, zero i rząd wielkości za dużo — odmowa ze zdaniem o polu", () => {
  const odmowa = (c: unknown) => {
    const w = pomiarZCiala(c);
    assert.equal(w.ok, false);
    return w.ok ? "" : w.error;
  };
  assert.match(odmowa({ dlugosc: "12cm" }), /^Długość: wpisz liczbę/);
  assert.match(odmowa({ bruttoKg: "-1" }), /^Waga brutto: wpisz liczbę/);
  assert.match(odmowa({ wysokosc: 0 }), /^Wysokość musi być większa od zera/);
  assert.match(odmowa({ szerokosc: "0,04" }), /większa od zera/, "zero po zaokrągleniu to też zero");
  assert.match(odmowa({ nettoKg: 2500 }), /^Waga netto ponad 2000 kg/);
  assert.match(odmowa({ bruttoKg: "0,5", nettoKg: "0,6" }), /netto \(0,6 kg\) większa od brutto \(0,5 kg\)/);
  assert.match(odmowa({ dlugosc: 1200 }), /ponad 1000 cm/);
  assert.match(odmowa({}), /co najmniej jedną/);
  assert.match(odmowa(null), /co najmniej jedną/);
});

const POLA = { poleDlugosc: "tw_Pole4", poleSzerokosc: "tw_Pole5", poleWysokosc: "tw_Pole6" };

test("pola wymiarów: puste to brak funkcji, komplet poprawnych przechodzi", () => {
  assert.deepEqual(bledyPolWymiarow({ poleDlugosc: "", poleSzerokosc: "", poleWysokosc: "" }, "tw_Pole1"), []);
  assert.deepEqual(bledyPolWymiarow(POLA, "tw_Pole1"), []);
});

test("pola wymiarów: niekomplet, obce kolumny, lokalizacja i duplikaty odpadają", () => {
  assert.match(bledyPolWymiarow({ ...POLA, poleWysokosc: "" }, "tw_Pole1").join(), /WYMIARY_POLE_WYSOKOSC/);
  assert.match(bledyPolWymiarow({ ...POLA, poleDlugosc: "tw_Nazwa" }, "tw_Pole1").join(), /tylko pola własne/);
  assert.match(bledyPolWymiarow({ ...POLA, poleDlugosc: "tw_Pole9" }, "tw_Pole1").join(), /tylko pola własne/);
  assert.match(bledyPolWymiarow(POLA, "tw_Pole5").join(), /pole lokalizacji/);
  assert.match(bledyPolWymiarow({ ...POLA, poleWysokosc: "tw_Pole4" }, "tw_Pole1").join(), /trzy różne pola/);
});
