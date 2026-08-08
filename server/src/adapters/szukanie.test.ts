import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kolejność wyników wyszukiwania ──────────────────────────────────────────
   POWSTAŁO PO ZGŁOSZENIU z magazynu. Z ~3600 kartotek aktywnych jest ~1000,
   więc dwie trzecie trafień to kartoteki martwe: zerowy stan w obu magazynach.
   Sortowanie po samym symbolu wypychało je na górę alfabetem i magazynier
   przewijał listę, żeby dojść do pozycji, którą w ogóle można podać klientowi.

   Trafność zostaje kryterium PIERWSZYM — te testy pilnują, że stan magazynowy
   jej nie wywraca, tylko rozstrzyga wewnątrz niej.                            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szuk-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";

let db: typeof import("../db/db.js").db;
let subiekt: import("./subiekt.js").SubiektAdapter;

before(async () => {
  ({ db } = await import("../db/db.js"));
  const { SeededSubiektAdapter } = await import("./subiekt.seeded.js");
  subiekt = new SeededSubiektAdapter();
});

/** Towar z zadanym stanem na hali i w przyjęciach. */
function towar(id: number, sym: string, nazwa: string, mag: number, mgp = 0, ean = ""): void {
  const d = db();
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,'')"
  ).run(id, sym, nazwa, ean);
  d.prepare("INSERT OR REPLACE INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,1,?,0)").run(id, mag);
  d.prepare("INSERT OR REPLACE INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,2,?,0)").run(id, mgp);
}

beforeEach(() => {
  db().prepare("DELETE FROM sgt_stan").run();
  db().prepare("DELETE FROM sgt_towar").run();
});

const symbole = (q: string) => subiekt.search(q, 20).map((r) => r.sym);

test("towar ze stanem wyprzedza martwą kartotekę o wcześniejszym symbolu", () => {
  // alfabetycznie AAA-1 wygrywa; magazynowo nie ma go wcale
  towar(1, "AAA-1", "Kosa spalinowa", 0);
  towar(2, "ZZZ-9", "Kosa spalinowa", 12);
  assert.deepEqual(symbole("Kosa"), ["ZZZ-9", "AAA-1"]);
});

test("większy stan idzie przed mniejszym", () => {
  towar(1, "K-1", "Kosa", 2);
  towar(2, "K-2", "Kosa", 40);
  towar(3, "K-3", "Kosa", 15);
  assert.deepEqual(symbole("Kosa"), ["K-2", "K-3", "K-1"]);
});

test("stan liczy się ŁĄCZNIE z halą i przyjęciami", () => {
  // towar na MGP jeszcze nie leży na półce, ale JEST w firmie — pomijanie go
  // kazałoby magazynierowi szukać dalej mimo pełnej palety w przyjęciach
  towar(1, "K-1", "Kosa", 5, 0);
  towar(2, "K-2", "Kosa", 0, 30);
  assert.deepEqual(symbole("Kosa"), ["K-2", "K-1"]);
});

test("TRAFNOŚĆ nadal wygrywa ze stanem", () => {
  /* Wpisany symbol ma wygrać z przypadkowym trafieniem w nazwie, choćby tamto
     miało pełny magazyn — inaczej szukanie po symbolu przestałoby działać. */
  towar(1, "KOSA-77", "Element dowolny", 0);
  towar(2, "INNY-1", "Kosa spalinowa", 999);
  assert.deepEqual(symbole("KOSA"), ["KOSA-77", "INNY-1"]);
});

test("przy równym stanie kolejność jest powtarzalna — po symbolu", () => {
  towar(1, "K-9", "Kosa", 7);
  towar(2, "K-1", "Kosa", 7);
  assert.deepEqual(symbole("Kosa"), ["K-1", "K-9"]);
});

test("kartoteka bez wiersza stanu liczy się jako zero, nie wypada z wyników", () => {
  // LEFT JOIN: brak wiersza w sgt_stan to stan zerowy, a nie brak towaru
  db()
    .prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (5,'BRAK-1','Kosa','','')")
    .run();
  towar(1, "MA-1", "Kosa", 3);
  assert.deepEqual(symbole("Kosa"), ["MA-1", "BRAK-1"]);
});

/* ── Wyrozumiałość (0.34.0) ──────────────────────────────────────────────────
   Zgłoszenie brzmiało: „wpisuję gaznik i nie znajduje gaźnika". Przyczyna
   sięgała głębiej — SQLite nie zna polskich liter ani w `lower()`, ani
   w `COLLATE NOCASE`, więc zepsuta była też zwykła wielkość liter.           */

test("gaznik znajduje Gaźnik — cztery warianty pisowni", () => {
  towar(1, "G-1", "Gaźnik kompletny", 5);
  for (const q of ["gaznik", "gaźnik", "GAŹNIK", "Gaznik", "GAZNIK"]) {
    assert.deepEqual(symbole(q), ["G-1"], `nie znalazł dla „${q}"`);
  }
});

test("kierunek odwrotny też — zapytanie z ogonkiem, kartoteka bez", () => {
  // asymetria składania JS vs SQL objawiłaby się dokładnie tutaj
  towar(1, "G-2", "Gaznik do kosy", 5);
  assert.deepEqual(symbole("gaźnik"), ["G-2"]);
});

test("wielkość liter działa TAKŻE dla polskich znaków", () => {
  // regresja na dzisiejszą wadę: 'łańcuch' = 'ŁAŃCUCH' COLLATE NOCASE dawało 0
  towar(1, "L-1", "łańcuch tnący", 5);
  assert.deepEqual(symbole("ŁAŃCUCH"), ["L-1"]);
});

test("słowa w dowolnej kolejności", () => {
  towar(1, "S-1", "Gaźnik ssanie ręczne", 5);
  assert.deepEqual(symbole("ssanie gaznik"), ["S-1"]);
  assert.deepEqual(symbole("gaznik ssanie"), ["S-1"]);
});

test("myślniki i spacje w symbolu nie mają znaczenia", () => {
  towar(1, "LS51-139-HSD-LI-068", "Filtr", 5);
  for (const q of ["LS51139", "ls51-139", "LS51 139", "ls51139hsd"]) {
    assert.deepEqual(symbole(q), ["LS51-139-HSD-LI-068"], `nie znalazł dla „${q}"`);
  }
});

test("myślnik w nazwie też nie przeszkadza", () => {
  towar(1, "O-1", "SW-40 olej silnikowy", 5);
  assert.deepEqual(symbole("sw40"), ["O-1"]);
});

test("cała fraza w nazwie bije rozproszone słowa", () => {
  towar(1, "R-1", "Gaźnik ssanie", 0);
  towar(2, "R-2", "Ssanie do pompy, gaźnik osobno", 999);
  // R-1 ma frazę „gaznikssanie" w jednym kawałku (rank 1), R-2 tylko oba słowa
  // rozproszone (rank 2) — i to ma wygrać ze stanem 999
  assert.deepEqual(symbole("gaznik ssanie"), ["R-1", "R-2"]);
});

// ── Furtka na literówki ─────────────────────────────────────────────────────

test("literówka znajduje towar, gdy dosłownie nic nie ma", () => {
  towar(1, "G-1", "Gaźnik kompletny", 5);
  assert.deepEqual(symbole("gaznk"), ["G-1"]);
  assert.deepEqual(symbole("gzanik"), ["G-1"]);
});

test("literówka NIE wypycha trafienia dosłownego", () => {
  /* Sedno projektu: furtka odpala się WYŁĄCZNIE przy zerze wyników. Gdyby
     dopasowanie rozmyte szło do wspólnego rankingu, „gaznk" zwracałoby oba
     towary i dokładne trafienie tonęłoby wśród podobnych. */
  towar(1, "D-1", "Gaznk specjalny", 1);
  towar(2, "D-2", "Gaznik zwykły", 999);
  assert.deepEqual(symbole("gaznk"), ["D-1"]);
});

test("krótkie słowo nie dostaje prawa do literówki", () => {
  // jeden błąd na trzech znakach zrównuje kos = kot = koc = kod
  towar(1, "K-1", "Koc wełniany", 5);
  assert.deepEqual(symbole("kos"), []);
});

test("ścieżka skanu NIE dostaje wyników przybliżonych", () => {
  /* Strażnik auto-otwarcia karty z routes/products.ts: gdy skan zwróci
     dokładnie jeden wynik, serwer otwiera kartę bez pytania. Trafienie po
     literówce prowadziłoby wprost do cudzej kartoteki. */
  towar(1, "G-1", "Gaźnik kompletny", 5);
  assert.deepEqual(subiekt.search("gaznk", 20, { literowki: false }).map((r) => r.sym), []);
  assert.deepEqual(subiekt.search("gaznk", 20).map((r) => r.sym), ["G-1"]);
});

test("przy równym dystansie literówki rozstrzyga stan magazynowy", () => {
  towar(1, "F-1", "Gaznik", 2);
  towar(2, "F-2", "Gaznil", 40);
  // oba o dystansie 1 od „gaznk"… nie: oba mają dystans 1 od „gazni"
  assert.deepEqual(symbole("gazni"), ["F-2", "F-1"]);
});

// ── Śmieci na wejściu ───────────────────────────────────────────────────────

test("zapytanie bez ani jednego słowa nie zwraca całej kartoteki", () => {
  /* Koniunkcja po pustym zbiorze tokenów jest PRAWDZIWA — bez strażnika
     „-" oddawałoby dwadzieścia najlepiej zatowarowanych kartotek. */
  towar(1, "A-1", "Kosa", 5);
  towar(2, "A-2", "Piła", 5);
  for (const q of ["-", "///", "   ", "..."]) {
    assert.deepEqual(symbole(q), [], `„${q}" zwróciło wyniki`);
  }
});

test("procent przestaje być wieloznacznikiem", () => {
  /* Regresja na dzisiejszy błąd: `%` szło do wzorca LIKE jako „cokolwiek",
     więc `100%` trafiało też `1005`, a samo `%` całą kartotekę.

     Uwaga na drugą asercję: `%` MA znaleźć P-1, bo jego nazwa naprawdę
     zawiera znak procentu. Dowodem naprawy jest to, że NIE znajduje P-2. */
  towar(1, "P-1", "Filtr 100% bawelna", 5);
  towar(2, "P-2", "Filtr 1005", 5);
  assert.deepEqual(symbole("100%"), ["P-1"], "procent ma być znakiem, nie wieloznacznikiem");
  assert.deepEqual(symbole("%"), ["P-1"], "trafia tylko tam, gdzie procent stoi w treści");
});

test("podkreślenie przestaje być wieloznacznikiem", () => {
  towar(1, "U-1", "Wal_korbowy", 5);
  towar(2, "U-2", "Walxkorbowy", 5);
  assert.deepEqual(symbole("wal_"), ["U-1"]);
});

// ── EAN ─────────────────────────────────────────────────────────────────────

test("EAN nadal działa i ustępuje trafieniu tekstowemu", () => {
  towar(1, "E-1", "Zupełnie inny towar", 0, 0, "5901234567890");
  towar(2, "E-2", "Kosa 5901234567890 w nazwie", 0);
  assert.deepEqual(symbole("5901234567890"), ["E-2", "E-1"]);
});

test("EAN ze spacją ze skanera też trafia", () => {
  // cyfry wyciągamy z zapytania, a nie wymagamy czystego ciągu cyfr
  towar(1, "E-1", "Towar", 5, 0, "5901234567890");
  assert.deepEqual(symbole("5901234 567890"), ["E-1"]);
});
