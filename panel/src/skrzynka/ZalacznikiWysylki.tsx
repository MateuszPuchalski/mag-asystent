import React, { useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, X } from "lucide-react";
import type { ZalacznikSzkicu } from "../api/rozmowy";

/* ── Załączniki DO WYSYŁKI (0.195.0) ─────────────────────────────────────────
   Nazwa rozróżnia strony: `Os.tsx` rysuje załączniki PRZYCHODZĄCE (od 0.155.0,
   testowane w `Zalaczniki.test.tsx`), a ten plik — te, które dopiero pójdą.

   Odczyt załączników klienta stoi od 0.155.0; wysyłka nie istniała wcale.
   Przy pytaniach o części zdjęcie bywa CAŁĄ odpowiedzią — „ten gwint, nie
   tamten" pokazuje się szybciej, niż opisuje — a agent musiał po to iść do
   panelu Allegro, czyli tam, skąd panel miał go zabrać (§25).

   PLIK LECI DO ALLEGRO JUŻ PRZY DODANIU, nie przy WYŚLIJ. Dlatego lista tutaj
   pokazuje rzeczy, które NAPRAWDĘ tam są — a odmowa typu albo rozmiaru pada,
   gdy jeszcze da się wybrać inny plik.

   Załączniki wiszą przy ROZMOWIE, nie przy przeglądarce: szkic jest
   współdzielony z zespołem (§6.4), więc kolega widzi i tekst, i pliki, a
   odświeżenie karty niczego nie gubi.                                       */

/** Typy, które Allegro przyjmuje przy wiadomości — lustro `TYPY_ZALACZNIKA`. */
const PRZYJMOWANE = "image/png,image/gif,image/bmp,image/tiff,image/jpeg,application/pdf";

/** Rozmiar po ludzku. Bajty przy pliku 2,4 MB nie mówią nic. */
export function poLudzku(bajtow: number): string {
  if (bajtow < 1024) return `${bajtow} B`;
  if (bajtow < 1024 * 1024) return `${Math.round(bajtow / 1024)} kB`;
  return `${(bajtow / 1024 / 1024).toFixed(1)} MB`;
}

export function ZalacznikiWysylki({ lista, dodaje, blad, onDodaj, onUsun, wylaczone }: {
  lista: ZalacznikSzkicu[];
  dodaje: boolean;
  blad: string;
  /** Dostaje plik; kodowanie i wysyłkę robi wołający, bo tam mieszka klient HTTP. */
  onDodaj: (plik: File) => void;
  onUsun: (id: number) => void;
  /** Cudza rozmowa — szkicu ani załączników nie ruszamy. */
  wylaczone: boolean;
}) {
  const wejscie = useRef<HTMLInputElement>(null);
  const [nazwaWToku, setNazwaWToku] = useState("");

  return <div className="mt-2">
    <input ref={wejscie} type="file" accept={PRZYJMOWANE} className="hidden"
      aria-label="Wybierz plik do odpowiedzi"
      onChange={(e) => {
        const plik = e.target.files?.[0];
        if (plik) { setNazwaWToku(plik.name); onDodaj(plik); }
        /* Czyścimy pole, bo bez tego ten sam plik wybrany drugi raz nie
           wywołuje `change` — a drugi raz wybiera się go właśnie wtedy, gdy
           za pierwszym coś poszło nie tak. */
        e.target.value = "";
      }} />

    {/* ── NIE KAŻDE DZIAŁANIE ZASŁUGUJE NA PRZYCISK (0.247.0) ─────────────────
        Pełny przycisk z obwódką i zdanie o dozwolonych formatach zajmowały
        własny rząd pod wysyłką — dwa elementy w tej samej wadze co „Wyślij do
        klienta", dla czynności, która zdarza się przy co którejś odpowiedzi.

        Zostaje spinacz. Nazwa nie ginie: niesie ją `aria-label`, a ograniczenie
        formatu — podpowiedź, czyli tam, gdzie szuka się go w chwili wątpliwości,
        a nie przy każdym otwarciu rozmowy. Wgrywanie ODZYSKUJE słowa, bo wtedy
        sama ikona nie powiedziałaby, że coś trwa. */}
    <div className="flex flex-wrap items-center gap-2">
      {dodaje
        ? <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Paperclip size={13} />Wgrywam {nazwaWToku}…</span>
        : <button type="button" disabled={wylaczone}
            aria-label="Dołącz plik" title="Dołącz plik — zdjęcie albo PDF, najwyżej 4 MB"
            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 disabled:opacity-40"
            onClick={() => wejscie.current?.click()}>
            <Paperclip size={16} />
          </button>}
    </div>

    {lista.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">
      {lista.map((z) => <li key={z.id}
        className="flex items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-xs">
        {z.typ === "application/pdf"
          ? <FileText size={13} className="shrink-0 text-slate-400" />
          : <ImageIcon size={13} className="shrink-0 text-slate-400" />}
        <span className="max-w-52 truncate font-semibold">{z.nazwa}</span>
        <span className="tabular-nums text-slate-400">{poLudzku(z.rozmiar)}</span>
        {/* Kto dołożył — bo szkic jest wspólny, a plik kolegi wygląda inaczej
            niż własny dopiero wtedy, gdy przy nim stoi imię. */}
        {z.dodal && <span className="text-slate-400">· {z.dodal}</span>}
        <button type="button" disabled={wylaczone}
          onClick={() => onUsun(z.id)} aria-label={`Zdejmij ${z.nazwa}`}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
          <X size={13} /></button>
      </li>)}
    </ul>}

    {blad && <p className="mt-1 text-xs font-semibold text-ranga-zle">{blad}</p>}
  </div>;
}
