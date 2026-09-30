import React from "react";
import type { OkresWskaznikow } from "../api/wglad";
import { useWskazniki } from "../api/wglad";
import { Blad, odmien } from "../ui";
import { Liczba } from "../ui/wykres";
import { KartaWgladu } from "../ui/wglad";
import { dniPl } from "./liczby";
import { czasPo } from "./ZakresObslugi";

/* ── Trzy wskaźniki nad zakresami Analizy ────────────────────────────────────
   Dostawa na półce, szukanie z adresem, odpowiedź klientowi. To są trzy
   pytania, dla których WERTIS istnieje, więc stoją nad każdym zakresem,
   a nie w jednym z nich. Reguły liczenia są przy `services/wskazniki.ts`.

   STAŁE OKNO 30 DNI. Dostaw jest kilka w tygodniu, więc tydzień daje
   medianę z garstki. Czip okna byłby decyzją, której ta karta nie potrzebuje.

   OBOK LICZBY STOI POPRZEDNI OKRES, BEZ BARW DOBRZE-ŹLE. Ocenę zostawiamy
   człowiekowi, który wie, co to był za miesiąc — ta sama zasada co
   w `porownanie.ts`. */

export const OKNO_WSKAZNIKOW = 30;

const procent = (x: number | null) => (x === null ? "—" : `${x}%`);
const dostaw = (n: number) => `${n} ${odmien(n, "dostawa", "dostawy", "dostaw")}`;
const szukan = (n: number) => `${n} ${odmien(n, "szukanie", "szukania", "szukań")}`;
const odpowiedzi = (n: number) => `${n} ${odmien(n, "odpowiedź", "odpowiedzi", "odpowiedzi")}`;

function Wskaznik({ ile, etykieta, szczegoly, wczesniej }: {
  ile: string; etykieta: string; szczegoly: string; wczesniej: string;
}) {
  return <div className="flex flex-col gap-1">
    <Liczba ile={ile} etykieta={etykieta} />
    <p className="text-sm text-slate-600">{szczegoly}</p>
    <p className="text-sm text-slate-600">Wcześniej: {wczesniej}</p>
  </div>;
}

export function KartaWskaznikow({ teraz, poprzednio }: { teraz: OkresWskaznikow; poprzednio: OkresWskaznikow }) {
  const d = teraz.dostawy, s = teraz.szukanie, o = teraz.odpowiedz;
  return <KartaWgladu tytul="Trzy wskaźniki"
    opis={`Ostatnie ${OKNO_WSKAZNIKOW} dni wobec ${OKNO_WSKAZNIKOW} dni wcześniej. Mediany, nie średnie.`}>
    <div className="grid gap-4 sm:grid-cols-3">
      <Wskaznik ile={dniPl(d.medianaDni)} etykieta="od daty faktury do rozłożenia"
        szczegoly={`${dostaw(d.n)} · praca na kolektorze ${czasPo(d.medianaMinPracy)}`}
        wczesniej={`${dniPl(poprzednio.dostawy.medianaDni)}, ${dostaw(poprzednio.dostawy.n)}`} />
      <Wskaznik ile={procent(s.odsetekZAdresem)} etykieta="szukań z kolektora kończy się adresem półki"
        szczegoly={`${szukan(s.n)} · bez wyniku ${s.bezWyniku} · wynik bez adresu ${s.bezAdresu}`}
        wczesniej={`${procent(poprzednio.szukanie.odsetekZAdresem)}, ${szukan(poprzednio.szukanie.n)}`} />
      <Wskaznik ile={czasPo(o.medianaMin)} etykieta="klient czeka na odpowiedź"
        szczegoly={`${odpowiedzi(o.n)} · co dziesiąty dłużej niż ${czasPo(o.p90Min)}`}
        wczesniej={`${czasPo(poprzednio.odpowiedz.medianaMin)}, ${odpowiedzi(poprzednio.odpowiedz.n)}`} />
    </div>
  </KartaWgladu>;
}

export function Wskazniki() {
  const w = useWskazniki(OKNO_WSKAZNIKOW);
  if (w.error) return <Blad>{w.error.message}</Blad>;
  return w.data ? <KartaWskaznikow teraz={w.data.teraz} poprzednio={w.data.poprzednio} /> : null;
}
