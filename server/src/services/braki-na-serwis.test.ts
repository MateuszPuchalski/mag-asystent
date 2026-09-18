import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Brak w dostawie jedzie na magazyn serwisowy ─────────────────────────────
   Decyzja właściciela: „gdy rozkładający dostawę zgłosi braki, brakujący towar
   powinien być przeniesiony na magazyn serwis". Do tego wydania zgłoszenie
   braku było wyłącznie ZDANIEM: wiersz w `problem`, pozycja w protokole dla
   dostawcy i tyle. Stanu nie ruszało nic.

   Dlaczego to bolało: fakturę zakupu Subiekt księguje w CAŁOŚCI, więc towar,
   którego w palecie nie było, wisiał na magazynie głównym jako sprzedawalny.
   Sklep obiecywał go klientom, a magazynier wracał z półki z niczym.

   MAGAZYN USTAWIAMY PRZED IMPORTEM. `config` powstaje raz, przy wczytaniu
   modułu, więc test z innym ustawieniem musi mieszkać w OSOBNYM pliku —
   jeden proces to jedna konfiguracja. Plik obok (`problems.test.ts`) biegnie
   BEZ `MAG_ID_SERWIS` i pilnuje zachowania sprzed tego wydania.             */

process.env.MAG_ID_SERWIS = "7";
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-serwis-")), "t.db");

/** Magazyn skutku dostawy krajowej — snapshot z chwili otwarcia, nie `config`. */
const MAG_DOSTAWY = 1;

let db: typeof import("../db/db.js").db;
let nowIso: typeof import("../db/db.js").nowIso;
let P: typeof import("./problems.js");

before(async () => {
  /* WSZYSTKO dynamicznie, także `db.js`: statyczny import wciągnąłby
     `config.js`, a ten czyta `process.env` przy wczytaniu modułu — czyli ZANIM
     wykona się linia z `MAG_ID_SERWIS` wyżej. */
  ({ db, nowIso } = await import("../db/db.js"));
  P = await import("./problems.js");
});

let deliveryId = 0;
let lineId = 0;

beforeEach(() => {
  for (const t of ["events", "problem", "delivery_line", "delivery", "sfera_queue"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
  deliveryId = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, opened_at, source_mag_id)
         VALUES (4711,'FZ 4711/2026','FALON-TECH','2026-08-01',?,?)`
      )
      .run(nowIso(), MAG_DOSTAWY).lastInsertRowid
  );
  lineId = Number(
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok)
         VALUES (?,31,'W32-0401','Zestaw podkładek',10)`
      )
      .run(deliveryId).lastInsertRowid
  );
});

/** Najmniejszy poprawny PNG — treść zdjęcia nie ma tu znaczenia. */
const ZDJECIE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const zglos = (wejscie: Partial<Parameters<typeof P.raiseProblem>[0]>) =>
  P.raiseProblem({ deliveryId, lineId, typ: "missing_item", ...wejscie } as never, "Jan Kowalski");

interface Zadanie {
  id: number;
  type: string;
  tw_id: number | null;
  source_doc_id: number | null;
  label: string;
  detail: string;
  payload: { magFrom: number; magTo: number; items: Array<{ twId: number; qty: number }> };
}

const zadania = (): Zadanie[] =>
  (
    db()
      .prepare("SELECT id, type, tw_id, source_doc_id, label, detail, payload FROM sfera_queue ORDER BY id")
      .all() as Array<Omit<Zadanie, "payload"> & { payload: string }>
  ).map((z) => ({ ...z, payload: JSON.parse(z.payload) }));

const zdarzenia = (typ: string): Array<Record<string, unknown>> =>
  (db().prepare("SELECT payload FROM events WHERE type=? ORDER BY id").all(typ) as Array<{
    payload: string;
  }>).map((e) => JSON.parse(e.payload));

/* ── Ile sztuk brakuje ───────────────────────────────────────────────────── */

test("formuła braku jest ODWROTNA między kategoriami", () => {
  /* To jest jedyny naprawdę groźny szczegół tego wydania. Arkusz kolektora pyta
     przy „Braku w przesyłce", ILE BRAKUJE, a przy „Złej ilości" — ILE PRZYSZŁO
     (`ProblemSheet.etykietaIlosci`). Jedna formuła na oba przypadki przesunęłaby
     złą liczbę sztuk, a MM nie cofa się jednym kliknięciem. */
  assert.equal(P.brakujaceSztuki("missing_item", 3, 10), 3, "brak: ilość to sam brak");
  assert.equal(P.brakujaceSztuki("qty_mismatch", 3, 10), 7, "zła ilość: brak to różnica");
});

test("nadmiar i uszkodzenie nie brakują niczego", () => {
  // przyszło więcej, niż jest na dokumencie — na stanie nie brakuje nic
  assert.equal(P.brakujaceSztuki("qty_mismatch", 12, 10), 0);
  // towar uszkodzony LEŻY na półce; jest do reklamacji, nie do przesunięcia
  assert.equal(P.brakujaceSztuki("damaged", 4, 10), 0);
  assert.equal(P.brakujaceSztuki("wrong_item", 4, 10), 0);
  assert.equal(P.brakujaceSztuki("extra_item", 4, 10), 0);
});

test("brak nie przekracza ilości z dokumentu ani nie liczy się bez niej", () => {
  // pomyłka w polu „ile" nie ma prawa wystawić MM na ilość spoza tej dostawy
  assert.equal(P.brakujaceSztuki("missing_item", 99, 10), 10);
  assert.equal(P.brakujaceSztuki("missing_item", 3, null), 0);
  assert.equal(P.brakujaceSztuki("missing_item", null, 10), 0);
});

/* ── Zgłoszenie wystawia MM ──────────────────────────────────────────────── */

test("brak w przesyłce kolejkuje MM z magazynu dostawy na serwisowy", () => {
  const r = zglos({ typ: "missing_item", qty: 4 });
  assert.ok("id" in r);

  const q = zadania();
  assert.equal(q.length, 1, "dokładnie jedno zadanie — zgłoszenie to jeden ruch");
  assert.equal(q[0].type, "mm");
  assert.equal(q[0].payload.magFrom, MAG_DOSTAWY, "źródło z dostawy, nie z konfiguracji");
  assert.equal(q[0].payload.magTo, 7, "cel z MAG_ID_SERWIS");
  assert.deepEqual(q[0].payload.items, [{ twId: 31, qty: 4 }]);
  /* DOKUMENT MUSI BYĆ. `czekaNaDokument` wstrzymuje MM, dopóki FZ siedzi
     w buforze Subiekta — na nieksięgowanej fakturze tego stanu jeszcze nie ma,
     więc przesunięcie nie miałoby czego zabrać. */
  assert.equal(q[0].source_doc_id, 4711);
  /* KOLUMNA `tw_id` ZOSTAJE PUSTA. Guard „adres przed sprzedawalnością"
     (sfera-worker/sql/pick_mm_pending.sql) pilnuje MM czyniącego towar
     sprzedawalnym; to zabiera towar ze sprzedaży. Wypełniona kazałaby zadaniu
     czekać na `set_location` tej kartoteki — a przy braku po CZĘŚCIOWYM
     odłożeniu taki zapis zwykle stoi w kolejce. */
  assert.equal(q[0].tw_id, null);
  // kartka dla magazyniera musi powiedzieć, dokąd i po czym
  assert.match(q[0].label, /W32-0401/);
  assert.match(q[0].detail, /serwisow/);
});

test("zła ilość przesuwa TYLKO różnicę", () => {
  // dokument mówi 10, przyjechało 7 — brakuje trzech, nie siedmiu i nie dziesięciu
  const r = zglos({ typ: "qty_mismatch", qty: 7 });
  assert.ok("id" in r);
  assert.deepEqual(zadania()[0].payload.items, [{ twId: 31, qty: 3 }]);
});

test("nadmiar przy zamknięciu dostawy nie rusza stanu", () => {
  /* Automatyczne zgłoszenie nadmiaru (0.64.0) idzie tą samą drogą, z ilością
     FAKTYCZNĄ większą od dokumentu. Gdyby formuła brała moduł różnicy, każde
     zamknięcie dostawy z nadmiarem wystawiałoby MM na towar, który leży. */
  const r = zglos({ typ: "qty_mismatch", qty: 13, zachowajStatusLinii: true });
  assert.ok("id" in r);
  assert.equal(zadania().length, 0);
});

test("uszkodzenie w transporcie nie rusza stanu", () => {
  const r = zglos({ typ: "damaged", qty: 2, photoBase64: ZDJECIE });
  assert.ok("id" in r);
  assert.equal(zadania().length, 0, "uszkodzony towar leży na półce — jest do reklamacji");
});

test("zgłoszenie odrzucone walidacją nie kolejkuje niczego", () => {
  // kolejność w `raiseProblem`: walidacja, zapis, dopiero skutek magazynowy
  const r = zglos({ typ: "missing_item", qty: null });
  assert.ok("error" in r);
  assert.equal(zadania().length, 0);
});

/* ── Ślad w audycie ─────────────────────────────────────────────────────── */

test("zdarzenie wiąże zgłoszenie z zadaniem w obie strony", () => {
  /* Pytanie „dlaczego ten stan się ruszył" musi mieć odpowiedź w jednym
     miejscu. `enqueueMM` własnego wpisu nie robi, bo MM chodzi z pięciu
     różnych ekranów. */
  const r = zglos({ typ: "missing_item", qty: 4 });
  assert.ok("id" in r);
  const e = zdarzenia("brak_na_serwis");
  assert.equal(e.length, 1);
  assert.equal(e[0].problemId, r.id);
  assert.equal(e[0].queueId, zadania()[0].id);
  assert.equal(e[0].brak, 4);
  assert.equal(e[0].magFrom, MAG_DOSTAWY);
  assert.equal(e[0].magTo, 7);
  const naKarcie = db()
    .prepare("SELECT tw_id FROM events WHERE type='brak_na_serwis'")
    .get() as { tw_id: number | null };
  assert.equal(naKarcie.tw_id, 31, "zdarzenie siedzi na kartotece — historia karty je pokaże");
});

/* ── Luki, przy których ruchu zrobić nie sposób ──────────────────────────── */

test("dostawa bez magazynu skutku nie wystawia dokumentu w ciemno", () => {
  /* Starsze dostawy nie mają wypełnionej kolumny. Zgadnięty numer przesunąłby
     towar z magazynu, na którym go nigdy nie było — a dokument już powstał. */
  db().prepare("UPDATE delivery SET source_mag_id=NULL WHERE id=?").run(deliveryId);
  const r = zglos({ typ: "missing_item", qty: 4 });
  assert.ok("id" in r, "zgłoszenie braku to fakt o dostawie i musi się zapisać");
  assert.equal(zadania().length, 0);
  const pominiete = zdarzenia("brak_na_serwis_pominiety");
  assert.equal(pominiete.length, 1, "pominięcie zostawia ślad, nie ciszę");
  assert.equal(pominiete[0].powod, "dostawa bez magazynu skutku");
  assert.equal(pominiete[0].brak, 4, "w ślad idzie też to, czego nie przesunięto");
});

test("nadmiar bez magazynu skutku nie zostawia śladu — nie było czego przesuwać", () => {
  // ślad o pominięciu ma znaczyć „tego nie zrobiono, a trzeba było"; przy
  // nadmiarze nie ma braku, więc nie ma też pominięcia
  db().prepare("UPDATE delivery SET source_mag_id=NULL WHERE id=?").run(deliveryId);
  zglos({ typ: "qty_mismatch", qty: 13, zachowajStatusLinii: true });
  assert.equal(zdarzenia("brak_na_serwis_pominiety").length, 0);
});
