import React from "react";
import { Database, FileText, Brain } from "lucide-react";
import type { PoziomPewnosci, TwierdzenieCopilota, ZrodloTwierdzenia } from "../api/typy";

/**
 * Okno „Skąd to wiem" (0.253.0) — rachunek Copilota za tekst, który agent
 * zaraz wyśle klientowi.
 *
 * Powstało z decyzji właściciela. Do 0.252.0 model nie miał prawa użyć własnej
 * wiedzy: numer spoza faktów wywracał cały szkic, więc szkic był suchy, ale
 * sprawdzalny bez czytania czegokolwiek. Właściciel zdjął zakaz pod warunkiem
 * — „pełna swoboda, ale niech przy tym załącza źródła, sztywno oceniany poziom
 * pewności" — i to okno jest miejscem, w którym ten warunek stoi na ekranie.
 *
 * DLACZEGO OSOBNO OD SZKICU. Klient ma dostać gładki tekst, a nie tekst
 * podziurawiony przypisami; agent ma zobaczyć, na czym ten tekst stoi. To są
 * dwie różne potrzeby i jedno pole nie obsłuży obu — proza z odnośnikami jest
 * nieczytelna dla obu stron naraz.
 *
 * OTWARTE TYLKO WTEDY, GDY JEST CO SPRAWDZIĆ. Szkic w całości oparty o bazę
 * nie wymaga od agenta ani jednego ruchu — lista zwija się do jednej linii.
 * Gdy pada choć jedno zdanie z wiedzy modelu albo z opisu oferty, okno stoi
 * otwarte, bo to jest wyjątek, a plakietka należy się wyjątkowi, nie normie.
 */

/** Jak nazwać źródło agentowi. Nie skrótem — agent czyta to raz i musi zrozumieć. */
const ZRODLA: Record<ZrodloTwierdzenia, { etykieta: string; klasa: string; Ikona: typeof Database }> = {
  fakty: { etykieta: "z bazy", klasa: "border-emerald-200 bg-emerald-50 text-emerald-900", Ikona: Database },
  oferta: { etykieta: "z opisu oferty", klasa: "border-sky-200 bg-sky-50 text-sky-900", Ikona: FileText },
  model: { etykieta: "z wiedzy modelu", klasa: "border-amber-200 bg-amber-50 text-amber-900", Ikona: Brain },
};

const PEWNOSC: Record<PoziomPewnosci, string> = {
  pewne: "text-emerald-800",
  prawdopodobne: "text-slate-600",
  niepewne: "text-amber-800",
};

/** Twierdzenie, którego agent nie może wziąć na wiarę — te decydują o otwarciu okna. */
const doSprawdzenia = (t: TwierdzenieCopilota) => t.zrodlo !== "fakty";

export function ProcesCopilota({ twierdzenia }: { twierdzenia: TwierdzenieCopilota[] }) {
  const ile = twierdzenia.filter(doSprawdzenia).length;
  /* Stan startowy liczy się RAZ, przy pierwszym renderze tego szkicu — nowy
     szkic to nowy komponent, bo `key` w rodzicu wisi na czasie szkicu. Bez
     tego okno zamykałoby się agentowi pod ręką przy każdym odświeżeniu. */
  const [otwarte, setOtwarte] = React.useState(ile > 0);
  if (twierdzenia.length === 0) return null;

  return <div className="mt-2 rounded border border-slate-200 bg-white">
    <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-slate-700"
      aria-expanded={otwarte} onClick={() => setOtwarte(!otwarte)}>
      <span className="font-semibold">Skąd to wiem</span>
      <span className="text-slate-500">{twierdzenia.length} twierdzeń</span>
      {ile > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
        {ile} do sprawdzenia</span>}
      <span className="ml-auto text-slate-400">{otwarte ? "zwiń" : "rozwiń"}</span>
    </button>
    <ul className="border-t border-slate-100 p-2 text-xs" aria-label="Twierdzenia szkicu ze źródłem" hidden={!otwarte}>
      {twierdzenia.map((t, i) => {
        const z = ZRODLA[t.zrodlo];
        return <li key={i} className="mb-1.5 last:mb-0">
          <span className={`mr-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${z.klasa}`}>
            <z.Ikona size={11} aria-hidden />{z.etykieta}{t.odwolanie ? ` ${t.odwolanie}` : ""}
          </span>
          <span className="text-slate-800">{t.teza}</span>
          <span className={`ml-1.5 ${PEWNOSC[t.pewnosc]}`}>· {t.pewnosc}</span>
          {/* Obniżenie mówi agentowi coś o MODELU, nie o części: model uznał
              to zdanie za mocniejsze, niż pozwala jego źródło. */}
          {t.obnizona && <span className="ml-1 text-slate-400">(pewność obniżona przez serwer)</span>}
        </li>;
      })}
    </ul>
  </div>;
}
