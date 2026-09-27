import React, { useState, type MutableRefObject } from "react";
import { Link } from "react-router-dom";
import { Banknote, Ban, Check, Lock, Truck, Undo2, UserRound } from "lucide-react";
import type { StanZwrotuPieniedzy, WynikDosylki } from "../api/typy";
import { Przycisk, barwaTonu } from "../ui";
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
const KODY: Array<{ kod: string; etykieta: string;
  /** Brzmienie po wysłaniu, gdy etykieta formularza niesie wskazówkę dla operatora. */
  poOdmowie?: string }> = [
  /* Po wysłaniu fakt, nie pierwsza osoba: „Odmówiono: „Odmawiam…”” mówiło
     dwa razy to samo i brzmiało, jakby odmowa dopiero szła. */
  { kod: "REFUND_REJECTED", etykieta: "Odmawiam zwrotu pieniędzy (wymaga powodu)",
    poOdmowie: "Odmowa zwrotu pieniędzy" },
  { kod: "NEW_ITEM_SENT", etykieta: "Wysłaliśmy nowy towar" },
  { kod: "ITEM_FIXED", etykieta: "Naprawiliśmy towar" },
  { kod: "MISSING_PART_SENT", etykieta: "Wysłaliśmy brakującą część" },
  { kod: "ITEM_MISMATCH", etykieta: "Wrócił inny towar, niż zgłoszono" },
  { kod: "BUSINESS_PURCHASE", etykieta: "Zakup na firmę" },
  { kod: "NO_RETURN_RIGHT", etykieta: "Brak prawa do zwrotu" },
];
const WYMAGA_POWODU = "REFUND_REJECTED";
/**
 * Kody, przy których do klienta jedzie druga paczka (0.536.0). Odmowa z nimi
 * zakłada śledzenie dosyłki i krok dosyłki w sprawie klienta — w tym samym
 * zapisie, bez nowego wyboru w formularzu (dekalog p. 5).
 *
 * `NEW_ITEM_SENT` nazwał właściciel 27 września 2026: zły towar wraca, a biuro
 * odmawia wypłaty kodem „Wysłaliśmy nowy towar”. `MISSING_PART_SENT` doszedł
 * w tym wydaniu, bo brakująca część też jedzie drugą paczką — do oceny
 * właściciela, nie z jego słów.
 */
const KODY_DOSYLKI = new Set(["NEW_ITEM_SENT", "MISSING_PART_SENT"]);

/**
 * Kod odmowy słowami operatora (0.536.0). Do tego wydania stał tu surowy
 * `NEW_ITEM_SENT`, czyli nazwa pola ze specyfikacji Allegro, nie zdanie.
 *
 * JEDEN KOD, JEDNO BRZMIENIE. Czytają stąd: ta sekcja, kolumna dowodów
 * („Rozstrzygnięte w Allegro”) i propozycja dosyłki na profilu klienta.
 * Kolumna dowodów miała do tego wydania własną mapę z innymi słowami, więc
 * ta sama odmowa brzmiała na jednym ekranie dwojako.
 *
 * Kod spoza listy zostaje surowy. Kolumna dowodów pokazuje `rejection_code`
 * z synchronizacji, a Allegro może tam dołożyć kod, którego lista nie zna.
 */
export const etykietaKodu = (kod: string) => {
  const k = KODY.find((x) => x.kod === kod);
  return k?.poOdmowie ?? k?.etykieta ?? kod;
};
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
  akcje, przedWerdyktem = false, wynikDosylki = null, onSledzDosylke, kodAllegro = null }: {
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
  /**
   * Wynik założenia dosyłki z ODPOWIEDZI ostatniego zapisu (0.536.0). Zdanie
   * jednorazowe: stan trwały przychodzi odświeżonym `stan.dosylka`, a tego,
   * czy zapis podmienił krok sprawy, stan już nie mówi.
   */
  wynikDosylki?: WynikDosylki | null;
  /** „Śledź dosyłkę” — gdy odmowa z kodem dosyłki nie ma śledzenia (0.536.0). */
  onSledzDosylke?: () => void;
  /**
   * Kod odmowy z synchronizacji Allegro (`Zwrot.rejectionCode`, @wydanie).
   * Odmowa złożona w panelu Allegro nie ma `stan.odmowa` — to pole niesie
   * tylko naszą. Bez tego kodu linijka dosyłki wisiałaby bez powodu.
   */
  kodAllegro?: string | null;
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
      {/* JEDYNE MIEJSCE KWOTY NA EKRANIE (0.516.0, §26d). Stała też w pasku
          decyzji i w stopce pozycji; zeszła stamtąd, więc tu zostaje także po
          oddaniu — inaczej zamknięty zwrot nie mówiłby, ile wyszło. */}
      {stan.kwotaGrosze !== null &&
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
        <Ban size={14} />Odmówiono: „{etykietaKodu(stan.odmowa.kod)}”</span>}
      {/* ODMOWA Z PANELU ALLEGRO (@wydanie) — tylko przy dosyłce, bo to ją
          ta linijka tłumaczy. Kod z synchronizacji stoi też w kolumnie
          dowodów; tutaj stoi obok dosyłki, której jest powodem. Inne kody
          z synchronizacji zostają tam, gdzie były. */}
      {!stan.odmowa && kodAllegro && (stan.dosylka || stan.sledzicDosylke) &&
        <span className="flex items-center gap-1 text-sm font-semibold text-slate-600">
          <Ban size={14} aria-hidden="true" />Odmówiono w Allegro: „{etykietaKodu(kodAllegro)}”</span>}

      {/* Klawisz STOI PRZY PRZYCISKU, tak jak przy werdykcie i korekcie:
          rozpoznanie jest tańsze od pamiętania, a pasek skrótów na dole ekranu
          czyta się dopiero wtedy, gdy się wie, że jest czego szukać. */}
      {/* Etykiety zwykłą pisownią (0.516.0, §26d): wersaliki krzyczały przy
          każdym przycisku naraz, więc żaden nie był głośniejszy od innych. */}
      {stan.moznaZwrocic && <Przycisk wariant="glowny" className="ml-auto text-xs" disabled={trwa}
        onClick={onZwroc}>{trwa ? "Oddaję…"
          : <><kbd className="rounded border border-black/20 px-1 text-xs">Z</kbd>{" "}
            Oddaj pieniądze</>}</Przycisk>}

      {stan.moznaOdmowic && !odmawiam && !stan.odmowa && !stan.oddane &&
        <Przycisk className={`text-xs ${stan.moznaZwrocic ? "" : "ml-auto"}`}
          onClick={() => setOdmawiam(true)}>Odmów wypłaty</Przycisk>}
    </div>

    {/* Przeszkoda mówi, CO zrobić — i stoi także wtedy, gdy odmowa jest
        możliwa, bo to dwie różne drogi, nie dwa warianty jednej. */}
    {stan.powod && !stan.oddane && !stan.odmowa && !przedWerdyktem &&
      <p className="mt-2 text-xs text-slate-500">{stan.powod}</p>}

    {/* ── DOSYŁKA POD ODMOWĄ (0.536.0) ───────────────────────────────────
        Zła paczka wraca, biuro odmawia wypłaty kodem „Wysłaliśmy nowy towar”
        i wysyła właściwy towar z nową etykietą w Sellasist. Do tego wydania
        ekran zwrotu kończył się na odmowie, a aplikacja o drugiej paczce nie
        wiedziała nic. Zdanie składa serwer, to samo co na profilu; odnośnik
        prowadzi tam, gdzie stoi krok sprawy. Pracy tu nie ma, poza jednym
        ponowieniem.

        Linijka NIE ZALEŻY od `stan.odmowa`: odmowa złożona w panelu Allegro
        przychodzi synchronizacją i naszej odmowy nie ma, a dosyłkę ma. */}
    {stan.dosylka && <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Truck size={13} aria-hidden="true" className="shrink-0 text-slate-400" />
      <span className={`font-semibold ${barwaTonu(stan.dosylka.ton)}`}>{stan.dosylka.opis}</span>
      <Link to={`/obsluga/klient/${encodeURIComponent(stan.dosylka.login)}`}
        className="inline-flex items-center gap-1 text-sky-700 underline underline-offset-2 hover:text-sky-900">
        <UserRound size={12} aria-hidden="true" />profil klienta</Link>
    </p>}
    {/* Ponowienie, gdy odmowa wyszła, a śledzenie nie powstało — albo gdy
        odmowę złożono w panelu Allegro i jej kod przyszedł synchronizacją.
        Przycisk zamiast automatu, bo zapis zakłada krok w cudzej sprawie
        klienta, a tego nie robi się przy samym patrzeniu. */}
    {stan.sledzicDosylke && !stan.dosylka && onSledzDosylke &&
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <Truck size={13} aria-hidden="true" className="shrink-0 text-slate-400" />
        <span>Dosyłki nie śledzimy.</span>
        <Przycisk className="text-xs" disabled={trwa} onClick={() => onSledzDosylke()}>Śledź dosyłkę</Przycisk>
      </p>}
    {/* Odmowy w Allegro nie da się cofnąć, więc nieudany zapis u nas NIE MOŻE
        jej przykryć. Zdanie mówi najpierw, co wyszło, potem czego zabrakło. */}
    {wynikDosylki && !wynikDosylki.zalozona && <p className="mt-2 text-xs font-semibold text-ranga-uwaga">
      Odmowa wysłana; śledzenia dosyłki nie założono — {wynikDosylki.blad}</p>}
    {/* Założenie dosyłki ZASTĄPIŁO krok, który prowadzący ustawił sam. Stan
        tego nie pokaże, a bez zdania prowadzący szukałby swojego kroku na profilu.
        Nowy krok pisze się z odpowiedzi serwera, nie z pamięci ekranu. */}
    {wynikDosylki?.zalozona && wynikDosylki.zastapil && <p className="mt-2 text-xs text-slate-600">
      Krok sprawy klienta: „{wynikDosylki.krok}” zamiast „{wynikDosylki.zastapil}”</p>}

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
          {trwa ? "Zapisuję…" : "Zapisz przelew"}</Przycisk>
      </div>}

    {/* Formularz znika razem z odmową: odświeżony stan mówi już „Odmówiono”,
        a druga odmowa tego samego zwrotu i tak wraca z Allegro błędem. */}
    {odmawiam && !stan.odmowa && <div className="mt-2 space-y-2 border-t pt-2">
      <label className="block text-xs font-semibold text-slate-600">Powód odmowy
        <select className="field mt-1 w-full text-sm" aria-label="Kod odmowy"
          value={kod} onChange={(e) => setKod(e.target.value)}>
          <option value={BEZ_KODU}>— wybierz powód —</option>
          {KODY.map((k) => <option key={k.kod} value={k.kod}>{k.etykieta}</option>)}
        </select>
      </label>
      {/* Zdanie, nie pole wyboru: skutek wynika z kodu, więc pytanie
          „czy śledzić" byłoby decyzją, którą stan pracy już zna (dekalog p. 5).
          Brzmienia kroku tu nie ma: ustawia je serwer, a ekran pokazuje je
          dopiero z odpowiedzi. */}
      {KODY_DOSYLKI.has(kod) && <p className="text-xs text-slate-600">
        Sprawa klienta dostanie krok dosyłki i jej śledzenie.</p>}
      <label className="block text-xs font-semibold text-slate-600">
        Uzasadnienie {kod === BEZ_KODU ? "" : kod === WYMAGA_POWODU ? "(wymagane)" : "(opcjonalne)"}
        <textarea className="field mt-1 min-h-16 w-full text-sm" maxLength={LIMIT_POWODU}
          aria-label="Uzasadnienie odmowy" value={powod}
          onChange={(e) => setPowod(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={trwa || niegotowe}
          onClick={() => onOdmow(kod, powod.trim() === "" ? null : powod.trim())}>
          {trwa ? "Wysyłam…" : "Wyślij odmowę"}</Przycisk>
        <Przycisk className="text-xs" onClick={() => setOdmawiam(false)}>Anuluj</Przycisk>
        <span className="ml-auto text-xs text-slate-500">{powod.length}/{LIMIT_POWODU}</span>
      </div>
      {/* Klient przeczyta ten powód w Allegro — to nie jest notatka wewnętrzna. */}
      <p className="text-podpis text-slate-500">Powód trafia do klienta w Allegro.</p>
    </div>}

    {blad && <p className="mt-2 text-xs font-semibold text-ranga-zle">{blad}</p>}
  </section>;
}
