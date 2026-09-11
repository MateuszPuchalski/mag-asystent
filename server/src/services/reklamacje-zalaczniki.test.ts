import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  dodajZalacznikSprawy, usunZalacznikSprawy, zalacznikiDoWyslania,
} from "./reklamacje-zalaczniki.js";

/* ── Załączniki wychodzące w sprawie (0.274.0) ───────────────────────────────
   Trzy rzeczy warte testu, bo każda kosztowałaby plik u kupującego:

   1. WALIDACJA PRZED SIECIĄ. Odmowa typu albo rozmiaru ma paść przy wybieraniu
      pliku, a nie po wgraniu czterech megabajtów.
   2. WIERSZ DOPIERO PO UDANYM WGRANIU. Wiersz bez pliku po tamtej stronie
      obiecywałby wysyłce załącznik, którego Allegro nie zna.
   3. DZIENNIK NIE NIESIE BAJTÓW. Nazwa, typ i rozmiar — tyle.               */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  /* Użytkownik PRZED załącznikiem: `dodal_user_id` wskazuje `app_user` bez
     kaskady, więc bez tego wiersza klucz obcy wywraca każdy zapis. */
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','Ala','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const reklamacja = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,otwarto_at,synced_at)
    VALUES (?,'i-1','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto).lastInsertRowid);
  return { d, reklamacja };
}

const autor = { id: 1, name: "Ala" };
const plik = (n = 64) => new Uint8Array(n).fill(7);

/** Atrapa wgrania: zbiera wywołania i oddaje kolejne numery. */
function wgrywacz() {
  const wywolania: Array<{ nazwa: string; typ: string; bajtow: number }> = [];
  let i = 0;
  return {
    wywolania,
    wgraj: async (nazwa: string, typ: string, dane: Uint8Array) => {
      wywolania.push({ nazwa, typ, bajtow: dane.byteLength });
      i += 1;
      return { id: `att-${i}` };
    },
  };
}

test("plik idzie do Allegro OD RAZU, a wiersz powstaje po udanym wgraniu", async () => {
  const { d, reklamacja } = stanowisko();
  const w = wgrywacz();

  const z = await dodajZalacznikSprawy({
    reklamacjaId: reklamacja, nazwa: "usterka.jpg", typ: "image/jpeg",
    dane: plik(128), autor, database: d, wgraj: w.wgraj,
  });

  assert.deepEqual(w.wywolania, [{ nazwa: "usterka.jpg", typ: "image/jpeg", bajtow: 128 }]);
  assert.equal(z.allegroId, "att-1");
  assert.equal(zalacznikiDoWyslania(d, reklamacja).length, 1);

  /* Dziennik: nazwa, typ i rozmiar — nigdy bajty. */
  const zdarzenie = d.prepare(
    "SELECT payload FROM events WHERE type='reklamacja_zalacznik_dodany'").get() as
    { payload: string };
  const p = JSON.parse(zdarzenie.payload) as Record<string, unknown>;
  assert.equal(p.nazwa, "usterka.jpg");
  assert.equal(p.rozmiar, 128);
  assert.ok(!JSON.stringify(p).includes("dane"), "bajty nie idą do dziennika");
});

test("odmowa typu i rozmiaru pada PRZED siecią, bez wiersza i bez żądania", async () => {
  const { d, reklamacja } = stanowisko();
  const w = wgrywacz();
  const zadanie = (n: Partial<{ nazwa: string; typ: string; dane: Uint8Array }>) => ({
    reklamacjaId: reklamacja, nazwa: "usterka.jpg", typ: "image/jpeg",
    dane: plik(), autor, database: d, wgraj: w.wgraj, ...n,
  });

  await assert.rejects(() => dodajZalacznikSprawy(zadanie({ typ: "image/webp" })),
    /image\/webp|PNG|przyjmuje/);
  await assert.rejects(() => dodajZalacznikSprawy(zadanie({ dane: new Uint8Array(0) })),
    /Pusty plik/);
  await assert.rejects(() => dodajZalacznikSprawy(
    zadanie({ dane: new Uint8Array(5 * 1024 * 1024) })), /MB/);
  await assert.rejects(() => dodajZalacznikSprawy(zadanie({ nazwa: "   " })), /nazwy pliku/);

  assert.deepEqual(w.wywolania, [], "żaden odrzucony plik nie poszedł do Allegro");
  assert.equal(zalacznikiDoWyslania(d, reklamacja).length, 0);
});

test("piąty plik wchodzi, szósty dostaje zdanie z liczbą", async () => {
  const { d, reklamacja } = stanowisko();
  const w = wgrywacz();
  const dodaj = () => dodajZalacznikSprawy({
    reklamacjaId: reklamacja, nazwa: "usterka.jpg", typ: "image/jpeg",
    dane: plik(), autor, database: d, wgraj: w.wgraj,
  });
  for (let i = 0; i < 5; i++) await dodaj();
  await assert.rejects(dodaj, /najwyżej 5/);
  assert.equal(w.wywolania.length, 5, "szósty nie poszedł do Allegro");
});

test("zdjęcie kasuje NASZ wiersz i mówi, gdy nie ma czego zdejmować", async () => {
  /* Deklaracji po stronie Allegro cofnąć się nie da — nie ma takiej końcówki —
     więc ekran nie ma prawa obiecywać, że „usunięto go z Allegro". */
  const { d, reklamacja } = stanowisko();
  const w = wgrywacz();
  const z = await dodajZalacznikSprawy({
    reklamacjaId: reklamacja, nazwa: "usterka.jpg", typ: "image/jpeg",
    dane: plik(), autor, database: d, wgraj: w.wgraj,
  });

  assert.equal(usunZalacznikSprawy(d, reklamacja, z.id, autor), true);
  assert.equal(zalacznikiDoWyslania(d, reklamacja).length, 0);
  assert.equal(usunZalacznikSprawy(d, reklamacja, z.id, autor), false);
  const sladow = d.prepare(
    "SELECT count(*) n FROM events WHERE type='reklamacja_zalacznik_zdjety'").get() as { n: number };
  assert.equal(Number(sladow.n), 1, "ślad zostaje raz, nie przy każdej próbie");
});

test("cudzej sprawy nie da się okraść z załącznika po samym numerze", async () => {
  const { d, reklamacja } = stanowisko();
  const obca = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,otwarto_at,synced_at)
    VALUES (1,'i-2','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`).run().lastInsertRowid);
  const w = wgrywacz();
  const z = await dodajZalacznikSprawy({
    reklamacjaId: reklamacja, nazwa: "usterka.jpg", typ: "image/jpeg",
    dane: plik(), autor, database: d, wgraj: w.wgraj,
  });

  assert.equal(usunZalacznikSprawy(d, obca, z.id, autor), false,
    "numer załącznika nie wystarcza za uprawnienie do sprawy");
  assert.equal(zalacznikiDoWyslania(d, reklamacja).length, 1);
});
