import React from "react";
import { ImageOff } from "lucide-react";
import { useZdjecie } from "./useZdjecie";

/* Kafel zdjęcia o STAŁYM rozmiarze — także wtedy, gdy zdjęcia nie ma i gdy
   jeszcze się ładuje. To jest lekcja z `biuro.html`: kafel, który rośnie po
   doładowaniu, przesuwa wiersze pod kursorem i operator klika nie w ten
   zwrot, w który celował. */

export function Zdjecie({ twId, rozmiar = 48, nazwa, onKlik }: {
  twId: number | null;
  rozmiar?: number;
  nazwa?: string;
  onKlik?: () => void;
}) {
  const url = useZdjecie(twId);
  const styl = { width: rozmiar, height: rozmiar } as React.CSSProperties;
  const wspolne = "shrink-0 rounded-lg border border-slate-200 bg-slate-50";

  if (twId == null) {
    /* Bez kartoteki nie ma czym pokazać obrazu — i ekran ma to POWIEDZIEĆ,
       bo to jest zaproszenie do wskazania towaru, nie awaria. */
    return <div style={styl} title="Bez kartoteki — wskaż towar, żeby zobaczyć zdjęcie"
      className={`${wspolne} grid place-items-center border-dashed text-slate-400`}>
      <ImageOff size={Math.round(rozmiar / 3)} />
    </div>;
  }
  if (url === undefined) {
    return <div style={styl} className={`${wspolne} animate-pulse`} aria-hidden="true" />;
  }
  if (url === null) {
    return <div style={styl} title="Kartoteka nie ma zdjęcia"
      className={`${wspolne} grid place-items-center border-dashed text-[9px] font-bold uppercase text-slate-400`}>
      bez zdjęcia
    </div>;
  }
  const obraz = <img src={url} alt={nazwa ?? "Zdjęcie towaru"} style={styl}
    className={`${wspolne} object-cover`} />;
  return onKlik
    ? <button type="button" onClick={onKlik} title="Powiększ" className="shrink-0">{obraz}</button>
    : obraz;
}
