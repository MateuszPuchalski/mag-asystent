import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BellRing, PackageX } from "lucide-react";
import { adresZwrotu, useAlarmInnyTowar } from "./powodInnyTowar";

/* Pas alarmu „inny towar" — zasady i powody w `zwroty/powodInnyTowar.ts`.
   Pas bez przycisku zamknięcia: alarm zdejmowany odruchem znika, zanim ktoś
   go przeczyta. Cichnie po otwarciu zwrotu na tym komputerze. */

/** Numer zwrotu z adresu `/obsluga/zwroty/<id>`; reszta ścieżek to nie zwrot. */
function zwrotZAdresu(pathname: string): number | null {
  const m = /^\/obsluga\/zwroty\/(\d+)$/.exec(pathname);
  return m ? Number(m[1]) : null;
}

export function AlarmInnyTowar() {
  const { pathname } = useLocation();
  const nawiguj = useNavigate();
  const { nowe, potwierdz } = useAlarmInnyTowar((z) => nawiguj(adresZwrotu(z)));

  const otwarty = zwrotZAdresu(pathname);
  const naOtwartym = otwarty !== null && nowe.some((z) => z.id === otwarty);
  useEffect(() => {
    if (naOtwartym) potwierdz(otwarty!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naOtwartym, otwarty]);

  const [zgoda, setZgoda] = useState(() =>
    typeof Notification === "undefined" ? "denied" : Notification.permission);

  if (!nowe.length) return null;

  return <section role="alert" aria-label="Zwrot: inny towar"
    className="flex items-start gap-3 border-b-4 border-red-700 bg-red-600 px-5 py-3 text-white">
    <PackageX size={24} className="mt-0.5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="text-naglowek font-bold">
        {nowe.length > 1
          ? `Klienci wskazali „inny towar” w zwrotach (${nowe.length})`
          : "Klient wskazał w zwrocie „inny towar”"}
      </p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {nowe.map((z) => <li key={z.id}>
          <Link to={adresZwrotu(z)} className="font-semibold underline underline-offset-2 hover:no-underline">
            {z.numer ?? `Zwrot ${z.id}`}
          </Link>
          {" — "}{z.pozycje.join(", ")}
          {z.komentarz && <span className="break-words"> · „{z.komentarz}”</span>}
        </li>)}
      </ul>
    </div>
    {zgoda === "default" && <button type="button"
      onClick={() => void Notification.requestPermission().then(setZgoda)}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2 py-1 text-sm font-semibold hover:bg-white/25">
      <BellRing size={14} aria-hidden="true" />Powiadomienia Windows</button>}
  </section>;
}
