import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseAdres } from "../locs.js";

/* ── Zbiórki → kandydaci do strefy złotej ────────────────────────────────────
   Trzy rzeczy z cichym trybem awarii:

   1. PARSER CSV. Eksport Sellasist ma HTML-owe linki z przecinkami w środku —
      naiwny `split(",")` rozjechałby kolumny i import „udałby się" na złych
      danych.
   2. IDEMPOTENCJA po `koszyk_id`. Ponowne wgranie tego samego okresu nie może
      podwoić rotacji — podwojona wysłałaby połowę magazynu do strefy złotej.
   3. TRÓJWARTOŚCIOWOŚĆ reguł strefy. Regał bez reguły to „nie wiem", nie
      „poza strefą" — pomylenie tego rozdaje adnotacje bez podstawy.          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zbr-")), "t.db");

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zbiorki.js");
let S: typeof import("./strefa-zlota.js");
let D: typeof import("./delivery.js");
/** Ziarno reguł, odtwarzane przed każdym testem — testy edycji je nadpisują. */
let ziarno: Array<{ alejka?: string; od?: string; do?: string; poziomy: string }>;

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zbiorki.js");
  S = await import("./strefa-zlota.js");
  D = await import("./delivery.js");
  ziarno = S.regulyStrefy().map((r) => ({
    ...(r.alejka ? { alejka: r.alejka } : {}),
    ...(r.od ? { od: r.od } : {}),
    ...(r.do ? { do: r.do } : {}),
    poziomy: r.poziomy.join(","),
  }));
});

beforeEach(() => {
  const d = db();
  for (const t of ["zbiorka", "sgt_towar", "delivery_line", "delivery"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  S.zapiszReguly(ziarno);
  Z.zresetujKandydatow();
});

function towar(twId: number, sym: string, ean: string | null, lokalizacja: string): void {
  db()
    .prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,?)")
    .run(twId, sym, `Towar ${sym}`, ean, lokalizacja);
}

/** Wiersz surowy w tabeli — testy kandydatów nie przechodzą przez parser. */
let kolejnyKoszyk = 1;
function zbiorka(twId: number | null, data: string, ile = 1): void {
  const ins = db()
    .prepare("INSERT INTO zbiorka(koszyk_id, tw_id, symbol_csv, data, ilosc) VALUES (?,?,?,?,1)");
  for (let i = 0; i < ile; i++) ins.run(kolejnyKoszyk++, twId, "X", data);
}

const NAGLOWEK = "ID Koszyka,Data zebrania,EAN,Symbol,Ilość";
const csv = (wiersze: string[]) => [NAGLOWEK, ...wiersze].join("\r\n");

/* ── Parser ──────────────────────────────────────────────────────────────── */

test("cudzysłowy RFC 4180: przecinki i cudzysłowy w polu nie rozjeżdżają kolumn", () => {
  const w = Z.parsujCsv('a,"x, y","powiedział ""tak""",c\r\n1,2,3,4');
  assert.deepEqual(w, [["a", "x, y", 'powiedział "tak"', "c"], ["1", "2", "3", "4"]]);
});

test("BOM z Excela jest zjadany, pusta końcówka pliku nie robi pustego wiersza", () => {
  const w = Z.parsujCsv("﻿kol\r\nwart\r\n");
  assert.deepEqual(w, [["kol"], ["wart"]]);
});

test("liczba wychodzi z HTML-owego linku i z gołej wartości; śmieć daje null", () => {
  assert.equal(Z.liczbaZLinku('<a href="https://x/orders/142393" target="_blank">142393</a>'), 142393);
  assert.equal(Z.liczbaZLinku(" 5032 "), 5032);
  assert.equal(Z.liczbaZLinku("brak"), null);
  assert.equal(Z.liczbaZLinku(""), null);
});

test("kolumny znajdują się po NAZWACH, nie po pozycjach", () => {
  // Sellasist pozwala przestawiać kolumny eksportu — kolejność to nie kontrakt
  const { wiersze } = Z.wierszeZbiorek(
    "Symbol,Ilość,ID Koszyka,Data zebrania,EAN\r\nW01-001,2,7001,2026-08-10,590"
  );
  assert.equal(wiersze.length, 1);
  assert.deepEqual(wiersze[0], { koszykId: 7001, symbol: "W01-001", ean: "590", data: "2026-08-10", ilosc: 2 });
});

test("plik bez kluczowych kolumn jest odrzucany z nazwami braków", () => {
  assert.throws(() => Z.wierszeZbiorek("Symbol,EAN\r\nW01-001,590"), /ID Koszyka.*Data zebrania/);
});

test("wiersz ucięty w połowie jest pomijany i POLICZONY, nie przemilczany", () => {
  const { wiersze, odrzuconych } = Z.wierszeZbiorek(
    csv(["5001,2026-08-10,,W01-001,1", "5002,zepsuta-data,,W01-002,1", ",,,,"])
  );
  assert.equal(wiersze.length, 1);
  assert.equal(odrzuconych, 2);
});

/* ── Import ──────────────────────────────────────────────────────────────── */

test("dopasowanie po symbolu bez wielkości liter, zapasowo po EAN", () => {
  towar(1, "W01-001", null, "A01-01-05");
  towar(2, "INNY", "5900000000017", "A01-01-05");
  const w = Z.importujZbiorki(
    csv(["5001,2026-08-10,,w01-001,1", "5002,2026-08-10,5900000000017,SYMBOL-Z-SELLASIST,1"])
  );
  assert.equal(w.dopasowanych, 2);
  assert.equal(w.niedopasowanych, 0);
  const twIds = db().prepare("SELECT tw_id FROM zbiorka ORDER BY koszyk_id").all() as Array<{ tw_id: number }>;
  assert.deepEqual(twIds.map((r) => r.tw_id), [1, 2]);
});

test("powtórne wgranie tego samego okresu niczego nie dubluje", () => {
  towar(1, "W01-001", null, "A01-01-05");
  const plik = csv(["5001,2026-08-10,,W01-001,1", "5002,2026-08-11,,W01-001,1"]);
  const pierwszy = Z.importujZbiorki(plik);
  assert.equal(pierwszy.nowych, 2);
  assert.deepEqual(pierwszy.okres, { od: "2026-08-10", do: "2026-08-11" });

  const drugi = Z.importujZbiorki(plik);
  assert.equal(drugi.nowych, 0);
  assert.equal(drugi.pominietychDuplikatow, 2);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM zbiorka").get() as { n: number }).n, 2);
});

test("plik z dopasowaniem poniżej połowy jest odrzucany W CAŁOŚCI", () => {
  towar(1, "W01-001", null, "A01-01-05");
  assert.throws(
    () => Z.importujZbiorki(csv([
      "5001,2026-08-10,,W01-001,1",
      "5002,2026-08-10,,OBCY-1,1",
      "5003,2026-08-10,,OBCY-2,1",
    ])),
    /Dopasowano tylko 1 z 3.*OBCY/s
  );
  // odrzucony znaczy odrzucony — także ten jeden pasujący wiersz
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM zbiorka").get() as { n: number }).n, 0);
});

/* ── Kandydaci ───────────────────────────────────────────────────────────── */

test("kandydatem jest górne 15% rotacji POZA strefą; reszta na osobnych licznikach", () => {
  towar(1, "SZYBKI-POZA", null, "A01-01-05");   // alejka A: strefa {2,3,4} → poziom 5 poza
  towar(2, "SZYBKI-W-STREFIE", null, "A01-01-03");
  towar(3, "SZYBKI-BEZ-REGULY", null, "D06-01-02"); // D06 nie ma reguły → „nie wiem"
  towar(4, "SZYBKI-BEZ-ADRESU", null, "PALETA22");
  zbiorka(1, "2026-08-10", 50); zbiorka(1, "2026-08-11", 50);
  zbiorka(2, "2026-08-10", 95);
  zbiorka(4, "2026-08-10", 92);
  zbiorka(3, "2026-08-10", 90);
  for (let tw = 5; tw <= 21; tw++) {
    towar(tw, `WOLNY-${tw}`, null, "A01-01-05");
    zbiorka(tw, "2026-08-10", 5);
  }

  const r = Z.kandydaciStrefy();
  // 21 kartotek z ruchem → ceil(21 · 0,15) = 4 → próg to 4. wynik: 90
  assert.equal(r.prog, 90);
  assert.deepEqual(r.okno, { od: "2026-08-10", do: "2026-08-11", dni: 2 });
  assert.deepEqual(r.kandydaci.map((k) => k.sym), ["SZYBKI-POZA"]);
  assert.equal(r.kandydaci[0].zbiorki, 100);
  assert.equal(r.kandydaci[0].zbiorekNaDzien, 50);
  assert.equal(r.kandydaci[0].adres, "A01-01-05");
  assert.equal(r.kandydaci[0].poziomy, "2 albo 3 albo 4");
  assert.equal(r.juzWStrefie, 1, "towar w strefie nie jest kandydatem");
  assert.equal(r.bezReguly, 1, "regał bez reguły to „nie wiem”, nie „przenieś”");
  // towar bez adresu regałowego nie trafia NIGDZIE — nie wiadomo, skąd go nieść
});

test("okno to ostatnie 30 dni OBECNE w danych, nie kalendarzowe", () => {
  towar(1, "CODZIENNY", null, "A01-01-05");
  towar(2, "TYLKO-NAJSTARSZY-DZIEN", null, "A01-01-05");
  for (let dzien = 1; dzien <= 31; dzien++) {
    zbiorka(1, `2026-07-${String(dzien).padStart(2, "0")}`);
  }
  zbiorka(2, "2026-07-01", 5);

  const r = Z.kandydaciStrefy();
  assert.deepEqual(r.okno, { od: "2026-07-02", do: "2026-07-31", dni: 30 });
  // 31. dzień wypadł z okna, a razem z nim wszystkie zbiórki towaru 2
  assert.deepEqual(r.kandydaci.map((k) => k.sym), ["CODZIENNY"]);
  assert.equal(r.kandydaci[0].zbiorki, 30);
});

test("adnotacja karty: O(1) dla kandydata, null dla całej reszty", () => {
  towar(1, "SZYBKI", null, "A01-01-05");
  towar(2, "WOLNY", null, "A01-01-05");
  zbiorka(1, "2026-08-10", 10);
  zbiorka(2, "2026-08-10", 1);

  assert.deepEqual(Z.adnotacjaStrefy(1), { zbiorekNaDzien: 10, poziomy: "2 albo 3 albo 4" });
  assert.equal(Z.adnotacjaStrefy(2), null, "wolny towar poniżej progu");
  assert.equal(Z.adnotacjaStrefy(999), null, "kartoteka bez zbiórek");
});

test("puste dane to raport zerowy, nie wyjątek — karta pyta od pierwszego dnia", () => {
  const r = Z.kandydaciStrefy();
  assert.equal(r.okno, null);
  assert.deepEqual(r.kandydaci, []);
  assert.equal(Z.adnotacjaStrefy(1), null);
});

/* ── Reguły strefy w bazie ───────────────────────────────────────────────── */

test("ziarno reguł siedzi w bazie po migracji — zapis właściciela, nie pusta tabela", () => {
  const reguly = S.regulyStrefy();
  assert.equal(reguly.length, 10);
  const a = reguly.find((r) => r.alejka === "A");
  assert.deepEqual(a?.poziomy, [2, 3, 4]);
});

test("zapis reguł unieważnia cache — edycja z biura działa od następnego pytania", () => {
  const adres = parseAdres("A01-01-05")!;
  assert.equal(S.wStrefieZlotej(adres), false);
  S.zapiszReguly([{ alejka: "A", poziomy: "5" }]);
  assert.equal(S.wStrefieZlotej(adres), true);
  // A jest teraz JEDYNĄ regułą — reszta magazynu spadła do „nie wiem"
  assert.equal(S.wStrefieZlotej(parseAdres("B01-01-03")!), null);
});

test("zmiana reguł przelicza kandydatów po zresetujKandydatow", () => {
  towar(1, "SZYBKI", null, "A01-01-05");
  zbiorka(1, "2026-08-10", 10);
  assert.equal(Z.kandydaciStrefy().kandydaci.length, 1);

  S.zapiszReguly([{ alejka: "A", poziomy: "5" }]); // poziom 5 stał się złoty
  Z.zresetujKandydatow();
  const r = Z.kandydaciStrefy();
  assert.deepEqual(r.kandydaci, []);
  assert.equal(r.juzWStrefie, 1);
});

test("walidacja reguły łapie każdy sposób na bezsens", () => {
  assert.equal(S.bladReguly({ alejka: "a", poziomy: "2,3" }), null, "mała litera przechodzi");
  assert.equal(S.bladReguly({ od: "d01", do: "D05", poziomy: "2" }), null);
  assert.match(S.bladReguly({ alejka: "A", od: "D01", do: "D05", poziomy: "2" })!, /ALBO/);
  assert.match(S.bladReguly({ poziomy: "2" })!, /Podaj alejkę/);
  assert.match(S.bladReguly({ alejka: "AB", poziomy: "2" })!, /jedna litera/);
  assert.match(S.bladReguly({ od: "D1", do: "D05", poziomy: "2" })!, /litera i dwie cyfry/);
  assert.match(S.bladReguly({ od: "D01", do: "E05", poziomy: "2" })!, /jednej alejce/);
  assert.match(S.bladReguly({ alejka: "A", poziomy: "" })!, /Podaj poziomy/);
  assert.match(S.bladReguly({ alejka: "A", poziomy: "2,x" })!, /liczby/);
});

/* ── Ta sama podpowiedź na pozycji dostawy (0.70.0) ─────────────────────────
   Magazynier stoi z towarem w ręce i WŁAŚNIE wybiera półkę — to lepszy moment
   na „ten jedzie do strefy złotej" niż zaglądanie na kartę. Pilnujemy dwóch
   rzeczy naraz: że podpowiedź dochodzi na pozycję i że NIE dochodzi tam,
   gdzie karta też by jej nie pokazała.                                       */

/** Dostawa z jedną pozycją na podany towar; zwraca `deliveryId`. */
let kolejnyDok = 7001;
function dostawaZPozycja(twId: number, sym: string): number {
  const d = db();
  // własny numer dokumentu na wywołanie — `delivery.sgt_dok_id` jest UNIQUE
  const dokId = kolejnyDok++;
  const id = Number(
    d
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?, ?, 'open', ?, 1)`
      )
      .run(dokId, `FZ ${dokId}/MAG/08/2026`, new Date().toISOString()).lastInsertRowid
  );
  d.prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok,
                               ilosc_odlozona, status)
     VALUES (?,?,?,?,5,0,'todo')`
  ).run(id, twId, sym, `Towar ${sym}`);
  return id;
}

test("pozycja dostawy niesie tę samą podpowiedź strefy co karta towaru", () => {
  towar(1, "SZYBKI", null, "A01-01-05");
  towar(2, "WOLNY", null, "A01-01-05");
  zbiorka(1, "2026-08-10", 10);
  zbiorka(2, "2026-08-10", 1);

  const szybki = D.getDelivery(dostawaZPozycja(1, "SZYBKI"));
  assert.deepEqual(szybki?.lines[0].zlotaStrefa, Z.adnotacjaStrefy(1) ?? undefined,
    "pozycja i karta muszą mówić DOKŁADNIE to samo");
  assert.equal(szybki?.lines[0].zlotaStrefa?.zbiorekNaDzien, 10);

  const wolny = D.getDelivery(dostawaZPozycja(2, "WOLNY"));
  assert.equal(wolny?.lines[0].zlotaStrefa, undefined,
    "towar poniżej progu nie dostaje podpowiedzi — ani tu, ani na karcie");
});

test("brak danych o zbiórkach nie dokłada pola do pozycji", () => {
  /* Świeża instalacja i instancja demo nie mają ani jednej zbiórki. Pole ma
     wtedy ZNIKNĄĆ z JSON-a, a nie przyjść jako zero — „zbierany 0×/dzień"
     brzmiałoby jak zmierzony fakt, a nie jak brak pomiaru. */
  towar(1, "BEZ-DANYCH", null, "A01-01-05");
  const v = D.getDelivery(dostawaZPozycja(1, "BEZ-DANYCH"));
  assert.equal(v?.lines[0].zlotaStrefa, undefined);
  assert.ok(!("zlotaStrefa" in JSON.parse(JSON.stringify(v!.lines[0]))));
});
