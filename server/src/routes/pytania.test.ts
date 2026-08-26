import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy pytań klientów ────────────────────────────────────────────────────
   Logika jest przedmiotem `services/pytania.test.ts`; tutaj bramka ról i pełny
   przepływ przez HTTP na adapterze dev i doradcy dev: odśwież → generuj →
   popraw → wyślij → następne pytanie.

   Bramka ma DWA poziomy i to jest tu najważniejsze do sprawdzenia: pytania
   obsługuje biuro, ale prompt eksperta i fakty firmowe zmienia wyłącznie
   admin — bo to one decydują, co aplikacja mówi klientom.                    */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pytr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let zresetujAdapterAllegro: typeof import("../adapters/allegro.js").zresetujAdapterAllegro;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ zresetujAdapterAllegro } = await import("../adapters/allegro.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of [
    "dopasowanie", "pytanie", "ai_config", "sgt_towar", "sgt_stan",
    "events", "device_session", "app_user",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, opis, lokalizacja) VALUES (900036,'TEST-LINIA-TODO','Pozycja jeszcze nietknięta','','','F02-02-04')"
  ).run();
  d.prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (900036,1,10,0)").run();
  zresetujAdapterAllegro();
});

function zalogowany(rola: Rola): string {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "biurko-1", teraz, teraz);
  return token;
}

const TRASY = [
  { method: "GET" as const, url: "/api/biuro/pytania" },
  { method: "GET" as const, url: "/api/biuro/pytania/licznik" },
  { method: "GET" as const, url: "/api/biuro/pytania/statystyki" },
  { method: "GET" as const, url: "/api/biuro/pytania/prompt" },
  { method: "POST" as const, url: "/api/biuro/pytania/odswiez", body: {} },
  { method: "POST" as const, url: "/api/biuro/pytania/wklejka", body: { tekst: "x" } },
  { method: "GET" as const, url: "/api/biuro/pytania/1" },
  { method: "POST" as const, url: "/api/biuro/pytania/1/generuj", body: {} },
];

test("bez sesji 401 na każdej trasie", async () => {
  for (const t of TRASY) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.body });
    assert.equal(r.statusCode, 401, t.url);
  }
});

test("magazynier dostaje 403 — na pytania klientów odpowiada biuro", async () => {
  const token = zalogowany("magazynier");
  for (const t of TRASY) {
    const r = await app.inject({
      method: t.method, url: t.url, payload: t.body, headers: { "x-session": token },
    });
    assert.equal(r.statusCode, 403, t.url);
  }
});

test("prompt i fakty: biuro czyta, ale zmienia wyłącznie admin", async () => {
  const biuro = zalogowany("biuro");
  const admin = zalogowany("admin");

  const odczyt = await app.inject({
    method: "GET", url: "/api/biuro/pytania/prompt", headers: { "x-session": biuro },
  });
  assert.equal(odczyt.statusCode, 200);

  for (const [url, ciało] of [
    ["/api/biuro/pytania/prompt", { prompt: "Jesteś doradcą." }],
    ["/api/biuro/pytania/fakty", { fakty: "Wysyłka do Chorwacji: 60 zł." }],
  ] as const) {
    const odmowa = await app.inject({
      method: "PUT", url, payload: ciało, headers: { "x-session": biuro },
    });
    assert.equal(odmowa.statusCode, 403, url);
    assert.match(odmowa.json().error, /admin/);

    const zapis = await app.inject({
      method: "PUT", url, payload: ciało, headers: { "x-session": admin },
    });
    assert.equal(zapis.statusCode, 200, url);
  }

  const po = await app.inject({
    method: "GET", url: "/api/biuro/pytania/prompt", headers: { "x-session": admin },
  });
  assert.equal(po.json().konfiguracja.prompt, "Jesteś doradcą.");
  assert.match(po.json().konfiguracja.fakty, /Chorwacji/);
});

test("pełny przepływ: odśwież → szkic → poprawka → wysyłka → następne pytanie", async () => {
  const token = zalogowany("biuro");
  const naglowki = { "x-session": token };

  const odswiez = await app.inject({
    method: "POST", url: "/api/biuro/pytania/odswiez", payload: {}, headers: naglowki,
  });
  assert.equal(odswiez.statusCode, 200);
  /* Wątek zakończony naszą odpowiedzią nie jest pytaniem — trzy z czterech. */
  assert.equal(odswiez.json().nowych, 3);
  /* Szkice liczą się od razu po synchronizacji: otwarte pytanie ma mieć
     odpowiedź gotową, a nie przycisk „wygeneruj" i czekanie. */
  assert.equal(odswiez.json().szkicow, 3);
  assert.equal(odswiez.json().otwartych, 3);

  const lista = await app.inject({ method: "GET", url: "/api/biuro/pytania", headers: naglowki });
  const pytania = lista.json().pytania;
  assert.equal(pytania.length, 3);
  assert.equal(lista.json().ai.tryb, "dev");
  const p = pytania.find((x: { ofertaId: string | null }) => x.ofertaId === "of-1");
  assert.ok(p.odpowiedz, "szkic czeka gotowy");

  const szczegol = await app.inject({
    method: "GET", url: `/api/biuro/pytania/${p.id}`, headers: naglowki,
  });
  assert.equal(szczegol.statusCode, 200);
  /* Karty towarów obok szkicu — dobór weryfikuje się okiem, bez Subiekta. */
  const kartoteki = szczegol.json().kartoteki;
  assert.ok(kartoteki.some((k: { symbol: string }) => k.symbol === "TEST-LINIA-TODO"));
  assert.equal(kartoteki[0].zdjecieUrl, `/api/products/${kartoteki[0].twId}/zdjecie`);
  assert.ok(szczegol.json().oferty.length > 0);
  /* Panel ma dostać to samo, co model: po czym szukaliśmy i czy pusta lista
     aukcji znaczy „nie mamy", czy „nie udało się sprawdzić". Bez `bladOfert`
     ekran pisał „nic nie pasuje" także wtedy, gdy Allegro padło. */
  assert.ok(Array.isArray(szczegol.json().frazy) && szczegol.json().frazy.length > 0);
  assert.ok(Array.isArray(szczegol.json().dopasowania));
  assert.ok(Array.isArray(szczegol.json().poprzednie));
  assert.equal(szczegol.json().bladOfert, null);

  const rozmowa = await app.inject({
    method: "GET", url: `/api/biuro/pytania/${p.id}/wiadomosci`, headers: naglowki,
  });
  assert.equal(rozmowa.json().watek.wiadomosci.length, 1);

  const wyslij = await app.inject({
    method: "POST",
    url: `/api/biuro/pytania/${p.id}/wyslij`,
    payload: { odpowiedz: p.odpowiedz + " Pozdrawiamy, WERTIS." },
    headers: naglowki,
  });
  assert.equal(wyslij.statusCode, 200);
  assert.equal(wyslij.json().pytanie.status, "wyslane");
  assert.equal(wyslij.json().pytanie.edytowano, true);
  assert.ok(wyslij.json().nastepneId, "panel ma czym otworzyć następne pytanie");
  assert.equal(wyslij.json().otwartych, 2);
});

test("wklejka zakłada pytanie ze szkicem i bez wątku", async () => {
  const naglowki = { "x-session": zalogowany("biuro") };
  const r = await app.inject({
    method: "POST",
    url: "/api/biuro/pytania/wklejka",
    payload: { tekst: "Czy cewka pasuje do T375?" },
    headers: naglowki,
  });
  assert.equal(r.statusCode, 200);
  const p = r.json().pytanie;
  assert.equal(p.zrodlo, "wklejka");
  assert.equal(p.status, "szkic");
  assert.equal(p.threadId, null);

  /* Bez wątku nie ma dokąd odpisać — 400 ze zdaniem, co zrobić zamiast tego. */
  const wyslij = await app.inject({
    method: "POST", url: `/api/biuro/pytania/${p.id}/wyslij`, payload: {}, headers: naglowki,
  });
  assert.equal(wyslij.statusCode, 400);
  assert.match(wyslij.json().error, /Centrum wiadomości/);
});

test("wklejka z obrazem w złym formacie kończy się czytelnym 400", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/biuro/pytania/wklejka",
    payload: { obraz: "data:image/gif;base64,AAAA" },
    headers: { "x-session": zalogowany("biuro") },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /Nieobsługiwany format/);
});

test("zamknięcie i pominięcie schodzą z worklisty i wskazują następne", async () => {
  const naglowki = { "x-session": zalogowany("biuro") };
  await app.inject({ method: "POST", url: "/api/biuro/pytania/odswiez", payload: {}, headers: naglowki });
  const pytania = (await app.inject({ method: "GET", url: "/api/biuro/pytania", headers: naglowki }))
    .json().pytania;

  const zamkniete = await app.inject({
    method: "POST", url: `/api/biuro/pytania/${pytania[0].id}/zamknij`, payload: {}, headers: naglowki,
  });
  assert.equal(zamkniete.json().pytanie.status, "zamkniete");
  assert.equal(zamkniete.json().otwartych, 2);

  const pominiete = await app.inject({
    method: "POST", url: `/api/biuro/pytania/${pytania[1].id}/pomin`, payload: {}, headers: naglowki,
  });
  assert.equal(pominiete.json().pytanie.status, "pominiete");
  assert.equal(pominiete.json().otwartych, 1);

  const licznik = await app.inject({
    method: "GET", url: "/api/biuro/pytania/licznik", headers: naglowki,
  });
  assert.equal(licznik.json().otwartych, 1);
});

test("statystyki wracają w umówionym oknie, także na pustej bazie", async () => {
  const naglowki = { "x-session": zalogowany("biuro") };
  const r = await app.inject({
    method: "GET", url: "/api/biuro/pytania/statystyki?dni=7", headers: naglowki,
  });
  assert.equal(r.statusCode, 200);
  /* Okno spoza listy schodzi do domyślnych 90 dni, nie do błędu. */
  assert.equal(r.json().statystyki.dni, 90);
  assert.equal(r.json().statystyki.wyslanych, 0);
  assert.deepEqual(r.json().statystyki.pozaOferta, []);
});

test("ślad pobrania zostaje także wtedy, gdy nic nie przyszło", async () => {
  /* Skrzynka na zero wygląda IDENTYCZNIE w dwóch zupełnie różnych sytuacjach:
     dziś nikt nie napisał, albo od wczoraj nikt nie pytał Allegro. Zdarzenie
     w audycie ich nie rozróżnia i nie powinno — przebieg bez zmian nie jest
     faktem o towarze ani o ludziach, więc `pytanie_sync` leci tylko przy
     nowych pytaniach. Ślad przebiegu to co innego: stan w pamięci, który ma
     powstać ZAWSZE, bo odpowiada na pytanie „czy ktoś dziś w ogóle pytał".

     Ten test pilnuje właśnie tego drugiego pobrania — pierwsze zwraca nowe
     pytania i ślad powstałby nawet przy starej regule. */
  const naglowki = { "x-session": zalogowany("biuro") };
  const czytaj = async () =>
    (await app.inject({ method: "GET", url: "/api/biuro/pytania/licznik", headers: naglowki }))
      .json().synchronizacja;

  const pierwsze = await app.inject({
    method: "POST", url: "/api/biuro/pytania/odswiez", payload: {}, headers: naglowki,
  });
  assert.ok(pierwsze.json().nowych > 0, "pierwszy przebieg coś przynosi");
  const poPierwszym = await czytaj();
  assert.ok(poPierwszym, "ślad powstaje");
  assert.equal(poPierwszym.nowych, pierwsze.json().nowych);
  assert.ok(poPierwszym.przejrzanychWatkow > 0, "liczba przejrzanych rozmów jedzie ze śladem");

  /* DRUGI przebieg na tych samych danych: `INSERT OR IGNORE` nie doda nic,
     więc `nowych` wynosi zero — i dokładnie tu stara reguła gubiła ślad. */
  const drugie = await app.inject({
    method: "POST", url: "/api/biuro/pytania/odswiez", payload: {}, headers: naglowki,
  });
  assert.equal(drugie.json().nowych, 0, "drugi przebieg nie ma czego dodać");
  const poDrugim = await czytaj();
  assert.ok(poDrugim,
    "ślad zostaje MIMO zera — inaczej ekran nie odróżni pustej skrzynki od braku pobrania");
  assert.equal(poDrugim.nowych, 0);
  assert.ok(poDrugim.at >= poPierwszym.at, "znacznik czasu przesuwa się na drugi przebieg");
  assert.ok(poDrugim.przejrzanychWatkow > 0);
});

test("zero nowych mówi, DLACZEGO — rozbicie pominięć", async () => {
  /* Usterka 0.102.1 wyglądała na ekranie tak: „przejrzano 60 rozmów, nowych 0"
     i nic więcej. Trzy różne sytuacje dawały ten sam widok, więc nie dało się
     odróżnić poprawnej skrzynki na zero od zakładki, która cicho odrzuca
     wszystko. Rozbicie jest jedyną rzeczą, która je rozdziela. */
  const naglowki = { "x-session": zalogowany("biuro") };
  const odswiez = async () =>
    (await app.inject({
      method: "POST", url: "/api/biuro/pytania/odswiez", payload: {}, headers: naglowki,
    })).json();

  const pierwsze = await odswiez();
  assert.ok(pierwsze.pominiete, "rozbicie jedzie z wynikiem");
  /* Ziarno dev ma wątek domknięty naszą odpowiedzią — trzy z czterech wchodzą,
     czwarty jest pominięty POPRAWNIE i to musi być widać jako osobny powód. */
  assert.ok(
    pierwsze.pominiete.zakonczonyNaszaOdpowiedzia > 0,
    "wątek z ostatnim słowem po naszej stronie liczy się osobno"
  );
  assert.equal(pierwsze.pominiete.bezWiadomosci, 0, "adapter dev oddaje czytelne wątki");

  /* DRUGI przebieg: te same wątki, nic nowego. Bez kubełka „już mamy" ekran
     pokazywałby „przejrzano N, nowych 0" i ANI SŁOWA więcej — czyli tę samą
     ciszę, którą to rozbicie ma usunąć. Rachunek musi się domknąć. */
  const drugie = await odswiez();
  assert.equal(drugie.nowych, 0, "drugi przebieg nie ma czego dodać");
  assert.ok(drugie.pominiete.juzZnane > 0, "znane pytania mają swój kubełek, a nie giną w zerze");

  /* Rachunek musi się DOMKNĄĆ — to jest właściwy niezmiennik, a nie związek
     z poprzednim przebiegiem (baza jest wspólna dla testów w tym pliku, więc
     „ile weszło przed chwilą" zależy od sąsiadów). Każdy przejrzany wątek
     wpada dokładnie do jednego kubełka; gdyby doszedł piąty powód i nikt nie
     dopisał go tutaj, ta suma przestałaby się zgadzać i test by o tym
     powiedział. */
  for (const przebieg of [pierwsze, drugie]) {
    const suma =
      przebieg.nowych +
      przebieg.pominiete.juzZnane +
      przebieg.pominiete.zakonczonyNaszaOdpowiedzia +
      przebieg.pominiete.bezWiadomosci +
      przebieg.pominiete.bezIdentyfikatora;
    assert.equal(suma, przebieg.przejrzanychWatkow, "kubełki domykają przejrzane rozmowy");
  }

  /* Rozbicie ma dojechać aż na ekran — trasa licznika jest tą, z której panel
     czyta linijkę pod przyciskiem. */
  const licznik = await app.inject({
    method: "GET", url: "/api/biuro/pytania/licznik", headers: naglowki,
  });
  const sync = licznik.json().synchronizacja;
  assert.ok(sync.pominiete, "ślad pobrania niesie rozbicie, nie tylko liczby");
  /* Ślad trzyma OSTATNI przebieg, czyli `drugie` — nie pierwszy. Ekran ma
     mówić o tym, co stało się przy ostatnim kliknięciu, a nie o historii. */
  assert.deepEqual(sync.pominiete, drugie.pominiete, "ślad niesie rozbicie ostatniego przebiegu");
  assert.equal(sync.nowych, drugie.nowych);
});

test("nieznane pytanie to 404, nie 500", async () => {
  const r = await app.inject({
    method: "GET", url: "/api/biuro/pytania/9999", headers: { "x-session": zalogowany("biuro") },
  });
  assert.equal(r.statusCode, 404);
});
