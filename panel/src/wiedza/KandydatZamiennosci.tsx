import React, { useState } from "react";
import type { KandydatZamiennosci as Kandydat } from "../api/typy";
import { Pole, Przycisk, ile } from "../ui";
import { Kafel } from "../towar/Kafel";

/**
 * Karta kandydata na zamienność przez wspólny numer oryginału. Kształt
 * `PropozycjaPasowania`: dwa kafle, między nimi para, pod spodem decyzja.
 *
 * NAZWY OBU KARTOTEK W PEŁNI, NIE SAME SYMBOLE. Tu rozstrzyga się po
 * nazwie: „lewy" przy „lewy mielący", „wstępny" przy zwykłym filtrze,
 * „zestaw" przy nakrętce. Symbol tych różnic nie niesie, a właśnie one
 * odróżniały w pomiarze zamiennik od pomyłki.
 *
 * WSPÓLNE NUMERY Z LICZBĄ. Cztery wspólne numery to co innego niż jeden;
 * kolejka stoi po tej liczbie, więc karta ma ją pokazać, a nie kazać liczyć.
 */
export function KandydatZamiennosci({ k, trwa, onDecyzja }: {
  k: Kandydat; trwa: boolean; onDecyzja: (decyzja: "zatwierdz" | "odrzuc", powod: string | null) => void;
}) {
  const [odrzuca, setOdrzuca] = useState(false);
  const [powod, setPowod] = useState("");
  return <article className="rounded-lg border border-slate-200 p-3"
    aria-label={`Zamienność: ${k.a.symbol} ⟷ ${k.b.symbol}`}>
    <div className="flex items-start gap-3">
      <Kafel twId={k.a.twId} rozmiar={44} nazwa={k.a.nazwa} symbol={k.a.symbol} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <b className="font-mono">{k.a.symbol}</b>
          <span className="text-slate-500" aria-hidden="true">⟷</span>
          <b className="font-mono">{k.b.symbol}</b>
        </div>
        <p className="text-sm text-slate-700">{k.a.nazwa}</p>
        <p className="text-sm text-slate-700">{k.b.nazwa}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-600">
          {/* Odmiana przez `ile`, nie trójnik: zrzut z seeda pokazał „14 wspólne
              numery" — liczby od pięciu wzwyż chcą dopełniacza. */}
          <span>{k.numery.length > 1
            ? `${ile(k.numery.length, "wspólny numer", "wspólne numery", "wspólnych numerów")} oryginału:`
            : "Wspólny numer oryginału:"}</span>
          {k.numery.map((n) => <span key={n} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">{n}</span>)}
        </p>
      </div>
      <Kafel twId={k.b.twId} rozmiar={44} nazwa={k.b.nazwa} symbol={k.b.symbol} />
    </div>
    {/* Rozmiar domyślny, nie `text-xs` (@wydanie): ta sama para decyzji co
        w karcie `Propozycja`. Słowa zostają własne — „Zamienne" odpowiada
        na pytanie karty wprost, a „Zatwierdź" kazałoby je sobie dopowiedzieć. */}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Przycisk wariant="glowny" disabled={trwa} onClick={() => onDecyzja("zatwierdz", null)}>
        Zamienne</Przycisk>
      {!odrzuca && <Przycisk disabled={trwa} onClick={() => setOdrzuca(true)}>Nie są zamienne</Przycisk>}
      {odrzuca && <>
        <Pole className="w-64" aria-label="Powód odrzucenia" value={powod} placeholder="np. lewy i prawy"
          onChange={(e) => setPowod(e.target.value)} />
        <Przycisk disabled={trwa || !powod.trim()} onClick={() => onDecyzja("odrzuc", powod.trim())}>
          Odrzuć</Przycisk>
      </>}
    </div>
  </article>;
}
