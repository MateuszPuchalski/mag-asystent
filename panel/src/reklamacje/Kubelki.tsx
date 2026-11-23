import type { KubelekReklamacji } from "../api/typy";
import { FiltrZWiecej } from "../ui/FiltrZWiecej";
import { KUBELKI } from "./Kolejka";

/* ── Kubełki kolejki: praca na wierzchu, wgląd pod „Więcej” ─────────────────────────────────────
   Wszystkie widoki kolejki w jednym kształcie wyboru (`FiltrZWiecej`), w kolejności
   klawiszy 1–5. Na wierzchu stoją kubełki pracy, a rozstrzygnięte, bez ruchu
   i wszystkie — pod „Więcej”, jak w pozostałych kolejkach. Kafle z liczbami dnia i osobny rząd „pozostałych” były dwoma
   miejscami do jednego wyboru, a to więcej decyzji, nie mniej (dekalog,
   punkt 1). Praca stoi pierwsza, wgląd za nią.

   LICZBA TO DŁUGOŚĆ LISTY, KTÓRĄ PIGUŁKA POKAŻE. Liczy ją serwer z tej samej
   listy, którą dostaje ekran. Liczba z innego źródła obiecywałaby sprawy,
   których po kliknięciu nie ma. Trendy i średni czas do werdyktu stoją
   w Analizie, bo to wgląd, a nie praca.

   PO TERMINIE NIE MA WŁASNEJ PIGUŁKI. Sprawy po terminie stoją pierwsze pod
   własnym nagłówkiem z liczbą, więc osobny filtr pokazywałby to samo.

   BRAK LICZBY TO KRESKA, NIE ZERO. Przy awarii serwera pigułka mówi „—”, bo
   „0” agent czyta jako „nic nie czeka” (`panel/CLAUDE.md`). */

/** Widoki w kolejności klawiszy; `null` to „Wszystkie”. */
const WIDOKI: Array<KubelekReklamacji | null> = [...KUBELKI.map((k) => k.id), null];

/** Kubełki przeglądania, nie pracy — pod „Więcej”. */
const POD_WIECEJ: ReadonlyArray<KubelekReklamacji | null> = ["zamknieta", "bez_ruchu", null];

export function Kubelki({ wybrany, liczniki, wszystkich, onWybierz }: {
  wybrany: KubelekReklamacji | null;
  /** `undefined` = nie wiemy; wtedy każda pozycja mówi „—”. */
  liczniki?: Partial<Record<KubelekReklamacji, number>>;
  wszystkich?: number;
  onWybierz: (k: KubelekReklamacji | null) => void;
}) {
  const pozycje = WIDOKI.map((k, i) => {
    const opis = k === null ? null : KUBELKI.find((x) => x.id === k)!;
    const n = k === null ? wszystkich : liczniki?.[k];
    return {
      klucz: k,
      etykieta: opis?.etykieta ?? "Wszystkie",
      ile: n === undefined ? "—" as const : n,
      podpowiedz: `${opis?.pytanie ?? "Każda sprawa z kolejki."} (klawisz ${i + 1})`,
    };
  });
  return <div role="group" aria-label="Kubełki kolejki" className="flex flex-wrap items-center gap-1">
    <FiltrZWiecej<KubelekReklamacji | null> zwarty wybrany={wybrany} pozycje={pozycje} wiecej={POD_WIECEJ}
      onWybierz={onWybierz} />
  </div>;
}
