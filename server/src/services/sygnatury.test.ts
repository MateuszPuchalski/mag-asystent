import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { kartotekaPoSku } from "./dopasowanie-sku.js";
import { AUTOMAT, pokrycieSygnatur, zwiazPewne } from "./sygnatury.js";

/* ── Sygnatura wiąże i widać, ile wiąże (0.169.0) ────────────────────────────
   Wiązanie oferty z kartoteką po `offer.external.id` działa od 0.152.0, ale do
   0.168.0 nie dało się zobaczyć, ILE trafia — ani nie wiązało się samo.      */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const mkDb = () => { const d = new DatabaseSync(":memory:"); d.exec(schema); migrate(d); return d; };

/** Konto kanału, zamówienie z pozycjami i zwrot wskazujący na to zamówienie. */
function baza(pozycje: Array<{ offer: string; nazwa: string; sku: string | null }>,
  kartoteki: Array<[number, string]>, zwrotOferty: string[] = []) {
  const d = mkDb();
  for (const [twId, symbol] of kartoteki) {
    d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
      .run(twId, symbol, `Towar ${symbol}`);
  }
  d.exec("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')");
  d.exec(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (1,'zam-1','2026-09-02T09:00:00Z')`);
  for (const p of pozycje) {
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja
      (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
      VALUES (1,?,?,?,1,1000,'PLN')`).run(p.offer, p.nazwa, p.sku);
  }
  if (zwrotOferty.length) {
    d.exec(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,created_at,synced_at)
      VALUES (1,'zwr-1','zam-1','2026-09-02T08:00:00Z','2026-09-02T09:00:00Z')`);
    for (const oferta of zwrotOferty) {
      const p = pozycje.find((x) => x.offer === oferta)!;
      d.prepare(`INSERT INTO zwrot_klienta_pozycja
        (zwrot_id,offer_id,klucz,nazwa,ilosc,cena_grosze,waluta)
        VALUES (1,?,?,?,1,1000,'PLN')`).run(oferta, `${oferta}|${p.nazwa}`, p.nazwa);
    }
  }
  return d;
}

test("raport liczy DOKŁADNIE to, co wiąże mechanizm", () => {
  /* Sedno tego pliku. Raport mówiący o pokryciu, którego nie ma, jest gorszy
     od braku raportu — więc porównujemy go wierszem po wierszu z funkcją,
     która naprawdę wskazuje kartotekę. */
  const d = baza(
    [{ offer: "o1", nazwa: "Nóż 51", sku: "W27-0521" },
     { offer: "o2", nazwa: "Nóż ze spacją", sku: "W27-0999" },
     { offer: "o3", nazwa: "Bez sygnatury", sku: null },
     { offer: "o4", nazwa: "Literówka", sku: "W27-BRAK" },
     { offer: "o5", nazwa: "Zdublowany", sku: "DUBEL" }],
    [[11, "W27-0521"], [12, "w27-0999 "], [13, "DUBEL"], [14, "dubel"]]);

  const p = pokrycieSygnatur(d);
  assert.equal(p.pozycji, 5);
  assert.equal(p.bezSygnatury, 1);
  assert.equal(p.trafia, 2, "trafiają dwie: dokładna i ta różniąca się spacją oraz wielkością liter");
  assert.deepEqual(p.pudla.map((w) => w.sygnatura), ["W27-BRAK"]);
  assert.deepEqual(p.zdublowane.map((w) => w.sygnatura), ["DUBEL"]);

  for (const w of [...p.pudla, ...p.zdublowane]) {
    assert.notEqual(kartotekaPoSku(d, w.sygnatura).stan, "jedno",
      `raport wypisał „${w.sygnatura}" jako problem, a mechanizm ją wiąże`);
  }
  assert.equal(kartotekaPoSku(d, "W27-0999").stan, "jedno", "spacja w symbolu Subiekta nie może psuć trafienia");
});

test("pusta baza nie wywraca raportu", () => {
  const p = pokrycieSygnatur(mkDb());
  assert.deepEqual(p, { pozycji: 0, bezSygnatury: 0, trafia: 0, sygnatur: 0, pudla: [], zdublowane: [] });
});

test("PEWNA sygnatura wiąże się SAMA, bez klikania", () => {
  const d = baza([{ offer: "o1", nazwa: "Nóż 51", sku: "W27-0521" }],
    [[11, "W27-0521"]], ["o1"]);

  assert.equal(zwiazPewne(d), 1);

  const p = d.prepare("SELECT tw_id, tw_symbol, tw_zrodlo, tw_przez FROM zwrot_klienta_pozycja")
    .get() as { tw_id: number; tw_symbol: string; tw_zrodlo: string; tw_przez: string };
  assert.equal(p.tw_id, 11);
  assert.equal(p.tw_symbol, "W27-0521");
  assert.equal(p.tw_zrodlo, "sku", "źródło ma dalej mówić, że to automat, a nie człowiek");
  assert.equal(p.tw_przez, AUTOMAT);

  /* Audyt zwrotu MUSI się zapisać: `kto_user_id` ma klucz obcy do `app_user`,
     więc udawany użytkownik wywróciłby całą transakcję. */
  const zdarzen = d.prepare(
    "SELECT COUNT(*) n FROM zwrot_zdarzenie WHERE rodzaj='kartoteka'").get() as { n: number };
  assert.equal(zdarzen.n, 1);

  assert.equal(zwiazPewne(d), 0, "drugi przebieg nie ma czego wiązać — funkcja jest idempotentna");
});

test("automat NIE podszywa się pod decyzję człowieka w pamięci powiązań", () => {
  /* `oferta_kartoteka` znaczy „wskazał to człowiek" i bije automat przy
     kolejnym dopasowaniu. Wpis od automatu podszyłby się pod tamtą decyzję. */
  const d = baza([{ offer: "o1", nazwa: "Nóż 51", sku: "W27-0521" }],
    [[11, "W27-0521"]], ["o1"]);
  zwiazPewne(d);
  const pamiec = d.prepare("SELECT COUNT(*) n FROM oferta_kartoteka").get() as { n: number };
  assert.equal(pamiec.n, 0);
});

test("ZGADYWANIE nie wiąże się samo — ani jedyna pozycja, ani nazwa", () => {
  /* Powiązanie prowadzi do korekty stanu w Subiekcie. Pomyłka wraca towarem
     na złej półce, nie czerwonym napisem na ekranie. */
  const d = baza([{ offer: "o1", nazwa: "Nóż bez sygnatury", sku: null }],
    [[11, "W27-0521"]], ["o1"]);
  assert.equal(zwiazPewne(d), 0);
  const p = d.prepare("SELECT tw_id FROM zwrot_klienta_pozycja").get() as { tw_id: number | null };
  assert.equal(p.tw_id, null);
});

test("symbol zdublowany nie wiąże się nigdy", () => {
  const d = baza([{ offer: "o1", nazwa: "Nóż", sku: "DUBEL" }],
    [[11, "DUBEL"], [12, "dubel"]], ["o1"]);
  assert.equal(zwiazPewne(d), 0, "dwa symbole to spór do rozstrzygnięcia, nie trafienie");
});
