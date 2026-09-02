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

/* Stan POŁĄCZENIA to nie stan synchronizacji, choć oba bywają czerwone naraz.
   `niepolaczone` woła admina do parowania, `failed` — do dziennika. */
const RANGA_POLACZENIA: Record<string, Ranga> = {
  polaczone: "ok", dev: "nic", wylaczone: "uwaga",
  niepolaczone: "zle", zle_srodowisko: "zle",
};

/** Panel „Stan integracji" z §21 — trzynaście rzeczy, które ma raportować health. */
export function StanIntegracji({ zdrowie, odczyt }: { zdrowie: Zdrowie | undefined; odczyt: number | null }) {
  if (!zdrowie) return null;
  const i = zdrowie.allegroInbox;
  const o = zdrowie.obsluga;

  const wiersze: Array<[string, string, Ranga]> = [
    /* DWA OSOBNE WIERSZE, i to jest poprawka z 0.152.0. Do niej etykieta
       „Połączenie Allegro" niosła `allegroInbox.status`, czyli stan
       SYNCHRONIZACJI — ekran nazywał rzecz, której nie pokazywał. Niesparowane
       konto wyglądało wtedy jak awaria synchronizacji i właściciel szukał
       przyczyny w dzienniku usługi zamiast na ekranie. */
    ["Połączenie Allegro", zdrowie.allegro?.stan ?? "nieznany",
      RANGA_POLACZENIA[zdrowie.allegro?.stan ?? ""] ?? "nic"],
    ["Synchronizacja", i.status, RANGA_STATUSU[i.status] ?? "nic"],
    ["Ostatnia próba", i.ostatniaProba
      ? `${czas(i.ostatniaProba)}${i.kodOstatniegoBledu ? ` · ${i.kodOstatniegoBledu}` : ""}`
      : "nie było", i.kodOstatniegoBledu ? "zle" : "nic"],
    /* Zdanie o powodzie dochodzi TYLKO wtedy, gdy jest. Pusty wiersz „Ostatni
       błąd: —" przy zdrowej skrzynce byłby szumem na stałe. */
    ...(i.tekstOstatniegoBledu
      ? [["Ostatni błąd", i.tekstOstatniegoBledu, "zle"] as [string, string, Ranga]]
      : []),
    ["Ostatni sukces", czas(i.ostatniaUdanaSynchronizacja), i.ostatniaUdanaSynchronizacja ? "nic" : "uwaga"],
    ["Wiek lokalnych danych", wiek(i.opoznienieMs), i.alarm ? "uwaga" : "nic"],
    ["Następna próba", czas(i.nastepnaProba), "nic"],
    ["Wątki z błędem", String(i.watkiZBledem), i.watkiZBledem ? "uwaga" : "nic"],
    ["Rozmowy oczekujące", String(o.rozmowyOczekujace), "nic"],
    ["Zadania terenowe", o.najstarszeZadanieMs != null
      ? `${o.zadaniaTerenowe} · najstarsze ${wiek(o.najstarszeZadanieMs)}`
      : String(o.zadaniaTerenowe), "nic"],
    /* Nieudana wysyłka znaczy, że odpowiedź NIE poszła do klienta, a niepewna —
       że nie wiadomo, czy poszła. Zasada 10 projektu każe to pokazać, więc
       wiersz zmienia rangę, zamiast stać zawsze na szaro. */
    ["Kolejka wysyłek", o.kolejkaWysylek, o.wysylkiDoSprawdzenia ? "uwaga" : "nic"],
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
