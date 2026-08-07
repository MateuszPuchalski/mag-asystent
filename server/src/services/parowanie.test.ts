import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SCHEMAT_PAROWANIA, adresyLan, parsujKodParowania } from "./parowanie.js";

test("adresy prywatne idą przed publicznymi", () => {
  const lista = adresyLan();
  const pierwszyPubliczny = lista.findIndex(
    (a) => !/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
  );
  const ostatniPrywatny = lista.reduce(
    (acc, a, i) => (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) ? i : acc),
    -1
  );
  if (pierwszyPubliczny !== -1 && ostatniPrywatny !== -1) {
    assert.ok(ostatniPrywatny < pierwszyPubliczny, "prywatne muszą poprzedzać publiczne");
  }
});

test("adresy pętli zwrotnej nie trafiają na listę", () => {
  assert.ok(!adresyLan().includes("127.0.0.1"));
});

test("kod parowania rozwija się w adres HTTP", () => {
  assert.equal(parsujKodParowania("wertis://192.168.1.50:3001"), "http://192.168.1.50:3001");
  assert.equal(parsujKodParowania("wertis://mag.wertis.local:3001"), "http://mag.wertis.local:3001");
});

test("brak portu w kodzie oznacza port domyślny", () => {
  assert.equal(parsujKodParowania("wertis://192.168.1.50"), "http://192.168.1.50:3001");
});

test("białe znaki wokół kodu nie przeszkadzają", () => {
  // skaner potrafi dokleić CR/LF na końcu — to nie jest inny kod
  assert.equal(parsujKodParowania("  wertis://192.168.1.50:3001\r\n"), "http://192.168.1.50:3001");
});

test("wielkość liter w schemacie nie ma znaczenia", () => {
  assert.equal(parsujKodParowania("WERTIS://192.168.1.50:3001"), "http://192.168.1.50:3001");
});

test("cokolwiek innego niż kod parowania jest odrzucane", () => {
  for (const nie of [
    "A01-02-03", // adres regału
    "W32-0203", // symbol towaru
    "5901234123457", // EAN
    "http://192.168.1.50:3001", // zwykły URL — celowo NIE jest kodem parowania
    "wertis://", // sam schemat
    "wertis://192.168.1.50:3001/api/health", // ze ścieżką
    "wertis://user:haslo@192.168.1.50:3001", // z danymi logowania
    "wertis://192.168.1.50:99999", // port poza zakresem
    "wertis://192.168.1.50:3001?x=1", // z zapytaniem
    "wertis://192.168.1.50 evil.example.com", // dwa hosty
  ]) {
    assert.equal(parsujKodParowania(nie), null, nie);
  }
});

test("schemat parowania jest tym, którego szuka kolektor", () => {
  // Lustro `Parowanie.kt` — rozjazd tej stałej to kod QR, którego nikt nie czyta.
  assert.equal(SCHEMAT_PAROWANIA, "wertis://");
});
