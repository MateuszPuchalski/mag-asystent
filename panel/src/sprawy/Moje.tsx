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

const KLUCZ = "wertis.sprawy.moje";

function zapamietane(): boolean {
  /* Prywatne okno rzuca przy odczycie — wybór zostaje wtedy na jedno otwarcie
     ekranu. Ten sam wzorzec co kolejność kolejki w skrzynce. */
  try { return localStorage.getItem(KLUCZ) === "1"; } catch { return false; }
}

/**
 * Stan sita, trwały między otwarciami ekranu.
 *
 * PAMIĘTANY, bo „czyje to" jest nawykiem stanowiska, a nie decyzją na jedno
 * wejście. Cena tej pamięci jest jednak realna i płaci ją `ZdanieOUkrytych`
 * niżej: filtr, który pamięta i milczy, zagłodziłby sprawy nieprzypisane.
 */
export function useMoje() {
  const [moje, ustaw] = useState<boolean>(zapamietane);
  const przelacz = (v: boolean) => {
    ustaw(v);
    try { localStorage.setItem(KLUCZ, v ? "1" : "0"); } catch { /* prywatne okno */ }
  };
  return { moje, przelacz };
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
 * Pigułka sita.
 *
 * Przy nieznanej tożsamości NIE MA JEJ W DRZEWIE. Filtr, który zawsze daje
 * pustkę, jest gorszy od braku filtru — ta sama zasada co przy zamkniętej
 * rozmowie i przy spinaczu: czego nie da się zrobić, tego nie ma na ekranie.
 */
export function PigulkaMoje({ moje, mojeId, ile, onPrzelacz }: {
  moje: boolean;
  mojeId: number | null;
  ile: number;
  onPrzelacz: (v: boolean) => void;
}) {
  if (mojeId === null) return null;
  return <FiltrSegmentowy<"moje" | null>
    wybrany={moje ? "moje" : null}
    /* PRZEŁĄCZAMY ZE STANU, nie z wartości pigułki. `FiltrSegmentowy` oddaje
       zawsze klucz klikniętej pozycji, więc przy rzędzie jednoelementowym
       nigdy nie przyszłoby `null` i sito dałoby się tylko włączyć. Skrzynka
       robi to samo przy kategoriach, tam gdzie zna swój stan. */
    onWybierz={() => onPrzelacz(!moje)}
    pozycje={[{ klucz: "moje", etykieta: "Moje", ile,
      podpowiedz: "Sprawy, które prowadzę (klawisz m)" }]} />;
}

/**
 * Ile spraw sito właśnie chowa.
 *
 * TO NIE JEST OZDOBA. Sito pamięta wybór między otwarciami, więc bez tego
 * zdania sprawa nieprzypisana mogłaby nie pokazać się nikomu przez tydzień —
 * ta sama klasa błędu co rozmowa urwana bez znaku w 0.273.0. Dekalog p. 6:
 * ograniczenie i uprzedzenie są tańsze od tłumaczenia po fakcie.
 */
export function ZdanieOUkrytych({ ile, onPokazWszystkie }: {
  ile: number;
  onPokazWszystkie: () => void;
}) {
  if (ile <= 0) return null;
  return <p className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 text-podpis text-slate-600">
    <span>Sito „Moje” chowa {sprawSlowo(ile)}.</span>
    {/* Cel dotyku bierze wysokość z własnego `py-1`, nie z akapitu: bez tego
        odnośnik miałby 16 px przy progu 24×24 z WCAG 2.2 AA (2.5.8). */}
    <button type="button" onClick={onPokazWszystkie}
      className="py-1 font-semibold text-slate-700 underline">pokaż wszystkie</button>
  </p>;
}
