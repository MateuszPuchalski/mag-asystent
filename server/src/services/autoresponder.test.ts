import { test } from "node:test";
import assert from "node:assert/strict";
import { czyAutoresponder } from "./autoresponder.js";

/* ── Autoodpowiedź biura (0.218.0) ────────────────────────────────────────────
   Reguła ma być WĄSKA. Zwinięcie prawdziwej odpowiedzi agenta kosztowałoby
   dużo więcej niż niezwinięcie jednego odbicia: agent czyta oś, żeby wiedzieć,
   co już klientowi powiedzieliśmy.                                           */

/** Treść z żywej skrzynki — przepisana z wiadomości właściciela, ze spacjami
    na końcach wierszy i podwójnym językiem, bo tak przychodzi. */
const ODBICIE = `Dziękujemy za kontakt 

Ta wiadomość jest generowana automatycznie i jest potwierdzeniem, że e-mail do nas dotarł. 
Wiemy, że zależy Państwu na szybkiej odpowiedzi, dlatego postaramy się odpisać w możliwie najkrótszym czasie. 

Godziny pracy biura: 
-Pon.- Pt. 8:00 - 16:00
-Sob.- Nie. Nieczynne 

Thank you for contacting us This message is generated automatically and is a confirmation that the e-mail has been received by us.`;

test("odbicie z biura jest rozpoznane", () => {
  assert.equal(czyAutoresponder(ODBICIE), true);
});

test("sam angielski wystarcza — kanał ucina koniec, nie początek", () => {
  /* Gdyby dopasowanie żądało OBU zdań naraz, przycięta wiadomość przestałaby
     być rozpoznawana i wróciłaby na oś w pełnym rozmiarze. */
  assert.equal(czyAutoresponder("This message is generated automatically."), true);
  assert.equal(czyAutoresponder("Ta wiadomość jest generowana automatycznie."), true);
});

test("łamanie wiersza w środku zdania nie psuje dopasowania", () => {
  /* Kanał zawija treść po swojemu, a mail miał ją zawiniętą inaczej. */
  assert.equal(czyAutoresponder("Ta wiadomość\n jest   generowana\nautomatycznie i tyle."), true);
});

test("rozsypane polskie znaki nie ratują odbicia przed zwinięciem", () => {
  assert.equal(czyAutoresponder("TA WIADOMOSC JEST GENEROWANA AUTOMATYCZNIE"), true);
});

test("prawdziwa odpowiedź agenta zostaje wiadomością", () => {
  /* To jest ten test, dla którego reguła jest wąska. */
  assert.equal(czyAutoresponder(
    "Dzień dobry, szarpak SZR-148/82 pasuje do tej kosiarki. Wysyłamy jutro."), false);
  assert.equal(czyAutoresponder("Dziękujemy za kontakt, sprawdzam i wracam."), false);
  assert.equal(czyAutoresponder("Godziny pracy biura: Pon.- Pt. 8:00 - 16:00"), false);
});

test("pusta treść nie jest odbiciem", () => {
  assert.equal(czyAutoresponder(""), false);
});
