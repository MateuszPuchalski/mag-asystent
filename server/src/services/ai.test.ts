import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generujOdpowiedz,
  sparsujOdpowiedzAI,
  zbudujSystem,
  zbudujTrescUzytkownika,
} from "./ai.js";

/* ── Serwis AI — czyste funkcje i doradca dev ────────────────────────────────
   Granica testów jest ta sama co przy Allegro: `fetch` nie jest mockowany.
   Testujemy to, co da się przetestować bez sieci — rozbiór odpowiedzi
   i budowę promptu — oraz doradcę dev, który sieci nie potrzebuje.

   Najważniejsze są tu testy DEGRADACJI. Model potrafi odpowiedzieć inaczej,
   niż go poproszono, i to nie może kończyć się błędem 500 zamiast szkicu.  */

const JSON_WZORCOWY = JSON.stringify({
  odpowiedz: "Dzień dobry, pasuje symbol W80-2005.",
  kategoria: "dobor-czesci",
  produkty: [{ symbol: "W80-2005" }],
  urzadzenie: "T375",
  w_ofercie: true,
  pytanie_klienta: null,
});

test("czysty JSON rozbiera się na wszystkie pola", () => {
  const o = sparsujOdpowiedzAI(JSON_WZORCOWY);
  assert.equal(o.odpowiedz, "Dzień dobry, pasuje symbol W80-2005.");
  assert.equal(o.kategoria, "dobor-czesci");
  assert.deepEqual(o.produkty, [{ symbol: "W80-2005" }]);
  assert.equal(o.urzadzenie, "T375");
  assert.equal(o.wOfercie, true);
});

test("płotki markdown wokół JSON-a nie psują rozbioru", () => {
  const o = sparsujOdpowiedzAI("```json\n" + JSON_WZORCOWY + "\n```");
  assert.equal(o.kategoria, "dobor-czesci");
  assert.equal(o.produkty.length, 1);
});

test("zdanie wstępne przed obiektem nie psuje rozbioru", () => {
  const o = sparsujOdpowiedzAI("Oto odpowiedź:\n" + JSON_WZORCOWY);
  assert.equal(o.urzadzenie, "T375");
});

test("nieparsowalna odpowiedź degraduje do szkicu bez klasyfikacji", () => {
  /* Szkic do poprawienia jest użyteczny, błąd 500 nie jest — dlatego cały
     tekst ląduje w treści odpowiedzi zamiast wywracać żądanie. */
  const o = sparsujOdpowiedzAI("Dzień dobry, ta część pasuje. Pozdrawiamy.");
  assert.equal(o.odpowiedz, "Dzień dobry, ta część pasuje. Pozdrawiamy.");
  assert.equal(o.kategoria, null);
  assert.deepEqual(o.produkty, []);
  assert.equal(o.wOfercie, null);
});

test("JSON bez treści odpowiedzi też degraduje — nie ma czego wysłać", () => {
  const o = sparsujOdpowiedzAI('{"kategoria":"inne"}');
  assert.equal(o.kategoria, null);
  assert.equal(o.odpowiedz, '{"kategoria":"inne"}');
});

test("kategoria spoza umówionej listy jest odrzucana, nie zapisywana", () => {
  /* Pole zasila statystyki — jedna „doradztwo-techniczne" rozbiłaby
     zestawienie na kategorie, których nikt nie zdefiniował. */
  const o = sparsujOdpowiedzAI(
    JSON.stringify({ odpowiedz: "x", kategoria: "doradztwo-techniczne" })
  );
  assert.equal(o.kategoria, null);
});

test("produkty przyjmują i obiekty, i gołe symbole", () => {
  const o = sparsujOdpowiedzAI(
    JSON.stringify({ odpowiedz: "x", produkty: ["A-1", { symbol: "B-2" }, {}, 7] })
  );
  assert.deepEqual(o.produkty, [{ symbol: "A-1" }, { symbol: "B-2" }]);
});

test("prompt systemowy: fakty i przykłady wchodzą, umowa o JSON zamyka", () => {
  const s = zbudujSystem("Jesteś doradcą.", "Wysyłka do Chorwacji: 60 zł.", [
    { pytanie: "Czy pasuje?", odpowiedz: "Tak, symbol X." },
  ]);
  assert.match(s, /Jesteś doradcą\./);
  assert.match(s, /Wysyłka do Chorwacji: 60 zł\./);
  assert.match(s, /Tak, symbol X\./);
  /* Ostatnie zdanie promptu waży najwięcej, a to ono decyduje, czy odpowiedź
     da się w ogóle rozebrać — dlatego umowa stoi na końcu. */
  assert.ok(s.trimEnd().endsWith("albo napisz, że sprawdzisz i odpiszesz."));
});

test("pusty prompt schodzi do domyślnego, a nie do pustki", () => {
  const s = zbudujSystem("", "", []);
  assert.match(s, /maszyn ogrodniczych/);
  assert.doesNotMatch(s, /FAKTY FIRMOWE/);
  assert.doesNotMatch(s, /TAK ODPOWIADAMY NAPRAWDĘ/);
});

test("treść bez tekstu prosi o przepisanie pytania z obrazu", () => {
  assert.match(zbudujTrescUzytkownika(null, "KONTEKST"), /pytanie_klienta/);
  assert.match(zbudujTrescUzytkownika("Czy pasuje?", "KONTEKST"), /Czy pasuje\?/);
});

test("doradca dev składa odpowiedź z kontekstu, bez sieci", async () => {
  const o = await generujOdpowiedz({
    system: "x",
    tekst: "Czy ta końcówka pasuje do modelu T375?",
    kontekst:
      "KARTOTEKI:\n- SYMBOL: W80-2005 | Cewka | stan: 4 szt.\n" +
      "NASZE AUKCJE:\n- Cewka | https://allegro.pl/oferta/of-1",
  });
  assert.equal(o.kategoria, "dobor-czesci");
  assert.deepEqual(o.produkty, [{ symbol: "W80-2005" }]);
  assert.match(o.odpowiedz, /W80-2005/);
  assert.match(o.odpowiedz, /https:\/\/allegro\.pl\/oferta\/of-1/);
  assert.equal(o.wOfercie, true);
});

test("doradca dev rozpoznaje pytanie o wysyłkę i nie zgaduje kosztu", async () => {
  const o = await generujOdpowiedz({
    system: "x",
    tekst: "czy można wysłać do Chorwacji i jaki koszt wysyłki",
    kontekst: "KARTOTEKI: nic nie pasuje.",
  });
  assert.equal(o.kategoria, "dostawa-wysylka");
  assert.doesNotMatch(o.odpowiedz, /\d+ ?zł/);
});

test("doradca dev bez trafienia w kartotece prosi o model urządzenia", async () => {
  const o = await generujOdpowiedz({
    system: "x",
    tekst: "Szukam części, czy coś pasuje?",
    kontekst: "KARTOTEKI: nic nie pasuje do tego pytania w naszej kartotece.",
  });
  assert.equal(o.wOfercie, false);
  assert.match(o.odpowiedz, /model urządzenia/);
});
