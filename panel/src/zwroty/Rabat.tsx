import React from "react";
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
  const kolor = rabat.stan === "przyznany" ? "text-ranga-ok"
    : rabat.stan === "odrzucony" ? "text-ranga-zle"
    : rabat.stan === "nie_wiadomo" ? "text-slate-400" : "text-slate-600";

  return <div className="mt-1 text-xs">
    <div className="flex flex-wrap items-center gap-1.5">
      <BadgePercent size={12} className="shrink-0 text-slate-400" />
      <span className={kolor}>{ZDANIE[rabat.stan]}</span>
      {rabat.prowizjaGrosze !== null && <b className="tabular-nums">
        {zlote(rabat.prowizjaGrosze, rabat.waluta ?? "PLN")}</b>}
      {/* `MANUAL` czy `AUTOMATIC` — czyli czy ktoś musiał kliknąć, czy Allegro
          zrobiło to samo. To ta liczba mówi, ile pracy zdejmuje przycisk. */}
      {rabat.typ === "AUTOMATIC" && <span className="text-slate-400">· automat Allegro</span>}

      {rabat.stan === "brak" && <Przycisk className="ml-auto text-xs" disabled={trwa}
        onClick={onZglos}>ZGŁOŚ RABAT</Przycisk>}
    </div>

    {/* Brak dopasowania mówi POWÓD — milczenie wygląda jak usterka panelu,
        a jest zerwanym ogniwem w danych (ten sam wzorzec co przy kartotekach). */}
    {rabat.stan === "nie_wiadomo" && rabat.powod &&
      <p className="mt-0.5 text-slate-400">{rabat.powod}</p>}

    {blad && <p className="mt-0.5 font-semibold text-ranga-zle">{blad}</p>}
  </div>;
}
