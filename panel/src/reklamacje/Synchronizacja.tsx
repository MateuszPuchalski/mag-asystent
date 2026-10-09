import { RefreshCw } from "lucide-react";
import type { StanReklamacji } from "../api/typy";
import { godzina } from "../ui";

/* ── Synchronizacja przy tytule kolejki ──────────────────────────────────────
   Przycisk-ikona obok „Reklamacje” i drobne „Allegro: 15:10” pod tytułem.
   Stoi przy kolejce, bo synchronizacja odświeża właśnie tę listę. Pełny rząd
   nad kolumnami oddał przez to wysokość pracy.

   PRZYCISK JEST DOKŁADNIE JEDEN. Ekran dyskusji odsyła tutaj, a drugi
   przycisk byłby drugą drogą do limitu 429 u Allegro.

   W CISZY MÓWI GODZINĘ, W AWARII STAN. Zła synchronizacja barwi zdanie na
   czerwono, bo cicha lista z wczoraj wygląda jak lista z teraz. */

/** Statusy synchronizacji po polsku — ten sam słownik co na pasku zwrotów. */
const STANY: Record<StanReklamacji["status"], string> = {
  current: "działa",
  delayed: "opóźniona",
  rate_limited: "wstrzymana limitem Allegro",
  authentication_error: "odmowa logowania do Allegro",
  failed: "nie działa",
};

export function PrzyciskSynchronizacji({ trwa, onSynchronizuj }: {
  trwa: boolean; onSynchronizuj: () => void;
}) {
  /* Nazwa stała także w trakcie: czytnik ma wiedzieć, CO trwa, a obrót
     ikony mówi to samo oku. */
  return <button type="button" disabled={trwa} onClick={onSynchronizuj}
    aria-label="Synchronizuj z Allegro" aria-busy={trwa}
    title={trwa ? "Pobieram z Allegro…" : "Synchronizuj z Allegro"}
    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-50">
    <RefreshCw size={18} aria-hidden="true" className={trwa ? "motion-safe:animate-spin" : ""} />
  </button>;
}

/**
 * Zdania pod tytułem: godzina albo stan, błąd przycisku i niekompletna lista.
 *
 * NIEKOMPLETNA LISTA WOŁA TUTAJ. Kolejka stoi według terminu, więc brakujące
 * wiersze to zwykle te najbardziej spóźnione. Zero i `null` milczą: lista
 * skończyła się sama albo Allegro nie podało liczby.
 */
export function StanSynchronizacji({ stan, blad }: { stan?: StanReklamacji; blad: string }) {
  const zla = stan && stan.status !== "current";
  const zdanie = !stan ? "Allegro: stan nieznany"
    : zla ? `Synchronizacja Allegro: ${STANY[stan.status] ?? stan.status}${
      stan.kodOstatniegoBledu ? `, kod ${stan.kodOstatniegoBledu}` : ""}`
      : stan.ostatniaUdanaSynchronizacja
        ? `Allegro: ${godzina(stan.ostatniaUdanaSynchronizacja)}`
        : "Allegro: jeszcze nie synchronizowano";
  return <>
    <p className={`text-xs ${zla ? "font-semibold text-ranga-zle" : "text-slate-600"}`}>{zdanie}</p>
    {blad && <p className="text-xs text-ranga-zle">{blad}</p>}
    {stan?.pozostaloDoPobrania ? <p className="text-xs font-semibold text-ranga-zle">
      Ta kolejka nie jest kompletna: {stan.pozostaloDoPobrania} spraw czeka po stronie Allegro.
      {" "}Najstarszych reklamacji może tu jeszcze nie być.</p> : null}
  </>;
}
