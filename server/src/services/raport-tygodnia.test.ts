import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-tydzien-"));
process.env.DB_PATH = path.join(dir, "wertis.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";
process.env.STREFA_CZASU = "Europe/Warsaw";

/* ── Raport tygodnia i migawka doby ──────────────────────────────────────────
   Pilnujemy czterech obietnic z nagłówka `raport-tygodnia.ts`:
   1. GRANICE STAŁE i lokalne — zdarzenie z niedzieli 23:30 jest niedzielą,
      a z poniedziałku 00:00 już następnym tygodniem.
   2. Te same reguły co Analiza — rozłożenie liczone raz, nie dwa razy.
   3. Automat nadrabia, nie powtarza, i nie robi tygodnia, którego dziennik
      nie obejmuje w całości.
   4. Żadnych ludzi w zapisanym raporcie.                                   */

let d: DatabaseSync;
let R: typeof import("./raport-tygodnia.js");

/* Tydzień 38 roku 2026: poniedziałek 14 września, czas letni (UTC+2).
   Zamyka się w poniedziałek 21 września o 00:00, czyli 20 września 22:00 UTC. */
const PO_ZAMKNIECIU = Date.parse("2026-09-20T22:30:00.000Z");

function zdarzenie(typ: string, at: string, payload: unknown = null, kto = "Jan Wrona") {
  d.prepare("INSERT INTO events(type, payload, user_id, created_at) VALUES (?,?,?,?)")
    .run(typ, payload == null ? null : JSON.stringify(payload), kto, at);
}

before(async () => {
  const { db } = await import("../db/db.js");
  d = db();
  R = await import("./raport-tygodnia.js");
  /* Dziennik zaczyna się 10 września — tydzień 37 (7–13 IX) jest więc
     niepełny i automat ma go pominąć. */
  zdarzenie("login", "2026-09-10T08:00:00.000Z");

  // ── praca hali w tygodniu 38 ──
  zdarzenie("putaway_line_done", "2026-09-14T06:00:00.000Z");
  // ta sama czynność, drugi wiersz z rozkładania — `bezDubli` ma go odsiać
  zdarzenie("location_set", "2026-09-14T06:00:01.000Z", { zrodlo: "putaway" });
  zdarzenie("location_set", "2026-09-15T10:00:00.000Z", { zrodlo: "karta" });
  // niedziela 23:30 lokalnie = 21:30 UTC — ostatnia chwila tygodnia
  zdarzenie("putaway_line_done", "2026-09-20T21:30:00.000Z");
  // poniedziałek 00:00 lokalnie — już tydzień 39
  zdarzenie("putaway_line_done", "2026-09-20T22:00:00.000Z");
  // niedziela 13 IX — tydzień 37
  zdarzenie("putaway_line_done", "2026-09-13T12:00:00.000Z");
  zdarzenie("manual_entry", "2026-09-15T10:00:00.000Z", { code: "R-09-4", kind: "LOC" });
  zdarzenie("search", "2026-09-16T10:00:00.000Z", { q: "Szarpak", wynikow: 0 });
  zdarzenie("search", "2026-09-16T11:00:00.000Z", { q: "szarpak", wynikow: 0 });
  zdarzenie("search", "2026-09-16T12:00:00.000Z", { q: "linka", wynikow: 3 });
  zdarzenie("kopia_bazy", "2026-09-15T00:30:00.000Z", { plik: "noc-2026-09-15.db" });
  zdarzenie("rekoncyliacja", "2026-09-15T00:31:00.000Z", { rozjazdow: 4 });
  zdarzenie("rekoncyliacja", "2026-09-16T00:31:00.000Z", { rozjazdow: 1 });
  // uszkodzony payload nie może położyć raportu (blizna S59)
  zdarzenie("search", "2026-09-17T10:00:00.000Z");
  d.prepare("UPDATE events SET payload = '{ucięty payload' WHERE created_at = '2026-09-17T10:00:00.000Z'").run();

  // ── obsługa klienta ──
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','sprzedawca')").run().lastInsertRowid);
  let n = 0;
  const rozmowa = () => Number(d.prepare(
    "INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (?,?)")
    .run(konto, `w-${++n}`).lastInsertRowid);
  const wiad = (r: number, kier: string, at: string) => d.prepare(`INSERT INTO message(conversation_id,
      channel_account_id,external_message_id,direction,body,sent_at) VALUES (?,?,?,?,?,?)`)
    .run(r, konto, `m-${++n}`, kier, "treść", at);
  const r1 = rozmowa();
  wiad(r1, "incoming", "2026-09-18T08:00:00.000Z");
  wiad(r1, "outgoing", "2026-09-18T08:30:00.000Z");
  // pytanie w niedzielę wieczorem, odpowiedź w poniedziałek — w tygodniu 38
  // to klient, który czeka na zamknięcie, a nie odpowiedź
  const r2 = rozmowa();
  wiad(r2, "incoming", "2026-09-20T20:00:00.000Z");
  wiad(r2, "outgoing", "2026-09-21T06:00:00.000Z");
});

test("automat: migawka doby i raport jedynego pełnego tygodnia", () => {
  const w = R.przebiegRaportow(d, PO_ZAMKNIECIU);
  assert.equal(w.migawka, "2026-09-21", "doba lokalna, nie UTC");
  assert.deepEqual(w.raporty, ["2026-W38"], "tydzień 37 zaczął się przed pierwszym wpisem dziennika");

  const znowu = R.przebiegRaportow(d, PO_ZAMKNIECIU + 3_600_000);
  assert.deepEqual(znowu, { migawka: null, raporty: [] }, "druga runda tej samej doby");

  const wpisy = d.prepare("SELECT type FROM events WHERE type IN ('migawka_dnia','raport_tygodnia') ORDER BY id")
    .all() as Array<{ type: string }>;
  assert.deepEqual(wpisy.map((x) => x.type), ["migawka_dnia", "raport_tygodnia"]);
});

test("granice: poniedziałek 00:00 do poniedziałku 00:00 czasu magazynu", () => {
  const { raport } = R.raportTygodnia("2026-W38", d)!;
  assert.equal(raport.od, "2026-09-13T22:00:00.000Z");
  assert.equal(raport.do, "2026-09-20T22:00:00.000Z");
  assert.deepEqual(raport.dni, ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17",
    "2026-09-18", "2026-09-19", "2026-09-20"]);
  // poniedziałek: rozłożenie bez dubla; wtorek: zmiana z karty; niedziela: 23:30
  assert.deepEqual(raport.magazyn.pozycjeWgDnia, [1, 1, 0, 0, 0, 0, 1]);
  assert.equal(raport.magazyn.pozycje, 3);
});

test("magazyn i system: te same reguły co Analiza", () => {
  const { raport } = R.raportTygodnia("2026-W38", d)!;
  assert.deepEqual(raport.magazyn.etykietyDoPrzedruku, [{ kod: "R-09-4", reczne: 1 }]);
  assert.deepEqual(raport.magazyn.szukaniaBezWynikow, [{ q: "szarpak", ile: 2 }],
    "bez wielkości liter, bez zapytań z wynikiem");
  assert.equal(raport.magazyn.dotknieciaNaPozycje, 0.33);
  assert.equal(raport.system.kopieNocne, 1);
  assert.equal(raport.system.rozjazdyRekoncyliacji, 1, "OSTATNIA rekoncyliacja tygodnia, nie suma");
});

test("obsługa: odpowiedź po zamknięciu tygodnia nie wchodzi, klient czeka na koniec", () => {
  const { raport } = R.raportTygodnia("2026-W38", d)!;
  assert.equal(raport.obsluga.wiadomosciOdKlientow, 2);
  assert.equal(raport.obsluga.odpowiedzi, 1);
  assert.equal(raport.obsluga.medianaMin, 30);
  assert.deepEqual(raport.obsluga.klientCzekaNaKoniec, { n: 1, najdluzejMin: 120 });
});

test("migawka: stan z tych samych funkcji co ekrany, w raporcie jako koniec tygodnia", () => {
  const { raport } = R.raportTygodnia("2026-W38", d)!;
  assert.equal(raport.migawki.length, 1);
  const m = raport.migawki[0];
  assert.equal(m.data, "2026-09-21");
  assert.notEqual(m.stan.doDecyzji, null, "sekcja policzona, a nie połknięta przez wyjątek");
  assert.notEqual(m.stan.zwroty, null);
  assert.notEqual(m.stan.reklamacje, null);
  assert.deepEqual(m.stan.kolejka, { bledy: 0, wDrodze: 0 });
});

test("zapisany raport nie niesie ludzi", () => {
  const { dane } = d.prepare("SELECT dane FROM raport_tygodnia WHERE tydzien = '2026-W38'").get() as { dane: string };
  assert.ok(!dane.includes("Jan Wrona"), "nazwisko z dziennika nie trafia do raportu");
});

test("poprzedni tydzień po granicy; raport zamrożony, a nie liczony od nowa", () => {
  assert.equal(R.raportTygodnia("2026-W38", d)!.poprzedni, null, "tygodnia 37 nie policzono");
  // dziennik sięga teraz dalej wstecz — automat nadrabia tydzień 37
  zdarzenie("login", "2026-09-01T08:00:00.000Z");
  const w = R.przebiegRaportow(d, PO_ZAMKNIECIU + 7_200_000);
  assert.deepEqual(w.raporty, ["2026-W37"]);
  const { raport, poprzedni } = R.raportTygodnia("2026-W38", d)!;
  assert.equal(poprzedni?.tydzien, "2026-W37");
  assert.equal(poprzedni?.magazyn.pozycje, 1);
  // zdarzenie dopisane po fakcie nie zmienia zapisanego tygodnia
  zdarzenie("putaway_line_done", "2026-09-16T09:00:00.000Z");
  assert.equal(R.raportTygodnia("2026-W38", d)!.raport.magazyn.pozycje, raport.magazyn.pozycje);
  assert.deepEqual(R.listaRaportow(d).map((x) => x.tydzien), ["2026-W38", "2026-W37"]);
});

test("tydzień przełomu roku: 2026-W53 poprzedza 2027-W01", async () => {
  const { tydzienIso, dodajDni } = await import("../czas.js");
  assert.equal(tydzienIso(dodajDni("2027-01-04", -7)).tydzien, "2026-W53");
});
