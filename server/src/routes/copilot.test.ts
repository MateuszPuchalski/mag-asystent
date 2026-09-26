import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-copilot-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";
/* Copilot zostaje WYŁĄCZONY na cały ten plik i to jest celowe: dzięki temu
   żaden test nie ma jak wyjść do Anthropic, a bramka „wyłączony" jest
   sprawdzana na tej samej ścieżce, którą pójdzie produkcja. Ścieżkę szczęśliwą
   pokrywają testy serwisu, ze wstrzykniętym nadawcą. */
delete process.env.COPILOT_MODE;

/* ── Trasy Copilota (etap F) — trzy umowy ───────────────────────────────────
   1. Bramka roli na KAŻDEJ trasie, także na odczycie; 401 przed 403.
   2. Otwarcie ekranu niczego nie zapisuje, a tras zapisu jest SIEDEM.
   3. Wyłączony Copilot odmawia zdaniem, nie wywrotką — i nie wychodzi do sieci.
*/

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let rozmowa = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["decyzja_klasyfikacji", "szkic_copilota", "copilot_wywolanie", "message", "conversation",
    "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("INSERT OR IGNORE INTO channel_account(id,channel,external_account_id) VALUES (1,'allegro','k')").run();
  rozmowa = Number(d.prepare(`INSERT INTO conversation
    (channel_account_id,external_conversation_id,subject) VALUES (1,'w-1','zielony_ogrod')`)
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,'m-1','incoming','Czy nóż pasuje do NAC LS 46-450?','2026-09-03T08:00:00Z')`)
    .run(rozmowa);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token } };
}

const liczba = (tabela: string) => (db().prepare(`SELECT count(*) n FROM ${tabela}`).get() as { n: number }).n;

const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/copilot" },
  { method: "GET" as const, url: "/api/obsluga/copilot/pomiar" },
  { method: "POST" as const, url: "/api/obsluga/copilot/klasyfikacja",
    payload: { rozmowyId: [rozmowa] } },
  { method: "POST" as const, url: `/api/obsluga/copilot/klasyfikacja/${rozmowa}/korekta`,
    payload: { kategoria: "OTHER" } },
  { method: "POST" as const, url: "/api/obsluga/copilot/szkic", payload: { rozmowaId: rozmowa } },
  { method: "POST" as const, url: `/api/obsluga/copilot/szkic/${rozmowa}/ocena`,
    payload: { ocena: "wstawiony" } },
  { method: "POST" as const, url: `/api/obsluga/copilot/szkic/${rozmowa}/dane`,
    payload: { ocena: "odrzucone" } },
  { method: "POST" as const, url: `/api/obsluga/copilot/szkic/${rozmowa}/pasowanie`,
    payload: { ocena: "odrzucone" } },
  { method: "POST" as const, url: "/api/obsluga/copilot/pytania/1/pasowania/0" },
];

test("bez sesji żadna trasa Copilota nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.payload });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi Copilota — bramka stoi też na odczycie", async () => {
  const m = login("magazynier", "Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: m.naglowki, payload: t.payload });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
    assert.match(r.json<{ error: string }>().error, /biuro/);
  }
});

/* ── Umowa: CZTERY trasy zapisu ─────────────────────────────────────────────
   Licznik jest umową, jak przy zwrotach. Każdy nowy zapis podnosi liczbę
   i dostaje zdanie uzasadnienia.

   PIERWSZA to partia klasyfikacji — pierwsze miejsce, z którego treść rozmowy
   wychodzi poza firmę, i dlatego pierwsze, przed którym stoi warstwa maskowania.

   DRUGA to etykieta człowieka — potwierdzenie albo poprawka kategorii (do
   22 września 2026 werdykt „trafna/nietrafna", na tym samym miejscu umowy).
   Wygląda na drobiazg, a jest warunkiem pomiaru: bez niej da się policzyć,
   ILE Copilot kosztuje, ale nie da się policzyć, CZY jest dobry. Poprawka
   mówi dodatkowo, JAK powinno być, więc liczy się z niej także czułość.

   TRZECIA to szkic odpowiedzi z faktów (0.231.0) — drugie miejsce, z którego
   treść wychodzi, tym razem cały wątek za tym samym maskowaniem. Osobna trasa,
   bo to inne ZADANIE księgi i inna odpowiedź; trasa partii przyjmuje listę
   rozmów do etykiety, nie rozmowę do napisania.

   CZWARTA to werdykt agenta o szkicu: wstawił, zastąpił, odrzucił. Ten sam
   argument co przy drugiej — bez niej „szkic z AI" byłby kosztem bez miary.

   PIĄTA to los danych doboru rozpoznanych w rozmowie (przyrost trzeci):
   jedno kliknięcie agenta wpisuje je w PUSTE pola doboru albo odsyła.
   Osobna od `PUT dobor/dane`, bo serwis sam pilnuje „tylko puste pola"
   i liczy los propozycji — przez zwykły PUT każda wyglądałaby w dzienniku
   jak ręczny wpis agenta. Automat sam nie wpisuje nigdy.

   SZÓSTA to los pasowania rozpoznanego w rozmowie (przyrost czwarty):
   jedno kliknięcie agenta kładzie parę w kolejce wiedzy jako propozycję ze
   źródłem `copilot` albo ją odsyła. Osobna od `POST wiedza/pasowania`, bo
   tamta wywodzi źródło z kontekstu i nie zna wiersza szkicu; para, rola
   i dowód idą z wiersza SPRAWDZONEGO przez serwer, nie z ciała żądania.
   Rozstrzyga biuro, jak przy każdej propozycji. */
/* SIÓDMA (0.332.0) to dopytanie. Licznik podniósł się o jeden świadomie:
   trasa produkuje tekst DLA AGENTA i celowo nie ma sit szkicu, więc wspólna
   trasa z tamtą musiałaby wybrać jedno zachowanie dla dwóch różnych rzeczy. */
/* ÓSMA (0.528.0) to „Zapisz jako propozycję” przy pasowaniu z sieci
   znalezionym w dopytaniu. Para leży przy wymianie i przeszła sito strony;
   trasa bierze ją z wiersza, nie z ciała żądania — jak szósta ze szkicu. */
test("Copilot ma OSIEM tras zapisu", async () => {
  const zrodlo = fs.readFileSync(new URL("./copilot.ts", import.meta.url), "utf8");
  const posty = zrodlo.match(/app\.post[<(]/g) ?? [];
  assert.equal(posty.length, 8, `tras POST jest ${posty.length}, a umowa mówi o ośmiu`);
  for (const slowo of ["klasyfikacja", "korekta", "ocena", "szkic", "dane", "pasowanie", "pytanie", "pasowania/:nr"]) {
    assert.equal(zrodlo.includes(slowo), true, `brak trasy ${slowo}`);
  }
});

test("patrzenie na Copilota niczego nie mutuje", async () => {
  const b = login("biuro", "Ala");
  const stan = () => [liczba("decyzja_klasyfikacji"), liczba("szkic_copilota"),
    liczba("copilot_wywolanie"), liczba("events")];
  const przed = stan();
  for (const t of TRASY().filter((t) => t.method === "GET")) {
    await app.inject({ method: t.method, url: t.url, headers: b.naglowki });
    await app.inject({ method: t.method, url: t.url, headers: b.naglowki });
  }
  assert.deepEqual(stan(), przed,
    "otwarcie ekranu Copilota coś zapisało",
  );
});

/* ── Wyłączony Copilot ──────────────────────────────────────────────────── */

test("wyłączony Copilot mówi, co włączyć, i nie wychodzi do sieci", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: "/api/obsluga/copilot/klasyfikacja",
    headers: b.naglowki, payload: { rozmowyId: [rozmowa] },
  });
  assert.equal(r.statusCode, 400, "wyłączony Copilot ma odmówić zdaniem, nie wywrotką 500");
  assert.match(r.json<{ error: string }>().error, /COPILOT_MODE|wertis\.env/);
  assert.equal(liczba("copilot_wywolanie"), 0, "odmowa nie ma prawa nic kosztować");
});

test("stan mówi wprost, dlaczego przycisku nie ma", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/copilot", headers: b.naglowki });
  const s = r.json<{ wlaczony: boolean; powod: string | null; maxPartia: number;
    autoKlasyfikacja: boolean; autoSzkic: boolean }>();
  assert.equal(s.wlaczony, false);
  /* Automat wyłączony domyślnie — i ekran ma o tym wiedzieć, bo od tego
     zależy, czy „Rozpoznaj" jest drogą główną, czy tylko ponowieniem. */
  assert.equal(s.autoKlasyfikacja, false);
  assert.equal(s.autoSzkic, false);
  assert.match(String(s.powod), /wertis\.env/);
  /* Limit idzie na ekran z konfiguracji, żeby przycisk nie powtarzał liczby
     wpisanej w panelu — inaczej rozjechałby się z hamulcem po stronie serwera. */
  assert.ok(s.maxPartia > 0);
});

/* Kolejność bramek jest DECYZJĄ: wyłączony Copilot odmawia, ZANIM zajrzy do
   listy rozmów. Człowiek ma najpierw usłyszeć o problemie fundamentalnym,
   a nie o pustym polu w żądaniu, które i tak nie miałoby czego zrobić. */
test("wyłączony Copilot odmawia przed sprawdzeniem listy, a nie po", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: "/api/obsluga/copilot/klasyfikacja",
    headers: b.naglowki, payload: { rozmowyId: [] },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /wertis\.env/,
    "przy wyłączonym Copilocie odmowa ma nazwać wyłączenie, nie pustą listę");
  /* Sam strażnik pustej listy stoi w trasie i pilnuje go czytanie źródła —
     ścieżki z włączonym Copilotem ten plik świadomie nie uruchamia, żeby
     żaden test nie miał jak wyjść do Anthropic. */
  const zrodlo = fs.readFileSync(new URL("./copilot.ts", import.meta.url), "utf8");
  assert.match(zrodlo, /Nie podano rozmów/);
});

test("wyłączony Copilot nie układa szkicu i nie wychodzi do sieci", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: "/api/obsluga/copilot/szkic", headers: b.naglowki, payload: { rozmowaId: rozmowa },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /COPILOT_MODE|wertis\.env/);
  assert.equal(liczba("copilot_wywolanie"), 0, "odmowa nie ma prawa nic kosztować");
  assert.equal(liczba("szkic_copilota"), 0);
});

test("ocena szkicu bez szkicu odmawia zdaniem", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/copilot/szkic/${rozmowa}/ocena`,
    headers: b.naglowki, payload: { ocena: "wstawiony" },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /nie ma jeszcze szkicu/);
});

test("ocena pasowania bez propozycji odmawia zdaniem, a zła ocena nazywa dozwolone", async () => {
  const b = login("biuro", "Ala");
  let r = await app.inject({
    method: "POST", url: `/api/obsluga/copilot/szkic/${rozmowa}/pasowanie`,
    headers: b.naglowki, payload: { ocena: "zaproponowane" },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /nie ma propozycji pasowania/);
  r = await app.inject({
    method: "POST", url: `/api/obsluga/copilot/szkic/${rozmowa}/pasowanie`,
    headers: b.naglowki, payload: { ocena: "moze" },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /„zaproponowane” albo „odrzucone”/);
  assert.equal(liczba("szkic_copilota"), 0);
});

/* Strażnik adresów panelu (blizna 0.181.1): każdy adres wołany z
   `panel/src/api/copilot.ts` ma trasę. Do 0.230.0 ten plik nie miał strażnika —
   strażnik skrzynki czyta tylko `rozmowy.ts`, a wiedzy tylko `wiedza.ts`. */
test("każdy adres wołany z panel/src/api/copilot.ts ma trasę na serwerze", async () => {
  const b = login("biuro", "Ala");
  const zrodlo = fs.readFileSync(new URL("../../../panel/src/api/copilot.ts", import.meta.url), "utf8");
  /* Adresy stałe stoją w cudzysłowie, szablonowe w odwrotnych apostrofach —
     strażnik czyta oba, inaczej widziałby tylko połowę pliku. */
  const re = /api(?:<[^>]*>)?\(\s*(["`])([^"`]+)\1(?:\s*,\s*\{[^}]*?method:\s*"(GET|POST|PUT|DELETE)")?/gs;
  const wywolania: Array<{ url: string; method: "GET" | "POST" | "PUT" | "DELETE" }> = [];
  for (const m of zrodlo.matchAll(re)) {
    wywolania.push({ url: m[2]!.replace(/\$\{[^}]+\}/g, String(rozmowa)), method: (m[3] as "GET") ?? "GET" });
  }
  assert.ok(wywolania.length >= 4, `strażnik widzi tylko ${wywolania.length} adresów — regex się rozjechał`);
  for (const w of wywolania) {
    const r = await app.inject({ method: w.method, url: w.url, headers: b.naglowki,
      payload: w.method === "GET" ? undefined : {} });
    assert.doesNotMatch(r.body, /Route .* not found/, `${w.method} ${w.url} nie ma trasy`);
  }
});

test("poprawka bez rozpoznanej kategorii odmawia zdaniem", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/copilot/klasyfikacja/${rozmowa}/korekta`,
    headers: b.naglowki, payload: { kategoria: "OTHER" },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /nie ma jeszcze rozpoznanej/);
});

test("poprawka spoza słownika nazywa dozwolone kategorie", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/copilot/klasyfikacja/${rozmowa}/korekta`,
    headers: b.naglowki, payload: { kategoria: "dobor" },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /PRODUCT_COMPATIBILITY/);
});
