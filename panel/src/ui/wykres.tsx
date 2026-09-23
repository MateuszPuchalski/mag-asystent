import React from "react";

/* ── Liczby i słupki wglądu (0.440.0) ───────────────────────────────────
   Przyszły z ANALIZY w `biuro.html`, gdzie składał je ręcznie `slupkiSvg`
   i `komorkaSlupka`. Panel nie miał dotąd ani jednego wykresu, a dwa
   słupkowe wykresy jednej serii nie uzasadniają biblioteki — ta sama
   decyzja, którą biuro zapisało przy swoim SVG.

   BARWA SŁUPKA: CIEMNIEJSZY STOPIEŃ BURSZTYNU. Biuro malowało słupki barwą
   marki (dziś #FF9100), a ta na bieli daje 2,26:1 — poniżej progu 3:1, który WCAG
   stawia znakom graficznym, i dokładnie ta liczba, dla której `Kontrast.test`
   zakazuje bursztynu jako pisma. `amber-600` (#D97706) zostaje w rodzinie
   marki i przechodzi walidator palety: pasmo jasności, nasycenie i kontrast
   powyżej 3:1. Szarość łupkowa odpadła na nasyceniu — słupek „czyta się
   jako wyłączony", a wykres ma mówić, że tu są dane.
   Podpisy i liczby zostają atramentem: pismo nie nosi barwy danych. */

/**
 * Jedna liczba z podpisem — kafel wglądu.
 *
 * Mieszkała w `ustawienia/PokrycieSygnatur.tsx` i przyjmowała wyłącznie
 * `number`. Analiza podaje też „12 min" i „4,2%", więc wartość jest węzłem,
 * a komponent przeszedł tutaj, bo odbiorców ma już dwa ekrany, nie jeden.
 */
export const Liczba = ({ etykieta, ile, ton = "" }: {
  etykieta: string; ile: React.ReactNode; ton?: string;
}) =>
  <div className="flex flex-col">
    <span className={`text-2xl font-bold ${ton}`}>{ile}</span>
    <span className="text-xs text-slate-500">{etykieta}</span>
  </div>;

/**
 * Pasek proporcji w komórce tabeli. `max` to największa wartość W TEJ
 * TABELI — pełny tor znaczy „ten największy", nie żadną wartość bezwzględną.
 * Liczba zostaje obok, bo pasek mówi o proporcji i milczy o skali, a tabela
 * bez odczytywalnych wartości przestaje być tabelą.
 */
export function PasekUdzialu({ ile, max, etykieta }: { ile: number; max: number; etykieta?: string }) {
  /* Podłoga 2%: wartość MAŁA, ale niezerowa, dalej rysuje kreskę — inaczej
     „1 przy stu" wygląda jak zero. Samo zero kreski nie dostaje: pusty tor to
     jedyna rzecz, którą da się odczytać jako „nic". */
  const proc = max > 0 && ile > 0 ? Math.max(2, Math.round((ile / max) * 100)) : 0;
  /* Tor do 10 rem: przy szerokiej kolumnie pasek na pół ekranu mówi o
     proporcji tyle samo, a zabiera oko od liczby obok. */
  return <div className="min-w-24 max-w-40">
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
      <div className="h-1.5 rounded-full bg-amber-600" style={{ width: `${proc}%` }} />
    </div>
    <div className="mt-0.5 text-xs tabular-nums text-slate-600">{etykieta ?? ile}</div>
  </div>;
}

export interface Slupek {
  ile: number;
  /** Podpis pod osią — krótki: „26.08", „14", „t36". */
  podpis: string;
  /** Pełna nazwa do dymka i tabeli dla czytnika: „2026-08-26", „godzina 14:00". */
  tytul: string;
}

/** Ile miejsca ma wykres. Stałe, bo SVG skaluje się w CAŁOŚCI — patrz `max-w` niżej. */
const W = 560, H = 150, DOL = 22, GORA = 14;

/**
 * Słupki jednej serii — oś czasu albo rozkład.
 *
 * `co` przerzedza podpisy osi: przy 90 dniach podpis pod każdym słupkiem
 * byłby nieczytelną kaszą.
 *
 * WARTOŚĆ NA KAŻDYM SŁUPKU, GDY SIĘ MIEŚCI — decyzja z 0.427.0 (dekalog
 * pkt 2): wcześniej podpisany był tylko najwyższy, a resztę trzeba było
 * szacować wzrokiem. 18 px na słupek mieści trzycyfrową liczbę w 10 px; przy
 * 90 dniach słupek ma 6 px i podpisy zlałyby się w pasek, więc wtedy zostaje
 * podpis samego maksimum. Pełne liczby i tak stoją w tabeli dla czytnika.
 */
export function Slupki({ dane, co, opis }: { dane: Slupek[]; co: number; opis: string }) {
  if (!dane.length) return <p className="text-sm text-slate-500">Brak danych w tym oknie.</p>;
  const max = Math.max(...dane.map((d) => d.ile), 1);
  const szczyt = dane.findIndex((d) => d.ile === max);
  const krok = W / dane.length;
  /* 24 px to górna granica grubości: słupek nie wypełnia pasma, resztę
     zostawia na powietrze. 2 px odstępu między sąsiadami rysuje tło, nie
     obrys — obrys dodałby atramentu, który nie jest daną. */
  const szer = Math.max(2, Math.min(24, krok - 2));
  const wszystkiePodpisy = krok >= 18;
  return <figure className="m-0">
    {/* `max-w` jest obowiązkowe, nie kosmetyczne. SVG rośnie razem z wysokością
        i z podpisami osi, więc wykres puszczony na całą szerokość karty urósłby
        do plakatu. Wykres jednej serii ma być paskiem pod tekstem. */}
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[560px]" role="img" aria-label={opis}>
      <line x1={0} y1={H - DOL} x2={W} y2={H - DOL} className="stroke-slate-200" strokeWidth={1} />
      {dane.map((d, i) => {
        const h = Math.round(((H - DOL - GORA) * d.ile) / max);
        const x = i * krok + (krok - szer) / 2;
        const y = H - DOL - h;
        /* Zaokrąglony TYLKO koniec danych, 4 px; u podstawy słupek stoi
           kanciasto na osi, z której rośnie. */
        const r = Math.min(4, szer / 2, h);
        const srodek = (i * krok + krok / 2).toFixed(1);
        const podpisany = i === szczyt || (wszystkiePodpisy && d.ile > 0);
        return <g key={i} className="group">
          {/* Pas trafienia na CAŁĄ wysokość kolumny, nie sam słupek: w dzień
              z jedną pozycją słupek ma dwa piksele i nikt w nie nie trafi. */}
          <rect x={i * krok} y={0} width={krok} height={H - DOL} fill="transparent">
            <title>{`${d.tytul}: ${d.ile}`}</title>
          </rect>
          {h > 0 && <path className="pointer-events-none fill-amber-600 group-hover:fill-amber-800"
            d={`M${x.toFixed(1)} ${H - DOL} v${-(h - r)} q0 ${-r} ${r} ${-r} h${(szer - 2 * r).toFixed(1)} q${r} 0 ${r} ${r} v${h - r} z`} />}
          {i % co === 0 && <text x={srodek} y={H - 6} textAnchor="middle" fontSize={10}
            className="pointer-events-none fill-slate-600">{d.podpis}</text>}
          {podpisany && <text x={srodek} y={y - 3} textAnchor="middle" fontSize={10}
            fontWeight={i === szczyt ? 700 : 600} className="pointer-events-none fill-slate-700">{d.ile}</text>}
        </g>;
      })}
    </svg>
    {/* Tabela dla czytnika: dymek `title` jest myszą, a obraz z `aria-label`
        mówi, CO narysowano, nie ILE. Liczby mają być osiągalne bez wzroku. */}
    <table className="sr-only">
      <caption>{opis}</caption>
      <tbody>{dane.map((d, i) => <tr key={i}><th scope="row">{d.tytul}</th><td>{d.ile}</td></tr>)}</tbody>
    </table>
  </figure>;
}
