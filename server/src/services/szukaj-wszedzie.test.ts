import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Ctrl+K: jedno szukanie ponad kolejkami (23 września 2026) ───────────────
   Pilnujemy trzech rzeczy. Numer zamówienia prowadzi do WSZYSTKICH spraw tego
   zakupu, także rozmowy. Login kupującego trafia też w rozmowę po loginie
   rozmówcy, bez wielkości liter — od 24 września 2026, gdy właściciel
   potwierdził, że to ten sam login. Szukanie niczego nie zapisuje. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szukaj-")), "t.db");

let db: typeof import("../db/db.js").db;
let S: typeof import("./szukaj-wszedzie.js");
let konto = 0;
let rozmowaZamowienia = 0;
let rozmowaPoLoginie = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./szukaj-wszedzie.js");
  const d = db();
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-s')").run().lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,kupujacy_login,kupiono_at,
      przesylka_waybill,odbiorca_telefon_cyfry,synced_at)
    VALUES (?,'29f8e1a0-aaaa-bbbb','chips20','2026-09-01T10:00:00Z','AD123456789','48600111222','2026-09-01')`)
    .run(konto);
  rozmowaZamowienia = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
      subject,updated_at) VALUES (?,'w-zam','gdzie paczka','2026-09-02T10:00:00Z')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
      related_order_id,sent_at) VALUES (?,?,'m-z','incoming','gdzie paczka?','29f8e1a0-aaaa-bbbb','2026-09-02T10:00:00Z')`)
    .run(rozmowaZamowienia, konto);
  /* Rozmowa, której wątek ma TEN SAM login rozmówcy, ale żadnego numeru zamówienia. */
  rozmowaPoLoginie = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
      subject,updated_at) VALUES (?,'w-login','pytanie o nóż','2026-09-03T10:00:00Z')`).run(konto).lastInsertRowid);
  d.prepare("INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at) VALUES ('w-login',1,'chips20','{}','2026-09-03')").run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,created_at,
      waybill,kupujacy_login,synced_at) VALUES (?,'z-1','ZW-7788','29f8e1a0-aaaa-bbbb','2026-09-05T10:00:00Z','RET9988776','chips20','x')`)
    .run(konto);
  d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,reference_number,order_id,
      kupujacy_login,typ,temat,otwarto_at,synced_at) VALUES (?,'r-1','RK-1','29f8e1a0-aaaa-bbbb','chips20','CLAIM',
      'Nóż pęknięty','2026-09-06T10:00:00Z','x')`).run(konto);
  d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,reference_number,order_id,
      kupujacy_login,typ,temat,otwarto_at,synced_at) VALUES (?,'r-2',NULL,'inne-zamowienie-1','ktos','DISPUTE',
      'Brak paczki','2026-09-07T10:00:00Z','x')`).run(konto);
});

const rodzaje = (t: Array<{ rodzaj: string; id: string }>) => t.map((x) => `${x.rodzaj}:${x.id}`).sort();

test("numer zamówienia prowadzi do zakupu, rozmowy, zwrotu i reklamacji naraz", () => {
  const t = S.szukajWszedzie("29f8e1a0", null, db());
  const r = rodzaje(t);
  assert.ok(r.includes(`rozmowa:${rozmowaZamowienia}`), "rozmowa po related_order_id");
  assert.ok(r.includes("zamowienie:29f8e1a0-aaaa-bbbb"));
  assert.ok(t.some((x) => x.rodzaj === "zwrot"));
  assert.ok(t.some((x) => x.rodzaj === "reklamacja" && x.cel?.startsWith("/obsluga/reklamacje/")));
  assert.ok(!t.some((x) => x.rodzaj === "dyskusja"), "cudze zamówienie nie trafia");
});

test("login kupującego trafia w rozmowę po loginie rozmówcy, bez wielkości liter", () => {
  const t = S.szukajWszedzie("CHIPS20", null, db());
  const r = rodzaje(t);
  assert.ok(r.includes(`rozmowa:${rozmowaZamowienia}`), "przez zamówienie tego loginu");
  assert.ok(r.includes(`rozmowa:${rozmowaPoLoginie}`), "pytanie sprzed zakupu, bez numeru zamówienia");
  assert.equal(t.find((x) => x.id === String(rozmowaPoLoginie))?.dlaczego, "login kupującego");
  assert.equal(t.find((x) => x.rodzaj === "zwrot")?.dlaczego, "login kupującego");
});

test("list przewozowy zwrotu, końcówka telefonu i numer dyskusji bez numeru Allegro", () => {
  assert.equal(S.szukajWszedzie("RET9988776", null, db()).find((x) => x.rodzaj === "zwrot")?.dlaczego,
    "list przewozowy");
  const tel = S.szukajWszedzie("600 111 222", null, db());
  assert.equal(tel.find((x) => x.rodzaj === "zamowienie")?.dlaczego, "telefon odbiorcy");
  assert.ok(S.szukajWszedzie("inne-zamowienie-1", null, db()).some((x) => x.rodzaj === "dyskusja"
    && x.cel?.startsWith("/obsluga/dyskusje/")));
});

test("towar z wstrzykniętej kartoteki, a fraza krótsza niż trzy znaki nie szuka niczego", () => {
  const t = S.szukajWszedzie("5901234", () => [{ id: 7, sym: "NOZ-1", name: "Nóż", ean: "5901234567890" }], db());
  assert.deepEqual(t.filter((x) => x.rodzaj === "towar").map((x) => x.dlaczego), ["EAN"]);
  assert.deepEqual(S.szukajWszedzie("ab", () => [{ id: 1, sym: "AB", name: "x", ean: null }], db()), []);
});

test("szukanie niczego nie zapisuje", () => {
  const d = db();
  const przed = d.prepare("SELECT total_changes() AS n").get() as { n: number };
  S.szukajWszedzie("chips20", null, d);
  S.szukajWszedzie("29f8e1a0", null, d);
  const po = d.prepare("SELECT total_changes() AS n").get() as { n: number };
  assert.equal(po.n, przed.n);
});

/* ── Login po kawałku (24 września 2026) ─────────────────────────────────────
   Zrzut właściciela: „chrzanowski" nie znajdowało „Chrzanowski1234". Agent
   pamięta nazwisko z loginu, nie cyfry dopisane przez Allegro. */
test("kawałek loginu znajduje rozmowę, zakup i zwrot; pełny login stoi pierwszy", () => {
  const t = S.szukajWszedzie("chips", null, db());
  const r = rodzaje(t);
  assert.ok(r.includes(`rozmowa:${rozmowaPoLoginie}`), "rozmowa po kawałku loginu rozmówcy");
  assert.ok(r.includes("zamowienie:29f8e1a0-aaaa-bbbb"));
  assert.ok(t.some((x) => x.rodzaj === "zwrot" && x.dlaczego === "login kupującego"));
  /* Znak `%` wpisany przez agenta to znak, nie dżoker. */
  assert.deepEqual(S.szukajWszedzie("%%%", null, db()), []);
});

/* ── Klient w wynikach (24 września 2026) ────────────────────────────────────
   Login pasujący do frazy daje JEDEN wiersz „Klient" prowadzący do profilu,
   na górze listy, bez względu na wielkość liter w różnych tabelach. */
test("login daje jeden wiersz klienta na górze, prowadzący do profilu", () => {
  const t = S.szukajWszedzie("chips", null, db());
  const klienci = t.filter((x) => x.rodzaj === "klient");
  assert.equal(klienci.length, 1, "Chips20 i chips20 to jeden klient");
  assert.equal(t[0].rodzaj, "klient");
  assert.match(klienci[0].cel ?? "", /^\/obsluga\/klient\/chips20$/i);
});
