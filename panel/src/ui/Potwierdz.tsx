import React, { useState } from "react";
import { Przycisk } from "./index";

/* ── Potwierdzenie w miejscu ────────────────────────────────────────────
   Pytanie staje W MIEJSCU przycisku, obok rzeczy, której dotyczy (dekalog
   pkt 5 — mniej ruchu oka), zamiast okna na środku ekranu. Drugi klik jest
   świadomy, bo przycisk zmienia napis i barwę; przypadkowy podwójny klik
   trafia w pytanie, nie w zapis.

   Ustawienia (konta, logo) pytają tak samo jak stan systemu, a dwie kopie
   pytania rozjechałyby się przy pierwszej poprawce. */

const MALY = "!px-2.5 !py-1 !text-xs";

export function Potwierdz({ etykieta, pytanie, tak, onTak, trwa = false, maly = false }: {
  etykieta: React.ReactNode;
  pytanie: string;
  tak: string;
  onTak: () => void;
  trwa?: boolean;
  maly?: boolean;
}) {
  const [pyta, setPyta] = useState(false);
  if (!pyta) {
    return <Przycisk className={maly ? MALY : ""} disabled={trwa} onClick={() => setPyta(true)}>{etykieta}</Przycisk>;
  }
  return <span role="group" aria-label={pytanie} className="inline-flex flex-wrap items-center gap-2">
    <span className="text-xs font-semibold text-ranga-zle">{pytanie}</span>
    <Przycisk className={`${maly ? MALY : ""} !border-red-700 !bg-red-700 !text-white`} disabled={trwa}
      onClick={() => { setPyta(false); onTak(); }}>{tak}</Przycisk>
    <Przycisk className={maly ? MALY : ""} onClick={() => setPyta(false)}>Nie</Przycisk>
  </span>;
}
