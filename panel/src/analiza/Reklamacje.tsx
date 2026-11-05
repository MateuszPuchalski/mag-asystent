import React from "react";
import { useReklamacje } from "../api/reklamacje";
import { Kafle } from "../reklamacje/Kafle";
import { Blad, Karta } from "../ui";

/* ── Reklamacje w liczbach ───────────────────────────────────────────────────
   Trend tygodnia i średni czas do werdyktu odpowiadają na „jak idzie”, a nie
   na „co teraz zrobić”, więc stoją w Analizie, a nie nad kolejką. Kolejka
   wybiera widok jednym rzędem kubełków.

   Czyta tę samą kolejkę co ekran reklamacji (jedno GET, ten sam klucz
   TanStacka), bo statystyki jadą razem z nią. Osobnej trasy na cztery
   liczby nie ma. */
export function ReklamacjeWLiczbach() {
  const { data, error } = useReklamacje();
  return <Karta className="flex flex-col gap-3 p-4">
    <h2 className="text-naglowek font-bold text-slate-900">Reklamacje w liczbach</h2>
    {/* Przy awarii kafle mówią „—”, a zdanie pod nimi mówi dlaczego. */}
    <Kafle statystyki={data?.statystyki} />
    <Blad>{error && !data ? (error as Error).message : ""}</Blad>
  </Karta>;
}
