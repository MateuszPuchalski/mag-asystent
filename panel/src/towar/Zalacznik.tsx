import React, { useState } from "react";
import { Paperclip, Play } from "lucide-react";
import { Powiekszenie } from "./Powiekszenie";

/* ── Wspólny załącznik rozmowy (skrzynka i reklamacje) ───────────────────────
   Do tego wydania to samo było narysowane DWA RAZY: `skrzynka/Os.tsx` rysował
   zdjęcie w linii z nazwą pod spodem, zdaniem odmowy i „Spróbuj ponownie";
   `reklamacje/Czat.tsx` — kafel 128 px z lupą, ale porażka podglądu milczała
   (spadała na przycisk pobrania), a błąd pobrania był połykany. Właściciel
   patrzył więc na dwie różne odpowiedzi na to samo pytanie „co klient
   przysłał", a każda poprawka w jednym miejscu omijała drugie.

   TU JEST WYGLĄD, NIE DANE. Powłoka nie woła haka obrazu — bo hak zależy od
   źródła (inna trasa dla wiadomości, inna dla reklamacji), a haka nie wolno
   wołać warunkowo. Opakowanie per źródło woła SWÓJ hak i podaje wynik
   propsem; to ten sam podział, co `Kafel` × `Plytka` przy kartotekach.

   Wygląd POŁĄCZONY (decyzja właściciela): zdjęcie w linii jak w skrzynce,
   bo agent ma widzieć usterkę bez klikania; kliknięcie powiększa jak
   w reklamacjach, bo pęknięcie na zdjęciu z telefonu bywa niewidoczne
   w 256 px; nazwa pliku pod zdjęciem jest pobraniem — plik na dysku to inne
   pytanie niż podgląd. Stan lokalny (powiększenie, błąd pobrania) to nie hak
   danych — powłoka dalej nie wie, skąd obraz przyszedł.                      */

/** Wynik haka obrazu: `undefined` = w drodze, `null` = nie ma (z powodem albo bez). */
export type ObrazZalacznika = {
  url: string | null | undefined;
  blad: string | null;
  ponow: () => void;
};

/** Pojemnik listy. Zawijanie, nie kolumna: kilka zdjęć z telefonu w jednej
    wiadomości nie ma rozciągać osi na trzy ekrany. */
export function ListaZalacznikow({ children, className }: {
  children: React.ReactNode; className?: string;
}) {
  return <ul className={`mt-2 flex flex-wrap items-start gap-3 text-xs ${className ?? ""}`}>
    {children}
  </ul>;
}

/**
 * Jeden załącznik: obraz (albo ramka, albo nic) nad nazwą; nazwa ZAWSZE.
 *
 * `podglad` decyduje o UKŁADZIE — czy w ogóle prosimy o obraz. Nazwa pliku
 * bywa kłamstwem (`usterka.jpg` bez sygnatury obrazu), więc `null` bez zdania
 * to odpowiedź „to nie obraz" (404/415): zostaje sama nazwa z pobraniem.
 * `null` ZE zdaniem to awaria drogi (502/503) — zdanie z serwera i ponowienie.
 */
export function KartaZalacznika({ nazwa, podglad, obraz, pobierz, powodBrakuPobrania }: {
  nazwa: string;
  podglad: boolean;
  obraz: ObrazZalacznika;
  /** `null` = nie do pobrania (Allegro uznało plik za niebezpieczny, wygasł). */
  pobierz: (() => Promise<void>) | null;
  powodBrakuPobrania?: string | null;
}) {
  const [powiekszone, setPowiekszone] = useState(false);
  const [bladPobrania, setBladPobrania] = useState<string | null>(null);
  const { url, blad, ponow } = obraz;

  return <li className="max-w-full">
    {/* Stałe miejsce PRZED pobraniem: bez ramki oś skakała przy doładowaniu,
        a przy porażce nie zostawało nic — agent widział samą nazwę pliku
        i nie miał jak zgadnąć, że zdjęcie w ogóle było spodziewane. */}
    {podglad && url === undefined &&
      <span className="mb-1 flex h-32 w-48 max-w-full items-center justify-center rounded border border-dashed
        border-slate-300 text-xs text-slate-500">wczytuję…</span>}
    {/* Wysokość ograniczona, nie szerokość: zdjęcie z telefonu bywa pionowe
        i rozpychałoby oś na cały ekran. Przycisk, bo obraz jest też wejściem
        do powiększenia — a `Powiekszenie` montuje się WYŁĄCZNIE z adresem,
        żeby nigdy nie powiedziało „Ta kartoteka nie ma zdjęcia". */}
    {url && <button type="button" onClick={() => setPowiekszone(true)}
      title={`${nazwa} — kliknij, żeby powiększyć`} aria-label={`Powiększ: ${nazwa}`}
      className="mb-1 block rounded focus:outline-none focus:ring-2 focus:ring-slate-400">
      <img src={url} alt={nazwa} loading="lazy"
        className="max-h-64 w-auto max-w-full rounded border border-slate-200 bg-white p-1" />
    </button>}
    {powiekszone && url && <Powiekszenie url={url} nazwa={nazwa} symbol={null}
      zamknij={() => setPowiekszone(false)} />}
    {/* `min-w-0` i `break-all`: w wąskiej kolumnie zdjęć nazwa z aparatu
        („IMG_20260912_101010.jpg") nie ma spacji i wyszłaby za krawędź. */}
    <span className="flex min-w-0 items-center gap-1.5">
      <Paperclip size={12} className="shrink-0 text-slate-400" />
      {pobierz
        /* PRZYCISK, nie odnośnik: `<a href>` nie niesie nagłówka `x-session`
           i pobranie było przez to zepsute od 0.155.0 do 0.219.1. */
        ? <button type="button" className="min-w-0 break-all text-left font-bold text-slate-700 underline hover:text-slate-900"
            onClick={() => {
              setBladPobrania(null);
              pobierz().catch((e: unknown) =>
                setBladPobrania(e instanceof Error ? e.message : "Nie udało się pobrać"));
            }}>{nazwa}</button>
        /* Plik nie do pobrania ZOSTAJE WIDOCZNY: ukrycie kłamałoby, że klient
           nic nie przysłał. */
        : <span className="text-slate-500">
            <span className="font-bold">{nazwa}</span>
            {powodBrakuPobrania ? <>{" — "}{powodBrakuPobrania}</> : null}
          </span>}
    </span>
    {/* Nieudany PODGLĄD mówi o sobie zdaniem z serwera (502 „Allegro nie
        oddało…", 503 „Konto niepołączone…") i daje ponowienie. */}
    {podglad && url === null && blad &&
      <p className="mt-0.5 text-ranga-zle">{blad}{" "}
        <button type="button" className="font-bold underline" onClick={ponow}>Spróbuj ponownie</button>
      </p>}
    {/* Nieudane POBRANIE też mówi — w reklamacjach do tego wydania było
        połykane (`void`), więc kliknięcie bez pliku nie zostawiało nic. */}
    {bladPobrania && <p className="mt-0.5 text-ranga-zle">{bladPobrania}</p>}
  </li>;
}

/* ── Kafel w dymku rozmowy ───────────────────────────────────────────────────
   Makieta właściciela stawia zdjęcia W DYMKU wiadomości, kaflami 112×84.
   Pełne zdjęcie do 256 px wypychało następną wiadomość poza ekran, a osobna
   kolumna rozrywała wiadomość od jej zdjęcia. Kafel mówi „co klient przysłał”,
   a szczegół daje powiększenie jednym kliknięciem.

   DWA CELE W JEDNYM KAFLU: obraz powiększa, pasek z nazwą pobiera. Pobranie
   zostaje, bo plik na dysku to inne pytanie niż podgląd. Pasek ma 24 px,
   czyli próg celu WCAG 2.2 (2.5.8).

   Film nie ma podglądu w przeglądarce bez pobrania, więc stoi ciemnym kaflem
   z nazwą. Rozpoznajemy go po rozszerzeniu, bo Allegro nie podaje typu. */
const FILM = /\.(mp4|mov|m4v|avi|webm|3gp|mkv)$/i;

export function KafelZalacznika({ nazwa, podglad, obraz, pobierz }: {
  nazwa: string;
  podglad: boolean;
  obraz: ObrazZalacznika;
  pobierz: () => Promise<void>;
}) {
  const [powiekszone, setPowiekszone] = useState(false);
  const [bladPobrania, setBladPobrania] = useState<string | null>(null);
  const { url, blad, ponow } = obraz;
  const film = FILM.test(nazwa);
  const pobieraj = () => {
    setBladPobrania(null);
    pobierz().catch((e: unknown) =>
      setBladPobrania(e instanceof Error ? e.message : "Nie udało się pobrać"));
  };
  /* PRZYCISK, nie odnośnik: `<a href>` nie niesie nagłówka `x-session`. */
  const pasekNazwy = <button type="button" onClick={pobieraj} title={`${nazwa} — kliknij, żeby pobrać`}
    className={`absolute inset-x-0 bottom-0 flex min-h-6 items-center gap-1 px-2 text-left text-xs underline-offset-2 hover:underline ${
      film ? "text-white" : "bg-white/90 text-slate-700"}`}>
    {film ? <Play size={12} className="shrink-0" /> : <Paperclip size={12} className="shrink-0 text-slate-500" />}
    <span className="truncate">{nazwa}</span>
  </button>;

  return <li className="flex max-w-56 flex-col gap-1">
    <div className={`relative h-[84px] w-28 overflow-hidden rounded-lg ${
      film ? "bg-slate-700" : "border border-slate-200 bg-white"}`}>
      {url && !film && <button type="button" onClick={() => setPowiekszone(true)}
        aria-label={`Powiększ: ${nazwa}`} title={`${nazwa} — kliknij, żeby powiększyć`}
        className="block h-full w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400">
        <img src={url} alt={nazwa} loading="lazy" className="h-full w-full object-cover" />
      </button>}
      {/* Stałe miejsce PRZED pobraniem, żeby oś nie skakała przy doładowaniu. */}
      {podglad && !film && url === undefined &&
        <span className="flex h-full items-start justify-center pt-5 text-xs text-slate-600">wczytuję…</span>}
      {pasekNazwy}
    </div>
    {powiekszone && url && <Powiekszenie url={url} nazwa={nazwa} symbol={null}
      zamknij={() => setPowiekszone(false)} />}
    {/* Nieudany PODGLĄD mówi zdaniem z serwera i daje ponowienie. */}
    {podglad && url === null && blad &&
      <p className="text-xs text-ranga-zle">{blad}{" "}
        <button type="button" className="font-bold underline" onClick={ponow}>Spróbuj ponownie</button>
      </p>}
    {bladPobrania && <p className="text-xs text-ranga-zle">{bladPobrania}</p>}
  </li>;
}
