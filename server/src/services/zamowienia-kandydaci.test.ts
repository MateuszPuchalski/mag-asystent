import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kandyd-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Które zamówienie dotyczy tej rozmowy (0.397.0) ──────────────────────────
   Zgłoszenie właściciela ze zrzutem: klient napisał pod OFERTĄ „otrzymałem
   paczkę, ale nie było w zestawie świecy" — i nigdzie nie było powiązania
   rozmowy z jego zamówieniem. Wątek niesie JEDEN obiekt powiązany, a przy
   pytaniu spod oferty jest nim oferta.

   Testy pilnują czterech granic, bo każda kosztuje co innego:

   1. CUDZY ZAKUP NIE MA TU WSTĘPU. Pomyłka w złączeniu pokazałaby agentowi
      zamówienie obcej osoby — a stamtąd prosta droga do odpowiedzi wysłanej
      niewłaściwemu klientowi.
   2. WIELKOŚĆ LITER NIE ROZSTRZYGA. Allegro oddaje ten sam login raz małymi,
      raz wielkimi literami; porównanie wrażliwe gubiłoby zakupy i wyglądało
      jak „klient pierwszy raz u nas".
   3. OFERTA Z ROZMOWY PODNOSI KANDYDATA. To jedyna przesłanka mocniejsza od
      czasu, jaką mamy.
   4. WSKAZANIE JEST SPRAWDZANE PO STRONIE SERWERA. Panel wysyła sam numer,
      więc bramka musi stać tutaj, nie w przycisku.                          */

let db: typeof import("../db/db.js").db;
let kandydaciZamowien: typeof import("./zamowienia-kandydaci.js").kandydaciZamowien;
let wskazZamowienie: typeof import("./zamowienia-kandydaci.js").wskazZamowienie;
let zamowienieWskazane: typeof import("./zamowienia-kandydaci.js").zamowienieWskazane;

let konto = 0;
let rozmowaId = 0;
let agent = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ kandydaciZamowien, wskazZamowienie, zamowienieWskazane } =
    await import("./zamowienia-kandydaci.js"));
});

function rozmowa(watek: string, login: string | null): number {
  const d = db();
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES (?,0,?,'{}','2026-09-17T16:39:00.000Z')`).run(watek, login);
  return Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject,updated_at) VALUES (?,?,?,?)`)
    .run(konto, watek, "Brak w zestawie", "2026-09-17T16:39:00.000Z").lastInsertRowid);
}

/** Wiadomość klienta powiązana z OFERTĄ — dokładnie przypadek ze zgłoszenia. */
function pytanieSpodOferty(id: number, ofertaId: string): void {
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at,related_object_type,related_object_id)
    VALUES (?,?,?,'incoming','Nie było świecy w zestawie','2026-09-17T16:39:00.000Z','OFFER',?)`)
    .run(id, konto, `m-${id}-${ofertaId}`, ofertaId);
}

function zakup(login: string, externalId: string, kiedy: string,
  pozycje: Array<[string, string | null]>): void {
  const d = db();
  const id = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,
    kupujacy_login,kupiono_at,suma_grosze,waluta,synced_at) VALUES (?,?,?,?,5500,'PLN',?)`)
    .run(konto, externalId, login, kiedy, kiedy).lastInsertRowid);
  for (const [nazwa, offerId] of pozycje) {
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,nazwa,offer_id,ilosc,
      cena_grosze,waluta) VALUES (?,?,?,1,5500,'PLN')`).run(id, nazwa, offerId);
  }
}

beforeEach(() => {
  const d = db();
  for (const t of ["conversation_event", "zamowienie_klienta_pozycja", "zamowienie_klienta",
    "message", "conversation", "allegro_inbox_thread", "channel_account", "app_user", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  agent = Number(d.prepare("INSERT INTO app_user(name,role) VALUES ('A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  rozmowaId = rozmowa("w-chips20", "chips20");
  pytanieSpodOferty(rozmowaId, "13187800218");
});

test("pytanie spod OFERTY dostaje zakupy tego kupującego", () => {
  /* Sedno zgłoszenia: rozmowa nie ma numeru zamówienia i mieć go nie będzie,
     a zakup leży w bazie i dotąd nie docierał tu wcale. */
  zakup("chips20", "ord-1", "2026-09-15T08:00:00.000Z", [["Filtr powietrza", "13187800218"]]);

  const k = kandydaciZamowien(rozmowaId);
  assert.equal(k.length, 1);
  assert.equal(k[0].externalId, "ord-1");
  assert.equal(k[0].pozycje, "Filtr powietrza");
});

test("CUDZY zakup nie ma tu wstępu", () => {
  /* Najdroższa pomyłka w tym pliku: agent zobaczyłby zamówienie obcej osoby
     pod loginem, który ma przed oczami. */
  zakup("chips20", "ord-moj", "2026-09-15T08:00:00.000Z", [["Filtr", "13187800218"]]);
  zakup("kto_inny", "ord-obcy", "2026-09-16T08:00:00.000Z", [["Filtr", "13187800218"]]);

  assert.deepEqual(kandydaciZamowien(rozmowaId).map((k) => k.externalId), ["ord-moj"]);
});

test("WIELKOŚĆ LITER w loginie nie rozstrzyga", () => {
  /* W tej samej rozmowie nagłówek wątku mówi „chips20", a podpis wiadomości
     „CHIPS20" — to ten sam człowiek i ten sam zakup. */
  zakup("CHIPS20", "ord-1", "2026-09-15T08:00:00.000Z", [["Filtr", "13187800218"]]);

  assert.deepEqual(kandydaciZamowien(rozmowaId).map((k) => k.externalId), ["ord-1"]);
});

test("zakup z OFERTĄ Z ROZMOWY idzie na górę, mimo że jest starszy", () => {
  /* Jedyna przesłanka mocniejsza od czasu. Nowszy zakup zostaje na liście —
     „rzadko" to nie „nigdy" — ale nie stoi pierwszy. */
  zakup("chips20", "ord-stary-z-oferta", "2026-08-01T08:00:00.000Z", [["Filtr", "13187800218"]]);
  zakup("chips20", "ord-nowy-bez-oferty", "2026-09-16T08:00:00.000Z", [["Nóż", "999"]]);

  const k = kandydaciZamowien(rozmowaId);
  assert.deepEqual(k.map((x) => x.externalId), ["ord-stary-z-oferta", "ord-nowy-bez-oferty"]);
  assert.equal(k[0].maTeOferte, true);
  assert.equal(k[1].maTeOferte, false);
});

test("bez loginu w lądowisku lista jest pusta, a nie przypadkowa", () => {
  /* Wątek zamaskowany: bez loginu nie ma mostka. Pusta lista jest jedyną
     uczciwą odpowiedzią — dobranie „po czasie" dałoby cudzy zakup. */
  const bezLoginu = rozmowa("w-anonim", null);
  zakup("chips20", "ord-1", "2026-09-15T08:00:00.000Z", [["Filtr", "13187800218"]]);

  assert.deepEqual(kandydaciZamowien(bezLoginu), []);
});

test("wskazanie zapisuje wybór razem z IMIENIEM człowieka", () => {
  zakup("chips20", "ord-1", "2026-09-15T08:00:00.000Z", [["Filtr", "13187800218"]]);

  wskazZamowienie(rozmowaId, "ord-1", agent);
  assert.deepEqual(zamowienieWskazane(rozmowaId), {
    externalId: "ord-1", autor: "A. Lewandowska",
  });
});

test("wskazanie CUDZEGO zamówienia serwer odbija", () => {
  /* Bramka stoi tutaj, a nie w przycisku: panel wysyła sam numer. */
  zakup("kto_inny", "ord-obcy", "2026-09-16T08:00:00.000Z", [["Filtr", "13187800218"]]);

  assert.throws(() => wskazZamowienie(rozmowaId, "ord-obcy", agent),
    /nie należy do kupującego/);
  assert.equal(zamowienieWskazane(rozmowaId), null);
});

test("pomyłkę poprawia się WSKAZANIEM INNEGO, a nie kasowaniem", () => {
  /* Ostatni wpis wygrywa, a historia zostaje w zdarzeniach rozmowy. */
  zakup("chips20", "ord-1", "2026-09-15T08:00:00.000Z", [["Filtr", "13187800218"]]);
  zakup("chips20", "ord-2", "2026-09-10T08:00:00.000Z", [["Nóż", "999"]]);

  wskazZamowienie(rozmowaId, "ord-1", agent);
  wskazZamowienie(rozmowaId, "ord-2", agent);
  assert.equal(zamowienieWskazane(rozmowaId)?.externalId, "ord-2");

  const wpisow = db().prepare(`SELECT COUNT(*) AS n FROM conversation_event
    WHERE conversation_id=? AND event_type='order_linked_manually'`).get(rozmowaId) as { n: number };
  assert.equal(wpisow.n, 2);
});

test("wskazanie zostawia ślad w dzienniku", () => {
  /* Każda mutacja woła `logEvent` — powiązanie zmienia to, co agent widzi
     o kliencie, więc musi dać się odtworzyć. */
  zakup("chips20", "ord-1", "2026-09-15T08:00:00.000Z", [["Filtr", "13187800218"]]);
  wskazZamowienie(rozmowaId, "ord-1", agent);

  const e = db().prepare(
    "SELECT user_id FROM events WHERE type='rozmowa_zamowienie_wskazane'").get() as
    { user_id: string } | undefined;
  assert.equal(e?.user_id, "A. Lewandowska");
});
