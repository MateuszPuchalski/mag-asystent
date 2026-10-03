import { AlarmClock } from "lucide-react";
import { Link } from "react-router-dom";
import { useZdrowie } from "../api/rozmowy";
import { ile, odmien } from "../ui";

/* ── PASEK ALARMU: DYSKUSJA BEZ ODPOWIEDZI ──────────────────────────────
   Allegro zablokowało konto za dyskusję, która stała w kolejce „Do
   odpowiedzi" i której nikt nie otworzył. Kolejka pokazuje, że sprawa jest,
   ale nie woła. Ten pasek woła z każdego ekranu, bo nikt nie siedzi cały
   dzień na jednej zakładce.

   ŹRÓDŁO. Blok `dyskusje` z `/api/health`, który panel i tak odpytuje co
   30 sekund. Próg liczy serwer (`DYSKUSJE_ALARM_GODZIN`), więc pasek, wiersz
   w kolejce i zdanie w stanie systemu mówią jedną liczbą. Pasek nie ma
   przycisku „zamknij": znika dopiero, gdy dyskusja dostanie odpowiedź. Alarm,
   który można odrzucić, przestaje być alarmem.

   ZERO ZAPISU. Pasek tylko czyta, a link prowadzi do kolejki. */

export function PasekAlarmuDyskusji() {
  const alarm = useZdrowie().data?.dyskusje?.alarm;
  if (!alarm) return null;
  const ileCzeka = `${ile(alarm.ile, "dyskusja", "dyskusje", "dyskusji")} ${odmien(alarm.ile, "czeka", "czekają", "czeka")}`;
  return <section role="alert" aria-label="Dyskusje bez odpowiedzi"
    className="flex items-start gap-3 border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-950">
    <AlarmClock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
    <p className="min-w-0 flex-1">
      <b>{ileCzeka} na odpowiedź dłużej niż {alarm.progGodzin} godz.</b> · najstarsza {alarm.najstarszaGodzin} godz.
      {" "}Allegro może zablokować konto za dyskusje bez odpowiedzi.
    </p>
    <Link to="/obsluga/dyskusje"
      className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 font-semibold underline hover:bg-red-100">
      Otwórz dyskusje</Link>
  </section>;
}
