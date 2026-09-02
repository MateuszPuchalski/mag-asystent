import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-naglowki-")), "t.db");
process.env.LOG_LEVEL = "silent";

/* ── Co NAPRAWDĘ wysyłamy do Allegro (0.173.0) ───────────────────────────────
   PIERWSZY TEST TEJ FUNKCJI Z PODSTAWIONYM `fetch`. Dotąd sprawdzaliśmy
   budowę adresów i obsługę błędów, ale nigdy nagłówków — a to w nich siedział
   błąd: ciało szło jako `application/json`, czyli typ, którego specyfikacja
   nie wymienia przy ŻADNYM z naszych dwóch zapisów. Odpowiedzią na
   niezadeklarowany typ treści jest 415, czyli cicha odmowa wysyłki.        */

let zapytajAllegro: typeof import("./allegro.http.js").zapytajAllegro;
let db: typeof import("../db/db.js").db;

const PUBLIC = "application/vnd.allegro.public.v1+json";
const BETA = "application/vnd.allegro.beta.v1+json";

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ zapytajAllegro } = await import("./allegro.http.js"));
  /* Token w bazie, żeby `wazneBearer` nie poszedł po sieć po odświeżenie.
     Środowisko `prod`, bo tak liczy je konfiguracja bez ALLEGRO_SANDBOX. */
  db().prepare(`INSERT INTO allegro_token(id,access_token,refresh_token,wygasa_at,srodowisko,
    polaczono_at,polaczono_przez) VALUES (1,'tok','ref',?, 'prod','2026-09-01T00:00:00Z','test')`)
    .run(new Date(Date.now() + 86_400_000).toISOString());
});

after(() => mock.restoreAll());

/** Podstawiony `fetch`: zbiera żądania i oddaje kolejne przygotowane odpowiedzi. */
function podstaw(odpowiedzi: Array<{ status: number; body?: unknown }>) {
  const zebrane: Array<{ url: string; headers: Record<string, string>; body: string | null }> = [];
  let i = 0;
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    zebrane.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? init.body : null,
    });
    const o = odpowiedzi[Math.min(i++, odpowiedzi.length - 1)];
    return new Response(JSON.stringify(o.body ?? {}), {
      status: o.status, headers: { "content-type": PUBLIC },
    });
  });
  return zebrane;
}

test("ZAPIS deklaruje wersję zasobu, nie gołe application/json", async () => {
  const zebrane = podstaw([{ status: 200, body: { id: "m-1" } }]);
  await zapytajAllegro("https://api.test/messaging/threads/w-1/messages", {
    metoda: "POST", body: { text: "Dzień dobry" },
  });

  assert.equal(zebrane.length, 1);
  assert.equal(zebrane[0].headers["content-type"], PUBLIC,
    "specyfikacja nie wymienia application/json przy żadnym z naszych zapisów");
  assert.equal(zebrane[0].headers.accept, PUBLIC, "obie deklaracje mają mówić o tej samej wersji");
  assert.equal(zebrane[0].body, JSON.stringify({ text: "Dzień dobry" }));
});

test("415 przy zapisie prowadzi do NASTĘPNEJ wersji, nie do błędu na ekranie", async () => {
  /* 406 mówi „zła wersja w accept", 415 — „zła w content-type". Jedno i drugie
     znaczy to samo: spróbuj innej. Do 0.172.0 415 kończyło wysyłkę surowym
     błędem, bo pętla negocjacji znała wyłącznie 406. */
  const zebrane = podstaw([{ status: 415 }, { status: 200, body: { id: "m-2" } }]);
  const odp = await zapytajAllegro("https://api.test/sale/nieznana-rodzina/rzecz", {
    metoda: "POST", body: { a: 1 },
  });

  assert.equal(zebrane.length, 2, "po 415 ma pójść druga próba");
  assert.equal(zebrane[0].headers["content-type"], PUBLIC);
  assert.equal(zebrane[1].headers["content-type"], BETA);
  assert.deepEqual(odp, { id: "m-2" });
});

test("ODCZYT nie deklaruje typu treści — pusty content-type bywa powodem odmowy", async () => {
  const zebrane = podstaw([{ status: 200, body: { threads: [] } }]);
  await zapytajAllegro("https://api.test/messaging/threads?limit=20&offset=0");
  assert.equal(zebrane[0].headers["content-type"], undefined);
  assert.equal(zebrane[0].headers.accept, PUBLIC);
});
