import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import { ofertyPoSygnaturze, SYGNATUR_NA_ZADANIE } from "./allegro-oferty-po-sygnaturze.js";

/* ── Która z NASZYCH ofert sprzedaje tę kartotekę (0.270.0) ──────────────────
   Serwis odpowiada na pytanie, na które do 0.269.0 nie odpowiadał nikt.
   Testy pilnują czterech rzeczy, z których każda jest decyzją, nie detalem:
   pytamy JEDNYM żądaniem i tylko o aktywne, błąd nie przerywa szkicu, pusta
   lista nie idzie do sieci wcale, a oferta bez sygnatury milczy zamiast
   zgadywać, do której kartoteki należy.                                     */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.exec("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','konto-1')");
  return d;
}

const oferta = (id: string, sygnatura: string | null, nazwa = "Presostat 230V") => ({
  id, name: nazwa,
  external: sygnatura === null ? null : { id: sygnatura },
  publication: { status: "ACTIVE" },
  sellingMode: { price: { amount: "49.90", currency: "PLN" } },
});

test("JEDNO żądanie na komplet sygnatur, wyłącznie o aktywne aukcje", async () => {
  /* `external.id` jest w specyfikacji tablicą, więc dwadzieścia kartotek
     kosztuje jedno wywołanie. `publication.status=ACTIVE` nie jest
     oszczędnością: link do zakończonej aukcji jest gorszy od braku linku. */
  const d = baza();
  const adresy: string[] = [];
  const wynik = await ofertyPoSygnaturze(["W28-0304", "10680/1"], {
    database: d, apiUrl: "https://api.test", accountId: "konto-1",
    query: async (url) => { adresy.push(url); return { offers: [oferta("111", "W28-0304")] }; },
  });

  assert.equal(adresy.length, 1, "dwie sygnatury mają kosztować jedno żądanie");
  assert.match(adresy[0], /external\.id=W28-0304/);
  assert.match(adresy[0], /external\.id=10680%2F1/, "ukośnik w symbolu musi być zakodowany");
  assert.match(adresy[0], /publication\.status=ACTIVE/);
  assert.equal(wynik.size, 1);
  assert.match(wynik.get("w280304")!.link, /111$/);
  d.close();
});

test("pusta lista sygnatur NIE idzie do sieci", async () => {
  /* Puste `external.id` w adresie oddałoby całą listę ofert konta — czyli
     najgorszą możliwą odpowiedź na pytanie „o którą kartotekę chodzi". */
  const d = baza();
  let strzalow = 0;
  const wynik = await ofertyPoSygnaturze([], {
    database: d, query: async () => { strzalow++; return { offers: [] }; },
  });
  assert.equal(strzalow, 0);
  assert.equal(wynik.size, 0);
  d.close();
});

test("błąd Allegro NIE przerywa szkicu — także limit", async () => {
  /* To jest OSTATNIE żądanie do Allegro na drodze szkicu, więc reguła
     „limit przerywa, bo drugie żądanie pogłębia przerwę" nie ma tu czego
     chronić. Szkic bez linku jest wart tyle, ile był wart do 0.269.0. */
  const d = baza();
  const wynik = await ofertyPoSygnaturze(["W28-0304"], {
    database: d, query: async () => { throw new Error("429 Too Many Requests"); },
  });
  assert.equal(wynik.size, 0, "brak linku, ale bez wyjątku w górę");
  d.close();
});

test("oferta bez sygnatury milczy, zamiast zgadywać kartotekę", async () => {
  const d = baza();
  const wynik = await ofertyPoSygnaturze(["W28-0304"], {
    database: d, apiUrl: "https://api.test", accountId: "konto-1",
    query: async () => ({ offers: [oferta("111", null), oferta("222", "  ")] }),
  });
  assert.equal(wynik.size, 0);
  d.close();
});

test("pierwsza oferta wygrywa — wyboru handlowego ten kod nie podejmuje", async () => {
  /* Ta sama kartoteka bywa na kilku aukcjach (zestaw, inna ilość). Druga
     w faktach kazałaby modelowi wybierać za nas. */
  const d = baza();
  const wynik = await ofertyPoSygnaturze(["W28-0304"], {
    database: d, apiUrl: "https://api.test", accountId: "konto-1",
    query: async () => ({ offers: [
      oferta("111", "W28-0304", "Presostat pojedynczy"),
      oferta("222", "W28-0304", "Presostat w zestawie"),
    ] }),
  });
  assert.equal(wynik.size, 1);
  assert.equal(wynik.get("w280304")!.ofertaId, "111");
  d.close();
});

test("porcja jest ograniczona, a odpowiedź ląduje w snapshocie ofert", async () => {
  /* Długi ciąg żądań z jednego adresu to sygnatura, po której Allegro odcina
     konto. A skoro i tak zapytaliśmy, snapshot zapisujemy: rozmowa pod tą
     ofertą dostanie tytuł bez osobnego żądania. */
  const d = baza();
  const duzo = Array.from({ length: SYGNATUR_NA_ZADANIE + 5 }, (_, i) => `W28-${i}`);
  let adres = "";
  await ofertyPoSygnaturze(duzo, {
    database: d, apiUrl: "https://api.test", accountId: "konto-1",
    query: async (url) => { adres = url; return { offers: [oferta("111", "W28-0")] }; },
  });
  assert.equal((adres.match(/external\.id=/g) ?? []).length, SYGNATUR_NA_ZADANIE);
  const w = d.prepare("SELECT external_id, sku, status FROM offer_snapshot WHERE external_id='111'")
    .get() as { external_id: string; sku: string; status: string } | undefined;
  assert.equal(w?.sku, "W28-0");
  assert.equal(w?.status, "ACTIVE");
  d.close();
});
