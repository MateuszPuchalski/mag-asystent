import React, { useEffect, useState } from "react";
import { Gavel, Check, Ban, PackageSearch } from "lucide-react";
import type { Reklamacja, Werdykt as KodWerdyktu } from "../api/typy";
import { Przycisk, Skopiuj, czas } from "../ui";
import { zlote } from "../api/zwroty";
import { NAZWA_STANU_WERDYKTU, NAZWA_WERDYKTU, ODMOWY, UZNANIA } from "./statusy";
import { LIMIT_ZNAKOW } from "./Edytor";

/* ── Werdykt reklamacji (przyrost trzeci) ────────────────────────────────────
   Pasek decyzji CAŁEJ sprawy nad rozmową — §25a.4: „pasek decyzji zostaje
   przy tym, co dotyczy całego zwrotu". Rozmowa ma edytor pod osią; werdykt
   nie jest wiadomością, tylko rozstrzygnięciem, więc stoi osobno i wyżej.

   PRAWO HICKA: najpierw DWA przyciski — „UZNAJĘ" albo „ODRZUCAM" — dopiero po
   kliknięciu lista czterech albo siedmiu wartości Allegro. Jedenaście pozycji
   w jednym `select` to jedenaście decyzji naraz.

   POTWIERDZENIE ZAMIAST COFNIĘCIA (§25a.5). Allegro drugiego werdyktu w tej
   samej sprawie nie przyjmie, więc cofnięcia nie ma — jest pole zgody przed
   przyciskiem, jak przy odmowie wypłaty. Zgoda jest KLIKNIĘCIEM W ZDANIE,
   które mówi, co się stanie, a nie oknem „na pewno?" z dwoma przyciskami.

   LOS PRÓBY JEST ZDANIEM, NIE KODEM. `sent` mówi „Allegro jeszcze nie
   potwierdziło" — zieleń należy się dopiero statusowi z synchronizacji, jak
   przy pieniądzach (0.209.0). `send_uncertain` mówi, czego NIE robić.
   Ponowienie dostaje wyłącznie `send_failed`: przy niepewnym losie drugi
   strzał mógłby być drugim werdyktem.

   WERDYKT Z CENTRUM SPRZEDAŻY nie udaje naszego: `werdykt: null` przy
   `CLAIM_ACCEPTED` to sprawa rozstrzygnięta poza panelem i pasek to mówi.  */

const ROZSTRZYGNIETE: Record<string, string> = {
  CLAIM_ACCEPTED: "uznana", CLAIM_REJECTED: "odrzucona",
};

/** Zdania startowe kroku o towarze — do edycji, nie do wysłania w ciemno. */
const ZDANIE_O_TOWARZE = {
  wymagany: "Prosimy o odesłanie reklamowanego towaru na adres sklepu. Po otrzymaniu paczki zrealizujemy uznaną reklamację.",
  niewymagany: "Towaru nie trzeba odsyłać. Uznaną reklamację zrealizujemy bez zwrotu przesyłki.",
} as const;

/** „12,50" albo „12.50" → grosze; śmieci dają `null`, a nie zero. */
export function naGrosze(tekst: string): number | null {
  const t = tekst.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export interface ZadanieWerdyktu {
  werdykt: KodWerdyktu;
  wiadomosc: string;
  kwotaGrosze: number | null;
}

export type DecyzjaOTowarze = "wymagany" | "niewymagany";

export function Werdykt({ reklamacja: r, trwa, blad, trwaTowar, bladTowaru, onWerdykt, onTowar }: {
  reklamacja: Reklamacja;
  trwa: boolean;
  /** Zdanie z serwera pod formularzem: konflikt, sufit kwoty, odmowa Allegro. */
  blad: string;
  trwaTowar: boolean;
  bladTowaru: string;
  onWerdykt: (z: ZadanieWerdyktu) => void;
  onTowar: (decyzja: DecyzjaOTowarze, tresc: string) => void;
}) {
  const [galaz, setGalaz] = useState<"uznaje" | "odrzucam" | null>(null);
  const [kod, setKod] = useState<KodWerdyktu>("ACCEPTED_REFUND");
  const [kwota, setKwota] = useState("");
  const [wiadomosc, setWiadomosc] = useState("");
  const [zgoda, setZgoda] = useState(false);
  const [towar, setTowar] = useState<DecyzjaOTowarze | null>(null);
  const [trescTowaru, setTrescTowaru] = useState("");

  /* Formularz czyści się przy ZMIANIE SPRAWY — inaczej werdykt pisany do
     jednej reklamacji wyjechałby do drugiej po strzałce w kolejce. */
  useEffect(() => {
    setGalaz(null); setZgoda(false); setKwota(""); setWiadomosc("");
    setTowar(null); setTrescTowaru("");
  }, [r.id]);

  const status = r.werdyktStatus;
  const wydany = status === "sent" || status === "send_uncertain" || status === "sending";
  const uAllegro = r.statusAllegro ? ROZSTRZYGNIETE[r.statusAllegro] : undefined;
  const uznana = (r.werdykt ?? "").startsWith("ACCEPTED");

  const otworz = (g: "uznaje" | "odrzucam", start?: { kod: KodWerdyktu; wiadomosc: string; kwota: number | null }) => {
    setGalaz(g);
    setKod(start?.kod ?? (g === "uznaje" ? UZNANIA[0] : ODMOWY[0]));
    setWiadomosc(start?.wiadomosc ?? "");
    setKwota(start?.kwota != null ? (start.kwota / 100).toFixed(2).replace(".", ",") : "");
    setZgoda(false);
  };

  /* ── Blok po werdykcie (nasz albo z Centrum Sprzedaży) ───────────────────── */
  if (wydany || (uAllegro && status !== "send_failed")) {
    const potwierdzony = Boolean(uAllegro);
    return <section aria-label="Werdykt" className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Gavel size={15} className="shrink-0 text-slate-400" />
        <b className="text-sm">Werdykt</b>
        {r.werdykt
          ? <span className="text-sm font-semibold">{r.werdyktNazwa ?? r.werdykt}
              {r.werdyktKwotaGrosze !== null && <span className="ml-1 tabular-nums">
                · {zlote(r.werdyktKwotaGrosze, r.waluta)}</span>}</span>
          : <span className="text-sm">Rozstrzygnięta poza panelem — <b>{uAllegro}</b> w Centrum Sprzedaży</span>}
        {r.werdykt && (potwierdzony
          ? <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-ranga-ok">
              <Check size={14} />Potwierdzony przez Allegro</span>
          : <span className={`ml-auto text-xs font-semibold ${
              status === "send_uncertain" ? "text-ranga-zle" : "text-ranga-uwaga"}`}
              title="Status Allegro przestawia dopiero synchronizacja">
              {NAZWA_STANU_WERDYKTU[status ?? "sent"]}</span>)}
      </div>
      {r.werdykt && <>
        <p className="mt-1 text-xs text-slate-500">
          {r.werdyktPrzez ?? "?"}{r.werdyktAt ? `, ${czas(r.werdyktAt)}` : ""}
        </p>
        {r.werdyktWiadomosc && <div className="mt-2 flex items-start gap-2 rounded bg-slate-50 p-2">
          <p className="flex-1 whitespace-pre-wrap text-sm text-slate-800">{r.werdyktWiadomosc}</p>
          <Skopiuj tekst={r.werdyktWiadomosc} tytul="Kopiuj wiadomość werdyktu" />
        </div>}
      </>}

      {/* ── Krok drugi po uznaniu: towar do odesłania? ────────────────────────
          Tylko przy NASZYM uznaniu, które wyszło albo mogło wyjść. Po decyzji
          zostaje zdanie i potwierdzenie z `zwrotWymagany` — Allegro ma to
          samo zrozumieć, a specyfikacja tego nie obiecuje wprost. */}
      {uznana && status !== "sending" && <div className="mt-3 border-t pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <PackageSearch size={15} className="shrink-0 text-slate-400" />
          <b className="text-sm">Towar do odesłania?</b>
          {r.zwrotTowaru
            ? <span className="text-sm">Kupującemu powiedziano: <b>{r.zwrotTowaru === "wymagany"
                ? "odesłać" : "zostaje u klienta"}</b>
                <span className="ml-2 text-xs text-slate-500">
                  {r.zwrotWymagany === null ? "Allegro jeszcze nie potwierdziło"
                    : `Allegro potwierdza: ${r.zwrotWymagany ? "zwrot wymagany" : "bez zwrotu"}`}</span></span>
            : r.zwrotWymagany !== null
              ? <span className="text-sm">Zapadło poza panelem: <b>{r.zwrotWymagany
                  ? "zwrot wymagany" : "bez zwrotu"}</b></span>
              : towar === null && <>
                <Przycisk className="text-xs" disabled={trwaTowar}
                  onClick={() => { setTowar("wymagany"); setTrescTowaru(ZDANIE_O_TOWARZE.wymagany); }}>
                  TOWAR DO ODESŁANIA</Przycisk>
                <Przycisk className="text-xs" disabled={trwaTowar}
                  onClick={() => { setTowar("niewymagany"); setTrescTowaru(ZDANIE_O_TOWARZE.niewymagany); }}>
                  BEZ ODSYŁANIA</Przycisk>
              </>}
        </div>
        {towar !== null && !r.zwrotTowaru && <div className="mt-2 space-y-2">
          <label className="block text-xs font-semibold text-slate-600">
            Wiadomość do kupującego — {towar === "wymagany" ? "towar do odesłania" : "bez odsyłania"}
            <textarea className="field mt-1 min-h-16 w-full text-sm" value={trescTowaru}
              aria-label="Wiadomość o towarze" onChange={(e) => setTrescTowaru(e.target.value)} />
          </label>
          <div className="flex items-center gap-2">
            <Przycisk wariant="glowny" className="text-xs" disabled={trwaTowar || !trescTowaru.trim()}
              onClick={() => onTowar(towar, trescTowaru.trim())}>
              {trwaTowar ? "WYSYŁAM…" : "WYŚLIJ STANOWISKO"}</Przycisk>
            <Przycisk className="text-xs" onClick={() => setTowar(null)}>Anuluj</Przycisk>
          </div>
        </div>}
        {bladTowaru && <p className="mt-2 text-xs font-semibold text-ranga-zle">{bladTowaru}</p>}
      </div>}
    </section>;
  }

  /* ── Formularz (także ponowienie po `send_failed`) ───────────────────────── */
  const nieudany = status === "send_failed";
  const czesciowy = kod === "ACCEPTED_PARTIAL_REFUND";
  const grosze = naGrosze(kwota);
  const znakow = wiadomosc.length;
  const zaDlugo = znakow > LIMIT_ZNAKOW;
  const gotowe = Boolean(wiadomosc.trim()) && !zaDlugo && zgoda && (!czesciowy || (grosze !== null && grosze > 0));

  return <section aria-label="Werdykt" className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-center gap-2">
      <Gavel size={15} className="shrink-0 text-slate-400" />
      <b className="text-sm">Werdykt</b>
      {nieudany && <span className="text-xs font-semibold text-ranga-zle">
        Nieudany: {r.werdyktBlad ?? "Allegro odmówiło"}</span>}
      {galaz === null && <>
        {nieudany
          ? <Przycisk wariant="glowny" className="ml-auto text-xs" disabled={trwa}
              onClick={() => otworz(uznana ? "uznaje" : "odrzucam", {
                kod: r.werdykt as KodWerdyktu, wiadomosc: r.werdyktWiadomosc ?? "",
                kwota: r.werdyktKwotaGrosze,
              })}>SPRÓBUJ JESZCZE RAZ</Przycisk>
          : <>
            <Przycisk wariant="glowny" className="ml-auto text-xs" disabled={trwa}
              onClick={() => otworz("uznaje")}><Check size={14} />UZNAJĘ</Przycisk>
            <Przycisk className="text-xs" disabled={trwa}
              onClick={() => otworz("odrzucam")}><Ban size={14} />ODRZUCAM</Przycisk>
          </>}
      </>}
    </div>

    {galaz !== null && <div className="mt-2 space-y-2 border-t pt-2">
      <label className="block text-xs font-semibold text-slate-600">
        {galaz === "uznaje" ? "Sposób uznania" : "Powód odrzucenia"}
        <select className="field mt-1 w-full text-sm" aria-label="Wartość werdyktu"
          value={kod} onChange={(e) => setKod(e.target.value as KodWerdyktu)}>
          {(galaz === "uznaje" ? UZNANIA : ODMOWY).map((k) =>
            <option key={k} value={k}>{NAZWA_WERDYKTU[k]}</option>)}
        </select>
      </label>

      {czesciowy && <label className="block text-xs font-semibold text-slate-600">
        Kwota zwrotu ({r.waluta})
        <input className="field mt-1 w-full text-sm tabular-nums" inputMode="decimal"
          aria-label="Kwota zwrotu" value={kwota} placeholder="np. 40,00"
          onChange={(e) => setKwota(e.target.value)} />
        {/* Podpowiedź, nie wartość domyślna: kwotę wpisuje agent (decyzja
            właściciela), a serwer pilnuje sufitu i mówi, skąd go wziął. */}
        {r.oczekiwanie === "PARTIAL_REFUND" && r.oczekiwanaKwotaGrosze !== null &&
          <span className="mt-1 block font-normal text-slate-500">
            Klient prosi o {zlote(r.oczekiwanaKwotaGrosze, r.waluta)}.</span>}
      </label>}

      <label className="block text-xs font-semibold text-slate-600">
        Wiadomość do kupującego — wymagana przez Allegro, klient ją przeczyta
        <textarea className="field mt-1 min-h-20 w-full text-sm" value={wiadomosc}
          aria-label="Wiadomość do kupującego" onChange={(e) => setWiadomosc(e.target.value)} />
        <span className={`mt-1 block font-normal tabular-nums ${zaDlugo ? "text-ranga-zle" : "text-slate-500"}`}>
          {znakow} znaków{zaDlugo ? ` — o ${znakow - LIMIT_ZNAKOW} za dużo` : ""}</span>
      </label>

      {/* Zgoda bramkuje przycisk. Zdanie mówi, co się stanie — bez tego
          „na pewno?" pytałoby o nic. */}
      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={zgoda} onChange={(e) => setZgoda(e.target.checked)} />
        <span>Rozumiem: werdykt jest <b>nieodwracalny</b> i razem z wiadomością trafia do kupującego.</span>
      </label>

      <div className="flex items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={trwa || !gotowe}
          onClick={() => onWerdykt({ werdykt: kod, wiadomosc: wiadomosc.trim(), kwotaGrosze: czesciowy ? grosze : null })}>
          {trwa ? "WYSYŁAM…" : "WYŚLIJ WERDYKT"}</Przycisk>
        <Przycisk className="text-xs" onClick={() => setGalaz(null)}>Anuluj</Przycisk>
      </div>
    </div>}

    {blad && <p className="mt-2 text-xs font-semibold text-ranga-zle">{blad}</p>}
  </section>;
}
