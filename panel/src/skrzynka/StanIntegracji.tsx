import React from "react";
import type { Zdrowie } from "../api/typy";
import { czas } from "../ui";
import { KartaWgladu } from "../ui/wglad";
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

/** Panel „Stan integracji" z §21 — to, co raportuje health, bez faktów,
 *  które na tym samym ekranie niesie już inna karta (niżej). */
export function StanIntegracji({ zdrowie, odczyt }: { zdrowie: Zdrowie | undefined; odczyt: number | null }) {
  if (!zdrowie) return null;
  const i = zdrowie.allegroInbox;
  const o = zdrowie.obsluga;

  const wiersze: Array<[string, string, Ranga]> = [
    /* POŁĄCZENIE TO NIE SYNCHRONIZACJA — poprawka z 0.152.0. Do niej etykieta
       „Połączenie Allegro" niosła `allegroInbox.status`, czyli stan
       SYNCHRONIZACJI. Niesparowane konto wyglądało jak awaria synchronizacji
       i właściciel szukał przyczyny w dzienniku usługi zamiast na ekranie.

       Wiersz o połączeniu zszedł stąd (0.509.0), bo ten sam fakt, ze słowem
       zamiast kodu i z przyciskiem „Połącz", niesie karta „Konto Allegro" tuż
       nad tą. Rozdział z 0.152.0 zostaje: ta tabela mówi o synchronizacji. */
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
    /* Wiersz „Subiekt GT" zszedł (0.509.0): to, czy worker żyje, mówi karta
       „Serwer" na tym samym ekranie, i mówi więcej — kiedy go widziano i że
       bez niego zapisy do Subiekta nie wchodzą. */
  ];

  /* Rama kart wglądu (0.509.0), jak każda karta obok. Własny nagłówek miał
     inny krój i nazwę trasy „/api/health" — głos programisty, nie biura.
     Zostaje godzina odczytu, bo mówi, jak świeże są te wiersze. */
  return <KartaWgladu id="karta-integracje" tytul="Stan integracji"
    akcje={<span className="text-xs text-slate-600">odczyt {czas(
      odczyt ? new Date(odczyt).toISOString() : null)}</span>}>
    <dl className="-my-2 divide-y text-sm">
      {wiersze.map(([nazwa, wartosc, ranga]) => <div key={nazwa} className="flex gap-3 py-2">
        <dt className="mr-auto text-slate-600">{nazwa}</dt>
        <dd className={`font-bold ${BARWA[ranga]}`}>{wartosc}</dd>
      </div>)}
    </dl>
  </KartaWgladu>;
}
