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
let wezZadanie: typeof import("./zadania-terenowe.js").wezZadanie;
let wykonajZadanie: typeof import("./zadania-terenowe.js").wykonajZadanie;

const BIURO = { id: 0, name: "Biuro" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ listaRozmow, osRozmowy, zlecPomiar, stanSkrzynki } = await import("./skrzynka.js"));
  ({ wezZadanie, wykonajZadanie } = await import("./zadania-terenowe.js"));
  const d = db();
  BIURO.id = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('biuro','Biuro','biuro')").run().lastInsertRowid);
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,last_message_at,interlocutor_login,surowe_json,synced_at)
             VALUES ('w-1',0,'2026-08-31T08:42:00.000Z','zielony_ogrod','{}','2026-08-31T09:00:00.000Z')`).run();
  d.prepare(`INSERT INTO allegro_inbox_message(id,thread_id,author_login,author_role,text,
             related_object_type,related_object_id,read,surowe_json)
             VALUES ('m-1','w-1','zielony_ogrod','BUYER','Czy zmierzycie rozstaw otworów?','OFFER','oferta-9',0,'{}')`).run();
  d.prepare(`INSERT INTO allegro_inbox_message(id,thread_id,author_login,author_role,text,
             related_object_type,related_object_id,read,surowe_json)
             VALUES ('m-2','w-1','wertis','SELLER','Sprawdzimy na hali.',NULL,NULL,1,'{}')`).run();
});

test("lista bierze rozmowy ze zsynchronizowanego magazynu", () => {
  const r = listaRozmow();
  assert.equal(r.length, 1);
  assert.equal(r[0].klient, "zielony_ogrod");
  assert.equal(r[0].nieprzeczytana, true);
  assert.equal(r[0].ostatniaWiadomosc, "Sprawdzimy na hali.");
});

/* Data ostatniej synchronizacji jest częścią odpowiedzi, bo pusta lista bez niej
   nie odróżnia „nic nie przyszło" od „synchronizator stoi". */
test("stan skrzynki niesie moment ostatniej synchronizacji", () => {
  db().prepare(`INSERT INTO allegro_inbox_sync_state(id,last_success_at,error_count)
                VALUES(1,'2026-08-31T09:00:00.000Z',0)`).run();
  assert.equal(stanSkrzynki().ostatniaSynchronizacja, "2026-08-31T09:00:00.000Z");
});

test("oś rozmowy pokazuje wiadomości i numer oferty", () => {
  const { os } = osRozmowy("w-1");
  assert.equal(os.length, 2);
  assert.equal(os[0].odKlienta, true);
  assert.equal(os[0].ofertaId, "oferta-9");
  assert.equal(os[1].odKlienta, false);
});

test("nieznana rozmowa nie udaje pustej", () => {
  assert.throws(() => osRozmowy("nie-ma"), /Nie znaleziono rozmowy/);
});

/* Sedno bramki: agent podaje identyfikatory, a treść i ofertę składa serwer
   z bazy. Wiadomość z cudzej rozmowy ma odpaść, zanim powstanie zadanie. */
test("pomiar można zlecić tylko z wiadomości należącej do tej rozmowy", () => {
  assert.throws(() => zlecPomiar("w-1", "m-obca", "", BIURO), /nie należy do tej rozmowy/);
  assert.equal((db().prepare("SELECT count(*) n FROM zadanie_terenowe").get() as { n: number }).n, 0);
});

test("zlecony pomiar niesie pytanie klienta, ofertę i namiary rozmowy", () => {
  const z = zlecPomiar("w-1", "m-1", "podaj w milimetrach", BIURO);
  assert.equal(z.zrodlo, "skrzynka");
  assert.equal(z.zrodloRef, "w-1");
  assert.equal(z.rodzaj, "pomiar");
  assert.match(z.instrukcja, /Czy zmierzycie rozstaw otworów\?/);
  assert.match(z.instrukcja, /oferta-9/);
  assert.match(z.instrukcja, /podaj w milimetrach/);
  /* tw_id zostaje puste: synchronizator nie pobiera ofert, więc mapowania
     oferta→kartoteka nie ma z czego zrobić. Zgadywanie byłoby gorsze. */
  assert.equal(z.twId, null);
});

test("wynik z hali wraca na oś rozmowy jako osobny wpis", () => {
  const zadanie = db().prepare(
    "SELECT id FROM zadanie_terenowe WHERE zrodlo_ref='w-1'").get() as { id: number };
  const halina = { id: Number(db().prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('halina','Halina','magazynier')")
    .run().lastInsertRowid), name: "Halina" };
  wezZadanie(zadanie.id, halina);
  wykonajZadanie(zadanie.id, "46 mm", halina);

  const { os } = osRozmowy("w-1");
  const wynik = os.find((w) => w.rodzaj === "wynik_zadania");
  assert.ok(wynik, "wynik ma stać na osi");
  assert.equal(wynik.tresc, "46 mm");
  assert.equal(wynik.autor, "Halina");
  /* Treść klienta ma zostać nietknięta — wynik jest dopiskiem, nie podmianą. */
  assert.equal(os.find((w) => w.id === "m-1")!.tresc, "Czy zmierzycie rozstaw otworów?");
});
