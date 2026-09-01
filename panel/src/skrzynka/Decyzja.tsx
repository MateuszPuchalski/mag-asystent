import React, { useState } from "react";
import { AlarmClock, Ban, Check, Eye, Undo2 } from "lucide-react";
import type { Rozmowa, StatusRozmowy } from "../api/typy";
import { NAZWA_STATUSU, Plakietka, czas } from "../ui";

/* ── Pasek decyzji o statusie (0.157.0) ──────────────────────────────────────
   Trzy ruchy, których automat nie zgadnie: odłóż, załatwione, spam. Reszta
   liczy się sama z faktów (`services/statusy.ts` po stronie serwera), więc
   typowa rozmowa nie wymaga tu ani jednego kliknięcia.

   COFNIĘCIE ZAMIAST POTWIERDZENIA — ta sama zasada co przy zwrotach (§25a.5).
   Dopóki nic nie poszło do Allegro, każdy ruch ma drogę powrotną, a dialog
   „czy na pewno" kosztuje kliknięcie przy KAŻDEJ decyzji, także trafnej.   */

/** Trzy gotowe terminy zamiast kalendarza: trzy kliknięcia mniej. */
export function terminy(teraz: Date): Array<{ etykieta: string; iso: string }> {
  const jutro = new Date(teraz);
  jutro.setDate(jutro.getDate() + 1);
  jutro.setHours(8, 0, 0, 0);
  const zaDni = (ile: number) => {
    const d = new Date(teraz);
    d.setDate(d.getDate() + ile);
    d.setHours(8, 0, 0, 0);
    return d.toISOString();
  };
  return [
    { etykieta: "jutro rano", iso: jutro.toISOString() },
    { etykieta: "za trzy dni", iso: zaDni(3) },
    { etykieta: "za tydzień", iso: zaDni(7) },
  ];
}

export function Decyzja({ rozmowa, zajete, blad, onOdloz, onStatus, mojeId = null,
  teraz = new Date() }: {
  rozmowa: Rozmowa;
  zajete: boolean;
  blad: string;
  onOdloz: (iso: string) => void;
  onStatus: (status: StatusRozmowy) => void;
  /** Żeby nie mówić agentowi, że sam przy tej rozmowie siedzi. */
  mojeId?: number | null;
  teraz?: Date;
}) {
  const [odkladam, setOdkladam] = useState(false);
  const zamkniete = rozmowa.status === "resolved" || rozmowa.status === "closed"
    || rozmowa.status === "spam";
  /* Termin minął, ale w bazie dalej stoi `snoozed` — ekran ma to powiedzieć,
     zamiast pokazywać „w toku" bez wyjaśnienia, skąd rozmowa wróciła. */
  const wrocilaZOdlozenia = rozmowa.statusZapisany === "snoozed" && rozmowa.status !== "snoozed";

  return <section className="card p-3">
    <div className="flex flex-wrap items-center gap-2">
      <Plakietka status={rozmowa.status}>{NAZWA_STATUSU[rozmowa.status] ?? rozmowa.status}</Plakietka>

      {rozmowa.status === "snoozed" && rozmowa.snoozeDo &&
        <span className="text-xs text-slate-500">wraca {czas(rozmowa.snoozeDo)}</span>}
      {wrocilaZOdlozenia &&
        <span className="text-xs text-slate-500">termin odłożenia minął {czas(rozmowa.snoozeDo)}</span>}
      {/* Rozmowa wracająca po zamknięciu wygląda inaczej niż każda inna „w toku",
          bo jest inna: klient odpisał na coś, co uznaliśmy za załatwione. */}
      {rozmowa.wrocilaPoZamknieciu &&
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
          WRÓCIŁA PO ZAMKNIĘCIU</span>}
      {/* Uchwyt jest przydziałem TYMCZASOWYM — na czas siedzenia. Widać go,
          zanim padnie pierwsze słowo odpowiedzi, a nie dopiero przy wysyłce. */}
      {rozmowa.oglada && rozmowa.oglada.userId !== mojeId &&
        <span className="flex items-center gap-1 text-xs font-semibold text-violet-700">
          <Eye size={13} />siedzi tu {rozmowa.oglada.name}</span>}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {zamkniete
          ? <button type="button" disabled={zajete} onClick={() => onStatus("open")}
              className="btn-secondary inline-flex items-center gap-1 text-sm">
              <Undo2 size={14} />Wróć do pracy
              <kbd className="rounded border border-slate-300 bg-slate-100 px-1 text-[10px]">Backspace</kbd>
            </button>
          : <>
              <button type="button" disabled={zajete} onClick={() => setOdkladam((v) => !v)}
                className="btn-secondary inline-flex items-center gap-1 text-sm">
                <AlarmClock size={14} />Odłóż
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 text-[10px]">O</kbd>
              </button>
              <button type="button" disabled={zajete} onClick={() => onStatus("spam")}
                className="btn-secondary inline-flex items-center gap-1 text-sm">
                <Ban size={14} />Spam
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 text-[10px]">S</kbd>
              </button>
              <button type="button" disabled={zajete} onClick={() => onStatus("resolved")}
                className="btn-primary inline-flex items-center gap-1 text-sm">
                <Check size={14} />Załatwione
                <kbd className="rounded border border-white/40 bg-white/20 px-1 text-[10px]">Z</kbd>
              </button>
            </>}
      </div>
    </div>

    {odkladam && <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
      <span className="text-xs text-slate-500">Wróć do niej:</span>
      {terminy(teraz).map((t) => <button key={t.iso} type="button" disabled={zajete}
        onClick={() => { onOdloz(t.iso); setOdkladam(false); }}
        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">
        {t.etykieta}</button>)}
    </div>}

    {blad && <p className="mt-2 text-xs text-red-700">{blad}</p>}
  </section>;
}
