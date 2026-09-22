import React from "react";
import type { Pominieta, WierszKosza, ZnalezionaWKoszu } from "../api/kosze";
import { Pusto, WierszKolejki, czas, dniSlowo, ile } from "../ui";
import { CyklKosza, StanMmKosza } from "./Cykl";

/* ── Kolejka koszy (0.438.0) ───────────────────────────────────────────────
   Z MAGAZYNU ZWROTÓW w `biuro.html`, w ramie kolejek panelu. Kubełki
   odpowiadają na pytania biura przy koszach, po kolei:

     W pracy     — co jest w drodze: koszyk zbiera towar albo kosz stoi na hali;
     Pominięte   — czego hala nie znalazła; każdy wiersz czeka na decyzję;
     Rozłożone   — historia, do sprawdzenia „kto to rozłożył";
     Anulowane   — praca, która się nie wydarzyła.

   KARTONY stoją na tej samej liście, bo dla biura „co jest na hali" to jedno
   pytanie — ale z pastylką, inaczej karton bez zwrotów i bez MM wyglądałby
   jak kosz zepsuty. Biuro go wyłącznie ogląda: zawartość zbiera hala. */

export type KubelekKoszy = "praca" | "pominiete" | "rozlozone" | "anulowane";

export const KUBELKI_KOSZY: Array<{ id: KubelekKoszy; etykieta: string; pytanie: string }> = [
  { id: "praca", etykieta: "W pracy", pytanie: "Co jest w drodze na regał?" },
  { id: "pominiete", etykieta: "Pominięte", pytanie: "Szukać dalej, reklamować czy poprawić dokument?" },
  { id: "rozlozone", etykieta: "Rozłożone", pytanie: "Tylko wgląd." },
  { id: "anulowane", etykieta: "Anulowane", pytanie: "Tylko wgląd." },
];

export function kubelekKosza(k: WierszKosza): KubelekKoszy {
  if (k.status === "anulowany") return "anulowane";
  if (k.status === "rozlozony") return "rozlozone";
  return "praca";
}

/** Zdanie o postępie — to, co w biurze stało pod numerem kosza. */
function postep(k: WierszKosza): string {
  const karton = k.rodzaj === "karton";
  if (k.status === "anulowany") {
    return `Anulowany${k.anulowanoPrzez ? ` przez ${k.anulowanoPrzez}` : ""} — ${
      k.odlozonych} z ${k.pozycji} poz. zdążyło wrócić na półki.`;
  }
  if (k.status === "otwarty") {
    return karton ? "Hala zbiera zawartość — pudło jeszcze otwarte."
      : "Przyjmuje zwroty — rozkładanie jeszcze nie ruszyło.";
  }
  return `Rozłożono ${k.odlozonych}/${k.pozycji} poz.${k.rozlozonoPrzez ? ` · ${k.rozlozonoPrzez}` : ""}`;
}

export function KolejkaKoszy({ kosze, wybrany, onWybierz }: {
  kosze: WierszKosza[]; wybrany: number | null; onWybierz: (id: number) => void;
}) {
  if (!kosze.length) return <Pusto waga="lista">Ten kubełek jest pusty.</Pusto>;
  return <ul className="divide-y divide-slate-200">
    {kosze.map((k) => {
      const karton = k.rodzaj === "karton";
      return <WierszKolejki key={k.id} aktywny={k.id === wybrany} onKlik={() => onWybierz(k.id)}>
        <span className="flex w-full items-baseline gap-2">
          <span className="truncate font-bold">{k.kod}</span>
          <span className="ml-auto shrink-0 text-xs text-slate-600">
            {karton ? ile(k.pozycji, "pozycja", "pozycje", "pozycji")
              : k.mmNumer ? `MM ${k.mmNumer}` : ile(k.zwrotow, "zwrot", "zwroty", "zwrotów")}</span>
        </span>
        <span className="w-full truncate text-sm text-slate-600">{postep(k)}</span>
        <span className="mt-1 flex w-full flex-wrap items-center gap-1.5">
          {karton && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">karton</span>}
          <CyklKosza status={k.status} mmBlad={k.mmStan === "blad" && !k.mmNumer && !karton} />
          <StanMmKosza mmStan={k.mmStan} mmNumer={k.mmNumer} brakujeKorekt={k.brakujeKorekt} karton={karton} />
          {k.pominietych > 0 &&
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">
              {ile(k.pominietych, "pominięta", "pominięte", "pominiętych")}</span>}
        </span>
      </WierszKolejki>;
    })}
  </ul>;
}

/**
 * Pominięte ze WSZYSTKICH koszy — lista pracy, nie historia. Najdłużej
 * czekające na górze: sprawa sprzed tygodnia kosztuje więcej niż wczorajsza.
 * Wiersz otwiera swój kosz, bo tam stoi reszta jego zawartości i ZAŁATWIONE.
 */
export function KolejkaPominietych({ lista, wybranyKosz, onWybierz }: {
  lista: Pominieta[]; wybranyKosz: number | null; onWybierz: (koszId: number) => void;
}) {
  if (!lista.length) return <Pusto waga="lista">Hala niczego nie pominęła — nic tu nie czeka.</Pusto>;
  return <ul className="divide-y divide-slate-200">
    {lista.map((p) => <WierszKolejki key={p.pozycjaId} aktywny={p.koszId === wybranyKosz}
      onKlik={() => onWybierz(p.koszId)}>
      <span className="flex w-full items-baseline gap-2">
        <span className="truncate font-bold">{p.symbol || p.kod}</span>
        <span className="ml-auto shrink-0 text-xs text-slate-600">{p.dni > 0 ? dniSlowo(p.dni) : "dziś"}</span>
      </span>
      <span className="w-full truncate text-sm text-slate-600">{p.nazwa} · {p.ilosc} szt.</span>
      <span className="mt-1 flex w-full flex-wrap gap-1.5">
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">kosz {p.kod}</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">
          {p.powod || "bez powodu"}</span>
      </span>
    </WierszKolejki>)}
  </ul>;
}

/** „W którym koszu jechał ten towar?" — wynik szukania zamiast kolejki. */
export function WynikiSzukania({ lista, onWybierz }: {
  lista: ZnalezionaWKoszu[]; onWybierz: (koszId: number) => void;
}) {
  if (!lista.length) return <Pusto waga="lista">Nic w koszach nie pasuje do tego, czego szukasz.</Pusto>;
  return <ul className="divide-y divide-slate-200">
    {lista.map((z, i) => <WierszKolejki key={`${z.koszId}-${i}`} aktywny={false} onKlik={() => onWybierz(z.koszId)}>
      <span className="flex w-full items-baseline gap-2">
        <span className="truncate font-bold">{z.symbol || z.nazwa}</span>
        <span className="ml-auto shrink-0 text-xs text-slate-600">{z.kiedy ? czas(z.kiedy) : "—"}</span>
      </span>
      <span className="w-full truncate text-sm text-slate-600">{z.nazwa} · {z.ilosc} szt.</span>
      <span className="mt-1 flex w-full flex-wrap items-center gap-1.5">
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">kosz {z.kod}</span>
        {z.status === "skipped"
          ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">pominięta</span>
          : z.lokFaktyczna
            ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">{z.lokFaktyczna}</span>
            : <span className="text-xs text-slate-600">czeka na hali</span>}
      </span>
    </WierszKolejki>)}
  </ul>;
}
