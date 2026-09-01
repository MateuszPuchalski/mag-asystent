import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  ConversationConflict, dodajKomentarz, obudzPrzychodzaca, przejmijRozmowe,
  statusRozmowy, ustawStatus, zapiszSzkic,
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

/* ── Statusy rozmowy §7 (0.158.0) ────────────────────────────────────────────
   `conversation` nie miała kolumny statusu, więc kolejka nie odróżniała sprawy
   załatwionej od nietkniętej, a rozmowa raz otwarta rosła w nieskończoność.

   Najważniejsze są tu PRZEJŚCIA AUTOMATYCZNE. Status, który trzeba ustawić
   ręcznie po każdym ruchu, jest biurokracją — a status, który nie wraca sam,
   gdy klient dopisze pytanie, jest gorszy od jego braku: rozmowa wygląda na
   załatwioną i nikt do niej nie zagląda. */

test("nowa rozmowa jest `new`, przejęcie robi z niej `open`", () => {
  const { d, ala, rozmowa } = stanowisko();
  assert.equal(statusRozmowy(d, rozmowa), "new");

  przejmijRozmowe(rozmowa, ala, 1, d);
  assert.equal(statusRozmowy(d, rozmowa), "open");
});

test("wysłanie odpowiedzi przestawia rozmowę na `waiting_for_customer`", () => {
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);

  ustawStatus(d, rozmowa, "waiting_for_customer", ala, null);
  assert.equal(statusRozmowy(d, rozmowa), "waiting_for_customer");
});

test("PRZYCHODZĄCA wiadomość budzi rozmowę rozwiązaną i odłożoną", () => {
  /* To jest sedno całego wydania. Klient dopisuje pytanie do sprawy, którą
     biuro uznało za zamkniętą; bez tego przejścia rozmowa zostaje na liście
     „rozwiązane" i nikt jej nie otwiera. */
  for (const zamkniety of ["resolved", "waiting_for_customer", "snoozed"] as const) {
    const { d, ala, rozmowa } = stanowisko();
    przejmijRozmowe(rozmowa, ala, 1, d);
    ustawStatus(d, rozmowa, zamkniety, ala, zamkniety === "snoozed" ? "2026-12-01T08:00:00Z" : null);

    obudzPrzychodzaca(d, rozmowa);

    assert.equal(statusRozmowy(d, rozmowa), "open", `${zamkniety} nie wróciło do open`);
  }
});

test("`closed` i `spam` NIE budzą się same — to decyzja człowieka", () => {
  /* Zamknięcie i spam są jawnymi werdyktami biura. Automat, który je cofa,
     kazałby ręcznie zamykać tę samą rozmowę w kółko. */
  for (const koniec of ["closed", "spam"] as const) {
    const { d, ala, rozmowa } = stanowisko();
    przejmijRozmowe(rozmowa, ala, 1, d);
    ustawStatus(d, rozmowa, koniec, ala, null);

    obudzPrzychodzaca(d, rozmowa);

    assert.equal(statusRozmowy(d, rozmowa), koniec, `${koniec} obudziło się samo`);
  }
});

test("odłożenie wymaga terminu, a po nim rozmowa wraca sama", () => {
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);

  assert.throws(() => ustawStatus(d, rozmowa, "snoozed", ala, null), /termin|do kiedy/i);

  ustawStatus(d, rozmowa, "snoozed", ala, "2026-09-02T08:00:00Z");
  /* Termin jeszcze nie minął — rozmowa ma leżeć odłożona. */
  assert.equal(statusRozmowy(d, rozmowa, Date.parse("2026-09-01T20:00:00Z")), "snoozed");
  /* Po terminie wraca SAMA, bez tickera: liczymy przy odczycie, bo stan
     wyliczalny nie potrzebuje procesu, który go pilnuje. */
  assert.equal(statusRozmowy(d, rozmowa, Date.parse("2026-09-02T09:00:00Z")), "open");
});

test("zmiana statusu ląduje na osi i w audycie", () => {
  const { d, ala, rozmowa } = stanowisko();
  przejmijRozmowe(rozmowa, ala, 1, d);
  ustawStatus(d, rozmowa, "resolved", ala, null);

  const zdarzenia = (d.prepare(
    "SELECT event_type FROM conversation_event WHERE conversation_id=?").all(rozmowa) as
    Array<{ event_type: string }>).map((z) => z.event_type);
  assert.ok(zdarzenia.includes("status_changed"), `oś nie zna zmiany: ${zdarzenia.join(",")}`);
  assert.ok((d.prepare("SELECT count(*) n FROM events WHERE type='rozmowa_status'")
    .get() as { n: number }).n > 0, "brak śladu w audycie");
});

test("nieznany status odpada — lista z §7 jest zamknięta", () => {
  const { d, ala, rozmowa } = stanowisko();
  assert.throws(() => ustawStatus(d, rozmowa, "zalatwione" as never, ala, null), /status/i);
});
