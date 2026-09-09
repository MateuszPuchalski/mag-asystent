import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-tokeny-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Tokeny silników w nazwach kartotek (§12, 0.239.0) ───────────────────────
   Na REALNYM seedzie, jak identyfikatory: reguła dopasowania ma trafiać
   w prawdziwe nazwy („Gaźnik do silników HONDA GX160", „Świeca do silników
   GX160 GX200 GX270"). Pilnujemy granic, które kosztują najwięcej: token
   wpisuje człowiek i wskazuje SILNIK; dopasowanie po zwinięciu, bez furtki
   na literówki; jedno kliknięcie tworzy ZATWIERDZONE zastosowania z pełnym
   śladem; pominięte nie wracają po imporcie; usunięcie tokenu nie cofa
   faktów; odczyt niczego nie zapisuje.                                       */

let db: typeof import("../db/db.js").db;
let T: typeof import("./tokeny-silnikow.js");
let W: typeof import("./wiedza.js");
let I: typeof import("./identyfikatory.js");
let config: typeof import("../config.js").config;
let biuro = 0;
let hala = 0;
let GAZNIK_GX160 = 0;

const GX160 = { rodzaj: "silnik" as const, marka: "Honda", nazwa: "GX160" };
const GX200 = { rodzaj: "silnik" as const, marka: "Honda", nazwa: "GX200" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  T = await import("./tokeny-silnikow.js");
  W = await import("./wiedza.js");
  I = await import("./identyfikatory.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  assert.ok(rows.length > 3000, `kartoteka wygląda na niekompletną: ${rows.length}`);
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  GAZNIK_GX160 = (d.prepare("SELECT tw_id FROM sgt_towar WHERE symbol='W09-0211'").get() as { tw_id: number }).tw_id;
});

beforeEach(() => {
  const d = db();
  /* Pary PRZED tokenem i zastosowaniem, token PRZED modelem: klucze obce. */
  for (const t of ["token_silnika_kartoteka", "token_silnika", "dowod_zastosowania", "zastosowanie",
    "model_urzadzenia", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  hala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','magazynier')").run().lastInsertRowid);
});

const ala = () => ({ userId: biuro, name: "A. Lewandowska" });
const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;

test("token dopasowuje nazwy po zwinięciu: „GX160” i „gx-160” to jeden token, „GX 200” łapie „GX200”", () => {
  const t = T.dodajToken({ token: "GX160", silnik: GX160 }, ala());
  assert.equal(t.silnik.etykieta, "silnik Honda GX160");
  assert.ok(t.nowych >= 40 && t.nowych <= 80, `GX160 w nazwach: ${t.nowych}`);
  assert.ok(t.nowe.some((k) => k.twId === GAZNIK_GX160), "gaźnik W09-0211 ma GX160 w nazwie");
  assert.equal(t.nowe.length, Math.min(t.nowych, 200));
  /* Dubel po zwinięciu — konflikt ze wskazaniem, dokąd token prowadzi. */
  assert.throws(() => T.dodajToken({ token: "gx-160", silnik: GX200 }, ala()),
    (e: Error) => e instanceof W.WiedzaConflict && /prowadzi do silnik Honda GX160/.test(e.message));
  const t2 = T.dodajToken({ token: "GX 200", silnik: GX200 }, ala());
  assert.ok(t2.nowych >= 20, `„GX 200” ma łapać „GX200” w nazwach: ${t2.nowych}`);
  assert.equal(t2.nowe.some((k) => k.twId === GAZNIK_GX160), false, "W09-0211 nie ma GX200 w nazwie");
  assert.deepEqual(T.listaTokenow().tokeny.map((x) => x.token), ["GX 200", "GX160"]);
});

test("token wpisuje biuro i wskazuje silnik; krótki token nie wchodzi", () => {
  assert.throws(() => T.dodajToken({ token: "GX", silnik: GX160 }, ala()), /trzy znaki/);
  assert.throws(() => T.dodajToken({ token: "  ", silnik: GX160 }, ala()), /wymaga tekstu/);
  assert.throws(() => T.dodajToken({ token: "LS 46-450", silnik: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" } as never }, ala()),
    /wskazuje SILNIK/);
  assert.throws(() => T.dodajToken({ token: "GX160", silnik: GX160 }, { userId: hala, name: "B. Nowak" }), /człowiek z biura/);
  assert.equal(liczba("token_silnika"), 0);
});

test("jedno kliknięcie: zaznaczone → ZATWIERDZONE zastosowania z pełnym śladem, odznaczone → pominięte", () => {
  const t = T.dodajToken({ token: "GX160", silnik: GX160 }, ala());
  const [pierwsza, druga, ...reszta] = t.nowe.map((k) => k.twId);
  const w = T.rozstrzygnijToken(t.id, { zatwierdz: [pierwsza, GAZNIK_GX160], pomin: [druga] }, biuro);
  assert.deepEqual(w, { zatwierdzonych: 2, juzBylo: 0, pominietych: 1 });

  const z = W.zastosowaniaTowaru(GAZNIK_GX160);
  assert.equal(z.potwierdzone.length, 1);
  assert.equal(z.propozycje.length, 0, "nic nie czeka w kolejce — decyzja padła przy liście");
  const zas = z.potwierdzone[0];
  assert.equal(zas.model.etykieta, "silnik Honda GX160");
  assert.equal(zas.zrodlo, "opis");
  assert.equal(zas.zaproponowal, "A. Lewandowska");
  assert.equal(zas.rozstrzygnal, "A. Lewandowska", "propozycja i rozstrzygnięcie to ten sam człowiek");
  assert.equal(zas.dowody[0].rodzaj, "decyzja_biura");
  assert.match(zas.dowody[0].tresc, /^token „GX160” w nazwie kartoteki „Gaźnik do silników HONDA GX160/);
  assert.equal(zas.pewnosc, "potwierdzone");

  const po = T.listaTokenow().tokeny[0];
  assert.equal(po.zatwierdzonych, 2);
  assert.equal(po.pominietych, 1);
  assert.equal(po.nowych, t.nowych - 3, "reszta czeka");
  assert.equal(po.nowych, t.nowych - 3);
  assert.equal(po.nowe.some((k) => k.twId === druga), false);
  const typy = (db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>).map((e) => e.type);
  assert.ok(typy.includes("token_silnika_rozstrzygniecie") && typy.includes("wiedza_propozycja") && typy.includes("wiedza_rozstrzygniecie"));
});

test("obce id to błąd, nie cisza; pusta decyzja też; para już w bazie zostaje podpięta, nie zdublowana", () => {
  const t = T.dodajToken({ token: "GX160", silnik: GX160 }, ala());
  assert.throws(() => T.rozstrzygnijToken(t.id, { zatwierdz: [999999], pomin: [] }, biuro), /nie czekają na decyzję/);
  assert.throws(() => T.rozstrzygnijToken(t.id, { zatwierdz: [], pomin: [] }, biuro), /Nie wskazano/);
  assert.throws(() => T.rozstrzygnijToken(t.id, { zatwierdz: [GAZNIK_GX160], pomin: [] }, hala), /człowiek z biura/);
  /* Zastosowanie wpisane wcześniej ręcznie — token je wskazuje, nie dubluje. */
  const reczne = W.zaproponujZastosowanie({ twId: GAZNIK_GX160, model: GX160, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "producent", tresc: "IPL" } }, ala())!;
  const przed = liczba("zastosowanie");
  const w = T.rozstrzygnijToken(t.id, { zatwierdz: [GAZNIK_GX160], pomin: [] }, biuro);
  assert.deepEqual(w, { zatwierdzonych: 0, juzBylo: 1, pominietych: 0 });
  assert.equal(liczba("zastosowanie"), przed);
  const para = db().prepare("SELECT stan, zastosowanie_id FROM token_silnika_kartoteka WHERE token_id=? AND tw_id=?")
    .get(t.id, GAZNIK_GX160) as { stan: string; zastosowanie_id: number };
  assert.equal(para.stan, "zatwierdzona");
  assert.equal(para.zastosowanie_id, reczne.id);
  /* Drugie kliknięcie na tę samą kartotekę: już nie jest `nowa`. */
  assert.throws(() => T.rozstrzygnijToken(t.id, { zatwierdz: [GAZNIK_GX160], pomin: [] }, biuro), /nie czekają/);
});

test("pominięte nie wracają po imporcie, nowa kartoteka wraca jako `nowa`, znikła schodzi", () => {
  const t = T.dodajToken({ token: "GX160", silnik: GX160 }, ala());
  const [pominieta] = t.nowe.map((k) => k.twId);
  T.rozstrzygnijToken(t.id, { zatwierdz: [GAZNIK_GX160], pomin: [pominieta] }, biuro);
  /* „Import": nowa kartoteka z tokenem w nazwie i jedna, która zmieniła nazwę. */
  db().prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (900001,'TEST-GX','Filtr do silnika Honda GX 160 test')").run();
  const zmieniona = t.nowe.map((k) => k.twId).find((x) => x !== pominieta && x !== GAZNIK_GX160)!;
  db().prepare("UPDATE sgt_towar SET nazwa='Część bez tokenu' WHERE tw_id=?").run(zmieniona);
  const p = T.przebudujTokenySilnikow(db());
  assert.equal(p.tokenow, 1);
  assert.equal(p.nowych, 1, "tylko nowa kartoteka doszła");
  const po = T.listaTokenow().tokeny[0];
  assert.ok(po.nowe.some((k) => k.twId === 900001), "nowa kartoteka wraca do biura");
  assert.equal(po.nowe.some((k) => k.twId === zmieniona), false, "kartoteka bez tokenu w nazwie schodzi");
  assert.equal(po.pominietych, 1, "pominięta została pominięta");
  assert.equal(po.zatwierdzonych, 1);
  db().prepare("DELETE FROM sgt_towar WHERE tw_id=900001").run();
  db().prepare("UPDATE sgt_towar SET nazwa=(SELECT nazwa FROM sgt_towar WHERE tw_id=?) WHERE tw_id=?").run(zmieniona, zmieniona);
});

test("usunięcie tokenu zabiera pary, ale zostawia zatwierdzone zastosowania", () => {
  const t = T.dodajToken({ token: "GX160", silnik: GX160 }, ala());
  T.rozstrzygnijToken(t.id, { zatwierdz: [GAZNIK_GX160], pomin: [] }, biuro);
  assert.throws(() => T.usunToken(t.id, hala), /człowiek z biura/);
  T.usunToken(t.id, biuro);
  assert.equal(liczba("token_silnika"), 0);
  assert.equal(liczba("token_silnika_kartoteka"), 0);
  assert.equal(W.zastosowaniaTowaru(GAZNIK_GX160).potwierdzone.length, 1, "fakt z dowodem zostaje");
  assert.throws(() => T.usunToken(t.id, biuro), /Nie znaleziono/);
});

test("odczyt niczego nie zapisuje, a pokrycie liczy tokeny", () => {
  T.dodajToken({ token: "GX160", silnik: GX160 }, ala());
  const przed = [liczba("events"), liczba("token_silnika_kartoteka"), liczba("zastosowanie")];
  T.listaTokenow(); I.pokrycieWiedzy();
  assert.deepEqual([liczba("events"), liczba("token_silnika_kartoteka"), liczba("zastosowanie")], przed);
  const p = I.pokrycieWiedzy();
  assert.equal(p.tokeny.tokenow, 1);
  assert.ok(p.tokeny.nowych >= 40);
  assert.equal(p.tokeny.zatwierdzonych, 0);
});
