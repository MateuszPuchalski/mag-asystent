import { bezMigracji } from "./db/db.js";
import { cyklZwrotow, poLudzku, PROG_PROBKI, PRZERWA_MIN } from "./services/cykl-zwrotow.js";
import { wierszCsv, zbudujCsv } from "./services/csv.js";

/* ── Gdzie schodzi czas jednego zwrotu ───────────────────────────────────────
   Osobny proces, nie ekran: pytanie „czy warto skracać ten odcinek" zadaje się
   kilka razy do roku, a odpowiedź czyta się raz.

       source wertis.env && npm run zwroty:cykl
       npm run zwroty:cykl -- --dni 30
       npm run zwroty:cykl -- --csv > kartony.csv

   Raport NICZEGO NIE ZAPISUJE i liczy ze znaczników, które w bazie już są, więc
   działa wstecz — także na kartonach sprzed wydania, które go dołożyło.       */

bezMigracji();

const arg = (nazwa: string): string | undefined => {
  const i = process.argv.indexOf(nazwa);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dni = Number(arg("--dni") ?? 90) || 90;
const r = cyklZwrotow(dni);

if (process.argv.includes("--csv")) {
  const linie = [wierszCsv([
    "koszId", "kod", "kodHali", "poczatek", "zamkniecie", "mmZamowione", "mmWSubiekcie",
    "pierwszeOdlozenie", "ostatnieOdlozenie", "powrot",
    "odlozen", "poprawek", "pominiec", "wpisow", "rozjazdow", "minutyAktywne",
  ], ";")];
  for (const s of r.sprawy) {
    linie.push(wierszCsv([
      s.koszId, s.kod, s.kodHali ?? "", s.poczatek, s.zamkniecie ?? "",
      s.mmZamowione ?? "", s.mmWSubiekcie ?? "",
      s.pierwszeOdlozenie ?? "", s.ostatnieOdlozenie ?? "", s.powrot ?? "",
      s.odlozen, s.poprawek, s.pominiec, s.wpisow, s.rozjazdow, s.minutyAktywne.toFixed(1),
    ], ";"));
  }
  process.stdout.write(zbudujCsv(linie));
  process.exit(0);
}

console.log(`\n  CYKL ZWROTU — ostatnie ${r.dni} dni, ${r.kartonow} kartonów\n`);
if (r.kartonow === 0) {
  console.log("  Brak koszyków zwrotów w tym oknie — nie ma czego liczyć.\n");
  process.exit(0);
}

for (const o of r.odcinki) {
  /* Próbka poniżej progu dostaje gwiazdkę, a nie milczenie: mediana z dwóch
     kartonów jest szumem, ale ukrycie jej kazałoby się zastanawiać, czy
     odcinek w ogóle istnieje. */
  const szum = o.probka > 0 && o.probka < PROG_PROBKI ? " *" : "";
  console.log(
    `  ${o.nazwa.padEnd(14)} ${poLudzku(o.medianaMin).padStart(10)}` +
      `   ${`[${o.czyja}]`.padEnd(15)} n=${o.probka}, najdłuższy ${poLudzku(o.najdluzszyMin)}${szum}`
  );
  console.log(`  ${" ".repeat(14)} ${o.opis}`);
}

const proc = (n: number) => ((n / Math.max(1, r.odlozen)) * 100).toFixed(1);
console.log(`\n  Odłożeń: ${r.odlozen} · poprawek: ${r.poprawek} · pominięć: ${r.pominiec}`);
console.log(
  `  Adres z klawiatury: ${r.wpisow} (${proc(r.wpisow)}%)` +
    ` · pod innym adresem niż kartoteka: ${r.rozjazdow} (${proc(r.rozjazdow)}%)`
);
console.log(
  `  Tempo: ${r.sekundNaPozycje === null ? "brak danych"
    : `${r.sekundNaPozycje.toFixed(0)} s na pozycję`}` +
    ` (czas aktywny; przerwa > ${PRZERWA_MIN} min nie liczy się jako praca)`
);
console.log(
  `\n  * próbka mniejsza niż ${PROG_PROBKI} kartonów — liczba jest szumem, nie wynikiem.` +
    "\n  Mediana, nie średnia: jeden karton z piątku na poniedziałek zamazałby resztę.\n"
);
