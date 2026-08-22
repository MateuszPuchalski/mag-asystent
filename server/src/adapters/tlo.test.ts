import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

/* ── Adapter usługi usuwania tła ─────────────────────────────────────────────
   Cała stawka tego pliku to JEDNO rozróżnienie: `null` znaczy „tła nie
   usunięto" (odpowiedź poprawna — człowiek zobaczy oryginał i zdecyduje),
   a wyjątek znaczy „nie dało się zapytać" (stan przejściowy). Zlanie ich
   w jedno zamieniłoby padniętą usługę w ciche „zdjęcie z tłem" i nikt nigdy
   nie skojarzyłby, że wycinanie w ogóle nie działa.

   Usługę zastępujemy zwykłym serwerem HTTP: adapter ma zero wiedzy o modelu,
   więc do jego sprawdzenia model nie jest potrzebny.                          */

process.env.LOG_LEVEL = "silent";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/** Co atrapa ma odpowiedzieć na następne wywołanie. */
let odpowiedz: { kod: number; typ: string; tresc: Buffer } = {
  kod: 200,
  typ: "image/png",
  tresc: PNG,
};
let wywolan = 0;

let serwer: http.Server;
let usunTlo: typeof import("./tlo.js").usunTlo;
let tloWlaczone: typeof import("./tlo.js").tloWlaczone;
let zresetujBezpiecznikTla: typeof import("./tlo.js").zresetujBezpiecznikTla;

before(async () => {
  serwer = http.createServer((req, res) => {
    wywolan++;
    req.resume();
    req.on("end", () => {
      res.writeHead(odpowiedz.kod, { "content-type": odpowiedz.typ });
      res.end(odpowiedz.tresc);
    });
  });
  await new Promise<void>((r) => serwer.listen(0, "127.0.0.1", r));
  const port = (serwer.address() as AddressInfo).port;

  /* Adres USTAWIAMY przed pierwszym importem konfiguracji — `config.ts` czyta
     środowisko raz, przy tworzeniu literału. */
  process.env.TLO_URL = `http://127.0.0.1:${port}`;
  ({ usunTlo, tloWlaczone, zresetujBezpiecznikTla } = await import("./tlo.js"));
});

after(() => serwer.close());

beforeEach(() => {
  zresetujBezpiecznikTla();
  wywolan = 0;
  odpowiedz = { kod: 200, typ: "image/png", tresc: PNG };
});

test("ustawiony TLO_URL włącza funkcję", () => {
  assert.equal(tloWlaczone(), true);
});

test("udana odpowiedź oddaje PNG", async () => {
  const r = await usunTlo(JPEG, "image/jpeg");
  assert.ok(r);
  assert.deepEqual(r, PNG);
});

/* 422 to ODMOWA, nie awaria: usługa obejrzała zdjęcie i nie znalazła na nim
   przedmiotu. Kadr regału z pięcioma kartonami wygląda właśnie tak. */
test("422 znaczy „tła nie usunięto”, a nie awarię", async () => {
  odpowiedz = { kod: 422, typ: "text/plain", tresc: Buffer.from("brak przedmiotu") };
  assert.equal(await usunTlo(JPEG, "image/jpeg"), null);
});

test("odmowa 422 NIE nakręca bezpiecznika", async () => {
  odpowiedz = { kod: 422, typ: "text/plain", tresc: Buffer.from("brak") };
  for (let i = 0; i < 5; i++) assert.equal(await usunTlo(JPEG, "image/jpeg"), null);
  assert.equal(wywolan, 5, "poprawna odpowiedź nie ma prawa odciąć usługi");
});

test("błąd usługi RZUCA — to stan przejściowy, nie brak tła", async () => {
  odpowiedz = { kod: 500, typ: "text/plain", tresc: Buffer.from("bum") };
  await assert.rejects(() => usunTlo(JPEG, "image/jpeg"), /Nie da się usunąć tła/);
});

/* Typ rozpoznajemy Z BAJTÓW, nie z nagłówka. Usługa, która odesłała komunikat
   błędu jako tekst z kodem 200, dałaby na karcie pusty prostokąt bez powodu. */
test("odpowiedź 200, która nie jest PNG-iem, jest odrzucana", async () => {
  odpowiedz = { kod: 200, typ: "image/png", tresc: Buffer.from("to nie jest obraz") };
  await assert.rejects(() => usunTlo(JPEG, "image/jpeg"), /nie jest plikiem PNG/);
});

test("zdanie o błędzie mówi, gdzie szukać usługi", async () => {
  odpowiedz = { kod: 500, typ: "text/plain", tresc: Buffer.from("bum") };
  await assert.rejects(() => usunTlo(JPEG, "image/jpeg"), /wertis-tlo/);
});

/* Bez bezpiecznika padnięta usługa zamienia każde zrobione zdjęcie
   w kilkunastosekundowe kółko — a to wygląda jak zawieszony kolektor,
   nie jak wyłączone wycinanie tła. */
test("po trzech błędach z rzędu przestajemy pytać usługę", async () => {
  odpowiedz = { kod: 500, typ: "text/plain", tresc: Buffer.from("bum") };
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => usunTlo(JPEG, "image/jpeg"));
  }
  assert.equal(wywolan, 3);
  await assert.rejects(() => usunTlo(JPEG, "image/jpeg"));
  assert.equal(wywolan, 3, "czwarte wywołanie ma odpaść na bezpieczniku, bez ruchu po sieci");
});

test("udana odpowiedź zeruje licznik błędów", async () => {
  odpowiedz = { kod: 500, typ: "text/plain", tresc: Buffer.from("bum") };
  await assert.rejects(() => usunTlo(JPEG, "image/jpeg"));
  await assert.rejects(() => usunTlo(JPEG, "image/jpeg"));
  odpowiedz = { kod: 200, typ: "image/png", tresc: PNG };
  assert.ok(await usunTlo(JPEG, "image/jpeg"));

  odpowiedz = { kod: 500, typ: "text/plain", tresc: Buffer.from("bum") };
  await assert.rejects(() => usunTlo(JPEG, "image/jpeg"));
  await assert.rejects(() => usunTlo(JPEG, "image/jpeg"));
  /* Pięć wywołań, nie cztery: gdyby licznik nie wracał do zera, trzeci błąd
     z rzędu uzbroiłby bezpiecznik i ostatnie wywołanie odpadłoby bez ruchu
     po sieci. */
  assert.equal(wywolan, 5);
});
