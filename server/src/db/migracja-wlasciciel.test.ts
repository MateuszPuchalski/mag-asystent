import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

/* ── Schemat ma JEDNEGO właściciela: serwer API (0.177.1) ────────────────────
   2 września wyjątek w `migrate()` położył API i workera naraz, bo migrację
   wykonywał każdy proces otwierający bazę. W logu workera zostawało „database
   is locked" — objaw prowadzący diagnozę w złe miejsce, bo bazę blokowało API
   mielące migrację w pętli restartów NSSM.

   Te testy pilnują obu połówek umowy: że proces zrzekający się migracji
   NAPRAWDĘ jej nie robi, i że zrzeczenie się po fakcie nie przechodzi po
   cichu. Każdy chodzi we WŁASNYM procesie, bo `bezMigracji()` jest stanem
   modułu — jeden test nie ma prawa zmienić warunków drugiemu.               */

const tutaj = path.dirname(new URL(import.meta.url).pathname);

/** Uruchamia kod w osobnym procesie na własnej bazie; oddaje jego wyjście. */
function wProcesie(kod: string): { out: string; ok: boolean } {
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wlasciciel-"));
  const plik = path.join(katalog, "t.mjs");
  /* Import po ADRESIE BEZWZGLĘDNYM: skrypt leży w katalogu tymczasowym, więc
     ścieżka względna szukałaby modułu obok niego, nie w repo. */
  const modul = JSON.stringify(new URL("./db.ts", import.meta.url).href);
  fs.writeFileSync(plik,
    `process.env.DB_PATH = ${JSON.stringify(path.join(katalog, "t.db"))};\n`
    + `const { bezMigracji, db } = await import(${modul});\n${kod}`);
  const r = spawnSync("npx", ["tsx", plik], {
    cwd: path.resolve(tutaj, "../.."), encoding: "utf8", timeout: 120_000,
  });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, ok: r.status === 0 };
}

test("proces bez migracji nie zakłada schematu ANI go nie migruje", () => {
  /* Sedno umowy. Worker otwierający pustą bazę ma jej NIE tknąć — inaczej
     zostawiłby stan pośredni: pół schematu z `schema.sql`, bez migracji. */
  const r = wProcesie(`
    bezMigracji();
    const d = db();
    const ile = d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get();
    console.log("TABEL:" + ile.n);
  `);
  assert.equal(r.ok, true, r.out);
  assert.match(r.out, /TABEL:0/, "pusta baza ma zostać pusta");
});

test("ten sam kod BEZ zrzeczenia się migruje — inaczej test wyżej nic nie mierzy", () => {
  /* Kontrola. Bez niej „zero tabel" mogłoby znaczyć, że zepsuł się sam odczyt. */
  const r = wProcesie(`
    const d = db();
    const ile = d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get();
    console.log("TABEL:" + ile.n);
  `);
  assert.equal(r.ok, true, r.out);
  const n = Number(/TABEL:(\d+)/.exec(r.out)?.[1] ?? 0);
  assert.ok(n > 20, `API zakłada pełny schemat, a zastałem ${n} tabel`);
});

test("zrzeczenie się PO otwarciu bazy rzuca, zamiast milczeć", () => {
  /* Cicha nieskuteczność byłaby gorsza niż brak funkcji: proces myślałby, że
     nie migruje, a migracja już by przeszła. */
  const r = wProcesie(`
    db();
    try { bezMigracji(); console.log("BEZ-BLEDU"); }
    catch (e) { console.log("RZUCILO:" + e.message); }
  `);
  assert.equal(r.ok, true, r.out);
  assert.match(r.out, /RZUCILO:.*po otwarciu bazy/);
});

test("brakującą tabelę widać po nazwie, a pełny schemat nie zgłasza nic", () => {
  const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  return import("./db.js").then(({ brakujacaTabela }) => {
    assert.equal(brakujacaTabela(d as never), null, "pełny schemat jest gotowy");
    d.exec("DROP TABLE sfera_queue");
    assert.equal(brakujacaTabela(d as never), "sfera_queue",
      "brak tabeli ma być nazwany, nie zbiorczy");
  });
});

test("worker z niepełnym schematem CZEKA — nie pada i nie migruje", () => {
  /* Najważniejszy test tego wydania, bo odtwarza dokładnie 2 września: worker
     wstaje przed API (NSSM nie ma między nimi zależności) i zastaje bazę bez
     schematu. Ma wypisać JEDNO zdanie i pracować dalej — proces, który pada,
     NSSM podnosi z powrotem, czyli wraca pętla restartów.

     Bazę zostawia NIETKNIĘTĄ: gdyby ją zakładał, wróciłby stan, w którym dwa
     procesy migrują tę samą bazę. */
  const r = wProcesie(`
    const { spawnSync } = await import("node:child_process");
    // worker.ts sam odpala pętlę, więc puszczamy go i ubijamy po dwóch taktach
    const modul = new URL("../worker/worker.ts", ${JSON.stringify(new URL("./db.ts", import.meta.url).href)}).pathname;
    const w = spawnSync("npx", ["tsx", modul], {
      encoding: "utf8", timeout: 12000,
      env: { ...process.env, WORKER_POLL_MS: "150", SGT_MODE: "seeded" },
    });
    console.log("WYJSCIE:" + (w.stdout ?? "") + (w.stderr ?? ""));
    const d = new (await import("node:sqlite")).DatabaseSync(process.env.DB_PATH);
    console.log("TABEL:" + d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n);
  `);
  assert.equal(r.ok, true, r.out);
  assert.match(r.out, /czekam — w bazie nie ma tabeli/, "worker mówi, na co czeka");
  assert.doesNotMatch(r.out, /no such table/, "i nie wywraca się na zapytaniu");
  assert.match(r.out, /TABEL:0/, "bazy nie tknął");
});

test("zdanie o czekaniu pada RAZ, nie co takt", () => {
  /* Przy takcie rzędu sekundy pisanie za każdym razem zapełniłoby dziennik
     kopiami jednego zdania — tę cenę repo już raz zapłaciło (DEPLOY §7). */
  const r = wProcesie(`
    const { spawnSync } = await import("node:child_process");
    const modul = new URL("../worker/worker.ts", ${JSON.stringify(new URL("./db.ts", import.meta.url).href)}).pathname;
    const w = spawnSync("npx", ["tsx", modul], {
      encoding: "utf8", timeout: 12000,
      env: { ...process.env, WORKER_POLL_MS: "150", SGT_MODE: "seeded" },
    });
    const tekst = (w.stdout ?? "") + (w.stderr ?? "");
    console.log("ILE:" + (tekst.match(/czekam — w bazie nie ma tabeli/g) ?? []).length);
  `);
  assert.equal(r.ok, true, r.out);
  assert.match(r.out, /ILE:1/, "jedno zdanie na jedną zmianę stanu");
});
