import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wiedza-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Baza wiedzy (§11.3, §11.4, §12, etap E2) ────────────────────────────────
   Wiedza rośnie z pracy i ZAWSZE przechodzi przez człowieka. Te testy pilnują
   granic, które kosztują najwięcej, gdy pękną: automat nie zatwierdza,
   negatyw nie znika bez powodu, zatwierdzenie nie bierze się z niczego
   (dowód), a odczyt niczego nie zapisuje. Plus historia wersji: poprawka to
   nowy wiersz, stary schodzi na `wycofane` — nic nie znika.                 */

let db: typeof import("../db/db.js").db;
let W: typeof import("./wiedza.js");

let biuro = 0;
let druga = 0;
let hala = 0;
let rozmowa = 0;
const SZR = 501;
const SZR_ALT = 502;
const NAC = { rodzaj: "maszyna" as const, marka: "NAC", nazwa: "LS 46-450" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  W = await import("./wiedza.js");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(SZR, "SZR-148/82", "Szarpak 148 mm");
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(SZR_ALT, "SZR-140/82", "Szarpak 140 mm");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "model_urzadzenia", "zadanie_terenowe",
    "conversation_event", "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  druga = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ola','O. Nowak','biuro')").run().lastInsertRowid);
  hala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('marek','M. Kowal','magazynier')").run().lastInsertRowid);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')").run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-1','zielony_ogrod')`).run(konto).lastInsertRowid);
});

const liczba = (tabela: string) => (db().prepare(`SELECT count(*) n FROM ${tabela}`).get() as { n: number }).n;
const ALA = () => ({ userId: biuro, name: "A. Lewandowska" });
const propozycja = (n: Partial<Parameters<typeof W.zaproponujZastosowanie>[0]> = {}) =>
  W.zaproponujZastosowanie({
    twId: SZR, model: NAC, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "rozmowa", tresc: "dobór zatwierdzony w rozmowie" }, ...n,
  }, ALA());

test("jedna kosiarka = jeden model, choćby wpisana trzema sposobami", () => {
  const a = W.upewnijModel(NAC, ALA());
  const b = W.upewnijModel({ rodzaj: "maszyna", marka: " nac ", nazwa: "ls46450" }, ALA());
  const c = W.upewnijModel({ rodzaj: "maszyna", marka: "Nac", nazwa: "LS 46 450" }, ALA());
  assert.equal(a.id, b.id); assert.equal(a.id, c.id);
  assert.equal(a.etykieta, "NAC LS 46-450", "etykieta niesie pisownię z pierwszego wpisu");
  assert.equal(liczba("model_urzadzenia"), 1);
  /* Silnik o tej samej nazwie to INNY wiersz — rodzaj jest częścią klucza. */
  assert.notEqual(W.upewnijModel({ ...NAC, rodzaj: "silnik" }, ALA()).id, a.id);
  assert.deepEqual(W.szukajModeli("ls 46").map((m) => m.klucz).sort(), ["maszyna|nacls46450", "silnik|nacls46450"]);
});

test("propozycja rodzi się z dowodem, w jednej transakcji, i nie dubluje się", () => {
  const z = propozycja()!;
  assert.equal(z.stan, "propozycja");
  assert.equal(z.symbol, "SZR-148/82", "symbol z bazy, nie z żądania");
  assert.equal(z.dowody.length, 1);
  assert.equal(z.pewnosc, "prawdopodobne", "sam ślad rozmowy to nie dowód techniczny");
  assert.equal(liczba("events"), 2, "model + propozycja");
  /* Ten sam dobór zatwierdzony drugi raz nie zaśmieca kolejki. */
  assert.equal(propozycja(), null);
  assert.equal(liczba("zastosowanie"), 1);
  assert.equal(liczba("events"), 2, "duplikat nie zostawia śladu");
  /* Negatyw dla tej samej pary to INNA propozycja — sprzeczność rozstrzyga człowiek. */
  assert.notEqual(propozycja({ polaryzacja: "nie_pasuje", powodNegatywny: "niewlasciwy_rozstaw" }), null);
  assert.throws(() => propozycja({ polaryzacja: "nie_pasuje" }), /wymaga powodu/);
  assert.throws(() => propozycja({ twId: 999999 }), /Nie ma takiej kartoteki/);
  assert.throws(() => propozycja({ dowod: { rodzaj: "producent", tresc: "  " } }), /musi mieć treść/);
});

test("automat i hala NIE zatwierdzają — rozstrzyga wyłącznie konto biura", () => {
  const z = propozycja()!;
  assert.throws(() => W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, 999999), /człowiek z biura/);
  assert.throws(() => W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, hala), /człowiek z biura/);
  assert.equal(W.zastosowanie(z.id)!.stan, "propozycja", "odmowa niczego nie zmienia");
  const przed = liczba("events");
  assert.throws(() => W.wycofajZastosowanie(z.id, "x", hala), /człowiek z biura/);
  assert.throws(() => W.dodajDowod(z.id, { rodzaj: "producent", tresc: "katalog" }, hala), /człowiek z biura/);
  assert.equal(liczba("events"), przed);
});

test("autor zatwierdza własną propozycję, a obie osoby są zapisane osobno", () => {
  /* Decyzja właściciela: minimum klikań, każdy z biura. Ślad mówi, że to ta
     sama osoba — i to wystarczy do rozliczenia. */
  const z = propozycja()!;
  const po = W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);
  assert.equal(po.stan, "zatwierdzone");
  assert.equal(po.zaproponowal, "A. Lewandowska");
  assert.equal(po.rozstrzygnal, "A. Lewandowska");
  assert.ok(po.rozstrzygnietoAt);
  const os = db().prepare("SELECT event_type FROM conversation_event WHERE conversation_id=?").all(rozmowa);
  assert.equal(os.length, 0, "propozycja bez rozmowy nie pisze na żadną oś");
});

test("odrzucenie wymaga powodu, drugie rozstrzygnięcie to konflikt", () => {
  const z = propozycja()!;
  assert.throws(() => W.rozstrzygnijZastosowanie(z.id, "odrzuc", "", druga), /wymaga powodu/);
  const po = W.rozstrzygnijZastosowanie(z.id, "odrzuc", "zły model — to LS 51", druga);
  assert.equal(po.stan, "odrzucone");
  assert.equal(po.powodRozstrzygniecia, "zły model — to LS 51");
  assert.throws(() => W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro), (e: unknown) => {
    assert.ok(e instanceof W.WiedzaConflict);
    assert.equal(e.details.rozstrzygnal, "O. Nowak");
    return true;
  });
  /* Odrzucona para może wrócić jako nowa propozycja — odrzucenie nie blokuje na zawsze. */
  assert.notEqual(propozycja(), null);
});

test("zatwierdzenie bez dowodu odbija się; dowód techniczny podnosi pewność", () => {
  const z = propozycja()!;
  db().prepare("DELETE FROM dowod_zastosowania").run();
  assert.throws(() => W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro), /choć jednego dowodu/);
  const zDowodem = W.dodajDowod(z.id, { rodzaj: "pomiar_wlasny", tresc: "rozstaw 148 mm" }, biuro);
  assert.equal(zDowodem.pewnosc, "potwierdzone");
  const po = W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);
  assert.match(po.zdanieZrodla, /^potwierdzone zastosowanie do NAC LS 46-450 — pomiar własny, \d+\.\d+\.\d+, A\. Lewandowska$/);
  /* Dowód jest append-only: kolejny ślad rozmowy pewności NIE obniża. */
  const zeSladem = W.dodajDowod(z.id, { rodzaj: "rozmowa", tresc: "klient potwierdził" }, druga);
  assert.equal(zeSladem.pewnosc, "potwierdzone");
  assert.equal(zeSladem.dowody.length, 2);
  assert.throws(() => W.dodajDowod(z.id, { rodzaj: "ekspert" as never, tresc: "x" }, biuro), /Nieznany rodzaj/);
});

test("negatyw wycofuje się wyłącznie z powodem — pozytyw bez", () => {
  const neg = propozycja({ polaryzacja: "nie_pasuje", powodNegatywny: "mylace_oznaczenie",
    dowod: { rodzaj: "decyzja_biura", tresc: "u dostawcy to inna część" } })!;
  W.rozstrzygnijZastosowanie(neg.id, "zatwierdz", null, biuro);
  assert.throws(() => W.wycofajZastosowanie(neg.id, null, biuro), /wyłącznie z powodem/);
  assert.equal(W.zastosowanie(neg.id)!.stan, "zatwierdzone");
  assert.match(W.zastosowanie(neg.id)!.zdanieZrodla, /^nie pasuje do NAC LS 46-450: występuje pod mylącym oznaczeniem — decyzja biura/);
  assert.equal(W.wycofajZastosowanie(neg.id, "dostawca poprawił oznaczenie", biuro).stan, "wycofane");

  const poz = propozycja()!;
  W.rozstrzygnijZastosowanie(poz.id, "zatwierdz", null, biuro);
  assert.equal(W.wycofajZastosowanie(poz.id, null, druga).stan, "wycofane");
  assert.throws(() => W.wycofajZastosowanie(poz.id, null, druga), /tylko zatwierdzone/);
  assert.equal(liczba("zastosowanie"), 2, "wycofanie zmienia stan, nie kasuje wiersza");
});

test("poprawka to nowy wiersz z zastepujeId — stare schodzi na wycofane przy zatwierdzeniu", () => {
  const stare = propozycja({ dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2021" } })!;
  W.rozstrzygnijZastosowanie(stare.id, "zatwierdz", null, biuro);
  assert.throws(() => propozycja({ zastepujeId: 999999 }), /tylko zatwierdzone/);
  const nowe = propozycja({ model: { ...NAC, wariant: "HS" }, zastepujeId: stare.id,
    dowod: { rodzaj: "producent", tresc: "tylko wariant HS od 2019" } })!;
  assert.equal(nowe.zastepujeId, stare.id);
  assert.equal(W.zastosowanie(stare.id)!.stan, "zatwierdzone", "do rozstrzygnięcia stare stoi");
  W.rozstrzygnijZastosowanie(nowe.id, "zatwierdz", null, druga);
  assert.equal(W.zastosowanie(stare.id)!.stan, "wycofane");
  assert.match(W.zastosowanie(stare.id)!.powodRozstrzygniecia ?? "", /zastąpione przez/);
  assert.deepEqual(W.zastosowaniaModelu("maszyna|nacls46450").map((z) => z.id), []);
  assert.deepEqual(W.zastosowaniaModelu("maszyna|nacls46450hs").map((z) => z.id), [nowe.id]);
});

test("pomiar z hali staje się dowodem, nie faktem — i dopisuje się do istniejącej pary", () => {
  const d = db();
  const zadanie = Number(d.prepare(`INSERT INTO zadanie_terenowe(rodzaj,tytul,instrukcja,tw_id,status,utworzono_at,
    utworzono_przez,conversation_id) VALUES ('pomiar','Zmierz','rozstaw',?,'w_toku','2026-09-01T08:00:00Z','Ala',?)`)
    .run(SZR, rozmowa).lastInsertRowid);
  assert.throws(() => W.propozycjaZPomiaru(zadanie, { model: NAC, polaryzacja: "pasuje" }, biuro), /WYKONANE/);
  d.prepare(`UPDATE zadanie_terenowe SET status='wykonane', wynik='rozstaw 148 mm, średnica 82 mm',
    wykonano_at='2026-09-01T09:00:00Z', wykonano_przez='M. Kowal' WHERE id=?`).run(zadanie);

  const z = W.propozycjaZPomiaru(zadanie, { model: NAC, polaryzacja: "pasuje" }, biuro);
  assert.equal(z.stan, "propozycja", "wynik NIE staje się faktem (§13.4)");
  assert.equal(z.zrodlo, "pomiar");
  assert.equal(z.conversationId, rozmowa);
  assert.equal(z.dowody[0].rodzaj, "pomiar_wlasny");
  assert.equal(z.dowody[0].zadanieId, zadanie);
  assert.match(z.dowody[0].tresc, /rozstaw 148 mm.*zadanie #/);
  assert.equal(z.pewnosc, "potwierdzone");
  const os = (d.prepare("SELECT event_type FROM conversation_event WHERE conversation_id=?").all(rozmowa) as Array<{ event_type: string }>)
    .map((e) => e.event_type);
  assert.deepEqual(os, ["wiedza_propozycja"]);

  /* Ten sam pomiar drugi raz: nic nowego. Drugi pomiar tej samej pary: dowód
     dopisany do istniejącej propozycji, kolejka nie rośnie. */
  assert.equal(W.propozycjaZPomiaru(zadanie, { model: NAC, polaryzacja: "pasuje" }, biuro).dowody.length, 1);
  const zadanie2 = Number(d.prepare(`INSERT INTO zadanie_terenowe(rodzaj,tytul,instrukcja,tw_id,status,utworzono_at,
    utworzono_przez,wynik,wykonano_at,wykonano_przez) VALUES ('pomiar','Zmierz','x',?,'wykonane','2026-09-02T08:00:00Z','Ala','zaczep dwuramienny','2026-09-02T09:00:00Z','M. Kowal')`)
    .run(SZR).lastInsertRowid);
  assert.equal(W.propozycjaZPomiaru(zadanie2, { model: NAC, polaryzacja: "pasuje" }, biuro).dowody.length, 2);
  assert.equal(liczba("zastosowanie"), 1);
  /* Zadanie bez kartoteki i bez wskazania odbija się ze zdaniem. */
  d.prepare("UPDATE zadanie_terenowe SET tw_id=NULL WHERE id=?").run(zadanie2);
  assert.throws(() => W.propozycjaZPomiaru(zadanie2, { model: { ...NAC, nazwa: "LS 51" }, polaryzacja: "pasuje" }, biuro), /wskaż ją/);
});

test("zdjęcie wyboru w doborze wycofuje własną propozycję, zatwierdzonej nie rusza", () => {
  const swoja = propozycja({ zrodlo: "dobor", conversationId: rozmowa })!;
  const obca = propozycja({ twId: SZR_ALT, zrodlo: "dobor", conversationId: rozmowa })!;
  W.rozstrzygnijZastosowanie(obca.id, "zatwierdz", null, druga);
  assert.equal(W.wycofajPropozycjeDoboru(rozmowa, SZR, ALA()), 1);
  assert.equal(W.wycofajPropozycjeDoboru(rozmowa, SZR_ALT, ALA()), 0);
  assert.equal(W.zastosowanie(swoja.id)!.stan, "wycofane");
  assert.equal(W.zastosowanie(obca.id)!.stan, "zatwierdzone");
});

test("odczyt niczego nie zapisuje, a kasacja rozmowy nie kasuje wiedzy", () => {
  const z = propozycja({ conversationId: rozmowa })!;
  W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);
  propozycja({ twId: SZR_ALT, polaryzacja: "nie_pasuje", powodNegatywny: "niewlasciwy_rozstaw" });
  const przed = [liczba("events"), liczba("zastosowanie"), liczba("dowod_zastosowania"), liczba("model_urzadzenia")];
  const t = W.zastosowaniaTowaru(SZR);
  assert.equal(t.potwierdzone.length, 1); assert.equal(t.negatywne.length, 0); assert.equal(t.propozycje.length, 0);
  assert.equal(W.zastosowaniaTowaru(SZR_ALT).propozycje.length, 1);
  assert.equal(W.kolejkaPropozycji().liczba, 1);
  assert.equal(W.zastosowaniaModelu("maszyna|nacls46450").length, 1);
  W.szukajModeli("nac");
  assert.deepEqual([liczba("events"), liczba("zastosowanie"), liczba("dowod_zastosowania"), liczba("model_urzadzenia")], przed);

  db().prepare("DELETE FROM conversation WHERE id=?").run(rozmowa);
  assert.equal(W.zastosowanie(z.id)!.conversationId, null);
  assert.equal(W.zastosowanie(z.id)!.stan, "zatwierdzone");
});
