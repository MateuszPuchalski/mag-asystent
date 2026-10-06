import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* Baza w pamięci na każdy test, ale ścieżka domyślna i tak wskazuje katalog
   tymczasowy. Wpis dziennika bez jawnej bazy nie ma prawa trafić do bazy
   deweloperskiej. */
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-na-zywo-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Przepływ kategorii na żywo ─────────────────────────────────────────────
   Pierwsza droga do klienta bez kliknięcia człowieka. Każdy warunek ma tu
   test, w którym jest JEDYNYM powodem pominięcia, a dziennik musi nazwać
   właśnie jego. Bez warunku albo wychodzi wysyłka, albo pada inny powód,
   więc test zauważa brak. Allegro jest atrapą, nic nie idzie w sieć. */

let N: typeof import("./przeplyw-na-zywo.js");
let K: typeof import("./przeplyw-kategorii.js");
let W: typeof import("./wysylka.js");
let R: typeof import("./conversation-realtime.js");
let A: typeof import("../adapters/allegro.js");
let migrate: typeof import("../db/db.js").migrate;

before(async () => {
  ({ migrate } = await import("../db/db.js"));
  N = await import("./przeplyw-na-zywo.js");
  K = await import("./przeplyw-kategorii.js");
  W = await import("./wysylka.js");
  R = await import("./conversation-realtime.js");
  A = await import("../adapters/allegro.js");
});

beforeEach(() => R._wyczyscObecnosc());

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = new Date("2026-10-06T10:00:00.000Z");
const SZKIC = "Dzień dobry, paczka jest w drodze i dotrze jutro.";

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const ala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro')")
    .run().lastInsertRowid);
  return { d, konto, ala };
}
type Baza = ReturnType<typeof baza>;

/** Rozmowa gotowa do wysyłki: pytanie, decyzja, świeży szkic i propozycja „wyslij”. */
function gotowa(b: Baza, kategoria = "ORDER_STATUS", watek = `t-${Math.random()}`) {
  const { d, konto } = b;
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject) VALUES (?,?,'Kupujący 7')`).run(konto, watek).lastInsertRowid);
  const pytanie = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,
    external_message_id,direction,body,sent_at) VALUES (?,?,?,'incoming','Gdzie paczka?',?)`)
    .run(rozmowa, konto, `m-${Math.random()}`, "2026-10-06T09:50:00.000Z").lastInsertRowid);
  const decyzja = Number(d.prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,
    aktywna,zrodlo,status,kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,
    pewnosc,taksonomia_wersja,polityka_wersja,at,przez)
    VALUES (?,?,1,1,'MODEL','SUCCESS',?,'GET_SHIPMENT',0,0,0,'wysoka','v2','p1',?,'automat')`)
    .run(rozmowa, pytanie, kategoria, "2026-10-06T09:51:00.000Z").lastInsertRowid);
  d.prepare(`INSERT INTO szkic_copilota(conversation_id,tresc,message_id,model,at,przez,decyzja_id)
    VALUES (?,?,?,'atrapa','2026-10-06T09:52:00Z','automat',?)`).run(rozmowa, SZKIC, pytanie, decyzja);
  assert.equal(K.zapiszPropozycje(d, [rozmowa], TERAZ), 1);
  const propozycja = (d.prepare("SELECT id FROM propozycja_przeplywu WHERE conversation_id=?")
    .get(rozmowa) as { id: number }).id;
  return { rozmowa, pytanie, decyzja, propozycja, watek };
}

interface Atrapa { strzaly: Array<{ watek: string; tresc: string }>; }
function biegnij(b: Baza, rozmowy: number[], o: {
  naZywo?: string[]; naGodzine?: number; wyslij?: import("./allegro-wysylka.js").WyslijDoAllegro;
} = {}) {
  const atrapa: Atrapa = { strzaly: [] };
  const wynik = N.wyslijNaZywo(rozmowy, {
    database: b.d, naZywo: o.naZywo ?? ["ORDER_STATUS"], naGodzine: o.naGodzine ?? 10,
    now: () => TERAZ, oznaczPrzeczytany: async () => {},
    wyslij: async (watek, tresc, zalaczniki) => {
      atrapa.strzaly.push({ watek, tresc });
      return o.wyslij ? o.wyslij(watek, tresc, zalaczniki)
        : { externalMessageId: `ext-${atrapa.strzaly.length}-${Math.random()}` };
    },
  });
  return { wynik, atrapa };
}

const propozycja = (d: DatabaseSync, id: number) => d.prepare(
  "SELECT werdykt, wykonana_at, outbox_id, wykonanie_blad FROM propozycja_przeplywu WHERE id=?").get(id) as
  { werdykt: string | null; wykonana_at: string | null; outbox_id: number | null; wykonanie_blad: string | null };
const zdarzenia = (d: DatabaseSync, typ: string) => (d.prepare(
  "SELECT payload, user_id, user_ref FROM events WHERE type=? ORDER BY id").all(typ) as
  Array<{ payload: string | null; user_id: string; user_ref: number | null }>)
  .map((e) => ({ ...e, payload: e.payload ? JSON.parse(e.payload) as Record<string, unknown> : null }));
const ile = (d: DatabaseSync, sql: string, ...a: Array<string | number>) =>
  Number((d.prepare(sql).get(...a) as { n: number }).n);

/** Pominięcie jednym, nazwanym powodem — i ani jednego śladu wysyłki. */
async function pominietaZ(b: Baza, r: ReturnType<typeof gotowa>, powod: string) {
  const { wynik, atrapa } = biegnij(b, [r.rozmowa]);
  const w = await wynik;
  assert.deepEqual(w, { wyslanych: 0, pominietych: 1, bledow: 0, przerwane: null });
  assert.equal(atrapa.strzaly.length, 0, "nic nie poszło do Allegro");
  assert.equal(ile(b.d, "SELECT count(*) n FROM outbox"), 0);
  assert.deepEqual({ ...propozycja(b.d, r.propozycja) },
    { werdykt: null, wykonana_at: null, outbox_id: null, wykonanie_blad: null });
  assert.deepEqual(zdarzenia(b.d, "przeplyw_na_zywo").at(-1)?.payload?.powody, { [powod]: 1 });
  assert.equal(zdarzenia(b.d, "rozmowa_wysylka_konflikt").length, 0, "wysyłka nie była nawet próbowana");
}

/* ── Wyłącznik ──────────────────────────────────────────────────────────── */

test("pusta lista na żywo: ani jednego zapytania do bazy i ani jednego strzału", async () => {
  const bezBazy = new Proxy({}, { get() { throw new Error("tryb na żywo dotknął bazy"); } }) as DatabaseSync;
  let strzalow = 0;
  const wyslij = async () => { strzalow++; return { externalMessageId: "x" }; };
  assert.deepEqual(await N.wyslijNaZywo([1, 2], { database: bezBazy, naZywo: [], wyslij }),
    { wyslanych: 0, pominietych: 0, bledow: 0, przerwane: null });
  /* Domyślna konfiguracja testów nie ma `PRZEPLYW_NA_ZYWO`, jak każda instalacja po aktualizacji. */
  assert.deepEqual(await N.wyslijNaZywo([1, 2], { database: bezBazy, wyslij }),
    { wyslanych: 0, pominietych: 0, bledow: 0, przerwane: null });
  assert.equal(strzalow, 0);
});

test("pusta lista na żywo przy gotowej rozmowie nie zmienia w bazie nic", async () => {
  const b = baza();
  const r = gotowa(b);
  const zrzut = () => ["events", "outbox", "app_user", "message", "conversation_assignment"]
    .map((t) => ile(b.d, `SELECT count(*) n FROM ${t}`)).join(",");
  const przed = zrzut();
  const { wynik, atrapa } = biegnij(b, [r.rozmowa], { naZywo: [] });
  await wynik;
  assert.equal(zrzut(), przed);
  assert.equal(atrapa.strzaly.length, 0);
  assert.equal(propozycja(b.d, r.propozycja).wykonana_at, null);
});

test("kategoria spoza NA_ZYWO_MOZLIWE nie wysyła, choćby stała w pliku", async () => {
  assert.deepEqual(K.kategorieNaZywo(["RETURN", "ORDER_STATUS", "BLEDNA"]), ["ORDER_STATUS"]);
  assert.deepEqual(K.kategorieNaZywo(["RETURN"]), []);
  const ostrz = K.ostrzezeniaNaZywo(["RETURN", "ORDER_STATUS", "BLEDNA"]);
  assert.equal(ostrz.length, 2);
  assert.match(ostrz[0]!, /RETURN/);
  assert.match(ostrz[1]!, /BLEDNA/);

  const b = baza();
  /* RETURN ma w tabeli przepływów `wysylka: true`, więc propozycja „wyslij” stoi. */
  const r = gotowa(b, "RETURN");
  const { wynik, atrapa } = biegnij(b, [r.rozmowa], { naZywo: ["RETURN", "ORDER_STATUS"] });
  assert.deepEqual(await wynik, { wyslanych: 0, pominietych: 0, bledow: 0, przerwane: null });
  assert.equal(atrapa.strzaly.length, 0);
  assert.equal(propozycja(b.d, r.propozycja).wykonana_at, null);
});

/* ── Wysyłka ────────────────────────────────────────────────────────────── */

test("wysyłka automatu: szkic do klienta, bez przydziału, bez werdyktu, podpisana kontem automatu", async () => {
  const b = baza();
  const r = gotowa(b);
  const { wynik, atrapa } = biegnij(b, [r.rozmowa]);
  assert.deepEqual(await wynik, { wyslanych: 1, pominietych: 0, bledow: 0, przerwane: null });
  assert.deepEqual(atrapa.strzaly, [{ watek: r.watek, tresc: SZKIC }]);

  const p = propozycja(b.d, r.propozycja);
  assert.equal(p.wykonana_at, TERAZ.toISOString());
  assert.equal(p.werdykt, null, "wysłanie przez automat to nie zgoda człowieka");
  assert.equal(p.wykonanie_blad, null);
  const o = b.d.prepare("SELECT id, status, created_by, szkic_los FROM outbox").get() as
    { id: number; status: string; created_by: number; szkic_los: string | null };
  assert.equal(p.outbox_id, o.id);
  assert.equal(o.status, "sent");
  assert.equal(o.szkic_los, null, "los szkicu mierzy decyzje agentów, nie automatu");

  const konto = b.d.prepare("SELECT user_id, login, haslo_hash, name, active FROM app_user WHERE user_id=?")
    .get(o.created_by) as Record<string, unknown>;
  assert.deepEqual({ ...konto }, { user_id: o.created_by, login: null, haslo_hash: null, name: "Automat", active: 0 });

  const c = b.d.prepare("SELECT assigned_user_id, status FROM conversation WHERE id=?").get(r.rozmowa) as
    { assigned_user_id: number | null; status: string };
  assert.equal(c.assigned_user_id, null, "rozmowa przydzielona automatowi zablokowałaby agentów");
  assert.equal(c.status, "waiting_for_customer");
  assert.equal(ile(b.d, "SELECT count(*) n FROM conversation_assignment"), 0);
  assert.equal(zdarzenia(b.d, "rozmowa_przypisana_odpowiedzia").length, 0);

  const [wyslane] = zdarzenia(b.d, "przeplyw_wyslane_na_zywo");
  assert.deepEqual(wyslane?.payload, { conversationId: r.rozmowa, propozycjaId: r.propozycja,
    kategoria: "ORDER_STATUS", outboxId: o.id });
  assert.equal(wyslane?.user_id, "Automat");
  assert.equal(wyslane?.user_ref, o.created_by);
  assert.equal(zdarzenia(b.d, "rozmowa_wyslana")[0]?.user_ref, o.created_by,
    "wpis wysyłki wskazuje automat, nie sesję, z której ruszył łańcuch");
  assert.equal(zdarzenia(b.d, "przeplyw_na_zywo_konto").length, 1);

  /* Drugi przebieg: propozycja ma wykonanie, więc nie jest już kandydatem. */
  const drugi = biegnij(b, [r.rozmowa]);
  assert.deepEqual(await drugi.wynik, { wyslanych: 0, pominietych: 0, bledow: 0, przerwane: null });
  assert.equal(drugi.atrapa.strzaly.length, 0);
});

test("konto automatu powstaje raz i jest wspólne dla kolejnych wysyłek", async () => {
  const b = baza();
  const r1 = gotowa(b);
  const r2 = gotowa(b);
  assert.equal((await biegnij(b, [r1.rozmowa, r2.rozmowa]).wynik).wyslanych, 2);
  assert.equal(ile(b.d, "SELECT count(*) n FROM app_user WHERE name='Automat'"), 1);
  assert.equal(ile(b.d, "SELECT count(DISTINCT created_by) n FROM outbox"), 1);
});

test("późniejsza wysyłka człowieka nie daje werdyktu propozycji wysłanej przez automat", async () => {
  const b = baza();
  const r = gotowa(b);
  await biegnij(b, [r.rozmowa]).wynik;
  const v = (b.d.prepare("SELECT version FROM conversation WHERE id=?").get(r.rozmowa) as { version: number }).version;
  await W.wyslijOdpowiedz({ conversationId: r.rozmowa, autor: { id: b.ala, name: "Ala" },
    body: "Uzupełniam: numer przesyłki to 123.", expectedVersion: v, expectedLastMessageId: r.pytanie,
    database: b.d, wyslij: async () => ({ externalMessageId: "ext-ala" }), oznaczPrzeczytany: async () => {} });
  assert.equal(propozycja(b.d, r.propozycja).werdykt, null, "werdykt da agent przy przeglądzie");
});

/* ── Siedem warunków, każdy jedynym powodem ─────────────────────────────── */

test("1. dopisek klienta po rozpoznaniu: decyzja nie jest już bieżąca", async () => {
  const b = baza();
  const r = gotowa(b);
  b.d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-dopisek','incoming','A jednak anuluję','2026-10-06T09:55:00.000Z')`).run(r.rozmowa, b.konto);
  await pominietaZ(b, r, "decyzja");
});

test("1. poprawka kategorii: decyzja propozycji przestała być aktywna", async () => {
  const b = baza();
  const r = gotowa(b);
  b.d.prepare("UPDATE decyzja_klasyfikacji SET aktywna=0 WHERE id=?").run(r.decyzja);
  b.d.prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,status,
    kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,pewnosc,taksonomia_wersja,
    polityka_wersja,at,przez) VALUES (?,?,2,1,'MODEL','SUCCESS','INVOICE','HUMAN_REVIEW',0,0,0,'wysoka',
    'v2','p1','2026-10-06T09:56:00Z','Ala')`).run(r.rozmowa, r.pytanie);
  await pominietaZ(b, r, "decyzja");
});

test("2. ktoś już odpisał po tej wiadomości", async () => {
  const b = baza();
  const r = gotowa(b);
  b.d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-nasza','outgoing','Sprawdzam','2026-10-06T09:58:00.000Z')`).run(r.rozmowa, b.konto);
  await pominietaZ(b, r, "odpisano");
});

test("2. odpowiedź agenta właśnie leci albo zawisła jako niepewna", async () => {
  const b = baza();
  const r = gotowa(b);
  b.d.prepare(`INSERT INTO outbox(conversation_id,idempotency_key,body,expected_version,
    expected_last_message_id,status,created_by) VALUES (?,'k-ala','Sprawdzam',1,?,'send_uncertain',?)`)
    .run(r.rozmowa, r.pytanie, b.ala);
  const { wynik, atrapa } = biegnij(b, [r.rozmowa]);
  assert.equal((await wynik).pominietych, 1);
  assert.equal(atrapa.strzaly.length, 0);
  assert.deepEqual(zdarzenia(b.d, "przeplyw_na_zywo").at(-1)?.payload?.powody, { odpisano: 1 });
});

test("3. szkic z zastrzeżeniem, odrzucony, wstawiony albo spod innej wiadomości nie wychodzi", async () => {
  for (const zmiana of [
    "UPDATE szkic_copilota SET zastrzezenia='[\"Nie znam numeru przesyłki\"]' WHERE conversation_id=?",
    "UPDATE szkic_copilota SET zastrzezenia='to nie JSON' WHERE conversation_id=?",
    "UPDATE szkic_copilota SET ocena='odrzucony' WHERE conversation_id=?",
    "UPDATE szkic_copilota SET ocena='wstawiony' WHERE conversation_id=?",
    "UPDATE szkic_copilota SET decyzja_id=NULL WHERE conversation_id=?",
    "UPDATE szkic_copilota SET message_id=NULL WHERE conversation_id=?",
    "UPDATE szkic_copilota SET tresc='   ' WHERE conversation_id=?",
    "DELETE FROM szkic_copilota WHERE conversation_id=?",
  ]) {
    const b = baza();
    const r = gotowa(b);
    b.d.prepare(zmiana).run(r.rozmowa);
    await pominietaZ(b, r, "szkic");
  }
});

test("4. agent pisze własną odpowiedź albo dołożył plik", async () => {
  const b = baza();
  const r = gotowa(b);
  b.d.prepare("INSERT INTO conversation_draft(conversation_id,body,updated_by) VALUES (?,?,?)")
    .run(r.rozmowa, "Dzień dobry, sprawdzam", b.ala);
  await pominietaZ(b, r, "agentPisze");
  assert.ok(b.d.prepare("SELECT 1 FROM conversation_draft WHERE conversation_id=?").get(r.rozmowa),
    "szkic agenta został nietknięty");

  const c = baza();
  const s = gotowa(c);
  c.d.prepare(`INSERT INTO wysylka_zalacznik(conversation_id,allegro_id,nazwa,typ,rozmiar,dodal_user_id)
    VALUES (?,'a-1','faktura.pdf','application/pdf',100,?)`).run(s.rozmowa, c.ala);
  await pominietaZ(c, s, "agentPisze");

  /* Pusty szkic agenta to brak pracy, nie praca w toku. */
  const e = baza();
  const t = gotowa(e);
  e.d.prepare("INSERT INTO conversation_draft(conversation_id,body,updated_by) VALUES (?,?,?)")
    .run(t.rozmowa, "  ", e.ala);
  assert.equal((await biegnij(e, [t.rozmowa]).wynik).wyslanych, 1);
});

test("5. rozmowę prowadzi człowiek", async () => {
  const b = baza();
  const r = gotowa(b);
  b.d.prepare("UPDATE conversation SET assigned_user_id=? WHERE id=?").run(b.ala, r.rozmowa);
  await pominietaZ(b, r, "przydzial");
});

test("6. ktoś siedzi przy rozmowie", async () => {
  const b = baza();
  const r = gotowa(b);
  R.wejdzDoRozmowy(r.rozmowa, b.ala, "Ala");
  await pominietaZ(b, r, "obecnosc");
});

test("7. sufit godzinowy liczy się z bazy, także wysyłki sprzed restartu", async () => {
  const b = baza();
  const stara = gotowa(b);
  /* Wysyłka sprzed pół godziny, zapisana przez poprzedni proces. */
  b.d.prepare("UPDATE propozycja_przeplywu SET wykonana_at=? WHERE id=?")
    .run("2026-10-06T09:30:00.000Z", stara.propozycja);
  const r = gotowa(b);
  const { wynik, atrapa } = biegnij(b, [r.rozmowa], { naGodzine: 1 });
  assert.deepEqual(await wynik, { wyslanych: 0, pominietych: 0, bledow: 0, przerwane: "sufit godzinowy wyczerpany" });
  assert.equal(atrapa.strzaly.length, 0);
  assert.equal(zdarzenia(b.d, "przeplyw_na_zywo_sufit").length, 1);
  assert.equal(propozycja(b.d, r.propozycja).wykonana_at, null);

  /* Ta sama wysyłka sprzed ponad godziny już się nie liczy. */
  b.d.prepare("UPDATE propozycja_przeplywu SET wykonana_at=? WHERE id=?")
    .run("2026-10-06T08:59:00.000Z", stara.propozycja);
  assert.equal((await biegnij(b, [r.rozmowa], { naGodzine: 1 }).wynik).wyslanych, 1);
});

test("7. sufit liczy też wysyłki z bieżącego przebiegu", async () => {
  const b = baza();
  const r1 = gotowa(b);
  const r2 = gotowa(b);
  const { wynik, atrapa } = biegnij(b, [r1.rozmowa, r2.rozmowa], { naGodzine: 1 });
  assert.deepEqual(await wynik, { wyslanych: 1, pominietych: 0, bledow: 0, przerwane: "sufit godzinowy wyczerpany" });
  assert.equal(atrapa.strzaly.length, 1);
  assert.equal(propozycja(b.d, r2.propozycja).wykonana_at, null);
});

/* ── Błędy: zapis powodu, bez ponawiania ────────────────────────────────── */

test("błąd Allegro zapisuje powód przy propozycji i nie wraca co takt", async () => {
  const b = baza();
  const r = gotowa(b);
  const r2 = gotowa(b);
  let strzalow = 0;
  const pada = async () => { strzalow++; throw new Error("Allegro odpowiedziało 500: awaria"); };
  const w = await biegnij(b, [r.rozmowa, r2.rozmowa], { wyslij: pada }).wynik;
  assert.deepEqual(w, { wyslanych: 0, pominietych: 0, bledow: 2, przerwane: null }, "jeden błąd nie zatrzymuje reszty");
  const p = propozycja(b.d, r.propozycja);
  assert.equal(p.wykonanie_blad, "Allegro odpowiedziało 500: awaria");
  assert.equal(p.wykonana_at, null);
  const o = b.d.prepare("SELECT id, status FROM outbox WHERE conversation_id=?").get(r.rozmowa) as
    { id: number; status: string };
  assert.equal(p.outbox_id, o.id);
  assert.equal(o.status, "send_failed");
  assert.equal(zdarzenia(b.d, "przeplyw_na_zywo_blad").length, 2);

  await biegnij(b, [r.rozmowa, r2.rozmowa], { wyslij: pada }).wynik;
  assert.equal(strzalow, 2, "drugi przebieg nie ponawia");
});

test("timeout to wysyłka niepewna: zapis „niepewna”, bez ponowienia, przebieg staje", async () => {
  const b = baza();
  const r = gotowa(b);
  const r2 = gotowa(b);
  let strzalow = 0;
  const w = await biegnij(b, [r.rozmowa, r2.rozmowa],
    { wyslij: async () => { strzalow++; throw new Error("The operation was aborted due to timeout"); } }).wynik;
  assert.equal(w.bledow, 1);
  assert.match(String(w.przerwane), /timeout/);
  assert.equal(strzalow, 1);
  const p = propozycja(b.d, r.propozycja);
  assert.equal(p.wykonanie_blad, "niepewna");
  assert.ok(p.outbox_id);
  assert.equal(propozycja(b.d, r2.propozycja).wykonanie_blad, null, "druga czeka nietknięta");
});

test("Allegro bez numeru wiadomości: zapis „niepewna” z wierszem kolejki", async () => {
  const b = baza();
  const r = gotowa(b);
  const w = await biegnij(b, [r.rozmowa], { wyslij: async () => ({ externalMessageId: null }) }).wynik;
  assert.equal(w.bledow, 1);
  const p = propozycja(b.d, r.propozycja);
  assert.equal(p.wykonanie_blad, "niepewna");
  assert.equal(p.wykonana_at, null);
  assert.ok(p.outbox_id);
});

test("limit Allegro zatrzymuje przebieg, a propozycja zostaje bez błędu", async () => {
  const b = baza();
  const r = gotowa(b);
  const r2 = gotowa(b);
  let strzalow = 0;
  const w = await biegnij(b, [r.rozmowa, r2.rozmowa], { wyslij: async () => {
    strzalow++; throw new A.BladLimituAllegro("Allegro prosi o przerwę (429)", 60_000);
  } }).wynik;
  assert.equal(strzalow, 1);
  assert.match(String(w.przerwane), /429/);
  assert.equal(propozycja(b.d, r.propozycja).wykonanie_blad, null, "winne konto, nie ta odpowiedź");
  assert.equal(zdarzenia(b.d, "przeplyw_na_zywo_blad")[0]?.payload?.przerwane, true);
});
