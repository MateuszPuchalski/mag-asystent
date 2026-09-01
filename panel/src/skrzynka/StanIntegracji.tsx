import React from "react";
import type { Zdrowie } from "../api/typy";
import { Karta, czas } from "../ui";
import { wiek } from "./AlarmSynchronizacji";

type Ranga = "zle" | "uwaga" | "ok" | "nic";
const BARWA: Record<Ranga, string> = {
  zle: "text-ranga-zle", uwaga: "text-ranga-uwaga", ok: "text-ranga-ok", nic: "text-ranga-nic",
};

/* Ranga statusu, nie jego barwa: „czerwony" przestałby znaczyć cokolwiek
   przy zmianie palety, a `authentication_error` zawsze woła admina. */
const RANGA_STATUSU: Record<string, Ranga> = {
  current: "ok", delayed: "uwaga", rate_limited: "zle",
  authentication_error: "zle", failed: "zle",
};

/** Panel „Stan integracji" z §21 — trzynaście rzeczy, które ma raportować health. */
export function StanIntegracji({ zdrowie, odczyt }: { zdrowie: Zdrowie | undefined; odczyt: number | null }) {
  if (!zdrowie) return null;
  const i = zdrowie.allegroInbox;
  const o = zdrowie.obsluga;

  const wiersze: Array<[string, string, Ranga]> = [
    ["Połączenie Allegro", i.status, RANGA_STATUSU[i.status] ?? "nic"],
    ["Ostatnia próba", i.ostatniaProba
      ? `${czas(i.ostatniaProba)}${i.kodOstatniegoBledu ? ` · ${i.kodOstatniegoBledu}` : ""}`
      : "nie było", i.kodOstatniegoBledu ? "zle" : "nic"],
    ["Ostatni sukces", czas(i.ostatniaUdanaSynchronizacja), i.ostatniaUdanaSynchronizacja ? "nic" : "uwaga"],
    ["Wiek lokalnych danych", wiek(i.opoznienieMs), i.alarm ? "uwaga" : "nic"],
    ["Następna próba", czas(i.nastepnaProba), "nic"],
    ["Wątki z błędem", String(i.watkiZBledem), i.watkiZBledem ? "uwaga" : "nic"],
    ["Rozmowy oczekujące", String(o.rozmowyOczekujace), "nic"],
    ["Zadania terenowe", o.najstarszeZadanieMs != null
      ? `${o.zadaniaTerenowe} · najstarsze ${wiek(o.najstarszeZadanieMs)}`
      : String(o.zadaniaTerenowe), "nic"],
    ["Kolejka wysyłek", o.kolejkaWysylek, "nic"],
    ["Subiekt GT", zdrowie.worker?.zyje ? `tryb ${zdrowie.worker.mode}` : "worker milczy",
      zdrowie.worker?.zyje ? "ok" : "uwaga"],
  ];

  return <Karta className="overflow-hidden">
    <header className="flex items-baseline gap-2 border-b p-4">
      <b className="mr-auto">Stan integracji</b>
      <span className="text-xs text-slate-400">/api/health · odczyt {czas(
        odczyt ? new Date(odczyt).toISOString() : null)}</span>
    </header>
    <dl className="divide-y text-sm">
      {wiersze.map(([nazwa, wartosc, ranga]) => <div key={nazwa} className="flex gap-3 px-4 py-2">
        <dt className="mr-auto text-slate-500">{nazwa}</dt>
        <dd className={`font-bold ${BARWA[ranga]}`}>{wartosc}</dd>
      </div>)}
    </dl>
  </Karta>;
}
