import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUSY_KONCOWE, sprawaOtwarta } from "./statusy-spraw.js";

/* ── Statusy końcowe sprawy — jedna lista dla całego repo ────────────────────
   Plik jest mały, a decyzja w nim duża: co robimy ze statusem, którego NIE
   ZNAMY. Bez tego testu regresja byłaby cicha — sprawa z biegnącym zegarem
   zeszłaby z kolejki, bo Allegro dorzuciło wartość spoza naszej listy.     */

test("status nieznany zostaje OTWARTY — nowy schemat Allegro to nie koniec sprawy", () => {
  assert.equal(sprawaOtwarta("NOWY_STATUS_ALLEGRO"), true);
  /* `null` znaczy „Allegro jeszcze nic nie powiedziało", a nie „załatwione". */
  assert.equal(sprawaOtwarta(null), true);
});

test("trzy statusy końcowe zamykają sprawę, bez względu na wielkość liter", () => {
  for (const s of STATUSY_KONCOWE) assert.equal(sprawaOtwarta(s), false, s);
  assert.equal(sprawaOtwarta("claim_accepted"), false);
});

test("lista niesie DISPUTE_CLOSED, bo enum Allegro jest jeden dla obu spraw", () => {
  /* Dyskusja i reklamacja dzielą `PostPurchaseIssueStatus`. Lista o CZEKANIU
     NA RUCH musi znać oba końce; węższa lista potwierdzeń werdyktu stoi
     osobno w `reklamacje.ts` i te dwie rzeczy nie mają prawa się zlać. */
  assert.deepEqual([...STATUSY_KONCOWE].sort(),
    ["CLAIM_ACCEPTED", "CLAIM_REJECTED", "DISPUTE_CLOSED"]);
});
