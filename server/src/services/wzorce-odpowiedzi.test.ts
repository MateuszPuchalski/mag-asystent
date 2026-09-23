import { test } from "node:test";
import assert from "node:assert/strict";
import { KATEGORIE } from "./klasyfikacja-slownik.js";
import { WZORCE_ODPOWIEDZI, wzorzecOdpowiedzi } from "./wzorce-odpowiedzi.js";

/* ── Wzorzec odpowiedzi dla kategorii (23 września 2026) ─────────────────────
   Pilnujemy trzech rzeczy. Każda kategoria słownika ma wzorzec. Wzorzec przy
   sprawach, które rozstrzyga człowiek, mówi „nie obiecuj". Kategoria spoza
   słownika nie dostaje wzorca zgadniętego. */

test("każda z piętnastu kategorii ma niepusty wzorzec", () => {
  assert.equal(KATEGORIE.length, 15);
  for (const k of KATEGORIE) assert.ok(wzorzecOdpowiedzi(k)?.trim(), k);
});

test("sprawy rozstrzygane przez człowieka mają w wzorcu zakaz obietnicy", () => {
  for (const k of ["DELIVERY_LOST", "DELIVERY_DAMAGED", "WRONG_PRODUCT", "MISSING_PRODUCT",
    "DAMAGED_PRODUCT", "COMPLAINT", "CANCEL_ORDER", "INVOICE"] as const) {
    assert.match(WZORCE_ODPOWIEDZI[k], /nie obiecuj|nie uznawaj|nie potwierdzaj/, k);
  }
});

test("pytanie o paczkę nie każe pytać o maszynę; spoza słownika nie ma wzorca", () => {
  assert.match(WZORCE_ODPOWIEDZI.ORDER_STATUS, /o maszynę ani część nie pytaj/);
  assert.equal(wzorzecOdpowiedzi("dobor"), null);
  assert.equal(wzorzecOdpowiedzi("toString"), null);
});
