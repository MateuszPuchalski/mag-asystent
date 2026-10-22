import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  BladPomylki, BrakPomylki, KonfliktPomylki, dodajPomylke, licznikDoUzupelnienia, listaPomylek,
  opisPomylki, osobyReczne, podsumowanieMiesiaca, pomylka, pomylkiKlienta, pozycjeDoWyboru, usunPomylke,
  wznowPomylke, zakonczPomylke, zalozPomylkeZDosylki, zalozPomylkeZOdmowy, zmienPomylke,
} from "./pomylki.js";

/* Serwis pomyłek pilnuje czterech rzeczy:
   1. fakty z kolejek wygrywają z wpisem ręki i liczą stan przy odczycie;
   2. automat zakłada JEDNĄ pomyłkę na zamówienie i nie zakłada jej przy
      brakującej części;
   3. blokada wersji i 404 mają własne błędy, które trasa tłumaczy;
   4. dziennik niesie numer pomyłki, nigdy loginu ani treści. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const KTO = { id: 1, name: "Ala z biura" };
const TERAZ = new Date("2026-10-19T10:00:00Z");

function baza(): Db {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(id,channel,external_account_id) VALUES (1,'allegro','k')").run();
  for (const [id, name, role] of [[1, "Ala z biura", "biuro"], [2, "Marek", "magazynier"], [3, "Ola", "magazynier"]]) {
    d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (?,?,?,?)").run(id, `u${id}`, name, role);
  }
  return d as unknown as Db;
}

function zamowienie(d: Db, numer = "ord-1", login = "Kupiec_77") {
  const id = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,kupujacy_login,synced_at)
      VALUES (1,?,?,'2026-10-01T00:00:00Z')`).run(numer, login).lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,nazwa,sku,ilosc,cena_grosze,waluta)
      VALUES (?,'Nóż NAC 46','NAC-46',1,4999,'PLN')`).run(id);
  return id;
}

function zwrot(d: Db, n: { numer?: string; login?: string | null; kod?: string | null; komentarz?: string } = {}) {
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,kupujacy_login,
      created_at,synced_at,odmowa_kod) VALUES (1,?,?,?,'2026-10-10T08:00:00Z','2026-10-10T08:00:00Z',?)`)
    .run(`zw-${Math.random()}`, n.numer ?? "ord-1", n.login === undefined ? "kupiec_77" : n.login, n.kod ?? null)
    .lastInsertRowid);
  d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,powod_komentarz,klucz)
      VALUES (?,'1','Nóż NAC 46',1,4999,'PLN',?,'1|Nóż')`).run(id, n.komentarz ?? null);
  return id;
}

const ileWierszy = (d: Db) => Number((d.prepare("SELECT count(*) n FROM pomylka_wysylki").get() as { n: number }).n);
const wpisy = (d: Db) => d.prepare("SELECT type, payload FROM events WHERE type LIKE 'pomylka_%' ORDER BY id")
  .all() as Array<{ type: string; payload: string }>;

test("opis składa się z dwóch pól, a bez „co dostał” go nie ma", () => {
  assert.equal(opisPomylki("nóż 40", "nóż 46"), "Dostał nóż 40 zamiast nóż 46");
  assert.equal(opisPomylki("nóż 40", null), "Dostał nóż 40");
  assert.equal(opisPomylki(null, "nóż 46"), null);
  assert.equal(opisPomylki("  ", "  "), null);
});

test("odmowa NEW_ITEM_SENT zakłada dokładnie jedną pomyłkę; powtórka i dosyłka nie dublują", () => {
  const d = baza();
  const z = zwrot(d, { kod: "NEW_ITEM_SENT" });
  const id = zalozPomylkeZOdmowy(d, z, KTO, TERAZ);
  assert.ok(id);
  assert.equal(zalozPomylkeZOdmowy(d, z, KTO, TERAZ), null, "druga próba trafia w istniejący wiersz");
  assert.equal(zalozPomylkeZDosylki(d, { login: "kupiec_77", konto: 1, zamowienie: "ord-1", kod: "NEW_ITEM_SENT" },
    KTO, TERAZ), null);
  assert.equal(ileWierszy(d), 1);
  const p = pomylka(id!, d)!;
  assert.deepEqual([p.zgloszono, p.login, p.konto, p.zamowienie, p.zrodlo, p.zwrotId, p.stan],
    ["2026-10-19", "kupiec_77", 1, "ord-1", "odmowa", z, "do_uzupelnienia"]);
  assert.deepEqual(p.odmowa, { wartosc: "tak", zKolejki: true, kod: "NEW_ITEM_SENT" });
  assert.deepEqual(wpisy(d).map((e) => e.type), ["pomylka_zalozona"]);
  assert.doesNotMatch(JSON.stringify(wpisy(d)), /kupiec/i, "login nie idzie do dziennika");
});

test("odmowa innym kodem albo bez loginu pomyłki nie zakłada", () => {
  const d = baza();
  assert.equal(zalozPomylkeZOdmowy(d, zwrot(d, { kod: "MISSING_PART_SENT" }), KTO, TERAZ), null);
  assert.equal(zalozPomylkeZOdmowy(d, zwrot(d, { numer: "ord-2", kod: "NEW_ITEM_SENT", login: null }), KTO, TERAZ), null);
  assert.equal(zalozPomylkeZOdmowy(d, 9999, KTO, TERAZ), null);
  assert.equal(ileWierszy(d), 0);
});

test("dosyłka brakującej części nie jest pomyłką; numer wpisany ręką pyta zwrot", () => {
  const d = baza();
  const p = { login: "kupiec_77", konto: 1, zamowienie: "ord-1" };
  assert.equal(zalozPomylkeZDosylki(d, { ...p, kod: "MISSING_PART_SENT" }, KTO, TERAZ), null);
  /* Zwrot bez odmowy złym towarem: numer ręką to nie dowód pomyłki. */
  zwrot(d, { kod: "MISSING_PART_SENT" });
  assert.equal(zalozPomylkeZDosylki(d, { ...p, kod: null }, KTO, TERAZ), null);
  /* Bez zwrotu numer ręką to np. druga paczka za zgubioną — nie pomyłka. */
  assert.equal(zalozPomylkeZDosylki(d, { ...p, zamowienie: "ord-9", kod: null }, KTO, TERAZ), null);
  assert.equal(ileWierszy(d), 0);
  /* Zwrot z odmową złym towarem (z Allegro, ze spacją) rozstrzyga na tak. */
  const z = zwrot(d, { numer: "ord-8" });
  d.prepare("UPDATE zwrot_klienta SET rejection_code=' NEW_ITEM_SENT ' WHERE id=?").run(z);
  const id = zalozPomylkeZDosylki(d, { ...p, zamowienie: "ord-8", kod: null }, KTO, TERAZ);
  assert.ok(id);
  assert.equal(pomylka(id!, d)!.zrodlo, "dosylka");
});

test("fakty z kolejek wygrywają z ręką, a stan liczy się sam", () => {
  const d = baza();
  zamowienie(d);
  const { pomylka: p } = dodajPomylke({ login: "ktokolwiek", zamowienie: "ord-1", coDostal: "nóż 40" }, KTO, TERAZ, d);
  assert.equal(p.login, "Kupiec_77", "login z zamówienia bije wpisany");
  assert.equal(p.konto, 1);
  assert.equal(p.stan, "do_uzupelnienia", "bez osób pomyłka czeka na agenta");

  let w = zmienPomylke(p.id, { wersja: p.wersja, zbieralUserId: 2, nowyTowar: "nie", towarWrocil: "nie_wraca",
    odmowa: "nie_trzeba" }, KTO, TERAZ, d);
  assert.equal(w.zbieral?.nazwa, "Marek");
  assert.equal(w.stan, "zakonczona", "wszystkie trzy kolumny rozstrzygnięte ręką kończą pomyłkę");
  assert.deepEqual([w.nowyTowar.zKolejki, w.towarWrocil.zKolejki, w.odmowa.zKolejki], [false, false, false]);

  w = zmienPomylke(p.id, { wersja: w.wersja, towarWrocil: null }, KTO, TERAZ, d);
  assert.equal(w.stan, "w_toku");

  /* Kolejki mówią: dosyłka ma numer, paczka zwrotu doszła, odmowa poszła. */
  const z = zwrot(d, { kod: "NEW_ITEM_SENT" });
  d.prepare("UPDATE zwrot_klienta SET dostarczono_at='2026-10-12T22:30:00Z' WHERE id=?").run(z);
  d.prepare(`INSERT INTO klient_prowadzenie(id,login,krok,krok_do,znane_json,zmieniono_at,zmieniono_przez)
      VALUES (1,'Kupiec_77','x','2026-10-20T00:00:00Z','{}','2026-10-19T00:00:00Z','x')`).run();
  d.prepare(`INSERT INTO klient_dosylka(sprawa_id,konto,zamowienie,waybill,zalozono_at)
      VALUES (1,1,'ord-1','DPD123','2026-10-13T00:00:00Z')`).run();
  w = pomylka(p.id, d)!;
  assert.deepEqual(w.nowyTowar, { wartosc: "tak", zKolejki: true }, "ręczne „nie” przegrywa z dosyłką z numerem");
  assert.deepEqual(w.towarWrocil, { wartosc: "2026-10-13", zKolejki: true }, "dzień lokalny, nie doba UTC");
  assert.deepEqual(w.odmowa, { wartosc: "tak", zKolejki: true, kod: "NEW_ITEM_SENT" });
  assert.equal(w.zwrotId, z);
  assert.equal(w.stan, "zakonczona");
});

test("ręczne zakończenie wygrywa, wznowienie wraca do stanu liczonego", () => {
  const d = baza();
  const { pomylka: p } = dodajPomylke({ login: "paragon Kowalski" }, KTO, TERAZ, d);
  const z = zakonczPomylke(p.id, p.wersja, KTO, TERAZ, d);
  assert.deepEqual([z.stan, z.zakonczonaRecznie], ["zakonczona", true]);
  const w = wznowPomylke(p.id, z.wersja, KTO, TERAZ, d);
  assert.deepEqual([w.stan, w.zakonczonaRecznie], ["do_uzupelnienia", false]);
  assert.deepEqual(wpisy(d).map((e) => e.type), ["pomylka_dodana", "pomylka_zakonczona", "pomylka_wznowiona"]);
});

test("stara wersja to konflikt z bieżącym stanem, brak wiersza to osobny błąd", () => {
  const d = baza();
  const { pomylka: p } = dodajPomylke({ login: "kupiec" }, KTO, TERAZ, d);
  zmienPomylke(p.id, { wersja: p.wersja, coDostal: "grabie" }, KTO, TERAZ, d);
  assert.throws(() => zmienPomylke(p.id, { wersja: p.wersja, coDostal: "łopata" }, KTO, TERAZ, d),
    (e: unknown) => e instanceof KonfliktPomylki && e.pomylka.coDostal === "grabie");
  assert.throws(() => zakonczPomylke(p.id, p.wersja, KTO, TERAZ, d), KonfliktPomylki);
  assert.throws(() => zmienPomylke(999, { wersja: 1 }, KTO, TERAZ, d), BrakPomylki);
  assert.throws(() => pozycjeDoWyboru(999, d), BrakPomylki);
});

test("osoba: nieznane konto odpada, wyczyszczenie zdejmuje winę, wina bez osoby odpada", () => {
  const d = baza();
  let p = dodajPomylke({ login: "kupiec" }, KTO, TERAZ, d).pomylka;
  assert.throws(() => zmienPomylke(p.id, { wersja: p.wersja, zbieralUserId: 77 }, KTO, TERAZ, d), BladPomylki);
  assert.throws(() => zmienPomylke(p.id, { wersja: p.wersja, winaPakujacego: true }, KTO, TERAZ, d), BladPomylki);
  p = zmienPomylke(p.id, { wersja: p.wersja, zbieralUserId: 2, pakowalUserId: 3, winaZbierajacego: true,
    winaPakujacego: true }, KTO, TERAZ, d);
  assert.deepEqual([p.zbieral, p.pakowal, p.winaZbierajacego, p.winaPakujacego],
    [{ userId: 2, nazwa: "Marek" }, { userId: 3, nazwa: "Ola" }, true, true]);
  p = zmienPomylke(p.id, { wersja: p.wersja, zbieralUserId: null }, KTO, TERAZ, d);
  assert.deepEqual([p.zbieral, p.winaZbierajacego, p.winaPakujacego], [null, false, true]);
  assert.throws(() => zmienPomylke(p.id, { wersja: p.wersja, towarWrocil: "wczoraj" }, KTO, TERAZ, d), BladPomylki);
  assert.throws(() => zmienPomylke(p.id, { wersja: p.wersja, nowyTowar: "może" }, KTO, TERAZ, d), BladPomylki);
  const ostatni = wpisy(d).at(-1)!;
  assert.deepEqual(JSON.parse(ostatni.payload), { pomylka: p.id, pola: ["zbieralUserId"] });
});

test("ręczne zgłoszenie dla zamówienia z pomyłką oddaje istniejącą; bez klienta odpada", () => {
  const d = baza();
  zwrot(d, { kod: "NEW_ITEM_SENT" });
  const id = zalozPomylkeZOdmowy(d, Number((d.prepare("SELECT id FROM zwrot_klienta").get() as { id: number }).id),
    KTO, TERAZ)!;
  const r = dodajPomylke({ login: "", zamowienie: "ord-1" }, KTO, TERAZ, d);
  assert.deepEqual([r.nowa, r.pomylka.id], [false, id], "login i konto przyszły ze zwrotu");
  assert.throws(() => dodajPomylke({ login: "  " }, KTO, TERAZ, d), BladPomylki);
  assert.throws(() => dodajPomylke({ zamowienie: "nieznane" }, KTO, TERAZ, d), BladPomylki);
  assert.equal(ileWierszy(d), 1);
});

test("lista filtruje po stanie i miesiącu, najnowsze pierwsze; licznik liczy do uzupełnienia", () => {
  const d = baza();
  const a = dodajPomylke({ login: "a" }, KTO, new Date("2026-09-30T21:30:00Z"), d).pomylka;
  const pozno = dodajPomylke({ login: "p" }, KTO, new Date("2026-09-30T22:30:00Z"), d).pomylka;
  const b = dodajPomylke({ login: "b", coDostal: "x" }, KTO, TERAZ, d).pomylka;
  zmienPomylke(b.id, { wersja: b.wersja, pakowalUserId: 3 }, KTO, TERAZ, d);
  assert.equal(a.zgloszono, "2026-09-30", "23:30 w magazynie to nadal 30 września");
  assert.equal(pozno.zgloszono, "2026-10-01", "00:30 w magazynie to już październik, choć w UTC wrzesień");
  zakonczPomylke(pozno.id, pozno.wersja, KTO, TERAZ, d);
  assert.deepEqual(listaPomylek({}, d).map((x) => x.id), [b.id, pozno.id, a.id]);
  assert.deepEqual(listaPomylek({ stan: "do_uzupelnienia" }, d).map((x) => x.id), [a.id]);
  assert.deepEqual(listaPomylek({ stan: "w_toku" }, d).map((x) => x.id), [b.id]);
  assert.deepEqual(listaPomylek({ stan: "zakonczone" }, d).map((x) => x.id), [pozno.id]);
  assert.deepEqual(listaPomylek({ miesiac: "2026-09" }, d).map((x) => x.id), [a.id]);
  assert.equal(licznikDoUzupelnienia(d), 1);
  assert.throws(() => listaPomylek({ stan: "otwarte" }, d), BladPomylki);
  assert.throws(() => listaPomylek({ miesiac: "2026-13" }, d), BladPomylki);
});

test("podsumowanie miesiąca liczy role i winę na osobę; podwójna wina to jedna pomyłka", () => {
  const d = baza();
  const raz = dodajPomylke({ login: "a" }, KTO, TERAZ, d).pomylka;
  zmienPomylke(raz.id, { wersja: 1, zbieralUserId: 2, pakowalUserId: 2, winaZbierajacego: true,
    winaPakujacego: true }, KTO, TERAZ, d);
  const dwa = dodajPomylke({ login: "b" }, KTO, TERAZ, d).pomylka;
  zmienPomylke(dwa.id, { wersja: 1, zbieralUserId: 3, pakowalUserId: 2, winaZbierajacego: true }, KTO, TERAZ, d);
  dodajPomylke({ login: "c" }, KTO, new Date("2026-09-10T10:00:00Z"), d);
  const s = podsumowanieMiesiaca("2026-10", d);
  assert.equal(s.razem, 2);
  assert.deepEqual(s.osoby, [
    { userId: 2, nazwa: "Marek", zbieral: 1, pakowal: 2, winny: 1 },
    { userId: 3, nazwa: "Ola", zbieral: 1, pakowal: 0, winny: 1 },
  ]);
  assert.equal(podsumowanieMiesiaca("2026-09", d).razem, 1);
});

test("podsumowanie niesie stany, źródła, pół roku wstecz i najczęściej mylone towary", () => {
  const d = baza();
  const raz = dodajPomylke({ login: "a", coZamowil: "Nóż NAC 46" }, KTO, TERAZ, d).pomylka;
  zmienPomylke(raz.id, { wersja: 1, coDostal: "Nóż 40", zbieralUserId: 2 }, KTO, TERAZ, d);
  dodajPomylke({ login: "b", coZamowil: "nóż nac 46" }, KTO, TERAZ, d);
  dodajPomylke({ login: "c", coZamowil: "Pompa" }, KTO, TERAZ, d);
  dodajPomylke({ login: "d" }, KTO, new Date("2026-06-10T10:00:00Z"), d);
  dodajPomylke({ login: "e" }, KTO, new Date("2026-04-10T10:00:00Z"), d);
  const s = podsumowanieMiesiaca("2026-10", d);
  assert.deepEqual(s.stany, { do_uzupelnienia: 2, w_toku: 1, zakonczona: 0 });
  assert.deepEqual(s.zrodla, { odmowa: 0, dosylka: 0, recznie: 3 });
  assert.equal(s.bezWinnego, 1, "osoba bez winy nie wchodzi do rachunku, więc liczy się osobno");
  assert.deepEqual(s.trend, [
    { miesiac: "2026-05", razem: 0 }, { miesiac: "2026-06", razem: 1 }, { miesiac: "2026-07", razem: 0 },
    { miesiac: "2026-08", razem: 0 }, { miesiac: "2026-09", razem: 0 }, { miesiac: "2026-10", razem: 3 },
  ]);
  /* Pisownia z najnowszego wpisu: lista idzie od najnowszej. */
  assert.deepEqual(s.towary, [{ nazwa: "nóż nac 46", ile: 2 }, { nazwa: "Pompa", ile: 1 }]);
  assert.deepEqual(podsumowanieMiesiaca("2026-01", d).trend.map((t) => t.miesiac),
    ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"], "trend przechodzi przez rok");
});

test("osoba spoza listy: samo imię bez konta, liczona po imieniu i podsuwana ponownie", () => {
  const d = baza();
  const p = dodajPomylke({ login: "a" }, KTO, TERAZ, d).pomylka;
  const z = zmienPomylke(p.id, { wersja: 1, zbieralNazwa: "  Kuba sezonowy ", winaZbierajacego: true }, KTO, TERAZ, d);
  assert.deepEqual([z.zbieral, z.winaZbierajacego], [{ userId: null, nazwa: "Kuba sezonowy" }, true]);
  const q = dodajPomylke({ login: "b" }, KTO, TERAZ, d).pomylka;
  zmienPomylke(q.id, { wersja: 1, pakowalNazwa: "kuba sezonowy" }, KTO, TERAZ, d);
  assert.deepEqual(osobyReczne(d), ["Kuba sezonowy"], "jedno imię bez względu na wielkość liter");
  assert.deepEqual(podsumowanieMiesiaca("2026-10", d).osoby,
    [{ userId: null, nazwa: "Kuba sezonowy", zbieral: 1, pakowal: 1, winny: 1 }]);
  assert.throws(() => zmienPomylke(p.id, { wersja: 2, zbieralNazwa: " " }, KTO, TERAZ, d), BladPomylki);
  assert.throws(() => zmienPomylke(p.id, { wersja: 2, zbieralNazwa: "x".repeat(61) }, KTO, TERAZ, d), BladPomylki);
  assert.throws(() => zmienPomylke(p.id, { wersja: 2, zbieralNazwa: "Kuba", zbieralUserId: 2 }, KTO, TERAZ, d),
    BladPomylki);
  /* Wybór konta po imieniu ręcznym zdejmuje imię: id wraca razem z nazwą z kartoteki. */
  assert.deepEqual(zmienPomylke(p.id, { wersja: 2, zbieralUserId: 2 }, KTO, TERAZ, d).zbieral,
    { userId: 2, nazwa: "Marek" });
});

test("usunięcie zdejmuje pomyłkę z rejestru i rachunku, pod blokadą wersji, z wpisem bez treści", () => {
  const d = baza();
  zamowienie(d);
  const p = dodajPomylke({ zamowienie: "ord-1", coDostal: "Nóż 40" }, KTO, TERAZ, d).pomylka;
  assert.throws(() => usunPomylke(p.id, 99, KTO, d), KonfliktPomylki);
  assert.equal(ileWierszy(d), 1, "konflikt niczego nie kasuje");
  usunPomylke(p.id, p.wersja, KTO, d);
  assert.equal(ileWierszy(d), 0);
  assert.equal(podsumowanieMiesiaca("2026-10", d).razem, 0);
  assert.throws(() => usunPomylke(p.id, p.wersja, KTO, d), BrakPomylki);
  const ostatni = wpisy(d).at(-1)!;
  assert.equal(ostatni.type, "pomylka_usunieta");
  assert.deepEqual(JSON.parse(ostatni.payload), { pomylka: p.id, zrodlo: "recznie" });
  /* To samo zamówienie można zgłosić od nowa, gdy jednak była pomyłka. */
  assert.equal(dodajPomylke({ zamowienie: "ord-1" }, KTO, TERAZ, d).nowa, true);
});

test("pozycje z zamówienia, a bez niego ze zwrotu; podpowiedź z komentarza klienta", () => {
  const d = baza();
  zamowienie(d);
  zwrot(d, { komentarz: "Przyszedł nóż 40 cm" });
  const p = dodajPomylke({ login: "x", zamowienie: "ord-1" }, KTO, TERAZ, d).pomylka;
  assert.deepEqual(pozycjeDoWyboru(p.id, d),
    { pozycje: [{ nazwa: "Nóż NAC 46", ilosc: 1, sku: "NAC-46" }], podpowiedz: "Przyszedł nóż 40 cm" });

  zwrot(d, { numer: "ord-2" });
  const bez = dodajPomylke({ login: "x", zamowienie: "ord-2" }, KTO, TERAZ, d).pomylka;
  assert.deepEqual(pozycjeDoWyboru(bez.id, d), { pozycje: [{ nazwa: "Nóż NAC 46", ilosc: 1, sku: null }], podpowiedz: null });

  const paragon = dodajPomylke({ login: "Kowalski" }, KTO, TERAZ, d).pomylka;
  assert.deepEqual(pozycjeDoWyboru(paragon.id, d), { pozycje: [], podpowiedz: null });
});

test("wiązanie: klient bez wielkości liter", () => {
  const d = baza();
  zamowienie(d);
  const p = dodajPomylke({ login: "x", zamowienie: "ord-1" }, KTO, TERAZ, d).pomylka;
  assert.deepEqual(pomylkiKlienta("KUPIEC_77", d).map((x) => x.id), [p.id]);
});

test("pomyłka bez konta: automat i zgłoszenie z kontem ją przejmują zamiast zakładać drugą", () => {
  const d = baza();
  /* Paragon albo zgłoszenie z samym numerem — zamówienia w bazie jeszcze nie ma. */
  const reczna = dodajPomylke({ login: "kupiec_77", zamowienie: "ord-1" }, KTO, TERAZ, d).pomylka;
  assert.equal(reczna.konto, null);
  const id = zalozPomylkeZOdmowy(d, zwrot(d, { kod: "NEW_ITEM_SENT" }), KTO, TERAZ);
  assert.equal(id, null, "nic nowego nie powstało");
  assert.equal(ileWierszy(d), 1);
  const po = pomylka(reczna.id, d)!;
  assert.deepEqual([po.konto, po.zrodlo, po.wersja], [1, "recznie", reczna.wersja + 1]);
  assert.deepEqual(JSON.parse(wpisy(d).at(-1)!.payload), { pomylka: reczna.id, pola: ["konto"] });

  const drugaReczna = dodajPomylke({ login: "x", zamowienie: "ord-5" }, KTO, TERAZ, d).pomylka;
  const r = dodajPomylke({ login: "x", konto: 1, zamowienie: "ord-5" }, KTO, TERAZ, d);
  assert.deepEqual([r.nowa, r.pomylka.id, r.pomylka.konto], [false, drugaReczna.id, 1]);
  assert.equal(ileWierszy(d), 2);
});

test("porażka zapisu pomyłki przy automacie jest zalogowana i połknięta, a transakcja wołającego żyje", () => {
  const d = baza();
  const z = zwrot(d, { kod: "NEW_ITEM_SENT" });
  d.exec(`CREATE TEMP TRIGGER pomylka_pada BEFORE INSERT ON pomylka_wysylki
    BEGIN SELECT RAISE(ABORT, 'rejestr pomyłek leży'); END`);
  const blad = console.error;
  let zalogowano = 0;
  console.error = () => { zalogowano++; };
  try {
    d.exec("BEGIN IMMEDIATE");
    d.prepare("UPDATE zwrot_klienta SET notatka='zapis wołającego' WHERE id=?").run(z);
    assert.equal(zalozPomylkeZDosylki(d, { login: "k", konto: 1, zamowienie: "ord-1", kod: "NEW_ITEM_SENT" },
      KTO, TERAZ), null);
    d.exec("COMMIT");
    assert.equal(zalozPomylkeZOdmowy(d, z, KTO, TERAZ), null, "poza transakcją też nie rzuca");
  } finally {
    console.error = blad;
  }
  assert.equal(zalogowano, 2);
  assert.equal((d.prepare("SELECT notatka FROM zwrot_klienta WHERE id=?").get(z) as { notatka: string }).notatka,
    "zapis wołającego", "zapis wołającego przetrwał porażkę rejestru");
  assert.equal(ileWierszy(d), 0);
});
