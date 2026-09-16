import React, { useState } from "react";
import { BadgePercent } from "lucide-react";
import type { StanRabatu } from "../api/typy";
import { Przycisk } from "../ui";
import { zlote } from "../api/zwroty";

/* Rabat transakcyjny przy pozycji zwrotu (0.164.0).

   Do tego wydania firma odzyskiwała prowizję klikając ręcznie przy KAŻDYM
   zwrocie w panelu Allegro — nie dlatego, że tak trzeba, tylko dlatego, że
   znikąd nie było widać, przy którym wniosek już jest. Obserwacja z 2 września
   pokazuje skalę: 60 wniosków na 100 złożył człowiek, 40 Allegro samo.

   Cztery stany mają CZTERY różne zdania, bo każde każe co innego zrobić:
   złożyć, poczekać, nic (przyznany) albo pójść do Allegro po odwołanie. */
const ZDANIE: Record<StanRabatu["stan"], string> = {
  brak: "Rabat transakcyjny: brak wniosku",
  zlozony: "Rabat transakcyjny: wniosek złożony, czeka na decyzję",
  przyznany: "Rabat transakcyjny: przyznany",
  odrzucony: "Rabat transakcyjny: wniosek odrzucony",
  nie_wiadomo: "Rabat transakcyjny: nie wiadomo",
};

export function Rabat({ rabat, trwa, blad, onZglos }: {
  rabat: StanRabatu;
  trwa: boolean;
  blad: string;
  onZglos: () => void;
}) {
  /* ── WNIOSEK PYTA „NA PEWNO" (audyt, 15 września 2026) ────────────────────
     §25a.5 daje cofnięcie wszędzie, gdzie da się cofnąć, a potwierdzenie tam,
     gdzie się nie da. Tu się nie da: wniosek idzie do Allegro, panel nie ma
     końcówki do jego wycofania, a drugiego na tę samą pozycję złożyć nie można
     (przycisk znika, bo końcówka nie jest idempotentna).

     Do tego audytu stało tu jedno kliknięcie bez pytania — i to przy
     przycisku, który siedzi na liście pozycji, tuż obok oceny „na stan"
     i „utylizacja" klikanych dziesiątki razy dziennie. Trafienie obok
     kosztowało nieodwracalny wniosek o cudze pieniądze. */
  const [pytam, setPytam] = useState(false);

  const kolor = rabat.stan === "przyznany" ? "text-ranga-ok"
    : rabat.stan === "odrzucony" ? "text-ranga-zle"
    : rabat.stan === "nie_wiadomo" ? "text-slate-500" : "text-slate-600";

  return <div className="mt-1 text-xs">
    <div className="flex flex-wrap items-center gap-1.5">
      <BadgePercent size={12} className="shrink-0 text-slate-400" />
      <span className={kolor}>{ZDANIE[rabat.stan]}</span>
      {rabat.prowizjaGrosze !== null && <b className="tabular-nums">
        {zlote(rabat.prowizjaGrosze, rabat.waluta ?? "PLN")}</b>}
      {/* `MANUAL` czy `AUTOMATIC` — czyli czy ktoś musiał kliknąć, czy Allegro
          zrobiło to samo. To ta liczba mówi, ile pracy zdejmuje przycisk. */}
      {rabat.typ === "AUTOMATIC" && <span className="text-slate-500">· automat Allegro</span>}

      {rabat.stan === "brak" && !pytam && <Przycisk className="ml-auto text-xs" disabled={trwa}
        onClick={() => setPytam(true)}>ZGŁOŚ RABAT</Przycisk>}
    </div>

    {/* Zdanie mówi SKUTEK, nie „czy na pewno": pytanie bez treści uczy tylko
        odruchu klikania „tak". Po złożeniu przycisk i tak znika, więc to jedyny
        moment, w którym ta informacja kogokolwiek dosięgnie. */}
    {rabat.stan === "brak" && pytam && <div className="mt-1 flex flex-wrap items-center gap-2
      rounded border border-slate-200 bg-slate-50 p-1.5">
      <span className="text-slate-600">Wniosek idzie do Allegro i panel go nie wycofa.</span>
      <Przycisk wariant="glowny" className="ml-auto text-xs" disabled={trwa}
        onClick={() => { setPytam(false); onZglos(); }}>ZŁÓŻ WNIOSEK</Przycisk>
      <Przycisk className="text-xs" disabled={trwa}
        onClick={() => setPytam(false)}>Anuluj</Przycisk>
    </div>}

    {/* Brak dopasowania mówi POWÓD — milczenie wygląda jak usterka panelu,
        a jest zerwanym ogniwem w danych (ten sam wzorzec co przy kartotekach). */}
    {rabat.stan === "nie_wiadomo" && rabat.powod &&
      <p className="mt-0.5 text-slate-500">{rabat.powod}</p>}

    {/* WNIOSEK SPOZA PANELU (0.176.0). Złożony ręcznie w panelu Allegro albo
        przez ich automat nie ma prawa być w naszym lustrze, dopóki nie
        przewinie się przez listę wniosków. Zwrot niesie wtedy własny status
        i to on tu mówi — a ekran przyznaje się, ile z tego wie: numeru
        wniosku ani kwoty prowizji zwrot nie podaje. */}
    {rabat.zrodlo === "zwrot" && rabat.powod &&
      <p className="mt-0.5 text-slate-500">
        {rabat.powod} Samego wniosku jeszcze nie pobraliśmy, więc numeru
        i kwoty prowizji nie znamy.</p>}

    {blad && <p className="mt-0.5 font-semibold text-ranga-zle">{blad}</p>}
  </div>;
}
