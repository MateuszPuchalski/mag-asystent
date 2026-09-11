import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  czatyDoUzupelnienia, czyReklamacja, odswiezSprawe, pierwszeOczekiwanie,
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

test("dyskusje WCHODZĄ do rejestru z własnym typem i są policzone (0.245.0)", async () => {
  /* Do 0.244.0 ten test pilnował rzeczy odwrotnej: dyskusje leciały do kosza
     w pamięci, bo panel prowadził wyłącznie reklamacje. Właściciel odwrócił tę
     decyzję 9 września 2026, więc obie gałęzie lądują w bazie, a rozróżnia je
     kolumna `typ`. Licznik `dyskusji` ZOSTAŁ i zmienił znaczenie z „ile
     wyrzuciliśmy" na „ile przyjechało" — jest teraz kontrolą krzyżową dla
     licznika kolejki dyskusji. */
  const d = baza();
  const { query } = api([
    sprawa(),
    sprawa({ id: "i-2", type: "DISPUTE", referenceNumber: null, right: null }),
    sprawa({ id: "i-3", type: "DISPUTE" }),
  ]);

  const wynik = await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });

  assert.equal(wynik.reklamacji, 1, "licznik reklamacji nie liczy dyskusji");
  assert.equal(wynik.dyskusji, 2);
  /* `node:sqlite` oddaje wiersze BEZ prototypu, a `deepEqual` ze `strict`
     porównuje także prototyp — stąd rozłożenie na zwykły obiekt. */
  const w = (d.prepare("SELECT external_id, typ FROM reklamacja_klienta ORDER BY external_id")
    .all() as Array<Record<string, unknown>>).map((r) => ({ ...r }));
  assert.deepEqual(w, [
    { external_id: "i-1", typ: "CLAIM" },
    { external_id: "i-2", typ: "DISPUTE" },
    { external_id: "i-3", typ: "DISPUTE" },
  ], "typ bierze się z ładunku Allegro, nie z gałęzi kodu");
  assert.equal(stanReklamacji(d).dyskusji, 2);
});

test("dyskusja bez pól reklamacyjnych zapisuje się pustymi kolumnami, nie zgadywanymi", async () => {
  /* Schemat mówi `Null for disputes` przy `referenceNumber`, `decisionDueDate`,
     `reason`, `right` i `expectations`. Podstawienie tam czegokolwiek zrobiłoby
     z dyskusji reklamację bez tytułu prawnego. */
  const d = baza();
  const { query } = api([sprawa({
    id: "d-1", type: "DISPUTE", referenceNumber: null, right: null,
    decisionDueDate: null, reason: null, expectations: null,
  })]);
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });
  const w = d.prepare("SELECT * FROM reklamacja_klienta WHERE external_id='d-1'")
    .get() as Record<string, unknown>;
  assert.equal(w.typ, "DISPUTE");
  for (const kolumna of ["reference_number", "decyzja_do", "prawo", "powod_typ", "oczekiwanie"]) {
    assert.equal(w[kolumna], null, kolumna);
  }
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

test("werdykt biura jest nietykalny przy ponownym pobraniu; `ilosc` idzie z `offer.quantity`", async () => {
  const d = baza();
  const { query } = api([sprawa({ offer: { id: "of-1", quantity: 3 } })]);
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });
  const id = Number((d.prepare("SELECT id FROM reklamacja_klienta").get() as { id: number }).id);
  assert.equal((d.prepare("SELECT ilosc FROM reklamacja_klienta WHERE id=?").get(id) as { ilosc: number }).ilosc, 3);

  d.prepare(`UPDATE reklamacja_klienta SET werdykt='ACCEPTED_REFUND', werdykt_wiadomosc='Zwracamy.',
    werdykt_status='sent', werdykt_przez='A. Lewandowska', zwrot_towaru='wymagany' WHERE id=?`).run(id);
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });
  const w = { ...(d.prepare(
    "SELECT werdykt, werdykt_wiadomosc, werdykt_status, werdykt_przez, zwrot_towaru FROM reklamacja_klienta WHERE id=?",
  ).get(id) as Record<string, unknown>) };
  assert.deepEqual(w, {
    werdykt: "ACCEPTED_REFUND", werdykt_wiadomosc: "Zwracamy.", werdykt_status: "sent",
    werdykt_przez: "A. Lewandowska", zwrot_towaru: "wymagany",
  }, "werdykt to praca biura — ponowne pobranie go nie rusza");
  /* Śmieci w `quantity` dają NULL, nie zero: zero kłamałoby o sufit kwoty. */
  const { query: q2 } = api([sprawa({ id: "i-2", offer: { id: "of-2", quantity: 0 } })]);
  await synchronizujAllegroReklamacje({ database: d, query: q2, czatow: 0 });
  assert.equal((d.prepare("SELECT ilosc FROM reklamacja_klienta WHERE external_id='i-2'").get() as { ilosc: unknown }).ilosc, null);
});

test("status z Allegro rozstrzyga niejednoznaczny werdykt: ta sama gałąź potwierdza, inna nazywa porażkę", async () => {
  const d = baza();
  await synchronizujAllegroReklamacje({ database: d, query: api([sprawa()]).query, czatow: 0 });
  const id = Number((d.prepare("SELECT id FROM reklamacja_klienta").get() as { id: number }).id);
  const stan = () => ({ ...(d.prepare(
    "SELECT werdykt, werdykt_status, werdykt_blad, status_allegro FROM reklamacja_klienta WHERE id=?",
  ).get(id) as Record<string, unknown>) });
  const ustaw = (status: string) => d.prepare(
    "UPDATE reklamacja_klienta SET werdykt='REJECTED_OTHER', werdykt_status=?, werdykt_blad=NULL WHERE id=?",
  ).run(status, id);
  const allegro = (status: string) => api([sprawa({
    currentState: { status, statusDueDate: null, returnRequired: null, chatActive: false },
  })]).query;

  /* Wciąż CLAIM_SUBMITTED — nic nie wiadomo, `send_uncertain` zostaje. */
  ustaw("send_uncertain");
  await synchronizujAllegroReklamacje({ database: d, query: allegro("CLAIM_SUBMITTED"), czatow: 0 });
  assert.equal(stan().werdykt_status, "send_uncertain");

  /* Odmowa potwierdzona odmową. */
  await synchronizujAllegroReklamacje({ database: d, query: allegro("CLAIM_REJECTED"), czatow: 0 });
  assert.deepEqual(stan(), {
    werdykt: "REJECTED_OTHER", werdykt_status: "sent", werdykt_blad: null, status_allegro: "CLAIM_REJECTED",
  });

  /* `sent` już nikt nie przestawia, nawet gdy Allegro pokaże co innego. */
  await synchronizujAllegroReklamacje({ database: d, query: allegro("CLAIM_ACCEPTED"), czatow: 0 });
  assert.equal(stan().werdykt_status, "sent");

  /* Niejednoznaczna odmowa, a Allegro pokazuje UZNANIE: nasz werdykt nie
     zapadł — ktoś rozstrzygnął w Centrum Sprzedaży. Porażka ze zdaniem. */
  ustaw("send_uncertain");
  await synchronizujAllegroReklamacje({ database: d, query: allegro("CLAIM_ACCEPTED"), czatow: 0 });
  const po = stan();
  assert.equal(po.werdykt_status, "send_failed");
  assert.match(String(po.werdykt_blad), /CLAIM_ACCEPTED.*REJECTED_OTHER.*poza panelem/);
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

/* ── Stronicowanie rozmowy i filtr statusów (0.273.0) ────────────────────────
   Do 0.272.0 rozmowa jechała JEDNYM żądaniem bez offsetu, choć adres umiał go
   od początku. Sprawy dłuższe niż sto wiadomości były przez to przycięte na
   zawsze — a ekran obiecywał przy nich, że reszta dojdzie następną
   synchronizacją. Gorzej: taka sprawa spełniała warunek doboru rozmów po
   KAŻDYM przebiegu i głodziła budżet pozostałych.                           */

/** Wiadomość czatu o zadanym numerze — tyle, ile trzeba, żeby ją zapisać. */
const wiad = (n: number) => ({
  id: `w-${n}`, text: `wiadomość ${n}`,
  author: { login: "kupujacy1", role: "BUYER" },
  createdAt: "2026-09-06T10:01:00.000Z",
});

/**
 * Atrapa, w której rozmowa ma ZADANĄ długość i stronicuje się naprawdę.
 *
 * `czaty` mapuje identyfikator sprawy na liczbę wiadomości; adres z `offset`
 * dostaje właściwy wycinek, więc test sprawdza zachowanie, a nie atrapę.
 */
function apiZeStronami(issues: unknown[], czaty: Record<string, number>) {
  const wywolania: string[] = [];
  const query = async (url: string) => {
    wywolania.push(url);
    const m = /\/sale\/issues\/([^/?]+)\/chat/.exec(url);
    if (m) {
      const ile = czaty[m[1]] ?? 0;
      const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? 0);
      return { chat: Array.from({ length: Math.max(0, Math.min(100, ile - offset)) },
        (_, i) => wiad(offset + i + 1)) };
    }
    return url.includes("offset=0") ? { issues } : { issues: [] };
  };
  return { query, wywolania };
}

const ileWiadomosci = (d: DatabaseSync, ext: string) => Number((d.prepare(
  `SELECT COUNT(*) n FROM reklamacja_wiadomosc w JOIN reklamacja_klienta r ON r.id=w.reklamacja_id
    WHERE r.external_id=?`).get(ext) as { n: number }).n);

test("rozmowa dłuższa niż sto wiadomości dociąga się W CAŁOŚCI, stronami", async () => {
  const d = baza();
  const { query, wywolania } = apiZeStronami(
    [sprawa({ chat: { messagesCount: 150, lastMessage: null, initialMessage: wiad(1) } })],
    { "i-1": 150 });

  await synchronizujAllegroReklamacje({ database: d, query });

  assert.equal(ileWiadomosci(d, "i-1"), 150, "druga strona rozmowy też jest zapisana");
  const strony = wywolania.filter((u) => u.includes("/chat"));
  assert.equal(strony.length, 2, "dwie strony, nie jedna i nie trzy");
  assert.match(strony[1], /offset=100/);
  /* Rozmowa kompletna, więc sprawa NIE wraca po nią następnym przebiegiem. */
  assert.deepEqual(czatyDoUzupelnienia(d, 1), []);
});

test("bezpiecznik stron urywa rozmowę JAWNIE — i sprawa przestaje głodzić budżet", async () => {
  /* Pięć stron to pięćset wiadomości. Rozmowa dłuższa zostaje niepełna, ale
     wiersz mówi to wprost, zamiast wracać po resztę w każdym takcie. */
  const d = baza();
  const { query, wywolania } = apiZeStronami(
    [sprawa({ chat: { messagesCount: 10_000, lastMessage: null, initialMessage: wiad(1) } })],
    { "i-1": 10_000 });

  await synchronizujAllegroReklamacje({ database: d, query });

  assert.equal(wywolania.filter((u) => u.includes("/chat")).length, 5, "bezpiecznik trzyma");
  assert.equal(ileWiadomosci(d, "i-1"), 500);
  assert.equal(Number((d.prepare("SELECT czat_urwany FROM reklamacja_klienta WHERE external_id='i-1'")
    .get() as { czat_urwany: number }).czat_urwany), 1, "urwanie jest ZAPISANE, nie domyślane");
  assert.deepEqual(czatyDoUzupelnienia(d, 1), [],
    "sprawa z urwaną rozmową nie wraca do kolejki — inaczej głodziłaby resztę");
});

test("jedna gruba rozmowa NIE wypycha z budżetu spraw, które da się domknąć", async () => {
  /* Blizna 0.273.0 w czystej postaci: przy budżecie trzech rozmów sprawa
     gruba stała na czele kolejki w kółko, bo sortowanie idzie po terminie
     decyzji, a jej warunek był prawdziwy zawsze. */
  const d = baza();
  const sprawy = [
    sprawa({ id: "gruba", decisionDueDate: "2026-09-08T10:00:00.000Z",
      chat: { messagesCount: 10_000, lastMessage: null, initialMessage: wiad(1) } }),
    ...[1, 2, 3].map((n) => sprawa({
      id: `chuda-${n}`, decisionDueDate: `2026-09-1${n}T10:00:00.000Z`,
      chat: { messagesCount: 3, lastMessage: null, initialMessage: wiad(1) },
    })),
  ];
  const { query } = apiZeStronami(sprawy,
    { gruba: 10_000, "chuda-1": 3, "chuda-2": 3, "chuda-3": 3 });

  /* Dwa przebiegi z budżetem trzech: w pierwszym gruba zjada swoje strony,
     w drugim NIE ma jej już w kolejce i chude schodzą do zera. */
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 3 });
  await synchronizujAllegroReklamacje({ database: d, query, czatow: 3 });

  for (const n of [1, 2, 3]) {
    assert.equal(ileWiadomosci(d, `chuda-${n}`), 3, `chuda-${n} została domknięta`);
  }
});

test("przebieg pyta NAJPIERW o sprawy otwarte, potem o całą listę", async () => {
  /* Lista jedzie malejąco po dacie otwarcia, a bezpiecznik stron ucina jej
     ogon — czyli sprawy najstarsze, czyli najbardziej spóźnione. Filtr
     `status` ze specyfikacji zawęża pierwszy przelot do spraw żywych. */
  const d = baza();
  const { query, wywolania } = apiZeStronami([sprawa()], { "i-1": 3 });

  await synchronizujAllegroReklamacje({ database: d, query, czatow: 0 });

  const listy = wywolania.filter((u) => u.includes("/sale/issues?"));
  assert.match(listy[0], /status=CLAIM_SUBMITTED/);
  assert.match(listy[0], /status=DISPUTE_ONGOING/);
  assert.match(listy[0], /status=DISPUTE_UNRESOLVED/);
  assert.ok(!listy[listy.length - 1].includes("status="),
    "przelot pełny zostaje bez filtra — to on domyka sprawy rozstrzygnięte");
  /* Sprawa widziana w obu przelotach zapisuje się RAZ i liczy się raz. */
  assert.equal(Number((d.prepare("SELECT COUNT(*) n FROM reklamacja_klienta")
    .get() as { n: number }).n), 1);
});

test("odświeżenie JEDNEJ sprawy nie rusza pracy człowieka", async () => {
  /* Blizna 0.128.0 rozszerzona o pracę biura: ponowne pobranie uzupełnia pola
     z Allegro, ale `prowadzi`, `notatka` i `wersja` należą do nas. */
  const d = baza();
  const { query } = apiZeStronami([sprawa()], { "i-1": 3 });
  /* Pierwszy przebieg Z rozmową, żeby licznik zgadzał się przed odświeżeniem —
     inaczej test sprawdzałby dociąganie braków, a nie oszczędność żądań. */
  await synchronizujAllegroReklamacje({ database: d, query });
  d.prepare(`UPDATE reklamacja_klienta SET prowadzi='Ala', notatka='moje ustalenia', wersja=7
    WHERE external_id='i-1'`).run();
  const id = Number((d.prepare("SELECT id FROM reklamacja_klienta WHERE external_id='i-1'")
    .get() as { id: number }).id);

  const wywolania: string[] = [];
  const pojedyncza = async (url: string) => {
    wywolania.push(url);
    if (url.includes("/chat")) return { chat: [wiad(1), wiad(2), wiad(3)] };
    return sprawa({ currentState: { status: "CLAIM_ACCEPTED", chatActive: false } });
  };

  assert.equal(await odswiezSprawe(id, { database: d, query: pojedyncza }), true);

  const w = d.prepare(`SELECT status_allegro, czat_aktywny, prowadzi, notatka, wersja
    FROM reklamacja_klienta WHERE id=?`).get(id) as Record<string, unknown>;
  assert.equal(w.status_allegro, "CLAIM_ACCEPTED", "stan z Allegro jest świeży");
  assert.equal(Number(w.czat_aktywny), 0);
  assert.equal(w.prowadzi, "Ala");
  assert.equal(w.notatka, "moje ustalenia");
  assert.equal(Number(w.wersja), 7, "wersja jest nasza — odświeżenie jej nie podnosi");
  assert.ok(!wywolania.some((u) => u.includes("/chat")),
    "licznik się zgadza, więc po rozmowę nie idziemy");
});

test("odświeżenie sprawy, której nie ma, mówi to zamiast strzelać do Allegro", async () => {
  const d = baza();
  let strzalow = 0;
  const wynik = await odswiezSprawe(999, {
    database: d, query: async () => { strzalow += 1; return null; },
  });
  assert.equal(wynik, false);
  assert.equal(strzalow, 0);
});
