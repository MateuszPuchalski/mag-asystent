import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Encja sprawy — rekoncyliacja ────────────────────────────────────────────
   Sedno modelu: sklejanie automatyczne WYŁĄCZNIE po order_id (dwa pytania
   jednego klienta to dwie sprawy), stabilne id sprawy między przebiegami
   (na id staną zdarzenia etapu D) i idempotencja pełnej przebudowy.         */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-encja-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let S: typeof import("./sprawa.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./sprawa.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["sprawa_zrodlo", "sprawa", "zwrot_pozycja", "zwrot", "dyskusja", "pytanie", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

const dzis = "2026-08-20T10:00:00.000Z";

function pytanie(login: string | null, id?: string | null): number {
  const w = db()
    .prepare(
      `INSERT INTO pytanie (zrodlo, thread_id, wiadomosc_id, kupujacy_login, kupujacy_id,
         tresc, otrzymano_at, status, utworzono_at, utworzono_przez)
       VALUES ('allegro', ?, ?, ?, ?, 'treść', ?, 'nowe', ?, 'sync')`
    )
    .run(`t-${Math.random()}`, `w-${Math.random()}`, login, id ?? null, dzis, dzis);
  return Number(w.lastInsertRowid);
}

function zwrot(orderId: string | null, login = "jan_wraca", kupujacyId: string | null = "44300001"): number {
  const w = db()
    .prepare(
      `INSERT INTO zwrot (allegro_order_id, kupujacy_login, kupujacy_id, waybill, status,
         utworzono_at, utworzono_przez)
       VALUES (?, ?, ?, ?, 'nowy', ?, 'Test')`
    )
    .run(orderId, login, kupujacyId, `WB-${Math.random()}`, dzis);
  return Number(w.lastInsertRowid);
}

function dyskusja(orderId: string | null, login = "jan_wraca"): number {
  const w = db()
    .prepare(
      `INSERT INTO dyskusja (allegro_id, typ, status, temat, kupujacy_login, order_id,
         widziano_at, utworzono_at)
       VALUES (?, 'DISCUSSION', 'nowa', 'temat', ?, ?, ?, ?)`
    )
    .run(`iss-${Math.random()}`, login, orderId, dzis, dzis);
  return Number(w.lastInsertRowid);
}

function reklamacja(zwrotId: number): number {
  const w = db()
    .prepare(
      `INSERT INTO zwrot_pozycja (zwrot_id, nazwa, ilosc, decyzja)
       VALUES (?, 'Towar', 1, 'reklamacja')`
    )
    .run(zwrotId);
  return Number(w.lastInsertRowid);
}

function sprawy(): Array<Record<string, unknown>> {
  return db().prepare("SELECT * FROM sprawa ORDER BY id").all() as Array<Record<string, unknown>>;
}

test("auto-sklejanie WYŁĄCZNIE po order_id; dwa pytania jednego klienta to dwie sprawy", () => {
  const z = zwrot("zam-1");
  dyskusja("zam-1");
  reklamacja(z);
  pytanie("client:44300001", "44300001");
  pytanie("client:44300001", "44300001");
  S.przebudujSprawy();

  const lista = sprawy();
  assert.equal(lista.length, 3, "zam-1 skleja trójkę; pytania zostają osobno mimo tego samego kupującego");
  const zamowienie = lista.find((s) => s.order_id === "zam-1")!;
  const zrodla = db()
    .prepare("SELECT rodzaj FROM sprawa_zrodlo WHERE sprawa_id = ? ORDER BY rodzaj")
    .all(zamowienie.id as number) as Array<{ rodzaj: string }>;
  assert.deepEqual(zrodla.map((x) => x.rodzaj), ["dyskusja", "reklamacja", "zwrot"]);
  assert.equal(zamowienie.kupujacy_id, "44300001");
  assert.equal(zamowienie.kupujacy_login, "jan_wraca", "prawdziwy login przed maską");
});

test("rekoncyliacja jest idempotentna i nie zmienia id spraw", () => {
  const z = zwrot("zam-7");
  S.przebudujSprawy();
  const przed = sprawy();
  const idZwrotu = przed[0].id as number;

  /* Dołącza dyskusja tego samego zamówienia — sprawa ma zostać TA SAMA. */
  dyskusja("zam-7");
  db().prepare("UPDATE sprawa SET prowadzi = 'anna', prowadzi_at = ? WHERE id = ?").run(dzis, idZwrotu);
  S.przebudujSprawy();
  S.przebudujSprawy();

  const po = sprawy();
  assert.equal(po.length, 1);
  assert.equal(po[0].id, idZwrotu, "grupa przejmuje sprawę o najmniejszym id");
  assert.equal(po[0].prowadzi, "anna", "prowadzący przeżywa dołączenie źródła");
  const wiazan = db().prepare("SELECT COUNT(*) AS n FROM sprawa_zrodlo").get() as { n: number };
  assert.equal(wiazan.n, 2);
  void z;
});

test("zwrot ręczny bez zamówienia trzyma swoje reklamacje w jednej sprawie", () => {
  const z = zwrot(null, "ewa_oddaje", null);
  reklamacja(z);
  reklamacja(z);
  S.przebudujSprawy();
  const lista = sprawy();
  assert.equal(lista.length, 1, "klucz zastępczy zwrot:<id> skleja paczkę");
  assert.equal(lista[0].order_id, null);
  const n = db().prepare("SELECT COUNT(*) AS n FROM sprawa_zrodlo").get() as { n: number };
  assert.equal(n.n, 3);
});

test("zamknięcie wszystkich źródeł stempluje sprawę; otwarcie zdejmuje stempel", () => {
  const z = zwrot("zam-3");
  S.przebudujSprawy();
  db().prepare("UPDATE zwrot SET status = 'rozliczony' WHERE id = ?").run(z);
  S.przebudujSprawy();
  assert.ok(sprawy()[0].zamknieto_at, "sprawa bez otwartych źródeł jest zamknięta");
  db().prepare("UPDATE zwrot SET status = 'nowy' WHERE id = ?").run(z);
  S.przebudujSprawy();
  assert.equal(sprawy()[0].zamknieto_at, null, "reaktywacja źródła otwiera sprawę z powrotem");
});

test("skasowane źródło znika z wiązań, sprawa-sierota znika z tabeli", () => {
  const p = pytanie("client:44300009", "44300009");
  S.przebudujSprawy();
  assert.equal(sprawy().length, 1);
  db().prepare("DELETE FROM pytanie WHERE id = ?").run(p);
  S.przebudujSprawy();
  assert.equal(sprawy().length, 0);
  const n = db().prepare("SELECT COUNT(*) AS n FROM sprawa_zrodlo").get() as { n: number };
  assert.equal(n.n, 0);
});

test("kupujacyIdZMaski: maska oddaje liczbę, prawdziwy login NULL", () => {
  assert.equal(S.kupujacyIdZMaski("client:44300444"), "44300444");
  assert.equal(S.kupujacyIdZMaski("jan_wraca"), null);
  assert.equal(S.kupujacyIdZMaski("client:abc"), null, "maska bez liczby to nie identyfikator");
  assert.equal(S.kupujacyIdZMaski(null), null);
});

test("stempelProwadziSprawy pisze sprawę i loguje zdarzenie", () => {
  zwrot("zam-5");
  S.przebudujSprawy();
  const id = sprawy()[0].id as number;
  S.stempelProwadziSprawy(id, "ola");
  assert.equal(sprawy()[0].prowadzi, "ola");
  const zdarzen = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'sprawa_prowadzi'")
    .get() as { n: number };
  assert.equal(zdarzen.n, 1, "przejęcie to mutacja z klika — loguje się");
  assert.throws(() => S.stempelProwadziSprawy(999_999, "ola"), /Nie ma takiej sprawy/);
});

/* ── Wiązania ręczne w rekoncyliacji (0.129.0) ───────────────────────────────
   Do 0.129.0 źródła spięte ręką człowieka wypadały z przeliczenia PRZED
   denormalizacją: sprawa złożona z samych takich wiązań nie dostawała ani
   kupującego, ani numeru zamówienia, ani stempla zamknięcia. Fazy A/B/C
   naprawiają to jednym `UPDATE` na sprawę, nad kompletem członków.          */

function zwiazRecznie(rodzaj: string, lokalnyId: number, sprawaId: number): void {
  db()
    .prepare(
      `UPDATE sprawa_zrodlo SET sprawa_id = ?, wiazanie = 'reczne'
        WHERE rodzaj = ? AND lokalny_id = ?`
    )
    .run(sprawaId, rodzaj, lokalnyId);
}

test("sprawa z wiązaniami ręcznymi dostaje denormalizację ze WSZYSTKICH źródeł", () => {
  const p = pytanie("client:44300555", "44300555");
  const z = zwrot("zam-r1", "marek_m", "44300555");
  S.przebudujSprawy();
  const idPytania = db()
    .prepare("SELECT sprawa_id AS s FROM sprawa_zrodlo WHERE rodzaj='pytanie' AND lokalny_id=?")
    .get(p) as { s: number };
  /* Ręczne spięcie: zwrot przechodzi do sprawy pytania. */
  zwiazRecznie("zwrot", z, idPytania.s);
  S.przebudujSprawy();

  const sprawa = db().prepare("SELECT * FROM sprawa WHERE id = ?").get(idPytania.s) as
    Record<string, unknown>;
  assert.equal(sprawa.order_id, "zam-r1", "numer zamówienia przychodzi z ręcznie spiętego zwrotu");
  assert.equal(sprawa.kupujacy_login, "marek_m", "prawdziwy login bije maskę pytania");
  assert.equal(sprawa.kupujacy_id, "44300555");
  assert.equal(sprawa.zamknieto_at, null, "oba źródła otwarte — sprawa też");
});

test("sprawa z samych wiązań ręcznych zamyka się, gdy padnie ostatnie źródło", () => {
  const p = pytanie("client:44300556", "44300556");
  const z = zwrot("zam-r2", "iza_i", "44300556");
  S.przebudujSprawy();
  const idPytania = (
    db()
      .prepare("SELECT sprawa_id AS s FROM sprawa_zrodlo WHERE rodzaj='pytanie' AND lokalny_id=?")
      .get(p) as { s: number }
  ).s;
  zwiazRecznie("zwrot", z, idPytania);
  S.przebudujSprawy();

  db().prepare("UPDATE pytanie SET status = 'wyslane' WHERE id = ?").run(p);
  db().prepare("UPDATE zwrot SET status = 'rozliczony' WHERE id = ?").run(z);
  S.przebudujSprawy();
  const sprawa = db().prepare("SELECT zamknieto_at FROM sprawa WHERE id = ?").get(idPytania) as {
    zamknieto_at: string | null;
  };
  assert.ok(sprawa.zamknieto_at, "ostatnie źródło zamknięte — sprawa dostaje stempel");
});

test("rekoncyliacja NIE rozkleja wiązania ręcznego i jest po nim idempotentna", () => {
  const p = pytanie("client:44300557", "44300557");
  const z = zwrot("zam-r3", "ola_o", "44300557");
  S.przebudujSprawy();
  const idPytania = (
    db()
      .prepare("SELECT sprawa_id AS s FROM sprawa_zrodlo WHERE rodzaj='pytanie' AND lokalny_id=?")
      .get(p) as { s: number }
  ).s;
  zwiazRecznie("zwrot", z, idPytania);
  S.przebudujSprawy();
  const stan = () =>
    JSON.stringify(
      db()
        .prepare("SELECT rodzaj, lokalny_id, sprawa_id, wiazanie FROM sprawa_zrodlo ORDER BY rodzaj")
        .all()
    );
  const przed = stan();
  S.przebudujSprawy();
  S.przebudujSprawy();
  assert.equal(stan(), przed, "dwa dalsze przebiegi nie ruszają ręcznego spięcia");
  assert.equal(sprawy().length, 1, "zwrot nie wraca do własnej sprawy po order_id");
});

/* ── SCAL i ROZKLEJ (0.129.0) ────────────────────────────────────────────────
   Potwierdzenie podpowiedzi „ten sam kupujący" ręką człowieka i jego
   cofnięcie. Automat nie ma prawa rozkleić tego, co spiął człowiek — ale
   człowiek nie ma prawa rozkleić tego, co automat i tak sklei z powrotem.  */

test("SCAL przenosi źródła dawcy pod mniejsze id i oznacza je jako ręczne", () => {
  const p = pytanie("client:44300601", "44300601");
  const z = zwrot("zam-s1", "kasia_k", "44300601");
  S.przebudujSprawy();
  const lista = sprawy();
  assert.equal(lista.length, 2, "pytanie i zwrot to na starcie dwie sprawy");
  const a = lista[0].id as number;
  const b = lista[1].id as number;

  /* Panel może podać sprawy w dowolnej kolejności — docelowa i tak jest ta
     o mniejszym id, bo na id staną zdarzenia etapu D2. */
  const docelowa = S.scalSprawy(b, a, "ola");
  assert.equal(docelowa, Math.min(a, b));
  assert.equal(sprawy().length, 1, "sprawa-dawca znika jako sierota");
  const zrodla = db()
    .prepare("SELECT rodzaj, wiazanie FROM sprawa_zrodlo WHERE sprawa_id = ? ORDER BY rodzaj")
    .all(docelowa) as Array<{ rodzaj: string; wiazanie: string }>;
  assert.deepEqual(zrodla.map((x) => x.rodzaj), ["pytanie", "zwrot"]);
  assert.ok(zrodla.some((x) => x.wiazanie === "reczne"), "źródła dawcy są odtąd ręczne");
  const zdarzen = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'sprawa_scalona'")
    .get() as { n: number };
  assert.equal(zdarzen.n, 1, "scalenie to decyzja człowieka — loguje się");
  void p;
  void z;
});

test("SCAL odmawia scalenia sprawy ze sobą i sprawy nieistniejącej", () => {
  zwrot("zam-s2");
  S.przebudujSprawy();
  const id = sprawy()[0].id as number;
  assert.throws(() => S.scalSprawy(id, id, "ola"), /jedna i ta sama/);
  assert.throws(() => S.scalSprawy(id, 999_999, "ola"), /Nie ma takiej sprawy/);
});

test("ROZKLEJ cofa scalenie: źródła wracają tam, gdzie chce automat", () => {
  const p = pytanie("client:44300602", "44300602");
  const z = zwrot("zam-s3", "ewa_e", "44300602");
  const dy = dyskusja("zam-s3", "ewa_e");
  S.przebudujSprawy();
  assert.equal(sprawy().length, 2, "pytanie osobno, zwrot z dyskusją razem");
  const [a, b] = sprawy().map((s) => s.id as number);
  const docelowa = S.scalSprawy(a, b, "ola");
  assert.equal(sprawy().length, 1);

  S.rozklejSprawe(docelowa, "ola");
  const po = sprawy();
  assert.equal(po.length, 2, "wracamy do układu sprzed scalenia");
  /* Zwrot i dyskusja tego samego zamówienia wracają RAZEM — to jest cały
     sens rozklejania sprawy zamiast pojedynczych źródeł. */
  const razem = db()
    .prepare(
      `SELECT sprawa_id AS s FROM sprawa_zrodlo
        WHERE (rodzaj = 'zwrot' AND lokalny_id = ?) OR (rodzaj = 'dyskusja' AND lokalny_id = ?)`
    )
    .all(z, dy) as Array<{ s: number }>;
  assert.equal(new Set(razem.map((x) => x.s)).size, 1);
  const wiazania = db()
    .prepare("SELECT DISTINCT wiazanie AS w FROM sprawa_zrodlo")
    .all() as Array<{ w: string }>;
  assert.deepEqual(wiazania.map((x) => x.w), ["auto"], "po rozklejeniu nie ma już ręcznych spięć");
  const zdarzen = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'sprawa_rozklejona'")
    .get() as { n: number };
  assert.equal(zdarzen.n, 1);
  void p;
});

test("ROZKLEJ odmawia sprawie, w której nic nie spięto ręką", () => {
  zwrot("zam-s5");
  S.przebudujSprawy();
  const id = sprawy()[0].id as number;
  assert.throws(() => S.rozklejSprawe(id, "ola"), /nic nie zostało spięte/);
  assert.throws(() => S.rozklejSprawe(999_999, "ola"), /Nie ma takiej sprawy/);
});
