import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/* ── Strażnik źródła: każde sięgnięcie do tabeli spraw wie, o który typ chodzi ─
   Tabela `reklamacja_klienta` trzyma też wiersze dawnych dyskusji (`DISPUTE`).
   Panel ich nie prowadzi, ale dane zostały nietknięte. Zapytanie bez warunku
   na `typ` pokazałoby taki wiersz jako reklamację — z odnośnikiem do ekranu,
   który go nie obsłuży, albo z werdyktem, którego Allegro nie przyjmie.

   Test czyta ŹRÓDŁO, bo przeciek da się dopisać w miejscu, którego żaden test
   zachowania nie odwiedza.

   ZWOLNIENIE ISTNIEJE I WYMAGA ZDANIA. Zapis stojący ZA bramką albo działający
   po kluczu z Allegro nie ma czego sprawdzać drugi raz. Znacznik `bez typu:`
   z powodem tuż nad zapytaniem działa tu tak samo jak `ergonomia:` w
   `tools/ergonomia_check.py` — zwolnienie bez uzasadnienia to brak zwolnienia. */

const KATALOG = path.resolve(import.meta.dirname, "..");

function zrodla(dir: string): string[] {
  return fs.readdirSync(path.join(KATALOG, dir))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(KATALOG, dir, f));
}

/** Komentarze zamienione na spacje tej samej długości: indeksy zostają, a słowa z komentarzy nie liczą się jako SQL. */
const bezKomentarzy = (z: string): string =>
  z.replace(/\/\*[\s\S]*?\*\//g, (k) => " ".repeat(k.length))
    .replace(/(^|\s)\/\/[^\n]*/g, (k) => " ".repeat(k.length));

/** Fragment zapytania za nazwą tabeli: do końca zdania SQL albo do nawiasu zamykającego podzapytanie. */
function ogonZapytania(tekst: string, od: number): string {
  let glebokosc = 0;
  for (let i = od; i < Math.min(tekst.length, od + 900); i++) {
    const c = tekst[i];
    if (c === "(") glebokosc++;
    else if (c === ")") { if (glebokosc === 0) return tekst.slice(od, i); glebokosc--; }
    else if (c === "`") return tekst.slice(od, i);
    else if (c === '"' && /^"\s*[,)]/.test(tekst.slice(i, i + 4))) return tekst.slice(od, i);
  }
  return tekst.slice(od, od + 900);
}

test("STRAŻNIK ŹRÓDŁA: zapytania do reklamacja_klienta mają warunek na typ albo zwolnienie z powodem", () => {
  let sprawdzonych = 0;
  const bez: string[] = [];
  for (const plik of [...zrodla("services"), ...zrodla("routes")]) {
    const surowy = fs.readFileSync(plik, "utf8");
    const czysty = bezKomentarzy(surowy);
    /* Zapytanie poznaje się po `FROM`/`UPDATE`/`INTO`/`JOIN` przed nazwą
       tabeli, w kodzie, nie w komentarzu. */
    for (const m of czysty.matchAll(/\b(?:FROM|UPDATE|INTO|JOIN)\s+reklamacja_klienta\b/g)) {
      sprawdzonych += 1;
      const ogon = ogonZapytania(czysty, m.index + m[0].length);
      if (/\btyp\s*(=|<>|IN\b)/i.test(ogon)) continue;
      /* Zwolnienie stoi TUŻ NAD zapytaniem — w komentarzu, w zasięgu wzroku
         czytającego, a nie gdzieś w pliku. */
      const nad = surowy.slice(Math.max(0, m.index - 600), m.index);
      if (!/bez typu:\s*\S+/.test(nad)) {
        bez.push(`${path.basename(plik)}: ${(m[0] + ogon).replace(/\s+/g, " ").slice(0, 110)}`);
      }
    }
  }
  assert.deepEqual(bez, [],
    "zapytanie bez warunku na typ i bez zwolnienia „bez typu:” z powodem tuż nad nim");
  assert.ok(sprawdzonych >= 40,
    `strażnik przestał cokolwiek znajdować (${sprawdzonych}) — pilnowałby pustki`);
});
