import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { naGrosze, poczatekHistorii, synchronizujAllegroZwroty } from "./allegro-zwroty-sync.js";
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

test("granica historii: stała data wygrywa z ruchomym oknem", () => {
  /* Okno „N dni wstecz" przesuwa się każdego dnia — po kwartale przestaje
     sięgać początku historii, a przy odtwarzaniu bazy z kopii wciąga co
     innego niż przy pierwszym uruchomieniu. Data mówi wprost, gdzie ta
     historia się zaczyna. */
  const teraz = new Date("2026-09-01T10:00:00Z");
  assert.equal(poczatekHistorii({ od: "2026-08-20", oknoDni: 90, teraz }),
    "2026-08-20T00:00:00.000Z", "sama data znaczy początek dnia w UTC");
  assert.equal(poczatekHistorii({ od: "  2026-08-20 ", oknoDni: 90, teraz }),
    "2026-08-20T00:00:00.000Z");
  assert.equal(poczatekHistorii({ od: "2026-08-20T06:30:00Z", oknoDni: 90, teraz }),
    "2026-08-20T06:30:00.000Z", "pełny znacznik czasu przechodzi bez zmian");
  assert.equal(poczatekHistorii({ od: "", oknoDni: 90, teraz }),
    "2026-06-03T10:00:00.000Z", "puste = zapasowe okno dnowe");
  /* Śmieć NIE cofa nas po cichu do okna: to ten sam gatunek cichej podmiany,
     przez który `MAG_ID_MAG=jeden` dawało kiedyś 1. */
  assert.throws(() => poczatekHistorii({ od: "wczoraj", oknoDni: 90, teraz }),
    /ALLEGRO_ZWROTY_OD/);
});

test("pierwszy przebieg bierze granicę dat, kolejny idzie kursorem", async () => {
  const d = stanowisko();
  const url: string[] = [];
  await synchronizujAllegroZwroty({
    database: d, od: "2026-08-20", now: () => new Date("2026-09-01T10:00:00Z"),
    apiUrl: "https://api", query: async (u) => { url.push(u); return odpowiedz([zwrot("z1", "2026-08-30T08:00:00Z")]); },
  });
  assert.match(url[0], /createdAt\.gte=2026-08-20T00%3A00%3A00\.000Z/,
    "brak kursora → granica z konfiguracji");
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
