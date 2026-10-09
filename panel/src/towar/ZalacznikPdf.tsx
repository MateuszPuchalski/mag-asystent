import React, { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { OdmowaPodgladu } from "../api/klient";
import { useBajtyPdf } from "../api/podgladPdf";
import { useOkno } from "../nawigacja/fokus";
import { Przycisk } from "../ui";
import { otworzPdf, proporcja, przerwane, rysujStrone } from "./rysujPdf";

/* ── PDF przysłany przez klienta: miniatura w czacie i cały dokument ────────
   Klient reklamujący kosiarkę przysyła fakturę, protokół z serwisu albo skan
   paragonu. Do tej pory agent widział samą nazwę „dokument.pdf” i musiał
   ściągnąć plik na dysk, żeby wiedzieć, o czym mowa. Miniatura pierwszej
   strony mówi „to faktura z pieczątką” bez klikania, a klik otwiera całość
   w panelu, bez wychodzenia z rozmowy.

   WYGLĄD ZOSTAJE U KAFLA. Ten moduł nie wie, czy stoi w dymku reklamacji,
   czy w karcie skrzynki, więc oddaje kawałki: miniaturę, okno i zdanie
   o porażce. Kafel układa je po swojemu. To ten sam podział co przy obrazach,
   gdzie wygląd ma `Zalacznik.tsx`, a dane przychodzą z zewnątrz.

   PORAŻKA NIE ZOSTAWIA PUSTEGO PROSTOKĄTA. 404 i 415 to odpowiedź „to nie
   PDF” (nazwa skłamała), więc zostaje dzisiejszy kafel z nazwą i pobraniem.
   413 i plik, którego pdf.js nie otworzy, mówią zdaniem bez ponowienia, bo
   druga próba da to samo. Awaria drogi mówi zdaniem z ponowieniem. */

export type WidokPdf = {
  /** Przycisk z miniaturą; `null`, gdy bajtów nie ma albo dokument się nie otworzył. */
  miniatura: React.ReactNode;
  /** Bajty w drodze albo strona jeszcze się rysuje — kafel trzyma miejsce. */
  wDrodze: boolean;
  /** Zdanie o porażce; `ponow` tylko tam, gdzie druga próba ma sens. */
  blad: { zdanie: string; ponow: (() => void) | null } | null;
  /** Okno całego dokumentu, gdy otwarte. Stoi WEWNĄTRZ `<li>` kafla. */
  okno: React.ReactNode;
};

/** Zdanie dla agenta z porażki pdf.js — bez angielskich nazw wyjątków. */
function zdanieOtwarcia(e: unknown): string {
  if (e instanceof Error && e.name === "PasswordException")
    return "PDF jest zabezpieczony hasłem — pobierz go na dysk.";
  return "Nie umiem otworzyć tego PDF-a — pobierz go na dysk.";
}

/**
 * Pobiera bajty PDF-a i oddaje kafelkowi kawałki widoku.
 *
 * Komponent, nie hak: zapytanie wolno zamontować WYŁĄCZNIE przy PDF-ie,
 * a haka nie wolno wołać warunkowo. Zdjęcia i filmy nie pytają tej trasy.
 */
export function PodgladPdf({ sciezka, nazwa, pobierz, szerokosc, children }: {
  sciezka: string;
  nazwa: string;
  pobierz: (() => Promise<void>) | null;
  /** Szerokość miniatury w pikselach ekranu — tyle, ile ma kafel. */
  szerokosc: number;
  children: (w: WidokPdf) => React.ReactNode;
}) {
  const bajty = useBajtyPdf(sciezka);
  const [narysowana, setNarysowana] = useState(false);
  const [bladOtwarcia, setBladOtwarcia] = useState<string | null>(null);
  const [otwarte, setOtwarte] = useState(false);

  const odmowa = bajty.error instanceof OdmowaPodgladu ? bajty.error : null;
  let blad: WidokPdf["blad"] = null;
  if (bladOtwarcia) blad = { zdanie: bladOtwarcia, ponow: null };
  else if (odmowa?.status === 413) blad = { zdanie: odmowa.message, ponow: null };
  else if (bajty.error && !odmowa) blad = { zdanie: bajty.error.message, ponow: () => void bajty.refetch() };

  const dane = bajty.data && !bladOtwarcia ? bajty.data : null;

  return <>{children({
    miniatura: dane && <button type="button" onClick={() => setOtwarte(true)}
      aria-label={`Otwórz PDF: ${nazwa}`} title={`${nazwa} — kliknij, żeby otworzyć cały dokument`}
      /* Ukryta, nie odmontowana, dopóki strona się rysuje: płótno musi już
         stać w dokumencie, żeby pdf.js miał na czym rysować. Atrybut obok
         klasy, bo drzewo dostępności czyta atrybut, a klasę zna tylko arkusz. */
      hidden={!narysowana}
      className={`relative h-full w-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400 ${
        narysowana ? "block" : "hidden"}`}>
      <MiniaturaPdf bajty={dane} szerokosc={szerokosc}
        onGotowa={() => setNarysowana(true)} onBlad={setBladOtwarcia} />
      {/* Znaczek, bo pierwsza strona faktury wygląda jak zdjęcie kartki.
          Agent ma wiedzieć przed kliknięciem, że otworzy się dokument. */}
      <span className="absolute left-1 top-1 rounded bg-slate-800 px-1 text-xs font-bold text-white">PDF</span>
    </button>,
    wDrodze: !blad && !odmowa && !narysowana,
    blad,
    okno: otwarte && dane && <OknoPdf bajty={dane} nazwa={nazwa} pobierz={pobierz}
      zamknij={() => setOtwarte(false)} />,
  })}</>;
}

/** Pierwsza strona na płótnie o szerokości kafla; wysokość przycina kafel. */
function MiniaturaPdf({ bajty, szerokosc, onGotowa, onBlad }: {
  bajty: Uint8Array; szerokosc: number;
  onGotowa: () => void; onBlad: (zdanie: string) => void;
}) {
  const plotno = useRef<HTMLCanvasElement>(null);
  /* Wywołania zwrotne przez ref: rodzic podaje nowe funkcje przy każdym
     rysowaniu, a ponowne otwarcie dokumentu z tego powodu byłoby marnotrawstwem. */
  const zwrotne = useRef({ onGotowa, onBlad });
  zwrotne.current = { onGotowa, onBlad };

  useEffect(() => {
    const otwierany = otworzPdf(bajty);
    let rysowanie: RenderTask | null = null;
    let zywy = true;
    otwierany.dokument
      .then((d) => d.getPage(1))
      .then((strona) => {
        if (!zywy || !plotno.current) return;
        rysowanie = rysujStrone(strona, plotno.current, szerokosc);
        return rysowanie.promise;
      })
      .then(() => { if (zywy) zwrotne.current.onGotowa(); },
        (e: unknown) => { if (zywy && !przerwane(e)) zwrotne.current.onBlad(zdanieOtwarcia(e)); });
    return () => {
      zywy = false;
      rysowanie?.cancel();
      otwierany.zniszcz();
    };
  }, [bajty, szerokosc]);

  return <canvas ref={plotno} aria-hidden="true" className="block w-full bg-white" />;
}

/* ── Okno całego dokumentu ───────────────────────────────────────────────────
   Strony pod sobą, jak w każdej przeglądarce PDF-ów, bo agent czyta fakturę
   od góry do dołu, a nie kartkuje. Licznik „Strona N z M” mówi, gdzie jest,
   gdy dokument ma kilka stron.

   Strony rysują się PO KOLEI i dopiero przy zbliżeniu do kadru. Protokół
   serwisu bywa trzydziestostronicowy, a każde płótno to kilka megabajtów
   pamięci karty. Pierwsza strona rysuje się od razu, bo na nią agent patrzy.

   Pobranie zostaje w oknie, bo „chcę to mieć u siebie” pada zwykle po
   przeczytaniu. To ta sama funkcja co pasek nazwy, z audytem po stronie
   serwera. */
function OknoPdf({ bajty, nazwa, pobierz, zamknij }: {
  bajty: Uint8Array; nazwa: string;
  pobierz: (() => Promise<void>) | null;
  zamknij: () => void;
}) {
  const okno = useOkno<HTMLDivElement>({ onZamknij: zamknij });
  const przewijak = useRef<HTMLDivElement>(null);
  const [dokument, setDokument] = useState<PDFDocumentProxy | null>(null);
  const [ksztalt, setKsztalt] = useState<{ szerokosc: number; proporcja: number } | null>(null);
  const [bladOtwarcia, setBladOtwarcia] = useState<string | null>(null);
  const [bladPobrania, setBladPobrania] = useState<string | null>(null);
  const [biezaca, setBiezaca] = useState(1);
  /* Jedna kolejka rysowania na okno: strony nie rysują się równolegle. */
  const kolejka = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const otwierany = otworzPdf(bajty);
    let zywy = true;
    otwierany.dokument.then(async (d) => {
      const pierwsza = await d.getPage(1);
      if (!zywy) return;
      /* Szerokość z kolumny okna; jsdom i ukryte okno dają zero, więc zapas. */
      const kolumna = (przewijak.current?.clientWidth ?? 0) - 32;
      setKsztalt({ szerokosc: Math.min(800, kolumna > 0 ? kolumna : 720), proporcja: proporcja(pierwsza) });
      setDokument(d);
    }).catch((e: unknown) => { if (zywy && !przerwane(e)) setBladOtwarcia(zdanieOtwarcia(e)); });
    return () => { zywy = false; otwierany.zniszcz(); };
  }, [bajty]);

  /* Bieżąca strona: ostatnia, której góra minęła trzecią część kadru. */
  const przewin = () => {
    const el = przewijak.current;
    if (!el) return;
    const prog = el.scrollTop + el.clientHeight / 3;
    let n = 1;
    el.querySelectorAll<HTMLElement>("[data-strona]").forEach((s) => {
      if (s.offsetTop <= prog) n = Number(s.dataset.strona);
    });
    setBiezaca(n);
  };

  const ile = dokument?.numPages ?? 0;

  return <div role="dialog" {...okno} aria-label={`Dokument: ${nazwa}`}
    className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onClick={zamknij}>
    <div className="flex h-full max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white"
      onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold">{nazwa}</h2>
          {ile > 0 && <p className="text-sm text-slate-600">Strona {biezaca} z {ile}</p>}
        </div>
        {pobierz && <Przycisk onClick={() => {
          setBladPobrania(null);
          pobierz().catch((e: unknown) =>
            setBladPobrania(e instanceof Error ? e.message : "Nie udało się pobrać"));
        }}><Download size={16} />Pobierz</Przycisk>}
        <button type="button" onClick={zamknij} aria-label="Zamknij"
          className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        {bladPobrania && <p className="w-full text-sm text-ranga-zle">{bladPobrania}</p>}
      </div>
      <div ref={przewijak} onScroll={przewin} className="relative min-h-0 flex-1 overflow-auto bg-slate-200 p-4">
        {bladOtwarcia && <p className="p-10 text-center text-sm text-ranga-zle">{bladOtwarcia}</p>}
        {!bladOtwarcia && !dokument && <p className="p-10 text-center text-sm text-slate-700">Wczytuję…</p>}
        {dokument && ksztalt && Array.from({ length: ile }, (_, i) =>
          <StronaPdf key={i + 1} dokument={dokument} numer={i + 1} ile={ile} ksztalt={ksztalt}
            przewijak={przewijak} kolejka={kolejka} />)}
      </div>
    </div>
  </div>;
}

function StronaPdf({ dokument, numer, ile, ksztalt, przewijak, kolejka }: {
  dokument: PDFDocumentProxy; numer: number; ile: number;
  ksztalt: { szerokosc: number; proporcja: number };
  przewijak: React.RefObject<HTMLDivElement | null>;
  kolejka: React.RefObject<Promise<void>>;
}) {
  const ramka = useRef<HTMLDivElement>(null);
  const plotno = useRef<HTMLCanvasElement>(null);
  const [potrzebna, setPotrzebna] = useState(numer === 1);
  const [stan, setStan] = useState<"czeka" | "gotowa" | "blad">("czeka");

  /* Obserwator mówi „strona zbliża się do kadru” z zapasem jednego ekranu,
     żeby następna była narysowana, zanim agent do niej dojedzie. */
  useEffect(() => {
    if (potrzebna || !ramka.current) return;
    if (typeof IntersectionObserver === "undefined") { setPotrzebna(true); return; }
    const obs = new IntersectionObserver((wpisy) => {
      if (wpisy.some((w) => w.isIntersecting)) setPotrzebna(true);
    }, { root: przewijak.current, rootMargin: "100% 0px" });
    obs.observe(ramka.current);
    return () => obs.disconnect();
  }, [potrzebna, przewijak]);

  useEffect(() => {
    if (!potrzebna) return;
    let zywy = true;
    let rysowanie: RenderTask | null = null;
    kolejka.current = kolejka.current.then(async () => {
      if (!zywy || !plotno.current) return;
      try {
        const strona = await dokument.getPage(numer);
        if (!zywy || !plotno.current) return;
        rysowanie = rysujStrone(strona, plotno.current, ksztalt.szerokosc);
        await rysowanie.promise;
        if (zywy) setStan("gotowa");
      } catch (e) {
        if (zywy && !przerwane(e)) setStan("blad");
      }
    });
    return () => { zywy = false; rysowanie?.cancel(); };
  }, [potrzebna, dokument, numer, ksztalt.szerokosc, kolejka]);

  /* Ramka ma wymiar strony, zanim strona się narysuje: bez tego pasek
     przewijania skakałby przy każdej doładowanej stronie, a licznik
     pokazywałby nie tę stronę. Proporcja z pierwszej strony. */
  return <div ref={ramka} data-strona={numer}
    className="relative mx-auto mb-4 bg-white shadow last:mb-0"
    style={{ width: ksztalt.szerokosc, maxWidth: "100%",
      ...(stan === "gotowa" ? {} : { aspectRatio: `1 / ${ksztalt.proporcja}` }) }}>
    <canvas ref={plotno} role="img" aria-label={`Strona ${numer} z ${ile}`} hidden={stan !== "gotowa"}
      className={`w-full ${stan === "gotowa" ? "block" : "hidden"}`} />
    {stan === "blad" && <p className="p-6 text-center text-sm text-ranga-zle">
      Nie udało się narysować strony {numer}.</p>}
  </div>;
}
