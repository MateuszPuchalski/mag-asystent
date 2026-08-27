import { test } from "node:test";
import assert from "node:assert/strict";
import { nastepnyOdstep } from "./takt.js";
import { BladLimituAllegro, retryAfterMs } from "../adapters/allegro.js";

/* ── Takt tickerów — arytmetyka rytmu, bez zegara ────────────────────────────
   Sedno: odstęp nigdy nie jest równy bazie co do milisekundy (rozrzut ±10%
   zdejmuje sygnaturę maszyny), a po 429 nigdy nie jest krótszy, niż prosi
   Allegro. Sam planer (`uruchomTakt`) to setTimeout wokół tej funkcji —
   testujemy arytmetykę, nie zegar.                                           */

test("odstęp trzyma się przedziału ±10% wokół bazy", () => {
  const baza = 300_000;
  assert.equal(nastepnyOdstep(baza, 0), 270_000, "los=0 → dolna krawędź 0.9×");
  assert.equal(nastepnyOdstep(baza, 0.5), 300_000, "środek losowania = dokładnie baza");
  assert.ok(nastepnyOdstep(baza, 0.999) <= 330_000, "górna krawędź nie przekracza 1.1×");
  // baza ujemna nie produkuje ujemnego odstępu
  assert.equal(nastepnyOdstep(-5, 0.5), 0);
});

test("po 429 odstęp nie jest krótszy, niż prosi Allegro", () => {
  const baza = 60_000;
  assert.equal(
    nastepnyOdstep(baza, 0.5, 180_000),
    180_000,
    "Retry-After dłuższy od bazy wygrywa"
  );
  assert.equal(
    nastepnyOdstep(baza, 0.5, 10_000),
    60_000,
    "Retry-After krótszy od bazy nie skraca rytmu"
  );
});

test("Retry-After: sekundy, data HTTP, śmieci", () => {
  const teraz = Date.parse("2026-08-26T12:00:00Z");
  assert.equal(retryAfterMs("120", teraz), 120_000, "liczba = sekundy");
  assert.equal(retryAfterMs("0", teraz), 0);
  assert.equal(
    retryAfterMs("Wed, 26 Aug 2026 12:05:00 GMT", teraz),
    300_000,
    "data HTTP = różnica do teraz"
  );
  assert.equal(retryAfterMs("Wed, 26 Aug 2026 11:00:00 GMT", teraz), null, "przeszłość = nie wiem");
  assert.equal(retryAfterMs("za chwilę", teraz), null, "śmieci = nie wiem, nie zero");
  assert.equal(retryAfterMs(null, teraz), null);
});

test("BladLimituAllegro niesie czas z nagłówka dla taktu", () => {
  const e = new BladLimituAllegro("Allegro prosi o przerwę (429)", 90_000);
  assert.ok(e instanceof Error);
  assert.equal(e.poIluMs, 90_000);
  assert.equal(new BladLimituAllegro("bez nagłówka", null).poIluMs, null);
});
