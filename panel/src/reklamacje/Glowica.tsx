import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Check, EllipsisVertical, ExternalLink } from "lucide-react";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";
import { dataCyfrowa, ile, LoginKlienta } from "../ui";
import { mojaSprawa } from "../sprawy/Moje";
import { tytulStatusu } from "./etap";
import { MenuPrzycisku } from "./Menu";

/* ── Głowica sprawy: która to reklamacja i czyja ─────────────────────────────
   Dwa rzędy nad drogą sprawy i rozmową. Pierwszy mówi, KTÓRA to sprawa i w
   jakim jest stanie, a obok stoi jedyna czynność głowicy: wzięcie sprawy.
   Drugi mówi, CZYJA: login do skopiowania, profil i inne sprawy klienta.

   NUMER JEST DRZWIAMI DO ALLEGRO. Agent porównuje sprawę z Centrum Sprzedaży
   po numerze, więc numer sam otwiera ją w nowej karcie. Osobny przycisk obok
   byłby drugim celem do jednej czynności.

   Fakty o towarze i zamówieniu stoją w prawej kolumnie, a etap sprawy rysuje
   droga pod głowicą. Głowica ich nie powtarza: jeden dom na fakt.

   Profil klienta domyka wiązanie drogi klienta w obie strony: profil prowadzi
   do reklamacji, a reklamacja do profilu (`docs/obsluga-klienta-calosc.md`). */

type Ton = "decyzja" | "zle" | "uwaga" | "ok" | "nic";

const KLASA_TONU: Record<Ton, string> = {
  decyzja: "bg-sky-50 text-sky-800",
  zle: "bg-red-50 text-ranga-zle",
  uwaga: "bg-orange-50 text-ranga-uwaga",
  ok: "bg-emerald-50 text-ranga-ok",
  nic: "bg-slate-100 text-ranga-nic",
};

/* Status w mapie, nie w łańcuchu `?:` — nowy kod Allegro dopisany do mapy
   dostaje własne słowo, a nieznany stoi surowo, zamiast udawać ostatnią gałąź. */
const STATUS: Record<string, { tekst: string; ton: Ton }> = {
  CLAIM_SUBMITTED: { tekst: "Czeka na decyzję", ton: "decyzja" },
  CLAIM_ACCEPTED: { tekst: "Uznana", ton: "ok" },
  CLAIM_REJECTED: { tekst: "Odrzucona", ton: "nic" },
  DISPUTE_ONGOING: { tekst: "Spór w Allegro", ton: "uwaga" },
  DISPUTE_CLOSED: { tekst: "Spór zamknięty", ton: "nic" },
  DISPUTE_UNRESOLVED: { tekst: "Spór nierozstrzygnięty", ton: "uwaga" },
};

/**
 * Stan sprawy jednym słowem do plakietki.
 *
 * NASZ werdykt przed potwierdzeniem Allegro wygrywa ze statusem Allegro:
 * status zmieni się dopiero po synchronizacji, a agent ma wiedzieć teraz,
 * że decyzja wyszła albo że nie przeszła.
 */
export function stanSprawy(r: Pick<Reklamacja, "statusAllegro" | "werdyktStatus" | "poTerminie">):
  { tekst: string; ton: Ton } {
  if (r.werdyktStatus === "send_failed") return { tekst: "Werdykt nie przeszedł", ton: "zle" };
  if (r.statusAllegro === "CLAIM_SUBMITTED") {
    if (r.werdyktStatus === "send_uncertain") return { tekst: "Werdykt niepewny", ton: "uwaga" };
    if (r.werdyktStatus === "sending" || r.werdyktStatus === "sent") {
      return { tekst: "Werdykt czeka na Allegro", ton: "uwaga" };
    }
    if (r.poTerminie) return { tekst: "Po terminie decyzji", ton: "zle" };
  }
  if (r.statusAllegro === null) return { tekst: "Bez statusu Allegro", ton: "nic" };
  return STATUS[r.statusAllegro] ?? { tekst: `Status: ${r.statusAllegro}`, ton: "nic" };
}

/**
 * Wzięcie sprawy — znacznik, nie zamek.
 *
 * Niczyją sprawę bierze się jednym kliknięciem, a własną tym samym odkłada.
 * Cudzej się tu nie odbiera: przekazanie z powodem to osobna droga.
 */
function Prowadze({ prowadzi, moja, trwa, onProwadze }: {
  prowadzi: string | null; moja: boolean; trwa: boolean; onProwadze: () => void;
}) {
  const rama = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50";
  if (prowadzi && !moja) {
    return <span className="text-sm text-slate-700">Prowadzi <b className="text-slate-900">{prowadzi}</b></span>;
  }
  return <button type="button" aria-pressed={moja} disabled={trwa} onClick={onProwadze}
    title={moja ? "Prowadzisz tę sprawę — kliknij, żeby ją odłożyć" : "Weź tę sprawę na siebie"}
    className={rama}>
    {moja && <Check size={14} aria-hidden="true" className="text-ranga-ok" />}
    {moja ? "Prowadzisz" : "Prowadzę"}</button>;
}

export function Glowica({
  szczegol, mojeId = null, trwa, blad = "", onProwadze,
  onOdswiez, odswieza = false,
}: {
  szczegol: SzczegolReklamacji;
  /** Konto patrzącego — po nim „Prowadzisz” zamiast cudzego imienia. */
  mojeId?: number | null;
  trwa: boolean;
  blad?: string;
  onProwadze: () => void;
  /** Jawne odświeżenie sprawy z Allegro, z menu „⋮”. */
  onOdswiez?: () => void;
  odswieza?: boolean;
}) {
  const r = szczegol.reklamacja;
  const numer = r.numer ?? r.externalId;
  const login = r.kupujacyLogin;
  const stan = stanSprawy(r);
  /* `null` serwer daje i przy zerze, i przy „nie wiemy”, więc wtedy nic nie
     stoi — ekran nigdy nie mówi „pierwsza reklamacja”. */
  const inne = szczegol.historia?.klient ?? null;

  /* Rzadkie czynności stoją pod „⋮”: każda to jawne kliknięcie, bo żądanie
     u Allegro nie wychodzi z samego patrzenia. Pytanie o paczkę stoi przy
     przesyłce w karcie zamówienia, bo tam widać też jego błąd. */
  const pozycje = onOdswiez ? [{ klucz: "odswiez", napis: odswieza ? "Odświeżam…" : "Odśwież z Allegro",
    onWybierz: onOdswiez, wylaczona: odswieza }] : [];

  return <div className="flex flex-col gap-2.5 px-5 py-4">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="min-w-0 text-tytul font-bold text-slate-900">
        {r.link
          ? <a href={r.link} target="_blank" rel="noopener noreferrer" title="Otwórz tę reklamację w Allegro"
              className="inline-flex flex-wrap items-center gap-1.5 text-slate-900 hover:underline">
              Reklamacja {numer}
              <ExternalLink size={16} aria-hidden="true" className="text-slate-600" />
              <span className="sr-only">(otwiera się w Allegro)</span></a>
          : <>Reklamacja {numer}</>}
      </h2>
      {/* Surowy kod Allegro zostaje w podpowiedzi, dla dokładnej wartości. */}
      <span title={tytulStatusu(r.statusAllegro)}
        className={`rounded-full px-2.5 text-xs font-bold leading-6 ${KLASA_TONU[stan.ton]}`}>
        {stan.tekst}</span>
      <div className="ml-auto flex items-center gap-1.5">
        <Prowadze prowadzi={r.prowadzi} moja={mojaSprawa(r.prowadziId, mojeId)} trwa={trwa}
          onProwadze={onProwadze} />
        <MenuPrzycisku etykieta="Więcej działań" nazwaPrzycisku="Więcej działań" pozycje={pozycje}
          przycisk={<EllipsisVertical size={16} aria-hidden="true" />}
          klasaPrzycisku="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-900 hover:bg-slate-50" />
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-slate-600">
      {login
        ? <>
            <LoginKlienta login={login}
              className="min-h-8 rounded-lg border border-slate-200 bg-slate-100 px-2.5 font-mono text-tresc font-bold text-slate-900" />
            <RouterLink to={`/obsluga/klient/${encodeURIComponent(login)}`}
              title="Profil klienta — zakupy, zwroty, reklamacje i rozmowy"
              className="inline-flex min-h-6 items-center font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
              Profil klienta</RouterLink>
          </>
        /* Brak loginu mówi o sobie: pusty slot czytałby się jak awaria, a to
           Allegro go nie podało. Bez loginu nie ma czyjego profilu. */
        : <span>kupujący: Allegro nie podało loginu</span>}
      {login && inne && inne.ile > 0 &&
        <span>{ile(inne.ile, "inna reklamacja", "inne reklamacje", "innych reklamacji")}</span>}
      <span>Zgłoszono {dataCyfrowa(r.otwartoAt)}</span>
    </div>
    {blad && <p className="text-sm text-ranga-zle">{blad}</p>}
  </div>;
}
