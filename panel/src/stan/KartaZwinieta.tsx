import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Karta } from "../ui";

/* ── Karta stanu zwinięta do nagłówka (0.509.0) ─────────────────────────
   Agenci mówili, że aplikacja przytłacza. Na stanie systemu stało dziesięć
   kart naraz, a trzy z nich — test na żywym Allegro, rekoncyliacja i arkusz
   lokalizacji — otwiera się rzadko, na żądanie. Zwinięte zostawiają sam
   nagłówek, więc każda jest jedno kliknięcie dalej.

   KSZTAŁT JAK `KartaWgladu`, nie `Zwijka`. Zwijka to blok w środku karty,
   drobnym pismem; tu zwija się cała karta, więc nagłówek ma tę samą rangę
   co nagłówki kart obok. `KartaWgladu` nie umie się zwijać, a jest wspólna
   dla analizy, więc ta rama stoi obok niej, a nie w niej.

   `otworz` PRZYCHODZI Z ZEWNĄTRZ: głęboki link `?karta=` i błąd, który ma
   być widać. Zwinięta karta nie może schować celu wiersza DO DECYZJI.
   Otwiera ją zmiana na `true`; zamknięcia ręką nie cofa kolejne
   odświeżenie. Pamięci w przeglądarce nie ma celowo — karta Allegro opisuje,
   ile kosztowało jej utrzymanie w biurze. */

export function KartaZwinieta({ id, tytul, opis, akcje, otworz = false, children }: {
  id: string; tytul: string; opis?: React.ReactNode; akcje?: React.ReactNode;
  otworz?: boolean; children: React.ReactNode;
}) {
  const [otwarta, setOtwarta] = useState(otworz);
  useEffect(() => { if (otworz) setOtwarta(true); }, [otworz]);
  const Strzalka = otwarta ? ChevronDown : ChevronRight;

  return <Karta id={id} className="scroll-mt-4 overflow-hidden">
    <header className={`flex flex-wrap items-baseline gap-2 px-4 py-3 ${otwarta ? "border-b" : ""}`}>
      {/* Przycisk W nagłówku, nie nagłówek w przycisku: nazwa nagłówka zostaje
          samym tytułem, a cały wiersz tytułu da się kliknąć. */}
      <h2 className="text-naglowek mr-auto flex-1 font-bold">
        <button type="button" aria-expanded={otwarta} onClick={() => setOtwarta((o) => !o)}
          className="flex w-full items-center gap-1.5 text-left">
          <Strzalka size={16} aria-hidden="true" className="shrink-0 text-slate-600" />{tytul}
        </button>
      </h2>
      {/* Akcje dopiero w otwartej karcie: wynik „Sprawdź teraz" w zwiniętej
          przyszedłby tam, gdzie go nie widać. */}
      {otwarta && akcje}
      {otwarta && opis && <p className="w-full text-sm text-slate-600">{opis}</p>}
    </header>
    {otwarta && <div className="p-4">{children}</div>}
  </Karta>;
}
