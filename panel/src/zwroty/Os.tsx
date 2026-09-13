import React from "react";
import type { WpisOsiZwrotu } from "../api/typy";
import { czas } from "../ui";

/* ── Oś zwrotu (0.285.0) ─────────────────────────────────────────────────────
   Zwrot zapisywał ślad po każdej decyzji od 0.156.0 i serwer oddawał go przy
   szczególe sprawy. Panel dostał na to nawet typ — i zostawił go nieużytym.
   Biuro patrzące na zamknięty zwrot nie widziało więc ANI kto go przyjął, ANI
   za co poszła ta kwota, ANI czy towar wrócił na półkę; odpowiedzi szukało się
   w Subiekcie i w panelu Allegro, czyli tam, gdzie ich nie ma.

   PIONOWO, NIE W PASKU. Skrzynka rysuje przebieg rozmowy jako rząd czipów
   (`skrzynka/Os.tsx`), bo tam zdarzeń bywa kilkanaście i konkurują z treścią
   wiadomości. Zwrot ma ich kilka i każde jest zdaniem do przeczytania — lista
   z góry na dół czyta się w kolejności pracy, a pasek kazałby najeżdżać myszą
   po podpowiedź.

   NAJSTARSZE NA GÓRZE. Kolejność szukania („co ostatnio") ma kolejka; tu pyta
   się o drogę sprawy, a tę opowiada się od początku. Porządek rozstrzyga
   serwer (`osZwrotu`), żeby nie było dwóch definicji tego samego.            */

/**
 * Barwa mówi RODZINĘ zdarzenia, nie jego wagę.
 *
 * Trzy rodziny, bo tyle jest naprawdę: decyzja biura, ruch pieniędzy, praca
 * hali. Cofnięcia idą szarością — to fakt o pomyłce, a nie druga decyzja tej
 * samej wagi. Rodzaj nieznany (starszy wpis, nowy serwis) dostaje szarość
 * i SWOJĄ treść; milczenie byłoby gorsze niż wiersz bez koloru.
 */
const BARWA: Record<string, string> = {
  werdykt: "bg-sky-100 text-sky-900",
  ocena: "bg-sky-100 text-sky-900",
  kwota: "bg-sky-100 text-sky-900",
  korekta: "bg-emerald-100 text-emerald-800",
  pieniadze: "bg-emerald-100 text-emerald-800",
  przelew: "bg-emerald-100 text-emerald-800",
  odmowa: "bg-amber-100 text-amber-900",
  rabat: "bg-amber-100 text-amber-900",
  rozlozenie: "bg-violet-100 text-violet-800",
  kosz_pominiety: "bg-violet-100 text-violet-800",
  notatka: "bg-slate-100 text-slate-700",
};

const SZARY = "bg-slate-100 text-slate-600";

/** Krótkie nazwy rodzajów — czip ma się zmieścić obok godziny. */
const NAZWA: Record<string, string> = {
  werdykt: "decyzja",
  ocena: "ocena",
  ocena_cofnieta: "ocena cofnięta",
  kwota: "kwota",
  kwota_cofnieta: "kwota cofnięta",
  werdykt_cofniety: "decyzja cofnięta",
  korekta: "korekta",
  korekta_cofnieta: "korekta cofnięta",
  pieniadze: "pieniądze",
  odmowa: "odmowa wypłaty",
  przelew: "przelew",
  przelew_cofniety: "przelew cofnięty",
  rabat: "rabat",
  rozlozenie: "hala",
  kosz_pominiety: "hala",
  notatka: "notatka",
  notatka_zdjeta: "notatka",
  notatka_cofnieta: "notatka",
};

/**
 * Numer korekty bywa ZNALEZIONY, a nie przepisany — i to jest informacja.
 *
 * Ta sama zasada co przy dokumencie sprzedaży (§4.3): fakt z danych nie ma
 * udawać czyjejś decyzji. Automat podpisuje się w kolumnie `kto`, więc tu
 * wystarczy jedno słowo obok treści.
 */
function zrodlo(w: WpisOsiZwrotu): string | null {
  return w.dane && w.dane.zrodlo === "subiekt" ? "znaleziona w Subiekcie" : null;
}

export function Os({ wpisy }: { wpisy: WpisOsiZwrotu[] }) {
  /* Pusta oś NIE ZOSTAJE jako pusta ramka. Zwrot świeżo zaciągnięty z Allegro
     nie ma jeszcze żadnej decyzji, a pas szarości pod nagłówkiem mówiłby, że
     czegoś brakuje. Ten sam wybór co przy pasku przebiegu w skrzynce. */
  if (!wpisy.length) return null;

  return <ol className="space-y-2">
    {wpisy.map((w) => <li key={w.id} className="flex gap-2">
      <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
        BARWA[w.rodzaj] ?? SZARY}`}>
        {NAZWA[w.rodzaj] ?? w.rodzaj}
      </span>
      <div className="min-w-0">
        <p className="break-words">{w.tresc ?? "—"}</p>
        <p className="text-xs text-slate-500">
          {czas(w.kiedy)}
          {w.kto ? ` · ${w.kto}` : ""}
          {zrodlo(w) ? ` · ${zrodlo(w)}` : ""}
        </p>
      </div>
    </li>)}
  </ol>;
}
