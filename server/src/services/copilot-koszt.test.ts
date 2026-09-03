import { test } from "node:test";
import assert from "node:assert/strict";
import { kosztUsd, znanyModel } from "./copilot-koszt.js";

/* Cennik zmienia się bez pytania nas o zdanie, więc testy pilnują REGUŁ
   przeliczania, nie konkretnych stawek — poza jedną kotwicą, żeby literówka
   w cenniku nie przeszła niezauważona. */

test("wejście i wyjście liczą się po swoich stawkach", () => {
  /* Milion tokenów wejścia Opusa 5 to 5 $, milion wyjścia — 25 $. */
  assert.equal(kosztUsd("claude-opus-5", { wej: 1_000_000, wyj: 0, cacheZapis: 0, cacheOdczyt: 0 }), 5);
  assert.equal(kosztUsd("claude-opus-5", { wej: 0, wyj: 1_000_000, cacheZapis: 0, cacheOdczyt: 0 }), 25);
});

test("odczyt z cache jest tańszy od świeżego wejścia, zapis droższy", () => {
  const swieze = kosztUsd("claude-opus-5", { wej: 100_000, wyj: 0, cacheZapis: 0, cacheOdczyt: 0 });
  const zCache = kosztUsd("claude-opus-5", { wej: 0, wyj: 0, cacheZapis: 0, cacheOdczyt: 100_000 });
  const zapis = kosztUsd("claude-opus-5", { wej: 0, wyj: 0, cacheZapis: 100_000, cacheOdczyt: 0 });
  assert.ok(zCache < swieze, "odczyt z cache ma być tańszy — inaczej cache nie ma sensu");
  assert.ok(zapis > swieze, "zapis do cache kosztuje więcej niż zwykłe wejście");
});

/* Zero na ekranie kosztów wygląda jak „nic nie wydaliśmy", a znaczyłoby
   „nie znam tego modelu". Nieznany liczy się po najdroższej znanej stawce. */
test("model spoza cennika nie jest darmowy", () => {
  const nieznany = kosztUsd("claude-cos-nowego", { wej: 1_000_000, wyj: 0, cacheZapis: 0, cacheOdczyt: 0 });
  assert.ok(nieznany > 0);
  assert.equal(znanyModel("claude-cos-nowego"), false);
  assert.equal(znanyModel("claude-opus-5"), true);
});

test("jedna klasyfikacja kosztuje ułamek centa, a nie zero", () => {
  /* Typowe wywołanie: ~1000 tokenów wejścia, ~300 wyjścia. Gdyby zaokrąglać
     do centa, każde pojedyncze wywołanie pokazywałoby zero i pomiar nie
     miałby czego sumować. */
  const jedno = kosztUsd("claude-opus-5", { wej: 1000, wyj: 300, cacheZapis: 0, cacheOdczyt: 0 });
  assert.ok(jedno > 0, "pojedyncze wywołanie nie ma prawa zaokrąglić się do zera");
  assert.ok(jedno < 0.05, `jedno wywołanie ma kosztować grosze, a kosztuje ${jedno}`);
});
