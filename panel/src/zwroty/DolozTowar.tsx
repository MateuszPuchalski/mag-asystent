import React, { useRef, useState } from "react";
import { Check, PackagePlus, ScanLine } from "lucide-react";
import { useDolozTowar, useTowaryDoKosza } from "../api/zwroty";
import { Blad } from "../ui";
import { SeriaWPolu } from "../skaner";

/* ── Towar do koszyka: skan albo kartoteka (0.365.0) ─────────────────────────
   Zgłoszenie właściciela: „dodaj możliwość dodawania produktów do koszyka
   zwrotowego poprzez zeskanowanie produktu lub wybranie go z kartoteki",
   a zaraz po nim granica: „tylko z poziomu obsługi zwrotów, jak jeszcze nie
   jest zamknięty".

   DLACZEGO TO STOI PRZY OTWARTYM ZWROCIE, a nie przy pasku koszyka. Pasek
   pokazuje się dopiero z zawartością (0.192.0, punkt 2 dekalogu) i tej reguły
   nie ruszamy — a pierwszą sztukę trzeba gdzieś zeskanować. Poza tym operator
   stoi wtedy nad OTWARTYM KARTONEM konkretnej paczki: ekran idzie za
   czynnością fizyczną (dekalog, punkt 1).

   CZEGO TO NIE ROBI, i dlatego mówi to wprost na ekranie: nie dopisuje pozycji
   do zwrotu i nie rusza pieniędzy. Zwrot rozlicza się z tego, co klient zgłosił
   i co potwierdza dokument sprzedaży (§25a.3). Tutaj przesuwa się TOWAR —
   z biurka na regał, przez koszyk i dokument MM.

   POLE JEST JEDNO na skan i na szukanie, tak jak przy szukaniu zwrotu:
   dwa byłyby dwoma nawykami do wyuczenia. Serwer rozpoznaje kod czytnika tą
   samą drabinką co kolektor (EAN, alias, symbol) i wtedy oddaje JEDEN wynik
   oznaczony `dokladne` — ten dokładamy od razu, bo skan jest wskazaniem, a nie
   pytaniem.                                                                  */

/** Co mówi dołożenie — jedno zdanie, w dwóch miejscach, więc jedna stała. */
const CO_ROBI = "Dokłada do koszyka, czyli na regał — nie do rozliczenia z klientem. "
  + "Zwrot wycenia się z tego, co klient zgłosił.";

export function DolozTowar(
  { rodzaj = "zwroty", koszId, wiersz = false }: {
    rodzaj?: "zwroty" | "odpad"; koszId?: number;
    /**
     * Tryb paska koszyka (0.453.0): pole stoi otwarte na stałe, wyniki
     * rozwijają się POD nim, a zdanie „czego to nie robi" idzie do podpowiedzi.
     * Przy pudle ten skan jest jedyną czynnością — przycisk „otwórz pole"
     * byłby kliknięciem przed każdą serią skanów. W karcie zwrotu zostaje
     * stary kształt, bo tam dokładanie jest wyjątkiem, nie codziennością.
     */
    wiersz?: boolean;
  },
) {
  const [otwarte, setOtwarte] = useState(wiersz);
  const [fraza, setFraza] = useState("");
  const [blad, setBlad] = useState("");
  const [ostatni, setOstatni] = useState("");
  /* Seria żyje MIĘDZY zdarzeniami klawiszy, więc nie może być stanem —
     ta sama zasada co w polu szukania zwrotu. */
  const seria = useRef(new SeriaWPolu());
  const szukanie = useTowaryDoKosza(fraza);
  const doloz = useDolozTowar();

  const dodaj = (twId: number, symbol: string) => {
    setBlad("");
    /* KOSZYK WPROST, gdy pole stoi przy konkretnym pudle (0.379.0). Bez tego
       skan przy drugim kartonie wpadałby do pierwszego albo odbijałby się od
       pytania „do którego" — a pytanie zadane przy pudle, które człowiek ma
       przed sobą, byłoby pytaniem o to, co już powiedział. */
    doloz.mutate({ twId, ilosc: 1, rodzaj, koszId }, {
      onSuccess: (w) => {
        /* Licznik sztuk W ZDANIU, nie sama nazwa: drugi skan tego samego
           towaru dolicza sztukę, a operator ma to zobaczyć bez patrzenia
           w pasek koszyka. */
        setOstatni(`${symbol} → koszyk ${w.kod}: ${w.ilosc} szt.`);
        setFraza("");
      },
      onError: (e) => setBlad((e as Error).message),
    });
  };

  if (!otwarte) {
    return <div className="border-t border-slate-200 p-2">
      <button type="button" onClick={() => setOtwarte(true)}
        className="btn-secondary inline-flex items-center gap-1 text-xs">
        <PackagePlus size={12} />Dołóż towar do koszyka
      </button>
    </div>;
  }

  const wyniki = szukanie.data?.towary ?? [];
  const lista = wyniki.length > 0 && <ul className={wiersz
    /* W pasku lista WYSKAKUJE nad resztą ekranu: rozpychanie paska przy każdym
       znaku przesuwałoby w dół całą kolejkę, na którą operator patrzy. */
    ? "absolute left-0 right-0 top-full z-20 mt-1 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
    : "mt-2 max-h-48 space-y-1 overflow-y-auto"}>
    {wyniki.map((t) => <li key={t.twId}>
      <button type="button" onClick={() => dodaj(t.twId, t.symbol)}
        disabled={doloz.isPending}
        className="w-full rounded border border-slate-200 p-1.5 text-left hover:bg-slate-50">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <b className="font-mono">{t.symbol}</b>
          {t.ean && <span className="font-mono text-slate-500">{t.ean}</span>}
          {t.stanMag !== null && <span className="tabular-nums text-slate-500">
            stan {t.stanMag}</span>}
        </span>
        <span className="mt-0.5 block truncate text-slate-600">{t.nazwa}</span>
      </button>
    </li>)}
  </ul>;

  const pole = <input className="field h-8 min-w-0 flex-1 text-sm" autoFocus={!wiersz} value={fraza}
    aria-label="Towar do koszyka"
    placeholder={wiersz ? "Skanuj towar · symbol · EAN" : "Zeskanuj towar albo wpisz symbol, EAN lub nazwę"}
    title={wiersz ? CO_ROBI : undefined}
    onChange={(e) => setFraza(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Escape") {
        seria.current.przerwij();
        /* W pasku pole nie znika — Escape czyści je i oddaje klawisze. */
        if (wiersz) { setFraza(""); e.currentTarget.blur(); } else setOtwarte(false);
        return;
      }
      const { podmien } = seria.current.klawisz(e, fraza);
      /* Podmiana zjada znak i wstawia SAMĄ serię — inaczej szósty znak
         kodu doleciałby jeszcze do starej treści (blizna 0.329.0). */
      if (podmien !== null) { e.preventDefault(); setFraza(podmien); return; }
      if (e.key !== "Enter") return;
      e.preventDefault();
      /* Enter przy JEDNYM wyniku dokłada — przy kilku wybiera człowiek. */
      if (wyniki.length === 1) dodaj(wyniki[0].twId, wyniki[0].symbol);
    }} />;

  if (wiersz) {
    /* ── PASEK: jedna linia, stan w podpowiedziach i znacznikach ──────────
       Potwierdzenie ZOSTAJE do następnego skanu, jak w trybie karty — tylko
       jako znacznik z ptaszkiem, nie zdanie. „Nie znam" i „przybliżone"
       zostają słowami, bo to one mówią, że skan NIE poszedł. */
    return <div className="relative flex min-w-[16rem] flex-1 flex-wrap items-center gap-2 text-xs">
      <ScanLine size={14} aria-hidden="true" className="shrink-0 text-slate-400" />
      {pole}
      {szukanie.isFetching && <span className="text-slate-500">Szukam…</span>}
      {fraza.trim() && !szukanie.isFetching && wyniki.length === 0 &&
        <span className="text-slate-600">Nie znam takiego towaru.</span>}
      {szukanie.data?.przyblizone && <span className="text-amber-800" title="Dokładnie nic nie pasuje">
        przybliżone</span>}
      {ostatni && !blad && <span title={`Dołożono: ${ostatni}`}
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">
        <Check size={12} aria-hidden="true" />{ostatni}</span>}
      {lista}
      {blad && <div className="w-full"><Blad>{blad}</Blad></div>}
    </div>;
  }

  return <div className="border-t border-slate-200 p-2 text-xs">
    <div className="flex items-center gap-2">
      <ScanLine size={14} className="shrink-0 text-slate-400" />
      {pole}
      <button type="button" className="btn-secondary text-xs"
        onClick={() => { seria.current.przerwij(); setOtwarte(false); }}>Zamknij</button>
    </div>

    <p className="mt-1 text-slate-500">{CO_ROBI}</p>

    {szukanie.isFetching && <p className="mt-1 text-slate-500">Szukam…</p>}
    {szukanie.data?.przyblizone && <p className="mt-1 text-amber-700">
      Dokładnie nic nie pasuje — to są trafienia przybliżone.</p>}
    {fraza.trim() && !szukanie.isFetching && wyniki.length === 0 &&
      <p className="mt-1 text-slate-500">Nie znam takiego towaru.</p>}

    {lista}

    {/* Potwierdzenie ZOSTAJE na ekranie do następnego skanu: przy serii
        towarów operator patrzy na karton, nie na ekran, i wraca wzrokiem
        dopiero po kilku sztukach. */}
    {ostatni && !blad && <p className="mt-2 text-emerald-700">Dołożono: {ostatni}</p>}
    {blad && <div className="mt-2"><Blad>{blad}</Blad></div>}
  </div>;
}
