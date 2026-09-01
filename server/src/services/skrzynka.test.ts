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
     otwartą, ale nie milczeć o tym, że nikt jej po terminie nie tknął. */
  const { ustawStatus } = await import("./conversations.js");
  const d = db();
  ustawStatus(d, rozmowaId, "snoozed", BIURO.id, "2026-08-31T06:00:00.000Z");

  const wiersz = listaRozmow().find((r) => r.id === rozmowaId)!;
  assert.equal(wiersz.status, "open", "termin minął, więc rozmowa jest znów otwarta");
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
