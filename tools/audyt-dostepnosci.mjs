#!/usr/bin/env node
/* ── Audyt dostępności panelu w prawdziwej przeglądarce (@wydanie) ──────────
   axe-core (WCAG 2.2 A i AA oraz dobre praktyki) na każdej trasie `/obsluga`,
   po zalogowaniu, plus zrzut ekranu każdej trasy i przejście klawiaturą
   przez ekran startowy.

   DLACZEGO OBOK STRAŻNIKA W TESTACH. `panel/src/test/dostepnosc.ts` biegnie
   w jsdom, który nie liczy układu ani barw. Kontrast zależny od tła rodzica
   i widoczność fokusu mierzy się wyłącznie tutaj. Pierwszy przebieg znalazł
   właśnie taki przypadek: `slate-500` na tle strony w `PasekTla`, 4.34:1.

   NIE JEST BRAMKĄ. Potrzebuje działającego serwera i panelu, a bramki przed
   wypchnięciem ich nie stawiają. To pomiar przed i po zmianie wyglądu.

   Użycie (z korzenia repo, serwer na :3001 i `npm run dev:panel` na :5174):
     node tools/audyt-dostepnosci.mjs <katalog-wyniku> [login] [hasło]
   Domyślne konto to `biuro.test` z `seed:scenariusze`. Wynik: `raport.json`
   i zrzuty PNG w podanym katalogu. Kod wyjścia 1, gdy są naruszenia. */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [wyjscie, login = "biuro.test", haslo = "wertis12345"] = process.argv.slice(2);
if (!wyjscie) {
  console.error("Użycie: node tools/audyt-dostepnosci.mjs <katalog-wyniku> [login] [hasło]");
  process.exit(2);
}
const KORZEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AXE = fs.readFileSync(path.join(KORZEN, "node_modules/axe-core/axe.min.js"), "utf8");
const BAZA = process.env.PANEL_URL ?? "http://127.0.0.1:5174";
const TRASY = [
  "/obsluga/", "/obsluga/zadania", "/obsluga/dostawy", "/obsluga/skrzynka", "/obsluga/zwroty",
  "/obsluga/zwroty/kosze", "/obsluga/reklamacje", "/obsluga/dyskusje", "/obsluga/stan",
  "/obsluga/dziennik", "/obsluga/analiza", "/obsluga/wiedza", "/obsluga/ustawienia",
];
const TAGI = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** axe w stronie; oddaje naruszenia w postaci do raportu. */
const zmierz = (strona) => strona.evaluate(`${AXE};axe.run(document,{runOnly:{type:"tag",values:${JSON.stringify(TAGI)}}})
  .then(r=>r.violations.map(v=>({id:v.id,waga:v.impact,opis:v.help,ile:v.nodes.length,
    elementy:v.nodes.slice(0,4).map(n=>n.target.join(" ")+" | "+(n.failureSummary||"").split("\\n").slice(1,3).join(" "))})))`);

/* Przeglądarkę wskazuje ta sama zmienna co `panel/playwright.config.ts`. */
const przegladarka = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const strona = await (await przegladarka.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
fs.mkdirSync(wyjscie, { recursive: true });

await strona.goto(`${BAZA}/obsluga/`);
await strona.waitForTimeout(1500);
await strona.screenshot({ path: path.join(wyjscie, "00-logowanie.png") });
const raport = { "logowanie": await zmierz(strona) };

await strona.locator("input").first().fill(login);
await strona.locator('input[type="password"]').fill(haslo);
await strona.keyboard.press("Enter");
await strona.waitForTimeout(2500);

for (const [i, trasa] of TRASY.entries()) {
  await strona.goto(`${BAZA}${trasa}`);
  await strona.waitForTimeout(2500);
  const nazwa = `${String(i + 1).padStart(2, "0")}${trasa.replace(/\//g, "_")}`;
  await strona.screenshot({ path: path.join(wyjscie, `${nazwa}.png`) });
  raport[trasa] = await zmierz(strona);
}

/* Klawiatura: dwanaście tabulatorów na ekranie startowym. Fokus bez obrysu
   i bez cienia to fokus, którego nie widać. */
await strona.goto(`${BAZA}/obsluga/`);
await strona.waitForTimeout(2000);
const tabulator = [];
for (let k = 0; k < 12; k++) {
  await strona.keyboard.press("Tab");
  tabulator.push(await strona.evaluate(() => {
    const e = document.activeElement;
    if (!e) return "brak fokusu";
    const s = getComputedStyle(e);
    const widac = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
    const nazwa = (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40);
    return `${e.tagName.toLowerCase()} «${nazwa}» — fokus ${widac ? "widać" : "NIE WIDAĆ"}`;
  }));
}
raport["__tabulator"] = tabulator;
fs.writeFileSync(path.join(wyjscie, "raport.json"), JSON.stringify(raport, null, 2));
await przegladarka.close();

let razem = 0;
for (const [trasa, naruszenia] of Object.entries(raport)) {
  if (trasa.startsWith("__")) continue;
  for (const n of naruszenia) {
    razem += n.ile;
    console.log(`${trasa}  ${n.id} (${n.waga}) ×${n.ile}: ${n.opis}`);
  }
}
const bezFokusu = tabulator.filter((t) => t.includes("NIE WIDAĆ")).length;
console.log(`Naruszeń: ${razem} na ${TRASY.length + 1} ekranach. Tabulator bez widocznego fokusu: ${bezFokusu}/12.`);
process.exit(razem || bezFokusu ? 1 : 0);
