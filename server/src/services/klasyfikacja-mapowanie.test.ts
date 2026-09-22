import { test } from "node:test";
import assert from "node:assert/strict";
import { mapujStrukture } from "./klasyfikacja-mapowanie.js";

/* ── Rejestr mapowań: trzy reguły z tabeli specyfikacji ─────────────────────
   COMMON nic nie mówi; podtyp opisuje wątek, więc rozstrzyga tylko pierwszą
   wiadomość; wartość nieznana zostaje i dostaje kod — nigdy nie jest
   dopasowana po cichu (AC2). */

const st = (typ: string | null, podtyp: string | null = null, zZamowieniem = true) =>
  ({ typ, podtyp, zZamowieniem });

test("COMMON i brak struktury nie dają ani wskazówki, ani kodu", () => {
  for (const w of [mapujStrukture(st("COMMON"), true), mapujStrukture(st(null), true),
    mapujStrukture(st("POST_PURCHASE_ISSUE", "OTHER"), true)]) {
    assert.equal(w.waska, null);
    assert.equal(w.wskazowka, null);
    assert.deepEqual(w.kody, []);
  }
});

test("wąski podtyp rozstrzyga PIERWSZĄ wiadomość bez modelu", () => {
  const w = mapujStrukture(st("POST_PURCHASE_ISSUE", "MISSING_PRODUCT_ELEMENTS"), true);
  assert.equal(w.waska?.zrodlo, "ALLEGRO_MAPPING");
  assert.equal(w.waska?.kategoria, "MISSING_PRODUCT");
  assert.equal(w.waska?.akcja, "GET_ORDER");
  assert.equal(w.waska?.pewnosc, null, "mapowanie nie ma pewności modelu — NULL, nie syntetyczna liczba");
  assert.equal(w.waska?.kategoriaModelu, null);
  assert.equal(w.waska?.brakDanychZamowienia, false);
});

test("dopisek w wątku z wąskim podtypem NIE jest przyklejany do kategorii wątku", () => {
  const w = mapujStrukture(st("POST_PURCHASE_ISSUE", "MISSING_PRODUCT_ELEMENTS"), false);
  assert.equal(w.waska, null);
  assert.equal(w.wskazowka, null, "„dziękuję, doszło” nie może wejść w spór z podtypem");
});

test("spór o zwrot zawsze woła człowieka", () => {
  const w = mapujStrukture(st("POST_PURCHASE_ISSUE", "SELLER_DOES_NOT_WANT_TO_ACCEPT_RETURN"), true);
  assert.equal(w.waska?.wymagaCzlowieka, true);
  assert.equal(w.waska?.akcja, "HUMAN_REVIEW");
});

test("szeroki podtyp to tylko wskazówka z listą zgodnych kategorii", () => {
  const w = mapujStrukture(st("POST_PURCHASE_ISSUE", "PRODUCT_INCONSISTENT_WITH_THE_OFFER"), true);
  assert.equal(w.waska, null);
  assert.equal(w.wskazowka?.kategoria, "WRONG_PRODUCT");
  assert.ok(w.wskazowka?.zgodne.includes("PRODUCT_COMPATIBILITY"),
    "część zgodna z zamówieniem, która nie pasuje, to doprecyzowanie, nie spór");
});

test("wartość nieznana zostaje nazwana i idzie do przeglądu", () => {
  const p = mapujStrukture(st("POST_PURCHASE_ISSUE", "NOWY_2027"), true);
  assert.deepEqual(p.kody, ["PODTYP_NIEZNANY"]);
  assert.equal(p.nieznane, "subType=NOWY_2027");
  assert.equal(p.waska, null);
  const t = mapujStrukture(st("PRE_PURCHASE"), true);
  assert.deepEqual(t.kody, ["TYP_NIEZNANY"]);
});

test("brak zamówienia w wątku zapala flagę zachowawczo", () => {
  const w = mapujStrukture(st("POST_PURCHASE_ISSUE", "NO_REFUND", false), true);
  assert.equal(w.waska?.brakDanychZamowienia, true);
});
