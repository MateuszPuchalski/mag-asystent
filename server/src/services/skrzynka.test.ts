import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-skrzynka-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let listaRozmow: typeof import("./skrzynka.js").listaRozmow;
let osRozmowy: typeof import("./skrzynka.js").osRozmowy;
let zlecPomiar: typeof import("./skrzynka.js").zlecPomiar;
let stanSkrzynki: typeof import("./skrzynka.js").stanSkrzynki;
let przejmijRozmowe: typeof import("./conversations.js").przejmijRozmowe;
let wezZadanie: typeof import("./zadania-terenowe.js").wezZadanie;
let wykonajZadanie: typeof import("./zadania-terenowe.js").wykonajZadanie;

const BIURO = { id: 0, name: "Biuro" };
let rozmowaId = 0;
let wiadomoscKlienta = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ listaRozmow, osRozmowy, zlecPomiar, stanSkrzynki } = await import("./skrzynka.js"));
  ({ przejmijRozmowe } = await import("./conversations.js"));
  ({ wezZadanie, wykonajZadanie } = await import("./zadania-terenowe.js"));
  const d = db();
  BIURO.id = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('biuro','Biuro','biuro')").run().lastInsertRowid);

  /* Stan po przebiegu synchronizatora: konto kanału, rozmowa, dwie wiadomości. */
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowaId = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-1','zielony_ogrod',1,'2026-08-31T08:42:00.000Z')`)
    .run(konto).lastInsertRowid);
  wiadomoscKlienta = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,
    external_message_id,direction,body,related_object_type,related_object_id,sent_at)
    VALUES (?,?,'m-1','incoming','Czy zmierzycie rozstaw otworów?','OFFER','oferta-9','2026-08-31T08:42:00.000Z')`)
    .run(rozmowaId, konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-2','outgoing','Sprawdzimy na hali.','2026-08-31T08:42:00.000Z')`).run(rozmowaId, konto);
});

test("lista bierze rozmowy z modelu kanonicznego", () => {
  const r = listaRozmow();
  assert.equal(r.length, 1);
  assert.equal(r[0].klient, "zielony_ogrod");
  assert.equal(r[0].nieprzeczytana, true);
  assert.equal(r[0].ostatniaWiadomosc, "Sprawdzimy na hali.");
  assert.equal(r[0].wlasciciel, null);
});

/* Data ostatniej synchronizacji jest częścią odpowiedzi, bo pusta lista bez niej
   nie odróżnia „nic nie przyszło" od „synchronizator stoi". */
test("stan skrzynki niesie moment ostatniej synchronizacji", () => {
  db().prepare(`INSERT INTO allegro_inbox_sync_state(id,last_success_at,error_count)
                VALUES(1,'2026-08-31T09:00:00.000Z',0)`).run();
  assert.equal(stanSkrzynki().ostatniaSynchronizacja, "2026-08-31T09:00:00.000Z");
});

test("oś rozmowy pokazuje wiadomości i numer oferty", () => {
  const { os } = osRozmowy(rozmowaId);
  assert.equal(os.length, 2);
  assert.equal(os[0].odKlienta, true);
  assert.equal(os[0].ofertaId, "oferta-9");
  assert.equal(os[1].odKlienta, false);
});

test("nieznana rozmowa nie udaje pustej", () => {
  assert.throws(() => osRozmowy(9999), /Nie znaleziono rozmowy/);
});

/* Punkty 3 i 4 definicji ukończenia: jedno przejęcie wygrywa, a przegrany widzi
   właściciela zamiast cichej porażki. */
test("rozmowę przejmuje jeden agent, drugi widzi właściciela", () => {
  const drugi = Number(db().prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ola','Ola','biuro')").run().lastInsertRowid);
  const wersja = listaRozmow()[0].wersja;
  przejmijRozmowe(rozmowaId, BIURO.id, wersja);
  assert.throws(() => przejmijRozmowe(rozmowaId, drugi, wersja), /przejął już inny agent/);
  assert.equal(listaRozmow()[0].wlasciciel, "Biuro");
});

test("pomiar można zlecić tylko z wiadomości należącej do tej rozmowy", () => {
  assert.throws(() => zlecPomiar(rozmowaId, 9999, "", BIURO), /nie należy do tej rozmowy/);
  assert.equal((db().prepare("SELECT count(*) n FROM zadanie_terenowe").get() as { n: number }).n, 0);
});

test("zlecony pomiar niesie pytanie klienta, ofertę i klucze rozmowy", () => {
  const z = zlecPomiar(rozmowaId, wiadomoscKlienta, "podaj w milimetrach", BIURO);
  assert.equal(z.conversationId, rozmowaId);
  assert.equal(z.messageId, wiadomoscKlienta);
  assert.match(z.instrukcja, /Czy zmierzycie rozstaw otworów\?/);
  assert.match(z.instrukcja, /oferta-9/);
  assert.match(z.instrukcja, /podaj w milimetrach/);
  /* tw_id zostaje puste: synchronizator nie pobiera ofert, więc mapowania
     oferta→kartoteka nie ma z czego zrobić. Zgadywanie byłoby gorsze. */
  assert.equal(z.twId, null);
});

test("wynik z hali wraca na oś tej rozmowy jako osobny wpis", () => {
  const zadanie = db().prepare(
    "SELECT id FROM zadanie_terenowe WHERE conversation_id=?").get(rozmowaId) as { id: number };
  const halina = { id: Number(db().prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('halina','Halina','magazynier')")
    .run().lastInsertRowid), name: "Halina" };
  wezZadanie(zadanie.id, halina);
  wykonajZadanie(zadanie.id, "46 mm", halina);

  const { os } = osRozmowy(rozmowaId);
  const wynik = os.find((w) => w.rodzaj === "wynik_zadania");
  assert.ok(wynik, "wynik ma stać na osi");
  assert.equal(wynik.tresc, "46 mm");
  assert.equal(wynik.autor, "Halina");
  /* Treść klienta ma zostać nietknięta — wynik jest dopiskiem, nie podmianą. */
  assert.equal(os.find((w) => w.messageId === wiadomoscKlienta)!.tresc, "Czy zmierzycie rozstaw otworów?");
  /* I trafia na oś WŁAŚCIWEJ rozmowy — zdarzenie wisi na conversation_id. */
  assert.equal((db().prepare(
    "SELECT count(*) n FROM conversation_event WHERE conversation_id=? AND event_type='field_task_result'")
    .get(rozmowaId) as { n: number }).n, 1);
});

/* Bramka własności zostaje bramką także wtedy, gdy zadanie wisi na rozmowie. */
test("wynik zadania z rozmowy zapisze tylko ten, kto je przejął", () => {
  const zadanie = zlecPomiar(rozmowaId, wiadomoscKlienta, "", BIURO);
  assert.throws(() => wykonajZadanie(zadanie.id, "48 mm", { id: 999, name: "Ktoś inny" }),
    /przejęte przez Ciebie/);
});
