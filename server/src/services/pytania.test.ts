import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Pytania klientów — serwis ───────────────────────────────────────────────
   Cztery rzeczy z cichym trybem awarii:

   1. KTÓRY WĄTEK JEST PYTANIEM. Wątek zakończony NASZĄ wiadomością to sprawa
      załatwiona; gdyby zakładał wiersz, worklista sama by się zapychała.
   2. IDEMPOTENCJA. Ticker widzi te same wątki co pięć minut — drugi przebieg
      nie ma prawa zrobić duplikatów.
   3. UCZCIWOŚĆ WSKAŹNIKA „bez edycji". Ma znaczyć dosłownie tyle, że poszedł
      szkic modelu co do znaku — inaczej mierzyłby sam siebie.
   4. WIEDZA ROŚNIE Z WYSŁANYCH. Dopasowanie maszyna→część zapisuje się
      wyłącznie po akceptacji człowieka, nigdy przy samym szkicu.

   Adapter Allegro i dostawca AI to tryby dev — granica testów ta sama co
   przy zwrotach, bez mockowania fetch.                                       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pyt-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let P: typeof import("./pytania.js");
let zresetujAdapterAllegro: typeof import("../adapters/allegro.js").zresetujAdapterAllegro;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ zresetujAdapterAllegro } = await import("../adapters/allegro.js"));
  P = await import("./pytania.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dopasowanie", "pytanie", "ai_config", "sgt_towar", "sgt_stan"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  /* Świeży adapter na każdy test: dev trzyma wysłane wiadomości w pamięci
     instancji, więc bez resetu wysyłka z jednego testu wyciekłaby do
     następnego. */
  zresetujAdapterAllegro();
});

function towar(twId: number, sym: string, nazwa: string, opis = ""): void {
  db()
    .prepare(
      "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, opis, lokalizacja) VALUES (?,?,?,'',?,'')"
    )
    .run(twId, sym, nazwa, opis);
  db().prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,1,5,0)").run(twId);
}

/* ── Synchronizacja ────────────────────────────────────────────────────────── */

test("pytanie powstaje tylko z wątku zakończonego wiadomością klienta", async () => {
  const wynik = await P.synchronizujPytania("test");
  assert.equal(wynik.przejrzanychWatkow, 4);
  /* dev-pyt-3 kończy się NASZĄ odpowiedzią — sprawa załatwiona, nie pytanie. */
  assert.equal(wynik.nowych, 3);
  const threads = P.listaPytan({ limit: 50 }).map((p) => p.threadId);
  assert.ok(!threads.includes("dev-pyt-3"));
  assert.deepEqual(new Set(threads), new Set(["dev-pyt-1", "dev-pyt-2", "dev-pyt-4"]));
});

test("drugi przebieg nie robi duplikatów (idempotencja po wiadomosc_id)", async () => {
  await P.synchronizujPytania("test");
  const drugi = await P.synchronizujPytania("test");
  assert.equal(drugi.nowych, 0);
  assert.equal(P.listaPytan({ limit: 50 }).length, 3);
});

test("kontekst wątku niesie tytuł oferty do dopasowania kartoteki", async () => {
  await P.synchronizujPytania("test");
  const p = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!;
  assert.equal(p.ofertaId, "of-1");
  assert.equal(p.kupujacyLogin, "client:44300101");
  assert.match(p.tresc, /T375/);
});

test("seria wiadomości klienta pod rząd skleja się w jedno pytanie", () => {
  const seria = P.ostatniaSeriaKupujacego([
    { id: "1", odKupujacego: false, autor: "my", tresc: "W czym pomóc?", at: null, zalacznikow: 0 },
    { id: "2", odKupujacego: true, autor: "k", tresc: "Dzień dobry", at: null, zalacznikow: 0 },
    { id: "3", odKupujacego: true, autor: "k", tresc: "mam kosiarkę T375", at: "x", zalacznikow: 0 },
  ]);
  /* Identyfikatorem jest OSTATNIA wiadomość — to na nią odpowiadamy i to ona
     rozstrzyga o idempotencji. */
  assert.equal(seria?.id, "3");
  assert.equal(seria?.tresc, "Dzień dobry\nmam kosiarkę T375");
  assert.equal(
    P.ostatniaSeriaKupujacego([
      { id: "1", odKupujacego: false, autor: "my", tresc: "gotowe", at: null, zalacznikow: 0 },
    ]),
    null
  );
});

/* ── Kontekst ──────────────────────────────────────────────────────────────── */

test("frazy szukania biorą tytuł oferty i tokeny z cyframi, pomijają uprzejmości", () => {
  const frazy = P.frazySzukania(
    "Dzień dobry, czy cewka pasuje do modelu T375 numer 1P70F?",
    "Cewka zapłonowa NAC"
  );
  assert.equal(frazy[0], "Cewka zapłonowa NAC");
  assert.ok(frazy.includes("T375"));
  assert.ok(frazy.includes("1P70F"));
  assert.ok(!frazy.includes("Dzień"));
});

test("kontekst niesie symbol, stan i link do aukcji", async () => {
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta");
  await P.synchronizujPytania("test");
  const p = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!;
  const k = await P.kontekstPytania(p);
  assert.match(k.tekst, /SYMBOL: TEST-LINIA-TODO/);
  assert.match(k.tekst, /https:\/\/allegro\.pl\/oferta\//);
  assert.ok(k.kartoteki.length > 0);
});

test("kontekst bez trafienia mówi wprost, że nic nie pasuje", async () => {
  await P.synchronizujPytania("test");
  const p = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-2")!;
  const k = await P.kontekstPytania(p);
  assert.match(k.tekst, /nic nie pasuje/);
  assert.equal(k.kartoteki.length, 0);
});

/* ── Szkic ─────────────────────────────────────────────────────────────────── */

test("szkic zapisuje kategorię, mapuje symbole na kartoteki i wchodzi w pole odpowiedzi", async () => {
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta");
  await P.synchronizujPytania("test");
  const id = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!.id;

  const p = await P.generujSzkic(id, "test");
  assert.equal(p.status, "szkic");
  assert.equal(p.kategoria, "dobor-czesci");
  assert.deepEqual(p.produkty, [{ twId: 900_036, symbol: "TEST-LINIA-TODO" }]);
  /* Szkic ląduje OD RAZU w polu odpowiedzi — człowiek redaguje, nie przepisuje. */
  assert.equal(p.odpowiedz, p.szkicAi);
  assert.equal(p.edytowano, false);
});

test("symbol spoza kartoteki zostaje w produktach z pustym tw_id", () => {
  /* Model bywa pewny czegoś, czego u nas nie ma. Wyrzucenie takiego symbolu
     ukryłoby właśnie ten fakt przed statystyką braków w ofercie. */
  const id = Number(
    db()
      .prepare(
        `INSERT INTO pytanie (zrodlo, tresc, otrzymano_at, status, produkty_json,
           utworzono_at, utworzono_przez)
         VALUES ('wklejka','x',datetime('now'),'nowe','[{"twId":null,"symbol":"NIEZNANY-1"}]',
           datetime('now'),'test')`
      )
      .run().lastInsertRowid
  );
  assert.deepEqual(P.szczegolPytania(id).produkty, [{ twId: null, symbol: "NIEZNANY-1" }]);
});

test("dogenerujSzkice liczy szkice dla wszystkiego, co czeka", async () => {
  await P.synchronizujPytania("test");
  assert.equal(await P.dogenerujSzkice("ticker"), 3);
  assert.equal(P.listaPytan({ status: "nowe" }).length, 0);
  assert.equal(await P.dogenerujSzkice("ticker"), 0);
});

/* ── Redakcja i wysyłka ────────────────────────────────────────────────────── */

test("„bez edycji” znaczy dosłownie szkic co do znaku", async () => {
  await P.synchronizujPytania("test");
  const id = P.listaPytan({ limit: 50 })[0].id;
  const p = await P.generujSzkic(id, "test");

  assert.equal(P.zapiszOdpowiedz(id, p.szkicAi!).edytowano, false);
  assert.equal(P.zapiszOdpowiedz(id, p.szkicAi + " Pozdrawiamy.").edytowano, true);
});

test("wysyłka zmienia status, dopisuje wiadomość do wątku i wskazuje następne", async () => {
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta");
  await P.synchronizujPytania("test");
  await P.dogenerujSzkice("test");
  const id = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!.id;

  const wynik = await P.wyslijOdpowiedz(id, "anna");
  assert.equal(wynik.pytanie.status, "wyslane");
  assert.equal(wynik.pytanie.odpowiedzial, "anna");
  assert.ok(wynik.nastepneId !== null, "kolejne pytania czekają — panel ma je otworzyć");

  const { allegroAdapter } = await import("../adapters/allegro.js");
  const wiadomosci = await allegroAdapter().wiadomosciWatku("dev-pyt-1");
  assert.equal(wiadomosci[wiadomosci.length - 1].odKupujacego, false);
  assert.equal(wiadomosci[wiadomosci.length - 1].tresc, wynik.pytanie.odpowiedz);
});

test("wysyłka drugi raz jest odmawiana, nie powtarzana", async () => {
  await P.synchronizujPytania("test");
  await P.dogenerujSzkice("test");
  const id = P.listaPytan({ limit: 50 })[0].id;
  await P.wyslijOdpowiedz(id, "anna");
  await assert.rejects(() => P.wyslijOdpowiedz(id, "anna"), /już poszła/);
});

test("pytanie z wklejki nie ma dokąd odpisać — wysyłka mówi to wprost", async () => {
  const p = await P.pytanieZWklejki({ tekst: "Czy pasuje do T375?" }, "test");
  assert.equal(p.zrodlo, "wklejka");
  assert.equal(p.status, "szkic");
  assert.ok(p.odpowiedz);
  await assert.rejects(() => P.wyslijOdpowiedz(p.id, "test"), /Centrum wiadomości/);
});

test("wklejka odrzuca obraz w nieobsługiwanym formacie", async () => {
  await assert.rejects(
    () => P.pytanieZWklejki({ obrazBase64: "data:image/gif;base64,AAAA" }, "test"),
    /Nieobsługiwany format/
  );
  await assert.rejects(() => P.pytanieZWklejki({}, "test"), /Wklej treść/);
});

test("wklejka z obrazem zapisuje transkrypcję, nie obraz", async () => {
  const p = await P.pytanieZWklejki(
    { obrazBase64: "data:image/png;base64,iVBORw0KGgo=" },
    "test"
  );
  /* Transkrypcja z odpowiedzi modelu ląduje w treści — samego obrazu nie ma
     w żadnej kolumnie i to jest cała decyzja o prywatności. */
  assert.match(p.tresc, /transkrypcja dev/);
  const kolumny = db().prepare("SELECT * FROM pytanie WHERE id = ?").get(p.id) as Record<string, unknown>;
  assert.ok(!Object.values(kolumny).some((v) => typeof v === "string" && v.includes("iVBORw0KGgo")));
});

test("odpowiedź dłuższa niż limit Allegro jest zatrzymywana u nas", async () => {
  await P.synchronizujPytania("test");
  const id = P.listaPytan({ limit: 50 })[0].id;
  P.zapiszOdpowiedz(id, "x".repeat(2500));
  await assert.rejects(() => P.wyslijOdpowiedz(id, "test"), /skróć/);
});

/* ── Wiedza ────────────────────────────────────────────────────────────────── */

test("dopasowanie maszyna→część zapisuje się dopiero przy wysyłce", async () => {
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta");
  await P.synchronizujPytania("test");
  const id = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!.id;

  await P.generujSzkic(id, "test");
  const poSzkicu = db().prepare("SELECT COUNT(*) AS ile FROM dopasowanie").get() as { ile: number };
  assert.equal(poSzkicu.ile, 0, "sam szkic to jeszcze zgadywanie modelu");

  await P.wyslijOdpowiedz(id, "anna");
  const poWysylce = db()
    .prepare("SELECT urzadzenie, symbol FROM dopasowanie")
    .all() as Array<{ urzadzenie: string; symbol: string }>;
  assert.equal(poWysylce.length, 1);
  assert.equal(poWysylce[0].symbol, "TEST-LINIA-TODO");
});

test("potwierdzone dopasowanie wraca do kontekstu następnego pytania", async () => {
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta");
  db()
    .prepare(
      `INSERT INTO dopasowanie (urzadzenie, symbol, tw_id, potwierdzono_at, potwierdzono_przez)
       VALUES ('T375','TEST-LINIA-TODO',900036,datetime('now'),'anna')`
    )
    .run();
  await P.synchronizujPytania("test");
  const p = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!;
  const k = await P.kontekstPytania(p);
  assert.match(k.tekst, /DOPASOWANIA POTWIERDZONE WCZEŚNIEJ/);
  assert.match(k.tekst, /T375 → TEST-LINIA-TODO/);
});

test("prompt i fakty zapisują się osobno i nie kasują się nawzajem", () => {
  P.zapiszPrompt("Jesteś doradcą.", "admin");
  P.zapiszFakty("Wysyłka do Chorwacji: 60 zł.", "admin");
  const k = P.pobierzKonfiguracje();
  assert.equal(k.prompt, "Jesteś doradcą.");
  assert.equal(k.fakty, "Wysyłka do Chorwacji: 60 zł.");
  assert.equal(k.zmienionoPrzez, "admin");
});

/* ── Statystyki ────────────────────────────────────────────────────────────── */

test("statystyki liczą produkty, kategorie, udział bez edycji i braki w ofercie", async () => {
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta");
  await P.synchronizujPytania("test");
  await P.dogenerujSzkice("test");
  for (const p of P.listaPytan({ limit: 50 })) {
    if (p.threadId) await P.wyslijOdpowiedz(p.id, "anna");
  }

  const s = P.statystykiPytan(90);
  assert.equal(s.dni, 90);
  assert.equal(s.wyslanych, 3);
  assert.equal(s.bezEdycji, 3, "nikt nie ruszał szkiców — udział ma być pełny");
  assert.ok(s.produkty.some((p) => p.symbol === "TEST-LINIA-TODO"));
  assert.ok(s.kategorie.some((k) => k.kategoria === "dobor-czesci"));
  assert.ok(s.pozaOferta.length > 0, "pytanie o towar spoza katalogu ma być widoczne");
  /* Tygodnie z kalendarza: okno 90 dni ma oś, nawet gdy pytania są z jednego dnia. */
  assert.ok(s.tygodnie.length >= 12);
});

test("okno statystyk przyjmuje tylko umówione wartości", () => {
  assert.equal(P.oknoDniPytan("30"), 30);
  assert.equal(P.oknoDniPytan("180"), 180);
  assert.equal(P.oknoDniPytan("7"), 90);
  assert.equal(P.oknoDniPytan(undefined), 90);
});

test("zakładka synchronizacji patrzy tylko na pytania z Allegro", async () => {
  /* Wklejka ma datę WKLEJENIA, nie datę wiadomości w Centrum. Wpuszczona do
     zakładki przesuwałaby ją w przód i chowała pytania, które przyszły
     wcześniej tego samego dnia — czyli gubiłaby robotę po cichu. */
  await P.synchronizujPytania("test");
  const zAllegro = P.odKiedySync();
  assert.ok(zAllegro, "po synchronizacji zakładka istnieje");

  await P.pytanieZWklejki({ tekst: "Świeże pytanie z poczty" }, "test");
  assert.equal(P.odKiedySync(), zAllegro, "wklejka nie rusza zakładki");

  db().prepare("DELETE FROM pytanie").run();
  assert.equal(P.odKiedySync(), null, "pusta baza = bez granicy dat");
});
