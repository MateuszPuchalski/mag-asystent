import { bezMigracji } from "./db/db.js";
import { reconcile, zapiszRaportRekoncyliacji } from "./services/reconcile.js";

/* ── Rekoncyliacja na żądanie ────────────────────────────────────────────────
   Od 0.487.0 NOCNĄ rekoncyliację robi sam serwer API (`services/przebieg-
   nocny.ts`). Ten skrypt był dotąd jedyną drogą i czekał na wpis
   w Harmonogramie zadań, którego instalator nie zakładał — a bramka etapu 4
   wdrożenia stała właśnie na nim. Zostaje do uruchomienia ręką, na przykład
   zaraz po naprawie, żeby nie czekać do nocy.

   ZEROWY WYNIK NIE TWORZY PLIKU. Raport, który przychodzi codziennie, przestaje
   być czytany po tygodniu — a wtedy nie chroni już przed niczym. Kod wyjścia
   też o tym mówi: 0 = czysto, 2 = są rozjazdy.                              */

/* Migracji NIE robimy (0.177.1) — schemat zakłada wyłącznie serwer API. Ten
   skrypt bywa uruchamiany przy żywej usłudze, a migracja z dwóch procesów
   naraz to blizna z 2 września. */
bezMigracji();

const r = reconcile();
const { kartotek, zadan } = r.sprawdzono;
console.log(`[reconcile] sprawdzono: ${kartotek} kartotek, ${zadan} zadań`);

const plik = zapiszRaportRekoncyliacji(r);
if (!plik) {
  console.log("[reconcile] bez rozjazdów — raport nie powstaje");
  process.exit(0);
}

console.error(`[reconcile] ${r.rozjazdy.length} rozjazdów → ${plik}`);
for (const x of r.rozjazdy.slice(0, 20)) {
  console.error(`  ${x.rodzaj}  ${x.klucz}  ${x.opis}`);
}
if (r.rozjazdy.length > 20) console.error(`  … i ${r.rozjazdy.length - 20} więcej (patrz CSV)`);
process.exit(2);
