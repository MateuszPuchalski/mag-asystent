import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import {
  dodajZalacznik, LIMIT_NASZ, MAKS_ZALACZNIKOW, usunZalacznik, zalacznikiRozmowy,
} from "./zalaczniki-wysylki.js";

/* ── Załączniki do odpowiedzi (0.195.0) ──────────────────────────────────────
   Odczyt załączników klienta działał od 0.155.0, wysyłka nie istniała wcale.
   Te testy pilnują dwóch rzeczy, na których stoi reszta:

   1. WALIDACJA IDZIE PRZED SIECIĄ. Odmowę typu i rozmiaru agent ma zobaczyć
      przy dodawaniu, gdy jeszcze da się wybrać inny plik — a nie po napisaniu
      odpowiedzi, przy WYŚLIJ.
   2. WIERSZ POWSTAJE PO UDANYM WGRANIU. Wiersz bez pliku po tamtej stronie
      obiecywałby załącznik, którego wysyłka nie znajdzie.                   */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const user = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'t-1','Kupujący 44300444')`)
    .run(konto).lastInsertRowid);
  return { d, user, rozmowa };
}

const autor = (id: number) => ({ id, name: "A. Lewandowska" });
const bajty = (ile: number) => new Uint8Array(ile).fill(7);

test("plik wgrany do Allegro zostaje przy rozmowie z numerem deklaracji", async () => {
  const { d, user, rozmowa } = stanowisko();
  const widziane: Array<{ nazwa: string; typ: string; ile: number }> = [];

  const z = await dodajZalacznik({
    conversationId: rozmowa, nazwa: "gwint.jpg", typ: "image/jpeg", dane: bajty(2048),
    autor: autor(user), database: d,
    wgraj: async (nazwa, typ, dane) => {
      widziane.push({ nazwa, typ, ile: dane.byteLength });
      return { id: "att-7" };
    },
  });

  assert.equal(z.allegroId, "att-7");
  assert.deepEqual(widziane, [{ nazwa: "gwint.jpg", typ: "image/jpeg", ile: 2048 }]);
  assert.deepEqual(zalacznikiRozmowy(d, rozmowa).map((a) => a.allegroId), ["att-7"]);
  assert.equal(zalacznikiRozmowy(d, rozmowa)[0].dodal, "A. Lewandowska", "autor jest częścią wiersza");
});

test("typ spoza listy Allegro odpada PRZED siecią", async () => {
  /* Specyfikacja wymienia przy wgraniu sześć typów. Wysłanie siódmego kończy
     się 415, czyli odmową bez objawu poza „nie udało się". */
  const { d, user, rozmowa } = stanowisko();
  let strzalow = 0;

  await assert.rejects(() => dodajZalacznik({
    conversationId: rozmowa, nazwa: "instrukcja.docx", typ: "application/msword",
    dane: bajty(100), autor: autor(user), database: d,
    wgraj: async () => { strzalow += 1; return { id: "x" }; },
  }), /PNG.*PDF|application\/msword/);

  assert.equal(strzalow, 0);
  assert.equal(zalacznikiRozmowy(d, rozmowa).length, 0);
});

test("za duży plik odpada PRZED siecią i mówi OBIE liczby", async () => {
  /* Nasz próg jest niższy niż próg Allegro, więc zdanie musi powiedzieć,
     że plik nie odpadł przez Allegro. */
  const { d, user, rozmowa } = stanowisko();
  let strzalow = 0;

  await assert.rejects(() => dodajZalacznik({
    conversationId: rozmowa, nazwa: "skan.pdf", typ: "application/pdf",
    dane: bajty(LIMIT_NASZ + 1), autor: autor(user), database: d,
    wgraj: async () => { strzalow += 1; return { id: "x" }; },
  }), /przyjmujemy 4 MB.*Allegro bierze 5 MB/s);

  assert.equal(strzalow, 0);
});

test("pusty plik nie idzie do klienta", async () => {
  const { d, user, rozmowa } = stanowisko();
  await assert.rejects(() => dodajZalacznik({
    conversationId: rozmowa, nazwa: "puste.png", typ: "image/png", dane: bajty(0),
    autor: autor(user), database: d, wgraj: async () => ({ id: "x" }),
  }), /Pusty plik/);
});

test("nieudane wgranie NIE zostawia wiersza obiecującego załącznik", async () => {
  const { d, user, rozmowa } = stanowisko();

  await assert.rejects(() => dodajZalacznik({
    conversationId: rozmowa, nazwa: "gwint.jpg", typ: "image/jpeg", dane: bajty(10),
    autor: autor(user), database: d,
    wgraj: async () => { throw new Error("413 z Allegro"); },
  }), /413/);

  assert.equal(zalacznikiRozmowy(d, rozmowa).length, 0);
});

test("liczba załączników przy jednej odpowiedzi jest ograniczona", async () => {
  const { d, user, rozmowa } = stanowisko();
  for (let i = 0; i < MAKS_ZALACZNIKOW; i++) {
    await dodajZalacznik({
      conversationId: rozmowa, nazwa: `plik-${i}.png`, typ: "image/png", dane: bajty(10),
      autor: autor(user), database: d, wgraj: async () => ({ id: `att-${i}` }),
    });
  }
  await assert.rejects(() => dodajZalacznik({
    conversationId: rozmowa, nazwa: "za-duzo.png", typ: "image/png", dane: bajty(10),
    autor: autor(user), database: d, wgraj: async () => ({ id: "att-x" }),
  }), new RegExp(`najwyżej ${MAKS_ZALACZNIKOW}`));
});

test("załączniki są WSPÓLNE dla rozmowy, jak szkic — nie prywatne dla agenta", async () => {
  /* Szkic jest współdzielony z zespołem (§6.4). Plik dołożony przez kolegę ma
     pójść z odpowiedzią tak samo jak jego zdanie w treści. */
  const { d, user, rozmowa } = stanowisko();
  const drugi = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('marek','M. Wójcik','biuro')")
    .run().lastInsertRowid);

  await dodajZalacznik({ conversationId: rozmowa, nazwa: "a.png", typ: "image/png",
    dane: bajty(10), autor: autor(user), database: d, wgraj: async () => ({ id: "att-1" }) });
  await dodajZalacznik({ conversationId: rozmowa, nazwa: "b.png", typ: "image/png",
    dane: bajty(10), autor: { id: drugi, name: "M. Wójcik" }, database: d,
    wgraj: async () => ({ id: "att-2" }) });

  assert.deepEqual(zalacznikiRozmowy(d, rozmowa).map((a) => a.dodal),
    ["A. Lewandowska", "M. Wójcik"]);
});

test("zdjęcie załącznika kasuje nasz wiersz i zostawia ślad w audycie", async () => {
  const { d, user, rozmowa } = stanowisko();
  const z = await dodajZalacznik({
    conversationId: rozmowa, nazwa: "gwint.jpg", typ: "image/jpeg", dane: bajty(10),
    autor: autor(user), database: d, wgraj: async () => ({ id: "att-1" }),
  });

  assert.equal(usunZalacznik(d, rozmowa, z.id, autor(user)), true);
  assert.equal(zalacznikiRozmowy(d, rozmowa).length, 0);
  const slad = d.prepare("SELECT count(*) n FROM events WHERE type='rozmowa_zalacznik_zdjety'")
    .get() as { n: number };
  assert.equal(Number(slad.n), 1);
});

test("zdjęcie cudzego załącznika z INNEJ rozmowy nie przechodzi", async () => {
  /* Numer wiersza sam nie wystarcza: trasa dostaje go z adresu, a adres
     wpisuje człowiek. */
  const { d, user, rozmowa } = stanowisko();
  const inna = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (1,'t-2','Ktoś inny')`).run().lastInsertRowid);
  const z = await dodajZalacznik({
    conversationId: rozmowa, nazwa: "gwint.jpg", typ: "image/jpeg", dane: bajty(10),
    autor: autor(user), database: d, wgraj: async () => ({ id: "att-1" }),
  });

  assert.equal(usunZalacznik(d, inna, z.id, autor(user)), false);
  assert.equal(zalacznikiRozmowy(d, rozmowa).length, 1, "wiersz zostaje przy swojej rozmowie");
});
