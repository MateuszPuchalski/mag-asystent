import React from "react";
import type { WpisOsiZwrotu } from "../api/typy";
import { czas } from "../ui";

/* ── Oś zwrotu (0.313.0) ─────────────────────────────────────────────────────
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
  /* Zadanie zlecone hali ze zwrotu wraca tu wynikiem albo odesłaniem (0.502.0). */
  zadanie_wynik: "bg-violet-100 text-violet-800",
  zadanie_odeslane: "bg-amber-100 text-amber-900",
  notatka: "bg-slate-100 text-slate-700",
};

const SZARY = "bg-slate-100 text-slate-600";

/** Krótkie nazwy rodzajów — czip ma się zmieścić obok godziny. Czyta je też
    pasek zdarzeń rozmowy (0.502.0), żeby zwrot nazywał się tak samo w obu. */
export const NAZWA_ZDARZENIA_ZWROTU: Record<string, string> = {
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
  zadanie_wynik: "hala",
  zadanie_odeslane: "hala odesłała",
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

/**
 * Przebieg zwrotu jednym zdaniem, całość na żądanie (@wydanie).
 *
 * Zgłoszenie agentów: „aplikacja przytłacza". Pełna lista stała otwarta pod
 * każdym zwrotem, a przy decyzji liczy się ostatni ruch — reszta jest
 * historią, po którą sięga się przy sprawie wracającej pytaniem. Ten sam
 * kształt co pasek zdarzeń rozmowy (`skrzynka/Os.tsx`, 0.506.0), żeby dwa
 * ekrany obsługi miały jeden nawyk. Kopia wzorca, nie import: tamten pasek
 * nie jest eksportowany i czyta zdarzenia rozmowy, nie wpisy zwrotu.
 *
 * Rozwinięcie pokazuje DOTYCHCZASOWĄ listę pionową — powód pionu stoi wyżej.
 */
export function PrzebiegZwrotu({ wpisy }: { wpisy: WpisOsiZwrotu[] }) {
  const [cala, setCala] = React.useState(false);
  /* Pusty przebieg milczy — powód przy `Os` niżej. */
  if (!wpisy.length) return null;
  /* Ostatni wpis to ostatni ruch, bo serwer oddaje oś od najstarszego. */
  const ostatni = wpisy[wpisy.length - 1]!;
  return <nav aria-label="Przebieg sprawy">
    {!cala
      ? <p className="text-podpis text-slate-600">
          {/* Treść wpisu w podpowiedzi: nazwa rodzaju mieści się w jednym
              wierszu, a pełne zdanie jest jednym najazdem myszy dalej. */}
          Ostatnio: <b title={ostatni.tresc ?? undefined} className="font-semibold text-slate-800">
            {NAZWA_ZDARZENIA_ZWROTU[ostatni.rodzaj] ?? ostatni.rodzaj}</b> · {czas(ostatni.kiedy)}{" · "}
          <button type="button" aria-expanded={false} onClick={() => setCala(true)}
            className="font-semibold text-sky-800 underline underline-offset-2">
            przebieg ({wpisy.length})</button>
        </p>
      : <>
          <button type="button" aria-expanded onClick={() => setCala(false)}
            className="mb-2 text-podpis font-semibold text-sky-800 underline underline-offset-2">zwiń</button>
          <Os wpisy={wpisy} />
        </>}
  </nav>;
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
        {NAZWA_ZDARZENIA_ZWROTU[w.rodzaj] ?? w.rodzaj}
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
