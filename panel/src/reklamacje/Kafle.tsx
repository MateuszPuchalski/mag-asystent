import React from "react";
import { ChartColumn, Clock, MessageSquare, RefreshCw, SquareCheckBig } from "lucide-react";
import type {
  KubelekReklamacji, LicznikZTrendem, StanReklamacji, StatystykiReklamacji,
} from "../api/typy";
import { dniSlowo, godzina } from "../ui";

/* ── Kafle nad kolumnami ─────────────────────────────────────────────────────
   Cztery liczby, które biuro sprawdza przed pierwszą sprawą dnia: ile czeka
   na decyzję, ile na odpowiedź, ile już po terminie i jak szybko decydujemy.
   Liczy je serwer na CAŁEJ tabeli, więc próg daty kolejki ich nie zmienia.

   KAFEL KUBEŁKA JEST FILTREM. Liczba „Do decyzji” i lista spraw do decyzji to
   jedno pytanie, więc kliknięcie w kafel przestawia kolejkę. Dwa miejsca do
   jednego wyboru to więcej decyzji, nie mniej (dekalog, punkt 1).

   BRAK DANYCH TO KRESKA, NIE ZERO (`panel/CLAUDE.md`). Zero przy awarii
   serwera agent czyta jako „nic nie czeka” i kończy pracę.

   TREND TYLKO PRAWDZIWY. Gdy serwer nie umie odtworzyć stanu sprzed tygodnia,
   kafel mówi, co liczba znaczy, zamiast udawać zmianę od zera. */

/** Statusy synchronizacji po polsku — ten sam słownik co na pasku zwrotów. */
const STANY: Record<StanReklamacji["status"], string> = {
  current: "działa",
  delayed: "opóźniona",
  rate_limited: "wstrzymana limitem Allegro",
  authentication_error: "odmowa logowania do Allegro",
  failed: "nie działa",
};

/** Minus typograficzny, bo łącznik przy liczbie czyta się jak myślnik. */
const zeZnakiem = (n: number, napis: string) => `${n > 0 ? "+" : "−"}${napis}`;

/** Jedno miejsce po przecinku, po polsku — bez formatera, bo to nie data. */
const ulamek = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** „2,4 dnia”, ale „1 dzień” i „3 dni” — ułamek bierze dopełniacz. */
function dniUlamkiem(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? dniSlowo(r) : `${ulamek(r)} dnia`;
}

/** Trend tygodniowy albo zdanie opisowe, gdy trendu nie da się policzyć. */
function podpisLicznika(l: LicznikZTrendem | undefined, opis: string): string {
  if (!l) return "nie wiemy";
  if (l.tydzienTemu === null) return opis;
  const d = l.teraz - l.tydzienTemu;
  if (d === 0) return "tyle samo co tydzień temu";
  return `${zeZnakiem(d, String(Math.abs(d)))} od zeszłego tygodnia`;
}

function podpisSredniej(s: StatystykiReklamacji["sredniDniDoWerdyktu"] | undefined): string {
  if (!s) return "nie wiemy";
  if (s.teraz === null) return `brak werdyktów w ostatnich ${dniSlowo(s.okresDni)}`;
  if (s.poprzednio === null) return `z ostatnich ${dniSlowo(s.okresDni)}`;
  const d = Math.round((s.teraz - s.poprzednio) * 10) / 10;
  if (d === 0) return `tyle samo co poprzednie ${dniSlowo(s.okresDni)}`;
  return `${zeZnakiem(d, dniUlamkiem(Math.abs(d)))} od poprzednich ${dniSlowo(s.okresDni)}`;
}

interface OpisKafla {
  etykieta: string;
  wartosc: string;
  podpis: string;
  ikona: React.ReactNode;
  /** Tło i barwa kwadratu z ikoną — barwa mówi o randze, nie zdobi. */
  tonIkony: string;
  /** Barwa liczby; czerwień tylko przy pracy po terminie. */
  tonWartosci?: string;
  /** Kubełek, który kafel przestawia; bez niego kafel tylko mówi. */
  kubelek?: KubelekReklamacji;
}

function Kafel({ k, wybrany, onWybierz }: {
  k: OpisKafla; wybrany: boolean; onWybierz?: (k: KubelekReklamacji) => void;
}) {
  const tresc = <>
    <span aria-hidden="true"
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${k.tonIkony}`}>
      {k.ikona}</span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-sm font-medium text-slate-600">{k.etykieta}</span>
      <span className={`text-2xl font-bold tabular-nums ${k.tonWartosci ?? "text-slate-900"}`}>
        {k.wartosc}</span>
      <span className="text-xs text-slate-600">{k.podpis}</span>
    </span>
  </>;
  /* Ramka dwupikselowa przy KAŻDYM kaflu, zmienia się tylko barwa — wybór
     nie przesuwa treści o piksel, tak jak belka przy wierszu kolejki. */
  const rama = "flex min-w-0 items-center gap-3 rounded-xl border-2 bg-white px-4 py-3 text-left shadow-sm";
  if (!k.kubelek || !onWybierz) {
    return <div className={`${rama} border-slate-200`}>{tresc}</div>;
  }
  const kubelek = k.kubelek;
  return <button type="button" aria-pressed={wybrany} onClick={() => onWybierz(kubelek)}
    title={`Pokaż w kolejce: ${k.etykieta}`}
    className={`${rama} hover:bg-slate-50 ${wybrany ? "border-wertis-ink" : "border-slate-200"}`}>
    {tresc}</button>;
}

/**
 * Stan synchronizacji z jedynym przyciskiem „Synchronizuj” na ekranie.
 *
 * PRZYCISK JEST DOKŁADNIE JEDEN. Ekran dyskusji odsyła tutaj, a drugi
 * przycisk byłby drugą drogą do limitu 429 u Allegro.
 *
 * W CISZY MÓWI GODZINĘ, W AWARII STAN. Zła synchronizacja barwi zdanie na
 * czerwono, bo cicha lista z wczoraj wygląda jak lista z teraz.
 */
function Synchronizacja({ stan, trwa, blad, onSynchronizuj }: {
  stan?: StanReklamacji; trwa: boolean; blad: string; onSynchronizuj: () => void;
}) {
  const zla = stan && stan.status !== "current";
  const zdanie = !stan ? "Allegro: stan synchronizacji nieznany"
    : zla ? `Synchronizacja Allegro: ${STANY[stan.status] ?? stan.status}${
      stan.kodOstatniegoBledu ? `, kod ${stan.kodOstatniegoBledu}` : ""}`
      : stan.ostatniaUdanaSynchronizacja
        ? `Allegro: zsynchronizowano ${godzina(stan.ostatniaUdanaSynchronizacja)}`
        : "Allegro: jeszcze nie synchronizowano";
  return <div className="flex flex-[1_1_14rem] flex-wrap items-center justify-end gap-x-3 gap-y-1">
    <span className={`text-sm ${zla ? "font-semibold text-ranga-zle" : "text-slate-600"}`}>{zdanie}</span>
    <button type="button" disabled={trwa} onClick={onSynchronizuj}
      className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50">
      <RefreshCw size={16} aria-hidden="true" />
      {trwa ? "Pobieram…" : "Synchronizuj"}</button>
    {blad && <p className="basis-full text-right text-sm text-ranga-zle">{blad}</p>}
  </div>;
}

/**
 * Ile spraw NIE WESZŁO do kolejki — bezpiecznik stron urywa listę cicho.
 *
 * Kolejka stoi według terminu, więc brakujące wiersze to zwykle te najbardziej
 * spóźnione. Zero i `null` milczą: lista skończyła się sama albo Allegro nie
 * podało liczby.
 */
function NiekompletnaLista({ stan }: { stan?: StanReklamacji }) {
  if (!stan?.pozostaloDoPobrania) return null;
  return <p className="basis-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
    <b>Ta kolejka nie jest kompletna: {stan.pozostaloDoPobrania} spraw czeka po stronie Allegro.</b>{" "}
    Dociągną się kolejnymi przebiegami, ale do tego czasu najstarszych reklamacji może tu nie być.
  </p>;
}

export function Kafle({ statystyki, kubelek, onKubelek, stan, trwaSync, bladSync, onSynchronizuj }: {
  /** `undefined` = nie wiemy: serwer milczy albo zapytanie padło. */
  statystyki?: StatystykiReklamacji;
  kubelek: KubelekReklamacji | null;
  onKubelek: (k: KubelekReklamacji) => void;
  stan?: StanReklamacji;
  trwaSync: boolean;
  bladSync: string;
  onSynchronizuj: () => void;
}) {
  const s = statystyki;
  const liczba = (l?: LicznikZTrendem) => (l ? String(l.teraz) : "—");
  const kafle: OpisKafla[] = [
    { etykieta: "Do decyzji", wartosc: liczba(s?.doDecyzji), kubelek: "decyzja",
      podpis: podpisLicznika(s?.doDecyzji, "czekają na uznanie albo odrzucenie"),
      ikona: <SquareCheckBig size={22} />, tonIkony: "bg-slate-100 text-slate-800" },
    { etykieta: "Do odpowiedzi", wartosc: liczba(s?.doOdpowiedzi), kubelek: "odpowiedz",
      podpis: podpisLicznika(s?.doOdpowiedzi, "klient napisał, czeka na nas"),
      ikona: <MessageSquare size={22} />, tonIkony: "bg-sky-50 text-sky-700" },
    { etykieta: "Po terminie", wartosc: liczba(s?.poTerminie),
      podpis: podpisLicznika(s?.poTerminie, "minął termin decyzji"),
      tonWartosci: s && s.poTerminie.teraz > 0 ? "text-ranga-zle" : undefined,
      ikona: <Clock size={22} />, tonIkony: "bg-red-50 text-ranga-zle" },
    { etykieta: "Średni czas do werdyktu",
      wartosc: s?.sredniDniDoWerdyktu.teraz != null ? dniUlamkiem(s.sredniDniDoWerdyktu.teraz) : "—",
      podpis: podpisSredniej(s?.sredniDniDoWerdyktu),
      ikona: <ChartColumn size={22} />, tonIkony: "bg-emerald-50 text-ranga-ok" },
  ];
  return <section aria-label="Reklamacje w liczbach" className="flex shrink-0 flex-wrap items-center gap-4">
    <div className="grid min-w-0 flex-[999_1_40rem] grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4">
      {kafle.map((k) => <Kafel key={k.etykieta} k={k}
        wybrany={k.kubelek !== undefined && k.kubelek === kubelek} onWybierz={onKubelek} />)}
    </div>
    <Synchronizacja stan={stan} trwa={trwaSync} blad={bladSync} onSynchronizuj={onSynchronizuj} />
    <NiekompletnaLista stan={stan} />
  </section>;
}
