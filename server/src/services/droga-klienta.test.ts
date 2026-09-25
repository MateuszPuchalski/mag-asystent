import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-droga-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Droga klienta przez cztery kolejki (`docs/obsluga-klienta-calosc.md`) ───
   Testy pilnują trzech granic, nie kształtu wiersza.

   PIERWSZA: mostkiem jest numer zamówienia, nigdy login kupującego
   (blizna 0.56.6). DRUGA: konto jest w warunku — sprawa z cudzego konta nie ma
   prawa pokazać się na naszym ekranie. TRZECIA: droga jest ODCZYTEM, więc
   wyliczenie przeskoku nie zapisuje niczego (blizna 0.18.0).             */

let db: typeof import("../db/db.js").db;
let sprawyZakupu: typeof import("./droga-klienta.js").sprawyZakupu;
let drogaZakupu: typeof import("./droga-klienta.js").drogaZakupu;
let eskalacje: typeof import("./droga-klienta.js").eskalacje;
let kontekstZwrotu: typeof import("./droga-klienta.js").kontekstZwrotu;
let mojeSprawy: typeof import("./droga-klienta.js").mojeSprawy;

let konto = 0;
let obce = 0;
let rozmowa = 0;
let agent = 0;

const ZAM = "ord-1";

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ sprawyZakupu, drogaZakupu, eskalacje, kontekstZwrotu, mojeSprawy } =
    await import("./droga-klienta.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["reklamacja_klienta", "zwrot_klienta", "message", "conversation_event", "conversation",
    "channel_account", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();

  agent = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);

  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  obce = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-b')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-1','Szarpak')`).run(konto).lastInsertRowid);
});

const wiadomosc = (at: string, zam: string | null = ZAM, rozm = rozmowa, kto = konto) =>
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,related_order_id,sent_at) VALUES (?,?,?,'incoming','tresc',?,?)`)
    .run(rozm, kto, `m-${at}-${rozm}`, zam, at);

const sprawa = (typ: string, at: string, zam: string | null = ZAM, kto = konto,
  status: string | null = null) =>
  Number(db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
    reference_number,order_id,typ,temat,status_allegro,otwarto_at,synced_at)
    VALUES (?,?,?,?,?,'Nie działa',?,?,'2026-09-17T00:00:00Z')`)
    .run(kto, `s-${typ}-${at}-${kto}`, typ === "CLAIM" ? "12/2026" : null, zam, typ, status, at)
    .lastInsertRowid);

const zwrot = (at: string, zam: string | null = ZAM, kto = konto) =>
  Number(db().prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,
    order_id,created_at,synced_at) VALUES (?,?,'Z-1',?,?,'2026-09-17T00:00:00Z')`)
    .run(kto, `z-${at}-${kto}`, zam, at).lastInsertRowid);

test("skrzynka widzi sprawę posprzedażową tego zakupu — siedem brakujących wiązań", () => {
  const rek = sprawa("CLAIM", "2026-09-10T08:00:00Z");
  sprawa("DISPUTE", "2026-09-05T08:00:00Z");

  const lista = sprawyZakupu(db(), konto, ZAM);
  assert.deepEqual(lista.map((s) => s.typ), ["CLAIM", "DISPUTE"]);
  assert.equal(lista[0]!.id, rek);
  /* Numer nadaje Allegro wyłącznie reklamacji — dyskusja go nie ma (§25c.1). */
  assert.equal(lista[0]!.numer, "12/2026");
  assert.equal(lista[1]!.numer, null);
});

test("sprawa nie pokazuje w rodzeństwie samej siebie", () => {
  const rek = sprawa("CLAIM", "2026-09-10T08:00:00Z");
  sprawa("DISPUTE", "2026-09-05T08:00:00Z");

  assert.deepEqual(sprawyZakupu(db(), konto, ZAM, rek).map((s) => s.typ), ["DISPUTE"]);
});

test("sprawa z cudzego konta nie wchodzi na nasz ekran", () => {
  sprawa("CLAIM", "2026-09-10T08:00:00Z", ZAM, obce);

  assert.deepEqual(sprawyZakupu(db(), konto, ZAM), []);
  assert.deepEqual(drogaZakupu(db(), konto, ZAM), []);
});

test("zamknięta sprawa przestaje być otwarta, a nieznany status jej nie zamyka", () => {
  sprawa("CLAIM", "2026-09-10T08:00:00Z", ZAM, konto, "CLAIM_ACCEPTED");
  sprawa("DISPUTE", "2026-09-05T08:00:00Z", ZAM, konto, "NOWY_STATUS_ALLEGRO");

  const lista = sprawyZakupu(db(), konto, ZAM);
  assert.equal(lista[0]!.otwarta, false);
  assert.equal(lista[1]!.otwarta, true);
});

test("droga układa przystanki w kolejności czasu, a nie kolejek", () => {
  wiadomosc("2026-09-01T08:00:00Z");
  sprawa("DISPUTE", "2026-09-03T08:00:00Z");
  sprawa("CLAIM", "2026-09-06T08:00:00Z");
  zwrot("2026-09-08T08:00:00Z");

  assert.deepEqual(drogaZakupu(db(), konto, ZAM).map((p) => p.rodzaj),
    ["rozmowa", "dyskusja", "reklamacja", "zwrot"]);
});

test("rozmowa wchodzi na drogę PIERWSZĄ wiadomością o tym zakupie", () => {
  /* Wątek bywa starszy od zakupu, bo klient pytał przed nim. Data założenia
     wątku postawiłaby rozmowę przed zakupem, którego jeszcze nie było. */
  wiadomosc("2026-09-07T08:00:00Z");
  wiadomosc("2026-09-02T08:00:00Z");
  sprawa("CLAIM", "2026-09-04T08:00:00Z");

  const droga = drogaZakupu(db(), konto, ZAM);
  assert.deepEqual(droga.map((p) => p.rodzaj), ["rozmowa", "reklamacja"]);
  assert.equal(droga[0]!.at, "2026-09-02T08:00:00Z");
});

test("wiadomość bez numeru zamówienia nie tworzy przystanku", () => {
  wiadomosc("2026-09-01T08:00:00Z", null);

  assert.deepEqual(drogaZakupu(db(), konto, ZAM), []);
});

test("droga niczego nie zapisuje — otwarcie ekranu nie mutuje", () => {
  wiadomosc("2026-09-01T08:00:00Z");
  sprawa("CLAIM", "2026-09-04T08:00:00Z");
  const przed = Number(db().prepare("SELECT COUNT(*) AS n FROM events").get()!.n);

  drogaZakupu(db(), konto, ZAM);
  sprawyZakupu(db(), konto, ZAM);
  eskalacje(db(), konto);

  assert.equal(Number(db().prepare("SELECT COUNT(*) AS n FROM events").get()!.n), przed);
});

test("eskalacja liczy zakupy, nie sprawy i nie wiadomości", () => {
  /* Trzy wiadomości i jedna reklamacja przy jednym zakupie to JEDNA eskalacja.
     Liczenie wiadomości nagradzałoby milczenie agenta. */
  wiadomosc("2026-09-01T08:00:00Z");
  wiadomosc("2026-09-02T08:00:00Z");
  wiadomosc("2026-09-03T08:00:00Z");
  sprawa("CLAIM", "2026-09-04T08:00:00Z");
  sprawa("DISPUTE", "2026-09-05T08:00:00Z");

  assert.deepEqual(eskalacje(db(), konto), [
    { miesiac: "2026-09", zRozmowa: 1, eskalowane: 1 },
  ]);
});

test("reklamacja złożona BEZ pytania do nas nie jest eskalacją", () => {
  /* Nie było odpowiedzi, więc nie ma o czym mówić. Ta różnica dzieli miarę
     obsługi od licznika reklamacji. */
  sprawa("CLAIM", "2026-09-04T08:00:00Z", "ord-bez-rozmowy");
  wiadomosc("2026-09-01T08:00:00Z");

  assert.deepEqual(eskalacje(db(), konto), [
    { miesiac: "2026-09", zRozmowa: 1, eskalowane: 0 },
  ]);
});

test("sprawa starsza od pierwszej wiadomości nie wynika z naszej odpowiedzi", () => {
  sprawa("CLAIM", "2026-09-01T08:00:00Z");
  wiadomosc("2026-09-04T08:00:00Z");

  assert.deepEqual(eskalacje(db(), konto), [
    { miesiac: "2026-09", zRozmowa: 1, eskalowane: 0 },
  ]);
});

test("eskalacje idą miesiącami, od najnowszego", () => {
  wiadomosc("2026-08-01T08:00:00Z", "ord-sierpien");
  sprawa("CLAIM", "2026-08-03T08:00:00Z", "ord-sierpien");
  wiadomosc("2026-09-01T08:00:00Z");

  assert.deepEqual(eskalacje(db(), konto).map((m) => m.miesiac), ["2026-09", "2026-08"]);
});

test("bez numeru zamówienia odczyty milczą, zamiast zgadywać", () => {
  assert.deepEqual(sprawyZakupu(db(), konto, null), []);
  assert.deepEqual(drogaZakupu(db(), konto, null), []);
});

test("zwrot dostaje kontekst po SWOIM koncie, bez pytania trasy o konto", () => {
  const id = zwrot("2026-09-08T08:00:00Z");
  sprawa("CLAIM", "2026-09-06T08:00:00Z");
  wiadomosc("2026-09-01T08:00:00Z");

  const k = kontekstZwrotu(db(), id);
  assert.deepEqual(k.sprawy.map((s) => s.typ), ["CLAIM"]);
  assert.deepEqual(k.droga.map((p) => p.rodzaj), ["rozmowa", "reklamacja", "zwrot"]);
});

test("zwrot, którego nie ma, oddaje pustkę zamiast wyjątku", () => {
  assert.deepEqual(kontekstZwrotu(db(), 9999), { sprawy: [], droga: [] });
});

/* ── S4 spoiwa: jedno „Moje" ponad kolejkami ────────────────────────────────
   Agent miał cztery sita „Moje" i musiał odwiedzić każde z osobna.         */

test("moje sprawy schodzą z trzech kolejek w jedną listę", () => {
  const d = db();
  d.prepare("UPDATE conversation SET assigned_user_id=?, status='open' WHERE id=?")
    .run(agent, rozmowa);
  const rek = sprawa("CLAIM", "2026-09-06T08:00:00Z");
  const dys = sprawa("DISPUTE", "2026-09-02T08:00:00Z");
  d.prepare("UPDATE reklamacja_klienta SET prowadzi_user_id=? WHERE id IN (?,?)")
    .run(agent, rek, dys);

  const moje = mojeSprawy(d, agent);
  assert.deepEqual(moje.map((m) => m.kolejka).sort(), ["dyskusja", "reklamacja", "rozmowa"]);
});

test("cudza sprawa nie wchodzi na moją listę", () => {
  const d = db();
  const rek = sprawa("CLAIM", "2026-09-06T08:00:00Z");
  const ktoInny = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','biuro')")
    .run().lastInsertRowid);
  d.prepare("UPDATE reklamacja_klienta SET prowadzi_user_id=? WHERE id=?").run(ktoInny, rek);

  assert.deepEqual(mojeSprawy(d, agent), []);
});

test("sprawa zamknięta i rozmowa zamknięta schodzą z listy roboczej", () => {
  const d = db();
  d.prepare("UPDATE conversation SET assigned_user_id=?, status='closed' WHERE id=?")
    .run(agent, rozmowa);
  const rek = sprawa("CLAIM", "2026-09-06T08:00:00Z", ZAM, konto, "CLAIM_ACCEPTED");
  d.prepare("UPDATE reklamacja_klienta SET prowadzi_user_id=? WHERE id=?").run(agent, rek);

  assert.deepEqual(mojeSprawy(d, agent), []);
});

test("sprawa z terminem staje NAD sprawą ruszoną dawniej, bez terminu", () => {
  /* Jedno pole na oba zegary postawiłoby dyskusję ruszoną 1 września nad
     reklamacją z terminem 2 września. To jest blizna 0.121.0 w miniaturze. */
  const d = db();
  const pilna = sprawa("CLAIM", "2026-09-06T08:00:00Z");
  const luzna = sprawa("DISPUTE", "2026-09-01T08:00:00Z");
  d.prepare("UPDATE reklamacja_klienta SET prowadzi_user_id=? WHERE id IN (?,?)")
    .run(agent, pilna, luzna);
  d.prepare("UPDATE reklamacja_klienta SET decyzja_do='2026-09-02T00:00:00Z' WHERE id=?")
    .run(pilna);

  const moje = mojeSprawy(d, agent);
  assert.equal(moje[0]!.id, pilna);
  assert.equal(moje[0]!.terminDo, "2026-09-02T00:00:00Z");
});

test("zwrot NIE wchodzi na moją listę — właściciel zdjął prowadzącego w 0.370.0", () => {
  const d = db();
  const id = zwrot("2026-09-08T08:00:00Z");
  /* Kolumna została w tabeli, więc test wpisuje do niej wprost: gdyby ktoś
     wskrzesił zwroty na tej liście, ten wiersz by się pokazał. */
  d.prepare("UPDATE zwrot_klienta SET prowadzi_user_id=? WHERE id=?").run(agent, id);

  assert.deepEqual(mojeSprawy(d, agent), []);
});

test("moja lista niczego nie zapisuje", () => {
  const d = db();
  d.prepare("UPDATE conversation SET assigned_user_id=?, status='open' WHERE id=?")
    .run(agent, rozmowa);
  const przed = Number(d.prepare("SELECT COUNT(*) AS n FROM events").get()!.n);

  mojeSprawy(d, agent);

  assert.equal(Number(d.prepare("SELECT COUNT(*) AS n FROM events").get()!.n), przed);
});

/* ── Wiązanie obustronne przy ręcznie wskazanym zamówieniu (0.502.0) ───────
   Rozmowa bez numeru w wiadomościach, której zamówienie wskazał agent.
   Skrzynka widziała jej zwrot od 0.397.0; zwrot, droga zakupu i szukanie
   rozmowy nie widziały. Test chodzi mostkiem w OBIE strony, bo wiązanie
   jednostronne to wiązanie, którego nie ma.                               */
const wskaz = (numer: string, rozm = rozmowa) => db().prepare(`INSERT INTO conversation_event(
    conversation_id, event_type, payload) VALUES (?, 'order_linked_manually',
    json_object('externalId', ?, 'autor', 'A. Lewandowska'))`).run(rozm, numer);

test("zamówienie wskazane ręcznie wiąże rozmowę w obie strony: droga, zwrot, eskalacja", async () => {
  const { listaZwrotow } = await import("./zwroty.js");
  const { numerZamowieniaRozmowy } = await import("./zamowienia-kandydaci.js");
  wiadomosc("2026-09-10T08:00:00Z", null);
  wskaz("inny");
  wskaz(ZAM);
  const idZwrotu = zwrot("2026-09-12T08:00:00Z");

  assert.equal(numerZamowieniaRozmowy(rozmowa, db())?.externalId, ZAM, "strona skrzynki");
  const droga = drogaZakupu(db(), konto, ZAM);
  assert.deepEqual(droga.map((p) => p.rodzaj), ["rozmowa", "zwrot"], "strona drogi zakupu");
  assert.equal(droga[0].at, "2026-09-10T08:00:00Z", "rozmowa staje pierwszą wiadomością, nie chwilą wskazania");
  const z = listaZwrotow(db(), Date.parse("2026-09-20T00:00:00Z"), { channelAccountId: konto, orderId: ZAM });
  assert.equal(z.find((w) => w.id === idZwrotu)?.rozmowy.map((r) => r.id)[0], rozmowa, "strona zwrotu");
  assert.equal(drogaZakupu(db(), konto, "inny").length, 0, "liczy się ostatnie wskazanie");
  sprawa("CLAIM", "2026-09-15T08:00:00Z");
  assert.deepEqual(eskalacje(db(), konto).map((m) => m.eskalowane), [1]);
});

test("numer z wiadomości bije wskazanie — jak w `numerZamowieniaRozmowy`", () => {
  wiadomosc("2026-09-10T08:00:00Z", "z-wiadomosci");
  wskaz(ZAM);
  zwrot("2026-09-12T08:00:00Z");
  assert.deepEqual(drogaZakupu(db(), konto, ZAM).map((p) => p.rodzaj), ["zwrot"]);
  assert.deepEqual(drogaZakupu(db(), konto, "z-wiadomosci").map((p) => p.rodzaj), ["rozmowa"]);
});

test("rozmowa z cudzego konta nie wchodzi do zwrotu, choć niesie ten sam numer", async () => {
  const { listaZwrotow } = await import("./zwroty.js");
  const obca = Number(db().prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-obca','Obca')`).run(obce).lastInsertRowid);
  wiadomosc("2026-09-10T08:00:00Z", ZAM, obca, obce);
  const idZwrotu = zwrot("2026-09-12T08:00:00Z");
  const z = listaZwrotow(db(), Date.parse("2026-09-20T00:00:00Z"), { channelAccountId: konto, orderId: ZAM });
  assert.deepEqual(z.find((w) => w.id === idZwrotu)?.rozmowy, []);
});

/* STRAŻNIK ŹRÓDŁA: rozmowy zamówienia czyta się wyłącznie przez
   `ROZMOWA_ZAMOWIENIA`. Surowe `related_order_id =` albo `IN (` w serwisie
   wróciłoby do wiązania jednostronnego bez jednego czerwonego testu.
   Zwolnione: sama relacja, reguła jednej rozmowy (`numerZamowieniaRozmowy`),
   klasyfikator czytający własne wiadomości i wiersz osi pojedynczej wiadomości. */
test("rozmowy zamówienia tylko przez ROZMOWA_ZAMOWIENIA", () => {
  const katalog = new URL(".", import.meta.url);
  const zwolnione = new Set(["droga-klienta.ts", "zamowienia-kandydaci.ts", "copilot-klasyfikacja.ts"]);
  const zle: string[] = [];
  for (const plik of fs.readdirSync(katalog)) {
    if (!plik.endsWith(".ts") || plik.endsWith(".test.ts") || zwolnione.has(plik)) continue;
    const tresc = fs.readFileSync(new URL(plik, katalog), "utf8");
    if (/related_order_id\s*(=|IN\s*\()/.test(tresc)) zle.push(plik);
  }
  assert.deepEqual(zle, []);
});
