import { db } from "./db/db.js";
import { policzZwroty, wyczyscZwroty, type PodsumowanieZwrotow } from "./services/zwroty-reset.js";
import { synchronizujAllegroZwroty } from "./services/allegro-zwroty-sync.js";

/* ── Czyszczenie zwrotów i pobranie ich od nowa (0.199.0) ───────────────────
   Osobny proces, nie trasa w API: ma się wykonać i skończyć. Trasa dawałaby
   przycisk kasujący zwroty firmy jednym kliknięciem, a to jest operacja
   nieodwracalna, którą wykonuje się świadomie z konsoli.

       source wertis.env && npm run zwroty:reset             # RAPORT, nic nie kasuje
       source wertis.env && npm run zwroty:reset -- --wykonaj
       source wertis.env && npm run zwroty:reset -- --wykonaj --bez-pobrania

   RAPORT JEST DOMYŚLNY. Kasowanie zwrotów jest nieodwracalne, a liczba
   w wierszu „własne" bywa niespodzianką: zwroty z paczek nieodebranych zakłada
   BIURO, więc Allegro ich nie odda i po skasowaniu nie wrócą.

   Usługi NIE trzeba zatrzymywać. SQLite chodzi w WAL, a takt synchronizacji
   po skasowaniu kursora zacznie od progu `ALLEGRO_ZWROTY_OD` — czyli zrobi
   dokładnie to samo, co `--wykonaj` bez `--bez-pobrania`, tylko później. */

const wykonaj = process.argv.includes("--wykonaj");
const bezPobrania = process.argv.includes("--bez-pobrania");
const mimoPieniedzy = process.argv.includes("--mimo-pieniedzy");

function wypisz(p: PodsumowanieZwrotow, naglowek: string): void {
  console.log(`\n${naglowek}`);
  console.log(`  zwroty                       ${p.zwrotow}`);
  console.log(`  pozycje zwrotów              ${p.pozycji}`);
  console.log(`  w tym własne (nieodebrane)   ${p.wlasnych}${
    p.wlasnych > 0 ? "   ← te NIE wrócą z Allegro, zakłada je biuro" : ""}`);
  console.log(`  z oddanymi pieniędzmi        ${p.zOddanymiPieniedzmi}${
    p.zOddanymiPieniedzmi > 0 ? "   ← zatrzymają czyszczenie" : ""}`);
  console.log(`  koszyki otwarte              ${p.koszykiOtwarte} (${p.pozycjiWKoszykachOtwartych} pozycji)`);
  console.log(`  koszyki zamknięte            ${p.koszykiZamkniete}   ← zostają nietknięte`);
  console.log(`  zadania mm w kolejce         ${p.zadaniaMmWKolejce}   ← zostają nietknięte`);
}

async function main(): Promise<void> {
  const database = db();

  if (!wykonaj) {
    wypisz(policzZwroty(database), "Stan zwrotów — RAPORT, nic nie skasowano:");
    console.log("\nCzyszczenie: npm run zwroty:reset -- --wykonaj");
    console.log("Zostają: pamięć oferta→kartoteka, zamknięte koszyki, zadania mm, dziennik.\n");
    return;
  }

  const skasowane = wyczyscZwroty(database,
    { id: null, name: "konserwacja (zwroty-reset)" }, { mimoPieniedzy });
  wypisz(skasowane, "Skasowano:");
  console.log("  kursor synchronizacji        cofnięty do zera");

  if (bezPobrania) {
    console.log("\nPobrania nie uruchamiam (--bez-pobrania). Zrobi je najbliższy takt.\n");
    return;
  }

  console.log("\nPobieram zwroty od nowa…");
  await synchronizujAllegroZwroty({ database });
  const po = policzZwroty(database);
  console.log(`  pobrane zwroty               ${po.zwrotow} (${po.pozycji} pozycji)`);
  console.log("\nGotowe. Decyzje biura są czyste — werdykty, oceny i kwoty trzeba nadać od nowa.\n");
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
