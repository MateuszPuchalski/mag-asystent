import React, { useId } from "react";
import { useModele } from "../api/wiedza";
import { Pole } from "../ui";

export type DaneModelu = { rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string; wariant: string };

/**
 * Cztery pola maszyny z podpowiedziami z bazy — wspólne dla ręcznej propozycji
 * i dla przerabiania sekcji „Modele:" z opisu (E3). Datalisty mają własne
 * `id` z `useId`, bo na liście „Z opisów" ten blok stoi wiele razy na raz.
 */
export function PolaModelu({ dane, onZmiana, zwarte = false }: {
  dane: DaneModelu;
  onZmiana: (d: DaneModelu) => void;
  /** Wiersz listy: bez etykiet nad polami, same placeholdery. */
  zwarte?: boolean;
}) {
  const id = useId();
  const modele = useModele(`${dane.marka} ${dane.nazwa}`);
  const ustaw = (p: Partial<DaneModelu>) => onZmiana({ ...dane, ...p });
  const etykieta = zwarte ? "sr-only" : "text-xs font-bold text-slate-600";
  return <>
    <div className={`grid gap-2 ${zwarte ? "grid-cols-2 md:grid-cols-4" : "md:grid-cols-4"}`}>
      <label className={etykieta}>Rodzaj
        <select className={zwarte ? "field" : "field mt-1"} aria-label="Rodzaj urządzenia" value={dane.rodzaj}
          onChange={(e) => ustaw({ rodzaj: e.target.value as "maszyna" | "silnik" })}>
          <option value="maszyna">maszyna</option><option value="silnik">silnik</option></select></label>
      <label className={etykieta}>Marka
        <Pole className={zwarte ? "" : "mt-1"} aria-label="Marka" value={dane.marka} list={`${id}-marka`} placeholder="Marka, np. NAC"
          onChange={(e) => ustaw({ marka: e.target.value })} /></label>
      <label className={etykieta}>Model
        <Pole className={zwarte ? "" : "mt-1"} aria-label="Model" value={dane.nazwa} list={`${id}-nazwa`} placeholder="Model, np. LS 46-450"
          onChange={(e) => ustaw({ nazwa: e.target.value })} /></label>
      <label className={etykieta}>Wariant
        <Pole className={zwarte ? "" : "mt-1"} aria-label="Wariant" value={dane.wariant} placeholder="Wariant, np. HS"
          onChange={(e) => ustaw({ wariant: e.target.value })} /></label>
    </div>
    {/* Podpowiedzi z bazy: jedna kosiarka = jeden wiersz, więc pisownia z pierwszego wpisu wygrywa. */}
    <datalist id={`${id}-marka`}>{[...new Set(modele.data?.modele.map((m) => m.marka) ?? [])].map((m) => <option key={m} value={m} />)}</datalist>
    <datalist id={`${id}-nazwa`}>{(modele.data?.modele ?? []).map((m) => <option key={m.id} value={m.nazwa}>{m.etykieta}</option>)}</datalist>
    {modele.data && modele.data.modele.length > 0 && <p className="text-[11px] text-slate-500">
      Znane modele: {modele.data.modele.map((m) => m.etykieta).join(" · ")}</p>}
  </>;
}
