import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-klient-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Historia klienta (§10.1, zakładka KLIENT) ───────────────────────────────
   Zakładka jest ODCZYTEM po loginie kupującego i te testy pilnują trzech
   granic, które o tym stanowią: skąd bierze się login, co liczy się jako
   „maszyna ustalona" i czego na osi NIE MA.

   Czwarta granica jest najważniejsza i najłatwiejsza do zgubienia przy
   pierwszym refaktorze: rozmowa CUDZEGO klienta nie ma prawa wejść do
   historii tego. Pomyłka w warunku złączenia pokazałaby biuru zakupy obcej
   osoby pod nazwiskiem, które ma przed oczami.                              */

let db: typeof import("../db/db.js").db;
let historiaKlienta: typeof import("./klient-historia.js").historiaKlienta;

let konto = 0;
let biezaca = 0;
let starsza = 0;
let obca = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ historiaKlienta } = await import("./klient-historia.js"));
});

/** Rozmowa razem z jej wątkiem — login mieszka w lądowisku, nie w rozmowie. */
function rozmowa(watek: string, login: string | null, temat: string, kiedy: string): number {
  const d = db();
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES (?,0,?,'{}',?)`).run(watek, login, kiedy);
  return Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject,updated_at) VALUES (?,?,?,?)`)
    .run(konto, watek, temat, kiedy).lastInsertRowid);
}

function dobor(rozmowaId: number, marka: string, model: string, kiedy: string,
  extra: { status?: string; silnik?: string; rocznik?: string } = {}): void {
  db().prepare(`INSERT INTO dobor_rozmowy(conversation_id,status,marka,model,rocznik,silnik,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(rozmowaId, extra.status ?? "confirmed", marka, model,
    extra.rocznik ?? null, extra.silnik ?? null, kiedy);
}

function zakup(login: string, externalId: string, nazwa: string, kiedy: string): void {
  const d = db();
  const id = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,
    kupujacy_login,kupiono_at,synced_at) VALUES (?,?,?,?,?)`)
    .run(konto, externalId, login, kiedy, kiedy).lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,?,1,1000,'PLN')`).run(id, nazwa);
}

beforeEach(() => {
  const d = db();
  for (const t of ["dobor_rozmowy", "zamowienie_klienta_pozycja", "zamowienie_klienta",
    "message", "conversation", "allegro_inbox_thread", "channel_account", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);

  biezaca = rozmowa("w-3140b", "zielony_ogrod", "Szarpak do kosiarki", "2026-09-01T10:00:00.000Z");
  starsza = rozmowa("w-3140", "zielony_ogrod", "ustalono model kosiarki i kod silnika",
    "2024-06-14T09:00:00.000Z");
  obca = rozmowa("w-999", "kto_inny", "Nóż do innej maszyny", "2025-01-01T09:00:00.000Z");
});

test("maszynę widać z rozmową, w której ją ustalono", () => {
  dobor(starsza, "NAC", "LS 46-450", "2024-06-14T09:30:00.000Z",
    { rocznik: "2019", silnik: "1P70FV" });

  const h = historiaKlienta(biezaca);
  assert.equal(h.login, "zielony_ogrod");
  assert.equal(h.maszyny.length, 1);
  assert.deepEqual(
    { marka: h.maszyny[0].marka, nazwa: h.maszyny[0].nazwa, rocznik: h.maszyny[0].rocznik,
      silnik: h.maszyny[0].silnik, rozmowaId: h.maszyny[0].rozmowaId },
    { marka: "NAC", nazwa: "LS 46-450", rocznik: "2019", silnik: "1P70FV", rozmowaId: starsza },
  );
});

test("dobór w trakcie NIE jest ustaleniem — maszyna wchodzi dopiero z domknięciem", () => {
  /* Agent wpisuje markę, zanim cokolwiek ustali. Gdyby liczył się każdy
     dobór z marką, zakładka mówiłaby „klient ma taką maszynę" o zgadywance
     sprzed pięciu minut. */
  dobor(starsza, "NAC", "LS 46-450", "2024-06-14T09:30:00.000Z", { status: "searching" });
  assert.deepEqual(historiaKlienta(biezaca).maszyny, []);
});

test("ta sama maszyna w dwóch rozmowach zostaje jedna, z NAJSTARSZĄ", () => {
  /* Pytanie brzmi „od kiedy to wiemy", nie „gdzie ostatnio padło". */
  dobor(starsza, "NAC", "LS 46-450", "2024-06-14T09:30:00.000Z");
  dobor(biezaca, "nac", "ls 46-450", "2026-09-01T10:30:00.000Z");

  const m = historiaKlienta(biezaca).maszyny;
  assert.equal(m.length, 1, "wielkość liter nie robi drugiej maszyny");
  assert.equal(m[0].rozmowaId, starsza);
});

test("oś niesie zakupy i wcześniejsze rozmowy, od najnowszych", () => {
  zakup("zielony_ogrod", "2024/06/1183", "Szarpak SZR-148/82", "2024-06-14T12:00:00.000Z");
  zakup("zielony_ogrod", "2023/03/0410", "Nóż NZ-460/18", "2023-03-02T12:00:00.000Z");

  const w = historiaKlienta(biezaca).wpisy;
  assert.deepEqual(w.map((x) => x.rodzaj), ["zakup", "rozmowa", "zakup"]);
  assert.match(w[0].tresc, /SZR-148\/82/);
  assert.equal(w[0].zamowienieId, "2024/06/1183");
  assert.equal(w[1].rozmowaId, starsza);
});

test("bieżącej rozmowy na osi NIE MA — stoi otwarta obok", () => {
  const w = historiaKlienta(biezaca).wpisy;
  assert.equal(w.some((x) => x.rozmowaId === biezaca), false);
});

test("cudzy klient nie wchodzi do historii tego", () => {
  /* Pomyłka w warunku złączenia pokazałaby biuru zakupy obcej osoby pod
     nazwiskiem, które ma przed oczami — dlatego osobny test, nie asercja
     doklejona do innego. */
  zakup("kto_inny", "2025/01/0001", "Nóż NZ-999", "2025-01-01T12:00:00.000Z");
  dobor(obca, "STIHL", "FS 350", "2025-01-01T12:30:00.000Z");

  const h = historiaKlienta(biezaca);
  assert.deepEqual(h.maszyny, []);
  assert.deepEqual(h.wpisy.filter((w) => w.rodzaj === "zakup"), []);
  assert.equal(h.wpisy.some((w) => w.rozmowaId === obca), false);
});

test("wątek bez loginu daje pustą historię, nie zgadywanie", () => {
  const bezLoginu = rozmowa("w-anon", null, "Pytanie bez konta", "2026-09-02T10:00:00.000Z");
  zakup("zielony_ogrod", "2024/06/1183", "Szarpak SZR-148/82", "2024-06-14T12:00:00.000Z");

  assert.deepEqual(historiaKlienta(bezLoginu), { login: null, maszyny: [], wpisy: [] });
});
