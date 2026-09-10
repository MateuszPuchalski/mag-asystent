import { after, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zalacznik-")), "t.db");
process.env.LOG_LEVEL = "silent";

/* ── Pobranie załącznika Centrum Wiadomości z podstawionym `fetch` ───────────
   Pilnujemy KOLEJNOŚCI prób i tego, co idzie w nagłówkach: droga API BEZ
   `Accept` (swagger: `downloadAttachmentGET` oddaje plik dowolnego typu; JSON w `Accept`
   dawał na żywo 406), zapisany adres też bez niego; 401 kończy od razu (token
   jest jeden); odmowa każdej drogi wraca jednym zdaniem z kodami, bez adresów
   i bez UUID — zdanie idzie na ekran agenta.                                 */

let pobierzZalacznikWiadomosci: typeof import("./allegro.http.js").pobierzZalacznikWiadomosci;
let sondujZalacznik: typeof import("./allegro.http.js").sondujZalacznik;
let BladOdpowiedziAllegro: typeof import("./allegro.js").BladOdpowiedziAllegro;
let db: typeof import("../db/db.js").db;

const API = "https://api.allegro.pl";
const URL_ZAL = "https://upload.allegro.pl/message-center/message-attachments/97dc0b60-2da4-4247-92ba-b748630ba0f6";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ pobierzZalacznikWiadomosci, sondujZalacznik } = await import("./allegro.http.js"));
  ({ BladOdpowiedziAllegro } = await import("./allegro.js"));
  db().prepare(`INSERT INTO allegro_token(id,access_token,refresh_token,wygasa_at,srodowisko,
    polaczono_at,polaczono_przez) VALUES (1,'tok','ref',?, 'prod','2026-09-01T00:00:00Z','test')`)
    .run(new Date(Date.now() + 86_400_000).toISOString());
});
beforeEach(() => mock.restoreAll());
after(() => mock.restoreAll());

/** Podstawiony `fetch`: odpowiedź zależy od ADRESU i nagłówka `accept`. */
function podstaw(regula: (url: string, accept: string | undefined) => { status: number; typ?: string }) {
  const zebrane: Array<{ url: string; accept?: string; auth?: string }> = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    zebrane.push({ url: String(url), accept: h.accept, auth: h.authorization });
    const o = regula(String(url), h.accept);
    return new Response(o.status === 200 ? PNG : JSON.stringify({ error: "nie" }), {
      status: o.status, headers: { "content-type": o.typ ?? (o.status === 200 ? "image/png" : "application/json") },
    });
  });
  return zebrane;
}

test("droga API działa: jedna próba, BEZ Accept, Bearer, bajty wracają z drogą 'api'", async () => {
  const zebrane = podstaw(() => ({ status: 200 }));
  const w = await pobierzZalacznikWiadomosci(API, URL_ZAL);
  assert.equal(w.droga, "api");
  assert.equal(w.bajty.byteLength, PNG.byteLength);
  assert.equal(zebrane.length, 1);
  assert.equal(zebrane[0]!.url, `${API}/messaging/message-attachments/97dc0b60-2da4-4247-92ba-b748630ba0f6`);
  /* Bez `Accept`: końcówka oddaje plik dowolnego typu, a JSON w nagłówku dawał 406. */
  assert.equal(zebrane[0]!.accept, undefined);
  assert.equal(zebrane[0]!.auth, "Bearer tok");
});

test("API odmawia 403 → zapisany adres BEZ Accept oddaje plik (droga 'url')", async () => {
  const zebrane = podstaw((url) => ({ status: url.startsWith(API) ? 403 : 200 }));
  const w = await pobierzZalacznikWiadomosci(API, URL_ZAL);
  assert.equal(w.droga, "url");
  assert.deepEqual(zebrane.map((z) => [z.url.startsWith(API) ? "api" : "url", z.accept ?? null]), [
    ["api", null],
    ["url", null],
  ], "dwie próby, obie bez wersji zasobu");
});

test("406 z API (gdyby wrócił) też przepuszcza do zapasu", async () => {
  const zebrane = podstaw((url) => ({ status: url.startsWith(API) ? 406 : 200 }));
  const w = await pobierzZalacznikWiadomosci(API, URL_ZAL);
  assert.equal(w.droga, "url");
  assert.equal(zebrane.length, 2);
});

test("401 kończy od razu — token jest jeden dla wszystkich dróg", async () => {
  const zebrane = podstaw(() => ({ status: 401 }));
  await assert.rejects(() => pobierzZalacznikWiadomosci(API, URL_ZAL),
    (e: unknown) => e instanceof BladOdpowiedziAllegro && e.status === 401);
  assert.equal(zebrane.length, 1);
});

test("wszystkie drogi 403: jedno zdanie z kodem każdej próby, bez adresów i bez UUID", async () => {
  podstaw(() => ({ status: 403 }));
  await assert.rejects(() => pobierzZalacznikWiadomosci(API, URL_ZAL), (e: unknown) => {
    assert.ok(e instanceof BladOdpowiedziAllegro);
    assert.equal(e.status, 403);
    assert.match(e.message, /końcówka API: 403/);
    assert.match(e.message, /zapisany adres: 403/);
    assert.match(e.message, /allegro:api:messaging/);
    assert.equal(/https?:\/\//.test(e.message), false, "adresy nie idą na ekran");
    assert.equal(/97dc0b60/.test(e.message), false, "identyfikator nie idzie na ekran");
    return true;
  });
});

test("adres bez ogona UUID (reklamacje) idzie jedną drogą, jak dotąd", async () => {
  const zebrane = podstaw(() => ({ status: 200 }));
  const w = await pobierzZalacznikWiadomosci(API, "https://api.allegro.pl/sale/issues/attachments/a-1");
  assert.equal(w.droga, "url");
  assert.equal(zebrane.length, 1);
  assert.equal(zebrane[0]!.accept, undefined);
});

test("sonda oddaje kody i typy każdej próby, nigdy bajtów", async () => {
  /* Jak u właściciela 10 września: bez Accept 200, z Accept 406, zapisany adres 403. */
  podstaw((url, accept) => ({ status: accept ? 406 : url.startsWith(API) ? 200 : 403 }));
  const w = await sondujZalacznik(API, URL_ZAL);
  assert.equal(w.length, 4, "dwie próby z listy plus dwie kontrolne z Accept");
  assert.deepEqual(w.map((x) => [x.droga, x.akcept === null ? null : x.akcept.replace("application/vnd.allegro.", ""), x.status]), [
    ["api", null, 200], ["url", null, 403],
    ["api", "public.v1+json", 406], ["url", "public.v1+json", 406],
  ]);
  assert.equal(w[0]!.typ, "image/png");
  assert.equal(w[0]!.bajtow, PNG.byteLength);
  assert.equal(w[1]!.bajtow, null);
  assert.equal(w[0]!.hostKoncowy, "api.allegro.pl");
  assert.equal(JSON.stringify(w).includes("97dc0b60"), false, "UUID nie wychodzi z sondy");
});
