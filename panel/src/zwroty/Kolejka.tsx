import React, { useEffect, useRef } from "react";
import { AlertTriangle, PackageX, Ban } from "lucide-react";
import type { Kubelek, Sygnal, Zwrot } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Zdjecie } from "../towar/Zdjecie";

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
  brak_dowodu: { tytul: "Klient nie nadał jeszcze paczki, a termin biegnie",
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

export function Kolejka({ zwroty, wybrany, zKubelkiem = false, onWybierz }: {
  zwroty: Zwrot[];
  wybrany: number | null;
  /** Przy szukaniu lista miesza kubełki, więc wiersz musi powiedzieć swój. */
  zKubelkiem?: boolean;
  onWybierz: (id: number) => void;
}) {
  const aktywnyWiersz = useRef<HTMLButtonElement | null>(null);

  /* Od 0.165.0 kolejka jest zamknięta we własnym scrollerze, więc wybór trzeba
     DOGONIĆ widokiem — inaczej `j` przesuwa zaznaczenie poza dolną krawędź
     i operator steruje czymś, czego nie widzi.

     `block: "nearest"` załatwia przy okazji mysz: wiersz widoczny w całości
     nie jest przewijany wcale, a klikniętego nie da się kliknąć, nie widząc
     go. Flaga „skąd przyszła zmiana" byłaby drugim stanem do utrzymania po to,
     żeby wyłączyć operację, która i tak jest pusta.

     Efekt biegnie po zmianie `wybrany`, a nie przy każdym renderze: inaczej
     odświeżenie zapytania szarpałoby listę z powrotem do zaznaczenia, gdy
     operator przewinął ją ręcznie. */
  useEffect(() => { aktywnyWiersz.current?.scrollIntoView({ block: "nearest" }); }, [wybrany]);

  if (!zwroty.length) {
    return <p className="p-6 text-center text-sm text-slate-500">
      {zKubelkiem
        ? "Żaden zwrot nie pasuje do tego, czego szukasz."
        : "Ten kubełek jest pusty — nic tu nie czeka na ruch."}</p>;
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
          ref={aktywny ? aktywnyWiersz : null}
          onClick={() => onWybierz(z.id)}
          className={`flex w-full gap-3 px-4 py-3 text-left ${aktywny ? "bg-amber-50" : "hover:bg-slate-50"}`}>
          {/* Miniatura PIERWSZEJ pozycji. Zwrot wielopozycyjny i tak
              rozstrzyga się w kolumnie dowodów, a rząd czterech kafli
              zrobiłby z wiersza tabelę. */}
          <Zdjecie twId={z.pozycje[0]?.twId ?? null} rozmiar={44}
            nazwa={z.pozycje[0]?.nazwa} />
          <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Paczka nieodebrana nie ma numeru zwrotu — jej identyfikator to
                nasz `nieodebrana:<numer listu>`, więc pokazujemy sam numer
                listu i mówimy wprost, czym to jest. */}
            <span className="truncate font-bold">
              {z.zrodlo === "nieodebrana"
                ? (z.externalId.replace(/^nieodebrana:/, "") || "bez numeru")
                : (z.numer ?? z.externalId)}</span>
            {z.zrodlo === "nieodebrana" &&
              <span title="Klient nie odebrał przesyłki — to nie jest zgłoszony zwrot"
                className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-bold text-violet-800">
                nieodebrana</span>}
            <span className="ml-auto" />
            {/* Wynik szukania bywa z kubełka, którego nikt nie ogląda —
                bez tej etykiety zwrot ZAMKNIĘTY wyglądałby jak praca. */}
            {zKubelkiem && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-600">
              {KUBELKI.find((k) => k.id === z.kubelek)?.etykieta}</span>}
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
                {SYGNALY[s].ikona}{s === "termin" ? "termin" : s === "brak_dowodu" ? "nie nadana" : "w Allegro"}
              </span>
            ))}
          </div>
          </div>
        </button>
      </li>;
    })}
  </ul>;
}
