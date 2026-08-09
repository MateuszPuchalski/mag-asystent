import { config } from "./config.js";
import { zwin, sqlZwinSymbol } from "./tekst.js";

/* ── Pozycje dokumentu, które NIE są towarem ─────────────────────────────────
   Na fakturze zakupu bywa wiersz `PRZESYŁKA` / „koszt transportu". Z punktu
   widzenia księgowości to normalna pozycja dokumentu; z punktu widzenia
   magazyniera — nic, czego dałoby się dotknąć, zeskanować i położyć na półce.

   TO JEST WYJĄTEK OD REGUŁY, WIĘC WYMAGA UZASADNIENIA. „Rozkładanie JEST
   sprawdzaniem faktury i liczy się KAŻDĄ pozycję" — dlatego nic tu nie jest
   ukrywane warunkowo ani na ekranie. Pozycja usługowa wypada ze SNAPSHOTU,
   czyli nie istnieje dla tej pracy w ogóle: nie da się jej odłożyć, nie da się
   jej pominąć, nie wisi do końca dnia jako jedyna niezałatwiona linia i nie
   każe człowiekowi zgłaszać problemu na coś, co problemem nie jest.

   Cena jest jawna: dostawa z samą przesyłką i niczym więcej zamknie się
   natychmiast, a licznik pozycji na liście będzie o tę jedną mniejszy niż
   w Subiekcie. To jest zamierzone i dlatego licznik przed otwarciem dostawy
   (`countPositionsByDoc`) odsiewa dokładnie to samo — inaczej otwarcie dostawy
   zmniejszałoby liczbę pozycji „samo z siebie".

   ROZPOZNAJEMY PO SYMBOLU, nie po opisie. Opis jest polem swobodnym i różni się
   między dostawcami; symbol kartoteki to jedna, powtarzalna wartość, którą
   magazyn zna. Subiekt ma wprawdzie `tw_Rodzaj` z literą `U` (usługa) i to
   byłoby źródło pewniejsze — ale read-model `sgt_towar` tej kolumny nie ma,
   a dołożenie jej to zmiana importera, migracja i nowe uprawnienie SELECT.
   Lista symboli w ustawieniu załatwia zgłoszony przypadek dziś; gdyby usług
   przybyło, `tw_Rodzaj` jest właściwym następnym krokiem.

   Porównanie idzie przez `zwin` — to samo składanie, którego używa
   wyszukiwarka. Dzięki temu `PRZESYŁKA`, `przesylka` i `PRZESYŁKA-1` w polskim
   Subiekcie z ogonkami albo bez trafiają w to samo ustawienie. Strona SQL
   dostaje `sqlZwinSymbol`, czyli udowodnioną testem parę tego samego.        */

/** Symbole z ustawienia, złożone do porównywania. Puste = funkcja wyłączona. */
function wzorce(): string[] {
  const out: string[] = [];
  for (const s of config.pozycjeNieTowarowe) {
    const k = zwin(s);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Czy pozycja o tym symbolu ma wypaść z rozkładania.
 *
 * `null`/pusty symbol NIE wypada: brak symbolu znaczy „kartoteka, której nie
 * umiemy nazwać", a taką trzeba pokazać człowiekowi, nie schować.
 */
export function pomijanaPozycja(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return wzorce().includes(zwin(symbol));
}

/**
 * Warunek SQL wykluczający pozycje usługowe, albo `null` gdy nie ma czego
 * wykluczać. Zwraca też parametry — wywołujący wstawia je w swojej kolejności.
 *
 * `null` zamiast warunku zawsze prawdziwego jest tu celowe: przy pustym
 * ustawieniu zapytanie zostaje dokładnie takie, jakie było, i nie płaci ani
 * jednego podzapytania za funkcję, której nikt nie włączył.
 */
export function sqlBezPozycjiUslugowych(kolumnaTwId: string): {
  warunek: string;
  parametry: string[];
} | null {
  const w = wzorce();
  if (w.length === 0) return null;
  const luki = w.map(() => "?").join(",");
  return {
    warunek: `${kolumnaTwId} NOT IN (
      SELECT tw_id FROM sgt_towar WHERE ${sqlZwinSymbol("symbol")} IN (${luki})
    )`,
    parametry: w,
  };
}
