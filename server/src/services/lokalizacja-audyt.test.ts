import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Ślad audytowy zmiany pola lokalizacji ──────────────────────────────────
   Pole `tw_Pole1..8` w Subiekcie zmieniają TRZY ścieżki: karta towaru,
   rozkładanie linii dostawy i zamknięcie koszyka. Do sierpnia 2026 zdarzenie
   emitowała wyłącznie pierwsza, więc:

   - zmiana z rozkładania nie pojawiała się w historii na karcie WCALE,
   - żadna ścieżka nie zapisywała zawartości pola SPRZED zmiany, czyli tego,
     co trzeba znać, żeby zmianę cofnąć.

   Emisja siedzi teraz w `enqueueSetLocation`, przez które przechodzą wszystkie
   trzy. Te testy pilnują obu stron tej zmiany: że wpis powstaje wszędzie ORAZ
   że powstaje DOKŁADNIE RAZ.                                                 */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-lokaudyt-")), "t.db");
process.env.LOG_LEVEL = "silent";

let db: typeof import("../db/db.js").db;
let enqueueSetLocation: typeof import("./queue.js").enqueueSetLocation;
let productHistory: typeof import("./events.js").productHistory;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ enqueueSetLocation } = await import("./queue.js"));
  ({ productHistory } = await import("./events.js"));
});

beforeEach(() => {
  for (const t of ["events", "sfera_queue"]) db().prepare(`DELETE FROM ${t}`).run();
});

/** Zdarzenia lokalizacji dla towaru, od najnowszego. */
function wpisy(twId: number) {
  return (
    db()
      .prepare(
        `SELECT type, payload FROM events
         WHERE tw_id = ? AND type IN ('location_set','location_removed') ORDER BY id DESC`
      )
      .all(twId) as Array<{ type: string; payload: string }>
  ).map((r) => ({ type: r.type, p: JSON.parse(r.payload) as Record<string, unknown> }));
}

const baza = (twId: number) => ({
  createdBy: "Anna Testowa",
  twId,
  label: "Lokalizacja · TEST",
  detail: "test",
});

// ── Wartość sprzed zmiany ───────────────────────────────────────────────────

test("zapis z karty niesie starą ORAZ nową zawartość pola", () => {
  enqueueSetLocation(701, "B05-01-02 A01-02-03", baza(701), {
    locsPrzed: "A01-02-03",
    zrodlo: "karta",
    akcja: "add",
    wartosc: "B05-01-02",
  });
  const w = wpisy(701);
  assert.equal(w.length, 1);
  assert.equal(w[0].p.locsPrzed, "A01-02-03");
  assert.equal(w[0].p.result, "B05-01-02 A01-02-03");
  assert.notEqual(w[0].p.locsPrzed, w[0].p.result, "przed i po nie mogą być tym samym");
});

test("wartość sprzed zmiany idzie SUROWA, bez normalizacji", () => {
  /* Sedno całej zmiany. Wycofanie polega na wpisaniu z powrotem dokładnie tego,
     co w polu stało — łącznie z podwójną spacją, którą ktoś tam kiedyś wklepał.
     Wartość przepuszczona przez `parseLocs` byłaby rekonstrukcją i cofnęłaby
     coś innego, niż było. */
  const brzydkie = "A01-02-03  B05-01-02";
  enqueueSetLocation(702, "C09-01-01", baza(702), { locsPrzed: brzydkie, zrodlo: "karta" });
  assert.equal(wpisy(702)[0].p.locsPrzed, brzydkie);
});

test("puste pole daje pusty łańcuch, nie brak pola", () => {
  // `undefined` znika z JSON-a i wpis przestaje odpowiadać na pytanie „co było"
  enqueueSetLocation(703, "A01-02-03", baza(703), { locsPrzed: "", zrodlo: "karta" });
  const p = wpisy(703)[0].p;
  assert.equal(p.locsPrzed, "");
  assert.ok("locsPrzed" in p, "klucz MUSI być obecny nawet przy pustej wartości");
});

// ── Wszystkie trzy ścieżki, każda raz ───────────────────────────────────────

test("rozkładanie dostawy zostawia ślad — dawniej nie zostawiało żadnego", () => {
  enqueueSetLocation(704, "D02-01-01", baza(704), {
    locsPrzed: "A01-02-03",
    zrodlo: "dostawa",
  });
  const w = wpisy(704);
  assert.equal(w.length, 1);
  assert.equal(w[0].p.zrodlo, "dostawa");
});

test("koszyk zostawia ślad z własnym źródłem", () => {
  enqueueSetLocation(705, "E08-03-01", baza(705), { locsPrzed: "", zrodlo: "koszyk" });
  assert.equal(wpisy(705)[0].p.zrodlo, "koszyk");
});

test("jedno zakolejkowanie to DOKŁADNIE JEDEN wpis", () => {
  /* Osobna asercja od tych o treści, bo łapie inny błąd: zapomniane usunięcie
     `logEvent` z trasy karty. Test sprawdzający sam payload przeszedłby wtedy
     bez zająknięcia, a audyt liczyłby każdą zmianę podwójnie. */
  enqueueSetLocation(706, "A01-02-03", baza(706), { locsPrzed: "", zrodlo: "karta", akcja: "replace" });
  assert.equal(wpisy(706).length, 1);
});

test("usunięcie kodu daje location_removed, nie location_set", () => {
  // oba typy muszą przetrwać — `productHistory` po nich filtruje
  enqueueSetLocation(707, "", baza(707), {
    locsPrzed: "A01-02-03",
    zrodlo: "karta",
    akcja: "remove",
    wartosc: "A01-02-03",
  });
  assert.equal(wpisy(707)[0].type, "location_removed");
});

// ── Historia na karcie ──────────────────────────────────────────────────────

test("historia pokazuje przejście przed → po", () => {
  enqueueSetLocation(708, "B05-01-02", baza(708), { locsPrzed: "A01-02-03", zrodlo: "karta" });
  assert.equal(productHistory(708)[0].detail, "A01-02-03 → B05-01-02");
});

test("historia odróżnia zmianę z rozkładania od zmiany z karty", () => {
  enqueueSetLocation(709, "B05-01-02", baza(709), { locsPrzed: "A01-02-03", zrodlo: "dostawa" });
  assert.match(productHistory(709)[0].detail, /\(dostawa\)$/);
});

test("puste pole opisane słowem, nie pustką", () => {
  enqueueSetLocation(710, "B05-01-02", baza(710), { locsPrzed: "", zrodlo: "karta" });
  assert.equal(productHistory(710)[0].detail, "(puste) → B05-01-02");
});

test("wiersz sprzed tej zmiany NIE wywraca historii", () => {
  /* Dane historyczne nie mają `locsPrzed`. Muszą się dalej wyświetlać — a nie
     znikać ani psuć ekranu — bo to jest ten sam ślad audytowy, o który cała
     ta praca chodzi. */
  db()
    .prepare(
      "INSERT INTO events(type, tw_id, payload, user_id, created_at) VALUES ('location_set',?,?,?,?)"
    )
    .run(711, JSON.stringify({ action: "add", value: "A01-02-03", result: "A01-02-03" }), "Stary", "2026-01-01T10:00:00Z");
  const h = productHistory(711);
  assert.equal(h.length, 1);
  assert.equal(h[0].detail, "→ A01-02-03");
});
