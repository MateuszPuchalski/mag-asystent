import React from "react";
import { Pin } from "lucide-react";
import type { WpisOsi } from "../api/typy";
import { LoginKlienta, czas } from "../ui";

/**
 * Pytanie klienta przypięte nad edytorem (0.260.0).
 *
 * ── DLACZEGO W OGÓLE ISTNIEJE ──────────────────────────────────────────────
 * Rozmowa jest kolumną, w której przewija się TYLKO oś: nagłówek, pasek
 * zdarzeń i edytor są `shrink-0`. Pytanie klienta mieszka więc w części
 * ruchomej, a pole do pisania stoi nieruchomo pod nią. Przy dłuższym wątku,
 * przy rozepchniętym edytorze (karta szkicu Copilota, lista załączników) albo
 * po przewinięciu w górę agent pisze odpowiedź, nie widząc zdania, na które
 * odpowiada. Dekalog ergonomii, punkt 5: mniej pamiętania.
 *
 * ── DLACZEGO WARUNKOWO, A NIE NA STAŁE ─────────────────────────────────────
 * Pasek widoczny zawsze dublowałby to samo zdanie dwa razy na jednym ekranie,
 * bo przy krótkiej rozmowie pytanie i tak stoi tuż nad edytorem. Pokazujemy go
 * WYŁĄCZNIE wtedy, gdy tamta wypowiedź wypadła z kadru — i przez to samo jego
 * pojawienie się niesie treść: „odjechałeś od pytania". Pasek stojący zawsze
 * nie mówiłby nic.
 *
 * Sprzężenia zwrotnego tu nie ma, choć wygląda na możliwe: pasek zabiera
 * wysokość osi, więc może wypchnąć z kadru wypowiedź, która ledwo w nim
 * stała. To pcha w JEDNĄ stronę — raz pokazany pasek zostaje, a nie miga.
 * Odwrotny kierunek (pasek znika, oś rośnie) też tylko utwierdza wynik.
 *
 * ── DLACZEGO OSTATNIE PYTANIE, A NIE OSTATNI WPIS ──────────────────────────
 * Dół osi bywa naszą autoodpowiedzią, notatką kolegi albo wynikiem z hali.
 * Agent odpowiada na ostatnią wypowiedź KLIENTA i to ona ma być przypięta.
 */
export function PrzypietePytanie({ wpis, onPokaz }: {
  wpis: WpisOsi;
  onPokaz: () => void;
}) {
  /* Biel i podpis w bursztynie to ten sam kształt, co karta klienta na osi —
     pasek ma być rozpoznany jako TA wypowiedź, a nie jako nowy byt. Bursztyn
     nie zyskuje tu piątego znaczenia: na osi znaczy już „to mówi klient". */
  return <aside aria-label="Pytanie klienta"
    className="shrink-0 border-t border-slate-300 bg-os-klient px-4 py-2">
    <div className="flex items-center gap-2 text-podpis text-slate-500">
      <Pin size={12} className="shrink-0 text-slate-500" />
      {/* `min-w-0 truncate` przy loginie i `shrink-0` przy dacie: login bywa
          długi, a w kolumnie 400 px to ON ma się skrócić, nie data ani
          przycisk. Bez tego rząd rozpycha pasek i wraca poziomy pasek
          przewijania, którego ten ekran nie ma nigdzie indziej. */}
      <span className="flex min-w-0 items-center gap-1 truncate font-bold uppercase tracking-wide text-amber-700">
        <LoginKlienta login={wpis.autor} className="uppercase" /></span>
      <span className="shrink-0">{czas(wpis.at)}</span>
      {/* `py-1` przy interlinii 16 px daje 24 px wysokości, czyli próg celu
          dotyku z WCAG 2.2 AA (2.5.8). Na blacie to mysz, ale próg jest
          progiem — a to jedyny przycisk tego paska. */}
      <button type="button" onClick={onPokaz}
        className="ml-auto shrink-0 px-1 py-1 font-semibold text-slate-600 underline hover:text-slate-900">
        Pokaż w rozmowie</button>
    </div>
    {/* Dwa wiersze, nie całość: pasek jest PRZYPOMNIENIEM, a nie drugim
        miejscem do czytania. Pełne zdanie stoi na osi, o krok stąd. */}
    <p className="line-clamp-2 whitespace-pre-wrap text-tresc text-slate-700">{wpis.tresc}</p>
  </aside>;
}
