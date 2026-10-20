import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useOkno } from "../nawigacja/fokus";

/* Powiększenie odpowiada na pytanie „co dokładnie widać na zdjęciu”: czy to
   ten sam wariant, który wrócił, i gdzie klient widzi usterkę.

   OBRAZ WCHODZI PROPSEM, nie hakiem po `twId`. Źródła są trzy — kartoteka
   Subiekta, oferta Allegro i załącznik klienta — a okno jest dla nich
   takie samo. Wybór źródła należy do kafla, który je otworzył.

   GALERIA I LUPA, decyzją właściciela. Klient przysyła usterkę kilkoma
   zdjęciami, a pęknięcie z telefonu w oknie 70% wysokości ekranu bywa
   niewidoczne. Przełączanie dostaje okno tylko od galerii rozmowy
   (`Galeria.tsx`); lupa jest przy każdym zdjęciu. */

/** Przybliżenie lupy względem zdjęcia w oknie. Zdjęcie z telefonu ma kilka
    razy więcej pikseli niż okno, więc lupa pokazuje szczegół, nie rozmycie. */
const PRZYBLIZENIE = 3;
/** Promień lupy w pikselach ekranu: tyle, żeby objąć gwint albo pęknięcie. */
const PROMIEN = 90;

export type SterowanieGalerii = {
  /** Numer bieżącego zdjęcia, od jedynki. */
  pozycja: number;
  ile: number;
  poprzednie: () => void;
  nastepne: () => void;
};

export function Powiekszenie({ url, nazwa, symbol, zamknij, galeria }: {
  /** `undefined` = jeszcze się ładuje, `null` = obrazu nie ma. */
  url: string | null | undefined;
  nazwa: string; symbol: string | null; zamknij: () => void;
  /** Kilka zdjęć jednej rozmowy; bez niego okno pokazuje jedno zdjęcie. */
  galeria?: SterowanieGalerii;
}) {

  /* Escape zamyka, jak każdy dialog w tym panelu. Bez tego operator
     szukałby myszką krzyżyka w rogu. Okno jest modalne także dla
     klawiatury: skróty strony pod nakładką milkną (`nawigacja/fokus.ts`). */
  const okno = useOkno<HTMLDivElement>({ onZamknij: zamknij });
  /* Lupa zostaje włączona przy przełączaniu: agent, który ogląda szczegóły,
     ogląda je na każdym zdjęciu po kolei. */
  const [lupa, setLupa] = useState(false);

  /* Strzałki wprost w oknie, bo fokus stoi w nim od otwarcia. Okno bez pól
     pisania nie ma komu tych klawiszy zabrać. */
  const klawisz = (e: React.KeyboardEvent) => {
    if (!galeria || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); galeria.poprzednie(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); galeria.nastepne(); }
  };

  const strzalka = (kierunek: "poprzednie" | "nastepne") => galeria && <button type="button"
    onClick={galeria[kierunek]} aria-keyshortcuts={kierunek === "poprzednie" ? "ArrowLeft" : "ArrowRight"}
    aria-label={kierunek === "poprzednie" ? "Poprzednie zdjęcie" : "Następne zdjęcie"}
    title={kierunek === "poprzednie" ? "Poprzednie zdjęcie (←)" : "Następne zdjęcie (→)"}
    className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900">
    {kierunek === "poprzednie" ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
  </button>;

  return <div role="dialog" {...okno} aria-label={`Zdjęcie: ${nazwa}`} onKeyDown={klawisz}
    aria-keyshortcuts={galeria ? "ArrowLeft ArrowRight" : undefined}
    className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onClick={zamknij}>
    <div className={`max-h-full w-full overflow-auto rounded-xl bg-white p-4 ${galeria ? "max-w-4xl" : "max-w-2xl"}`}
      onClick={(e) => e.stopPropagation()}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-bold">{nazwa}</h2>
          {symbol && <p className="text-sm text-slate-500">{symbol}</p>}
        </div>
        {/* Licznik mówi, ile jeszcze zostało do obejrzenia. Strzałki
            zawijają się na końcu, więc bez niego nie widać, gdzie koniec. */}
        {galeria && <span className="ml-auto shrink-0 pt-0.5 text-sm tabular-nums text-slate-600">
          {galeria.pozycja} z {galeria.ile}</span>}
        {url && <button type="button" onClick={() => setLupa((l) => !l)} aria-pressed={lupa}
          title="Lupa — przybliża miejsce pod kursorem"
          className={`${galeria ? "" : "ml-auto"} inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold ${
            lupa ? "border-sky-700 bg-sky-50 text-sky-900" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
          <Search size={16} />Lupa</button>}
        <button onClick={zamknij} aria-label="Zamknij"
          className={`${galeria || url ? "" : "ml-auto"} rounded-lg p-1 text-slate-500 hover:bg-slate-100`}><X size={20} /></button>
      </div>
      <div className="flex items-center gap-3">
        {strzalka("poprzednie")}
        <div className="flex min-w-0 flex-1 justify-center">
          {url
            ? <ObrazZLupa url={url} nazwa={nazwa} lupa={lupa} />
            : <p className="p-10 text-center text-sm text-slate-500">
                {url === null ? "Ta kartoteka nie ma zdjęcia." : "Wczytuję…"}</p>}
        </div>
        {strzalka("nastepne")}
      </div>
    </div>
  </div>;
}

/**
 * Zdjęcie z lupą: okrąg pod kursorem pokazuje to samo miejsce przybliżone.
 *
 * Lupa zamiast powiększenia całego obrazu, bo agent szuka szczegółu, a nie
 * chce zgubić, w którym miejscu zdjęcia jest. Tło lupy to ten sam plik
 * w pełnej rozdzielczości, więc przybliżenie nie dokłada żądania.
 */
function ObrazZLupa({ url, nazwa, lupa }: { url: string; nazwa: string; lupa: boolean }) {
  const [punkt, setPunkt] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const widac = lupa && punkt !== null;

  return <div className={`relative max-w-full overflow-hidden rounded-lg ${lupa ? "cursor-crosshair touch-none" : ""}`}
    onPointerMove={lupa ? (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setPunkt({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height });
    } : undefined}
    onPointerLeave={() => setPunkt(null)}>
    <img src={url} alt={nazwa} className="block max-h-[70vh] max-w-full" />
    {widac && <div data-lupa aria-hidden="true"
      className="pointer-events-none absolute rounded-full border-2 border-white shadow-lg ring-1 ring-slate-500"
      style={{
        width: PROMIEN * 2, height: PROMIEN * 2,
        left: punkt.x - PROMIEN, top: punkt.y - PROMIEN,
        backgroundImage: `url("${url}")`, backgroundRepeat: "no-repeat",
        backgroundSize: `${punkt.w * PRZYBLIZENIE}px ${punkt.h * PRZYBLIZENIE}px`,
        backgroundPosition: `${PROMIEN - punkt.x * PRZYBLIZENIE}px ${PROMIEN - punkt.y * PRZYBLIZENIE}px`,
      }} />}
  </div>;
}
