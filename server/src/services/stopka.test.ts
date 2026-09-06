import { test } from "node:test";
import assert from "node:assert/strict";
import { podzielStopke } from "./stopka.js";

/* ── Stopka firmowa (0.219.1) ─────────────────────────────────────────────────
   Reguła tnie od NAZWY SPÓŁKI do końca wiadomości, więc pomyłka kosztuje
   ucięcie odpowiedzi. Testy pilnują obu stron tego ryzyka.                   */

/** Przepisane ze zrzutu właściciela. */
const ODPOWIEDZ = `Dzień dobry,

dziękujemy za wiadomość. Jeżeli zaworek zwrotny w gaźniku nie działa
prawidłowo, prosimy o zgłoszenie reklamacji produktu przez Allegro.

Z poważaniem,
Mateusz



WERTIS Sp. z o.o.
Sienkiewicze 4, 16-070 Sienkiewicze
NIP: 5423444020 KRS: 0000949011 REGON: 521041553
Telefon:: (+48) 535696989`;

test("stopka schodzi z treści, podpis człowieka zostaje", () => {
  const { tresc, stopka } = podzielStopke(ODPOWIEDZ);

  /* „Z poważaniem, Mateusz" to podpis, nie blok firmowy: mówi, z kim klient
     rozmawiał, i przy sporze jest tym, czego się szuka. */
  assert.ok(tresc.includes("Z poważaniem,"));
  assert.ok(tresc.includes("Mateusz"));
  assert.ok(tresc.includes("zaworek zwrotny"));

  assert.ok(!tresc.includes("NIP"));
  assert.ok(!tresc.includes("WERTIS Sp. z o.o."));
  assert.match(stopka!, /^WERTIS Sp\. z o\.o\./);
  assert.ok(stopka!.includes("535696989"));
});

test("puste wiersze przed stopką znikają razem z nią", () => {
  /* Zostawione w treści robiłyby pod podpisem dziurę bez powodu. */
  const { tresc } = podzielStopke(ODPOWIEDZ);
  assert.equal(tresc, tresc.trimEnd());
  assert.ok(tresc.endsWith("Mateusz"));
});

test("wiadomość bez stopki zostaje nietknięta", () => {
  const bez = "Dzień dobry, szarpak pasuje. Wysyłamy jutro.";
  assert.deepEqual(podzielStopke(bez), { tresc: bez, stopka: null });
});

test("nazwa firmy w zdaniu nie ucina odpowiedzi", () => {
  /* Bierzemy OSTATNIE wystąpienie właśnie dlatego: cięcie od pierwszego
     zjadłoby tu połowę wiadomości. */
  const z = ["Zamówienie złożone na WERTIS Sp. z o.o. jest już spakowane.",
    "Wyślemy je jutro rano.", "", "WERTIS Sp. z o.o.", "NIP: 5423444020"].join("\n");
  const { tresc, stopka } = podzielStopke(z);
  assert.ok(tresc.includes("Wyślemy je jutro rano."));
  assert.ok(tresc.includes("jest już spakowane"));
  assert.equal(stopka, "WERTIS Sp. z o.o.\nNIP: 5423444020");
});

test("sama stopka bez treści nie gubi wiadomości", () => {
  const { tresc, stopka } = podzielStopke("WERTIS Sp. z o.o.\nNIP: 5423444020");
  assert.equal(tresc, "");
  assert.equal(stopka, "WERTIS Sp. z o.o.\nNIP: 5423444020");
});
