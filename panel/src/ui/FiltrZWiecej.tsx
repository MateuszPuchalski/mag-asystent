import React from "react";
import { FiltrSegmentowy, type PozycjaFiltra } from "./index";

/* ── KUBEŁKI PRACY NA WIERZCHU, PRZEGLĄDANIE POD „WIĘCEJ" ───────────────────
   Robotę robi się w kilku kubełkach, a resztę się przegląda. „Tylko wgląd"
   nie zajmuje pigułki równej „Do decyzji", żeby aplikacja nie przytłaczała.

   KOMPONENT, NIE KOPIA. Przepisany na kilka ekranów układ byłby kilkoma
   kształtami jednego wyboru.

   CO ZOSTAJE: pigułki dalej rysuje `FiltrSegmentowy`, więc kształt wyboru jest
   jeden. Lista to zwykły `<select>`: jedno kliknięcie do każdego ukrytego
   kubełka, liczba w opcji, a wybrany ukryty kubełek pokazuje swoją nazwę
   i obwódkę atramentu. Stanu, którego nie widać, nie ma. Klawisze cyfr
   zostają przy ekranie, więc ukrycie niczego nie zabiera klawiaturze.

   WARTOŚĆ OPCJI TO INDEKS, nie klucz. Klucze kubełków bywają `null`
   („Wszystkie") i liczbą, a `<select>` zna wyłącznie napisy.

   ── TRYB ZWARTY ─────────────────────────────────────────────────────────────
   Lista rozciągnięta na resztę rzędu po zawinięciu staje się pełnoszerokim
   paskiem pod kubełkami — osobnym pasmem sterowania nad pytaniami. W trybie
   zwartym „Więcej" ma szerokość swojej treści (`field-sizing: content`):
   stoi obok pigułek i schodzi do drugiego rzędu tylko wtedy, gdy się nie
   mieści. Przeglądarka bez `field-sizing` bierze szerokość najdłuższej
   opcji, czyli dalej zwarty element, tylko szerszy. Tryb jest wyborem
   ekranu, bo pozostałe kolejki mają inne szerokości kolumn. */
export function FiltrZWiecej<T extends string | number | null>({
  wybrany, onWybierz, pozycje, wiecej, zwarty = false,
}: {
  wybrany: T;
  onWybierz: (v: T) => void;
  pozycje: Array<PozycjaFiltra<T>>;
  /** Klucze kubełków do przeglądania — stoją pod „Więcej", nie na wierzchu. */
  wiecej: ReadonlyArray<T>;
  /** „Więcej" na szerokość treści, nie na resztę rzędu — patrz komentarz wyżej. */
  zwarty?: boolean;
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
      /* Reszta rzędu, nie własna szerokość: stała szerokość
         125 px spadałaby w kolumnie 360 px pod kubełki i dokładała rząd.
         Tryb zwarty mierzy się treścią, więc stałej szerokości też nie ma. */
      className={`field w-auto py-1 text-xs font-semibold ${zwarty
        ? "shrink-0 px-2 [field-sizing:content]" : "min-w-0 flex-1 basis-[5.5rem]"} ${
        wybranyUkryty < 0 ? "" : "border-wertis-ink"}`}>
      {/* Bez wielokropka w trybie zwartym: strzałkę rysuje sama lista,
          a „Więcej…" obok niej mówiłoby dwa razy „jest tu coś jeszcze". */}
      <option value="">{zwarty ? "Więcej" : "Więcej…"}</option>
      {ukryte.map((p, i) => <option key={String(p.klucz)} value={String(i)} title={p.podpowiedz}>
        {p.etykieta}{p.ile === undefined ? "" : ` · ${p.ile}`}</option>)}
    </select>}
  </>;
}
