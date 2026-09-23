import React from "react";
import { useKolektory, useSzukanieKolektora, type Kolektor } from "../api/kolektory";
import { Blad, Przycisk, godzina, wiek } from "../ui";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Zgubiony kolektor ─────────────────────────────────────────────────
   Biuro każe odłożonemu gdzieś kolektorowi dzwonić, a hala idzie na dźwięk.
   To samo może kolega z własnego kolektora (Ustawienia → ZNAJDŹ KOLEKTOR).

   KARTA MÓWI, CZY KOLEKTOR SŁYSZY, zanim ktoś pójdzie nasłuchiwać. Kolektor
   sam pyta o wezwanie co 10 s, więc uśpiony albo z padniętą baterią nie
   zadzwoni wcale. Bez tego zdania szukający chodziłby po hali w ciszy
   i nie wiedziałby, czy szuka źle, czy kolektor milczy.

   Kolejność wierszy daje serwer: najświeżej widziane na górze. Zgubiony
   kolektor zwykle był używany niedawno, a wycofane stoją na dole. */

function StanKolektora({ k }: { k: Kolektor }) {
  const w = k.wezwanie;
  if (w) {
    const zostalo = wiek(Date.parse(w.doKiedy) - Date.now());
    return w.odebrane
      ? <span className="font-bold text-emerald-700">Dzwoni · wezwał(a) {w.przez} · jeszcze {zostalo}</span>
      : <span className="font-bold text-amber-700">Czeka, aż kolektor zapyta (do 10 s) · wezwał(a) {w.przez}</span>;
  }
  if (!k.zalogowany) return <span className="text-slate-600">Wylogowany — nie zadzwoni</span>;
  if (k.slucha) return <span className="text-emerald-700">Słucha — zadzwoni od razu</span>;
  return <span className="text-slate-600">
    Cisza od {godzina(k.ostatnioWidziany)} — uśpiony albo bez baterii; zadzwoni, gdy się obudzi</span>;
}

export function KartaKolektorow() {
  const lista = useKolektory();
  const szukanie = useSzukanieKolektora();
  const kolektory = lista.data?.kolektory ?? [];

  return <KartaWgladu id="karta-kolektory" tytul="Zgubiony kolektor"
    opis="Zadzwoń każe kolektorowi grać głośny alarm przez 5 minut, także przy ściszonym dźwięku. Kończy go ZNALAZŁEM na kolektorze albo Przestań tutaj.">
    <Blad>{lista.error?.message || szukanie.error?.message}</Blad>
    <Tabela naglowki={["Kolektor", "Ostatnio pracował(a)", "Widziany", "Stan", ""]}
      pusto="Żaden kolektor nie logował się w ostatnich 30 dniach.">
      {kolektory.map((k) => <tr key={k.deviceId}>
        <Td className="font-mono font-bold">{k.etykieta}</Td>
        <Td>{k.osoba ?? "—"}</Td>
        <Td className="whitespace-nowrap text-slate-600">{godzina(k.ostatnioWidziany)}</Td>
        <Td><StanKolektora k={k} /></Td>
        <Td className="text-right">
          {k.wezwanie
            ? <Przycisk disabled={szukanie.isPending}
                onClick={() => szukanie.mutate({ deviceId: k.deviceId, ruch: "odwolaj" })}>Przestań</Przycisk>
            : <Przycisk wariant="glowny" disabled={szukanie.isPending || !k.zalogowany}
                aria-label={`Zadzwoń na kolektor ${k.etykieta}`}
                onClick={() => szukanie.mutate({ deviceId: k.deviceId, ruch: "wezwij" })}>Zadzwoń</Przycisk>}
        </Td>
      </tr>)}
    </Tabela>
  </KartaWgladu>;
}
