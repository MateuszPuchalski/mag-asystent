import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  ConversationConflict, dodajKomentarz, dopiszZdarzenieWyniku, odlozRozmowe, przejmijRozmowe,
  ustawStatusRozmowy, zapiszSzkic, zapiszWiadomosc,
} from "./conversations.js";

/* Serwis rozmów nie miał testu obok do 0.145.1, choć trzyma trzy mutacje
   i całą współbieżność panelu. Ten plik pilnuje dwóch rzeczy naraz: że wyścig
   agentów rozstrzyga się jednym zapisem ORAZ że każda mutacja zostawia ślad
   w dzienniku — bo bez śladu wróciłaby blizna 0.137.1.

   Baza to schemat PLUS `migrate()`: `events.user_ref` dochodzi dostawką,
   więc sam `schema.sql` opisuje kształt, którego na produkcji nie ma. */
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
    external_conversation_id,subject) VALUES (?,'w-1','Kupujący 44300444')`)
    .run(konto).lastInsertRowid);
  const wiadomosc = (tresc: string, external: string) => Number(d.prepare(
    `INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
     VALUES (?,?,?,'incoming',?,'2026-09-01T07:12:00.000Z')`)
    .run(rozmowa, konto, external, tresc).lastInsertRowid);
  const pytanie = wiadomosc("Czy ten szarpak pasuje do NAC LS 46-450?", "m-1");
  return { d, ala, marek, rozmowa, pytanie, wiadomosc };
}

const zdarzenia = (d: DatabaseSync, type: string) => d.prepare(
  "SELECT user_id, payload FROM events WHERE type=? ORDER BY id").all(type) as
  Array<{ user_id: string; payload: string | null }>;

test("wyścig o przejęcie rozstrzyga jeden zapis, przegrany dostaje właściciela i wersję", () => {
  const { d, ala, marek, rozmowa } = stanowisko();

  const wynik = przejmijRozmowe(rozmowa, ala, 1, d);
  assert.equal(wynik.assignedUserId, ala);
  assert.equal(wynik.version, 2, "przejęcie podnosi wersję rozmowy");

  /* Drugi agent niesie TĘ SAMĄ wersję co pierwszy — dokładnie sytuacja
     z makiety: obaj kliknęli, zanim ekran się odświeżył. */
  try {
    przejmijRozmowe(rozmowa, marek, 1, d);
    assert.fail("drugie przejęcie miało odpaść");
  } catch (e) {
    assert.ok(e instanceof ConversationConflict);
    assert.equal(e.details.assignedUserId, ala);
    assert.equal(e.details.assignedUserName, "A. Lewandowska");
    assert.equal(e.details.version, 2, "przegrany widzi wersję BIEŻĄCĄ, nie swoją");
    /* Bez czasu przejęcia kafelek „Przejęcie o" z makiety nie ma treści. */
    assert.ok(e.details.assignedAt, "przegrany widzi, kiedy sprawę przejęto");
  }
});

test("przejęcie zapisuje historię przypisań, nie tylko pole właściciela", () => {
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);

  const wiersze = d.prepare(`SELECT assigned_to, assigned_by, assigned_at, unassigned_at
    FROM conversation_assignment WHERE conversation_id=?`).all(rozmowa) as
    Array<{ assigned_to: number; assigned_by: number; assigned_at: string; unassigned_at: string | null }>;
  assert.equal(wiersze.length, 1);
  assert.equal(wiersze[0].assigned_to, ala);
  assert.equal(wiersze[0].assigned_by, ala, "przejęcie własne: przydzielił sam sobie");
  assert.equal(wiersze[0].unassigned_at, null, "przypisanie jest otwarte");
  assert.ok(wiersze[0].assigned_at, "bez czasu ekran przegranego nie ma czego pokazać");
});

test("przegrany wyścig nie zostawia ani przypisania, ani wpisu w dzienniku", () => {
  const { d, ala, marek, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  assert.throws(() => przejmijRozmowe(rozmowa, marek, 1, d), ConversationConflict);

  /* Transakcja ma się wycofać w całości. Wpis audytu o przejęciu, które się
     nie odbyło, kłamałby o tym, kto siedzi przy sprawie. */
  assert.equal(zdarzenia(d, "rozmowa_przejeta").length, 1);
  assert.equal((d.prepare("SELECT count(*) n FROM conversation_assignment").get() as {n:number}).n, 1);
});

test("każda z trzech mutacji zostawia wpis w dzienniku, podpisany kontem", () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  zapiszSzkic(rozmowa, ala, "Dzień dobry, pasuje.", pytanie, null, d);
  dodajKomentarz(rozmowa, ala, "Sprawdzić rozstaw przed wysłaniem.", [], d);

  for (const type of ["rozmowa_przejeta", "rozmowa_szkic_zapisany", "rozmowa_komentarz"]) {
    const wpisy = zdarzenia(d, type);
    assert.equal(wpisy.length, 1, `${type} ma dokładnie jeden wpis`);
    assert.equal(wpisy[0].user_id, "A. Lewandowska", `${type} niesie imię z konta, nie numer`);
  }
});

test("dziennik niesie wersję przed i po, ale NIGDY treści", () => {
  const { d, ala, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  const tajne = "Numer seryjny klienta LS19-0042";
  zapiszSzkic(rozmowa, ala, tajne, pytanie, null, d);
  dodajKomentarz(rozmowa, ala, tajne, [], d);

  const przejecie = JSON.parse(zdarzenia(d, "rozmowa_przejeta")[0].payload!);
  assert.equal(przejecie.wersjaPrzed, 1);
  assert.equal(przejecie.wersjaPo, 2);

  /* §19: treść wiadomości nie trafia do ogólnego dziennika zdarzeń. Dziennik
     czyta się przy zupełnie innych sprawach niż rozmowa z klientem. */
  const wszystko = (d.prepare("SELECT payload FROM events").all() as Array<{payload: string|null}>)
    .map((w) => w.payload ?? "").join(" ");
  assert.ok(!wszystko.includes(tajne), "treść przeciekła do dziennika");
  assert.ok(wszystko.includes(String(tajne.length)), "została sama długość");
});

test("szkic odpada, gdy klient dopisał wiadomość w trakcie redagowania", () => {
  const { d, ala, rozmowa, pytanie, wiadomosc } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  zapiszSzkic(rozmowa, ala, "Pierwsza wersja", pytanie, null, d);

  const dopisek = wiadomosc("Dopisuję: kosiarka jest z 2019.", "m-2");
  try {
    zapiszSzkic(rozmowa, ala, "Druga wersja", pytanie, 1, d);
    assert.fail("szkic na starą oś miał odpaść");
  } catch (e) {
    assert.ok(e instanceof ConversationConflict);
    assert.equal(e.details.lastMessageId, dopisek, "panel dostaje numer NOWEJ wiadomości");
  }

  const szkic = d.prepare("SELECT body FROM conversation_draft WHERE conversation_id=?")
    .get(rozmowa) as { body: string };
  assert.equal(szkic.body, "Pierwsza wersja", "odrzucona wysyłka nie kasuje szkicu");
});

test("szkic odpada, gdy zmienił go inny agent", () => {
  const { d, ala, marek, rozmowa, pytanie } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  zapiszSzkic(rozmowa, ala, "Wersja Ali", pytanie, null, d);
  zapiszSzkic(rozmowa, marek, "Wersja Marka", pytanie, 1, d);

  /* Ala trzyma w ekranie wersję 1, a w bazie stoi już 2. */
  assert.throws(() => zapiszSzkic(rozmowa, ala, "Znowu Ala", pytanie, 1, d), ConversationConflict);
});

test("komentarz zapisuje wzmianki bez duplikatów i odrzuca pustą treść", () => {
  const { d, ala, marek, rozmowa } = stanowisko();
  const wynik = dodajKomentarz(rozmowa, ala, "  Pytanie do @Marka  ", [marek, marek], d);
  assert.equal(wynik.body, "Pytanie do @Marka", "treść jest przycinana");
  assert.deepEqual(wynik.mentionedUserIds, [marek]);
  assert.equal((d.prepare("SELECT count(*) n FROM conversation_mention").get() as {n:number}).n, 1);

  assert.throws(() => dodajKomentarz(rozmowa, ala, "   ", [], d), /nie może być pusty/);
});

/* ── Status rozmowy (0.157.0) ────────────────────────────────────────────────
   Te testy IDĄ PRZEZ PRAWDZIWE MUTACJE, a nie ustawiają statusu `UPDATE`-em
   i sprawdzają, że się ustawił. Fikstura, która sama wpisuje wynik, sprawdza
   wyłącznie to, że SQLite działa. */

const status = (d: DatabaseSync, rozmowa: number) => d.prepare(
  "SELECT status, snooze_do FROM conversation WHERE id=?").get(rozmowa) as
  { status: string; snooze_do: string | null };

/** Wiadomość klienta drogą, którą chodzi synchronizacja — nie `INSERT`-em. */
const odKlienta = (d: DatabaseSync, rozmowa: number, external: string) => zapiszWiadomosc({
  conversationId: rozmowa, channelAccountId: 1, externalMessageId: external,
  direction: "incoming", body: "Dopisuję pytanie.", sentAt: "2026-09-02T08:00:00.000Z",
}, d);

test("wiadomość klienta otwiera zamkniętą rozmowę i zostawia ślad powrotu", () => {
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  ustawStatusRozmowy(rozmowa, ala, "resolved", null, 2, d);
  assert.equal(status(d, rozmowa).status, "resolved");

  odKlienta(d, rozmowa, "m-wraca");

  assert.equal(status(d, rozmowa).status, "open",
    "klient, który odpisał po zamknięciu, ma sprawę niezałatwioną");
  const slad = d.prepare(`SELECT payload FROM conversation_event
    WHERE conversation_id=? AND event_type='reopened_by_customer'`)
    .get(rozmowa) as { payload: string } | undefined;
  assert.ok(slad, "powrót zostawia zdarzenie na osi, nie kolumnę do sprzątania");
  assert.match(slad.payload, /resolved/, "zdarzenie mówi, z jakiego stanu wróciła");
});

test("ta sama wiadomość zapisana drugi raz nie rusza statusu", () => {
  /* Blizna 0.128.0: ponowny przebieg synchronizacji jest no-opem. Gdyby
     status liczył się mimo to, zamknięte rozmowy otwierałyby się w kółko. */
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  odKlienta(d, rozmowa, "m-2");
  ustawStatusRozmowy(rozmowa, ala, "closed", null, 2, d);

  assert.equal(odKlienta(d, rozmowa, "m-2"), null, "druga próba to no-op");
  assert.equal(status(d, rozmowa).status, "closed");
});

test("spam zostaje spamem, choćby spamer pisał dalej", () => {
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  ustawStatusRozmowy(rozmowa, ala, "spam", "trzecia oferta pożyczki", 2, d);
  odKlienta(d, rozmowa, "m-spam");
  assert.equal(status(d, rozmowa).status, "spam");
  assert.equal(
    (d.prepare("SELECT count(*) n FROM conversation_event WHERE event_type='reopened_by_customer'")
      .get() as { n: number }).n, 0, "spam nie wraca i nie zostawia śladu powrotu");
});

test("wynik z hali zdejmuje czekanie na nas", () => {
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  d.prepare("UPDATE conversation SET status='waiting_for_internal' WHERE id=?").run(rozmowa);
  dopiszZdarzenieWyniku(rozmowa, 77, "Szerokość 8 mm", d);
  assert.equal(status(d, rozmowa).status, "open",
    "agent nie ma pamiętać o kliknięciu, którego nikt od niego nie oczekuje");
});

test("przejęcie budzi odłożoną rozmowę i czyści termin", () => {
  const { d, ala, marek, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  odlozRozmowe(rozmowa, ala, "2026-12-24T08:00:00.000Z", 2, d, new Date("2026-09-02T10:00:00.000Z"));
  assert.equal(status(d, rozmowa).snooze_do, "2026-12-24T08:00:00.000Z");

  /* Rozmowa wraca do kolejki, ktoś inny ją bierze. */
  d.prepare("UPDATE conversation SET assigned_user_id=NULL WHERE id=?").run(rozmowa);
  przejmijRozmowe(rozmowa, marek, 3, d);
  const po = status(d, rozmowa);
  assert.equal(po.status, "open");
  assert.equal(po.snooze_do, null, "przejęcie kasuje termin, nie tylko status");
});

test("odłożenie wymaga terminu i to terminu w przyszłości", () => {
  const { d, ala, rozmowa } = stanowisko();
  const teraz = new Date("2026-09-02T10:00:00.000Z");
  assert.throws(() => odlozRozmowe(rozmowa, ala, "", 1, d, teraz), /wymaga terminu/);
  /* Termin w przeszłości dałby przycisk, który nic nie robi: odczyt uznaje
     taką rozmowę za otwartą już w chwili zapisu. */
  assert.throws(() => odlozRozmowe(rozmowa, ala, "2026-09-01T10:00:00.000Z", 1, d, teraz),
    /w przyszłości/);
});

test("statusów automatu nie da się ustawić ręką", () => {
  const { d, ala, rozmowa } = stanowisko();
  /* `waiting_for_customer` wpisane z palca kłamałoby o tym, że odpowiedź
     poszła do klienta. Ten status ustawia wysyłka albo nikt. */
  assert.throws(() => ustawStatusRozmowy(rozmowa, ala, "waiting_for_customer", null, 1, d),
    /nie ustawia się ręcznie/);
  assert.throws(() => ustawStatusRozmowy(rozmowa, ala, "wymyslony", null, 1, d),
    /nie ustawia się ręcznie/);
});

test("zmiana statusu pilnuje wersji i zostawia ślad w dzienniku", () => {
  const { d, ala, marek, rozmowa } = stanowisko();
  const wynik = ustawStatusRozmowy(rozmowa, ala, "resolved", null, 1, d);
  assert.equal(wynik.version, 2, "ręczna decyzja podnosi wersję");

  /* Marek trzyma w ekranie wersję sprzed decyzji Ali. */
  try {
    ustawStatusRozmowy(rozmowa, marek, "spam", null, 1, d);
    assert.fail("spóźniona zmiana miała odpaść");
  } catch (e) {
    assert.ok(e instanceof ConversationConflict);
    assert.equal(e.details.status, "resolved", "konflikt mówi, co stoi w bazie");
    assert.equal(e.details.version, 2);
  }
  assert.equal(zdarzenia(d, "rozmowa_status").length, 1);
});

test("wiadomość klienta NIE podbija wersji rozmowy", () => {
  /* Wersja pilnuje współbieżnej pracy LUDZI. Podbicie jej przy każdym
     dopisku klienta dawałoby agentowi 409 „rozmowa się zmieniła" zamiast
     dialogu świeżości, który jest od tego (blizna 0.110.0). */
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  const przed = d.prepare("SELECT version, updated_at FROM conversation WHERE id=?")
    .get(rozmowa) as { version: number; updated_at: string };
  odKlienta(d, rozmowa, "m-3");
  const po = d.prepare("SELECT version, updated_at FROM conversation WHERE id=?")
    .get(rozmowa) as { version: number; updated_at: string };
  assert.equal(po.version, przed.version);
  assert.equal(po.updated_at, przed.updated_at,
    "skrzynka pokazuje `updated_at` jako moment ostatniej wiadomości");
});
