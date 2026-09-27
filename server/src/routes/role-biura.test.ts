import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── JEDNA LISTA RÓL BIURA (0.544.0) ────────────────────────────────────────
   Do tego wydania para `["biuro", "admin"]` stała wpisana z palca w piętnastu
   trasach i jednym serwisie, choć `ROLE_BIUROWE` w `services/users.ts`
   istniało od dawna. Każda kopia to miejsce, w którym dopisanie nowej roli
   biurowej po cichu nie zadziała. Rozjazd nie daje błędu, tylko 403 u jednej
   osoby na jednym ekranie.

   Poza tym plikiem para wolno stać wyłącznie w dwóch miejscach:
   - `services/users.ts` — jej jedyna definicja;
   - `services/auth.ts` — mapa uprawnień operacji. Tam każda operacja ma
     WŁASNĄ listę i zbieżność z biurem jest dziś przypadkiem, nie regułą. */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOZWOLONE = new Set(["services/users.ts", "services/auth.ts"]);

function pliki(katalog: string): string[] {
  return fs.readdirSync(katalog, { withFileTypes: true }).flatMap((w) => {
    const p = path.join(katalog, w.name);
    if (w.isDirectory()) return pliki(p);
    return w.name.endsWith(".ts") && !w.name.endsWith(".test.ts") ? [p] : [];
  });
}

test("para ról biura stoi w jednym miejscu, reszta bierze ROLE_BIUROWE", () => {
  const kopie = pliki(SRC)
    .map((p) => path.relative(SRC, p).split(path.sep).join("/"))
    .filter((rel) => !DOZWOLONE.has(rel))
    .filter((rel) => /\[\s*"biuro"\s*,\s*"admin"\s*\]/.test(fs.readFileSync(path.join(SRC, rel), "utf8")));
  assert.deepEqual(kopie, [], "użyj ROLE_BIUROWE z services/users.ts");
});
