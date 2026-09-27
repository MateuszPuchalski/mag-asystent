import type { Zwrot } from "../api/typy";

/* ── Cztery sita DO DECYZJI (0.539.0) ───────────────────────────────────────
   Zgłoszenie właściciela: „jak sprawdzić te 645?". Kubełek mieszał zwroty
   z paczką u nas, paczki w drodze i zgłoszenia, za którymi nic nie przyszło.
   Po samym terminie tego nie widać, a każda grupa wymaga innego ruchu:
   decyzji P/O, czekania, sprawdzenia etykiety albo odmowy.

   SITO LICZY PANEL, bo lista zwrotów przyjeżdża w całości — tak samo jak
   filtr kubełka. Trasa z licznikami byłaby drugim miejscem z tą samą regułą.

   „NIE ODESŁAŁ" CZYTA SYGNAŁ SERWERA, nie własnego warunku. Serwer daje
   `nie_odeslany` i klawisz N, a sito z inną regułą pokazałoby w tej grupie
   zwrot bez odmowy pod ręką.

   „ETYKIETA BEZ SKANU" to data nadania bez żadnego wpisu przewoźnika. Serwer
   liczy taką paczkę jako doręczoną (`poczatekTerminu`), bo przewoźnik bez
   śledzenia nie da nic lepszego. Tak jednak wygląda też etykieta, której nikt
   nie nadał — zwrot 5ZRQ/2026. Sito pokazuje, ile ich jest, zanim ktokolwiek
   zmieni tę regułę.

   TO NIE JEST SITO Z 0.315.0. Tamto dzieliło po prowadzącym (Moje/Niczyje)
   i zeszło w 0.370.0, bo zwroty prowadzi całe biuro. Te dzielą po stanie
   paczki, czyli po tym, jaki ruch jest do zrobienia. */

export type SitoDecyzji = "doreczone" | "w_drodze" | "bez_skanu" | "nie_odeslal";

export const SITA_DECYZJI: Array<{ id: SitoDecyzji; etykieta: string; podpowiedz: string }> = [
  { id: "doreczone", etykieta: "doręczone",
    podpowiedz: "Przewoźnik potwierdził doręczenie do nas — decyzja P/O" },
  { id: "w_drodze", etykieta: "w drodze",
    podpowiedz: "Przewoźnik wiezie paczkę albo klient ma jeszcze czas na nadanie — czekamy" },
  { id: "bez_skanu", etykieta: "etykieta bez skanu",
    podpowiedz: "Klient wygenerował etykietę, a przewoźnik nie ma o niej ani jednego wpisu — sprawdź, czy paczka w ogóle wyszła" },
  { id: "nie_odeslal", etykieta: "nie odesłał",
    podpowiedz: "Brak etykiety, a od zgłoszenia minęło 14 dni — odmów (N)" },
];

/**
 * Do którego sita należy zwrot z DO DECYZJI.
 *
 * Kolejność warunków ma znaczenie: doręczenie wygrywa z każdym innym stanem,
 * bo paczka u nas to decyzja do podjęcia, cokolwiek przewoźnik dopisał później.
 * „W drodze" jest resztą — obejmuje też zgłoszenie bez etykiety przed upływem
 * czternastu dni, bo w obu przypadkach nie ma nic do zrobienia poza czekaniem.
 */
export function sitoDecyzji(z: Pick<Zwrot, "dostarczonoAt" | "paczkaAt" | "przesylkaStatus" | "sygnaly">): SitoDecyzji {
  if (z.dostarczonoAt) return "doreczone";
  if (z.sygnaly.includes("nie_odeslany")) return "nie_odeslal";
  if (z.paczkaAt && z.przesylkaStatus == null) return "bez_skanu";
  return "w_drodze";
}
