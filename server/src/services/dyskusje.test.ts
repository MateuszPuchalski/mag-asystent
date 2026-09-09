import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Dyskusje klienckie (0.245.0) ────────────────────────────────────────────
   Trzy niezmienniki, każdy kupiony blizną albo decyzją właściciela:

   1. DWIE KOLEJKI Z JEDNEJ TABELI NIE MOGĄ SIĘ PRZECIEKAĆ. Odkąd
      `reklamacja_klienta` trzyma oba rodzaje spraw, zapytanie bez warunku
      na `typ` pokazuje dyskusję na ekranie reklamacji — z pustym paskiem
      werdyktu i pustą kolumną terminu. To jest blizna 0.121.0, „CLAIM miał
      tę samą plakietkę co zwykła dyskusja". Ostatni test w tym pliku czyta
      ŹRÓDŁO obu serwisów, bo warunek łatwiej pominąć niż zauważyć.
   2. DORADCA ALLEGRO STAWIA PIŁKĘ PO NASZEJ STRONIE. Przy reklamacji jest
      samym sygnałem, bo tam o kolejności rozstrzyga zegar. Tutaj zegara nie
      ma, a doradca odezwał się jako ostatni w 61 sprawach na 100 — reguła
      z reklamacji wsadziłaby większość dyskusji do „czeka na klienta"
      w chwili, gdy czeka Allegro.
   3. „CZEKA N DNI" MILCZY, GDY RUCH NIE JEST NASZ. Liczba przy sprawie, przy
      której nie mamy nic do zrobienia, czyta się jak zaległość.              */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dyskusje-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./dyskusje.js");
let R: typeof import("./reklamacje.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./dyskusje.js");
  R = await import("./reklamacje.js");
});

const KONTO = 1;
const DZIEN = 86_400_000;
const TERAZ = Date.parse("2026-09-09T12:00:00.000Z");
const przedDniami = (n: number) => new Date(TERAZ - n * DZIEN).toISOString();

beforeEach(() => {
  const d = db();
  for (const t of ["reklamacja_zalacznik", "reklamacja_wiadomosc", "reklamacja_klienta",
                   "channel_account", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT INTO channel_account(id, channel, external_account_id, display_name) VALUES (?,?,?,?)",
  ).run(KONTO, "allegro", "konto-1", "WERTIS");
});

/** Sprawa w bazie; domyślnie dyskusja, na którą czekamy od dwóch dni. */
function sprawa(o: {
  id: string;
  typ?: string;
  status?: string | null;
  ostatniStatus?: string | null;
  ostatniaAt?: string | null;
  czatAktywny?: number;
  order?: string | null;
} ): number {
  const {
    id, typ = "DISPUTE", status = "DISPUTE_ONGOING",
    ostatniStatus = "BUYER_REPLIED", ostatniaAt = przedDniami(2),
    czatAktywny = 1, order = "ZAM-1",
  } = o;
  return Number(db().prepare(
    `INSERT INTO reklamacja_klienta
      (channel_account_id, external_id, typ, order_id, kupujacy_login, temat,
       status_allegro, czat_aktywny, wiadomosci_ile,
       ostatnia_wiadomosc_status, ostatnia_wiadomosc_at, otwarto_at, synced_at)
     VALUES (?,?,?,?, 'kowalski', 'Nie dostałem przesyłki', ?,?, 3, ?,?,?,?)`,
  ).run(KONTO, id, typ, order, status, czatAktywny, ostatniStatus, ostatniaAt,
        przedDniami(9), przedDniami(0)).lastInsertRowid);
}

/* ── Kubełki ──────────────────────────────────────────────────────────────── */

test("kubełek DO ODPOWIEDZI, gdy ostatnie słowo nie było nasze", () => {
  for (const s of ["NEW", "BUYER_REPLIED", "ALLEGRO_ADVISOR_REPLIED"]) {
    assert.equal(
      D.kubelekDyskusji({ statusAllegro: "DISPUTE_ONGOING", ostatniaWiadomoscStatus: s, czatAktywny: true }),
      "odpowiedz", s);
  }
});

test("DORADCA ALLEGRO stawia piłkę po naszej stronie — inaczej niż przy reklamacji", () => {
  /* Sedno różnicy między tymi dwoma ekranami. Sonda: 61 spraw na 100. */
  const rdzen = { statusAllegro: "DISPUTE_ONGOING", ostatniaWiadomoscStatus: "ALLEGRO_ADVISOR_REPLIED", czatAktywny: true };
  assert.equal(D.kubelekDyskusji(rdzen), "odpowiedz");
  assert.ok(D.sygnalyDyskusji(rdzen).includes("klient_czeka"));
  assert.ok(D.sygnalyDyskusji(rdzen).includes("doradca"), "doradca zostaje też sygnałem");
  /* A przy reklamacji ta sama wartość NIE przenosi sprawy do odpowiedzi. */
  assert.equal(
    R.kubelek({ statusAllegro: "CLAIM_ACCEPTED", ostatniaWiadomoscStatus: "ALLEGRO_ADVISOR_REPLIED", czatAktywny: true }),
    "zamknieta", "reguła reklamacji zostaje nietknięta");
});

test("kubełek CZEKA NA KLIENTA, gdy ostatnie słowo było nasze", () => {
  assert.equal(
    D.kubelekDyskusji({ statusAllegro: "DISPUTE_ONGOING", ostatniaWiadomoscStatus: "SELLER_REPLIED", czatAktywny: true }),
    "klient");
});

test("kubełek ZAMKNIĘTE po statusie ALBO po zamkniętym czacie", () => {
  assert.equal(
    D.kubelekDyskusji({ statusAllegro: "DISPUTE_CLOSED", ostatniaWiadomoscStatus: "BUYER_REPLIED", czatAktywny: true }),
    "zamknieta", "status końcowy rozstrzyga, choć klient pisał ostatni");
  assert.equal(
    D.kubelekDyskusji({ statusAllegro: "DISPUTE_ONGOING", ostatniaWiadomoscStatus: "BUYER_REPLIED", czatAktywny: false }),
    "zamknieta", "bez czynnego czatu nie wyjdzie stąd ani jedno słowo");
});

/* ── Sygnały ──────────────────────────────────────────────────────────────── */

test("pięć sygnałów, każdy ze swojego powodu", () => {
  const czynna = { statusAllegro: "DISPUTE_ONGOING", ostatniaWiadomoscStatus: "BUYER_REPLIED", czatAktywny: true };
  assert.deepEqual(D.sygnalyDyskusji(czynna), ["klient_czeka"]);
  assert.deepEqual(
    D.sygnalyDyskusji({ ...czynna, czatAktywny: false }), ["czat_zamkniety"],
    "bez czynnego czatu ruch nie jest już nasz");
  assert.ok(D.sygnalyDyskusji({ ...czynna, statusAllegro: "DISPUTE_UNRESOLVED" })
    .includes("nierozstrzygnieta"));
  assert.ok(D.sygnalyDyskusji({ ...czynna, statusAllegro: "DISPUTE_WYMYSLONY" })
    .includes("status_nieznany"), "wartość spoza specyfikacji zapala sygnał, nie wywraca odczytu");
});

/* ── Czekanie zamiast zegara ──────────────────────────────────────────────── */

test("czekanie liczy się TYLKO wtedy, gdy ruch należy do nas", () => {
  assert.equal(D.czekaOdDni(przedDniami(5), true, TERAZ), 5);
  assert.equal(D.czekaOdDni(przedDniami(5), false, TERAZ), null,
    "gdy piłka jest u klienta, liczba czytałaby się jak nasza zaległość");
  assert.equal(D.czekaOdDni(null, true, TERAZ), null);
  assert.equal(D.czekaOdDni("nie-data", true, TERAZ), null);
});

test("czekanie nie schodzi poniżej zera przy dacie z przyszłości", () => {
  /* Zegar Allegro i nasz bywają rozjechane o sekundy; „czeka -1 dni" na
     ekranie wygląda jak usterka i nią jest. */
  assert.equal(D.czekaOdDni(new Date(TERAZ + 60_000).toISOString(), true, TERAZ), 0);
});

test("wiersz wyróżnia się dopiero od progu trzech dni", () => {
  sprawa({ id: "d-1", ostatniaAt: przedDniami(2) });
  assert.equal(D.listaDyskusji(db(), TERAZ)[0].dlugoCzeka, false);
  db().prepare("UPDATE reklamacja_klienta SET ostatnia_wiadomosc_at=? WHERE external_id='d-1'")
    .run(przedDniami(D.PROG_CZEKANIA_DNI));
  assert.equal(D.listaDyskusji(db(), TERAZ)[0].dlugoCzeka, true);
});

/* ── Kolejka ──────────────────────────────────────────────────────────────── */

test("kolejka: najpierw czekające na nas, w niej najdłużej czekająca na górze", () => {
  sprawa({ id: "swieza", ostatniaAt: przedDniami(1) });
  sprawa({ id: "stara", ostatniaAt: przedDniami(8) });
  sprawa({ id: "u-klienta", ostatniStatus: "SELLER_REPLIED", ostatniaAt: przedDniami(30) });
  assert.deepEqual(
    D.listaDyskusji(db(), TERAZ).map((d) => d.externalId),
    ["stara", "swieza", "u-klienta"],
    "sprawa sprzed miesiąca, w której to klient ma ruch, nie jest pilna");
});

test("liczniki kubełków liczą to, co widać na ekranie", () => {
  sprawa({ id: "a" });
  sprawa({ id: "b", ostatniStatus: "SELLER_REPLIED" });
  sprawa({ id: "c", status: "DISPUTE_CLOSED" });
  assert.deepEqual(D.licznikiDyskusji(D.listaDyskusji(db(), TERAZ)),
    { odpowiedz: 1, klient: 1, zamknieta: 1 });
});

test("adresu SAMEJ dyskusji nie zgadujemy — zostaje odnośnik do zamówienia", () => {
  /* Blizna 0.226.1: wzorzec adresu wywiedziony z analogii dał 404 przy
     pierwszym kliknięciu właściciela. Wzorca dla dyskusji nikt nie sprawdził. */
  const w = (sprawa({ id: "d-2" }), D.listaDyskusji(db(), TERAZ)[0]);
  assert.ok(!("link" in w), "pola z adresem sprawy w ogóle nie ma");
  assert.equal(typeof w.linkZamowienia, "string");
});

/* ── Przeciek między kolejkami ────────────────────────────────────────────── */

test("dyskusja NIE wchodzi do kolejki reklamacji, a reklamacja do dyskusji", () => {
  sprawa({ id: "dyskusja-1", typ: "DISPUTE" });
  sprawa({ id: "reklamacja-1", typ: "CLAIM", status: "CLAIM_SUBMITTED" });
  assert.deepEqual(D.listaDyskusji(db(), TERAZ).map((d) => d.externalId), ["dyskusja-1"]);
  assert.deepEqual(R.listaReklamacji(db(), TERAZ).map((r) => r.externalId), ["reklamacja-1"]);
});

test("szczegół drugiego rodzaju sprawy oddaje 404, a nie sprawę bez połowy pól", () => {
  const dyskusja = sprawa({ id: "d-3", typ: "DISPUTE" });
  const reklamacja = sprawa({ id: "r-3", typ: "CLAIM", status: "CLAIM_SUBMITTED" });
  assert.throws(() => R.szczegolReklamacji(db(), dyskusja), /nie istnieje/);
  assert.throws(() => D.szczegolDyskusji(db(), reklamacja), /nie istnieje/);
  assert.equal(D.szczegolDyskusji(db(), dyskusja).dyskusja.externalId, "d-3");
});

test("mutacja przez cudzy ekran odpada, zanim cokolwiek zapisze", () => {
  const reklamacja = sprawa({ id: "r-4", typ: "CLAIM", status: "CLAIM_SUBMITTED" });
  assert.throws(() => D.stempelProwadziDyskusje(db(), reklamacja, "Ala"), /Dyskusja .* nie istnieje/);
  assert.throws(() => D.zapiszNotatkeDyskusji(db(), reklamacja, "cokolwiek", "Ala"),
    /Dyskusja .* nie istnieje/);
  const w = db().prepare("SELECT prowadzi, notatka, wersja FROM reklamacja_klienta WHERE id=?")
    .get(reklamacja) as { prowadzi: string | null; notatka: string | null; wersja: number };
  assert.deepEqual({ ...w }, { prowadzi: null, notatka: null, wersja: 1 });
});

test("STRAŻNIK ŹRÓDŁA: każde sięgnięcie do tabeli spraw wie, o który rodzaj chodzi", () => {
  /* Warunek łatwiej pominąć niż zauważyć, a skutkiem jest sprawa na ekranie,
     który nie umie jej obsłużyć — albo, gorzej, werdykt wysłany na dyskusję,
     którego Allegro nie przyjmie. Test czyta ŹRÓDŁO, bo przeciek da się
     dopisać w miejscu, którego żaden test zachowania nie odwiedza.

     ZWOLNIENIE ISTNIEJE I WYMAGA ZDANIA. Zapisy stojące ZA bramką nie mają
     czego sprawdzać drugi raz, a powtórzony warunek udawałby niezależną
     kontrolę. Znacznik `bez typu:` z powodem działa tu tak samo jak
     `ergonomia:` w `tools/ergonomia_check.py` — zwolnienie bez uzasadnienia
     to brak zwolnienia. */
  const PLIKI = [
    "dyskusje.ts", "reklamacje.ts", "reklamacja-werdykt.ts", "reklamacje-wysylka.ts",
  ];
  let sprawdzonych = 0;
  for (const plik of PLIKI) {
    const surowy = fs.readFileSync(path.resolve(import.meta.dirname, plik), "utf8");
    /* Szukamy w SUROWYM źródle, a zdanie o regule odsiewamy inaczej niż
       komentarzem: zapytanie poznaje się po tym, że stoi w `prepare(`.
       Wzmianka w preambule tego warunku nie spełnia. */
    for (const m of surowy.matchAll(
      /prepare\(\s*[`"](?:[\s\S]{0,200}?)(?:FROM|UPDATE|INTO)\s+reklamacja_klienta\b([\s\S]{0,400}?)[`"]/g)) {
      sprawdzonych += 1;
      if (/typ\s*=\s*(\?|'CLAIM'|'DISPUTE')/.test(m[1])) continue;
      /* Zwolnienie stoi TUŻ NAD zapytaniem — w komentarzu, w zasięgu wzroku
         czytającego, a nie gdzieś w pliku. */
      const nad = surowy.slice(Math.max(0, m.index - 400), m.index);
      assert.match(nad, /bez typu:\s*\S+/,
        `${plik}: zapytanie bez warunku na typ i bez zwolnienia „bez typu:" z powodem:\n`
        + m[0].replace(/\s+/g, " ").slice(0, 90));
    }
  }
  assert.ok(sprawdzonych >= 12,
    `strażnik przestał cokolwiek znajdować (${sprawdzonych}) — pilnowałby pustki`);
});
