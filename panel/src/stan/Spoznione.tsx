import React from "react";
import { Link } from "react-router-dom";
import { Hourglass } from "lucide-react";
import { useAlarmWymiany } from "../api/stan";
import { ile } from "../ui";

/* ── Spóźnione sprawy w nagłówku (0.446.0, z paska `biuro.html` 0.364.0) ──
   Sprawa między halą a biurem, która stoi dłużej niż dziewięć na dziesięć
   domkniętych w tym samym kanale. Biuro pokazywało ją plakietką przy ikonach
   stanu, widoczną z KAŻDEJ zakładki. Strona zniknęła, a w panelu ta liczba
   stała tylko w karcie wymiany — widział ją ten, kto już poszedł sprawdzić,
   czyli nikt, kto jej potrzebował.

   Cztery reguły przeszły razem z plakietką, każda z blizny:
   1. OKNO STAŁE (30 dni): sygnał nie zależy od tego, co ktoś wybrał w tabeli.
   2. PROWADZI DO TREŚCI: klik otwiera kartę, która wyjaśnia, co stoi.
   3. BURSZTYN, NIE CZERWIEŃ: nic nie stoi, praca idzie wolniej. Czerwień
      należy do awarii — pigułka synchronizacji obok jej nie oddaje.
   4. ZERO TO BRAK PLAKIETKI: pusty licznik na stałe uczy go nie widzieć. */
export function PlakietkaSpoznien() {
  const { data } = useAlarmWymiany();
  const n = data?.spoznionychRazem ?? 0;
  if (!n) return null;
  const opis = ile(n, "spóźniona sprawa", "spóźnione sprawy", "spóźnionych spraw");
  return <Link to="/obsluga/stan?karta=wymiana"
    title={`${n} — stoją dłużej niż dziewięć na dziesięć domkniętych w tym kanale. Kliknij, żeby zobaczyć które.`}
    className="flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900">
    <Hourglass size={14} aria-hidden />{opis}</Link>;
}
