import React from "react";
import { ArrowRight, Lock, Paperclip } from "lucide-react";
import type { WpisOsi, ZalacznikOsi } from "../api/typy";
import { Przycisk } from "../ui";

/* Załączniki wiadomości (0.155.0). Sonda pokazała je w 7 z 39 wiadomości —
   do tej pory rozmowa milczała o tym, że klient coś przysłał.

   ADRES ALLEGRO NIE TRAFIA DO PRZEGLĄDARKI. Pobranie idzie przez naszą trasę,
   bo wymaga tokena konta firmy, a ten zostaje po stronie serwera.

   Plik nie do pobrania ZOSTAJE WIDOCZNY. Ukrycie kłamałoby, że klient nic nie
   przysłał; `UNSAFE` znaczy, że Allegro uznało go za niebezpieczny, a `EXPIRED`
   — że wygasł u nich. Agent ma wiedzieć, że coś było, i móc o to dopytać. */
const POWOD: Record<string, string> = {
  UNSAFE: "Allegro uznało plik za niebezpieczny",
  EXPIRED: "załącznik wygasł po stronie Allegro",
  NEW: "Allegro jeszcze go sprawdza",
};

function Zalaczniki({ lista }: { lista: ZalacznikOsi[] }) {
  return <ul className="mt-2 space-y-1 border-t pt-2 text-xs">
    {lista.map((z) => <li key={z.id} className="flex items-center gap-1.5">
      <Paperclip size={12} className="shrink-0 text-slate-400" />
      {z.doPobrania
        ? <a className="font-bold text-slate-700 underline hover:text-slate-900"
             href={`/api/obsluga/zalaczniki/${z.id}`}>{z.nazwa}</a>
        : <span className="text-slate-500">
            <span className="font-bold">{z.nazwa}</span>
            {" — "}{POWOD[z.status] ?? `stan ${z.status}`}
          </span>}
    </li>)}
  </ul>;
}

/* §10.3: każdy rodzaj wpisu ma wyglądać inaczej. Dziś rodzaje są dwa —
   wiadomość kanału i wynik z hali. Komentarze, zdarzenia systemowe i wpisy
   wysyłki dochodzą w kolejnych etapach i mają tu DOŁOŻYĆ gałąź, a nie
   przepisać tę. Barwy idą z tokenów `os.*`, nie z klas Tailwinda wprost. */
export function Os({ wpisy, zrodloPomiaru, mozeZlecac, onZrodlo, onWstawDoSzkicu }: {
  wpisy: WpisOsi[];
  zrodloPomiaru: number | null;
  mozeZlecac: boolean;
  onZrodlo: (messageId: number | null) => void;
  onWstawDoSzkicu: (tresc: string) => void;
}) {
  return <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
    {wpisy.map((w) => w.rodzaj === "status" || w.rodzaj === "sprawa"
      /* Zmiana statusu (§10.3, 0.158.0) i sklejenie sprawy (0.161.0) są
         KRESKĄ, nie kafelkiem: to nie czyjaś wypowiedź, tylko znak, że sprawa
         przeszła dalej. Kafelek w rzędzie wiadomości przerwałby czytanie
         rozmowy w biegu. */
      ? <p key={w.id} className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          <ArrowRight size={12} />{w.tresc} · {w.autor}
          <span className="h-px flex-1 bg-slate-200" />
        </p>
      : w.rodzaj === "komentarz"
      /* §6.4: komentarz ma być WIZUALNIE ODRÓŻNIONY od wiadomości klienta.
         Inna barwa to za mało — kłódka i podpis mówią wprost, że klient tego
         nie widzi, bo to jedyna rzecz, o którą tu naprawdę chodzi. */
      ? <article key={w.id} className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
            <Lock size={12} />NOTATKA WEWNĘTRZNA · {w.autor}
            {w.wzmianki?.length ? <span className="font-normal">
              · dla: {w.wzmianki.map((m) => m.name).join(", ")}</span> : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
        </article>
      : w.rodzaj === "wynik_zadania"
      ? <article key={w.id} className="rounded-lg border border-os-wynik-ramka bg-os-wynik p-3">
          <div className="text-xs font-bold uppercase text-ranga-ok">Wynik z magazynu · {w.autor}</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
          {/* Wynik nie staje się odpowiedzią sam — do szkicu trafia wyłącznie
              na jawne kliknięcie agenta. */}
          <Przycisk className="mt-2 text-xs" onClick={() => onWstawDoSzkicu(w.tresc)}>
            Wstaw wynik do szkicu</Przycisk>
        </article>
      : <article key={w.id} className={`rounded-lg border p-3 ${w.odKlienta
          ? "border-os-klient-ramka bg-os-klient" : "border-os-firma-ramka bg-os-firma"}`}>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <b>{w.autor}</b>
            {/* Nazwa przy ofercie jest Z ZAMÓWIENIA (§4.3) — mail Allegro
                „Wiadomość dotyczy" pokazuje tytuł, goły numer kazał agentowi
                szukać towaru drugi raz. Zamówienie skracamy: UUID w całości
                nikomu nic nie mówi, a całość niesie blok nad osią. */}
            {w.ofertaId && <span>· oferta {w.ofertaId}{w.nazwaOferty && ` — ${w.nazwaOferty}`}</span>}
            {w.zamowienieId && <span title={w.zamowienieId}>· zamówienie {w.zamowienieId.slice(0, 8)}…</span>}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
          {w.zalaczniki?.length ? <Zalaczniki lista={w.zalaczniki} /> : null}
          {w.odKlienta && mozeZlecac && <button
            className={`mt-2 text-xs font-bold ${
              zrodloPomiaru === w.messageId ? "text-amber-700" : "text-slate-500"}`}
            onClick={() => onZrodlo(zrodloPomiaru === w.messageId ? null : w.messageId!)}>
            {zrodloPomiaru === w.messageId ? "✓ źródło pomiaru" : "Zleć z tej wiadomości"}</button>}
        </article>)}
  </div>;
}
