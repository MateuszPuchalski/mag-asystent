import React from "react";
import { FileText } from "lucide-react";
import type { FakturaZwrotu, KandydatFaktury } from "../api/typy";
import { Skopiuj } from "../ui";

/* ── Dokument sprzedaży z Subiekta (0.174.0) ─────────────────────────────────
   Ostatnia pozycja z listy biura zwrotów: „widoczny numer paragonu". Bez niego
   pracownik szukał sprzedaży w Subiekcie ręcznie — po dacie i nazwisku, bo nic
   innego nie miał.

   Ekran rozróżnia trzy stany i to jest cała jego treść:

     numer   — automat dopasował po numerze zamówienia NA dokumencie; pewne,
     ręczne  — wskazał człowiek; też fakt, ale czyjś wybór i tak się podpisuje,
     brak    — kandydaci z jawnym powodem albo szczere „nie wiem".

   Nakładka pozycji sama z siebie NIE WIĄŻE. Firma ogrodnicza sprzedaje ten sam
   sekator dziesięć razy dziennie, więc „wszystkie zwracane towary są na tym
   dokumencie" bywa prawdą o kilkunastu dokumentach naraz — a zły dokument
   znaczy korektę do cudzej sprzedaży.                                        */

export function Dokument({ faktura, kandydaci, trwa, blad, onWskaz }: {
  faktura: FakturaZwrotu;
  kandydaci: KandydatFaktury[];
  trwa: boolean;
  blad: string;
  onWskaz: (dokId: number | null) => void;
}) {
  if (faktura.dokId !== null) {
    return <div className="text-xs">
      {/* Numer do SCHOWKA (0.176.0). Kliknięcie nie otwiera dokumentu
          w Subiekcie i nie otworzy go z przeglądarki: okno wystawia program
          na stanowisku, nie serwer. Do czasu, aż taki program stanie
          (`docs/architektura.md` §4), schowek jest najkrótszą drogą — numer
          wkleja się w „Znajdź dokument" Subiekta. */}
      <p className="flex items-center gap-1 text-base font-bold">
        {faktura.numer}
        {faktura.numer && <Skopiuj tekst={faktura.numer}
          tytul="Kopiuj numer dokumentu — wklej w wyszukiwanie Subiekta" />}</p>
      {/* Skąd się wziął, jest częścią informacji: wybór człowieka nie ma
          udawać faktu z danych (projekt panelu §4.3). */}
      <p className="mt-0.5 text-slate-500">
        {faktura.zrodlo === "numer"
          ? "Numer zamówienia stoi na tym dokumencie."
          : `Wskazał(a) ${faktura.przez ?? "ktoś z biura"}.`}
      </p>
      <button type="button" disabled={trwa} onClick={() => onWskaz(null)}
        className="mt-1 text-slate-500 underline underline-offset-2 hover:text-slate-800">
        to nie ten dokument</button>
      {blad && <p className="mt-1 text-red-700">{blad}</p>}
    </div>;
  }

  if (kandydaci.length === 0) {
    return <div className="text-xs text-slate-500">
      <p>Nie znalazłem dokumentu sprzedaży dla tego zwrotu.</p>
      {/* Trzy powody i wszystkie prawdziwe — bez nich „nie znalazłem" wygląda
          na awarię, a bywa po prostu starą sprzedażą albo brakiem kartoteki. */}
      <p className="mt-1">
        Sprzedaż bywa starsza niż okno importu, integracja nie zawsze wpisuje
        numer zamówienia na dokument, a bez potwierdzonej kartoteki nie ma
        po czym dopasować towarów.</p>
      {blad && <p className="mt-1 text-red-700">{blad}</p>}
    </div>;
  }

  return <div className="text-xs">
    <p className="text-slate-600">
      Nie wiem, który to dokument. {kandydaci.length === 1 ? "Jeden pasuje" : "Pasuje kilka"} —
      wskaż właściwy:</p>
    <ul className="mt-1 space-y-1">
      {kandydaci.map((k) => <li key={k.dokId}
        className="rounded-lg bg-slate-50 px-2 py-1">
        <button type="button" disabled={trwa} onClick={() => onWskaz(k.dokId)}
          className="font-semibold text-sky-700 underline underline-offset-2">
          {k.numer}</button>
        <span className="ml-2 text-slate-500">{k.data}</span>
        {/* Powód przy KAŻDYM kandydacie — człowiek wybiera, więc ma widzieć,
            czemu akurat te dokumenty tu stoją. */}
        <p className="mt-0.5 text-slate-500">{k.powody.join("; ")}</p>
      </li>)}
    </ul>
    {blad && <p className="mt-1 text-red-700">{blad}</p>}
  </div>;
}

/** Ikona sekcji — trzymana obok komponentu, żeby kolumna jej nie wymyślała. */
export const ikonaDokumentu = <FileText size={14} />;
