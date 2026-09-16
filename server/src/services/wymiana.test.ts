import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wymiana-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Ile trwa wymiana magazyn↔biuro (własność „Miara") ───────────────────────
   §22 projektu panelu wymienia „czas realizacji zadania magazynowego" wśród
   metryk biznesowych i nie podaje przy nim ani progu, ani miejsca pomiaru.
   W kodzie nie było go WCALE: znaczniki obu końców każdej wymiany leżą w bazie
   od lat, a różnicy nie liczył nikt.

   Ten plik pilnuje czterech rzeczy, bo każda z nich zamieniłaby miarę
   w ozdobę: że mediana jest medianą (nie średnią), że ogon widać osobno, że
   sprawa TRWAJĄCA nie wypada z raportu, i że odesłanie liczy się jako
   odpowiedź hali — inaczej „czas realizacji" mierzyłby wyłącznie zadania,
   które się udały.                                                          */

let db: typeof import("../db/db.js").db;
let W: typeof import("./wymiana.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  W = await import("./wymiana.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["zadanie_terenowe", "problem", "ean_rozstrzygniecie", "ean_conflict"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

/** Znacznik liczony OD TERAZ — raport z oknem nie zna konkretnych dat. */
const temu = (minut: number) => new Date(Date.now() - minut * 60_000).toISOString();

function zadanie(minutTemu: number, status: string, trwaloMinut: number | null) {
  const od = temu(minutTemu);
  const domkniete = trwaloMinut === null ? null : temu(minutTemu - trwaloMinut);
  db().prepare(`INSERT INTO zadanie_terenowe(rodzaj,tytul,instrukcja,zrodlo,priorytet,status,
    utworzono_at,utworzono_przez,wykonano_at) VALUES ('pomiar','X','Y','panel','normalny',?,?,?,?)`)
    .run(status, od, "Anna", domkniete);
}

const wiersz = (kanal: string, dni = 30) =>
  W.czasyWymiany(dni).wiersze.find((w) => w.kanal === kanal)!;

test("MEDIANA, nie średnia — jedna sprawa sprzed tygodnia nie topi stu z kwadransa", () => {
  /* Cztery po 10 minut i jedna po 10 000. Średnia dałaby ~2008 minut, czyli
     liczbę, której nie miała ŻADNA sprawa. Mediana mówi, jak wygląda zwykły
     dzień; ogon — jak wygląda zły. */
  for (let i = 0; i < 4; i++) zadanie(100 + i, "wykonane", 10);
  zadanie(20_000, "wykonane", 10_000);

  const z = wiersz("zadanie");
  assert.equal(z.zamknietych, 5);
  assert.equal(z.medianaMin, 10, "mediana pięciu spraw to ta środkowa");
  assert.equal(z.p90Min, 10_000, "ogon pokazuje się OSOBNO, nie rozmywa mediany");
});

test("sprawa TRWAJĄCA nie wypada z raportu — bywa najgorsza z całej listy", () => {
  /* Bez tej kolumny raport pokazywałby wyłącznie sprawy, które ktoś domknął,
     czyli mierzyłby własny sukces. Najdłużej stoi zwykle to, czego nikt nie
     ruszył. */
  zadanie(30, "wykonane", 5);
  zadanie(4320, "nowe", null);

  const z = wiersz("zadanie");
  assert.equal(z.zamknietych, 1);
  assert.equal(z.medianaMin, 5);
  assert.equal(z.otwartych, 1);
  assert.ok(z.najstarszaOtwartaMin! >= 4319 && z.najstarszaOtwartaMin! <= 4325,
    `najstarsza otwarta = ${z.najstarszaOtwartaMin}`);
});

test("ODESŁANIE liczy się jako odpowiedź hali, nie jako sprawa otwarta", () => {
  /* Inaczej „czas realizacji zadania magazynowego" mierzyłby wyłącznie
     zadania, które się udały — a te trudne wypadałyby z miary właśnie
     dlatego, że były trudne. Hala odpowiedziała: „nie da się" to odpowiedź. */
  const od = temu(120);
  db().prepare(`INSERT INTO zadanie_terenowe(rodzaj,tytul,instrukcja,zrodlo,priorytet,status,
    utworzono_at,utworzono_przez,odeslano_at,powod_kod)
    VALUES ('pomiar','X','Y','panel','normalny','odeslane',?,'Anna',?,'brak_towaru')`)
    .run(od, temu(90));

  const z = wiersz("zadanie");
  assert.equal(z.zamknietych, 1, "odesłane JEST domknięte — hala odpowiedziała");
  assert.equal(z.medianaMin, 30);
  assert.equal(z.otwartych, 0);
});

test("okno odcina historię, a puste kanały mówią `null`, nie zero", () => {
  zadanie(60 * 24 * 45, "wykonane", 30);

  const szerokie = W.czasyWymiany(90).wiersze.find((w) => w.kanal === "zadanie")!;
  assert.equal(szerokie.zamknietych, 1);

  const waskie = wiersz("zadanie", 7);
  assert.equal(waskie.zamknietych, 0);
  /* `null`, nie zero: „mediana z zera spraw wynosi 0 minut" to zdanie
     nieprawdziwe, a na ekranie wygląda na doskonały wynik. */
  assert.equal(waskie.medianaMin, null);
  assert.equal(waskie.p90Min, null);
  assert.equal(waskie.najstarszaOtwartaMin, null);
});

test("wszystkie cztery kanały są w raporcie ZAWSZE, także puste", () => {
  /* Ta sama zasada co przy jedenastu drogach doboru: kanał bez ani jednej
     sprawy jest ustaleniem, nie pustką — mówi, że tą drogą nikt nie chodzi. */
  const r = W.czasyWymiany(30);
  assert.deepEqual(r.wiersze.map((w) => w.kanal),
    ["zadanie", "niezgodnosc", "pominiecie", "kolizja"]);
  assert.deepEqual(r.wiersze.map((w) => w.kierunek),
    ["biuro→hala", "hala→biuro", "hala→biuro", "hala→biuro"]);
  assert.ok(r.wiersze.every((w) => w.medianaMin === null && w.zamknietych === 0));
});

test("p90 bierze najbliższą rangę — liczbę, którą MIAŁA któraś sprawa", () => {
  /* Interpolacja zwróciłaby przy dziesięciu sprawach wartość, której nie miała
     żadna z nich. Ten raport mówi o sprawach, nie o rozkładzie. */
  assert.equal(W.p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(W.p90([5]), 5);
  assert.equal(W.p90([]), null);
});
