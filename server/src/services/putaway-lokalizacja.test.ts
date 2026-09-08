import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Rozjazd adresu przy rozkładaniu: ZAMIEŃ czy DODAJ (§4.3) ────────────────
   ZGŁOSZENIE WŁAŚCICIELA: „gdy skanuję inną lokalizację niż produkt posiada
   i decyduję się ją dodać, to powinna dodawać się jako dodatkowa lokalizacja,
   a nie jako podstawowa".

   Przycisk na kolektorze mówi „LEŻY W OBU — DODAJ" i o kolejności nie obiecuje
   nic, a serwer stawiał zeskanowany kod na PIERWSZYM miejscu pola. Pierwszy kod
   JEST lokalizacją pickingową (`locs.ts`), więc prośba o drugi adres kończyła
   się zmianą adresu podstawowego.

   Do 0.233.1 `locAction` NIE MIAŁ ANI JEDNEGO TESTU w całym repo — i dlatego
   ta gałąź mogła po cichu rozjechać się z `computeNewLocs` w trasie karty
   towaru, która od zawsze dokłada na koniec. Ten plik pilnuje OBU akcji, żeby
   naprawa jednej nie zjadła drugiej.                                          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-putloc-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
});

const TW = 41;
const DOK = 841;
const dzis = () => new Date().toISOString().slice(0, 10);

/** Pole `tw_Lokalizacja`, które poszło do kolejki — albo `null`, gdy nic. */
function zakolejkowanePole(): string | null {
  const r = db()
    .prepare("SELECT payload FROM sfera_queue WHERE type='set_location' ORDER BY id DESC")
    .get() as { payload: string } | undefined;
  return r ? (JSON.parse(r.payload) as { newValue: string }).newValue : null;
}

const zadan = (): number =>
  (db().prepare("SELECT COUNT(*) n FROM sfera_queue WHERE type='set_location'").get() as { n: number }).n;

/** Dostawa z jedną pozycją; `lok` ustawia pole kartoteki przed odłożeniem. */
function przygotuj(lok: string): number {
  const d = db();
  for (const t of ["events", "sfera_queue", "delivery_line", "delivery",
                   "sgt_pozycja", "sgt_dokument", "sgt_towar"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,lokalizacja) VALUES (?,?,?,?)")
    .run(TW, "GAZ-1", "Gaźnik kompletny", lok);
  d.prepare(
    `INSERT INTO sgt_dokument(dok_id,typ,nr_pelny,data_wyst,mag_id,dostawca,w_buforze)
     VALUES (?,'FZ',?,?,1,'Dostawca sp. z o.o.',0)`
  ).run(DOK, `FZ ${DOK}/08/2026`, dzis());
  d.prepare("INSERT INTO sgt_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)").run(DOK, TW, 5);
  const id = D.openDelivery(DOK, "jan");
  return D.getDelivery(id)!.lines[0].id;
}

beforeEach(() => {
  db().prepare("DELETE FROM sfera_queue").run();
});

/* ── DODAJ: adres DODATKOWY, nie podstawowy ──────────────────────────────── */

test("DODAJ dokłada adres na KONIEC — pickingowy zostaje ten, który był", () => {
  /* Sedno zgłoszenia. Przed poprawką pole wyglądało tak:
     „C01-02-02 A01-02-03 B02-03-04" — czyli towar przeprowadzał się na półkę,
     na którą magazynier tylko dołożył część sztuk. */
  const linia = przygotuj("A01-02-03 B02-03-04");
  const w = D.putawayLine(linia, "C01-02-02", "jan", { locAction: "add" });
  assert.ok("ok" in w, "odłożenie ma się udać");
  assert.equal(zakolejkowanePole(), "A01-02-03 B02-03-04 C01-02-02");
});

test("DODAJ przy towarze bez adresu daje mu pierwszy i jedyny", () => {
  // Brak adresu to nie jest przypadek szczególny — ma po prostu wyjść jeden kod.
  const linia = przygotuj("");
  D.putawayLine(linia, "C01-02-02", "jan", { locAction: "add" });
  assert.equal(zakolejkowanePole(), "C01-02-02");
});

test("DODAJ kodu, który towar JUŻ MA, nie kolejkuje niczego", () => {
  /* Towar stoi w dwóch miejscach, magazynier odkłada na to DRUGIE. Kartoteka
     zna ten adres, więc nie ma czego zapisywać. Wspólny warunek
     `current[0] !== code` przepuszczał ten przypadek i kolejkował zapis pola
     identycznego z obecnym — zapis do bazy firmy po nic. */
  const linia = przygotuj("A01-02-03 B02-03-04");
  const w = D.putawayLine(linia, "B02-03-04", "jan", { locAction: "add" });
  assert.ok("ok" in w);
  assert.equal(zadan(), 0);
});

test("DODAJ nie przestawia kolejności, gdy kod już jest pickingowy", () => {
  const linia = przygotuj("A01-02-03 B02-03-04");
  D.putawayLine(linia, "A01-02-03", "jan", { locAction: "add" });
  assert.equal(zadan(), 0);
});

/* ── ZAMIEŃ: bez zmian, druga połówka poprawki ───────────────────────────── */

test("ZAMIEŃ nadal podmienia pickingowy, a reszta adresów zostaje", () => {
  /* Poprawka DODAJ nie ma prawa ruszyć tej ścieżki: „przeniesiony" znaczy, że
     stary adres podstawowy przestał być prawdziwy, a pozostałe zostają. */
  const linia = przygotuj("A01-02-03 B02-03-04 PAL-042");
  D.putawayLine(linia, "C01-02-02", "jan", { locAction: "replace" });
  assert.equal(zakolejkowanePole(), "C01-02-02 B02-03-04 PAL-042");
});

test("domyślną akcją bez rozjazdu jest ZAMIEŃ", () => {
  // `locAction` = null na ścieżce bez rozjazdu (kolektor go nie wysyła).
  const linia = przygotuj("A01-02-03 B02-03-04");
  D.putawayLine(linia, "C01-02-02", "jan");
  assert.equal(zakolejkowanePole(), "C01-02-02 B02-03-04");
});

/* ── Pełne pole odmawia, zamiast uciąć kod w połowie ─────────────────────── */

test("DODAJ przy pełnym polu ODMAWIA i nie kolejkuje niczego", () => {
  /* Limit `tw_Lokalizacja` to 50 znaków, czyli pięć adresów. Dotąd stało tu
     ślepe ucięcie — a odkąd DODAJ dokłada na końcu, ucięciu podlegałby kod
     WŁAŚNIE ZESKANOWANY. Do kartoteki wjechałby adres, którego nikt nie
     znajdzie, a magazynier byłby pewien, że odłożył. */
  const linia = przygotuj("A01-02-03 B02-03-04 C03-04-05 D04-05-06 E05-06-07");
  const w = D.putawayLine(linia, "F06-07-08", "jan", { locAction: "add" });
  assert.ok("error" in w, "ma odmówić, a nie uciąć");
  assert.match(w.error, /pełne/);
  assert.equal(zadan(), 0);
});

test("komunikat o pełnym polu mówi, CO ZROBIĆ zamiast tego", () => {
  /* Odmowa przy regale bez wyjścia jest gorsza niż brak odmowy — magazynier
     stoi z kartonem i nie wie, co dalej. ZAMIEŃ pola nie powiększa. */
  const linia = przygotuj("A01-02-03 B02-03-04 C03-04-05 D04-05-06 E05-06-07");
  const w = D.putawayLine(linia, "F06-07-08", "jan", { locAction: "add" });
  assert.ok("error" in w);
  assert.match(w.error, /ZAMIEŃ/);
});

test("ZAMIEŃ przy pełnym polu przechodzi — nie powiększa go", () => {
  const linia = przygotuj("A01-02-03 B02-03-04 C03-04-05 D04-05-06 E05-06-07");
  const w = D.putawayLine(linia, "F06-07-08", "jan", { locAction: "replace" });
  assert.ok("ok" in w);
  assert.equal(zakolejkowanePole(), "F06-07-08 B02-03-04 C03-04-05 D04-05-06 E05-06-07");
});

/* ── Niezmiennik kolejności ──────────────────────────────────────────────── */

test("zadanie adresu niesie tw_id — guard kolejności Sfery działa po tej kolumnie", () => {
  /* „ADRES ZAWSZE PRZED SPRZEDAWALNOŚCIĄ" trzyma się na tym, że worker bierze
     zadania po `id` rosnąco, a guard MM porównuje `tw_id`. */
  const linia = przygotuj("A01-02-03");
  D.putawayLine(linia, "C01-02-02", "jan", { locAction: "add" });
  const z = db()
    .prepare("SELECT type, tw_id FROM sfera_queue ORDER BY id")
    .get() as { type: string; tw_id: number };
  assert.equal(z.type, "set_location");
  assert.equal(z.tw_id, TW);
});
