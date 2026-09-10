import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { naTekst, zbierzTresc, trzebaTresci, dociagnijTresc } from "./allegro-oferta-tresc.js";

/* ── Treść oferty dla Copilota (0.253.0) ─────────────────────────────────────
   Testy pilnują TRZECH rzeczy, z których każda kosztowałaby osobno.

   Kształt: opis Allegro jedzie HTML-em w sekcjach, a lista zgodności ma dwie
   odmiany. Rozbiór sprawdzamy na kształcie ze `swagger.yaml`, nie na tym, co
   pamiętamy z panelu sprzedawcy.

   Koszt: ta końcówka to jedno żądanie NA OFERTĘ. Test liczy żądania, bo
   pomyłka w warunku świeżości nie widać na ekranie — widać ją na rachunku.

   Odporność: odmowa Allegro nie ma prawa wywrócić szkicu.                    */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.prepare("INSERT INTO channel_account(id, channel, external_account_id) VALUES (1,'allegro','k')").run();
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id, external_id, nazwa, synced_at)
    VALUES (1,'12345','Gaźnik do pilarki', '2026-09-01T10:00:00Z')`).run();
  return d;
}

test("HTML opisu schodzi do tekstu, a listy zostają listami", () => {
  const html = "<h2>Dane techniczne</h2><p>Średnica: 46&nbsp;mm</p>"
    + "<ul><li>wysoko&sacute;&cacute; 12 mm</li><li>gwint M10</li></ul>";
  assert.equal(naTekst(html), "Dane techniczne\nŚrednica: 46 mm\n- wysokość 12 mm\n- gwint M10");
});

test("znacznik obrazu i skrypt nie zostawiają śmieci w tekście", () => {
  assert.equal(naTekst("<script>var x=1;</script><p>Pasuje do 340</p>"), "Pasuje do 340");
  assert.equal(naTekst("<img src=\"x.jpg\"/><p>Wymiar 148 mm</p>"), "Wymiar 148 mm");
});

test("rozbiór bierze opis, parametry i listę zgodności ze schematu", () => {
  const t = zbierzTresc({
    description: {
      sections: [
        { items: [{ type: "TEXT", content: "<p>Pasuje do modeli 340, 345, 350.</p>" }] },
        /* Sekcja obrazkowa: schemat dopuszcza `IMAGE` obok `TEXT`. */
        { items: [{ type: "IMAGE", url: "https://a.allegroimg.com/x" }] },
        { items: [{ type: "TEXT", content: "<p>Wa&#322;ek 8 mm.</p>" }] },
      ],
    },
    parameters: [
      { name: "Kod producenta", values: ["503 28 32-08"] },
      /* Parametr bez wartości to pole niewypełnione — nie ma czego pokazać. */
      { name: "Waga", values: [] },
    ],
    compatibilityList: { items: [{ text: "HUSQVARNA 340 (1995-2005)" }, { id: "abc" } as never] },
  });

  assert.equal(t.opis, "Pasuje do modeli 340, 345, 350.\n\nWałek 8 mm.");
  assert.deepEqual(t.parametry, [{ nazwa: "Kod producenta", wartosci: ["503 28 32-08"] }]);
  assert.deepEqual(t.pasujeDo, ["HUSQVARNA 340 (1995-2005)"]);
});

test("pusta odpowiedź nie wywraca rozbioru", () => {
  assert.deepEqual(zbierzTresc(null), { opis: "", parametry: [], pasujeDo: [] });
  assert.deepEqual(zbierzTresc({}), { opis: "", parametry: [], pasujeDo: [] });
});

test("oferta bez snapshotu nie kosztuje żądania", async () => {
  const d = baza();
  let strzalow = 0;
  const poszlo = await dociagnijTresc(1, "nie-ma-takiej", {
    database: d, query: async () => { strzalow += 1; return {}; },
  });
  assert.equal(poszlo, false);
  assert.equal(strzalow, 0, "poszliśmy po ofertę, której nie mamy gdzie zapisać");
});

test("treść dociąga się RAZ, a drugi szkic w tym tygodniu nie kosztuje nic", async () => {
  const d = baza();
  let strzalow = 0;
  const query = async () => {
    strzalow += 1;
    return { description: { sections: [{ items: [{ type: "TEXT", content: "<p>Pasuje do 340</p>" }] }] } };
  };
  const teraz = new Date("2026-09-10T10:00:00Z");

  assert.equal(await dociagnijTresc(1, "12345", { database: d, query, now: () => teraz }), true);
  assert.equal(await dociagnijTresc(1, "12345", { database: d, query, now: () => teraz }), false);
  assert.equal(strzalow, 1, "druga próba poszła do sieci mimo świeżego opisu");

  const w = d.prepare("SELECT opis, tresc_synced_at FROM offer_snapshot").get() as
    { opis: string; tresc_synced_at: string };
  assert.equal(w.opis, "Pasuje do 340");
  assert.equal(w.tresc_synced_at, teraz.toISOString());
});

test("po tygodniu treść odświeża się sama", async () => {
  const d = baza();
  d.prepare("UPDATE offer_snapshot SET opis='stary', tresc_synced_at='2026-09-01T10:00:00Z'").run();
  assert.equal(trzebaTresci(d, 1, "12345", new Date("2026-09-05T10:00:00Z")), false);
  assert.equal(trzebaTresci(d, 1, "12345", new Date("2026-09-09T10:00:00Z")), true);
});

test("oferta BEZ opisu też zapamiętuje, że pytaliśmy", async () => {
  /* Inaczej każda oferta bez opisu kosztowałaby żądanie przy każdym szkicu —
     ta sama blizna, którą zdjęcie listingowe kupiło w 0.214.0. */
  const d = baza();
  let strzalow = 0;
  const query = async () => { strzalow += 1; return {}; };
  const teraz = new Date("2026-09-10T10:00:00Z");

  await dociagnijTresc(1, "12345", { database: d, query, now: () => teraz });
  await dociagnijTresc(1, "12345", { database: d, query, now: () => teraz });

  assert.equal(strzalow, 1);
  const w = d.prepare("SELECT opis, tresc_synced_at FROM offer_snapshot").get() as
    { opis: string; tresc_synced_at: string | null };
  assert.equal(w.opis, "");
  assert.ok(w.tresc_synced_at, "brak znacznika pytania przy ofercie bez opisu");
});

test("odmowa Allegro nie psuje snapshotu i nie udaje, że pytaliśmy", async () => {
  const d = baza();
  const poszlo = await dociagnijTresc(1, "12345", {
    database: d, query: async () => { throw new Error("500 z Allegro"); },
  });
  assert.equal(poszlo, false);
  const w = d.prepare("SELECT nazwa, opis, tresc_synced_at FROM offer_snapshot").get() as
    { nazwa: string; opis: string | null; tresc_synced_at: string | null };
  assert.equal(w.nazwa, "Gaźnik do pilarki", "odmowa ruszyła tytuł");
  assert.equal(w.tresc_synced_at, null, "odmowa zapisała się jako udane pytanie");
});
