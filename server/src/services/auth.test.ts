import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Sesja rozstrzyga, KTO pracuje. Dwa zachowania są tu ważniejsze od reszty
   i mają własne testy: blokada NIE gubi pracy, a przejęcie NIE jest ciche.   */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-auth-")), "t.db");

let db: typeof import("../db/db.js").db;
let A: typeof import("./auth.js");
let U: typeof import("./users.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  A = await import("./auth.js");
  U = await import("./users.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
  db().prepare("DELETE FROM device_session").run();
  db().prepare("DELETE FROM app_user").run();
});

/** Cofnięcie ostatniej aktywności sesji — symulacja bezczynności bez czekania. */
function bezczynnaOd(token: string, minut: number) {
  const kiedy = new Date(Date.now() - minut * 60_000).toISOString();
  db().prepare("UPDATE device_session SET last_seen = ? WHERE token = ?").run(kiedy, token);
}

const zdarzenia = (typ: string) =>
  db().prepare("SELECT * FROM events WHERE type = ?").all(typ) as Array<{
    user_id: string;
    user_ref: number | null;
    payload: string | null;
  }>;

/* ── Logowanie ───────────────────────────────────────────────────────────── */

test("skan badge'a zakłada sesję i zapisuje kto", () => {
  const u = U.createUser("Jan Kowalski");
  const s = A.zaloguj(u.badgeCode, "KOLEKTOR-1");
  assert.ok(s, "poprawny badge loguje");
  assert.equal(s.user.userId, u.userId);
  assert.equal(s.zablokowana, false);
  assert.equal(zdarzenia("login").length, 1);
});

test("uszkodzona etykieta NIE loguje jako ktoś inny", () => {
  // to jest cały powód istnienia cyfry kontrolnej: bez niej starty znak
  // logowałby Jana jako Piotra, a audyt wskazałby niewinnego
  U.createUser("Jan Kowalski"); // PRC-0001-9
  U.createUser("Piotr Nowak"); // PRC-0002-8
  assert.equal(A.zaloguj("PRC-0001-8", null), null, "cyfra z sąsiedniego konta");
  assert.equal(A.zaloguj("PRC-0003-4", null), null, "konto nie istnieje");
  assert.equal(zdarzenia("login").length, 0);
});

test("konto wyłączone nie loguje się, choć badge jest poprawny", () => {
  const u = U.createUser("Były Pracownik");
  U.setActive(u.userId, false);
  assert.equal(A.zaloguj(u.badgeCode, null), null);
});

/* ── Blokada, nie wylogowanie ────────────────────────────────────────────── */

test("bezczynność BLOKUJE sesję, ale jej nie kasuje", () => {
  // wylogowanie gubiące 30 rozłożonych pozycji to najprostszy sposób na
  // aplikację, która leży w szufladzie — dlatego sesja tylko się blokuje
  const u = U.createUser("Jan Kowalski");
  const s = A.zaloguj(u.badgeCode, "KOLEKTOR-1")!;
  bezczynnaOd(s.token, A.BLOKADA_MIN + 1);

  const po = A.sesja(s.token);
  assert.ok(po, "sesja ISTNIEJE dalej");
  assert.equal(po.zablokowana, true);
  assert.equal(po.user.userId, u.userId, "i wie, czyja jest");
});

test("każda aktywność odsuwa blokadę", () => {
  const u = U.createUser("Jan Kowalski");
  const s = A.zaloguj(u.badgeCode, null)!;
  bezczynnaOd(s.token, A.BLOKADA_MIN - 1);
  assert.equal(A.sesja(s.token)?.zablokowana, false, "tuż przed progiem jeszcze nie");
  A.dotknij(s.token);
  bezczynnaOd(s.token, A.BLOKADA_MIN - 1);
  assert.equal(A.sesja(s.token)?.zablokowana, false);
});

test("odblokowanie to JEDEN skan własnego badge'a", () => {
  const u = U.createUser("Jan Kowalski");
  const s = A.zaloguj(u.badgeCode, null)!;
  bezczynnaOd(s.token, A.BLOKADA_MIN + 5);
  const odblokowana = A.odblokuj(s.token, u.badgeCode);
  assert.ok(odblokowana);
  assert.equal(odblokowana.zablokowana, false);
  assert.equal(odblokowana.token, s.token, "TEN SAM token — kontekst pracy zostaje");
});

test("cudzy badge NIE odblokowuje cudzej sesji po cichu", () => {
  // ciche przełączenie tożsamości w środku dostawy niszczy audyt dokładnie
  // tam, gdzie jest potrzebny — przejęcie idzie osobną, jawną drogą
  const jan = U.createUser("Jan Kowalski");
  const piotr = U.createUser("Piotr Nowak");
  const s = A.zaloguj(jan.badgeCode, null)!;
  bezczynnaOd(s.token, A.BLOKADA_MIN + 5);
  assert.equal(A.odblokuj(s.token, piotr.badgeCode), null);
  assert.equal(A.sesja(s.token)?.user.userId, jan.userId, "sesja dalej Jana");
});

/* ── Przejęcie pracy ─────────────────────────────────────────────────────── */

test("przejęcie unieważnia starą sesję i zostawia ślad", () => {
  const jan = U.createUser("Jan Kowalski");
  const piotr = U.createUser("Piotr Nowak");
  const stara = A.zaloguj(jan.badgeCode, "KOLEKTOR-1")!;

  const nowa = A.przejmij(stara.token, piotr.badgeCode, "KOLEKTOR-1", "dostawa 4711");
  assert.ok(nowa);
  assert.equal(nowa.user.userId, piotr.userId);
  assert.notEqual(nowa.token, stara.token, "nowy token — to inna osoba");
  assert.equal(A.sesja(stara.token), null, "stara sesja unieważniona");

  const ev = zdarzenia("session_handover");
  assert.equal(ev.length, 1, "przejęcie MUSI być widoczne w audycie");
  const p = JSON.parse(ev[0].payload!);
  assert.equal(p.od, "Jan Kowalski");
  assert.equal(p.kontekst, "dostawa 4711", "kontekst przejmowanej pracy zapisany");
});

test("przejęcie nieznanym badgem nie rusza istniejącej sesji", () => {
  const jan = U.createUser("Jan Kowalski");
  const s = A.zaloguj(jan.badgeCode, null)!;
  assert.equal(A.przejmij(s.token, "PRC-0099-1", null, undefined), null);
  assert.equal(A.sesja(s.token)?.user.userId, jan.userId, "Jan dalej pracuje");
  assert.equal(zdarzenia("session_handover").length, 0);
});

test("wylogowanie kończy sesję i to jest decyzja człowieka", () => {
  const u = U.createUser("Jan Kowalski");
  const s = A.zaloguj(u.badgeCode, null)!;
  A.wyloguj(s.token);
  assert.equal(A.sesja(s.token), null);
});

/* ── Operacje uprzywilejowane ────────────────────────────────────────────── */

test("magazynier nie dostaje operacji uprzywilejowanej nawet znając PIN", () => {
  const u = U.createUser("Jan Kowalski", "magazynier", "4821");
  const w = A.autoryzuj(u, "domkniecie_z_wyjatkami", "4821");
  assert.equal(w.ok, false);
  assert.match(w.powod!, /brygadzist/i, "komunikat mówi, czego brakuje");
});

test("brygadzista bez PIN-u dostaje odmowę, nie przepustkę", () => {
  // konto uprzywilejowane bez PIN-u to konto, którego nie da się przypisać
  // do człowieka — lepiej odmówić niż wpisać do audytu coś niepewnego
  const u = U.createUser("Adam Brygadzista", "brygadzista");
  assert.equal(A.autoryzuj(u, "zdjecie_cudzego_locka", null).ok, false);
  assert.equal(A.autoryzuj(u, "zdjecie_cudzego_locka", "0000").ok, false);
});

test("PIN dowodzi, że to naprawdę ta osoba", () => {
  // badge'e bywają pożyczane („podaj mi swój, mam ręce w oleju") — PIN
  // sprawia, że „ktoś użył mojego badge'a" jest kłamstwem, a nie wymówką
  const u = U.createUser("Adam Brygadzista", "brygadzista", "4821");
  assert.equal(A.autoryzuj(u, "domkniecie_z_wyjatkami", "4822").ok, false);
  assert.equal(A.autoryzuj(u, "domkniecie_z_wyjatkami", null).ok, false);
  assert.equal(A.autoryzuj(u, "domkniecie_z_wyjatkami", "4821").ok, true);
});

test("udana operacja uprzywilejowana zostawia ślad, nieudana nie udaje że była", () => {
  const u = U.createUser("Adam Brygadzista", "brygadzista", "4821");
  A.autoryzuj(u, "ustawienia", "9999");
  assert.equal(zdarzenia("privileged").length, 0, "błędny PIN to nie operacja");
  A.autoryzuj(u, "ustawienia", "4821");
  const ev = zdarzenia("privileged");
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].payload!).operacja, "ustawienia");
});

test("biuro też podaje PIN — rola mówi KTO może, PIN KTO to jest", () => {
  const u = U.createUser("Biuro Zakupy", "biuro", "1234");
  assert.equal(A.autoryzuj(u, "ustawienia", null).ok, false);
  assert.equal(A.autoryzuj(u, "ustawienia", "1234").ok, true);
});
