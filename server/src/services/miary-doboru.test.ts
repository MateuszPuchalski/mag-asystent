import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import { miaryDoboru } from "./miary-doboru.js";

/* ── Miary doboru: z dziennika, ostatni wynik każdej rozmowy ─────────────────
   Pilnujemy trzech rzeczy: rozmowa liczy się raz, ostatnim wynikiem w oknie;
   skasowana rozmowa nie zmienia liczb (dziennik przeżywa retencję); stan
   „otwarty" liczy się z tabeli, bo to pytanie o dziś.                      */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

const wynik = (d: DatabaseSync, rozmowa: number, po: string | null, podstawa: string | null = null, kiedy = "+0 days") =>
  d.prepare(`INSERT INTO events(type,payload,user_id,created_at)
    VALUES ('dobor_wynik',?,'Ala',strftime('%Y-%m-%dT%H:%M:%fZ','now',?))`)
    .run(JSON.stringify({ conversationId: rozmowa, przed: null, po, podstawa }), kiedy);

test("każda rozmowa liczy się raz, ostatnim wynikiem w oknie; podstawy tylko przy „ta część”", () => {
  const d = baza();
  wynik(d, 1, "czesc", "podobne");
  wynik(d, 1, "czesc", "numer"); // agent zmienił zdanie — liczy się ostatnie
  wynik(d, 2, "brak");
  wynik(d, 3, "czesc", "wiedza");
  wynik(d, 3, null); // otwarty ponownie — to nie odpowiedź
  wynik(d, 4, "dopytac");
  wynik(d, 5, "czesc", "reczny", "-40 days"); // poza oknem 30 dni
  const m = miaryDoboru(30, d);
  assert.equal(m.dni, 30);
  assert.deepEqual(m.wyniki, { czesc: 1, brak: 1, dopytac: 1, nie_dotyczy: 0 });
  assert.deepEqual(m.podstawy, { numer: 1, wiedza: 0, podobne: 0, reczny: 0 });
  assert.deepEqual(miaryDoboru(90, d).podstawy, { numer: 1, wiedza: 0, podobne: 0, reczny: 1 });
  d.close();
});

test("otwarte liczą się z tabeli: dane bez wyniku; pusty dobór i wynik się nie liczą", () => {
  const d = baza();
  d.exec("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a')");
  for (let i = 1; i <= 3; i++) {
    d.prepare("INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,?)").run(`w-${i}`);
  }
  d.prepare("INSERT INTO dobor(conversation_id,marka) VALUES (1,'NAC')").run();
  d.prepare("INSERT INTO dobor(conversation_id) VALUES (2)").run();
  d.prepare("INSERT INTO dobor(conversation_id,marka,wynik) VALUES (3,'NAC','brak')").run();
  assert.equal(miaryDoboru(7, d).otwarte, 1);
  /* Retencja kasuje rozmowę z kaskadą — wyniki z dziennika zostają. */
  wynik(d, 3, "brak");
  d.exec("PRAGMA foreign_keys = ON");
  d.prepare("DELETE FROM conversation WHERE id=3").run();
  assert.equal(miaryDoboru(7, d).wyniki.brak, 1);
  d.close();
});
