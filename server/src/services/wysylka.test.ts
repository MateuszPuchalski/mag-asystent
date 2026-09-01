import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { ConversationConflict, przejmijRozmowe, zapiszSzkic } from "./conversations.js";
import { kluczIdempotencji, LIMIT_ZNAKOW, wyslijOdpowiedz } from "./wysylka.js";
import { _wyczyscObecnosc, wejdzDoRozmowy, wyjdzZRozmowy } from "./conversation-realtime.js";
import type { WyslijDoAllegro } from "./allegro-wysylka.js";

/* Wysyłka jest jedyną drogą, którą treść wychodzi z WERTIS na zewnątrz.
   Ten plik pilnuje ośmiu warunków z §8.5 oraz dwóch blizn naraz: 0.110.0
   (kontrola świeżości — 409 i jawne „wyślij mimo to", nigdy ciche
   nadpisanie) i 0.128.0 (idempotencja; drugi strzał nie robi duplikatu). */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const agent = (login: string, name: string) => Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES (?,?,'biuro')").run(login, name).lastInsertRowid);
  const ala = agent("ala", "A. Lewandowska");
  const marek = agent("marek", "M. Wójcik");
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'t-4821','Kupujący 44300444')`)
    .run(konto).lastInsertRowid);
  const wiadomosc = (tresc: string, ext: string) => Number(d.prepare(
    `INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
     VALUES (?,?,?,'incoming',?,'2026-09-01T07:12:00.000Z')`)
    .run(rozmowa, konto, ext, tresc).lastInsertRowid);
  const pytanie = wiadomosc("Czy ten szarpak pasuje do NAC LS 46-450?", "m-88214");
  return { d, ala, marek, rozmowa, pytanie, wiadomosc };
}

const udany = (id = "m-99001"): WyslijDoAllegro => async () => ({ externalMessageId: id });
const autorAli = (id: number) => ({ id, name: "A. Lewandowska" });

/** Wpisy dziennika danego rodzaju — audyt jest częścią umowy, nie dodatkiem. */
const zdarzenia = (d: DatabaseSync, type: string) => d.prepare(
  "SELECT user_id, payload FROM events WHERE type=? ORDER BY id").all(type) as
  Array<{ user_id: string; payload: string | null }>;

const outbox = (d: DatabaseSync) => d.prepare(
  "SELECT id, status, idempotency_key, external_message_id, blad FROM outbox ORDER BY id").all() as
  Array<{ id: number; status: string; idempotency_key: string; external_message_id: string | null; blad: string | null }>;

/* Limit 2000 znaków stoi w schemacie `NewMessageInThread`. Sprawdzamy go PRZED
   wysłaniem, bo po wysłaniu jedyną informacją zwrotną jest 400 od Allegro
   i `send_failed` w kolejce — agent traci wtedy napisany tekst. */
test("odpowiedź dłuższa niż limit Allegro nie wychodzi z serwera", async () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  let strzalow = 0;

  await assert.rejects(
    wyslijOdpowiedz({
      conversationId: rozmowa, autor: autorAli(ala), body: "x".repeat(LIMIT_ZNAKOW + 1),
      expectedVersion: 2, expectedLastMessageId: pytanie, database: d,
      wyslij: async () => { strzalow += 1; return { externalMessageId: "nie-powinno" }; },
    }),
    /2000 znaków/);

  assert.equal(strzalow, 0, "za długa treść nie ma prawa dotknąć Allegro");
  assert.equal(outbox(d).length, 0, "odrzucona odpowiedź nie zostawia wiersza w kolejce");
});

test("udana wysyłka dopisuje wiadomość wychodzącą i kasuje szkic", async () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  zapiszSzkic(rozmowa, ala, "Pasuje, rozstaw 148 mm.", pytanie, null, d);

  const w = await wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje, rozstaw 148 mm.",
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  });
  assert.equal(w.status, "sent");
  assert.equal(w.externalMessageId, "m-99001");

  const wychodzaca = d.prepare(
    "SELECT body, external_message_id FROM message WHERE direction='outgoing'").get() as
    { body: string; external_message_id: string };
  assert.equal(wychodzaca.body, "Pasuje, rozstaw 148 mm.");
  assert.equal(wychodzaca.external_message_id, "m-99001");

  /* Szkic znika dopiero po UDANEJ wysyłce — przy każdym innym końcu zostaje. */
  assert.equal((d.prepare("SELECT count(*) n FROM conversation_draft").get() as {n:number}).n, 0);
  assert.equal(outbox(d)[0].status, "sent");

  /* Ruch jest teraz po stronie klienta i status mówi to sam. Gdyby czekał na
     kliknięcie, kłamałby przy pierwszej rozmowie, w której agent się spieszył. */
  assert.equal((d.prepare("SELECT status FROM conversation WHERE id=?").get(rozmowa) as
    { status: string }).status, "waiting_for_customer");
});

test("nieudana wysyłka NIE przestawia statusu na czekanie", async () => {
  /* Status ma opisywać to, co się stało. Odmowa Allegro znaczy, że klient
     dalej czeka na nas — a nie odwrotnie. */
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  await assert.rejects(() => wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje.",
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d,
    wyslij: async () => { throw new Error("400 Bad Request"); },
  }));
  assert.equal((d.prepare("SELECT status FROM conversation WHERE id=?").get(rozmowa) as
    { status: string }).status, "open");
});

test("wysyła ten, kto prowadzi rozmowę", async () => {
  const { d, ala, marek, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  await assert.rejects(() => wyslijOdpowiedz({
    conversationId: rozmowa, autor: { id: marek, name: "M. Wójcik" }, body: "Moja odpowiedź",
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  }), ConversationConflict);
  assert.equal(outbox(d).length, 0, "cudza wysyłka nie zostawia śladu w kolejce");
});

test("pusta treść i nieaktualna wersja rozmowy nie przechodzą", async () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  await assert.rejects(() => wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "   ",
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  }), /Pusta odpowiedź/);
  await assert.rejects(() => wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "Cokolwiek",
    expectedVersion: 1, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  }), ConversationConflict);
});

test("dopisek klienta zatrzymuje wysyłkę, a szkic zostaje nietknięty", async () => {
  const { d, ala, rozmowa, pytanie, wiadomosc } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  zapiszSzkic(rozmowa, ala, "Pasuje, rozstaw 148 mm.", pytanie, null, d);
  const dopisek = wiadomosc("Dopisuję: kosiarka jest z 2019.", "m-88903");

  let strzelono = false;
  try {
    await wyslijOdpowiedz({
      conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje, rozstaw 148 mm.",
      expectedVersion: 2, expectedLastMessageId: pytanie, database: d,
      wyslij: async () => { strzelono = true; return { externalMessageId: "m-x" }; },
    });
    assert.fail("wysyłka na starą wersję pytania miała odpaść");
  } catch (e) {
    assert.ok(e instanceof ConversationConflict);
    /* Dialog z makiety rysuje się dokładnie z tych pól. */
    assert.equal(e.details.lastMessageId, dopisek);
    assert.equal((e.details.nowaWiadomosc as { id: number }).id, dopisek);
    assert.match(String(e.details.kluczIdempotencji), /^snd-/);
  }

  assert.equal(strzelono, false, "nic nie poszło do Allegro");
  const szkic = d.prepare("SELECT body FROM conversation_draft WHERE conversation_id=?")
    .get(rozmowa) as { body: string };
  assert.equal(szkic.body, "Pasuje, rozstaw 148 mm.", "409 nie ma prawa skasować szkicu");
});

test("„wyślij mimo to\" przechodzi dopiero na jawną zgodę", async () => {
  const { d, ala, rozmowa, pytanie, wiadomosc } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  wiadomosc("Dopisuję: kosiarka jest z 2019.", "m-88903");

  const w = await wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje bez zmian.",
    expectedVersion: 2, expectedLastMessageId: pytanie, mimoNowejWiadomosci: true,
    database: d, wyslij: udany(),
  });
  assert.equal(w.status, "sent");
});

test("podwójne kliknięcie nie tworzy drugiej odpowiedzi", async () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  const tresc = "Pasuje, rozstaw 148 mm.";
  let strzaly = 0;
  const licz: WyslijDoAllegro = async () => { strzaly++; return { externalMessageId: "m-99001" }; };
  const zadanie = () => ({
    conversationId: rozmowa, autor: autorAli(ala), body: tresc,
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d, wyslij: licz,
  });

  const pierwsza = await wyslijOdpowiedz(zadanie());
  const druga = await wyslijOdpowiedz(zadanie());

  assert.equal(strzaly, 1, "drugie kliknięcie strzeliło do Allegro jeszcze raz");
  assert.equal(pierwsza.kluczIdempotencji, druga.kluczIdempotencji);
  assert.equal(outbox(d).length, 1, "kolejka ma jeden wiersz");
  assert.equal((d.prepare(
    "SELECT count(*) n FROM message WHERE direction='outgoing'").get() as {n:number}).n, 1);
});

test("poprawiona treść to inny zamiar, więc inny klucz", () => {
  const a = kluczIdempotencji(4821, 88903, "Pasuje.");
  assert.equal(a, kluczIdempotencji(4821, 88903, "Pasuje."));
  assert.notEqual(a, kluczIdempotencji(4821, 88903, "Pasuje, rozstaw 148 mm."));
  assert.notEqual(a, kluczIdempotencji(4821, 88214, "Pasuje."));
});

test("odmowa Allegro zostaje w kolejce razem z treścią odpowiedzi serwera", async () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  await assert.rejects(() => wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje.",
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d,
    wyslij: async () => { throw new Error("Allegro odrzuciło żądanie (422): nieznane pole"); },
  }), /422/);

  const [w] = outbox(d);
  assert.equal(w.status, "send_failed");
  /* Kształt POST pochodzi z pamięci, więc pierwszy prawdziwy strzał ma sam
     podać właściwy kształt. Bez zapisanej odpowiedzi nie byłoby z czego. */
  assert.match(w.blad!, /nieznane pole/);
  assert.equal((d.prepare(
    "SELECT count(*) n FROM message WHERE direction='outgoing'").get() as {n:number}).n, 0);
});

test("timeout daje stan niepewny i nie ponawia się sam", async () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  const zadanie = () => ({
    conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje.",
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d,
  });

  await assert.rejects(() => wyslijOdpowiedz({ ...zadanie(),
    wyslij: async () => { throw new Error("Brak połączenia z Allegro — (The operation was aborted due to timeout)"); },
  }));
  assert.equal(outbox(d)[0].status, "send_uncertain");

  /* §8.5: po niejednoznacznym timeoucie system NAJPIERW synchronizuje wątek.
     Ponowienie na ślepo mogłoby wysłać tę samą odpowiedź drugi raz. */
  let strzaly = 0;
  await assert.rejects(() => wyslijOdpowiedz({ ...zadanie(),
    wyslij: async () => { strzaly++; return { externalMessageId: "m-1" }; },
  }), /zsynchronizuj wątek/);
  assert.equal(strzaly, 0);
});

test("brak numeru od Allegro to stan niepewny, nie wiadomość na osi", async () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  const w = await wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje.",
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d,
    wyslij: async () => ({ externalMessageId: null }),
  });

  /* Wiersz z lokalnym numerem zdublowałby się przy synchronizacji, a §8.4
     zabrania, żeby wiadomość wróciła z nowym numerem. */
  assert.equal(w.status, "send_uncertain");
  assert.equal((d.prepare(
    "SELECT count(*) n FROM message WHERE direction='outgoing'").get() as {n:number}).n, 0);
});

test("każdy koniec wysyłki zostawia ślad w dzienniku, bez treści", async () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  const tajne = "Numer seryjny klienta LS19-0042";
  await wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: tajne,
    expectedVersion: 2, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  });

  const typy = (d.prepare("SELECT type FROM events WHERE type LIKE 'rozmowa_wys%' OR type='rozmowa_wyslana' ORDER BY id")
    .all() as Array<{ type: string }>).map((w) => w.type);
  assert.deepEqual(typy, ["rozmowa_wysylka_proba", "rozmowa_wyslana"]);

  const payloady = (d.prepare("SELECT payload FROM events").all() as Array<{payload: string|null}>)
    .map((w) => w.payload ?? "").join(" ");
  assert.ok(!payloady.includes(tajne), "treść odpowiedzi przeciekła do dziennika");
});

/* ── Uchwyt rozmowy i przydział przez odpowiedź (0.158.0) ────────────────────
   Decyzja właściciela: wejście w pytanie trzyma je na czas siedzenia,
   odpowiedź przydziela na stałe. Uchwyt żyje w PAMIĘCI, więc każdy test
   zaczyna od czystego stanu — inaczej niósłby się między nimi. */

test("odpowiedź na nieprzypisaną rozmowę przydziela ją na stałe", async () => {
  _wyczyscObecnosc();
  const { d, ala, rozmowa, pytanie } = stanowisko();
  /* ANI JEDNEGO przejęcia po drodze: agent wszedł w pytanie i odpisał. */
  const w = await wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje, rozstaw 148 mm.",
    expectedVersion: 1, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  });
  assert.equal(w.status, "sent");

  const c = d.prepare("SELECT assigned_user_id, version FROM conversation WHERE id=?")
    .get(rozmowa) as { assigned_user_id: number; version: number };
  assert.equal(c.assigned_user_id, ala, "kto odpisał klientowi, ten prowadzi sprawę");
  assert.equal(c.version, 2, "przydział jest decyzją człowieka, więc podnosi wersję");
  /* Historia przypisań ma pokazać, skąd wzięło się to przypisanie. */
  assert.equal((d.prepare("SELECT count(*) n FROM conversation_assignment WHERE conversation_id=?")
    .get(rozmowa) as { n: number }).n, 1);
  assert.equal(zdarzenia(d, "rozmowa_przypisana_odpowiedzia").length, 1);
});

test("uchwyt kolegi zatrzymuje odpowiedź, dopóki nie padnie jawne „mimo to\"", async () => {
  _wyczyscObecnosc();
  const { d, ala, marek, rozmowa, pytanie } = stanowisko();
  /* Ala weszła pierwsza i siedzi przy pytaniu. */
  wejdzDoRozmowy(rozmowa, ala, "A. Lewandowska");

  await assert.rejects(() => wyslijOdpowiedz({
    conversationId: rozmowa, autor: { id: marek, name: "M. Wójcik" }, body: "Pasuje.",
    expectedVersion: 1, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  }), (e: unknown) => {
    assert.ok(e instanceof ConversationConflict);
    assert.match(e.message, /siedzi A. Lewandowska/);
    assert.equal(e.details.trzymajacyUserId, ala);
    return true;
  });
  assert.equal((d.prepare("SELECT count(*) n FROM message WHERE direction='outgoing'")
    .get() as { n: number }).n, 0, "zablokowana odpowiedź nie idzie do klienta");

  /* Blokada jest MIĘKKA: kolega mógł zostawić otwartą zakładkę i wyjść. */
  const w = await wyslijOdpowiedz({
    conversationId: rozmowa, autor: { id: marek, name: "M. Wójcik" }, body: "Pasuje.",
    expectedVersion: 1, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
    mimoObecnosci: true,
  });
  assert.equal(w.status, "sent");
  assert.equal((d.prepare("SELECT assigned_user_id FROM conversation WHERE id=?")
    .get(rozmowa) as { assigned_user_id: number }).assigned_user_id, marek);
});

test("wyjście z pytania puszcza uchwyt i nie zostawia nic w bazie", async () => {
  _wyczyscObecnosc();
  const { d, ala, marek, rozmowa, pytanie } = stanowisko();
  wejdzDoRozmowy(rozmowa, ala, "A. Lewandowska");
  /* Wyjście BEZ odpowiedzi: rozmowa wraca do puli, a w bazie nie ma po tym
     śladu — cały uchwyt żył w pamięci procesu (§6.3). */
  wyjdzZRozmowy(rozmowa, ala);
  assert.equal((d.prepare("SELECT assigned_user_id FROM conversation WHERE id=?")
    .get(rozmowa) as { assigned_user_id: number | null }).assigned_user_id, null);
  assert.equal(zdarzenia(d, "rozmowa_przypisana_odpowiedzia").length, 0);

  const w = await wyslijOdpowiedz({
    conversationId: rozmowa, autor: { id: marek, name: "M. Wójcik" }, body: "Pasuje.",
    expectedVersion: 1, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  });
  assert.equal(w.status, "sent", "po wyjściu kolegi nikt już nie blokuje");
});

test("własny uchwyt nie blokuje własnej odpowiedzi", async () => {
  _wyczyscObecnosc();
  const { d, ala, rozmowa, pytanie } = stanowisko();
  wejdzDoRozmowy(rozmowa, ala, "A. Lewandowska");
  const w = await wyslijOdpowiedz({
    conversationId: rozmowa, autor: autorAli(ala), body: "Pasuje.",
    expectedVersion: 1, expectedLastMessageId: pytanie, database: d, wyslij: udany(),
  });
  assert.equal(w.status, "sent");
});
