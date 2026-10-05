import React, { useId, useState } from "react";
import { Ban, Check, Truck } from "lucide-react";
import type { OstatniaDostawaReklamacji, Reklamacja, ReklamacjaUDostawcy } from "../api/typy";
import { Przycisk, dzien } from "../ui";

/* ── Dalej: sztuka do dostawcy ───────────────────────────────────────────────
   Decyzja właściciela: wady fabryczne reklamujemy u dostawcy. Po uznaniu
   z odesłaniem towaru sprawa klienta się kończy, a nasza dopiero zaczyna.
   Bez tego kroku nikt nie pamięta, że sztukę trzeba zgłosić dalej, i koszt
   uznania zostaje u nas.

   DWA KROKI, W KOLEJNOŚCI PRACY (dekalog, punkt 1). Najpierw sztuka wraca do
   nas, potem zgłoszenie u dostawcy i jego wynik. Ekran mówi, który krok jest
   następny, zamiast kazać go pamiętać.

   PACZKI ZWROTNEJ NIE ŚLEDZIMY i krok to mówi. Stan przesyłki w sprawie dotyczy
   paczki DO klienta, więc „doręczona" pod tym krokiem znaczyłoby, że sztuka
   wróciła, gdy wyszła. Fałszywy fakt jest gorszy od przyznania się do braku.

   ZAPIS TO NASZA PAMIĘĆ, nie wiadomość do nikogo. Dlatego przyciski są
   drugorzędne: bursztyn na tym ekranie znaczy „to idzie do klienta". */

/** Jeden zapis zgłoszenia u dostawcy; `wersja: 0` zakłada rekord. */
export interface ZapisUDostawcy {
  dostawca: string;
  nrUDostawcy?: string | null;
  wynik?: "uznal" | "odrzucil" | null;
  wersja: number;
}

/** Granice pól — te same, które trzyma serwer; dłuższego nie da się wpisać. */
const LIMIT_DOSTAWCY = 120;
const LIMIT_NR = 80;

export function SztukaDoDostawcy({ reklamacja: r, dostawa = null, uDostawcy = null, trwa = false,
  blad = "", onZapisz }: {
  reklamacja: Reklamacja;
  /** Ostatnia dostawa towaru — z niej podpowiadamy, u kogo zgłosić. */
  dostawa?: OstatniaDostawaReklamacji | null;
  uDostawcy?: ReklamacjaUDostawcy | null;
  trwa?: boolean;
  blad?: string;
  onZapisz: (z: ZapisUDostawcy) => void;
}) {
  const [formularz, setFormularz] = useState(false);
  const [dostawca, setDostawca] = useState(dostawa?.dostawca ?? "");
  const [nr, setNr] = useState("");
  const id = useId();
  const kto = uDostawcy?.dostawca ?? dostawa?.dostawca ?? null;

  /* Skąd wiemy, że sztuka ma wrócić: z naszego stanowiska albo z Allegro,
     gdy zapadło w Centrum Sprzedaży. Jedno zdanie, bez zgadywania paczki. */
  const skad = r.zwrotTowaru === "wymagany"
    ? "kupujący wie, że ma ją odesłać" : "Allegro: zwrot towaru wymagany";

  const zapiszWynik = (wynik: "uznal" | "odrzucil" | null) => uDostawcy && onZapisz({
    dostawca: uDostawcy.dostawca, wynik, wersja: uDostawcy.wersja,
  });

  return <div role="group" aria-label="Dalej: sztuka do dostawcy" className="mt-3 border-t pt-2">
    <div className="flex items-center gap-2">
      <Truck size={15} aria-hidden="true" className="shrink-0 text-slate-500" />
      <b className="text-naglowek">Dalej: sztuka do dostawcy</b>
    </div>
    <ol className="mt-1 flex flex-col gap-2 text-sm text-slate-800">
      <li>
        <b>1. Sztuka wraca do nas</b>
        <p className="text-xs text-slate-600">{skad}. Paczki zwrotnej nie śledzimy — przyjęcie
          sprawdzisz w magazynie.</p>
      </li>
      <li>
        <b>2. Reklamacja u dostawcy</b>{" "}
        <span className={kto ? "font-mono font-semibold" : "text-slate-600"}>{kto ?? "nie wiemy"}</span>

        {uDostawcy
          ? <div className="mt-1 flex flex-col gap-1.5">
              <p className="text-xs text-slate-700">
                Zgłoszone u <b>{uDostawcy.dostawca}</b> · {dzien(uDostawcy.zgloszonoAt)}
                {uDostawcy.nrUDostawcy && <> · nr <span className="font-mono">{uDostawcy.nrUDostawcy}</span></>}
              </p>
              {uDostawcy.wynik === null
                ? <div className="flex flex-wrap gap-2">
                    {/* Równe, jak gałęzie werdyktu: wynik zapisuje się tym,
                        co dostawca odpisał, a nie tym, co ekran podsuwa. */}
                    <Przycisk className="text-xs text-ranga-ok" disabled={trwa}
                      onClick={() => zapiszWynik("uznal")}><Check size={14} />Dostawca uznał</Przycisk>
                    <Przycisk className="text-xs text-ranga-zle" disabled={trwa}
                      onClick={() => zapiszWynik("odrzucil")}><Ban size={14} />Dostawca odrzucił</Przycisk>
                  </div>
                : <p className="text-xs">
                    <b className={uDostawcy.wynik === "uznal" ? "text-ranga-ok" : "text-ranga-zle"}>
                      {uDostawcy.wynik === "uznal" ? "Dostawca uznał" : "Dostawca odrzucił"}</b>
                    {uDostawcy.wynikAt && <span className="text-slate-600"> · {dzien(uDostawcy.wynikAt)}</span>}
                    {" · "}
                    {/* Pomyłkę w wyniku cofa jedno kliknięcie, nie telefon do
                        administratora — to nasz zapis, nie wiadomość do kogoś. */}
                    <button type="button" disabled={trwa} onClick={() => zapiszWynik(null)}
                      className="min-h-6 font-semibold text-slate-700 underline underline-offset-2
                        disabled:opacity-50">zmień wynik</button>
                  </p>}
            </div>
          : formularz
            ? <form className="mt-1 flex flex-col gap-1.5" onSubmit={(e) => {
                e.preventDefault();
                if (!dostawca.trim() || trwa) return;
                onZapisz({ dostawca: dostawca.trim(), nrUDostawcy: nr.trim() || null, wersja: 0 });
              }}>
                <label htmlFor={`${id}-dostawca`} className="text-xs font-semibold text-slate-600">
                  Dostawca</label>
                <input id={`${id}-dostawca`} className="field text-sm" value={dostawca}
                  maxLength={LIMIT_DOSTAWCY} onChange={(e) => setDostawca(e.target.value)}
                  placeholder="symbol kontrahenta" />
                <label htmlFor={`${id}-nr`} className="text-xs font-semibold text-slate-600">
                  Nr u dostawcy (nieobowiązkowy)</label>
                <input id={`${id}-nr`} className="field text-sm" value={nr} maxLength={LIMIT_NR}
                  onChange={(e) => setNr(e.target.value)} />
                <div className="flex items-center gap-2">
                  <Przycisk type="submit" className="text-xs" disabled={trwa || !dostawca.trim()}>
                    {trwa ? "Zapisuję…" : "Zapisz"}</Przycisk>
                  <Przycisk type="button" className="text-xs" onClick={() => setFormularz(false)}>
                    Anuluj</Przycisk>
                </div>
              </form>
            : <div className="mt-1">
                <Przycisk className="text-xs" disabled={trwa} onClick={() => setFormularz(true)}>
                  Zgłoś u dostawcy</Przycisk>
              </div>}
      </li>
    </ol>
    {blad && <p className="mt-2 text-xs font-semibold text-ranga-zle">{blad}</p>}
  </div>;
}
