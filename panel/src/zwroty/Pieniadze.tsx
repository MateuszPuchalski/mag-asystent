import React, { useState, type MutableRefObject } from "react";
import { Banknote, Ban, Check, Lock, Undo2 } from "lucide-react";
import type { StanZwrotuPieniedzy } from "../api/typy";
import { Przycisk } from "../ui";
import { zlote } from "../api/zwroty";
import { useAkcjaKlawisza, type AkcjeKlawiszy } from "./klawisze";

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
/**
 * Żadnego kodu nie ma wybranego z góry — i to jest decyzja, nie brak jednej.
 *
 * Do audytu z 15 września 2026 stał tu `KODY[0]`, czyli `REFUND_REJECTED`.
 * Wyglądało to na wybór bezpieczny, bo jako jedyny żąda uzasadnienia.
 * Jest odwrotnie. Operator rozwija odmowę, żeby powiedzieć „wysłaliśmy nowy
 * towar", wpisuje to w uzasadnienie — i wysyła je pod kodem, którego nie
 * wybrał. Klient czyta ten kod w Allegro jako oświadczenie firmy, więc wybór
 * ma być świadomy: pole zaczyna puste, a przycisk czeka na wskazanie.
 */
const BEZ_KODU = "";
const LIMIT_POWODU = 250;
/** `LIMIT_REFERENCJI` z `services/zwrot-pieniedzy.ts` — tytuł przelewu bywa długi. */
const LIMIT_REFERENCJI = 140;

export function Pieniadze({ stan, trwa, blad, onZwroc, onOdmow, onPrzelew, onCofnijPrzelew,
  akcje, przedWerdyktem = false }: {
  stan: StanZwrotuPieniedzy;
  /**
   * Zwrot czeka jeszcze na werdykt (0.453.0). Przeszkoda jest wtedy jedna
   * i znana z góry, a oś etapów nad sekcją już ją pokazuje — więc zdanie
   * „Najpierw przyjmij zwrot…" schodzi do znacznika z kłódką. Inne przeszkody
   * zostają zdaniami: każda mówi co innego i każda każe coś zrobić.
   */
  przedWerdyktem?: boolean;
  trwa: boolean;
  blad: string;
  onZwroc: () => void;
  onOdmow: (kod: string, powod: string | null) => void;
  /** Zapis przelewu oddanego poza Allegro (0.269.0) i jego cofnięcie. */
  onPrzelew?: (referencja: string | null) => void;
  onCofnijPrzelew?: () => void;
  /** Rejestr klawiszy ekranu — stąd bierze się `Z`. */
  akcje?: MutableRefObject<AkcjeKlawiszy>;
}) {
  const [odmawiam, setOdmawiam] = useState(false);
  const [kod, setKod] = useState(BEZ_KODU);
  const [powod, setPowod] = useState("");
  const [referencja, setReferencja] = useState("");

  /* Dwie różne przeszkody, jedna bramka: nie wybrano kodu albo wybrany kod
     żąda uzasadnienia, którego nie ma. */
  const niegotowe = kod === BEZ_KODU || (kod === WYMAGA_POWODU && powod.trim() === "");

  /* KLAWISZ `Z` ODDAJE PIENIĄDZE (audyt z 15 września 2026). Tabela §25a.2
     obiecuje, że typowy zwrot to jeden klawisz na kubełek — a ostatni krok,
     jedyny, który rusza pieniędzmi, nie miał żadnego i wymuszał sięgnięcie po mysz
     dokładnie tam, gdzie ręka już leżała na klawiaturze.

     Rejestracja jest BEZWARUNKOWA, bo to hook; warunek siedzi w środku
     funkcji. Sprawdza dokładnie to samo, co decyduje o istnieniu przycisku
     wyżej — klawisz ma robić to, co widać, i nic więcej. */
  useAkcjaKlawisza(akcje, "oddajPieniadze", () => {
    if (stan.moznaZwrocic && !trwa) onZwroc();
  });

  return <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3"
    aria-label="Pieniądze">
    <div className="flex flex-wrap items-center gap-2">
      <Banknote size={15} className="shrink-0 text-slate-400" />
      <b className="text-naglowek">Pieniądze</b>
      {stan.kwotaGrosze !== null && !stan.oddane &&
        <span className="text-sm tabular-nums">{zlote(stan.kwotaGrosze, stan.waluta)}</span>}

      {/* Oddane: numer zwrotu płatności z Allegro, nie samo „zrobione".
          Bez numeru nie da się niczego znaleźć po drugiej stronie. */}
      {/* DWA STANY, NIE JEDEN (0.209.0). Do tego wydania stało tu samo
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

      {przedWerdyktem && stan.powod && !stan.oddane && !stan.odmowa &&
        <span title={stan.powod}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
          <Lock size={12} aria-hidden="true" />po werdykcie</span>}

      {stan.odmowa && <span className="flex items-center gap-1 text-sm font-semibold text-slate-600">
        <Ban size={14} />Odmówiono ({stan.odmowa.kod})</span>}

      {/* Klawisz STOI PRZY PRZYCISKU, tak jak przy werdykcie i korekcie:
          rozpoznanie jest tańsze od pamiętania, a pasek skrótów na dole ekranu
          czyta się dopiero wtedy, gdy się wie, że jest czego szukać. */}
      {stan.moznaZwrocic && <Przycisk wariant="glowny" className="ml-auto text-xs" disabled={trwa}
        onClick={onZwroc}>{trwa ? "ODDAJĘ…"
          : <><kbd className="rounded border border-black/20 px-1 text-xs">Z</kbd>{" "}
            ODDAJ PIENIĄDZE</>}</Przycisk>}

      {stan.moznaOdmowic && !odmawiam && !stan.odmowa && !stan.oddane &&
        <Przycisk className={`text-xs ${stan.moznaZwrocic ? "" : "ml-auto"}`}
          onClick={() => setOdmawiam(true)}>ODMÓW WYPŁATY</Przycisk>}
    </div>

    {/* Przeszkoda mówi, CO zrobić — i stoi także wtedy, gdy odmowa jest
        możliwa, bo to dwie różne drogi, nie dwa warianty jednej. */}
    {stan.powod && !stan.oddane && !stan.odmowa && !przedWerdyktem &&
      <p className="mt-2 text-xs text-slate-500">{stan.powod}</p>}

    {/* ── PRZELEW ODDANY POZA ALLEGRO (0.269.0) ────────────────────────────
        Przy pobraniu klient nigdy nie zapłacił Allegro, więc przycisk wyżej
        jest zamknięty z definicji, a zwrot zamykał się BEZ ŚLADU po wypłacie:
        jedynym dowodem był wyciąg bankowy poza aplikacją. Ten blok zapisuje
        notatkę o przelewie — kiedy poszedł, kto go zlecił i pod jakim numerem
        da się go znaleźć.

        Cofnięcie zamiast potwierdzenia (§25a.5): to notatka o ruchu pieniędzy,
        nie sam ruch, więc pomyłka w numerze jest odwracalna. */}
    {stan.przelew && <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-600">
      <Check size={13} className="text-ranga-ok" />
      <span>Oddano przelewem{stan.przelew.przez ? ` · ${stan.przelew.przez}` : ""}</span>
      {stan.przelew.referencja && <span className="font-mono text-slate-500">
        {stan.przelew.referencja}</span>}
      {onCofnijPrzelew && <button type="button" disabled={trwa} onClick={onCofnijPrzelew}
        title="Cofnij zapis o przelewie"
        className="ml-1 inline-flex items-center gap-1 text-slate-500 underline
          underline-offset-2 hover:text-slate-800 disabled:opacity-50">
        <Undo2 size={12} />cofnij</button>}
    </p>}

    {!stan.przelew && stan.moznaZapisacPrzelew && onPrzelew &&
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
        <label className="flex flex-1 items-center gap-2 text-xs font-semibold text-slate-600">
          Numer przelewu
          {/* OPCJONALNY: numer bywa znany dopiero z wyciągu, a wymóg kazałby
              wpisać cokolwiek albo odłożyć zapis — czyli zostawić ten sam brak
              śladu, który to wydanie usuwa. */}
          <input className="field w-full text-sm" maxLength={LIMIT_REFERENCJI}
            aria-label="Numer przelewu" placeholder="opcjonalny — z wyciągu"
            value={referencja} onChange={(e) => setReferencja(e.target.value)} />
        </label>
        <Przycisk className="text-xs" disabled={trwa}
          onClick={() => onPrzelew(referencja.trim() === "" ? null : referencja.trim())}>
          {trwa ? "ZAPISUJĘ…" : "ZAPISZ PRZELEW"}</Przycisk>
      </div>}

    {odmawiam && <div className="mt-2 space-y-2 border-t pt-2">
      <label className="block text-xs font-semibold text-slate-600">Powód odmowy
        <select className="field mt-1 w-full text-sm" aria-label="Kod odmowy"
          value={kod} onChange={(e) => setKod(e.target.value)}>
          <option value={BEZ_KODU}>— wybierz powód —</option>
          {KODY.map((k) => <option key={k.kod} value={k.kod}>{k.etykieta}</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-600">
        Uzasadnienie {kod === BEZ_KODU ? "" : kod === WYMAGA_POWODU ? "(wymagane)" : "(opcjonalne)"}
        <textarea className="field mt-1 min-h-16 w-full text-sm" maxLength={LIMIT_POWODU}
          aria-label="Uzasadnienie odmowy" value={powod}
          onChange={(e) => setPowod(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={trwa || niegotowe}
          onClick={() => onOdmow(kod, powod.trim() === "" ? null : powod.trim())}>
          {trwa ? "WYSYŁAM…" : "WYŚLIJ ODMOWĘ"}</Przycisk>
        <Przycisk className="text-xs" onClick={() => setOdmawiam(false)}>Anuluj</Przycisk>
        <span className="ml-auto text-xs text-slate-500">{powod.length}/{LIMIT_POWODU}</span>
      </div>
      {/* Klient przeczyta ten powód w Allegro — to nie jest notatka wewnętrzna. */}
      <p className="text-podpis text-slate-500">Powód trafia do klienta w Allegro.</p>
    </div>}

    {blad && <p className="mt-2 text-xs font-semibold text-ranga-zle">{blad}</p>}
  </section>;
}
