import React, { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "./api/klient";
import { Kafel } from "./towar/Kafel";
import { Zdjecie } from "./towar/Zdjecie";

/* Agent nie wpisuje `tw_id` z pamięci — wskazuje towar (projekt panelu §13.2).
   Techniczny identyfikator bazy nie jest wiedzą, którą ktokolwiek nosi w
   głowie, a literówka w nim wysyłała na halę zadanie o cudzym towarze.

   ── ZDJĘCIE PRZY WYNIKU (0.203.0) ────────────────────────────────────────
   To pole obsługuje pięć miejsc: dobór, kartotekę przy rozmowie, zlecenie
   pomiaru, sprawdzenie wiedzy i nową propozycję. Wszędzie kończy się tym
   samym pytaniem — „który z tych dwudziestu wierszy to TA część" — a
   odpowiadały na nie sam symbol i nazwa. Nazwy w kartotece tej firmy różnią
   się końcówką („szarpak NAC LS46" i „szarpak NAC LS51"), więc wybór
   wymagał otwarcia Subiekta albo strzału.

   Kafel ma stały rozmiar, także pusty, żeby lista nie przesuwała się pod
   kursorem po doładowaniu obrazów. Wyników jest najwyżej dwadzieścia
   (`/api/products/search`), a pobrania i tak idą po trzy naraz.

   NAZWA PRZED SYMBOLEM. Symbol pozostaje potrzebny — jedzie na dokument
   i na halę — ale rozpoznaje się część po nazwie i po obrazku. Do 0.202.0
   wiersz zaczynał się od pogrubionego symbolu, czyli od tego, czego nikt
   nie nosi w głowie. */

export interface Towar { id: number; sym: string; name: string; locs: string[] }

export function Wyszukiwarka(
  { wybrany, onWybierz, etykieta = "Towar z Subiekta" }: {
    wybrany: Towar | null;
    onWybierz: (t: Towar | null) => void;
    etykieta?: string;
  },
) {
  const [q, setQ] = useState("");
  const [wyniki, setWyniki] = useState<Towar[]>([]);
  const [przyblizone, setPrzyblizone] = useState(false);
  const [szuka, setSzuka] = useState(false);

  /* Odpytujemy po pauzie w pisaniu. Bez tego każda litera to jedno zapytanie
     do Subiekta, a serwer loguje każde szukanie jako zdarzenie. */
  useEffect(() => {
    const fraza = q.trim();
    if (wybrany || fraza.length < 2) { setWyniki([]); return; }
    const t = setTimeout(async () => {
      setSzuka(true);
      try {
        const d = await api<{ results?: Towar[]; przyblizone?: boolean }>(
          `/api/products/search?q=${encodeURIComponent(fraza)}`);
        setWyniki(d.results ?? []);
        setPrzyblizone(Boolean(d.przyblizone));
      } catch { setWyniki([]); } finally { setSzuka(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, wybrany]);

  /* Wybrany towar dostaje kafel WIĘKSZY niż wiersze listy: to jest już
     decyzja, a nie kandydat, i ma się dać sprawdzić okiem bez klikania. */
  if (wybrany) return <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
    <Kafel twId={wybrany.id} rozmiar={56} nazwa={wybrany.name} symbol={wybrany.sym} />
    <div className="min-w-0 flex-1">
      <div className="text-xs font-bold uppercase text-emerald-700">{etykieta}</div>
      <div className="truncate font-semibold">{wybrany.name}</div>
      <div className="truncate font-mono text-xs text-slate-600">{wybrany.sym}</div>
      <div className="text-xs text-slate-500">Lokalizacja: {wybrany.locs?.join(", ") || "brak"}</div>
    </div>
    <button type="button" className="rounded p-1 text-slate-500 hover:bg-white" title="Wyczyść"
      onClick={() => { onWybierz(null); setQ(""); }}><X size={16} /></button>
  </div>;

  return <div>
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
      <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Szukaj po symbolu, nazwie albo EAN" />
    </div>
    {szuka && <p className="mt-2 text-xs text-slate-500">Szukam…</p>}
    {/* „Przybliżone" znaczy: nie znalazłem dosłownie, to są podobne. Serwer
        odróżnia te dwa przypadki, więc ekran też ma je odróżniać. */}
    {przyblizone && wyniki.length > 0 && <p className="mt-2 text-xs text-amber-700">
      Brak dokładnego trafienia — poniżej podobne.</p>}
    {q.trim().length >= 2 && !szuka && !wyniki.length && <p className="mt-2 text-xs text-slate-500">
      Nic nie znaleziono.</p>}
    {wyniki.length > 0 && <ul className="mt-2 max-h-52 overflow-y-auto rounded-lg border">
      {wyniki.map((t) => <li key={t.id}>
        <button type="button"
          className="flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-0 hover:bg-slate-50"
          onClick={() => { onWybierz(t); setWyniki([]); }}>
          {/* Bez `Kafel`: kliknięcie w wiersz WYBIERA towar, a przycisk
              powiększenia w środku przycisku wyboru byłby przyciskiem
              w przycisku — i zabierałby kliknięcie temu, po co lista jest. */}
          <Zdjecie twId={t.id} rozmiar={40} nazwa={t.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{t.name}</div>
            <div className="truncate text-xs">
              <span className="font-mono text-slate-600">{t.sym}</span>
              <span className="text-slate-400"> · {t.locs?.join(", ") || "brak lokalizacji"}</span>
            </div>
          </div>
        </button>
      </li>)}
    </ul>}
  </div>;
}
