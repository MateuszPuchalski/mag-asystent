import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-przeplyw-werdykt-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Werdykt agenta o propozycji przepływu ──────────────────────────────────
   Zgoda wykonuje krok, sprzeciw tylko się zapisuje, a drugi werdykt nie
   powtarza kroku. Propozycja spod starego rozpoznania nie zleca niczego.
   Baza jest globalna, bo zgoda na krok zakłada zadanie przez `zlecPomiar`,
   a ten pisze do `db()`. */

let db: typeof import("../db/db.js").db;
let P: typeof import("./przeplyw-kategorii.js") & typeof import("./przeplyw-werdykt.js");
let poprawKlasyfikacje: typeof import("./copilot-klasyfikacja.js").poprawKlasyfikacje;
let konto = 0;
let biuro = 0;
const Ola = () => ({ id: biuro, name: "Ola" });

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ poprawKlasyfikacje } = await import("./copilot-klasyfikacja.js"));
  P = { ...await import("./przeplyw-kategorii.js"), ...await import("./przeplyw-werdykt.js") };
});

beforeEach(() => {
  const d = db();
  for (const t of ["propozycja_przeplywu", "zadanie_terenowe", "szkic_copilota", "decyzja_klasyfikacji",
    "conversation_event", "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','p')")
    .run().lastInsertRowid);
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('o','Ola','biuro')").run().lastInsertRowid);
});

/** Rozmowa z pytaniem klienta i aktywną decyzją. Zwraca rozmowę, wiadomość i decyzję. */
function rozpoznana(kategoria: string, o: { pewnosc?: string; temat?: string } = {}) {
  const d = db();
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,?,?)`).run(konto, `w-${Math.random()}`, o.temat ?? "Kupujący 7").lastInsertRowid);
  const m = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,?,'incoming','Gdzie paczka?',?)`)
    .run(r, konto, `m-${Math.random()}`, new Date().toISOString()).lastInsertRowid);
  const k = Number(d.prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,
    status,kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,pewnosc,
    taksonomia_wersja,polityka_wersja,at,przez)
    VALUES (?,?,1,1,'MODEL','SUCCESS',?,'GET_ORDER',0,0,0,?,'v2','p1',?,'automat')`)
    .run(r, m, kategoria, o.pewnosc ?? "wysoka", new Date().toISOString()).lastInsertRowid);
  return { r, m, k };
}

function szkic(r: number, m: number, decyzja: number, zastrzezenia: string[] = []) {
  db().prepare(`INSERT INTO szkic_copilota(conversation_id,tresc,zastrzezenia,message_id,model,at,przez,decyzja_id)
    VALUES (?,?,?,?,'atrapa',?,'automat',?)
    ON CONFLICT(conversation_id) DO UPDATE SET decyzja_id=excluded.decyzja_id,
      zastrzezenia=excluded.zastrzezenia, message_id=excluded.message_id`)
    .run(r, "Paczka jest w drodze.", JSON.stringify(zastrzezenia), m, new Date().toISOString(), decyzja);
}

test("werdykt: zła wartość i „wyslij” to 400, cudza propozycja 404, drugi raz 409", () => {
  const a = rozpoznana("ORDER_STATUS");
  szkic(a.r, a.m, a.k);
  const b = rozpoznana("COMPLAINT");
  P.zapiszPropozycje(db(), [a.r, b.r]);
  const [wyslij] = P.propozycjeRozmowy(db(), a.r);
  const [pilne] = P.propozycjeRozmowy(db(), b.r);
  const kod = (f: () => unknown) => {
    try { f(); return 0; } catch (e) { return e instanceof P.BladPrzeplywu ? e.kod : -1; }
  };
  assert.equal(kod(() => P.werdyktPropozycji(db(), b.r, pilne!.id, "moze" as "zgoda", Ola())), 400);
  assert.equal(kod(() => P.werdyktPropozycji(db(), a.r, wyslij!.id, "zgoda", Ola())), 400);
  assert.equal(kod(() => P.werdyktPropozycji(db(), a.r, pilne!.id, "zgoda", Ola())), 404);
  assert.equal(kod(() => P.werdyktPropozycji(db(), b.r, 999_999, "zgoda", Ola())), 404);
  assert.equal(P.werdyktPropozycji(db(), b.r, pilne!.id, "sprzeciw", Ola()).werdykt, "sprzeciw");
  assert.equal(kod(() => P.werdyktPropozycji(db(), b.r, pilne!.id, "zgoda", Ola())), 409);
});

test("werdykt pod stare rozpoznanie to 409 — krok nie idzie na halę", () => {
  const a = rozpoznana("MISSING_PRODUCT");
  P.zapiszPropozycje(db(), [a.r]);
  const krok = P.propozycjeRozmowy(db(), a.r).find((p) => p.rodzaj === "krok")!;
  poprawKlasyfikacje(db(), a.r, "RETURN", null, Ola());
  assert.throws(() => P.werdyktPropozycji(db(), a.r, krok.id, "zgoda", Ola()),
    (e: unknown) => e instanceof P.BladPrzeplywu && e.kod === 409);
  assert.equal(Number((db().prepare("SELECT count(*) n FROM zadanie_terenowe").get() as { n: number }).n), 0);
});

test("zgoda na pilne ustawia priorytet, zgoda na krok zakłada weryfikację przy rozmowie", () => {
  const a = rozpoznana("WRONG_PRODUCT", { temat: "Kupujący 44300444" });
  P.zapiszPropozycje(db(), [a.r]);
  const [krok, pilne] = P.propozycjeRozmowy(db(), a.r);

  const p = P.werdyktPropozycji(db(), a.r, pilne!.id, "zgoda", Ola());
  assert.equal(p.werdykt, "zgoda");
  assert.equal(p.werdyktZrodlo, "agent");
  assert.equal(p.werdyktPrzez, "Ola");
  assert.equal((db().prepare("SELECT priorytet FROM conversation WHERE id=?").get(a.r) as
    { priorytet: string }).priorytet, "pilny");

  P.werdyktPropozycji(db(), a.r, krok!.id, "zgoda", Ola());
  const z = db().prepare("SELECT rodzaj, tytul, instrukcja, conversation_id, message_id FROM zadanie_terenowe")
    .get() as Record<string, unknown>;
  assert.equal(z.rodzaj, "weryfikacja");
  assert.equal(z.tytul, "Weryfikacja z rozmowy — Kupujący 44300444");
  assert.match(String(z.instrukcja), /inny towar/);
  assert.equal(z.conversation_id, a.r);
  assert.equal(z.message_id, a.m);

  const w = db().prepare("SELECT payload FROM events WHERE type='przeplyw_werdykt' ORDER BY id")
    .all() as Array<{ payload: string }>;
  assert.deepEqual(w.map((x) => JSON.parse(x.payload).rodzaj), ["pilne", "krok"]);
  assert.equal(JSON.parse(w[1]!.payload).kategoria, "WRONG_PRODUCT");
});

test("sprzeciw zapisuje tylko werdykt — ani zadania, ani priorytetu", () => {
  const a = rozpoznana("WRONG_PRODUCT");
  P.zapiszPropozycje(db(), [a.r]);
  for (const p of P.propozycjeRozmowy(db(), a.r)) P.werdyktPropozycji(db(), a.r, p.id, "sprzeciw", Ola());
  assert.equal(Number((db().prepare("SELECT count(*) n FROM zadanie_terenowe").get() as { n: number }).n), 0);
  assert.equal((db().prepare("SELECT priorytet FROM conversation WHERE id=?").get(a.r) as
    { priorytet: string }).priorytet, "normalny");
});

/* ── Przegląd po fakcie: szkic wysłany przez automat ────────────────────────
   Losu szkicu tu nie ma, bo nikt go nie poprawiał. Werdykt daje agent na
   karcie i to jest jedyny dowód, czy automat odpisał dobrze. */
test("wysłaną przez automat agent ocenia zgodą albo sprzeciwem, bez żadnego wykonania", () => {
  const a = rozpoznana("ORDER_STATUS");
  szkic(a.r, a.m, a.k);
  const b = rozpoznana("ORDER_STATUS");
  szkic(b.r, b.m, b.k);
  P.zapiszPropozycje(db(), [a.r, b.r]);
  db().prepare("UPDATE propozycja_przeplywu SET wykonana_at=? WHERE rodzaj='wyslij'").run(new Date().toISOString());
  const [wa] = P.propozycjeRozmowy(db(), a.r);
  const [wb] = P.propozycjeRozmowy(db(), b.r);

  /* Dopisek klienta po wysyłce zmienia decyzję, a przegląd i tak ma sens. */
  poprawKlasyfikacje(db(), a.r, "INVOICE", null, Ola());
  const p = P.werdyktPropozycji(db(), a.r, wa!.id, "zgoda", Ola());
  assert.deepEqual([p.werdykt, p.werdyktZrodlo, p.werdyktPrzez], ["zgoda", "agent", "Ola"]);
  assert.equal(P.werdyktPropozycji(db(), b.r, wb!.id, "sprzeciw", Ola()).werdykt, "sprzeciw");

  assert.equal(Number((db().prepare("SELECT count(*) n FROM zadanie_terenowe").get() as { n: number }).n), 0);
  assert.equal(Number((db().prepare("SELECT count(*) n FROM outbox").get() as { n: number }).n), 0);
  assert.throws(() => P.werdyktPropozycji(db(), b.r, wb!.id, "zgoda", Ola()),
    (e: unknown) => e instanceof P.BladPrzeplywu && e.kod === 409);
  const w = db().prepare("SELECT payload FROM events WHERE type='przeplyw_werdykt' ORDER BY id").all() as
    Array<{ payload: string }>;
  assert.equal(JSON.parse(w[0]!.payload).naZywo, true);
});

test("„wyslij” bez wysyłki automatu dalej odpada 400", () => {
  const a = rozpoznana("ORDER_STATUS");
  szkic(a.r, a.m, a.k);
  P.zapiszPropozycje(db(), [a.r]);
  db().prepare("UPDATE propozycja_przeplywu SET wykonanie_blad='niepewna' WHERE rodzaj='wyslij'").run();
  const [w] = P.propozycjeRozmowy(db(), a.r);
  assert.throws(() => P.werdyktPropozycji(db(), a.r, w!.id, "zgoda", Ola()),
    (e: unknown) => e instanceof P.BladPrzeplywu && e.kod === 400);
});
