import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  dolnaGranicaOkna, fakturaZwrotu, kandydaciFaktury, numerWskazuje, wskazFakture, zwiazFakture,
} from "./faktury.js";

/* ── Dokument sprzedaży przy zwrocie (0.174.0) ───────────────────────────────
   Te testy pilnują jednej granicy: co wolno automatowi, a co należy do
   człowieka. Automat wiąże wyłącznie dokument z numerem zamówienia; nakładka
   pozycji jest poszlaką i nie wiąże nigdy, bo firma ogrodnicza sprzedaje ten
   sam sekator dziesięć razy dziennie.                                       */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const KTO = { id: 3, name: "Ala" };
const ZAMOWIENIE = "29738e61-7f6a-11e8-ac45-09db60ede9d6";

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

/** Pobrane zamówienie Allegro z datą zakupu — po nim liczy się dolna granica okna. */
function zamowienie(d: Db, orderId: string, kupiono: string) {
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,kupiono_at,synced_at)
    VALUES (1,?,?,'2026-09-01T10:00:00Z')`).run(orderId, kupiono);
}

let kolejny = 0;
function zwrot(d: Db, pola: { orderId?: string | null; referencja?: string | null;
  utworzono?: string; zamkniety?: string } = {}, twIds: number[] = []) {
  const ext = `z${++kolejny}`;
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,
    reference_number,created_at,synced_at,zamkniety_at)
    VALUES (1,?,?,?,?,?,?)`).run(ext, pola.orderId ?? null, pola.referencja ?? null,
    pola.utworzono ?? "2026-09-01T10:00:00Z", "2026-09-01T10:00:00Z", pola.zamkniety ?? null);
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta WHERE external_id=?")
    .get(ext) as { id: number }).id);
  for (const tw of twIds) {
    d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,nazwa,ilosc,cena_grosze,waluta,tw_id,klucz)
      VALUES (?,'Sekator',1,4999,'PLN',?,?)`).run(id, tw, `${ext}-${tw}`);
  }
  return id;
}

function dokument(d: Db, dokId: number, pola: { typ?: string; numer?: string;
  nrOryg?: string | null; zUwag?: string | null; data?: string } = {}, twIds: number[] = []) {
  d.prepare(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,nr_oryg,zamowienie_z_uwag,data_wyst)
    VALUES (?,?,?,?,?,?)`)
    .run(dokId, pola.typ ?? "FS", pola.numer ?? `FS ${dokId}/2026`,
      pola.nrOryg ?? null, pola.zUwag ?? null, pola.data ?? "2026-08-20");
  for (const tw of twIds) {
    d.prepare("INSERT INTO sgt_faktura_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,1)").run(dokId, tw);
  }
}

test("numer obcy ucięty do trzydziestu znaków to nadal trafienie", () => {
  /* `dok_NrPelnyOryg` jest varchar(30), a identyfikator zamówienia to UUID
     o 36 znakach. Integracja wpisująca cały numer zapisze pierwsze trzydzieści
     — i to jest arytmetyka, nie przypuszczenie. */
  assert.equal(numerWskazuje(ZAMOWIENIE.slice(0, 30), [ZAMOWIENIE]), true);
  assert.equal(numerWskazuje(`Allegro ${ZAMOWIENIE}`, [ZAMOWIENIE]), true);
  assert.equal(numerWskazuje(ZAMOWIENIE, [ZAMOWIENIE]), true);
});

test("krótszy prefiks NIE jest trafieniem", () => {
  /* „29738e61" pasuje do wszystkiego, co zaczyna się tak samo, a fałszywe
     wiązanie kosztuje korektę do cudzej sprzedaży. */
  assert.equal(numerWskazuje(ZAMOWIENIE.slice(0, 8), [ZAMOWIENIE]), false);
  assert.equal(numerWskazuje("", [ZAMOWIENIE]), false);
  assert.equal(numerWskazuje(null, [ZAMOWIENIE]), false);
  assert.equal(numerWskazuje("FS 12/2026", [ZAMOWIENIE]), false);
});

test("jeden dokument z numerem zamówienia wiąże się sam", () => {
  const d = stanowisko();
  const id = zwrot(d, { orderId: ZAMOWIENIE });
  dokument(d, 500, { nrOryg: ZAMOWIENIE.slice(0, 30) });
  dokument(d, 501, { nrOryg: "inne" });

  assert.equal(zwiazFakture(id, d), true);
  const f = fakturaZwrotu(id, d);
  assert.equal(f.dokId, 500);
  assert.equal(f.numer, "FS 500/2026");
  assert.equal(f.zrodlo, "numer");
  /* Każda mutacja zostawia ślad, także ta bez człowieka. */
  const ev = d.prepare("SELECT COUNT(*) n FROM events WHERE type='zwrot_faktura'")
    .get() as { n: number };
  assert.equal(Number(ev.n), 1);
});

test("dwa dokumenty z tym samym numerem to spór, nie trafienie", () => {
  const d = stanowisko();
  const id = zwrot(d, { orderId: ZAMOWIENIE });
  dokument(d, 500, { nrOryg: ZAMOWIENIE });
  dokument(d, 501, { nrOryg: ZAMOWIENIE });

  assert.equal(zwiazFakture(id, d), false);
  assert.equal(fakturaZwrotu(id, d).dokId, null);
  /* Obaj zostają na liście dla człowieka — z jawnym powodem. */
  const k = kandydaciFaktury(id, d);
  assert.equal(k.length, 2);
  assert.ok(k.every((x) => x.pewny));
});

test("sama nakładka pozycji NIE wiąże automatycznie", () => {
  /* Ten sam sekator wychodzi z magazynu dziesięć razy dziennie — „wszystkie
     zwracane towary są na dokumencie" bywa prawdą o kilkunastu naraz. */
  const d = stanowisko();
  const id = zwrot(d, { orderId: ZAMOWIENIE }, [77]);
  dokument(d, 500, { nrOryg: null }, [77]);

  assert.equal(zwiazFakture(id, d), false);
  const k = kandydaciFaktury(id, d);
  assert.equal(k.length, 1);
  assert.equal(k[0].pewny, false);
  assert.deepEqual(k[0].powody, ["wszystkie zwracane towary są na tym dokumencie"]);
});

test("dokument bez jednego ze zwracanych towarów wypada z listy", () => {
  const d = stanowisko();
  const id = zwrot(d, {}, [77, 78]);
  dokument(d, 500, {}, [77]);
  assert.deepEqual(kandydaciFaktury(id, d), []);
});

test("dokument spoza okna nie jest kandydatem", () => {
  /* Okno ma sześćdziesiąt dni wstecz od zwrotu; sprzedaż sprzed pół roku nie
     jest tą sprzedażą, choćby towar się zgadzał. */
  const d = stanowisko();
  const id = zwrot(d, { utworzono: "2026-09-01T10:00:00Z" }, [77]);
  dokument(d, 500, { data: "2026-03-01" }, [77]);
  dokument(d, 501, { data: "2026-09-05" }, [77]);   // po dacie zwrotu
  assert.deepEqual(kandydaciFaktury(id, d), []);
});

test("pewny kandydat stoi nad poszlaką", () => {
  const d = stanowisko();
  const id = zwrot(d, { orderId: ZAMOWIENIE }, [77]);
  dokument(d, 500, { nrOryg: null, data: "2026-08-30" }, [77]);
  dokument(d, 501, { nrOryg: ZAMOWIENIE, data: "2026-08-01" }, [77]);
  const k = kandydaciFaktury(id, d);
  assert.equal(k[0].dokId, 501);
  assert.equal(k[0].powody.length, 2);
});

test("wskazanie człowieka zapisuje się jako RĘCZNE i da się cofnąć", () => {
  /* Wybór człowieka nie udaje faktu z danych — projekt panelu §4.3. */
  const d = stanowisko();
  const id = zwrot(d, {}, [77]);
  dokument(d, 500, {}, [77]);

  const f = wskazFakture(d, id, 500, KTO);
  assert.equal(f.dokId, 500);
  assert.equal(f.zrodlo, "reczne");
  assert.equal(f.przez, "Ala");

  const po = wskazFakture(d, id, null, KTO);
  assert.equal(po.dokId, null);
  assert.equal(po.zrodlo, null);
  const ev = d.prepare("SELECT COUNT(*) n FROM events WHERE type='zwrot_faktura_cofnieta'")
    .get() as { n: number };
  assert.equal(Number(ev.n), 1);
});

test("automat nie nadpisuje wskazania człowieka", () => {
  /* Podszyłby się pod cudzą decyzję — ta sama zasada co przy pamięci wskazań
     oferta–kartoteka. */
  const d = stanowisko();
  const id = zwrot(d, { orderId: ZAMOWIENIE });
  dokument(d, 500, { nrOryg: ZAMOWIENIE });
  dokument(d, 501, { nrOryg: null });

  wskazFakture(d, id, 501, KTO);
  assert.equal(zwiazFakture(id, d), false);
  assert.equal(fakturaZwrotu(id, d).dokId, 501);
});

test("dokumentu spoza read-modelu wskazać się nie da", () => {
  /* Numer wpisany z palca byłby napisem, którego nikt nie odnajdzie
     w Subiekcie — a to jest cała jego rola. */
  const d = stanowisko();
  const id = zwrot(d);
  assert.throws(() => wskazFakture(d, id, 999, KTO), /Nie znam takiego dokumentu/);
});

test("zwrot zamknięty nie przyjmuje już dokumentu", () => {
  const d = stanowisko();
  const id = zwrot(d, { zamkniety: "2026-09-01T11:00:00Z" });
  dokument(d, 500);
  assert.throws(() => wskazFakture(d, id, 500, KTO), /zamknięty/);
});

test("numer zwrotu na dokumencie też wiąże", () => {
  /* Integracja bywa ustawiona na numer referencyjny zwrotu, nie zamówienia —
     obie drogi prowadzą do tej samej sprzedaży. */
  const d = stanowisko();
  const id = zwrot(d, { orderId: null, referencja: "1234/Z04A" });
  dokument(d, 500, { nrOryg: "1234/Z04A" });
  assert.equal(zwiazFakture(id, d), true);
  assert.equal(fakturaZwrotu(id, d).dokId, 500);
});

/* ── Numer zamówienia w UWAGACH dokumentu (0.175.0) ─────────────────────────
   Zrzut z Subiekta firmy: Sellasist wpisuje UUID zamówienia w `dok_Uwagi`,
   a `dok_NrPelnyOryg` zostawia pusty. Do 0.174.0 mocny sygnał — jedyny, który
   wiąże automatycznie — nie miał więc prawa zadziałać ani razu.            */

test("numer zamówienia w UWAGACH wiąże tak samo pewnie jak w numerze obcym", () => {
  const d = stanowisko();
  const id = zwrot(d, { orderId: ZAMOWIENIE }, [77]);
  dokument(d, 500, { nrOryg: null, zUwag: ZAMOWIENIE, data: "2026-08-20" }, [77]);
  dokument(d, 501, { nrOryg: null, zUwag: null, data: "2026-08-21" }, [77]);

  const k = kandydaciFaktury(id, d);
  assert.equal(k[0].dokId, 500);
  assert.equal(k[0].pewny, true);
  assert.ok(k[0].powody.includes("numer zamówienia stoi w uwagach dokumentu"),
    "powód ma nazwać MIEJSCE, żeby biuro wiedziało, gdzie w Subiekcie spojrzeć");
  assert.equal(k[1].pewny, false, "sama nakładka pozycji dalej jest poszlaką");

  assert.equal(zwiazFakture(id, d), true, "jeden pewny kandydat wiąże się sam");
  assert.equal(fakturaZwrotu(id, d).dokId, 500);
});

test("dwa dokumenty z tym samym numerem w uwagach to nadal spór", () => {
  const d = stanowisko();
  const id = zwrot(d, { orderId: ZAMOWIENIE }, [77]);
  dokument(d, 500, { zUwag: ZAMOWIENIE }, [77]);
  dokument(d, 501, { zUwag: ZAMOWIENIE }, [77]);
  assert.equal(zwiazFakture(id, d), false);
});

/* ── Dokument nie może być starszy niż zakup (0.175.0) ───────────────────────
   Na ekranie: zamówienie kupione 17.08, a wśród kandydatów paragony z 13.08
   i 23.07. Okno liczyło się wyłącznie od daty ZWROTU, sześćdziesiąt dni
   wstecz — data zakupu leżała w bazie obok i ekran ją pokazywał, tylko
   dopasowanie jej nie czytało.                                              */

test("paragon sprzed dnia zakupu NIE jest kandydatem, choć towar się zgadza", () => {
  const d = stanowisko();
  zamowienie(d, ZAMOWIENIE, "2026-08-17T07:44:41Z");
  const id = zwrot(d, { orderId: ZAMOWIENIE, utworzono: "2026-09-01T10:00:00Z" }, [77]);
  dokument(d, 500, { data: "2026-07-23" }, [77]);   // sprzed zakupu — niemożliwy
  dokument(d, 501, { data: "2026-08-13" }, [77]);   // sprzed zakupu — niemożliwy
  dokument(d, 502, { data: "2026-08-18" }, [77]);
  dokument(d, 503, { data: "2026-08-19" }, [77]);

  assert.deepEqual(kandydaciFaktury(id, d).map((k) => k.dokId).sort(), [502, 503]);
});

test("dzień luzu na strefę: zakup tuż po północy UTC nie odcina paragonu z dnia poprzedniego", () => {
  /* `kupiono_at` jest chwilą w UTC, `data_wyst` samą datą lokalną Subiekta.
     Zakup o 00:30 UTC to 02:30 naszego czasu — paragon może mieć datę „dnia
     poprzedniego" w UTC i wciąż być tym paragonem. */
  assert.equal(dolnaGranicaOkna("2026-09-01T10:00:00Z", "2026-08-17T00:30:00Z", 60), "2026-08-16");
});

test("bez pobranego zamówienia okno zostaje przy sześćdziesięciu dniach od zwrotu", () => {
  assert.equal(dolnaGranicaOkna("2026-09-01T10:00:00Z", null, 60), "2026-07-03");
  /* Zakup starszy niż okno nie ROZSZERZA okna — granica to zawsze późniejsza
     z dwóch dat. */
  assert.equal(dolnaGranicaOkna("2026-09-01T10:00:00Z", "2026-01-05T10:00:00Z", 60), "2026-07-03");
});
