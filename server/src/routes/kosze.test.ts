import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy koszy zwrotowych ──────────────────────────────────────────────────
   Logika jest przedmiotem `services/kosze.test.ts`; tutaj bramki i pełny
   przepływ przez HTTP: biuro przypina i zamyka, HALA rozkłada i kończy.
   Podział ról jest tu treścią: magazynier NIE zamyka koszy, ale rozkłada —
   trasy /api/kosze/* muszą działać na roli magazynier.                       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-koszr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of [
    "kosz_pozycja", "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot", "kosz",
    "przyjecie_pominiete", "sgt_mm_zwrot_pozycja", "sgt_mm_zwrot",
    "sgt_sprzedaz_pozycja", "sgt_sprzedaz", "sgt_towar", "sfera_queue",
    "events", "device_session", "app_user",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,?)");
  ins.run(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta", "", "A01-02-03");
  ins.run(900_037, "TEST-LINIA-DONE", "Pozycja odłożona w całości", "5900000000037", "");
  d.prepare(
    "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, mag_id) VALUES (101,'FS','FS 101/08/2026','dev-ord-1',?, 'ALLEGRO', 1)"
  ).run(new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10));
  const poz = d.prepare("INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (101,?,?)");
  poz.run(900_036, 1);
  poz.run(900_037, 2);
});

function zalogowany(rola: Rola): Record<string, string> {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "biurko-1", teraz, teraz);
  return { "x-session": token };
}

async function zwrotWKoszu(biuro: Record<string, string>): Promise<{ zwrotId: number; koszId: number }> {
  let r = await app.inject({ method: "POST", url: "/api/biuro/zwroty/skan", payload: { kod: "DEVWB0001" }, headers: biuro });
  const zwrot = r.json().zwrot;
  for (const p of zwrot.pozycje) {
    await app.inject({
      method: "POST",
      url: `/api/biuro/zwroty/${zwrot.id}/pozycje/${p.id}/decyzja`,
      payload: { decyzja: "pelnowartosciowy" },
      headers: biuro,
    });
  }
  r = await app.inject({ method: "POST", url: `/api/biuro/zwroty/${zwrot.id}/dokumenty`, headers: biuro });
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(r.json().zwrot.dokumenty.queueId);
  r = await app.inject({ method: "POST", url: `/api/biuro/zwroty/${zwrot.id}/kosz`, payload: { kod: "KZ-07" }, headers: biuro });
  assert.equal(r.statusCode, 200);
  return { zwrotId: zwrot.id, koszId: r.json().zwrot.kosz.id };
}

test("bramki: przypinanie i zamykanie to biuro, rozkładanie działa na magazynierze", async () => {
  const magazynier = zalogowany("magazynier");
  let r = await app.inject({ method: "POST", url: "/api/biuro/zwroty/1/kosz", payload: { kod: "X" }, headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/kosze", headers: magazynier });
  assert.equal(r.statusCode, 403);
  // hala bez sesji — bramka globalna
  r = await app.inject({ method: "GET", url: "/api/kosze" });
  assert.equal(r.statusCode, 401);
  r = await app.inject({ method: "GET", url: "/api/kosze", headers: magazynier });
  assert.equal(r.statusCode, 200);
});

test("pełny przepływ: kosz na karcie, zamknięcie, rozkładanie, cofnięcie bufora", async () => {
  const biuro = zalogowany("biuro");
  const magazynier = zalogowany("magazynier");
  const { zwrotId, koszId } = await zwrotWKoszu(biuro);

  // karta zwrotu pokazuje kosz
  let r = await app.inject({ method: "GET", url: `/api/biuro/zwroty/${zwrotId}`, headers: biuro });
  assert.equal(r.json().zwrot.kosz.kod, "KZ-07");

  r = await app.inject({ method: "POST", url: `/api/biuro/kosze/${koszId}/zamknij`, headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().kosz.pozycje.length, 2);

  // hala: kosz widoczny po kodzie z etykiety
  r = await app.inject({ method: "GET", url: "/api/kosze/kod/KZ-07", headers: magazynier });
  assert.equal(r.statusCode, 200);
  const kosz = r.json().kosz;

  // skan towaru wskazuje pozycję; odkładanie po kolei
  r = await app.inject({
    method: "POST", url: `/api/kosze/${koszId}/skan`, payload: { code: "5900000000037" }, headers: magazynier,
  });
  assert.ok(r.json().pozycjaId);
  for (const p of kosz.pozycje) {
    r = await app.inject({
      method: "POST",
      url: `/api/kosze/pozycje/${p.id}/odloz`,
      payload: { lokalizacja: p.lokOczekiwana ?? "B01-01-01" },
      headers: magazynier,
    });
    assert.equal(r.statusCode, 200, r.body);
  }

  r = await app.inject({ method: "POST", url: `/api/kosze/${koszId}/zakoncz`, headers: magazynier });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().kosz.status, "rozlozony");
  const mm = db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number };
  assert.equal(mm.n, 2, "bufor cofa się sam — MM per pozycja");

  // autor zadań MM = magazynier z sesji, nie biuro
  const autorzy = db().prepare("SELECT DISTINCT created_by FROM sfera_queue WHERE type='mm'").all() as Array<{ created_by: string }>;
  assert.deepEqual(autorzy.map((a) => a.created_by), ["Ktoś magazynier"]);
});

test("cofanie i odkładanie na później przez HTTP — bez bramki roli", async () => {
  const biuro = zalogowany("biuro");
  const magazynier = zalogowany("magazynier");
  const { koszId } = await zwrotWKoszu(biuro);
  await app.inject({ method: "POST", url: `/api/biuro/kosze/${koszId}/zamknij`, headers: biuro });
  const kosz = (await app.inject({ method: "GET", url: "/api/kosze/kod/KZ-07", headers: magazynier })).json().kosz;
  const pierwsza = kosz.pozycje[0].id;

  // „później" — pozycja zjeżdża na koniec, ale wciąż czeka
  let r = await app.inject({ method: "POST", url: `/api/kosze/pozycje/${pierwsza}/pozniej`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);
  const poZsunieciu = r.json().kosz.pozycje;
  assert.equal(poZsunieciu[poZsunieciu.length - 1].id, pierwsza);
  assert.equal(poZsunieciu[poZsunieciu.length - 1].status, "todo");

  // odłożenie i cofnięcie tą samą trasą — serwer rozpoznaje, co cofa
  await app.inject({
    method: "POST", url: `/api/kosze/pozycje/${pierwsza}/odloz`,
    payload: { lokalizacja: "B01-01-01" }, headers: magazynier,
  });
  r = await app.inject({ method: "POST", url: `/api/kosze/pozycje/${pierwsza}/cofnij`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().kosz.pozycje.find((p: { id: number }) => p.id === pierwsza).status, "todo");

  // zakończenie i jego cofnięcie
  for (const p of kosz.pozycje) {
    await app.inject({
      method: "POST", url: `/api/kosze/pozycje/${p.id}/odloz`,
      payload: { lokalizacja: "B01-01-01" }, headers: magazynier,
    });
  }
  await app.inject({ method: "POST", url: `/api/kosze/${koszId}/zakoncz`, headers: magazynier });
  r = await app.inject({ method: "POST", url: `/api/kosze/${koszId}/cofnij-zakonczenie`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().kosz.status, "zamkniety");
});

test("przyjęcia: hala otwiera numerem z kartki, zdejmuje z listy tylko admin", async () => {
  const magazynier = zalogowany("magazynier");
  const admin = zalogowany("admin");
  const d = db();
  d.prepare(
    `INSERT INTO sgt_mm_zwrot(dok_id, nr_pelny, numer, data_wyst, mag_z, mag_do)
     VALUES (41209, 'MM 1209/MAG/2026', '1209', '2026-08-18', 1, 3)`
  ).run();
  d.prepare("INSERT INTO sgt_mm_zwrot_pozycja(dok_id, tw_id, ilosc) VALUES (41209, 900036, 2)").run();

  let r = await app.inject({ method: "GET", url: "/api/przyjecia", headers: magazynier });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().przyjecia[0].numer, "1209");

  // numer z kartki, nie identyfikator z bazy
  r = await app.inject({
    method: "POST", url: "/api/przyjecia/otworz", payload: { numer: "1209" }, headers: magazynier,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().kosz.mmNumer, "1209");

  r = await app.inject({
    method: "POST", url: "/api/przyjecia/otworz", payload: { numer: "999" }, headers: magazynier,
  });
  assert.equal(r.statusCode, 404);

  // „już rozłożony" to decyzja admina — magazynier jej nie ma
  r = await app.inject({
    method: "POST", url: "/api/przyjecia/41209/poza-aplikacja", payload: {}, headers: magazynier,
  });
  assert.equal(r.statusCode, 403);
  r = await app.inject({
    method: "POST", url: "/api/przyjecia/41209/poza-aplikacja", payload: {}, headers: admin,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().przyjecia[0].stan, "poza_aplikacja");
});

test("pominięcie pozycji: przez HTTP, z powodem, i nie blokuje zakończenia", async () => {
  const biuro = zalogowany("biuro");
  const magazynier = zalogowany("magazynier");
  const { koszId } = await zwrotWKoszu(biuro);
  await app.inject({ method: "POST", url: `/api/biuro/kosze/${koszId}/zamknij`, headers: biuro });
  const kosz = (await app.inject({ method: "GET", url: "/api/kosze/kod/KZ-07", headers: magazynier })).json().kosz;

  // powód jest treścią zgłoszenia — bez niego trasa odmawia
  let r = await app.inject({
    method: "POST", url: `/api/kosze/pozycje/${kosz.pozycje[0].id}/pomin`, payload: {}, headers: magazynier,
  });
  assert.equal(r.statusCode, 400);

  r = await app.inject({
    method: "POST",
    url: `/api/kosze/pozycje/${kosz.pozycje[0].id}/pomin`,
    payload: { powod: "nie ma w koszu" },
    headers: magazynier,
  });
  assert.equal(r.statusCode, 200, r.body);

  await app.inject({
    method: "POST",
    url: `/api/kosze/pozycje/${kosz.pozycje[1].id}/odloz`,
    payload: { lokalizacja: "B01-01-01" },
    headers: magazynier,
  });
  r = await app.inject({ method: "POST", url: `/api/kosze/${koszId}/zakoncz`, headers: magazynier });
  assert.equal(r.statusCode, 200, r.body);
  const pominieta = r.json().kosz.pozycje.find((p: { status: string }) => p.status === "skipped");
  assert.equal(pominieta.powod, "nie ma w koszu");
});

test("biuro: lista pominięć i szukanie po towarze, oba za bramką roli", async () => {
  const biuro = zalogowany("biuro");
  const magazynier = zalogowany("magazynier");
  const { koszId } = await zwrotWKoszu(biuro);
  await app.inject({ method: "POST", url: `/api/biuro/kosze/${koszId}/zamknij`, headers: biuro });
  const kosz = (await app.inject({ method: "GET", url: "/api/kosze/kod/KZ-07", headers: magazynier })).json().kosz;
  await app.inject({
    method: "POST",
    url: `/api/kosze/pozycje/${kosz.pozycje[0].id}/pomin`,
    payload: { powod: "nie ma w koszu" },
    headers: magazynier,
  });

  /* Trasa stała nie może wpaść w `/:id` — inaczej „pominiete" poszłoby do
     `szczegolKosza(NaN)` i wróciło 404 zamiast listy. */
  let r = await app.inject({ method: "GET", url: "/api/biuro/kosze/pominiete", headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/kosze/pominiete", headers: biuro });
  assert.equal(r.statusCode, 200, r.body);
  const p = r.json().pominiete;
  assert.equal(p.length, 1);
  assert.equal(p[0].powod, "nie ma w koszu");
  assert.equal(p[0].kod, "KZ-07");
  assert.equal(typeof p[0].dni, "number");

  // szukanie po symbolu ze snapshotu kosza
  r = await app.inject({
    method: "GET", url: "/api/biuro/kosze/szukaj?q=TEST-LINIA", headers: biuro,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().znalezione.length, 2, "obie pozycje kosza niosą ten symbol");

  // kod kreskowy z kartoteki — w koszu go nie ma, więc dochodzi JOIN-em
  r = await app.inject({
    method: "GET", url: "/api/biuro/kosze/szukaj?q=5900000000037", headers: biuro,
  });
  assert.equal(r.json().znalezione.length, 1);
  assert.equal(r.json().znalezione[0].symbol, "TEST-LINIA-DONE");

  // jedna litera to nie zapytanie — odmowa zamiast wyrzucenia całej tabeli
  r = await app.inject({ method: "GET", url: "/api/biuro/kosze/szukaj?q=T", headers: biuro });
  assert.equal(r.statusCode, 400);

  /* ZAŁATWIONE zdejmuje sprawę z listy pracy, ale NIE z kosza: pominięcie
     zostaje, bo hala naprawdę zgłosiła brak. Bez tego rozróżnienia biuro
     mogłoby zamknąć sprawę i stracić ślad, że kosz wrócił niekompletny. */
  const pozycjaId = p[0].pozycjaId;
  r = await app.inject({
    method: "POST", url: `/api/biuro/kosze/pominiete/${pozycjaId}/zalatwione`,
    payload: { notatka: "znalazło się na regale" }, headers: magazynier,
  });
  assert.equal(r.statusCode, 403, "to decyzja biura, nie hali");
  r = await app.inject({
    method: "POST", url: `/api/biuro/kosze/pominiete/${pozycjaId}/zalatwione`,
    payload: { notatka: "znalazło się na regale" }, headers: biuro,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().pominiete, [], "sprawa schodzi z listy pracy");

  // drugie kliknięcie nic nie psuje, a pozycja dalej jest pominięta w koszu
  r = await app.inject({
    method: "POST", url: `/api/biuro/kosze/pominiete/${pozycjaId}/zalatwione`,
    payload: {}, headers: biuro,
  });
  assert.equal(r.statusCode, 200);
  r = await app.inject({ method: "GET", url: `/api/biuro/kosze/${koszId}`, headers: biuro });
  const wKoszu = r.json().kosz.pozycje.find((x: { id: number }) => x.id === pozycjaId);
  assert.equal(wKoszu.status, "skipped");
  assert.equal(wKoszu.zalatwioneNotatka, "znalazło się na regale");

  // odłożenie tej samej pozycji kasuje i pominięcie, i jego zamknięcie
  await app.inject({
    method: "POST", url: `/api/kosze/pozycje/${pozycjaId}/odloz`,
    payload: { lokalizacja: "B02-02-02" }, headers: magazynier,
  });
  r = await app.inject({ method: "GET", url: `/api/biuro/kosze/${koszId}`, headers: biuro });
  const po = r.json().kosz.pozycje.find((x: { id: number }) => x.id === pozycjaId);
  assert.equal(po.status, "done");
  assert.equal(po.zalatwioneAt, null);
});

test("reklamacje i raport odpowiadają przez HTTP z bramką biura", async () => {
  const biuro = zalogowany("biuro");
  const magazynier = zalogowany("magazynier");
  let r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/reklamacje", headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/reklamacje", headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().reklamacje, []);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/raport", headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.equal(typeof r.json().raport.zwroty.razem30dni, "number");
  // statystyki produktowe (0.78.0) — ta sama bramka, okno z zapytania
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/statystyki", headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/statystyki?dni=30", headers: biuro });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().statystyki.dni, 30);
  // nieznane okno nie wywraca trasy, tylko wraca do domyślnego
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/statystyki?dni=abc", headers: biuro });
  assert.equal(r.json().statystyki.dni, 90);
  /* Czasy obsługi (0.80.0) — ta sama bramka. Odpowiedź na pustej bazie ma być
     KOMPLETNA: pięć odcinków, każdy z wyjaśnieniem, dlaczego jest pusty, i
     podstawa prawna monitoringu przy tempie ludzi. */
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/czasy", headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/czasy?dni=30", headers: biuro });
  assert.equal(r.statusCode, 200, r.body);
  const czasy = r.json().czasy;
  assert.equal(czasy.dni, 30);
  assert.equal(czasy.odcinki.length, 5);
  assert.ok(czasy.odcinki.every((o: { czemuPusto: string | null }) => o.czemuPusto));
  assert.match(czasy.podstawaPrawna, /Kodeks pracy/);
  // brakujące paczki (Etap 4) — ta sama bramka biura, pusta lista bez przebiegu tickera
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/zapowiedzi", headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/zapowiedzi", headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().zapowiedzi, []);
  // schowanie zapowiedzi (0.70.0) — bramka biura, a nieznane id to 404, nie 500
  r = await app.inject({ method: "POST", url: "/api/biuro/zwroty/zapowiedzi/1/pomin", payload: {}, headers: magazynier });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "POST", url: "/api/biuro/zwroty/zapowiedzi/1/pomin", payload: {}, headers: biuro });
  assert.equal(r.statusCode, 404);
  // półka reklamacyjna i dyskusje Allegro (Etap 6) — bramka biura
  r = await app.inject({
    method: "PUT", url: "/api/biuro/zwroty/reklamacje/1/polka",
    payload: { polka: "REK-01" }, headers: magazynier,
  });
  assert.equal(r.statusCode, 403);
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/dyskusje", headers: biuro });
  assert.equal(r.statusCode, 200);
  const dyskusje = r.json().dyskusje;
  assert.equal(dyskusje.length, 2, "adapter dev daje rozmowę i formalną reklamację");
  assert.ok(dyskusje.some((y: { typ: string }) => y.typ === "CLAIM"));
});
