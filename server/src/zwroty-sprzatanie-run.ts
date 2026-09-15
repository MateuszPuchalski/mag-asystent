import { db } from "./db/db.js";
import {
  policzRozliczonePozaAplikacja, skasujRozliczonePozaAplikacja,
  type PodsumowanieSprzatania,
} from "./services/zwroty-sprzatanie.js";

/* ── Kasowanie zwrotów rozliczonych poza aplikacją (0.340.0) ────────────────
   Osobny proces, nie trasa w API — ta sama zasada co przy `zwroty:reset`:
   trasa dałaby przycisk kasujący historię firmy jednym kliknięciem, a to jest
   operacja nieodwracalna, którą wykonuje się świadomie z konsoli.

       source wertis.env && npm run zwroty:sprzatnij              # RAPORT
       source wertis.env && npm run zwroty:sprzatnij -- --wykonaj

   RAPORT JEST DOMYŚLNY, bo skasowanego zwrotu nie da się odzyskać: kursor
   synchronizacji zostaje nietknięty, więc Allegro go nie odda przy takcie.
   Pojedynczy zwrot wraca drogą „Poszukaj w Allegro", gdy okaże się potrzebny
   do rozmowy z klientem.

   Usługi NIE trzeba zatrzymywać — SQLite chodzi w WAL.                      */

const wykonaj = process.argv.includes("--wykonaj");

function wypisz(p: PodsumowanieSprzatania, naglowek: string): void {
  console.log(`\n${naglowek}`);
  console.log(`  zwroty                       ${p.doSkasowania}`);
  console.log(`  pozycje zwrotów              ${p.pozycji}`);
  if (p.numery.length) {
    console.log(`  numery                       ${p.numery.join(", ")}${
      p.doSkasowania > p.numery.length ? ` … i ${p.doSkasowania - p.numery.length} więcej` : ""}`);
  }
  /* CO ZOSTAJE I DLACZEGO. Sama liczba skasowanych nie odpowiada na pytanie,
     które człowiek zada jako następne: „czemu tamten wiersz dalej stoi". */
  const z = p.zostaja;
  console.log("\n  Zostają, bo mają u nas własny ślad:");
  console.log(`    nasz zwrot płatności       ${z.zNaszymZwrotemPlatnosci}`);
  console.log(`    notatka o przelewie        ${z.zNotatkaOPrzelewie}`);
  console.log(`    numer korekty              ${z.zKorekta}`);
  console.log(`    pozycja w koszyku          ${z.wKoszyku}`);
}

function main(): void {
  const database = db();

  if (!wykonaj) {
    wypisz(policzRozliczonePozaAplikacja(database),
      "Zwroty rozliczone POZA aplikacją — RAPORT, nic nie skasowano:");
    console.log("\nKasowanie: npm run zwroty:sprzatnij -- --wykonaj");
    console.log("Kursor synchronizacji zostaje — skasowane NIE wrócą przy takcie.\n");
    return;
  }

  const skasowane = skasujRozliczonePozaAplikacja(database,
    { id: null, name: "konserwacja (zwroty-sprzatanie)" });
  wypisz(skasowane, "Skasowano:");
  console.log("\nGotowe. Dziennik zdarzeń zostaje nietknięty.\n");
}

try {
  main();
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
}
