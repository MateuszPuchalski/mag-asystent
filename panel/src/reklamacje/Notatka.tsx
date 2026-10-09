import React, { useEffect, useId, useState } from "react";
import type { Reklamacja } from "../api/typy";
import { czas } from "../ui";

/* ── Notatka wewnętrzna ──────────────────────────────────────────────────────
   Ustalenia biura, których klient nie widzi: numer sprawy u Allegro, co
   ustalono z magazynem, propozycja werdyktu dla kolegi. Stoi na końcu prawej
   kolumny, bo czyta się ją po faktach, a nie zamiast nich.

   CZYTANIE JEST DOMYŚLNE, PISANIE NA ŻĄDANIE. Pole otwarte zawsze kusiło
   do dopisywania przy każdej sprawie i wyglądało jak druga odpowiedź do
   klienta. „Edytuj” otwiera je jawnie, a „Anuluj” zostawia zapisaną treść.

   ZAPIS JAWNYM PRZYCISKIEM, nie przy każdym znaku. Zapis podnosi wersję
   sprawy, a wersja pilnuje świeżości odpowiedzi u kolegi przy drugim biurku.

   COFNIĘCIE ZAMIAST PYTANIA. Notatka jako jedyna zostaje wyłącznie u nas,
   więc pomyłkę cofa się jednym kliknięciem, bez okna z potwierdzeniem. */

export function Notatka({ reklamacja: r, trwa, blad, onZapisz, onCofnij }: {
  reklamacja: Reklamacja;
  trwa: boolean;
  /** Zdanie z serwera: konflikt wersji, odmowa, brak połączenia. */
  blad: string;
  /** `gotowe` zamyka pole dopiero po udanym zapisie — błąd zostawia tekst. */
  onZapisz: (tekst: string, gotowe: () => void) => void;
  /** Bez procedury cofnięcia nie ma na ekranie przycisku, który nic nie robi. */
  onCofnij?: () => void;
}) {
  const [edycja, setEdycja] = useState(false);
  const [tekst, setTekst] = useState(r.notatka ?? "");
  const idPola = useId();
  /* Zmiana sprawy zamyka pole i podmienia treść. Bez tego notatka jednej
     sprawy zostawałaby w polu i dała się zapisać na cudzej. */
  useEffect(() => { setEdycja(false); setTekst(r.notatka ?? ""); }, [r.id]);
  useEffect(() => { if (!edycja) setTekst(r.notatka ?? ""); }, [r.notatka, edycja]);

  return <section aria-labelledby={`${idPola}-tytul`}
    className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-wertis-paper px-5 py-4">
    <div className="flex items-center justify-between gap-3">
      <h2 id={`${idPola}-tytul`} className="text-naglowek font-bold text-slate-900">Notatka wewnętrzna</h2>
      {!edycja && <button type="button" onClick={() => setEdycja(true)}
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 hover:bg-slate-50">
        {r.notatka ? "Edytuj" : "Dodaj"}</button>}
    </div>
    {/* Autor i chwila stoją przy treści, bo pytanie „kto to napisał” zadaje
        się, patrząc na notatkę. Dopisek o kliencie odróżnia ją od odpowiedzi. */}
    <p className="text-xs text-slate-600">
      {r.notatkaPrzez ? `${r.notatkaPrzez} · ${czas(r.notatkaAt)} · ` : ""}klient jej nie widzi
      {onCofnij && r.maPoprzedniaNotatke && !edycja && <>
        {" · "}
        <button type="button" disabled={trwa} onClick={onCofnij}
          className="min-h-6 font-semibold text-slate-700 underline underline-offset-2 disabled:opacity-50">
          Cofnij zmianę</button>
      </>}
    </p>
    {edycja
      ? <>
          <label className="sr-only" htmlFor={idPola}>Notatka wewnętrzna</label>
          <textarea id={idPola} rows={4} value={tekst} autoFocus
            onChange={(e) => setTekst(e.target.value)}
            placeholder="Ustalenia, których klient nie widzi"
            className="field resize-y bg-white text-sm" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={trwa || tekst.trim() === (r.notatka ?? "").trim()}
              onClick={() => onZapisz(tekst, () => setEdycja(false))}
              className="btn-primary">{trwa ? "Zapisuję…" : "Zapisz"}</button>
            <button type="button" disabled={trwa}
              onClick={() => { setEdycja(false); setTekst(r.notatka ?? ""); }}
              className="btn-secondary">Anuluj</button>
          </div>
        </>
      : r.notatka
        ? <p className="whitespace-pre-wrap text-tresc text-slate-900">{r.notatka}</p>
        : <p className="text-sm text-slate-600">Brak notatki.</p>}
    {blad && <p className="text-sm text-ranga-zle">{blad}</p>}
  </section>;
}
