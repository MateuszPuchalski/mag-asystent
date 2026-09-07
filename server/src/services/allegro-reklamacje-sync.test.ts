import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  czatyDoUzupelnienia, czyReklamacja, pierwszeOczekiwanie,
  synchronizujAllegroReklamacje,
} from "./allegro-reklamacje-sync.js";
import { stanReklamacji } from "./allegro-reklamacje-sync-state.js";

/* Ten plik pilnuje trzech rzeczy, których nie da się sprawdzić na ekranie:
   że dyskusje NIE wchodzą do rejestru i są policzone, że drugi przebieg nie
   robi duplikatów (blizna 0.128.0) oraz że rozmowy dociągają się z limitem,
   a nie po jednym żądaniu na sprawę.

   Baza to schemat PLUS `migrate()` — sam `schema.sql` opisuje kształt,
   którego na produkcji nie ma. */
const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

/** Sprawa w kształcie, który oddaje `/sale/issues` (pola z `PostPurchaseIssue`). */
function sprawa(nadpisz: Record<string, unknown> = {}) {
  return {
    id: "i-1",
    type: "CLAIM",
    referenceNumber: "123/2026",
    decisionDueDate: "2026-09-20T10:00:00.000Z",
    openedDate: "2026-09-06T10:00:00.000Z",
    subject: "DEFECT_FOUND_DURING_USE",
    description: null,
    right: "COMPLAINT",
    buyer: { login: "kupujacy1" },
    checkoutForm: { id: "zam-1" },
    offer: { id: "of-1", quantity: 1 },
    reason: { type: "DEFECT_FOUND_DURING_USE", description: "Pękła obudowa" },
    expectations: [{ name: "REFUND", refund: { amount: "129.99", currency: "PLN" } }],
    currentState: {
      status: "CLAIM_SUBMITTED", statusDueDate: "2026-09-20T10:00:00.000Z",
      returnRequired: true, chatActive: true,
    },
    chat: {
      messagesCount: 3,
      lastMessage: { status: "BUYER_REPLIED", createdAt: "2026-09-07T08:00:00.000Z" },
      initialMessage: {
        id: "w-1", text: "Kosiarka przestała ciąć po tygodniu",
        author: { login: "kupujacy1", role: "BUYER" },
        createdAt: "2026-09-06T10:01:00.000Z",
        attachments: [{ fileName: "usterka.jpg", url: "https://api.allegro.pl/sale/issues/attachments/a-1" }],
      },
    },
    attachments: [{ fileName: "paragon.pdf", url: "https://api.allegro.pl/sale/issues/attachments/a-2" }],
    ...nadpisz,
  };
}

/** Atrapa Allegro: lista pod jednym adresem, czat pod drugim. */
function api(issues: unknown[], czat: unknown[] = []) {
  const wywolania: string[] = [];
  const query = async (url: string) => {
    wywolania.push(url);
    if (url.includes("/chat")) return { chat: czat };
    /* Druga strona pusta — bez tego przebieg chodziłby do bezpiecznika stron. */
    return url.includes("offset=0") ? { issues } : { issues: [] };
  };
  return { query, wywolania };
}

test("dyskusje nie wchodzą do rejestru, ale są POLICZONE", async () => {
  const d = baza();
  const { query } = api([
    sprawa(),
    sprawa({ id: "i-2", type: "DISPUTE", referenceNumber: null, right: null }),
    sprawa({ id: "i-3", type: "DISPUTE" }),
  ]);

  const wynik = await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });

  assert.equal(wynik.reklamacji, 1, "do rejestru wchodzi wyłącznie CLAIM");
  assert.equal(wynik.dyskusji, 2);
  /* `node:sqlite` oddaje wiersze BEZ prototypu, a `deepEqual` ze `strict`
     porównuje także prototyp — stąd rozłożenie na zwykły obiekt. */
  const w = (d.prepare("SELECT external_id, typ FROM reklamacja_klienta").all() as
    Array<Record<string, unknown>>).map((r) => ({ ...r }));
  assert.deepEqual(w, [{ external_id: "i-1", typ: "CLAIM" }]);
  /* Liczba odsianych stoi w stanie synchronizacji, bo bez niej ktoś szukałby
     kiedyś reklamacji, która nigdy reklamacją nie była. */
  assert.equal(stanReklamacji(d).dyskusji, 2);
});

test("mapowanie bierze zegar Z ALLEGRO, nie liczy go samo", async () => {
  const d = baza();
  const { query } = api([sprawa()]);
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });

  const w = d.prepare("SELECT * FROM reklamacja_klienta WHERE external_id='i-1'")
    .get() as Record<string, unknown>;
  /* Termin przepisany jeden do jednego. Implementacja sprzed 0.140.0 liczyła
     ustawowe czternaście dni od zgłoszenia, bo nie wiedziała, że Allegro
     `decisionDueDate` w ogóle oddaje. */
  assert.equal(w.decyzja_do, "2026-09-20T10:00:00.000Z");
  assert.equal(w.status_do, "2026-09-20T10:00:00.000Z");
  assert.equal(w.order_id, "zam-1", "checkoutForm.id jest mostkiem do zamówienia");
  assert.equal(w.offer_id, "of-1");
  assert.equal(w.kupujacy_login, "kupujacy1");
  assert.equal(w.prawo, "COMPLAINT");
  assert.equal(w.powod_typ, "DEFECT_FOUND_DURING_USE");
  assert.equal(w.oczekiwanie, "REFUND");
  assert.equal(w.oczekiwana_kwota_grosze, 12999, "kwota liczona na tekście, nie przez float");
  assert.equal(w.zwrot_wymagany, 1);
  assert.equal(w.czat_aktywny, 1);
  assert.equal(w.wiadomosci_ile, 3);
  assert.equal(w.ostatnia_wiadomosc_status, "BUYER_REPLIED");
});

test("pierwsza wiadomość i oba załączniki są w bazie po JEDNYM żądaniu listy", async () => {
  const d = baza();
  const { query, wywolania } = api([sprawa()]);
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });

  const w = (d.prepare("SELECT external_id, autor_rola, tresc FROM reklamacja_wiadomosc")
    .all() as Array<Record<string, unknown>>).map((r) => ({ ...r }));
  assert.deepEqual(w, [{
    external_id: "w-1", autor_rola: "BUYER",
    tresc: "Kosiarka przestała ciąć po tygodniu",
  }]);
  /* Załącznik sprawy (`wiadomosc_id IS NULL`) i załącznik wiadomości stoją
     w jednej tabeli i rozróżnia je ta kolumna. */
  const z = (d.prepare(
    "SELECT nazwa, wiadomosc_id IS NULL AS sprawy FROM reklamacja_zalacznik ORDER BY nazwa")
    .all() as Array<Record<string, unknown>>).map((r) => ({ ...r }));
  assert.deepEqual(z, [
    { nazwa: "paragon.pdf", sprawy: 1 },
    { nazwa: "usterka.jpg", sprawy: 0 },
  ]);
  assert.equal(wywolania.filter((u) => u.includes("/chat")).length, 0,
    "przy `czatow: 0` nie pytamy o rozmowy ani razu");
});

test("drugi przebieg nie robi duplikatów i nie kasuje pracy biura", async () => {
  const d = baza();
  const { query } = api([sprawa()]);
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });

  const id = Number((d.prepare("SELECT id FROM reklamacja_klienta").get() as { id: number }).id);
  d.prepare("UPDATE reklamacja_klienta SET prowadzi='A. Lewandowska', notatka='dzwonię jutro' WHERE id=?")
    .run(id);

  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });

  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_klienta").get() as { n: number }).n, 1);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_wiadomosc").get() as { n: number }).n, 1);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_zalacznik").get() as { n: number }).n, 2);
  const w = { ...(d.prepare("SELECT prowadzi, notatka FROM reklamacja_klienta WHERE id=?")
    .get(id) as Record<string, unknown>) };
  assert.deepEqual(w, { prowadzi: "A. Lewandowska", notatka: "dzwonię jutro" },
    "ponowne pobranie nie ma prawa zabrać pracy człowieka");
});

test("rozmowę dociągamy tylko wtedy, gdy licznik Allegro rozjechał się z bazą", async () => {
  const d = baza();
  const czat = [
    { id: "w-1", text: "Kosiarka przestała ciąć po tygodniu",
      author: { login: "kupujacy1", role: "BUYER" }, createdAt: "2026-09-06T10:01:00.000Z" },
    { id: "w-2", text: "Proszę o zdjęcie noża",
      author: { role: "ADMIN" }, createdAt: "2026-09-06T12:00:00.000Z" },
    { id: "w-3", text: "Załączam", author: { login: "kupujacy1", role: "BUYER" },
      createdAt: "2026-09-07T08:00:00.000Z" },
  ];
  const { query, wywolania } = api([sprawa()], czat);

  await synchronizujAllegroReklamacje({ database: d, query });
  assert.equal(wywolania.filter((u) => u.includes("/chat")).length, 1);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_wiadomosc").get() as { n: number }).n, 3);
  /* Autor bez loginu przechodzi: schemat mówi wprost „not present if role is
     ADMIN, SYSTEM or FULFILLMENT", a doradca Allegro odpisał w 61 sprawach
     na 100 w sondzie. */
  const doradca = { ...(d.prepare(
    "SELECT autor_login, autor_rola FROM reklamacja_wiadomosc WHERE external_id='w-2'")
    .get() as Record<string, unknown>) };
  assert.deepEqual(doradca, { autor_login: null, autor_rola: "ADMIN" });

  /* Drugi przebieg: licznik zgadza się z bazą, więc o rozmowę nie pytamy. */
  await synchronizujAllegroReklamacje({ database: d, query });
  assert.equal(wywolania.filter((u) => u.includes("/chat")).length, 1,
    "kompletna rozmowa nie jest pytana drugi raz");
});

test("kolejka dociągania idzie po TERMINIE i pomija rozstrzygnięte", () => {
  const d = baza();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  const wstaw = (ext: string, termin: string | null, status: string) => d.prepare(
    `INSERT INTO reklamacja_klienta(channel_account_id,external_id,status_allegro,
       decyzja_do,wiadomosci_ile,otwarto_at,synced_at)
     VALUES (?,?,?,?,5,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')`)
    .run(konto, ext, status, termin);
  wstaw("late", "2026-09-30T00:00:00Z", "CLAIM_SUBMITTED");
  wstaw("pilna", "2026-09-08T00:00:00Z", "CLAIM_SUBMITTED");
  wstaw("bez", null, "CLAIM_SUBMITTED");
  wstaw("zamknieta", "2026-09-07T00:00:00Z", "CLAIM_ACCEPTED");

  const kolejka = czatyDoUzupelnienia(d, konto);
  assert.deepEqual(kolejka.map((k) => k.externalId), ["pilna", "late", "bez"],
    "przy ciasnym budżecie pierwszeństwo ma sprawa, która się najbardziej pali");
});

test("czysta arytmetyka: typ sprawy i pierwsze oczekiwanie", () => {
  assert.equal(czyReklamacja({ id: "a", type: "CLAIM" }), true);
  assert.equal(czyReklamacja({ id: "a", type: "DISPUTE" }), false);
  /* Element bez `name` nie mówi nic, więc bierzemy pierwszy, który go ma. */
  assert.deepEqual(
    pierwszeOczekiwanie({ id: "a", expectations: [{ name: null }, { name: "EXCHANGE" }] }),
    { nazwa: "EXCHANGE", grosze: null, waluta: "PLN" });
  assert.deepEqual(
    pierwszeOczekiwanie({ id: "a", expectations: null }),
    { nazwa: null, grosze: null, waluta: "PLN" });
});

test("bezpiecznik stron zostawia ŚLAD, a nie ciszę", async () => {
  const d = baza();
  /* Sto spraw na stronie znaczy „jest więcej"; atrapa oddaje pełne strony bez
     końca, więc przebieg musi urwać się na bezpieczniku i to zapisać. */
  const query = async (url: string) => {
    if (url.includes("/chat")) return { chat: [] };
    return { count: 5000, issues: Array.from({ length: 100 }, (_, i) =>
      sprawa({ id: `i-${url}-${i}` })) };
  };
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });
  const s = stanReklamacji(d);
  assert.equal(s.pozostalo, 4000, "1000 pobranych z 5000 — reszta została po tamtej stronie");
});

test("błąd Allegro podnosi licznik i zapisuje kod, a nie znika", async () => {
  const d = baza();
  const query = async () => { throw new Error("Allegro nie odpowiedziało"); };
  await assert.rejects(() => synchronizujAllegroReklamacje({ database: d, query }));
  const s = stanReklamacji(d);
  assert.equal(s.errorCount, 1);
  assert.ok(s.nextAttemptAt, "następna próba ma termin, a nie „kiedyś”");
});
