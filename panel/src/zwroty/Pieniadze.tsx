import React, { useState } from "react";
import { Banknote, Ban, Check } from "lucide-react";
import type { StanZwrotuPieniedzy } from "../api/typy";
import { Przycisk } from "../ui";
import { zlote } from "../api/zwroty";

/* ── Oddanie pieniędzy i odmowa (§25a, 0.190.0) ──────────────────────────────

   OSTATNI KROK, KTÓRY DOTĄD ROBIŁO SIĘ POZA PANELEM. Operator rozstrzygał
   zwrot tutaj, dostawał policzoną kwotę tutaj — i szedł oddać pieniądze do
   panelu Allegro. Kryterium gotowości z §25 mówi „bez otwierania panelu
   Allegro"; przy zwrocie nie było spełnione ani razu.

   PRZESZKODA JEST ZDANIEM, NIE WYŁĄCZONYM PRZYCISKIEM. Wyłączony przycisk bez
   powodu każe zgadywać, czego brakuje: werdyktu, kwoty, zamówienia czy formy
   płatności. Zdanie pisze serwer, bo to on zna regułę — panel powtarzający ją
   u siebie rozjechałby się z nią przy pierwszej zmianie (blizna z 0.175.0:
   ekran obiecywał pracę, której serwer nie przyjmował).

   ODMOWA MA POTWIERDZENIE, ZWROT NIE. To wygląda na niekonsekwencję, a jest
   §25a.5: cofnięcie zamiast potwierdzenia wszędzie, gdzie da się cofnąć.
   Zwrot pieniędzy jest odwracalny dopłatą i widać go od razu na osi; odmowa
   idzie do Allegro jako oświadczenie wobec klienta i drugiej takiej samej nie
   da się złożyć (422). Dlatego to ona pyta „na pewno", w formie wpisanego
   powodu, a nie okna z dwoma przyciskami.                                    */

/** Kody ze schematu `CustomerReturnRefundRejectionRequest` — po polsku. */
const KODY: Array<{ kod: string; etykieta: string }> = [
  { kod: "REFUND_REJECTED", etykieta: "Odmawiam zwrotu pieniędzy (wymaga powodu)" },
  { kod: "NEW_ITEM_SENT", etykieta: "Wysłaliśmy nowy towar" },
  { kod: "ITEM_FIXED", etykieta: "Naprawiliśmy towar" },
  { kod: "MISSING_PART_SENT", etykieta: "Wysłaliśmy brakującą część" },
  { kod: "ITEM_MISMATCH", etykieta: "Wrócił inny towar, niż zgłoszono" },
  { kod: "BUSINESS_PURCHASE", etykieta: "Zakup na firmę" },
  { kod: "NO_RETURN_RIGHT", etykieta: "Brak prawa do zwrotu" },
];
const WYMAGA_POWODU = "REFUND_REJECTED";
const LIMIT_POWODU = 250;

export function Pieniadze({ stan, trwa, blad, onZwroc, onOdmow }: {
  stan: StanZwrotuPieniedzy;
  trwa: boolean;
  blad: string;
  onZwroc: () => void;
  onOdmow: (kod: string, powod: string | null) => void;
}) {
  const [odmawiam, setOdmawiam] = useState(false);
  const [kod, setKod] = useState(KODY[0].kod);
  const [powod, setPowod] = useState("");

  const powodPusty = kod === WYMAGA_POWODU && powod.trim() === "";

  return <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3"
    aria-label="Pieniądze">
    <div className="flex flex-wrap items-center gap-2">
      <Banknote size={15} className="shrink-0 text-slate-400" />
      <b className="text-sm">Pieniądze</b>
      {stan.kwotaGrosze !== null && !stan.oddane &&
        <span className="text-sm tabular-nums">{zlote(stan.kwotaGrosze, stan.waluta)}</span>}

      {/* Oddane: numer zwrotu płatności z Allegro, nie samo „zrobione".
          Bez numeru nie da się niczego znaleźć po drugiej stronie. */}
      {/* DWA STANY, NIE JEDEN (0.208.0). Do tego wydania stało tu samo
          „Oddano" — od chwili, w której Allegro PRZYJĘŁO polecenie. Przelew
          odrzucony godzinę później wyglądał identycznie jak udany. Zieleń
          należy się dopiero potwierdzeniu ze statusu zwrotu; do tego czasu
          ekran mówi, na co czeka, zamiast obiecywać przelew. */}
      {stan.oddane && (stan.oddane.potwierdzone
        ? <span className="flex items-center gap-1 text-sm font-semibold text-ranga-ok">
            <Check size={14} />Oddano{stan.oddane.id && <span className="font-mono text-xs font-normal
              text-slate-500">{stan.oddane.id}</span>}</span>
        : <span title="Allegro przyjęło polecenie, ale nie potwierdziło jeszcze wypłaty"
            className="flex items-center gap-1 text-sm font-semibold text-ranga-uwaga">
            <Check size={14} />Zlecone — Allegro jeszcze nie potwierdziło
            {stan.oddane.id && <span className="font-mono text-xs font-normal
              text-slate-500">{stan.oddane.id}</span>}</span>)}

      {stan.odmowa && <span className="flex items-center gap-1 text-sm font-semibold text-slate-600">
        <Ban size={14} />Odmówiono ({stan.odmowa.kod})</span>}

      {stan.moznaZwrocic && <Przycisk wariant="glowny" className="ml-auto text-xs" disabled={trwa}
        onClick={onZwroc}>{trwa ? "ODDAJĘ…" : "ODDAJ PIENIĄDZE"}</Przycisk>}

      {stan.moznaOdmowic && !odmawiam && !stan.odmowa && !stan.oddane &&
        <Przycisk className={`text-xs ${stan.moznaZwrocic ? "" : "ml-auto"}`}
          onClick={() => setOdmawiam(true)}>ODMÓW WYPŁATY</Przycisk>}
    </div>

    {/* Przeszkoda mówi, CO zrobić — i stoi także wtedy, gdy odmowa jest
        możliwa, bo to dwie różne drogi, nie dwa warianty jednej. */}
    {stan.powod && !stan.oddane && !stan.odmowa &&
      <p className="mt-2 text-xs text-slate-500">{stan.powod}</p>}

    {odmawiam && <div className="mt-2 space-y-2 border-t pt-2">
      <label className="block text-xs font-semibold text-slate-600">Powód odmowy
        <select className="field mt-1 w-full text-sm" aria-label="Kod odmowy"
          value={kod} onChange={(e) => setKod(e.target.value)}>
          {KODY.map((k) => <option key={k.kod} value={k.kod}>{k.etykieta}</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-600">
        Uzasadnienie {kod === WYMAGA_POWODU ? "(wymagane)" : "(opcjonalne)"}
        <textarea className="field mt-1 min-h-16 w-full text-sm" maxLength={LIMIT_POWODU}
          aria-label="Uzasadnienie odmowy" value={powod}
          onChange={(e) => setPowod(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={trwa || powodPusty}
          onClick={() => onOdmow(kod, powod.trim() === "" ? null : powod.trim())}>
          {trwa ? "WYSYŁAM…" : "WYŚLIJ ODMOWĘ"}</Przycisk>
        <Przycisk className="text-xs" onClick={() => setOdmawiam(false)}>Anuluj</Przycisk>
        <span className="ml-auto text-xs text-slate-400">{powod.length}/{LIMIT_POWODU}</span>
      </div>
      {/* Klient przeczyta ten powód w Allegro — to nie jest notatka wewnętrzna. */}
      <p className="text-[11px] text-slate-500">Powód trafia do klienta w Allegro.</p>
    </div>}

    {blad && <p className="mt-2 text-xs font-semibold text-ranga-zle">{blad}</p>}
  </section>;
}
