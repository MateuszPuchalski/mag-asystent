import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Crop, ImagePlus, RotateCcw, RotateCw, SkipForward, Undo2 } from "lucide-react";
import { Konflikt, Wygaslo } from "../api/klient";
import {
  usePorzucPodglad, useWstepneZdjecie, useZapiszZdjecie, type PodgladZdjecia, type PozycjaBezZdjecia,
  type ZapisanieZdjecia,
} from "../api/zdjecia";
import { klawiszZajety, oknoModalne } from "../nawigacja/fokus";
import { Klawisz } from "../nawigacja/Klawisz";
import { Blad, NaglowekSekcji, Przycisk, SymbolTowaru } from "../ui";
import { doWyslania, podgladEdycji, wczytajPlik, zlozGotowy, type Plik, type Zrodlo } from "./obraz";
import { kadrZPrzeciagniecia, obroc, type Kadr, type Obrot, type Punkt } from "./obrobka";

/* ── EDYTOR ZDJĘCIA JEDNEGO TOWARU ─────────────────────────────────────────
   Trzy kroki w jednej kolumnie: zdjęcie, poprawki, podgląd po usunięciu tła.
   Każdy krok ma jedno główne działanie, a reszta stoi obok jako przełącznik.
   Typowy towar to: wklej, Enter (usuń tło), Enter (zatwierdź). Ręka nie
   schodzi z klawiatury, a każdy przełącznik ma swoją literę.

   „Białe tło i kwadrat” jest domyślnie wyłączone, decyzją właściciela.
   Wybór trzyma ekran, nie edytor: przy pracy seryjnej agent ustawia go
   raz, a nie przy każdym towarze.

   Podgląd żyje na serwerze. Porzucamy go, gdy agent wybiera inne zdjęcie,
   inny towar albo wychodzi z ekranu — inaczej plik czekałby kwadrans
   na wygaśnięcie. */

const LICZBA = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 3 });

const opis = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* Enter na przycisku, polu wyboru czy etykiecie należy do niego — ten sam
   klawisz z okna kliknąłby główne działanie drugi raz. */
const naKontrolce = (t: EventTarget | null) =>
  t instanceof Element && t.closest("button, a, select, label, input") !== null;

function Przelacznik({ zaznaczony, onZmiana, wylaczony, tytul, children }: {
  zaznaczony: boolean; onZmiana: (v: boolean) => void; wylaczony?: boolean; tytul?: string;
  children: React.ReactNode;
}) {
  return <label title={tytul} className={`inline-flex min-h-10 items-center gap-2 text-sm font-semibold ${
    wylaczony ? "text-slate-500" : "text-slate-800"}`}>
    <input type="checkbox" checked={zaznaczony} disabled={wylaczony} onChange={(e) => onZmiana(e.target.checked)}
      className="h-4 w-4 accent-wertis-ink" />
    {children}
  </label>;
}

/** Wybór pliku z dysku. Pole jest w etykiecie, więc klik w napis otwiera okno wyboru. */
function WyborPliku({ onPlik, children, className = "btn-secondary" }: {
  onPlik: (p: File) => void; children: React.ReactNode; className?: string;
}) {
  return <label className={`${className} cursor-pointer`}>
    {children}
    <input type="file" accept="image/*" className="sr-only"
      onChange={(e) => { const p = e.target.files?.[0]; e.target.value = ""; if (p) onPlik(p); }} />
  </label>;
}

/**
 * Kadrowanie przeciągnięciem po obrazie.
 * Kadr trzyma części obrazu (0–1), więc nie zależy od rozmiaru, w jakim obraz stoi na ekranie.
 */
function Kadrowanie({ adres, kadr, onKadr }: { adres: string; kadr: Kadr | null; onKadr: (k: Kadr | null) => void }) {
  const ramka = useRef<HTMLDivElement | null>(null);
  const [start, setStart] = useState<Punkt | null>(null);
  const [biezacy, setBiezacy] = useState<Kadr | null>(null);
  const punkt = (e: React.PointerEvent): Punkt => {
    const r = ramka.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1) };
  };
  const widac = biezacy ?? kadr;
  return <div ref={ramka}
    className="relative mx-auto w-fit max-w-full cursor-crosshair touch-none select-none overflow-hidden rounded-lg border border-slate-200"
    onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setStart(punkt(e)); setBiezacy(null); }}
    onPointerMove={(e) => { if (start) setBiezacy(kadrZPrzeciagniecia(start, punkt(e))); }}
    onPointerUp={(e) => {
      if (!start) return;
      /* Samo kliknięcie bez przeciągnięcia nie kasuje kadru. Od tego jest
         osobny przycisk, bo przypadkowy klik nie ma cofać pracy. */
      const k = kadrZPrzeciagniecia(start, punkt(e));
      if (k) onKadr(k);
      setStart(null); setBiezacy(null);
    }}>
    <img src={adres} alt="Zdjęcie do wykadrowania" draggable={false} className="block max-h-[55vh] max-w-full" />
    {widac && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.5)]"
      style={{ left: `${widac.x * 100}%`, top: `${widac.y * 100}%`, width: `${widac.szer * 100}%`, height: `${widac.wys * 100}%` }} />}
  </div>;
}

export function Edytor({ towar, onZapisano, onPomin, bialeKwadrat, onBialeKwadrat }: {
  towar: PozycjaBezZdjecia;
  onZapisano: (w: ZapisanieZdjecia) => void;
  /** Następny towar bez zapisu — gdy tego nie ma pod ręką. */
  onPomin?: () => void;
  bialeKwadrat: boolean;
  onBialeKwadrat: (v: boolean) => void;
}) {
  const { twId } = towar;
  const wstepne = useWstepneZdjecie();
  const zapisz = useZapiszZdjecie();
  const porzuc = usePorzucPodglad();

  const [zrodlo, setZrodlo] = useState<Zrodlo | null>(null);
  const [wczytuje, setWczytuje] = useState(false);
  const [obrot, setObrot] = useState<Obrot>(0);
  const [kadr, setKadr] = useState<Kadr | null>(null);
  const [wyrownaj, setWyrownaj] = useState(true);
  const [przygotowuje, setPrzygotowuje] = useState(false);
  const [podglad, setPodglad] = useState<{ dane: PodgladZdjecia; wyslany: Plik } | null>(null);
  const [usunTlo, setUsunTlo] = useState(true);
  /* `undefined` = gotowe zdjęcie się składa; `null` = nie ma czego składać. */
  const [gotowy, setGotowy] = useState<Plik | null | undefined>(null);
  const [blad, setBlad] = useState("");

  /* Podgląd do porzucenia trzyma ref, bo sprzątanie przy wyjściu widzi
     tylko stan z chwili zamontowania. */
  const doPorzucenia = useRef<string | null>(null);
  const porzucTeraz = useRef(porzuc.mutate);
  porzucTeraz.current = porzuc.mutate;
  const porzucPodglad = () => {
    const id = doPorzucenia.current;
    doPorzucenia.current = null;
    if (id) porzucTeraz.current({ twId, podgladId: id });
  };
  useEffect(() => () => porzucPodglad(), []);

  const przyjmij = async (plik: Blob) => {
    setBlad("");
    if (plik.type && !plik.type.startsWith("image/")) {
      setBlad("To nie jest zdjęcie. Panel przyjmuje JPEG i PNG — wybierz inny plik.");
      return;
    }
    porzucPodglad();
    setPodglad(null);
    setWczytuje(true);
    try {
      setZrodlo(await wczytajPlik(plik));
      setObrot(0); setKadr(null);
    } catch (e) {
      setBlad(opis(e));
    } finally {
      setWczytuje(false);
    }
  };
  const przyjmijRef = useRef(przyjmij);
  przyjmijRef.current = przyjmij;

  /* Wklejenie ze schowka działa z każdego miejsca ekranu, także z pola
     szukania. Zdjęcie robione zrzutem ekranu albo kopiowane z przeglądarki
     to najczęstsze źródło, a celowanie w strefę to zbędny ruch.
     Pod oknem modalnym wklejenie należy do okna. */
  useEffect(() => {
    const wklej = (e: ClipboardEvent) => {
      if (oknoModalne()) return;
      const plik = [...(e.clipboardData?.items ?? [])]
        .find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (!plik) return;
      e.preventDefault();
      void przyjmijRef.current(plik);
    };
    window.addEventListener("paste", wklej);
    return () => window.removeEventListener("paste", wklej);
  }, []);

  const edycja = useMemo(() => {
    if (!zrodlo) return null;
    try { return podgladEdycji(zrodlo, obrot, wyrownaj); } catch (e) { return { blad: opis(e) }; }
  }, [zrodlo, obrot, wyrownaj]);

  const zTla = podglad !== null && usunTlo && podglad.dane.tlo === "usuniete";

  useEffect(() => {
    if (!podglad || !bialeKwadrat) { setGotowy(null); return; }
    let zywy = true;
    setGotowy(undefined);
    const [b64, mime] = zTla ? [podglad.dane.png, podglad.dane.mime] : [podglad.wyslany.base64, "image/jpeg"];
    zlozGotowy(b64, mime).then(
      (p) => { if (zywy) setGotowy(p); },
      (e) => { if (zywy) { setGotowy(null); setBlad(opis(e)); } });
    return () => { zywy = false; };
  }, [podglad, bialeKwadrat, zTla]);

  const przygotuj = async () => {
    if (!zrodlo) return;
    setBlad("");
    setPrzygotowuje(true);
    let wyslany: Plik;
    try {
      wyslany = await doWyslania(zrodlo, obrot, kadr, wyrownaj);
    } catch (e) {
      setBlad(opis(e)); setPrzygotowuje(false);
      return;
    }
    wstepne.mutate({ twId, zdjecie: wyslany.base64 }, {
      onSuccess: (dane) => {
        doPorzucenia.current = dane.podgladId;
        setPodglad({ dane, wyslany });
        /* Tło usunięte — domyślnie bierzemy wycięcie. Tło zostało — nie ma
           czego włączać, więc przełącznik gaśnie razem z powodem obok. */
        setUsunTlo(dane.tlo === "usuniete");
      },
      onError: (e) => setBlad(opis(e)),
      onSettled: () => setPrzygotowuje(false),
    });
  };

  const jeszczeRaz = () => {
    porzucPodglad();
    setPodglad(null);
    setBlad("");
  };

  const zatwierdz = () => {
    if (!podglad) return;
    setBlad("");
    zapisz.mutate({
      twId, podgladId: podglad.dane.podgladId, zTlem: !zTla,
      /* Bez „Białe tło i kwadrat” serwer zapisuje sam: wycięcie albo wysłany
         obraz, zależnie od `zTlem`. Gotowy plik z przeglądarki byłby tu kopią. */
      gotowy: bialeKwadrat ? gotowy?.base64 : undefined,
    }, {
      onSuccess: (w) => { doPorzucenia.current = null; onZapisano(w); },
      onError: (e) => {
        if (e instanceof Wygaslo) {
          doPorzucenia.current = null;
          setPodglad(null);
          setBlad("Podgląd wygasł na serwerze. Poprawki zostały — kliknij „Usuń tło i pokaż podgląd” jeszcze raz.");
          return;
        }
        setBlad(opis(e));
      },
    });
  };

  const upusc = (e: React.DragEvent) => {
    e.preventDefault();
    const plik = e.dataTransfer.files?.[0];
    if (plik) void przyjmij(plik);
  };

  const wylaczone = wstepne.error instanceof Konflikt || zapisz.error instanceof Konflikt;
  const mozePrzygotowac = !!zrodlo && !podglad && !przygotowuje && !wylaczone && !!edycja && "adres" in edycja;
  const mozeZatwierdzic = !!podglad && !zapisz.isPending && !(bialeKwadrat && !gotowy) && !wylaczone;
  const obrocW = (kierunek: 1 | -1) => { setObrot((o) => obroc(o, kierunek)); setKadr(null); };

  /* Klawisze czyta ref, bo słuchacz okna wstaje raz, a stan zmienia się
     przy każdym kroku. Pod oknem modalnym i w polu pisania milczą. */
  const klawisz = useRef<(e: KeyboardEvent) => void>(() => undefined);
  klawisz.current = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || klawiszZajety(e.target)) return;
    if (e.key === "Enter") {
      if (naKontrolce(e.target)) return;
      if (podglad ? mozeZatwierdzic : mozePrzygotowac) {
        e.preventDefault();
        if (podglad) zatwierdz(); else void przygotuj();
      }
      return;
    }
    if (e.key === "Escape") {
      if (podglad && !zapisz.isPending) { e.preventDefault(); jeszczeRaz(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (zrodlo && !podglad) {
      if (k === "l") obrocW(-1);
      else if (k === "p") obrocW(1);
      else if (k === "w") setWyrownaj((v) => !v);
    } else if (podglad) {
      if (k === "t" && podglad.dane.tlo === "usuniete") setUsunTlo(!zTla);
      else if (k === "b") onBialeKwadrat(!bialeKwadrat);
    }
  };
  useEffect(() => {
    const sluchaj = (e: KeyboardEvent) => klawisz.current(e);
    window.addEventListener("keydown", sluchaj);
    return () => window.removeEventListener("keydown", sluchaj);
  }, []);
  const poAdres = !podglad ? null
    : bialeKwadrat ? gotowy?.adres ?? null
      : zTla ? `data:${podglad.dane.mime};base64,${podglad.dane.png}` : podglad.wyslany.adres;

  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="shrink-0 border-b border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <SymbolTowaru symbol={towar.symbol} />
        {towar.ean && <span className="font-mono text-slate-600">EAN {towar.ean}</span>}
        {/* Stan mówi, czy towar w ogóle jest do sfotografowania na półce. */}
        <span className="tabular-nums text-slate-600">
          sprzedano {LICZBA.format(towar.sprzedaz)} w 30 dni · stan {LICZBA.format(towar.stan)}</span>
        {onPomin && <Przycisk className="ml-auto" onClick={onPomin}
          title="Następny towar bez zdjęcia — nic się nie zapisuje">
          <SkipForward size={16} />Pomiń <Klawisz>j</Klawisz></Przycisk>}
      </div>
      <h2 className="mt-1 text-naglowek font-bold text-slate-900">{towar.nazwa}</h2>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto p-4" onDragOver={(e) => e.preventDefault()} onDrop={upusc}>
      <div className="flex flex-col gap-4">
        {!zrodlo && <label className="flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center hover:border-slate-500">
          <ImagePlus size={38} className="text-slate-400" />
          <span className="text-tresc font-semibold text-slate-800">
            {wczytuje ? "Wczytuję zdjęcie…" : "Upuść zdjęcie tutaj albo wklej je ze schowka (Ctrl+V)"}</span>
          <span className="btn-secondary">Wybierz plik z dysku</span>
          <input type="file" accept="image/*" className="sr-only"
            onChange={(e) => { const p = e.target.files?.[0]; e.target.value = ""; if (p) void przyjmij(p); }} />
        </label>}

        {zrodlo && !podglad && <>
          {edycja && "adres" in edycja
            ? <Kadrowanie adres={edycja.adres} kadr={kadr} onKadr={setKadr} />
            : <Blad>{edycja?.blad}</Blad>}
          <p className="text-sm text-slate-600">
            <Crop size={14} className="mr-1 inline align-[-2px]" />
            Przeciągnij po zdjęciu, żeby zostawić sam towar.</p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Obrót kasuje kadr: prostokąt narysowany na leżącym zdjęciu
                po obrocie wskazywałby inny fragment, niż agent zaznaczył. */}
            <Przycisk onClick={() => obrocW(-1)}>
              <RotateCcw size={16} />Obróć w lewo <Klawisz>L</Klawisz></Przycisk>
            <Przycisk onClick={() => obrocW(1)}>
              <RotateCw size={16} />Obróć w prawo <Klawisz>P</Klawisz></Przycisk>
            <Przycisk onClick={() => setKadr(null)} disabled={!kadr}>Cały kadr</Przycisk>
            <Przelacznik zaznaczony={wyrownaj} onZmiana={setWyrownaj}
              tytul="Rozciąga jasność i kolory, żeby biel była bielą. Łagodnie, bez przesadnych barw.">
              Wyrównaj kolory <Klawisz>W</Klawisz></Przelacznik>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            <Przycisk wariant="glowny" onClick={() => void przygotuj()} disabled={!mozePrzygotowac}>
              {przygotowuje ? "Usuwam tło…" : "Usuń tło i pokaż podgląd"} <Klawisz>Enter</Klawisz></Przycisk>
            <WyborPliku onPlik={(p) => void przyjmij(p)}>Inne zdjęcie</WyborPliku>
          </div>
        </>}

        {podglad && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <figure className="flex flex-col gap-1">
              <figcaption><NaglowekSekcji>Przed</NaglowekSekcji></figcaption>
              <img src={podglad.wyslany.adres} alt="Zdjęcie przed usunięciem tła"
                className="max-h-[45vh] w-full rounded-lg border border-slate-200 bg-white object-contain" />
            </figure>
            <figure className="flex flex-col gap-1">
              <figcaption><NaglowekSekcji>Po — tak trafi do Subiekta</NaglowekSekcji></figcaption>
              {poAdres
                ? <img src={poAdres} alt="Gotowe zdjęcie towaru"
                    className="max-h-[45vh] w-full rounded-lg border border-slate-200 bg-white object-contain" />
                : <div aria-hidden="true" className="aspect-square w-full animate-pulse rounded-lg border border-slate-200 bg-slate-50 motion-reduce:animate-none" />}
            </figure>
          </div>
          {podglad.dane.tlo === "zostawione" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Tło zostało. {podglad.dane.powod ?? "Usługa nie wycięła towaru z tego zdjęcia."}</p>}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Przelacznik zaznaczony={zTla} onZmiana={setUsunTlo} wylaczony={podglad.dane.tlo !== "usuniete"}
              tytul={podglad.dane.tlo !== "usuniete" ? "Tła nie udało się usunąć, więc nie ma czego włączyć." : undefined}>
              Usuń tło <Klawisz>T</Klawisz></Przelacznik>
            <Przelacznik zaznaczony={bialeKwadrat} onZmiana={onBialeKwadrat}
              tytul="Biel pod towarem, przycięcie do towaru i kwadrat z marginesem.">
              Białe tło i kwadrat <Klawisz>B</Klawisz></Przelacznik>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            <Przycisk wariant="glowny" onClick={zatwierdz} disabled={!mozeZatwierdzic}>
              <Check size={16} />{zapisz.isPending ? "Zapisuję…" : "Zatwierdź"} <Klawisz>Enter</Klawisz></Przycisk>
            <Przycisk onClick={jeszczeRaz} disabled={zapisz.isPending}>
              <Undo2 size={16} />Jeszcze raz <Klawisz>Esc</Klawisz></Przycisk>
          </div>
        </>}

        <Blad>{blad}</Blad>
      </div>
    </div>
  </div>;
}
