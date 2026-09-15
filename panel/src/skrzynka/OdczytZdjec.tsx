import { Camera } from "lucide-react";
import { Zwijka } from "./Zwijka";
import type { OdczytZdjecia } from "../api/typy";

/**
 * CO MODEL ODCZYTAŁ ZE ZDJĘĆ — jeden akapit na fotografię.
 *
 * Powstało z pytania właściciela o kosiarkę PARKSIDE: klient przysłał ostre
 * zdjęcie tabliczki znamionowej, a model „nie był w stanie wyciągnąć modelu".
 * Nie był, bo tego zdjęcia nigdy nie dostał — wątek szedł do dostawcy jako
 * goły tekst i nie wspominał nawet, że załącznik istnieje.
 *
 * DLACZEGO TO W OGÓLE STOI NA EKRANIE, skoro odczyt jest dla modelu, nie dla
 * agenta. Bo jest CENĄ za prawo powołania się na zdjęcie. Odsiew numerów
 * odrzuca szkic z numerem spoza faktów i wątku, a tabliczka to sama
 * numeracja; odczyt otwiera tym numerom drogę. Otwarta droga bez widocznej
 * kontroli byłaby furtką, więc kontrola jest tutaj: agent porównuje ten tekst
 * z miniaturą na osi rozmowy i w jednym spojrzeniu wie, czy model przeczytał
 * tabliczkę, czy ją sobie wyobraził.
 *
 * ZWINIĘTE DOMYŚLNIE OD 0.342.0, i to jest zmiana zdania, nie przeoczenie.
 * Do 0.341.0 stało tu „zawsze otwarte, bo każdy wiersz jest do sprawdzenia
 * z definicji". Zdanie było prawdziwe i prowadziło do złego ekranu: odczyt
 * z czterech zdjęć wypychał szkic, po który agent tu przyszedł, poza
 * krawędź. Właściciel rozstrzygnął spór wprost — czytelność szkicu wygrywa.
 *
 * Do sprawdzenia jest dalej każdy wiersz i nagłówek mówi to bez rozwijania:
 * niesie LICZBĘ zdjęć i zdanie „porównaj z miniaturą". Kto ma wątpliwość,
 * rozwija jednym kliknięciem; kto nie ma, nie płaci za nią wysokością.
 *
 * Bez bursztynu: to nie jest ostrzeżenie ani zaznaczenie, tylko materiał.
 */
export function OdczytZdjec({ odczyt }: { odczyt: OdczytZdjecia[] }) {
  if (odczyt.length === 0) return null;

  return <Zwijka
    tytul="Co model odczytał ze zdjęć"
    Ikona={Camera}
    podpis={`${odczyt.length} ${odczyt.length === 1 ? "zdjęcie" : "zdjęć"} · porównaj z miniaturą`}
  >
    <ul className="space-y-1.5 p-2 text-xs text-slate-800" aria-label="Odczyt ze zdjęć rozmowy">
      {odczyt.map((o) => <li key={o.zdjecie} className="flex gap-2">
        <span className="shrink-0 rounded bg-violet-200 px-1.5 py-0.5 font-semibold text-violet-900">
          {o.zdjecie}
        </span>
        {/* `pre`, nie `p`: tabliczka bywa przepisana wierszami i łamanie jej
            w akapit zamienia numer katalogowy w kaszę. */}
        <pre className="whitespace-pre-wrap font-sans">{o.tekst}</pre>
      </li>)}
    </ul>
  </Zwijka>;
}
