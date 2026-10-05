import React from "react";
import type { MiesiacEskalacji } from "../api/typy";
import { Pusto } from "../ui";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Miara eskalacji (S5 spoiwa, `docs/obsluga-klienta-calosc.md`) ───────────
   Po ilu rozmowach klient szedł dalej — w dyskusję albo w reklamację. Klient,
   który po pytaniu składa reklamację, powiedział coś o naszej odpowiedzi.

   KOLEJKA PUSTA PRZY ROSNĄCEJ ESKALACJI JEST MIARĄ, KTÓRA KŁAMIE, a do 0.386.0
   biuro nie miało tej liczby wcale: mierzyliśmy czas wymiany z halą, czyli
   własną pracę, nigdy jej skutku u klienta.

   BEZ OSI OSOBOWEJ, celowo. Ta liczba mówi o naszych odpowiedziach jako
   całości; rozbita na ludzi stałaby się oceną pracownika liczoną z cudzej
   decyzji. */

/** Udział w procentach; zero rozmów to brak podstawy, nie zero procent. */
const udzial = (m: MiesiacEskalacji) =>
  m.zRozmowa === 0 ? null : Math.round((m.eskalowane / m.zRozmowa) * 100);

/* Rama i tabela wspólne z resztą analizy (0.519.0): karta budowała własny
   nagłówek z ikoną i własną tabelę, a obok stoi pięć kart w innym kształcie.
   Pusta lista mówi zdaniem przez `Tabela`, jak wszędzie w analizie. */
export function Eskalacja({ miesiace }: { miesiace: MiesiacEskalacji[] | undefined }) {
  /* Bez rozmów powiązanych z zamówieniem karta jest jednym zdaniem
     (0.542.0, wariant C Analizy) — pusta tabela z nagłówkami nic nie mówi. */
  if (miesiace?.length === 0) return <KartaWgladu tytul="Eskalacja po rozmowie"
    pusta="Brak rozmów powiązanych z zamówieniem — nie ma z czego liczyć." />;
  return <KartaWgladu tytul="Eskalacja po rozmowie"
    opis={"Zakupy, przy których klient najpierw napisał do nas, a potem otworzył dyskusję "
      + "albo reklamację. Liczone po zakupach, nie po wiadomościach — inaczej miara "
      + "nagradzałaby milczenie agenta."}>
    {miesiace === undefined
      ? <Pusto waga="lista">Wczytuję…</Pusto>
      : <Tabela naglowki={["miesiąc", "zakupy z rozmową", "poszły dalej", "udział"]}
          pusto="Brak rozmów powiązanych z zamówieniem — nie ma z czego liczyć.">
          {miesiace.map((m) => <tr key={m.miesiac}>
            <Td className="font-mono">{m.miesiac}</Td>
            <Td className="tabular-nums">{m.zRozmowa}</Td>
            <Td className="tabular-nums">{m.eskalowane}</Td>
            {/* Podstawa przy liczbie, bo 50% z dwóch spraw i 50% z dwustu
                to dwie różne informacje. */}
            <Td className="tabular-nums">{udzial(m) === null ? "—" : `${udzial(m)}%`}</Td>
          </tr>)}
        </Tabela>}
  </KartaWgladu>;
}
