import { db, bezMigracji } from "./db/db.js";
import { config } from "./config.js";
import { postepZasiewu, rozjazdyZapasu, zasiew } from "./services/wms-subiekt.js";

/* ── Zasiew zapasu ze stanu Subiekta (0.381.0) ───────────────────────────────
   Uruchamiane RĘKĄ, raz przy starcie WMS-a i potem w razie potrzeby. Nie jest
   tickerem i nie ma go w `main()`: dosypanie stanu jest decyzją wdrożeniową,
   a nie rytmem pracy serwera.

   Bez argumentu skrypt POKAZUJE, co by zrobił, i nic nie zapisuje. Zapis
   wymaga `--zapisz`, bo pierwszy przebieg na produkcji dotyka całego magazynu.
   Ta sama zasada co `-DryRun` w instalatorze: narzędzie ma najpierw pokazać.

       npm -w server run wms:zasiew            # podgląd, zero zapisu
       npm -w server run wms:zasiew -- --zapisz

   Migracji NIE robimy (0.177.1): schemat zakłada wyłącznie serwer API.       */
bezMigracji();

const zapisz = process.argv.includes("--zapisz");
const rozjazdy = rozjazdyZapasu();
const doZasiewu = rozjazdy.filter((r) => r.powod === "wms_mniej");
const pominiete = rozjazdy.filter((r) => r.powod !== "wms_mniej");

console.log(`Magazyn: ${config.magId.MAG}`);
console.log(`Kartotek do zasiewu: ${doZasiewu.length}`);
console.log(`Sztuk do dosypania: ${doZasiewu.reduce((s, r) => s + r.roznica, 0)}`);
console.log(`Pominiętych rozjazdów: ${pominiete.length}`);
for (const r of pominiete.slice(0, 20)) {
  console.log(`  ${r.powod.padEnd(11)} ${r.symbol ?? r.twId}: Subiekt ${r.subiekt}, miejsca ${r.wms}`);
}
if (pominiete.length > 20) console.log(`  … i ${pominiete.length - 20} więcej`);

if (!zapisz) {
  console.log("\nPODGLĄD — nic nie zapisano. Zapis: npm -w server run wms:zasiew -- --zapisz");
} else {
  /* Konto systemowe: zasiew wykonuje wdrożenie, nie zalogowany człowiek.
     `admin` jest wymagane, bo ruch zapasu przechodzi przez bramkę roli. */
  const wynik = zasiew(
    { id: 0, name: "zasiew", role: "admin" },
    `zasiew-subiekt-${new Date().toISOString().replace(/[^0-9]/g, "")}`,
  );
  console.log(`\nZasiane kartoteki: ${wynik.zasiane}, sztuk: ${wynik.sztuk}`);
}

const postep = postepZasiewu();
console.log(
  `\nPostęp: w miejscu nieznanym ${postep.nieznane} szt (${postep.kartotekNieznane} kartotek), ` +
    `na półkach ${postep.polki} szt (${postep.kartotekPolki} kartotek).`,
);
db().close();
