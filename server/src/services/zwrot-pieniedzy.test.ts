import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  cofnijPrzelew, KODY_ODMOWY, odmowZwrotuPieniedzy, stanZwrotuPieniedzy,
  zapiszPrzelew, zwrocPieniadze, ZwrotPieniedzyConflict,
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

  const zam = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,
    platnosc_typ,platnosc_id,dostawa_grosze,suma_grosze,waluta,synced_at)
    VALUES (1,'ord-1','READY_FOR_PROCESSING',?,?,1499,6498,'PLN','2026-09-02T08:00:00Z')`)
    .run(pole<string>("platnoscTyp", "ONLINE"), pole<string | null>("platnoscId", "pay-uuid"))
    .lastInsertRowid);
  /* Jedna pozycja zamówienia i jedna ZAZNACZONA pozycja zwrotu. Kwota domyślna
     to jej cena plus dostawa — dokładnie tyle, ile policzyłby `zapiszKwote`. */
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,external_id,offer_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,'li-1','111','Sekator',1,4999,'PLN')`).run(zam);
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,created_at,synced_at,werdykt,
     kwota_grosze,kwota_dostawa_grosze,wersja)
    VALUES (1,'zw-1',?,'2026-09-01T08:00:00Z','2026-09-02T08:00:00Z',?,?,?,1)`)
    .run(pole<string | null>("orderId", "ord-1"), pole<string | null>("werdykt", "przyjety"),
      pole<number | null>("kwota", 6498), pole<number>("dostawa", 1499)).lastInsertRowid);
  d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta,w_zwrocie)
    VALUES (?,'111|Sekator','111','Sekator',1,4999,'PLN',1)`).run(id);
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
  /* Pozycja zamówienia z ZAZNACZENIA. Do 15 września 2026 tego pola nie było
     i kwota z ekranu nie docierała do Allegro. */
  assert.deepEqual(c.lineItems, [{ id: "li-1", type: "QUANTITY", quantity: 1 }]);
});

/* ── Pozycje żądania (lineItems) ─────────────────────────────────────────── */

/** Wysyła zwrot i oddaje ciało żądania. */
async function wyslij(d: Db, id: number): Promise<Record<string, any>> {
  let wyslane: Record<string, unknown> | null = null;
  await zwrocPieniadze(d, id, 1, KTO, async (c) => { wyslane = c; return { id: "ref-1" }; });
  return wyslane as unknown as Record<string, any>;
}

test("sztuki idą po tym, co WRÓCIŁO, a nie po zgłoszeniu", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  d.prepare("UPDATE zwrot_klienta_pozycja SET ilosc=2, ilosc_zwrocona=1 WHERE zwrot_id=?").run(id);
  assert.deepEqual((await wyslij(d, id)).lineItems,
    [{ id: "li-1", type: "QUANTITY", quantity: 1 }]);
});

test("potrącenie idzie kwotą wprost — QUANTITY oddałoby pełną cenę", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { kwota: 3999 + 1499 });
  d.prepare(`UPDATE zwrot_klienta_pozycja SET potracenie_grosze=1000, potracenie_powod='rysa'
    WHERE zwrot_id=?`).run(id);
  assert.deepEqual((await wyslij(d, id)).lineItems,
    [{ id: "li-1", type: "AMOUNT", value: { amount: "39.99", currency: "PLN" } }]);
});

test("powód potrącenia jedzie do klienta w sellerComment (0.476.0)", async () => {
  /* Formularz potrącenia obiecywał „to jego treść zobaczy klient", a do
     przeglądu zwrotów z 23 września powód nie wychodził z panelu wcale. */
  const d = stanowisko();
  const id = zwrotGotowy(d, { kwota: 3999 + 1499 });
  d.prepare(`UPDATE zwrot_klienta_pozycja SET potracenie_grosze=1000, potracenie_powod='rysa na ostrzu'
    WHERE zwrot_id=?`).run(id);
  assert.equal((await wyslij(d, id)).sellerComment,
    "Pomniejszony zwrot: Sekator — rysa na ostrzu (−10,00 zł)");
});

test("bez potrącenia sellerComment nie idzie, a za długi urywa się na limicie schematu", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  assert.equal("sellerComment" in await wyslij(d, id), false);

  const d2 = stanowisko();
  const id2 = zwrotGotowy(d2, { kwota: 3999 + 1499 });
  d2.prepare(`UPDATE zwrot_klienta_pozycja SET potracenie_grosze=1000, potracenie_powod=?
    WHERE zwrot_id=?`).run("x".repeat(400), id2);
  const k = String((await wyslij(d2, id2)).sellerComment);
  assert.equal(k.length, 250);
  assert.ok(k.endsWith("…"));
});

test("inna cena w zamówieniu też idzie kwotą — Allegro liczyłoby po swojej", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  d.prepare("UPDATE zamowienie_klienta_pozycja SET cena_grosze=5500").run();
  assert.deepEqual((await wyslij(d, id)).lineItems,
    [{ id: "li-1", type: "AMOUNT", value: { amount: "49.99", currency: "PLN" } }]);
});

test("niezaznaczona pozycja nie jedzie w żądaniu", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  const zam = (d.prepare("SELECT id FROM zamowienie_klienta").get() as { id: number }).id;
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,external_id,offer_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,'li-2','222','Kosa',1,19999,'PLN')`).run(zam);
  d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta,w_zwrocie)
    VALUES (?,'222|Kosa','222','Kosa',1,19999,'PLN',0)`).run(id);
  const linie = (await wyslij(d, id)).lineItems as Array<{ id: string }>;
  assert.deepEqual(linie.map((l) => l.id), ["li-1"]);
});

test("pozycja bez odpowiednika w zamówieniu zatrzymuje przelew przed siecią", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  d.prepare("DELETE FROM zamowienie_klienta_pozycja").run();
  const s = stanZwrotuPieniedzy(d, id);
  assert.equal(s.moznaZwrocic, false);
  assert.match(String(s.powod), /Sekator/, "zdanie mówi, której pozycji brakuje");
  let wolane = false;
  await assert.rejects(
    () => zwrocPieniadze(d, id, 1, KTO, async () => { wolane = true; return { id: "x" }; }),
    ZwrotPieniedzyConflict);
  assert.equal(wolane, false, "żądanie bez linii oddałoby mniej, niż obiecał ekran");
});

test("kwota rozjechana z pozycjami zatrzymuje przelew", () => {
  /* Synchronizacja nadpisuje cenę pozycji, a kwota jest migawką z zaznaczenia. */
  const d = stanowisko();
  const id = zwrotGotowy(d);
  d.prepare("UPDATE zwrot_klienta_pozycja SET cena_grosze=5999").run();
  const s = stanZwrotuPieniedzy(d, id);
  assert.equal(s.moznaZwrocic, false);
  assert.match(String(s.powod), /popraw kwotę/);
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

test("brak płatności: „dociągnij” tylko wtedy, gdy zamówienia nie ma (0.484.7)", () => {
  /* Dociąganie pobiera zamówienia BRAKUJĄCE. Wiersz, który stoi bez
     płatności, nie zmieni się od przycisku — wtedy zostaje panel Allegro. */
  const d = stanowisko();
  const stoi = zwrotGotowy(d, { platnoscId: null });
  assert.match(String(stanZwrotuPieniedzy(d, stoi).powod), /panelu Allegro/i);
  assert.doesNotMatch(String(stanZwrotuPieniedzy(d, stoi).powod), /dociągnij/i);

  const d2 = stanowisko();
  const brak = zwrotGotowy(d2);
  d2.prepare("DELETE FROM zamowienie_klienta_pozycja").run();
  d2.prepare("DELETE FROM zamowienie_klienta").run();
  assert.match(String(stanZwrotuPieniedzy(d2, brak).powod), /dociągnij zamówienie/i);
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

/* ── Ślad po przelewie oddanym poza Allegro (0.269.0) ────────────────────────
   Przy pobraniu Allegro nigdy nie trzymało tych pieniędzy, więc trasa zwrotu
   jest zamknięta z definicji. Do 0.268.0 zwrot zamykał się korektą BEZ ŚLADU
   po wypłacie — klient bez pieniędzy wyglądał tak samo jak rozliczony.     */

test("pobranie: zapis przelewu zostawia ślad, oś i podniesioną wersję", () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { platnoscTyp: "CASH_ON_DELIVERY", platnoscId: null });
  const przed = stanZwrotuPieniedzy(d, id);
  assert.equal(przed.moznaZwrocic, false, "Allegro tych pieniędzy nie odda");
  assert.equal(przed.moznaZapisacPrzelew, true, "…ale zapisać, że oddaliśmy je sami, wolno");

  const w = zapiszPrzelew(d, id, 1, KTO, "  PRZ/2026/09/14  ");
  assert.equal(w.wersja, 2);

  const po = stanZwrotuPieniedzy(d, id);
  assert.equal(po.przelew?.referencja, "PRZ/2026/09/14", "referencja idzie przycięta z białych znaków");
  assert.equal(po.przelew?.przez, KTO.name);
  assert.equal(po.moznaZapisacPrzelew, false, "drugi zapis nie ma czego zapisać");
  assert.match(String(po.powodPrzelewu), /cofnij/i);

  const os = d.prepare("SELECT rodzaj, tresc FROM zwrot_zdarzenie WHERE zwrot_id=?")
    .all(id) as Array<{ rodzaj: string; tresc: string }>;
  assert.deepEqual(os.map((z) => z.rodzaj), ["przelew"]);
  assert.match(os[0].tresc, /PRZ\/2026\/09\/14/);
});

test("referencja jest OPCJONALNA — numer bywa znany dopiero z wyciągu", () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { platnoscTyp: "CASH_ON_DELIVERY", platnoscId: null });
  zapiszPrzelew(d, id, 1, KTO, "   ");
  const s = stanZwrotuPieniedzy(d, id);
  assert.equal(s.przelew?.referencja, null);
  assert.ok(s.przelew?.kiedy, "sam fakt wypłaty zapisuje się i bez numeru");
});

test("cofnięcie zamiast potwierdzenia — notatka o przelewie jest odwracalna", () => {
  /* §25a.5: potwierdzenia dostają rzeczy NIEODWRACALNE. To nie jest ruch
     pieniędzy, tylko zdanie o nim, więc literówkę w numerze prostuje się
     cofnięciem — a obie decyzje zostają na osi. */
  const d = stanowisko();
  const id = zwrotGotowy(d, { platnoscTyp: "CASH_ON_DELIVERY", platnoscId: null });
  zapiszPrzelew(d, id, 1, KTO, "PRZ/1");
  cofnijPrzelew(d, id, 2, KTO);

  const s = stanZwrotuPieniedzy(d, id);
  assert.equal(s.przelew, null);
  assert.equal(s.moznaZapisacPrzelew, true, "po cofnięciu da się zapisać poprawny numer");
  const os = d.prepare("SELECT rodzaj FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY id")
    .all(id) as Array<{ rodzaj: string }>;
  assert.deepEqual(os.map((z) => z.rodzaj), ["przelew", "przelew_cofniety"]);

  assert.throws(() => cofnijPrzelew(d, id, 3, KTO), /nie ma zapisanego przelewu/);
});

test("stara wersja przegrywa, a przelew po zwrocie przez Allegro nie ma sensu", () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { platnoscTyp: "CASH_ON_DELIVERY", platnoscId: null });
  assert.throws(() => zapiszPrzelew(d, id, 99, KTO, null), ZwrotPieniedzyConflict);

  const d2 = stanowisko();
  const oddany = zwrotGotowy(d2);
  d2.prepare("UPDATE zwrot_klienta SET zwrot_pieniedzy_id='ref-1' WHERE id=?").run(oddany);
  const s = stanZwrotuPieniedzy(d2, oddany);
  assert.equal(s.moznaZapisacPrzelew, false);
  assert.match(String(s.powodPrzelewu), /panel Allegro/);
});

test("bez werdyktu i bez kwoty przelewu też nie ma czego zapisywać", () => {
  const d = stanowisko();
  const bezWerdyktu = zwrotGotowy(d, { platnoscTyp: "CASH_ON_DELIVERY", werdykt: null });
  assert.match(String(stanZwrotuPieniedzy(d, bezWerdyktu).powodPrzelewu), /przyjmij zwrot/i);

  const d2 = stanowisko();
  const bezKwoty = zwrotGotowy(d2, { platnoscTyp: "CASH_ON_DELIVERY", kwota: null });
  assert.match(String(stanZwrotuPieniedzy(d2, bezKwoty).powodPrzelewu), /zaznacz/i);
});

test("zamknięty zwrot NIE blokuje zapisu — przelew idzie zwykle po korekcie", () => {
  const d = stanowisko();
  const id = zwrotGotowy(d, { platnoscTyp: "CASH_ON_DELIVERY", platnoscId: null });
  d.prepare("UPDATE zwrot_klienta SET zamkniety_at='2026-09-03T10:00:00Z' WHERE id=?").run(id);
  assert.equal(stanZwrotuPieniedzy(d, id).moznaZapisacPrzelew, true);
  assert.ok(zapiszPrzelew(d, id, 1, KTO, null).kiedy);
});

/* ── Zamknięcie a pieniądze (audyt zwrotów, 15 września 2026) ───────────────
   Biuro wystawia korektę zwykle PRZED przelewem. Korekta zamyka zwrot, a do
   tego wydania zamknięty zwrot chował ODDAJ PIENIĄDZE — na nagraniu z pracy
   przelew szedł więc w Sales Center, obok gotowego przycisku.               */

test("korekta zamyka zwrot, ale NIE drogę do oddania pieniędzy", async () => {
  const d = stanowisko();
  const id = zwrotGotowy(d);
  d.prepare(`UPDATE zwrot_klienta SET zamkniety_at='2026-09-15T12:39:00Z',
    korekta_numer='ZW 413/MAG/09/2026' WHERE id=?`).run(id);
  assert.equal(stanZwrotuPieniedzy(d, id).moznaZwrocic, true);
  const w = await zwrocPieniadze(d, id, 1, KTO, async () => ({ id: "ref-1" }));
  assert.equal(w.refundId, "ref-1");
});

test("zwrot rozliczony przez Allegro nie proponuje drugiego przelewu", () => {
  /* Zatrzask z 0.345.0: wskaźnik idzie dalej osią czasu, rozliczenie zostaje. */
  const d = stanowisko();
  const id = zwrotGotowy(d);
  d.prepare(`UPDATE zwrot_klienta SET rozliczony_allegro_at='2026-09-10T08:00:00Z',
    status_allegro='COMMISSION_REFUND_CLAIMED' WHERE id=?`).run(id);
  const s = stanZwrotuPieniedzy(d, id);
  assert.equal(s.moznaZwrocic, false);
  assert.match(String(s.powod), /Allegro już oddało/);
});

test("paczka nieodebrana oddaje pieniądze płatnością, ale odmówić nie ma czego (0.493.0)", async () => {
  /* Zwrot płatności idzie po zamówieniu i działa bez zwrotu klienta.
     Odmowa idzie do zwrotu klienta w Allegro — a tego tu nie ma. */
  const d = stanowisko();
  const id = zwrotGotowy(d);
  d.prepare("UPDATE zwrot_klienta SET external_id='nieodebrana:620000111222', zrodlo='nieodebrana' WHERE id=?")
    .run(id);
  const s = stanZwrotuPieniedzy(d, id);
  assert.equal(s.moznaZwrocic, true);
  assert.equal(s.moznaOdmowic, false);
  let wyslano = false;
  await assert.rejects(
    () => odmowZwrotuPieniedzy(d, id, "REFUND_REJECTED", "powód", 1, KTO,
      async () => { wyslano = true; return null; }),
    ZwrotPieniedzyConflict);
  assert.equal(wyslano, false, "żądanie nie wychodzi do Allegro");
});
