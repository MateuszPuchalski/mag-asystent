import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Cofanie pomyłek przy rozkładaniu dostawy ────────────────────────────────
   ZGŁOSZENIE WŁAŚCICIELA: „jak już zaznaczyłem, że wszystko jest, a się
   pomyliłem, to nie mogę tego cofnąć".

   Ten plik pilnuje czterech dróg powrotu i ich granic. Najważniejsza jest
   pierwsza: odłożenie OSTATNIEJ pozycji domyka dostawę, a do tego wydania
   zamknięta dostawa nie przyjmowała już żadnej poprawki. Pomyłka przy końcu
   palety była więc jedyną, której nie dało się naprawić.                     */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-cofanie-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";
process.env.MAG_ID_SERWIS = "4";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");
let C: typeof import("./cofanie-dostawy.js");
let P: typeof import("./problems.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
  C = await import("./cofanie-dostawy.js");
  P = await import("./problems.js");
});

const DOK = 777;
const dzis = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  const d = db();
  for (const t of ["events", "sfera_queue", "problem", "delivery_note", "delivery_line", "delivery",
                   "sgt_pozycja", "sgt_dokument", "sgt_towar"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

/** Dostawa z pozycjami; zwraca identyfikatory linii w kolejności wejścia. */
function dostawa(pozycje: Array<{ tw: number; sym: string; lok: string; ilosc: number }>): {
  id: number;
  linie: number[];
} {
  const d = db();
  d.prepare(
    `INSERT INTO sgt_dokument(dok_id,typ,nr_pelny,data_wyst,mag_id,dostawca,w_buforze)
     VALUES (?,'FZ',?,?,1,'Dostawca sp. z o.o.',0)`
  ).run(DOK, `FZ ${DOK}/09/2026`, dzis());
  for (const p of pozycje) {
    d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,lokalizacja) VALUES (?,?,?,?)")
      .run(p.tw, p.sym, `Towar ${p.sym}`, p.lok);
    d.prepare("INSERT INTO sgt_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)").run(DOK, p.tw, p.ilosc);
  }
  const id = D.openDelivery(DOK, "jan");
  const linie = pozycje.map(
    (p) =>
      (d.prepare("SELECT id FROM delivery_line WHERE delivery_id=? AND tw_id=?").get(id, p.tw) as {
        id: number;
      }).id
  );
  return { id, linie };
}

const linia = (id: number) =>
  db()
    .prepare(
      "SELECT ilosc_odlozona AS qty, status, lok_faktyczna AS lok, cofniecie FROM delivery_line WHERE id=?"
    )
    .get(id) as { qty: number; status: string; lok: string | null; cofniecie: string | null };

const stanDostawy = (id: number) =>
  (db().prepare("SELECT status FROM delivery WHERE id=?").get(id) as { status: string }).status;

const zadania = () =>
  db()
    .prepare("SELECT id, status, payload FROM sfera_queue WHERE type='set_location' ORDER BY id")
    .all() as Array<{ id: number; status: string; payload: string }>;

const pole = (z: { payload: string }) => (JSON.parse(z.payload) as { newValue: string }).newValue;

/** Worker przyszedł i zapisał — tak wygląda zadanie, którego już nie ma jak zatrzymać. */
const wykonaj = (queueId: number) =>
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(queueId);

/* ── COFNIJ: sedno zgłoszenia ─────────────────────────────────────────────── */

test("cofnięcie ostatniej pozycji otwiera dostawę, którą to odłożenie domknęło", () => {
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  assert.equal(stanDostawy(id), "done", "ostatnia pozycja domyka dostawę jak dotąd");

  const r = C.cofnijOdlozenie(linie[0], "jan");
  assert.ok(!("error" in r), JSON.stringify(r));
  assert.equal(r.otwartaPonownie, true);
  assert.equal(stanDostawy(id), "open");
  const l = linia(linie[0]);
  assert.equal(l.qty, 0);
  assert.equal(l.status, "todo");
  assert.equal(l.lok, null, "półka wraca do stanu sprzed odłożenia");
  assert.equal(l.cofniecie, null, "drugie cofnięcie tego samego nie ma czego cofać");
});

test("cofnięcie ANULUJE czekający zapis adresu zamiast pisać drugi", () => {
  // zadanie jeszcze nie dotknęło Subiekta — najtańszy powrót to go nie wysłać
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  const r = C.cofnijOdlozenie(linie[0], "jan");
  assert.ok(!("error" in r));
  assert.equal(r.adres, "anulowany");
  const z = zadania();
  assert.equal(z.length, 1);
  assert.equal(z[0].status, "cancelled");
});

test("gdy adres już wszedł do Subiekta, cofnięcie pisze stary adres WPRZÓD", () => {
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01 C03-03-03", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  wykonaj(zadania()[0].id);
  const r = C.cofnijOdlozenie(linie[0], "jan");
  assert.ok(!("error" in r));
  assert.equal(r.adres, "zapisany");
  const z = zadania();
  assert.equal(z.length, 2);
  assert.equal(pole(z[1]), "A01-01-01 C03-03-03", "pole wraca co do kolejności");
});

test("cofnięcie odłożenia częściowego odejmuje tylko jego sztuki", () => {
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 4 });
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 3 });
  C.cofnijOdlozenie(linie[0], "jan");
  const l = linia(linie[0]);
  assert.equal(l.qty, 4, "cofa się OSTATNIE odłożenie, nie całą pozycję");
  assert.equal(l.status, "partial");
});

test("po korekcie ilości cofnięcie odmawia — liczba nie wynika już ze skanu", () => {
  const { linie } = dostawa([
    { tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 },
    { tw: 2, sym: "GRABIE", lok: "A01-01-02", ilosc: 5 },
  ]);
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 6 });
  D.korygujIlosc(linie[0], 5, "jan");
  const r = C.cofnijOdlozenie(linie[0], "jan");
  assert.ok("error" in r);
  assert.match(r.error, /POPRAW ILOŚĆ/);
  assert.equal(linia(linie[0]).qty, 5);
});

test("zapis w toku u workera: cofnięcie czeka, niczego nie ruszając", () => {
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  db().prepare("UPDATE sfera_queue SET status='processing'").run();
  const r = C.cofnijOdlozenie(linie[0], "jan");
  assert.ok("error" in r);
  assert.match(r.error, /spróbuj/);
  assert.equal(linia(linie[0]).qty, 10);
});

test("adres zmieniony po odłożeniu inną drogą blokuje cofnięcie", () => {
  /* Bez tej bramki cofnięcie wróciłoby do adresu sprzed odłożenia i po cichu
     zjadło zmianę zrobioną w międzyczasie na karcie towaru. */
  const { linie } = dostawa([
    { tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 },
    { tw: 2, sym: "GRABIE", lok: "A01-01-02", ilosc: 5 },
  ]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, label, detail, tw_id, created_by)
       VALUES ('set_location', '{"twId":1,"newValue":"D04-04-04"}', 'pending', 'x', 'x', 1, 'ola')`
    )
    .run();
  const r = C.cofnijOdlozenie(linie[0], "jan");
  assert.ok("error" in r);
  assert.match(r.error, /karcie towaru/);
});

/* ── ZMIEŃ PÓŁKĘ ──────────────────────────────────────────────────────────── */

test("zmiana półki podmienia czekający zapis i zostawia resztę adresów", () => {
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01 C03-03-03", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan"); // ZAMIEŃ — pickingowy B, zapas C zostaje
  const r = C.zmienPolke(linie[0], "b02-02-03", "jan");
  assert.ok(!("error" in r), JSON.stringify(r));
  assert.equal(r.lok, "B02-02-03");
  const z = zadania();
  assert.equal(z[0].status, "cancelled", "błędny zapis nie dochodzi do Subiekta wcale");
  assert.equal(pole(z[1]), "B02-02-03 C03-03-03");
  assert.equal(linia(linie[0]).lok, "B02-02-03");
  assert.equal(linia(linie[0]).qty, 10, "ilość zostaje — nikt jej nie kwestionuje");
});

test("zmiana półki przy DODAJ dokłada właściwy kod, nie ruszając pickingowego", () => {
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan", { locAction: "add" });
  C.zmienPolke(linie[0], "B02-02-03", "jan");
  assert.equal(pole(zadania().at(-1)!), "A01-01-01 B02-02-03");
});

test("cofnięcie po zmianie półki na WYKONANYM zapisie wraca do adresu sprzed dostawy", () => {
  /* Najtrudniejszy przypadek: błędny zapis już w Subiekcie, poprawka czeka.
     Samo anulowanie poprawki zostawiłoby w kartotece BŁĘDNĄ półkę. */
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  wykonaj(zadania()[0].id);
  C.zmienPolke(linie[0], "B02-02-03", "jan");
  const r = C.cofnijOdlozenie(linie[0], "jan");
  assert.ok(!("error" in r), JSON.stringify(r));
  const z = zadania();
  assert.equal(z[1].status, "cancelled", "poprawka, która czekała, nie idzie");
  assert.equal(pole(z[2]), "A01-01-01", "a Subiekt dostaje adres sprzed dostawy");
});

test("zmiana na tę samą półkę odmawia zdaniem, nie zadaniem w kolejce", () => {
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  const r = C.zmienPolke(linie[0], "B02-02-02", "jan");
  assert.ok("error" in r);
  assert.equal(zadania().length, 1);
});

test("zmiana półki odrzuca kod, który nie jest adresem", () => {
  const { linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  assert.ok("error" in C.zmienPolke(linie[0], "KOSA-1", "jan"));
});

test("zmiana półki działa na dostawie zamkniętej — adres nie należy do protokołu", () => {
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "B02-02-02", "jan");
  assert.equal(stanDostawy(id), "done");
  const r = C.zmienPolke(linie[0], "B02-02-03", "jan");
  assert.ok(!("error" in r));
  assert.equal(stanDostawy(id), "done", "sama półka nie otwiera dostawy");
});

/* ── OTWÓRZ PONOWNIE ──────────────────────────────────────────────────────── */

test("przedwczesne ZAKOŃCZ: otwarcie wycofuje braki i przywraca pominięte", () => {
  const { id, linie } = dostawa([
    { tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 },
    { tw: 2, sym: "GRABIE", lok: "A01-01-02", ilosc: 5 },
  ]);
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 4 });
  D.zakonczDostawe(id, "jan");
  assert.equal(stanDostawy(id), "done");
  assert.equal(linia(linie[0]).status, "problem");
  assert.equal(linia(linie[1]).status, "skipped");

  const r = C.otworzPonownie(id, "jan");
  assert.ok(!("error" in r), JSON.stringify(r));
  assert.equal(r.wycofane, 1);
  assert.equal(r.przywrocone, 1);
  assert.equal(stanDostawy(id), "open");
  assert.equal(linia(linie[0]).status, "partial", "odłożone 4 z 10 zostaje odłożone");
  assert.equal(linia(linie[1]).status, "todo");
  const n = db().prepare("SELECT COUNT(*) AS n FROM problem").get() as { n: number };
  assert.equal(n.n, 0, "zgłoszenie braku z ZAKOŃCZ znika razem z zamknięciem");
});

test("otwarcie zostawia zgłoszenie złożone przez człowieka", () => {
  const { id, linie } = dostawa([
    { tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 },
    { tw: 2, sym: "GRABIE", lok: "A01-01-02", ilosc: 5 },
  ]);
  P.raiseProblem({ deliveryId: id, lineId: linie[0], typ: "qty_mismatch", qty: 8 }, "jan");
  D.putawayLine(linie[1], "A01-01-02", "jan");
  assert.equal(stanDostawy(id), "done");
  C.otworzPonownie(id, "jan");
  assert.equal(linia(linie[0]).status, "problem", "twierdzenie człowieka nie znika z otwarciem");
  const n = db().prepare("SELECT COUNT(*) AS n FROM problem").get() as { n: number };
  assert.equal(n.n, 1);
});

test("otwarcie wycofuje nadmiar zgłoszony przy domknięciu", () => {
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 12 });
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM problem WHERE zrodlo='nadmiar'").get() as { n: number }).n,
    1
  );
  C.cofnijOdlozenie(linie[0], "jan");
  assert.equal(stanDostawy(id), "open");
  const n = db().prepare("SELECT COUNT(*) AS n FROM problem").get() as { n: number };
  assert.equal(n.n, 0, "omyłkowy nadmiar nie idzie do dostawcy");
});

test("rozstrzygnięte przez biuro zgłoszenie z zamknięcia blokuje otwarcie", () => {
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 4 });
  D.zakonczDostawe(id, "jan");
  db().prepare("UPDATE problem SET resolved_at=?, resolved_by='biuro'").run(new Date().toISOString());
  const m = C.mozliwoscOtwarcia(id);
  assert.equal(m.mozna, false);
  assert.match(m.powod!, /biuro/i);
  assert.ok("error" in C.otworzPonownie(id, "jan"));
  assert.equal(stanDostawy(id), "done");
});

test("dostawę zamkniętą wczoraj otwiera już tylko biuro", () => {
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "A01-01-01", "jan");
  const wczoraj = new Date(Date.now() - 36 * 3600_000).toISOString();
  db().prepare("UPDATE delivery SET closed_at=? WHERE id=?").run(wczoraj, id);
  const r = C.otworzPonownie(id, "jan");
  assert.ok("error" in r);
  assert.match(r.error, /w dniu zamknięcia/);
});

test("otwarcie odmawia na dostawie otwartej i rozłożonej poza WERTIS", () => {
  const { id } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  assert.ok("error" in C.otworzPonownie(id, "jan"));
  db().prepare("UPDATE delivery SET status='external' WHERE id=?").run(id);
  assert.ok("error" in C.otworzPonownie(id, "jan"));
});

test("otwarcie zatrzymuje MM braku, które jeszcze czeka w kolejce", () => {
  // brak z ZAKOŃCZ zdjął towar ze sprzedaży — wycofany brak nie może go dalej trzymać
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 4 });
  D.zakonczDostawe(id, "jan");
  const mm = db().prepare("SELECT id, status FROM sfera_queue WHERE type='mm'").get() as
    | { id: number; status: string }
    | undefined;
  assert.ok(mm, "brak przy ZAKOŃCZ wystawia MM na magazyn serwisowy");
  C.otworzPonownie(id, "jan");
  const po = db().prepare("SELECT status FROM sfera_queue WHERE id=?").get(mm!.id) as { status: string };
  assert.equal(po.status, "cancelled");
});

test("wykonane MM braku blokuje otwarcie — dokumentu w Subiekcie nie udajemy", () => {
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 4 });
  D.zakonczDostawe(id, "jan");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='mm'").run();
  const r = C.otworzPonownie(id, "jan");
  assert.ok("error" in r);
  assert.match(r.error, /serwisowy/);
});

/* ── WYCOFAJ ZGŁOSZENIE ───────────────────────────────────────────────────── */

test("własne zgłoszenie wycofane — pozycja wraca do roboty z tym, co odłożono", () => {
  const { id, linie } = dostawa([
    { tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 },
    { tw: 2, sym: "GRABIE", lok: "A01-01-02", ilosc: 5 },
  ]);
  D.putawayLine(linie[0], "A01-01-01", "jan", { qty: 6 });
  const p = P.raiseProblem({ deliveryId: id, lineId: linie[0], typ: "qty_mismatch", qty: 6 }, "jan");
  assert.ok("id" in p);
  assert.equal(linia(linie[0]).status, "problem");

  const r = C.wycofajZgloszenie(p.id, "jan");
  assert.ok(!("error" in r), JSON.stringify(r));
  assert.equal(r.statusLinii, "partial");
  const w = db().prepare("SELECT payload FROM events WHERE type='problem_wycofany'").get() as { payload: string };
  assert.match(w.payload, /qty_mismatch/, "treść zgłoszenia zostaje w dzienniku");
});

test("cudze, rozstrzygnięte i automatyczne zgłoszenie nie dają się wycofać", () => {
  const { id, linie } = dostawa([
    { tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 },
    { tw: 2, sym: "GRABIE", lok: "A01-01-02", ilosc: 5 },
  ]);
  const p = P.raiseProblem({ deliveryId: id, lineId: linie[0], typ: "qty_mismatch", qty: 6 }, "jan");
  assert.ok("id" in p);
  const cudze = C.wycofajZgloszenie(p.id, "ola");
  assert.ok("error" in cudze);
  assert.match(cudze.error, /jan/);

  db().prepare("UPDATE problem SET resolved_at=? WHERE id=?").run(new Date().toISOString(), p.id);
  assert.ok("error" in C.wycofajZgloszenie(p.id, "jan"));

  db().prepare("UPDATE problem SET resolved_at=NULL, zrodlo='zakonczenie' WHERE id=?").run(p.id);
  const auto = C.wycofajZgloszenie(p.id, "jan");
  assert.ok("error" in auto);
  assert.match(auto.error, /OTWÓRZ PONOWNIE/);
});

test("zgłoszenie na zamkniętej dostawie: najpierw otwarcie, potem wycofanie", () => {
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  const p = P.raiseProblem({ deliveryId: id, lineId: linie[0], typ: "qty_mismatch", qty: 6 }, "jan");
  assert.ok("id" in p);
  assert.equal(stanDostawy(id), "done", "wyjątek na ostatniej pozycji domyka dostawę");
  assert.match((C.wycofajZgloszenie(p.id, "jan") as { error: string }).error, /OTWÓRZ PONOWNIE/);
  C.otworzPonownie(id, "jan");
  const r = C.wycofajZgloszenie(p.id, "jan");
  assert.ok(!("error" in r));
  assert.equal(r.statusLinii, "todo");
});

/* ── Widok dostawy niesie drogi powrotu ───────────────────────────────────── */

test("widok dostawy mówi, co da się cofnąć i czy da się otworzyć", () => {
  const { id, linie } = dostawa([{ tw: 1, sym: "KOSA-1", lok: "A01-01-01", ilosc: 10 }]);
  const otwarta = D.getDelivery(id)!;
  assert.equal(otwarta.otwarcie, null);
  assert.equal(otwarta.lines[0].cofnij, null);

  D.putawayLine(linie[0], "B02-02-02", "jan", { qty: 10 });
  const zamknieta = D.getDelivery(id)!;
  assert.deepEqual(zamknieta.otwarcie, { mozna: true, powod: null });
  assert.deepEqual(zamknieta.lines[0].cofnij, { qty: 10, lok: "B02-02-02" });
});
