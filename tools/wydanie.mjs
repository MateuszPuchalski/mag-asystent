#!/usr/bin/env node
/* ── Numer wydania nadawany przy scaleniu ──────────────────────────────────
   Do tej pory numer wybierał autor PR-a, a każdy PR zmieniał te same cztery
   miejsca: dwa `package.json`, lockfile i szczyt `CHANGELOG.md`. Dwa otwarte
   PR-y konfliktowały więc ZAWSZE, a numery zderzały się mimo `co_w_toku.sh`.
   W dniu wprowadzenia tego pliku inna gałąź wzięła 0.492.0 dziesięć minut po
   tym, jak `main` już go miał.

   Teraz PR dokłada plik `zmiany/<nazwa>.md` z rodzajem zmiany i opisem, a numer
   nadaje `wydanie.yml` po scaleniu: podbija wersję, składa wpis w CHANGELOG-u,
   kasuje fragmenty i podmienia znacznik `@wydanie` na numer. Fragmenty mają
   różne nazwy plików, więc nie konfliktują ze sobą.

   Polecenia:
     node tools/wydanie.mjs plan               co by wyszło, bez zmian na dysku
     node tools/wydanie.mjs zastosuj [--json]  podbicie wersji, wpis, sprzątanie
     node tools/wydanie.mjs sprawdz <baza>     bramka PR-a (fragmenty, brak podbić)

   Bez zależności: biegnie w CI przed `npm ci`. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const KATALOG = "zmiany";
export const ZNACZNIK = "@wydanie";
const RODZAJE = ["patch", "minor"];

/* Pliki, które OPISUJĄ znacznik, a nie go używają — podmiana zrobiłaby
   z instrukcji numer wersji. */
export const BEZ_PODMIANY = new Set([
  "tools/wydanie.mjs", "tools/wydanie.test.mjs", "CLAUDE.md", "zmiany/README.md",
]);

/** Fragment: nagłówek `---` z polami `rodzaj` i `tytul`, potem treść wpisu. */
export function czytajFragment(tekst, nazwa) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(tekst);
  if (!m) throw new Error(`${nazwa}: brak nagłówka --- z polami rodzaj i tytul.`);
  const pola = {};
  for (const linia of m[1].split(/\r?\n/)) {
    const p = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/.exec(linia);
    if (p) pola[p[1]] = p[2].replace(/\s+#.*$/, "");
  }
  if (!RODZAJE.includes(pola.rodzaj)) {
    throw new Error(`${nazwa}: rodzaj ma być patch albo minor, jest „${pola.rodzaj ?? ""}".`);
  }
  if (!pola.tytul) throw new Error(`${nazwa}: pusty tytul — z niego powstaje tytuł commita wydania.`);
  const tresc = m[2].trim();
  if (!tresc) throw new Error(`${nazwa}: pusta treść — z niej powstaje wpis w CHANGELOG.md.`);
  return { nazwa, rodzaj: pola.rodzaj, tytul: pola.tytul, tresc, wymagaDzialania: /\[wymaga działania/.test(tresc) };
}

/** MINOR zeruje PATCH; MAJOR zostaje decyzją właściciela (preambuła CHANGELOG-u). */
export function nastepnaWersja(wersja, rodzaj) {
  const [a, b, c] = wersja.split(".").map(Number);
  return rodzaj === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

const MIESIACE = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca",
  "sierpnia", "września", "października", "listopada", "grudnia"];

/** Data jak w dotychczasowych wpisach, w czasie firmy — nie runnera. */
export function dataPl(d = new Date()) {
  const cz = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${Number(cz.day)} ${MIESIACE[Number(cz.month) - 1]} ${cz.year}`;
}

/** Nowy wpis ląduje nad pierwszym `## ` — preambuła zostaje na górze. */
export function wstawDoChangelogu(changelog, wersja, data, tresc) {
  const i = changelog.search(/^## /m);
  if (i < 0) throw new Error("CHANGELOG.md nie ma żadnego wpisu `## ` — nie wiem, gdzie wstawić.");
  return `${changelog.slice(0, i)}## ${wersja} — ${data}\n\n${tresc.trim()}\n\n${changelog.slice(i)}`;
}

/** Tytuł commita: jeden fragment mówi sam; kilka — po średniku. */
export function tytulWydania(fragmenty) {
  return fragmenty.map((f) => f.tytul).join("; ");
}

export function planuj(wersja, fragmenty) {
  if (!fragmenty.length) return null;
  const rodzaj = fragmenty.some((f) => f.rodzaj === "minor") ? "minor" : "patch";
  const posortowane = [...fragmenty].sort((x, y) => x.nazwa.localeCompare(y.nazwa));
  return {
    z: wersja,
    wersja: nastepnaWersja(wersja, rodzaj),
    rodzaj,
    tytul: tytulWydania(posortowane),
    tresc: posortowane.map((f) => f.tresc).join("\n\n"),
    fragmenty: posortowane.map((f) => f.nazwa),
    wymagaDzialania: posortowane.some((f) => f.wymagaDzialania),
  };
}

export const podmienZnacznik = (tekst, wersja) => tekst.split(ZNACZNIK).join(wersja);

/* ── Dysk ─────────────────────────────────────────────────────────────── */

function czytajFragmenty(korzen) {
  const kat = path.join(korzen, KATALOG);
  if (!fs.existsSync(kat)) return [];
  return fs.readdirSync(kat).filter((n) => n.endsWith(".md") && n !== "README.md").sort()
    .map((n) => czytajFragment(fs.readFileSync(path.join(kat, n), "utf8"), `${KATALOG}/${n}`));
}

const wersjaZ = (korzen) => JSON.parse(fs.readFileSync(path.join(korzen, "package.json"), "utf8")).version;

/* JSON przez parse i stringify: wszystkie trzy pliki robią pełną drogę
   bajt w bajt (sprawdzone przy wprowadzeniu), więc diff to jedna linia. */
function ustawWersjeJson(plik, zmien) {
  const obj = JSON.parse(fs.readFileSync(plik, "utf8"));
  zmien(obj);
  fs.writeFileSync(plik, `${JSON.stringify(obj, null, 2)}\n`);
}

export function zastosuj(korzen, data = dataPl()) {
  const plan = planuj(wersjaZ(korzen), czytajFragmenty(korzen));
  if (!plan) return null;
  const w = plan.wersja;
  ustawWersjeJson(path.join(korzen, "package.json"), (o) => { o.version = w; });
  ustawWersjeJson(path.join(korzen, "server/package.json"), (o) => { o.version = w; });
  ustawWersjeJson(path.join(korzen, "package-lock.json"), (o) => {
    o.version = w;
    if (o.packages?.[""]) o.packages[""].version = w;
    if (o.packages?.server) o.packages.server.version = w;
  });
  const cl = path.join(korzen, "CHANGELOG.md");
  fs.writeFileSync(cl, wstawDoChangelogu(fs.readFileSync(cl, "utf8"), w, data, podmienZnacznik(plan.tresc, w)));
  for (const n of plan.fragmenty) fs.rmSync(path.join(korzen, n));

  let zeZnacznikiem = [];
  try {
    zeZnacznikiem = execFileSync("git", ["grep", "-l", "-F", ZNACZNIK], { cwd: korzen, encoding: "utf8" })
      .split("\n").filter(Boolean);
  } catch { /* git grep kończy się kodem 1, gdy nic nie znalazł */ }
  const podmienione = [];
  for (const p of zeZnacznikiem) {
    if (BEZ_PODMIANY.has(p) || !fs.existsSync(path.join(korzen, p))) continue;
    const f = path.join(korzen, p);
    fs.writeFileSync(f, podmienZnacznik(fs.readFileSync(f, "utf8"), w));
    podmienione.push(p);
  }
  return { ...plan, podmienione };
}

/**
 * Bramka PR-a. Fragmenty muszą się dać przeczytać, a PR nie może sam podbić
 * wersji ani dopisać wpisu `## ` — inaczej wydanie powstałoby dwa razy.
 */
export function sprawdz(korzen, baza) {
  const bledy = [];
  try { czytajFragmenty(korzen); } catch (e) { bledy.push(e.message); }
  const diff = (plik) => {
    try {
      return execFileSync("git", ["diff", `${baza}...HEAD`, "--", plik], { cwd: korzen, encoding: "utf8" });
    } catch { return ""; }
  };
  for (const p of ["package.json", "server/package.json"]) {
    if (/^\+\s*"version"\s*:/m.test(diff(p))) {
      bledy.push(`${p}: PR zmienia wersję. Numer nadaje wydanie.yml po scaleniu — opisz zmianę w ${KATALOG}/<nazwa>.md.`);
    }
  }
  if (/^\+## /m.test(diff("CHANGELOG.md"))) {
    bledy.push(`CHANGELOG.md: PR dopisuje wpis wydania. Treść idzie do ${KATALOG}/<nazwa>.md, wpis składa wydanie.yml.`);
  }
  return bledy;
}

/* ── Wiersz poleceń ───────────────────────────────────────────────────── */

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const korzen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [polecenie, arg] = process.argv.slice(2);
  try {
    if (polecenie === "plan") {
      console.log(JSON.stringify(planuj(wersjaZ(korzen), czytajFragmenty(korzen)), null, 2));
    } else if (polecenie === "zastosuj") {
      const w = zastosuj(korzen);
      /* `--json` dla workflowu: wersja i tytuł bez wycinania ich z tekstu. */
      if (arg === "--json") { console.log(JSON.stringify(w)); process.exit(0); }
      if (!w) { console.log("Brak fragmentów w zmiany/ — nie ma czego wydawać."); process.exit(0); }
      console.log(`Wydanie ${w.wersja} (${w.rodzaj}) z ${w.fragmenty.join(", ")}`);
      if (w.podmienione.length) console.log(`Znacznik ${ZNACZNIK} → ${w.wersja}: ${w.podmienione.join(", ")}`);
    } else if (polecenie === "sprawdz") {
      const bledy = sprawdz(korzen, arg ?? "origin/main");
      for (const b of bledy) console.error(`BŁĄD  ${b}`);
      if (bledy.length) process.exit(1);
      console.log("Fragmenty zmian w porządku, wersja nietknięta.");
    } else {
      console.error("Użycie: node tools/wydanie.mjs plan | zastosuj [--json] | sprawdz [baza]");
      process.exit(2);
    }
  } catch (e) {
    console.error(`BŁĄD  ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
