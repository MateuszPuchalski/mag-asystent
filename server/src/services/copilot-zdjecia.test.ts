import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { przygotujZdjecia, spisZdjec, SUFIT_ZDJEC } from "./copilot-zdjecia.js";

/* ── Zdjęcia dla Copilota (0.283.0) ──────────────────────────────────────────
   Cztery rzeczy warte testu, bo każda jest granicą, nie wyglądem:

   1. TYP ROZSTRZYGA SYGNATURA, nie nazwa pliku. `faktura.jpg`, która jest
      PDF-em, nie ma prawa pojechać do modelu jako obraz.
   2. ŻADNE POTKNIĘCIE NIE WYWRACA ROZPOZNANIA. Karta bez zdjęć wie mniej;
      brak karty nie mówi agentowi nic.
   3. NUMERY SĄ CHRONOLOGICZNE i zgadzają się ze spisem — bez tego cytat `Z2`
      w karcie przestaje być sprawdzalny.
   4. SUFITU SZTUK NIE MA (decyzja właściciela), ale sufit BAJTÓW jest
      i mówi o sobie.                                                       */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

/* Sygnatury prawdziwe — `rozpoznajMime` czyta bajty, nie nazwę. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from("%PDF-1.7\n", "latin1");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,otwarto_at,synced_at)
    VALUES (?,'i-1','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto).lastInsertRowid);

  const wiadomosc = (n: number) => Number(d.prepare(`INSERT INTO reklamacja_wiadomosc
    (reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
    VALUES (?,?,'BUYER',?,?)`)
    .run(id, `w-${n}`, `wiadomość ${n}`, `2026-09-0${n}T10:00:00Z`).lastInsertRowid);

  const zalacznik = (nazwa: string, wiadomoscId: number | null) =>
    Number(d.prepare(`INSERT INTO reklamacja_zalacznik
      (reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,?,?,?)`)
      .run(id, wiadomoscId, nazwa, `https://allegro.pl/plik/${nazwa}`).lastInsertRowid);

  return { d, id, wiadomosc, zalacznik };
}

/** Atrapa pobierania: mapa nazwy pliku na bajty albo na wyjątek. */
function pobieracz(mapa: Record<string, Buffer | "blad">) {
  const wywolania: string[] = [];
  return {
    wywolania,
    pobierz: async (url: string) => {
      wywolania.push(url);
      const nazwa = url.split("/").pop()!;
      const v = mapa[nazwa];
      if (v === undefined || v === "blad") throw new Error("Allegro nie oddało załącznika");
      return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
    },
  };
}

test("typ rozstrzyga SYGNATURA, nie rozszerzenie w nazwie", async () => {
  /* `faktura.jpg`, która jest PDF-em, nie ma prawa pojechać jako obraz —
     ta sama bramka co przy podglądzie w panelu. */
  const { d, id, zalacznik } = stanowisko();
  zalacznik("usterka.jpg", null);
  zalacznik("faktura.jpg", null);
  const p = pobieracz({ "usterka.jpg": JPEG, "faktura.jpg": PDF });

  const w = await przygotujZdjecia(d, id, p.pobierz);
  assert.equal(w.zdjecia.length, 1);
  assert.equal(w.zdjecia[0].typ, "image/jpeg");
  assert.deepEqual(w.nieObrazy, ["faktura.jpg"]);
});

test("pobranie, które padło, jest LICZONE, a nie rzucane dalej", async () => {
  /* Karta bez jednego zdjęcia wie mniej. Brak karty nie mówi agentowi nic. */
  const { d, id, zalacznik } = stanowisko();
  zalacznik("dobre.png", null);
  zalacznik("padnie.png", null);
  const p = pobieracz({ "dobre.png": PNG, "padnie.png": "blad" });

  const w = await przygotujZdjecia(d, id, p.pobierz);
  assert.equal(w.zdjecia.length, 1);
  assert.equal(w.bledow, 1);
});

test("gdy padną WSZYSTKIE, wynik jest pusty — nadal bez wyjątku", async () => {
  const { d, id, zalacznik } = stanowisko();
  zalacznik("a.png", null);
  const p = pobieracz({ "a.png": "blad" });

  const w = await przygotujZdjecia(d, id, p.pobierz);
  assert.deepEqual(w.zdjecia, []);
  assert.equal(w.bledow, 1);
});

test("numery są CHRONOLOGICZNE i zgadzają się ze spisem", async () => {
  /* Cytat `Z2` w karcie ma wskazywać ten sam plik, co `Z2` w spisie —
     inaczej agent nie ma jak go sprawdzić. */
  const { d, id, wiadomosc, zalacznik } = stanowisko();
  const w1 = wiadomosc(1);
  const w3 = wiadomosc(3);
  zalacznik("stare.jpg", w1);
  zalacznik("nowe.png", w3);
  const p = pobieracz({ "stare.jpg": JPEG, "nowe.png": PNG });

  const w = await przygotujZdjecia(d, id, p.pobierz);
  assert.deepEqual(w.zdjecia.map((z) => [z.numer, z.nazwa]),
    [["Z1", "stare.jpg"], ["Z2", "nowe.png"]]);

  const spis = spisZdjec(w);
  assert.ok(spis.includes("[Z1] plik: stare.jpg"));
  assert.ok(spis.includes("[Z2] plik: nowe.png"));
});

test("spis MÓWI o plikach, których nie pokazał", async () => {
  /* Bez tego wiersza model nie ma jak napisać w „brakuje", że przysłany
     dokument jest nieczytelny jako zdjęcie. */
  const { d, id, zalacznik } = stanowisko();
  zalacznik("gwarancja.pdf", null);
  const p = pobieracz({ "gwarancja.pdf": PDF });

  const spis = spisZdjec(await przygotujZdjecia(d, id, p.pobierz));
  assert.ok(spis.includes("Nie pokazano, bo nie są obrazem: gwarancja.pdf"));
});

test("bez załączników spis jest PUSTY, a nie pustym nagłówkiem", async () => {
  const { d, id } = stanowisko();
  const w = await przygotujZdjecia(d, id, async () => { throw new Error("nie wołać"); });
  assert.deepEqual(w.zdjecia, []);
  assert.equal(spisZdjec(w), "");
});

test("sufit BAJTÓW tnie komplet i mówi, ile zostało poza", async () => {
  /* Sufitu SZTUK nie ma — właściciel wybrał wszystkie zdjęcia sprawy, znając
     koszt. Sufit bajtów zostaje, bo bez niego żądanie nie przejdzie. */
  const { d, id, zalacznik } = stanowisko();
  const duze = Buffer.concat([PNG, Buffer.alloc(SUFIT_ZDJEC.lacznie - 8)]);
  zalacznik("pierwsze.png", null);
  zalacznik("drugie.png", null);
  const p = pobieracz({ "pierwsze.png": duze, "drugie.png": PNG });

  const w = await przygotujZdjecia(d, id, p.pobierz);
  assert.equal(w.zdjecia.length, 1);
  assert.equal(w.pominieto, 1);
  assert.ok(spisZdjec(w).includes("Nie pokazano z braku miejsca: 1"));
});

test("każde pobranie niesie sufit na sztukę — inaczej plik wchodzi w całości do RAM", async () => {
  const { d, id, zalacznik } = stanowisko();
  zalacznik("a.png", null);
  let opcje: unknown = null;
  await przygotujZdjecia(d, id, async (_url, o) => {
    opcje = o;
    return PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) as ArrayBuffer;
  });
  assert.deepEqual(opcje, { maksBajtow: SUFIT_ZDJEC.naSztuke });
});
