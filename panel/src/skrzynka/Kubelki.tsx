import React from "react";
import type { Rozmowa } from "../api/typy";

/* ── Kubełki skrzynki (0.157.0) ──────────────────────────────────────────────
   Ten sam nawyk co w zwrotach: praca dzieli się na kubełki, a operator nie
   wybiera akcji z menu — wchodzi tam, gdzie ma robotę. Cyfra przełącza.

   OSTATNI KUBEŁEK JEST WSZYSTKOŻERNY i to nie jest ozdoba. Rozmowa, która nie
   trafiłaby do żadnego z sześciu pierwszych, zniknęłaby operatorowi z oczu bez
   jednego objawu — a to najgorszy rodzaj usterki w kolejce pracy.           */

export type KubelekId =
  | "moje" | "nieprzypisane" | "klient" | "my" | "odlozone" | "zalatwione" | "wszystkie";

export const KUBELKI: Array<{ id: KubelekId; etykieta: string; opis: string }> = [
  { id: "moje", etykieta: "Moje", opis: "Prowadzisz je Ty." },
  { id: "nieprzypisane", etykieta: "Nieprzypisane", opis: "Czekają na kogokolwiek." },
  { id: "klient", etykieta: "Czeka na klienta", opis: "Odpowiedź poszła, ruch po tamtej stronie." },
  { id: "my", etykieta: "Czeka na nas", opis: "Zlecony pomiar wraca z hali." },
  { id: "odlozone", etykieta: "Odłożone", opis: "Wrócą same, w wyznaczonym dniu." },
  { id: "zalatwione", etykieta: "Załatwione", opis: "Zamknięte, rozstrzygnięte, spam." },
  { id: "wszystkie", etykieta: "Wszystkie", opis: "Nic się tu nie chowa." },
];

/**
 * Czy rozmowa należy do kubełka. Jedno miejsce z tą regułą — pasek, filtr
 * i liczniki muszą liczyć tak samo, inaczej liczba przy zakładce nie zgadza
 * się z tym, co po kliknięciu widać.
 *
 * `status` jest tym EFEKTYWNYM z serwera: odłożenie po terminie jest już
 * `open`, więc wraca do pracy samo, bez zapisu i bez tickera.
 */
export function wKubelku(r: Rozmowa, kubelek: KubelekId, mojeId: number | null): boolean {
  const wToku = r.status === "new" || r.status === "open";
  switch (kubelek) {
    case "moje": return wToku && r.wlascicielId !== null && r.wlascicielId === mojeId;
    case "nieprzypisane": return wToku && r.wlascicielId === null;
    case "klient": return r.status === "waiting_for_customer";
    case "my": return r.status === "waiting_for_internal";
    case "odlozone": return r.status === "snoozed";
    case "zalatwione":
      return r.status === "resolved" || r.status === "closed" || r.status === "spam";
    case "wszystkie": return true;
  }
}

export function Kubelki({ rozmowy, mojeId, wybrany, onWybierz }: {
  rozmowy: Rozmowa[];
  mojeId: number | null;
  wybrany: KubelekId;
  onWybierz: (k: KubelekId) => void;
}) {
  return <nav className="flex flex-wrap gap-1 border-b p-2">
    {KUBELKI.map((k, i) => {
      const ile = rozmowy.filter((r) => wKubelku(r, k.id, mojeId)).length;
      const aktywny = k.id === wybrany;
      return <button key={k.id} onClick={() => onWybierz(k.id)}
        title={`${k.opis} (klawisz ${i + 1})`}
        className={`rounded-md px-2 py-1 text-xs font-bold ${
          aktywny ? "bg-wertis-amber text-wertis-ink" : "text-slate-600 hover:bg-slate-100"}`}>
        {k.etykieta}<span className="ml-1 tabular-nums opacity-70">{ile}</span>
      </button>;
    })}
  </nav>;
}
