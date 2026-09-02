import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { stanRabatu, pozycjaDoWniosku, zlozWniosekORabat, RabatConflict } from "./rabaty.js";

/* ── Rabat transakcyjny przy pozycji zwrotu (0.164.0) ────────────────────────
   Firma klikała po zwrot prowizji ręcznie przy KAŻDYM zwrocie w panelu
   Allegro, bo skądinąd nie widziała, przy którym wniosek już jest. Te testy
   pilnują dwóch rzeczy, na których stoi cała reszta:

   1. IDENTYFIKATOR DO ZAPISU bierze się z pozycji ZAMÓWIENIA, nigdy
      z `items[].offerId` zwrotu. Do której przestrzeni należy tamten, jest
      pytaniem otwartym (`[WERYFIKUJ]` w allegro-ksztalt.md) — a tędy pytanie
      nas nie dotyczy.
   2. BRAK DOPASOWANIA MÓWI POWÓD. Milczenie wygląda jak usterka panelu,
      a jest brakiem danych po drugiej stronie (blizna łańcucha kartotek).  */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

/** Zwrot z jedną pozycją plus zamówienie, z którego pochodzi. */
function zwrotZZamowieniem(d: Db, opcje: { offerIdZwrotu?: string | null; lineItemId?: string } = {}) {
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,
    dostawa_grosze,suma_grosze,waluta,synced_at)
    VALUES (1,'ord-1','READY_FOR_PROCESSING',1499,6498,'PLN','2026-09-02T08:00:00Z')`).run();
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,external_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,?,'of-1','Sekator','SEK-46',1,4999,'PLN')`)
    .run(opcje.lineItemId ?? "li-1");
  const zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,created_at,synced_at)
    VALUES (1,'zw-1','ord-1','2026-09-01T08:00:00Z','2026-09-02T08:00:00Z')`)
    .run().lastInsertRowid);
  const pozycja = Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,?,?,'Sekator',1,4999,'PLN')`)
    .run(zwrot, "of-1|Sekator",
      opcje.offerIdZwrotu === undefined ? "of-1" : opcje.offerIdZwrotu).lastInsertRowid);
  return { zwrot, pozycja };
}

const wniosek = (d: Db, dane: Partial<{ id: string; lineItemId: string; status: string;
  typ: string; grosze: number }> = {}) =>
  d.prepare(`INSERT INTO allegro_rabat(channel_account_id,external_id,line_item_id,
    offer_id,ilosc,prowizja_grosze,waluta,status,typ,created_at,synced_at)
    VALUES (1,?,?,'of-1',1,?,'PLN',?,?,'2026-09-01T10:00:00Z','2026-09-02T08:00:00Z')`)
    .run(dane.id ?? "rc-1", dane.lineItemId ?? "li-1", dane.grosze ?? 615,
      dane.status ?? "GRANTED", dane.typ ?? "MANUAL");

test("pozycja bez wniosku mówi BRAK i podaje identyfikator do złożenia", () => {
  const d = stanowisko();
  const { pozycja } = zwrotZZamowieniem(d);

  const stan = stanRabatu(d, pozycja);
  assert.equal(stan.stan, "brak");
  assert.equal(stan.lineItemId, "li-1", "identyfikator z pozycji ZAMÓWIENIA, nie ze zwrotu");
  assert.equal(stan.ilosc, 1);
  assert.equal(stan.powod, null);
});

test("przyznany wniosek niesie kwotę prowizji i sposób złożenia", () => {
  const d = stanowisko();
  const { pozycja } = zwrotZZamowieniem(d);
  wniosek(d, { status: "GRANTED", typ: "MANUAL", grosze: 615 });

  const stan = stanRabatu(d, pozycja);
  assert.equal(stan.stan, "przyznany");
  assert.equal(stan.prowizjaGrosze, 615);
  assert.equal(stan.typ, "MANUAL");
  assert.equal(stan.wniosekId, "rc-1");
});

test("wniosek w toku i odrzucony to DWA różne stany, nie jeden „jest\"", () => {
  /* Odrzucony wniosek wymaga innej reakcji niż czekający: przy pierwszym
     nie ma co robić, przy drugim można złożyć odwołanie w panelu Allegro. */
  const d = stanowisko();
  const { pozycja } = zwrotZZamowieniem(d);

  wniosek(d, { id: "rc-2", status: "WAITING_FOR_PAYMENT_REFUND" });
  assert.equal(stanRabatu(d, pozycja).stan, "zlozony");

  d.prepare("UPDATE allegro_rabat SET status='REJECTED' WHERE external_id='rc-2'").run();
  assert.equal(stanRabatu(d, pozycja).stan, "odrzucony");
});

test("anulowany wniosek zwalnia pozycję — wolno złożyć następny", () => {
  /* `DELETE /order/refund-claims/{id}` zostawia wniosek ze statusem
     `CANCELLED`. Gdyby liczył się jak istniejący, pomyłka blokowałaby rabat
     na zawsze. */
  const d = stanowisko();
  const { pozycja } = zwrotZZamowieniem(d);
  wniosek(d, { id: "rc-3", status: "CANCELLED" });

  const stan = stanRabatu(d, pozycja);
  assert.equal(stan.stan, "brak");
  assert.equal(stan.lineItemId, "li-1");
});

test("bez dopasowanej pozycji zamówienia mówimy POWÓD, nie ciszę", () => {
  const d = stanowisko();
  /* Zwrot bez pobranego zamówienia — najczęstsze zerwane ogniwo. */
  const zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,created_at,synced_at)
    VALUES (1,'zw-9','ord-9','2026-09-01T08:00:00Z','2026-09-02T08:00:00Z')`)
    .run().lastInsertRowid);
  const pozycja = Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,'of-9|Kosa','of-9','Kosa',1,9999,'PLN')`).run(zwrot).lastInsertRowid);

  const stan = stanRabatu(d, pozycja);
  assert.equal(stan.stan, "nie_wiadomo");
  assert.equal(stan.lineItemId, null, "bez identyfikatora nie ma czego złożyć");
  assert.match(stan.powod!, /zamówieni/i);
});

test("identyfikator do wniosku NIE bierze się z pozycji zwrotu", () => {
  /* Sedno: `items[].offerId` zwrotu bywa z innej przestrzeni niż oferta
     zamówienia. Tu zwrot niesie identyfikator, który w zamówieniu jest
     numerem POZYCJI — a wniosek i tak ma pójść z `external_id` zamówienia. */
  const d = stanowisko();
  const { pozycja } = zwrotZZamowieniem(d, { offerIdZwrotu: "li-1", lineItemId: "li-1" });

  const wybrana = pozycjaDoWniosku(d, pozycja);
  assert.equal(wybrana?.lineItemId, "li-1");
  assert.equal(wybrana?.zrodlo, "zamowienie",
    "identyfikator pochodzi z pozycji zamówienia, choćby zwrot niósł ten sam napis");
});

/* ── Złożenie wniosku: pierwszy ZAPIS tego systemu do Allegro ────────────────
   Końcówka NIE MA idempotencji — `commandId` jest przy zwrocie pieniędzy,
   nie tutaj. Powtórzone żądanie to DRUGI wniosek, więc strażnik musi być
   nasz i musi stać PRZED wyjściem do sieci.                                */

const KTO = { id: 1, name: "Ala z biura" };
const konto = (d: Db) =>
  d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','Ala z biura','biuro')").run();

test("wniosek idzie z identyfikatorem pozycji zamówienia i wraca z numerem", async () => {
  const d = stanowisko();
  konto(d);
  const { pozycja } = zwrotZZamowieniem(d);
  const wyslane: unknown[] = [];

  const wynik = await zlozWniosekORabat(d, pozycja, KTO, async (lineItemId, ilosc) => {
    wyslane.push({ lineItemId, ilosc });
    return { id: "rc-nowy" };
  });

  assert.deepEqual(wyslane, [{ lineItemId: "li-1", ilosc: 1 }]);
  assert.equal(wynik.wniosekId, "rc-nowy");
  /* Wniosek ląduje u nas OD RAZU, nie dopiero po następnym przebiegu
     synchronizacji: między jednym a drugim kliknięciem są sekundy, a takt
     chodzi co kwadrans. Bez tego zapisu drugie kliknięcie złożyłoby drugi. */
  assert.equal(stanRabatu(d, pozycja).stan, "zlozony");
  assert.equal(stanRabatu(d, pozycja).wniosekId, "rc-nowy");
});

test("drugi raz na tę samą pozycję NIE wychodzi do Allegro", async () => {
  const d = stanowisko();
  konto(d);
  const { pozycja } = zwrotZZamowieniem(d);
  wniosek(d, { id: "rc-1", status: "GRANTED" });
  let strzalow = 0;

  await assert.rejects(
    () => zlozWniosekORabat(d, pozycja, KTO, async () => { strzalow++; return { id: "x" }; }),
    (e: unknown) => e instanceof RabatConflict && /rc-1|wniosek/i.test((e as Error).message));
  assert.equal(strzalow, 0, "strażnik stoi PRZED siecią, nie po niej");
});

test("status zwrotu z Allegro też zatrzymuje — to drugi strażnik", async () => {
  /* Wniosek mógł powstać poza panelem: w panelu Allegro albo automatem
     Allegro. Nasza tabela wtedy o nim nie wie, ale zwrot niesie
     `COMMISSION_REFUND_CLAIMED`. */
  const d = stanowisko();
  konto(d);
  const { zwrot, pozycja } = zwrotZZamowieniem(d);
  d.prepare("UPDATE zwrot_klienta SET status_allegro='COMMISSION_REFUNDED' WHERE id=?").run(zwrot);
  let strzalow = 0;

  await assert.rejects(
    () => zlozWniosekORabat(d, pozycja, KTO, async () => { strzalow++; return { id: "x" }; }),
    (e: unknown) => e instanceof RabatConflict && /prowizj/i.test((e as Error).message));
  assert.equal(strzalow, 0);
});

test("bez dopasowanej pozycji zamówienia nie ma czego wysłać", async () => {
  const d = stanowisko();
  konto(d);
  const zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,created_at,synced_at)
    VALUES (1,'zw-9',NULL,'2026-09-01T08:00:00Z','2026-09-02T08:00:00Z')`)
    .run().lastInsertRowid);
  const pozycja = Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,'of-9|Kosa','of-9','Kosa',1,9999,'PLN')`).run(zwrot).lastInsertRowid);

  await assert.rejects(() => zlozWniosekORabat(d, pozycja, KTO, async () => ({ id: "x" })),
    /zamówieni/i);
});

test("złożenie zostawia ślad w dzienniku i na osi zwrotu", async () => {
  const d = stanowisko();
  konto(d);
  const { zwrot, pozycja } = zwrotZZamowieniem(d);
  await zlozWniosekORabat(d, pozycja, KTO, async () => ({ id: "rc-7" }));

  const typy = (d.prepare("SELECT type FROM events WHERE type LIKE 'zwrot_rabat%'")
    .all() as Array<{ type: string }>).map((w) => w.type);
  assert.deepEqual(typy, ["zwrot_rabat_zgloszony"]);
  const os = d.prepare("SELECT rodzaj, tresc FROM zwrot_zdarzenie WHERE zwrot_id=?")
    .get(zwrot) as { rodzaj: string; tresc: string };
  assert.equal(os.rodzaj, "rabat");
  assert.match(os.tresc, /rc-7/);
});

test("odmowa Allegro NIE zostawia u nas wniosku, którego tam nie ma", async () => {
  /* Zapis lokalny idzie PO udanej odpowiedzi. Odwrotna kolejność zablokowałaby
     pozycję wnioskiem-widmem: u nas jest, w Allegro go nie ma, a strażnik
     nie pozwala spróbować drugi raz. */
  const d = stanowisko();
  konto(d);
  const { pozycja } = zwrotZZamowieniem(d);

  await assert.rejects(() => zlozWniosekORabat(d, pozycja, KTO, async () => {
    throw new Error("Brak uprawnienia (403) — scope allegro:api:orders:write");
  }), /orders:write/);

  assert.equal((d.prepare("SELECT count(*) n FROM allegro_rabat").get() as { n: number }).n, 0);
  assert.equal(stanRabatu(d, pozycja).stan, "brak", "pozycja zostaje do spróbowania jeszcze raz");
});
