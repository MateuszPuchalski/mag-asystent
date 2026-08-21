import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Zapowiedzi zwrotów (Etap 4) ─────────────────────────────────────────────
   Sedno: system zna zgłoszenie ZANIM paczka dojedzie. Ticker upsertuje bez
   duplikatów, skan trafia w zapowiedź po KTÓRYMKOLWIEK numerze paczki
   i odhacza ją, a panel brakujących pokazuje tylko to, co czeka za długo.  */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zapo-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zapowiedzi.js");
let Zw: typeof import("./zwroty.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zapowiedzi.js");
  Zw = await import("./zwroty.js");
});

beforeEach(() => {
  const d = db();
  // zapowiedź wskazuje zwrot (FK), więc schodzi z bazy PRZED zwrotami
  for (const t of ["kosz_pozycja", "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot_zapowiedz", "zwrot", "sfera_queue"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

test("przebieg tickera: upsert bez duplikatów, drugi raz zero nowych", async () => {
  assert.equal(await Z.odswiezZapowiedzi(), 3, "trzy fikcyjne zgłoszenia adaptera dev");
  assert.equal(await Z.odswiezZapowiedzi(), 0, "te same zgłoszenia nie liczą się drugi raz");
  const n = (db().prepare("SELECT COUNT(*) AS n FROM zwrot_zapowiedz").get() as { n: number }).n;
  assert.equal(n, 3);
});

test("skan trafia w zapowiedź po każdym numerze paczki zgłoszenia", async () => {
  await Z.odswiezZapowiedzi();
  // dev-ret-2 ma waybill nadania DEVWB0002 i numer doręczyciela DEVTW0002
  assert.equal(Z.zapowiedzDlaWaybilla("DEVWB0002")?.allegroReturnId, "dev-ret-2");
  assert.equal(Z.zapowiedzDlaWaybilla("DEVTW0002")?.allegroReturnId, "dev-ret-2");
  assert.equal(Z.zapowiedzDlaWaybilla("OBCY-NUMER"), null);
});

test("przyjęcie skanem odhacza zgłoszenie i zdejmuje je z brakujących", async () => {
  await Z.odswiezZapowiedzi();
  // dev-ret-3 czeka 5 dni — powyżej progu 3 dni, więc jest alarmem…
  assert.ok(Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0003"));
  // …a świeże zgłoszenie sprzed dnia (dev-ret-2) alarmem nie jest
  assert.ok(!Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0002"));

  const w = await Zw.utworzZeSkanu("DEVWB0003", "Test");
  assert.equal(w.rodzaj, "utworzony");
  const zap = db()
    .prepare("SELECT status, zwrot_id FROM zwrot_zapowiedz WHERE allegro_return_id='dev-ret-3'")
    .get() as { status: string; zwrot_id: number | null };
  assert.equal(zap.status, "dotarl");
  assert.ok(zap.zwrot_id, "zapowiedź wskazuje przyjęty zwrot");
  assert.ok(!Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0003"));
});

test("zgłoszenie zwrotu przyjętego PRZED przebiegiem rodzi się jako dotarłe", async () => {
  // paczka wyprzedziła ticker: najpierw skan…
  const w = await Zw.utworzZeSkanu("DEVWB0001", "Test");
  assert.equal(w.rodzaj, "utworzony");
  // …potem pierwszy przebieg — zgłoszenie nie ma prawa wisieć wśród brakujących
  await Z.odswiezZapowiedzi();
  const zap = db()
    .prepare("SELECT status FROM zwrot_zapowiedz WHERE allegro_return_id='dev-ret-1'")
    .get() as { status: string };
  assert.equal(zap.status, "dotarl");
});

test("liczby do raportu: oczekujące, alarmy i doręczone-nieprzyjęte osobno", async () => {
  await Z.odswiezZapowiedzi();
  const l = Z.liczbyZapowiedzi();
  assert.equal(l.oczekujace, 3);
  /* dev-ret-1 jest DELIVERED (paczka u nas, nikt nie skanował), dev-ret-3
     jedzie piąty dzień — oba alarmują. dev-ret-2 nadano wczoraj: cisza. */
  assert.equal(l.brakujace, 2);
  assert.equal(l.doreczoneNieprzyjete, 1);
});

test("status Allegro rozstrzyga stan zgłoszenia; nieznany nie chowa paczki", () => {
  for (const s of ["FINISHED", "FINISHED_APT", "REJECTED", "COMMISSION_REFUNDED",
                   "COMMISSION_REFUND_CLAIMED", "WAREHOUSE_DELIVERED", "WAREHOUSE_VERIFICATION"]) {
    assert.equal(Z.stanZgloszenia(s), "zamknieta", s);
  }
  assert.equal(Z.stanZgloszenia("DELIVERED"), "doreczona");
  assert.equal(Z.stanZgloszenia(" delivered "), "doreczona", "wielkość liter i spacje nie decydują");
  for (const s of ["CREATED", "IN_TRANSIT", "NOWY_STATUS_Z_PRZYSZLOSCI", "", null]) {
    assert.equal(Z.stanZgloszenia(s), "w_drodze", String(s));
  }
});

test("sprawa zamknięta w panelu Allegro schodzi z listy sama", async () => {
  /* To był fałszywy alarm z produkcji: zwrot zgłoszony 10 sierpnia, doręczony,
     rozliczony w panelu — a karta pokazywała „11 dni bez paczki", bo nikt go
     u nas nie skanował i nie czytaliśmy statusu z Allegro. */
  await Z.odswiezZapowiedzi();
  assert.ok(Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0003"));
  db()
    .prepare("UPDATE zwrot_zapowiedz SET status_allegro='FINISHED' WHERE allegro_return_id='dev-ret-3'")
    .run();
  assert.ok(!Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0003"));
  assert.equal(Z.liczbyZapowiedzi().oczekujace, 2, "zamknięta sprawa nie jest już naszą pracą");
});

test("doręczona paczka alarmuje NATYCHMIAST, bez czekania na próg", async () => {
  await Z.odswiezZapowiedzi();
  // dev-ret-2 nadano wczoraj — poniżej progu, więc na liście go nie ma…
  assert.ok(!Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0002"));
  db()
    .prepare("UPDATE zwrot_zapowiedz SET status_allegro='DELIVERED' WHERE allegro_return_id='dev-ret-2'")
    .run();
  // …a gdy przewoźnik dostarczył, paczka leży u nas nieprzyjęta i próg nie ma nic do rzeczy
  const lista = Z.brakujacePaczki();
  assert.ok(lista.some((b) => b.referencja === "ZW-DEV-0002"));
  assert.equal(lista[0].stan, "doreczona", "doręczone stoją nad tymi w drodze");
});

test("stare zgłoszenie dostaje status po id — lista przyrostowa go nie pokaże", async () => {
  /* Zgłoszenie z produkcji 29YN/2026: zwrot doręczony 10 sierpnia i rozliczony
     12-go wisiał u nas jako „w drodze" bez końca. Lista zwrotów filtruje po
     dacie UTWORZENIA, więc okno przyrostowe nigdy po niego nie wróciło,
     a status został pusty z migracji. */
  await Z.odswiezZapowiedzi();
  const d = db();
  d.prepare(
    "UPDATE zwrot_zapowiedz SET status_allegro=NULL, widziano_at='2020-01-01T00:00:00.000Z'"
  ).run();
  /* Bez statusu wszystko wygląda na „w drodze", więc alarmują te powyżej progu
     (dev-ret-1 i dev-ret-3); wczorajsze dev-ret-2 wciąż grzecznie czeka. */
  assert.equal(Z.brakujacePaczki().length, 2);

  assert.equal(await Z.odswiezStatusyOczekujacych(), 3);
  const statusy = d
    .prepare("SELECT allegro_return_id AS id, status_allegro AS s FROM zwrot_zapowiedz ORDER BY id")
    .all() as Array<{ id: string; s: string | null }>;
  // wiersze z SQLite mają null-prototype — porównujemy zwykłe obiekty
  assert.deepEqual(statusy.map((r) => ({ id: r.id, s: r.s })), [
    { id: "dev-ret-1", s: "DELIVERED" },
    { id: "dev-ret-2", s: "CREATED" },
    { id: "dev-ret-3", s: "CREATED" },
  ]);

  // świeżo odświeżonych nie pytamy drugi raz w kółko
  assert.equal(await Z.odswiezStatusyOczekujacych(), 0);
});

test("odświeżenie zdejmuje z listy zwrot zamknięty w Allegro", async () => {
  await Z.odswiezZapowiedzi();
  const d = db();
  // zgłoszenie sprzed wdrożenia: status pusty, dawno niewidziane
  d.prepare(
    `UPDATE zwrot_zapowiedz SET status_allegro=NULL, widziano_at='2020-01-01T00:00:00.000Z'
      WHERE allegro_return_id='dev-ret-3'`
  ).run();
  assert.ok(Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0003"));
  /* Adapter dev odda dla tego zwrotu status CREATED, więc żeby zmierzyć samo
     zejście z listy, podmieniamy odpowiedź na sprawę zamkniętą. */
  const adapter = (await import("../adapters/allegro.js")).allegroAdapter();
  const oryginal = adapter.zwrot.bind(adapter);
  adapter.zwrot = async (id: string) => {
    const z = await oryginal(id);
    return z && id === "dev-ret-3" ? { ...z, status: "FINISHED" } : z;
  };
  try {
    assert.equal(await Z.odswiezStatusyOczekujacych(), 1);
  } finally {
    adapter.zwrot = oryginal;
  }
  assert.ok(!Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0003"));
});

test("jedno zgłoszenie w błędzie nie zatrzymuje całej partii", async () => {
  /* Bez łapania błędu per zgłoszenie pierwszy zwrot kończący się wyjątkiem
     przerywał przebieg i CAŁA reszta nigdy nie dostawała statusu — a na
     ekranie wyglądało to jak „ticker nie działa". */
  await Z.odswiezZapowiedzi();
  const d = db();
  d.prepare(
    "UPDATE zwrot_zapowiedz SET status_allegro=NULL, widziano_at='2020-01-01T00:00:00.000Z'"
  ).run();

  const adapter = (await import("../adapters/allegro.js")).allegroAdapter();
  const oryginal = adapter.zwrot.bind(adapter);
  adapter.zwrot = async (id: string) => {
    if (id === "dev-ret-1") throw new Error("Brak uprawnienia do zwrotów klienckich (403)");
    return oryginal(id);
  };
  try {
    assert.equal(await Z.odswiezStatusyOczekujacych(), 2, "dwa pozostałe mimo błędu pierwszego");
  } finally {
    adapter.zwrot = oryginal;
  }

  const t = Z.stanOdswiezania()!;
  assert.equal(t.bledow, 1);
  assert.match(t.ostatniBlad ?? "", /403/);
  assert.equal(t.doOdswiezenia, 1, "wiersz w błędzie wciąż czeka na status");
  /* Znacznik czasu zostaje nietknięty, więc ten sam wiersz wraca przy kolejnym
     przebiegu — błąd Allegro bywa chwilowy. */
  assert.equal(await Z.odswiezStatusyOczekujacych(), 1);
  assert.equal(Z.stanOdswiezania()!.doOdswiezenia, 0);
});

test("SCHOWAJ zdejmuje zgłoszenie z listy raz i tylko raz", async () => {
  await Z.odswiezZapowiedzi();
  const cel = Z.brakujacePaczki().find((b) => b.referencja === "ZW-DEV-0003")!;
  assert.equal(Z.pominZapowiedz(cel.id, "Biuro"), true);
  assert.ok(!Z.brakujacePaczki().some((b) => b.id === cel.id));
  assert.equal(Z.pominZapowiedz(cel.id, "Biuro"), false, "drugie kliknięcie nie ma czego chować");
  assert.equal(Z.pominZapowiedz(999_999, "Biuro"), false);
  /* Schowanie NIE blokuje przyjęcia: paczka może się jednak znaleźć, a skan
     szuka po numerze przesyłki, nie po stanie wiersza. */
  const w = await Zw.utworzZeSkanu("DEVWB0003", "Test");
  assert.equal(w.rodzaj, "utworzony");
});
