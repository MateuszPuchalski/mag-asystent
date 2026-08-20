import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { kandydaciZamiennikow, podzielZamienniki } from "./zamienniki.js";
import { config } from "../config.js";

/* Opis kartoteki to pole swobodne, więc parser zawsze będzie przybliżeniem.
   Kosztowna jest jednak tylko jedna strona pomyłki: przeoczony zamiennik to
   spacer do regału, a zamiennik PODANY BŁĘDNIE to zła część wysłana klientowi.
   Dlatego każdy wiersz tabeli pilnuje przypadku, w którym opis kusi, żeby
   powiedzieć za dużo.                                                        */

/** Skrót: rozstrzyga wyłącznie podana lista symboli. */
function kartotekaZ(...symbole: string[]) {
  const set = new Set(symbole.map((s) => s.toUpperCase()));
  return (s: string) => set.has(s.toUpperCase());
}

const TABELA: Array<{
  opis: string;
  sym: string;
  maSymbole: string[];
  znane: string[];
  obce: string[];
  po: string;
}> = [
  {
    opis: "OEM: 41307131600 Modele: FS200 FS250 Zamiennik: 24-04003",
    sym: "FTC272",
    maSymbole: ["24-04003"],
    znane: ["24-04003"],
    obce: [],
    po: "sekcje OEM: i Modele: leżą PRZED etykietą i nie należą do listy",
  },
  {
    opis:
      "110x130 OEM: 491588S // 491588 // 399959 // 17211-ZL8-000 Zamiennik: 89-022 // 04-01003",
    sym: "W08-0502",
    maSymbole: ["04-01003"],
    znane: ["04-01003"],
    obce: ["89-022"],
    po: "numery z sekcji OEM nie wciekają do zamienników mimo tych samych separatorów",
  },
  {
    opis: "OEM: 492932, 492056, 696854 Zastępuje: 05-01001",
    sym: "W06-1302",
    maSymbole: ["05-01001"],
    znane: ["05-01001"],
    obce: [],
    po: "Zastępuje: to też etykieta zamiennika",
  },
  {
    opis: "Zamiennik: M831364 // FTC242+92-009 // FTC242+FTC243",
    sym: "W03-0802",
    maSymbole: ["FTC242", "92-009", "FTC243"],
    znane: [],
    obce: ["M831364", "FTC242+92-009", "FTC242+FTC243"],
    po: "PLUS łączy zestaw, nie alternatywy — sama FTC242 NIE jest zamiennikiem",
  },
  {
    opis: "Zamiennie: 04-01005+04-01020 // 04-01005 // FTC299",
    sym: "W08-1302",
    maSymbole: ["04-01005", "04-01020", "FTC299"],
    znane: ["04-01005", "FTC299"],
    obce: ["04-01005+04-01020"],
    po: "autor sam odróżnia parę od pojedynczej sztuki — parser musi tak samo",
  },
  {
    opis: "Zamiennie: NZ113 // 28-05025 // 124-003 //  503 22 00-01 530 01 59-17",
    sym: "W25-0801",
    maSymbole: ["28-05025"],
    znane: ["28-05025"],
    obce: ["NZ113", "124-003"],
    po: "numery Husqvarny pisane spacjami to nie są tokeny — sieczka odpada",
  },
  {
    opis: "Zamienniki: 160f, 168f,  Silniki: 3,5 - 4KM, 5 - 6,5KM",
    sym: "55-064",
    maSymbole: [],
    znane: [],
    obce: ["160f", "168f"],
    po: "Silniki: kończy listę; nierozpoznane zostają jako numery obce",
  },
  {
    opis: "025 MS170 Śruba OEM: 11236642400 Nr. oryg.: GND-33 STIHL: 017 018 Zamiennik: 76-064",
    sym: "W24-0807",
    maSymbole: ["76-064"],
    znane: ["76-064"],
    obce: [],
    po: "Nr. oryg.: i STIHL: to etykiety, których żadna whitelista by nie znała",
  },
  {
    opis: "Zamiennik: 05-06014 // 05-06007 // W07-0401 // W07-0402 OEM: 00003503510",
    sym: "W07-0401",
    maSymbole: ["05-06007", "W07-0402"],
    znane: ["05-06007", "W07-0402"],
    obce: ["05-06014"],
    po: "własny symbol odrzucony, a OEM: nie utnie sąsiedniego W07-0402 w połowie",
  },
  {
    opis: "OEM: 692519 806232 ZAM: W08-1305 ZAM wstępny: 510011",
    sym: "692520",
    maSymbole: ["W08-1305", "510011"],
    znane: ["W08-1305"],
    obce: [],
    po: "ZAM: to etykieta; ZAM wstępny: dotyczy filtra wstępnego, czyli innej części",
  },
  {
    opis: "Zamiennie: OLEJ-MIX-0,5L // DBR A-7540444 // FTC199/FTC206",
    sym: "W99-9999",
    maSymbole: ["OLEJ-MIX-0,5L", "DBR A-7540444", "FTC199/FTC206"],
    znane: ["OLEJ-MIX-0,5L", "DBR A-7540444", "FTC199/FTC206"],
    obce: [],
    po: "przecinek, spacja i ukośnik SIEDZĄ w prawdziwych symbolach — całość przed podziałem",
  },
  {
    opis: "Zamienni: W06-1303",
    sym: "492932S",
    maSymbole: ["W06-1303"],
    znane: ["W06-1303"],
    obce: [],
    po: "literówka w etykiecie (Zamienni zamiast Zamiennik) jest w danych i musi działać",
  },
  {
    opis: "Osłona świecy Honda GX110, pasuje do BPR6ES",
    sym: "W10-0101",
    maSymbole: ["BPR6ES"],
    znane: [],
    obce: [],
    po: "opis bez etykiety nie daje NIC, choćby zawierał symbol z kartoteki",
  },
  {
    opis: "S11100 // G74050 // MF381350",
    sym: "W80-0101",
    maSymbole: ["S11100", "G74050", "MF381350"],
    znane: ["S11100", "G74050", "MF381350"],
    obce: [],
    po: "sama lista po // jest listą, choć nikt jej nie podpisał",
  },
  {
    opis: "Filtr powietrza do pilarki. S11100 // G74050 // MF381350",
    sym: "W80-0102",
    maSymbole: ["S11100", "G74050", "MF381350"],
    znane: ["S11100", "G74050", "MF381350"],
    obce: [],
    po: "proza przed listą nie przeszkadza i sama nie trafia do wyniku",
  },
  {
    opis: "Pasuje do modeli 340 // 345 // 350",
    sym: "W80-0103",
    maSymbole: ["340"],
    znane: [],
    obce: [],
    po: "jedno trafienie bez nagłówka to za mało — numer modelu bywa naszym symbolem",
  },
  {
    opis: "ex1003 // FTC335 // 8R77-01",
    sym: "W80-0803",
    maSymbole: ["ex1003", "8R77-01"],
    znane: ["ex1003", "8R77-01"],
    obce: [],
    po: "bez nagłówka nierozpoznane numery NIE idą do obcych — nie wiadomo, czym są",
  },
  {
    opis: "",
    sym: "W00-0000",
    maSymbole: [],
    znane: [],
    obce: [],
    po: "pusty opis",
  },
];

for (const { opis, sym, maSymbole, znane, obce, po } of TABELA) {
  test(`${sym}: ${po}`, () => {
    const wynik = podzielZamienniki(opis, sym, kartotekaZ(...maSymbole));
    assert.deepEqual(wynik.znane, znane, "znane");
    assert.deepEqual(wynik.obce, obce, "obce");
  });
}

test("kandydaci obejmują każdy szczebel podziału, żeby baza mogła rozstrzygnąć", () => {
  // Parser nie wie, co jest symbolem — pyta o wszystko, co mogłoby nim być.
  const k = kandydaciZamiennikow("Zamiennik: FTC212 / EX1095 // OLEJ-MIX-0,5L", "W1");
  assert.ok(k.includes("FTC212 / EX1095"), "cały kawałek przed podziałem po ukośniku");
  assert.ok(k.includes("EX1095"), "część po podziale");
  assert.ok(k.includes("OLEJ-MIX-0,5L"), "symbol z przecinkiem w środku");
});

test("bez etykiety kandydatami są tylko tokeny wyglądające na numer", () => {
  /* Cały opis idzie wtedy do rozbioru, więc bez tego zawężenia limit
     kandydatów zjadałyby wyrazy prozy, zanim dojdzie do symboli. */
  const k = kandydaciZamiennikow("Filtr powietrza do pilarki. S11100 // G74050", "W1");
  assert.ok(k.includes("S11100") && k.includes("G74050"), "symbole zostają");
  assert.ok(!k.some((t) => /^[A-Za-z]+$/.test(t)), `wyraz prozy w kandydatach: ${k}`);
});

test("opis bez // nie uruchamia trybu domyślnego", () => {
  // przecinek i spacja dzielą prozę — lista bez nagłówka byłaby na nich zgadywaniem
  assert.deepEqual(kandydaciZamiennikow("S11100, G74050 i jeszcze MF381350", "W1"), []);
});

test("własny symbol nigdy nie jest kandydatem", () => {
  const k = kandydaciZamiennikow("Zamiennik: W07-0401 // 05-06007", "w07-0401");
  assert.ok(!k.some((t) => t.toUpperCase() === "W07-0401"));
});

/* ── Strażnik na PRAWDZIWEJ kartotece ───────────────────────────────────────
   Tabela wyżej dowodzi reguł na przypadkach, które sam wybrałem. Ten test
   pilnuje, że reguły nadal trafiają w rzeczywistość: parser, który przestanie
   cokolwiek znajdować, zrobi się „zielony" na tabeli i czerwony tutaj.       */

/** Ta sama kartoteka, z której powstaje seed — plik jest w repo. */
function kartoteka(): string[][] {
  return JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
}

const SYMBOL = 0;
const OPIS = 9;

test("na pełnej kartotece parser znajduje setki zamienników, nie zero i nie wszystko", () => {
  const rows = kartoteka();
  // brak danych to NIE jest wynik — strażnik bez danych milczy
  assert.ok(rows.length > 3000, `kartoteka wygląda na niekompletną: ${rows.length} pozycji`);

  const wKartotece = kartotekaZ(...rows.map((r) => String(r[SYMBOL]).trim()));
  let zKlikalnym = 0;
  for (const r of rows) {
    const { znane } = podzielZamienniki(String(r[OPIS] ?? ""), String(r[SYMBOL]), wKartotece);
    if (znane.length > 0) zKlikalnym++;
  }

  /* Przedział, nie liczba dokładna: opis jest polem swobodnym, a `products.json`
     bywa odświeżany. Regres parsera (zero trafień) i rozjazd w drugą stronę
     (wzorzec przepuszczający numery OEM) wychodzą oba, a zmiana danych o 10%
     nie psuje testu bez powodu. Pomiar z 2026-07-26: 393 kartoteki; po
     dopuszczeniu list bez etykiety (0.61.0) jest ich 491, z czego 69 to
     kartoteki, w których wcześniej sekcja była pusta. */
  assert.ok(
    zKlikalnym > 250 && zKlikalnym < 600,
    `kartotek z klikalnym zamiennikiem: ${zKlikalnym} — poza spodziewanym przedziałem`
  );
});

test("strażnik faktycznie wykrywa regres, a nie tylko przechodzi", () => {
  // Bez tej asercji parser zwracający zawsze [] jest zielony i wygląda jak dowód.
  const zepsuty = (_: string) => false;
  const { znane, obce } = podzielZamienniki("Zamiennik: 24-04003", "FTC272", zepsuty);
  assert.deepEqual(znane, [], "pusta kartoteka nie daje klikalnych");
  assert.deepEqual(obce, ["24-04003"], "…ale token nie znika — ląduje w obcych");
});
