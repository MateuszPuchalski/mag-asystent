import React from "react";
import { TrendingUp } from "lucide-react";
import type { MiesiacEskalacji } from "../api/typy";
import { Karta, NaglowekSekcji, Pusto } from "../ui";

/* ── Miara eskalacji (S5 spoiwa, `docs/obsluga-klienta-calosc.md`) ───────────
   Po ilu rozmowach klient szedł dalej — w dyskusję albo w reklamację. Klient,
   który po pytaniu składa reklamację, powiedział coś o naszej odpowiedzi.

   KOLEJKA PUSTA PRZY ROSNĄCEJ ESKALACJI JEST MIARĄ, KTÓRA KŁAMIE, a do 0.386.0
   biuro nie miało tej liczby wcale: mierzyliśmy skuteczność doboru i czas
   wymiany z halą, czyli własną pracę, nigdy jej skutku u klienta.

   BEZ OSI OSOBOWEJ, celowo. Ta liczba mówi o naszych odpowiedziach jako
   całości; rozbita na ludzi stałaby się oceną pracownika liczoną z cudzej
   decyzji. Skuteczność doboru obok ma oś osobową, bo tam mierzymy WYBÓR
   agenta, a nie ruch klienta — i dlatego niesie zdanie o podstawie prawnej. */

/** Udział w procentach; zero rozmów to brak podstawy, nie zero procent. */
const udzial = (m: MiesiacEskalacji) =>
  m.zRozmowa === 0 ? null : Math.round((m.eskalowane / m.zRozmowa) * 100);

export function Eskalacja({ miesiace }: { miesiace: MiesiacEskalacji[] | undefined }) {
  return <Karta className="p-4">
    <NaglowekSekcji jako="h3">
      <TrendingUp size={16} className="mr-1 inline align-baseline" />Eskalacja po rozmowie
    </NaglowekSekcji>
    <p className="mt-1 text-sm text-slate-600">
      Zakupy, przy których klient najpierw napisał do nas, a potem otworzył
      dyskusję albo reklamację. Liczone po ZAKUPACH, nie po wiadomościach —
      inaczej miara nagradzałaby milczenie agenta.
    </p>

    {miesiace === undefined
      ? <Pusto waga="lista">Wczytuję…</Pusto>
      : miesiace.length === 0
        ? <Pusto waga="lista">
            Brak rozmów powiązanych z zamówieniem — nie ma z czego liczyć.</Pusto>
        : <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500">
              <th className="font-medium">miesiąc</th>
              <th className="font-medium">zakupy z rozmową</th>
              <th className="font-medium">poszły dalej</th>
              <th className="font-medium">udział</th>
            </tr></thead>
            <tbody>
              {miesiace.map((m) => <tr key={m.miesiac} className="border-t">
                <td className="py-1 font-mono">{m.miesiac}</td>
                <td className="tabular-nums">{m.zRozmowa}</td>
                <td className="tabular-nums">{m.eskalowane}</td>
                {/* Podstawa przy liczbie, bo 50% z dwóch spraw i 50% z dwustu
                    to dwie różne informacje — ta sama zasada, co przy progu
                    wiarygodności w skuteczności doboru. */}
                <td className="tabular-nums">{udzial(m) === null ? "—" : `${udzial(m)}%`}</td>
              </tr>)}
            </tbody>
          </table>}
  </Karta>;
}
