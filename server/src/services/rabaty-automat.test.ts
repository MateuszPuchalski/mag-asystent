import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import {
  AUTOMAT_RABATU, KARENCJA_MIN, MAKS_NA_PRZEBIEG, zlozBrakujaceWnioski,
} from "./rabaty-automat.js";

/* ── Automat wniosków o rabat (0.320.0) ──────────────────────────────────────
   Zgłoszenie właściciela: wniosek ma iść sam, zaraz po tym, jak dowiadujemy
   się o odstąpieniu. Ręczny przycisk z 0.164.0 działa, ale trzeba o nim
   pamiętać przy każdym z kilkuset zwrotów — a prowizja, po którą nikt nie
   kliknął, zostaje u Allegro.

   Pięć rzeczy warte testu, bo każda kosztuje pieniądze albo zaufanie:

   1. NOWA POZYCJA DOSTAJE WNIOSEK bez czekania na werdykt biura.
   2. ZASTANA POZYCJA NIE DOSTAJE — stempel migracji trzyma automat z dala od
      zwrotów sprzed wdrożenia.
   3. PACZKA NIEODEBRANA I POZYCJA DOPISANA PRZEZ BIURO ODPADAJĄ: żadna z nich
      nie jest odstąpieniem klienta.
   4. ODSTĄPIENIE SPRZED CHWILI CZEKA KARENCJĘ: czterdzieści wniosków na sto
      zakłada Allegro samo, a końcówka nie ma idempotencji.
   5. LIMIT ALLEGRO PRZERYWA PRZEBIEG, a nie mnoży odmów.
   6. ODMOWA JEDNEJ POZYCJI NIE ZABIERA POZOSTAŁYCH.                         */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,
    dostawa_grosze,suma_grosze,waluta,synced_at)
    VALUES (1,'ord-1','READY_FOR_PROCESSING',1499,6498,'PLN','2026-09-02T08:00:00Z')`).run();
  return d as unknown as Db;
}

/** Zwrot z jedną pozycją — tak, jak zapisuje go synchronizator odstąpień. */
function zwrot(d: Db, n: number,
  opcje: { zrodloZwrotu?: string; zrodloPozycji?: string; kiedy?: string } = {}) {
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,external_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,?,?,'Sekator','SEK-46',1,4999,'PLN')`).run(`li-${n}`, `of-${n}`);
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,zrodlo,created_at,synced_at)
    VALUES (1,?,'ord-1',?,?,'2026-09-02T08:00:00Z')`)
    .run(`zw-${n}`, opcje.zrodloZwrotu ?? "allegro",
      opcje.kiedy ?? "2026-09-01T08:00:00Z").lastInsertRowid);
  const pozycja = Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta,zrodlo)
    VALUES (?,?,?,'Sekator',1,4999,'PLN',?)`)
    .run(id, `of-${n}|Sekator`, `of-${n}`, opcje.zrodloPozycji ?? "allegro").lastInsertRowid);
  /* Stempel migracji dotyczy pozycji ZASTANYCH; ta właśnie przyjechała. */
  d.prepare("UPDATE zwrot_klienta_pozycja SET rabat_poza_automatem=0 WHERE id=?").run(pozycja);
  return { id, pozycja };
}

test("nowa pozycja dostaje wniosek bez czekania na werdykt biura", async () => {
  /* Wniosek dotyczy PROWIZJI od transakcji, którą klient wycofał, a nie
     towaru — więc nie czeka ani na ocenę, ani na korektę. */
  const d = stanowisko();
  zwrot(d, 1);
  const wolano: Array<{ lineItemId: string; ilosc: number }> = [];

  const w = await zlozBrakujaceWnioski(d, async (lineItemId, ilosc) => {
    wolano.push({ lineItemId, ilosc });
    return { id: "rc-1" };
  });

  assert.deepEqual(w, { zlozone: 1, pominiete: 0, bledy: 0, limit: false });
  assert.deepEqual(wolano, [{ lineItemId: "li-1", ilosc: 1 }]);
  /* Wniosek ląduje w lustrze i na osi zwrotu, podpisany automatem. */
  const zapis = d.prepare("SELECT external_id AS id, typ FROM allegro_rabat")
    .get() as { id: string; typ: string };
  assert.equal(zapis.id, "rc-1");
  const os = d.prepare("SELECT rodzaj, kto, kto_user_id FROM zwrot_zdarzenie")
    .get() as { rodzaj: string; kto: string; kto_user_id: number | null };
  assert.equal(os.rodzaj, "rabat");
  assert.equal(os.kto, AUTOMAT_RABATU);
  assert.equal(os.kto_user_id, null, "automat nie ma konta i nie udaje, że ma");

  /* Drugi przebieg NIE składa drugiego wniosku — stan czyta z lustra. */
  const drugi = await zlozBrakujaceWnioski(d, async () => { throw new Error("nie wolno"); });
  assert.equal(drugi.zlozone, 0);
  assert.equal(drugi.pominiete, 1);
});

test("pozycja zastana przed wdrożeniem zostaje przy ręcznym przycisku", async () => {
  /* Automat składa wniosek zaraz po odstąpieniu. Zastane odstąpienia mają
     sprzed miesięcy: seria żądań o nie zderzyłaby się z limitem Allegro
     i wróciła odmowami, których nie cofa się jednym kliknięciem. */
  const d = stanowisko();
  const { pozycja } = zwrot(d, 1);
  d.prepare("UPDATE zwrot_klienta_pozycja SET rabat_poza_automatem=1 WHERE id=?").run(pozycja);

  const w = await zlozBrakujaceWnioski(d, async () => { throw new Error("nie wolno"); });
  assert.deepEqual(w, { zlozone: 0, pominiete: 0, bledy: 0, limit: false });
});

test("paczka nieodebrana i pozycja dopisana przez biuro nie są odstąpieniem", async () => {
  const d = stanowisko();
  zwrot(d, 1, { zrodloZwrotu: "nieodebrana" });
  zwrot(d, 2, { zrodloPozycji: "biuro" });

  const w = await zlozBrakujaceWnioski(d, async () => { throw new Error("nie wolno"); });
  assert.equal(w.zlozone, 0, "klient niczego nie zgłosił — nie ma czego żądać");
  assert.equal(w.pominiete, 0, "obie odpadają zapytaniem, nie sprawdzaniem stanu");
});

test("odstąpienie sprzed chwili czeka, aż lustro zobaczy wniosek Allegro", async () => {
  /* Allegro zakłada część wniosków samo (`type: AUTOMATIC`, 40 na 100).
     Nasz wniosek złożony w tej samej minucie byłby DRUGIM zgłoszeniem do tej
     samej prowizji — końcówka nie ma idempotencji. */
  const d = stanowisko();
  const teraz = new Date("2026-09-13T12:00:00Z");
  zwrot(d, 1, { kiedy: "2026-09-13T11:50:00Z" });

  const swieze = await zlozBrakujaceWnioski(
    d, async () => { throw new Error("nie wolno"); }, teraz);
  assert.deepEqual(swieze, { zlozone: 0, pominiete: 0, bledy: 0, limit: false });

  /* Po karencji ten sam zwrot idzie normalnie. */
  const potem = new Date(teraz.getTime() + (KARENCJA_MIN + 1) * 60_000);
  const w = await zlozBrakujaceWnioski(d, async () => ({ id: "rc-1" }), potem);
  assert.equal(w.zlozone, 1);
});

test("limit Allegro przerywa przebieg, a nie mnoży odmów", async () => {
  /* 429 dotyczy WSZYSTKICH następnych żądań, więc dalsze próby tylko
     pogłębiałyby przerwę. Reszta poczeka na następny takt. */
  const d = stanowisko();
  zwrot(d, 1);
  zwrot(d, 2);

  let prob = 0;
  const w = await zlozBrakujaceWnioski(d, async () => {
    prob++;
    throw new BladLimituAllegro("Allegro prosi o przerwę (429)", 60_000);
  });

  assert.equal(prob, 1, "po limicie nie próbujemy dalej");
  assert.equal(w.limit, true);
  assert.equal(w.bledy, 0, "limit to przerwa, nie odmowa");
});

test("odmowa jednej pozycji nie zabiera pozostałych", async () => {
  const d = stanowisko();
  zwrot(d, 1);
  zwrot(d, 2);

  const w = await zlozBrakujaceWnioski(d, async (lineItemId) => {
    if (lineItemId === "li-1") throw new Error("Allegro odmówiło (400)");
    return { id: "rc-2" };
  });

  assert.equal(w.bledy, 1);
  assert.equal(w.zlozone, 1, "druga pozycja idzie własną próbą");
  /* Do dziennika idzie zdanie odmowy — bez niego pytanie „dlaczego nie ma
     wniosku" nie ma odpowiedzi. */
  const blad = d.prepare(
    "SELECT payload FROM events WHERE type='zwrot_rabat_automat_blad'").get() as
    { payload: string } | undefined;
  assert.match(String(blad?.payload), /Allegro odmówiło/);
});

test("sufit na przebieg jest dodatni i skończony", () => {
  /* Sufit to OSTROŻNOŚĆ: automat bierze nowe zwroty, więc idzie ich kilka na
     takt — ale paczka po dłuższej przerwie w synchronizacji nie ma prawa
     wysłać setki żądań pod rząd. */
  assert.ok(MAKS_NA_PRZEBIEG > 0 && Number.isFinite(MAKS_NA_PRZEBIEG));
});
