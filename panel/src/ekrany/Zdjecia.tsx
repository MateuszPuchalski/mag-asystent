import React, { useEffect, useState } from "react";
import { ImageOff, ImagePlus } from "lucide-react";
import { NA_STRONIE, useBezZdjecia, type PozycjaBezZdjecia, type ZapisanieZdjecia } from "../api/zdjecia";
import { Blad, EtykietaWartosci, Karta, Pole, Przycisk, Pusto, WierszKolejki, ile } from "../ui";
import { Edytor } from "../zdjecia/Edytor";

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

/** Następny towar do zrobienia: pierwszy wolny za bieżącym, potem od góry listy. */
export function nastepnyWolny(lista: PozycjaBezZdjecia[], biezacy: number, zrobione: ReadonlySet<number>):
  PozycjaBezZdjecia | null {
  const wolny = (p: PozycjaBezZdjecia) => !p.oczekuje && !zrobione.has(p.twId) && p.twId !== biezacy;
  const i = lista.findIndex((p) => p.twId === biezacy);
  return lista.slice(i + 1).find(wolny) ?? lista.slice(0, Math.max(0, i)).find(wolny) ?? null;
}

function Wiersz({ p, wybrany, wKolejce, onWybierz }: {
  p: PozycjaBezZdjecia; wybrany: boolean; wKolejce: boolean; onWybierz: () => void;
}) {
  const tresc = <>
    <span className="flex items-baseline justify-between gap-2">
      <span className="truncate font-mono text-sm text-slate-800">{p.symbol}</span>
      {wKolejce && <EtykietaWartosci className="shrink-0">w kolejce</EtykietaWartosci>}
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
  useEffect(() => {
    const t = setTimeout(() => { setQ(fraza.trim()); setOffset(0); }, 250);
    return () => clearTimeout(t);
  }, [fraza]);
  const lista = useBezZdjecia(q, offset);
  const [wybrany, setWybrany] = useState<PozycjaBezZdjecia | null>(null);
  const [zrobione, setZrobione] = useState<ReadonlySet<number>>(() => new Set());
  const [ostatni, setOstatni] = useState("");

  const pozycje = lista.data?.pozycje ?? [];
  /* Pierwszy wolny towar wybiera się sam. Wybór nie jest zapisem, a oszczędza
     klik przy każdym wejściu na ekran. */
  useEffect(() => {
    if (wybrany) return;
    const p = pozycje.find((x) => !x.oczekuje && !zrobione.has(x.twId));
    if (p) setWybrany(p);
  }, [pozycje, wybrany, zrobione]);

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
    : pozycje.length === 0 ? <Pusto waga="lista">{q ? "Nic nie pasuje do szukania." : "Każdy towar ma zdjęcie."}</Pusto>
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
          ? <Edytor key={wybrany.twId} towar={wybrany} onZapisano={zapisano(wybrany)} />
          : <Pusto ikona={ImagePlus}>{pozycje.length ? "Wybierz towar z listy." : "Nie ma towaru do zdjęcia."}</Pusto>}
      </Karta>
    </div>
  </div>;
}
