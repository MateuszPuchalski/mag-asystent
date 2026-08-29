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
  for (const t of ["dopasowanie", "pytanie", "ai_config", "sgt_towar", "sgt_stan", "watek_meta"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  /* Świeży adapter na każdy test: dev trzyma wysłane wiadomości w pamięci
     instancji, więc bez resetu wysyłka z jednego testu wyciekłaby do
     następnego. */
  zresetujAdapterAllegro();
});

function towar(twId: number, sym: string, nazwa: string, opis = "", ean = ""): void {
  db()
    .prepare(
      "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, opis, lokalizacja) VALUES (?,?,?,?,?,'')"
    )
    .run(twId, sym, nazwa, ean, opis);
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
    { id: "1", odKupujacego: false, autor: "my", tresc: "W czym pomóc?", at: null, zalacznikow: 0, ofertaId: null },
    { id: "2", odKupujacego: true, autor: "k", tresc: "Dzień dobry", at: null, zalacznikow: 0, ofertaId: null },
    { id: "3", odKupujacego: true, autor: "k", tresc: "mam kosiarkę T375", at: "x", zalacznikow: 0, ofertaId: null },
  ]);
  /* Identyfikatorem jest OSTATNIA wiadomość — to na nią odpowiadamy i to ona
     rozstrzyga o idempotencji. */
  assert.equal(seria?.id, "3");
  assert.equal(seria?.tresc, "Dzień dobry\nmam kosiarkę T375");
  assert.equal(
    P.ostatniaSeriaKupujacego([
      { id: "1", odKupujacego: false, autor: "my", tresc: "gotowe", at: null, zalacznikow: 0, ofertaId: null },
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

test("hurtowe szkice idą wyłącznie za zgodą biura (0.107.0)", async () => {
  /* Do 0.106.0 model pisał sam do każdego pobranego pytania — także do tych,
     których nikt nigdy nie otworzy. To koszt u dostawcy AI za nic, więc
     domyślnie milczy: szkic powstaje po kliknięciu GENERUJ przy konkretnej
     sprawie. Kto chce mieć gotowe od ręki, włącza przełącznik w karcie AI. */
  await P.synchronizujPytania("test");
  assert.equal(await P.dogenerujSzkice("ticker"), 0, "domyślnie ticker nic nie liczy");
  assert.equal(P.listaPytan({ status: "nowe" }).length, 3, "pytania czekają nietknięte");

  assert.equal(P.zapiszAutoSzkic(true, "test").autoSzkic, true);
  assert.equal(await P.dogenerujSzkice("ticker"), 3);
  assert.equal(P.listaPytan({ status: "nowe" }).length, 0);
  assert.equal(await P.dogenerujSzkice("ticker"), 0, "drugi przebieg nie dubluje");

  /* Wyłączenie zatrzymuje ticker, ale nie kasuje tego, co już napisane. */
  assert.equal(P.zapiszAutoSzkic(false, "test").autoSzkic, false);
  assert.equal(P.listaPytan({ status: "szkic" }).length, 3);
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
  P.zapiszAutoSzkic(true, "test");
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
  P.zapiszAutoSzkic(true, "test");
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

/* „Nie mamy" i „nie mamy, ale przyjdzie" to dla klienta dwie różne odpowiedzi.
   Do 0.89.0 kontekst pytania niósł sam stan, więc druga była nie do napisania —
   choć serwer liczył ją od dawna na karcie towaru. */
test("kartoteka w kontekście niesie EAN, towar w drodze i zamienniki rozstrzygnięte", async () => {
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta", "", "5900000000036");
  await P.synchronizujPytania("test");
  const p = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!;
  const k = await P.kontekstPytania(p);
  const trafienie = k.kartoteki.find((x) => x.symbol === "TEST-LINIA-TODO")!;

  assert.ok(trafienie, "kartoteka z aukcji ma trafić do kontekstu");
  assert.equal(trafienie.ean, "5900000000036", "EAN bywa jedynym, co klient podaje");
  assert.ok(Array.isArray(trafienie.zamowione));
  assert.ok(Array.isArray(trafienie.wDostawie));
  /* Podział na nasze i cudze, nie płaska lista kandydatów: „mamy zamiennik"
     wolno obiecać, cudzego numeru katalogowego nie sprzedajemy. */
  assert.ok(Array.isArray(trafienie.zamienniki.znane));
  assert.ok(Array.isArray(trafienie.zamienniki.obce));
});

/* Kontekst szedł do 0.89.0 WYŁĄCZNIE do modelu — panel dostawał sam tekst
   promptu, którego nie pokazywał. Te pola są po to, żeby człowiek widział to
   samo co model: po czym szukaliśmy i co już potwierdziliśmy. */
test("kontekst wystawia frazy i potwierdzone dopasowania osobnymi polami", async () => {
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

  assert.ok(k.frazy.includes("T375"), "frazy szukania mają wyjść na zewnątrz");
  assert.equal(k.dopasowania.length, 1);
  assert.equal(k.dopasowania[0].urzadzenie, "T375");
  assert.equal(k.dopasowania[0].symbol, "TEST-LINIA-TODO");
  /* Adapter dev nie chodzi po sieci, więc pusta lista aukcji znaczy tu
     „nie mamy", a nie „nie sprawdziliśmy" — i to musi być rozróżnialne. */
  assert.equal(k.bladOfert, null);
});

test("prompt i fakty zapisują się osobno i nie kasują się nawzajem", () => {
  P.zapiszPrompt("Jesteś doradcą.", "admin");
  P.zapiszFakty("Wysyłka do Chorwacji: 60 zł.", "admin");
  const k = P.pobierzKonfiguracje();
  assert.equal(k.prompt, "Jesteś doradcą.");
  assert.equal(k.fakty, "Wysyłka do Chorwacji: 60 zł.");
  assert.equal(k.zmienionoPrzez, "admin");
});


/* ── Historia klienta i prowadzenie sprawy ─────────────────────────────────── */

test("historia klienta zbiera jego wcześniejsze pytania, a wklejka nie ma po czym szukać", async () => {
  await P.synchronizujPytania("test");
  const lista = P.listaPytan({ limit: 50 });
  const p = lista.find((x) => x.threadId === "dev-pyt-1")!;
  const inne = lista.find((x) => x.threadId === "dev-pyt-2")!;
  /* Oba pytania temu samemu loginowi — dopiero wtedy historia ma sens. */
  db().prepare("UPDATE pytanie SET kupujacy_login = 'klient-x' WHERE id IN (?,?)").run(p.id, inne.id);

  const h = P.historiaKlienta(p.id);
  assert.equal(h.login, "klient-x");
  assert.equal(h.pytania.length, 1, "bieżąca sprawa nie jest własną historią");
  assert.equal(h.pytania[0].id, inne.id);

  const zWklejki = await P.pytanieZWklejki({ tekst: "Czy pasuje do kosiarki?" }, "biuro");
  const pusta = P.historiaKlienta(zWklejki.id);
  assert.equal(pusta.login, null);
  assert.deepEqual(pusta.pytania, []);
});

/* Panel biura ma regułę „zero zapisu przy samym PATRZENIU" (routes/biuro.test.ts),
   więc prowadzącego stempluje PRACA nad sprawą, nie jej otwarcie. */
test("sprawę zajmuje redakcja odpowiedzi, a wysłanie ją zwalnia", async () => {
  await P.synchronizujPytania("test");
  const p = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!;
  assert.equal(p.prowadzi, null, "samo pobranie pytania nikogo nie zajmuje");

  const po = P.zapiszOdpowiedz(p.id, "Tak, ta część pasuje.", "anna");
  assert.equal(po.prowadzi, "anna");
  assert.ok(po.prowadziAt);

  const wynik = await P.wyslijOdpowiedz(p.id, "anna");
  assert.equal(wynik.pytanie.status, "wyslane");
  assert.equal(wynik.pytanie.prowadzi, null, "zamknięta sprawa nikogo nie zajmuje");
});

test("liczniki rozdzielają czekające na szkic od gotowych do sprawdzenia", async () => {
  await P.synchronizujPytania("test");
  const p = P.listaPytan({ limit: 50 })[0];
  P.zapiszOdpowiedz(p.id, "Szkic po ręce.", "anna");
  const l = P.licznikiPytan();
  assert.equal(l.nowe + l.szkice, P.licznikOtwartych());
  assert.ok(l.szkice >= 1);
});

/* ── Statystyki ────────────────────────────────────────────────────────────── */

test("statystyki liczą produkty, kategorie, udział bez edycji i braki w ofercie", async () => {
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta");
  await P.synchronizujPytania("test");
  P.zapiszAutoSzkic(true, "test");
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

/* ── Przesyłki w kontekście (0.105.0) ──────────────────────────────────────── */

test("kontekst: pytanie o wysyłkę dostaje blok przesyłek, dobór części nie", async () => {
  await P.synchronizujPytania("test");
  const lista = P.listaPytan({ limit: 50 });

  // dev-pyt-4: „czy można wysłać do Chorwacji…" — heurystyka trafia,
  // a kupujący 44300104 ma zamówienie dopiero w przygotowaniu
  const oWysylce = lista.find((x) => x.threadId === "dev-pyt-4")!;
  const k = await P.kontekstPytania(oWysylce);
  assert.match(k.tekst, /PRZESYŁKI OSTATNICH ZAMÓWIEŃ KLIENTA/);
  assert.match(k.tekst, /W przygotowaniu/);
  assert.ok(k.przesylki && k.przesylki.zamowienia.length === 1);
  assert.equal(k.bladPrzesylek, null);

  // dev-pyt-1: dobór części — ZERO strzałów o przesyłki, zero szumu w kontekście
  const oCzesc = lista.find((x) => x.threadId === "dev-pyt-1")!;
  const k2 = await P.kontekstPytania(oCzesc);
  assert.ok(!/PRZESYŁKI/.test(k2.tekst), "pytanie o część nie ciągnie przesyłek");
  assert.equal(k2.przesylki, null);
});

test("kontekst: wklejka z pytaniem o paczkę mówi uczciwie o braku loginu", async () => {
  const p = await P.pytanieZWklejki({ tekst: "Gdzie jest moja paczka? Zamówiłem tydzień temu." }, "test");
  const k = await P.kontekstPytania(p);
  assert.match(k.tekst, /bez loginu kupującego/);
  assert.match(k.tekst, /NIE zgaduj/);
  assert.equal(k.przesylki, null);
});

/* ── Aukcja podpięta do pytania ────────────────────────────────────────────── */

test("pytanie zna aukcję z WIADOMOŚCI, nie tylko z nagłówka wątku (0.107.0)", async () => {
  /* Klient klika PYTANIE przy konkretnej ofercie i Allegro wpina ją w tę
     wiadomość (`relatedObject`). Wątek zna wyłącznie pierwszą sprawę, jaką
     ten klient kiedykolwiek zgłosił — przy stałym kliencie to zupełnie inny
     towar. Do 0.106.0 braliśmy nagłówek wątku i biuro odpowiadało o czymś
     innym, niż widzi kupujący. Nagłówek zostaje jako zapasowe źródło. */
  await P.synchronizujPytania("test");
  const lista = P.listaPytan({ limit: 50 });

  const zWiadomosci = lista.find((x) => x.threadId === "dev-pyt-1")!;
  assert.equal(zWiadomosci.ofertaId, "of-1", "aukcja z wiadomości klienta");

  const zNaglowka = lista.find((x) => x.threadId === "dev-pyt-4")!;
  assert.equal(zNaglowka.ofertaId, "of-3", "wiadomość bez aukcji — bierzemy wątek");
});

test("kontekst szkicu prowadzi symbolem z podpiętej aukcji (0.107.0)", async () => {
  /* Sygnatura sprzedawcy (`external.id`) trafia w kartotekę pewniej niż
     jakiekolwiek szukanie po nazwie — dlatego stoi na początku listy symboli
     i osobnym akapitem w kontekście. Bez tego model zgadywał z treści. */
  towar(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta");
  await P.synchronizujPytania("test");
  const p = P.szczegolPytania(P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!.id);

  const k = await P.kontekstPytania(p);
  assert.equal(k.oferta?.externalId, "TEST-LINIA-TODO");
  assert.match(k.tekst, /PYTANIE DOTYCZY TEJ AUKCJI/);
  assert.ok(
    k.kartoteki.some((x) => x.symbol === "TEST-LINIA-TODO"),
    "symbol z aukcji wciąga właściwą kartotekę"
  );
});

test("aukcja zdjęta ze sprzedaży: kontekst każe dopytać, nie zgadywać (0.107.0)", async () => {
  /* Identyfikator jest, oferty już nie ma. Najgorsze, co model może zrobić,
     to napisać o dowolnym podobnym towarze — kupujący dostałby cenę czegoś
     innego. Więc mówimy mu wprost: dopytaj. */
  const id = Number(
    db()
      .prepare(
        `INSERT INTO pytanie
           (zrodlo, tresc, otrzymano_at, status, produkty_json, oferta_id, utworzono_at, utworzono_przez)
         VALUES ('allegro','Czy to pasuje?',datetime('now'),'nowe','[]','of-nie-ma',datetime('now'),'test')`
      )
      .run().lastInsertRowid
  );

  const k = await P.kontekstPytania(P.szczegolPytania(id));
  assert.equal(k.oferta, null);
  assert.match(k.tekst, /oferty już nie ma/);
});

/* ── Świeżość sprawy (0.110.0) ─────────────────────────────────────────────── */

test("dopisek klienta aktualizuje otwartą sprawę zamiast zakładać drugą", async () => {
  /* Nowa wiadomość kupującego w wątku z OTWARTĄ sprawą dawała dotąd nowy
     wiersz (INSERT po wiadomosc_id) — dwie osoby pisałyby dwie odpowiedzi
     temu samemu klientowi. Symulacja: cofamy znaną wiadomość sprawy, więc
     sync widzi w wątku „nowszą" — dokładnie tak wygląda dopisek. */
  await P.synchronizujPytania("test");
  const przed = P.listaPytan({ limit: 50 });
  const sprawa = przed.find((x) => x.threadId === "dev-pyt-1")!;
  db()
    .prepare("UPDATE pytanie SET wiadomosc_id = 'starsza', odpowiedz = 'Szkic biura' WHERE id = ?")
    .run(sprawa.id);

  const wynik = await P.synchronizujPytania("test");
  assert.equal(wynik.dopisanych, 1, "dopisek policzony osobno od nowych");
  assert.equal(
    P.listaPytan({ limit: 50 }).length,
    przed.length,
    "żadnego drugiego wiersza dla tego samego wątku"
  );

  const po = P.szczegolPytania(sprawa.id);
  assert.ok(po.nowaWiadomoscAt, "sync stempluje dopisek");
  assert.equal(po.odpowiedz, "Szkic biura", "szkic biura NIETKNIĘTY — zasada nienaruszalności");
  assert.equal(po.status, sprawa.status, "status nie cofa się przez dopisek");
  assert.notEqual(po.wiadomoscId, "starsza", "sprawa stoi już na nowej wiadomości");
});

test("wysyłka na nieświeżą rozmowę odmawia z dopiskami; wymus wysyła", async () => {
  await P.synchronizujPytania("test");
  P.zapiszAutoSzkic(true, "test");
  await P.dogenerujSzkice("test");
  const id = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!.id;
  /* Sprawa myśli, że ostatnie słowo klienta to starsza wiadomość — a wątek
     w Allegro ma nowszą. Dokładnie ten stan zostawia dopisek klienta. */
  db().prepare("UPDATE pytanie SET wiadomosc_id = 'starsza' WHERE id = ?").run(id);

  await assert.rejects(
    () => P.wyslijOdpowiedz(id, "anna"),
    (e: unknown) => {
      assert.ok(e instanceof P.BladSwiezosci, "osobna klasa z ładunkiem, nie goły 400");
      assert.equal((e as InstanceType<typeof P.BladSwiezosci>).kod, 409);
      assert.ok((e as InstanceType<typeof P.BladSwiezosci>).wiadomosci.length > 0, "niesie dopiski");
      return true;
    }
  );
  assert.equal(P.szczegolPytania(id).status, "szkic", "odmowa niczego nie wysłała");

  /* Świadoma decyzja człowieka: przeczytał i mimo to wysyła. */
  const wynik = await P.wyslijOdpowiedz(id, "anna", true);
  assert.equal(wynik.pytanie.status, "wyslane");
  assert.equal(wynik.pytanie.nowaWiadomoscAt, null, "wysyłka gasi stempel dopisku");
});

test("noweOdKlienta: świeża sprawa milczy, dopisek wraca od znanej wiadomości", () => {
  const w = (id: string, odKupujacego = true) => ({
    id, odKupujacego, autor: "k", tresc: "x", at: null, zalacznikow: 0, ofertaId: null,
  });
  // ostatnia znana = ostatnia w wątku → świeżo
  assert.equal(P.noweOdKlienta([w("a"), w("b")], "b"), null);
  // wątek zakończony NASZĄ odpowiedzią → nie ma o czym mówić
  assert.equal(P.noweOdKlienta([w("a"), w("nasza", false)], "a"), null);
  // dopisek → wszystko PO znanej wiadomości
  assert.deepEqual(
    P.noweOdKlienta([w("a"), w("b"), w("c")], "a")!.map((m) => m.id),
    ["b", "c"]
  );
  // znanej nie ma w oknie (bardzo stara sprawa) → uczciwie cała rozmowa
  assert.equal(P.noweOdKlienta([w("a"), w("b")], "spoza-okna")!.length, 2);
});

/* ── Metadane wątku przy pytaniach (0.126.0) ─────────────────────────────────
   Sync i tak czyta każdą rozmowę — metadane piłki (kto ostatni, kiedy, ile)
   zostają za darmo; wysyłka stempluje nasz głos bez ponownego GET-a.         */

test("sync wypełnia watek_meta metadanami, wysyłka stempluje nasz głos", async () => {
  const M = await import("./watek-meta.js");
  await P.synchronizujPytania("test");
  const p = P.listaPytan({ limit: 50 }).find((x) => x.threadId === "dev-pyt-1")!;
  const meta = M.metaWatku("pytanie", p.threadId!);
  assert.ok(meta, "sync zostawia meta dla przejrzanego wątku");
  assert.equal(meta.ostatniGlos, "klient", "pytanie w kolejce = ostatni głos klienta");
  assert.equal(meta.zrodlo, "sync");
  assert.ok(meta.wiadomosci !== null && meta.wiadomosci > 0, "licznik z rozmowy sync");

  P.zapiszOdpowiedz(p.id, "Dzień dobry, pasek jest w drodze.");
  await P.wyslijOdpowiedz(p.id, "anna");
  const po = M.metaWatku("pytanie", p.threadId!);
  assert.equal(po?.ostatniGlos, "my", "po wysyłce ostatnie słowo jest nasze");
  assert.equal(po?.zrodlo, "wysylka");
  assert.equal(po?.wiadomosci, meta.wiadomosci, "stempel nie zeruje licznika");
});
