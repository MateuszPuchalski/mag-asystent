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

/* Modele 5.5 to cel przejścia z claude-opus-5. Bez wpisu w cenniku liczyłyby
   się po stawce najdroższej i porównanie modeli na ekranie pomiaru kłamałoby
   na korzyść starego. Stawki z cennika Anthropic, 21 października 2026. */
const MILION = 1_000_000;
const tylko = (pole: "wej" | "wyj" | "cacheZapis" | "cacheOdczyt") =>
  ({ wej: 0, wyj: 0, cacheZapis: 0, cacheOdczyt: 0, [pole]: MILION });

for (const [model, wej, wyj, zapis, odczyt] of [
  ["claude-opus-5-5", 4, 20, 5, 0.2],
  ["claude-sonnet-5-5", 2, 10, 2.5, 0.1],
  ["claude-haiku-5-5", 0.1, 0.5, 0.125, 0.01],
] as const) {
  test(`${model}: wejście, wyjście, zapis i odczyt cache po stawkach z cennika`, () => {
    assert.equal(znanyModel(model), true);
    assert.equal(kosztUsd(model, tylko("wej")), wej);
    assert.equal(kosztUsd(model, tylko("wyj")), wyj);
    assert.equal(kosztUsd(model, tylko("cacheZapis")), zapis);
    assert.equal(kosztUsd(model, tylko("cacheOdczyt")), odczyt);
  });
}

test("odczyt cache ma stawkę per model, a bez niej zostaje jedna dziesiąta wejścia", () => {
  /* Opus 5.5 czyta cache za 0,05 wejścia; ta sama reguła 0,1 co u Opusa 5
     zawyżyłaby jego odczyt dwukrotnie. */
  assert.equal(kosztUsd("claude-opus-5-5", tylko("cacheOdczyt")), 0.2);
  assert.equal(kosztUsd("claude-opus-5", tylko("cacheOdczyt")), 0.5);
  assert.equal(kosztUsd("claude-haiku-4-5", tylko("cacheOdczyt")), 0.1);
});

test("nieznany model dalej liczy się po najdroższej stawce, także w cache", () => {
  const nieznany = (pole: Parameters<typeof tylko>[0]) => kosztUsd("claude-cos-nowego", tylko(pole));
  for (const pole of ["wej", "wyj", "cacheZapis", "cacheOdczyt"] as const) {
    assert.equal(nieznany(pole), kosztUsd("claude-opus-5", tylko(pole)), pole);
    assert.ok(nieznany(pole) >= kosztUsd("claude-opus-5-5", tylko(pole)), pole);
  }
  /* Identyfikator z przyrostkiem nie zgaduje się do bazowego modelu: księga
     trzyma to, co zwróciło API, a ciche dopasowanie ukryłoby nowy model. */
  assert.equal(znanyModel("claude-opus-5-5-20261001"), false);
});

test("jedna klasyfikacja kosztuje ułamek centa, a nie zero", () => {
  /* Typowe wywołanie: ~1000 tokenów wejścia, ~300 wyjścia. Gdyby zaokrąglać
     do centa, każde pojedyncze wywołanie pokazywałoby zero i pomiar nie
     miałby czego sumować. */
  const jedno = kosztUsd("claude-opus-5", { wej: 1000, wyj: 300, cacheZapis: 0, cacheOdczyt: 0 });
  assert.ok(jedno > 0, "pojedyncze wywołanie nie ma prawa zaokrąglić się do zera");
  assert.ok(jedno < 0.05, `jedno wywołanie ma kosztować grosze, a kosztuje ${jedno}`);
});

test("wyszukiwanie w sieci kosztuje cent od sztuki, niezależnie od modelu (0.507.0)", () => {
  const bez = kosztUsd("claude-opus-5", { wej: 1000, wyj: 100, cacheZapis: 0, cacheOdczyt: 0 });
  const z = kosztUsd("claude-opus-5", { wej: 1000, wyj: 100, cacheZapis: 0, cacheOdczyt: 0, wyszukiwania: 3 });
  assert.equal(Number((z - bez).toFixed(6)), 0.03);
  assert.equal(kosztUsd("claude-haiku-4-5", { wej: 0, wyj: 0, cacheZapis: 0, cacheOdczyt: 0, wyszukiwania: 1 }), 0.01);
});
