/**
 * Odcięcie stopki firmowej od treści odpowiedzi (0.219.1).
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Każda odpowiedź biura kończy się blokiem: nazwa spółki, adres, NIP, KRS,
 * REGON, telefon. To siedem wierszy, w każdej wiadomości te same, i ani jeden
 * z nich nie mówi nic o sprawie klienta. Na osi rozmowy wychodzi z tego ściana
 * powtórzeń — przy trzech naszych odpowiedziach stopka zajmuje więcej miejsca
 * niż wszystko, co naprawdę napisaliśmy. Właściciel: „zwijaj też tę stopkę".
 *
 * ── CO JEST STOPKĄ, A CO NIE ──────────────────────────────────────────────
 * „Z poważaniem, Mateusz" ZOSTAJE w treści. To podpis człowieka, który
 * odpisał, a nie blok firmowy — mówi, z kim klient rozmawiał, i przy sporze
 * jest tym, czego się szuka. Cięcie zaczyna się dopiero na nazwie spółki.
 *
 * ── DLACZEGO PO NAZWIE SPÓŁKI ─────────────────────────────────────────────
 * To jest NASZ tekst, nie cudzy kształt — sami go wpisaliśmy do podpisu poczty,
 * więc rozpoznajemy własny blok, a nie zgadujemy Allegro. Adres, numery i
 * telefon zmienią się przy pierwszej przeprowadzce albo zmianie operatora;
 * nazwa spółki jest tym, co w tym bloku zmienia się najrzadziej.
 *
 * Bierzemy OSTATNIE wystąpienie: agent bywa, że wymienia firmę w zdaniu
 * („zamówienie złożone na WERTIS Sp. z o.o."), a wtedy cięcie od pierwszego
 * trafienia zjadłoby połowę odpowiedzi.
 */
const NAZWA_SPOLKI = /^\s*WERTIS\s+Sp\.\s*z\s*o\.?\s*o\.?/i;

export interface TrescIStopka {
  /** Treść bez stopki, z uciętymi pustymi wierszami na końcu. */
  tresc: string;
  /** Blok firmowy albo `null`, gdy wiadomość go nie ma. */
  stopka: string | null;
}

/**
 * Rozdziela treść wiadomości na to, co agent napisał, i na blok firmowy.
 *
 * WOŁAJ TO WYŁĄCZNIE DLA WIADOMOŚCI WYCHODZĄCYCH. Klient odpisujący z cytatem
 * naszej odpowiedzi niesie tę samą stopkę w środku swojego listu, a wtedy
 * cięcie „od nazwy spółki do końca" zabrałoby to, co dopisał pod spodem.
 * Kierunek rozstrzyga o tym pewnie, treść nie rozstrzyga wcale.
 */
export function podzielStopke(tresc: string): TrescIStopka {
  const wiersze = tresc.split("\n");
  let od = -1;
  for (let i = 0; i < wiersze.length; i++) {
    if (NAZWA_SPOLKI.test(wiersze[i]!)) od = i;
  }
  if (od < 0) return { tresc, stopka: null };

  /* Puste wiersze MIĘDZY treścią a stopką idą do stopki: zostawione w treści
     robiłyby pod ostatnim zdaniem dziurę bez powodu, bo to, co ją tłumaczyło,
     właśnie zniknęło z ekranu. */
  let koniec = od;
  while (koniec > 0 && wiersze[koniec - 1]!.trim() === "") koniec--;

  const stopka = wiersze.slice(koniec).join("\n").trim();
  return {
    tresc: wiersze.slice(0, koniec).join("\n"),
    /* Stopka pusta po przycięciu to brak stopki — inaczej ekran pokazałby
       przycisk „pokaż stopkę", pod którym nie ma nic. */
    stopka: stopka === "" ? null : stopka,
  };
}
