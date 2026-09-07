import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-silniki-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Zabudowa silnika (§11.2) ────────────────────────────────────────────────
   Relacja maszyna→silnik jest wiele do wielu i ma ten sam cykl życia co
   zastosowanie: propozycja, którą rozstrzyga człowiek z biura. Te testy
   pilnują granic, które kosztują najwięcej, gdy pękną: rodzaj modelu po
   właściwej stronie (SQLite tego nie sprawdzi), automat nie zatwierdza,
   wycofanie wyłącznie z powodem, a kolejka luk niczego nie zapisuje.        */

let db: typeof import("../db/db.js").db;
let S: typeof import("./silniki.js");
let zapiszDane: typeof import("./dobor.js").zapiszDane;

let biuro = 0;
let hala = 0;
let konto = 0;
let rozmowa = 0;

const NAC = { rodzaj: "maszyna" as const, marka: "NAC", nazwa: "LS 46-450" };
const STIGA = { rodzaj: "maszyna" as const, marka: "STIGA", nazwa: "Combi 48" };
const BS450 = { rodzaj: "silnik" as const, marka: "Briggs & Stratton", nazwa: "450E" };
const LONCIN = { rodzaj: "silnik" as const, marka: "Loncin", nazwa: "LC1P65FE" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./silniki.js");
  ({ zapiszDane } = await import("./dobor.js"));
});

beforeEach(() => {
  const d = db();
  /* `zabudowa_silnika` PRZED `model_urzadzenia`: ON DELETE RESTRICT. */
  for (const t of ["zabudowa_silnika", "dowod_zastosowania", "zastosowanie", "model_urzadzenia",
    "dobor_rozmowy", "conversation_event", "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  hala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','magazyn')")
    .run().lastInsertRowid);
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s-a')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','klient')`).run(konto).lastInsertRowid);
});

const ala = { userId: 0, name: "A. Lewandowska" };
const zaproponuj = (maszyna: typeof NAC, silnik: typeof BS450, n: Partial<Parameters<typeof S.zaproponujZabudowe>[0]> = {}) =>
  S.zaproponujZabudowe({ maszyna, silnik, rodzajDowodu: "producent", dowodTresc: "karta katalogowa",
    zrodlo: "reczne", ...n }, { ...ala, userId: biuro });
const zatwierdz = (maszyna: typeof NAC, silnik: typeof BS450) =>
  S.rozstrzygnijZabudowe(zaproponuj(maszyna, silnik)!.id, "zatwierdz", null, biuro);

test("wiele do wielu działa w OBIE strony", () => {
  /* Jedna kosiarka w dwóch wersjach silnikowych i jeden silnik w dwóch
     kosiarkach — to jest cały powód, dla którego to osobna tabela. */
  const nac = zatwierdz(NAC, BS450);
  zatwierdz(NAC, LONCIN);
  const stiga = zatwierdz(STIGA, BS450);

  const silnikiNac = S.zabudowyMaszyny(nac.maszyna.klucz);
  assert.equal(silnikiNac.length, 2, "NAC ma dwie wersje silnikowe");
  assert.deepEqual(silnikiNac.map((z) => z.silnik.nazwa).sort(), ["450E", "LC1P65FE"]);

  const maszynyBS = S.zabudowySilnika(nac.silnik.klucz);
  assert.deepEqual(maszynyBS.map((z) => z.maszyna.marka).sort(), ["NAC", "STIGA"]);
  assert.notEqual(nac.maszyna.klucz, stiga.maszyna.klucz);
  /* Klucz jest dokładny, nie rozmyty: literówka nie ma trafiać w cudzą parę. */
  assert.deepEqual(S.zabudowyMaszyny("maszyna|nacls46451"), []);
});

test("rodzaj modelu musi stać po właściwej stronie — CHECK tego nie złapie", () => {
  assert.throws(() => zaproponuj(BS450 as unknown as typeof NAC, LONCIN), /to MASZYNA/);
  assert.throws(() => zaproponuj(NAC, STIGA as unknown as typeof BS450), /to SILNIK/);
});

test("zabudowa bez dowodu nie powstaje wcale", () => {
  assert.throws(() => zaproponuj(NAC, BS450, { dowodTresc: "   " }), /bez dowodu nie powstaje/);
});

test("duplikat aktywnej pary to `null`, a para WYCOFANA pozwala złożyć nową", () => {
  const pierwsza = zatwierdz(NAC, BS450);
  assert.equal(zaproponuj(NAC, BS450), null, "para już stoi");
  S.wycofajZabudowe(pierwsza.id, "pomyłka przy przepisywaniu z katalogu", biuro);
  /* Gdyby tabela miała UNIQUE na parze, ten wiersz by nie wszedł. */
  assert.ok(zaproponuj(NAC, BS450), "po wycofaniu para może wrócić");
});

test("poprawka mocniejszym dowodem spycha starą parę na `wycofane`", () => {
  const stara = zatwierdz(NAC, BS450);
  const nowa = zaproponuj(NAC, BS450, { rodzajDowodu: "producent",
    dowodTresc: "IPL producenta, strona 4", zastepujeId: stara.id })!;
  S.rozstrzygnijZabudowe(nowa.id, "zatwierdz", null, biuro);
  assert.equal(S.zabudowa(stara.id)!.stan, "wycofane");
  assert.equal(S.zabudowyMaszyny(S.zabudowa(nowa.id)!.maszyna.klucz).length, 1, "historia nie dubluje kandydatów");
});

test("rozstrzyga wyłącznie biuro; odrzucenie i wycofanie wymagają powodu", () => {
  const p = zaproponuj(NAC, BS450)!;
  assert.throws(() => S.rozstrzygnijZabudowe(p.id, "zatwierdz", null, hala), /człowiek z biura/);
  assert.throws(() => S.rozstrzygnijZabudowe(p.id, "odrzuc", "  ", biuro), /wymaga powodu/);
  const z = S.rozstrzygnijZabudowe(p.id, "zatwierdz", null, biuro);
  /* Cofnięcie zabudowy gasi CAŁĄ gałąź kandydatów naraz — stąd powód
     obowiązkowy także przy parze pozytywnej, inaczej niż przy zastosowaniu. */
  assert.throws(() => S.wycofajZabudowe(z.id, null, biuro), /wymaga powodu/);
});

test("drugie rozstrzygnięcie tej samej propozycji to konflikt, nie cicha nadpisanka", () => {
  const p = zaproponuj(NAC, BS450)!;
  S.rozstrzygnijZabudowe(p.id, "zatwierdz", null, biuro);
  assert.throws(() => S.rozstrzygnijZabudowe(p.id, "odrzuc", "jednak nie", biuro), /rozstrzygnął już/);
});

test("pewność i zdanie źródła: dowód techniczny kontra sam ślad rozmowy", () => {
  const techniczna = zatwierdz(NAC, BS450);
  assert.equal(techniczna.pewnosc, "potwierdzone");
  assert.match(techniczna.zdanieZrodla, /^silnik Briggs & Stratton 450E stoi w NAC LS 46-450 — producent, /);
  const zRozmowy = S.rozstrzygnijZabudowe(
    zaproponuj(STIGA, LONCIN, { rodzajDowodu: "rozmowa", dowodTresc: "klient podał z tabliczki" })!.id,
    "zatwierdz", null, biuro);
  assert.equal(zRozmowy.pewnosc, "prawdopodobne", "ślad rozmowy nie jest dowodem technicznym");
});

test("każda mutacja zostawia ślad w dzienniku", () => {
  const przed = (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  const z = zatwierdz(NAC, BS450);
  S.wycofajZabudowe(z.id, "inna wersja kosiarki", biuro);
  const rodzaje = (db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>)
    .slice(przed).map((e) => e.type);
  assert.ok(rodzaje.includes("zabudowa_propozycja"));
  assert.ok(rodzaje.includes("zabudowa_rozstrzygniecie"));
  assert.ok(rodzaje.includes("zabudowa_wycofanie"));
});

/* ── Kolejka luk ─────────────────────────────────────────────────────────── */

test("luki idą od maszyn BEZ silnika, potem po częstości, i nie rozbijają wpisanego tekstu", () => {
  const nowaRozmowa = (n: string) => Number(db().prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,?,'k')`).run(konto, n).lastInsertRowid);
  /* NAC: trzy dobory, w dwóch agent wpisał ten sam łańcuch. */
  zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450", silnik: "B&S 450E" }, 1, biuro);
  zapiszDane(nowaRozmowa("w-2"), { marka: "nac", model: "ls46450", silnik: "B&S 450E" }, 1, biuro);
  zapiszDane(nowaRozmowa("w-3"), { marka: "NAC", model: "LS 46-450", silnik: "Loncin" }, 1, biuro);
  /* STIGA: jeden dobór, ale silnik JUŻ znany — schodzi pod NAC. */
  zapiszDane(nowaRozmowa("w-4"), { marka: "STIGA", model: "Combi 48" }, 1, biuro);
  zatwierdz(STIGA, BS450);

  const { luki, liczba } = S.lukiSilnikow();
  assert.equal(liczba, 2);
  assert.equal(luki[0].marka, "NAC", "maszyna bez silnika idzie pierwsza");
  assert.equal(luki[0].pytan, 3, "trzy dobory mimo różnej pisowni — klucz je scala");
  assert.deepEqual(luki[0].wpisaneSilniki, [{ tekst: "B&S 450E", ile: 2 }, { tekst: "Loncin", ile: 1 }],
    "surowy tekst z licznikiem, nierozbity na markę i nazwę");
  assert.deepEqual(luki[0].zabudowy, []);
  assert.equal(luki[1].marka, "STIGA");
  assert.equal(luki[1].zabudowy.length, 1, "maszyna z silnikiem zostaje na liście, ale niżej");
});

test("odczyt luk niczego nie zapisuje", () => {
  zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  const licz = () => (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n
    + (db().prepare("SELECT count(*) n FROM model_urzadzenia").get() as { n: number }).n;
  const przed = licz();
  S.lukiSilnikow();
  S.kolejkaZabudow();
  assert.equal(licz(), przed, "zero zapisu przy patrzeniu");
});
