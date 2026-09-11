import React, { useState } from "react";
import { Tag as IkonaTagu, X } from "lucide-react";
import type { Tag, TagSprawy } from "../api/typy";
import { FiltrSegmentowy } from "../ui";

/* ── Tagi spraw posprzedażowych (0.279.0) ────────────────────────────────────
   Właściciel poprosił o tagi w jednym celu: „abym łatwiej mógł znaleźć
   reklamacje, którymi się zajmuję". Tag jest SITEM, nie ozdobą.

   ── BARWA: ANI FIOLET, ANI BURSZTYN, i obie odmowy mają powód ─────────────
   Fiolet znaczy w tym panelu PRZYPUSZCZENIE MASZYNY — tak chodzą kategorie
   Copilota i tylko one. Tag jest zdaniem człowieka o sprawie, więc fiolet
   kłamałby o jego pochodzeniu. Bursztyn jest tłem marki i zaznaczeniem
   wiersza, a `text-wertis-amber` ma 2,02:1 i nie jest pismem.

   Zostaje rodzina łupkowa — ta sama, którą noszą czipy faktów w wierszu
   („zwrot pieniędzy", „bez terminu"). I dobrze: tag JEST faktem o sprawie,
   tyle że zapisanym przez biuro, a nie przez Allegro.

   ── CZEGO TAG NIE ROBI ────────────────────────────────────────────────────
   Nie przestawia kolejki. §14.5 rozstrzygnął to przy kategoriach Copilota
   i powód jest ten sam: kolejność liczy termin i czas czekania, czyli fakty
   o pilności. Tag zawęża listę i nic poza tym.                              */

/** Czip na wierszu kolejki. Bez krzyżyka — zdejmuje się w kolumnie faktów. */
export function CzipTagu({ nazwa }: { nazwa: string }) {
  return <span title={`Tag biura: ${nazwa}`}
    className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-700">
    <IkonaTagu size={13} />{nazwa}</span>;
}

/**
 * Pasek filtra nad kolejką.
 *
 * POKAZUJE TYLKO TAGI OBECNE W OGLĄDANYM KUBEŁKU, malejąco po liczbie — ten
 * sam wzorzec co pasek kategorii w skrzynce. Pigułka tagu, którego w kubełku
 * nie ma, obiecywałaby zawężenie do pustki.
 */
export function FiltrTagow({ wgLiczby, wybrany, onWybierz }: {
  wgLiczby: Array<[TagSprawy, number]>;
  wybrany: number | null;
  onWybierz: (id: number | null) => void;
}) {
  if (!wgLiczby.length) return null;
  return <FiltrSegmentowy<number | null>
    wybrany={wybrany}
    /* Kliknięcie w wybrany tag go ZDEJMUJE — to zawężenie listy, a nie
       kubełek. Ta sama klauzula co przy kategoriach w skrzynce. */
    onWybierz={(k) => onWybierz(wybrany === k ? null : k)}
    pozycje={wgLiczby.map(([t, ile]) => ({
      klucz: t.id, etykieta: t.nazwa, ile,
      podpowiedz: `Sprawy z tagiem „${t.nazwa}”`,
    }))} />;
}

/** Ile spraw w kubełku ma dany tag — malejąco, przy remisie alfabetycznie. */
export function tagiWgLiczby(sprawy: Array<{ tagi: TagSprawy[] }>): Array<[TagSprawy, number]> {
  const licznik = new Map<number, [TagSprawy, number]>();
  for (const s of sprawy) {
    for (const t of s.tagi) {
      const wpis = licznik.get(t.id);
      if (wpis) wpis[1] += 1;
      else licznik.set(t.id, [t, 1]);
    }
  }
  return [...licznik.values()].sort((a, b) => b[1] - a[1] || a[0].nazwa.localeCompare(b[0].nazwa));
}

/**
 * Tagi PRZY OTWARTEJ SPRAWIE: co jest przypięte, co można dopiąć, co dopisać.
 *
 * ZDJĘCIE JEDNYM KLIKNIĘCIEM I TO JEST CAŁE COFNIĘCIE. Przypięcie i zdjęcie
 * kosztują po jednym ruchu, więc osobne „cofnij" nie miałoby czego cofać —
 * §25a.5 mówi o cofnięciu zamiast potwierdzenia, a nie obok istniejącej
 * drogi powrotnej.
 *
 * Tag WYŁĄCZONY ze słownika zostaje widoczny na sprawie, ale nie ma go wśród
 * podpowiedzi. Inaczej „wyłączony" nie znaczyłoby nic, a historia sprawy
 * traciłaby zdanie o tym, dlaczego stała trzy tygodnie.
 */
export function TagiSprawy({ przypiete, slownik, trwa, blad, onPrzypnij, onOdepnij, onNowy }: {
  przypiete: TagSprawy[];
  slownik: Tag[];
  trwa: boolean;
  blad: string;
  onPrzypnij: (tagId: number) => void;
  onOdepnij: (tagId: number) => void;
  onNowy: (nazwa: string) => void;
}) {
  const [nowy, setNowy] = useState("");
  const [pisze, setPisze] = useState(false);
  const maja = new Set(przypiete.map((t) => t.id));
  const doWyboru = slownik.filter((t) => t.aktywny && !maja.has(t.id));

  const dopisz = () => {
    const n = nowy.trim();
    if (!n) return;
    onNowy(n);
    setNowy("");
    setPisze(false);
  };

  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-1.5">
      {przypiete.map((t) => <span key={t.id}
        className="inline-flex items-center gap-1 rounded bg-slate-100 py-1 pl-2 pr-1 text-xs font-bold text-slate-700">
        <IkonaTagu size={13} />{t.nazwa}
        <button type="button" disabled={trwa} onClick={() => onOdepnij(t.id)}
          aria-label={`Zdejmij tag ${t.nazwa}`}
          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50">
          <X size={12} /></button>
      </span>)}
      {!przypiete.length &&
        <span className="text-podpis text-slate-600">Bez tagów.</span>}
    </div>

    {/* Podpowiedzi to PIGUŁKI, nie lista rozwijana: tagów aktywnych jest
        najwyżej dwadzieścia, a rozwijana kazałaby otworzyć, przeczytać
        i wybrać tam, gdzie wystarczy jedno kliknięcie (Dekalog p. 5). */}
    {doWyboru.length > 0 && <div className="flex flex-wrap gap-1">
      {doWyboru.map((t) => <button key={t.id} type="button" disabled={trwa}
        onClick={() => onPrzypnij(t.id)}
        className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50">
        + {t.nazwa}</button>)}
    </div>}

    {pisze
      ? <div className="flex gap-1">
        <label className="sr-only" htmlFor="nowy-tag">Nazwa nowego tagu</label>
        <input id="nowy-tag" autoFocus value={nowy} maxLength={30}
          onChange={(e) => setNowy(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); dopisz(); }
            if (e.key === "Escape") { setNowy(""); setPisze(false); }
          }}
          placeholder="np. czeka na część"
          className="field w-full py-1 text-xs" />
        <button type="button" onClick={dopisz} disabled={trwa || !nowy.trim()}
          className="shrink-0 rounded bg-wertis-ink px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">
          Dodaj</button>
      </div>
      : <button type="button" onClick={() => setPisze(true)}
        className="self-start py-1 text-podpis font-semibold text-slate-700 underline">
        + nowy tag</button>}

    {blad && <p className="text-podpis text-red-700">{blad}</p>}
  </div>;
}
