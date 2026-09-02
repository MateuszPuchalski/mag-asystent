import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-health-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* `/api/health` nie miała testu do 0.149.0, choć to po niej instalator poznaje,
   że system żyje: `Test-WertisHealth` odpytuje ją piętnaście razy i po
   piętnastym wyjątku melduje „API nie odpowiedziało".

   1 września 2026 wyszło, ile to kosztuje. Trasa zdrowia zbiera kilkanaście
   liczb z bazy i z adapterów; każda z nich potrafi rzucić, a rzut jednej
   zabierał całą odpowiedź. Człowiek widział wtedy „API nie odpowiedziało"
   i nie miał jak odróżnić martwego procesu od jednego zepsutego licznika. */

let app: FastifyInstance;
before(async () => { app = await (await import("../index.js")).buildApp(); });

test("zdrowie odpowiada 200 i niesie to, po czym poznaje się instalację", async () => {
  const r = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(r.statusCode, 200, r.body);

  const h = r.json();
  /* Te pola czyta instalator i pasek kolektora. Rozjazd wersji serwera
     i APK to najczęstsze pytanie po aktualizacji. */
  assert.ok(h.wersja, "brak wersji serwera");
  assert.equal(h.mode, "seeded");
  assert.ok(h.configZPliku !== undefined, "brak źródła konfiguracji");
  assert.ok(Array.isArray(h.problemy), "problemy mają być listą zdań");
  assert.equal(typeof h.ok, "boolean");
});

test("trasa jest publiczna — poznaje się po niej stan PRZED zalogowaniem", async () => {
  /* Bez sesji i tak ma być: ostrzeżenie „to jest dev" musi być widoczne
     zanim człowiek się zaloguje, bo właśnie wtedy myli serwery. */
  const r = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(r.statusCode, 200);
  assert.notEqual(r.statusCode, 401);
});

test("blok obsługi klienta niesie liczby z §21, bez treści i bez klientów", async () => {
  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.equal(typeof h.obsluga.rozmowyOczekujace, "number");
  assert.equal(typeof h.obsluga.zadaniaTerenowe, "number");
  /* Do 0.172.0 stała tu stała „wysyłka wyłączona" — zdanie nieprawdziwe od
     0.148.0, czyli od wydania, w którym wysyłka zaczęła działać. Teraz pole
     opisuje STAN kolejki, a pusta baza znaczy „nic jeszcze nie poszło". */
  assert.equal(h.obsluga.kolejkaWysylek, "pusta — nic jeszcze nie poszło");
  assert.equal(h.obsluga.wysylkiDoSprawdzenia, 0);

  /* Trasa jest publiczna, więc do payloadu nie ma wstępu nic poza liczbami. */
  const surowy = JSON.stringify(h);
  assert.ok(!/klient|tresc|oferta/i.test(JSON.stringify(h.obsluga)),
    "blok obsługi przemycił coś poza liczbami");
  assert.ok(!surowy.includes("MSSQL_PASSWORD"), "hasło w trasie publicznej");
});

test("blok synchronizacji Allegro niesie status z §7", async () => {
  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.ok(["current", "delayed", "rate_limited", "authentication_error", "failed"]
    .includes(h.allegroInbox.status), `nieznany status: ${h.allegroInbox.status}`);
  assert.equal(typeof h.allegroInbox.alarm, "boolean");
});

test("padnięty blok NIE kasuje odpowiedzi, tylko melduje się zdaniem", async () => {
  /* Sedno tej trasy. Psujemy jeden licznik i sprawdzamy, że zdrowie nadal
     odpowiada — bo `Test-WertisHealth` nie odróżnia 500 od martwego procesu,
     a człowiek dostaje wtedy komunikat, który nie mówi nic. */
  const { db } = await import("../db/db.js");
  db().exec("ALTER TABLE zadanie_terenowe RENAME TO zadanie_terenowe_schowane");
  try {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(r.statusCode, 200, "zdrowie padło razem z jednym licznikiem");

    const h = r.json();
    assert.equal(h.obsluga, null, "padnięty blok ma zwrócić null");
    assert.equal(h.ok, false, "awaria bloku musi zdejmować `ok`");
    assert.ok(h.problemy.some((p: string) => p.includes("obsługa klienta")),
      `awaria nie zameldowała się zdaniem: ${JSON.stringify(h.problemy)}`);
    /* Reszta odpowiedzi ma przeżyć — po niej instalator poznaje instalację. */
    assert.ok(h.wersja);
    assert.equal(h.mode, "seeded");
  } finally {
    db().exec("ALTER TABLE zadanie_terenowe_schowane RENAME TO zadanie_terenowe");
  }
});

test("awaria importu z Subiekta NIE kładzie serwera, tylko melduje się w zdrowiu", async () => {
  /* 1 września 2026 `main()` czekał na `importFromMssql()` przed
     `app.listen()`, a wyjątek kończył proces. NSSM restartował, import padał
     znowu — z zewnątrz martwe API. Read-model ma prawo być nieświeży;
     API nie ma prawa nie wstać. */
  const { odswiezReadModel } = await import("../index.js");

  await odswiezReadModel("start", async () => {
    throw new Error("FOREIGN KEY constraint failed");
  });

  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.equal(h.ok, false);
  const zdanie = h.problemy.find((p: string) => p.includes("Import z Subiekta"));
  assert.ok(zdanie, `awaria importu nie zameldowała się: ${JSON.stringify(h.problemy)}`);
  /* Zdanie ma mówić, co teraz widzi kolektor — sam komunikat błędu tego nie mówi. */
  assert.match(zdanie, /ostatniego udanego odświeżenia/);
  assert.match(zdanie, /FOREIGN KEY constraint failed/);
});

test("udane odświeżenie zdejmuje zdanie o nieświeżym read-modelu", async () => {
  const { odswiezReadModel } = await import("../index.js");
  await odswiezReadModel("cykl", async () => { throw new Error("padło"); });
  await odswiezReadModel("cykl", async () => undefined);

  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.ok(!h.problemy.some((p: string) => p.includes("Import z Subiekta")),
    "zdanie o awarii zostało po udanym imporcie");
});
