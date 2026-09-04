import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zwroty-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasy zwrotów pilnują tu trzech rzeczy, z których żadna nie mieszka
   w serwisie:

   1. BRAMKA ROLI TAKŻE NA ODCZYCIE. Zwrot niesie numer zamówienia i sprawę
      klienta — dane biura, nie hali. Trasa odczytu bez bramki wygląda
      niewinnie i przecieka po cichu.
   2. ZERO ZAPISU PRZY PATRZENIU. Reguła z 0.18.0 obowiązuje też panel
      obsługi, choć licznik `method:` w `biuro.test.ts` obejmuje wyłącznie
      `biuro.html`. Licznik tras zapisu niżej jest UMOWĄ: każdy nowy zapis
      podnosi liczbę i dostaje zdanie w uzasadnieniu.
   3. 401 PRZED 403. Brak sesji to inna naprawa niż zła rola.              */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let zwrot = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zwrot_zdarzenie", "zwrot_klienta_pozycja", "zwrot_klienta", "allegro_zwrot",
    "zamowienie_klienta_pozycja", "zamowienie_klienta", "allegro_zamowienie",
    "oferta_kartoteka", "sgt_faktura_pozycja", "sgt_faktura", "sgt_towar",
    "channel_account", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,
    reference_number,order_id,created_at,paczka_at,synced_at)
    VALUES (?,'zw-1','REF-1','ord-1','2026-08-25T09:00:00Z','2026-08-28T09:00:00Z','2026-09-01T09:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,powod,klucz)
    VALUES (?,'111','Sekator NAC',1,4999,'PLN','DONT_LIKE_IT','111|Sekator NAC')`).run(zwrot);
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
  { method: "GET" as const, url: "/api/obsluga/zwroty" },
  { method: "GET" as const, url: `/api/obsluga/zwroty/${zwrot}` },
  { method: "GET" as const, url: "/api/obsluga/zwroty/csv" },
  { method: "POST" as const, url: "/api/obsluga/zwroty/zamowienia" },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/werdykt` },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/kwota` },
  { method: "POST" as const, url: "/api/obsluga/zwroty/pozycje/1/ocena" },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/korekta` },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/korekta/cofnij` },
  { method: "POST" as const, url: "/api/obsluga/zwroty/pozycje/1/rabat" },
  { method: "POST" as const, url: "/api/obsluga/zwroty/skan" },
  { method: "POST" as const, url: "/api/obsluga/zwroty/skan/dociagnij" },
  /* Zapisy do Allegro (0.190.0). Wchodzą do tej listy jak każda inna trasa:
     bramka roli stoi przed uprawnieniem, więc hala nie zobaczy nawet powodu
     odmowy uprzywilejowanej. */
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/pieniadze` },
  { method: "POST" as const, url: `/api/obsluga/zwroty/${zwrot}/odmowa-platnosci` },
];

test("bez sesji żadna trasa zwrotów nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi zwrotów — bramka roli stoi też na odczycie", async () => {
  const { naglowki } = login("magazynier", "Magazynier Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: naglowki });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
    assert.match(r.json().error, /biuro/, "odmowa mówi, kto to prowadzi");
  }
});

test("biuro dostaje kolejkę z kubełkiem, terminem i licznikami", async () => {
  const { naglowki } = login("biuro", "Ala z biura");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty", headers: naglowki });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.zwroty.length, 1);
  const z = body.zwroty[0];
  assert.equal(z.externalId, "zw-1");
  assert.equal(z.kubelek, "decyzja", "zwrot bez werdyktu czeka na decyzję");
  assert.equal(z.sumaPozycjiGrosze, 4999);
  assert.equal(typeof z.dniDoTerminu, "number");
  assert.equal(body.liczniki.decyzja, 1);
  assert.ok(body.stan.status, "stan synchronizacji jedzie razem z kolejką");
});

test("zwrot spoza bazy to 404, nie pusty obiekt", async () => {
  const { naglowki } = login("biuro", "Ala druga");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty/99999", headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("otwarcie kolejki nie zapisuje NICZEGO", async () => {
  /* Umowa z 0.18.0. Liczymy wiersze we WSZYSTKICH tabelach, których ten
     ekran dotyka — nie tylko w dzienniku, bo zapis potrafi wylądować obok. */
  const { naglowki } = login("biuro", "Ala trzecia");
  const licz = () => {
    const d = db();
    return ["events", "zwrot_klienta", "zwrot_klienta_pozycja", "zwrot_zdarzenie",
      "allegro_zwrot", "allegro_zwroty_sync_state"]
      .map((t) => (d.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n)
      .join("/");
  };
  const przed = licz();
  /* Eksport CSV jest tu JAWNIE wyłączony i to jedyny wyjątek. Umowa mówi
     o patrzeniu, a wyniesienie pliku z loginami kupujących na dysk nie jest
     patrzeniem — dlatego zostawia ślad (test niżej tego pilnuje). */
  for (const t of TRASY().filter((t) => t.method === "GET" && !t.url.endsWith("/csv"))) {
    await app.inject({ method: t.method, url: t.url, headers: naglowki });
    await app.inject({ method: t.method, url: t.url, headers: naglowki });
  }
  assert.equal(licz(), przed, "patrzenie na zwroty niczego nie mutuje");
});

test("eksport do Excela zostawia ślad, bo wynosi loginy kupujących", async () => {
  /* Ta sama zasada co przy `analiza_eksport` i `audyt_eksport`: kto pobiera
     zestawienie o ludziach, sam trafia do dziennika. */
  const { naglowki } = login("biuro", "Ala z eksportu");
  const d = db();
  const zdarzen = () => (d.prepare(
    "SELECT count(*) n FROM events WHERE type='zwroty_eksport'").get() as { n: number }).n;
  const przed = zdarzen();

  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty/csv", headers: naglowki });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"] as string, /text\/csv/);
  assert.match(r.headers["content-disposition"] as string, /wertis-zwroty\.csv/);
  assert.equal(zdarzen(), przed + 1, "eksport dopisał zdarzenie");

  /* Separator `;`, bo Excel PL otwiera taki plik bez kreatora importu.
     Numeru listu przewozowego w pliku NIE MA — polityka danych zwrotów. */
  const tekst = r.body;
  assert.match(tekst, /Numer zwrotu;/);
  assert.match(tekst, /EAN;SKU;/);
  assert.equal(tekst.includes("List przewozowy"), false, "numeru listu nie wynosimy");
});

test("zwroty mają dziewiętnaście tras POST, a trzy z nich wychodzą do Allegro", async () => {
  /* Ta liczba jest UMOWĄ, jak licznik `method:` w `biuro.test.ts`.
     Do 0.151.0 stało tu zero, w 0.152.0 jeden, do 0.155.0 dwa, w 0.156.0 pięć,
     w 0.162.0 siedem (korekta i jej cofnięcie). Dziś jest dziewięć.

     Komentarz mówił jeszcze o pięciu i twierdził, że „korekta nie ma tu
     trasy" — nieprawda od 0.162.0. Asercja `>=` to przepuściła; teraz liczba
     jest dokładna, więc następny rozjazd wyjdzie od razu.

     ÓSMA i DZIEWIĄTA to skan etykiety zwrotnej (0.163.0), i tylko jedna z nich
     zapisuje. Samo szukanie zwrotu pod kodem jest POST-em wyłącznie po to,
     żeby numer listu przewozowego nie wylądował w logu żądań serwera.

     DZIESIĄTA to wniosek o rabat transakcyjny (0.164.0) i różni się od
     wszystkich poprzednich: jako jedyna WYCHODZI DO ALLEGRO. Reszta zapisuje
     wyłącznie u nas. Uzasadnienie: firma odzyskiwała prowizję klikając ręcznie
     przy każdym zwrocie w panelu Allegro, bo znikąd nie było widać, przy
     którym wniosek już jest. Końcówka Allegro nie ma idempotencji, więc
     strażnik przed dubletem stoi w serwisie, PRZED siecią.

     JEDENASTA to potrącenie za utratę wartości (0.170.0) — jedyna trasa
     zwrotów przyjmująca od panelu LICZBĘ o pieniądzach. Dlatego jako jedyna
     waliduje ją w widełkach `0…wartość pozycji` i wymaga powodu, a kwotę do
     oddania dalej składa serwer z zaznaczenia (§25a.3). Bez niej kwota była
     binarna per pozycja: cała cena albo nic, a towar wraca używany.

     DWUNASTA to rejestracja paczki NIEODEBRANEJ (0.172.0) — jedyna trasa
     zwrotów, która tworzy zwrot OD ZERA. Allegro takiego bytu nie zna:
     `CustomerReturn` powstaje z deklaracji klienta, a nieodebrana przesyłka
     wraca sama. Pieniądze i tak trzeba oddać.

     TRZYNASTA wskazuje DOKUMENT SPRZEDAŻY z Subiekta (0.174.0). Zapisuje
     wyłącznie wybór człowieka z listy kandydatów — sam automat wiąże taktem,
     bez trasy, bo „zero zapisu przy patrzeniu" nie zna wyjątków. Uzasadnienie:
     biuro szukało numeru paragonu ręcznie w Subiekcie, po dacie i nazwisku,
     bo nic innego nie miało. 
     CZTERNASTA i PIĘTNASTA obsługują produkt, którego klient NIE ZGŁOSIŁ
     (0.184.0). Formularz zwrotu wypełnia się na ekranie, a paczkę pakuje przy
     stole — i wtedy dokłada się to, co też nie pasowało. Regulamin Allegro tej
     zgodności nie wymaga: liczy się terminowe oświadczenie o odstąpieniu, nie
     zgodność przesyłki ze zgłoszeniem. Dopisanie bierze POZYCJĘ ZAMÓWIENIA,
     nigdy nazwy ani ceny; zdjęcie działa wyłącznie na pozycji biura.

     SZESNASTA I SIEDEMNASTA ODDAJĄ PIENIĄDZE I ODMAWIAJĄ ICH ODDANIA
     (0.190.0). To jedyne trasy tej aplikacji, które ruszają cudze pieniądze na
     zewnątrz — i dlatego jako jedyne w tym pliku stoją nie tylko za `odmowa()`,
     ale i za `autoryzuj(…, "zwrot_pieniedzy")`, czyli za wpisem `privileged`
     z nazwą operacji.

     Uzasadnienie: do 0.190.0 panel rozstrzygał zwrot, liczył kwotę i kazał
     operatorowi pójść oddać pieniądze do panelu Allegro — czyli kończył pracę
     dokładnie tam, gdzie §25 obiecuje nie zaglądać. Kryterium gotowości mówi
     „agent obsłuży typowe pytanie bez otwierania panelu Allegro"; przy zwrocie
     nie było to spełnione ani razu.

     KWOTY NIE MA W CIELE ŻĄDANIA i to jest ta sama decyzja, co przy
     `zapiszKwote` (0.156.0). Gdyby panel podawał liczbę, dałoby się oddać
     dowolną kwotę żądaniem z pominięciem ekranu; serwer bierze tę, którą sam
     policzył z zaznaczenia.

     Zwrot pieniędzy ma idempotencję po `commandId` — w odróżnieniu od rabatu,
     gdzie końcówka jej NIE MA. `commandId` powstaje raz na zwrot i wraca ten
     sam przy ponowieniu, bo sieć zerwana po wysłaniu żądania, a przed
     odpowiedzią, jest scenariuszem normalnym. Nowy identyfikator przy drugiej
     próbie oddałby pieniądze dwa razy.

     DZIEWIĘTNASTA COFA USTALONĄ KWOTĘ (0.202.0). Do tego wydania kwota była
     wyjęta z obietnicy §25a.5 („reszta ma cofnięcie"): nadpisać dawało się ją
     tylko w kubełku DO ZWROTU, a zapis natychmiast z niego wyprowadzał.
     Bramki stoją w serwisie, nie tutaj, bo zależą od stanu zwrotu: oddane
     pieniądze zatrzymują cofnięcie na dobre, a zapisana korekta każe cofnąć
     najpierw ją — cofa się o jeden szczebel.

          OSIEMNASTA DOMYKA KOSZYK ZWROTÓW (0.192.0) i kolejkuje dokument MM
     z magazynu głównego na regał zwrotów. Jedyna trasa zwrotów, po której
     powstaje dokument w Subiekcie — przez Sferę, tą samą drogą co korekta.

     DOKŁADANIA DO KOSZYKA TRASY NIE MA i to jest decyzja, nie brak: dokłada
     ocena „na stan", którą operator i tak naciska. Osobna trasa kazałaby
     powiedzieć dwa razy to samo, a licznik urósłby o dwa zamiast o jeden.

     Stoi za samym `odmowa()`, bez `autoryzuj()`: przesunięcie towaru między
     własnymi magazynami to praca, którą biuro wykonuje codziennie, i różni
     się od oddania pieniędzy na zewnątrz tym, że nic nie opuszcza firmy. */
  /* Liczymy w ŹRÓDLE tras zwrotów, nie w drzewie Fastify: `printRoutes`
     oddaje całą aplikację (siedemdziesiąt kilka POST-ów), więc licznik z niego
     mierzyłby cokolwiek, tylko nie tę umowę. Ten sam wzorzec co licznik
     `method:` po źródle `biuro.html`. */
  const zrodlo = fs.readFileSync(new URL("./zwroty.ts", import.meta.url), "utf8");
  const posty = zrodlo.match(/app\.post[<(]/g) ?? [];
  assert.equal(posty.length, 19, `tras POST jest ${posty.length}, a umowa mówi o dziewiętnastu`);

  for (const slowo of ["kartoteka", "werdykt", "ocena", "kwota", "zamowienia",
    "korekta", "cofnij", "skan", "dociagnij", "rabat", "potracenie", "nieodebrana",
    "faktura", "pozycje", "zdejmij", "pieniadze", "odmowa-platnosci"]) {
    assert.equal(zrodlo.includes(slowo), true, `brak trasy ${slowo}`);
  }
});

test("bilans kartotek jedzie razem z kolejką", async () => {
  /* Bez liczby nie da się powiedzieć, czy problem jest w kodzie, czy
     w danych Allegro — a przez trzy wydania nie dało się tego rozstrzygnąć. */
  const { naglowki } = login("biuro", "Ala liczy");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty", headers: naglowki });
  const b = r.json().kartoteki;
  assert.equal(b.wszystkie, 1);
  assert.equal(b.bez, 1);
  assert.equal(b.powody.zamowienie_niepobrane, 1, "powód jest nazwany, nie zbiorczy");
});

test("dokument sprzedaży wskazuje człowiek, a szczegół podaje kandydatów", async () => {
  /* Numer paragonu to ostatnia pozycja z listy biura zwrotów. Bez niego
     pracownik szukał sprzedaży w Subiekcie po dacie i nazwisku. */
  const d = db();
  d.prepare(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,nr_oryg,data_wyst)
    VALUES (500,'FS','FS 140/2026','REF-1','2026-08-20')`).run();
  const { naglowki } = login("biuro", "Ala wskazuje");

  const szczegol = await app.inject({
    method: "GET", url: `/api/obsluga/zwroty/${zwrot}`, headers: naglowki });
  const kandydaci = szczegol.json().kandydaciFaktury;
  assert.equal(kandydaci.length, 1);
  assert.equal(kandydaci[0].pewny, true, "numer zwrotu stoi na dokumencie");

  const r = await app.inject({
    method: "POST", url: `/api/obsluga/zwroty/${zwrot}/faktura`,
    headers: naglowki, payload: { dokId: 500 } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().faktura.numer, "FS 140/2026");
  assert.equal(r.json().faktura.zrodlo, "reczne");

  /* Zdjęcie powiązania to droga wyjścia z pomyłki, a nie brak funkcji. */
  const cofniete = await app.inject({
    method: "POST", url: `/api/obsluga/zwroty/${zwrot}/faktura`,
    headers: naglowki, payload: { dokId: null } });
  assert.equal(cofniete.json().faktura.dokId, null);

  const ev = d.prepare(
    "SELECT COUNT(*) n FROM events WHERE type IN ('zwrot_faktura','zwrot_faktura_cofnieta')")
    .get() as { n: number };
  assert.equal(Number(ev.n), 2, "obie mutacje zostawiają ślad");
});

test("dokumentu spoza read-modelu wskazać się nie da", async () => {
  /* Numer wpisany z palca byłby napisem, którego nikt nie odnajdzie
     w Subiekcie — a to jest cała jego rola. */
  const { naglowki } = login("biuro", "Ala zmyśla");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/zwroty/${zwrot}/faktura`,
    headers: naglowki, payload: { dokId: 999 } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /Nie znam takiego dokumentu/);
});

test("ręczne dociągnięcie zamówień wymaga sparowanego konta", async () => {
  /* Bez konta trasa mówi, czego brakuje, zamiast strzelać w Allegro bez
     tokenu i oddawać 401 z obcego systemu. */
  const { naglowki } = login("biuro", "Ala dociąga");
  const r = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/zamowienia", headers: naglowki });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /sparowane/);
});

test("hala nie dociąga zamówień", async () => {
  const { naglowki } = login("magazynier", "Marek z hali");
  const r = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/zamowienia", headers: naglowki });
  assert.equal(r.statusCode, 403);
});

test("potwierdzenie kartoteki zapisuje wybór RAZEM ze źródłem", async () => {
  const { naglowki } = login("biuro", "Ala potwierdza");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (77,'SEK-46','Sekator')").run();
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja").get() as { id: number }).id);

  const r = await app.inject({ method: "POST", headers: naglowki,
    url: `/api/obsluga/zwroty/pozycje/${poz}/kartoteka`, payload: { twId: 77, zrodlo: "sku" } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { twId: 77, twSymbol: "SEK-46", twZrodlo: "sku" });

  /* Symbol pochodzi z KARTOTEKI, nie z żądania — snapshot ma przeżyć
     skasowanie read-modelu przy imporcie, a kłamliwy byłby gorszy od braku. */
  const w = d.prepare("SELECT tw_id, tw_symbol, tw_zrodlo, tw_przez FROM zwrot_klienta_pozycja WHERE id=?")
    .get(poz) as Record<string, unknown>;
  assert.equal(w.tw_symbol, "SEK-46");
  assert.equal(w.tw_zrodlo, "sku");
  assert.equal(w.tw_przez, "Ala potwierdza");

  const zdarzenia = d.prepare("SELECT type FROM events WHERE type LIKE 'zwrot_kartoteka%'").all();
  assert.equal(zdarzenia.length, 1, "każda mutacja zostawia ślad w dzienniku");
  const os = d.prepare("SELECT rodzaj FROM zwrot_zdarzenie").all() as Array<{ rodzaj: string }>;
  assert.deepEqual(os.map((e) => e.rodzaj), ["kartoteka"], "oś zwrotu też o tym mówi");
});

test("puste `twId` zdejmuje powiązanie — to droga wyjścia z pomyłki", async () => {
  const { naglowki } = login("biuro", "Ala cofa");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (77,'SEK-46','Sekator')").run();
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja").get() as { id: number }).id);
  const url = `/api/obsluga/zwroty/pozycje/${poz}/kartoteka`;
  await app.inject({ method: "POST", url, headers: naglowki, payload: { twId: 77, zrodlo: "reczne" } });
  const r = await app.inject({ method: "POST", url, headers: naglowki, payload: { twId: null } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { twId: null, twSymbol: null, twZrodlo: null });
});

test("nieznany towar i nieznana pozycja to 400 z powodem, nie 500", async () => {
  const { naglowki } = login("biuro", "Ala myli się");
  const poz = Number((db().prepare("SELECT id FROM zwrot_klienta_pozycja").get() as { id: number }).id);
  const zly = await app.inject({ method: "POST", headers: naglowki,
    url: `/api/obsluga/zwroty/pozycje/${poz}/kartoteka`, payload: { twId: 99999 } });
  assert.equal(zly.statusCode, 400);
  assert.match(zly.json().error, /towaru/);

  const brak = await app.inject({ method: "POST", headers: naglowki,
    url: "/api/obsluga/zwroty/pozycje/99999/kartoteka", payload: { twId: null } });
  assert.equal(brak.statusCode, 400);
  assert.match(brak.json().error, /pozycji/);
});

test("hala nie potwierdza kartoteki", async () => {
  const { naglowki } = login("magazynier", "Marek z hali");
  const poz = Number((db().prepare("SELECT id FROM zwrot_klienta_pozycja").get() as { id: number }).id);
  const r = await app.inject({ method: "POST", headers: naglowki,
    url: `/api/obsluga/zwroty/pozycje/${poz}/kartoteka`, payload: { twId: null } });
  assert.equal(r.statusCode, 403);
});

test("decyzje zwrotu: rola, brak powodu przy odmowie i konflikt wersji", async () => {
  /* Trzy odmowy, każda z innym kodem — operator ma odróżnić „nie wolno ci"
     od „ktoś zdążył pierwszy". */
  const bezSesji = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`,
    payload: { decyzja: "przyjety", wersja: 1 } });
  assert.equal(bezSesji.statusCode, 401);

  const hala = login("magazynier", "Hala");
  const zHali = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`, headers: hala.naglowki,
    payload: { decyzja: "przyjety", wersja: 1 } });
  assert.equal(zHali.statusCode, 403, "zwroty prowadzi biuro");

  const b = login("biuro", "Biuro");
  const bezPowodu = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`, headers: b.naglowki,
    payload: { decyzja: "odrzucony", powod: "   ", wersja: 1 } });
  assert.equal(bezPowodu.statusCode, 400);
  assert.match(bezPowodu.json().error, /powod|powód/i);

  const ok = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`, headers: b.naglowki,
    payload: { decyzja: "przyjety", wersja: 1 } });
  assert.equal(ok.statusCode, 200);

  /* Drugi agent z tą samą wersją dostaje 409 ZE SZCZEGÓŁAMI, nie 400 —
     panel ma narysować „ktoś zdążył pierwszy", a nie gołe „błąd". */
  const spozniony = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/werdykt`, headers: b.naglowki,
    payload: { decyzja: "odrzucony", powod: "duplikat", wersja: 1 } });
  assert.equal(spozniony.statusCode, 409);
  assert.equal(spozniony.json().wersja, 2);
});

test("kwota bierze się z zaznaczenia — liczba przysłana przez panel jest ignorowana", async () => {
  const poz = Number((db().prepare(
    "SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?").get(zwrot) as { id: number }).id);
  const b = login("biuro", "Biuro");

  await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/werdykt`,
    headers: b.naglowki, payload: { decyzja: "przyjety", wersja: 1 } });
  await app.inject({ method: "POST", url: `/api/obsluga/zwroty/pozycje/${poz}/ocena`,
    headers: b.naglowki, payload: { ocena: "stan", wersja: 2 } });

  const odp = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota`,
    headers: b.naglowki,
    /* `kwotaGrosze` w ciele jest CELOWO absurdalne: trasa nie ma prawa go
       przeczytać. Gdyby czytała, dałoby się oddać dowolną kwotę żądaniem
       z pominięciem ekranu — a to są cudze pieniądze. */
    payload: { pozycjeIds: [poz], dostawa: false, wersja: 3, kwotaGrosze: 999999 } });

  assert.equal(odp.statusCode, 200);
  assert.equal(odp.json().kwotaGrosze, 4999, "jedna sztuka po 49,99 z fixture'u");
});

test("MM wypuszczone przez automat NIE dostaje konta klikającego człowieka", async () => {
  /* Numer korekty wpisuje CZŁOWIEK, ale MM wypuszcza z tego automat — i to
     jest jedyna droga, na której widać różnicę. Zadanie powstaje wewnątrz
     żądania, więc kolejka miała skąd wziąć konto z sesji i wpisywała je
     zamiast jawnego „bez konta". Audyt wiąże po koncie, nie po nazwie, więc
     wypuszczenie automatu wyglądałoby na ręczne kliknięcie Ali.

     Przy okazji kształt wiersza, na którym stoi guard kolejności workera
     (sfera-worker/sql/pick_mm_pending.sql): koszyk to JEDNO zadanie
     wielopozycyjne bez `tw_id`. */
  const { naglowki } = login("biuro", "Ala z biura");
  /* Koszyki i kolejka nie schodzą w `beforeEach` — czyścimy je tutaj, żeby
     licznik zadań MM mierzył TEN przebieg, a nie resztki po sąsiadach. */
  for (const t of ["kosz_pozycja", "kosz", "sfera_queue"]) db().prepare(`DELETE FROM ${t}`).run();
  const wersja = () => (db().prepare("SELECT wersja FROM zwrot_klienta WHERE id=?")
    .get(zwrot) as { wersja: number }).wersja;
  const pozycja = (db().prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(zwrot) as { id: number }).id;
  /* Bez kartoteki pozycja do koszyka nie wchodzi — MM przesuwa stany kartotek. */
  db().prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (77,'SEK-01','Sekator NAC')").run();
  db().prepare("UPDATE zwrot_klienta_pozycja SET tw_id=77 WHERE id=?").run(pozycja);

  let r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/werdykt`,
    headers: naglowki, payload: { decyzja: "przyjety", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/pozycje/${pozycja}/ocena`,
    headers: naglowki, payload: { ocena: "stan", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  const kosz = (db().prepare(
    "SELECT id FROM kosz WHERE rodzaj='zwroty' AND status='otwarty'")
    .get() as { id: number } | undefined);
  assert.ok(kosz, "ocena „na stan\" zakłada koszyk zwrotów");

  r = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/kosz/zamknij",
    headers: naglowki, payload: { koszId: kosz.id } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().queueId, null, "MM czeka na korektę");

  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota`,
    headers: naglowki, payload: { pozycjeIds: [pozycja], dostawa: false, wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/korekta`,
    headers: naglowki, payload: { numer: "KFS 21/2026", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  const q = db().prepare(
    "SELECT created_by, created_by_ref, tw_id, payload FROM sfera_queue WHERE type='mm'")
    .all() as Array<{ created_by: string; created_by_ref: number | null;
      tw_id: number | null; payload: string }>;
  assert.equal(q.length, 1, "jeden koszyk to JEDEN dokument i jedna kartka");
  assert.equal(q[0].created_by_ref, null, "autorem jest automat, nie osoba przy klawiaturze");
  assert.match(q[0].created_by, /automat/);
  assert.equal(q[0].tw_id, null, "MM na bufor jest wielopozycyjne — guard go nie dotyczy");
  assert.ok((JSON.parse(q[0].payload) as { items: unknown[] }).items.length >= 1);
});

test("kwotę da się cofnąć przez HTTP i zapisać inną", async () => {
  /* Drabina cofania (0.202.0): DO KOREKTY cofa kwotę, DO ZWROTU cofa ocenę.
     Ten test przechodzi cały szczebel, bo dopiero on pokazuje, że po
     cofnięciu zwrot wraca do kubełka, w którym wycena jest w ogóle możliwa. */
  const { naglowki } = login("biuro", "Ala z biura");
  const wersja = () => (db().prepare("SELECT wersja FROM zwrot_klienta WHERE id=?")
    .get(zwrot) as { wersja: number }).wersja;
  const pozycja = (db().prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(zwrot) as { id: number }).id;

  let r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/werdykt`,
    headers: naglowki, payload: { decyzja: "przyjety", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/pozycje/${pozycja}/ocena`,
    headers: naglowki, payload: { ocena: "przecena", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota`,
    headers: naglowki, payload: { pozycjeIds: [pozycja], dostawa: false, wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  r = await app.inject({ method: "GET", url: `/api/obsluga/zwroty/${zwrot}`, headers: naglowki });
  assert.equal(r.json().zwrot.kubelek, "korekta");

  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota/cofnij`,
    headers: naglowki, payload: { wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  r = await app.inject({ method: "GET", url: `/api/obsluga/zwroty/${zwrot}`, headers: naglowki });
  assert.equal(r.json().zwrot.kubelek, "zwrot", "wraca tam, gdzie wycena jest możliwa");
  assert.equal(r.json().zwrot.kwotaGrosze, null);

  /* Stara wersja dostaje 409, nie ciche nadpisanie — jak przy każdej decyzji. */
  const stara = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota/cofnij`,
    headers: naglowki, payload: { wersja: wersja() - 1 } });
  assert.equal(stara.statusCode, 409, stara.body);

  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota`,
    headers: naglowki, payload: { pozycjeIds: [], dostawa: false, wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().kwotaGrosze, 0, "puste zaznaczenie to zero, nie odmowa");
});

test("korekta domyka zwrot przez HTTP, a cofnięcie otwiera go z powrotem", async () => {
  /* Cała droga jednym ciągiem, bo to jedyny test, w którym widać, że kubełki
     naprawdę się przesuwają: werdykt → ocena → kwota → korekta → zamknięty. */
  const { naglowki } = login("biuro", "Ala z biura");
  const wersja = () => (db().prepare("SELECT wersja FROM zwrot_klienta WHERE id=?")
    .get(zwrot) as { wersja: number }).wersja;
  const pozycja = (db().prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(zwrot) as { id: number }).id;

  let r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/werdykt`,
    headers: naglowki, payload: { decyzja: "przyjety", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/pozycje/${pozycja}/ocena`,
    headers: naglowki, payload: { ocena: "stan", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/kwota`,
    headers: naglowki, payload: { pozycjeIds: [pozycja], dostawa: false, wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  const pusty = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/korekta`,
    headers: naglowki, payload: { numer: "  ", wersja: wersja() } });
  assert.equal(pusty.statusCode, 400);
  assert.match(pusty.json().error, /numer/i);

  r = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/korekta`,
    headers: naglowki, payload: { numer: "KFS 12/2026", wersja: wersja() } });
  assert.equal(r.statusCode, 200, r.body);

  r = await app.inject({ method: "GET", url: `/api/obsluga/zwroty/${zwrot}`, headers: naglowki });
  assert.equal(r.json().zwrot.kubelek, "zamkniety");
  assert.equal(r.json().zwrot.korektaNumer, "KFS 12/2026");

  /* Stara wersja dostaje 409, nie ciche nadpisanie — dwóch agentów nie zamyka
     jednego zwrotu dwoma numerami. */
  const stara = await app.inject({ method: "POST", url: `/api/obsluga/zwroty/${zwrot}/korekta/cofnij`,
    headers: naglowki, payload: { wersja: wersja() - 1 } });
  assert.equal(stara.statusCode, 409, stara.body);

  const cofnij = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/${zwrot}/korekta/cofnij`,
    headers: naglowki, payload: { wersja: wersja() } });
  assert.equal(cofnij.statusCode, 200, cofnij.body);
  r = await app.inject({ method: "GET", url: `/api/obsluga/zwroty/${zwrot}`, headers: naglowki });
  assert.equal(r.json().zwrot.kubelek, "korekta", "wraca do kubełka, nie na początek kolejki");
});

test("wniosek o rabat: bez dopasowanej pozycji zamówienia trasa mówi POWÓD", async () => {
  /* Jedyna trasa tego pliku, która WYCHODZI do Allegro. Tu sprawdzamy, że nie
     wychodzi wtedy, gdy nie ma czego wysłać — identyfikator pozycji zamówienia
     jest jedynym wymaganym polem żądania i bez niego nie ma wniosku.

     Zwrot z tego stanowiska nie ma pobranego zamówienia, więc łańcuch pęka na
     pierwszym ogniwie i ekran ma to powiedzieć zdaniem, nie ciszą. */
  const { naglowki } = login("biuro", "Ala z biura");
  const pozycja = (db().prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(zwrot) as { id: number }).id;

  const r = await app.inject({ method: "POST",
    url: `/api/obsluga/zwroty/pozycje/${pozycja}/rabat`, headers: naglowki });
  assert.equal(r.statusCode, 400, r.body);
  assert.match(r.json().error, /zamówieni/i);

  /* I nie zostawia po sobie wniosku-widma. */
  assert.equal((db().prepare("SELECT count(*) n FROM allegro_rabat").get() as { n: number }).n, 0);
});

/* ── Skan etykiety zwrotnej (0.163.0) ─────────────────────────────────────── */

const ETYKIETA = "600000367616070023174201";

/** Numer listu leży TYLKO w lądowisku — kolumny na niego nie ma i nie będzie. */
function dopiszPaczke(externalId: string, waybill: string) {
  db().prepare(`INSERT INTO allegro_zwrot(id,created_at,surowe_json,synced_at)
    VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET surowe_json=excluded.surowe_json`).run(
      externalId, "2026-09-01T08:00:00Z",
      JSON.stringify({ id: externalId, parcels: [{ waybill }] }), "2026-09-01T08:00:00Z");
}

test("skan otwiera zwrot i mówi, którą drogą trafił", async () => {
  const { naglowki } = login("biuro", "Ala skanuje");
  const ext = (db().prepare("SELECT external_id FROM zwrot_klienta WHERE id=?")
    .get(zwrot) as { external_id: string }).external_id;
  dopiszPaczke(ext, ETYKIETA);

  const r = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/skan",
    headers: naglowki, payload: { kod: ETYKIETA } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().trafienie, "waybill");
  assert.equal(r.json().zwrotId, zwrot);
});

test("skan NICZEGO nie zapisuje, choć jest POST-em", async () => {
  /* Cała treść tej trasy: kod nie ma prawa wylądować ani w bazie, ani
     w dzienniku, ani w adresie żądania — numer listu prowadzi w systemie
     kuriera do adresu odbiorcy. POST jest tu formą, nie zapisem. */
  const { naglowki } = login("biuro", "Ala liczy skany");
  const licz = () => {
    const d = db();
    return ["events", "zwrot_klienta", "zwrot_zdarzenie", "allegro_zwrot"]
      .map((t) => (d.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n).join("/");
  };
  const przed = licz();
  for (const kod of [ETYKIETA, "nie-ma-takiego", "1234/Z04A"]) {
    await app.inject({ method: "POST", url: "/api/obsluga/zwroty/skan",
      headers: naglowki, payload: { kod } });
  }
  assert.equal(licz(), przed, "skan dopisał wiersz");
});

test("nieznany kod oddaje brak, a pusty — odmowę", async () => {
  const { naglowki } = login("biuro", "Ala pyta");
  const brak = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/skan",
    headers: naglowki, payload: { kod: "600000000000000000000000" } });
  assert.equal(brak.statusCode, 200, "nieznany kod to nie awaria");
  assert.equal(brak.json().trafienie, null);

  const pusty = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/skan",
    headers: naglowki, payload: { kod: "  " } });
  assert.equal(pusty.statusCode, 400, pusty.body);
});

test("dociągnięcie po skanie wymaga sparowanego konta", async () => {
  /* Bez konta trasa mówi, czego brakuje, zamiast strzelać w Allegro bez tokenu
     i oddawać 401 z obcego systemu — tak samo jak dociąganie zamówień. */
  const { naglowki } = login("biuro", "Ala dociąga skan");
  const r = await app.inject({ method: "POST", url: "/api/obsluga/zwroty/skan/dociagnij",
    headers: naglowki, payload: { kod: ETYKIETA } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /nie jest sparowane/);
});
