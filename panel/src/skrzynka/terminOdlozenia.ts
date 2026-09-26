/* ── TERMINY ODŁOŻENIA (@wydanie) ────────────────────────────────────────────
   Trzy gotowe terminy zamiast kalendarza, bo prawie każde odłożenie to jedno
   z trzech: „jutro rano", „za dwa dni" (dostawca odpowiada), „za tydzień"
   (towar w drodze). Kalendarz zostaje na resztę — jako czwarta droga, nie
   pierwsza (dekalog p. 1: wybór zamiast wpisywania).

   GODZINA 8:00, NIE „ZA 24 GODZINY". Odłożona o 15:40 na „jutro" wracałaby
   jutro o 15:40, czyli w środku dnia i bez sensu dla nikogo. Wraca na
   początek pracy biura, a że kolejka układa się po czasie oczekiwania, stoi
   wtedy wysoko — tam, gdzie agent zaczyna dzień.

   DNI ROBOCZE, NIE KALENDARZOWE. „Jutro" w piątek to poniedziałek: odłożona
   na sobotę wróciłaby do pustego biura i przeleżała weekend jako najstarsza.
   Świąt nie liczymy — to kalendarz, którego panel nie ma, a błąd jest
   bezpieczny: rozmowa wróci o dzień za wcześnie, nie za późno. */

import { termin } from "../ui";

const GODZINA_POWROTU = 8;

const weekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Początek pracy `ile` dni roboczych po `od` (czas lokalny przeglądarki). */
export function poDniachRoboczych(od: Date, ile: number): Date {
  const d = new Date(od);
  d.setHours(GODZINA_POWROTU, 0, 0, 0);
  let zostalo = ile;
  while (zostalo > 0) {
    d.setDate(d.getDate() + 1);
    if (!weekend(d)) zostalo--;
  }
  return d;
}

/** Ten sam dzień tygodnia za tydzień, 8:00 — bez przesuwania z weekendu. */
export function zaTydzien(od: Date): Date {
  const d = new Date(od);
  d.setHours(GODZINA_POWROTU, 0, 0, 0);
  d.setDate(d.getDate() + 7);
  return poWeekendzie(d);
}

/** Data z kalendarza (`RRRR-MM-DD`) na 8:00 tego dnia; `null`, gdy to nie data. */
export function dzienZKalendarza(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), GODZINA_POWROTU, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function poWeekendzie(d: Date): Date {
  while (weekend(d)) d.setDate(d.getDate() + 1);
  return d;
}

/** Opis terminu dla ekranu — format mieszka w `ui` (`termin`), jak każdy format daty. */
export const opisTerminu = (d: Date): string => termin(d);

export interface TerminOdlozenia { etykieta: string; kiedy: Date }

/** Gotowe terminy dla menu — w kolejności od najczęstszego. */
export function terminyOdlozenia(teraz = new Date()): TerminOdlozenia[] {
  return [
    { etykieta: "Następny dzień roboczy", kiedy: poDniachRoboczych(teraz, 1) },
    { etykieta: "Za 2 dni robocze", kiedy: poDniachRoboczych(teraz, 2) },
    { etykieta: "Za tydzień", kiedy: zaTydzien(teraz) },
  ];
}
