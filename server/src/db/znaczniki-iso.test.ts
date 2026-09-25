import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { KOLUMNY_ZNACZNIKOW_ZE_SPACJA, migrate } from "./db.js";

/* ── Znaczniki ISO (0.497.1) ─────────────────────────────────────────────
   Dwie gwarancje. Stare wiersze ze spacją migracja zamienia na ISO, nie
   ruszając godziny ani wierszy już poprawnych. W źródłach serwera nie ma
   `datetime('now'` — ani w zapisie, ani w granicy okna. Oba błędy już
   raz weszły tą drogą: okna liczyły o dobę za dużo, a panel pokazywał
   zakończenie dyskusji dwie godziny za wcześnie. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

test("migracja zamienia zapis ze spacją na ISO, ISO i NULL zostawia, drugi raz nic nie robi", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')").run().lastInsertRowid);
  const autor = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  const sprawa = (ext: string, at: string | null) => Number(d.prepare(`INSERT INTO reklamacja_klienta
      (channel_account_id, external_id, otwarto_at, synced_at, zakonczenie_at, zwrot_towaru_at, prowadzi_at)
      VALUES (?,?,?,?,?,?,?)`).run(konto, ext, "2026-09-01T10:00:00.000Z", "2026-09-01T10:00:00.000Z",
      at, at, at).lastInsertRowid);
  const stara = sprawa("i-1", "2026-09-25 08:00:00");
  const nowa = sprawa("i-2", "2026-09-25T08:00:00.123Z");
  const pusta = sprawa("i-3", null);
  d.prepare(`INSERT INTO reklamacja_outbox(reklamacja_id, idempotency_key, body, expected_wersja,
      status, created_by, finished_at) VALUES (?,?,?,?,?,?,?)`)
    .run(stara, "k-1", "treść", 1, "sent", autor, "2026-09-25 08:00:00");

  migrate(d);

  const kolumny = (id: number) => d.prepare(`SELECT zakonczenie_at, zwrot_towaru_at, prowadzi_at
      FROM reklamacja_klienta WHERE id=?`).get(id) as Record<string, string | null>;
  // `datetime('now')` w SQLite to UTC — zmienia się zapis, nie godzina
  assert.deepEqual({ ...kolumny(stara) }, {
    zakonczenie_at: "2026-09-25T08:00:00.000Z",
    zwrot_towaru_at: "2026-09-25T08:00:00.000Z",
    prowadzi_at: "2026-09-25T08:00:00.000Z",
  });
  assert.equal(kolumny(nowa).prowadzi_at, "2026-09-25T08:00:00.123Z", "ISO zostaje co do milisekundy");
  assert.equal(kolumny(pusta).prowadzi_at, null);
  assert.equal((d.prepare("SELECT finished_at FROM reklamacja_outbox").get() as { finished_at: string })
    .finished_at, "2026-09-25T08:00:00.000Z");

  const przed = JSON.stringify(d.prepare("SELECT * FROM reklamacja_klienta ORDER BY id").all());
  migrate(d);
  assert.equal(JSON.stringify(d.prepare("SELECT * FROM reklamacja_klienta ORDER BY id").all()), przed);
  assert.equal(KOLUMNY_ZNACZNIKOW_ZE_SPACJA.length, 4);
});

function plikiSerwera(katalog: string): string[] {
  return fs.readdirSync(katalog, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(katalog, e.name);
    if (e.isDirectory()) return plikiSerwera(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

test("w źródłach serwera nie ma datetime('now' poza komentarzem", () => {
  const trafienia: string[] = [];
  for (const plik of plikiSerwera(path.resolve(import.meta.dirname, ".."))) {
    fs.readFileSync(plik, "utf8").split("\n").forEach((linia, i) => {
      /* Komentarz o pułapce ma prawo ją nazwać — liczy się kod. Linia
         komentarza zaczyna się od `*`, `//` albo `/*`, a SQL-owy od `--`. */
      if (/^\s*(\*|\/\/|\/\*|--)/.test(linia)) return;
      if (linia.includes("datetime('now'")) {
        trafienia.push(`${path.relative(path.resolve(import.meta.dirname, ".."), plik)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(trafienia, [],
    "datetime() daje spację zamiast T — użyj strftime('%Y-%m-%dT%H:%M:%fZ', …) albo GRANICA_OKNA");
});
