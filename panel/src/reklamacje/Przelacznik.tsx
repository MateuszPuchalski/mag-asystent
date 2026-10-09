import React from "react";
import { CirclePause, Gavel, Menu as IkonaMenu, MessageSquareText } from "lucide-react";
import type { KubelekReklamacji } from "../api/typy";
import { KUBELKI } from "./Kolejka";
import { MenuPrzycisku } from "./Menu";

/* ── Przełącznik kubełków: cztery pola równej szerokości ─────────────────────
   Trzy kubełki na wierzchu i „Więcej”. Równa szerokość, bo pole o stałym
   miejscu ręka znajduje bez czytania (dekalog, punkt 2). Każde pole niesie
   ikonę, liczbę i nazwę, więc liczbę widać bez przełączania kubełka.

   „Rozstrzygnięte” i „Wszystkie” to widoki „tylko wgląd”, nie praca, więc
   leżą pod „Więcej”. Wybrany widok staje wtedy w czwartym polu, żeby nazwa
   bieżącej listy zawsze była na widoku. Cyfry z klawiatury wybierają je dalej.

   BRAK LICZBY TO KRESKA, NIE ZERO. Przy awarii serwera pole mówi „—”, bo
   „0” agent czyta jako „nic nie czeka” (`panel/CLAUDE.md`). */

const IKONY: Partial<Record<KubelekReklamacji, React.ReactNode>> = {
  decyzja: <Gavel size={16} aria-hidden="true" />,
  odpowiedz: <MessageSquareText size={16} aria-hidden="true" />,
  bez_ruchu: <CirclePause size={16} aria-hidden="true" />,
};

/** Kubełki na wierzchu, w kolejności pól; reszta stoi pod „Więcej”. */
const NA_WIERZCHU: KubelekReklamacji[] = ["decyzja", "odpowiedz", "bez_ruchu"];

/** Klawisz skrótu liczy się z `KUBELKI`, jak w nasłuchu ekranu. */
const klawisz = (k: KubelekReklamacji | null) =>
  k === null ? KUBELKI.length + 1 : KUBELKI.findIndex((x) => x.id === k) + 1;

const nazwa = (k: KubelekReklamacji | null) =>
  k === null ? "Wszystkie" : (KUBELKI.find((x) => x.id === k)?.etykieta ?? k);

const pole = (wybrane: boolean) =>
  `flex min-h-[3.25rem] w-full min-w-0 flex-col items-center justify-center rounded-lg px-1 py-1.5 ${
    wybrane ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,.12),inset_0_-3px_0_#303030]"
      : "text-slate-600 hover:bg-slate-200"}`;

function Tresc({ ikona, ile, napis, wybrane }: {
  ikona: React.ReactNode; ile: string; napis: string; wybrane: boolean;
}) {
  return <>
    <span className="flex items-center gap-1.5">
      {ikona}
      <span className={`text-naglowek font-bold tabular-nums ${wybrane ? "text-slate-900" : "text-slate-700"}`}>
        {ile}</span>
    </span>
    <span className="max-w-full truncate text-xs font-semibold">{napis}</span>
  </>;
}

export function PrzelacznikKubelkow({ wybrany, liczniki, wszystkich, onWybierz }: {
  wybrany: KubelekReklamacji | null;
  /** `undefined` = nie wiemy; wtedy każde pole mówi „—”. */
  liczniki?: Partial<Record<KubelekReklamacji, number>>;
  wszystkich?: number;
  onWybierz: (k: KubelekReklamacji | null) => void;
}) {
  const ile = (k: KubelekReklamacji | null) => {
    const n = k === null ? wszystkich : liczniki?.[k];
    return n === undefined ? "—" : String(n);
  };
  const podWiecej: Array<KubelekReklamacji | null> = ["zamknieta", null];
  const wiecejWybrane = podWiecej.includes(wybrany);
  return <div role="group" aria-label="Kubełek"
    className="grid grid-cols-4 gap-1 rounded-[10px] bg-slate-100 p-1">
    {NA_WIERZCHU.map((k) => {
      const opis = KUBELKI.find((x) => x.id === k)!;
      const on = wybrany === k;
      return <button key={k} type="button" aria-pressed={on} onClick={() => onWybierz(k)}
        title={`${opis.pytanie} (klawisz ${klawisz(k)})`} className={pole(on)}>
        <Tresc ikona={IKONY[k]} ile={ile(k)} napis={opis.etykieta} wybrane={on} />
      </button>;
    })}
    <MenuPrzycisku etykieta="Więcej kubełków" wcisniety={wiecejWybrane}
      klasaPrzycisku={pole(wiecejWybrane)} szerokosc="w-52"
      przycisk={wiecejWybrane
        ? <Tresc ikona={<IkonaMenu size={16} aria-hidden="true" />} ile={ile(wybrany)}
            napis={nazwa(wybrany)} wybrane />
        : <Tresc ikona={<IkonaMenu size={16} aria-hidden="true" />} ile="" napis="Więcej" wybrane={false} />}
      pozycje={podWiecej.map((k) => ({
        klucz: String(k), wybrana: wybrany === k, onWybierz: () => onWybierz(k),
        napis: <span title={`klawisz ${klawisz(k)}`}>{nazwa(k)} · {ile(k)}</span>,
      }))} />
  </div>;
}
