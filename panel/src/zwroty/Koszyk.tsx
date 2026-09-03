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
  if (!kosz || kosz.pozycji === 0) return null;

  return <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg
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
      Domknięcie wystawia MM z magazynu głównego na regał zwrotów; numer wraca
      z Subiekta. Kosz jedzie wtedy na halę do rozłożenia.
    </span>
    {zamknij.error && <div className="w-full"><Blad>{(zamknij.error as Error).message}</Blad></div>}
  </div>;
}
