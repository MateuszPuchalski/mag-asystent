import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-skutecznosc-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Skuteczność doboru (0.267.0) ────────────────────────────────────────────
   Ten raport ma jedną zasadę nadrzędną, wprost z nagłówka `sygnatury.ts`:
   RAPORT MA LICZYĆ TO SAMO, CO ROBI MECHANIZM. Dlatego stan do policzenia
   powstaje tu przez PRAWDZIWE funkcje doboru — `zapiszDane`,
   `wybierzKandydata`, `ustawStatusDoboru` — a nie przez ręczne wstawianie
   wierszy do `events`. Test na ręcznie posadzonych zdarzeniach sprawdzałby
   moje wyobrażenie o tym, co pisze mechanizm, a nie to, co pisze naprawdę.

   Trzy rzeczy, które ten plik ma złapać, bo pierwsza wersja serwisu myliła
   się na każdej z nich: zmieniony wybór, zdjęty wybór i cofnięte
   zatwierdzenie.                                                            */

let db: typeof import("../db/db.js").db;
let S: typeof import("./skutecznosc-doboru.js");
let D: typeof import("./dobor.js");

let ala = 0;
let ola = 0;
let konto = 0;
let rozmowa = 0;
const FTC272 = 14;
const INNA = 15;

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./skutecznosc-doboru.js");
  D = await import("./dobor.js");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(FTC272, "FTC272", "Podkładka");
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(INNA, "W09-0211", "Gaźnik");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dobor_rozmowy", "conversation_event", "message", "conversation",
    "channel_account", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  ala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  ola = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ola','O. Nowak','biuro')")
    .run().lastInsertRowid);
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  rozmowa = nowaRozmowa("w-1");
});

/** Rozmowa z jednym pytaniem klienta — punkt zero zegara. */
function nowaRozmowa(zewn: string, pytanieAt = "2026-09-10T08:00:00.000Z"): number {
  const d = db();
  const id = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id)
    VALUES (?,?)`).run(konto, zewn).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,?,'incoming','Jaka podkładka?',?)`).run(id, konto, `m-${zewn}`, pytanieAt);
  return id;
}

const wiersz = (r: import("./skutecznosc-doboru.js").SkutecznoscDoboru, droga: string) =>
  r.drogi.find((d) => d.droga === droga)!;

test("jedenaście dróg zawsze, także z zerami — zero jest tu ustaleniem, nie pustką", () => {
  /* Szczebel, który nie dał ani jednego wyboru, jest najcenniejszą informacją
     tego raportu: mówi, że droga utrzymywana w kodzie nie dała jeszcze nikomu
     odpowiedzi. Wypadnięcie go z listy zamieniłoby ustalenie w ciszę. */
  const r = S.skutecznoscDoboru(30, db());
  assert.equal(r.drogi.length, 11);
  assert.deepEqual(r.drogi.map((d) => d.wybranych), new Array(11).fill(0));
  assert.equal(r.medianaDoWyboruMin, null, "mediana z pustej próbki to null, nie zero");
  assert.equal(r.wyborow, 0);
});

test("ZMIENIONY wybór zostawia OBA szczeble, a punkt dostaje tylko ten zatwierdzony", () => {
  /* To jest błąd, przez który raport liczony z `dobor_rozmowy` był nie do
     uratowania: tabela pamięta ostatni wybór, więc pierwszy znikał bez śladu,
     a zatwierdzenie kredytowałoby drogę, która go nie zapracowała. */
  D.wybierzKandydata(rozmowa, FTC272, "pelnotekst", 1, ala, db());
  D.wybierzKandydata(rozmowa, INNA, "oem", 2, ala, db());
  D.ustawStatusDoboru(rozmowa, "confirmed", null, ala, db());

  const r = S.skutecznoscDoboru(30, db());
  assert.equal(wiersz(r, "pelnotekst").wybranych, 1, "pierwszy wybór ma zostać w historii");
  assert.equal(wiersz(r, "oem").wybranych, 1);
  assert.equal(wiersz(r, "pelnotekst").zatwierdzonych, 0,
    "pełny tekst nie zapracował na to zatwierdzenie — agent zmienił zdanie");
  assert.equal(wiersz(r, "oem").zatwierdzonych, 1);
  assert.equal(r.wyborow, 2);
});

test("ZDJĘTY wybór nie znika z historii, ale nie dostaje zatwierdzenia", () => {
  /* `wybierzKandydata(null)` zeruje w tabeli drogę, czas i konto. Z księgi
     zdarzeń nie da się tego wymazać — i o to chodzi, bo ten wybór naprawdę
     się wydarzył i naprawdę czegoś dowodzi o szczeblu, który go dał. */
  D.wybierzKandydata(rozmowa, FTC272, "wymiar", 1, ala, db());
  D.wybierzKandydata(rozmowa, null, "wymiar", 2, ala, db());

  const r = S.skutecznoscDoboru(30, db());
  assert.equal(wiersz(r, "wymiar").wybranych, 1);
  assert.equal(wiersz(r, "wymiar").zatwierdzonych, 0);
  assert.equal(Number((db().prepare(
    "SELECT count(*) n FROM dobor_rozmowy WHERE wybrany_droga IS NOT NULL").get() as { n: number }).n),
  0, "w tabeli po zdjęciu nie ma śladu — dlatego raport jej nie czyta");
});

test("zatwierdzenie liczy się z PRZEJŚCIA, więc cofnięcie go nie kasuje", () => {
  /* `status='confirmed'` dziś to nie to samo, co „doszło do zatwierdzenia".
     Zmiana wyboru sprowadza status z powrotem do `candidates_found`, a tabela
     zna wtedy tylko stan końcowy. Księga zna przebieg. */
  D.wybierzKandydata(rozmowa, FTC272, "zastosowanie", 1, ala, db());
  D.ustawStatusDoboru(rozmowa, "confirmed", null, ala, db());
  const dobor = D.doborRozmowy(rozmowa, db());
  D.wybierzKandydata(rozmowa, INNA, "symbol", dobor.wersja, ala, db());

  const r = S.skutecznoscDoboru(30, db());
  assert.equal(wiersz(r, "zastosowanie").zatwierdzonych, 1, "to zatwierdzenie się wydarzyło");
  assert.equal(r.naStole.statusy.find((s) => s.status === "confirmed")!.ile, 0,
    "…a na stole dziś nie stoi — i raport mówi obie te rzeczy osobno");
});

test("czas liczy się od OSTATNIEGO pytania klienta, nie od początku wątku", () => {
  /* Definicja zegara jest już w repo, przy `pytanieAt` w `skrzynka.ts`:
     liczenie od pierwszej wiadomości mierzyłoby wiek relacji z klientem,
     a nie pracę nad doborem. Rozmowa ciągnąca się od stycznia zawyżałaby
     medianę tym mocniej, im dłużej jesteśmy z klientem. */
  const d = db();
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-stary','incoming','pierwsze pytanie sprzed miesiąca','2026-08-15T08:00:00.000Z')`)
    .run(rozmowa, konto);
  D.wybierzKandydata(rozmowa, FTC272, "oem", 1, ala, db());

  const r = S.skutecznoscDoboru(30, db());
  assert.equal(r.wyborowZCzasem, 1);
  assert.ok(r.medianaDoWyboruMin !== null && r.medianaDoWyboruMin < 60 * 24,
    `mediana ${r.medianaDoWyboruMin} min — liczona od sierpnia zamiast od dzisiejszego pytania`);
});

test("podział na osoby idzie po KONCIE i nie niesie żadnej liczby rankingowej", () => {
  /* Grupowanie po nazwisku robiłoby z „Jan", „jan" i „Jan K" trzy osoby —
     antywzorzec nazwany w `raporty.ts`. A brak tempa i skuteczności per osoba
     jest decyzją, nie przeoczeniem: to jest raport o sposobie pracy. */
  D.wybierzKandydata(rozmowa, FTC272, "wyszukiwarka", 1, ola, db());
  const druga = nowaRozmowa("w-2");
  D.wybierzKandydata(druga, FTC272, "zastosowanie", 1, ala, db());

  const r = S.skutecznoscDoboru(30, db());
  assert.equal(r.osoby.length, 2);
  const o = r.osoby.find((x) => x.userId === ola)!;
  assert.equal(o.osoba, "O. Nowak");
  assert.equal(o.najczestszaDroga, "wyszukiwarka");
  assert.equal(o.medianaMin, null, "poniżej progu mediana to null — cztery dobory to nie wynik");
  assert.equal(r.progWiarygodnosci, 20);
  for (const klucz of ["tempo", "skutecznosc", "udzial", "ranking"]) {
    assert.equal(klucz in o, false, `wiersz osoby nie ma prawa nieść pola „${klucz}"`);
  }
});

test("raport niesie podstawę prawną monitoringu i granicę historii", () => {
  /* Pomiar per osoba to monitoring pracowniczy (art. 22² Kodeksu pracy).
     Zdanie jedzie w ładunku, żeby karta nie mogła go zgubić. Granica historii
     jedzie, bo bez niej selektor „ostatnie 90 dni" obiecuje kwartał, którego
     retencja nie zostawiła w bazie. */
  const r = S.skutecznoscDoboru(90, db());
  assert.match(r.podstawaPrawna, /Kodeks pracy|Kodeksu pracy/);
  assert.equal(typeof r.granicaHistorii, "string");
  assert.equal(r.dni, 90);
});

test("odczyt NICZEGO nie zapisuje", () => {
  /* Umowa „zero zapisu przy patrzeniu". Raport czyta księgę zdarzeń, więc
     zapis w nim dopisywałby do tego, co właśnie mierzy. */
  D.wybierzKandydata(rozmowa, FTC272, "oem", 1, ala, db());
  const licz = (t: string) => Number((db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n);
  const przed = [licz("events"), licz("dobor_rozmowy"), licz("conversation_event")];
  S.skutecznoscDoboru(30, db());
  S.skutecznoscDoboru(7, db());
  assert.deepEqual([licz("events"), licz("dobor_rozmowy"), licz("conversation_event")], przed);
});

test("uszkodzony ładunek zdarzenia nie kładzie raportu", () => {
  /* Blizna S59 z `raporty.ts`: jeden nie-JSON w `payload` wywracał cały
     raport piątką. Stąd `json_valid` przed każdym `json_extract`. */
  D.wybierzKandydata(rozmowa, FTC272, "oem", 1, ala, db());
  db().prepare("INSERT INTO events(type,user_id,payload) VALUES ('dobor_wybor','Ala','{nie-json')").run();
  const r = S.skutecznoscDoboru(30, db());
  assert.equal(wiersz(r, "oem").wybranych, 1, "zdrowe zdarzenie ma przejść mimo uszkodzonego sąsiada");
});
