import React, { useState } from "react";
import { Zdjecie } from "./Zdjecie";
import { Powiekszenie } from "./Powiekszenie";

/**
 * Kafel zdjęcia, który POWIĘKSZA SIĘ SAM (0.203.0).
 *
 * Do 0.202.0 każde miejsce ze zdjęciem trzymało własny stan powiększenia
 * i własny warunek na `Powiekszenie` — trzy kopie tych samych sześciu linijek
 * w `zwroty/Pozycje.tsx`, `skrzynka/TowarRozmowy.tsx` i nigdzie indziej.
 * Zdjęcie weszło w tym wydaniu do kandydatów doboru, do wyników wyszukiwarki
 * i do zadań terenowych; szósta kopia rozjechałaby się z pierwszą.
 *
 * Stan siedzi W KAFLU, nie w liście nad nim. Otwarty jest zawsze jeden, bo
 * otwiera go kliknięcie — a lista, która musiałaby pamiętać, KTÓRY wiersz
 * kliknięto, pamiętałaby to wyłącznie dla obrazka.
 *
 * Kliknięcie działa tylko tam, gdzie zdjęcie JEST: `Zdjecie` opakowuje w
 * przycisk sam obraz, a kafel zastępczy zostaje martwy. Kursor obiecujący
 * powiększenie brakującego obrazu byłby obietnicą bez pokrycia.
 */
export function Kafel({ twId, rozmiar = 48, nazwa, symbol = null }: {
  twId: number | null;
  rozmiar?: number;
  nazwa: string;
  symbol?: string | null;
}) {
  const [powiekszone, setPowiekszone] = useState(false);
  return <>
    <Zdjecie twId={twId} rozmiar={rozmiar} nazwa={nazwa}
      onKlik={twId === null ? undefined : () => setPowiekszone(true)} />
    {powiekszone && twId !== null && <Powiekszenie twId={twId} nazwa={nazwa} symbol={symbol}
      zamknij={() => setPowiekszone(false)} />}
  </>;
}
