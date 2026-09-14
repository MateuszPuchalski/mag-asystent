import React from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Przycisk } from "../ui";
import { ProcesCopilota } from "./ProcesCopilota";
import type { WymianaCopilota } from "../api/typy";

/**
 * DOPYTANIE COPILOTA (0.332.0) — rozmowa agenta z modelem o szkicu.
 *
 * Właściciel: „dodaj możliwość kontynuowania rozmowy z modelem, możliwość
 * dopytania, rozwiania wątpliwości".
 *
 * ODPOWIEDŹ JEST DLA AGENTA i ekran ma to mówić każdym elementem, bo to
 * jedyna rzecz, którą można tu pomylić kosztownie. Stąd trzy decyzje:
 *
 * Po pierwsze, odpowiedź NIE MA PRZYCISKU „wstaw". Szkic ma trzy („Wstaw",
 * „Zastąp", „Odrzuć"), bo szkic idzie do klienta. Tutaj przycisk wstawiania
 * byłby obejściem wszystkich sit szkicu jednym kliknięciem — a te sita są
 * jedynym powodem, dla którego tekst do klienta da się ufać. Kto chce mieć
 * z wymiany wiadomość, układa szkic od nowa; wymiana jest wtedy materiałem.
 *
 * Po drugie, kształt jest ROZMOWĄ, nie kartą. Pytanie agenta i odpowiedź
 * stoją naprzemiennie, bo druga wątpliwość zwykle wynika z pierwszej
 * odpowiedzi i agent musi widzieć, co już ustalił.
 *
 * Po trzecie, każda odpowiedź niesie swoje okno „Skąd to wiem" — ten sam
 * komponent, co przy szkicu. Odpowiedź „fakty tego nie rozstrzygają" jest
 * najcenniejsza dokładnie wtedy, gdy widać, czego zabrakło.
 *
 * Bez bursztynu: to nie jest ostrzeżenie ani zaznaczenie.
 */
export function Dopytanie(p: {
  wymiany: WymianaCopilota[];
  wylaczony: boolean;
  /** `null` gdy nic nie leci; łańcuch = zdanie o tym, co poszło nie tak. */
  blad: string | null;
  pracuje: boolean;
  onPytaj: (pytanie: string) => void;
  limitZnakow: number;
}) {
  const [tekst, setTekst] = React.useState("");
  const zaDlugie = tekst.length > p.limitZnakow;
  const gotowe = tekst.trim().length > 0 && !zaDlugie && !p.pracuje && !p.wylaczony;

  return <section className="mt-2 rounded border border-slate-200 bg-white" aria-label="Dopytanie Copilota">
    <h4 className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-700">
      <MessageCircleQuestion size={14} aria-hidden="true" />
      Dopytaj Copilota
      <span className="font-normal text-slate-500">odpowiedź czytasz Ty, nie klient</span>
    </h4>

    {p.wymiany.length > 0 && <ul className="divide-y divide-slate-100" aria-label="Wymiany z Copilotem">
      {p.wymiany.map((w) => <li key={w.id} className="p-2">
        <p className="text-xs font-semibold text-slate-700">{w.przez}: {w.pytanie}</p>
        <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">{w.odpowiedz}</pre>
        <ProcesCopilota key={`${w.id}-${w.at}`} twierdzenia={w.twierdzenia} />
      </li>)}
    </ul>}

    <div className="border-t border-slate-100 p-2">
      <label className="sr-only" htmlFor="dopytanie-tresc">Pytanie do Copilota</label>
      <textarea
        id="dopytanie-tresc"
        className="w-full resize-y rounded border border-slate-300 p-2 text-sm text-slate-800"
        rows={2}
        placeholder="np. czy ten nóż na pewno pasuje do 46 cm i skąd to wiesz?"
        value={tekst}
        disabled={p.wylaczony}
        onChange={(e) => setTekst(e.target.value)}
      />
      <div className="mt-1 flex items-center gap-2">
        {/* Licznik pokazuje się dopiero BLISKO limitu. Stale widoczny uczy
            pisać krótko zamiast pisać jasno, a limit jest tu hamulcem na
            wklejony szkic, nie zachętą do skrótów. */}
        {tekst.length > p.limitZnakow - 150 && <span
          className={zaDlugie ? "text-xs font-semibold text-red-700" : "text-xs text-slate-600"}>
          {tekst.length} / {p.limitZnakow}
        </span>}
        {p.blad && <span className="text-xs text-red-700">{p.blad}</span>}
        <Przycisk
          className="ml-auto text-xs"
          wariant="glowny"
          disabled={!gotowe}
          onClick={() => { p.onPytaj(tekst.trim()); setTekst(""); }}
        >
          {p.pracuje ? "Pytam…" : "Zapytaj"}
        </Przycisk>
      </div>
    </div>
  </section>;
}
