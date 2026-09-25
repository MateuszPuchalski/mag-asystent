import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import { czasOdpowiedzi, losOdpowiedzi, p90, probkiRozmowy } from "./czas-odpowiedzi.js";

/* ── Czas odpowiedzi (23 września 2026) ──────────────────────────────────────
   Pilnujemy reguły próbki, bo od niej zależy, czy liczba mówi prawdę:
   czekanie od PIERWSZEJ wiadomości klienta, autoodpowiedź go nie kończy,
   a rozbicie na osoby dostaje wyłącznie ten, komu trasa je pozwoli. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = Date.parse("2026-09-23T12:00:00Z");

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')").run().lastInsertRowid);
  const ala = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  let n = 0;
  const rozmowa = () => Number(d.prepare(
    "INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (?,?)")
    .run(konto, `w-${++n}`).lastInsertRowid);
  const wiad = (r: number, kier: "incoming" | "outgoing", at: string, auto = 0) => {
    const ext = `m-${++n}`;
    const id = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,
      external_message_id,direction,body,sent_at,auto_odpowiedz) VALUES (?,?,?,?,?,?,?)`)
      .run(r, konto, ext, kier, "treść", at, auto).lastInsertRowid);
    return { id, ext };
  };
  return { d, ala, rozmowa, wiad };
}

test("czekanie liczy się od PIERWSZEJ wiadomości klienta, a autoodpowiedź go nie kończy", () => {
  const w = (id: number, direction: string, sent_at: string, auto = 0) =>
    ({ id, conversation_id: 1, direction, auto_odpowiedz: auto, sent_at, external_message_id: `m${id}` });
  const r = probkiRozmowy([
    w(1, "incoming", "2026-09-23T08:00:00Z"),
    w(2, "outgoing", "2026-09-23T08:00:05Z", 1),
    w(3, "incoming", "2026-09-23T08:30:00Z"),
    w(4, "outgoing", "2026-09-23T09:00:00Z"),
    w(5, "incoming", "2026-09-23T10:00:00Z"),
  ]);
  assert.deepEqual(r.probki.map((p) => p.minuty), [60], "od 8:00 do 9:00, nie od 8:30 i nie do 8:00:05");
  assert.equal(r.czekaOd, "2026-09-23T10:00:00Z", "ostatnie słowo klienta czeka dalej");
});

test("p90 metodą najbliższej rangi", () => {
  assert.equal(p90([]), null);
  assert.equal(p90([5]), 5);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
});

test("kategoria z decyzji w oknie czekania; osoba tylko dla administratora", () => {
  const { d, ala, rozmowa, wiad } = baza();
  const r1 = rozmowa();
  const q = wiad(r1, "incoming", "2026-09-23T08:00:00Z");
  const odp = wiad(r1, "outgoing", "2026-09-23T08:20:00Z");
  d.prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,status,
    kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,taksonomia_wersja,
    polityka_wersja,at,przez) VALUES (?,?,1,1,'MODEL','SUCCESS','PRODUCT_COMPATIBILITY','CHECK_COMPATIBILITY',
    0,0,0,'v2','p1','2026-09-23T08:01:00Z','automat')`).run(r1, q.id);
  d.prepare(`INSERT INTO outbox(conversation_id,idempotency_key,body,expected_version,status,
    external_message_id,created_by) VALUES (?,?,?,?,?,?,?)`).run(r1, "k1", "x", 1, "sent", odp.ext, ala);

  /* Druga rozmowa: odpowiedź spoza WERTIS i bez rozpoznania. */
  const r2 = rozmowa();
  wiad(r2, "incoming", "2026-09-23T09:00:00Z");
  wiad(r2, "outgoing", "2026-09-23T11:00:00Z");

  /* Trzecia: klient czeka teraz od trzech godzin. */
  const r3 = rozmowa();
  wiad(r3, "incoming", "2026-09-23T09:00:00Z");

  const bez = czasOdpowiedzi(7, false, d, TERAZ);
  assert.equal(bez.ogolem.n, 2);
  assert.equal(bez.ogolem.medianaMin, 70);
  assert.deepEqual(bez.wgKategorii.map((w) => [w.klucz, w.medianaMin]).sort(),
    [["PRODUCT_COMPATIBILITY", 20], ["bez rozpoznania", 120]]);
  assert.equal(bez.wgOsoby, null, "biuro nie dostaje rozbicia na ludzi");
  assert.deepEqual(bez.czekaTeraz, { n: 1, najdluzejMin: 180 });
  assert.equal(bez.daneDo, "2026-09-23T11:00:00Z");

  const admin = czasOdpowiedzi(7, true, d, TERAZ);
  assert.deepEqual(admin.wgOsoby!.map((w) => [w.klucz, w.medianaMin]).sort(),
    [["A. Lewandowska", 20], ["z Allegro", 120]]);
});

test("odczyt niczego nie zapisuje", () => {
  const { d, rozmowa, wiad } = baza();
  wiad(rozmowa(), "incoming", "2026-09-23T09:00:00Z");
  const przed = (d.prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  czasOdpowiedzi(30, true, d, TERAZ);
  assert.equal((d.prepare("SELECT count(*) n FROM events").get() as { n: number }).n, przed);
});

/* ── Bez ponownego pytania (24 września 2026) ────────────────────────────────
   Pilnujemy trzech rzeczy, bo każda przekłamałaby wynik w inną stronę.
   Podziękowanie nie jest powrotem, ale „dziękuję” i zaraz nowe pytanie jest.
   Powrót bez rozpoznania liczy się jako powrót i jest wymieniony osobno.
   Odpowiedź młodsza niż tydzień bez powrotu nie ma jeszcze wyniku. */
const w = (id: number, direction: string, sent_at: string) =>
  ({ id, conversation_id: 1, direction, auto_odpowiedz: 0, sent_at, external_message_id: `m${id}` });
const DZIEKI = { kategoria: "OTHER", akcja: "NO_ACTION", status: "SUCCESS",
  pewnosc: "wysoka", wymagaCzlowieka: false };
const PYTANIE = { ...DZIEKI, kategoria: "SHIPPING_STATUS", akcja: "CHECK_SHIPMENT" };

test("los odpowiedzi: podziękowanie to nie powrót, a pytanie po podziękowaniu tak", () => {
  const odp = { doId: 2, at: "2026-09-01T10:00:00Z" };
  const lista = [w(1, "incoming", "2026-09-01T09:00:00Z"), w(2, "outgoing", "2026-09-01T10:00:00Z"),
    w(3, "incoming", "2026-09-01T11:00:00Z"), w(4, "incoming", "2026-09-02T11:00:00Z")];
  const teraz = Date.parse("2026-09-20T00:00:00Z");
  assert.deepEqual(losOdpowiedzi(lista.slice(0, 3), odp, () => DZIEKI, teraz),
    { los: "bez_powrotu", bezRozpoznania: false });
  assert.deepEqual(losOdpowiedzi(lista, odp, (id) => (id === 3 ? DZIEKI : PYTANIE), teraz),
    { los: "wrocil", bezRozpoznania: false });
  assert.deepEqual(losOdpowiedzi(lista.slice(0, 3), odp, () => null, teraz),
    { los: "wrocil", bezRozpoznania: true }, "bez rozpoznania nie wiemy, że to podziękowanie");
});

test("los odpowiedzi: powrót po tygodniu się nie liczy, a świeża odpowiedź jeszcze czeka", () => {
  const odp = { doId: 2, at: "2026-09-01T10:00:00Z" };
  const lista = [w(1, "incoming", "2026-09-01T09:00:00Z"), w(2, "outgoing", "2026-09-01T10:00:00Z"),
    w(3, "incoming", "2026-09-09T10:00:00Z")];
  assert.equal(losOdpowiedzi(lista, odp, () => PYTANIE, Date.parse("2026-09-20T00:00:00Z")).los,
    "bez_powrotu", "osiem dni później to nowa sprawa, nie powrót");
  assert.equal(losOdpowiedzi(lista.slice(0, 2), odp, () => null, Date.parse("2026-09-03T00:00:00Z")).los,
    "czeka");
});

test("udział bez ponownego pytania w odczycie Analizy, z rozbiciem tylko dla administratora", () => {
  const { d, ala, rozmowa, wiad } = baza();
  const decyzja = (r: number, m: number, kat: string, akcja: string, pewnosc: string) =>
    d.prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,status,
      kategoria,akcja,pewnosc,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,
      taksonomia_wersja,polityka_wersja,at,przez) VALUES (?,?,1,1,'MODEL','SUCCESS',?,?,?,0,0,0,'v2','p1',
      '2026-09-10T08:01:00Z','automat')`).run(r, m, kat, akcja, pewnosc);

  /* R1: odpowiedź Ali, klient podziękował — bez powrotu. */
  const r1 = rozmowa();
  const q1 = wiad(r1, "incoming", "2026-09-10T08:00:00Z");
  decyzja(r1, q1.id, "SHIPPING_STATUS", "CHECK_SHIPMENT", "wysoka");
  const o1 = wiad(r1, "outgoing", "2026-09-10T09:00:00Z");
  d.prepare(`INSERT INTO outbox(conversation_id,idempotency_key,body,expected_version,status,
    external_message_id,created_by) VALUES (?,?,?,?,?,?,?)`).run(r1, "k1", "x", 1, "sent", o1.ext, ala);
  const t1 = wiad(r1, "incoming", "2026-09-10T10:00:00Z");
  decyzja(r1, t1.id, "OTHER", "NO_ACTION", "wysoka");

  /* R2: klient dopytał następnego dnia — powrót. */
  const r2 = rozmowa();
  wiad(r2, "incoming", "2026-09-11T08:00:00Z");
  wiad(r2, "outgoing", "2026-09-11T09:00:00Z");
  wiad(r2, "incoming", "2026-09-12T09:00:00Z");

  /* R3: odpowiedź sprzed godziny — jeszcze bez wyniku. */
  const r3 = rozmowa();
  wiad(r3, "incoming", "2026-09-23T10:00:00Z");
  wiad(r3, "outgoing", "2026-09-23T11:00:00Z");

  const b = czasOdpowiedzi(30, false, d, TERAZ);
  assert.equal(b.powroty.n, 2);
  assert.equal(b.powroty.bezPowrotu, 1);
  assert.equal(b.powroty.wrocilo, 1);
  assert.equal(b.powroty.wrociloBezRozpoznania, 1, "R2 dopytał wiadomością bez rozpoznania");
  assert.equal(b.powroty.czeka, 1);
  assert.equal(b.powroty.wgOsoby, null);
  assert.deepEqual(b.powroty.wgKategorii.map((x) => [x.klucz, x.n, x.bezPowrotu]).sort(),
    [["SHIPPING_STATUS", 1, 1], ["bez rozpoznania", 1, 0]]);

  const a = czasOdpowiedzi(30, true, d, TERAZ);
  assert.deepEqual(a.powroty.wgOsoby!.map((x) => [x.klucz, x.n, x.bezPowrotu]).sort(),
    [["A. Lewandowska", 1, 1], ["z Allegro", 1, 0]]);
});
