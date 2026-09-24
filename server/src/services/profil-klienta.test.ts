import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-profil-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Profil klienta (24 września 2026) ───────────────────────────────────────
   Pilnujemy: login bez wielkości liter składa wszystko w jeden profil;
   anulowane zamówienie nie wchodzi do sumy; sygnały gasną z przyczyną;
   „niedoręczona” tylko wtedy, gdy pytaliśmy przewoźnika; notatka zapisuje się
   z dziennikiem bez treści i daje się cofnąć; nieznany login to `null`. */

let db: typeof import("../db/db.js").db;
let P: typeof import("./profil-klienta.js");
let konto = 0;
let biuro = 0;
const TERAZ = new Date("2026-09-24T12:00:00Z");
const dni = (n: number) => new Date(TERAZ.getTime() - n * 86_400_000).toISOString();

before(async () => {
  ({ db } = await import("../db/db.js"));
  P = await import("./profil-klienta.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["klient_notatka", "zamowienie_klienta_pozycja", "zamowienie_klienta", "zwrot_klienta",
    "reklamacja_klienta", "message", "conversation", "allegro_inbox_thread", "channel_account", "events",
    "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('b','Ola','biuro')").run().lastInsertRowid);
});

function zamowienie(id: string, login: string, kiedy: string, n: {
  status?: string; suma?: number; sprawdzono?: string | null; dostarczono?: string | null;
} = {}): number {
  const z = Number(db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,
      kupujacy_login,kupiono_at,suma_grosze,waluta,przesylka_sprawdzono_at,przesylka_dostarczono_at,
      przesylka_waybill,synced_at) VALUES (?,?,?,?,?,?,'PLN',?,?,'W1','x')`)
    .run(konto, id, n.status ?? "READY_FOR_PROCESSING", login, kiedy, n.suma ?? 5000,
      n.sprawdzono ?? null, n.dostarczono ?? null).lastInsertRowid);
  db().prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,'Nóż kosiarki',1,?,'PLN')`).run(z, n.suma ?? 5000);
  return z;
}

function rozmowa(watek: string, login: string, kiedy: string, kierunek = "incoming"): number {
  db().prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES (?,0,?,'{}',?)`).run(watek, login, kiedy);
  const c = Number(db().prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject,updated_at) VALUES (?,?,'Czy pasuje?',?)`).run(konto, watek, kiedy).lastInsertRowid);
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,?,?, 'Czy ten nóż pasuje do mojej kosiarki?',?)`).run(c, konto, `m-${watek}`, kierunek, kiedy);
  return c;
}

test("nieznany login to null, nie pusty profil", () => {
  assert.equal(P.profilKlienta("nikt", TERAZ, db()), null);
});

test("login bez wielkości liter składa zamówienia, rozmowę i liczby; anulowane poza sumą", () => {
  zamowienie("z-1", "Chrzanowski1234", dni(40), { suma: 12000 });
  zamowienie("z-2", "chrzanowski1234", dni(5), { suma: 3000 });
  zamowienie("z-3", "CHRZANOWSKI1234", dni(3), { suma: 99999, status: "CANCELLED" });
  const r = rozmowa("w-1", "chrzanowski1234", dni(1));
  const p = P.profilKlienta("chrzanowski1234", TERAZ, db())!;
  assert.equal(p.liczby.zamowien, 3);
  assert.equal(p.liczby.wydanoGrosze, 15000, "anulowane nie wchodzi do sumy");
  assert.equal(p.liczby.rozmow, 1);
  assert.equal(p.zamowienia[0].pozycje[0].nazwa, "Nóż kosiarki");
  assert.ok(p.otwarte.some((o) => o.rodzaj === "rozmowa" && o.id === r && o.stan === "czeka na nas"));
  assert.ok(p.sygnaly.some((s) => /czeka na naszą odpowiedź/.test(s.tekst)));
});

test("sygnały: otwarta reklamacja, seria zwrotów, paczka niedoręczona tylko gdy pytaliśmy", () => {
  zamowienie("z-sprawdzona", "kl", dni(10), { sprawdzono: dni(1) });
  zamowienie("z-niewiadoma", "kl", dni(12));
  for (const [i, kiedy] of [dni(20), dni(30)].entries()) {
    db().prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,kupujacy_login,
      created_at,synced_at) VALUES (?,?,?,?,?,'x')`).run(konto, `zw-${i}`, `ZW-${i}`, "kl", kiedy);
  }
  db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,typ,kupujacy_login,temat,
    status_allegro,decyzja_do,otwarto_at,synced_at) VALUES (?,'r-1','CLAIM','kl','Pęknięty','CLAIM_SUBMITTED',
    '2026-09-30T10:00:00Z',?,'x')`).run(konto, dni(2));
  const p = P.profilKlienta("KL", TERAZ, db())!;
  const t = p.sygnaly.map((s) => s.tekst);
  assert.ok(t.some((x) => /^Otwarta reklamacja, termin 30\.09\.2026/.test(x)));
  assert.ok(t.includes("2 zwroty w 60 dni"));
  assert.equal(t.filter((x) => /niedoręczone/.test(x)).length, 1, "bez pytania przewoźnika nie wiemy");
  assert.ok(p.otwarte.some((o) => o.rodzaj === "reklamacja" && o.stan === "termin 30.09.2026"));
  assert.equal(p.otwarte.filter((o) => o.rodzaj === "zwrot").length, 2);
});

test("notatka: zapis z dziennikiem bez treści, cofnięcie, zdjęcie", () => {
  zamowienie("z-1", "kl", dni(3));
  const kto = { id: biuro, name: "Ola" };
  P.zapiszNotatkeKlienta("KL", "Zawsze prosi o fakturę", kto, TERAZ, db());
  P.zapiszNotatkeKlienta("kl", "Prosi o fakturę na firmę", kto, TERAZ, db());
  let p = P.profilKlienta("kl", TERAZ, db())!;
  assert.equal(p.notatka?.tresc, "Prosi o fakturę na firmę");
  assert.equal(p.notatka?.cofalna, true);
  const payload = (db().prepare("SELECT payload FROM events WHERE type='klient_notatka' LIMIT 1").get() as { payload: string }).payload;
  assert.ok(!payload.includes("faktur"), "treść notatki nie idzie do dziennika");
  assert.equal(P.cofnijNotatkeKlienta("kl", kto, TERAZ, db()), true);
  p = P.profilKlienta("kl", TERAZ, db())!;
  assert.equal(p.notatka?.tresc, "Zawsze prosi o fakturę");
  P.zapiszNotatkeKlienta("kl", "  ", kto, TERAZ, db());
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.notatka, null);
  assert.throws(() => P.zapiszNotatkeKlienta("kl", "x".repeat(P.LIMIT_NOTATKI + 1), kto, TERAZ, db()));
});

test("profil jest odczytem — otwarcie niczego nie zapisuje", () => {
  zamowienie("z-1", "kl", dni(3));
  rozmowa("w-1", "kl", dni(1));
  const przed = (db().prepare("SELECT total_changes() n").get() as { n: number }).n;
  P.profilKlienta("kl", TERAZ, db());
  assert.equal((db().prepare("SELECT total_changes() n").get() as { n: number }).n, przed);
});
