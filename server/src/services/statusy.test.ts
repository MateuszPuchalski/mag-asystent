import { test } from "node:test";
import assert from "node:assert/strict";
import { poWiadomosciKlienta, statusEfektywny } from "./statusy.js";

/* Reguły statusu stoją w jednym pliku i tu są sprawdzane BEZ bazy — to jest
   arytmetyka decyzji, a nie zapytanie. Przejścia przez prawdziwe mutacje
   pilnują testy obok (`conversations.test.ts`, `skrzynka.test.ts`). */

const teraz = new Date("2026-09-02T10:00:00.000Z");

test("odłożenie wygasa samo, bez zapisu i bez tickera", () => {
  assert.equal(
    statusEfektywny("snoozed", "2026-09-03T08:00:00.000Z", teraz), "snoozed",
    "termin w przyszłości trzyma rozmowę poza kolejką");
  assert.equal(
    statusEfektywny("snoozed", "2026-09-02T08:00:00.000Z", teraz), "open",
    "po terminie rozmowa jest już otwarta, choć w bazie dalej stoi `snoozed`");
  /* Odłożenie bez terminu to stan, który nie ma jak się skończyć. Odczyt
     traktuje go jako otwarty zamiast chować rozmowę na zawsze. */
  assert.equal(statusEfektywny("snoozed", null, teraz), "open");
});

test("nieznany status z bazy czyta się jako `new`, a nie wywraca ekranu", () => {
  /* Kolumna ma `CHECK`, więc to nie powinno się zdarzyć — ale odczyt jest
     drogą, którą baza starsza od kodu dochodzi do panelu. */
  assert.equal(statusEfektywny("wymyslony", null, teraz), "new");
});

test("wiadomość klienta otwiera rozmowę, a bez właściciela robi z niej nową", () => {
  assert.equal(poWiadomosciKlienta("waiting_for_customer", true), "open");
  assert.equal(poWiadomosciKlienta("waiting_for_customer", false), "new");
  assert.equal(poWiadomosciKlienta("resolved", true), "open");
  assert.equal(poWiadomosciKlienta("closed", false), "new");
  assert.equal(poWiadomosciKlienta("snoozed", true), "open", "dopisek klienta budzi odłożoną");
});

test("spam jest nietykalny, a czekanie na halę zostaje czekaniem", () => {
  /* Spamer pisze dalej. Rozmowa wracająca do kolejki przy każdej jego
     wiadomości czyniłaby oznaczenie bezużytecznym. */
  assert.equal(poWiadomosciKlienta("spam", false), null);
  /* Dopisek klienta nie zdejmuje pomiaru z hali — dalej czekamy na wynik,
     a to, że przyszło coś nowego, mówi flaga `unread`. */
  assert.equal(poWiadomosciKlienta("waiting_for_internal", true), null);
});

test("status bez zmiany oddaje `null`, żeby nie robić zapisu z niczego", () => {
  assert.equal(poWiadomosciKlienta("open", true), null);
  assert.equal(poWiadomosciKlienta("new", false), null);
});
