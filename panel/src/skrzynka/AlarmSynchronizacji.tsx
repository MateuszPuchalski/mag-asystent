import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { Zdrowie } from "../api/typy";
import { Przycisk, czas } from "../ui";

/* Wiek danych po ludzku. „2 g 36 min" mówi agentowi to, czego nie mówi
   znacznik czasu: ile pytań mogło przyjść, a on ich nie widzi. */
export function wiek(ms: number | null): string {
  if (ms == null) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "poniżej minuty";
  const g = Math.floor(min / 60);
  return g ? `${g} g ${min % 60} min` : `${min} min`;
}

const POWOD: Record<string, string> = {
  rate_limited: "Allegro odpowiada 429 i prosi o przerwę.",
  authentication_error: "Allegro odrzuca token — konto trzeba sparować ponownie.",
  failed: "Kolejne przebiegi kończą się błędem.",
  delayed: "Synchronizacja jest opóźniona.",
};

/**
 * Trwały alarm z §21 — po więcej niż dwóch nieudanych przebiegach.
 *
 * Baner jest TRWAŁY, bez przycisku zamknięcia. Alarm, który da się zdjąć
 * kliknięciem, znika przy pierwszym odruchu i wraca dopiero wtedy, gdy ktoś
 * zauważy, że kolejka nie rośnie od rana.
 */
export function AlarmSynchronizacji({ zdrowie, synchronizuj, trwa, blad }: {
  zdrowie: Zdrowie | undefined;
  synchronizuj: () => void;
  trwa: boolean;
  blad: string;
}) {
  const i = zdrowie?.allegroInbox;
  if (!i?.alarm) return null;

  /* Niesparowane konto to NIE jest awaria synchronizacji, choć wygląda tak
     samo: przebiegi padają, licznik rośnie, baner się zapala. Różnica jest
     w tym, co pomaga — SYNCHRONIZUJ TERAZ wywoła dokładnie ten sam błąd,
     bo próba bez tokena nie ma jak wyjść do Allegro.

     Przycisk, który na pewno nie zadziała, jest gorszy niż jego brak:
     obiecuje naprawę i zabiera uwagę od jedynej rzeczy, która działa. */
  const bezPolaczenia = zdrowie?.allegro?.stan === "niepolaczone"
    || zdrowie?.allegro?.stan === "zle_srodowisko";

  return <div className="shrink-0 rounded-xl border border-red-200 bg-red-50 p-4">
    <div className="flex flex-wrap items-center gap-3">
      <AlertTriangle className="text-ranga-zle" size={20} />
      <div className="mr-auto">
        <b className="text-ranga-zle">
          Synchronizacja Allegro nie powiodła się przez {i.liczbaBledow} przebiegi
        </b>
        <p className="mt-1 text-sm text-red-900">
          {/* Zdanie z serwera bije nasz słownik statusów: niesie POWÓD
              i instrukcję, a status niesie tylko ocenę. */}
          {zdrowie?.problemy?.[0] ?? i.tekstOstatniegoBledu
            ?? POWOD[i.status] ?? "Synchronizacja nie działa."}{" "}
          Panel pokazuje dane sprzed {wiek(i.opoznienieMs)} — nowe pytania klientów mogą już
          czekać, a ich tu nie widać.
        </p>
      </div>
      {!bezPolaczenia && <Przycisk onClick={synchronizuj} disabled={trwa}>
        <RefreshCw size={16} />{trwa ? "PRÓBA W TOKU…" : "SYNCHRONIZUJ TERAZ"}
      </Przycisk>}
    </div>
    {blad && <p className="mt-2 text-sm text-red-800">{blad}</p>}
    {/* Ręczna synchronizacja NIE omija przerwy — skraca tylko czekanie po jej
        końcu. Bez tego zdania przycisk obiecuje coś, czego nie robi. */}
    <p className="mt-2 text-xs text-red-800">
      Respektujemy Retry-After. Następna próba: {czas(i.nastepnaProba)}.
      Ręczna synchronizacja nie omija tej przerwy.
    </p>
  </div>;
}
