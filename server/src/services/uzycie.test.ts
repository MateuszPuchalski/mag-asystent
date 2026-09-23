import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Raport „czego nikt nie używa" (23 września 2026) ────────────────────────
   Dwie gwarancje. Rejestr typów zna KAŻDY literał z `logEvent(...)` w źródłach
   serwera — inaczej funkcja nigdy nie naciśnięta nie trafiłaby do raportu,
   bo nie ma jej ani w dzienniku, ani w rejestrze. I raport jest odczytem:
   niczego nie dopisuje do bazy. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-uzycie-")), "t.db");

let db: typeof import("../db/db.js").db;
let U: typeof import("./uzycie.js");
let ZDARZENIA: readonly string[];

before(async () => {
  ({ db } = await import("../db/db.js"));
  U = await import("./uzycie.js");
  ({ ZDARZENIA } = await import("./zdarzenia-rejestr.js"));
});

beforeEach(() => { db().prepare("DELETE FROM events").run(); });

/** Pierwszy argument `logEvent(` — do przecinka albo nawiasu na zerowej głębokości. */
function pierwszyArgument(zrodlo: string, od: number): string {
  let glebokosc = 0; let napis: string | null = null; let arg = "";
  for (let i = od; i < zrodlo.length; i++) {
    const c = zrodlo[i];
    if (napis) {
      arg += c;
      if (c === "\\") { arg += zrodlo[++i]; continue; }
      if (c === napis) napis = null;
    } else if (c === "\"" || c === "'" || c === "`") { napis = c; arg += c; }
    else if ("([{".includes(c)) { glebokosc++; arg += c; }
    else if (")]}".includes(c)) { if (glebokosc === 0) break; glebokosc--; arg += c; }
    else if (c === "," && glebokosc === 0) break;
    else arg += c;
  }
  return arg;
}

function plikiSerwera(katalog: string): string[] {
  return fs.readdirSync(katalog, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(katalog, e.name);
    if (e.isDirectory()) return plikiSerwera(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

test("każdy literał z logEvent(...) w źródłach stoi w rejestrze", () => {
  const znane = new Set(ZDARZENIA);
  const brak: string[] = [];
  let literalow = 0;
  for (const plik of plikiSerwera(path.resolve(import.meta.dirname, ".."))) {
    const zrodlo = fs.readFileSync(plik, "utf8");
    for (const m of zrodlo.matchAll(/\blogEvent\(/g)) {
      if (zrodlo.slice(Math.max(0, m.index - 9), m.index) === "function ") continue;
      const arg = pierwszyArgument(zrodlo, m.index + m[0].length);
      /* Literał po `===` to warunek trójargumentowy, nie typ zdarzenia. */
      for (const l of arg.matchAll(/(===\s*)?"([^"]+)"/g)) {
        if (l[1]) continue;
        literalow++;
        if (!znane.has(l[2])) brak.push(`${path.basename(plik)}: ${l[2]}`);
      }
      /* Szablon: `zwrot_werdykt_${decyzja}` — rejestr ma znać choć jedno rozwinięcie. */
      for (const t of arg.matchAll(/`([^`$]+)\$\{/g)) {
        if (!ZDARZENIA.some((z) => z.startsWith(t[1]))) brak.push(`${path.basename(plik)}: ${t[1]}*`);
      }
    }
  }
  assert.ok(literalow > 200, `spodziewałem się ponad dwustu literałów, jest ${literalow}`);
  assert.deepEqual(brak, [], "dopisz nowe typy do services/zdarzenia-rejestr.ts");
});

test("nieużywane w oknie idą osobno, automaty odpadają, a obcy typ nie ginie", () => {
  const d = db();
  const teraz = new Date("2026-09-23T12:00:00Z");
  const wpisz = (typ: string, kiedy: string) =>
    d.prepare("INSERT INTO events(type,user_id,created_at) VALUES (?,?,?)").run(typ, "anna", kiedy);
  wpisz("rozmowa_wyslana", "2026-09-22T10:00:00Z");
  wpisz("rozmowa_wyslana", "2026-09-21T10:00:00Z");
  wpisz("rozmowa_priorytet", "2026-07-01T10:00:00Z");
  wpisz("copilot_auto_szkic", "2026-09-22T10:00:00Z");
  wpisz("typ_z_przeszlosci", "2026-01-01T10:00:00Z");

  const r = U.raportUzycia(30, teraz, d);
  const skrzynka = r.obszary.find((o) => o.obszar === "Skrzynka")!;
  assert.deepEqual(skrzynka.uzywane.find((w) => w.typ === "rozmowa_wyslana"), {
    typ: "rozmowa_wyslana", ile: 2, ostatnio: "2026-09-22T10:00:00Z" });
  const priorytet = skrzynka.nieuzywane.find((w) => w.typ === "rozmowa_priorytet");
  assert.equal(priorytet?.ostatnio, "2026-07-01T10:00:00Z", "ostatnie użycie przed oknem");
  assert.ok(skrzynka.nieuzywane.some((w) => w.typ === "rozmowa_komentarz" && w.ostatnio === null));
  assert.ok(!r.obszary.some((o) => [...o.uzywane, ...o.nieuzywane].some((w) => w.typ === "copilot_auto_szkic")));
  assert.deepEqual(r.spozaRejestru.map((w) => w.typ), ["typ_z_przeszlosci"]);
});

test("raport niczego nie zapisuje", () => {
  const d = db();
  const przed = (d.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  U.raportUzycia(30, new Date(), d);
  assert.equal((d.prepare("SELECT total_changes() AS n").get() as { n: number }).n, przed);
});

test("obszar po przedrostku typu", () => {
  assert.equal(U.obszarZdarzenia("zwrot_kwota"), "Zwroty");
  assert.equal(U.obszarZdarzenia("zwroty_synchronizacja_reczna"), "Zwroty");
  assert.equal(U.obszarZdarzenia("kosz_rozlozony"), "Kosze");
  assert.equal(U.obszarZdarzenia("reklamacje_synchronizacja_reczna"), "Reklamacje");
  assert.equal(U.obszarZdarzenia("cos_nowego"), "Inne");
});
