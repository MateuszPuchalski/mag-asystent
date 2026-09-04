import React from "react";
import { PackageOpen } from "lucide-react";
import { useKosz, useZamknijKosz } from "../api/zwroty";
import { Przycisk, Blad } from "../ui";

/* ── Pasek otwartego koszyka zwrotów (0.192.0) ──────────────────────────────
   Właściciel opisał obieg, który biuro robi od lat ręką: „gdy agent zasiada do
   zwrotów, to otwiera pustą MM i dodaje kolejno przedmioty ze zwrotów; gdy
   koszyk się zapełni, zamyka MM i tak w kółko".

   Ten pasek jest tą pustą MM. Nie ma na nim przycisku „dodaj" i to jest
   decyzja: dokłada ocena „na stan", którą operator i tak naciska przy towarze.
   Osobny przycisk kazałby powiedzieć dwa razy to samo (dekalog, punkt 5).

   Pasek POKAZUJE SIĘ DOPIERO Z ZAWARTOŚCIĄ. Pusty byłby stałym elementem
   mówiącym „zero" — punkt 2 dekalogu każe pokazywać to, co potrzebne teraz,
   a pusty kosz nie jest niczyją pracą.

   Stoi na górze, obok paska kartotek, bo dotyczy CAŁEJ SESJI pracy, a nie
   otwartego zwrotu. Wewnątrz karty zwrotu znikałby przy każdym przejściu do
   następnej paczki — a licznik ma rosnąć na oczach.                          */

export function Koszyk() {
  const { data } = useKosz();
  const zamknij = useZamknijKosz();
  const kosz = data?.kosz ?? null;
  const czekajace = data?.czekajace ?? [];
  if ((!kosz || kosz.pozycji === 0) && czekajace.length === 0) return null;

  return <>
    {/* Koszyki zamknięte, którym brakuje korekt. Stoją NAD otwartym, bo to
        praca zaległa: kosz jest już na hali, a dokumentu wciąż nie ma. */}
    {czekajace.map((c) => <div key={c.id}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg
        border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <PackageOpen size={14} className="shrink-0" />
      <b>Koszyk {c.kod}</b>
      <span className="min-w-0 flex-1">
        czeka na {c.brakuje.length === 1 ? "korektę" : "korekty"}: {
          c.brakuje.map((b) => b.numer).join(", ")}
      </span>
      {/* DLACZEGO czeka — bez tego zdania wygląda to na zaciętą kolejkę. */}
      <span className="w-full text-amber-700">
        MM zdejmuje towar z magazynu głównego, a ze zwrotu wraca on tam dopiero
        po korekcie. Dokument wyjdzie sam, gdy dojdzie ostatni numer.
      </span>
    </div>)}
    {kosz && kosz.pozycji > 0 && <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg
      border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
    <PackageOpen size={14} className="shrink-0" />
    <b>Koszyk {kosz.kod}</b>
    <span className="tabular-nums">
      {kosz.pozycji} poz. · {kosz.sztuk} szt.</span>
    {/* Symbole, nie nazwy: przy koszu liczy się to, co stoi na opakowaniu
        i na dokumencie MM. Nazwy nie zmieściłyby się w jednym pasku. */}
    <span className="min-w-0 flex-1 truncate text-sky-700"
      title={kosz.pozycje.map((p) => `${p.symbol} × ${p.ilosc}`).join(", ")}>
      {kosz.pozycje.map((p) => p.symbol).join(", ")}</span>
    <Przycisk className="text-xs" disabled={zamknij.isPending}
      onClick={() => zamknij.mutate(kosz.id)}>
      {zamknij.isPending ? "Zamykam…" : "Zamknij koszyk"}
    </Przycisk>
    {/* Co się stanie po kliknięciu — wprost, bo powstaje dokument w Subiekcie.
        Ta sama zasada co przy korekcie: ekran mówi, czego NIE robi i co robi
        za człowieka. */}
    <span className="w-full text-sky-700">
      Kosz jedzie na halę od razu. MM z magazynu głównego na regał zwrotów
      wychodzi, gdy wszystkie zwroty z tego kosza mają numer korekty.
    </span>
    {zamknij.error && <div className="w-full"><Blad>{(zamknij.error as Error).message}</Blad></div>}
    </div>}
  </>;
}
