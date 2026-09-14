import { Bot } from "lucide-react";
import { Karta } from "../ui";
import type { WpisAutomatu } from "../api/typy";

/**
 * CO AUTOMAT DOPISAŁ DO WIEDZY — lista do prostowania (0.331.0).
 *
 * Ta karta jest drugą połową decyzji właściciela i bez niej pierwsza jest nie
 * do przyjęcia. Do 0.330.0 wiedzę rozstrzygał wyłącznie człowiek z biura,
 * a `czlowiekZBiura` pilnował tego przed zapisem. Właściciel, pytany wprost
 * i ze wskazaniem ryzyka, wybrał opróżnianie kolejki automatem. Skoro maszyna
 * zatwierdza, człowiek musi mieć gdzie zobaczyć, CO zatwierdziła.
 *
 * DLACZEGO TU, A NIE W KOLEJCE WIEDZY. W kolejce leży to, co CZEKA. Tu leży
 * to, co już WESZŁO do bazy i karmi czwarty szczebel doboru. To są dwie różne
 * pilności i jeden ekran obsłużyłby je źle: wiersz zatwierdzony wygląda jak
 * załatwiony, a właśnie ten wymaga spojrzenia.
 *
 * PUSTA LISTA NIE JEST SUKCESEM i karta tego nie udaje. Znaczy tylko, że
 * automat nic nie dopisał — bo jest wyłączony, bo kolejka była pusta albo bo
 * wszystkie wiersze milczały. Zdanie mówi to wprost zamiast rysować ptaszka.
 *
 * Bez bursztynu: to nie jest ostrzeżenie ani zaznaczenie. Wpis maszyny nie
 * jest z założenia błędny — jest z założenia NIESPRAWDZONY, a to co innego.
 */
export function WiedzaAutomat({ wpisy }: { wpisy: WpisAutomatu[] | undefined }) {
  if (!wpisy) return null;

  return <Karta className="overflow-hidden">
    <header className="flex items-center gap-2">
      <Bot size={16} aria-hidden="true" className="text-slate-600" />
      <h3 className="font-semibold text-slate-900">Co automat dopisał do wiedzy</h3>
    </header>
    <p className="mt-1 text-xs text-slate-600">
      Wpisy zatwierdzone bez człowieka. Sprawdź je i cofnij te, które nie
      trzymają się kupy — cofanie jest przy wpisie w Wiedzy.
    </p>

    {wpisy.length === 0
      ? <p className="mt-3 text-sm text-slate-700">
          Automat nic nie dopisał. To znaczy tyle, że nic nie dopisał: kolejka
          mogła być pusta, a automat mógł być wyłączony.
        </p>
      : <ul className="mt-3 divide-y divide-slate-100 text-sm" aria-label="Wpisy automatu wiedzy">
          {wpisy.map((w) => <li key={`${w.rodzaj}-${w.id}`} className="flex items-baseline gap-2 py-1.5">
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
              {w.rodzaj === "zastosowanie" ? "zastosowanie" : "pasowanie"}
            </span>
            <span className="font-medium text-slate-900">{w.symbol}</span>
            <span className="text-slate-700">{w.etykieta}</span>
            <span className="ml-auto shrink-0 text-xs text-slate-500">{w.at.slice(0, 10)}</span>
          </li>)}
        </ul>}
  </Karta>;
}
