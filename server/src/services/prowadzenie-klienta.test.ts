import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-prowadzenie-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Sprawa klienta (0.535.0, S6) ───────────────────────────────────────────
   Pilnujemy umowy z projektu, punkt po punkcie:
   - dwa stany, krok z terminem jako JEDYNA droga założenia i wznowienia;
   - „nowe” z odcisku: budzi każde źródło po stronie klienta, także import
     z opóźnieniem, a NIE budzi podziękowanie ani rozmowa dowiązana wstecz;
   - `wersja` i odcisk jako strażnicy świeżości (409 ze świeżą sprawą) —
     na każdym z czterech zapisów, także „Przejmij” i „Cofnij”;
   - prowadzący ustawia się sam, „Przejmij” tylko cudzej sprawy w toku;
   - „Cofnij” przywraca „nowe” sprzed zakończenia, a obudzoną zakończoną
     kończy się znów jednym zapisem;
   - obudzenie tylko w oknie trzydziestu dni od zakończenia;
   - „Moje” scala kolejki i sprawy w czterech piętrach, na dobie LOKALNEJ,
     a odcisk liczy tylko sprawom, które przeszły przez sito;
   - znacznik bez strefy to UTC, jak w SQLite;
   - dziennik niesie numer sprawy, nigdy loginu ani treści kroku;
   - odczyty niczego nie zapisują. */

let db: typeof import("../db/db.js").db;
let P: typeof import("./prowadzenie-klienta.js");
let H: typeof import("./klient-historia.js");
let R: typeof import("./conversations.js");
let konto = 0;
let ala = { id: 0, name: "A. Lewandowska" };
let bob = { id: 0, name: "B. Nowak" };

const TERAZ = new Date("2026-09-26T10:00:00Z"); // 12:00 w magazynie (CEST)
const za = (godzin: number, od = TERAZ) => new Date(od.getTime() + godzin * 3_600_000);
const iso = (godzin: number, od = TERAZ) => za(godzin, od).toISOString();

before(async () => {
  ({ db } = await import("../db/db.js"));
  P = await import("./prowadzenie-klienta.js");
  H = await import("./klient-historia.js");
  R = await import("./conversations.js");
});

beforeEach(() => {
  const d = db();
  /* Dzieci przed rodzicami; `klient_prowadzenie` przed `app_user`, bo
     prowadzący to klucz obcy bez kaskady. */
  for (const t of ["klient_prowadzenie", "decyzja_klasyfikacji", "reklamacja_wiadomosc", "reklamacja_klienta",
    "zwrot_klienta", "zamowienie_klienta_pozycja", "zamowienie_klienta", "conversation_event", "message",
    "conversation", "allegro_inbox_thread", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  ala = { id: Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid), name: "A. Lewandowska" };
  bob = { id: Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','biuro')")
    .run().lastInsertRowid), name: "B. Nowak" };
});

function zamowienie(id: string, login: string): void {
  db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,kupujacy_login,kupiono_at,
      suma_grosze,waluta,synced_at) VALUES (?,?,'READY_FOR_PROCESSING',?,?,5000,'PLN','x')`)
    .run(konto, id, login, iso(-24 * 10));
}

/** Rozmowa z wątkiem; `login` null — wątek bez rozmówcy (dowiązuje go tylko zamówienie). */
function rozmowa(watek: string, login: string | null): number {
  db().prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES (?,0,?,'{}','x')`).run(watek, login);
  return Number(db().prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject,
    updated_at) VALUES (?,?,'Pytanie',?)`).run(konto, watek, iso(-48)).lastInsertRowid);
}

/** Wiadomość z JAWNYM czasem wstawienia — na nim stoi odcisk. */
function wiadomosc(c: number, kierunek: "incoming" | "outgoing", napisano: string, wstawiono: string): number {
  return Number(db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
      direction,body,sent_at,created_at) VALUES (?,?,?,?,'treść',?,?)`)
    .run(c, konto, `m-${Math.random()}`, kierunek, napisano, wstawiono).lastInsertRowid);
}

function zwrot(login: string, n: { zrodlo?: string; paczka?: string; dotarl?: string; utworzono?: string } = {}): number {
  return Number(db().prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,
      kupujacy_login,created_at,paczka_at,dostarczono_at,zrodlo,synced_at) VALUES (?,?,?,?,?,?,?,?,'x')`)
    .run(konto, `z-${Math.random()}`, "ZW-1", login, n.utworzono ?? iso(-24 * 5), n.paczka ?? null,
      n.dotarl ?? null, n.zrodlo ?? "allegro").lastInsertRowid);
}

function sprawaAllegro(login: string, typ: "CLAIM" | "DISPUTE", otwarto = iso(-24)): number {
  return Number(db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,typ,kupujacy_login,
      temat,status_allegro,otwarto_at,synced_at) VALUES (?,?,?,?,'Temat','CLAIM_SUBMITTED',?,'x')`)
    .run(konto, `r-${Math.random()}`, typ, login, otwarto).lastInsertRowid);
}

function wiadomoscSprawy(sprawa: number, rola: string, at = iso(1)): void {
  db().prepare(`INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
    VALUES (?,?,?,'treść',?)`).run(sprawa, `w-${Math.random()}`, rola, at);
}

const zmiany = () => (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
const zdarzenia = () => db().prepare(`SELECT type, payload, user_ref FROM events
    WHERE type LIKE 'klient_sprawa%' ORDER BY id`).all() as Array<{ type: string; payload: string; user_ref: number }>;

/** Pierwszy krok na trzy dni naprzód — najczęstszy początek sprawy w teście. */
function zaloz(login: string, kto = ala, teraz = TERAZ, krok = "czekamy na zwrot") {
  return P.ustawKrok(login, { krok, krokDo: iso(72, teraz), wersja: 0, odcisk: "" }, kto, teraz, db());
}

/** Ruch człowieka potwierdzający wszystko, co widać: krok od nowa, z bieżącym odciskiem. */
function potwierdz(login: string, teraz: Date) {
  const s = P.sprawaKlienta(login, teraz, db())!;
  return P.ustawKrok(login, { krok: s.krok, krokDo: iso(72, teraz), wersja: s.wersja, odcisk: s.odcisk },
    ala, teraz, db());
}

test("nieznany login: sprawy nie ma, a zapis odmawia bez śladu", () => {
  assert.equal(P.sprawaKlienta("nikt", TERAZ, db()), null);
  const przed = zmiany();
  assert.throws(() => zaloz("nikt"), P.BrakKlienta);
  assert.throws(() => P.zakonczSprawe("nikt", { wersja: 0, odcisk: "" }, ala, TERAZ, db()), P.BrakKlienta);
  assert.equal(zmiany(), przed);
});

test("pierwszy krok zakłada sprawę: prowadzi autor, login jak w Allegro, dziennik bez loginu i kroku", () => {
  zamowienie("z-1", "Chips20");
  const s = zaloz("chips20");
  assert.equal(s.login, "Chips20", "login tak, jak zapisało go Allegro");
  assert.equal(s.stan, "w_toku");
  assert.equal(s.wersja, 1);
  assert.equal(s.krok, "czekamy na zwrot");
  assert.equal(s.krokDo, iso(72));
  assert.deepEqual([s.prowadzi, s.prowadziId], [ala.name, ala.id]);
  assert.deepEqual(s.nowe, []);
  assert.equal(s.dzis, false);
  assert.equal(s.poTerminie, false);

  const [e] = zdarzenia();
  assert.equal(e.type, "klient_sprawa_krok");
  assert.equal(e.user_ref, ala.id);
  assert.deepEqual(JSON.parse(e.payload), { sprawa: s.id, znakow: 16, termin: iso(72), nowa: true });
  assert.doesNotMatch(e.payload.toLowerCase(), /chips|czekamy/);

  /* Drugi krok na tę samą sprawę to nie nowa sprawa: `nowa: false`, wersja 2. */
  const s2 = P.ustawKrok("CHIPS20", { krok: "  dosłać  ", krokDo: iso(24), wersja: 1, odcisk: s.odcisk }, bob, TERAZ, db());
  assert.equal(s2.id, s.id);
  assert.equal(s2.wersja, 2);
  assert.equal(s2.krok, "dosłać", "krok przycięty");
  assert.equal(s2.prowadziId, ala.id, "krok kolegi nie zabiera prowadzenia");
  assert.equal(JSON.parse(zdarzenia()[1].payload).nowa, false);
});

test("zły krok albo termin to BladSprawy i zero zapisu", () => {
  zamowienie("z-1", "kl");
  const przed = zmiany();
  const proba = (krok: string, krokDo: string) =>
    assert.throws(() => P.ustawKrok("kl", { krok, krokDo, wersja: 0, odcisk: "" }, ala, TERAZ, db()), P.BladSprawy);
  proba("   ", iso(24));
  proba("x".repeat(P.LIMIT_KROKU + 1), iso(24));
  proba("dosłać", "jutro");
  proba("dosłać", iso(-1));
  proba("dosłać", TERAZ.toISOString());
  proba("dosłać", iso(24 * P.NAJDLUZSZY_KROK_DNI + 1));
  assert.equal(zmiany(), przed);
  /* Granice włącznie: 200 znaków i równe 60 dni przechodzą. */
  P.ustawKrok("kl", { krok: "x".repeat(P.LIMIT_KROKU), krokDo: iso(24 * P.NAJDLUZSZY_KROK_DNI), wersja: 0, odcisk: "" },
    ala, TERAZ, db());
});

test("rozjazd wersji to 409 ze świeżą sprawą, bez zapisu", () => {
  zamowienie("z-1", "kl");
  const s = zaloz("kl");
  const przed = zmiany();
  assert.throws(() => zaloz("kl"), (e: unknown) => {
    assert.ok(e instanceof P.KonfliktSprawy);
    assert.equal(e.sprawa?.wersja, 1, "przegrany dostaje sprawę do narysowania");
    return true;
  });
  assert.throws(() => P.zakonczSprawe("kl", { wersja: 7, odcisk: s.odcisk }, ala, TERAZ, db()), P.KonfliktSprawy);
  assert.throws(() => P.wznowSprawe("kl", { wersja: 0, odcisk: s.odcisk }, ala, TERAZ, db()), P.KonfliktSprawy);
  assert.throws(() => P.przejmijSprawe("kl", { wersja: 2, odcisk: s.odcisk }, bob, TERAZ, db()), P.KonfliktSprawy);
  assert.equal(zmiany(), przed);

  /* Bez wiersza: wersja inna niż 0 to też rozjazd — i sprawa `null`. */
  zamowienie("z-2", "inny");
  assert.throws(() => P.ustawKrok("inny", { krok: "a", krokDo: iso(5), wersja: 1, odcisk: "" }, ala, TERAZ, db()),
    (e: unknown) => e instanceof P.KonfliktSprawy && e.sprawa === null);
  assert.throws(() => P.zakonczSprawe("inny", { wersja: 0, odcisk: "" }, ala, TERAZ, db()), P.KonfliktSprawy);
});

test("odcisk z ekranu: nowa wiadomość po otwarciu blokuje zakończenie, świeży odcisk je puszcza", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  wiadomosc(c, "incoming", iso(-3), iso(-3));
  const s = zaloz("kl");
  const ekran = P.sprawaKlienta("kl", za(1), db())!;
  assert.equal(ekran.odcisk, s.odcisk);
  assert.equal(ekran.odcisk, P.odciskTeraz("kl", db()));

  wiadomosc(c, "incoming", iso(2), iso(2));
  const przed = zmiany();
  assert.throws(() => P.zakonczSprawe("kl", { wersja: ekran.wersja, odcisk: ekran.odcisk }, ala, za(3), db()),
    (e: unknown) => {
      assert.ok(e instanceof P.KonfliktSprawy);
      assert.equal(e.message, "Klient dopisał coś po otwarciu ekranu");
      assert.equal(e.sprawa?.nowe[0]?.rodzaj, "rozmowa", "świeża sprawa pokazuje, co przyszło");
      return true;
    });
  assert.throws(() => P.ustawKrok("kl", { krok: "a", krokDo: iso(30), wersja: 1, odcisk: ekran.odcisk }, ala, za(3), db()),
    P.KonfliktSprawy);
  assert.equal(zmiany(), przed);

  const swiezy = P.sprawaKlienta("kl", za(3), db())!;
  const z = P.zakonczSprawe("kl", { wersja: swiezy.wersja, odcisk: swiezy.odcisk }, ala, za(3), db());
  assert.equal(z.stan, "zakonczona");
  assert.deepEqual(z.nowe, [], "zapis potwierdza, co było widać");
});

test("wiadomość klienta po zakończeniu budzi sprawę: zdanie z godziną lokalną i odnośnik do rozmowy", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  const s = zaloz("kl");
  P.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, za(1), db());
  assert.deepEqual(P.mojaLista(db(), ala.id, za(1)), [], "zakończona bez nowego schodzi z „Moje”");

  wiadomosc(c, "incoming", "2026-09-26T12:10:00.000Z", "2026-09-26T12:10:05.000Z");
  const obudzona = P.sprawaKlienta("kl", za(3), db())!;
  assert.equal(obudzona.stan, "zakonczona");
  assert.deepEqual(obudzona.nowe, [{ rodzaj: "rozmowa", tekst: "Klient napisał 26.09 14:10",
    at: "2026-09-26T12:10:00.000Z", cel: `/obsluga/skrzynka/${c}` }]);
  const [wiersz] = P.mojaLista(db(), ala.id, za(3));
  assert.equal(wiersz.kolejka, "klient");
  assert.equal(wiersz.id, s.id);
  assert.equal(wiersz.nowe, "Klient napisał 26.09 14:10");
  assert.equal(wiersz.cel, `/obsluga/skrzynka/${c}`);
  assert.equal(wiersz.terminDo, null, "zakończona sprawa nie ma biegnącego terminu");
  assert.equal(wiersz.opis, "kl: czekamy na zwrot");

  /* Cofnięcie zakończenia PRZYWRACA stan sprzed niego, nie potwierdza nowego:
     wiadomość przyszła po zakończeniu, więc po cofnięciu dalej jest nowa. */
  const w = P.wznowSprawe("kl", { wersja: obudzona.wersja, odcisk: obudzona.odcisk }, ala, za(3), db());
  assert.equal(w.stan, "w_toku");
  assert.equal(w.krok, "czekamy na zwrot", "krok przeżył zakończenie");
  assert.deepEqual(w.nowe, obudzona.nowe);
});

test("import z opóźnieniem budzi: liczy się nasz czas wstawienia, nie data napisania", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  zaloz("kl");
  /* Klient napisał PRZED ruchem agenta, ale wiadomość doszła do nas po nim —
     agent jej nie widział, więc to jest nowe. */
  wiadomosc(c, "incoming", iso(-5), iso(1));
  const n = P.sprawaKlienta("kl", za(2), db())!.nowe;
  assert.equal(n.length, 1);
  assert.equal(n[0].at, iso(-5), "zdanie mówi, kiedy klient pisał");
});

test("podziękowanie nie budzi, a pytanie po nim — tak", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  wiadomosc(c, "incoming", iso(-4), iso(-4));
  wiadomosc(c, "outgoing", iso(-3), iso(-3));
  const s = zaloz("kl");
  const dzieki = wiadomosc(c, "incoming", iso(1), iso(1));
  /* Zanim klasyfikator rozpozna podziękowanie, wiadomość jest zwykłą wiadomością. */
  assert.equal(P.sprawaKlienta("kl", za(2), db())!.nowe.length, 1);

  db().prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,status,
      kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,pewnosc,
      taksonomia_wersja,polityka_wersja,at,przez)
    VALUES (?,?,1,1,'MODEL','SUCCESS','OTHER','NO_ACTION',0,0,0,'wysoka','v2','p1',?,'automat')`)
    .run(c, dzieki, iso(1));
  const po = P.sprawaKlienta("kl", za(2), db())!;
  assert.deepEqual(po.nowe, [], "podziękowanie to rozstrzygnięcie, nie powrót klienta");
  assert.equal(po.odcisk, s.odcisk, "odcisk wraca do stanu sprzed podziękowania");

  /* NASZ ruch w skrzynce nie budzi. „Otwórz ponownie” wstrzymuje zakończenie
     rozmowy, a „Zakończona” zamienia jego źródło na werdykt agenta — obie
     rzeczy zmieniają STAN rozmowy, ale nie to, czy klient napisał coś nowego. */
  R.otworzRozmowe(db(), c, bob.id, za(2));
  const poOtwarciu = P.sprawaKlienta("kl", za(2), db())!;
  assert.deepEqual([poOtwarciu.nowe, poOtwarciu.odcisk], [[], s.odcisk], "otwarcie rozmowy nie budzi sprawy");
  R.zakonczRozmowe(db(), c, bob.id, true, za(2));
  const poZakonczeniu = P.sprawaKlienta("kl", za(2), db())!;
  assert.deepEqual([poZakonczeniu.nowe, poZakonczeniu.odcisk], [[], s.odcisk], "werdykt agenta nie budzi sprawy");

  wiadomosc(c, "incoming", iso(3), iso(3));
  assert.equal(P.sprawaKlienta("kl", za(4), db())!.nowe.length, 1, "dopisek po podziękowaniu budzi");
});

test("rozmowa dowiązana wstecz ręcznym wskazaniem zamówienia nie budzi", () => {
  zamowienie("z-1", "kl");
  const a = rozmowa("w-a", "kl");
  wiadomosc(a, "incoming", iso(-2), iso(-2));
  /* Rozmowa bez rozmówcy w wątku: do klienta prowadzi ją tylko zamówienie.
     Jej wiadomość weszła do bazy PRZED ruchem agenta, choć PO odcisku. */
  const x = rozmowa("w-x", null);
  wiadomosc(x, "incoming", iso(-1), iso(-1));
  const s = zaloz("kl");
  assert.ok(!H.rozmowyPoLoginie(db(), konto, "kl").some((r) => r.id === x));

  db().prepare(`INSERT INTO conversation_event(conversation_id,event_type,payload)
    VALUES (?,'order_linked_manually',json_object('externalId','z-1','autor','ala'))`).run(x);
  assert.ok(H.rozmowyPoLoginie(db(), konto, "kl").some((r) => r.id === x), "wskazanie wiąże rozmowę z klientem");
  const po = P.sprawaKlienta("kl", za(2), db())!;
  assert.deepEqual(po.nowe, [], "o tej wiadomości wiedzieliśmy przed ruchem agenta");
  assert.notEqual(po.odcisk, s.odcisk, "odcisk i tak się zmienia — ekran sprzed wskazania jest nieświeży");
});

test("każde źródło po stronie klienta budzi swoim zdaniem, także zwrot zsynchronizowany z opóźnieniem", () => {
  zamowienie("z-1", "kl");
  zaloz("kl");
  const nowe = (teraz: Date) => P.sprawaKlienta("kl", teraz, db())!.nowe;

  /* Zwrot z datą SPRZED ruchu agenta, wpisany po nim — sztuki, nie daty. */
  const zw = zwrot("KL", { utworzono: iso(-24 * 3) });
  assert.deepEqual(nowe(za(1)).map((n) => [n.rodzaj, n.tekst, n.cel]),
    [["zwrot_nowy", "Nowy zwrot", `/obsluga/zwroty/${zw}`]]);
  potwierdz("kl", za(1));

  db().prepare("UPDATE zwrot_klienta SET paczka_at=? WHERE id=?").run(iso(2), zw);
  assert.deepEqual(nowe(za(3)).map((n) => [n.rodzaj, n.tekst, n.at]), [["zwrot_nadany", "Klient nadał zwrot", iso(2)]]);
  potwierdz("kl", za(3));

  db().prepare("UPDATE zwrot_klienta SET dostarczono_at=? WHERE id=?").run(iso(4), zw);
  assert.deepEqual(nowe(za(5)).map((n) => n.tekst), ["Zwrot dotarł"]);
  potwierdz("kl", za(5));

  /* Paczkę nieodebraną zakłada biuro — to nie jest ruch klienta. */
  zwrot("kl", { zrodlo: "nieodebrana", paczka: iso(5), dotarl: iso(5) });
  assert.deepEqual(nowe(za(6)), []);

  const rek = sprawaAllegro("kl", "CLAIM");
  assert.deepEqual(nowe(za(6)).map((n) => [n.tekst, n.cel]), [["Nowa reklamacja", `/obsluga/reklamacje/${rek}`]]);
  potwierdz("kl", za(6));
  const dys = sprawaAllegro("kl", "DISPUTE");
  assert.deepEqual(nowe(za(7)).map((n) => [n.tekst, n.cel]), [["Nowa dyskusja", `/obsluga/dyskusje/${dys}`]]);
  potwierdz("kl", za(7));

  /* Nasza wiadomość w sprawie nie budzi; klienta i doradcy Allegro — tak. */
  wiadomoscSprawy(rek, "SELLER", iso(8));
  assert.deepEqual(nowe(za(9)), []);
  wiadomoscSprawy(rek, "BUYER", iso(9));
  assert.deepEqual(nowe(za(10)).map((n) => [n.tekst, n.cel]),
    [["Klient napisał w reklamacji", `/obsluga/reklamacje/${rek}`]]);
  potwierdz("kl", za(10));
  wiadomoscSprawy(dys, "ADMIN", iso(11));
  assert.deepEqual(nowe(za(12)).map((n) => n.tekst), ["Allegro napisało w dyskusji"]);
});

test("kilka zdarzeń naraz idzie od najnowszego", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  zaloz("kl");
  sprawaAllegro("kl", "CLAIM", iso(3));
  wiadomosc(c, "incoming", iso(2), iso(2));
  zwrot("kl", { utworzono: iso(1) });
  assert.deepEqual(P.sprawaKlienta("kl", za(4), db())!.nowe.map((n) => n.rodzaj),
    ["reklamacja", "rozmowa", "zwrot_nowy"]);
});

test("prowadzący: ustawia się sam, a przejąć można tylko cudzą sprawę w toku", () => {
  zamowienie("z-1", "kl");
  const s = zaloz("kl");
  assert.throws(() => P.przejmijSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ, db()),
    P.KonfliktSprawy, "swojej sprawy się nie przejmuje");
  const p = P.przejmijSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, bob, TERAZ, db());
  assert.deepEqual([p.prowadzi, p.prowadziId, p.wersja], [bob.name, bob.id, 2]);
  const e = zdarzenia().at(-1)!;
  assert.equal(e.type, "klient_sprawa_przejeta");
  assert.deepEqual(JSON.parse(e.payload), { sprawa: s.id, poprzedni: ala.id });

  const z = P.zakonczSprawe("kl", { wersja: p.wersja, odcisk: p.odcisk }, ala, TERAZ, db());
  assert.equal(z.zakonczyl, ala.name);
  assert.equal(z.prowadziId, bob.id, "zakończenie nie zmienia prowadzącego, który jest");
  assert.throws(() => P.przejmijSprawe("kl", { wersja: z.wersja, odcisk: z.odcisk }, ala, TERAZ, db()),
    P.KonfliktSprawy, "zakończonej nie ma czego przejmować");

  /* Sprawa bez prowadzącego dostaje autora — kroku i zakończenia. */
  db().prepare("UPDATE klient_prowadzenie SET prowadzi=NULL, prowadzi_user_id=NULL").run();
  const w = P.ustawKrok("kl", { krok: "dosłać", krokDo: iso(5), wersja: z.wersja, odcisk: z.odcisk }, ala, TERAZ, db());
  assert.equal(w.prowadziId, ala.id);
  assert.equal(w.stan, "w_toku", "krok wznawia zakończoną sprawę");
  assert.equal(w.zakonczyl, null);
  db().prepare("UPDATE klient_prowadzenie SET prowadzi=NULL, prowadzi_user_id=NULL").run();
  assert.throws(() => P.przejmijSprawe("kl", { wersja: w.wersja, odcisk: w.odcisk }, bob, TERAZ, db()),
    P.KonfliktSprawy, "sprawy bez prowadzącego nie przejmuje się — bierze się ją krokiem");
  const z2 = P.zakonczSprawe("kl", { wersja: w.wersja, odcisk: w.odcisk }, bob, TERAZ, db());
  assert.deepEqual([z2.prowadzi, z2.prowadziId], [bob.name, bob.id]);
});

test("zakończenie zostawia krok dla cofnięcia; cofnąć można tylko zakończoną", () => {
  zamowienie("z-1", "kl");
  const s = zaloz("kl");
  assert.throws(() => P.wznowSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ, db()),
    P.KonfliktSprawy);
  const z = P.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ, db());
  assert.deepEqual([z.stan, z.krok, z.krokDo, z.zakonczonoAt], ["zakonczona", s.krok, s.krokDo, TERAZ.toISOString()]);
  assert.throws(() => P.zakonczSprawe("kl", { wersja: z.wersja, odcisk: z.odcisk }, ala, TERAZ, db()),
    P.KonfliktSprawy, "dwa razy się nie kończy");
  const w = P.wznowSprawe("kl", { wersja: z.wersja, odcisk: z.odcisk }, ala, TERAZ, db());
  assert.deepEqual([w.stan, w.krok, w.krokDo, w.zakonczonoAt, w.wersja], ["w_toku", s.krok, s.krokDo, null, 3]);
  assert.deepEqual(zdarzenia().map((e) => [e.type, JSON.parse(e.payload)]), [
    ["klient_sprawa_krok", { sprawa: s.id, znakow: 16, termin: s.krokDo, nowa: true }],
    ["klient_sprawa_zakonczona", { sprawa: s.id }],
    ["klient_sprawa_wznowiona", { sprawa: s.id }],
  ]);
});

test("dziś i po terminie liczą się na dobie LOKALNEJ magazynu, nie UTC", () => {
  const zalozono = new Date("2026-09-20T08:00:00Z");
  const odczyt = new Date("2026-09-26T21:30:00Z"); // 23:30 w magazynie, 26.09
  const krok = (login: string, krokDo: string) => {
    zamowienie(`z-${login}`, login);
    P.ustawKrok(login, { krok: "dosłać", krokDo, wersja: 0, odcisk: "" }, ala, zalozono, db());
    const s = P.sprawaKlienta(login, odczyt, db())!;
    return [s.dzis, s.poTerminie];
  };
  /* 00:30 lokalnie 27.09 — w UTC to jeszcze 26.09, ale w magazynie jutro. */
  assert.deepEqual(krok("jutro", "2026-09-26T22:30:00.000Z"), [false, false]);
  /* 01:00 lokalnie 26.09 — w UTC to 25.09, ale w magazynie dziś. */
  assert.deepEqual(krok("dzis", "2026-09-25T23:00:00.000Z"), [true, false]);
  assert.deepEqual(krok("wczoraj", "2026-09-25T21:00:00.000Z"), [false, true]);
});

test("„Moje”: nowe na górze, terminy scalone po dacie, reszta kolejek, kroki na przyszłość na dole", () => {
  const d = db();
  const zalozono = new Date("2026-09-20T08:00:00Z");
  const odczyt = new Date("2026-09-26T21:30:00Z"); // 23:30 lokalnie
  const sprawa = (login: string, krokDo: string, kto = ala) => {
    zamowienie(`z-${login}`, login);
    return P.ustawKrok(login, { krok: `krok ${login}`, krokDo, wersja: 0, odcisk: "" }, kto, zalozono, d);
  };
  const dzis = sprawa("dzis", "2026-09-26T21:45:00.000Z");
  const nocna = sprawa("nocna", "2026-09-25T23:00:00.000Z"); // 01:00 lokalnie 26.09 — dziś
  const stara = sprawa("stara", "2026-09-24T10:00:00.000Z");
  const jutro = sprawa("jutro", "2026-09-26T22:30:00.000Z"); // 00:30 lokalnie 27.09 — czeka
  const pozniej = sprawa("pozniej", "2026-10-01T10:00:00.000Z");
  sprawa("cudza", "2026-09-24T10:00:00.000Z", bob);
  const zakoncz = (login: string) => {
    const s = P.sprawaKlienta(login, zalozono, d)!;
    return P.zakonczSprawe(login, { wersja: s.wersja, odcisk: s.odcisk }, ala, zalozono, d);
  };
  const cicha = sprawa("cicha", "2026-09-28T10:00:00.000Z");
  zakoncz("cicha");
  /* Dwie obudzone: klient pisał najpierw w „drugiej”, potem w „pierwszej”
     — dłużej czeka „druga”, więc stoi wyżej. */
  const pierwsza = sprawa("pierwsza", "2026-09-28T10:00:00.000Z");
  const druga = sprawa("druga", "2026-09-28T10:00:00.000Z");
  zakoncz("pierwsza");
  zakoncz("druga");
  wiadomosc(rozmowa("w-p", "pierwsza"), "incoming", "2026-09-26T15:00:00.000Z", "2026-09-26T15:00:00.000Z");
  wiadomosc(rozmowa("w-d", "druga"), "incoming", "2026-09-26T12:00:00.000Z", "2026-09-26T12:00:00.000Z");

  /* Kolejki: reklamacja z terminem między krokami i rozmowa bez terminu. */
  const rek = sprawaAllegro("rekl", "CLAIM");
  d.prepare("UPDATE reklamacja_klienta SET prowadzi_user_id=?, decyzja_do=? WHERE id=?")
    .run(ala.id, "2026-09-26T12:00:00.000Z", rek);
  const c = rozmowa("w-moja", "ktos");
  wiadomosc(c, "incoming", iso(-1), iso(-1));
  d.prepare("UPDATE conversation SET assigned_user_id=?, status='open' WHERE id=?").run(ala.id, c);

  const lista = P.mojaLista(d, ala.id, odczyt);
  assert.deepEqual(lista.map((w) => `${w.kolejka}:${w.id}`), [
    `klient:${druga.id}`, `klient:${pierwsza.id}`,
    `klient:${stara.id}`, `klient:${nocna.id}`, `reklamacja:${rek}`, `klient:${dzis.id}`,
    `rozmowa:${c}`,
    `klient:${jutro.id}`, `klient:${pozniej.id}`,
  ]);
  assert.ok(!lista.some((w) => w.id === cicha.id && w.kolejka === "klient"), "zakończona bez nowego nie wraca");
  const po = (id: number) => lista.find((w) => w.kolejka === "klient" && w.id === id)!;
  assert.deepEqual([po(stara.id).poTerminie, po(stara.id).dzis, po(stara.id).czeka], [true, false, false]);
  assert.deepEqual([po(nocna.id).dzis, po(nocna.id).poTerminie], [true, false]);
  assert.deepEqual([po(jutro.id).czeka, po(jutro.id).dzis], [true, false]);
  assert.equal(po(jutro.id).terminDo, "2026-09-26T22:30:00.000Z");
  assert.equal(po(jutro.id).cel, "/obsluga/klient/jutro");
  assert.equal(po(jutro.id).login, "jutro");
  assert.equal(po(jutro.id).nowe, null);
  assert.equal(po(druga.id).nowe, "Klient napisał 26.09 14:00");

  assert.deepEqual(P.mojaLista(d, bob.id, odczyt).map((w) => w.kolejka), ["klient"], "cudzej sprawy nie ma");
});

test("odczyty niczego nie zapisują: sprawa, odcisk, „Moje”", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  const s = zaloz("kl");
  P.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ, db());
  wiadomosc(c, "incoming", iso(1), iso(1));
  const przed = zmiany();
  P.sprawaKlienta("kl", za(2), db());
  P.odciskTeraz("kl", db());
  P.mojaLista(db(), ala.id, za(2));
  assert.equal(zmiany(), przed);
});

test("dziennik sprawy nigdy nie niesie loginu ani kroku — tylko numer sprawy", () => {
  zamowienie("z-1", "Kowalski_Jan88");
  const s = P.ustawKrok("kowalski_jan88", { krok: "Pan Kowalski prosi o telefon", krokDo: iso(10), wersja: 0,
    odcisk: "" }, ala, TERAZ, db());
  const z = P.zakonczSprawe("kowalski_jan88", { wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ, db());
  const w = P.wznowSprawe("kowalski_jan88", { wersja: z.wersja, odcisk: z.odcisk }, ala, TERAZ, db());
  P.przejmijSprawe("kowalski_jan88", { wersja: w.wersja, odcisk: w.odcisk }, bob, TERAZ, db());
  const wpisy = zdarzenia();
  assert.equal(wpisy.length, 4);
  for (const e of wpisy) {
    assert.equal(JSON.parse(e.payload).sprawa, s.id);
    assert.doesNotMatch(e.payload.toLowerCase(), /kowalski|telefon|prosi/, e.type);
  }
});

test("obudzoną zakończoną kończy się znów jednym zapisem; bez nowego — dalej 409", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  const s = zaloz("kl");
  P.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, za(1), db());
  wiadomosc(c, "incoming", iso(2), iso(2));
  const obudzona = P.sprawaKlienta("kl", za(3), db())!;
  assert.equal(obudzona.nowe.length, 1);
  assert.equal(P.mojaLista(db(), ala.id, za(3))[0]?.id, obudzona.id);

  /* Stary odcisk przegrywa także tu — ponowne zakończenie potwierdza nowe. */
  assert.throws(() => P.zakonczSprawe("kl", { wersja: obudzona.wersja, odcisk: s.odcisk }, ala, za(3), db()),
    (e: unknown) => e instanceof P.KonfliktSprawy && e.message === "Klient dopisał coś po otwarciu ekranu");

  const z = P.zakonczSprawe("kl", { wersja: obudzona.wersja, odcisk: obudzona.odcisk }, ala, za(3), db());
  assert.deepEqual([z.stan, z.nowe, z.wersja, z.zakonczonoAt], ["zakonczona", [], obudzona.wersja + 1, iso(3)]);
  assert.deepEqual(P.mojaLista(db(), ala.id, za(3)), [], "zgaszone obudzenie schodzi z „Moje”");
  assert.deepEqual(JSON.parse(zdarzenia().at(-1)!.payload), { sprawa: s.id, ponownie: true },
    "miara z S6 czyta ponowne zakończenie z dziennika");

  const przed = zmiany();
  assert.throws(() => P.zakonczSprawe("kl", { wersja: z.wersja, odcisk: z.odcisk }, ala, za(3), db()),
    (e: unknown) => e instanceof P.KonfliktSprawy && e.message === "Sprawa nie jest w toku");
  /* Cofnięcie ponownego zakończenia otworzyłoby sprawę z krokiem po terminie. */
  assert.throws(() => P.wznowSprawe("kl", { wersja: z.wersja, odcisk: z.odcisk }, ala, za(3), db()),
    (e: unknown) => e instanceof P.KonfliktSprawy && e.message === "Tego zakończenia nie cofa się — ustaw krok");
  assert.equal(zmiany(), przed);
});

test("„Cofnij” oddaje sprawie nowe sprzed zakończenia, zamiast je potwierdzić", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  zaloz("kl");
  wiadomosc(c, "incoming", iso(1), iso(1));
  const przed = P.sprawaKlienta("kl", za(2), db())!;
  assert.equal(przed.nowe.length, 1);

  const z = P.zakonczSprawe("kl", { wersja: przed.wersja, odcisk: przed.odcisk }, ala, za(2), db());
  assert.deepEqual(z.nowe, [], "zakończenie potwierdza, co było widać");
  const w = P.wznowSprawe("kl", { wersja: z.wersja, odcisk: z.odcisk }, ala, za(2), db());
  assert.deepEqual([w.stan, w.nowe], ["w_toku", przed.nowe], "pomyłka i jej cofnięcie nie załatwiają klienta");
  const [wiersz] = P.mojaLista(db(), ala.id, za(2));
  assert.deepEqual([wiersz.kolejka, wiersz.nowe, wiersz.cel], ["klient", przed.nowe[0].tekst, `/obsluga/skrzynka/${c}`]);
});

test("„Przejmij” i „Cofnij” z ekranu sprzed wiadomości klienta to 409 bez zapisu", () => {
  zamowienie("z-1", "kl");
  const c = rozmowa("w-1", "kl");
  const s = zaloz("kl");
  const ekranBoba = P.sprawaKlienta("kl", za(1), db())!;
  wiadomosc(c, "incoming", iso(2), iso(2));
  const przed = zmiany();
  const swieza = (e: unknown) => {
    assert.ok(e instanceof P.KonfliktSprawy);
    assert.equal(e.message, "Klient dopisał coś po otwarciu ekranu");
    assert.equal(e.sprawa?.nowe[0]?.rodzaj, "rozmowa", "przegrany dostaje sprawę z tym, czego nie widział");
    return true;
  };
  assert.throws(() => P.przejmijSprawe("kl", { wersja: ekranBoba.wersja, odcisk: ekranBoba.odcisk }, bob,
    za(3), db()), swieza);
  assert.equal(zmiany(), przed);
  assert.equal(P.sprawaKlienta("kl", za(3), db())!.prowadziId, ala.id);

  /* „Cofnij” niesie odcisk z odpowiedzi zakończenia; wiadomość w tych ośmiu
     sekundach zostawia sprawę zakończoną i obudzoną, jak jest naprawdę. */
  const teraz = P.sprawaKlienta("kl", za(3), db())!;
  const z = P.zakonczSprawe("kl", { wersja: teraz.wersja, odcisk: teraz.odcisk }, ala, za(3), db());
  wiadomosc(c, "incoming", iso(3.001), iso(3.001));
  const poZakonczeniu = zmiany();
  assert.throws(() => P.wznowSprawe("kl", { wersja: z.wersja, odcisk: z.odcisk }, ala, za(3.002), db()), swieza);
  assert.equal(zmiany(), poZakonczeniu);
  const po = P.sprawaKlienta("kl", za(3.002), db())!;
  assert.deepEqual([po.stan, po.nowe.length], ["zakonczona", 1]);
  assert.equal(s.id, po.id);
});

test("okno obudzenia: zakończona 29 dni temu budzi się, 31 dni temu — już nie", () => {
  const sprawa = (login: string, dni: number) => {
    zamowienie(`z-${login}`, login);
    const od = za(-24 * dni);
    const s = zaloz(login, ala, od);
    P.zakonczSprawe(login, { wersja: s.wersja, odcisk: s.odcisk }, ala, od, db());
    wiadomosc(rozmowa(`w-${login}`, login), "incoming", iso(-1), iso(-1));
    return s.id;
  };
  const swieza = sprawa("swieza", 29);
  sprawa("stara", 31);

  assert.equal(P.sprawaKlienta("swieza", TERAZ, db())!.nowe.length, 1);
  const stara = P.sprawaKlienta("stara", TERAZ, db())!;
  assert.deepEqual([stara.stan, stara.nowe], ["zakonczona", []],
    "po miesiącu nowa wiadomość to nowa sprawa — profil i lista mówią to samo");
  assert.deepEqual(P.mojaLista(db(), ala.id, TERAZ).map((w) => w.id), [swieza]);
  /* Starej nie kończy się drugi raz — zaczyna się ją krokiem. */
  assert.throws(() => P.zakonczSprawe("stara", { wersja: stara.wersja, odcisk: stara.odcisk }, ala, TERAZ, db()),
    (e: unknown) => e instanceof P.KonfliktSprawy && e.message === "Sprawa nie jest w toku");
  assert.equal(P.ustawKrok("stara", { krok: "odpisać", krokDo: iso(24), wersja: stara.wersja, odcisk: stara.odcisk },
    ala, TERAZ, db()).stan, "w_toku");
});

/** Loginy, którym liczył się odcisk — po zapytaniu `kontaLoginu`, od którego odcisk się zaczyna. */
function odciskiPrzy(zrob: (d: ReturnType<typeof db>) => void): string[] {
  const d = db();
  const loginy: string[] = [];
  const podglad = new Proxy(d, {
    get(cel, klucz) {
      if (klucz === "prepare") {
        return (sql: string) => {
          const st = cel.prepare(sql);
          if (!sql.includes("AS k, kupujacy_login AS l")) return st;
          return new Proxy(st, { get(c, k) {
            if (k === "all") return (...a: unknown[]) => { loginy.push(String(a[0])); return c.all(...(a as [])); };
            const v = Reflect.get(c, k);
            return typeof v === "function" ? v.bind(c) : v;
          } });
        };
      }
      const v = Reflect.get(cel, klucz);
      return typeof v === "function" ? v.bind(cel) : v;
    },
  });
  zrob(podglad);
  return loginy.sort();
}

test("„Moje” nie liczy odcisku zakończonej sprawie, przy której klient się nie ruszył", () => {
  const d = db();
  const zakonczona = (login: string, dni = 2) => {
    zamowienie(`z-${login}`, login);
    const od = za(-24 * dni);
    const s = zaloz(login, ala, od);
    return P.zakonczSprawe(login, { wersja: s.wersja, odcisk: s.odcisk }, ala, od, d);
  };
  zakonczona("cicha");
  /* Wiadomość wstawiona PRZED zakończeniem — znana, sita nie przechodzi. */
  const c = rozmowa("w-cicha", "cicha");
  wiadomosc(c, "incoming", iso(-24 * 3), iso(-24 * 3));
  zakonczona("zwrot");
  zwrot("zwrot");
  zakonczona("pisze");
  wiadomosc(rozmowa("w-pisze", "pisze"), "incoming", iso(-1), iso(-1));
  /* Rozmowa bez rozmówcy w wątku: do klienta prowadzi ją tylko numer
     zamówienia — sito musi ją znaleźć tą samą drogą co profil. */
  zakonczona("bezwatku");
  const x = rozmowa("w-x", null);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
      related_order_id,sent_at,created_at) VALUES (?,?,'m-x','incoming','treść','z-bezwatku',?,?)`)
    .run(x, konto, iso(-1), iso(-1));
  zakonczona("dawna", 31);
  zwrot("dawna");
  zamowienie("z-wtoku", "wtoku");
  zaloz("wtoku");

  let lista: ReturnType<typeof P.mojaLista> = [];
  const liczone = odciskiPrzy((podglad) => { lista = P.mojaLista(podglad, ala.id, TERAZ); });
  assert.deepEqual(liczone, ["bezwatku", "pisze", "wtoku", "zwrot"],
    "cicha i dawna nie przechodzą przez sito — odcisk się dla nich nie liczy");
  assert.deepEqual(lista.map((w) => w.login).sort(), ["bezwatku", "pisze", "wtoku", "zwrot"]);
});

test("znacznik bez strefy to UTC, jak w SQLite — próg obudzenia nie zależy od strefy maszyny", () => {
  const byla = process.env.TZ;
  try {
    /* Warszawa: `Date.parse` cofnąłby 10:30 bez strefy o dwie godziny, przed
       ruch agenta o 10:00 UTC — i wiadomość po ruchu nie obudziłaby sprawy. */
    process.env.TZ = "Europe/Warsaw";
    zamowienie("z-po", "po");
    zaloz("po");
    wiadomosc(rozmowa("w-po", "po"), "incoming", "2026-09-26 10:30:00", "2026-09-26 10:30:00");
    const po = P.sprawaKlienta("po", za(1), db())!;
    assert.deepEqual(po.nowe.map((n) => [n.tekst, n.at]), [["Klient napisał 26.09 12:30", "2026-09-26T10:30:00.000Z"]]);
    assert.deepEqual(P.mojaLista(db(), ala.id, za(1)).filter((w) => w.nowe).map((w) => w.login), ["po"]);

    /* São Paulo: tu `Date.parse` przesunąłby 09:30 o trzy godziny naprzód,
       za ruch agenta — i wiadomość sprzed ruchu obudziłaby sprawę fałszywie. */
    process.env.TZ = "America/Sao_Paulo";
    zamowienie("z-przed", "przed");
    zaloz("przed");
    wiadomosc(rozmowa("w-przed", "przed"), "incoming", "2026-09-26 09:30:00", "2026-09-26 09:30:00");
    assert.deepEqual(P.sprawaKlienta("przed", za(1), db())!.nowe, []);
  } finally {
    if (byla === undefined) delete process.env.TZ; else process.env.TZ = byla;
  }
});
