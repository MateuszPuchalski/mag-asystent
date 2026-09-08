import React from "react";
import { Sparkles } from "lucide-react";
import { Przycisk, czas } from "../ui";
import type { StanCopilota, SzkicCopilota } from "../api/typy";

/**
 * Szkic odpowiedzi z Copilota (§14.6, 0.231.0) — przycisk i karta pod edytorem.
 *
 * Propozycja modelu NIE wchodzi do pola sama. Stoi obok jako karta, a do
 * szkicu agenta trafia na jedno z dwóch kliknięć: „Wstaw" DOPISUJE (ten sam
 * kontrakt, co każda wstawka: nowa linia, nigdy ciche nadpisanie), „Zastąp"
 * jest jedyną świadomą drogą nadpisania i pojawia się TYLKO, gdy jest co
 * nadpisać. Każde kliknięcie, także „Odrzuć", jest werdyktem — z tych
 * werdyktów liczy się, czy przycisk wart jest pieniędzy.
 *
 * Bez kroku „to kosztuje": klik w jednej rozmowie JEST intencją. Partia nad
 * kolejką miała potwierdzenie, bo była kroplówką na dwadzieścia rozmów naraz.
 */
export interface PropsSzkicuCopilota {
  /** `undefined` = stan jeszcze nie przyszedł — wtedy nie ma ani przycisku, ani zdania. */
  stan: StanCopilota | undefined;
  szkic: SzkicCopilota | null;
  /** Klient dopisał po tym, jak szkic powstał — propozycja odpowiada na stare pytanie. */
  nieswiezy: boolean;
  uklada: boolean;
  blad: string;
  /** Szkic agenta jest niepusty — dopiero wtedy „Zastąp" ma sens. */
  maSzkicAgenta: boolean;
  wylaczony: boolean;
  onUloz: () => void;
  onWstaw: () => void;
  onZastap: () => void;
  onOdrzuc: () => void;
}

export function PrzyciskSzkicu({ p }: { p: PropsSzkicuCopilota }) {
  if (!p.stan) return null;
  return <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
    {p.stan.wlaczony
      ? <Przycisk className="text-xs" disabled={p.uklada || p.wylaczony} onClick={p.onUloz}>
          <Sparkles size={14} />{p.uklada ? "Układam szkic z faktów…" : "Ułóż odpowiedź"}</Przycisk>
      /* Przycisk, który nie może zadziałać, uczy nie klikać — zamiast niego zdanie z serwera. */
      : <span className="text-slate-500">{p.stan.powod}</span>}
    {p.blad && <span className="text-red-700">{p.blad}</span>}
  </div>;
}

export function KartaSzkicu({ p }: { p: PropsSzkicuCopilota }) {
  const s = p.szkic;
  /* Oceniony szkic zniknął z ekranu: wstawiony już jest w polu, odrzucony
     nie ma po co wisieć. Wiersz w bazie zostaje dla pomiaru. */
  if (!s || s.ocena !== null) return null;
  return <section className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3" aria-label="Szkic Copilota">
    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
      <b className="text-violet-900"><Sparkles size={12} className="inline" /> Szkic Copilota</b>
      <span className="text-slate-500">{s.model} · {czas(s.at)} · {s.przez}</span>
      {p.nieswiezy && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
        powstał przed nową wiadomością klienta</span>}
    </div>
    {s.zastrzezenia.length > 0 && <ul className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
      aria-label="Czego model nie znalazł w faktach">
      {s.zastrzezenia.map((z, i) => <li key={i}>⚠ {z}</li>)}
    </ul>}
    <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{s.tresc}</pre>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Przycisk wariant="glowny" className="text-xs" disabled={p.wylaczony} onClick={p.onWstaw}>Wstaw do szkicu</Przycisk>
      {p.maSzkicAgenta && <Przycisk className="text-xs" disabled={p.wylaczony} onClick={p.onZastap}>Zastąp szkic</Przycisk>}
      <Przycisk className="text-xs" onClick={p.onOdrzuc}>Odrzuć</Przycisk>
      <span className="ml-auto text-[11px] text-slate-500">{s.tresc.length} znaków · każde twierdzenie ma źródło (F…)</span>
    </div>
  </section>;
}
