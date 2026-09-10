import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szkic-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Copilot: szkic odpowiedzi z faktów (§14.6) ──────────────────────────────
   Na SEEDZIE, jak `pasowania.test.ts`: scenariusz GX160 jest w nim kompletny.
   Pilnujemy czterech rzeczy: co idzie do dostawcy (i czego NIE), że model nie
   ma jak przemycić numeru spoza faktów, że zapis jest jedną transakcją bez
   treści w dzienniku, i że odczyt niczego nie mutuje.                        */

let db: typeof import("../db/db.js").db;
let config: typeof import("../config.js").config;
let S: typeof import("./copilot-szkic.js");
let P: typeof import("./pasowania.js");
let D: typeof import("./dobor.js");
let K: typeof import("./copilot-klasyfikacja.js");
let subiekt: typeof import("../context.js").subiekt;
let biuro = 0;
let konto = 0;
let rozmowa = 0;
let pytanie = 0;
const ID: Record<string, number> = {};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ subiekt } = await import("../context.js"));
  S = await import("./copilot-szkic.js");
  P = await import("./pasowania.js");
  D = await import("./dobor.js");
  K = await import("./copilot-klasyfikacja.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  for (const s of ["W09-0211", "LC170430140-0001", "06-12038"]) {
    const w = d.prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(s) as { tw_id: number } | undefined;
    assert.ok(w, `scenariusz GX160 wymaga kartoteki ${s} w seedzie`);
    ID[s] = w.tw_id;
  }
  d.prepare("INSERT OR REPLACE INTO sgt_stan(tw_id,mag_id,stan,stan_rez) VALUES (?,?,5,1)").run(ID["W09-0211"], config.magId.MAG);
  d.prepare("INSERT OR REPLACE INTO sgt_stan(tw_id,mag_id,stan,stan_rez) VALUES (?,?,3,0)").run(ID["LC170430140-0001"], config.magId.MAG);
});

beforeEach(() => {
  const d = db();
  for (const t of ["szkic_copilota", "copilot_wywolanie", "alias_silnika", "model_urzadzenia", "pasowanie_czesci", "dobor_rozmowy",
    "conversation_event", "message", "conversation", "offer_snapshot", "allegro_inbox_thread",
    "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')").run().lastInsertRowid);
  const n = "2026-09-07T10:00:00Z";
  /* Login siedzi w WĄTKU Allegro, a temat rozmowy to tytuł oferty — dokładnie
     ten układ, w którym klasyfikacja do 0.230.0 nie maskowała loginu. */
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES ('w-1',1,'zielony_ogrod','{}',?)`).run(n);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','Gaźnik Honda GX160 z kranikiem')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,'of-1','Gaźnik Honda GX160 z kranikiem','W09-0211',?)`).run(konto, n);
  pytanie = Number(d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at,related_object_type,related_object_id)
    VALUES (?,?,'m-1','incoming',?,?,'OFFER','of-1')`)
    .run(rozmowa, konto, "Dzień dobry, tu zielony_ogrod. Mam gaźnik z tej oferty, jaka uszczelka pod filtr? " +
      "Stary numer ABC-1234. Tel 601 234 567", n).lastInsertRowid);
});

const KTO = () => ({ id: biuro, name: "A. Lewandowska" });
const odpowiedz = (n: Partial<import("./copilot-szkic.js").OdpowiedzSzkicu> = {}) => ({
  /* Domyślna odpowiedź cytuje wyłącznie numer, który JEST w faktach (kartoteka
     oferty) — testy sprawdzenia dokładają własne numery świadomie. */
  tresc: "Dzień dobry, gaźnik W09-0211 jest dziś dostępny (F1).",
  /* `daneDoboru: null` domyślnie — testy propozycji dokładają dane świadomie,
     a reszta nie zmienia znaczenia przez sam fakt, że model coś rozpoznał. */
  uzyteFakty: ["F1"], zastrzezenia: [], daneDoboru: null, pasowanie: null, twierdzenia: [],
  model: "claude-opus-5", ms: 800,
  zuzycie: { wej: 2000, wyj: 300, cacheZapis: 0, cacheOdczyt: 1500 }, ...n,
});
const nadawca = (n: Partial<import("./copilot-szkic.js").OdpowiedzSzkicu> = {}): import("./copilot-szkic.js").NadawcaSzkicu =>
  async () => odpowiedz(n);
const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;

const zatwierdzPasowanie = () => P.rozstrzygnijPasowanie(P.zaproponujPasowanie({
  twId: ID["LC170430140-0001"], doTwId: ID["W09-0211"], rola: "uszczelka", pozycja: "od strony filtra",
  polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog 2024", zrodlo: "reczne",
}, { userId: biuro, name: "A. Lewandowska" })!.id, "zatwierdz", null, biuro);

/* ── Co idzie do dostawcy ──────────────────────────────────────────────── */

test("luki w kartotece liczy KOD i to na przykładzie właściciela", () => {
  /* Cewka do FS56: oferta wymienia jedenaście modeli, kartoteka zna dwa.
     Dziewięć pozostałych nikt nigdy nie wpisał, bo nikt ich nie zobaczył
     obok siebie — właśnie to ma zaznaczyć ta lista. */
  const luki = S.lukiZOferty({
    parametry: [{ nazwa: "Kod producenta", wartosci: ["4134 400 1306"] }],
    zgodnosc: ["STIHL FS120", "STIHL FS200", "STIHL FS250", "STIHL FR450", "STIHL BT120C"],
  }, "Kartoteka oferty: W02-0401 — CEWKA ZAPŁONOWA DO STIHL FS120 FS200; EAN brak");

  assert.deepEqual(luki, ["4134 400 1306", "FS250", "FR450", "BT120C"],
    "kartoteka zna FS120 i FS200, reszta jest okazją do uzupełnienia");
});

test("numer katalogowy z pola parametru zostaje W CAŁOŚCI, nie w kawałkach", () => {
  /* „4134 400 1306" rozbite na trzy liczby przestaje być numerem, po którym
     szuka człowiek. Pole to jedna wartość — czytamy je jako jedną. */
  assert.deepEqual(S.lukiZOferty(
    { parametry: [{ nazwa: "Numer katalogowy", wartosci: ["4134 400 1306"] }], zgodnosc: [] }, "nic"),
  ["4134 400 1306"]);
});

test("rok i sama liczba nie są oznaczeniem części", () => {
  /* Bez tego każda oferta motoryzacyjna zgłaszałaby zakres lat jako brak. */
  const luki = S.lukiZOferty(
    { parametry: [], zgodnosc: ["CITROËN C6 (TD_) 2005/09-2011/12 204KM/150kW"] }, "nic");
  assert.equal(luki.includes("2005/09-2011/12"), false);
  assert.deepEqual(luki, ["204KM/150kW"], "oznaczenie z literami zostaje, sam rok wypada");
});

test("oznaczenie zapisane inaczej niż w kartotece nie jest brakiem", () => {
  /* „STIHL FS 120" i „FS120" to ten sam model. Porównanie po `zwin`, tak jak
     przy danych doboru — inaczej spacja sprzedawcy robiłaby fałszywy brak. */
  assert.deepEqual(S.lukiZOferty(
    { parametry: [], zgodnosc: ["STIHL FS 120"] }, "CEWKA DO FS120"), []);
});

test("luki NIE wchodzą do faktów, bo to zdanie o nas, nie o maszynie klienta", () => {
  db().prepare(`UPDATE offer_snapshot SET pasuje_do_json=?,
      tresc_synced_at='2026-09-10T10:00:00Z' WHERE external_id='of-1'`)
    .run(JSON.stringify(["HONDA GX160", "HONDA GX999"]));

  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.ok(k.luki.includes("GX999"), "brak nie został policzony");
  const f = String(k.tekstFaktow);
  assert.equal(/brak w kartotece|luk|uzupełni/i.test(f), false,
    "lista braków poszła do modelu — ma ją widzieć wyłącznie agent");
});

test("treść oferty wchodzi do faktów i mówi o sobie, że jest słowem SPRZEDAWCY", () => {
  /* Właściciel: „często oferta ma w sobie opis, do jakich wersji pasuje,
     wymiary z oferty, dane techniczne". Fakt musi jednak nieść też to, że
     opis bywa starszy od towaru — inaczej model zrówna go z kartoteką. */
  db().prepare(`UPDATE offer_snapshot SET opis=?, parametry_json=?, pasuje_do_json=?,
      tresc_synced_at='2026-09-10T10:00:00Z' WHERE external_id='of-1'`)
    .run("Uszczelka o średnicy 46 mm, wysokość 12 mm.",
      JSON.stringify([{ nazwa: "Kod producenta", wartosci: ["16211-ZE1-000"] }]),
      JSON.stringify(["HONDA GX160", "HONDA GX200"]));

  const f = String(S.kontekstSzkicu(rozmowa, subiekt).tekstFaktow);
  assert.match(f, /średnicy 46 mm/);
  assert.match(f, /SŁOWA SPRZEDAWCY/, "opis nie mówi, skąd pochodzi");
  assert.match(f, /rację ma kartoteka/, "brak rozstrzygnięcia sporu opisu z kartoteką");
  assert.match(f, /Kod producenta: 16211-ZE1-000/);
  assert.match(f, /HONDA GX160 \| HONDA GX200/);
});

test("długa lista zgodności wchodzi przycięta i mówi, ile jej było", () => {
  const wersje = Array.from({ length: 214 }, (_, i) => `HONDA GX${100 + i}`);
  db().prepare("UPDATE offer_snapshot SET pasuje_do_json=? WHERE external_id='of-1'")
    .run(JSON.stringify(wersje));

  const f = String(S.kontekstSzkicu(rozmowa, subiekt).tekstFaktow);
  assert.match(f, /lista ma 214 pozycji, to są pierwsze 30/);
  assert.equal(f.includes("HONDA GX313"), false, "cała lista weszła do promptu");
});

test("uszkodzony JSON w snapshocie nie wywraca faktów", () => {
  db().prepare("UPDATE offer_snapshot SET parametry_json='to nie jest json' WHERE external_id='of-1'").run();
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.ok(k.fakty.length > 0);
  assert.equal(k.fakty.some((x) => x.rodzaj === "oferta_parametry"), false);
});

test("fakty niosą kartotekę oferty z dostępnością, pasowanie z pozycją i intake — bez nazwiska i loginu", () => {
  zatwierdzPasowanie();
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const f = String(k.tekstFaktow);
  assert.match(f, /Kartoteka oferty: W09-0211/);
  assert.match(f, /dostępne dziś: 4/, "stan minus rezerwacja, jak w wstawce parametrów");
  assert.match(f, /LC170430140-0001 pasuje do W09-0211/);
  assert.match(f, /od strony filtra/);
  assert.match(f, /katalog dostawcy, \d{1,2}\.\d{2}\.\d{4}/, "podpis dowodu z datą");
  assert.equal(f.includes("A. Lewandowska"), false, "nazwisko pracownika wyszło w faktach");
  assert.equal(f.includes("Lewandowska"), false);
  assert.equal(/zielony_ogrod/i.test(f), false, "login w faktach");
  assert.equal(/rezerwac|półk|regał/i.test(f), false, "półka albo rezerwacje w faktach (§10.4)");
  assert.ok(k.fakty.some((x) => x.rodzaj === "intake"), "bez potwierdzonego wyboru fakty niosą pytania intake");
  /* Typ części bierze się z DANYCH DOBORU, nie z treści pytania (blizna szarpaka) — tu ich nie ma. */
  assert.match(f, /zapytaj klienta TYLKO o to, czego w rozmowie jeszcze nie podał \(część\)/);
});

test("wątek idzie w całości, zamaskowany, z loginem z WĄTKU Allegro, nie z tematu", () => {
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-2','outgoing','Dzień dobry zielony_ogrod, sprawdzam gaźnik.','2026-09-07T11:00:00Z')`).run(rozmowa, konto);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const w = String(k.watek);
  assert.match(w, /^KLIENT: /);
  assert.match(w, /\nMY: /, "nasza odpowiedź też idzie — cały wątek");
  assert.equal(/zielony_ogrod/i.test(w), false, "login wyszedł mimo maskowania");
  assert.match(w, /\[login\]/);
  assert.equal(w.includes("601"), false, "telefon wyszedł");
  assert.match(w, /jaka uszczelka pod filtr/);
  assert.equal(k.ostatniaWiadomoscId, pytanie, "świeżość liczy się na ostatniej wiadomości KLIENTA");
});

test("fakt danych doboru niesie kanoniczny silnik ze słownika, gdy alias istnieje", async () => {
  const Sl = await import("./silniki.js");
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450", silnik: "Lonci v200" }, 1, biuro);
  let f = S.kontekstSzkicu(rozmowa, subiekt).fakty.find((x) => x.rodzaj === "dobor")!;
  assert.match(f.zdanie, /silnik Lonci v200(?!\s*\(wg)/);
  Sl.dodajAliasSilnika({ tekst: "Lonci v200", silnik: { rodzaj: "silnik", marka: "Loncin", nazwa: "V200" } },
    { userId: biuro, name: "A. Lewandowska" });
  f = S.kontekstSzkicu(rozmowa, subiekt).fakty.find((x) => x.rodzaj === "dobor")!;
  assert.match(f.zdanie, /silnik Lonci v200 \(wg słownika: silnik Loncin V200\)/);
});

test("intake milknie, gdy agent wybrał kandydata z potwierdzonym dowodem", () => {
  zatwierdzPasowanie();
  const w1 = D.zapiszDane(rozmowa, { oem: "W09-0211", nazwaCzesci: "uszczelka" }, D.doborRozmowy(rozmowa).wersja, biuro);
  D.wybierzKandydata(rozmowa, ID["LC170430140-0001"], "pasowanie", w1.wersja, biuro);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.equal(k.fakty.some((x) => x.rodzaj === "intake"), false, "przy dowodzie w bazie pytania o wymiary udawałyby niewiedzę");
  assert.match(String(k.tekstFaktow), /Część wybrana przez agenta: Do W09-0211 pasuje LC170430140-0001/);
  assert.match(String(k.tekstFaktow), /Dane doboru wpisane przez agenta: .*numer OEM lub symbol W09-0211/);
});

test("intake dobiera pytania po nazwie części z danych doboru", () => {
  D.zapiszDane(rozmowa, { nazwaCzesci: "nóż" }, D.doborRozmowy(rozmowa).wersja, biuro);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const i = k.fakty.find((x) => x.rodzaj === "intake")!;
  assert.match(i.zdanie, /\(nóż\)/);
  assert.match(i.zdanie, /otworu centralnego/);
  assert.deepEqual(S.pytaniaIntake("filtr powietrza").typ, "filtr");
  assert.deepEqual(S.pytaniaIntake(null).typ, "część");
});

test("kontekst niczego nie zapisuje", () => {
  const przed = [liczba("events"), liczba("copilot_wywolanie"), liczba("szkic_copilota"), liczba("conversation_event")];
  S.kontekstSzkicu(rozmowa, subiekt);
  S.kontekstSzkicu(rozmowa, subiekt);
  assert.deepEqual([liczba("events"), liczba("copilot_wywolanie"), liczba("szkic_copilota"), liczba("conversation_event")], przed);
});

test("odwołania (F…) znikają z treści PO sprawdzeniu, uzyteFakty zostaje", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Gaźnik W09-0211 pasuje (F1). Dziś dostępny (F1, F2) .", uzyteFakty: ["F1"],
  }), subiekt);
  assert.equal(s.tresc, "Gaźnik W09-0211 pasuje. Dziś dostępny.");
  assert.deepEqual(s.uzyteFakty, ["F1"]);
  assert.equal(S.bezZnacznikow("bez odwołań"), "bez odwołań");
});

/* ── Sprawdzenie deterministyczne ──────────────────────────────────────── */

test("ścieżka szczęśliwa: wiersz, księga „szkic”, zdarzenie bez treści, ślad na osi", async () => {
  zatwierdzPasowanie();
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Dzień dobry, do gaźnika W09-0211 pasuje uszczelka LC170430140-0001 (F3).", uzyteFakty: ["F1", "F3"],
  }), subiekt);
  assert.match(s.tresc, /LC170430140-0001/);
  assert.equal(s.messageId, pytanie);
  assert.equal(s.ocena, null);
  assert.equal(liczba("szkic_copilota"), 1);
  const ks = db().prepare("SELECT zadanie, wynik, tokeny_cache_odczyt FROM copilot_wywolanie").get() as Record<string, unknown>;
  assert.equal(ks.zadanie, "szkic");
  assert.equal(ks.wynik, "ok");
  assert.equal(Number(ks.tokeny_cache_odczyt), 1500);
  const zd = db().prepare("SELECT payload FROM events WHERE type='copilot_szkic'").get() as { payload: string };
  assert.equal(zd.payload.includes("Dzień dobry"), false, "treść szkicu w dzienniku (§19)");
  assert.match(zd.payload, /znakow/);
  const os = db().prepare("SELECT payload FROM conversation_event WHERE event_type='copilot_szkic'").get() as { payload: string };
  assert.equal(os.payload.includes("Dzień dobry"), false, "treść na osi — oś niesie tylko metadane");
  assert.deepEqual(S.szkicCopilota(rozmowa)?.uzyteFakty, ["F1", "F3"]);
});

test("numer BEZ deklaracji źródła odrzuca szkic: księga notuje błąd, wiersza nie ma", async () => {
  /* Do 0.252.0 odrzucał tu sam fakt, że numeru nie ma w bazie. Od 0.253.0
     odrzuca CISZA: model wolno sięgnąć do własnej wiedzy, ale nie wolno mu
     podać numeru, którego agent nie ma jak sprawdzić przed wysłaniem. */
  await assert.rejects(
    S.ulozSzkic(rozmowa, KTO(), nadawca({ tresc: "Pasuje uszczelka XYZ-9999 (F1)." }), subiekt),
    (e: Error) => /XYZ-9999/.test(e.message) && /odrzucony/.test(e.message));
  assert.equal(liczba("szkic_copilota"), 0);
  const ks = db().prepare("SELECT wynik, blad FROM copilot_wywolanie").get() as Record<string, string>;
  assert.equal(ks.wynik, "blad");
  assert.match(ks.blad, /^numer_niezadeklarowany: XYZ-9999/);
});

test("ten sam numer Z DEKLARACJĄ przechodzi i ląduje w oknie „skąd to wiem”", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Pasuje uszczelka XYZ-9999 (F1).",
    twierdzenia: [{
      teza: "Uszczelka XYZ-9999 bywa stosowana w tej serii gaźników",
      zrodlo: "model", odwolanie: null, pewnosc: "prawdopodobne",
    }],
  }), subiekt);
  assert.match(s.tresc, /XYZ-9999/);
  assert.equal(s.twierdzenia.length, 1);
  /* Model chciał „prawdopodobne", ale mówił z pamięci — serwer obniża. */
  assert.equal(s.twierdzenia[0].pewnosc, "niepewne");
  assert.equal(s.twierdzenia[0].obnizona, true);
});

test("pewność nie przeskoczy sufitu źródła, a w dół model może zawsze", () => {
  const f = S.ustalPewnosc({ teza: "W09-0211 jest na stanie", zrodlo: "fakty", odwolanie: "F1", pewnosc: "pewne" });
  assert.equal(f.pewnosc, "pewne");
  assert.equal(f.obnizona, false);

  /* Opis oferty to słowa sprzedawcy sprzed lat — najwyżej „prawdopodobne". */
  const o = S.ustalPewnosc({ teza: "Pasuje do 340", zrodlo: "oferta", odwolanie: "F4", pewnosc: "pewne" });
  assert.equal(o.pewnosc, "prawdopodobne");
  assert.equal(o.obnizona, true);

  /* Zejście niżej niż sufit to uczciwość, nie błąd — zostaje jak było. */
  const w = S.ustalPewnosc({ teza: "Zwykle ma gwint M10", zrodlo: "oferta", odwolanie: null, pewnosc: "niepewne" });
  assert.equal(w.pewnosc, "niepewne");
  assert.equal(w.obnizona, false);
});

test("twierdzenie bez tezy wypada, bo pusty wiersz wygląda na urwaną informację", () => {
  const l = S.ocenTwierdzenia([
    { teza: "  ", zrodlo: "fakty", odwolanie: "F1", pewnosc: "pewne" },
    { teza: "Gaźnik jest na stanie", zrodlo: "fakty", odwolanie: "F1", pewnosc: "pewne" },
  ]);
  assert.equal(l.length, 1);
  assert.equal(l[0].teza, "Gaźnik jest na stanie");
});

test("numer, który KLIENT napisał w rozmowie, wolno powtórzyć", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Numer ABC-1234, o którym Pan pisze, nie jest w naszej bazie; proszę o zdjęcie tabliczki (F1).",
  }), subiekt);
  assert.match(s.tresc, /ABC-1234/);
});

test("numery bez cyfr i miary nie są numerami — zwykłe słowa przechodzą", () => {
  assert.deepEqual(S.numerySpozaFaktow("Proszę o zdjęcie NOŻA i pomiar 148 mm — GX160 pasuje.", "F1: GX160"), []);
  assert.deepEqual(S.numerySpozaFaktow("Pasuje 17211-ZL8-023 i 5901234567890.", "F1: nic"), ["17211-ZL8-023", "5901234567890"]);
});

test("fakt spoza listy i za długi szkic też są odrzucane z zapisem w księdze", async () => {
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), nadawca({ uzyteFakty: ["F99"] }), subiekt), /F99/);
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), nadawca({ tresc: "x".repeat(2001), uzyteFakty: [] }), subiekt), /2000/);
  assert.equal(liczba("szkic_copilota"), 0);
  const b = db().prepare("SELECT blad FROM copilot_wywolanie ORDER BY id").all() as Array<{ blad: string }>;
  assert.match(b[0]!.blad, /^fakt_spoza_listy/);
  assert.match(b[1]!.blad, /^za_dlugi/);
});

test("odmowa dostawcy ląduje w księdze jako błąd i idzie dalej do trasy", async () => {
  const { BladPrzeciazeniaCopilota } = await import("../adapters/copilot.js");
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), async () => {
    throw new BladPrzeciazeniaCopilota("Anthropic jest chwilowo przeciążone (529).", 529, "overloaded_error 529 req_1");
  }, subiekt), BladPrzeciazeniaCopilota);
  const ks = db().prepare("SELECT wynik, blad FROM copilot_wywolanie").get() as Record<string, string>;
  assert.equal(ks.wynik, "blad");
  assert.match(ks.blad, /overloaded_error 529 req_1/, "do księgi idzie ślad, nie zdanie");
});

/* ── Cykl życia propozycji ─────────────────────────────────────────────── */

test("drugi szkic nadpisuje pierwszy i zeruje ocenę; ocena spoza listy odmawia", async () => {
  await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  assert.deepEqual(S.ocenSzkic(rozmowa, "wstawiony", KTO()), { ocena: "wstawiony" });
  assert.equal(S.szkicCopilota(rozmowa)?.ocena, "wstawiony");
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ tresc: "Druga wersja (F1)." }), subiekt);
  assert.equal(liczba("szkic_copilota"), 1, "jeden wiersz na rozmowę");
  assert.equal(S.szkicCopilota(rozmowa)?.ocena, null, "nowa propozycja — stara ocena jej nie dotyczy");
  assert.throws(() => S.ocenSzkic(rozmowa, "super", KTO()), /wstawiony/);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE type='copilot_szkic_ocena'").get());
});

test("szkic nie rusza statusu, wersji ani szkicu AGENTA", async () => {
  const { zapiszSzkic } = await import("./conversations.js");
  zapiszSzkic(rozmowa, biuro, "mój własny szkic", pytanie, null);
  const przed = db().prepare("SELECT status, version FROM conversation WHERE id=?").get(rozmowa);
  await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  assert.deepEqual(db().prepare("SELECT status, version FROM conversation WHERE id=?").get(rozmowa), przed);
  assert.equal((db().prepare("SELECT body FROM conversation_draft WHERE conversation_id=?").get(rozmowa) as { body: string }).body,
    "mój własny szkic", "propozycja modelu nie ma prawa dotknąć szkicu agenta");
});

test("pomiar rozbija księgę po zadaniu i liczy losy szkiców", async () => {
  await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  S.ocenSzkic(rozmowa, "zastapiony", KTO());
  const p = K.pomiarCopilota(db());
  const sz = p.wgZadania.find((z) => z.zadanie === "szkic");
  assert.ok(sz, "brak zadania „szkic” w rozbiciu");
  assert.equal(sz.wywolan, 1);
  assert.ok(sz.kosztUsd > 0);
  assert.deepEqual(p.szkice, {
    ile: 1, wstawionych: 0, zastapionych: 1, odrzuconych: 0,
    daneZaproponowane: 0, daneWpisane: 0, daneOdrzucone: 0,
    pasowaniaRozpoznane: 0, pasowaniaZaproponowane: 0, pasowaniaOdrzucone: 0, pasowaniaZatwierdzonePrzezBiuro: 0,
  });
});

/* ── Dane doboru z rozmowy (przyrost trzeci) ───────────────────────────────
   Pytanie właściciela z 8.09.2026: „dlaczego dane wejściowe nie zostały
   wprowadzone automatycznie ze szkicu?". Pilnujemy czterech granic: wartość
   spoza rozmowy wypada (model nie może DOPISAĆ), wartość zamaskowana nie
   wraca, samo ułożenie NIE dotyka `dobor_rozmowy`, a kliknięcie wpisuje
   WYŁĄCZNIE w puste pola i idzie drogą ręcznego zapisu (wersja, 409). */

const DANE = (n: Partial<import("./dobor.js").DaneDoboru> = {}): import("./dobor.js").DaneDoboru => ({
  marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null,
  silnik: null, oem: null, nazwaCzesci: null, parametry: {}, ...n,
});

const dopiszKlienta = (tresc: string) => db().prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,?,'incoming',?,?)`)
  .run(rozmowa, konto, `m-${Date.now()}-${Math.random()}`, tresc, "2026-09-08T09:00:00Z");

test("wartość z rozmowy zostaje, zmyślona wypada — po zwinięciu numeru i po rdzeniu słowa", () => {
  const w = "KLIENT: Mam kosiarkę Faworyt GTV51N196L-4W1 z silnikiem Lonci v200, szukam śrubę do noża. OEM 532 19 93-77.";
  assert.equal(S.wartoscZRozmowy("Faworyt", w), true);
  assert.equal(S.wartoscZRozmowy("GTV51N196L-4W1", w), true);
  assert.equal(S.wartoscZRozmowy("Lonci v200", w), true);
  assert.equal(S.wartoscZRozmowy("śruba noża", w), true, "odmiana: „śrubę do noża” pokrywa „śruba noża”");
  assert.equal(S.wartoscZRozmowy("532199377", w), true, "„532 19 93-77” to ten sam numer po zwinięciu");
  /* Rdzeń czterech liter przepuszcza „Loncin" przy „Lonci" w rozmowie — to
     zapisana cena reguły odmiany, nie zaproszenie: instrukcja każe pisać
     dosłownie, a poprawia agent. */
  assert.equal(S.wartoscZRozmowy("Loncin", w), true);
  assert.equal(S.wartoscZRozmowy("Husqvarna", w), false, "marki nie ma w rozmowie");
  assert.equal(S.wartoscZRozmowy("GTV51N196L-4W2", w), false, "inny numer");
  assert.equal(S.wartoscZRozmowy("", w), false);
  const p = S.oczyscPropozycje(DANE({ marka: "Faworyt", model: "GX160", nazwaCzesci: "śruba noża",
    parametry: { "klucz": "16", "długość": "50 mm" } }), w + " Klucz 16.");
  assert.deepEqual(p.dane, DANE({ marka: "Faworyt", nazwaCzesci: "śruba noża", parametry: { klucz: "16" } }));
  assert.equal(p.odrzuconych, 2, "GX160 i „50 mm” nie stoją w rozmowie");
  assert.deepEqual(S.oczyscPropozycje(DANE({ model: "GX160" }), w), { dane: null, odrzuconych: 1 });
  assert.deepEqual(S.oczyscPropozycje(null, w), { dane: null, odrzuconych: 0 });
});

test("ułożenie zapisuje propozycję sprawdzoną przeciw rozmowie i NIE dotyka doboru", async () => {
  dopiszKlienta("Kosiarka Faworyt GTV51N196L-4W1, silnik Lonci v200, szukam śruby noża.");
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    daneDoboru: DANE({ marka: "Faworyt", model: "GTV51N196L-4W1", silnik: "Lonci v200",
      nazwaCzesci: "śruba noża", oem: "17211-ZL8-023" }),
  }), subiekt);
  assert.deepEqual(s.daneDoboru, DANE({ marka: "Faworyt", model: "GTV51N196L-4W1", silnik: "Lonci v200",
    nazwaCzesci: "śruba noża" }), "OEM spoza rozmowy wypadł, reszta została");
  assert.equal(s.daneOcena, null);
  assert.equal(s.doborWersja, 1);
  assert.equal(liczba("dobor_rozmowy"), 0, "samo ułożenie wpisało coś do doboru");
  assert.equal(D.doborRozmowy(rozmowa).status, "not_started");
  const zd = db().prepare("SELECT payload FROM events WHERE type='copilot_szkic'").get() as { payload: string };
  assert.match(zd.payload, /"polDoboru":4/);
  assert.match(zd.payload, /"polOdrzuconych":1/);
  assert.equal(zd.payload.includes("Faworyt"), false, "wartość w dzienniku (§19)");
});

test("wartość zamaskowana nie wraca do danych — telefon podany jako numer seryjny wypada", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    daneDoboru: DANE({ nrSeryjny: "601 234 567", nazwaCzesci: "uszczelka" }),
  }), subiekt);
  assert.deepEqual(s.daneDoboru, DANE({ nazwaCzesci: "uszczelka" }));
});

test("„Wpisz do danych” wpisuje TYLKO puste pola drogą ręcznego zapisu: wersja, status, dziennik, 409", async () => {
  dopiszKlienta("Kosiarka Faworyt GTV51N196L-4W1, silnik Lonci v200, klucz 16.");
  /* Agent wpisał model sam, inaczej niż model to widzi — jego słowo zostaje. */
  D.zapiszDane(rozmowa, { model: "GTV51" }, 1, biuro);
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    daneDoboru: DANE({ marka: "Faworyt", model: "GTV51N196L-4W1", silnik: "Lonci v200", parametry: { klucz: "16" } }),
  }), subiekt);
  assert.equal(s.doborWersja, 2);
  assert.throws(() => S.przyjmijDaneDoboru(rozmowa, 1, KTO()), /odśwież/, "stara wersja doboru musi dać konflikt");
  const po = S.przyjmijDaneDoboru(rozmowa, 2, KTO());
  assert.equal(po.daneOcena, "wpisane");
  const d = D.doborRozmowy(rozmowa);
  assert.equal(d.wersja, 3);
  assert.equal(d.status, "searching");
  assert.deepEqual(d.dane, DANE({ marka: "Faworyt", model: "GTV51", silnik: "Lonci v200", parametry: { klucz: "16" } }));
  const typy = (db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>).map((e) => e.type);
  assert.ok(typy.includes("dobor_dane") && typy.includes("copilot_dane_doboru"));
  const los = db().prepare("SELECT payload FROM events WHERE type='copilot_dane_doboru'").get() as { payload: string };
  assert.match(los.payload, /"pol":3/);
  assert.equal(los.payload.includes("Faworyt"), false);
  assert.throws(() => S.przyjmijDaneDoboru(rozmowa, 3, KTO()), /już oceniona/);
  assert.equal(K.pomiarCopilota(db()).szkice.daneWpisane, 1);
});

test("odrzucenie zostawia wiersz dla pomiaru; nowy szkic zeruje ocenę danych", async () => {
  dopiszKlienta("Kosiarka Faworyt.");
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ daneDoboru: DANE({ marka: "Faworyt" }) }), subiekt);
  assert.equal(S.odrzucDaneDoboru(rozmowa, KTO()).daneOcena, "odrzucone");
  assert.equal(K.pomiarCopilota(db()).szkice.daneOdrzucone, 1);
  assert.equal(liczba("dobor_rozmowy"), 0);
  const znow = await S.ulozSzkic(rozmowa, KTO(), nadawca({ daneDoboru: DANE({ marka: "Faworyt" }) }), subiekt);
  assert.equal(znow.daneOcena, null);
  assert.throws(() => S.odrzucDaneDoboru(rozmowa + 1000, KTO()), /nie ma propozycji/);
});

/* ── Pasowanie z rozmowy (przyrost czwarty) ─────────────────────────────────
   Zapowiedź z 0.230.0. Pilnujemy trzech granic właściciela: oba końce pary
   muszą być kartotekami, które serwer SAM położył na stole (biała lista
   z kontekstu — nigdy symbol z treści wiadomości), para wypada bez szkody
   dla szkicu, a do kolejki wiedzy wchodzi dopiero na kliknięcie agenta,
   jako propozycja ze źródłem `copilot`, którą rozstrzyga biuro. */

const PARA = (n: Partial<import("./copilot-szkic.js").PasowanieZRozmowy> = {}) =>
  ({ czesc: "LC170430140-0001", doCzego: "W09-0211", rola: "uszczelka", pozycja: null, ...n });

test("biała lista kartotek: oferta zawsze, kotwica po wpisaniu symbolu przez agenta — kontekst nic nie zapisuje", () => {
  let k = S.kontekstSzkicu(rozmowa, subiekt);
  const ma = (sym: string) => [...k.kartoteki.values()].some((x) => x.symbol === sym);
  assert.equal(ma("W09-0211"), true, "kartoteka oferty stoi na liście");
  assert.equal(ma("LC170430140-0001"), false, "uszczelki nikt jeszcze nie wskazał");
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  const przed = liczba("events");
  k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.equal(ma("LC170430140-0001"), true, "symbol wpisany przez agenta jest kotwicą, więc i kartoteką z kontekstu");
  assert.equal(liczba("events"), przed, "kontekst niczego nie zapisuje");
});

test("sprawdzPasowanie: symbole po zwinięciu, cztery powody odrzucenia, pozycja tylko z rozmowy", () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const w = String(k.watek);
  const ok = S.sprawdzPasowanie(PARA({ czesc: "lc 170430140-0001", doCzego: "w09 0211" }), k.kartoteki, w);
  assert.equal(ok.powod, null);
  assert.equal(ok.propozycja!.czesc.twId, ID["LC170430140-0001"], "symbol trafia po zwinięciu, jak wszędzie");
  assert.equal(ok.propozycja!.doCzego.twId, ID["W09-0211"]);
  assert.equal(ok.propozycja!.rola, "uszczelka");
  assert.equal(S.sprawdzPasowanie(PARA({ czesc: "06-12038" }), k.kartoteki, w).powod, "symbol_spoza_kontekstu",
    "uszczelka z seedu, ale NIE z kontekstu — model nie ma jak jej nazwać");
  assert.equal(S.sprawdzPasowanie(PARA({ czesc: "W09-0211" }), k.kartoteki, w).powod, "ta_sama_kartoteka");
  assert.equal(S.sprawdzPasowanie(PARA({ rola: "kolo" }), k.kartoteki, w).powod, "zla_rola");
  assert.equal(S.sprawdzPasowanie(null, k.kartoteki, w).powod, null);
  /* Pozycja: „od strony filtra" stoi w fakcie intake, nie w rozmowie — wypada, para zostaje. */
  const bez = S.sprawdzPasowanie(PARA({ pozycja: "od strony filtra" }), k.kartoteki, w);
  assert.equal(bez.propozycja!.pozycja, null);
  dopiszKlienta("Chodzi o uszczelkę od strony filtra.");
  const z = S.sprawdzPasowanie(PARA({ pozycja: "od strony filtra" }), k.kartoteki, String(S.kontekstSzkicu(rozmowa, subiekt).watek));
  assert.equal(z.propozycja!.pozycja, "od strony filtra");
  /* Para już żywa w bazie — w dowolnej polaryzacji — wypada. */
  zatwierdzPasowanie();
  assert.equal(S.sprawdzPasowanie(PARA(), k.kartoteki, w).powod, "juz_jest");
});

test("ułożenie zapisuje parę przy szkicu i NIE dotyka pasowań; para spoza kontekstu wypada, szkic zostaje", async () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA() }), subiekt);
  assert.deepEqual(s.pasowanie, {
    czesc: { twId: ID["LC170430140-0001"], symbol: "LC170430140-0001", nazwa: "Uszczelka do gaźników GX160 (od strony filtra)" },
    doCzego: { twId: ID["W09-0211"], symbol: "W09-0211", nazwa: "Gaźnik do silników HONDA GX160 z kranikiem i odsto" },
    rola: "uszczelka", pozycja: null,
  });
  assert.equal(s.pasowanieOcena, null);
  assert.equal(liczba("pasowanie_czesci"), 0, "samo ułożenie nic nie wkłada do kolejki wiedzy");
  let zd = db().prepare("SELECT payload FROM events WHERE type='copilot_szkic' ORDER BY id DESC").get() as { payload: string };
  assert.match(zd.payload, /"pasowanie":1/);
  assert.match(zd.payload, /"pasowanieOdrzucone":null/);
  const bez = await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA({ czesc: "06-12038" }) }), subiekt);
  assert.equal(bez.pasowanie, null);
  assert.equal(bez.tresc.length > 0, true, "szkic jest wart pieniędzy sam w sobie");
  zd = db().prepare("SELECT payload FROM events WHERE type='copilot_szkic' ORDER BY id DESC").get() as { payload: string };
  assert.match(zd.payload, /"pasowanieOdrzucone":"symbol_spoza_kontekstu"/);
  assert.equal(zd.payload.includes("06-12038"), false, "symbol w dzienniku (§19)");
});

test("„Zaproponuj pasowanie”: propozycja ze źródłem copilot, dowodem rozmowa i podpisem agenta; rozstrzyga biuro", async () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  dopiszKlienta("Chodzi o uszczelkę od strony filtra.");
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA({ pozycja: "od strony filtra" }) }), subiekt);
  const po = S.przyjmijPasowanie(rozmowa, KTO());
  assert.equal(po.pasowanieOcena, "zaproponowane");
  const kolejka = P.kolejkaPasowan().propozycje;
  assert.equal(kolejka.length, 1);
  const z = kolejka[0]!;
  assert.equal(z.zrodlo, "copilot");
  assert.equal(z.rodzajDowodu, "rozmowa");
  assert.equal(z.pewnosc, "prawdopodobne", "ślad rozmowy nie jest dowodem technicznym");
  assert.equal(z.conversationId, rozmowa);
  assert.equal(z.zaproponowal, "A. Lewandowska", "autorem jest klikający, nie automat");
  assert.equal(z.pozycja, "od strony filtra");
  assert.match(z.dowodTresc, /^Copilot rozpoznał w rozmowie #\d+: LC170430140-0001 pasuje do W09-0211 \(od strony filtra\)/);
  const typy = (db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>).map((e) => e.type);
  assert.ok(typy.includes("pasowanie_propozycja") && typy.includes("copilot_pasowanie"));
  const los = db().prepare("SELECT payload FROM events WHERE type='copilot_pasowanie'").get() as { payload: string };
  assert.match(los.payload, /"dubel":false/);
  assert.throws(() => S.przyjmijPasowanie(rozmowa, KTO()), /już oceniona/);
  assert.throws(() => S.odrzucPasowanie(rozmowa, KTO()), /już oceniona/);
  let pomiar = K.pomiarCopilota(db()).szkice;
  assert.equal(pomiar.pasowaniaRozpoznane, 1);
  assert.equal(pomiar.pasowaniaZaproponowane, 1);
  assert.equal(pomiar.pasowaniaZatwierdzonePrzezBiuro, 0);
  P.rozstrzygnijPasowanie(z.id, "zatwierdz", null, biuro);
  pomiar = K.pomiarCopilota(db()).szkice;
  assert.equal(pomiar.pasowaniaZatwierdzonePrzezBiuro, 1, "właściwa miara: biuro zatwierdza to, co Copilot widzi");
});

test("dubel nie jest błędem: para wpisana ręcznie między szkicem a kliknięciem daje ocenę bez drugiego wiersza", async () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA() }), subiekt);
  P.zaproponujPasowanie({ twId: ID["LC170430140-0001"], doTwId: ID["W09-0211"], rola: "uszczelka",
    polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog", zrodlo: "reczne" },
    { userId: biuro, name: "A. Lewandowska" });
  const po = S.przyjmijPasowanie(rozmowa, KTO());
  assert.equal(po.pasowanieOcena, "zaproponowane");
  assert.equal(liczba("pasowanie_czesci"), 1, "drugiego wiersza nie ma");
  const los = db().prepare("SELECT payload FROM events WHERE type='copilot_pasowanie'").get() as { payload: string };
  assert.match(los.payload, /"dubel":true/);
});

test("odrzucenie pary zostawia wiersz dla pomiaru; nowy szkic zeruje ocenę pary", async () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA() }), subiekt);
  assert.equal(S.odrzucPasowanie(rozmowa, KTO()).pasowanieOcena, "odrzucone");
  assert.equal(liczba("pasowanie_czesci"), 0);
  assert.equal(K.pomiarCopilota(db()).szkice.pasowaniaOdrzucone, 1);
  const znow = await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA() }), subiekt);
  assert.equal(znow.pasowanieOcena, null);
  assert.throws(() => S.przyjmijPasowanie(rozmowa + 1000, KTO()), /nie ma propozycji pasowania/);
});

test("rozmowa bez wiadomości nie ma na co odpowiadać", async () => {
  db().prepare("DELETE FROM message").run();
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt), /żadnej wiadomości/);
  assert.equal(liczba("copilot_wywolanie"), 0, "bez wiadomości nic nie kosztuje");
});
