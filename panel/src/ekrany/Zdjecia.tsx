import React, { useEffect, useRef, useState } from "react";
import { ImageOff, ImagePlus } from "lucide-react";
import {
  NA_STRONIE, useBezZdjecia, type PozycjaBezZdjecia, type SortBezZdjecia, type ZapisanieZdjecia,
} from "../api/zdjecia";
import { Blad, EtykietaWartosci, Karta, Pole, Przycisk, Pusto, WierszKolejki, ile } from "../ui";
import { Edytor } from "../zdjecia/Edytor";
import { klawiszZajety } from "../nawigacja/fokus";

/* ── ZDJĘCIA: TOWARY BEZ ZDJĘCIA ───────────────────────────────────────────
   Praca seryjna przy biurku: kartoteki Subiekta bez obrazu, jedna po drugiej.
   Lewa kolumna to lista, prawa to edytor wybranego towaru. Po zatwierdzeniu
   ekran sam przechodzi do następnego towaru bez zdjęcia. Agent nie szuka
   kolejnego kroku, bo ekran go zna (ergonomia, punkt 1).

   Towar ze zdjęciem w kolejce stoi na liście wyszarzony i nie da się go
   wybrać. Drugie zdjęcie tego samego towaru byłoby pracą wyrzuconą,
   gdy pierwsze dojdzie do Subiekta (punkt 6).

   Zatwierdzone w tej wizycie pamiętamy u siebie. Lista z serwera dochodzi
   chwilę później, a do tego czasu wiersz już ma być w kolejce. */

const SORTOWANIA: Array<{ wartosc: SortBezZdjecia; etykieta: string }> = [
  { wartosc: "stan", etykieta: "Największy stan" },
  { wartosc: "symbol", etykieta: "Symbol" },
  { wartosc: "nazwa", etykieta: "Nazwa" },
  { wartosc: "najnowsze", etykieta: "Najnowsze kartoteki" },
];

const LICZBA = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 3 });

/** Następny towar do zrobienia: pierwszy wolny za bieżącym, potem od góry listy. */
export function nastepnyWolny(lista: PozycjaBezZdjecia[], biezacy: number, zrobione: ReadonlySet<number>):
  PozycjaBezZdjecia | null {
  const wolny = (p: PozycjaBezZdjecia) => !p.oczekuje && !zrobione.has(p.twId) && p.twId !== biezacy;
  const i = lista.findIndex((p) => p.twId === biezacy);
  return lista.slice(i + 1).find(wolny) ?? lista.slice(0, Math.max(0, i)).find(wolny) ?? null;
}

/** Sąsiad w liście dla `j`/`k`, z pominięciem towarów czekających w kolejce. */
export function sasiad(lista: PozycjaBezZdjecia[], biezacy: number | null, krok: 1 | -1,
  zrobione: ReadonlySet<number>): PozycjaBezZdjecia | null {
  const wolne = lista.filter((p) => !p.oczekuje && !zrobione.has(p.twId));
  if (wolne.length === 0) return null;
  const i = wolne.findIndex((p) => p.twId === biezacy);
  if (i < 0) return wolne[krok === 1 ? 0 : wolne.length - 1];
  return wolne[i + krok] ?? null;
}

function Wiersz({ p, wybrany, wKolejce, onWybierz }: {
  p: PozycjaBezZdjecia; wybrany: boolean; wKolejce: boolean; onWybierz: () => void;
}) {
  const tresc = <>
    <span className="flex items-baseline justify-between gap-2">
      <span className="truncate font-mono text-sm text-slate-800">{p.symbol}</span>
      {wKolejce ? <EtykietaWartosci className="shrink-0">w kolejce</EtykietaWartosci>
        /* Stan przy symbolu: przy sortowaniu po stanie to on tłumaczy kolejność. */
        : <span className={`shrink-0 text-sm tabular-nums ${p.stan > 0 ? "text-slate-700" : "text-slate-500"}`}>
            stan {LICZBA.format(p.stan)}</span>}
    </span>
    <span className={`line-clamp-2 text-sm ${wKolejce ? "text-slate-500" : "text-slate-900"}`}>{p.nazwa}</span>
    {p.ean && <span className="font-mono text-podpis text-slate-500">{p.ean}</span>}
  </>;
  if (!wKolejce) return <WierszKolejki aktywny={wybrany} onKlik={onWybierz}>{tresc}</WierszKolejki>;
  return <li>
    <button type="button" disabled title="Zdjęcie tego towaru czeka w kolejce do Subiekta"
      className="flex w-full cursor-not-allowed flex-col border-l-[3px] border-l-transparent px-4 py-2 text-left">
      {tresc}
    </button>
  </li>;
}

export function Zdjecia() {
  const [fraza, setFraza] = useState("");
  /* Szukanie liczy serwer — ćwierć sekundy przerwy, jak w koszach i dostawach. */
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [sortuj, setSortuj] = useState<SortBezZdjecia>("stan");
  const [naStanie, setNaStanie] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setQ(fraza.trim()); setOffset(0); }, 250);
    return () => clearTimeout(t);
  }, [fraza]);
  const lista = useBezZdjecia(q, offset, sortuj, naStanie);
  const [wybrany, setWybrany] = useState<PozycjaBezZdjecia | null>(null);
  const [zrobione, setZrobione] = useState<ReadonlySet<number>>(() => new Set());
  const [ostatni, setOstatni] = useState("");
  /* Domyślnie wyłączone, decyzją właściciela. Stan żyje tu, nie w edytorze,
     więc przeżywa przejście do następnego towaru. */
  const [bialeKwadrat, setBialeKwadrat] = useState(false);

  const pozycje = lista.data?.pozycje ?? [];
  /* Pierwszy wolny towar wybiera się sam. Wybór nie jest zapisem, a oszczędza
     klik przy każdym wejściu na ekran. */
  useEffect(() => {
    if (wybrany) return;
    const p = pozycje.find((x) => !x.oczekuje && !zrobione.has(x.twId));
    if (p) setWybrany(p);
  }, [pozycje, wybrany, zrobione]);

  /* j/k jak w kolejkach obsługi: ten sam ruch po liście na każdym ekranie
     pracy seryjnej. Słuchacz czyta ref, bo wstaje raz. */
  const ruch = useRef<(e: KeyboardEvent) => void>(() => undefined);
  ruch.current = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || klawiszZajety(e.target)) return;
    if (e.key !== "j" && e.key !== "k") return;
    const p = sasiad(pozycje, wybrany?.twId ?? null, e.key === "j" ? 1 : -1, zrobione);
    if (p) { e.preventDefault(); setWybrany(p); setOstatni(""); }
  };
  useEffect(() => {
    const sluchaj = (e: KeyboardEvent) => ruch.current(e);
    window.addEventListener("keydown", sluchaj);
    return () => window.removeEventListener("keydown", sluchaj);
  }, []);

  if (lista.data && !lista.data.wlaczone) {
    return <Karta className="flex lg:h-full">
      <Pusto ikona={ImageOff}>{lista.data.powod ?? "Dodawanie zdjęć jest w tej instalacji wyłączone."}</Pusto>
    </Karta>;
  }

  const zapisano = (biezacy: PozycjaBezZdjecia) => (w: ZapisanieZdjecia) => {
    const nowe = new Set(zrobione).add(biezacy.twId);
    setZrobione(nowe);
    setOstatni(w.wSubiekcie
      ? `Zapisano zdjęcie ${biezacy.symbol}. Do Subiekta trafi z kolejki za chwilę.`
      : `Zapisano zdjęcie ${biezacy.symbol} w WERTIS. Ta instalacja nie wysyła zdjęć do Subiekta.`);
    setWybrany(nastepnyWolny(pozycje, biezacy.twId, nowe));
  };

  /* „Pomiń” niczego nie zapisuje: towar zostaje na liście, a ekran idzie dalej. */
  const pomin = (biezacy: PozycjaBezZdjecia) => {
    const p = nastepnyWolny(pozycje, biezacy.twId, zrobione);
    return p ? () => { setWybrany(p); setOstatni(""); } : undefined;
  };

  const razem = lista.data?.razem;
  /* Awaria zapytania do bazy Subiekta (503) to nie wyłączona funkcja.
     Mija sama, więc obok zdania stoi ponowienie, a nie wyjaśnienie konfiguracji. */
  const bladListy = lista.error && <div className="flex flex-col gap-2 p-2">
    <Blad>{(lista.error as Error).message}</Blad>
    <Przycisk onClick={() => void lista.refetch()} disabled={lista.isFetching}>
      {lista.isFetching ? "Pytam jeszcze raz…" : "Spróbuj jeszcze raz"}</Przycisk>
  </div>;
  const lewa = lista.isLoading ? <Pusto waga="lista">Wczytuję towary bez zdjęcia…</Pusto>
    /* Błąd bez danych zamiast „wszystko ma zdjęcie” — awaria to nie koniec pracy. */
    : lista.error && !lista.data ? bladListy
    : pozycje.length === 0 ? <Pusto waga="lista">{q ? "Nic nie pasuje do szukania."
        : naStanie ? "Każdy towar na stanie ma zdjęcie." : "Każdy towar ma zdjęcie."}</Pusto>
    : <ul className="divide-y divide-slate-100">
        {pozycje.map((p) => <Wiersz key={p.twId} p={p} wybrany={wybrany?.twId === p.twId}
          wKolejce={p.oczekuje || zrobione.has(p.twId)}
          onWybierz={() => { setWybrany(p); setOstatni(""); }} />)}
      </ul>;

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[23rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[25rem_minmax(0,1fr)]">
      <Karta className="flex min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 p-2">
          <Pole value={fraza} onChange={(e) => setFraza(e.target.value)}
            placeholder="Symbol, nazwa albo EAN" aria-label="Szukaj towaru bez zdjęcia" />
          {/* Zmiana porządku albo filtra wraca na pierwszą stronę: dalsza strona
              innego porządku to przypadkowy wycinek listy. */}
          <div className="mt-2 flex items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-700">Kolejność
              <select className="field min-w-0 flex-1" value={sortuj}
                onChange={(e) => { setSortuj(e.target.value as SortBezZdjecia); setOffset(0); }}>
                {SORTOWANIA.map((s) => <option key={s.wartosc} value={s.wartosc}>{s.etykieta}</option>)}
              </select>
            </label>
            <label className="flex shrink-0 items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={naStanie}
                onChange={(e) => { setNaStanie(e.target.checked); setOffset(0); }} />
              Tylko na stanie
            </label>
          </div>
        </div>
        <div className="shrink-0 border-y border-slate-200 bg-slate-50 px-3 py-1">
          <span className="text-xs font-semibold text-slate-600">
            {razem === undefined ? "Towary bez zdjęcia" : `${ile(razem, "towar", "towary", "towarów")} bez zdjęcia`}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{lewa}</div>
        {lista.data && bladListy}
        {razem !== undefined && razem > NA_STRONIE && <nav aria-label="Strony listy"
          className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 p-2 text-sm text-slate-600">
          <Przycisk disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - NA_STRONIE))}>Wstecz</Przycisk>
          <span>{offset + 1}–{Math.min(offset + NA_STRONIE, razem)} z {razem}</span>
          <Przycisk disabled={offset + NA_STRONIE >= razem} onClick={() => setOffset(offset + NA_STRONIE)}>Dalej</Przycisk>
        </nav>}
      </Karta>
      <Karta className="flex min-h-0 flex-col overflow-hidden">
        {ostatni && <p role="status" className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{ostatni}</p>}
        {wybrany
          /* Klucz po towarze: nowy towar to świeży edytor, a stary porzuca swój podgląd. */
          ? <Edytor key={wybrany.twId} towar={wybrany} onZapisano={zapisano(wybrany)}
              bialeKwadrat={bialeKwadrat} onBialeKwadrat={setBialeKwadrat}
              onPomin={pomin(wybrany)} />
          : <Pusto ikona={ImagePlus}>{pozycje.length ? "Wybierz towar z listy." : "Nie ma towaru do zdjęcia."}</Pusto>}
      </Karta>
    </div>
  </div>;
}
