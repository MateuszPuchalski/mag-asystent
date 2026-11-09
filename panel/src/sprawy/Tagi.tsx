import React from "react";
import { Tag as IkonaTagu } from "lucide-react";
import type { TagSprawy } from "../api/typy";
import { FiltrSegmentowy } from "../ui";

/* ── Tagi spraw posprzedażowych ──────────────────────────────────────────────
   Tag służy temu, żeby łatwiej znaleźć reklamacje, którymi ktoś się zajmuje.
   Tag jest SITEM, nie ozdobą.

   ── BARWA: ANI FIOLET, ANI BURSZTYN, i obie odmowy mają powód ─────────────
   Fiolet znaczy w tym panelu PRZYPUSZCZENIE MASZYNY — tak chodzą kategorie
   Copilota i tylko one. Tag jest zdaniem człowieka o sprawie, więc fiolet
   kłamałby o jego pochodzeniu. Bursztyn jest tłem marki i zaznaczeniem
   wiersza, a `text-wertis-amber` na bieli nie jest pismem.

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
