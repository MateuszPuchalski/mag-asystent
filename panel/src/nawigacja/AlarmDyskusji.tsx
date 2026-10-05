import { AlarmClock } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useZdrowie } from "../api/rozmowy";
import { ile, odmien } from "../ui";

/* ── PASEK ALARMU: DYSKUSJA BEZ ODPOWIEDZI ──────────────────────────────
   Allegro zablokowało konto za dyskusję, która stała w kolejce „Do
   odpowiedzi" i której nikt nie otworzył. Kolejka pokazuje, że sprawa jest,
   ale nie woła. Ten pasek woła z każdego ekranu poza reklamacjami, bo nikt
   nie siedzi cały dzień na jednej zakładce.

   REKLAMACJE GO NIE MAJĄ, decyzją właściciela przy przebudowie tego ekranu.
   Pasek pełnej szerokości zabierał rząd ekranowi, na którym liczy się każdy
   piksel trzech kolumn. Alarm nie znika jednak z oczu: niesie go czerwony
   licznik na zakładce „Dyskusje", widoczny także z reklamacji. Warunek stoi
   TUTAJ, a nie w ramie, bo tylko tu da się go sprawdzić testem.

   ŹRÓDŁO. Blok `dyskusje` z `/api/health`, który panel i tak odpytuje co
   30 sekund. Próg liczy serwer (`DYSKUSJE_ALARM_GODZIN`), więc pasek, licznik
   zakładki, wiersz w kolejce i zdanie w stanie systemu mówią jedną liczbą.
   Pasek nie ma przycisku „zamknij": znika dopiero, gdy dyskusja dostanie
   odpowiedź. Alarm, który można odrzucić, przestaje być alarmem.

   ZERO ZAPISU. Pasek i licznik tylko czytają, a link prowadzi do kolejki. */

/** Ekrany bez paska: sama kolejka reklamacji i każda jej sprawa. */
const BEZ_PASKA = /^\/obsluga\/reklamacje(?:\/|$)/;

/** „2 dyskusje czekają" — ta sama odmiana w pasku i w liczniku. */
const ileCzeka = (n: number) =>
  `${ile(n, "dyskusja", "dyskusje", "dyskusji")} ${odmien(n, "czeka", "czekają", "czeka")}`;

export function PasekAlarmuDyskusji() {
  const alarm = useZdrowie().data?.dyskusje?.alarm;
  const { pathname } = useLocation();
  if (!alarm || BEZ_PASKA.test(pathname)) return null;
  return <section role="alert" aria-label="Dyskusje bez odpowiedzi"
    className="flex items-start gap-3 border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-950">
    <AlarmClock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
    <p className="min-w-0 flex-1">
      <b>{ileCzeka(alarm.ile)} na odpowiedź dłużej niż {alarm.progGodzin} godz.</b> · najstarsza {alarm.najstarszaGodzin} godz.
      {" "}Allegro może zablokować konto za dyskusje bez odpowiedzi.
    </p>
    <Link to="/obsluga/dyskusje"
      className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 font-semibold underline hover:bg-red-100">
      Otwórz dyskusje</Link>
  </section>;
}

/**
 * Czerwony licznik na zakładce „Dyskusje" — ten sam alarm co pasek.
 *
 * Stoi na KAŻDYM ekranie, także tam, gdzie paska nie ma. Liczba mówi, ile
 * dyskusji przekroczyło próg, a dymek i nazwa dla czytnika — od ilu godzin,
 * ile czeka najstarsza i czym to grozi. Sama liczba bez zdania byłaby
 * kolejnym licznikiem pracy, a to jest ryzyko utraty konta.
 *
 * CZERWIEŃ, NIE BURSZTYN. Bursztynowa plakietka obok liczy pracę do
 * zrobienia (`Licznik` w `main.tsx`). Ten licznik znaczy co innego, więc
 * nie może wyglądać tak samo: dwie barwy, dwa znaczenia. `bg-red-600` pod
 * białym pismem daje 4.83:1, powyżej progu 4.5:1.
 *
 * Brak danych to nie zero: bez alarmu albo ze starego serwera licznika nie ma.
 */
export function LicznikAlarmuDyskusji() {
  const alarm = useZdrowie().data?.dyskusje?.alarm;
  if (!alarm || alarm.ile <= 0) return null;
  const opis = `${ileCzeka(alarm.ile)} na odpowiedź dłużej niż ${alarm.progGodzin} godz. · `
    + `najstarsza ${alarm.najstarszaGodzin} godz. Allegro może zablokować konto.`;
  return <span className="ml-0.5 rounded-full bg-red-600 px-1.5 text-podpis font-bold text-white"
    aria-label={opis} title={opis}>{alarm.ile}</span>;
}
