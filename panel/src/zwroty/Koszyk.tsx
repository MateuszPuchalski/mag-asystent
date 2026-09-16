import React from "react";
import { PackageOpen, X } from "lucide-react";
import { useKosz, useZamknijKosz, useZdejmijTowar } from "../api/zwroty";
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
  /* Zdejmowanie dotyczy WYŁĄCZNIE wierszy dołożonych ręką (0.365.0). Wiersz
     z oceny schodzi cofnięciem oceny na karcie zwrotu — jedna droga na oba
     kosztowałaby kasowanie cudzej oceny z drugiej strony ekranu. */
  const zdejmij = useZdejmijTowar();
  /* DWA KOSZYKI OD 0.211.0: zwroty i odpad. Pusty się nie pokazuje — pasek
     rośnie wtedy, kiedy operator naprawdę coś w nim ma. */
  const kosze = (data?.kosze ?? []).filter((k) => k.pozycji > 0);
  const czekajace = data?.czekajace ?? [];
  if (kosze.length === 0 && czekajace.length === 0) return null;

  const nazwa = (rodzaj: "zwroty" | "odpad") =>
    rodzaj === "odpad" ? "Koszyk odpadu" : "Koszyk zwrotów";

  return <>
    {/* Koszyki zamknięte, którym brakuje korekt. Stoją NAD otwartym, bo to
        praca zaległa: kosz jest już na hali, a dokumentu wciąż nie ma. */}
    {czekajace.map((c) => <div key={c.id}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg
        border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <PackageOpen size={14} className="shrink-0" />
      <b>{nazwa(c.rodzaj)} {c.kod}</b>
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
    {kosze.map((kosz) => <div key={kosz.id}
      /* Odpad w innym kolorze niż zwroty: to dwa różne końce hali, a pasek
         czyta się kątem oka. */
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2
        text-xs ${kosz.rodzaj === "odpad"
          ? "border border-stone-300 bg-stone-100 text-stone-800"
          : "border border-sky-200 bg-sky-50 text-sky-900"}`}>
    <PackageOpen size={14} className="shrink-0" />
    <b>{nazwa(kosz.rodzaj)} {kosz.kod}</b>
    <span className="tabular-nums">
      {kosz.pozycji} poz. · {kosz.sztuk} szt.</span>
    {/* Symbole, nie nazwy: przy koszu liczy się to, co stoi na opakowaniu
        i na dokumencie MM. Nazwy nie zmieściłyby się w jednym pasku.

        Ta linijka pokazuje CAŁĄ zawartość i tak zostaje. Wiersze dołożone
        ręką wracają niżej drugi raz — z krzyżykiem, bo tylko one dają się tu
        zdjąć (0.365.0). Powtórzenie symbolu jest ceną za to, że jedna linijka
        dalej odpowiada na pytanie „co leży w pudle". */}
    <span className={`min-w-0 flex-1 truncate ${
      kosz.rodzaj === "odpad" ? "text-stone-600" : "text-sky-700"}`}
      title={kosz.pozycje.map((p) => `${p.symbol} × ${p.ilosc}`).join(", ")}>
      {kosz.pozycje.map((p) => p.symbol).join(", ")}</span>
    <Przycisk className="text-xs" disabled={zamknij.isPending}
      onClick={() => zamknij.mutate(kosz.id)}>
      {zamknij.isPending ? "Zamykam…" : "Zamknij koszyk"}
    </Przycisk>
    {/* Co się stanie po kliknięciu — wprost, bo powstaje dokument w Subiekcie.
        Ta sama zasada co przy korekcie: ekran mówi, czego NIE robi i co robi
        za człowieka. */}
    <span className={`w-full ${kosz.rodzaj === "odpad" ? "text-stone-600" : "text-sky-700"}`}>
      {/* KOSZYK WIRTUALNY (0.350.0): zamknięcie kończy jego życie. Na hali
          rozkłada się kosz z dokumentu MM, a nie ten koszyk — zdanie mówi
          to wprost, bo inaczej etykieta „Z-" trafiałaby na regał. */}
      Zamknięcie kończy koszyk. MM z magazynu głównego {kosz.rodzaj === "odpad"
        ? "na magazyn odpadu" : "na regał zwrotów"} wychodzi, gdy wszystkie
      zwroty z tego koszyka mają numer korekty — na hali rozkłada się kosz
      z numerem tego MM.
    </span>
    {/* DOŁOŻONE RĘKĄ — osobno i z krzyżykiem (0.365.0). Osobno, bo tylko one
        dają się tu zdjąć; krzyżyk, bo skan bywa pomyłką, a wiersz bez zwrotu
        nie ma oceny do cofnięcia. Przy koszyku bez takich wierszy nie ma tu
        niczego: pusta etykieta „dołożone" byłaby napisem o braku. */}
    {kosz.pozycje.some((p) => !p.zeZwrotu) && <span className="flex w-full flex-wrap items-center gap-1">
      <span className={kosz.rodzaj === "odpad" ? "text-stone-600" : "text-sky-700"}>
        dołożone ręką:</span>
      {kosz.pozycje.filter((p) => !p.zeZwrotu).map((p) => <span key={p.id}
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1">
        <span className="font-mono">{p.symbol}</span>
        <span className="tabular-nums text-slate-500">×{p.ilosc}</span>
        <button type="button" disabled={zdejmij.isPending}
          onClick={() => zdejmij.mutate(p.id)}
          aria-label={`Zdejmij ${p.symbol} z koszyka`}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={12} /></button>
      </span>)}
    </span>}
    {zamknij.error && <div className="w-full"><Blad>{(zamknij.error as Error).message}</Blad></div>}
    {zdejmij.error && <div className="w-full"><Blad>{(zdejmij.error as Error).message}</Blad></div>}
    </div>)}
  </>;
}
