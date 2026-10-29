import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Wymiary w demo: lista → kolejka → DevSferaAdapter → lista ───────────────
   Demo ma przejść całą drogę bez Subiekta. Pilnujemy, że zmierzony towar
   schodzi z listy dopiero po wykonaniu zadania i że pomiar częściowy nie
   kasuje tego, co już było zmierzone. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wymd-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";
process.env.WORKER_SIM_ERRORS = "0";

let db: typeof import("../db/db.js").db;
let S: typeof import("../services/wymiary.js");
let K: typeof import("../worker/kolejka.js");
let Dev: typeof import("./sfera.dev.js").DevSferaAdapter;

const AUTOR = { nazwa: "Tester", ref: null };

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("../services/wymiary.js");
  K = await import("../worker/kolejka.js");
  ({ DevSferaAdapter: Dev } = await import("./sfera.dev.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["sfera_queue", "events", "sgt_stan", "sgt_towar"]) d.prepare(`DELETE FROM ${t}`).run();
  const t = d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean) VALUES (?,?,?,?)");
  t.run(1, "KOSA-1", "Kosa spalinowa", "5901");
  t.run(2, "GRAB-2", "Grabie", null);
  d.prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (1, 1, 5, 0)").run();
});

async function wykonajKolejke() {
  for (let t = K.pickTask(); t; t = K.pickTask()) await K.przetworzZadanie(t, new Dev());
}

const symbole = async (q = "") =>
  (await S.listaBezWymiarow({ q })).pozycje.map((p) => p.symbol);

test("demo działa bez kluczy WYMIARY_POLE_* i zaczyna od pełnej listy, stan na czele", async () => {
  const l = await S.listaBezWymiarow({});
  assert.equal(l.wlaczone, true);
  assert.equal(l.razem, 2);
  assert.deepEqual(l.pozycje.map((p) => [p.symbol, p.stan]), [["KOSA-1", 5], ["GRAB-2", 0]]);
  assert.deepEqual(await symbole("grab"), ["GRAB-2"]);
});

test("pełny pomiar schodzi z listy dopiero po wykonaniu zadania", async () => {
  const w = await S.zapiszPomiar(1, { bruttoKg: "3,2", nettoKg: "2,9", dlugosc: "120", szerokosc: "30,5", wysokosc: 25 }, AUTOR);
  assert.equal(w.ok, true);
  const przed = await S.listaBezWymiarow({});
  assert.equal(przed.pozycje.find((p) => p.twId === 1)?.oczekuje, true, "do wykonania towar stoi jako oczekujący");

  await wykonajKolejke();
  assert.deepEqual(await symbole(), ["GRAB-2"]);
  assert.deepEqual(
    { ...(db().prepare("SELECT masa, masa_netto, wym_dlugosc, wym_szerokosc, wym_wysokosc FROM sgt_towar WHERE tw_id = 1").get() as object) },
    { masa: 3.2, masa_netto: 2.9, wym_dlugosc: "120", wym_szerokosc: "30,5", wym_wysokosc: "25" }
  );
});

test("pomiar częściowy nie kasuje wcześniejszego, a brak jednego wymiaru trzyma towar na liście", async () => {
  await S.zapiszPomiar(2, { bruttoKg: 0.8, dlugosc: 150, szerokosc: 10 }, AUTOR);
  await wykonajKolejke();
  const g = (await S.listaBezWymiarow({ q: "grab" })).pozycje[0];
  assert.deepEqual([g.brutto, g.netto, g.dlugosc, g.szerokosc, g.wysokosc], [0.8, null, "150", "10", null]);

  /* Samo netto większe od brutto, które już stoi w kartotece — odmowa przed kolejką. */
  const zle = await S.zapiszPomiar(2, { nettoKg: "0,9" }, AUTOR);
  assert.equal(zle.ok, false);

  await S.zapiszPomiar(2, { nettoKg: "0,7", wysokosc: "4,5" }, AUTOR);
  await wykonajKolejke();
  assert.deepEqual(await symbole("grab"), []);
  assert.deepEqual(
    { ...(db().prepare("SELECT masa, wym_dlugosc, wym_wysokosc FROM sgt_towar WHERE tw_id = 2").get() as object) },
    { masa: 0.8, wym_dlugosc: "150", wym_wysokosc: "4,5" }
  );
});
