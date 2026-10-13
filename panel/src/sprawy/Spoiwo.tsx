import { MessageSquare, Scale, Undo2, MessagesSquare } from "lucide-react";
import type { PrzystanekDrogi, SprawaZakupu } from "../api/typy";

/* ── Spoiwo kolejek (`docs/obsluga-klienta-calosc.md`) ────────────────────────
   Słownik kolejek i składanie ich spraw w przystanki drogi klienta. Jeden
   słownik dla wszystkich ekranów, więc agent rozpoznaje sprawę tą samą
   nazwą i ikoną w skrzynce, zwrocie, reklamacji i dyskusji.

   Odnośniki idą przez `Link` (w pasku drogi), nie przez `<a href>`: gołe
   `href` przeładowuje stronę i wspólny cache zapytań startuje od zera.

   Własnych bloków list spraw tu już nie ma. Inne sprawy zakupu mówi
   wyłącznie pasek drogi, a stan, termin i prowadzącego niesie jego przystanek. */

/** Jak nazywa się przystanek i dokąd prowadzi — jedno miejsce na cztery.
    `cel` to biernik do nazwy łącza („otwórz rozmowę”): czytnik ma usłyszeć,
    dokąd prowadzi klik, a nie tylko rodzaj sprawy. */
export const KOLEJKI = {
  rozmowa: { nazwa: "pytanie", cel: "rozmowę", ikona: MessageSquare, sciezka: "/obsluga/skrzynka" },
  dyskusja: { nazwa: "dyskusja", cel: "dyskusję", ikona: MessagesSquare, sciezka: "/obsluga/dyskusje" },
  reklamacja: { nazwa: "reklamacja", cel: "reklamację", ikona: Scale, sciezka: "/obsluga/reklamacje" },
  zwrot: { nazwa: "zwrot", cel: "zwrot", ikona: Undo2, sciezka: "/obsluga/zwroty" },
} as const;

/** Dyskusja czy reklamacja — rozstrzyga kolumna `typ`, nigdy jedna plakietka. */
const rodzajSprawy = (typ: string): "dyskusja" | "reklamacja" =>
  (typ === "DISPUTE" ? "dyskusja" : "reklamacja");

/**
 * Inna sprawa tego zakupu: z której kolejki, która i od kiedy.
 *
 * Pola stanu przychodzą z wiersza `sprawy` tej samej sprawy. Zwrot i rozmowa
 * go nie mają, więc niosą samą datę i opis z drogi (zwrot: numer, rozmowa:
 * temat). Brak pola znaczy „nie wiemy”, nigdy „otwarta”.
 */
export interface InnaSprawaZakupu {
  rodzaj: PrzystanekDrogi["rodzaj"];
  id: number;
  at: string;
  /** Numer albo temat do nazwy łącza; pusty, gdy nic nie wiemy. */
  opis?: string | null;
  /** Numer reklamacji z Allegro; dyskusja go nie ma. */
  numer?: string | null;
  otwarta?: boolean;
  decyzjaDo?: string | null;
  prowadzi?: string | null;
}

/**
 * Wszystkie sprawy tego zakupu poza wskazaną, każda raz.
 *
 * `pomin` to sprawa, której kroki rysuje sam pasek (reklamacja): stoi na
 * nim jako kroki, więc przystankiem byłaby drugi raz. `null`, gdy pasek
 * nie rysuje żadnej sprawy i wszystkie zostają przystankami.
 *
 * Droga i rodzeństwo pokrywają się przy dyskusjach i reklamacjach, więc
 * sprawa z obu list staje jeden raz, ze stanem z wiersza rodzeństwa.
 * Kolejność idzie za drogą, bo ta jest już ułożona w czasie; rodzeństwo
 * spoza drogi dochodzi na końcu.
 */
export function inneSprawyZakupu(droga: PrzystanekDrogi[], sprawy: SprawaZakupu[],
  pomin: { rodzaj: PrzystanekDrogi["rodzaj"]; id: number } | null): InnaSprawaZakupu[] {
  const byly = new Set(pomin ? [`${pomin.rodzaj}-${pomin.id}`] : []);
  const stan = new Map(sprawy.map((s) => [`${rodzajSprawy(s.typ)}-${s.id}`, s]));
  const wynik: InnaSprawaZakupu[] = [];
  const dodaj = (s: InnaSprawaZakupu) => {
    const klucz = `${s.rodzaj}-${s.id}`;
    if (byly.has(klucz)) return;
    byly.add(klucz);
    const w = stan.get(klucz);
    wynik.push(w ? { ...s, opis: w.temat ?? s.opis ?? null, numer: w.numer, otwarta: w.otwarta,
      decyzjaDo: w.decyzjaDo, prowadzi: w.prowadzi } : s);
  };
  for (const p of droga) dodaj({ rodzaj: p.rodzaj, id: p.id, at: p.at, opis: p.opis });
  for (const s of sprawy) dodaj({ rodzaj: rodzajSprawy(s.typ), id: s.id, at: s.otwartoAt });
  return wynik;
}
