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
    R.kubelek({
      statusAllegro: "CLAIM_ACCEPTED", ostatniaWiadomoscStatus: "ALLEGRO_ADVISOR_REPLIED",
      czatAktywny: true, dniDoTerminu: null,
    }),
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
  assert.throws(() => D.stempelProwadziDyskusje(db(), reklamacja, { id: 1, name: "Ala" }), /Dyskusja .* nie istnieje/);
  assert.throws(() => D.zapiszNotatkeDyskusji(db(), reklamacja, "cokolwiek", { id: 1, name: "Ala" }),
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
    /* Piąty plik od S1 spoiwa. Czyta tabelę CELOWO bez warunku na typ, bo
       o przejściu dyskusja → reklamacja nie da się opowiedzieć, pytając
       o jeden rodzaj. Wchodzi tu właśnie dlatego: zwolnienie ma być widoczne
       w strażniku, a nie polegać na tym, że plik go nie obejmuje. */
    "droga-klienta.ts",
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

/* ── Próg daty ───────────────────────────────────────────────────────────────
   Ta sama tabela i ten sam pełny przelot listy z 0.273.0 karmią obie kolejki,
   więc próg jest jeden. Tutaj jest nawet ciaśniej niż przy reklamacjach:
   porządek „kto czeka najdłużej" stawia najstarsze na samej górze z definicji.
                                                                             */
test("próg daty odcina dyskusje sprzed niego, a granicę przepuszcza", () => {
  const prog = "2026-07-01T00:00:00Z";
  const stara = sprawa({ id: "d-stara" });
  const granica = sprawa({ id: "d-granica" });
  sprawa({ id: "d-nowa" });
  db().prepare("UPDATE reklamacja_klienta SET otwarto_at=? WHERE id=?")
    .run("2026-06-30T23:59:00Z", stara);
  db().prepare("UPDATE reklamacja_klienta SET otwarto_at=? WHERE id=?").run(prog, granica);

  assert.deepEqual(
    new Set(D.listaDyskusji(db(), TERAZ, prog).map((d) => d.externalId)),
    new Set(["d-granica", "d-nowa"]),
    "granica włącznie — „od 1 lipca” znaczy z 1 lipca");
  assert.equal(D.listaDyskusji(db(), TERAZ, null).length, 3,
    "bez progu wraca wszystko, inaczej dyskusja sprzed progu byłaby nieosiągalna");
});

/* ── Zegar „bez odpowiedzi od" i alarm ───────────────────────────────────────
   Allegro zablokowało konto za dyskusję, która stała w kolejce jako „dziś":
   odpowiedź doradcy zerowała licznik liczony od ostatniej wiadomości. Testy
   pilnują dwóch rzeczy: zegar liczy od pytania, na które nie odpowiedzieliśmy,
   a alarm odpala dokładnie na progu. */

const przedGodzinami = (h: number) => new Date(TERAZ - h * 3_600_000).toISOString();

function wiadomosc(sprawaId: number, rola: string, at: string): void {
  db().prepare(
    `INSERT INTO reklamacja_wiadomosc(reklamacja_id, external_id, autor_rola, tresc, utworzono_at)
     VALUES (?,?,?,?,?)`,
  ).run(sprawaId, `m-${sprawaId}-${rola}-${at}`, rola, "tekst", at);
}

test("zegar liczy od pytania kupującego, także gdy doradca odpisał dzisiaj", () => {
  /* Dokładnie przypadek ze zrzutu od właściciela: doradca na końcu, kolejka
     mówi „dziś", a kupujący zapytał cztery dni temu. */
  const t = D.bezOdpowiediOd([
    { rola: "BUYER", at: przedDniami(4) },
    { rola: "ADMIN", at: przedGodzinami(1) },
  ], przedGodzinami(1), true);
  assert.equal(t, przedDniami(4));
});

test("nasza odpowiedź zeruje zegar, a nowe pytanie zaczyna go od nowa", () => {
  const t = D.bezOdpowiediOd([
    { rola: "BUYER", at: przedDniami(6) },
    { rola: "SELLER", at: przedDniami(5) },
    { rola: "BUYER", at: przedDniami(2) },
    { rola: "BUYER", at: przedDniami(1) },
  ], przedDniami(1), true);
  assert.equal(t, przedDniami(2), "liczy się najstarsze pytanie PO naszej odpowiedzi");
});

test("automaty nie uruchamiają zegara, a bez wiadomości wracamy do ostatniej daty", () => {
  assert.equal(D.bezOdpowiediOd([
    { rola: "SELLER", at: przedDniami(5) },
    { rola: "SYSTEM", at: przedDniami(4) },
    { rola: "BUYER", at: przedDniami(2) },
  ], przedDniami(2), true), przedDniami(2));
  assert.equal(D.bezOdpowiediOd([], przedDniami(3), true), przedDniami(3),
    "bez wiadomości i bez naszej odpowiedzi: od ostatniej wiadomości");
  assert.equal(D.bezOdpowiediOd([], null, true, przedDniami(7)), przedDniami(7),
    "bez żadnej daty: od otwarcia sprawy, żeby sprawa nie wypadła z alarmu");
  assert.equal(D.bezOdpowiediOd([{ rola: "BUYER", at: przedDniami(9) }], przedDniami(9), false), null,
    "gdy piłka jest u klienta, zegara nie ma");
});

test("niepełna lista wiadomości ZAWYŻA czas: liczymy od naszej ostatniej odpowiedzi", () => {
  /* Czat urwany bezpiecznikiem stron: mamy naszą starą odpowiedź, a status mówi,
     że po niej ktoś napisał, tylko tej wiadomości nie mamy. Cisza byłaby gorsza
     od nadmiarowego paska. */
  assert.equal(D.bezOdpowiediOd([{ rola: "SELLER", at: przedDniami(5) }], przedGodzinami(1), true),
    przedDniami(5));
});

test("sprawa bez wiadomości i bez daty ostatniej nadal wchodzi do alarmu", () => {
  const id = sprawa({ id: "d-bez-dat", ostatniaAt: null });
  assert.ok(id > 0);
  const w = D.listaDyskusji(db(), TERAZ)[0];
  assert.equal(w.bezOdpowiediOd, przedDniami(9), "zapas to otwarto_at z fixtury: dziewięć dni temu");
  assert.equal(w.pilna, true);
  assert.equal(D.stanDyskusjiHealth(db(), TERAZ, 24, null).alarm?.ile, 1);
});

test("samo pytanie doradcy Allegro też uruchamia zegar", () => {
  assert.equal(D.bezOdpowiediOd([
    { rola: "SELLER", at: przedDniami(5) },
    { rola: "ADMIN", at: przedDniami(2) },
  ], przedGodzinami(1), true), przedDniami(2),
    "ostatnia data jest inna niż pytanie doradcy, więc zwrot nie bierze się z zapasowej");
});

test("wiersz niesie prawdziwy zegar: cztery dni, nie „dziś”", () => {
  const id = sprawa({ id: "d-doradca", ostatniStatus: "ALLEGRO_ADVISOR_REPLIED", ostatniaAt: przedGodzinami(1) });
  wiadomosc(id, "BUYER", przedDniami(4));
  wiadomosc(id, "ADMIN", przedGodzinami(1));
  const w = D.listaDyskusji(db(), TERAZ)[0];
  assert.equal(w.czekaOdDni, 4);
  assert.equal(w.czekaOdGodzin, 96);
  assert.equal(w.dlugoCzeka, true, "wiersz wyróżnia się od progu dni także przy odpowiedzi doradcy");
  assert.equal(w.pilna, true, "96 godz. przekracza domyślny próg alarmu (24)");
  const swieza = sprawa({ id: "d-swieza", ostatniaAt: przedGodzinami(3) });
  wiadomosc(swieza, "BUYER", przedGodzinami(3));
  const s = D.listaDyskusji(db(), TERAZ).find((d) => d.externalId === "d-swieza");
  assert.equal(s?.pilna, false);
  assert.equal(s?.czekaOdGodzin, 3);
});

test("kolejka układa się po prawdziwym zegarze, nie po ostatniej wiadomości", () => {
  const a = sprawa({ id: "a-doradca-dzis", ostatniStatus: "ALLEGRO_ADVISOR_REPLIED", ostatniaAt: przedGodzinami(1) });
  wiadomosc(a, "BUYER", przedDniami(6));
  wiadomosc(a, "ADMIN", przedGodzinami(1));
  const b = sprawa({ id: "b-trzy-dni", ostatniaAt: przedDniami(3) });
  wiadomosc(b, "BUYER", przedDniami(3));
  assert.deepEqual(D.listaDyskusji(db(), TERAZ).map((d) => d.externalId),
    ["a-doradca-dzis", "b-trzy-dni"]);
});

test("alarm odpala dokładnie na progu i liczy tylko dyskusje do odpowiedzi", () => {
  const wiersz = (id: string, godzin: number | null, kubelek: "odpowiedz" | "klient" | "zamknieta") =>
    ({ externalId: id, czekaOdGodzin: godzin, kubelek }) as unknown as import("./dyskusje.js").WierszDyskusji;
  assert.equal(D.alarmDyskusji([wiersz("a", 23, "odpowiedz")], 24), null, "23 godz. to jeszcze cisza");
  assert.deepEqual(D.alarmDyskusji([wiersz("a", 24, "odpowiedz")], 24),
    { ile: 1, najstarszaGodzin: 24, progGodzin: 24 });
  const a = D.alarmDyskusji([
    wiersz("a", 30, "odpowiedz"), wiersz("b", 80, "odpowiedz"),
    wiersz("c", 500, "klient"), wiersz("d", 900, "zamknieta"), wiersz("e", null, "odpowiedz"),
  ], 24);
  assert.deepEqual(a, { ile: 2, najstarszaGodzin: 80, progGodzin: 24 },
    "sprawa u klienta, zamknięta i bez daty nie zapalają alarmu");
});

test("stan do zdrowia pomija sprawy zamknięte, u klienta i sprzed progu widoku", () => {
  const stara = sprawa({ id: "do-odpowiedzi", ostatniaAt: przedDniami(3) });
  wiadomosc(stara, "BUYER", przedDniami(3));
  sprawa({ id: "u-klienta", ostatniStatus: "SELLER_REPLIED", ostatniaAt: przedDniami(9) });
  sprawa({ id: "zamknieta", status: "DISPUTE_CLOSED", ostatniaAt: przedDniami(9) });
  sprawa({ id: "czat-zamkniety", czatAktywny: 0, ostatniaAt: przedDniami(9) });
  const s = D.stanDyskusjiHealth(db(), TERAZ, 24, null);
  assert.equal(s.czekaNaNas, 1);
  assert.deepEqual(s.alarm, { ile: 1, najstarszaGodzin: 72, progGodzin: 24 });
  // Próg widoku jest PO otwarciu sprawy: otwarto_at to dziewięć dni temu.
  const po = D.stanDyskusjiHealth(db(), TERAZ, 24, przedDniami(1));
  assert.equal(po.czekaNaNas, 0, "sprawy, której kolejka nie pokazuje, alarm nie zgłasza");
  assert.equal(po.alarm, null);
});

test("zdanie alarmu mówi ile, jak długo i gdzie iść, a bez alarmu milczy", () => {
  assert.equal(D.problemDyskusji(null), null);
  assert.equal(D.problemDyskusji({ czekaNaNas: 3, alarm: null }), null);
  const jedna = D.problemDyskusji({ czekaNaNas: 1, alarm: { ile: 1, najstarszaGodzin: 30, progGodzin: 24 } });
  assert.match(jedna ?? "", /^1 dyskusja czeka na odpowiedź dłużej niż 24 godz\. \(najstarsza 30 godz\.\)/);
  assert.match(jedna ?? "", /Dyskusje/);
  const dwie = D.problemDyskusji({ czekaNaNas: 2, alarm: { ile: 2, najstarszaGodzin: 50, progGodzin: 24 } });
  assert.match(dwie ?? "", /^2 dyskusje czekają/);
});

test("odmiana „czeka” ma trzy formy, jak po polsku", () => {
  assert.deepEqual([1, 2, 4, 5, 12, 14, 21, 22, 25].map(D.ileDyskusjiCzeka), [
    "1 dyskusja czeka", "2 dyskusje czekają", "4 dyskusje czekają", "5 dyskusji czeka",
    "12 dyskusji czeka", "14 dyskusji czeka", "21 dyskusji czeka", "22 dyskusje czekają",
    "25 dyskusji czeka",
  ]);
});

test("alarm ze zdrowia zgadza się z wierszami pilnymi z listy", () => {
  /* Dwie ścieżki SQL liczą to samo pytanie. Rozjazd między paskiem a kolejką
     byłby alarmem o sprawie, której kolejka nie pokazuje, albo odwrotnie. */
  const a = sprawa({ id: "a", ostatniaAt: przedDniami(3) }); wiadomosc(a, "BUYER", przedDniami(3));
  const b = sprawa({ id: "b", ostatniStatus: "ALLEGRO_ADVISOR_REPLIED", ostatniaAt: przedGodzinami(1) });
  wiadomosc(b, "BUYER", przedDniami(2)); wiadomosc(b, "ADMIN", przedGodzinami(1));
  const c = sprawa({ id: "c", ostatniaAt: przedGodzinami(5) }); wiadomosc(c, "BUYER", przedGodzinami(5));
  sprawa({ id: "d", ostatniStatus: "SELLER_REPLIED", ostatniaAt: przedDniami(8) });
  sprawa({ id: "e", status: "DISPUTE_CLOSED", ostatniaAt: przedDniami(8) });
  const pilne = D.listaDyskusji(db(), TERAZ, null).filter((x) => x.pilna);
  const z = D.stanDyskusjiHealth(db(), TERAZ, 24, null);
  assert.equal(z.alarm?.ile, pilne.length);
  assert.equal(z.alarm?.najstarszaGodzin, Math.max(...pilne.map((x) => x.czekaOdGodzin ?? 0)));
  assert.deepEqual(pilne.map((x) => x.externalId).sort(), ["a", "b"]);
});
