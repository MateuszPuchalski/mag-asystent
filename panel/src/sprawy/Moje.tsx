import React, { useState } from "react";
import { FiltrSegmentowy } from "../ui";

/* ── Sito „Moje" dla reklamacji i dyskusji (0.278.0) ─────────────────────────
   POWSTAŁO Z JEDNEGO ZDANIA WŁAŚCICIELA: „chodziło mi, abym łatwiej mógł
   znaleźć reklamacje, którymi się zajmuję". Do tego wydania nie dało się tego
   zrobić wcale — kolejka miała kubełki etapu i szukanie po numerze, a po
   prowadzącym nie szukało nic.

   SITO, NIE KUBEŁEK, i to jest cała decyzja projektowa. Kubełek odpowiada na
   pytanie „na jakim to etapie", a właściciel pyta „czyje to". Wrzucenie obu
   w jeden rząd odebrałoby pytanie, które zadaje najczęściej: „moje sprawy do
   decyzji". Ten sam podział co przy kategoriach w skrzynce — kubełek mówi
   „czyje to", kategoria „o czym to" — tylko role są tu odwrócone.

   FOLDER `sprawy/`, bo `reklamacja_klienta` to JEDEN wiersz na reklamację
   i dyskusję, rozróżniany przez `typ`. Edytor i czat mieszkają w `reklamacje/`
   i są stamtąd wołane przez dyskusje, ale tam pierworodztwo jest prawdziwe:
   tamte komponenty powstały dla reklamacji. To sito powstaje dla obu naraz. */

/* ── DRUGA POŁOWA PYTANIA (0.281.0) ──────────────────────────────────────────
   „Które sprawy są moje" ma bliźniacze pytanie, bez którego pierwsze nie
   domyka pracy: „które są NICZYJE". Sprawa nieprzypisana nie trafia do nikogo
   sama — ktoś musi ją zobaczyć i wziąć. Sito pokazujące wyłącznie moje robiło
   z tego ślepą plamkę, i to plamkę PAMIĘTANĄ między otwarciami ekranu.

   JEDNO SITO O TRZECH STANACH, nie dwa przełączniki. Dwie osobne pigułki dałyby
   stan „moje i niczyje naraz", który nie znaczy nic, oraz „ani moje, ani
   niczyje", który znaczy „cudze" — a o cudze nikt tu nie pyta. Skrzynka ma te
   same pozycje w jednym rzędzie od §10.1 i to jest ten sam wybór.           */
export type Sito = "moje" | "niczyje" | null;

const KLUCZ = "wertis.sprawy.sito";

function zapamietane(): Sito {
  /* Prywatne okno rzuca przy odczycie — wybór zostaje wtedy na jedno otwarcie
     ekranu. Ten sam wzorzec co kolejność kolejki w skrzynce. */
  try {
    const v = localStorage.getItem(KLUCZ);
    return v === "moje" || v === "niczyje" ? v : null;
  } catch { return null; }
}

/**
 * Stan sita, trwały między otwarciami ekranu.
 *
 * PAMIĘTANY, bo „czyje to" jest nawykiem stanowiska, a nie decyzją na jedno
 * wejście. Cena tej pamięci jest jednak realna i płaci ją `ZdanieOUkrytych`
 * niżej: filtr, który pamięta i milczy, zagłodziłby sprawy spoza sita.
 */
export function useSito() {
  const [sito, ustaw] = useState<Sito>(zapamietane);
  const przelacz = (v: Sito) => {
    ustaw(v);
    try {
      if (v === null) localStorage.removeItem(KLUCZ);
      else localStorage.setItem(KLUCZ, v);
    } catch { /* prywatne okno */ }
  };
  return { sito, przelacz };
}

/** Czy sprawa przechodzi przez sito. `null` znaczy „bez zawężenia". */
export function wSicie(
  prowadziId: number | null, mojeId: number | null, sito: Sito,
): boolean {
  if (sito === null) return true;
  if (sito === "niczyje") return prowadziId === null;
  return mojaSprawa(prowadziId, mojeId);
}

/**
 * „1 sprawę", „2 sprawy", „5 spraw" — polszczyzna ma tu trzy formy, nie dwie.
 *
 * `dniSlowo` przy terminie reklamacji radzi sobie jednym wyjątkiem, bo tam
 * formy są dwie. Tutaj forma mnoga rozdwaja się na 2–4 i resztę, a nastolatki
 * (12–14) wracają do formy „spraw" mimo końcówki 2, 3 i 4.
 */
export function sprawSlowo(n: number): string {
  const ostatnia = n % 10;
  const dwie = n % 100;
  if (n === 1) return "1 sprawę";
  if (ostatnia >= 2 && ostatnia <= 4 && !(dwie >= 12 && dwie <= 14)) return `${n} sprawy`;
  return `${n} spraw`;
}

/** Czy sprawa jest moja. `mojeId === null` znaczy „nie wiem, kim jestem". */
export const mojaSprawa = (prowadziId: number | null, mojeId: number | null) =>
  mojeId !== null && prowadziId === mojeId;

/**
 * Pasek sita: „Moje" i „Niczyje" w jednym rzędzie.
 *
 * Przy nieznanej tożsamości NIE MA „Moje". Filtr, który zawsze daje pustkę,
 * jest gorszy od braku filtru — ta sama zasada co przy zamkniętej rozmowie
 * i przy spinaczu: czego nie da się zrobić, tego nie ma na ekranie.
 * „Niczyje" zostaje, bo do jego policzenia tożsamość nie jest potrzebna.
 */
export function PasekSita({ sito, mojeId, moich, niczyich, onPrzelacz }: {
  sito: Sito;
  mojeId: number | null;
  moich: number;
  niczyich: number;
  onPrzelacz: (v: Sito) => void;
}) {
  const pozycje = [
    ...(mojeId === null ? [] : [{
      klucz: "moje" as const, etykieta: "Moje", ile: moich,
      podpowiedz: "Sprawy, które prowadzę (klawisz m)",
    }]),
    {
      klucz: "niczyje" as const, etykieta: "Niczyje", ile: niczyich,
      podpowiedz: "Sprawy, których nikt jeszcze nie wziął (klawisz n)",
    },
  ];
  return <FiltrSegmentowy<Sito>
    wybrany={sito}
    /* Kliknięcie w WYBRANE sito je zdejmuje — to zawężenie listy, a nie
       kubełek. `FiltrSegmentowy` oddaje zawsze klucz klikniętej pozycji,
       więc `null` musi wyliczyć wołający. */
    onWybierz={(k) => onPrzelacz(sito === k ? null : k)}
    pozycje={pozycje} />;
}

/**
 * Ile spraw sito właśnie chowa.
 *
 * TO NIE JEST OZDOBA. Sito pamięta wybór między otwarciami, więc bez tego
 * zdania sprawa spoza sita mogłaby nie pokazać się nikomu przez tydzień —
 * ta sama klasa błędu co rozmowa urwana bez znaku w 0.273.0. Dekalog p. 6:
 * ograniczenie i uprzedzenie są tańsze od tłumaczenia po fakcie.
 */
export function ZdanieOUkrytych({ ile, nazwa, onPokazWszystkie }: {
  ile: number;
  /** Które sito chowa — zdanie ma wskazać TEN przełącznik, nie „jakiś filtr". */
  nazwa: string;
  onPokazWszystkie: () => void;
}) {
  if (ile <= 0) return null;
  return <p className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 text-podpis text-slate-600">
    <span>Sito „{nazwa}” chowa {sprawSlowo(ile)}.</span>
    {/* Cel dotyku bierze wysokość z własnego `py-1`, nie z akapitu: bez tego
        odnośnik miałby 16 px przy progu 24×24 z WCAG 2.2 AA (2.5.8). */}
    <button type="button" onClick={onPokazWszystkie}
      className="py-1 font-semibold text-slate-700 underline">pokaż wszystkie</button>
  </p>;
}
