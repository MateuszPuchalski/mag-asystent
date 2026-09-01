import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { SzczegolyWysylki } from "../api/typy";
import { Przycisk, czas } from "../ui";

/**
 * Konflikt świeżości przy wysyłce (§8.5, blizna 0.110.0).
 *
 * Dialog istnieje po to, żeby zgoda była JAWNA. Do 0.110.0 dopisek klienta
 * zakładał drugą sprawę, a odpowiedź szła na starą wersję pytania — po cichu.
 * Dlatego „WYŚLIJ MIMO TO" jest martwy, dopóki człowiek nie potwierdzi, że
 * wie, na którą wersję pytania odpowiada.
 *
 * Szkic zostaje nietknięty: serwer odrzucił wysyłkę PRZED strzałem do Allegro.
 */
export function DialogKonfliktu({ szczegoly, szkic, wysyla, blad, onWyslijMimoTo, onPopraw }: {
  szczegoly: SzczegolyWysylki;
  szkic: string;
  wysyla: boolean;
  blad: string;
  onWyslijMimoTo: () => void;
  onPopraw: () => void;
}) {
  const [zgoda, setZgoda] = useState(false);
  const nowa = szczegoly.nowaWiadomosc ?? null;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-4"
    role="dialog" aria-label="Wysyłka zatrzymana">
    <div className="card w-full max-w-3xl overflow-hidden">
      <header className="border-b border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-ranga-uwaga" size={18} />
          <b className="text-ranga-uwaga">Wysyłka zatrzymana — klient dopisał wiadomość</b>
        </div>
        <p className="mt-1 text-sm text-amber-900">
          Serwer odpowiedział 409 przed wysłaniem. Nic nie poszło do Allegro, a Twój szkic
          został zachowany w całości.
        </p>
      </header>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <section className="rounded-lg border border-os-klient-ramka bg-os-firma p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Twój szkic</div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{szkic}</p>
        </section>
        <section className="rounded-lg border border-os-komentarz-ramka bg-os-komentarz p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-ranga-uwaga">
            Nowa wiadomość klienta{nowa ? ` · ${czas(nowa.at)}` : ""}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{nowa?.tresc ?? "—"}</p>
          {nowa && <p className="mt-2 text-xs text-slate-500">wiadomość #{nowa.id}</p>}
        </section>
      </div>

      <p className="px-4 text-sm text-slate-500">
        Dopisek klienta nie zakłada drugiej sprawy i nie kasuje szkicu. Zmienia tylko to,
        na którą wersję pytania odpowiadasz.
      </p>

      <label className={`mx-4 mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${
        zgoda ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
        <input type="checkbox" className="mt-0.5" checked={zgoda}
          onChange={(e) => setZgoda(e.target.checked)} />
        Wiem, że odpowiadam na starszą wersję pytania, i chcę wysłać ten szkic bez zmian.
      </label>

      {blad && <p className="mx-4 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{blad}</p>}

      <footer className="mt-4 flex flex-wrap items-center gap-3 border-t bg-slate-50 p-4">
        <span className="font-mono text-xs text-slate-500">
          klucz idempotencji {szczegoly.kluczIdempotencji ?? "—"}
        </span>
        <span className="text-xs text-slate-400">podwójne kliknięcie nie utworzy drugiej odpowiedzi</span>
        <div className="ml-auto flex gap-2">
          <Przycisk onClick={onWyslijMimoTo} disabled={!zgoda || wysyla}>
            {wysyla ? "WYSYŁAM…" : "WYŚLIJ MIMO TO"}
          </Przycisk>
          <Przycisk wariant="glowny" onClick={onPopraw}>POPRAW SZKIC</Przycisk>
        </div>
      </footer>
    </div>
  </div>;
}
