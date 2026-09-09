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
let stanKolejkiWysylek: typeof import("./skrzynka.js").stanKolejkiWysylek;
let przejmijRozmowe: typeof import("./conversations.js").przejmijRozmowe;
let zapiszWiadomosc: typeof import("./conversations.js").zapiszWiadomosc;
let wskazKartoteke: typeof import("./conversations.js").wskazKartoteke;
let ustawPriorytet: typeof import("./conversations.js").ustawPriorytet;
let wezZadanie: typeof import("./zadania-terenowe.js").wezZadanie;
let wykonajZadanie: typeof import("./zadania-terenowe.js").wykonajZadanie;

const BIURO = { id: 0, name: "Biuro" };
let rozmowaId = 0;
let wiadomoscKlienta = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ listaRozmow, osRozmowy, zlecPomiar, stanSkrzynki, stanKolejkiWysylek } =
    await import("./skrzynka.js"));
  ({ przejmijRozmowe, wskazKartoteke, ustawPriorytet, zapiszWiadomosc } = await import("./conversations.js"));
  ({ wezZadanie, wykonajZadanie } = await import("./zadania-terenowe.js"));
  const d = db();
  BIURO.id = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('biuro','Biuro','biuro')").run().lastInsertRowid);

  /* Stan po przebiegu synchronizatora: konto kanału, rozmowa, dwie wiadomości. */
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowaId = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-1','zielony_ogrod',1,'2026-08-31T09:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  wiadomoscKlienta = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,
    external_message_id,direction,body,related_object_type,related_object_id,sent_at)
    VALUES (?,?,'m-1','incoming','Czy zmierzycie rozstaw otworów?','OFFER','oferta-9','2026-08-31T08:42:00.000Z')`)
    .run(rozmowaId, konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-2','outgoing','Sprawdzimy na hali.','2026-08-31T09:00:00.000Z')`).run(rozmowaId, konto);
});

test("lista bierze rozmowy z modelu kanonicznego, a podgląd to słowa klienta", () => {
  const r = listaRozmow();
  assert.equal(r.length, 1);
  assert.equal(r[0].klient, "zielony_ogrod");
  assert.equal(r[0].nieprzeczytana, true);
  /* Do 0.165.0 ta asercja oczekiwała „Sprawdzimy na hali." — czyli utrwalała
     usterkę: podgląd brał ostatnią wiadomość JAKĄKOLWIEK, więc autoodpowiedź
     konta Allegro zasłaniała pytanie. Data idzie z tej samej wiadomości,
     nie z daty wątku (09:00). */
  assert.equal(r[0].ostatniaWiadomosc, "Czy zmierzycie rozstaw otworów?");
  assert.equal(r[0].ostatniaWiadomoscAt, "2026-08-31T08:42:00.000Z");
  assert.equal(r[0].ostatniaOdKlienta, true);
  assert.equal(r[0].wlasciciel, null);
});

test("rozmowa bez wiadomości klienta pokazuje ostatnią naszą i mówi, że to biuro", () => {
  /* Wątek, który zaczęliśmy my. Pusty podgląd wyglądałby jak usterka, a podgląd
     bez podpisu — jak pytanie klienta. Osobna rozmowa, żeby nie ruszać
     stanu, na którym stoją pozostałe testy. */
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const nasza = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-nasza','ogrod_pl',0,'2026-08-30T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-nasza','outgoing','Przesyłka wyszła dziś.','2026-08-30T10:00:00.000Z')`).run(nasza, konto);
  const pusta = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-pusta','nowy_wątek',1,'2026-08-29T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);

  const lista = listaRozmow();
  const wNasza = lista.find((r) => r.id === nasza)!;
  assert.equal(wNasza.ostatniaWiadomosc, "Przesyłka wyszła dziś.");
  assert.equal(wNasza.ostatniaOdKlienta, false);
  /* Wątek świeżo założony, bez wiadomości (Allegro takie oddaje): data
     z wątku, podgląd pusty i bez podpisu „Biuro" — nie ma czego podpisywać. */
  const wPusta = lista.find((r) => r.id === pusta)!;
  assert.equal(wPusta.ostatniaWiadomosc, "");
  assert.equal(wPusta.ostatniaWiadomoscAt, "2026-08-29T10:00:00.000Z");
  assert.equal(wPusta.ostatniaOdKlienta, true);
  /* Kolejność dalej niesie datę wątku: 09:00 > 08-30 > 08-29. */
  assert.deepEqual(lista.map((r) => r.id), [rozmowaId, nasza, pusta]);
  d.prepare("DELETE FROM conversation WHERE id IN (?,?)").run(nasza, pusta);
});

test("oś niesie zamówienie z relatesTo.order i nazwę towaru z zamówienia", () => {
  /* Mail Allegro „Wiadomość dotyczy" pokazuje towar; panel do 0.165.0 pokazywał
     goły numer oferty, a numer zamówienia wyrzucał przy mapowaniu. */
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-zam','kupujacy_7',1,'2026-08-30T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_object_type,related_object_id,related_order_id,sent_at)
    VALUES (?,?,'m-zam-1','incoming','Ta sztuka pasuje?','OFFER','oferta-9','zam-77','2026-08-30T10:00:00.000Z')`)
    .run(r, konto);

  /* Zanim ticker dociągnie zamówienie: numer i odnośnik są, treści nie ma. */
  let os = osRozmowy(r);
  assert.equal(os.os[0].zamowienieId, "zam-77");
  assert.equal(os.os[0].nazwaOferty, null, "nazwy nie znamy, dopóki oferta nie przeszła przez zamówienie");
  assert.equal(os.zamowienie?.externalId, "zam-77");
  assert.equal(os.zamowienie?.pobrane, null);

  const zam = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (?,'zam-77','2026-08-30T10:10:00.000Z')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,offer_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,'oferta-9','Szarpak do NAC LS 46-450',1,4599,'PLN')`).run(zam);

  os = osRozmowy(r);
  assert.equal(os.os[0].nazwaOferty, "Szarpak do NAC LS 46-450");
  assert.equal(os.zamowienie?.pobrane?.pozycje[0].nazwa, "Szarpak do NAC LS 46-450");
  assert.equal(os.zamowienie?.pobrane?.pozycje[0].zwracana, false);
  /* Rozmowa bez numeru zamówienia nie udaje, że jakieś ma. */
  assert.equal(osRozmowy(rozmowaId).zamowienie, null);
  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
  d.prepare("DELETE FROM zamowienie_klienta WHERE id=?").run(zam);
});

test("pytanie pod ofertą niesie blok oferty: numer od razu, tytuł ze snapshotu", () => {
  /* Skarga z 2 września 2026: „klient zadał pytanie pod ofertą, a nie wyświetla
     mi się, pod jaką". Mail powiadamiający ma tytuł, cenę i zdjęcie; panel do
     0.177.1 miał sam numer, bo tytuł znaliśmy WYŁĄCZNIE z pozycji zamówienia —
     a pytanie sprzed zakupu zamówienia nie ma i mieć nie będzie. */
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-of','hemnryk',1,'2026-09-02T14:42:58.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_object_type,related_object_id,sent_at)
    VALUES (?,?,'m-of-1','incoming','nóż 43cm SV 40 150cc będzie pasował?','OFFER','12096815384',
            '2026-09-02T14:42:58.000Z')`).run(r, konto);

  /* Zanim ticker dociągnie snapshot: numer i odnośnik są, tytułu nie ma.
     `null` znaczy „jeszcze nie pobrano", a panel mówi to zdaniem — cisza
     w tym miejscu wyglądałaby jak usterka. */
  let os = osRozmowy(r);
  assert.equal(os.oferta?.externalId, "12096815384");
  assert.match(String(os.oferta?.link), /12096815384/);
  assert.equal(os.oferta?.pobrana, null);
  assert.equal(os.os[0].nazwaOferty, null);

  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,cena_grosze,
    waluta,status,synced_at) VALUES (?,'12096815384',
    'NÓŻ DO KOSIARKI STIGA 43cm 46S CASTELGARDEN NG464','NOZ-STIGA-43',4890,'PLN','ACTIVE',
    '2026-09-02T14:50:00.000Z')`).run(konto);

  os = osRozmowy(r);
  assert.match(String(os.oferta?.pobrana?.nazwa), /NÓŻ DO KOSIARKI STIGA 43cm/);
  assert.equal(os.oferta?.pobrana?.cenaGrosze, 4890);
  assert.equal(os.oferta?.pobrana?.sku, "NOZ-STIGA-43");
  assert.equal(os.oferta?.pobrana?.status, "ACTIVE");
  /* Ten sam tytuł wchodzi na oś, przy wiadomości. */
  assert.match(String(os.os[0].nazwaOferty), /NÓŻ DO KOSIARKI STIGA 43cm/);
  /* Rozmowa bez numeru oferty nie udaje, że jakąś ma — blok znika, a nie
     pokazuje pustego numeru. */
  const bez = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,'w-bez','kupujacy_0','2026-08-20T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    sent_at) VALUES (?,?,'m-bez-1','incoming','Dzień dobry','2026-08-20T10:00:00.000Z')`)
    .run(bez, konto);
  assert.equal(osRozmowy(bez).oferta, null);

  d.prepare("DELETE FROM conversation WHERE id IN (?,?)").run(r, bez);
  d.prepare("DELETE FROM offer_snapshot WHERE channel_account_id=?").run(konto);
});

test("snapshot oferty WYGRYWA z nazwą z pozycji zamówienia", () => {
  /* Kolejność nie jest obojętna: snapshot to tytuł SAMEJ oferty, a pozycja
     zamówienia opisuje towar tak, jak nazywał się w chwili zakupu. */
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-of2','kupujacy_9',1,'2026-09-02T15:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_object_type,related_object_id,related_order_id,sent_at)
    VALUES (?,?,'m-of-2','incoming','Pasuje?','OFFER','oferta-9','zam-78','2026-09-02T15:00:00.000Z')`)
    .run(r, konto);
  const zam = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (?,'zam-78','2026-09-02T15:10:00.000Z')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,offer_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,'oferta-9','Nazwa z zamówienia',1,4599,'PLN')`).run(zam);
  assert.equal(osRozmowy(r).os[0].nazwaOferty, "Nazwa z zamówienia");

  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,synced_at)
    VALUES (?,'oferta-9','Tytuł z oferty','2026-09-02T15:20:00.000Z')`).run(konto);
  assert.equal(osRozmowy(r).os[0].nazwaOferty, "Tytuł z oferty");

  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
  d.prepare("DELETE FROM zamowienie_klienta WHERE id=?").run(zam);
  d.prepare("DELETE FROM offer_snapshot WHERE channel_account_id=?").run(konto);
});

test("kartoteka przy rozmowie: SKU oferty prowadzi do towaru, a powód mówi o braku", () => {
  /* SKU sprzedawcy leżało w `offer_snapshot` od 0.178.0 i nie prowadziło
     donikąd — agent szedł po stan i półkę do Subiekta. */
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,'w-kart','hemnryk','2026-09-02T14:42:58.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_object_type,related_object_id,sent_at)
    VALUES (?,?,'m-kart-1','incoming','Nóż 43cm będzie pasował?','OFFER','12096815384',
            '2026-09-02T14:42:58.000Z')`).run(r, konto);

  /* Zanim ticker dociągnie snapshot: powód mówi, że oferty NIE POBRANO —
     to stan przejściowy i naprawi się sam. */
  assert.equal(osRozmowy(r).oferta?.kartoteka.powod, "oferta_niepobrana");

  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,'12096815384','NÓŻ DO KOSIARKI STIGA 43cm','NOZ-STIGA-43',
            '2026-09-02T14:50:00.000Z')`).run(konto);
  /* Snapshot jest, ale kartoteki o tym symbolu nie ma — inny powód, inne zdanie. */
  assert.equal(osRozmowy(r).oferta?.kartoteka.powod, "sku_nie_trafia");

  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (7701,'NOZ-STIGA-43','Nóż 43 cm')").run();
  const k = osRozmowy(r).oferta?.kartoteka;
  assert.equal(k?.twId, 7701);
  assert.equal(k?.pewnosc, "sku");
  assert.match(String(k?.zrodlo), /SKU oferty/);

  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
  d.prepare("DELETE FROM offer_snapshot WHERE channel_account_id=?").run(konto);
  d.prepare("DELETE FROM sgt_towar WHERE tw_id=7701").run();
});

test("ręczne wskazanie kartoteki zapisuje pamięć, oś i audyt, a zdjęcie ją kasuje", () => {
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,'w-wsk','kupujacy_5','2026-09-02T15:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (7702,'REC-01','Wskazany ręcznie')").run();

  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,'12096815384','Nóż','NOZ-STIGA-43','2026-09-02T14:50:00.000Z')`).run(konto);
  const w = wskazKartoteke(r, "12096815384", 7702, BIURO.id, d);
  assert.equal(w.twId, 7702);
  assert.equal(w.symbol, "REC-01");

  const pamiec = d.prepare(`SELECT tw_id, sku, sku_wtedy, wskazano_przez FROM oferta_kartoteka
    WHERE channel_account_id=? AND offer_id='12096815384'`).get(konto) as
    { tw_id: number; sku: string | null; sku_wtedy: string | null; wskazano_przez: string };
  assert.equal(pamiec.tw_id, 7702);
  /* Puste `sku` znaczy „wskazał człowiek", wypełnione — „zatwierdził
     propozycję automatu". Ekran czyta z tego, co podpisać przy kartotece. */
  assert.equal(pamiec.sku, null);
  /* Sygnatura z chwili wskazania (0.219.0): gdy sprzedawca ją przepnie, wskazanie ustąpi. */
  assert.equal(pamiec.sku_wtedy, "NOZ-STIGA-43");
  d.prepare("DELETE FROM offer_snapshot WHERE channel_account_id=?").run(konto);
  assert.equal(pamiec.wskazano_przez, "Biuro");

  const naOsi = d.prepare(`SELECT event_type FROM conversation_event
    WHERE conversation_id=? ORDER BY id DESC LIMIT 1`).get(r) as { event_type: string };
  assert.equal(naOsi.event_type, "product_linked_manually");
  assert.equal((d.prepare(`SELECT count(*) n FROM events WHERE type='rozmowa_kartoteka_wskazana'`)
    .get() as { n: number }).n, 1);

  /* Zdjęcie musi skasować PAMIĘĆ, inaczej następny odczyt zaproponuje ją
     z powrotem i zdjęcie wyglądałoby na nieskuteczne. */
  wskazKartoteke(r, "12096815384", null, BIURO.id, d);
  const zostalo = (d.prepare(`SELECT count(*) n FROM oferta_kartoteka
    WHERE channel_account_id=? AND offer_id='12096815384'`).get(konto) as { n: number }).n;
  assert.equal(zostalo, 0);

  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
  d.prepare("DELETE FROM sgt_towar WHERE tw_id=7702").run();
});

test("wiersz kolejki niesie czas oczekiwania, licznik dopisków i znak zadania", () => {
  const w = listaRozmow().find((r) => r.id === rozmowaId)!;
  /* Zegar liczy się od PYTANIA klienta (08:42), nie od naszej odpowiedzi
     o 09:00 — inaczej mierzyłby cudzą cierpliwość od złego momentu. */
  assert.ok(w.czekaOdMs !== null && w.czekaOdMs > 0);
  assert.equal(w.nowychOdOdpowiedzi, 0, "klient nie dopisał nic po naszej odpowiedzi");
  assert.equal(w.zadanieWToku, false);
  assert.equal(w.priorytet, "normalny");
});

test("rozmowa bez pytania klienta nie dostaje zegara oczekiwania", () => {
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,'w-nasza','kupujacy_8','2026-09-02T16:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    sent_at) VALUES (?,?,'m-nasza','outgoing','Dzień dobry','2026-09-02T16:00:00.000Z')`).run(r, konto);
  /* `null`, nie zero: nikt tu nie czeka, a zegar od NASZEJ wiadomości
     kłamałby o cierpliwości klienta, który nic nie napisał. */
  assert.equal(listaRozmow().find((x) => x.id === r)!.czekaOdMs, null);
  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
});

test("licznik liczy dopiski klienta OD NASZEJ ODPOWIEDZI, nie nieprzeczytane", () => {
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,'w-licz','kupujacy_6','2026-09-02T16:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  const wiadomosc = (ext: string, kierunek: string, at: string) =>
    d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,
      body,sent_at) VALUES (?,?,?,?,'tresc',?)`).run(r, konto, ext, kierunek, at);
  wiadomosc("l-1", "incoming", "2026-09-02T10:00:00.000Z");
  wiadomosc("l-2", "outgoing", "2026-09-02T11:00:00.000Z");
  wiadomosc("l-3", "incoming", "2026-09-02T12:00:00.000Z");
  wiadomosc("l-4", "incoming", "2026-09-02T13:00:00.000Z");
  assert.equal(listaRozmow().find((x) => x.id === r)!.nowychOdOdpowiedzi, 2);
  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
});

test("PILNE idzie na górę listy, a poza tym rządzi czas oczekiwania", () => {
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const zaloz = (ext: string, pytanieAt: string) => {
    const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
      subject,updated_at) VALUES (?,?,?,'2026-09-02T16:00:00.000Z')`)
      .run(konto, ext, ext).lastInsertRowid);
    d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,
      body,sent_at) VALUES (?,?,?, 'incoming','pytanie',?)`).run(r, konto, `m-${ext}`, pytanieAt);
    return r;
  };
  const stara = zaloz("w-stara", "2026-08-01T10:00:00.000Z");
  const swieza = zaloz("w-swieza", "2026-09-02T15:00:00.000Z");

  const bezFlagi = listaRozmow().map((x) => x.id);
  assert.ok(bezFlagi.indexOf(stara) < bezFlagi.indexOf(swieza), "starsze pytanie stoi wyżej");

  ustawPriorytet(d, swieza, "pilny", BIURO.id);
  assert.equal(listaRozmow()[0].id, swieza, "ręczna flaga przebija zegar");
  /* Ślad zostaje: mutacja bez autora nie istnieje w tym repo. */
  assert.equal((d.prepare("SELECT count(*) n FROM events WHERE type='rozmowa_priorytet'")
    .get() as { n: number }).n, 1);

  d.prepare("DELETE FROM conversation WHERE id IN (?,?)").run(stara, swieza);
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

/* ── Zlecenie i wynik to DWA wpisy (0.226.0) ─────────────────────────────────
   Zgłoszenie właściciela: „zlecenie zmierzenia też powinno zostać pokazane
   jako blok w wiadomości". Do 0.224.0 oś niosła sam wynik, a prośba, która go
   wywołała, nie zostawiała po sobie nic poza kreskami zmiany statusu.        */

test("zlecenie stoi na osi ZANIM wynik przyjdzie — bo wtedy właśnie się czeka", () => {
  const { os } = osRozmowy(rozmowaId);
  const zlec = os.find((w) => w.rodzaj === "zlecenie");
  assert.ok(zlec, "zlecenie ma stać na osi od chwili zlecenia");
  assert.equal(zlec.zlecenie?.status, "nowe");
  /* Treścią wpisu jest INSTRUKCJA: po niej widać, czy wynik odpowiada na
     zadane pytanie. Tytuł jedzie osobnym polem, bo jest etykietą. */
  assert.match(zlec.tresc, /Czy zmierzycie rozstaw otworów\?/);
  assert.ok(zlec.zlecenie?.tytul, "tytuł jedzie osobno, nie sklejony z instrukcją");
  /* Wyniku jeszcze nie ma — i to jest cała wartość tego wpisu. */
  assert.equal(os.find((w) => w.rodzaj === "wynik_zadania"), undefined);
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

  /* ZLECENIE ZOSTAJE i stoi PRZED wynikiem. Sklejenie ich w jeden kafelek
     przesunęłoby prośbę do godziny odpowiedzi i skłamało o kolejności —
     a między jednym a drugim mija czas, w którym bywają wiadomości klienta. */
  const zlec = os.findIndex((w) => w.rodzaj === "zlecenie");
  const wynikIdx = os.findIndex((w) => w.rodzaj === "wynik_zadania");
  assert.ok(zlec >= 0, "zlecenie nie znika po wykonaniu");
  assert.ok(zlec < wynikIdx, "prośba przed odpowiedzią");
  assert.equal(os[zlec].zlecenie?.status, "wykonane");
});

/* Bramka własności zostaje bramką także wtedy, gdy zadanie wisi na rozmowie. */
test("wynik zadania z rozmowy zapisze tylko ten, kto je przejął", () => {
  const zadanie = zlecPomiar(rozmowaId, wiadomoscKlienta, "", BIURO);
  assert.throws(() => wykonajZadanie(zadanie.id, "48 mm", { id: 999, name: "Ktoś inny" }),
    /przejęte przez Ciebie/);
});

/* ── Kartoteka wskazana przez agenta (0.145.0) ─────────────────────────────
   Agent nie wpisuje `tw_id`, tylko wskazuje towar wyszukiwarką. Zadanie ma
   zapisać, że to JEGO wybór — bo wkrótce dojdzie kartoteka wywiedziona
   z oferty i te dwie rzeczy nie mogą wyglądać tak samo. */

test("wskazana kartoteka ląduje na zadaniu i jest podpisana jako wybór agenta", () => {
  db().prepare(
    "INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (1042,'ROZ-GCV','Rozrusznik kompletny GCV')",
  ).run();
  const z = zlecPomiar(rozmowaId, wiadomoscKlienta, "", BIURO, 1042);
  assert.equal(z.twId, 1042);
  assert.match(z.instrukcja, /Kartotekę wskazał\(a\) Biuro, nie wynika z oferty/);
});

test("nieistniejąca kartoteka odrzucona, zadanie nie powstaje", () => {
  const przed = (db().prepare("SELECT count(*) n FROM zadanie_terenowe").get() as { n: number }).n;
  assert.throws(() => zlecPomiar(rozmowaId, wiadomoscKlienta, "", BIURO, 987654), /Nie znaleziono towaru/);
  assert.equal((db().prepare("SELECT count(*) n FROM zadanie_terenowe").get() as { n: number }).n, przed);
});

test("bez wskazania kartoteki zadanie idzie jak dotąd, bez podpisu o wyborze", () => {
  const z = zlecPomiar(rozmowaId, wiadomoscKlienta, "", BIURO);
  assert.equal(z.twId, null);
  assert.doesNotMatch(z.instrukcja, /wskazał/);
  assert.match(z.instrukcja, /Oferta Allegro: oferta-9/);
});

/* ── Komentarze wewnętrzne na osi (0.157.0) ──────────────────────────────────
   Do tego wydania `conversation_comment` miała w całym kodzie serwera JEDEN
   INSERT i ZERO odczytów. Agent mógł dodać notatkę, wiersz wpadał do tabeli
   i nie było drogi, którą wróciłby do kogokolwiek — funkcja do zapisu bez
   odczytu. §10.3 wymienia komentarz wśród rzeczy, które ma nieść oś. */

test("komentarz wewnętrzny wraca na oś, z autorem i wzmiankami", async () => {
  const { dodajKomentarz } = await import("./conversations.js");
  const d = db();
  const ala = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro')").run().lastInsertRowid);

  dodajKomentarz(rozmowaId, BIURO.id, "Sprawdź, czy to nie jest ten sam klient co wczoraj.", [ala]);

  const { os } = osRozmowy(rozmowaId);
  const k = os.find((w) => w.rodzaj === "komentarz");
  assert.ok(k, "komentarz ma stać na osi");
  assert.match(k.tresc, /ten sam klient/);
  assert.equal(k.autor, "Biuro");
  assert.equal(k.odKlienta, false);
  assert.deepEqual(k.wzmianki?.map((w) => w.name), ["Ala"]);
});

test("oś jest CHRONOLOGICZNA — komentarz z wczoraj nie ląduje na końcu", () => {
  /* Do 0.157.0 wyniki zadań doklejały się za wszystkimi wiadomościami bez
     względu na czas, bo oś nie miała wspólnego porządku. Przy dwóch źródłach
     to było znośne; przy trzech oś przestawała opowiadać przebieg sprawy. */
  const d = db();
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject,unread,updated_at)
    SELECT channel_account_id,'w-chrono','klient',0,'2026-08-31T10:00:00.000Z'
      FROM conversation WHERE id=?`).run(rozmowaId).lastInsertRowid);
  const konto = Number((d.prepare("SELECT channel_account_id k FROM conversation WHERE id=?")
    .get(rozmowa) as { k: number }).k);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,'c-1','incoming','Pytanie','2026-08-31T09:00:00.000Z')`)
    .run(rozmowa, konto);
  d.prepare(`INSERT INTO conversation_comment(conversation_id,author_user_id,body,created_at)
    VALUES (?,?,'Notatka w środku','2026-08-31T09:30:00.000Z')`).run(rozmowa, BIURO.id);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,'c-2','outgoing','Odpowiedź','2026-08-31T10:00:00.000Z')`)
    .run(rozmowa, konto);

  const rodzaje = osRozmowy(rozmowa).os.map((w) => w.rodzaj);
  assert.deepEqual(rodzaje, ["wiadomosc", "komentarz", "wiadomosc"]);
});

test("treść komentarza NIE trafia do tabeli, z której czyta wysyłka", async () => {
  /* §6.4: komentarze „nie mogą przypadkiem trafić do klienta"; §25 stawia to
     wśród kryteriów gotowości. Granica jest STRUKTURALNA: wysyłka bierze tekst
     ze szkicu i zapisuje go do `message`, a komentarz mieszka w osobnej tabeli
     i nigdy tam nie wchodzi.

     Pierwsza wersja tego testu wołała `payloadAllegroWiadomosci` z numerem
     komentarza i PRZECHODZIŁA PRZYPADKIEM. `conversation_comment.id`
     i `message.id` to dwie niezależne sekwencje, więc oba bywają jedynką —
     przy kolizji tamta funkcja oddałaby cudzą wiadomość zamiast rzucić. Test
     mierzył szczęście w doborze danych, a nie granicę. */
  const { dodajKomentarz } = await import("./conversations.js");
  const tresc = "Klient bywa trudny — uważaj na ton.";
  dodajKomentarz(rozmowaId, BIURO.id, tresc, []);

  const wMessage = (db().prepare("SELECT count(*) n FROM message WHERE body=?")
    .get(tresc) as { n: number }).n;
  assert.equal(wMessage, 0, "treść komentarza znalazła się wśród wiadomości");

  const wSzkicu = (db().prepare("SELECT count(*) n FROM conversation_draft WHERE body=?")
    .get(tresc) as { n: number }).n;
  assert.equal(wSzkicu, 0, "treść komentarza wylądowała w szkicu, który idzie do klienta");
});

test("odłożenie po terminie wraca do kolejki jako otwarte i widać, że termin minął", async () => {
  /* Rozmowa odłożona na wczoraj wygląda w kolumnie tak samo jak odłożona na
     przyszły tydzień — różnicę robi dopiero czas. Kolejka ma pokazać ją jako
     żywą, ale nie milczeć o tym, że nikt jej po terminie nie tknął.

     Od 0.225.0 „żywa" znaczy KONKRETNIE, kto ma następny ruch: odłożenie
     wygasa, a potem rozmowa sama mówi, czyja kolej. W tej rozmowie ostatnia
     jest NASZA odpowiedź, więc piłka stoi po stronie klienta. */
  const { ustawStatus } = await import("./conversations.js");
  const d = db();
  ustawStatus(d, rozmowaId, "snoozed", BIURO.id, "2026-08-31T06:00:00.000Z");

  const wiersz = listaRozmow().find((r) => r.id === rozmowaId)!;
  assert.equal(wiersz.status, "waiting_for_customer",
    "termin minął, więc rozmowa jest znów żywa — a ostatnia była nasza odpowiedź");
  assert.equal(wiersz.poTerminie, true);
  assert.equal(wiersz.odlozoneDo, "2026-08-31T06:00:00.000Z");

  /* Odczyt niczego nie prostuje w bazie — reguła „zero zapisu przy patrzeniu".
     Kolumna zostaje `snoozed` do najbliższej ręcznej zmiany. */
  const wBazie = d.prepare("SELECT status FROM conversation WHERE id=?").get(rozmowaId) as
    { status: string };
  assert.equal(wBazie.status, "snoozed");

  ustawStatus(d, rozmowaId, "open", BIURO.id, null);
  const po = listaRozmow().find((r) => r.id === rozmowaId)!;
  assert.equal(po.poTerminie, false);
  assert.equal(po.odlozoneDo, null, "ręczna zmiana kasuje termin, bo już nic nie znaczy");
});

test("zmiana statusu ląduje na osi, a zmiana bez różnicy nie zostawia nic", () => {
  /* §10.3 wymienia zmianę statusu wśród wpisów osi. Kolejność sprawdzamy
     razem z resztą, bo wpis bez daty wypłynąłby na samą górę — przed
     pierwszym pytaniem klienta. */
  const wpisy = osRozmowy(rozmowaId).os;
  assert.equal(wpisy[0].rodzaj, "wiadomosc", "pytanie klienta zostaje pierwsze");

  const statusy = wpisy.filter((w) => w.rodzaj === "status");
  /* Oś opowiada CAŁY przebieg, razem z pętlą przez halę: zlecony pomiar
     przestawia rozmowę na „czeka na nas", a wynik z hali zdejmuje ten stan
     (0.159.0). Oba przejścia są automatyczne i oba mają tu zostać — bez nich
     czytelnik nie wie, dlaczego sprawa stała.

     Czego NIE MA na tej liście: „open → open". Otwarcie rozmowy odłożonej,
     której termin już minął, nie zmieniło niczego, co widać — dla czytelnika
     była otwarta od chwili terminu, a wpis opowiadałby o zdarzeniu, którego
     nie było. */
  assert.deepEqual(statusy.map((w) => w.tresc), [
    "new → open",
    "open → waiting_for_internal",
    "waiting_for_internal → open",
    "open → waiting_for_internal",
    "waiting_for_internal → snoozed",
  ]);
  assert.equal(statusy.at(-1)!.autor, "Biuro");
  assert.equal(statusy.at(-1)!.odKlienta, false,
    "zmiana statusu nie ma prawa wyglądać jak głos klienta");
  /* Wynik z hali podpisuje HALA, nie agent: to jej pomiar zmienił stan. */
  assert.equal(statusy[2].autor, "hala");
});

/* ── Kolejka wysyłek mówi prawdę (0.173.0) ───────────────────────────────────
   Do 0.172.0 `/api/health` twierdził „wysyłka wyłączona" — nieprawda od
   0.148.0, czyli od wydania, w którym wysyłka zaczęła działać. Napis, który
   każe NIE szukać, jest gorszy od braku wskaźnika.                         */

/** Wiersz kolejki w zadanym stanie; kasuje poprzednie, bo baza jest wspólna. */
function outbox(stany: string[]) {
  const d = db();
  d.prepare("DELETE FROM outbox").run();
  stany.forEach((status, i) => {
    d.prepare(`INSERT INTO outbox(conversation_id,idempotency_key,body,expected_version,status,created_by)
      VALUES (?,?,'tekst',1,?,?)`).run(rozmowaId, `k-${i}-${status}`, status, BIURO.id);
  });
}

test("pusta kolejka mówi, że nic nie poszło — nie że wysyłka nie działa", () => {
  outbox([]);
  const s = stanKolejkiWysylek();
  assert.equal(s.kolejkaWysylek, "pusta — nic jeszcze nie poszło");
  assert.equal(s.wysylkiDoSprawdzenia, 0);
});

test("nieudana, niepewna i wisząca wysyłka WOŁAJĄ o człowieka, wysłana nie", () => {
  outbox(["sent", "sent", "send_failed", "send_uncertain", "sending"]);
  const s = stanKolejkiWysylek();
  assert.match(s.kolejkaWysylek, /2 wysłanych/);
  assert.match(s.kolejkaWysylek, /1 nieudanych/);
  assert.match(s.kolejkaWysylek, /1 niepewnych/);
  assert.match(s.kolejkaWysylek, /1 w toku/);
  assert.equal(s.wysylkiDoSprawdzenia, 3, "wysłane nie wołają o nic — reszta tak");
});

test("same udane wysyłki nie zapalają wskaźnika", () => {
  outbox(["sent"]);
  const s = stanKolejkiWysylek();
  assert.equal(s.kolejkaWysylek, "1 wysłanych");
  assert.equal(s.wysylkiDoSprawdzenia, 0);
});

/* ── Rozpoznanie Copilota nie przestawia kolejki (§14, etap F) ───────────────
   To jest DECYZJA, nie skutek uboczny, więc dostaje własny test. Dzisiejsze
   klucze kolejności — ręczna flaga `pilny` i czas oczekiwania klienta — są
   FAKTAMI. Kategoria jest przypuszczeniem maszyny, a jedna pomyłka
   klasyfikatora zakopałaby prawdziwe pytanie na dole listy tak, że nikt by
   tego nie zauważył. Regułę kolejności wolno dołożyć dopiero wtedy, gdy pomiar
   trafności ją uzasadni (etap G).                                            */
test("rozpoznanie kategorii dokłada plakietkę i NIE rusza kolejności", async () => {
  const d = db();
  const { sklasyfikujRozmowy } = await import("./copilot-klasyfikacja.js");
  const przed = listaRozmow().map((x) => x.id);
  assert.ok(przed.length >= 2, "test o kolejności potrzebuje co najmniej dwóch wierszy");
  assert.equal(listaRozmow().find((x) => x.id === rozmowaId)!.kopilot, null,
    "brak wiersza znaczy \u201enierozpoznana\u201d i liczy się przy odczycie");

  const w = await sklasyfikujRozmowy(d, [rozmowaId], BIURO, async () => ({
    kategoria: "dobor", pewnosc: "wysoka", uzasadnienie: "pyta o rozstaw",
    model: "claude-opus-5", ms: 90,
    zuzycie: { wej: 800, wyj: 150, cacheZapis: 0, cacheOdczyt: 0 },
  }));
  assert.equal(w.sklasyfikowane, 1);

  assert.deepEqual(listaRozmow().map((x) => x.id), przed,
    "kategoria nie jest kluczem kolejności i nie ma prawa nim zostać");
  const r = listaRozmow().find((x) => x.id === rozmowaId)!;
  assert.deepEqual(r.kopilot,
    { kategoria: "dobor", pewnosc: "wysoka", nieaktualna: false, ocena: null });
});

test("dopisek klienta czyni plakietkę nieaktualną — serwer mówi to sam", () => {
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  /* Nowsza wiadomość KLIENTA. Nasza odpowiedź etykiety nie postarza: pytanie
     zadaje klient, a klasyfikacja opisuje jego pytanie. */
  const nowa = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,
    external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-dopisek','incoming','Aha, i jeszcze jedno.','2026-08-31T10:00:00.000Z')`)
    .run(rozmowaId, konto).lastInsertRowid);

  const r = listaRozmow().find((x) => x.id === rozmowaId)!;
  assert.equal(r.kopilot!.nieaktualna, true,
    "etykieta liczona na starszej wiadomości ma się przyznać, że jest stara");

  d.prepare("DELETE FROM message WHERE id=?").run(nowa);
  assert.equal(listaRozmow().find((x) => x.id === rozmowaId)!.kopilot!.nieaktualna, false);
});

test("rozmowa z samym zamówieniem: jedyna pozycja daje ofertę rozmowy, a pozycja niesie kartotekę", async () => {
  /* Zrzut od właściciela (0.215.0): rozmowa bez oferty, z zamówieniem na jedną
     pozycję — a kolumna mówiła „nie ma z czego wywieść kartoteki". Zamówienie
     nazywa towar dokładniej niż oferta i ma SKU od razu, z formularza zakupu. */
  const { wskazOferte } = await import("./conversations.js");
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,'w-tylko-zam','kupujacy_91','2026-09-06T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_order_id,sent_at) VALUES (?,?,'m-tz-1','incoming','Czy to pasuje do MTD 600?','zam-91',
    '2026-09-06T10:00:00.000Z')`).run(r, konto);
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (7801,'16-25003','Mandrela piasta MTD')").run();

  /* Zanim ticker dociągnie zamówienie: ani oferty, ani kartoteki — i to nie jest usterka. */
  assert.equal(osRozmowy(r).oferta, null);

  const zam = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (?,'zam-91','2026-09-06T10:10:00.000Z')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (?,'9100000001','MANDRELA PIASTA DO MTD 600','16-25003',2,9292,'PLN')`).run(zam);

  let os = osRozmowy(r);
  assert.equal(os.oferta?.externalId, "9100000001");
  assert.equal(os.oferta?.zrodlo, "zamowienie");
  assert.equal(os.oferta?.pobrana, null, "snapshotu oferty nie ma — numer i kartoteka są mimo to");
  /* Kartoteka z SKU POZYCJI, nie ze snapshotu: pozycja zamówienia ma SKU od razu. */
  assert.equal(os.oferta?.kartoteka.twId, 7801);
  assert.equal(os.oferta?.kartoteka.pewnosc, "sku");
  const p = os.zamowienie?.pobrane?.pozycje[0];
  assert.equal(p?.twId, 7801);
  assert.equal(p?.twSymbol, "16-25003");
  assert.match(String(p?.twZrodlo), /SKU oferty/);

  /* Druga pozycja: automat nie zgaduje — oferty nie ma, a pozycja bez kartoteki mówi `null`. */
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (?,'9200000002','Linka gazu','BRAK-XYZ',1,1500,'PLN')`).run(zam);
  os = osRozmowy(r);
  assert.equal(os.oferta, null);
  assert.equal(os.zamowienie?.pobrane?.pozycje[1].twId, null);
  assert.equal(os.zamowienie?.pobrane?.pozycje[1].twZrodlo, null);

  /* Wskazanie przy pozycji = to samo zdarzenie, co ręczny numer; blok oferty je CZYTA (do 0.213.0 nie czytał). */
  wskazOferte(r, "9200000002", BIURO.id, d);
  os = osRozmowy(r);
  assert.equal(os.oferta?.externalId, "9200000002");
  assert.equal(os.oferta?.zrodlo, "reczne");
  /* Wskazana pozycja ma SKU z formularza zakupu, więc mostek nie czeka na
     snapshot: powodem braku jest „SKU nie trafia", nie „oferty nie pobrano". */
  assert.equal(os.oferta?.kartoteka.powod, "sku_nie_trafia");

  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
  d.prepare("DELETE FROM zamowienie_klienta WHERE id=?").run(zam);
  d.prepare("DELETE FROM sgt_towar WHERE tw_id=7801").run();
});

test("ręczne wskazanie oferty przebija numer z wiadomości — jak w doborze", async () => {
  const { wskazOferte } = await import("./conversations.js");
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,'w-reczna','kupujacy_92','2026-09-06T11:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_object_type,related_object_id,sent_at)
    VALUES (?,?,'m-r-1','incoming','Pasuje?','OFFER','111','2026-09-06T11:00:00.000Z')`).run(r, konto);
  assert.equal(osRozmowy(r).oferta?.zrodlo, "wiadomosc");
  assert.equal(osRozmowy(r).oferta?.externalId, "111");
  wskazOferte(r, "222", BIURO.id, d);
  assert.equal(osRozmowy(r).oferta?.externalId, "222");
  assert.equal(osRozmowy(r).oferta?.zrodlo, "reczne");
  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
});

/* ── Podpis rozmówcy (0.219.2) ───────────────────────────────────────────────
   NA KOŃCU PLIKU celowo: oba testy zakładają własne rozmowy, a testy listy
   wyżej liczą wiersze skrzynki. Dopisane przed nimi psuły trzy z nich. */
test("podpis wiadomości klienta niesie LOGIN, nie temat wątku", () => {
  /* ── Blizna 0.219.2 ────────────────────────────────────────────────────────
     Do 0.219.1 podpis brał `c.subject`, czyli TEMAT wątku. Na koncie
     właściciela temat bywa równy loginowi, więc ekran wyglądał poprawnie —
     i dokładnie dlatego było groźnie: przy wątku o temacie „Zaworek zwrotny"
     wiadomość klienta podpisywała się nazwą części, a nie tym, kto ją napisał.
     Ten test rozdziela oba pola, żeby nie dało się ich znowu pomylić. */
  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-login')")
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,last_message_at,interlocutor_login,surowe_json,synced_at)
    VALUES ('w-login',1,'2026-09-01T10:00:00.000Z','bagslublin','{}','2026-09-01T10:00:00.000Z')`).run();
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-login','Zaworek zwrotny',1,'2026-09-01T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-login','incoming','Dzień dobry','2026-09-01T10:00:00.000Z')`).run(rozmowa, konto);

  const wpis = osRozmowy(rozmowa).os.find((w) => w.rodzaj === "wiadomosc")!;
  assert.equal(wpis.autor, "bagslublin");
  assert.notEqual(wpis.autor, "Zaworek zwrotny");
});

test("kolejka i nagłówek też biorą LOGIN, nie temat (0.228.0)", () => {
  /* 0.219.2 naprawiło to na OSI rozmowy i zatrzymało się w pół drogi: wiersz
     kolejki i nagłówek dalej brały `c.subject`. Złapała to dopiero przeglądarka
     — przycisk „kopiuj login" w nagłówku kopiował nazwę części. */
  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','naglowek')")
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,last_message_at,interlocutor_login,surowe_json,synced_at)
    VALUES ('w-naglowek',1,'2026-09-01T10:00:00.000Z','bagslublin','{}','2026-09-01T10:00:00.000Z')`).run();
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject,updated_at)
    VALUES (?,'w-naglowek','Zaworek zwrotny','2026-09-01T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,'m-naglowek','incoming','Pytanie','2026-09-01T10:00:00.000Z')`)
    .run(rozmowa, konto);

  assert.equal(listaRozmow().find((x) => x.id === rozmowa)!.klient, "bagslublin");
  assert.equal(osRozmowy(rozmowa).rozmowa.klient, "bagslublin");
});

test("wątek bez loginu spada na temat, a potem na słowo „Klient”", () => {
  /* Wątek bez rozmówcy ISTNIEJE — Allegro takie oddaje. Ekran ma wtedy
     pokazać cokolwiek prawdziwego, a nie puste miejsce po podpisie. */
  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-bez')")
    .run().lastInsertRowid);
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-bez','Pytanie o gwint',1,'2026-09-01T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-bez','incoming','Dzień dobry','2026-09-01T10:00:00.000Z')`).run(rozmowa, konto);

  assert.equal(osRozmowy(rozmowa).os.find((w) => w.rodzaj === "wiadomosc")!.autor, "Pytanie o gwint");
});

test("zwrot tego zamówienia jedzie z rozmową — po numerze zamówienia, nigdy po loginie", () => {
  /* Właściciel (0.221.0): klient pyta pod zamówieniem o zwrot, którego dokonał,
     a agent szukał go ręcznie na ekranie Zwroty. Mostek jest ten sam, którym
     zwrot znajduje swoje rozmowy od 0.169.0 — `related_order_id`. */
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,'w-ze-zwrotem','kupujacy_44','2026-09-06T12:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_order_id,sent_at) VALUES (?,?,'m-zw-1','incoming','Kiedy dostanę pieniądze za zwrot?','zam-zw-1',
    '2026-09-06T12:00:00.000Z')`).run(r, konto);
  /* Zwrot INNEGO zamówienia tego samego kupującego nie ma prawa się tu pokazać. */
  const zw1 = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,created_at,synced_at,
    kupujacy_login,paczka_at) VALUES (?,'zwrot-1','zam-zw-1','2026-09-01T10:00:00.000Z','2026-09-06T11:00:00.000Z',
    'kupujacy_44','2026-09-03T08:00:00.000Z')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,powod,klucz)
    VALUES (?,'oferta-9','Szarpak do NAC',1,4599,'PLN','DAMAGED','oferta-9')`).run(zw1);
  const zw2 = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,created_at,synced_at,
    kupujacy_login) VALUES (?,'zwrot-2','zam-inne','2026-08-01T10:00:00.000Z','2026-09-06T11:00:00.000Z','kupujacy_44')`)
    .run(konto).lastInsertRowid);

  const os = osRozmowy(r);
  assert.equal(os.zwroty.length, 1);
  assert.equal(os.zwroty[0].externalId, "zwrot-1");
  assert.equal(os.zwroty[0].kubelek, "decyzja");
  assert.equal(os.zwroty[0].paczkaAt, "2026-09-03T08:00:00.000Z");
  assert.deepEqual(os.zwroty[0].pozycje.map((p) => [p.nazwa, p.ilosc, p.powod]), [["Szarpak do NAC", 1, "DAMAGED"]]);
  /* Ten sam skład, co w kolejce zwrotów — z rozmową o tym zakupie włącznie. */
  assert.deepEqual(os.zwroty[0].rozmowy.map((x) => x.id), [r]);
  /* Rozmowa bez numeru zamówienia nie ma zwrotów, choć login by pasował. */
  assert.deepEqual(osRozmowy(rozmowaId).zwroty, []);

  d.prepare("DELETE FROM zwrot_klienta_pozycja WHERE zwrot_id IN (?,?)").run(zw1, zw2);
  d.prepare("DELETE FROM zwrot_klienta WHERE id IN (?,?)").run(zw1, zw2);
  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
});

/* ── Kto ma następny ruch (0.225.0) ──────────────────────────────────────────
   Właściciel: „w większości nie powinienem był robić tego ręcznie — otwarta,
   czeka na klienta, czeka na nas powinno być odczytywane z wiadomości".
   Te testy pilnują, że reguła jest jedna i że werdykt człowieka ją przebija. */

function rozmowaZWiadomosciami(kierunki: Array<"incoming" | "outgoing">, status = "open") {
  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro',?)")
    .run(`ruch-${Math.random()}`).lastInsertRowid);
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject,status,updated_at)
    VALUES (?,?,'Temat',?,'2026-09-01T10:00:00.000Z')`)
    .run(konto, `w-${Math.random()}`, status).lastInsertRowid);
  kierunki.forEach((k, i) => d.prepare(`INSERT INTO message(conversation_id,channel_account_id,
    external_message_id,direction,body,sent_at)
    VALUES (?,?,?,?,'x',?)`).run(rozmowa, konto, `m-${rozmowa}-${i}`, k,
      `2026-09-01T1${i}:00:00.000Z`));
  return rozmowa;
}

test("ostatnia wiadomość klienta znaczy „czeka na nas”", () => {
  const r = rozmowaZWiadomosciami(["outgoing", "incoming"]);
  assert.equal(osRozmowy(r).rozmowa.status, "waiting_for_us");
});

test("nasza odpowiedź na końcu znaczy „czeka na klienta”", () => {
  const r = rozmowaZWiadomosciami(["incoming", "outgoing"]);
  assert.equal(osRozmowy(r).rozmowa.status, "waiting_for_customer");
});

test("kolejka i otwarta rozmowa mówią to samo", () => {
  /* Dwie kopie reguły rozjechałyby się przy pierwszej poprawce, a objawem
     byłaby kolejka pokazująca inny stan niż rozmowa po kliknięciu. */
  const r = rozmowaZWiadomosciami(["outgoing", "incoming"]);
  const zListy = listaRozmow().find((x) => x.id === r)!;
  assert.equal(zListy.status, osRozmowy(r).rozmowa.status);
  assert.equal(zListy.status, "waiting_for_us");
});

test("werdykt człowieka przebija wyliczenie", () => {
  /* „Rozwiązana" i „Zamknięta" mają zostać mimo pytania klienta na końcu —
     inaczej nie dałoby się domknąć żadnej sprawy. */
  for (const status of ["resolved", "closed", "spam", "snoozed"]) {
    const r = rozmowaZWiadomosciami(["incoming"], status);
    assert.equal(osRozmowy(r).rozmowa.status, status, `status ${status} miał zostać`);
  }
});

test("czekanie na halę przebija wyliczenie — pomiar trwa mimo pytania klienta", () => {
  /* `waiting_for_internal` nie wynika z wiadomości, tylko ze zlecenia pomiaru,
     więc wyliczenie nie ma prawa go zdjąć. Zdejmie go dopiero wynik z hali. */
  const r = rozmowaZWiadomosciami(["incoming"], "waiting_for_internal");
  assert.equal(osRozmowy(r).rozmowa.status, "waiting_for_internal");
});

test("wątek bez ani jednej wiadomości zostaje przy stanie zapisanym", () => {
  /* Allegro oddaje takie wątki. Nie ma z czego wywieść ruchu i ekran nie ma
     prawa zgadywać. */
  const r = rozmowaZWiadomosciami([], "new");
  assert.equal(osRozmowy(r).rozmowa.status, "new");
});

/* ── Autoodpowiedź nie zamyka piłki (0.227.0) ────────────────────────────────
   „Dziękujemy za kontakt" wychodzi SAMO, w sekundę po pytaniu, i nie odpowiada
   na nic. Liczone jako nasza wiadomość przestawiało rozmowę na „czeka na
   klienta" i zdejmowało ją z listy tych, które czekają na odpowiedź — pytanie
   ginęło przez to, że skrzynka grzecznie potwierdziła jego odbiór.        */

const ODBICIE = "Dziękujemy za kontakt\n\nTa wiadomość jest generowana automatycznie.";

function rozmowaZOdbiciem(poOdbiciu: Array<"incoming" | "outgoing"> = []) {
  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro',?)")
    .run(`auto-${Math.random()}`).lastInsertRowid);
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject,status,updated_at)
    VALUES (?,?,'Temat','open','2026-09-01T10:00:00.000Z')`)
    .run(konto, `w-${Math.random()}`).lastInsertRowid);
  /* Przez `zapiszWiadomosc`, nie wprost do tabeli: to ta funkcja rozpoznaje
     odbicie przy zapisie i test ma przejść JEJ ścieżką. */
  const pisz = (dir: "incoming" | "outgoing", body: string, i: number) =>
    zapiszWiadomosc({ conversationId: rozmowa, channelAccountId: konto,
      externalMessageId: `a-${rozmowa}-${i}`, direction: dir, body,
      sentAt: `2026-09-01T1${i}:00:00.000Z` }, d);
  pisz("incoming", "Czy ten szarpak pasuje?", 0);
  pisz("outgoing", ODBICIE, 1);
  poOdbiciu.forEach((k, i) => pisz(k, k === "incoming" ? "Dopisuję" : "Pasuje.", i + 2));
  return rozmowa;
}

test("po autoodpowiedzi rozmowa DALEJ czeka na nas", () => {
  const r = rozmowaZOdbiciem();
  assert.equal(osRozmowy(r).rozmowa.status, "waiting_for_us");
  assert.equal(listaRozmow().find((x) => x.id === r)!.status, "waiting_for_us");
});

test("prawdziwa odpowiedź agenta piłkę oddaje", () => {
  /* Reguła jest WĄSKA: pomija odbicie, a nie wszystko, co od nas wychodzi. */
  const r = rozmowaZOdbiciem(["outgoing"]);
  assert.equal(osRozmowy(r).rozmowa.status, "waiting_for_customer");
});

test("licznik dopisków liczy się od PRAWDZIWEJ odpowiedzi, nie od odbicia", () => {
  /* Wiersz kolejki mówił „zero dopisków" o rozmowie, w której klient napisał
     i nikt mu nie odpowiedział — bo autoodpowiedź stała po jego pytaniu. */
  const r = rozmowaZOdbiciem(["incoming"]);
  assert.equal(listaRozmow().find((x) => x.id === r)!.nowychOdOdpowiedzi, 2);
});

test("oś bierze znacznik odbicia z KOLUMNY, nie liczy go drugi raz", () => {
  /* Jedno źródło: tę samą wartość czyta kolejka przy wyliczaniu, kto ma ruch. */
  const r = rozmowaZOdbiciem();
  const d = db();
  const wpisy = osRozmowy(r).os.filter((w) => w.rodzaj === "wiadomosc");
  assert.equal(wpisy.at(-1)!.automatyczna, true);
  assert.equal(wpisy[0]!.automatyczna, undefined, "pytanie klienta nie jest odbiciem");
  assert.equal((d.prepare(
    "SELECT auto_odpowiedz a FROM message WHERE conversation_id=? ORDER BY id DESC LIMIT 1")
    .get(r) as { a: number }).a, 1);
});

test("odbicie CYTOWANE przez klienta nie jest naszym odbiciem", () => {
  /* Kierunek rozstrzyga pewnie, treść nie rozstrzyga wcale: klient odpisujący
     z naszym potwierdzeniem pod spodem zadaje pytanie. */
  const d = db();
  const r = rozmowaZOdbiciem();
  const konto = Number((d.prepare(
    "SELECT channel_account_id k FROM conversation WHERE id=?").get(r) as { k: number }).k);
  zapiszWiadomosc({ conversationId: r, channelAccountId: konto,
    externalMessageId: `cytat-${r}`, direction: "incoming",
    body: `Dopytuję.\n\n> ${ODBICIE}`, sentAt: "2026-09-01T19:00:00.000Z" }, d);

  assert.equal((d.prepare(
    "SELECT auto_odpowiedz a FROM message WHERE conversation_id=? ORDER BY id DESC LIMIT 1")
    .get(r) as { a: number }).a, 0);
  assert.equal(osRozmowy(r).rozmowa.status, "waiting_for_us");
});

/* ── Zdarzenie niesie KIERUNEK (0.228.0) ─────────────────────────────────────
   Panel zapalał pasek „Klient dopisał nową wiadomość" na każde
   `message.created` — także na naszą odpowiedź wracającą z synchronizacji
   i na autoodpowiedź. Bez kierunku w zdarzeniu odbiorca nie miał z czego
   odróżnić pytania od echa własnej pracy.                                  */
test("message.created mówi, czy pisał klient i czy to odbicie", async () => {
  const { onConversationEvent } = await import("./conversation-realtime.js");
  const zebrane: Array<Record<string, unknown>> = [];
  const stop = onConversationEvent((e) => {
    if (e.type === "message.created") zebrane.push(e.data as Record<string, unknown>);
  });

  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','zdarzenia')")
    .run().lastInsertRowid);
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-zdarzenia','Temat')`)
    .run(konto).lastInsertRowid);
  const pisz = (i: number, dir: "incoming" | "outgoing", body: string) =>
    zapiszWiadomosc({ conversationId: rozmowa, channelAccountId: konto,
      externalMessageId: `z-${i}`, direction: dir, body,
      sentAt: `2026-09-01T1${i}:00:00.000Z` }, d);

  pisz(1, "incoming", "Pytanie klienta");
  pisz(2, "outgoing", "Dziękujemy za kontakt\n\nTa wiadomość jest generowana automatycznie.");
  pisz(3, "outgoing", "Odpowiedź agenta");
  stop();

  assert.deepEqual(zebrane.map((z) => [z.odKlienta, z.automatyczna]), [
    [true, false],   // pytanie klienta — TO zapala pasek
    [false, true],   // odbicie — ani nasze „prawdziwe", ani klienta
    [false, false],  // nasza odpowiedź
  ]);
});

/* ── ZDARZENIA SPRAWY NIOSĄ KLUCZE, NIE TYLKO ZDANIE (0.243.0) ───────────────
   Pasek zdarzeń w panelu pokazuje krótką etykietę po polsku, a słownik
   polszczyzny stoi po tamtej stronie. Bez tych pól panel musiałby rozbierać
   `tresc` z powrotem na części — czyli traktować zdanie dla człowieka jak
   format danych. `tresc` ZOSTAJE nietknięta, bo niesie ją podpowiedź. */
test("oś podaje zdarzenia sprawy rozłożone na klucze, obok gotowego zdania", () => {
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,unread,updated_at) VALUES (?,'w-zdarz','kupujacy_9',0,'2026-09-01T10:00:00.000Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-zdarz-1','incoming','Pytanie','2026-09-01T09:00:00.000Z')`).run(r, konto);

  const zdarz = d.prepare(`INSERT INTO conversation_event(conversation_id,event_type,payload,created_at)
    VALUES (?,?,?,?)`);
  zdarz.run(r, "status_changed",
    JSON.stringify({ przed: "new", po: "open", autor: "klient" }), "2026-09-01T09:10:00.000Z");
  zdarz.run(r, "dobor_status_changed",
    JSON.stringify({ przed: "searching", po: "confirmed", autor: "Biuro" }), "2026-09-01T09:20:00.000Z");
  zdarz.run(r, "dobor_wybrano",
    JSON.stringify({ symbol: "W09-0513", droga: "wyszukiwarka", autor: "Biuro" }), "2026-09-01T09:30:00.000Z");
  zdarz.run(r, "sprawa_dolaczona",
    JSON.stringify({ tytul: "Linka T375", autor: "Biuro" }), "2026-09-01T09:40:00.000Z");

  const wpisy = osRozmowy(r).os;
  const zdarzenie = (rodzaj: string) => wpisy.find((w) => w.rodzaj === rodzaj)?.zdarzenie;

  assert.deepEqual(zdarzenie("status"), { rodzaj: "status", po: "open" });
  /* Dwa różne zdarzenia doboru dają DWA różne kształty — panel rysuje z nich
     co innego, więc zlanie ich w jeden kształt kazałoby mu zgadywać. */
  const dobory = wpisy.filter((w) => w.rodzaj === "dobor").map((w) => w.zdarzenie);
  assert.deepEqual(dobory, [
    { rodzaj: "dobor", po: "confirmed" },
    { rodzaj: "dobor_wybor", wybrano: true, symbol: "W09-0513" },
  ]);
  assert.deepEqual(zdarzenie("sprawa"),
    { rodzaj: "sprawa", dolaczona: true, tytul: "Linka T375" });

  /* Zdanie dla człowieka zostaje nietknięte — to ono stoi w podpowiedzi. */
  assert.equal(wpisy.find((w) => w.rodzaj === "status")?.tresc, "new → open");

  d.prepare("DELETE FROM conversation WHERE id=?").run(r);
});
