import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";

/**
 * Wymiary z nazw i opisów kartotek — szczebel „zgodne wymiary" (§11.2).
 *
 * Blizna z 9.09.2026: klient pyta o „linkę napędową 148 cm", katalog MA
 * „Linka napędu Castel Garden 81000668/1 1170x1480", a żaden szczebel jej nie
 * znalazł: pełny tekst pyta o słowa, nie o liczby, „148 cm" nigdzie nie
 * stawało się „1480", a w nazwie liczba stoi jako jeden token „1170x1480".
 *
 * Ten sam wzór, co `towar_identyfikator`: parser DETERMINISTYCZNY po
 * imporcie, tabela pochodna bez cyklu życia i bez nadawcy ręcznego, odczyt
 * po liczbie. Czyta NAZWĘ i OPIS — inaczej niż tokeny silników, bo wymiar
 * w opisie nie bywa negacją („linka napędu 1480mm x 1280mm" to fakt, nie
 * notatka „nie pasuje do…").
 *
 * Dopasowanie DOKŁADNE co do milimetra, bez tolerancji: tolerancja to
 * zgadywanie, a szczebel i tak mówi „wymaga danych". Jednostka OBOWIĄZKOWA —
 * „148" bez jednostki nie jest wymiarem, bo nie wiadomo, czy to centymetry.
 * `zwin()` kasuje kropki i przecinki, więc liczby z jednostką parsuje ta
 * funkcja, nie normalizacja tekstu.
 */

export interface Wymiar { mm: number; zapis: string }

/* Liczba z jednostką. `mm` i `cm` bez względu na wielkość liter („102 MM"),
   metry WYŁĄCZNIE małą literą — „1330M" to model Mountfield, nie 1330 metrów.
   Lookbehind i lookahead wykluczają litery, cyfry i `/`: „4x9mm" (przekrój
   przewodu) i „81000668/1" nie są wymiarami. */
const MM_CM = /(?<![\p{L}\d/.,-])(\d{1,4}(?:[.,]\d{1,2})?)\s*(mm|cm)(?![\p{L}\d/])/giu;
const METRY = /(?<![\p{L}\d/.,-])(\d{1,4}(?:[.,]\d{1,2})?)\s*m(?![\p{L}\d/])/gu;
/* Para „1170x1480", „1420x1250mm". Trzy cyfry minimum z obu stron, żeby gwint
   „M12x1,5" i przekrój „4x9mm" nie były wymiarami. */
const PARA = /(?<![\p{L}\d/.,-])(\d{3,4})\s*[x×X]\s*(\d{3,4})(?:\s*mm)?(?![\p{L}\d/])/gu;

const MAX_MM = 100_000; // szpule 100 m

/** Wymiary z tekstu w milimetrach całkowitych, bez powtórek, w kolejności wystąpienia. */
export function wymiaryZTekstu(tekst: string): Wymiar[] {
  const wynik = new Map<number, string>();
  const dodaj = (mm: number, zapis: string) => {
    if (mm >= 1 && mm <= MAX_MM && !wynik.has(mm)) wynik.set(mm, zapis.trim());
  };
  const t = tekst ?? "";
  for (const m of t.matchAll(PARA)) { dodaj(Number(m[1]), m[0]); dodaj(Number(m[2]), m[0]); }
  for (const m of t.matchAll(MM_CM)) {
    const liczba = Number(m[1]!.replace(",", "."));
    dodaj(Math.round(liczba * (m[2]!.toLowerCase() === "cm" ? 10 : 1)), m[0]);
  }
  for (const m of t.matchAll(METRY)) dodaj(Math.round(Number(m[1]!.replace(",", ".")) * 1000), m[0]);
  return [...wynik].map(([mm, zapis]) => ({ mm, zapis }));
}

/** Wymiary z parametrów doboru: „długość: 148 cm" → 1480 z etykietą do zdania źródła. */
export function wymiaryZParametrow(parametry: Record<string, string>): Array<Wymiar & { etykieta: string }> {
  const wynik: Array<Wymiar & { etykieta: string }> = [];
  for (const [klucz, wartosc] of Object.entries(parametry ?? {})) {
    for (const w of wymiaryZTekstu(String(wartosc ?? ""))) {
      if (!wynik.some((x) => x.mm === w.mm)) wynik.push({ ...w, etykieta: `${klucz}: ${wartosc}` });
    }
  }
  return wynik;
}

/**
 * Przebudowa po imporcie: kasuje i zakłada od nowa, jak identyfikatory.
 * Nazwa idzie pierwsza, opis drugi — przy tym samym milimetrze wygrywa nazwa
 * (`INSERT OR IGNORE` po kluczu `(tw_id, mm)`), bo to ona stoi w zdaniu źródła.
 */
export function przebudujWymiary(database: DatabaseSync = db()): { kartotek: number; wymiarow: number; ms: number } {
  const start = Date.now();
  let kartotek = 0; let wymiarow = 0;
  transaction(database, () => {
    database.prepare("DELETE FROM wymiar_kartoteki").run();
    const ins = database.prepare("INSERT OR IGNORE INTO wymiar_kartoteki(tw_id,tw_symbol,mm,zapis,pole) VALUES (?,?,?,?,?)");
    const wiersze = database.prepare("SELECT tw_id, symbol, nazwa, opis FROM sgt_towar").all() as
      Array<{ tw_id: number; symbol: string; nazwa: string | null; opis: string | null }>;
    for (const w of wiersze) {
      let ile = 0;
      for (const [pole, tekst] of [["nazwa", w.nazwa], ["opis", w.opis]] as const) {
        for (const x of wymiaryZTekstu(tekst ?? "")) ile += Number(ins.run(w.tw_id, w.symbol, x.mm, x.zapis, pole).changes);
      }
      if (ile > 0) { kartotek += 1; wymiarow += ile; }
    }
  })();
  return { kartotek, wymiarow, ms: Date.now() - start };
}

export interface TrafienieWymiaru {
  twId: number; symbol: string; nazwa: string;
  trafienia: Array<{ mm: number; zapis: string; pole: "nazwa" | "opis" }>;
}

/**
 * Kartoteki z DOKŁADNIE tymi milimetrami. Najpierw te, które trafiają
 * w więcej wymiarów naraz (długość i szerokość), potem po symbolu, żeby
 * kolejność była powtarzalna.
 */
export function szukajPoWymiarach(mm: number[], limit: number, database: DatabaseSync = db()): TrafienieWymiaru[] {
  const szukane = [...new Set(mm.filter((x) => Number.isFinite(x) && x > 0))];
  if (szukane.length === 0) return [];
  const wiersze = database.prepare(`SELECT w.tw_id, w.tw_symbol, t.nazwa, w.mm, w.zapis, w.pole
      FROM wymiar_kartoteki w JOIN sgt_towar t ON t.tw_id = w.tw_id
      WHERE w.mm IN (${szukane.map(() => "?").join(",")})
      ORDER BY w.tw_symbol, w.mm`).all(...szukane) as
    Array<{ tw_id: number; tw_symbol: string; nazwa: string; mm: number; zapis: string; pole: "nazwa" | "opis" }>;
  const mapa = new Map<number, TrafienieWymiaru>();
  for (const w of wiersze) {
    const t = mapa.get(w.tw_id) ?? { twId: w.tw_id, symbol: w.tw_symbol, nazwa: w.nazwa, trafienia: [] };
    t.trafienia.push({ mm: w.mm, zapis: w.zapis, pole: w.pole });
    mapa.set(w.tw_id, t);
  }
  return [...mapa.values()]
    .sort((a, b) => b.trafienia.length - a.trafienia.length || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);
}

/** Pusty indeks przy niepustym katalogu — szczebel ma to nazwać, nie milczeć. */
export function indeksWymiarowPusty(database: DatabaseSync = db()): boolean {
  const n = (sql: string) => Number((database.prepare(sql).get() as { n: number }).n);
  return n("SELECT count(*) n FROM sgt_towar") > 0 && n("SELECT count(*) n FROM wymiar_kartoteki") === 0;
}
