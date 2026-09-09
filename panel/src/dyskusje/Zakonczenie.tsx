import React, { useState } from "react";
import { Scale, Send } from "lucide-react";
import type { Dyskusja } from "../api/typy";
import { Przycisk, czas } from "../ui";
import { LIMIT_ZNAKOW } from "../reklamacje/Edytor";

/* ── Prośba o zakończenie dyskusji (0.245.0) ─────────────────────────────────
   PRZYCISK NAZYWA SIĘ „POPROŚ O ZAKOŃCZENIE", NIE „ZAKOŃCZ", i to jest
   najważniejsza decyzja tego pliku. Allegro nazywa tę wartość `END_REQUEST` —
   żądaniem zakończenia — i nigdzie, ani w schemacie, ani w opisie, nie
   obiecuje, że dyskusja zamknie się od naszego kliknięcia. Przycisk mówiący
   „ZAKOŃCZ" obiecywałby skutek, którego nie znamy; to ten sam rodzaj
   zgadywania, który do 0.155.0 trzymał w kodzie adres, jakiego Allegro nie ma.

   ZAMKNIĘCIE POTWIERDZA SYNCHRONIZACJA, nie nasz strzał. Do czasu, aż wróci
   `DISPUTE_CLOSED`, pasek mówi „poprosiliśmy" — tak samo, jak zieleń przy
   pieniądzach należy się dopiero potwierdzeniu (0.209.0).

   POTWIERDZENIE ZAMIAST COFNIĘCIA (§25a.5): prośba idzie do kupującego od
   razu i drugiej nie wyślemy, bo pierwsza mogła dojść. Zgoda jest
   KLIKNIĘCIEM W ZDANIE, które mówi, co się stanie, a nie oknem „na pewno?".

   WIADOMOŚĆ JEST WYMAGANA. `MessageRequest` ma `text` na liście `required`,
   ale powód jest głębszy niż schemat: prośba o zamknięcie sprawy bez ani
   jednego zdania to dla człowieka po drugiej stronie zamknięcie drzwi bez
   słowa. Limit znaków jest TEN SAM co w czacie — agent nie ma uczyć się
   dwóch liczb dla dwóch pól tego samego ekranu.                             */

const ZDANIE_STARTOWE =
  "Uznaję sprawę za wyjaśnioną i proszę o zakończenie dyskusji. "
  + "Gdyby coś jeszcze wymagało uwagi, proszę o wiadomość.";

export function Zakonczenie({ dyskusja, wysyla, blad, onZakoncz }: {
  dyskusja: Dyskusja;
  wysyla: boolean;
  blad: string;
  onZakoncz: (tresc: string) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [tresc, setTresc] = useState(ZDANIE_STARTOWE);
  const [zgoda, setZgoda] = useState(false);

  /* JUŻ POPROSZONO — przycisku nie ma wcale, zamiast wyszarzonego, który
     zaprasza do kliknięcia i odmawia. `send_uncertain` mówi wprost, czego
     NIE robić: drugiej prośby nie wysyłamy, bo pierwsza mogła dojść. */
  if (dyskusja.zakonczenieStatus) {
    const niepewny = dyskusja.zakonczenieStatus === "send_uncertain";
    return <div className={`rounded-lg border px-3 py-2 text-xs ${
      niepewny ? "border-amber-300 bg-amber-50 text-ranga-uwaga"
        : "border-slate-200 bg-slate-50 text-slate-600"}`}>
      <span className="inline-flex items-center gap-1 font-bold">
        <Scale size={13} />
        {niepewny
          ? "Prośba o zakończenie poszła, ale Allegro nie potwierdziło"
          : "Poproszono o zakończenie tej dyskusji"}
      </span>
      <span className="ml-1">
        {dyskusja.zakonczeniePrzez ? `· ${dyskusja.zakonczeniePrzez} ` : ""}
        {dyskusja.zakonczenieAt ? `· ${czas(dyskusja.zakonczenieAt)}` : ""}
      </span>
      <p className="mt-1">
        {niepewny
          ? "Nie wysyłaj drugiej prośby — sprawdź stan w Centrum Sprzedaży."
          : "Dyskusję zamyka Allegro, nie my. Stan zmieni się po synchronizacji."}
      </p>
    </div>;
  }

  /* ZAMKNIĘTEJ ROZMOWY NIE DA SIĘ ZAKOŃCZYĆ — paska tu nie ma, nie jest
     wyłączony. Ta sama decyzja co przy edytorze. */
  if (!dyskusja.czatAktywny) return null;

  if (!otwarte) {
    return <div>
      <Przycisk onClick={() => setOtwarte(true)}>
        <Scale size={16} />POPROŚ O ZAKOŃCZENIE
      </Przycisk>
    </div>;
  }

  const zaDlugo = tresc.length > LIMIT_ZNAKOW;
  const gotowe = Boolean(tresc.trim()) && !zaDlugo && zgoda && !wysyla;

  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
    <p className="mb-2 text-xs font-bold text-slate-700">
      Prośba o zakończenie dyskusji
    </p>
    {/* Zdanie startowe jest DO EDYCJI, nie do wysłania w ciemno — ten sam
        wybór co przy kroku „towar do odesłania?". */}
    <label className="block text-xs text-slate-600" htmlFor="zakonczenieTresc">
      Wiadomość dla kupującego — Allegro nie przyjmie prośby bez niej
    </label>
    <textarea
      id="zakonczenieTresc"
      className="field mt-1 h-24 w-full"
      value={tresc}
      onChange={(e) => setTresc(e.target.value)}
    />
    {zaDlugo && <p className="mt-1 text-xs font-bold text-ranga-zle">
      Za długa o {tresc.length - LIMIT_ZNAKOW} znaków
    </p>}
    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-slate-700">
      <input type="checkbox" className="mt-0.5" checked={zgoda}
        onChange={(e) => setZgoda(e.target.checked)} />
      <span>
        Rozumiem: prośba trafia do kupującego od razu i nie da się jej cofnąć.
        Dyskusję zamyka Allegro, nie to kliknięcie.
      </span>
    </label>
    {blad && <p className="mt-2 text-xs font-bold text-ranga-zle">{blad}</p>}
    <div className="mt-2 flex gap-2">
      <Przycisk wariant="glowny" disabled={!gotowe} onClick={() => onZakoncz(tresc)}>
        <Send size={16} />{wysyla ? "WYSYŁAM…" : "WYŚLIJ PROŚBĘ"}
      </Przycisk>
      <Przycisk onClick={() => { setOtwarte(false); setZgoda(false); }}>ANULUJ</Przycisk>
    </div>
  </div>;
}
