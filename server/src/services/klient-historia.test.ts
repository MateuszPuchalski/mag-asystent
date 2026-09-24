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
let historiaSprawy: typeof import("./klient-historia.js").historiaSprawy;

let konto = 0;
let biezaca = 0;
let starsza = 0;
let obca = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ historiaKlienta, historiaSprawy } = await import("./klient-historia.js"));
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

function zwrotKlienta(login: string, numer: string, kiedy: string): number {
  return Number(db().prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,
    reference_number,order_id,kupujacy_login,created_at,synced_at)
    VALUES (?,?,?,'ord-1',?,?,?)`).run(konto, `zw-${numer}`, numer, login, kiedy, kiedy)
    .lastInsertRowid);
}

function sprawaKlienta(login: string, typ: string, temat: string, kiedy: string): number {
  return Number(db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
    reference_number,order_id,kupujacy_login,typ,temat,otwarto_at,synced_at)
    VALUES (?,?,?,'ord-1',?,?,?,?,?)`)
    .run(konto, `sp-${typ}-${kiedy}`, typ === "CLAIM" ? "9/2026" : null, login, typ, temat,
      kiedy, kiedy).lastInsertRowid);
}

beforeEach(() => {
  const d = db();
  for (const t of ["dobor_rozmowy", "zamowienie_klienta_pozycja", "zamowienie_klienta",
    "reklamacja_klienta", "zwrot_klienta",
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

/* ── S2 spoiwa: historia przestaje pomijać trzy kolejki z czterech ───────────
   Do tego wydania zakładka obiecywała historię klienta, a znała wyłącznie
   zakupy i rozmowy. Agent czytał „nic się nie działo" o kliencie, który
   miesiąc wcześniej odesłał towar i złożył reklamację.                      */

test("zwrot, reklamacja i dyskusja wchodzą na oś historii klienta", () => {
  const zw = zwrotKlienta("zielony_ogrod", "Z-77", "2026-08-10T08:00:00.000Z");
  const rek = sprawaKlienta("zielony_ogrod", "CLAIM", "Nie działa", "2026-08-12T08:00:00.000Z");
  const dys = sprawaKlienta("zielony_ogrod", "DISPUTE", "Gdzie paczka", "2026-08-11T08:00:00.000Z");

  const wpisy = historiaKlienta(biezaca).wpisy;
  const wg = (r: string) => wpisy.find((w) => w.rodzaj === r);
  assert.equal(wg("zwrot")!.sprawaId, zw);
  assert.equal(wg("reklamacja")!.sprawaId, rek);
  assert.equal(wg("dyskusja")!.sprawaId, dys);
  /* Oś jest jedna i ułożona czasem — najnowsze u góry, jak zakupy i rozmowy. */
  assert.deepEqual(
    wpisy.filter((w) => w.sprawaId !== null).map((w) => w.rodzaj),
    ["reklamacja", "dyskusja", "zwrot"]);
});

test("zwrot i sprawa CUDZEGO klienta nie wchodzą do tej historii", () => {
  zwrotKlienta("kto_inny", "Z-88", "2026-08-10T08:00:00.000Z");
  sprawaKlienta("kto_inny", "CLAIM", "Nie moja sprawa", "2026-08-12T08:00:00.000Z");

  assert.deepEqual(historiaKlienta(biezaca).wpisy.filter((w) => w.sprawaId !== null), []);
});

test("dyskusja bez tematu bierze podpis, a nie pustą linię", () => {
  sprawaKlienta("zielony_ogrod", "DISPUTE", "", "2026-08-11T08:00:00.000Z");

  const w = historiaKlienta(biezaca).wpisy.find((x) => x.rodzaj === "dyskusja")!;
  assert.equal(w.tresc, "Sprawa bez tematu");
});

/* ── Historia ze zwrotu i ze sprawy (23 września 2026) ───────────────────────
   Login bierze się z SAMEJ sprawy. Rozmowy dochodzą numerem zamówienia
   i — od 24 września 2026 — loginem rozmówcy z wątku, bez wielkości liter. */
test("ze zwrotu: zakupy, sprawy i rozmowy obiema drogami, bez samego zwrotu", () => {
  zakup("chips20", "ord-1", "Nóż kosiarki", "2026-09-01T10:00:00Z");
  const poNumerze = rozmowa("w-num", null, "gdzie paczka", "2026-09-02T10:00:00Z");
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_order_id,sent_at) VALUES (?,?,'m-n','incoming','?','ord-1','2026-09-02T10:00:00Z')`).run(poNumerze, konto);
  /* Wielka litera celowo: wątek i zamówienie potrafią zapisać login różnie. */
  const poLoginie = rozmowa("w-log", "Chips20", "inne pytanie", "2026-09-03T10:00:00Z");
  const zw = zwrotKlienta("chips20", "ZW-1", "2026-09-05T10:00:00Z");
  const rk = sprawaKlienta("chips20", "CLAIM", "Pęknięty", "2026-09-06T10:00:00Z");
  zwrotKlienta("obcy", "ZW-2", "2026-09-07T10:00:00Z");

  const h = historiaSprawy("zwrot", zw, db());
  assert.equal(h.login, "chips20");
  const rodzaje = h.wpisy.map((w) => `${w.rodzaj}:${w.rozmowaId ?? w.sprawaId ?? w.zamowienieId}`);
  assert.ok(rodzaje.includes(`rozmowa:${poNumerze}`));
  assert.ok(rodzaje.includes(`rozmowa:${poLoginie}`), "pytanie bez numeru zamówienia, po loginie z wątku");
  assert.ok(rodzaje.includes(`reklamacja:${rk}`));
  assert.ok(rodzaje.includes("zakup:ord-1"));
  assert.ok(!rodzaje.includes(`zwrot:${zw}`), "bieżący zwrot stoi obok");
  assert.equal(h.wpisy.filter((w) => w.rodzaj === "zwrot").length, 0, "cudzy zwrot nie wchodzi");

  const zReklamacji = historiaSprawy("sprawa", rk, db());
  assert.ok(zReklamacji.wpisy.some((w) => w.rodzaj === "zwrot" && w.sprawaId === zw));
  assert.ok(!zReklamacji.wpisy.some((w) => w.rodzaj === "reklamacja" && w.sprawaId === rk));
});

test("sprawa bez loginu kupującego daje pustą historię", () => {
  const rk = sprawaKlienta("", "DISPUTE", "x", "2026-09-06T10:00:00Z");
  assert.deepEqual(historiaSprawy("sprawa", rk, db()).wpisy, []);
});

/* ── Login bez wielkości liter (24 września 2026) ────────────────────────────
   Zakładka KLIENT porównywała login dokładnie, a wątek i zamówienie potrafią
   zapisać go różnie. Klient, który u nas kupował, dostawał pustą historię. */
test("login z wątku różny wielkością liter od zamówienia dalej znajduje zakupy i rozmowy", () => {
  const moja = rozmowa("w-case", "Client:44300444", "pytanie", "2026-09-05T10:00:00Z");
  const druga = rozmowa("w-case-2", "client:44300444", "wcześniejsze", "2026-09-01T10:00:00Z");
  zakup("client:44300444", "ord-case", "Filtr powietrza", "2026-09-02T10:00:00Z");
  const h = historiaKlienta(moja, db());
  assert.ok(h.wpisy.some((w) => w.rodzaj === "zakup" && w.zamowienieId === "ord-case"));
  assert.ok(h.wpisy.some((w) => w.rodzaj === "rozmowa" && w.rozmowaId === druga));
});
