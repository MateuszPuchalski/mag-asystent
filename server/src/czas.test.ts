import { test, before } from "node:test";
import assert from "node:assert/strict";

/* ── Czas do pokazania człowiekowi ───────────────────────────────────────────
   POWSTAŁO PO ZGŁOSZENIU „logi są dwie godziny do tyłu". Znaczniki są w bazie
   w UTC i tak mają zostać; błąd polegał na pokazywaniu ich przez odcięcie
   znaków z ciągu ISO, czyli godziny z Greenwich przy zegarze wskazującym czas
   polski.

   Testy są jawne co do strefy, bo inaczej mierzyłyby ustawienie maszyny CI,
   a nie regułę.                                                               */

process.env.STREFA_CZASU = "Europe/Warsaw";

let C: typeof import("./czas.js");

before(async () => {
  C = await import("./czas.js");
});

test("lato: UTC+2", () => {
  assert.equal(C.czasLokalny("2026-07-28T09:14:03.000Z"), "11:14");
});

test("zima: UTC+1 — przesunięcie nie jest stałą", () => {
  assert.equal(C.czasLokalny("2026-01-28T09:14:03.000Z"), "10:14");
});

test("koniec doby UTC to już następny dzień lokalnie", () => {
  // wpis o 01:30 czasu polskiego ma w bazie 23:30 UTC dnia POPRZEDNIEGO —
  // i to on pokazywał się z wczorajszą datą
  assert.equal(C.dataLokalna("2026-07-28T23:30:00.000Z"), "2026-07-29");
  assert.equal(C.czasLokalny("2026-07-28T23:30:00.000Z"), "01:30");
});

test("pełny stempel łączy datę i czas lokalny", () => {
  assert.equal(C.stempelLokalny("2026-07-28T09:14:03.000Z"), "2026-07-28 11:14:03");
});

test("popsuty znacznik wraca NIEZMIENIONY, nie jako Invalid Date", () => {
  // wiersz kolejki ma dalej nieść etykietę i status — to one odpowiadają
  // na pytanie magazyniera, godzina jest dodatkiem
  assert.equal(C.czasLokalny("bez sensu"), "bez sensu");
  assert.equal(C.dataLokalna(""), "");
  assert.equal(C.stempelLokalny("2026-13-45"), "2026-13-45");
});
