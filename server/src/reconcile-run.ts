import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { reconcile, reconcileCsv } from "./services/reconcile.js";

/* ── Uruchomienie rekoncyliacji raz na dobę (plan §9) ───────────────────────
   Osobny proces, nie zadanie w API: ma się wykonać i skończyć, żeby cron albo
   NSSM mógł go pilnować, a awaria nie dotykała serwera obsługującego kolektory.

       0 3 * * *  cd /c/wertis && source wertis.env && npm run reconcile

   ZEROWY WYNIK NIE TWORZY PLIKU. Raport, który przychodzi codziennie, przestaje
   być czytany po tygodniu — a wtedy nie chroni już przed niczym. Kod wyjścia
   też o tym mówi: 0 = czysto, 2 = są rozjazdy (do podpięcia pod alert).       */

const r = reconcile();
const { kartotek, zadan } = r.sprawdzono;
console.log(`[reconcile] sprawdzono: ${kartotek} kartotek, ${zadan} zadań`);

if (r.rozjazdy.length === 0) {
  console.log("[reconcile] bez rozjazdów — raport nie powstaje");
  process.exit(0);
}

const dir = path.join(path.dirname(config.dbPath), "reconcile");
fs.mkdirSync(dir, { recursive: true });
const plik = path.join(dir, `${r.at.slice(0, 10)}.csv`);
fs.writeFileSync(plik, reconcileCsv(r), "utf8");

console.error(`[reconcile] ${r.rozjazdy.length} rozjazdów → ${plik}`);
for (const x of r.rozjazdy.slice(0, 20)) {
  console.error(`  ${x.rodzaj}  ${x.klucz}  ${x.opis}`);
}
if (r.rozjazdy.length > 20) console.error(`  … i ${r.rozjazdy.length - 20} więcej (patrz CSV)`);
process.exit(2);
