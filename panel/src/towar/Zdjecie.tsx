import React from "react";
import { ImageOff, PackageSearch } from "lucide-react";
import { useZdjecie } from "./useZdjecie";

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

export function Zdjecie({ twId, rozmiar = 48, nazwa, onKlik }: {
  twId: number | null;
  rozmiar?: number;
  nazwa?: string;
  onKlik?: () => void;
}) {
  const url = useZdjecie(twId);
  const styl = { width: rozmiar, height: rozmiar } as React.CSSProperties;
  const wspolne = "shrink-0 rounded-lg border border-slate-200 bg-slate-50";

  const ikona = Math.max(12, Math.round(rozmiar / 3));

  if (twId == null) {
    /* Bez kartoteki nie ma czym pokazać obrazu — i ekran ma to POWIEDZIEĆ,
       bo to jest zaproszenie do wskazania towaru, nie awaria. */
    return <div style={styl} title="Bez kartoteki — wskaż towar, żeby zobaczyć zdjęcie"
      className={`${wspolne} grid place-items-center border-dashed text-slate-400`}>
      <PackageSearch size={ikona} />
    </div>;
  }
  if (url === undefined) {
    return <div style={styl} className={`${wspolne} animate-pulse`} aria-hidden="true" />;
  }
  if (url === null) {
    return <div style={styl} title="Kartoteka nie ma zdjęcia"
      className={`${wspolne} grid place-items-center border-dashed text-[9px] font-bold uppercase leading-tight text-slate-400`}>
      {rozmiar >= 44 ? "bez zdjęcia" : <ImageOff size={ikona} />}
    </div>;
  }
  const obraz = <img src={url} alt={nazwa ?? "Zdjęcie towaru"} style={styl}
    className={`${wspolne} object-cover`} />;
  return onKlik
    ? <button type="button" onClick={onKlik} title="Powiększ" className="shrink-0">{obraz}</button>
    : obraz;
}
