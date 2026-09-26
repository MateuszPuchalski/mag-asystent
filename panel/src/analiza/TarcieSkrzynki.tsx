import React from "react";
import { useTarcie, type LiczbyTarcia } from "../api/wglad";
import { Liczba } from "../ui/wykres";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Tarcie w skrzynce (0.500.0) ────────────────────────────────────────────
   Trzy liczby, po których widać, czy zmiana układu skrzynki pomogła: ile
   pomyłek agent zawrócił, ile sekund mija od otwarcia rozmowy do wysyłki
   i jak często szkic Copilota idzie do klienta nietknięty. Powód każdej
   stoi przy `services/tarcie.ts`.

   UDZIAŁ „BEZ ZMIAN" NIE MA KOLORU OCENY. Wysoki bywa dobry (świetne szkice)
   i zły (nikt ich nie czyta) — rozstrzyga rozmowa z człowiekiem, nie barwa
   liczby. Dlatego bez zieleni i czerwieni, a opis mówi to wprost.

   Karta montuje się tylko w zakresie „Obsługa klienta", więc odczyt biegnie
   wyłącznie wtedy — i niczego nie zapisuje. */

const procent = (u: number | null) => (u === null ? "—" : `${Math.round(u * 100)}%`);
const sekundy = (s: number | null) =>
  (s === null ? "—" : s < 120 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/* Bez „w oknie N dni" (@wydanie): karta słucha okna zakresu, które stoi
   w nagłówku Analizy. Powtórka przy liczbie była drugim źródłem tego faktu. */
function Liczby({ l }: { l: LiczbyTarcia }) {
  return <div className="flex flex-wrap gap-8">
    <Liczba ile={l.cofnietychWysylek} etykieta={`cofniętych wysyłek z ${l.wyslanych}`} />
    <Liczba ile={l.cofnietychZakonczen} etykieta="cofniętych zakończeń" />
    <Liczba ile={sekundy(l.medianaSekDoWysylki)}
      etykieta={`mediana od otwarcia rozmowy do wysyłki · ${l.probekCzasu} pomiarów`} />
    <Liczba ile={procent(l.udzialBezZmian)}
      etykieta={`szkiców Copilota wysłanych bez zmian · ${l.bezZmian} z ${l.zeSzkicem}`} />
  </div>;
}

export function TarcieSkrzynki({ dni }: { dni: number }) {
  const t = useTarcie(dni, true);
  if (!t.data) return null;
  return <>
    <KartaWgladu tytul="Tarcie w skrzynce"
      opis={"Cofnięcia to pomyłki złapane w porę — rosną, gdy przycisk stoi w złym miejscu. "
        + "Czas mierzy szukanie po ekranie. Wysoki udział szkiców bez zmian bywa dobry albo zły: "
        + "rozstrzyga rozmowa, nie ta liczba."}>
      <Liczby l={t.data.razem} />
    </KartaWgladu>
    {/* Rozbicie na ludzi przychodzi WYŁĄCZNIE administratorowi (0.431.0). */}
    {t.data.osoby && <KartaWgladu tytul="Tarcie według osoby"
      opis="Czas liczy się od wydania, które zaczęło go mierzyć; wcześniejsze wysyłki nie mają pomiaru.">
      <Tabela naglowki={["kto", "wysłanych", "cofnięte wysyłki", "cofnięte zakończenia",
        "mediana do wysyłki", "szkic bez zmian"]} pusto="Brak wysyłek w tym oknie.">
        {t.data.osoby.map((o) => <tr key={o.osoba}>
          <Td>{o.osoba}</Td>
          <Td className="tabular-nums">{o.wyslanych}</Td>
          <Td className="tabular-nums">{o.cofnietychWysylek}</Td>
          <Td className="tabular-nums">{o.cofnietychZakonczen}</Td>
          <Td className="tabular-nums">{sekundy(o.medianaSekDoWysylki)}</Td>
          <Td className="tabular-nums">{procent(o.udzialBezZmian)}
            {o.zeSzkicem > 0 && <span className="text-slate-600"> ({o.bezZmian} z {o.zeSzkicem})</span>}</Td>
        </tr>)}
      </Tabela>
    </KartaWgladu>}
  </>;
}
