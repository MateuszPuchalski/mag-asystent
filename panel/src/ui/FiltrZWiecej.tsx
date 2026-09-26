import React from "react";
import { FiltrSegmentowy, type PozycjaFiltra } from "./index";

/* ── KUBEŁKI PRACY NA WIERZCHU, PRZEGLĄDANIE POD „WIĘCEJ" (0.522.0) ─────────
   Zgłoszenie agentów: „aplikacja przytłacza". 0.506.0 zwinęło w Skrzynce
   „Oczekujące" i „Zakończone" do listy „Więcej", bo robotę robi się w trzech
   kubełkach, a te dwa się przegląda. Ta sama diagnoza stoi na każdej kolejce
   obsługi: „Tylko wgląd" zajmował pigułkę równą „Do decyzji".

   KOMPONENT, NIE KOPIA. W Skrzynce ten układ stał wpisany w kolejkę. Przepisany
   na trzy kolejne ekrany byłby trzema kształtami jednego wyboru — dokładnie tym,
   co 0.262.0 zlikwidowało przy pigułkach.

   CO ZOSTAJE: pigułki dalej rysuje `FiltrSegmentowy`, więc kształt wyboru jest
   jeden. Lista to zwykły `<select>`: jedno kliknięcie do każdego ukrytego
   kubełka, liczba w opcji, a wybrany ukryty kubełek pokazuje swoją nazwę
   i obwódkę atramentu. Stanu, którego nie widać, nie ma. Klawisze cyfr
   zostają przy ekranie, więc ukrycie niczego nie zabiera klawiaturze.

   WARTOŚĆ OPCJI TO INDEKS, nie klucz. Klucze kubełków bywają `null`
   („Wszystkie") i liczbą, a `<select>` zna wyłącznie napisy. */
export function FiltrZWiecej<T extends string | number | null>({
  wybrany, onWybierz, pozycje, wiecej,
}: {
  wybrany: T;
  onWybierz: (v: T) => void;
  pozycje: Array<PozycjaFiltra<T>>;
  /** Klucze kubełków do przeglądania — stoją pod „Więcej", nie na wierzchu. */
  wiecej: ReadonlyArray<T>;
}) {
  const ukryte = pozycje.filter((p) => wiecej.includes(p.klucz));
  const naWierzchu = pozycje.filter((p) => !wiecej.includes(p.klucz));
  const wybranyUkryty = ukryte.findIndex((p) => p.klucz === wybrany);
  return <>
    <FiltrSegmentowy<T> wybrany={wybrany} onWybierz={onWybierz} pozycje={naWierzchu} />
    {ukryte.length > 0 && <select aria-label="Więcej kubełków"
      value={wybranyUkryty < 0 ? "" : String(wybranyUkryty)}
      title={wybranyUkryty < 0 ? "Kubełki do przeglądania" : ukryte[wybranyUkryty].podpowiedz}
      onChange={(e) => { if (e.target.value !== "") onWybierz(ukryte[Number(e.target.value)].klucz); }}
      /* Reszta rzędu, nie własna szerokość (0.506.0): stała szerokość
         125 px spadała w kolumnie 360 px pod kubełki i dokładała rząd. */
      className={`field w-auto min-w-0 flex-1 basis-[5.5rem] py-1 text-xs font-semibold ${
        wybranyUkryty < 0 ? "" : "border-wertis-ink"}`}>
      <option value="">Więcej…</option>
      {ukryte.map((p, i) => <option key={String(p.klucz)} value={String(i)} title={p.podpowiedz}>
        {p.etykieta}{p.ile === undefined ? "" : ` · ${p.ile}`}</option>)}
    </select>}
  </>;
}
