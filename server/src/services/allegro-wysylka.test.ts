import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { numerWiadomosci } from "./allegro-wysylka.js";

/* Odczyt odpowiedzi wysyłki sprawdzamy na FIXTURZE w kształcie ze specyfikacji
   Allegro, nie na obiekcie wymyślonym tutaj. To nie jest ostrożność na wyrost:
   mapowanie odczytu skrzynki stało dwa wydania na obiekcie wymyślonym w teście
   i przez ten czas nie zapisało ani jednego wątku. Test, który sam sobie
   definiuje Allegro, potwierdza wyłącznie własną wyobraźnię. */

const wyslana = JSON.parse(fs.readFileSync(
  new URL("../fixtures/allegro-inbox/wyslana.json", import.meta.url), "utf8"));

test("numer wiadomości bierze się z odpowiedzi Allegro", () => {
  assert.equal(numerWiadomosci(wyslana), "message-anon-002");
});

test("odpowiedź bez numeru nie jest błędem wysyłki", () => {
  /* Wiadomość mogła pójść, a my nie umiemy jej nazwać. Kolejka zapisuje wtedy
     `send_uncertain` i rozstrzyga dopiero synchronizacja wątku — ponowienie
     na ślepo wysłałoby klientowi to samo drugi raz. */
  for (const brak of [null, {}, { id: null }, "nie-json"]) {
    assert.equal(numerWiadomosci(brak), null);
  }
});

test("numer liczbowy schodzi do tekstu, bo kolumna trzyma tekst", () => {
  assert.equal(numerWiadomosci({ id: 82398120310 }), "82398120310");
});
