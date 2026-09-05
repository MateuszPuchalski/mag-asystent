import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  KODY_ODMOWY, odmowZwrotuPieniedzy, stanZwrotuPieniedzy, zwrocPieniadze,
  ZwrotPieniedzyConflict,
} from "./zwrot-pieniedzy.js";

/* ── Zwrot pieniędzy i odmowa w Allegro (0.190.0) ────────────────────────────
   To jest PIERWSZE miejsce, z którego ten system rusza cudze pieniądze.
   Testy pilnują więc nie kształtu ekranu, tylko czterech rzeczy, po których
   poznaje się, że wolno to wypuścić:

   1. Kształt żądania zgadza się ze SCHEMATEM (`InitializeRefund`): cztery
      pola wymagane, kwota z serwera, dostawa tylko wtedy, gdy ją oddajemy.
   2. `commandId` przy ponowieniu jest TEN SAM — inaczej druga próba po
      zerwanej sieci oddaje pieniądze drugi raz.
   3. Przeszkody mówią, CO zrobić, i nie wypuszczają żądania w świat.
   4. Zapis u nas idzie PO odpowiedzi Allegro, nigdy przed.                  */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const KTO = { id: 1, name: "A. Lewandowska" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')")
    .run();
  return d as unknown as Db;
}

/** Zwrot gotowy do oddania pieniędzy: przyjęty, z kwotą, z płatnością. */
function zwrotGotowy(d: Db, n: Record<string, unknown> = {}) {
  /* `??` NIE nadaje się na wartości domyślne w tym pomocniku: jawne `null`
     („tego pola nie ma") jest tu treścią połowy przypadków, a `??` zamieniłby
     je z powrotem na wartość domyślną i test przechodziłby na innym stanie,
     niż nazywa. */
  const pole = <T>(nazwa: string, domyslna: T): T =>
    (nazwa in n ? n[nazwa] : domyslna) as T;

  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,
    platnosc_typ,platnosc_id,dostawa_grosze,suma_grosze,waluta,synced_at)
    VALUES (1,'ord-1','READY_FOR_PROCESSING',?,?,1499,6498,'PLN','2026-09-02T08:00:00Z')`)
    .run(pole<string>("platnoscTyp", "ONLINE"), pole<string | null>("platnoscId", "pay-uuid"));
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,created_at,synced_at,werdykt,
     kwota_grosze,kwota_dostawa_grosze,wersja)
    VALUES (1,'zw-1',?,'2026-09-01T08:00:00Z','2026-09-02T08:00:00Z',?,?,?,1)`)
    .run(pole<string | null>("orderId", "ord-1"), pole<string | null>("werdykt", "przyjety"),
      pole<number | null>("kwota", 6498), pole<number>("dostawa", 1499)).lastInsertRowid);
  return id;
}

test("żądanie ma cztery pola wymagane przez schemat i kwotę z serwera", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  let wyslane: Record<string, unknown> | null = null;

  await zwrocPieniadze(d, id, 1, KTO, async (ciało) => {
    wyslane = ciało;
    return { id: "ref-1", status: "SUCCEEDED" };
  });

  const c = wyslane as unknown as Record<string, any>;
  assert.deepEqual(c.payment, { id: "pay-uuid" });
  assert.deepEqual(c.order, { id: "ord-1" });
  assert.equal(c.reason, "REFUND");
  assert.match(String(c.commandId), /^[0-9a-f-]{36}$/);
  /* Dostawa idzie w złotych, bo tak żąda `Price`, a grosze trzyma baza. */
  assert.deepEqual(c.delivery, { value: { amount: "14.99", currency: "PLN" } });
});

/* Pole `delivery` z zerem znaczy „oddaj zero za dostawę" i to jest co innego
   niż jego pominięcie. Zaznaczenie bez dostawy ma je POMIJAĆ. */
test("bez oddanej dostawy pole delivery nie idzie wcale", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { dostawa: 0, kwota: 4999 });
  let wyslane: Record<string, unknown> | null = null;
  await zwrocPieniadze(d, id, 1, KTO, async (c) => { wyslane = c; return { id: "ref-2" }; });
  assert.equal("delivery" in (wyslane as unknown as object), false);
});

test("ponowienie po zerwanej sieci idzie z TYM SAMYM commandId", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  const widziane: string[] = [];

  await assert.rejects(() => zwrocPieniadze(d, id, 1, KTO, async (c) => {
    widziane.push(String(c.commandId));
    throw new Error("sieć padła");
  }));

  await zwrocPieniadze(d, id, 1, KTO, async (c) => {
    widziane.push(String(c.commandId));
    return { id: "ref-1", status: "SUCCEEDED" };
  });

  assert.equal(widziane.length, 2);
  assert.equal(widziane[0], widziane[1],
    "drugi identyfikator polecenia oznaczałby drugi przelew");
});

test("nieudana próba NIE zapisuje u nas zwrotu pieniędzy", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  await assert.rejects(() => zwrocPieniadze(d, id, 1, KTO, async () => { throw new Error("400"); }));
  const w = d.prepare("SELECT zwrot_pieniedzy_id, wersja FROM zwrot_klienta WHERE id=?")
    .get(id) as { zwrot_pieniedzy_id: string | null; wersja: number };
  assert.equal(w.zwrot_pieniedzy_id, null);
  assert.equal(Number(w.wersja), 1);
});

test("Allegro bez numeru zwrotu to błąd, nie cichy sukces", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  await assert.rejects(
    () => zwrocPieniadze(d, id, 1, KTO, async () => ({ status: "PENDING" })),
    /nie oddało numeru/);
});

test("udany zwrot zapisuje numer, zdarzenie i podnosi wersję", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  const wynik = await zwrocPieniadze(d, id, 1, KTO,
    async () => ({ id: "ref-9", status: "SUCCEEDED" }));

  assert.equal(wynik.refundId, "ref-9");
  assert.equal(wynik.wersja, 2);
  const w = d.prepare(`SELECT zwrot_pieniedzy_id, zwrot_pieniedzy_status,
    zwrot_pieniedzy_przez, wersja FROM zwrot_klienta WHERE id=?`).get(id) as any;
  assert.equal(w.zwrot_pieniedzy_id, "ref-9");
  assert.equal(w.zwrot_pieniedzy_status, "SUCCEEDED");
  assert.equal(w.zwrot_pieniedzy_przez, "A. Lewandowska");
  assert.equal(Number(w.wersja), 2);
  const zd = d.prepare("SELECT rodzaj, tresc FROM zwrot_zdarzenie WHERE zwrot_id=?").get(id) as any;
  assert.equal(zd.rodzaj, "pieniadze");
  assert.match(String(zd.tresc), /64,98 PLN|64\.98 PLN/);
});

test("ekran czyta zapisany przelew i mówi, czy ALLEGRO go potwierdziło", async () => {
  /* Do 0.209.0 stały tu trzy `null`-e mimo wypełnionych kolumn: ekran nie
     wiedział ani kiedy przelew poszedł, ani co Allegro na niego odpowiedziało.
     Potwierdzeniem jest `CustomerReturn.status`, bo `GET` po identyfikatorze
     zwrotu płatności w specyfikacji nie istnieje. */
  const d = stanowisko();
  const id = zwrotGotowy(d);
  await zwrocPieniadze(d, id, 1, KTO, async () => ({ id: "ref-9", status: "SUCCEEDED" }),
    new Date("2026-09-01T10:00:00Z"));

  const przed = stanZwrotuPieniedzy(d, id);
  assert.equal(przed.oddane?.id, "ref-9");
  assert.equal(przed.oddane?.status, "SUCCEEDED", "odpowiedź na nasze polecenie");
  assert.equal(przed.oddane?.kiedy, "2026-09-01T10:00:00.000Z");
  assert.equal(przed.oddane?.potwierdzone, false,
    "przyjęcie polecenia to jeszcze nie przelew — Allegro nie mówi FINISHED");

  d.prepare("UPDATE zwrot_klienta SET status_allegro='FINISHED' WHERE id=?").run(id);
  assert.equal(stanZwrotuPieniedzy(d, id).oddane?.potwierdzone, true,
    "dopiero status zwrotu jest dowodem, że pieniądze wyszły");
});

test("drugi zwrot pieniędzy jest odmawiany bez wyjścia do sieci", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  await zwrocPieniadze(d, id, 1, KTO, async () => ({ id: "ref-1" }));
  let wolane = false;
  await assert.rejects(
    () => zwrocPieniadze(d, id, 2, KTO, async () => { wolane = true; return { id: "ref-2" }; }),
    ZwrotPieniedzyConflict);
  assert.equal(wolane, false, "żądanie nie miało prawa wyjść");
});

/* ── Przeszkody: każda mówi, CO zrobić ─────────────────────────────────── */

test("pobranie mówi wprost, że pieniędzy nie trzymało Allegro", () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { platnoscTyp: "CASH_ON_DELIVERY" });
  const s = stanZwrotuPieniedzy(d, id);
  assert.equal(s.moznaZwrocic, false);
  assert.match(String(s.powod), /pobraniem/);
  /* Odmówić przy pobraniu nadal wolno — to osobna droga. */
  assert.equal(s.moznaOdmowic, true);
});

test("brak werdyktu i brak kwoty to DWIE różne przeszkody", () => {
  const d = stanowisko();
  const bezWerdyktu = zwrotGotowy(d, { werdykt: null });
  assert.match(String(stanZwrotuPieniedzy(d, bezWerdyktu).powod), /przyjmij zwrot/i);

  const d2 = stanowisko();
  const bezKwoty = zwrotGotowy(d2, { kwota: null });
  assert.match(String(stanZwrotuPieniedzy(d2, bezKwoty).powod), /zaznacz/i);
});

test("brak identyfikatora płatności prowadzi do dociągnięcia zamówienia", () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { platnoscId: null });
  assert.match(String(stanZwrotuPieniedzy(d, id).powod), /dociągnij zamówienie/i);
});

/* ── Odmowa ────────────────────────────────────────────────────────────── */

test("REFUND_REJECTED bez powodu nie wychodzi do Allegro", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  let wolane = false;
  await assert.rejects(
    () => odmowZwrotuPieniedzy(d, id, "REFUND_REJECTED", "  ", 1, KTO,
      async () => { wolane = true; return null; }),
    /wymaga powodu/);
  assert.equal(wolane, false);
});

test("kod spoza schematu jest odrzucany u nas, nie w Allegro", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  await assert.rejects(
    () => odmowZwrotuPieniedzy(d, id, "WYMYSLONY", null, 1, KTO, async () => null),
    /Nieznany kod/);
  /* Siedem kodów ze schematu — nie cztery, jak mówił opis do 0.190.0. */
  assert.equal(KODY_ODMOWY.length, 7);
});

test("powód dłuższy niż 250 znaków zatrzymuje się u nas", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  await assert.rejects(
    () => odmowZwrotuPieniedzy(d, id, "REFUND_REJECTED", "x".repeat(251), 1, KTO,
      async () => null),
    /250 znaków/);
});

test("odmowa idzie z numerem zwrotu z Allegro i zapisuje się u nas", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { werdykt: null, kwota: null });
  let widziane: Array<string | null> = [];
  const wynik = await odmowZwrotuPieniedzy(d, id, "ITEM_MISMATCH", null, 1, KTO,
    async (zwrotExternalId, kod, powod) => { widziane = [zwrotExternalId, kod, powod]; return {}; });

  assert.deepEqual(widziane, ["zw-1", "ITEM_MISMATCH", null]);
  assert.equal(wynik.wersja, 2);
  const w = d.prepare("SELECT odmowa_kod, odmowa_przez FROM zwrot_klienta WHERE id=?").get(id) as any;
  assert.equal(w.odmowa_kod, "ITEM_MISMATCH");
  assert.equal(w.odmowa_przez, "A. Lewandowska");
});

test("po odmowie nie da się oddać pieniędzy tym samym zwrotem", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  await odmowZwrotuPieniedzy(d, id, "NO_RETURN_RIGHT", null, 1, KTO, async () => ({}));
  const s = stanZwrotuPieniedzy(d, id);
  assert.equal(s.moznaZwrocic, false);
  assert.match(String(s.powod), /Odmowa/);
});
