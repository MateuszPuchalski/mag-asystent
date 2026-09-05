import React from "react";
import { ImageOff, PackageSearch, ShoppingBag } from "lucide-react";
import { useZdjecie, useZdjecieOferty } from "./useZdjecie";

/* Kafel zdjęcia o STAŁYM rozmiarze — także wtedy, gdy zdjęcia nie ma i gdy
   jeszcze się ładuje. To jest lekcja z `biuro.html`: kafel, który rośnie po
   doładowaniu, przesuwa wiersze pod kursorem i operator klika nie w ten
   zwrot, w który celował.

   ── DWA BRAKI, DWA ZNAKI (0.203.0) ────────────────────────────────────────
   Kafel odpowiada na dwa różne pytania i myli je, dopóki wygląda tak samo.
   „Bez kartoteki" znaczy: nie wiadomo, o który towar chodzi — i to jest
   praca dla agenta. „Bez zdjęcia" znaczy: towar znany, obrazu w Subiekcie
   nie ma — i tu agent nie zrobi nic. Pierwszy brak nosi więc `PackageSearch`,
   ten sam znak, którym `TowarRozmowy.tsx` opisuje brak kartoteki w zdaniu
   obok; drugi nosi `ImageOff`.

   Słowo „bez zdjęcia" zostaje na kaflach od 44 px w górę — czyli wszędzie,
   gdzie stało do 0.202.0, bo w dwóch wierszach dziewięciopunktowego pisma
   jeszcze się mieści. Próg jest dla kafli MNIEJSZYCH, które weszły w tym
   wydaniu: negatyw doboru ma 36 px i słowo by się w nim rozjechało. */

/**
 * Sama PŁYTKA — pudełko o stałym rozmiarze z trzema stanami (0.211.0).
 *
 * Wydzielona, bo od tego wydania obrazy mają dwa źródła: kartotekę Subiekta
 * i ofertę Allegro. Wygląd, rozmiary i próg słowa „bez zdjęcia" mają zostać
 * WSPÓLNE — dwa kafle różniące się o dwa piksele czytałyby się jak dwa różne
 * rodzaje rzeczy. Różnią się wyłącznie zdania o braku, bo brak znaczy tam
 * co innego.
 */
function Plytka({ url, rozmiar, nazwa, tytul, brakTytul, brakSlowo, brakIkona, pusteTytul, pusteIkona, puste, onKlik }: {
  url: string | null | undefined;
  rozmiar: number;
  nazwa: string;
  /** Co to za obraz — na `title`. Dwa kafle obok siebie muszą dać się rozróżnić. */
  tytul: string;
  /** Stan „źródło znane, obrazu nie ma". */
  brakTytul: string;
  brakSlowo: string;
  brakIkona: React.ReactNode;
  /** Stan „nie wiadomo, o co pytać" — `puste` włącza go zamiast pobierania. */
  puste: boolean;
  pusteTytul: string;
  pusteIkona: React.ReactNode;
  onKlik?: () => void;
}) {
  const styl = { width: rozmiar, height: rozmiar } as React.CSSProperties;
  const wspolne = "shrink-0 rounded-lg border border-slate-200 bg-slate-50";

  if (puste) {
    return <div style={styl} title={pusteTytul}
      className={`${wspolne} grid place-items-center border-dashed text-slate-400`}>{pusteIkona}</div>;
  }
  if (url === undefined) {
    return <div style={styl} className={`${wspolne} animate-pulse`} aria-hidden="true" />;
  }
  if (url === null) {
    return <div style={styl} title={brakTytul}
      className={`${wspolne} grid place-items-center border-dashed text-[9px] font-bold uppercase leading-tight text-slate-400`}>
      {rozmiar >= 44 ? brakSlowo : brakIkona}
    </div>;
  }
  const obraz = <img src={url} alt={nazwa} title={tytul} style={styl}
    className={`${wspolne} object-cover`} />;
  return onKlik
    ? <button type="button" onClick={onKlik} title={`${tytul} — powiększ`} className="shrink-0">{obraz}</button>
    : obraz;
}

export function Zdjecie({ twId, rozmiar = 48, nazwa, onKlik }: {
  twId: number | null;
  rozmiar?: number;
  nazwa?: string;
  onKlik?: () => void;
}) {
  const url = useZdjecie(twId);
  const ikona = Math.max(12, Math.round(rozmiar / 3));
  return <Plytka url={url} rozmiar={rozmiar} nazwa={nazwa ?? "Zdjęcie towaru"} onKlik={onKlik}
    tytul="Zdjęcie kartoteki — Subiekt GT"
    /* Bez kartoteki nie ma czym pokazać obrazu — i ekran ma to POWIEDZIEĆ,
       bo to jest zaproszenie do wskazania towaru, nie awaria. */
    puste={twId == null}
    pusteTytul="Bez kartoteki — wskaż towar, żeby zobaczyć zdjęcie"
    pusteIkona={<PackageSearch size={ikona} />}
    brakTytul="Kartoteka nie ma zdjęcia"
    brakSlowo="bez zdjęcia"
    brakIkona={<ImageOff size={ikona} />} />;
}

/**
 * Zdjęcie listingowe oferty Allegro (0.211.0).
 *
 * Trzy stany mówią co innego i to jest cały powód, dla którego nie da się tu
 * użyć `Zdjecie` z innym adresem:
 * - bez numeru oferty — rozmowa albo pozycja nie jest z niczym powiązana,
 * - obrazu nie ma — Allegro nie podało adresu ALBO snapshot jeszcze nie
 *   przyjechał, a to naprawia się samo przy najbliższej synchronizacji,
 * - obraz jest — to, co klient widział na liście.
 *
 * Znak pustego stanu to koszyk, nie lupa nad paczką: brak oferty jest tu
 * faktem o SPRZEDAŻY, nie zaproszeniem do wskazania kartoteki.
 */
export function ZdjecieOferty({ externalId, rozmiar = 48, nazwa, onKlik }: {
  externalId: string | null;
  rozmiar?: number;
  nazwa?: string;
  onKlik?: () => void;
}) {
  const url = useZdjecieOferty(externalId);
  const ikona = Math.max(12, Math.round(rozmiar / 3));
  return <Plytka url={url} rozmiar={rozmiar} nazwa={nazwa ?? "Zdjęcie oferty"} onKlik={onKlik}
    tytul="Zdjęcie z oferty Allegro — to widział klient"
    puste={!externalId}
    pusteTytul="Bez powiązanej oferty — nie ma czego pokazać"
    pusteIkona={<ShoppingBag size={ikona} />}
    brakTytul="Allegro nie podało zdjęcia tej oferty"
    brakSlowo="bez zdjęcia"
    brakIkona={<ImageOff size={ikona} />} />;
}
