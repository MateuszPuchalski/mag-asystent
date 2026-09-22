import React from "react";
import { useNavigate } from "react-router-dom";
import { usePominiete } from "../api/kosze";
import { FiltrSegmentowy } from "../ui";

/* ── Zwroty i kosze pod jedną zakładką (0.438.0) ───────────────────────────
   Decyzja właściciela: kosze mieszkają w Zwrotach, nie w drugim rzędzie
   nagłówka. Kosz jest DALSZYM CIĄGIEM zwrotu — ocena „na stan" wkłada towar
   do koszyka, zamknięcie wysyła go na halę, a hala rozkłada go na regał.
   Osobna zakładka kazałaby szukać końca tej drogi gdzie indziej niż jej
   początku (dekalog pkt 1 i 2).

   Przełącznik, nie trzecia kolumna ani kubełek zwrotów: kubełek zawęża LISTĘ
   ZWROTÓW, a kosz nie jest zwrotem — ma własną kolejkę, zawartość i ludzi,
   którzy go rozłożyli. Ten sam kształt wyboru co wszędzie w panelu
   (`FiltrSegmentowy`), bo to jest wybór jednego z dwóch widoków.

   Licznik przy Koszach to POMINIĘTE — jedyna praca biura, która czeka tam
   bez niczyjego ruchu. Liczba koszy w drodze byłaby tłem. */

export function PrzelacznikZwrotow({ teraz }: { teraz: "zwroty" | "kosze" }) {
  const nawiguj = useNavigate();
  const pominiete = usePominiete().data?.pominiete.length ?? 0;
  return <nav aria-label="Zwroty i kosze" className="flex shrink-0 gap-1">
    <FiltrSegmentowy<"zwroty" | "kosze"> wybrany={teraz}
      onWybierz={(v) => nawiguj(v === "kosze" ? "/obsluga/zwroty/kosze" : "/obsluga/zwroty")}
      pozycje={[
        { klucz: "zwroty", etykieta: "Zwroty", podpowiedz: "Zwroty klientów — decyzje, oceny, pieniądze" },
        { klucz: "kosze", etykieta: "Kosze", ile: pominiete || undefined,
          podpowiedz: pominiete
            ? `Kosze na regał zwrotów — ${pominiete} pominiętych czeka na biuro`
            : "Kosze na regał zwrotów — co jedzie, co rozłożone, czego hala nie znalazła" },
      ]} />
  </nav>;
}
