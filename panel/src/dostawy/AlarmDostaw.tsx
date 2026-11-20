import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertOctagon, BellRing } from "lucide-react";
import type { Wyjatek } from "../api/dostawy";
import { godzina, ile } from "../ui";
import { adresDostawy, useAlarmDostaw } from "./alarm";

/* Pas alarmu nad pracą — zasady i powody w `dostawy/alarm.ts`.
   Stoi pod paskiem braku połączenia: bez serwera lista wyjątków i tak
   jest nieaktualna, a awaria mówi o tym pierwsza. */

/** Kawałek ścieżki po `/obsluga/dostawy/` jako numer dokumentu; `null` dla `bez`. */
function dokumentZAdresu(pathname: string): number | null | undefined {
  const m = /^\/obsluga\/dostawy\/([^/]+)/.exec(pathname);
  if (!m) return undefined;
  return m[1] === "bez" ? null : Number(m[1]);
}

export function AlarmDostaw() {
  const { pathname } = useLocation();
  const nawiguj = useNavigate();
  const { nowe, potwierdz } = useAlarmDostaw((w) => nawiguj(adresDostawy(w)));

  /* Otwarta dostawa potwierdza swoje wyjątki — także te, które przyszły,
     gdy biuro już na niej siedziało. */
  const otwarty = dokumentZAdresu(pathname);
  const naOtwartej = otwarty !== undefined && nowe.some((w) => w.dokId === otwarty);
  useEffect(() => {
    if (naOtwartej) potwierdz(otwarty!);
  }, [naOtwartej, otwarty, potwierdz]);

  const [zgoda, setZgoda] = useState(() =>
    typeof Notification === "undefined" ? "denied" : Notification.permission);

  if (!nowe.length) return null;

  /* Jeden wiersz na dostawę, nie na wyjątek: decyzja zapada w dokumencie. */
  const wgDostawy = new Map<string, Wyjatek[]>();
  for (const w of nowe) {
    const k = adresDostawy(w);
    wgDostawy.set(k, [...(wgDostawy.get(k) ?? []), w]);
  }

  return <section role="alert" aria-label="Problem w dostawie"
    className="flex items-start gap-3 border-b-4 border-red-700 bg-red-600 px-5 py-3 text-white">
    <AlertOctagon size={24} className="mt-0.5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="text-naglowek font-bold">
        Hala zgłosiła {nowe.length > 1 ? ile(nowe.length, "problem", "problemy", "problemów") : "problem"} w dostawie
      </p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {[...wgDostawy].map(([adres, lista]) => <li key={adres}>
          <Link to={adres} className="font-semibold underline underline-offset-2 hover:no-underline">
            {lista[0].docNumber ?? "Towar spoza dokumentu"}
          </Link>
          {" — "}
          {lista.map((w) => [w.typLabel, w.sym ?? w.symObcy].filter(Boolean).join(" ")).join(", ")}
          {" · "}{lista[0].createdBy ?? "hala"}, {godzina(lista[0].createdAt)}
        </li>)}
      </ul>
    </div>
    {/* Zgoda na powiadomienia wymaga kliknięcia, więc pytamy z pasa,
        a nie przy otwarciu panelu. */}
    {zgoda === "default" && <button type="button"
      onClick={() => void Notification.requestPermission().then(setZgoda)}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2 py-1 text-sm font-semibold hover:bg-white/25">
      <BellRing size={14} aria-hidden="true" />Powiadomienia Windows</button>}
  </section>;
}
