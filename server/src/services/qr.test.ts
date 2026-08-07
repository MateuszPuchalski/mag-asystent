import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  generator,
  informacjaOFormacie,
  kodujDane,
  macierzQr,
  przeplot,
  qrSvg,
  rsKoduj,
} from "./qr.js";

/* ── Po co te testy ─────────────────────────────────────────────────────────
   Generator QR nie ma objawów pośrednich: albo skaner czyta kod, albo nie
   czyta, a „nie czyta" wygląda na magazynie jak zepsuty kolektor. Sprawdzamy
   więc warstwy osobno i tam, gdzie da się je porównać z WARTOŚCIAMI Z NORMY,
   a nie z drugim wywołaniem tego samego kodu.                                */

test("wielomian generujący stopnia 10 zgadza się z tablicą normy", () => {
  // ISO/IEC 18004, wielomian dla 10 kodów korekcji (wersja 1-M)
  assert.deepEqual(
    Array.from(generator(10)),
    [1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193]
  );
});

/* Ciało GF(256) — potrzebne, żeby sprawdzić RS jego własną definicją, a nie
   drugim wywołaniem tej samej funkcji. Tabela liczona tu od zera, niezależnie
   od tej w `qr.ts`: gdyby obie wzięły ten sam błędny wielomian, test
   porównywałby błąd sam ze sobą. */
function alfa(i: number): number {
  let x = 1;
  for (let k = 0; k < i % 255; k++) {
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return x;
}

function mnozGf(a: number, b: number): number {
  let wynik = 0;
  for (let i = 0; i < 8; i++) {
    if ((b >> i) & 1) wynik ^= a << i;
  }
  for (let i = 14; i >= 8; i--) {
    if ((wynik >> i) & 1) wynik ^= 0x11d << (i - 8);
  }
  return wynik & 0xff;
}

/** Wartość wielomianu (współczynniki od najwyższej potęgi) w punkcie x. */
function wartosc(wspolczynniki: readonly number[], x: number): number {
  return wspolczynniki.reduce((acc, w) => mnozGf(acc, x) ^ w, 0);
}

test("wielomian generujący ma pierwiastki α⁰…α^(n-1)", () => {
  // To JEST definicja g(x) = ∏(x − α^i), więc sprawdza ją bez tablicy do przepisania.
  for (const stopien of [10, 16, 18, 24, 26]) {
    const g = Array.from(generator(stopien));
    for (let i = 0; i < stopien; i++) {
      assert.equal(wartosc(g, alfa(i)), 0, `stopień ${stopien}, pierwiastek α^${i}`);
    }
  }
});

test("słowo kodowe Reed-Solomona jest podzielne przez wielomian generujący", () => {
  /* Właściwość definiująca korekcję: dane wraz z dopisanymi kodami korekcji
     tworzą wielomian, który zeruje się we wszystkich pierwiastkach generatora.
     Sprawdzamy ją zamiast przepisywać tablicę z dokumentacji — tablicę można
     przepisać z literówką, a tej równości nie da się spełnić przypadkiem. */
  const dane = Uint8Array.from([
    32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
  ]);
  for (const ileEc of [10, 13, 16, 26]) {
    const slowo = [...dane, ...rsKoduj(dane, ileEc)];
    for (let i = 0; i < ileEc; i++) {
      assert.equal(wartosc(slowo, alfa(i)), 0, `${ileEc} kodów korekcji, α^${i}`);
    }
  }
});

test("kody korekcji dla wersji 1-M nie zmieniają się między wydaniami", () => {
  // Zaczep regresyjny: wartości wyliczone i sprawdzone testem podzielności wyżej.
  const dane = Uint8Array.from([
    32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
  ]);
  assert.deepEqual(
    Array.from(rsKoduj(dane, 10)),
    [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]
  );
});

test("informacja o formacie zgadza się z tablicą normy dla poziomu M", () => {
  // Osiem 15-bitowych ciągów dla poziomu korekcji M, maski 0–7.
  const zNormy = [
    "101010000010010",
    "101000100100101",
    "101111001111100",
    "101101101001011",
    "100010111111001",
    "100000011001110",
    "100111110010111",
    "100101010100000",
  ];
  zNormy.forEach((oczekiwany, maska) => {
    const bity = informacjaOFormacie(maska).toString(2).padStart(15, "0");
    assert.equal(bity, oczekiwany, `maska ${maska}`);
  });
});

test("dobiera najmniejszą wersję mieszczącą tekst", () => {
  assert.equal(kodujDane("A".repeat(14)).wersja, 1);
  assert.equal(kodujDane("A".repeat(15)).wersja, 2);
  assert.equal(kodujDane("A".repeat(26)).wersja, 2);
  assert.equal(kodujDane("A".repeat(27)).wersja, 3);
  // typowy adres w LAN mieści się w wersji 2 — najmniejszy realny kod
  assert.equal(kodujDane("wertis://192.168.1.50:3001").wersja, 2);
});

test("tekst ponad pojemność wersji 6 jest błędem, nie uciętym kodem", () => {
  assert.throws(() => kodujDane("x".repeat(107)), /106|bajt/);
});

test("nagłówek kodów danych niesie tryb bajtowy i długość", () => {
  const { kody } = kodujDane("AB");
  // 0100 (tryb) + 00000010 (długość 2) + 01000001 ('A') + 01000010 ('B')
  assert.equal(kody[0], 0b01000000 | 0b0000); // 0100 0000
  assert.equal(kody[1], 0b00100100); // 0010 (reszta długości) + 0100 ('A' górne)
  assert.equal(kody[2], 0b00010100); // 0001 ('A' dolne) + 0100 ('B' górne)
  assert.equal(kody[3], 0b00100000); // 0010 ('B' dolne) + terminator
});

test("wypełniacze normy idą naprzemiennie 0xEC / 0x11", () => {
  const { kody } = kodujDane("A");
  const ogon = Array.from(kody.slice(3));
  assert.deepEqual(ogon.slice(0, 4), [0xec, 0x11, 0xec, 0x11]);
});

test("przeplot rozkłada bloki tej samej wersji równomiernie", () => {
  // wersja 6-M: 4 bloki po 27 kodów danych + 4×16 kodów korekcji
  const kody = Uint8Array.from({ length: 108 }, (_, i) => i);
  const wynik = przeplot(kody, 6);
  assert.equal(wynik.length, 108 + 4 * 16);
  // pierwsze cztery bajty to pierwsze bajty czterech kolejnych bloków
  assert.deepEqual(Array.from(wynik.slice(0, 4)), [0, 27, 54, 81]);
});

/* ── Struktura macierzy ─────────────────────────────────────────────────── */

test("macierz ma rozmiar wersji i znaczniki pozycji w trzech rogach", () => {
  const m = macierzQr("wertis://192.168.1.50:3001");
  assert.equal(m.length, 25); // wersja 2 → 17 + 4×2
  assert.equal(m[0].length, 25);

  const n = m.length;
  for (const [r0, c0] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]) {
    // zewnętrzny pierścień ciemny, pierścień pod nim jasny, środek ciemny
    assert.equal(m[r0][c0], true, "róg znacznika");
    assert.equal(m[r0 + 1][c0 + 1], false, "jasny pierścień");
    assert.equal(m[r0 + 3][c0 + 3], true, "środek znacznika");
  }
});

test("wzorce taktujące są naprzemienne", () => {
  const m = macierzQr("wertis://192.168.1.50:3001");
  for (let i = 8; i < m.length - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `wiersz taktujący, kolumna ${i}`);
    assert.equal(m[i][6], i % 2 === 0, `kolumna taktująca, wiersz ${i}`);
  }
});

test("moduł zawsze ciemny jest ciemny", () => {
  const m = macierzQr("test");
  assert.equal(m[m.length - 8][8], true);
});

test("separator wokół znacznika pozycji jest jasny", () => {
  const m = macierzQr("test");
  for (let i = 0; i <= 7; i++) {
    assert.equal(m[7][i], false, `separator poziomy, kolumna ${i}`);
    assert.equal(m[i][7], false, `separator pionowy, wiersz ${i}`);
  }
});

test("różne teksty dają różne macierze", () => {
  const a = macierzQr("wertis://192.168.1.50:3001");
  const b = macierzQr("wertis://192.168.1.51:3001");
  assert.notDeepEqual(a, b);
});

/* ── SVG ────────────────────────────────────────────────────────────────── */

test("SVG ma cichy margines czterech modułów po każdej stronie", () => {
  const svg = qrSvg("test");
  const bok = macierzQr("test").length + 8;
  assert.match(svg, new RegExp(`viewBox="0 0 ${bok} ${bok}"`));
});

test("SVG nie wpuszcza tekstu wejściowego do atrybutu bez oczyszczenia", () => {
  const svg = qrSvg("test", { opis: 'a"><script>alert(1)</script>' });
  assert.ok(!svg.includes("<script"), "znaczniki w opisie muszą zniknąć");
  assert.ok(!svg.includes('a"><'), "cudzysłów nie może domknąć atrybutu");
});

test("SVG jest jednym pathem, nie tysiącem prostokątów", () => {
  const svg = qrSvg("wertis://192.168.1.50:3001");
  assert.equal((svg.match(/<path/g) ?? []).length, 1);
  assert.equal((svg.match(/<rect/g) ?? []).length, 1); // samo tło
});
