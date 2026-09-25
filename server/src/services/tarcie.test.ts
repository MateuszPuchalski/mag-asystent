import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { czasDoWysylki, pomiarTarcia, zapiszCofniecieWysylki } from "./tarcie.js";
import { otworzRozmowe, zakonczRozmowe } from "./conversations.js";

/* ── Pomiar tarcia w skrzynce (@wydanie) ─────────────────────────────────────
   Pilnujemy czterech rzeczy: udział szkiców bez zmian liczy się tylko ze
   szkiców na tę samą wiadomość; cofnięte zakończenie to wyłącznie otwarcie
   z paska „Cofnij"; liczba czasu z przeglądarki jest przycinana; a rozbicia
   na osoby nie ma w odpowiedzi dla kogoś, kto nie jest administratorem.     */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = Date.parse("2026-09-25T12:00:00.000Z");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const agent = (login: string, name: string) => Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES (?,?,'biuro')").run(login, name).lastInsertRowid);
  const ala = agent("ala", "A. Lewandowska");
  const marek = agent("marek", "M. Wójcik");
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')").run().lastInsertRowid);
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','Kupujący')`).run(konto).lastInsertRowid);
  let n = 0;
  const wyslana = (kto: number, los: string | null) => d.prepare(`INSERT INTO outbox(conversation_id,
      idempotency_key,body,expected_version,status,created_by,szkic_los,finished_at)
    VALUES (?,?,'Dzień dobry',1,'sent',?,?,'2026-09-24T10:00:00.000Z')`).run(rozmowa, `k-${n++}`, kto, los);
  const zdarzenie = (type: string, kto: string, payload: unknown) => d.prepare(
    "INSERT INTO events(type,user_id,payload,created_at) VALUES (?,?,?,'2026-09-24T10:00:00.000Z')")
    .run(type, kto, JSON.stringify(payload));
  return { d, ala, marek, rozmowa, wyslana, zdarzenie };
}

test("udział bez zmian liczy się tylko ze szkiców; osoby osobno, razem sumą", () => {
  const { d, ala, marek, wyslana } = stanowisko();
  wyslana(ala, "bez_zmian");
  wyslana(ala, "bez_zmian");
  wyslana(ala, "poprawiony");
  wyslana(ala, null);
  wyslana(marek, "poprawiony");
  const p = pomiarTarcia(7, true, d, TERAZ);
  assert.equal(p.razem.wyslanych, 5);
  assert.equal(p.razem.zeSzkicem, 4, "wysyłka bez szkicu nie wchodzi do mianownika");
  assert.equal(p.razem.udzialBezZmian, 0.5);
  const a = p.osoby!.find((o) => o.osoba === "A. Lewandowska")!;
  assert.equal(a.udzialBezZmian, 0.67);
  assert.equal(p.osoby!.find((o) => o.osoba === "M. Wójcik")!.udzialBezZmian, 0);
});

test("cofnięcia i czas do wysyłki z dziennika; biuro nie dostaje osób", () => {
  const { d, ala, rozmowa, zdarzenie } = stanowisko();
  assert.equal(zapiszCofniecieWysylki(d, rozmowa, { id: ala, name: "A. Lewandowska" }), true);
  assert.equal(zapiszCofniecieWysylki(d, 9999, { id: ala, name: "A. Lewandowska" }), false, "cudzy numer");
  zdarzenie("rozmowa_wyslana", "A. Lewandowska", { msOdOtwarcia: 40_000 });
  zdarzenie("rozmowa_wyslana", "A. Lewandowska", { msOdOtwarcia: 80_000 });
  zdarzenie("rozmowa_wyslana", "A. Lewandowska", { conversationId: 1 });

  zakonczRozmowe(d, rozmowa, ala, true);
  otworzRozmowe(d, rozmowa, ala, new Date(), true);
  zakonczRozmowe(d, rozmowa, ala, true);
  otworzRozmowe(d, rozmowa, ala);

  const p = pomiarTarcia(36_500, false, d, TERAZ);
  assert.equal(p.osoby, null);
  assert.equal(p.razem.cofnietychWysylek, 1);
  assert.equal(p.razem.cofnietychZakonczen, 1, "zwykłe „Otwórz ponownie” to decyzja, nie cofnięcie");
  assert.equal(p.razem.medianaSekDoWysylki, 60);
  assert.equal(p.razem.probekCzasu, 2, "wysyłka bez pomiaru nie udaje zera");
});

test("czas z przeglądarki: ujemny, nieliczbowy i dłuższy niż dzień pracy odpada", () => {
  assert.equal(czasDoWysylki(12_345.6), 12_346);
  for (const zly of [-1, Infinity, NaN, "100", null, 9 * 3_600_000]) assert.equal(czasDoWysylki(zly), null);
});
