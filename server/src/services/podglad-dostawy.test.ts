import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Podgląd dokumentu dla biura ─────────────────────────────────────────────
   Dwa niezmienniki są tu ważniejsze od reszty i oba są niewidoczne na ekranie:

   1. PODGLĄD NICZEGO NIE ZAPISUJE. Kliknięcie w biurze nie ma prawa otworzyć
      dostawy — inaczej samo patrzenie zapełniałoby listę pracy dokumentami,
      których nikt nie zaczął, i zabierało blokady ludziom przy półce.
   2. PODGLĄD I SNAPSHOT DAJĄ TEN SAM ZESTAW LINII. Rozjazd tych dwóch dałby
      biuro i halę patrzące na dwie różne faktury — obie wyglądające
      wiarygodnie, żadna nieoznaczona jako fałszywa.                          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-podglad-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let P: typeof import("./podglad-dostawy.js");
let D: typeof import("./delivery.js");
let R: typeof import("./problems.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  P = await import("./podglad-dostawy.js");
  D = await import("./delivery.js");
  R = await import("./problems.js");
});

const DOK = 700;
const GAZNIK = 21;
const LOZYSKO = 22;
const BEZ_ADRESU = 23;
const PRZESYLKA = 24;

const wczoraj = () => new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

/** Ile wierszy `delivery`/`delivery_line` stoi w bazie. */
const ile = (tabela: string) =>
  (db().prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;

beforeEach(() => {
  const d = db();
  /* `sfera_queue` MUSI tu być: adres oczekiwany pozycji nietkniętej idzie za
     kolejką przed kartoteką, więc zadanie z poprzedniego testu przeciekałoby
     do następnego jako adres nie wiadomo skąd. */
  for (const t of [
    "problem", "delivery_line", "delivery", "sfera_queue", "events",
    "sgt_pozycja", "sgt_dokument", "sgt_towar",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const towar = d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, lokalizacja) VALUES (?,?,?,?)"
  );
  towar.run(GAZNIK, "LS51-139", "Gaźnik kompletny", "A01-02-03");
  towar.run(LOZYSKO, "LZ-6202", "Łożysko 6202", "C04-01-02");
  towar.run(BEZ_ADRESU, "NOWOSC-1", "Kartoteka bez adresu", "");
  towar.run(PRZESYLKA, "PRZESYŁKA", "koszt transportu", "");

  d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,'FZ','FZ 700/MAG/08/2026',?,1,'Dostawca sp. z o.o.',0)`
  ).run(DOK, wczoraj());
  const poz = d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)");
  poz.run(DOK, GAZNIK, 4);
  poz.run(DOK, LOZYSKO, 10);
  poz.run(DOK, BEZ_ADRESU, 2);
  poz.run(DOK, PRZESYLKA, 1);
});

/* ── Zero zapisu ──────────────────────────────────────────────────────────── */

test("podgląd nietkniętego dokumentu NICZEGO nie zapisuje", () => {
  /* Sedno całej funkcji. `openDelivery` zakłada rekord dostawy, sprząta pozycje
     usługowe i przestawia dokument na liście z NIETKNIĘTA na W TOKU — wywołany
     stąd sprawiłby, że samo patrzenie zmienia stan magazynu. */
  const d = P.podgladDokumentu(DOK)!;
  assert.equal(ile("delivery"), 0);
  assert.equal(ile("delivery_line"), 0);
  assert.equal(d.deliveryId, null);
  assert.equal(d.status, null);
  assert.equal(d.zrodlo, "podglad");
});

test("podgląd i snapshot dają ten sam zestaw linii, w tej samej kolejności", () => {
  const przed = P.podgladDokumentu(DOK)!.lines.map((l) => [l.sym, l.qtyDoc, l.locExpected]);
  D.openDelivery(DOK, "tester");
  const po = P.podgladDokumentu(DOK)!;
  assert.equal(po.zrodlo, "snapshot");
  assert.deepEqual(
    po.lines.map((l) => [l.sym, l.qtyDoc, l.locExpected]),
    przed
  );
});

/* ── Zestaw linii ─────────────────────────────────────────────────────────── */

test("pozycja usługowa nie wchodzi do podglądu", () => {
  const symbole = P.podgladDokumentu(DOK)!.lines.map((l) => l.sym);
  assert.ok(!symbole.includes("PRZESYŁKA"), symbole.join(","));
  assert.equal(symbole.length, 3);
});

test("ten sam towar w dwóch pozycjach faktury to jedna linia z sumą", () => {
  db().prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)").run(DOK, GAZNIK, 6);
  const linie = P.podgladDokumentu(DOK)!.lines.filter((l) => l.sym === "LS51-139");
  assert.equal(linie.length, 1);
  assert.equal(linie[0].qtyDoc, 10);
});

test("bez lokalizacji na końcu listy i z markerem", () => {
  const linie = P.podgladDokumentu(DOK)!.lines;
  assert.equal(linie.at(-1)!.sym, "NOWOSC-1");
  assert.equal(linie.at(-1)!.bezLokalizacji, true);
  assert.equal(linie[0].bezLokalizacji, false);
});

test("nieznany dokument nie ma podglądu", () => {
  assert.equal(P.podgladDokumentu(999999), undefined);
});

/* ── Praca kolektora widziana z biura ─────────────────────────────────────── */

/** Otwiera dostawę i zwraca id linii danego symbolu. */
function otworz(sym: string): { id: number; lineId: number } {
  const id = D.openDelivery(DOK, "tester");
  const l = db()
    .prepare("SELECT id FROM delivery_line WHERE delivery_id=? AND tw_symbol=?")
    .get(id, sym) as { id: number };
  return { id, lineId: l.id };
}

const linia = (sym: string) => P.podgladDokumentu(DOK)!.lines.find((l) => l.sym === sym)!;

test("odłożona pozycja niesie autora i godzinę", () => {
  // te trzy kolumny leżały w bazie od 0.17.0 i nie czytał ich NIKT
  const { lineId } = otworz("LS51-139");
  D.putawayLine(lineId, "A01-02-03", "Jan Kowalski");
  const l = linia("LS51-139");
  assert.equal(l.status, "done");
  assert.equal(l.doneBy, "Jan Kowalski");
  assert.ok(l.doneAt, "brak znacznika czasu");
  assert.equal(l.locActual, "A01-02-03");
});

test("rozjazd adresu jest oznaczony, zgodność nie", () => {
  const { lineId } = otworz("LS51-139");
  D.putawayLine(lineId, "B02-01-01", "Jan Kowalski");
  assert.equal(linia("LS51-139").mismatch, true);

  const drugi = db()
    .prepare("SELECT id FROM delivery_line WHERE tw_symbol='LZ-6202'")
    .get() as { id: number };
  D.putawayLine(drugi.id, "C04-01-02", "Jan Kowalski");
  assert.equal(linia("LZ-6202").mismatch, false);
});

test("pozycja jeszcze nigdzie nieodłożona nie ma rozjazdu", () => {
  otworz("LS51-139");
  assert.equal(linia("LS51-139").mismatch, false);
});

test("odłożenie zdejmuje marker braku lokalizacji", () => {
  // „bez lokalizacji" znaczy „NIGDZIE jeszcze nie leży"; towar odłożony ma już
  // adres i przestaje być decyzją dla biura
  const { id } = otworz("LS51-139");
  const l = db()
    .prepare("SELECT id FROM delivery_line WHERE delivery_id=? AND tw_symbol='NOWOSC-1'")
    .get(id) as { id: number };
  assert.equal(linia("NOWOSC-1").bezLokalizacji, true);
  D.putawayLine(l.id, "E08-03-01", "Jan Kowalski");
  assert.equal(linia("NOWOSC-1").bezLokalizacji, false);
});

/* ── Wyjątki ──────────────────────────────────────────────────────────────── */

/** Zgłasza wyjątek i UPADA, gdy serwis go odrzucił — cichy `{error}` przeszedłby tu jako „brak wyjątków". */
function zglos(input: Parameters<typeof R.raiseProblem>[0], user = "Jan Kowalski") {
  const w = R.raiseProblem(input, user);
  assert.ok("id" in w, `wyjątek odrzucony: ${JSON.stringify(w)}`);
  return w;
}

test("wyjątek siedzi w wierszu SWOJEJ pozycji", () => {
  const { id, lineId } = otworz("LS51-139");
  zglos({ deliveryId: id, lineId, typ: "missing_item", qty: 2, opis: "dwie sztuki mniej" });
  const d = P.podgladDokumentu(DOK)!;
  assert.equal(d.lines.find((l) => l.sym === "LS51-139")!.problemy.length, 1);
  assert.equal(d.lines.find((l) => l.sym === "LZ-6202")!.problemy.length, 0);
  assert.equal(d.problemyBezLinii.length, 0);
});

test("wyjątek bez linii nie ginie — ląduje poza pozycjami", () => {
  // towar SPOZA dokumentu nie ma w której pozycji usiąść, a schowanie go
  // byłoby zgubieniem zgłoszenia
  const { id } = otworz("LS51-139");
  zglos({ deliveryId: id, typ: "extra_item", qty: 1, symObcy: "OBCY-1" }, "Ewa Bąk");
  const d = P.podgladDokumentu(DOK)!;
  assert.equal(d.problemyBezLinii.length, 1);
  assert.equal(d.lines.reduce((n, l) => n + l.problemy.length, 0), 0);
});

test("postęp liczy wyjątek jako domknięty (D8)", () => {
  const { id, lineId } = otworz("LS51-139");
  zglos({ deliveryId: id, lineId, typ: "missing_item", qty: 2 });
  const p = P.podgladDokumentu(DOK)!.progress;
  assert.deepEqual(p, { total: 3, done: 1, remaining: 2, problems: 1 });
});

/* ── Snapshot zostaje snapshotem ──────────────────────────────────────────── */

test("pozycja NIETKNIĘTA idzie za kartoteką", () => {
  /* Do 0.36.1 adres zamrażał się przy otwarciu dostawy i biuro oglądało go
     nieaktualnym choćby przez tydzień. Tu obowiązuje ta sama reguła co na
     kolektorze — inaczej dwa ekrany pokazywałyby dwie różne półki, żaden nie
     mówiąc, że to dwie różne liczby. */
  otworz("LS51-139");
  db().prepare("UPDATE sgt_towar SET lokalizacja='Z99-09-09' WHERE tw_id=?").run(GAZNIK);
  assert.equal(linia("LS51-139").locExpected, "Z99-09-09");
});

test("pozycja TKNIĘTA zachowuje adres z chwili pracy", () => {
  /* Odwrotna strona tej samej reguły: gdy praca już się odbyła, oczekiwany
     adres jest zapisem tego, czego spodziewaliśmy się WTEDY. Przeliczenie go
     zacierałoby rozjazd, który właśnie ta pozycja udokumentowała. */
  const { lineId } = otworz("LS51-139");
  D.putawayLine(lineId, "B02-01-01", "Jan Kowalski");
  db().prepare("UPDATE sgt_towar SET lokalizacja='Z99-09-09' WHERE tw_id=?").run(GAZNIK);
  const l = linia("LS51-139");
  assert.equal(l.locExpected, "A01-02-03");
  assert.equal(l.mismatch, true);
});

test("podgląd otwartej dostawy nie kasuje niczego ze snapshotu", () => {
  const { id } = otworz("LS51-139");
  db()
    .prepare(
      `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok)
       VALUES (?,?,?,?,?)`
    )
    .run(id, PRZESYLKA, "PRZESYŁKA", "koszt transportu", 1);
  const przed = ile("delivery_line");
  P.podgladDokumentu(DOK);
  assert.equal(ile("delivery_line"), przed);
});

test("podgląd niesie płatnika i flagę logo — panel wie, czy pytać o obraz", () => {
  /* Panel biura rysuje logo dostawcy przy dokumencie tak samo jak kolektor
     w swojej liście. Bez tej pary pól musiałby strzelać po obraz „na wszelki
     wypadek" i zbierać serię 404 — dokładnie ten błąd dał w 0.56.0 355 wpisów
     w dzienniku produkcyjnym na tysiąc. */
  const d = db();
  d.prepare("DELETE FROM dostawca_logo").run();
  d.prepare("UPDATE sgt_dokument SET kh_id = 4100 WHERE dok_id = ?").run(DOK);
  assert.equal(P.podgladDokumentu(DOK)?.khId, 4100);
  assert.equal(P.podgladDokumentu(DOK)?.maLogo, false, "nie ma logo, nie ma o co pytać");

  d.prepare(
    `INSERT INTO dostawca_logo(kh_id, nazwa, obraz, bajtow, etag, dodane_at, dodane_by)
     VALUES (4100, 'Dostawca sp. z o.o.', X'89504E470D0A1A0A', 8, 'etag', '2026-08-22T10:00:00.000Z', 'Test')`
  ).run();
  assert.equal(P.podgladDokumentu(DOK)?.maLogo, true);

  // dokument bez płatnika nie ma do czego przypiąć logo
  d.prepare("UPDATE sgt_dokument SET kh_id = NULL WHERE dok_id = ?").run(DOK);
  assert.equal(P.podgladDokumentu(DOK)?.khId, null);
  assert.equal(P.podgladDokumentu(DOK)?.maLogo, false);
  d.prepare("DELETE FROM dostawca_logo").run();
});
