import React from "react";
import { AlertTriangle, PackageX, Ban } from "lucide-react";
import type { Kubelek, Sygnal, Zwrot } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Zdjecie } from "./Zdjecie";

/* ── Kolejka zwrotów ─────────────────────────────────────────────────────────
   Wiersz ma się czytać W BIEGU, więc niesie SIEDEM rzeczy i ani jednej
   więcej: numer, klienta zamówienia, towar, sztuki, dni do terminu, kwotę
   proponowaną i sygnał. Wszystko, co trzeba doczytać, siedzi w kolumnie
   dowodów po prawej — a nie tutaj.

   Kolejność liczy SERWER (najkrótszy termin na górze) i panel jej nie
   zmienia. Dwie reguły sortowania rozjechałyby się przy pierwszej poprawce
   jednej z nich, a objawem byłby ekran pokazujący inną pilność niż liczniki. */

export const KUBELKI: Array<{ id: Kubelek; etykieta: string; pytanie: string }> = [
  { id: "decyzja", etykieta: "Do decyzji", pytanie: "Przyjąć czy odrzucić?" },
  { id: "ocena", etykieta: "Do oceny", pytanie: "Co z towarem?" },
  { id: "zwrot", etykieta: "Do zwrotu", pytanie: "Ile oddać?" },
  { id: "korekta", etykieta: "Do korekty", pytanie: "Zlecić korektę?" },
  { id: "odrzucony", etykieta: "Odrzucone", pytanie: "Tylko wgląd." },
  { id: "zamkniety", etykieta: "Zamknięte", pytanie: "Tylko wgląd." },
];

const SYGNALY: Record<Sygnal, { tytul: string; ikona: React.ReactNode; klasa: string }> = {
  termin: { tytul: "Termin ustawowy blisko albo minął", klasa: "bg-red-100 text-ranga-zle",
    ikona: <AlertTriangle size={13} /> },
  brak_dowodu: { tytul: "Towar jeszcze nie wrócił, a termin biegnie",
    klasa: "bg-amber-100 text-ranga-uwaga", ikona: <PackageX size={13} /> },
  odrzucony_w_allegro: { tytul: "Ktoś rozstrzygnął to już w panelu Allegro",
    klasa: "bg-slate-200 text-ranga-nic", ikona: <Ban size={13} /> },
};

/**
 * „1 dzień", ale „2 dni" i „12 dni".
 *
 * Polszczyzna ma tu jeden wyjątek i tylko jeden, więc reguła też jest jedna.
 * „1 dni" na ekranie, który ma się czytać w biegu, zatrzymuje oko na pół
 * sekundy — a to jest dokładnie ten koszt, który ten ekran miał zdjąć.
 */
export const dniSlowo = (n: number) => `${n} ${n === 1 ? "dzień" : "dni"}`;

/** Dni do terminu — jedyna liczba na wierszu, którą czyta się jako pilność. */
function Termin({ dni }: { dni: number }) {
  const pilne = dni <= 3;
  const tekst = dni < 0 ? `${dniSlowo(Math.abs(dni))} po` : dni === 0 ? "dziś" : dniSlowo(dni);
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold tabular-nums ${
    pilne ? "bg-red-100 text-ranga-zle" : "bg-slate-100 text-slate-600"}`}
    title={`Termin ustawowy: ${dni < 0 ? "przekroczony" : "za " + dniSlowo(dni)}`}>{tekst}</span>;
}

export function Kolejka({ zwroty, wybrany, onWybierz }: {
  zwroty: Zwrot[];
  wybrany: number | null;
  onWybierz: (id: number) => void;
}) {
  if (!zwroty.length) {
    return <p className="p-6 text-center text-sm text-slate-500">
      Ten kubełek jest pusty — nic tu nie czeka na ruch.</p>;
  }
  return <ul className="divide-y divide-slate-200">
    {zwroty.map((z) => {
      const aktywny = z.id === wybrany;
      const sztuki = z.pozycje.reduce((s, p) => s + p.ilosc, 0);
      return <li key={z.id}>
        <button
          /* `aria-current` zamiast samego koloru: wiersz wybrany klawiaturą
             ma być wybrany także dla czytnika ekranu. */
          aria-current={aktywny ? "true" : undefined}
          onClick={() => onWybierz(z.id)}
          className={`flex w-full gap-3 px-4 py-3 text-left ${aktywny ? "bg-amber-50" : "hover:bg-slate-50"}`}>
          {/* Miniatura PIERWSZEJ pozycji. Zwrot wielopozycyjny i tak
              rozstrzyga się w kolumnie dowodów, a rząd czterech kafli
              zrobiłby z wiersza tabelę. */}
          <Zdjecie twId={z.pozycje[0]?.twId ?? null} rozmiar={44}
            nazwa={z.pozycje[0]?.nazwa} />
          <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-bold">{z.numer ?? z.externalId}</span>
            <span className="ml-auto" />
            <Termin dni={z.dniDoTerminu} />
          </div>
          <div className="mt-0.5 truncate text-sm text-slate-600">
            {z.pozycje[0]?.nazwa ?? "Zwrot bez pozycji"}
            {z.pozycje.length > 1 ? ` i ${z.pozycje.length - 1} inne` : ""}
            {sztuki ? ` · ${sztuki} szt.` : ""}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums">
              {zlote(z.sumaPozycjiGrosze, z.waluta)}</span>
            {z.sygnaly.map((s) => (
              <span key={s} title={SYGNALY[s].tytul}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold ${SYGNALY[s].klasa}`}>
                {SYGNALY[s].ikona}{s === "termin" ? "termin" : s === "brak_dowodu" ? "bez paczki" : "w Allegro"}
              </span>
            ))}
          </div>
          </div>
        </button>
      </li>;
    })}
  </ul>;
}
