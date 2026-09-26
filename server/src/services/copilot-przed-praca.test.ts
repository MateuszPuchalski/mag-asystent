import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-przed-praca-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";
process.env.STREFA_CZASU = "Europe/Warsaw";

/* ── Szkice przed pracą (26 września 2026) ───────────────────────────────────
   Przebieg WYDAJE PIENIĄDZE BEZ KLIKNIĘCIA, więc testy pilnują jego hamulców:
   przełącznika, okna, własnego limitu z księgi — i tego, że nie zjada sufitu
   pierwszej godziny biura. Oba nadawcy są atrapami, zegar jest udawany. */

let db: typeof import("../db/db.js").db;
let P: typeof import("./copilot-przed-praca.js");
let sklasyfikujNowe: typeof import("./klasyfikacja-auto.js").sklasyfikujNowe;
let subiekt: typeof import("../context.js").subiekt;
let BladPrzeciazenia: typeof import("../adapters/copilot.js").BladPrzeciazeniaCopilota;
let konto = 0;

/* Poniedziałek 28 września 2026, czas letni (UTC+2): 4:30 UTC to 6:30 na
   ścianie magazynu, czyli środek domyślnego okna 6–8. */
const RANO = new Date("2026-09-28T04:30:00Z");
const PO_OKNIE = new Date("2026-09-28T06:05:00Z");

let klasyfikacji = 0;
let szkice: number[] = [];

const nadajKlasyfikacji: import("./copilot-klasyfikacja.js").NadawcaKlasyfikacji = async () => {
  klasyfikacji++;
  return {
    surowa: {
      kategoria: "ORDER_STATUS", dodatkowe: [], akcja: "GET_SHIPMENT",
      wymagaCzlowieka: false, prosiOCzlowieka: false,
      brakDanychZamowienia: false, brakDanychProduktu: false,
      pewnosc: "wysoka", powodInne: null, uzasadnienie: "pyta o paczkę",
    },
    model: "atrapa", promptWersja: "k2", ms: 5,
    zuzycie: { wej: 100, wyj: 20, cacheZapis: 0, cacheOdczyt: 0 },
  };
};

/** Atrapa szkicu; kolejność rozmów czyta się z księgi (`szkicowane`). */
const nadajSzkic: import("./copilot-szkic.js").NadawcaSzkicu = async () => {
  szkice.push(1);
  return {
    tresc: "Dzień dobry, paczka jest w drodze.", uzyteFakty: [], zastrzezenia: [],
    daneDoboru: null, pasowanie: null, twierdzenia: [], odczytZeZdjec: [],
    model: "atrapa", ms: 5, zuzycie: { wej: 10, wyj: 5, cacheZapis: 0, cacheOdczyt: 0 },
  };
};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ subiekt } = await import("../context.js"));
  ({ sklasyfikujNowe } = await import("./klasyfikacja-auto.js"));
  ({ BladPrzeciazeniaCopilota: BladPrzeciazenia } = await import("../adapters/copilot.js"));
  P = await import("./copilot-przed-praca.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["szkic_copilota", "copilot_wywolanie", "decyzja_klasyfikacji", "dobor_rozmowy",
    "conversation_event", "message", "conversation", "channel_account", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  klasyfikacji = 0; szkice = [];
});

/** Rozmowa z jednym pytaniem klienta z chwili `kiedy`. */
function rozmowa(kiedy: string, opcje: { pilna?: boolean; odpisalismy?: boolean } = {}): number {
  const d = db();
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject,priorytet)
    VALUES (?,?,'klient',?)`).run(konto, `w-${Math.random()}`, opcje.pilna ? "pilny" : "normalny").lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,?,'incoming','Gdzie jest moja paczka?',?)`).run(r, konto, `m-${Math.random()}`, kiedy);
  if (opcje.odpisalismy) {
    d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
      VALUES (?,?,?,'outgoing','Już sprawdzamy.',?)`)
      .run(r, konto, `m-${Math.random()}`, new Date(Date.parse(kiedy) + 60_000).toISOString());
  }
  return r;
}

/* Kolejność szkiców odczytujemy z księgi: `ulozSzkic` pisze tam rozmowę
   przy każdym wywołaniu, więc atrapa nie musi jej zgadywać. */
const szkicowane = () => (db().prepare(`SELECT conversation_id AS r FROM copilot_wywolanie
  WHERE zadanie='szkic_przed_praca' AND conversation_id IS NOT NULL ORDER BY id`).all() as Array<{ r: number }>).map((w) => Number(w.r));

const biegnij = (n: Partial<import("./copilot-przed-praca.js").PrzedPracaDeps> = {}) =>
  P.szkicePrzedPraca({
    database: db(), nadajKlasyfikacji, nadajSzkic, subiekt, now: () => RANO,
    wlaczony: true, okno: "6-8", limit: 100, oknoDni: 7, ...n,
  });

test("wyłączony przełącznik nie robi nic — ani jednego wywołania", async () => {
  rozmowa("2026-09-26T10:00:00Z");
  const w = await biegnij({ wlaczony: false });
  assert.deepEqual(w, { rozpoznanych: 0, ulozonych: 0, bledow: 0, przerwane: null });
  assert.equal(klasyfikacji + szkice.length, 0);
});

test("poza oknem nie robi nic, także godzinę po nim", async () => {
  rozmowa("2026-09-26T10:00:00Z");
  await biegnij({ now: () => PO_OKNIE });
  await biegnij({ now: () => new Date("2026-09-28T03:59:00Z") });
  assert.equal(klasyfikacji + szkice.length, 0);
});

test("rozpoznaje i szkicuje zaległość: PILNE, potem najdłużej czekające", async () => {
  const nowsza = rozmowa("2026-09-27T18:00:00Z");
  const pilna = rozmowa("2026-09-27T20:00:00Z", { pilna: true });
  const najstarsza = rozmowa("2026-09-26T09:00:00Z");
  const w = await biegnij();
  assert.equal(w.rozpoznanych, 3);
  assert.equal(w.ulozonych, 3);
  assert.deepEqual(szkicowane(), [pilna, najstarsza, nowsza]);
  const s = db().prepare("SELECT przez, przez_user_id, ocena FROM szkic_copilota WHERE conversation_id=?")
    .get(pilna) as { przez: string; przez_user_id: number | null; ocena: string | null };
  assert.equal(s.przez, "automat");
  assert.equal(s.przez_user_id, null);
  assert.equal(s.ocena, null, "szkic czeka na agenta");
  const wyslanych = db().prepare("SELECT count(*) n FROM message WHERE direction='outgoing'").get() as { n: number };
  assert.equal(wyslanych.n, 0, "nic nie idzie do klienta");
  assert.ok(db().prepare("SELECT 1 FROM events WHERE type='copilot_przed_praca'").get());
});

test("rozmowa, w której już odpisaliśmy, i rozmowa sprzed okna dni nie kosztują nic", async () => {
  rozmowa("2026-09-27T10:00:00Z", { odpisalismy: true });
  rozmowa("2026-09-01T10:00:00Z");
  await biegnij();
  assert.equal(klasyfikacji + szkice.length, 0);
});

test("świeży szkic zostaje — drugi przebieg tego ranka nie płaci drugi raz", async () => {
  rozmowa("2026-09-27T10:00:00Z");
  await biegnij();
  assert.equal(szkice.length, 1);
  const w = await biegnij({ now: () => new Date(RANO.getTime() + 120_000) });
  assert.equal(w.ulozonych + w.rozpoznanych, 0);
  assert.equal(klasyfikacji, 1);
  assert.equal(szkice.length, 1);
});

test("własny limit poranka liczy się z księgi, razem z błędami; wczorajszy poranek nie", async () => {
  const a = rozmowa("2026-09-26T10:00:00Z");
  rozmowa("2026-09-27T10:00:00Z");
  /* Wczoraj o 6:30 — inna data lokalna, więc limit dziś jest cały. */
  db().prepare(`INSERT INTO copilot_wywolanie(zadanie,model,wynik,at) VALUES ('szkic_przed_praca','atrapa','ok',?)`)
    .run("2026-09-27T04:30:00.000Z");
  /* Dziś: jeden nieudany szkic zjada limit tak samo jak udany. */
  db().prepare(`INSERT INTO copilot_wywolanie(zadanie,model,wynik,at) VALUES ('szkic_przed_praca','','blad',?)`)
    .run("2026-09-28T04:00:00.000Z");
  const w = await biegnij({ limit: 2 });
  assert.equal(w.ulozonych, 1, "zostało miejsca na jeden szkic");
  assert.deepEqual(szkicowane(), [a]);
  assert.equal(w.przerwane, "limit poranka wyczerpany");

  /* Wyczerpany na wejściu: cisza, bez nowego wpisu co dwie minuty. */
  const wpisow = () => (db().prepare("SELECT count(*) n FROM events WHERE type='copilot_przed_praca'").get() as { n: number }).n;
  const przed = wpisow();
  assert.deepEqual(await biegnij({ limit: 2, now: () => new Date(RANO.getTime() + 120_000) }),
    { rozpoznanych: 0, ulozonych: 0, bledow: 0, przerwane: null });
  assert.equal(wpisow(), przed);
});

test("poranek nie zjada sufitu godzinowego pierwszej godziny biura", async () => {
  /* Wybór z 26 września 2026: poranek pisze do księgi pod własnymi zadaniami,
     więc sufit dnia (`klasyfikacja`, `szkic`) widzi zero, choć poranek płacił. */
  rozmowa("2026-09-27T10:00:00Z");
  rozmowa("2026-09-27T11:00:00Z");
  await biegnij();
  const wg = Object.fromEntries((db().prepare(`SELECT zadanie, count(*) n FROM copilot_wywolanie
    GROUP BY zadanie`).all() as Array<{ zadanie: string; n: number }>).map((w) => [w.zadanie, Number(w.n)]));
  assert.deepEqual(wg, { klasyfikacja_przed_praca: 2, szkic_przed_praca: 2 });

  /* Wiadomość z 7:55, takt dnia o 8:05 z sufitem JEDNEGO rozpoznania na
     godzinę: gdyby poranek się liczył, takt by stał. */
  rozmowa("2026-09-28T05:55:00Z");
  const k = await sklasyfikujNowe({ database: db(), nadaj: nadajKlasyfikacji, naPrzebieg: 5, naGodzine: 1,
    oknoDni: 7, now: () => PO_OKNIE });
  assert.equal(k.sklasyfikowanych, 1);
});

test("koniec okna zatrzymuje przebieg w połowie zaległości", async () => {
  rozmowa("2026-09-26T10:00:00Z");
  rozmowa("2026-09-27T10:00:00Z");
  /* Zegar przeskakuje za 8:00 po pierwszym szkicu. */
  const w = await biegnij({ now: () => (szkice.length === 0 ? new Date("2026-09-28T05:59:00Z") : PO_OKNIE) });
  assert.equal(w.ulozonych, 1);
  assert.equal(w.przerwane, "koniec okna przed pracą");
});

test("szkic nieudany z winy rozmowy nie wraca tego ranka; nowa wiadomość i nowy dzień dostają próbę", async () => {
  const zla = rozmowa("2026-09-26T10:00:00Z");
  rozmowa("2026-09-27T10:00:00Z");
  let wolan = 0;
  const odmowa = async () => { wolan++; throw new Error("odmowa"); };
  const w = await biegnij({ nadajSzkic: odmowa });
  assert.equal(w.bledow, 2);
  assert.equal(wolan, 2);

  const pozniej = new Date(RANO.getTime() + 120_000);
  const w2 = await biegnij({ now: () => pozniej, nadajSzkic: odmowa });
  assert.equal(w2.bledow, 0, "obie próby były płatne i nie wracają dziś");
  assert.equal(wolan, 2);

  /* Klient dopisał: to inna wiadomość, więc inna próba — i tylko ona. */
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,?,'incoming','A jednak inny model.',?)`).run(zla, konto, `m-${Math.random()}`, "2026-09-28T04:00:00Z");
  await biegnij({ now: () => pozniej, nadajSzkic: odmowa });
  assert.equal(wolan, 3);

  /* Następny poranek: obie rozmowy znów dostają próbę. */
  await biegnij({ now: () => new Date(RANO.getTime() + 86_400_000), nadajSzkic: odmowa });
  assert.equal(wolan, 5);
});

test("stan dostawcy kończy przebieg, ale rozmowy nie skreśla — wraca w następnym takcie", async () => {
  const pierwsza = rozmowa("2026-09-26T10:00:00Z");
  rozmowa("2026-09-27T10:00:00Z");
  let wolan = 0;
  const w = await biegnij({
    nadajSzkic: async () => { wolan++; throw new BladPrzeciazenia("przeciążony", 529, "overloaded_error"); } });
  assert.equal(wolan, 1, "przeciążenie nie idzie po drugiej rozmowie");
  assert.equal(w.przerwane, "przeciążony");

  await biegnij({ now: () => new Date(RANO.getTime() + 120_000) });
  assert.equal(szkice.length, 2, "po przeciążeniu obie rozmowy dostają szkic");
  assert.equal(szkicowane().filter((r) => r === pierwsza).length, 2, "pierwsza: próba nieudana i udana");
});

test("okno: czas magazynu także zimą, zły zapis znaczy „nigdy”, a zwykłe takty odpuszczają w oknie", () => {
  /* 7 grudnia 2026, czas zimowy (UTC+1): 5:30 UTC to 6:30 na ścianie. */
  assert.equal(P.wOkniePrzedPraca(new Date("2026-12-07T05:30:00Z"), "6-8"), true);
  assert.equal(P.wOkniePrzedPraca(new Date("2026-12-07T04:30:00Z"), "6-8"), false);
  assert.equal(P.wOkniePrzedPraca(RANO, "22-2"), false, "okno przez północ odrzucone");
  assert.equal(P.wOkniePrzedPraca(RANO, "rano"), false);
  assert.equal(P.przedPracaTrwa(RANO, true), true);
  assert.equal(P.przedPracaTrwa(RANO, false), false);
  assert.equal(P.przedPracaTrwa(PO_OKNIE, true), false);
});
