import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/* ── Bramka TLO_URL zostaje ──────────────────────────────────────────────────
   0.88.5 prostuje odwrotne ukośniki, ale NIE otwiera furtki na byle co: adres
   bez schematu nadal zatrzymuje start. Tam nie ma czego prostować, więc ciche
   przyjęcie takiej wartości znaczyłoby usługę tła wołaną pod adresem, którego
   nie da się otworzyć — i nikt by się o tym nie dowiedział.

   Odmowa jest zdarzeniem PRZY IMPORCIE modułu, a import zdarza się raz na
   proces. Sprawdzamy ją więc w OSOBNYM procesie; w tym samym `config.ts` jest
   już wczytany z inną wartością (patrz `tlo-url.test.ts`).                    */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-tlobramka-"));
const config = fileURLToPath(new URL("./config.ts", import.meta.url));

/** Startuje `config.ts` w osobnym procesie; zwraca `null`, gdy przeszedł. */
function odmowa(tloUrl: string): string | null {
  try {
    execFileSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(config)})`], {
      env: {
        ...process.env,
        DB_PATH: path.join(katalog, "t.db"),
        LOG_LEVEL: "silent",
        TLO_URL: tloUrl,
      },
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });
    return null;
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? "");
  }
}

test("adres bez schematu NADAL zatrzymuje start", () => {
  const blad = odmowa("127.0.0.1:8791");
  assert.ok(blad, "brak schematu ma być odmową, nie cichym przyjęciem");
  assert.match(blad, /TLO_URL/);
  assert.match(blad, /ma być adresem http/);
});

test("wyprostowany adres przechodzi", () => {
  assert.equal(odmowa("http:\\\\127.0.0.1:8791"), null);
});

test("poprawny adres przechodzi", () => {
  assert.equal(odmowa("http://127.0.0.1:8791"), null);
});

test("puste TLO_URL przechodzi — funkcja jest wyłączona", () => {
  assert.equal(odmowa(""), null);
});
