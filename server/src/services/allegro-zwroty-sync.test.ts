import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { naGrosze, synchronizujAllegroZwroty } from "./allegro-zwroty-sync.js";
import { stanZwrotow } from "./allegro-zwroty-sync-state.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { zostalyWrazliwe } from "./allegro-oczyszczanie.js";

/* ── Strażnicy synchronizatora zwrotów (0.150.0) ─────────────────────────────
   Cztery rzeczy, z których każda kosztowała już wydanie w innym rejestrze:
   paginacja do bezpiecznika (0.127.0), idempotencja po identyfikatorze
   (0.128.0), respekt dla 429 (takt.ts) oraz — nowa — NIETYKALNOŚĆ pracy
   człowieka przy odświeżeniu listy.                                        */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d as unknown as Db;
}

const zwrot = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id, createdAt, referenceNumber: `REF-${id}`, orderId: `ord-${id}`,
  items: [{ offerId: "111", quantity: 1, name: "Sekator", price: { amount: "49.99", currency: "PLN" },
    reason: { type: "DONT_LIKE_IT", userComment: "za ciężki" } }],
  parcels: [], rejection: null, ...extra,
});

const odpowiedz = (lista: unknown[]) => ({ count: lista.length, customerReturns: lista });

test("kwotę liczymy na tekście — Allegro oddaje ją stringiem nie bez powodu", () => {
  assert.equal(naGrosze("49.99"), 4999, "grosze bez zaokrąglenia przez float");
  assert.equal(naGrosze("0.05"), 5);
  assert.equal(naGrosze("120"), 12000, "kwota bez części ułamkowej to pełne złote");
  assert.equal(naGrosze("1.5"), 150, "jedna cyfra po przecinku to dziesiątki groszy");
  assert.equal(naGrosze(undefined), 0);
  assert.throws(() => naGrosze("dużo"), /docs\/allegro-ksztalt\.md/,
    "kształt spoza kontraktu ma się zapalić, a nie policzyć na zero");
});

test("pierwszy przebieg bierze filtr dat, kolejny idzie kursorem", async () => {
  /* Do 0.152.0 filtrem było OKNO WZGLĘDNE (90 dni wstecz od teraz); dziś jest
     nim próg bezwzględny. Dla adresu zapytania różnica jest żadna — liczy się
     to, że dwa filtry nigdy nie jadą razem. */
  const d = stanowisko();
  const url: string[] = [];
  await synchronizujAllegroZwroty({
    database: d, zwrotyOd: "2026-06-03T00:00:00Z", now: () => new Date("2026-09-01T10:00:00Z"),
    apiUrl: "https://api", query: async (u) => { url.push(u); return odpowiedz([zwrot("z1", "2026-08-30T08:00:00Z")]); },
  });
  assert.match(url[0], /createdAt\.gte=2026-06-03/, "brak kursora → filtr dat");
  assert.equal(url[0].includes("from="), false);

  url.length = 0;
  await synchronizujAllegroZwroty({
    database: d, now: () => new Date("2026-09-01T10:05:00Z"),
    apiUrl: "https://api", query: async (u) => { url.push(u); return odpowiedz([]); },
  });
  assert.match(url[0], /from=z1/, "kursor rządzi, gdy już jest");
  assert.equal(url[0].includes("createdAt"), false, "dwa filtry naraz zawężałyby wynik dwa razy");
});

test("kursor bierze się z najpóźniejszej daty, nie z ostatniego elementu listy", async () => {
  /* Dokumentacja nie obiecuje porządku listy. Kursor z niewłaściwego końca
     przewijałby nas wstecz przy każdym przebiegu — i zwroty wracałyby
     w kółko, a najnowsze nie dochodziły nigdy. */
  const d = stanowisko();
  await synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api", now: () => new Date("2026-09-01T10:00:00Z"),
    query: async () => odpowiedz([
      zwrot("nowy", "2026-08-31T00:00:00Z"),
      zwrot("stary", "2026-08-01T00:00:00Z"),
    ]),
  });
  assert.equal(stanZwrotow(d).cursorId, "nowy");
});

test("paginacja idzie dalej niż pierwsza strona i staje na bezpieczniku", async () => {
  const d = stanowisko();
  let strony = 0;
  await synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api", now: () => new Date("2026-09-01T10:00:00Z"),
    /* Zawsze pełna strona: bez bezpiecznika ta pętla biłaby w konto bez końca. */
    query: async () => {
      strony++;
      return odpowiedz(Array.from({ length: 100 }, (_, i) => zwrot(`s${strony}-${i}`, "2026-08-30T00:00:00Z")));
    },
  });
  assert.equal(strony, 10, "dziesięć stron to bezpiecznik, nie limit poprawnościowy");
  const ile = d.prepare("SELECT COUNT(*) c FROM zwrot_klienta").get() as { c: number };
  assert.equal(ile.c, 1000);
});

test("drugi przebieg nie tworzy duplikatów i nie rusza decyzji biura", async () => {
  const d = stanowisko();
  const partia = [zwrot("z1", "2026-08-30T08:00:00Z")];
  const przebieg = () => synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api", now: () => new Date("2026-09-01T10:00:00Z"),
    query: async () => odpowiedz(partia),
  });
  await przebieg();

  /* Biuro pracuje: werdykt, kwota i ocena pozycji. */
  d.prepare(`UPDATE zwrot_klienta SET werdykt='przyjety', werdykt_przez='Ala',
    kwota_wariant='pelna', kwota_grosze=4999, wersja=2 WHERE external_id='z1'`).run();
  d.prepare("UPDATE zwrot_klienta_pozycja SET ocena='stan', ocena_przez='Marek'").run();

  await przebieg();

  const ile = d.prepare("SELECT COUNT(*) c FROM zwrot_klienta").get() as { c: number };
  assert.equal(ile.c, 1, "idempotencja po identyfikatorze Allegro");
  const z = d.prepare(`SELECT werdykt, werdykt_przez, kwota_grosze, wersja
    FROM zwrot_klienta WHERE external_id='z1'`).get() as Record<string, unknown>;
  assert.equal(z.werdykt, "przyjety", "ponowne pobranie nie kasuje werdyktu");
  assert.equal(z.kwota_grosze, 4999);
  assert.equal(z.wersja, 2, "wersja nie cofa się do jedynki");
  const p = d.prepare("SELECT ocena, ocena_przez FROM zwrot_klienta_pozycja").get() as Record<string, unknown>;
  assert.equal(p.ocena, "stan", "ocena hali przeżywa przepisanie pozycji");
  assert.equal(p.ocena_przez, "Marek");
});

test("429 przesuwa następną próbę o tyle, ile prosi Allegro", async () => {
  const d = stanowisko();
  await assert.rejects(() => synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api", intervalMs: 60_000,
    now: () => new Date("2026-09-01T10:00:00Z"),
    query: async () => { throw new BladLimituAllegro("limit", 900_000); },
  }));
  const s = stanZwrotow(d);
  assert.equal(s.lastErrorCode, 429);
  assert.equal(s.errorCount, 1);
  assert.equal(s.nextAttemptAt, "2026-09-01T10:15:00.000Z", "prośba Allegro wygrywa z naszym taktem");
});

test("kod porażki bierze się z klasy błędu, nie z jego zdania", async () => {
  /* Blizna 0.149.0: wyrażenie szukające kodu w nawiasie milczało akurat przy
     odmowach, które status ma nazywać. */
  const d = stanowisko();
  await assert.rejects(() => synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api",
    query: async () => { throw new BladOdpowiedziAllegro("Allegro odpowiedziało 403: brak scope", 403); },
  }));
  assert.equal(stanZwrotow(d).lastErrorCode, 403);
});

test("konto bankowe i telefon nadawcy nie mają gdzie wylądować", async () => {
  /* Do 0.151.0 ten test sprawdzał WYŁĄCZNIE model pracy, a lądowisko trzymało
     odpowiedź dosłownie — więc IBAN jednak był w bazie, wbrew zdaniu
     z polityki danych. Od 0.152.0 sprawdzamy obie tabele. */
  const d = stanowisko();
  await synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api",
    query: async () => odpowiedz([zwrot("z1", "2026-08-30T08:00:00Z", {
      refund: { bankAccount: { owner: "Jan Kowalski", iban: "PL61109010140000071219812874" } },
      parcels: [{ createdAt: "2026-08-31T09:00:00Z", waybill: "WB1", sender: { phoneNumber: "600100200" } }],
    })]),
  });
  const wiersz = d.prepare("SELECT * FROM zwrot_klienta").get() as Record<string, unknown>;
  const zapisane = JSON.stringify(wiersz);
  assert.equal(zapisane.includes("PL61109010140000071219812874"), false, "IBAN nie wchodzi do modelu pracy");
  assert.equal(zapisane.includes("600100200"), false, "telefon nadawcy też nie");
  assert.equal(wiersz.paczka_at, "2026-08-31T09:00:00Z", "sam FAKT powrotu paczki zostaje — bez danych nadawcy");

  const ladowisko = (d.prepare("SELECT surowe_json FROM allegro_zwrot").get() as { surowe_json: string }).surowe_json;
  assert.equal(ladowisko.includes("PL61109010140000071219812874"), false, "IBAN nie wchodzi też do lądowiska");
  assert.equal(ladowisko.includes("600100200"), false, "telefon nadawcy też nie");
  assert.equal(zostalyWrazliwe(ladowisko), false, "żadne pole wrażliwe nie zostało z wartością");
  /* Kształt ma przeżyć czyszczenie — to po niego lądowisko istnieje. */
  assert.equal(ladowisko.includes("bankAccount"), true, "klucz zostaje, znika wartość");
  assert.equal(ladowisko.includes("WB1"), true, "list przewozowy to nie dane osobowe");
});

/* ── Próg bezwzględny (0.152.0) ──────────────────────────────────────────────
   Decyzja właściciela: zwroty od 20 lipca 2026. Okno względne
   `ALLEGRO_ZWROTY_DNI_WSTECZ` znika, a to jest zmiana NATURY, nie jednostki:
   tamto liczyło się wyłącznie przy pierwszym przebiegu, bo dalej rządził
   kursor. Próg obowiązuje zawsze. */
const PROG = "2026-07-19T22:00:00Z";

test("próg wchodzi do pierwszego zapytania zamiast okna dni", async () => {
  const d = stanowisko();
  const url: string[] = [];
  await synchronizujAllegroZwroty({
    database: d, zwrotyOd: PROG, now: () => new Date("2026-09-01T10:00:00Z"),
    apiUrl: "https://api",
    query: async (u) => { url.push(u); return odpowiedz([zwrot("z1", "2026-08-30T08:00:00Z")]); },
  });
  assert.match(url[0], /createdAt\.gte=2026-07-19/, "pierwszy przebieg ma prosić od progu");
});

test("próg obowiązuje TAKŻE wtedy, gdy kursor już stoi", async () => {
  /* Tu przewracało się okno względne. Gdy kursor już jest, zapytanie idzie
     `from=`, bez filtra dat — więc zwrot sprzed progu wjeżdżał przy pierwszej
     zmianie po stronie Allegro. Próg musi ciąć wynik, a nie tylko zapytanie. */
  const d = stanowisko();
  await synchronizujAllegroZwroty({
    database: d, zwrotyOd: PROG, now: () => new Date("2026-09-01T10:00:00Z"),
    apiUrl: "https://api", query: async () => odpowiedz([zwrot("z1", "2026-08-30T08:00:00Z")]),
  });

  await synchronizujAllegroZwroty({
    database: d, zwrotyOd: PROG, now: () => new Date("2026-09-01T10:05:00Z"),
    apiUrl: "https://api",
    query: async () => odpowiedz([
      zwrot("stary", "2026-07-01T08:00:00Z"),
      zwrot("nowy", "2026-08-31T08:00:00Z"),
    ]),
  });

  const id = (d.prepare("SELECT external_id FROM zwrot_klienta ORDER BY external_id")
    .all() as Array<{ external_id: string }>).map((z) => z.external_id);
  assert.deepEqual(id, ["nowy", "z1"], "zwrot sprzed progu wjechał mimo granicy");
});

test("bez progu nic się nie zmienia", async () => {
  const d = stanowisko();
  await synchronizujAllegroZwroty({
    database: d, zwrotyOd: null, now: () => new Date("2026-09-01T10:00:00Z"),
    apiUrl: "https://api", query: async () => odpowiedz([zwrot("stary", "2020-01-01T08:00:00Z")]),
  });
  assert.equal((d.prepare("SELECT count(*) n FROM zwrot_klienta").get() as { n: number }).n, 1);
});


test("identyfikator pozycji NIE zmienia się między przebiegami", () => {
  /* Do 0.153.1 pozycje kasowało się i wstawiało od nowa, więc `id` rosło przy
     każdym przebiegu. Panel otwarty w trakcie synchronizacji wysyłał
     potwierdzenie kartoteki na nieaktualny numer — trafiało w cudzy wiersz
     albo w „Nie znaleziono pozycji zwrotu". */
  const d = stanowisko();
  const partia = [zwrot("z1", "2026-08-30T08:00:00Z")];
  const przebieg = () => synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api", query: async () => odpowiedz(partia),
  });
  return przebieg().then(async () => {
    const przed = d.prepare("SELECT id FROM zwrot_klienta_pozycja").all() as Array<{ id: number }>;
    await przebieg();
    await przebieg();
    const po = d.prepare("SELECT id FROM zwrot_klienta_pozycja").all() as Array<{ id: number }>;
    assert.deepEqual(po.map((p) => p.id), przed.map((p) => p.id));
  });
});

test("dwie pozycje o tej samej nazwie bez numeru oferty nie zlewają się", () => {
  /* Blizna projektowa: praca człowieka wracała po kluczu `offer_id|nazwa`
     z MAPY, więc przy pustym `offer_id` dwie takie pozycje dostawały jeden
     klucz i jedna traciła ocenę. Dziś klucz jest kolumną z ograniczeniem. */
  const d = stanowisko();
  const dwie = [{
    id: "z9", createdAt: "2026-08-30T08:00:00Z", referenceNumber: "REF-9",
    orderId: "ord-9", parcels: [], rejection: null,
    items: [
      { quantity: 1, name: "Uszczelka", price: { amount: "9.99", currency: "PLN" } },
      { quantity: 2, name: "Uszczelka", price: { amount: "9.99", currency: "PLN" } },
    ],
  }];
  return synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api", query: async () => odpowiedz(dwie),
  }).then(() => {
    /* Obie mają ten sam klucz naturalny, więc druga NADPISUJE pierwszą —
       i to jest poprawne: bez `offer_id` Allegro nie daje nam czym ich
       rozróżnić, a dwa wiersze nie do odróżnienia byłyby gorsze. */
    const poz = d.prepare("SELECT ilosc FROM zwrot_klienta_pozycja").all() as Array<{ ilosc: number }>;
    assert.equal(poz.length, 1, "jeden klucz to jedna pozycja");
    assert.equal(poz[0].ilosc, 2, "wygrywa ostatnia z odpowiedzi");
  });
});

test("pozycja wycofana przez klienta znika, reszta zostaje", () => {
  const d = stanowisko();
  const dwie = { id: "z8", createdAt: "2026-08-30T08:00:00Z", parcels: [], rejection: null,
    items: [
      { offerId: "a", quantity: 1, name: "Pierwsza", price: { amount: "10.00", currency: "PLN" } },
      { offerId: "b", quantity: 1, name: "Druga", price: { amount: "20.00", currency: "PLN" } },
    ] };
  const jedna = { ...dwie, items: [dwie.items[0]] };
  return synchronizujAllegroZwroty({
    database: d, apiUrl: "https://api", query: async () => odpowiedz([dwie]),
  }).then(async () => {
    await synchronizujAllegroZwroty({
      database: d, apiUrl: "https://api", query: async () => odpowiedz([jedna]),
    });
    const poz = d.prepare("SELECT nazwa FROM zwrot_klienta_pozycja").all() as Array<{ nazwa: string }>;
    assert.deepEqual(poz.map((p) => p.nazwa), ["Pierwsza"]);
  });
});
