import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* WARTOŚCIOWYCH IMPORTÓW SERWISU NIE MA TU CELOWO. Statyczny import biegnie
   PRZED ciałem modułu, więc `skrzynka.js` i `zdjecia.sgt.js` ładowały `config`
   i `db` zanim ta linia ustawiła `DB_PATH` — i cały plik pracował na PRAWDZIWEJ bazie biura
   (`server/data/wertis.db`), kasując jej zawartość w `beforeEach`. Póki tamta
   baza była pusta, testy przechodziły i nikt tego nie widział. Serwisy
   dociągamy dynamicznie w `before()`, jak w pozostałych plikach tras. */
process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wertis-reklamacje-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasy reklamacji pilnują tu czterech rzeczy, z których żadna nie mieszka
   w serwisie:

   1. BRAMKA ROLI TAKŻE NA ODCZYCIE. Reklamacja niesie login kupującego, treść
      jego zgłoszenia i numer zamówienia — dane biura, nie hali. Trasa odczytu
      bez bramki wygląda niewinnie i przecieka po cichu.
   2. ZERO ZAPISU PRZY PATRZENIU (blizna 0.18.0). Otwarcie kolejki i otwarcie
      sprawy nie mają prawa dołożyć ani jednego wiersza.
   3. LICZNIK ZAPISÓW JEST UMOWĄ. Przyrost pierwszy miał DWA zapisy, oba
      wyłącznie u nas: „prowadzę" i notatka. Drugi dołożył odpowiedź w czacie,
      trzeci — werdykt i decyzję o towarze, jedyne dwa za `autoryzuj()`.
   5. STRAŻNIK ADRESÓW. Każdy adres z `panel/src/api/reklamacje.ts` ma trasę —
      ta sama blizna, którą skrzynka kupiła w 0.181.0.
   4. 401 PRZED 403. Brak sesji to inna naprawa niż zła rola.               */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let typPodgladu: typeof import("../services/skrzynka.js").typPodgladu;
let rozpoznajMime: typeof import("../adapters/zdjecia.sgt.js").rozpoznajMime;
let reklamacja = 0;
let zalacznik = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ typPodgladu } = await import("../services/skrzynka.js"));
  ({ rozpoznajMime } = await import("../adapters/zdjecia.sgt.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["reklamacja_zalacznik", "reklamacja_wiadomosc", "reklamacja_klienta",
    "allegro_reklamacja", "allegro_reklamacje_sync_state", "message", "conversation",
    "channel_account", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  reklamacja = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
    reference_number,order_id,kupujacy_login,prawo,powod_typ,status_allegro,decyzja_do,
    ostatnia_wiadomosc_status,wiadomosci_ile,otwarto_at,synced_at)
    VALUES (?,'i-1','123/2026','ord-1','kupujacy1','COMPLAINT','DEFECT_FOUND_DURING_USE',
      'CLAIM_SUBMITTED','2126-09-20T10:00:00Z','BUYER_REPLIED',2,
      '2026-09-06T10:00:00Z','2026-09-07T10:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_login,autor_rola,
    tresc,utworzono_at) VALUES (?,'w-1','kupujacy1','BUYER','Kosiarka przestała ciąć',
    '2026-09-06T10:01:00Z')`).run(reklamacja);
  zalacznik = Number(d.prepare(
    "INSERT INTO reklamacja_zalacznik(reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,NULL,?,?)")
    .run(reklamacja, "paragon.pdf",
      "https://api.allegro.pl/sale/issues/attachments/a-2").lastInsertRowid);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token } };
}

const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/reklamacje" },
  { method: "GET" as const, url: `/api/obsluga/reklamacje/${reklamacja}` },
  { method: "GET" as const, url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}` },
  { method: "GET" as const, url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}/podglad` },
  { method: "POST" as const, url: "/api/obsluga/reklamacje/synchronizuj" },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/odswiez` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/prowadze` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/notatka` },
  { method: "GET" as const, url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki-wysylki` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki-wysylki` },
  { method: "DELETE" as const, url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki-wysylki/1` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/odpowiedz` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/werdykt` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/zwrot-towaru` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/notatka/cofnij` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/tagi/1` },
  { method: "DELETE" as const, url: `/api/obsluga/reklamacje/${reklamacja}/tagi/1` },
];

test("bez sesji żadna trasa reklamacji nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi reklamacji — bramka roli stoi też na odczycie", async () => {
  const { naglowki } = login("magazynier", "Magazynier Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: naglowki });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
    assert.match(r.json().error, /biuro/, "odmowa mówi, kto to prowadzi");
  }
});

test("DZIESIĘĆ ZAPISÓW po dołożeniu cofnięcia notatki — licznik jest umową", () => {
  /* Ta liczba jest kontraktem, nie obserwacją. Rosła z dwóch na trzy razem
     z odpowiedzią w czacie (0.224.0) i z trzech na pięć z werdyktem: czwarty
     zapis to werdykt (uznanie albo odrzucenie do Allegro), piąty — decyzja
     o towarze po uznaniu. Oba są nieodwracalne wobec kupującego i jako
     jedyne w module stoją za `autoryzuj()` z wpisem `privileged`. Każdy nowy
     zapis dostaje zdanie w uzasadnieniu.

     Szósty i siódmy doszły z załącznikami wychodzącymi (0.274.0): dodanie
     WGRYWA plik do Allegro od razu, więc jest zapisem wychodzącym mimo braku
     wiadomości; zdjęcie kasuje wyłącznie NASZ wiersz, bo deklaracji po tamtej
     stronie cofnąć się nie da. Uprzywilejowane nie są: plik bez wiadomości
     nie dociera do kupującego.

     Ósmy i dziewiąty doszły z tagami (0.279.0) i są zapisami WYŁĄCZNIE
     u nas: tag jest zdaniem biura o sprawie i do Allegro nie idzie żadnym
     polem. Uprzywilejowane nie są i mieć tego nie mogą — przypięcie
     i zdjęcie to jedno kliknięcie w każdą stronę, czyli własna droga
     powrotna.

     Dziesiąty to COFNIĘCIE zmiany notatki (0.280.0). Jest zapisem u nas
     i jedynym w tym module z drogą powrotną — notatka jako jedyna zostaje
     wyłącznie u nas i niczego nie obiecuje kupującemu. Werdykt, odpowiedź
     i stanowisko o towarze cofnięcia NIE DOSTANĄ: Allegro ich nie cofnie,
     więc przycisk byłby obietnicą bez pokrycia (§25b.8).

     `synchronizuj` i `odswiez` NIE SĄ zapisami do Allegro: to odczyty na
     żądanie, które zapisują wynik u nas. `POST`-em idą dlatego, że `GET`
     z takim skutkiem ubocznym łamałby „zero zapisu przy patrzeniu" ciszej,
     niż gdyby łamał ją jawnie — przeglądarka powtarza i wstępnie pobiera
     `GET`-y bez pytania. */
  const DOCIAGNIECIA = ["synchronizuj", "odswiez"];
  const zapisy = TRASY().filter((t) => (t.method === "POST" || t.method === "DELETE")
    && !DOCIAGNIECIA.some((d) => t.url.endsWith(d)));
  assert.equal(zapisy.length, 10,
    "prowadzę, notatka z cofnięciem i dwa tagi u nas; odpowiedź, werdykt, towar i dwa załączniki dalej");
});

test("werdykt: wersja obowiązkowa, wpis `privileged` z nazwą operacji, dziennik bez treści", async () => {
  const { naglowki } = login("biuro", "Ala werdykt");
  const bez = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/werdykt`,
    headers: naglowki, payload: { werdykt: "REJECTED_OTHER", wiadomosc: "Nie." } });
  assert.equal(bez.statusCode, 400, "werdykt bez wersji z ekranu to werdykt w ciemno");
  assert.match(bez.json().error, /wersji/);
  /* Złe ciało NIE zostawia wpisu `privileged`: ten ma znaczyć decyzję człowieka. */

  /* Testy chodzą bez sparowanego konta, więc strzał kończy się porażką
     nazwaną kodem u nas — a nie wyjątkiem 500. Wpis `privileged` musi stać
     NIEZALEŻNIE od losu strzału: to ślad decyzji człowieka, nie sieci. */
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/werdykt`,
    headers: naglowki, payload: { werdykt: "REJECTED_OTHER", wiadomosc: "Towar sprawny.", wersja: 1 } });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.werdykt, "REJECTED_OTHER");
  assert.equal(body.werdyktNazwa, "Odrzucona — inny powód");
  assert.ok(["send_failed", "send_uncertain"].includes(body.status), body.status);
  assert.equal(body.wersja, 2);
  const zdarzenia = (type: string) => (db().prepare(
    "SELECT user_id, payload FROM events WHERE type=? ORDER BY id").all(type) as
    Array<{ user_id: string; payload: string }>).map((z) => ({ user: z.user_id, ...JSON.parse(z.payload) }));
  assert.deepEqual(zdarzenia("privileged").filter((z) => z.user === "Ala werdykt"),
    [{ user: "Ala werdykt", operacja: "reklamacja_werdykt" }]);
  assert.equal(zdarzenia("reklamacja_werdykt_proba").length, 1);
  const dziennik = (db().prepare("SELECT payload FROM events").all() as Array<{ payload: string | null }>)
    .map((e) => e.payload ?? "").join(" ");
  assert.equal(dziennik.includes("sprawny"), false, "treść do kupującego nie idzie do dziennika");

  /* Konflikt wersji wraca jako 409 z ładunkiem, jak przy notatce. */
  const konflikt = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/werdykt`,
    headers: naglowki, payload: { werdykt: "REJECTED_OTHER", wiadomosc: "Nie.", wersja: 1 } });
  assert.equal(konflikt.statusCode, 409);
  assert.equal(konflikt.json().wersja, 2);

  /* Towar przed uznaniem — 409 ze stanem, żadnego 500. */
  const towar = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/zwrot-towaru`,
    headers: naglowki, payload: { decyzja: "wymagany", tresc: "Odeślij.", expectedWersja: 2, expectedLastMessageId: null } });
  assert.equal(towar.statusCode, 409);
  assert.match(towar.json().error, /po uznaniu/);
});

/* ── Strażnik adresów (wzór `skrzynka.test.ts`) ──────────────────────────────
   Do tego wydania `panel/src/api/reklamacje.ts` nie miał strażnika, a to jest
   plik, do którego dochodzą dwa nowe adresy. Czyta źródło hooków i puszcza
   PRAWDZIWE żądanie przez router; brak trasy poznaje po domyślnym 404 Fastify. */
test("każdy adres wołany z panel/src/api/reklamacje.ts ma trasę na serwerze", async () => {
  const zrodlo = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src/api/reklamacje.ts"), "utf8");
  /* Adresy stoją w tym pliku w obu cudzysłowach: `"…"` bez parametru i `\`…\`` z `${id}`. */
  const wywolania = [...zrodlo.matchAll(/api(?:<[^>]*>)?\(\s*[`"]([^`"]+)[`"](?:\s*,\s*\{[^}]*?method:\s*"(GET|POST|PUT|DELETE)")?/gs)];
  assert.ok(wywolania.length >= 8, `spodziewałem się co najmniej ośmiu wywołań api(), jest ${wywolania.length}`);
  const { naglowki } = login("biuro", "Strażnik adresów");
  const bledne: string[] = [];
  for (const [, adres, metoda] of wywolania) {
    const url = adres.replace(/\$\{[^}]+\}/g, "1").replace(/\?.*$/, "");
    const method = (metoda ?? "GET") as "GET" | "POST" | "PUT" | "DELETE";
    const r = await app.inject({ method, url, headers: naglowki,
      ...(method === "GET" ? {} : { payload: {} }) });
    const tresc = r.json<{ message?: string }>();
    if (r.statusCode === 404 && /^Route /.test(tresc.message ?? "")) bledne.push(`${method} ${adres}`);
  }
  assert.deepEqual(bledne, [], "panel woła adresy bez trasy na serwerze");
});

test("biuro dostaje kolejkę z kubełkiem, terminem, sygnałami i licznikami", async () => {
  const { naglowki } = login("biuro", "Ala z biura");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/reklamacje", headers: naglowki });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.reklamacje.length, 1);
  const k = body.reklamacje[0];
  assert.equal(k.externalId, "i-1");
  assert.equal(k.numer, "123/2026");
  assert.equal(k.kubelek, "decyzja", "sprawa przed werdyktem czeka na decyzję");
  assert.equal(typeof k.dniDoTerminu, "number");
  assert.deepEqual(k.sygnaly, ["klient_czeka"], "termin daleki, więc milczy");
  assert.equal(body.liczniki.decyzja, 1);
  assert.ok(body.stan.status, "stan synchronizacji jedzie razem z kolejką");
});

test("szczegół niesie czat i załączniki sprawy", async () => {
  const { naglowki } = login("biuro", "Ala druga");
  const r = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${reklamacja}`, headers: naglowki });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.czat.length, 1);
  assert.equal(body.czat[0].tresc, "Kosiarka przestała ciąć");
  assert.deepEqual(body.zalaczniki.map((z: { nazwa: string }) => z.nazwa), ["paragon.pdf"]);
});

test("reklamacja spoza bazy to 404, nie pusty obiekt", async () => {
  const { naglowki } = login("biuro", "Ala trzecia");
  const r = await app.inject({
    method: "GET", url: "/api/obsluga/reklamacje/99999", headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("otwarcie kolejki i otwarcie sprawy nie zapisują NICZEGO", async () => {
  /* Umowa z 0.18.0. Liczymy wiersze we WSZYSTKICH tabelach, których ten ekran
     dotyka — nie tylko w dzienniku, bo zapis potrafi wylądować obok. */
  const { naglowki } = login("biuro", "Ala czwarta");
  const licz = () => {
    const d = db();
    return ["events", "reklamacja_klienta", "reklamacja_wiadomosc", "reklamacja_zalacznik",
      "allegro_reklamacja", "allegro_reklamacje_sync_state"]
      .map((t) => (d.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n)
      .join("/");
  };
  const przed = licz();
  await app.inject({ method: "GET", url: "/api/obsluga/reklamacje", headers: naglowki });
  await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${reklamacja}`, headers: naglowki });
  assert.equal(licz(), przed, "patrzenie na reklamacje nie ma prawa niczego zapisać");
});

test("„prowadzę” zapisuje znacznik, a konflikt wersji wraca jako 409 z ładunkiem", async () => {
  const { naglowki } = login("biuro", "Ala piąta");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/prowadze`,
    headers: naglowki, payload: { wersja: 1 } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().reklamacja.prowadzi, "Ala piąta");

  /* Ta sama wersja drugi raz: ekran kolegi ma dowiedzieć się, kto był szybszy,
     a nie po cichu nadpisać jego pracę. */
  const konflikt = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/notatka`,
    headers: naglowki, payload: { notatka: "moje ustalenia", wersja: 1 } });
  assert.equal(konflikt.statusCode, 409);
  assert.equal(konflikt.json().prowadzi, "Ala piąta");
});

test("notatka innego typu niż tekst to 400 ze zdaniem, nie 500", async () => {
  const { naglowki } = login("biuro", "Ala szósta");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/notatka`,
    headers: naglowki, payload: { notatka: 42 } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /tekstem/);
});

test("załącznik cudzej sprawy nie wychodzi tą trasą", async () => {
  /* Bez tego znajomość samego identyfikatora załącznika wystarczałaby za
     uprawnienie do cudzej reklamacji. */
  const { naglowki } = login("biuro", "Ala siódma");
  const obca = Number(db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,
    external_id,otwarto_at,synced_at)
    SELECT channel_account_id,'i-2','2026-09-06T10:00:00Z','2026-09-07T10:00:00Z'
      FROM reklamacja_klienta WHERE id=?`).run(reklamacja).lastInsertRowid);
  const r = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${obca}/zalaczniki/${zalacznik}`,
    headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("synchronizacja bez sparowanego konta mówi zdaniem, a nie kodem", async () => {
  /* Testy chodzą bez `ALLEGRO_CLIENT_ID`, więc to jest ścieżka, którą zobaczy
     każdy, kto włączy panel przed sparowaniem konta. */
  const { naglowki } = login("biuro", "Ala ósma");
  const r = await app.inject({
    method: "POST", url: "/api/obsluga/reklamacje/synchronizuj", headers: naglowki });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /sparowane/);
});

test("odświeżenie sprawy bez sparowanego konta też mówi zdaniem", async () => {
  /* Ta sama ścieżka co przy synchronizacji i ten sam powód: 502 z gołym kodem
     kazałby szukać awarii tam, gdzie jej nie ma. */
  const { naglowki } = login("biuro", "Ala dziewiąta");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/odswiez`, headers: naglowki });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /sparowane/);
});

test("odświeżenie NIE jest operacją uprzywilejowaną — to dociągnięcie cudzego stanu", async () => {
  /* Werdykt i decyzja o towarze stoją za `autoryzuj()`, bo są nieodwracalne
     wobec kupującego. Odświeżenie nie zmienia u kupującego niczego, więc
     bramka roli biura wystarcza — inaczej zwykła praca wymagałaby admina. */
  const { naglowki } = login("biuro", "Ala dziesiąta");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/odswiez`, headers: naglowki });
  assert.notEqual(r.statusCode, 403, "biuro ma prawo odświeżyć sprawę");
});

test("podgląd rozstrzygają BAJTY, nie pole, którego Allegro nie przysyła", () => {
  /* `PostPurchaseIssueAttachment` ma dwa pola — `fileName` i `url` — więc
     bramki `SAFE` ze skrzynki nie da się tu powtórzyć. Powtarzamy jej SKUTEK:
     na oś idą wyłącznie typy, które przeglądarka narysuje, a rozpoznaje je
     sygnatura pliku.

     Przechodzą TRZY, bo tyle jest we wspólnej części tego, co Allegro przy
     tym zasobie przyjmuje (png, gif, bmp, tiff, jpeg, pdf) i co rysuje
     przeglądarka (`TYPY_PODGLADU`). */
  const sygnatura = (b: number[]) => typPodgladu(rozpoznajMime(Buffer.from(b)));
  assert.equal(sygnatura([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg");
  assert.equal(sygnatura([0x89, 0x50, 0x4e, 0x47]), "image/png");
  assert.equal(sygnatura([0x47, 0x49, 0x46, 0x38]), "image/gif");

  /* BMP i TIFF Allegro przyjmuje, a przeglądarki rysują je nierówno albo
     wcale — zostają przy pobieraniu i to jest odpowiedź, nie awaria. */
  assert.equal(sygnatura([0x42, 0x4d, 0x00, 0x00]), null, "BMP nie idzie na oś");
  assert.equal(sygnatura([0x49, 0x49, 0x2a, 0x00]), null, "TIFF nie idzie na oś");
  /* PDF to najczęstszy załącznik niebędący zdjęciem — paragon albo faktura. */
  assert.equal(sygnatura([0x25, 0x50, 0x44, 0x46]), null, "PDF nie idzie na oś");
  /* Plik nazwany `usterka.jpg`, który obrazem nie jest, dostaje 415: nazwa
     decyduje o UKŁADZIE, bajty o wydaniu. */
  assert.equal(sygnatura([0x3c, 0x73, 0x76, 0x67]), null, "SVG też nie — to dokument ze skryptem");
});

test("podgląd cudzej sprawy nie wychodzi tą trasą", async () => {
  const { naglowki } = login("biuro", "Ala dziewiąta");
  const obca = Number(db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,
    external_id,otwarto_at,synced_at)
    SELECT channel_account_id,'i-3','2026-09-06T10:00:00Z','2026-09-07T10:00:00Z'
      FROM reklamacja_klienta WHERE id=?`).run(reklamacja).lastInsertRowid);
  const r = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${obca}/zalaczniki/${zalacznik}/podglad`,
    headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("ETag odpowiada 304 PRZED pójściem do Allegro", async () => {
  /* Bez tego oś ciągnęłaby te same megabajty przy każdym przerysowaniu.
     Że 304 wraca bez sieci, widać po tym, że test przechodzi bez konta
     Allegro — gdyby trasa pytała Allegro, poleciałby błąd. */
  const { naglowki } = login("biuro", "Ala dziesiąta");
  const r = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}/podglad`,
    headers: { ...naglowki, "if-none-match": `"rekl-zal-${zalacznik}"` } });
  assert.equal(r.statusCode, 304);
});

test("trasa odpowiedzi PRZEKAZUJE każdą flagę z ciała", async () => {
  /* To jest blizna znaleziona w skrzynce przy rozpoznaniu do tego wydania:
     `mimoObecnosci` ginie tam dokładnie w tym miejscu — serwis go obsługuje,
     panel go wysyła, a trasa ani nie deklaruje pola, ani nie podaje go niżej.
     Jawna zgoda agenta nie ma wtedy jak zadziałać, a strażnik tras pilnuje
     ADRESÓW, nie pól ciała, więc przechodzi niezauważone.

     Dowód idzie przez ZACHOWANIE: bez `mimoNowejWiadomosci` dopisek daje 409,
     z flagą — przechodzi dalej. Gdyby trasa flagę gubiła, drugie żądanie
     dostałoby to samo 409. */
  const { naglowki } = login("biuro", "Ala jedenasta");
  const d = db();
  d.prepare(`INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_rola,tresc)
    VALUES (?,'w-2','ADMIN','Doradca dopisał')`).run(reklamacja);

  const wersja = Number((d.prepare("SELECT wersja FROM reklamacja_klienta WHERE id=?")
    .get(reklamacja) as { wersja: number }).wersja);
  const cialo = (extra: Record<string, unknown>) => ({
    tresc: "Odpowiadam na starszą wersję.", expectedWersja: wersja,
    expectedLastMessageId: 1, ...extra,
  });

  const bez = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/odpowiedz`,
    headers: naglowki, payload: cialo({}) });
  assert.equal(bez.statusCode, 409);
  assert.match(bez.json().error, /dopisał/);
  /* Ładunek jedzie PŁASKO obok `error` — dzięki temu `DialogKonfliktu`
     z panelu czyta go bez zmian. */
  assert.ok(bez.json().nowaWiadomosc, "409 niesie treść dopisku");
  assert.match(String(bez.json().kluczIdempotencji), /^rkl-/);

  /* Z flagą trasa idzie dalej i dopiero brak konta Allegro ją zatrzymuje —
     czyli konflikt świeżości został przepuszczony. */
  const zFlaga = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/odpowiedz`,
    headers: naglowki, payload: cialo({ mimoNowejWiadomosci: true }) });
  assert.notEqual(zFlaga.statusCode, 409,
    "flaga z ciała musi dojechać do serwisu — inaczej jawna zgoda nie działa");
});

test("odpowiedź bez treści to 400 ze zdaniem, nie 500", async () => {
  const { naglowki } = login("biuro", "Ala dwunasta");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/odpowiedz`,
    headers: naglowki, payload: { tresc: "   ", expectedWersja: 1 } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /Pusta odpowiedź/);
});

test("zamknięta rozmowa oddaje 409 ze zdaniem, a nie kodem Allegro", async () => {
  const { naglowki } = login("biuro", "Ala trzynasta");
  db().prepare("UPDATE reklamacja_klienta SET czat_aktywny=0 WHERE id=?").run(reklamacja);
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/odpowiedz`,
    headers: naglowki, payload: { tresc: "Cokolwiek", expectedWersja: 1,
      expectedLastMessageId: 1 } });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /nie przyjmie/);
  assert.equal(r.json().czatAktywny, false);
});

/* ── Załącznik od Allegro: parytet ze skrzynką (wydanie „wspólny załącznik") ──
   Do tego wydania każda awaria przy załączniku reklamacji wracała jako 400
   z JSON-em, a panel nie odróżniał „Allegro nie oddało" od 415 „to nie obraz"
   i milczał. Skrzynka dostała 502/503 w 0.244.0; wspólna powłoka w panelu
   zakłada, że obie trasy mówią tym samym językiem kodów.

   Pomocnicy skopiowani ze `skrzynka.test.ts` — dwadzieścia linii jest tańsze
   niż wspólny moduł testowy, którego serwer nie ma.                          */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function tokenAllegro(jest: boolean) {
  db().prepare("DELETE FROM allegro_token").run();
  if (jest) {
    db().prepare(`INSERT INTO allegro_token(id,access_token,refresh_token,wygasa_at,srodowisko,
      polaczono_at,polaczono_przez) VALUES (1,'tok','ref',?, 'prod','2026-09-01T00:00:00Z','test')`)
      .run(new Date(Date.now() + 86_400_000).toISOString());
  }
}

/** Podstawiony `fetch` do Allegro: liczy strzały, oddaje bajty albo kod. */
function allegroOddaje(odp: { status: number; bajty?: Buffer } | Error) {
  const s = { strzalow: 0 };
  mock.method(globalThis, "fetch", async () => {
    s.strzalow += 1;
    if (odp instanceof Error) throw odp;
    return new Response(odp.status === 200 ? new Uint8Array(odp.bajty ?? PNG) : JSON.stringify({ error: "nie" }),
      { status: odp.status, headers: { "content-type": odp.status === 200 ? "application/octet-stream" : "application/json" } });
  });
  return s;
}

afterEach(() => { mock.restoreAll(); tokenAllegro(false); });

/** Ile śladów pobrania zostawiła trasa w dzienniku. */
const sladowPobrania = () => Number((db().prepare(
  "SELECT COUNT(*) AS n FROM events WHERE type='reklamacja_zalacznik_pobrany'").get() as { n: number }).n);

test("podgląd przez trasę: 200 z typem z SYGNATURY i długością, 415 gdy bajty kłamią", async () => {
  const { naglowki } = login("biuro", "Ala trzynasta");
  tokenAllegro(true);
  const podglad = `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}/podglad`;

  const png = allegroOddaje({ status: 200, bajty: PNG });
  const r = await app.inject({ method: "GET", url: podglad, headers: naglowki });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-type"], "image/png");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["content-disposition"], "inline");
  assert.equal(r.headers["etag"], `"rekl-zal-${zalacznik}"`);
  assert.equal(r.headers["content-length"], String(PNG.length));
  assert.equal(png.strzalow, 1);
  /* Podgląd nie zostawia śladu — to nie jest czynność agenta. */
  assert.equal(sladowPobrania(), 0);

  /* Nazwa `paragon.pdf` obiecuje mało, ale i tak rozstrzygają bajty: plik
     wykonywalny udający obraz dostaje 415 ze wskazaniem na sygnaturę. */
  mock.restoreAll();
  allegroOddaje({ status: 200, bajty: Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]) });
  const exe = await app.inject({ method: "GET", url: podglad, headers: naglowki });
  assert.equal(exe.statusCode, 415);
  assert.match(exe.json().error, /sygnatura pliku/);
});

test("odmowa Allegro wraca jako 502 ze zdaniem, awaria sieci i brak konta jako 503", async () => {
  const { naglowki } = login("biuro", "Ala czternasta");
  const podglad = `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}/podglad`;
  const pobranie = `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}`;

  tokenAllegro(true);
  const odmowa = allegroOddaje({ status: 403 });
  const r = await app.inject({ method: "GET", url: podglad, headers: naglowki });
  assert.equal(r.statusCode, 502, "odmowa Allegro to 502, nie 400");
  assert.match(r.json().error, /Allegro nie oddało załącznika \(403\)/);
  assert.doesNotMatch(r.json().error, /https?:\/\//, "adres nie wychodzi na ekran");
  assert.equal(odmowa.strzalow, 1);
  /* Pobranie na dysk mówi tym samym kodem — panel pokazuje zdanie pod nazwą. */
  const p = await app.inject({ method: "GET", url: pobranie, headers: naglowki });
  assert.equal(p.statusCode, 502);
  assert.equal(sladowPobrania(), 0, "nieudane pobranie nie zostawia śladu");

  mock.restoreAll();
  allegroOddaje(new Error("fetch failed: timeout"));
  const siec = await app.inject({ method: "GET", url: podglad, headers: naglowki });
  assert.equal(siec.statusCode, 503);
  assert.match(siec.json().error, /internet na serwerze/);

  mock.restoreAll();
  tokenAllegro(false);
  const bezKonta = await app.inject({ method: "GET", url: podglad, headers: naglowki });
  assert.equal(bezKonta.statusCode, 503);
  assert.match(bezKonta.json().error, /niepołączone/i);

  /* 404 zostaje przy `blad()`: brak wiersza to nie wina Allegro. */
  const brak = await app.inject({ method: "GET", url: `${pobranie}9999/podglad`, headers: naglowki });
  assert.equal(brak.statusCode, 404);
});
