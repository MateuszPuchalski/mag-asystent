import { Camera } from "lucide-react";
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
 * ZAWSZE OTWARTE, inaczej niż okno „Skąd to wiem". Tamto zwija się, gdy
 * wszystko stoi na bazie, bo wtedy nie ma czego sprawdzać. Tutaj nie ma
 * takiego przypadku: każdy wiersz jest do sprawdzenia z definicji, bo każdy
 * jest odczytem z fotografii, której u nas nikt nie oglądał.
 *
 * Bez bursztynu: to nie jest ostrzeżenie ani zaznaczenie, tylko materiał.
 */
export function OdczytZdjec({ odczyt }: { odczyt: OdczytZdjecia[] }) {
  if (odczyt.length === 0) return null;

  return <div className="mt-2 rounded border border-violet-200 bg-violet-50 p-2">
    <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-900">
      <Camera size={14} aria-hidden="true" />
      Co model odczytał ze zdjęć
      <span className="font-normal text-violet-800">porównaj z miniaturą</span>
    </p>
    <ul className="mt-1.5 space-y-1.5 text-xs text-slate-800" aria-label="Odczyt ze zdjęć rozmowy">
      {odczyt.map((o) => <li key={o.zdjecie} className="flex gap-2">
        <span className="shrink-0 rounded bg-violet-200 px-1.5 py-0.5 font-semibold text-violet-900">
          {o.zdjecie}
        </span>
        {/* `pre`, nie `p`: tabliczka bywa przepisana wierszami i łamanie jej
            w akapit zamienia numer katalogowy w kaszę. */}
        <pre className="whitespace-pre-wrap font-sans">{o.tekst}</pre>
      </li>)}
    </ul>
  </div>;
}
