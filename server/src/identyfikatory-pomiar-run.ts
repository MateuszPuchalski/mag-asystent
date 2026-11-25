import fs from "node:fs";
import { bezMigracji, db } from "./db/db.js";
import { brakujaceTabele, raportPomiaru, zmierzIdentyfikatory } from "./services/identyfikatory-pomiar.js";

/* ── Pomiar parsera identyfikatorów ─────────────────────────────────────────
   Ile numerów części zostaje w opisach kartotek poza tabelą
   `towar_identyfikator` i spod jakich etykiet. Liczenie mieszka w
   `services/identyfikatory-pomiar.ts`; ten plik tylko je uruchamia.

   WYŁĄCZNIE ODCZYT. Wolno puścić na bazie magazynu przy żywej usłudze.

   Uruchomienie:  npm run identyfikatory:pomiar            (raport na ekran)
                  npm run identyfikatory:pomiar -- plik.md (raport do pliku)

   Na kartotece demo:  DB_PATH=/tmp/pomiar.db SGT_MODE=seeded npm run seed
                       DB_PATH=/tmp/pomiar.db npm run identyfikatory:pomiar   */

/* Migracji NIE robimy: schemat zakłada wyłącznie serwer API, a ten skrypt
   bywa uruchamiany obok niego. Dwa procesy migrujące naraz psują bazę. */
bezMigracji();

const brak = brakujaceTabele(db());
if (brak.length > 0) {
  /* Pusta baza to pomyłka w `DB_PATH`, nie wynik „zero numerów". Raport
     z samymi zerami wyglądałby jak pomiar. */
  console.error(`Brak tabel: ${brak.join(", ")}. Sprawdź DB_PATH — pomiar czyta bazę serwera.`);
  process.exit(1);
}

const raport = raportPomiaru(zmierzIdentyfikatory(db()), new Date().toISOString().slice(0, 19).replace("T", " "));

const plik = process.argv[2];
if (plik) {
  fs.writeFileSync(plik, raport, "utf8");
  console.log(`Raport zapisany: ${plik}`);
} else {
  console.log(raport);
}
