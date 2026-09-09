import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { BladReklamacji, ReklamacjaConflict } from "./reklamacje.js";
import { listaDyskusji } from "./dyskusje.js";
import { poprosOZakonczenie } from "./dyskusja-zakonczenie.js";

/* ── Prośba o zakończenie dyskusji (0.245.0) ─────────────────────────────────
   Ten plik pilnuje rzeczy, których na ekranie nie widać:

   - że prośba wychodzi jako `END_REQUEST`, a nie zwykła wiadomość — to jedyna
     wartość, którą Allegro przewiduje wyłącznie dla dyskusji;
   - że DRUGIEJ prośby nie ma, także po niejednoznacznym timeoucie: pierwsza
     mogła dojść, a druga byłaby dla kupującego wiadomością o niczym;
   - że porażka kodem NIE dotyka wiersza, więc wolno spróbować raz jeszcze;
   - że `status_allegro` zostaje NIETKNIĘTY — należy do Allegro i rozstrzyga
     go dopiero synchronizacja, dokładnie jak zieleń przy pieniądzach;
   - że reklamacji tą drogą nie da się dosięgnąć: `END_REQUEST` jest przy niej
     niedozwolony i żądanie wróciłoby błędem PO strzale.

   Adapter jest zawsze wstrzykiwany — żaden test nie strzela do Allegro.     */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const KTO = { id: 1, name: "A. Lewandowska" };

function stanowisko(n: { typ?: string; czatAktywny?: number; status?: string } = {}) {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
      typ,order_id,kupujacy_login,temat,status_allegro,czat_aktywny,wiadomosci_ile,
      ostatnia_wiadomosc_status,ostatnia_wiadomosc_at,otwarto_at,synced_at)
    VALUES (?,'i-1',?, 'ZAM-1','kowalski','Nie dostałem przesyłki', ?,?,1,
      'BUYER_REPLIED','2026-09-06T10:01:00Z','2026-09-06T10:00:00Z','2026-09-09T10:00:00Z')`).run(
    konto, n.typ ?? "DISPUTE", n.status ?? "DISPUTE_ONGOING", n.czatAktywny ?? 1).lastInsertRowid);
  d.prepare(
    `INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
     VALUES (?,'w-1','BUYER','Nie dostałem przesyłki','2026-09-06T10:01:00Z')`).run(id);
  const pytanie = Number((d.prepare(
    "SELECT id FROM reklamacja_wiadomosc WHERE reklamacja_id=?").get(id) as { id: number }).id);
  return { d, id, pytanie };
}

const wiersz = (d: DatabaseSync, id: number) => ({ ...(d.prepare(
  `SELECT zakonczenie_status, zakonczenie_przez, zakonczenie_user_id, zakonczenie_at,
          status_allegro, wersja, prowadzi FROM reklamacja_klienta WHERE id=?`)
  .get(id) as Record<string, unknown>) });

const skrzynka = (d: DatabaseSync) => (d.prepare(
  "SELECT typ, status, body FROM reklamacja_outbox ORDER BY id").all() as
  Array<Record<string, unknown>>).map((w) => ({ ...w }));

/** Zadanie z domyślnymi polami świeżości. */
const zadanie = (d: DatabaseSync, id: number, pytanie: number, n: Record<string, unknown> = {}) => ({
  dyskusjaId: id, autor: KTO, tresc: "Sprawa załatwiona, dziękuję.",
  expectedWersja: 1, expectedLastMessageId: pytanie, database: d, ...n,
});

test("prośba wychodzi jako END_REQUEST i zostawia ślad na sprawie", async () => {
  const { d, id, pytanie } = stanowisko();
  const wyslane: Array<[string, string, string]> = [];
  const wynik = await poprosOZakonczenie(zadanie(d, id, pytanie, {
    wyslij: async (issueId: string, tekst: string, typ: string) => {
      wyslane.push([issueId, tekst, typ]);
      return { id: "w-2", createdAt: "2026-09-09T12:00:00Z" };
    },
  }));

  assert.deepEqual(wyslane, [["i-1", "Sprawa załatwiona, dziękuję.", "END_REQUEST"]]);
  assert.equal(wynik.status, "sent");
  const w = wiersz(d, id);
  assert.equal(w.zakonczenie_status, "sent");
  assert.equal(w.zakonczenie_przez, "A. Lewandowska");
  assert.equal(w.zakonczenie_user_id, 1);
  assert.equal(w.status_allegro, "DISPUTE_ONGOING",
    "stan dyskusji należy do Allegro — rozstrzyga go synchronizacja, nie nasz strzał");
  assert.deepEqual(skrzynka(d).map((s) => s.typ), ["END_REQUEST"]);
});

test("pusta prośba nie idzie do Allegro — kupujący ma przeczytać dlaczego", async () => {
  const { d, id, pytanie } = stanowisko();
  let strzalow = 0;
  await assert.rejects(
    () => poprosOZakonczenie(zadanie(d, id, pytanie, {
      tresc: "   \n ", wyslij: async () => { strzalow += 1; return { id: "x" }; },
    })),
    (e: unknown) => e instanceof BladReklamacji && /Napisz kupującemu/.test((e as Error).message));
  assert.equal(strzalow, 0, "odrzucenie nie dotyka ani sieci, ani skrzynki");
  assert.deepEqual(skrzynka(d), []);
});

test("zamknięta rozmowa odpada PRZED strzałem, zdaniem zamiast kodu 409", async () => {
  const { d, id, pytanie } = stanowisko({ czatAktywny: 0 });
  let strzalow = 0;
  await assert.rejects(
    () => poprosOZakonczenie(zadanie(d, id, pytanie, {
      wyslij: async () => { strzalow += 1; return { id: "x" }; },
    })),
    (e: unknown) => e instanceof ReklamacjaConflict && /zamknęło rozmowę/.test((e as Error).message));
  assert.equal(strzalow, 0);
});

test("DRUGIEJ prośby nie ma — ani po udanej, ani po niejednoznacznej", async () => {
  for (const stan of ["sent", "send_uncertain"]) {
    const { d, id, pytanie } = stanowisko();
    d.prepare("UPDATE reklamacja_klienta SET zakonczenie_status=?, zakonczenie_przez='Ktoś' WHERE id=?")
      .run(stan, id);
    let strzalow = 0;
    await assert.rejects(
      () => poprosOZakonczenie(zadanie(d, id, pytanie, {
        wyslij: async () => { strzalow += 1; return { id: "x" }; },
      })),
      (e: unknown) => e instanceof ReklamacjaConflict && /już poproszono/.test((e as Error).message),
      stan);
    assert.equal(strzalow, 0, stan);
  }
});

test("porażka kodem NIE dotyka wiersza — wolno spróbować raz jeszcze", async () => {
  const { d, id, pytanie } = stanowisko();
  await assert.rejects(() => poprosOZakonczenie(zadanie(d, id, pytanie, {
    wyslij: async () => { throw new BladOdpowiedziAllegro("Allegro: 400", 400); },
  })));
  const w = wiersz(d, id);
  assert.equal(w.zakonczenie_status, null, "sprawa nie nosi śladu prośby, która nie wyszła");
  assert.deepEqual(skrzynka(d).map((s) => s.status), ["send_failed"],
    "ślad po nieudanej próbie zostaje w skrzynce nadawczej");

  /* Druga próba przechodzi, bo pierwsza na pewno nie doszła. */
  const wynik = await poprosOZakonczenie(zadanie(d, id, pytanie, {
    wyslij: async () => ({ id: "w-2" }),
  }));
  assert.equal(wynik.status, "sent");
  assert.equal(wiersz(d, id).zakonczenie_status, "sent");
});

test("niejednoznaczny los zapisuje się jako taki, a nie jako sukces", async () => {
  const { d, id, pytanie } = stanowisko();
  /* Allegro odpowiedziało, ale nie nazwało wiadomości — nie wiemy, czy jest. */
  const wynik = await poprosOZakonczenie(zadanie(d, id, pytanie, {
    wyslij: async () => ({}),
  }));
  assert.equal(wynik.status, "send_uncertain");
  assert.equal(wiersz(d, id).zakonczenie_status, "send_uncertain");
});

test("reklamacji tą drogą nie da się dosięgnąć", async () => {
  /* `END_REQUEST` jest przy reklamacji niedozwolony i żądanie wróciłoby błędem
     PO strzale — czyli po zapisie próby w skrzynce nadawczej. */
  const { d, id, pytanie } = stanowisko({ typ: "CLAIM", status: "CLAIM_SUBMITTED" });
  let strzalow = 0;
  await assert.rejects(
    () => poprosOZakonczenie(zadanie(d, id, pytanie, {
      wyslij: async () => { strzalow += 1; return { id: "x" }; },
    })),
    (e: unknown) => e instanceof BladReklamacji && /Dyskusja .* nie istnieje/.test((e as Error).message));
  assert.equal(strzalow, 0);
  assert.deepEqual(skrzynka(d), []);
});

test("do dziennika idą długość i los, nigdy treść", async () => {
  const { d, id, pytanie } = stanowisko();
  await poprosOZakonczenie(zadanie(d, id, pytanie, {
    tresc: "Adres klienta: Kowalskiego 5", wyslij: async () => ({ id: "w-2" }),
  }));
  const wpisy = (d.prepare("SELECT type, payload FROM events ORDER BY id").all() as
    Array<{ type: string; payload: string | null }>);
  const zakonczenie = wpisy.find((w) => w.type === "dyskusja_zakonczenie");
  assert.ok(zakonczenie, "zdarzenie ma WŁASNĄ nazwę, nie reklamacyjną");
  assert.deepEqual(JSON.parse(zakonczenie.payload ?? "{}"),
    { id, status: "sent", znakow: 28 });
  for (const w of wpisy) {
    assert.ok(!(w.payload ?? "").includes("Kowalskiego"), `treść wyciekła do ${w.type}`);
  }
});

test("odpowiedź w dyskusji zapisuje się w dzienniku pod własną nazwą", async () => {
  /* Wysyłka jest wspólna z reklamacjami, więc bez parametru rodzaju ślad
     audytowy mówiłby „reklamacja_odpowiedz" o dyskusji. */
  const { d, id, pytanie } = stanowisko();
  await poprosOZakonczenie(zadanie(d, id, pytanie, { wyslij: async () => ({ id: "w-2" }) }));
  const nazwy = (d.prepare("SELECT DISTINCT type FROM events").all() as Array<{ type: string }>)
    .map((w) => w.type);
  assert.ok(nazwy.includes("dyskusja_odpowiedz"), nazwy.join(", "));
  assert.ok(!nazwy.includes("reklamacja_odpowiedz"), nazwy.join(", "));
});

test("sprawa po prośbie nadal stoi w kolejce, dopóki Allegro jej nie zamknie", async () => {
  /* Prośba to nie zamknięcie. Zniknięcie wiersza z kolejki po naszym kliknięciu
     byłoby obietnicą, której specyfikacja nigdzie nie daje. */
  const { d, id, pytanie } = stanowisko();
  await poprosOZakonczenie(zadanie(d, id, pytanie, { wyslij: async () => ({ id: "w-2" }) }));
  const [w] = listaDyskusji(d, Date.parse("2026-09-09T12:00:00Z"));
  assert.equal(w.kubelek, "klient", "po naszej wiadomości ruch przechodzi do klienta");
  assert.equal(w.zakonczenieStatus, "sent");
});
