import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Przycisk } from "../ui";

/**
 * Pytanie bez numeru oferty (§4.3, otwarcie `docs/obsluga-klienta.md`).
 *
 * Ekran mówi o braku wprost, zamiast podstawiać ofertę zgadniętą z treści.
 * To zdanie stało do 0.506.0 także NA ekranie — agentowi mówiło o ekranie,
 * nie o kliencie. Na ekranie zostaje skutek: nie wiadomo, o jaki towar chodzi.
 * Tak wygrywały kiedyś „zdemontowanym" i „Pozdrawiam", bo dobór fraz brał
 * słowa po DŁUGOŚCI, a „szarpaku" wypadało przez limit trzech fraz.
 *
 * ── JEDNA LINIJKA (0.548.0, wariant C skrzynki) ──────────────────────────
 * Decyzja właściciela z 28 września 2026. Baner stał w trzech rzędach nad
 * osią rozmowy: tytuł ze zdaniem, dwa przyciski, odstępy. Oś, po którą agent
 * tu przyszedł, zaczynała się przez to niżej. Teraz brak i obie czynności
 * stoją w jednym rzędzie i zawijają się tylko przy braku miejsca.
 *
 * Zdanie „Nie wiadomo, o który towar pyta klient" zeszło do dymka. Tytuł
 * i dwie czynności mówią już to samo: czego brakuje i jak to uzupełnić.
 * Prawa kolumna nie powtarza braku akapitami — mówi go streszczeniem
 * wiersza „Oferta i towar" (`Kontekst.tsx`).
 */
export function BrakOferty({ zapisuje, blad, onWskaz, onDopytaj }: {
  zapisuje: boolean;
  blad: string;
  onWskaz: (ofertaId: string) => void;
  onDopytaj: () => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [numer, setNumer] = useState("");
  /* Zwarte przyciski: `py-1` przy `text-xs` daje 26 px z obramowaniem,
     czyli ponad próg 24 px z WCAG 2.2 AA (2.5.8). */
  const zwarty = "!px-2.5 !py-1 !text-xs";

  return <div className="shrink-0 border-b bg-amber-50 px-4 py-1.5">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p className="mr-auto flex min-w-0 items-center gap-2 text-sm text-amber-800"
        title="Nie wiadomo, o który towar pyta klient.">
        <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
        <b>Brak powiązania z ofertą</b>
      </p>
      <span className="flex shrink-0 flex-wrap gap-2">
        <Przycisk className={zwarty} aria-expanded={otwarte}
          onClick={() => setOtwarte(!otwarte)}>Wskaż ofertę</Przycisk>
        <Przycisk className={zwarty} onClick={onDopytaj}>Dopytaj o numer</Przycisk>
      </span>
    </div>

    {otwarte && <div className="mt-1.5 flex flex-wrap items-center gap-2 pb-0.5">
      <input className="field max-w-xs py-1 text-sm" value={numer} inputMode="numeric"
        aria-label="Numer oferty Allegro"
        onChange={(e) => setNumer(e.target.value)} placeholder="Np. 14892374512" />
      <Przycisk wariant="glowny" className={zwarty} disabled={!numer.trim() || zapisuje}
        onClick={() => { onWskaz(numer); setNumer(""); setOtwarte(false); }}>ZAPISZ</Przycisk>
      {/* Wskazanie ręczne zapisuje się jako WYBÓR AGENTA i tak wygląda na osi.
          Zadanie dla hali odróżni je od kartoteki wywiedzionej z oferty. */}
      <span className="text-xs text-slate-600">Zapisze się jako Twój wybór, nie fakt z Allegro.</span>
    </div>}
    {blad && <p className="mt-1.5 text-sm text-red-700">{blad}</p>}
  </div>;
}
