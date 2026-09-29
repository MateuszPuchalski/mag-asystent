import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dobor-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Dobór przy rozmowie (`docs/dobor-od-zera.md`) ───────────────────────────
   Granice, które kosztują najwięcej, gdy pękną: odczyt nic nie zapisuje,
   cudze dane nie giną po cichu (wersja), wynik „ta część" nie bierze się
   z niczego, a zdanie do szkicu nie mówi „pasuje" bez dowodu w wiedzy. */

let db: typeof import("../db/db.js").db;
let D: typeof import("./dobor.js");
let ConversationConflict: typeof import("./conversations.js").ConversationConflict;
let W: typeof import("./wiedza.js");
let S: typeof import("./silniki.js");
let P: typeof import("./pasowania.js");

let biuro = 0;
let rozmowa = 0;
const SZARPAK = 501;
const SZARPAK_ALT = 502;
const NAC = { rodzaj: "maszyna" as const, marka: "NAC", nazwa: "LS 46-450" };
const BS450 = { rodzaj: "silnik" as const, marka: "Briggs & Stratton", nazwa: "450E" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./dobor.js");
  ({ ConversationConflict } = await import("./conversations.js"));
  W = await import("./wiedza.js");
  S = await import("./silniki.js");
  P = await import("./pasowania.js");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(SZARPAK, "SZR-148/82", "Szarpak 148 mm");
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(SZARPAK_ALT, "SZR-150/82", "Szarpak 150 mm");
});

beforeEach(() => {
  const d = db();
  /* Wiedza PRZED użytkownikami: jej autor wskazuje na `app_user` bez kaskady. */
  for (const t of ["pasowanie_czesci", "dowod_zastosowania", "zastosowanie", "alias_silnika", "zabudowa_silnika",
    "model_urzadzenia", "dobor", "conversation_event", "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  const konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','zielony_ogrod')`).run(konto).lastInsertRowid);
});

const liczba = (tabela: string) => (db().prepare(`SELECT count(*) n FROM ${tabela}`).get() as { n: number }).n;
const os_ = () => (db().prepare(`SELECT payload FROM conversation_event
  WHERE conversation_id=? AND event_type='dobor_wynik' ORDER BY id`).all(rozmowa) as Array<{ payload: string }>)
  .map((z) => JSON.parse(z.payload) as Record<string, unknown>);
const autor = () => ({ userId: biuro, name: "A. Lewandowska" });
const czesc = (twId: number, wersja: number, podstawa: "numer" | "wiedza" | "podobne" | "reczny" = "numer") =>
  D.ustawWynik(rozmowa, { wynik: "czesc", twId, podstawa }, wersja, biuro);

test("bez wiersza dobór jest pusty, a odczyt niczego nie zapisuje", () => {
  const d = D.doborRozmowy(rozmowa);
  assert.equal(d.stan, "pusty");
  assert.equal(d.wynik, null);
  assert.equal(d.wersja, 1);
  assert.equal(liczba("dobor"), 0, "odczyt założył wiersz");
  assert.equal(liczba("events"), 0, "odczyt dopisał zdarzenie");
  D.wiedzaDoboru(rozmowa);
  assert.equal(liczba("dobor") + liczba("events"), 0);
  assert.throws(() => D.doborRozmowy(rozmowa + 999), /Nie znaleziono rozmowy/);
});

test("zapis danych zapisuje tylko zmienione pola, podnosi wersję i otwiera dobór", () => {
  const d = D.zapiszDane(rozmowa, { marka: " NAC ", model: "LS 46-450" }, 1, biuro);
  assert.equal(d.wersja, 2);
  assert.equal(d.dane.marka, "NAC", "wartości są przycinane");
  /* Stan jest wyliczany: dane są, wyniku nie ma. Nic go nie zapisało. */
  assert.equal(d.stan, "otwarty");
  assert.equal(d.zmienil, "A. Lewandowska");
  assert.equal(d.zmienilAutomat, false);
  const audyt = db().prepare("SELECT type, payload FROM events").all() as Array<{ type: string; payload: string }>;
  assert.deepEqual(audyt.map((a) => a.type), ["dobor_dane"]);
  assert.match(audyt[0].payload, /"marka":\{"z":null,"na":"NAC"\}/);
  assert.doesNotMatch(audyt[0].payload, /wariant/, "niezmienione pole nie trafia do śladu");
  /* Zapis bez zmian nie podnosi wersji koledze ani nie zostawia śladu. */
  assert.equal(D.zapiszDane(rozmowa, { marka: "NAC " }, 2, biuro).wersja, 2);
  assert.equal(liczba("events"), 1);
});

test("automat podpisuje się jako automat i nie ma konta", () => {
  const d = D.zapiszDane(rozmowa, { nazwaCzesci: "szarpak" }, 1, { automat: "szkic" });
  assert.equal(d.zmienil, "automat (szkic)");
  assert.equal(d.zmienilAutomat, true);
  assert.equal((db().prepare("SELECT zmienil_user_id u FROM dobor").get() as { u: number | null }).u, null);
});

test("nieaktualna wersja to 409 z bieżącym stanem — w obu zapisach", () => {
  D.zapiszDane(rozmowa, { marka: "NAC" }, 1, biuro);
  const konflikt = (e: unknown) => {
    assert.ok(e instanceof ConversationConflict);
    assert.equal(e.details.wersja, 2);
    assert.equal(e.details.zmienil, "A. Lewandowska");
    assert.equal((e.details.dobor as { dane: { marka: string } }).dane.marka, "NAC");
    return true;
  };
  assert.throws(() => D.zapiszDane(rozmowa, { model: "LS 46-450" }, 1, biuro), konflikt);
  assert.throws(() => D.ustawWynik(rozmowa, { wynik: "brak" }, 1, biuro), konflikt);
  assert.equal(D.doborRozmowy(rozmowa).dane.model, null);
  assert.equal(D.doborRozmowy(rozmowa).wynik, null);
});

test("wynik „ta część” wymaga kartoteki z bazy i podstawy z listy", () => {
  assert.throws(() => D.ustawWynik(rozmowa, { wynik: "czesc", podstawa: "numer" }, 1, biuro), /wymaga wybranej kartoteki/);
  assert.throws(() => D.ustawWynik(rozmowa, { wynik: "czesc", twId: SZARPAK }, 1, biuro), /wymaga podstawy/);
  assert.throws(() => D.ustawWynik(rozmowa, { wynik: "czesc", twId: SZARPAK, podstawa: "wymiar" as never }, 1, biuro),
    /wymaga podstawy/);
  assert.throws(() => czesc(999999, 1), /Nie ma takiej kartoteki/);
  assert.throws(() => D.ustawWynik(rozmowa, { wynik: "pasuje" as never }, 1, biuro), /Nieznany wynik/);
  assert.equal(liczba("dobor"), 0, "odmowa niczego nie zapisała");
  /* Symbol idzie Z BAZY, nie z żądania. */
  const d = czesc(SZARPAK, 1);
  assert.equal(d.stan, "czesc");
  assert.equal(d.wybrany?.symbol, "SZR-148/82");
  assert.equal(d.wybrany?.podstawa, "numer");
});

test("„dopytać” wymaga zdania, a wynik null otwiera dobór ponownie", () => {
  assert.throws(() => D.ustawWynik(rozmowa, { wynik: "dopytac", dopytac: "  " }, 1, biuro), /czego brakuje/);
  let d = D.ustawWynik(rozmowa, { wynik: "dopytac", dopytac: "numer z tabliczki" }, 1, biuro);
  assert.equal(d.dopytac, "numer z tabliczki");
  d = D.ustawWynik(rozmowa, { wynik: null }, d.wersja, biuro);
  assert.equal(d.wynik, null);
  assert.equal(d.dopytac, null, "zdanie należało do wyniku, którego już nie ma");
  assert.equal(d.stan, "pusty");
  assert.deepEqual(os_().map((p) => [p.przed, p.po, p.autor]),
    [[null, "dopytac", "A. Lewandowska"], ["dopytac", null, "A. Lewandowska"]]);
  assert.deepEqual((db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>).map((e) => e.type),
    ["dobor_wynik", "dobor_wynik"]);
});

/* ── Zdanie do szkicu: „pasuje" wyłącznie przy potwierdzonym wpisie ───────── */

test("bez podparcia w wiedzy zdanie NIGDY nie mówi samego „pasuje” — przy każdej podstawie", () => {
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  const zdania = (["numer", "wiedza", "podobne", "reczny"] as const).map((podstawa, i) =>
    czesc(SZARPAK, 2 + i, podstawa).wybrany!.zdanieDoSzkicu);
  assert.equal(zdania[0], "SZR-148/82 to część o numerze z pytania klienta; zgodności z NAC LS 46-450 baza wiedzy nie potwierdza.");
  assert.equal(zdania[1], "Do NAC LS 46-450 prawdopodobnie pasuje SZR-148/82 — źródło: wpis bazy wiedzy bez potwierdzenia;"
    + " bez potwierdzonego zastosowania.");
  assert.match(zdania[2], /źródło: trafienie po nazwie — nie dowód; bez potwierdzonego/);
  assert.match(zdania[3], /źródło: wskazane ręcznie przez agenta; bez potwierdzonego/);
  for (const z of zdania) assert.doesNotMatch(z, /(?<!prawdopodobnie )pasuje SZR/, z);
});

test("bez maszyny zdanie mówi, że to przypuszczenie; numer mówi tylko o numerze", () => {
  assert.equal(czesc(SZARPAK, 1, "reczny").wybrany!.zdanieDoSzkicu,
    "SZR-148/82 — źródło: wskazane ręcznie przez agenta; dobór bez wskazanej maszyny — to przypuszczenie.");
  assert.equal(czesc(SZARPAK, 2, "numer").wybrany!.zdanieDoSzkicu, "SZR-148/82 to część o numerze z pytania klienta.");
});

test("zatwierdzone zastosowanie z dowodem technicznym daje „pasuje” ze źródłem, bez nazwiska", () => {
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  const z = W.zaproponujZastosowanie({ twId: SZARPAK, model: NAC, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "pomiar_wlasny", tresc: "rozstaw 148 mm" } }, autor())!;
  W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);
  const zdanie = czesc(SZARPAK, 2, "wiedza").wybrany!.zdanieDoSzkicu;
  assert.match(zdanie, /^Do NAC LS 46-450 pasuje SZR-148\/82 — źródło: potwierdzone zastosowanie do NAC LS 46-450 — pomiar własny, /);
  assert.doesNotMatch(zdanie, /Lewandowska/, "nazwisko pracownika w zdaniu dla klienta");
  assert.match(zdanie, /pomiar własny, \d{1,2}\.\d{2}\.\d{4}\.$/, "źródło z datą zostaje");
});

test("warunek wpisu: nieznany zbija do „prawdopodobnie”, złamany mówi „może nie pasować”", () => {
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  const z = W.zaproponujZastosowanie({ twId: SZARPAK, model: NAC, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "producent", tresc: "IPL 2024" }, warunki: { seryjnyOd: "175000000" } }, autor())!;
  W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);
  czesc(SZARPAK, 2, "wiedza");
  assert.match(D.doborRozmowy(rozmowa).wybrany!.zdanieDoSzkicu,
    /^Do NAC LS 46-450 prawdopodobnie pasuje SZR-148\/82 — źródło: potwierdzone zastosowanie do NAC LS 46-450 \(nr seryjny od 175000000\)/);
  /* Dopisany numer seryjny doprecyzowuje maszynę, więc wybór zostaje,
     a zdanie liczy się od nowa z bieżących danych. */
  D.zapiszDane(rozmowa, { nrSeryjny: "175 000 001" }, 3, biuro);
  assert.match(D.doborRozmowy(rozmowa).wybrany!.zdanieDoSzkicu, /^Do NAC LS 46-450 pasuje SZR-148\/82 — źródło: potwierdzone/);
  /* Inny numer to inny egzemplarz: wybór schodzi i trzeba wybrać od nowa. */
  assert.equal(D.zapiszDane(rozmowa, { nrSeryjny: "174999999" }, 4, biuro).wybrany, null);
  assert.match(czesc(SZARPAK, 5, "wiedza").wybrany!.zdanieDoSzkicu, new RegExp("^SZR-148/82 do NAC LS 46-450 może nie pasować"
    + " — wpis obejmuje nr seryjny od 175000000, a w doborze nr 174999999; źródło: potwierdzone zastosowanie"));
});

const zabuduj = (rodzajDowodu: "producent" | "rozmowa" = "producent") => S.rozstrzygnijZabudowe(S.zaproponujZabudowe({
  maszyna: NAC, silnik: BS450, rodzajDowodu, dowodTresc: "karta katalogowa", zrodlo: "reczne" }, autor())!.id,
"zatwierdz", null, biuro);
const doSilnika = (rodzaj: "katalog_dostawcy" | "producent") => W.rozstrzygnijZastosowanie(W.zaproponujZastosowanie({
  twId: SZARPAK, model: BS450, polaryzacja: "pasuje", zrodlo: "reczne", dowod: { rodzaj, tresc: "katalog 2024" } },
autor())!.id, "zatwierdz", null, biuro);

test("zdanie przez silnik nazywa OBA ogniwa, a słabsze ogniwo zbija je do „prawdopodobnie”", () => {
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  zabuduj();
  doSilnika("katalog_dostawcy");
  const zdanie = czesc(SZARPAK, 2, "wiedza").wybrany!.zdanieDoSzkicu;
  assert.match(zdanie, /^Do NAC LS 46-450 pasuje SZR-148\/82 — pasuje do silnik Briggs & Stratton 450E, który stoi w tej maszynie/);
  assert.match(zdanie, /silnik Briggs & Stratton 450E stoi w NAC LS 46-450 — producent/);
  assert.equal(D.wiedzaDoboru(rozmowa).zabudowa?.silnik.etykieta, "silnik Briggs & Stratton 450E");
});

test("zabudowa na samym śladzie rozmowy to słabe ogniwo — „prawdopodobnie pasuje”", () => {
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  zabuduj("rozmowa");
  doSilnika("producent");
  assert.match(czesc(SZARPAK, 2, "wiedza").wybrany!.zdanieDoSzkicu, /prawdopodobnie pasuje/);
});

test("pasowanie do części klienta podpiera zdanie bez maszyny", () => {
  const p = P.zaproponujPasowanie({ twId: SZARPAK_ALT, doTwId: SZARPAK, rola: "uszczelka", pozycja: "od strony filtra",
    polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog 2024", zrodlo: "reczne" }, autor())!;
  P.rozstrzygnijPasowanie(p.id, "zatwierdz", null, biuro);
  /* Agent wpisał SYMBOL części klienta w polu OEM; maszyny nie zna wcale. */
  D.zapiszDane(rozmowa, { oem: "SZR-148/82", nazwaCzesci: "uszczelka" }, 1, biuro);
  assert.match(czesc(SZARPAK_ALT, 2, "wiedza").wybrany!.zdanieDoSzkicu,
    /^Do SZR-148\/82 pasuje SZR-150\/82 \(uszczelka, od strony filtra\) — źródło: /);
  assert.equal(D.wiedzaDoboru(rozmowa).pasowanie?.doCzego.symbol, "SZR-148/82");
});

/* ── Wiedza rośnie z pracy ────────────────────────────────────────────────── */

test("„ta część” przy marce i modelu rodzi PROPOZYCJĘ z dowodem rozmowy — nie fakt", () => {
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  czesc(SZARPAK, 2);
  const { propozycje } = W.kolejkaPropozycji();
  assert.equal(propozycje.length, 1);
  assert.equal(propozycje[0].stan, "propozycja", "automat proponuje, nie zatwierdza");
  assert.equal(propozycje[0].model.etykieta, "NAC LS 46-450");
  assert.equal(propozycje[0].zrodlo, "dobor");
  assert.equal(propozycje[0].conversationId, rozmowa);
  assert.equal(propozycje[0].dowody[0].rodzaj, "rozmowa");
  /* Ta sama kartoteka drugi raz nie dubluje propozycji. */
  czesc(SZARPAK, 3, "reczny");
  assert.equal(W.kolejkaPropozycji().liczba, 1);
});

test("bez marki albo modelu wynik nie rodzi propozycji", () => {
  D.zapiszDane(rozmowa, { marka: "NAC" }, 1, biuro);
  czesc(SZARPAK, 2);
  assert.equal(W.kolejkaPropozycji().liczba, 0);
});

test("zejście z części i zmiana kartoteki wycofują własną propozycję; zatwierdzonej nie rusza", () => {
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  czesc(SZARPAK, 2);
  D.ustawWynik(rozmowa, { wynik: "brak" }, 3, biuro);
  assert.equal(W.kolejkaPropozycji().liczba, 0);
  czesc(SZARPAK_ALT, 4);
  const z = W.kolejkaPropozycji().propozycje[0];
  W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);
  czesc(SZARPAK, 5);
  assert.equal(W.zastosowanie(z.id)!.stan, "zatwierdzone", "człowiek zatwierdził — automat nie cofa");
});

test("automat dopisujący pustą markę nie zdejmuje części wybranej przez człowieka", () => {
  D.zapiszDane(rozmowa, { oem: "532199377" }, 1, biuro);
  czesc(SZARPAK, 2, "numer");
  const d = D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 3, { automat: "szkic" });
  assert.equal(d.wynik, "czesc", "wynik ustawia wyłącznie człowiek — automat go nie zdejmuje");
  assert.equal(d.wybrany?.twId, SZARPAK);
  assert.equal(d.dane.marka, "NAC");
});

test("zmiana marki zdejmuje wybraną część, wycofuje propozycję i zostawia ślad na osi", () => {
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450", nazwaCzesci: "szarpak" }, 1, biuro);
  czesc(SZARPAK, 2);
  assert.equal(W.kolejkaPropozycji().liczba, 1);
  /* Silnik i nazwa części opisują pytanie, nie maszynę — wybór zostaje. */
  let d = D.zapiszDane(rozmowa, { nazwaCzesci: "szarpak rozrusznika", silnik: "B&S 450E" }, 3, biuro);
  assert.equal(d.wynik, "czesc");
  d = D.zapiszDane(rozmowa, { marka: "Stiga" }, 4, { automat: "szkic" });
  assert.equal(d.wynik, null);
  assert.equal(d.wybrany, null);
  assert.equal(d.stan, "otwarty");
  assert.equal(d.dane.marka, "Stiga");
  assert.equal(W.kolejkaPropozycji().liczba, 0, "propozycja dotyczyła innej maszyny");
  const ostatni = os_().at(-1)!;
  assert.deepEqual([ostatni.przed, ostatni.po, ostatni.symbol, ostatni.autor], ["czesc", null, "SZR-148/82", "automat (szkic)"]);
  /* Miary liczą z dziennika — zejście musi tam stać, inaczej rozmowa
     liczyłaby się jako „ta część". */
  const wpis = db().prepare("SELECT payload FROM events WHERE type='dobor_wynik' ORDER BY id DESC LIMIT 1").get() as { payload: string };
  assert.equal((JSON.parse(wpis.payload) as { po: unknown }).po, null);
});

test("pomiar do wiedzy wymaga marki i modelu z danych doboru", () => {
  assert.throws(() => D.pomiarDoWiedzy(rozmowa, { zadanieId: 1, polaryzacja: "pasuje" }, biuro), /Wpisz markę i model/);
});
