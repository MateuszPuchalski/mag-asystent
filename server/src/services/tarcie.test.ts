import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  czasCofniecia, czasDoWysylki, pomiarTarcia, rozkladCofniec, zapiszCofniecieWysylki, zapiszPominiecie,
} from "./tarcie.js";
import { otworzRozmowe, zakonczRozmowe } from "./conversations.js";

/* ── Pomiar tarcia w skrzynce (0.500.0) ─────────────────────────────────────
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

/* ── Pomiary pod decyzje (26 września 2026, @wydanie) ───────────────────────
   Każda z czterech liczb ma tu swój test: rozkład cofnięć z odczytem, tarcie
   wg twierdzeń do sprawdzenia, gotowość per klasa z dniami i przedziałem,
   pominięcia bez człowieka. Ostatni test pilnuje prywatności, nie liczby. */

test("czas cofnięcia z przeglądarki: tylko skończona liczba od 0 do 60 s", () => {
  assert.equal(czasCofniecia(1_234.4), 1_234);
  assert.equal(czasCofniecia(0), 0);
  assert.equal(czasCofniecia(60_000), 60_000);
  for (const zly of [-1, 60_001, Infinity, NaN, "900", null, undefined]) assert.equal(czasCofniecia(zly), null);
});

test("rozkład cofnięć: kubełki po 2 s, granica do kubełka wyżej, odczyt przy 90%", () => {
  const r = rozkladCofniec([500, 1_999, 2_000, 3_100, 3_900, 1_000, 1_500, 800, 1_200, 9_000]);
  assert.deepEqual(r.kubelki.map((k) => k.ile), [6, 3, 0, 0, 1]);
  assert.deepEqual(r.kubelki[1], { odSek: 2, doSek: 4, ile: 3 });
  assert.deepEqual(r.odczyt, { przedSek: 4, udzial: 0.9 }, "9 z 10 przed 4 s");
  assert.equal(r.poOknie, 0);
  assert.equal(rozkladCofniec([10_000]).kubelki[4]!.ile, 1, "10 s domyka ostatni kubełek");
  assert.equal(rozkladCofniec([12_000]).poOknie, 1);
  assert.equal(rozkladCofniec([]).odczyt, null, "bez próbki nie ma czego czytać");
  /* Po wydłużeniu okna ogon bywa za 10 s — zdanie zostaje prawdziwe. */
  assert.deepEqual(rozkladCofniec([1_000, 15_000, 20_000]).odczyt, { przedSek: 10, udzial: 0.33 });
});

test("okno cofnięcia: udział z odłożonych, stare cofnięcia bez czasu liczą się w udziale", () => {
  const { d, ala, rozmowa, wyslana, zdarzenie } = stanowisko();
  for (let i = 0; i < 8; i++) wyslana(ala, null);
  const autor = { id: ala, name: "A. Lewandowska" };
  zapiszCofniecieWysylki(d, rozmowa, autor, 1_500);
  zapiszCofniecieWysylki(d, rozmowa, autor, 7_000);
  zdarzenie("rozmowa_wysylka_cofnieta", "A. Lewandowska", { conversationId: rozmowa });
  const zapis = JSON.parse((d.prepare(`SELECT payload FROM events
    WHERE type='rozmowa_wysylka_cofnieta' ORDER BY id LIMIT 1`).get() as { payload: string }).payload);
  assert.equal(zapis.msOdKolejki, 1_500);

  const o = pomiarTarcia(36_500, false, d, TERAZ).oknoCofniecia;
  assert.equal(o.odlozonych, 11, "8 wysłanych + 3 cofnięte");
  assert.equal(o.cofnietych, 3);
  assert.equal(o.udzial, 0.27);
  assert.equal(o.bezCzasu, 1);
  assert.deepEqual(o.kubelki.map((k) => k.ile), [1, 0, 0, 1, 0]);
  assert.deepEqual(o.odczyt, { przedSek: 8, udzial: 1 });
});

function zRozmowami() {
  const s = stanowisko();
  const konto = Number((s.d.prepare("SELECT id FROM channel_account").get() as { id: number }).id);
  let m = 0;
  const rozmowa = () => Number(s.d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,?,'K')`).run(konto, `w-x${m++}`).lastInsertRowid);
  const pytanie = (r: number, at: string) => Number(s.d.prepare(`INSERT INTO message(conversation_id,
    channel_account_id,external_message_id,direction,body,sent_at) VALUES (?,?,?,'incoming','?',?)`)
    .run(r, konto, `m-${m++}`, at).lastInsertRowid);
  const decyzja = (r: number, msg: number, kategoria: string, status = "SUCCESS") => s.d.prepare(`INSERT INTO
    decyzja_klasyfikacji(conversation_id,message_id,wersja,zrodlo,status,kategoria,akcja,wymaga_czlowieka,
    brak_danych_zamowienia,brak_danych_produktu,taksonomia_wersja,polityka_wersja,at,przez)
    VALUES (?,?,1,'MODEL',?,?,'ANSWER',0,0,0,'v2','p1','2026-09-22T09:00:00.000Z','automat')`)
    .run(r, msg, status, kategoria);
  let k = 0;
  const wysylka = (r: number, msg: number | null, los: string | null, at = "2026-09-24T10:00:00.000Z",
    doSprawdzenia?: number) => {
    const id = Number(s.d.prepare(`INSERT INTO outbox(conversation_id,idempotency_key,body,expected_version,
      expected_last_message_id,status,created_by,szkic_los,finished_at) VALUES (?,?,'x',1,?,'sent',?,?,?)`)
      .run(r, `z-${k++}`, msg, s.ala, los, at).lastInsertRowid);
    s.d.prepare("INSERT INTO events(type,user_id,payload,created_at) VALUES ('rozmowa_wyslana','A',?,?)")
      .run(JSON.stringify({ outboxId: id,
        ...(doSprawdzenia !== undefined ? { szkicDoSprawdzenia: doSprawdzenia } : {}) }), at);
    return id;
  };
  return { ...s, rozmowa, pytanie, decyzja, wysylka };
}

test("tarcie przy szkicu: osobno z twierdzeniami do sprawdzenia i bez, stare bez danych", () => {
  const { d, rozmowa, pytanie, wysylka } = zRozmowami();
  const r = rozmowa();
  const p = pytanie(r, "2026-09-24T09:00:00.000Z");
  wysylka(r, p, "bez_zmian", undefined, 2);
  wysylka(r, p, "poprawiony", undefined, 1);
  wysylka(r, p, "poprawiony", undefined, 3);
  wysylka(r, p, "bez_zmian", undefined, 0);
  wysylka(r, p, "bez_zmian", undefined, 0);
  wysylka(r, p, "bez_zmian");
  wysylka(r, p, null);
  const t = pomiarTarcia(36_500, false, d, TERAZ).tarcieSzkicu;
  assert.deepEqual(t.zTwierdzeniami, { zeSzkicem: 3, bezZmian: 1, udzialBezZmian: 0.33 });
  assert.deepEqual(t.bezTwierdzen, { zeSzkicem: 2, bezZmian: 2, udzialBezZmian: 1 });
  assert.equal(t.bezDanych, 1, "szkic sprzed zapisu twierdzeń nie udaje żadnej grupy");
});

test("przed i po 0.500.0: granica z pierwszej wysyłki z pomiarem czasu, bez niej — brak porównania", () => {
  const { d, rozmowa, pytanie, wysylka } = zRozmowami();
  const r = rozmowa();
  const p = pytanie(r, "2026-09-20T09:00:00.000Z");
  wysylka(r, p, "bez_zmian", "2026-09-23T10:00:00.000Z");
  wysylka(r, p, "bez_zmian", "2026-09-23T11:00:00.000Z");
  wysylka(r, p, "poprawiony", "2026-09-25T15:00:00.000Z");
  assert.equal(pomiarTarcia(7, false, d, TERAZ).tarcieSzkicu.przedPo, null, "bez granicy nie ma porównania");

  d.prepare("INSERT INTO events(type,user_id,payload,created_at) VALUES ('rozmowa_wyslana','A',?,?)")
    .run(JSON.stringify({ msOdOtwarcia: 9_000 }), "2026-09-25T14:00:00.000Z");
  const pp = pomiarTarcia(7, false, d, TERAZ).tarcieSzkicu.przedPo!;
  assert.equal(pp.granica, "2026-09-25T14:00:00.000Z");
  assert.deepEqual(pp.przed, { zeSzkicem: 2, bezZmian: 2, udzialBezZmian: 1 });
  assert.deepEqual(pp.po, { zeSzkicem: 1, bezZmian: 0, udzialBezZmian: 0 });
});

test("granica przed i po to koniec wysyłki, nie chwila zdarzenia zapisanego po niej", () => {
  /* Zdarzenie `rozmowa_wyslana` powstaje kilka milisekund PO `outbox`. Granica
     z jego chwili wrzuciłaby pierwszą wysyłkę z tarciem do „przed". */
  const { d, rozmowa, pytanie, wysylka } = zRozmowami();
  const r = rozmowa();
  const p = pytanie(r, "2026-09-20T09:00:00.000Z");
  wysylka(r, p, "bez_zmian", "2026-09-23T10:00:00.000Z");
  const pierwsza = wysylka(r, p, "poprawiony", "2026-09-25T15:00:00.100Z");
  d.prepare("INSERT INTO events(type,user_id,payload,created_at) VALUES ('rozmowa_wyslana','A',?,?)")
    .run(JSON.stringify({ outboxId: pierwsza, msOdOtwarcia: 9_000 }), "2026-09-25T15:00:00.105Z");
  const pp = pomiarTarcia(7, false, d, TERAZ).tarcieSzkicu.przedPo!;
  assert.equal(pp.granica, "2026-09-25T15:00:00.100Z");
  assert.deepEqual(pp.po, { zeSzkicem: 1, bezZmian: 0, udzialBezZmian: 0 }, "pierwsza wysyłka z tarciem jest „po”");
});

test("gotowość per klasa: klasa z decyzji na pytanie, przedział Wilsona, dni z danymi", () => {
  const { d, rozmowa, pytanie, decyzja, wysylka } = zRozmowami();
  const a = rozmowa();
  const a1 = pytanie(a, "2026-09-22T09:00:00.000Z");
  decyzja(a, a1, "ORDER_STATUS");
  const a2 = pytanie(a, "2026-09-23T09:00:00.000Z");
  decyzja(a, a2, "RETURN");
  /* Odpowiedź na PIERWSZE pytanie należy do jego klasy, nie do późniejszej. */
  wysylka(a, a1, "bez_zmian", "2026-09-22T10:00:00.000Z");
  wysylka(a, a1, "bez_zmian", "2026-09-23T08:00:00.000Z");
  wysylka(a, a2, "poprawiony", "2026-09-23T10:00:00.000Z");
  const b = rozmowa();
  const b1 = pytanie(b, "2026-09-22T09:00:00.000Z");
  decyzja(b, b1, "OTHER", "FAILED");
  wysylka(b, b1, "bez_zmian");
  const c = rozmowa();
  wysylka(c, pytanie(c, "2026-09-22T09:00:00.000Z"), "poprawiony");

  const g = pomiarTarcia(36_500, false, d, TERAZ).gotowosc;
  const os = g.find((x) => x.kategoria === "ORDER_STATUS")!;
  assert.equal(os.zeSzkicem, 2);
  assert.equal(os.bezZmian, 2);
  assert.equal(os.dni, 2);
  assert.equal(os.udzial!.p, 1);
  assert.ok(os.udzial!.dolna < 0.5, "dwa z dwóch to wciąż słaby dowód");
  assert.equal(g[0]!.kategoria, "ORDER_STATUS", "najmocniejszy dowód pierwszy");
  assert.equal(g.find((x) => x.kategoria === "RETURN")!.bezZmian, 0);
  assert.ok(g.find((x) => x.kategoria === "nierozpoznane"), "decyzja FAILED to nie klasa");
  assert.ok(g.find((x) => x.kategoria === "bez rozpoznania"));
});

test("pominięcia: licznik doby i klasy, obok wysyłek; bez człowieka i bez rozmowy", () => {
  const { d, rozmowa, pytanie, decyzja, wysylka } = zRozmowami();
  const dzien = new Date("2026-09-24T10:00:00.000Z");
  zapiszPominiecie(d, "ORDER_STATUS", dzien);
  zapiszPominiecie(d, "ORDER_STATUS", dzien);
  zapiszPominiecie(d, "nie-ma-takiej'; DROP TABLE x", dzien);
  zapiszPominiecie(d, undefined, new Date("2026-09-23T10:00:00.000Z"));
  zapiszPominiecie(d, "nierozpoznane", dzien);
  const r = rozmowa();
  const p = pytanie(r, "2026-09-24T09:00:00.000Z");
  decyzja(r, p, "ORDER_STATUS");
  wysylka(r, p, null);

  const pm = pomiarTarcia(7, false, d, TERAZ).pominiecia;
  assert.equal(pm.odKiedy, "2026-09-23");
  assert.equal(pm.pominiec, 5);
  assert.equal(pm.wyslanych, 1);
  assert.deepEqual(pm.wgDnia, [
    { dzien: "2026-09-23", pominiec: 1, wyslanych: 0 },
    { dzien: "2026-09-24", pominiec: 4, wyslanych: 1 }]);
  assert.deepEqual(pm.wgKategorii, [
    { kategoria: "ORDER_STATUS", pominiec: 2, wyslanych: 1 },
    { kategoria: "bez rozpoznania", pominiec: 2, wyslanych: 0 },
    { kategoria: "nierozpoznane", pominiec: 1, wyslanych: 0 }]);

  /* Prywatność zapisana w kształcie: tabela nie ma kolumny, w którą dałoby
     się wpisać człowieka albo rozmowę, a licznik nie zostawia wpisu
     w dzienniku — tam stałby autor z milisekundą. */
  const kolumny = (d.prepare("PRAGMA table_info(pominiecia_dzien)").all() as Array<{ name: string }>)
    .map((k) => k.name);
  assert.deepEqual(kolumny, ["dzien", "kategoria", "ile"]);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM events WHERE type LIKE '%pomini%'").get() as { n: number }).n, 0);
});
