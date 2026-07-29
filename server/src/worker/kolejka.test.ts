import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SferaAdapter } from "../adapters/sfera.js";

/* ── Kolejka Sfery ──────────────────────────────────────────────────────────
   Ta logika decyduje o KAŻDYM zapisie do bazy firmy: co wziąć z kolejki, ile
   razy ponowić i kiedy uznać za przegrane. Do tej pory nie miała ani jednego
   testu i uruchamiała się wyłącznie ręcznie, bo `worker.ts` przy imporcie
   startował pętlę.

   Najważniejszy jest ostatni blok: zadanie flagi zakończone terminalnym
   błędem MUSI cofnąć `flaga_wyslana`. Bez tego dedupe w `syncFlag` uzna, że
   flaga poszła, i faktura zostanie nieoznaczona — bez śladu, bez ponowienia
   i bez czerwonej pastylki.                                                  */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kol-")), "t.db");
// backoff z domyślnych, ale bez losowych awarii — błędy wywołujemy adapterem
process.env.WORKER_SIM_ERRORS = "0";

let db: typeof import("../db/db.js").db;
let K: typeof import("./kolejka.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  K = await import("./kolejka.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM sfera_queue").run();
  db().prepare("DELETE FROM sgt_dokument").run();
  db().prepare("DELETE FROM delivery").run();
});

/** Adapter, który zawsze pada — zastępuje losowanie WORKER_SIM_ERRORS. */
const padajacy = (msg = "Kartoteka w edycji"): SferaAdapter => ({
  applySetLocation: async () => {
    throw new Error(msg);
  },
  applyDocFlag: async () => {
    throw new Error(msg);
  },
  createMM: async () => {
    throw new Error(msg);
  },
});

const udany = (): SferaAdapter => ({
  applySetLocation: async () => {},
  applyDocFlag: async () => {},
  createMM: async () => "MM 1/2026",
});

function dodajZadanie(
  type: string,
  payload: unknown,
  opts: { attempts?: number; status?: string; docId?: number | null } = {}
): number {
  const info = db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, attempts, source_doc_id, created_at, created_by)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(
      type,
      JSON.stringify(payload),
      opts.status ?? "pending",
      opts.attempts ?? 0,
      opts.docId ?? null,
      new Date().toISOString(),
      "test"
    );
  return Number(info.lastInsertRowid);
}

const stan = (id: number) =>
  db().prepare("SELECT status, attempts, error_msg, sgt_doc_number FROM sfera_queue WHERE id = ?").get(id) as {
    status: string;
    attempts: number;
    error_msg: string | null;
    sgt_doc_number: string | null;
  };

/* Pola, które `Task` niesie WYŁĄCZNIE dla audytu — worker działa poza żądaniem,
   więc autora musi dostać wierszem kolejki. Żaden test sterowania kolejką ich
   nie dotyczy, więc idą jednym rozwinięciem zamiast trzech linii w każdym
   literale. */
const AUDYT = { tw_id: null, created_by: "tester", created_by_ref: null };

// ── Ścieżka udana ───────────────────────────────────────────────────────────

test("udane zadanie kończy się statusem done", async () => {
  const id = dodajZadanie("set_location", { twId: 1, newValue: "A01-02-03" });
  await K.przetworzZadanie({ id, type: "set_location", payload: JSON.stringify({ twId: 1, newValue: "A01-02-03" }), attempts: 0, source_doc_id: null, ...AUDYT }, udany());
  assert.equal(stan(id).status, "done");
});

test("MM zapisuje numer dokumentu zwrócony przez Sferę", async () => {
  const payload = { magFrom: 2, magTo: 1, items: [{ twId: 1, qty: 3 }] };
  const id = dodajZadanie("mm", payload);
  await K.przetworzZadanie({ id, type: "mm", payload: JSON.stringify(payload), attempts: 0, source_doc_id: null, ...AUDYT }, udany());
  assert.equal(stan(id).sgt_doc_number, "MM 1/2026");
});

test("nieznany typ zadania to błąd, nie ciche pominięcie", async () => {
  const id = dodajZadanie("zrob_cos_dziwnego", {});
  await K.przetworzZadanie({ id, type: "zrob_cos_dziwnego", payload: "{}", attempts: 0, source_doc_id: null, ...AUDYT }, udany());
  assert.match(stan(id).error_msg ?? "", /Nieznany typ/);
});

// ── Retry i błąd terminalny ─────────────────────────────────────────────────

test("pierwsza porażka wraca do pending i planuje ponowienie", async () => {
  const id = dodajZadanie("set_location", { twId: 1, newValue: "A01-02-03" });
  await K.przetworzZadanie({ id, type: "set_location", payload: JSON.stringify({ twId: 1, newValue: "A" }), attempts: 0, source_doc_id: null, ...AUDYT }, padajacy());

  const s = stan(id);
  assert.equal(s.status, "pending"); // wróci, nie przepadło
  assert.equal(s.attempts, 1);
  assert.match(s.error_msg ?? "", /Kartoteka w edycji/);

  const next = db().prepare("SELECT next_attempt_at FROM sfera_queue WHERE id = ?").get(id) as {
    next_attempt_at: string | null;
  };
  assert.ok(next.next_attempt_at, "ponowienie musi mieć termin, inaczej worek weźmie je w kółko");
});

test("po wyczerpaniu prób zadanie przechodzi w error", async () => {
  const { config } = await import("../config.js");
  const ostatnia = config.worker.maxAttempts - 1;
  const id = dodajZadanie("set_location", { twId: 1, newValue: "A" }, { attempts: ostatnia });
  await K.przetworzZadanie({ id, type: "set_location", payload: JSON.stringify({ twId: 1, newValue: "A" }), attempts: ostatnia, source_doc_id: null, ...AUDYT }, padajacy());

  const s = stan(id);
  assert.equal(s.status, "error");
  assert.equal(s.attempts, config.worker.maxAttempts);
});

test("zadanie w błędzie terminalnym nie jest już wybierane z kolejki", async () => {
  dodajZadanie("set_location", { twId: 1, newValue: "A" }, { status: "error" });
  assert.equal(K.pickTask(), undefined);
});

// ── Dokument w buforze ──────────────────────────────────────────────────────

test("MM na dokumencie w buforze czeka i NIE zajmuje slotu", async () => {
  db()
    .prepare("INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, w_buforze) VALUES (7,'FZ','FZ 1/2026','2026-07-01',1,1)")
    .run();
  const id = dodajZadanie("mm", { magFrom: 2, magTo: 1, items: [] }, { docId: 7 });

  const czeka = K.czekaNaDokument({ id, type: "mm", payload: "{}", attempts: 0, source_doc_id: 7, ...AUDYT });
  assert.equal(czeka, true);
  assert.equal(stan(id).status, "waiting_for_doc");
});

test("dokument poza buforem nie wstrzymuje zadania", async () => {
  db()
    .prepare("INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, w_buforze) VALUES (8,'FZ','FZ 2/2026','2026-07-01',1,0)")
    .run();
  const id = dodajZadanie("mm", { magFrom: 2, magTo: 1, items: [] }, { docId: 8 });
  assert.equal(
    K.czekaNaDokument({ id, type: "mm", payload: "{}", attempts: 0, source_doc_id: 8, ...AUDYT }),
    false
  );
});

test("set_location nie czeka na dokument — wstrzymanie dotyczy tylko MM", async () => {
  db()
    .prepare("INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, w_buforze) VALUES (9,'FZ','FZ 3/2026','2026-07-01',1,1)")
    .run();
  const id = dodajZadanie("set_location", { twId: 1, newValue: "A" }, { docId: 9 });
  assert.equal(
    K.czekaNaDokument({ id, type: "set_location", payload: "{}", attempts: 0, source_doc_id: 9, ...AUDYT }),
    false
  );
});

// ── Cofnięcie flagi po terminalnym błędzie ──────────────────────────────────

test("przegrane zadanie flagi cofa flaga_wyslana, żeby dedupe je ponowił", async () => {
  const { config } = await import("../config.js");
  db()
    .prepare(
      "INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, status, flaga_wyslana, opened_at) VALUES (11,'FZ 9/2026','X','open','done',?)"
    )
    .run(new Date().toISOString());

  const ostatnia = config.worker.maxAttempts - 1;
  const payload = { dokId: 11, wartosc: "3", flaga: "done" };
  const id = dodajZadanie("set_doc_flag", payload, { attempts: ostatnia, docId: 11 });
  await K.przetworzZadanie(
    { id, type: "set_doc_flag", payload: JSON.stringify(payload), attempts: ostatnia, source_doc_id: 11, ...AUDYT },
    padajacy()
  );

  assert.equal(stan(id).status, "error");
  const d = db().prepare("SELECT flaga_wyslana FROM delivery WHERE sgt_dok_id = 11").get() as {
    flaga_wyslana: string | null;
  };
  assert.equal(d.flaga_wyslana, null, "bez cofnięcia faktura zostałaby nieoznaczona bez śladu");
});

test("porażka NIEterminalna flagi nie cofa — zadanie jeszcze wróci", async () => {
  db()
    .prepare(
      "INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, status, flaga_wyslana, opened_at) VALUES (12,'FZ 10/2026','X','open','done',?)"
    )
    .run(new Date().toISOString());

  const payload = { dokId: 12, wartosc: "3", flaga: "done" };
  const id = dodajZadanie("set_doc_flag", payload, { attempts: 0, docId: 12 });
  await K.przetworzZadanie(
    { id, type: "set_doc_flag", payload: JSON.stringify(payload), attempts: 0, source_doc_id: 12, ...AUDYT },
    padajacy()
  );

  assert.equal(stan(id).status, "pending");
  const d = db().prepare("SELECT flaga_wyslana FROM delivery WHERE sgt_dok_id = 12").get() as {
    flaga_wyslana: string | null;
  };
  assert.equal(d.flaga_wyslana, "done");
});
