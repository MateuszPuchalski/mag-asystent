import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Aktualizacja kolektora z serwera (0.52.0) ───────────────────────────────
   Dwie rzeczy są tu warte testu bardziej niż reszta.

   Pierwsza: OBIE TRASY MUSZĄ ODPOWIADAĆ BEZ SESJI. Kolektor pyta o wersję przy
   otwarciu aplikacji, więc także wtedy, gdy nikt nie jest zalogowany. Gdyby
   ktoś „posprzątał" listę `BEZ_SESJI`, aktualizacja przestałaby działać
   dokładnie na urządzeniu, które jej najbardziej potrzebuje — i nikt by tego
   nie zauważył, bo zalogowanemu wszystko dalej chodzi.

   Druga: przy kilku plikach wygrywa NAJWYŻSZA wersja liczona po numerach.
   Po napisach `0.9.0` wychodzi nowsze niż `0.10.0`.                          */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-apk-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let katalogApk: typeof import("../services/aktualizacja.js").katalogApk;

/** Minimalny plik udający APK: dwa bajty nagłówka ZIP plus wypełniacz. */
const UDAJE_APK = Buffer.concat([Buffer.from("PK"), Buffer.alloc(30, 7)]);

before(async () => {
  ({ katalogApk } = await import("../services/aktualizacja.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const dir = katalogApk();
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

function polozApk(nazwa: string, tresc: Buffer = UDAJE_APK): string {
  const dir = katalogApk();
  fs.mkdirSync(dir, { recursive: true });
  const plik = path.join(dir, nazwa);
  fs.writeFileSync(plik, tresc);
  return plik;
}

const info = () => app.inject({ method: "GET", url: "/api/aktualizacja" });
const plik = (naglowki: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: "/api/aktualizacja/apk", headers: naglowki });

test("brak katalogu to nie błąd — serwer mówi, że nie ma czego wydać", async () => {
  const r = await info();
  assert.equal(r.statusCode, 200, "404 byłoby nie do odróżnienia od starego serwera");
  assert.equal(r.json().wersja, null);
});

test("jeden plik: wersja z nazwy, rozmiar i suma z pliku", async () => {
  const p = polozApk("wertis-kolektor-0.48.0.apk");
  const r = await info();
  const j = r.json();
  assert.equal(j.wersja, "0.48.0");
  assert.equal(j.kodWersji, 48_000);
  assert.equal(j.bajtow, fs.statSync(p).size);
  assert.equal(j.sha256, crypto.createHash("sha256").update(UDAJE_APK).digest("hex"));
});

test("przy kilku plikach wygrywa najwyższa wersja, nie kolejność napisów", async () => {
  polozApk("wertis-kolektor-0.9.0.apk");
  polozApk("wertis-kolektor-0.10.0.apk");
  polozApk("wertis-kolektor-0.47.0.apk");
  assert.equal((await info()).json().wersja, "0.47.0");
});

test("0.10.0 jest nowsze niż 0.9.0", async () => {
  polozApk("wertis-kolektor-0.9.0.apk");
  polozApk("wertis-kolektor-0.10.0.apk");
  assert.equal((await info()).json().wersja, "0.10.0");
});

test("plik o innej nazwie nie jest wydawany", async () => {
  polozApk("kolektor.apk");
  polozApk("wertis-kolektor-0.48.apk");
  polozApk("wertis-kolektor-0.48.0.apk.tmp");
  assert.equal((await info()).json().wersja, null);
});

test("plik bez nagłówka ZIP jest ignorowany", async () => {
  // README przemianowany na .apk albo pobranie ucięte w połowie — kolektor
  // dowiedziałby się o tym po kilkunastu megabajtach
  polozApk("wertis-kolektor-0.48.0.apk", Buffer.from("To nie jest APK"));
  assert.equal((await info()).json().wersja, null);
});

test("pusty plik jest ignorowany", async () => {
  polozApk("wertis-kolektor-0.48.0.apk", Buffer.alloc(0));
  assert.equal((await info()).json().wersja, null);
});

test("człon wersji powyżej 999 jest odrzucany, a nie zwijany do sąsiedniej wersji", async () => {
  // 0.47.1000 i 0.48.0 dają ten sam kod — kolizja czytałaby się jako „ta sama
  // wersja", czyli aktualizacja znikałaby po cichu
  polozApk("wertis-kolektor-0.47.1000.apk");
  assert.equal((await info()).json().wersja, null);
});

test("setny minor ma swój kod, a nie kod następnego majora", async () => {
  /* Granica przekroczona przy wydaniu 0.100.0 i to jest cały powód tego testu.
     Przy zapasie 99 `0.100.0` dawało 10 000 — dokładnie tyle, co `1.0.0` —
     a strażnik `minor > 99` odrzucał ten plik, więc kolektory przestałyby
     widzieć aktualizację BEZ ANI JEDNEGO błędu. Wzór musi zostać zgodny
     z `kodWersji` w `android/app/build.gradle.kts`; rozjazd znaczy, że serwer
     poda plik, którego Android odmówi zainstalować. */
  polozApk("wertis-kolektor-0.100.0.apk");
  const j = (await info()).json();
  assert.equal(j.wersja, "0.100.0");
  assert.equal(j.kodWersji, 100_000, "setny minor ma własny kod");
  assert.ok(j.kodWersji < 1_000_000, "i jest MNIEJSZY niż 1.0.0");
  assert.ok(j.kodWersji > 99_000, "a WIĘKSZY niż 0.99.0 — Android przyjmie go jako nowszy");
});

test("obie trasy odpowiadają BEZ sesji", async () => {
  polozApk("wertis-kolektor-0.48.0.apk");
  assert.equal((await info()).statusCode, 200, "trasa musi zostać na liście BEZ_SESJI");
  assert.equal((await plik()).statusCode, 200, "trasa musi zostać na liście BEZ_SESJI");
});

test("pobranie niesie długość ze stat i typ APK", async () => {
  const p = polozApk("wertis-kolektor-0.48.0.apk");
  const r = await plik();
  assert.equal(r.headers["content-type"], "application/vnd.android.package-archive");
  assert.equal(r.headers["content-length"], String(fs.statSync(p).size));
  assert.equal(r.rawPayload.length, fs.statSync(p).size, "ciało krótsze niż deklaracja to cichy błąd");
});

test("pobranie ma no-store, żeby APK nie wyparło cache'u odpytywania", async () => {
  polozApk("wertis-kolektor-0.48.0.apk");
  // cache dyskowy OkHttp ma 20 MB i służy pytaniom co 1,5 s; zapisane tam APK
  // wyrzuciłoby z niego całą resztę
  assert.equal((await plik()).headers["cache-control"], "no-store");
});

test("znany ETag oszczędza przesłanie pliku", async () => {
  polozApk("wertis-kolektor-0.48.0.apk");
  const etag = (await plik()).headers.etag as string;
  const r = await plik({ "if-none-match": etag });
  assert.equal(r.statusCode, 304);
  assert.equal(r.rawPayload.length, 0);
});

test("pobranie bez pliku na serwerze kończy się 404", async () => {
  assert.equal((await plik()).statusCode, 404);
});
