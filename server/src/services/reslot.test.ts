import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAdres } from "../locs.js";
import { poziomyStrefy, wStrefieZlotej } from "./strefa-zlota.js";
import { przeslotowanie, progGornych, reslotCsv, DOMYSLNE } from "./reslot.js";
import type { Kartoteka, Opcje, Pobrania } from "./reslot.js";

/* Raport nie zmienia niczego w systemie — jego jedynym produktem jest lista,
   po której człowiek przenosi towar. Błąd nie objawi się więc awarią, tylko
   dniem pracy włożonym w przeniesienie niewłaściwych rzeczy.                 */

const TERAZ = new Date("2026-07-26T12:00:00Z");
const opcje = (o: Partial<Opcje> = {}): Opcje => ({ ...DOMYSLNE, teraz: TERAZ, ...o });

/* ── Rozbiór adresu ──────────────────────────────────────────────────────── */

test("adres rozkłada się na regał / kolumnę / poziom", () => {
  assert.deepEqual(parseAdres("D05-02-03"), {
    alejka: "D",
    regal: "D05",
    kolumna: 2,
    poziom: 3,
  });
});

test("co nie jest adresem regałowym, nie udaje poziomu 0", () => {
  // cicha zamiana na zera dałaby fałszywą „podłogę" i wysłała towar na eksmisję
  for (const zly of ["PALETA22", "PAL-042", "C07A-06-01", "", "W32-0203"]) {
    assert.equal(parseAdres(zly), null, zly);
  }
});

/* ── Reguły strefy złotej ────────────────────────────────────────────────── */

test("reguła alejkowa obejmuje wszystkie regały tej alejki", () => {
  for (const regal of ["A01", "A20", "A27"]) {
    assert.equal(wStrefieZlotej(parseAdres(`${regal}-01-03`)!), true, regal);
  }
  assert.equal(wStrefieZlotej(parseAdres("A01-01-05")!), false);
});

test("zakres regałów trafia dokładnie w swoje regały", () => {
  // D01–D05 ma strefę {2,3}; D00, D06, D07 nie mają reguły
  assert.equal(wStrefieZlotej(parseAdres("D01-01-02")!), true);
  assert.equal(wStrefieZlotej(parseAdres("D05-01-03")!), true);
  assert.equal(wStrefieZlotej(parseAdres("D05-01-04")!), false);
  assert.equal(wStrefieZlotej(parseAdres("D00-01-02")!), null);
  assert.equal(wStrefieZlotej(parseAdres("D06-01-02")!), null);
});

test("E03–E04 ma tylko poziom 2, E05–E08 ma 2 i 3", () => {
  // to jest sedno korekty `E04-08` → `E05-08`: zakresy nie mogą się nakładać
  assert.equal(wStrefieZlotej(parseAdres("E03-01-02")!), true);
  assert.equal(wStrefieZlotej(parseAdres("E04-01-03")!), false, "E04 nie ma poziomu 3");
  assert.equal(wStrefieZlotej(parseAdres("E05-01-03")!), true);
  assert.equal(wStrefieZlotej(parseAdres("E08-01-03")!), true);
  assert.equal(wStrefieZlotej(parseAdres("E01-01-02")!), null, "E01 bez reguły");
});

test("dwa nieprzyległe poziomy w F i G to nie pomyłka", () => {
  assert.deepEqual(poziomyStrefy(parseAdres("F07-01-04")!), [4, 8]);
  assert.equal(wStrefieZlotej(parseAdres("F07-01-08")!), true);
  assert.equal(wStrefieZlotej(parseAdres("F07-01-06")!), false, "poziom między pasmami");
  assert.deepEqual(poziomyStrefy(parseAdres("G12-01-03")!), [3, 7]);
});

/* ── Próg „górnych 15%" ──────────────────────────────────────────────────── */

test("próg liczy się na ruchomych, nie na całej kartotece", () => {
  // 2600 martwych indeksów rozcieńczyłoby zbiór tak, że progiem zostałoby zero
  // i CAŁA kartoteka trafiłaby na listę awansów
  const zMartwymi = [...Array(100).fill(0), 50, 40, 30, 20, 10];
  assert.equal(progGornych(zMartwymi, 0.15), 50);
});

test("brak jakichkolwiek pobrań nie daje progu zero", () => {
  assert.equal(progGornych([0, 0, 0], 0.15), Infinity);
});

/* ── Cała klasyfikacja ───────────────────────────────────────────────────── */

const kart = (
  twId: number,
  symbol: string,
  lok: string,
  stan = 1,
  ostatniZakup: string | null = "2026-07-01"
): Kartoteka => ({ twId, symbol, nazwa: "Towar " + symbol, lokalizacja: lok, stan, ostatniZakup });

const pob = (twId: number, pobrania: number, sztuki = pobrania): Pobrania => ({
  twId,
  pobrania,
  sztuki,
});

test("pobrania to liczba WYSTĄPIEŃ, nie suma ilości", () => {
  // Najczęstszy błąd domowych analiz ABC. Indeks wydany 400× po sztuce
  // generuje wielokrotnie więcej pracy niż wydany 4× po 100 szt. — mimo że
  // sztuk jest tyle samo. To praca, nie obrót, jest tym, co przenosimy.
  const kartoteki = [
    kart(1, "CZESTY", "A01-01-06"), // poza strefą (A ma 2,3,4)
    kart(2, "HURTOWY", "A01-01-06"),
  ];
  const raport = przeslotowanie(
    kartoteki,
    [pob(1, 400, 400), pob(2, 4, 400)],
    opcje({ gornyUdzial: 0.5 })
  );
  const awanse = raport.wiersze.filter((w) => w.lista === "awans").map((w) => w.symbol);
  assert.deepEqual(awanse, ["CZESTY"], "hurtowy ma te same sztuki, ale nie tę samą pracę");
});

test("martwy towar w strefie złotej idzie na eksmisję", () => {
  const r = przeslotowanie([kart(1, "MARTWY", "A01-01-03")], [], opcje());
  const w = r.wiersze.find((x) => x.lista === "eksmisja");
  assert.equal(w?.symbol, "MARTWY");
  assert.match(w!.powod, /zero pobrań/);
});

test("martwy towar POZA strefą złotą nie generuje pracy", () => {
  const r = przeslotowanie([kart(1, "MARTWY", "A01-01-06", 0)], [], opcje());
  assert.equal(r.wiersze.filter((w) => w.lista === "eksmisja").length, 0);
});

test("regał bez reguły trafia na czwartą listę, nigdy na pierwszą ani drugą", () => {
  // gdyby brak reguły znaczył „poza strefą", ten martwy towar wpadłby na
  // eksmisję albo awans bez żadnej podstawy
  const r = przeslotowanie([kart(1, "NIEZNANY", "E01-01-02")], [], opcje());
  assert.deepEqual(r.wiersze.map((w) => w.lista), ["brak_reguly"]);
  assert.equal(r.ocenionych, 0, "nieoceniona kartoteka nie liczy się jako oceniona");
  assert.match(r.wiersze[0].cel, /E01/);
});

test("brak reguły NIE ukrywa kandydata do likwidacji", () => {
  // Lista 3 jest decyzją HANDLOWĄ i od pionu nie zależy. Gdyby regał bez reguły
  // kończył ocenę kartoteki, leżący na nim martwy towar ze stanem zniknąłby
  // z oczu tylko dlatego, że nikt nie podał strefy dla tego regału.
  const r = przeslotowanie([kart(1, "ZAPOMNIANY", "E01-01-02", 7, "2022-03-01")], [], opcje());
  assert.deepEqual(r.wiersze.map((w) => w.lista).sort(), ["brak_reguly", "likwidacja"]);
});

test("kandydat do likwidacji: zero pobrań, jest stan, stary zakup", () => {
  const stary = przeslotowanie([kart(1, "STARY", "F01-01-01", 5, "2023-01-01")], [], opcje());
  assert.ok(stary.wiersze.some((w) => w.lista === "likwidacja"));

  const swiezy = przeslotowanie([kart(2, "SWIEZY", "F01-01-01", 5, "2026-06-01")], [], opcje());
  assert.ok(!swiezy.wiersze.some((w) => w.lista === "likwidacja"));

  const bezStanu = przeslotowanie([kart(3, "PUSTY", "F01-01-01", 0, "2020-01-01")], [], opcje());
  assert.ok(!bezStanu.wiersze.some((w) => w.lista === "likwidacja"), "nie ma czego likwidować");
});

test("kartoteki bez adresu i z adresem spoza wzorca są POLICZONE, nie zgubione", () => {
  const r = przeslotowanie(
    [kart(1, "BEZ", ""), kart(2, "PALETA", "PALETA22"), kart(3, "OK", "A01-01-03")],
    [],
    opcje()
  );
  assert.equal(r.pominieto.bezAdresu, 1);
  assert.equal(r.pominieto.adresSpozaWzorca, 1);
  assert.equal(r.zAdresem, 2);
});

test("wynik posortowany po lokalizacji — alejką chodzi się raz", () => {
  const r = przeslotowanie(
    [kart(1, "C", "A03-01-03"), kart(2, "A", "A01-01-03"), kart(3, "B", "A02-01-03")],
    [],
    opcje()
  );
  const eks = r.wiersze.filter((w) => w.lista === "eksmisja").map((w) => w.lokalizacja);
  assert.deepEqual(eks, ["A01-01-03", "A02-01-03", "A03-01-03"]);
});

test("CSV otwiera się w Excelu PL i niesie kolejność wykonania", () => {
  const csv = reslotCsv(przeslotowanie([kart(1, "X", "A01-01-03")], [], opcje()));
  assert.ok(csv.startsWith("﻿"), "BOM");
  assert.match(csv, /KOLEJNOSC MA ZNACZENIE/);
  assert.match(csv, /lista;symbol;nazwa;lokalizacja;cel;pobran_12m;stan;powod/);
});

test("bez historii pobrań KAŻDY indeks wygląda na martwy", () => {
  // Sedno bezpiecznika w reslot-run.ts: to nie jest hipotetyczne. Na realnej
  // kartotece pusta historia dała 1375 „eksmisji" i 3027 „likwidacji", czyli
  // polecenie opróżnienia całej strefy złotej. Ten sam stan na produkcji
  // wywoła zły `dok_Typ` albo zły zakres dat — a raport wygląda wtedy jak
  // zlecenie robocze, nie jak awaria.
  const kartoteki = [
    kart(1, "ZYWY", "A01-01-03", 5),
    kart(2, "TEZ-ZYWY", "A02-01-03", 5),
  ];
  const bezHistorii = przeslotowanie(kartoteki, [], opcje());
  assert.equal(
    bezHistorii.wiersze.filter((w) => w.lista === "eksmisja").length,
    2,
    "sama funkcja liczy uczciwie — to wołający musi rozpoznać brak danych"
  );

  // z historią te same kartoteki nie są martwe
  const zHistoria = przeslotowanie(kartoteki, [pob(1, 10), pob(2, 10)], opcje());
  assert.equal(zHistoria.wiersze.filter((w) => w.lista === "eksmisja").length, 0);
});
