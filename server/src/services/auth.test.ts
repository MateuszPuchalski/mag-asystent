import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Sesja rozstrzyga, KTO pracuje. Jedno zachowanie jest tu ważniejsze od reszty
   i ma własne testy: przejęcie pracy NIE jest ciche.

   Blokada po bezczynności została usunięta w sierpniu 2026 razem z ekranem
   „Sesja zablokowana". Sesja trwa do jawnego wylogowania albo przejęcia —
   testy niżej pilnują właśnie tego, że bezczynność jej NIE rusza.            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-auth-")), "t.db");

let db: typeof import("../db/db.js").db;
let nowIso: typeof import("../db/db.js").nowIso;
let A: typeof import("./auth.js");
let U: typeof import("./users.js");
let D: typeof import("./delivery.js");

before(async () => {
  ({ db, nowIso } = await import("../db/db.js"));
  A = await import("./auth.js");
  U = await import("./users.js");
  D = await import("./delivery.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
  db().prepare("DELETE FROM device_session").run();
  db().prepare("DELETE FROM app_user").run();
  db().prepare("DELETE FROM delivery_line").run();
  db().prepare("DELETE FROM delivery").run();
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

/* ── Sesja nie wygasa sama ───────────────────────────────────────────────── */

test("bezczynność NIE rusza sesji, choćby trwała dobę", () => {
  // Regresja na usunięty TTL. Kolektor odłożony na regale na całą przerwę
  // ma wrócić do pracy bez żadnego skanu — blokada po 10 minutach kosztowała
  // ten skan i nie kupowała za to niczego, bo urządzenia nie opuszczają hali.
  const u = U.createUser("Jan Kowalski");
  const s = A.zaloguj(u.badgeCode, "KOLEKTOR-1")!;
  bezczynnaOd(s.token, 24 * 60);

  const po = A.sesja(s.token);
  assert.ok(po, "sesja ISTNIEJE dalej");
  assert.equal(po.user.userId, u.userId, "i wie, czyja jest");
});

test("`dotknij` odnotowuje aktywność, ale niczego nie bramkuje", () => {
  // `last_seen` został jako jedyny ślad, kiedy dany kolektor się odezwał.
  // Test pilnuje, że zapis nadal działa — po usunięciu blokady nic innego
  // by tego nie zauważyło.
  const u = U.createUser("Jan Kowalski");
  const s = A.zaloguj(u.badgeCode, null)!;
  bezczynnaOd(s.token, 120);
  A.dotknij(s.token);

  const r = db()
    .prepare("SELECT last_seen FROM device_session WHERE token = ?")
    .get(s.token) as { last_seen: string };
  const minutTemu = (Date.now() - new Date(r.last_seen).getTime()) / 60_000;
  assert.ok(minutTemu < 1, `last_seen odświeżone, a jest sprzed ${minutTemu} min`);
  assert.ok(A.sesja(s.token), "i sesja dalej jest");
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
  const w = A.autoryzuj(u, "zdjecie_cudzego_locka", "4821");
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
  assert.equal(A.autoryzuj(u, "zdjecie_cudzego_locka", "4822").ok, false);
  assert.equal(A.autoryzuj(u, "zdjecie_cudzego_locka", null).ok, false);
  assert.equal(A.autoryzuj(u, "zdjecie_cudzego_locka", "4821").ok, true);
});

test("udana operacja uprzywilejowana zostawia ślad, nieudana nie udaje że była", () => {
  const u = U.createUser("Adam Brygadzista", "brygadzista", "4821");
  A.autoryzuj(u, "zdjecie_cudzego_locka", "9999");
  assert.equal(zdarzenia("privileged").length, 0, "błędny PIN to nie operacja");
  A.autoryzuj(u, "zdjecie_cudzego_locka", "4821");
  const ev = zdarzenia("privileged");
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].payload!).operacja, "zdjecie_cudzego_locka");
});

/* ── Zdjęcie cudzego locka: jedyna trasa, której PIN dziś strzeże ────────── */

/** Linia zablokowana przez `kto` sprzed `minut`. */
function liniaZLockiem(kto: string, minut: number): number {
  const d = db()
    .prepare(
      "INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, opened_at) VALUES (4711,'FZ 4711/2026',?)"
    )
    .run(nowIso()).lastInsertRowid;
  return Number(
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, locked_by, locked_at)
         VALUES (?,1,'SYM','Nazwa',1,?,?)`
      )
      .run(d, kto, new Date(Date.now() - minut * 60_000).toISOString()).lastInsertRowid
  );
}

const lock = (lineId: number) =>
  db().prepare("SELECT locked_by FROM delivery_line WHERE id=?").get(lineId) as {
    locked_by: string | null;
  };

test("odebranie świeżego locka zostawia w audycie KOMU i przez KOGO", () => {
  // to jedyne miejsce, gdzie jedna osoba odbiera pracę drugiej bez jej wiedzy
  const line = liniaZLockiem("Jan Kowalski", 1);
  const r = D.forceReleaseLine(line, "Adam Brygadzista");
  assert.equal(r.odebrano, "Jan Kowalski");
  assert.equal(lock(line).locked_by, null);
  const ev = db().prepare("SELECT payload, user_id FROM events WHERE type='lock_forced'").all() as
    Array<{ payload: string; user_id: string }>;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].user_id, "Adam Brygadzista", "kto odebrał");
  assert.equal(JSON.parse(ev[0].payload).odebrano, "Jan Kowalski", "komu odebrał");
});

test("lock wygasły zdejmuje się bez wpisu — nikomu nic nie odebrano", () => {
  // po TTL linia i tak jest wolna; wpis „odebrał pracę" byłby wtedy oskarżeniem
  // o coś, co się nie wydarzyło
  const line = liniaZLockiem("Jan Kowalski", 60);
  assert.equal(D.forceReleaseLine(line, "Adam Brygadzista").odebrano, null);
  assert.equal(lock(line).locked_by, null);
  assert.equal(zdarzenia("lock_forced").length, 0);
});

/* ── Zarządzanie kontami: tylko biuro ────────────────────────────────────── */

test("brygadzista NIE zakłada kont, choć zdejmuje cudze locki", () => {
  // to jest jedyna operacja tworząca TOŻSAMOŚĆ: brygadzista, który może
  // założyć konto, może założyć konto biura z własnym PIN-em — i cała reszta
  // reguł przestaje cokolwiek znaczyć
  const b = U.createUser("Adam Brygadzista", "brygadzista", "4821");
  assert.equal(A.autoryzuj(b, "zdjecie_cudzego_locka", "4821").ok, true);
  const w = A.autoryzuj(b, "zarzadzanie_kontami", "4821");
  assert.equal(w.ok, false);
  assert.match(w.powod!, /biura/i, "komunikat mówi, czyich uprawnień brakuje");
});

test("magazynier nie zbliża się do kont", () => {
  const m = U.createUser("Jan Kowalski", "magazynier", "1111");
  assert.equal(A.autoryzuj(m, "zarzadzanie_kontami", "1111").ok, false);
});

test("biuro z PIN-em zarządza kontami, bez PIN-u nie", () => {
  const b = U.createUser("Biuro Zakupy", "biuro", "1234");
  assert.equal(A.autoryzuj(b, "zarzadzanie_kontami", null).ok, false);
  assert.equal(A.autoryzuj(b, "zarzadzanie_kontami", "9999").ok, false);
  assert.equal(A.autoryzuj(b, "zarzadzanie_kontami", "1234").ok, true);
});

test("furtka pierwszego konta zamyka się sama", () => {
  // bez niej nie dałoby się założyć ŻADNEGO konta; z nią otwartą na stałe
  // każdy w sieci magazynu zakładałby sobie konto biura
  assert.equal(U.brakKont(), true, "pusta baza — furtka otwarta");
  U.createUser("Biuro Zakupy", "biuro", "1234");
  assert.equal(U.brakKont(), false, "jeden wiersz i furtka zamknięta");
});

test("biuro też podaje PIN — rola mówi KTO może, PIN KTO to jest", () => {
  const u = U.createUser("Biuro Zakupy", "biuro", "1234");
  assert.equal(A.autoryzuj(u, "zdjecie_cudzego_locka", null).ok, false);
  assert.equal(A.autoryzuj(u, "zdjecie_cudzego_locka", "1234").ok, true);
});

/* ── Autor operacji z bufora offline ─────────────────────────────────────── */

/** Minimalne żądanie — `autorOperacji` czyta wyłącznie nagłówki. */
const zadanie = (h: Record<string, string>) => ({ headers: h }) as never;

test("operacja z bufora zostaje przy SWOIM autorze", async () => {
  // Jan odkłada 12 pozycji poza zasięgiem, oddaje kolektor Piotrowi, wraca
  // Wi-Fi. Bez tego wszystkie 12 dostałoby nazwisko Piotra — czyli ta sama
  // cicha podmiana tożsamości, przed którą broni jawne przejęcie pracy.
  const { autorOperacji } = await import("../context.js");
  const jan = U.createUser("Jan Kowalski");
  const a = autorOperacji(zadanie({ "x-buffered-user": String(jan.userId) }));
  assert.equal(a.nazwa, "Jan Kowalski");
  assert.equal(a.ref, jan.userId);
});

test("nagłówek wskazujący nieistniejące konto NIE jest tożsamością", async () => {
  // inaczej byłby to powrót do „podaj się za kogo chcesz" sprzed §7
  const { autorOperacji } = await import("../context.js");
  const a = autorOperacji(zadanie({ "x-buffered-user": "99999", "x-user": "ktoś" }));
  assert.equal(a.ref, null);
  assert.equal(a.nazwa, "ktoś", "zostaje najwyżej podpowiedź z x-user");
});

test("śmieci w nagłówku nie wywracają ścieżki", async () => {
  const { autorOperacji } = await import("../context.js");
  for (const zly of ["", "abc", "-1", "0", "1.5"]) {
    const a = autorOperacji(zadanie({ "x-buffered-user": zly }));
    assert.equal(a.ref, null, zly);
  }
});
