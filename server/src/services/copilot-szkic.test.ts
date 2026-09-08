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
  uzyteFakty: ["F1"], zastrzezenia: [], daneDoboru: null, model: "claude-opus-5", ms: 800,
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

test("numer spoza faktów odrzuca szkic: księga notuje błąd, wiersza nie ma", async () => {
  await assert.rejects(
    S.ulozSzkic(rozmowa, KTO(), nadawca({ tresc: "Pasuje uszczelka XYZ-9999 (F1)." }), subiekt),
    (e: Error) => /XYZ-9999/.test(e.message) && /odrzucony/.test(e.message));
  assert.equal(liczba("szkic_copilota"), 0);
  const ks = db().prepare("SELECT wynik, blad FROM copilot_wywolanie").get() as Record<string, string>;
  assert.equal(ks.wynik, "blad");
  assert.match(ks.blad, /^numer_spoza_faktow: XYZ-9999/);
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

test("rozmowa bez wiadomości nie ma na co odpowiadać", async () => {
  db().prepare("DELETE FROM message").run();
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt), /żadnej wiadomości/);
  assert.equal(liczba("copilot_wywolanie"), 0, "bez wiadomości nic nie kosztuje");
});
