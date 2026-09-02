import React, { useState } from "react";
import { PackageX, ScanLine, Search, X } from "lucide-react";
import type { WynikSkanu } from "../api/zwroty";

/* ── Szukanie zwrotu: czytnikiem albo ręką (0.163.0, rozszerzone w 0.165.0) ──
   Paczka wraca do biura wcześniej niż wiedza o tym, który to zwrot. Czytnik
   USB pisze prosto w ekran (`useSkaner`), więc typowe użycie NIE WYMAGA nawet
   kliknięcia w to pole.

   Od 0.165.0 to samo pole SZUKA. Każdy wpisany znak zawęża kolejkę po
   fragmencie — bez debounce'u, bo filtr liczy się w pamięci ekranu i czekanie
   opóźniałoby to, co i tak jest natychmiastowe. Enter idzie na serwer, bo
   tylko ta droga zna numer listu przewozowego: w modelu pracy go nie ma
   i lista zwrotów w panelu też go nie niesie.

   Dwa pola na jeden kod byłyby dwoma nawykami do wyuczenia. Komunikaty mówią,
   CZEGO szukano — „nie znalazłem" bez tej informacji wygląda przy czytniku
   identycznie jak zepsuty czytnik.                                          */

export function Szukanie({
  wynik, kod, fraza, szuka, dociaga, blad, ile, rejestruje = false,
  onFraza, onSzukaj, onDociagnij, onWybierz, onNieodebrana,
}: {
  wynik: WynikSkanu | null;
  kod: string;
  fraza: string;
  szuka: boolean;
  dociaga: boolean;
  blad: string;
  /** Ile zwrotów pasuje do frazy — `null`, gdy pole jest puste. */
  ile: number | null;
  onFraza: (v: string) => void;
  onSzukaj: (kod: string) => void;
  onDociagnij: (kod: string) => void;
  onWybierz: (id: number) => void;
  /** Rejestracja paczki nieodebranej; brak = ekran jej nie proponuje. */
  rejestruje?: boolean;
  onNieodebrana?: (waybill: string, orderId: string, notatka: string) => void;
}) {
  const [nieodebrana, setNieodebrana] = useState(false);
  const [zamowienie, setZamowienie] = useState("");
  const [notatka, setNotatka] = useState("");
  const brak = wynik?.trafienie === null;
  const wiele = wynik?.trafienie === "wiele";

  return <div className="shrink-0 border-b border-slate-200 p-2">
    <div className="relative flex items-center gap-2">
      <ScanLine size={16} className="shrink-0 text-slate-400" />
      <input
        className={`field h-8 flex-1 text-sm ${fraza ? "pr-8" : ""}`}
        placeholder="Zeskanuj etykietę albo szukaj po numerze"
        value={fraza}
        onChange={(e) => onFraza(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const v = fraza.trim();
          if (!v) return;
          onSzukaj(v);
        }}
      />
      {/* Bez krzyżyka powrót do kubełka znaczy kasowanie znak po znaku —
          a przy dwudziestoczteroznakowej etykiecie to osobna czynność. */}
      {fraza && <button type="button" onClick={() => onFraza("")}
        aria-label="Wyczyść szukanie"
        className="absolute right-2 rounded p-0.5 text-slate-400 hover:bg-slate-100">
        <X size={14} /></button>}
      {szuka && <span className="text-xs text-slate-500">Szukam…</span>}
    </div>

    {/* Filtr PRZEBIJA kubełek, więc ekran musi to powiedzieć. Inaczej wynik
        z kubełka ZAMKNIĘTE wyglądałby jak zwrot czekający na pracę. */}
    {ile !== null && <p className="mt-1 text-xs text-slate-500">
      {ile
        ? `${ile} ${ile === 1 ? "zwrot pasuje" : "pasujących zwrotów"} — szukam po wszystkich kubełkach.`
        : "Żaden zwrot w kolejce nie pasuje. Enter zapyta jeszcze o numer listu."}
    </p>}

    {/* Kod pokazujemy przy KAŻDYM wyniku: operator ma widzieć, co czytnik
        naprawdę wpisał, gdy naklejka jest pomięta albo skan urwany. */}
    {brak && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      <p>Nie znam kodu <b className="break-all font-mono">{kod}</b>.</p>
      <p className="mt-1 text-amber-800">
        Szukałem po numerze listu, numerze zwrotu i identyfikatorze z Allegro,
        we wszystkich kubełkach. Paczka bywa u nas szybciej niż zwrot.</p>
      <button type="button" disabled={dociaga}
        onClick={() => onDociagnij(kod)}
        className="btn-secondary mt-2 inline-flex items-center gap-1 text-xs">
        <Search size={12} />{dociaga ? "Pytam Allegro…" : "Poszukaj w Allegro"}
      </button>

      {/* ── Paczka nieodebrana (0.172.0) ──────────────────────────────────────
          Druga droga wyjścia z nieznanego kodu. Allegro nie zna zwrotu, którego
          klient nie zgłosił — przesyłka nieodebrana wraca sama i zwrotem nigdy
          nie zostanie. Pieniądze i tak trzeba oddać, więc paczka wchodzi do
          kolejki, ale JAWNIE oznaczona. */}
      {onNieodebrana && !nieodebrana &&
        <button type="button" onClick={() => setNieodebrana(true)}
          className="btn-secondary ml-2 mt-2 inline-flex items-center gap-1 text-xs">
          <PackageX size={12} />To nieodebrana paczka</button>}

      {onNieodebrana && nieodebrana && <div className="mt-2 rounded-lg border border-amber-300 bg-white p-2">
        <p className="text-slate-600">
          Klient nie odebrał przesyłki i wróciła do nas. To NIE jest zwrot
          zgłoszony przez klienta — panel oznaczy ją wprost.</p>
        <input className="field mt-2 h-7 text-xs" value={zamowienie}
          aria-label="Numer zamówienia" placeholder="Numer zamówienia (jeśli znasz)"
          onChange={(e) => setZamowienie(e.target.value)} />
        <p className="mt-1 text-slate-500">
          Z numerem zamówienia paczka dostanie pozycje i będzie co wycenić.</p>
        <input className="field mt-2 h-7 text-xs" value={notatka}
          aria-label="Notatka" placeholder="Notatka, np. awizo dwa razy"
          onChange={(e) => setNotatka(e.target.value)} />
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={rejestruje}
            onClick={() => onNieodebrana(kod, zamowienie.trim(), notatka.trim())}
            className="btn-primary text-xs">
            {rejestruje ? "Rejestruję…" : "Zarejestruj paczkę"}</button>
          <button type="button" className="btn-secondary text-xs"
            onClick={() => setNieodebrana(false)}>Wróć</button>
        </div>
      </div>}
    </div>}

    {/* Dwa trafienia to brak trafienia — wybiera człowiek, patrząc na oba. */}
    {wiele && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      <p>Ten kod pasuje do {wynik.zwroty.length} zwrotów. Wskaż właściwy:</p>
      <ul className="mt-1 space-y-1">
        {wynik.zwroty.map((z) => <li key={z.id}>
          <button type="button" onClick={() => onWybierz(z.id)}
            className="font-semibold text-sky-700 underline underline-offset-2">
            {z.numer ?? z.externalId}</button>
        </li>)}
      </ul>
    </div>}

    {blad && <p className="mt-2 text-xs text-red-700">{blad}</p>}
  </div>;
}
