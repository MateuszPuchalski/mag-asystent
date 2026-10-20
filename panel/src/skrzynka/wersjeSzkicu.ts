import type { SzkicCopilota, TwierdzenieCopilota, WymianaCopilota } from "../api/typy";

/**
 * WERSJE SZKICU COPILOTA — oryginał i każda poprawka z dopytania.
 *
 * Historii nie trzyma osobna tabela. Wersją jest każda wymiana z `szkicPo`,
 * a numer liczy się z kolejności. Dzięki temu ekran i serwer nie mają dwóch
 * zapisów tej samej historii, które mogłyby się rozjechać.
 *
 * Historia należy do JEDNEGO szkicu. „Ułóż ponownie” daje nowy szkic na
 * nowych faktach, więc poprawki starego do jego historii nie wchodzą.
 */

export type WersjaSzkicu = {
  tresc: string;
  twierdzenia: TwierdzenieCopilota[];
  zastrzezenia: string[];
  at: string;
  /** „Wersja N” na ekranie. Oryginał ma 1. */
  nr: number;
} & ({ zrodlo: "szkic" } | { zrodlo: "wymiana"; wymianaId: number });

/**
 * Tekst po zwinięciu białych znaków. Tak samo liczy „bez zmian” serwer
 * (`losSzkicu`), więc ekran i pomiar nazywają tę samą rzecz tym samym słowem.
 */
export const zwin = (t: string) => t.replace(/\s+/g, " ").trim();

/* Porównanie chwil po wartości, nie po napisie. „…00Z” i „…00.000Z” to ta
   sama sekunda, a porównanie napisów ustawiłoby je w złej kolejności. */
function chwila(at: string): number {
  const t = Date.parse(at);
  return Number.isNaN(t) ? 0 : t;
}

/** Wersje od najstarszej: oryginał (jeśli jest) i poprawki tego szkicu. */
export function wersjeSzkicu(szkic: SzkicCopilota | null, wymiany: WymianaCopilota[]): WersjaSzkicu[] {
  const wynik: WersjaSzkicu[] = [];
  if (szkic) {
    wynik.push({ tresc: szkic.tresc, twierdzenia: szkic.twierdzenia, zastrzezenia: szkic.zastrzezenia,
      at: szkic.at, nr: 1, zrodlo: "szkic" });
  }
  const od = szkic ? chwila(szkic.at) : -Infinity;
  const poprawki = wymiany
    .filter((w) => typeof w.szkicPo === "string" && w.szkicPo !== "" && chwila(w.at) >= od)
    .sort((x, y) => chwila(x.at) - chwila(y.at) || x.id - y.id);
  for (const w of poprawki) {
    wynik.push({ tresc: w.szkicPo as string, twierdzenia: w.szkicTwierdzenia ?? [],
      zastrzezenia: w.szkicZastrzezenia ?? [], at: w.at, nr: wynik.length + 1,
      zrodlo: "wymiana", wymianaId: w.id });
  }
  return wynik;
}

/**
 * NAJNOWSZA wersja równa polu po zwinięciu białych znaków, albo `null`.
 *
 * Najnowsza, bo dwie wersje bywają równe, a rachunek „Skąd to wiem” ma
 * przyjść od tej, którą agent ostatnio dostał. Puste pole nie jest żadną
 * wersją.
 */
export function wersjaWPolu(wersje: WersjaSzkicu[], pole: string): WersjaSzkicu | null {
  if (pole.trim() === "") return null;
  const z = zwin(pole);
  for (let i = wersje.length - 1; i >= 0; i--) if (zwin(wersje[i].tresc) === z) return wersje[i];
  return null;
}

/** Wersja, z której wyrosła dana wymiana: ostatnia znana przed nią. */
function poprzedniaWersja(wersje: WersjaSzkicu[], w: WymianaCopilota): WersjaSzkicu | null {
  const t = chwila(w.at);
  let wynik: WersjaSzkicu | null = null;
  for (const v of wersje) {
    if (v.zrodlo === "wymiana" && v.wymianaId === w.id) continue;
    if (chwila(v.at) <= t) wynik = v;
  }
  return wynik;
}

/**
 * LUKA RĘCZNA: agent zmienił tekst między wersją Copilota a poleceniem.
 *
 * Model poprawia tekst z pola, a nie ostatnią swoją wersję. Różnica tej
 * poprawki pokazuje więc tylko zmiany modelu. Ręczne zmiany agenta stałyby
 * się niewidoczne, choć to on za nie odpowiada przed klientem. Stąd osobne
 * „Twoje zmiany przed poprawką”, liczone od poprzedniej znanej wersji.
 */
export function lukaReczna(wersje: WersjaSzkicu[], w: WymianaCopilota):
  { poprzednia: WersjaSzkicu; przed: string } | null {
  if (typeof w.szkicPrzed !== "string") return null;
  const poprzednia = poprzedniaWersja(wersje, w);
  if (!poprzednia || zwin(poprzednia.tresc) === zwin(w.szkicPrzed)) return null;
  return { poprzednia, przed: w.szkicPrzed };
}
