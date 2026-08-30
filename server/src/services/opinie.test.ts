import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Opinie o sprzedawcy ─────────────────────────────────────────────────────
   Piąte źródło sprawy sprawdzamy tam, gdzie może się zepsuć cicho: sync ma
   być idempotentny i nie cofać NASZEGO statusu, opinia z zamówieniem ma
   siadać w sprawie tego zamówienia, a licznik „złych" ma liczyć te, które
   wiszą publicznie — nie te, które ktoś tylko przeczytał.                    */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-opin-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";

let db: typeof import("../db/db.js").db;
let O: typeof import("./opinie.js");
let S: typeof import("./sprawy.js");
let przebudujSprawy: typeof import("./sprawa.js").przebudujSprawy;

before(async () => {
  ({ db } = await import("../db/db.js"));
  O = await import("./opinie.js");
  S = await import("./sprawy.js");
  ({ przebudujSprawy } = await import("./sprawa.js"));
});

beforeEach(() => {
  for (const t of ["sprawa_zdarzenie", "sprawa_zrodlo", "sprawa", "opinia", "zwrot", "events"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

test("przejęcie opinii zostawia ślad w dzienniku (0.137.1)", async () => {
  /* Trzeci z trzech stempli, które zapisywały bez logu. Opinia wisi publicznie
     przy ofercie, więc „kto się nią zajął" jest dokładnie tym pytaniem, na
     które ma odpowiadać dziennik. */
  await O.synchronizujOpinie("Anna");
  const id = O.listaOpinii()[0].id;
  const ile = () =>
    Number(
      (
        db()
          .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'opinia_prowadzi'")
          .get() as { n: number }
      ).n
    );

  O.stempelProwadziOpinii(id, "Anna");
  assert.equal(ile(), 1);
  O.stempelProwadziOpinii(id, "Anna");
  assert.equal(ile(), 1, "ta sama ręka drugi raz nie dokłada wpisu");
  O.stempelProwadziOpinii(id, "Bartek");
  assert.equal(ile(), 2, "zmiana ręki to nowe zdarzenie");
});

test("sync jest idempotentny i NIE cofa naszego statusu", async () => {
  const pierwszy = await O.synchronizujOpinie("Anna");
  assert.equal(pierwszy.nowych, 3, "adapter dev ma trzy opinie");
  const zla = O.listaOpinii().find((o) => o.ocena === 1);
  assert.ok(zla);
  O.zmienStatusOpinii(zla.id, "zalatwiona", "Anna");

  const drugi = await O.synchronizujOpinie("Anna");
  assert.equal(drugi.nowych, 0, "drugi przebieg nie zakłada niczego drugi raz");
  assert.equal(O.listaOpinii().length, 3);
  assert.equal(
    O.listaOpinii().find((o) => o.id === zla.id)?.status,
    "zalatwiona",
    "status jest NASZ — pobranie go nie przestawia"
  );
});

test("licznik: nowe i złe liczą się osobno, a załatwione znikają z obu", async () => {
  await O.synchronizujOpinie("Anna");
  const przed = O.licznikOpinii();
  assert.equal(przed.nowe, 3);
  assert.equal(przed.zle, 1, "jedna opinia negatywna w danych dev");

  const zla = O.listaOpinii().find((o) => o.ocena === 1)!;
  O.zmienStatusOpinii(zla.id, "przejrzana", "Anna");
  const poPrzejrzeniu = O.licznikOpinii();
  assert.equal(poPrzejrzeniu.nowe, 2);
  assert.equal(poPrzejrzeniu.zle, 1, "przejrzana zła opinia DALEJ wisi publicznie");

  O.zmienStatusOpinii(zla.id, "zalatwiona", "Anna");
  assert.equal(O.licznikOpinii().zle, 0);
});

test("opinia z numerem zamówienia siada w sprawie tego zamówienia", async () => {
  const teraz = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO zwrot(kupujacy_login, waybill, status, allegro_order_id, utworzono_at, utworzono_przez)
       VALUES ('ewa_oddaje', 'WB-9', 'nowy', 'dev-ord-2', ?, 'test')`
    )
    .run(teraz);
  await O.synchronizujOpinie("Anna");
  przebudujSprawy();

  const sprawy = S.listaSpraw();
  const zZamowieniem = O.listaOpinii().find((o) => o.orderId === "dev-ord-2")!;
  const zOpinia = sprawy.find((s) =>
    s.zrodla?.some((z) => z.rodzaj === "opinia" && z.id === zZamowieniem.id)
  );
  assert.ok(zOpinia, "opinia jest w kolejce");
  assert.equal(
    zOpinia.zrodla?.some((z) => z.rodzaj === "zwrot"),
    true,
    "ta sama sprawa niesie zwrot tego zamówienia"
  );
  /* Opinia bez zamówienia zostaje osobną sprawą — po samym loginie automat
     nie skleja niczego (ta sama reguła co przy pytaniach). */
  assert.equal(
    sprawy.filter((s) => s.zrodla?.some((z) => z.rodzaj === "opinia")).length >= 2,
    true
  );
});

test("piłka opinii: otwarta znaczy NASZ ruch, załatwiona zamyka sprawę", async () => {
  await O.synchronizujOpinie("Anna");
  przebudujSprawy();
  const zOpinia = S.listaSpraw().filter((s) => s.rodzaj === "opinia");
  assert.equal(zOpinia.length > 0, true);
  assert.equal(
    zOpinia.every((s) => s.pilka === "my"),
    true,
    "klient powiedział, co miał — ruch jest nasz"
  );

  for (const s of zOpinia) O.zmienStatusOpinii(s.id, "zalatwiona", "Anna");
  przebudujSprawy();
  assert.equal(
    S.listaSpraw().some((s) => s.zrodla?.some((z) => z.rodzaj === "opinia" && z.otwarte)),
    false
  );
});

test("nieznany status to odmowa ze zdaniem, a ten sam status to konflikt", async () => {
  await O.synchronizujOpinie("Anna");
  const o = O.listaOpinii()[0];
  assert.throws(() => O.zmienStatusOpinii(o.id, "wymyslony", "Anna"), /Nieznany status/);
  O.zmienStatusOpinii(o.id, "przejrzana", "Anna");
  assert.throws(() => O.zmienStatusOpinii(o.id, "przejrzana", "Anna"), /już w statusie/);
});

test("każda opinia zostawia ślad na osi czasu sprawy", async () => {
  await O.synchronizujOpinie("Anna");
  const o = O.listaOpinii().find((x) => x.ocena === 1)!;
  O.zmienStatusOpinii(o.id, "zalatwiona", "Anna");
  const wpisy = (
    db()
      .prepare("SELECT typ, szczegol FROM sprawa_zdarzenie WHERE rodzaj = 'opinia' AND lokalny_id = ? ORDER BY id")
      .all(o.id) as Array<{ typ: string; szczegol: string | null }>
  );
  assert.deepEqual(
    wpisy.map((w) => w.typ),
    ["zalozona", "zamknieta"]
  );
  assert.equal(wpisy[0].szczegol, "1/5", "oś czasu mówi, czy klient pochwalił, czy zjechał");
});
