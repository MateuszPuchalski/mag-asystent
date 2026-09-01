import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sprawy-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Sprawa (§6.1, 0.161.0) ──────────────────────────────────────────────────
   Sprawa stoi PONAD rozmowami i skleja te, które dotyczą jednego problemu
   klienta. Decyzja właściciela z `docs/obsluga-klienta.md` (pytanie 1), podjęta
   jawnie PRZED liczbami, których to pytanie żądało — i z pamięcią o tym, że
   poprzednia odpowiedź o tym samym kształcie kosztowała cztery tabele nakładki
   plus ręczne SCAL i ROZKLEJ.

   Stąd kształt najmniejszy z możliwych i te testy pilnują właśnie granic:
   rozmowa należy do JEDNEJ sprawy, sprawa NIE MA własnej osi (blizna 0.130.0),
   a rozklejenie zostawia rozmowę nietkniętą.                                 */

let db: typeof import("../db/db.js").db;
let utworzSprawe: typeof import("./sprawy.js").utworzSprawe;
let dolaczRozmowe: typeof import("./sprawy.js").dolaczRozmowe;
let odlaczRozmowe: typeof import("./sprawy.js").odlaczRozmowe;
let sprawaRozmowy: typeof import("./sprawy.js").sprawaRozmowy;
let listaSpraw: typeof import("./sprawy.js").listaSpraw;

let biuro = 0;
let pierwsza = 0;
let druga = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ utworzSprawe, dolaczRozmowe, odlaczRozmowe, sprawaRozmowy, listaSpraw } =
    await import("./sprawy.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["sprawa_klienta_rozmowa", "sprawa_klienta", "conversation_event", "message", "conversation",
    "channel_account", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();

  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  pierwsza = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-1','zielony_ogrod')`).run(konto).lastInsertRowid);
  druga = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-2','zielony_ogrod')`).run(konto).lastInsertRowid);
});

test("sprawa skleja dwie rozmowy jednego problemu i widać ją z każdej z nich", () => {
  const s = utworzSprawe("Szarpak do NAC LS 46-450", pierwsza, biuro);
  dolaczRozmowe(s.id, druga, biuro);

  for (const rozmowa of [pierwsza, druga]) {
    const w = sprawaRozmowy(rozmowa)!;
    assert.equal(w.tytul, "Szarpak do NAC LS 46-450");
    assert.deepEqual(w.rozmowy.map((r) => r.id).sort(), [pierwsza, druga].sort());
  }
});

test("rozmowa należy do JEDNEJ sprawy — druga próba mówi, do której", () => {
  /* Rozmowa w dwóch sprawach naraz jest początkiem drogi, która raz już
     kosztowała cztery tabele nakładki. Odmowa niesie tytuł tamtej sprawy,
     żeby agent wiedział, co odkleić, zamiast zgadywać. */
  const pierwszaSprawa = utworzSprawe("Szarpak", pierwsza, biuro);
  const drugaSprawa = utworzSprawe("Filtr", druga, biuro);

  assert.throws(() => dolaczRozmowe(drugaSprawa.id, pierwsza, biuro), /Szarpak/);
  assert.equal(sprawaRozmowy(pierwsza)!.id, pierwszaSprawa.id);
});

test("rozklejenie zostawia rozmowę nietkniętą, a sprawę pustą", () => {
  const s = utworzSprawe("Szarpak", pierwsza, biuro);
  dolaczRozmowe(s.id, druga, biuro);

  odlaczRozmowe(druga, biuro);
  assert.equal(sprawaRozmowy(druga), null);
  assert.deepEqual(sprawaRozmowy(pierwsza)!.rozmowy.map((r) => r.id), [pierwsza]);

  /* Sama rozmowa i jej wiadomości zostają — rozklejenie dotyczy klamry,
     nie treści. */
  const zyje = db().prepare("SELECT count(*) n FROM conversation WHERE id=?").get(druga) as
    { n: number };
  assert.equal(zyje.n, 1);
});

test("sprawa NIE MA własnej osi: zdarzenia wiszą przy rozmowie", () => {
  /* Blizna 0.130.0 — „historia sprawy ginęła przy scalaniu". Wpis o sklejeniu
     zapisujemy przy ŹRÓDLE, więc rozklejenie nie zabiera historii ze sobą. */
  const s = utworzSprawe("Szarpak", pierwsza, biuro);
  dolaczRozmowe(s.id, druga, biuro);
  odlaczRozmowe(druga, biuro);

  const wpisy = db().prepare(`SELECT conversation_id, event_type FROM conversation_event
    WHERE event_type LIKE 'sprawa_%' ORDER BY id`).all() as
    Array<{ conversation_id: number; event_type: string }>;
  assert.deepEqual(wpisy.map((w) => w.event_type),
    ["sprawa_dolaczona", "sprawa_dolaczona", "sprawa_odlaczona"]);
  assert.deepEqual(wpisy.map((w) => w.conversation_id), [pierwsza, druga, druga]);
});

test("każda zmiana klamry zostawia ślad w dzienniku, sam odczyt nie zostawia nic", () => {
  const d = db();
  const s = utworzSprawe("Szarpak", pierwsza, biuro);
  dolaczRozmowe(s.id, druga, biuro);
  const przed = (d.prepare("SELECT count(*) n FROM events").get() as { n: number }).n;

  sprawaRozmowy(pierwsza);
  listaSpraw();
  assert.equal((d.prepare("SELECT count(*) n FROM events").get() as { n: number }).n, przed,
    "odczyt sprawy dopisał zdarzenie");

  odlaczRozmowe(druga, biuro);
  const typy = (d.prepare("SELECT type FROM events WHERE type LIKE 'sprawa_%' ORDER BY id")
    .all() as Array<{ type: string }>).map((w) => w.type);
  /* Założenie sprawy daje DWA wpisy, bo zapisuje dwa wiersze: klamrę i pierwsze
     wiązanie. Jeden wpis na dwa zapisy kłamałby przy rozklejeniu tej pierwszej
     rozmowy — audyt pokazywałby sprawę, do której nikt nigdy nic nie dołączył. */
  assert.deepEqual(typy, ["sprawa_utworzona", "sprawa_dolaczona", "sprawa_dolaczona",
    "sprawa_odlaczona"]);
});

test("sprawa bez tytułu nie powstaje — klamra bez nazwy nic nie skleja", () => {
  assert.throws(() => utworzSprawe("   ", pierwsza, biuro), /tytuł/i);
  assert.equal(sprawaRozmowy(pierwsza), null);
});

test("lista spraw niesie liczbę rozmów i moment ostatniej wiadomości", () => {
  /* Po tych dwóch rzeczach agent wybiera sprawę z listy: czy to ta duża sprawa
     sprzed miesiąca, czy dzisiejsza. Sam tytuł tego nie mówi. */
  const d = db();
  const s = utworzSprawe("Szarpak", pierwsza, biuro);
  dolaczRozmowe(s.id, druga, biuro);
  const konto = (d.prepare("SELECT channel_account_id k FROM conversation WHERE id=?")
    .get(pierwsza) as { k: number }).k;
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,'m-1','incoming','Pytanie','2026-09-01T09:00:00.000Z')`)
    .run(druga, konto);

  const lista = listaSpraw();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].liczbaRozmow, 2);
  assert.equal(lista[0].ostatniaWiadomoscAt, "2026-09-01T09:00:00.000Z");
});

test("skasowana rozmowa zabiera swoje wiązanie, nie zostawia sieroty", () => {
  const s = utworzSprawe("Szarpak", pierwsza, biuro);
  dolaczRozmowe(s.id, druga, biuro);
  db().prepare("DELETE FROM conversation WHERE id=?").run(druga);
  assert.deepEqual(sprawaRozmowy(pierwsza)!.rozmowy.map((r) => r.id), [pierwsza]);
});
