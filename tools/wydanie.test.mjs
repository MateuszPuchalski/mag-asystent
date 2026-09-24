import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  czytajFragment, dataPl, nastepnaWersja, planuj, podmienZnacznik, sprawdz, wstawDoChangelogu, zastosuj,
} from "./wydanie.mjs";

/* Numer wydania nadawany przy scaleniu. Najważniejsze gwarancje:
   - zły fragment zatrzymuje PR, zanim trafi na `main` (bot nie ma kogo spytać);
   - wydanie z kilku fragmentów bierze najwyższy rodzaj i jeden numer;
   - PR, który sam podbija wersję albo dopisuje `## `, nie przechodzi;
   - pliki opisujące znacznik zostają nietknięte. */

const FRAG = (rodzaj, tytul, tresc) => `---\nrodzaj: ${rodzaj}\ntytul: ${tytul}\n---\n\n${tresc}\n`;
const ZN = "@" + "wydanie";

test("fragment: pola i treść, komentarz po wartości ignorowany", () => {
  const f = czytajFragment(FRAG("minor   # albo patch", "Aktualizacja w nocy", "**Nowość.** Serwer sam.\n\n**[wymaga działania]** Klucz."), "zmiany/a.md");
  assert.deepEqual([f.rodzaj, f.tytul, f.wymagaDzialania], ["minor", "Aktualizacja w nocy", true]);
  assert.match(f.tresc, /^\*\*Nowość\.\*\*/);
});

test("zły fragment mówi, co poprawić", () => {
  assert.throws(() => czytajFragment("bez nagłówka", "zmiany/x.md"), /zmiany\/x\.md: brak nagłówka/);
  assert.throws(() => czytajFragment(FRAG("major", "t", "x"), "zmiany/x.md"), /patch albo minor/);
  assert.throws(() => czytajFragment(FRAG("patch", "", "x"), "zmiany/x.md"), /pusty tytul/);
  assert.throws(() => czytajFragment(FRAG("patch", "t", "   "), "zmiany/x.md"), /pusta treść/);
});

test("numer: minor zeruje patch, patch rośnie o jeden, liczbowo", () => {
  assert.equal(nastepnaWersja("0.492.0", "minor"), "0.493.0");
  assert.equal(nastepnaWersja("0.492.7", "minor"), "0.493.0");
  assert.equal(nastepnaWersja("0.492.9", "patch"), "0.492.10");
});

test("kilka fragmentów: najwyższy rodzaj, jeden numer, treść po nazwie pliku", () => {
  const p = planuj("0.492.0", [
    czytajFragment(FRAG("patch", "B", "druga"), "zmiany/b.md"),
    czytajFragment(FRAG("minor", "A", "pierwsza"), "zmiany/a.md"),
  ]);
  assert.deepEqual([p.wersja, p.rodzaj, p.tytul, p.tresc], ["0.493.0", "minor", "A; B", "pierwsza\n\ndruga"]);
  assert.equal(planuj("0.492.0", []), null);
});

test("data po polsku w czasie firmy, nie runnera", () => {
  /* 23:30 UTC 24 września to już 25 września w Warszawie. */
  assert.equal(dataPl(new Date("2026-09-24T23:30:00Z")), "25 września 2026");
  assert.equal(dataPl(new Date("2026-01-05T12:00:00Z")), "5 stycznia 2026");
});

test("wpis ląduje nad pierwszym wydaniem, preambuła zostaje", () => {
  const cl = "# Historia\n\nPreambuła.\n\n---\n\n\n## 0.492.0 — 24 września 2026\n\nStare.\n";
  const nowy = wstawDoChangelogu(cl, "0.493.0", "25 września 2026", "Nowe.");
  assert.equal(nowy, "# Historia\n\nPreambuła.\n\n---\n\n\n## 0.493.0 — 25 września 2026\n\nNowe.\n\n## 0.492.0 — 24 września 2026\n\nStare.\n");
});

test("znacznik zamienia się na numer", () => {
  assert.equal(podmienZnacznik(`/* Aktualizacja w nocy (${ZN}). ${ZN} */`, "0.493.0"), "/* Aktualizacja w nocy (0.493.0). 0.493.0 */");
});

/* ── Na prawdziwym repo w katalogu tymczasowym ────────────────────────── */

function repo() {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wydanie-"));
  const git = (...a) => execFileSync("git", a, { cwd: k, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  const pisz = (p, t) => { fs.mkdirSync(path.dirname(path.join(k, p)), { recursive: true }); fs.writeFileSync(path.join(k, p), t); };
  const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
  pisz("package.json", json({ name: "wertis-kolektor", version: "0.492.0", workspaces: ["server"] }));
  pisz("server/package.json", json({ name: "@wertis/server", version: "0.492.0" }));
  pisz("package-lock.json", json({ name: "wertis-kolektor", version: "0.492.0", lockfileVersion: 3,
    packages: { "": { name: "wertis-kolektor", version: "0.492.0" }, server: { name: "@wertis/server", version: "0.492.0" },
      "node_modules/x": { version: "1.0.0" } } }));
  pisz("CHANGELOG.md", "# Historia\n\n---\n\n\n## 0.492.0 — 24 września 2026\n\nStare.\n");
  pisz("zmiany/README.md", `Jak pisać fragment; znacznik ${ZN} zostaje w tym pliku.\n`);
  pisz("CLAUDE.md", `Znacznik ${ZN} opisany.\n`);
  pisz("server/src/a.ts", `// Aktualizacja w nocy (${ZN}).\n`);
  git("add", "-A"); git("commit", "-qm", "baza");
  return { k, git, pisz };
}

test("zastosuj: wersja w trzech plikach, wpis, fragmenty znikają, znacznik podmieniony", () => {
  const { k, git, pisz } = repo();
  pisz("zmiany/noc.md", FRAG("minor", "Aktualizacja w nocy", `Opis (${ZN}).`));
  git("add", "-A");
  const w = zastosuj(k, "25 września 2026");
  assert.equal(w.wersja, "0.493.0");
  const j = (p) => JSON.parse(fs.readFileSync(path.join(k, p), "utf8"));
  assert.equal(j("package.json").version, "0.493.0");
  assert.equal(j("server/package.json").version, "0.493.0");
  const lock = j("package-lock.json");
  assert.deepEqual([lock.version, lock.packages[""].version, lock.packages.server.version, lock.packages["node_modules/x"].version],
    ["0.493.0", "0.493.0", "0.493.0", "1.0.0"]);
  assert.match(fs.readFileSync(path.join(k, "CHANGELOG.md"), "utf8"), /## 0\.493\.0 — 25 września 2026\n\nOpis \(0\.493\.0\)\.\n\n## 0\.492\.0/);
  assert.ok(!fs.existsSync(path.join(k, "zmiany/noc.md")));
  assert.ok(fs.existsSync(path.join(k, "zmiany/README.md")), "README fragmentów zniknął");
  assert.equal(fs.readFileSync(path.join(k, "server/src/a.ts"), "utf8"), "// Aktualizacja w nocy (0.493.0).\n");
  assert.ok(fs.readFileSync(path.join(k, "CLAUDE.md"), "utf8").includes(ZN), "opis znacznika podmieniony");
  assert.ok(fs.readFileSync(path.join(k, "zmiany/README.md"), "utf8").includes(ZN));
  assert.deepEqual(w.podmienione, ["server/src/a.ts"]);
});

test("zastosuj bez fragmentów niczego nie rusza", () => {
  const { k, git } = repo();
  assert.equal(zastosuj(k), null);
  assert.equal(git("status", "--porcelain"), "");
});

test("bramka PR-a: fragment przechodzi, ręczne podbicie i wpis ## nie", () => {
  const { k, git, pisz } = repo();
  git("checkout", "-qb", "pr");
  pisz("zmiany/noc.md", FRAG("patch", "t", "x"));
  git("add", "-A"); git("commit", "-qm", "fragment");
  assert.deepEqual(sprawdz(k, "main"), []);

  pisz("package.json", fs.readFileSync(path.join(k, "package.json"), "utf8").replace("0.492.0", "0.493.0"));
  pisz("CHANGELOG.md", fs.readFileSync(path.join(k, "CHANGELOG.md"), "utf8").replace("## 0.492.0", "## 0.493.0 — x\n\ny\n\n## 0.492.0"));
  git("add", "-A"); git("commit", "-qm", "po staremu");
  const b = sprawdz(k, "main");
  assert.equal(b.length, 2, b.join("\n"));
  assert.match(b.join("\n"), /package\.json: PR zmienia wersję/);
  assert.match(b.join("\n"), /CHANGELOG\.md: PR dopisuje wpis/);
});

test("bramka PR-a: gałąź w tyle za podbitym main nie jest ręcznym podbiciem", () => {
  const { k, git, pisz } = repo();
  git("checkout", "-qb", "pr");
  pisz("zmiany/noc.md", FRAG("patch", "t", "x"));
  git("add", "-A"); git("commit", "-qm", "fragment");
  git("checkout", "-q", "main");
  pisz("package.json", fs.readFileSync(path.join(k, "package.json"), "utf8").replace("0.492.0", "0.492.1"));
  git("add", "-A"); git("commit", "-qm", "0.492.1 — bot");
  git("checkout", "-q", "pr");
  /* `baza...HEAD` liczy od wspólnego przodka, więc cudze podbicie nie wchodzi. */
  assert.deepEqual(sprawdz(k, "main"), []);
});

test("bramka PR-a: zły fragment zatrzymuje", () => {
  const { k, git, pisz } = repo();
  git("checkout", "-qb", "pr");
  pisz("zmiany/zly.md", "bez nagłówka\n");
  git("add", "-A"); git("commit", "-qm", "zły");
  assert.match(sprawdz(k, "main").join("\n"), /zmiany\/zly\.md: brak nagłówka/);
});
