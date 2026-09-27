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
  /* `klient_prowadzenie` PRZED `app_user`: prowadzący sprawy klienta to klucz
     obcy bez kaskady. */
  for (const t of ["klient_prowadzenie", "klient_notatka", "zamowienie_klienta_pozycja", "zamowienie_klienta", "zwrot_klienta",
    "allegro_zwrot", "reklamacja_klienta", "message", "conversation", "allegro_inbox_thread", "channel_account", "events",
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

/* ── Sprawa klienta na profilu (0.535.0, S6) ────────────────────────────────
   Profil niesie sprawę i podpowiedź „Zakończ sprawę?”. Podpowiedź stoi tylko
   wtedy, gdy trzy rzeczy zachodzą naraz: sprawa w toku, w kolejkach nic nie
   czeka, a termin kroku nadszedł. Każda z trzech osobno ją gasi. */
test("profil bez sprawy: `sprawa` null, bez podpowiedzi", () => {
  zamowienie("z-1", "kl", dni(3));
  const p = P.profilKlienta("kl", TERAZ, db())!;
  assert.equal(p.sprawa, null);
  assert.equal(p.podpowiedzZakonczenia, false);
});

test("podpowiedź zakończenia: w toku, nic otwartego w kolejkach, termin kroku nadszedł", async () => {
  const S = await import("./prowadzenie-klienta.js");
  zamowienie("z-1", "kl", dni(3));
  const kto = { id: biuro, name: "Ola" };
  const zalozono = new Date(TERAZ.getTime() - 3 * 86_400_000);
  S.ustawKrok("kl", { krok: "czekamy na zwrot", krokDo: new Date(TERAZ.getTime() + 86_400_000).toISOString(),
    wersja: 0, odcisk: "" }, kto, zalozono, db());
  let p = P.profilKlienta("KL", TERAZ, db())!;
  assert.equal(p.sprawa?.krok, "czekamy na zwrot");
  assert.equal(p.podpowiedzZakonczenia, false, "termin kroku jeszcze nie nadszedł");

  const dwaDniPozniej = new Date(TERAZ.getTime() + 2 * 86_400_000);
  p = P.profilKlienta("kl", dwaDniPozniej, db())!;
  assert.equal(p.sprawa?.poTerminie, true);
  assert.deepEqual(p.otwarte, []);
  assert.equal(p.podpowiedzZakonczenia, true);

  /* Otwarty zwrot w kolejce gasi podpowiedź — sprawa jeszcze trwa. */
  const zw = Number(db().prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,
    kupujacy_login,created_at,synced_at) VALUES (?,'zw-1','ZW-1','kl',?,'x')`).run(konto, dni(1)).lastInsertRowid);
  assert.equal(P.profilKlienta("kl", dwaDniPozniej, db())!.podpowiedzZakonczenia, false);
  db().prepare("DELETE FROM zwrot_klienta WHERE id=?").run(zw);

  const s = P.profilKlienta("kl", dwaDniPozniej, db())!.sprawa!;
  S.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, kto, dwaDniPozniej, db());
  p = P.profilKlienta("kl", dwaDniPozniej, db())!;
  assert.equal(p.sprawa?.stan, "zakonczona");
  assert.equal(p.podpowiedzZakonczenia, false, "zakończonej nie ma czego kończyć");
});

test("profil ze sprawą dalej jest odczytem", async () => {
  const S = await import("./prowadzenie-klienta.js");
  zamowienie("z-1", "kl", dni(3));
  rozmowa("w-1", "kl", dni(1));
  S.ustawKrok("kl", { krok: "dosłać", krokDo: new Date(TERAZ.getTime() + 86_400_000).toISOString(),
    wersja: 0, odcisk: "" }, { id: biuro, name: "Ola" }, TERAZ, db());
  const przed = (db().prepare("SELECT total_changes() n").get() as { n: number }).n;
  assert.ok(P.profilKlienta("kl", TERAZ, db())!.sprawa);
  assert.equal((db().prepare("SELECT total_changes() n").get() as { n: number }).n, przed);
});

/* ── Dosyłka na profilu (@wydanie, S6) ──────────────────────────────────────
   Trzy rzeczy: podpowiedź „Dosyłka doręczona. Zakończ sprawę?” mimo
   otwartego zwrotu wymiany, propozycja śledzenia odmowy z ostatnich
   trzydziestu dni i lista przewoźników do formularza numeru. */

/** Zwrot z odmową wypłaty; `odmowa` null — kod zsynchronizowany z panelu Allegro. */
function zwrotZOdmowa(login: string, zam: string | null, n: {
  kod?: string; odmowa?: string | null; odrzucono?: string | null; zgloszono?: string | null; zamkniety?: boolean;
} = {}): number {
  const ext = `zw-${Math.random()}`;
  const surowy: Record<string, unknown> = { id: ext, orderId: zam };
  if (n.zgloszono) surowy.createdAt = n.zgloszono;
  if (n.odrzucono) surowy.rejection = { code: n.kod ?? "NEW_ITEM_SENT", createdAt: n.odrzucono };
  db().prepare("INSERT INTO allegro_zwrot(id,created_at,surowe_json,synced_at) VALUES (?,?,?,'x')")
    .run(ext, TERAZ.toISOString(), JSON.stringify(surowy));
  const nasza = n.odmowa !== null;
  return Number(db().prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,
      kupujacy_login,created_at,odmowa_kod,odmowa_at,rejection_code,zamkniety_at,przewoznik,synced_at)
    VALUES (?,?,'ZW',?,?,?,?,?,?,?,'INPOST','x')`)
    .run(konto, ext, zam, login, TERAZ.toISOString(), nasza ? n.kod ?? "NEW_ITEM_SENT" : null,
      nasza ? n.odmowa ?? dni(1) : null, nasza ? null : n.kod ?? "NEW_ITEM_SENT",
      n.zamkniety ? dni(1) : null).lastInsertRowid);
}

test("podpowiedź „dosylka”: doręczona dosyłka, a otwarty zwrot tego zamówienia jej nie gasi", async () => {
  const D = await import("./dosylka.js");
  zamowienie("z-1", "kl", dni(20));
  const kto = { id: biuro, name: "Ola" };
  const zw = zwrotZOdmowa("kl", "z-1");
  D.zalozDosylkeZOdmowy(db(), zw, kto, TERAZ);
  let p = P.profilKlienta("kl", TERAZ, db())!;
  assert.deepEqual([p.podpowiedzZakonczenia, p.podpowiedzPowod], [false, null], "dosyłka jeszcze jedzie");

  db().prepare("UPDATE klient_dosylka SET waybill='W1', przewoznik='DPD', status='DELIVERED', dostarczono_at=?")
    .run(dni(0));
  p = P.profilKlienta("kl", TERAZ, db())!;
  assert.ok(p.otwarte.some((o) => o.rodzaj === "zwrot" && o.id === zw), "zwrot wymiany stoi otwarty");
  assert.deepEqual([p.podpowiedzZakonczenia, p.podpowiedzPowod], [true, "dosylka"]);

  /* Otwarty zwrot INNEGO zamówienia gasi ją jak przy terminie. */
  zamowienie("z-2", "kl", dni(10));
  const inny = zwrotZOdmowa("kl", "z-2", { kod: "REFUND_REJECTED" });
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.podpowiedzPowod, null);
  db().prepare("UPDATE zwrot_klienta SET zamkniety_at=? WHERE id=?").run(dni(0), inny);

  /* Termin też minął — powodem zostaje dosyłka, bo mówi, CZEMU krok się spełnił. */
  const poTerminie = new Date(TERAZ.getTime() + 10 * 86_400_000);
  assert.equal(P.profilKlienta("kl", poTerminie, db())!.podpowiedzPowod, "dosylka");
  db().prepare("DELETE FROM klient_dosylka").run();
  db().prepare("UPDATE zwrot_klienta SET zamkniety_at=?").run(dni(0));
  assert.deepEqual([P.profilKlienta("kl", poTerminie, db())!.podpowiedzZakonczenia,
    P.profilKlienta("kl", poTerminie, db())!.podpowiedzPowod], [true, "termin"]);
});

test("propozycja dosyłki: odmowa z trzydziestu dni, bez śledzonej dosyłki; data nigdy z `created_at` zwrotu", async () => {
  const D = await import("./dosylka.js");
  zamowienie("z-1", "kl", dni(40));
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.propozycjaDosylki, null);
  zwrotZOdmowa("kl", "z-1", { odmowa: dni(31) });
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.propozycjaDosylki, null, "31 dni to poza oknem");
  zwrotZOdmowa("kl", null, { odmowa: dni(1) });
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.propozycjaDosylki, null, "bez zamówienia nie ma czego śledzić");
  zwrotZOdmowa("kl", "z-1", { odmowa: dni(5), kod: "ITEM_FIXED" });
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.propozycjaDosylki, null, "naprawa to nie dosyłka");

  /* Kod z panelu Allegro: data odmowy z lądowiska, nie z naszej kolumny. */
  const zAllegro = zwrotZOdmowa("kl", "z-1", { odmowa: null, kod: "MISSING_PART_SENT", odrzucono: dni(29) });
  assert.deepEqual(P.profilKlienta("kl", TERAZ, db())!.propozycjaDosylki,
    { zwrotId: zAllegro, zamowienie: "z-1", kod: "MISSING_PART_SENT", odmowaAt: dni(29) });
  /* Bez żadnej daty Allegro — `created_at` zwrotu bywa czasem synchronizacji,
     więc na nim propozycja nie stanie. */
  db().prepare("UPDATE allegro_zwrot SET surowe_json = json_remove(surowe_json, '$.rejection')").run();
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.propozycjaDosylki, null);

  const nasza = zwrotZOdmowa("kl", "z-1", { odmowa: dni(2) });
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.propozycjaDosylki?.zwrotId, nasza);
  D.zalozDosylkeZOdmowy(db(), nasza, { id: biuro, name: "Ola" }, TERAZ);
  assert.equal(P.profilKlienta("kl", TERAZ, db())!.propozycjaDosylki, null, "dosyłkę zamówienia już śledzimy");
});

test("przewoźnicy do formularza: z zamówień, zwrotów i dosyłek, bez powtórzeń i po kolei", () => {
  zamowienie("z-1", "kl", dni(3));
  db().prepare("UPDATE zamowienie_klienta SET przesylka_przewoznik='INPOST'").run();
  zwrotZOdmowa("kl", "z-1");
  db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,kupujacy_login,przesylka_przewoznik,
    synced_at) VALUES (?,'z-2','inny','DPD','x')`).run(konto);
  assert.deepEqual(P.profilKlienta("kl", TERAZ, db())!.przewoznicy, ["DPD", "INPOST"]);
});

test("„niedoręczone od N dni” milknie przy zamówieniu z dosyłką — jej los niesie karta sprawy", async () => {
  const D = await import("./dosylka.js");
  zamowienie("z-1", "kl", dni(10), { sprawdzono: dni(1) });
  const sygnal = () => P.profilKlienta("kl", TERAZ, db())!.sygnaly.filter((s) => /niedoręczone/.test(s.tekst)).length;
  assert.equal(sygnal(), 1);
  D.zalozDosylkeZOdmowy(db(), zwrotZOdmowa("kl", "z-1"), { id: biuro, name: "Ola" }, TERAZ);
  assert.equal(sygnal(), 0);
});

test("profil z dosyłką i propozycją dalej jest odczytem", async () => {
  const D = await import("./dosylka.js");
  zamowienie("z-1", "kl", dni(10));
  zamowienie("z-2", "kl", dni(10));
  D.zalozDosylkeZOdmowy(db(), zwrotZOdmowa("kl", "z-1"), { id: biuro, name: "Ola" }, TERAZ);
  zwrotZOdmowa("kl", "z-2");
  const przed = (db().prepare("SELECT total_changes() n").get() as { n: number }).n;
  const p = P.profilKlienta("kl", TERAZ, db())!;
  assert.equal(p.sprawa?.dosylki.length, 1);
  assert.equal(p.propozycjaDosylki?.zamowienie, "z-2");
  assert.equal((db().prepare("SELECT total_changes() n").get() as { n: number }).n, przed);
});
