import React, { useEffect, useState } from "react";
import { Gavel, Check, Ban, PackageSearch } from "lucide-react";
import type { Reklamacja, WiadomoscReklamacji, Werdykt as KodWerdyktu } from "../api/typy";
import { Przycisk, Skopiuj, czas } from "../ui";
import { zlote } from "../api/zwroty";
import { NAZWA_STANU_WERDYKTU, NAZWA_WERDYKTU, ODMOWY, UZNANIA } from "./statusy";
import { LIMIT_ZNAKOW } from "./Edytor";
import { DlugaTresc, scisle, zawieraOpis } from "./tresc";

/* ── Werdykt reklamacji (przyrost trzeci; miejsce z 0.412.0) ─────────────────
   Pasek decyzji CAŁEJ sprawy — §25a.4: „pasek decyzji zostaje przy tym, co
   dotyczy całego zwrotu". Werdykt nie jest wiadomością, tylko
   rozstrzygnięciem, więc stoi osobno, a nie w edytorze.

   POD ROZMOWĄ, nie nad nią (0.412.0). Do 0.411.0 ten pasek był pierwszym
   elementem kolumny, czyli ekran zadawał nieodwracalne pytanie przed
   pokazaniem dowodów. Dekalog obsługi, punkt 9, i ergonomii, punkt 5.

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
   `CLAIM_ACCEPTED` to sprawa rozstrzygnięta poza panelem i pasek to mówi.

   TRZY ROZDZIELENIA OD PRZYCISKU WYSYŁKI (0.421.0). Zgłoszenie właściciela ze
   zrzutem: „werdykt jest za blisko guzika wyślij wiadomość". Do 0.420.1 pas
   werdyktu i pas odpowiedzi stały w tej samej stopce, rozdzielone jedną
   kreską i dwoma razy po 12 px, a „UZNAJĘ" siedziało DOKŁADNIE POD „WYŚLIJ
   ODPOWIEDŹ" — oba dosunięte do prawej krawędzi i oba bursztynowe. Prawo
   Fittsa mówi, co się dzieje z przestrzeleniem celu: ląduje na sąsiedzie.
   Sąsiadem była nieodwracalna gałąź.

   Rozdzielamy na TRZY niezależne sposoby, bo żaden z osobna nie wystarcza:
     ODLEGŁOŚĆ — kreska grubieje do 4 px, a oddech nad paskiem rośnie do 20 px.
     POŁOŻENIE — „UZNAJĘ" i „ODRZUCAM" schodzą z prawej krawędzi i stają przy
       swoim nagłówku. Prawa krawędź stopki należy odtąd do JEDNEGO przycisku.
     BARWA — bursztyn w tej stopce znaczy „to idzie teraz do klienta" i zostaje
       przy wysyłce. Gałęzie werdyktu niosą znaczenie ikoną, słowem i barwą
       pisma (§WCAG 1.4.1: nigdy samą barwą). Bursztyn wraca dopiero na „WYŚLIJ
       WERDYKT" — za polem zgody i o dwieście pikseli niżej.

   Tło `slate-50` pod paskiem to ta sama myśl co przy osi rozmowy w 0.418.0:
   barwa tła jest cechą pojedynczą, czytaną równolegle, więc granica dwóch
   pasów widać bez czytania (Treisman i Gelade, 1980).                       */

const ROZSTRZYGNIETE: Record<string, string> = {
  CLAIM_ACCEPTED: "uznana", CLAIM_REJECTED: "odrzucona",
};

/** Zdania startowe kroku o towarze — do edycji, nie do wysłania w ciemno. */
const ZDANIE_O_TOWARZE = {
  wymagany: "Prosimy o odesłanie reklamowanego towaru na adres sklepu. Po otrzymaniu paczki zrealizujemy uznaną reklamację.",
  niewymagany: "Towaru nie trzeba odsyłać. Uznaną reklamację zrealizujemy bez zwrotu przesyłki.",
} as const;

/** Od ilu znaków przed sufitem licznik w ogóle się pokazuje — jak w edytorze. */
const PROG_LICZNIKA = 500;

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

export function Werdykt({ reklamacja: r, czat = [], trwa, blad, trwaTowar, bladTowaru, onWerdykt, onTowar }: {
  reklamacja: Reklamacja;
  /** Rozmowa sprawy — tylko po to, żeby nie powtarzać wiadomości werdyktu,
      którą Allegro oddało w rozmowie. Bez niej blok pokazuje ją jak dotąd. */
  czat?: WiadomoscReklamacji[];
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
  /* Równość po ściśnięciu łapie krótkie zdania, zawarcie — nasze zdanie
     wklejone przez Allegro w dłuższą wiadomość (próg dubla z `tresc.tsx`). */
  const wiadomoscWerdyktu = r.werdyktWiadomosc ?? "";
  const wRozmowie = wiadomoscWerdyktu !== "" && czat.some((w) => w.autorRola === "SELLER"
    && (scisle(w.tresc) === scisle(wiadomoscWerdyktu) || zawieraOpis(w.tresc, wiadomoscWerdyktu)));

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
    return <section aria-label="Werdykt" className="border-t-4 border-slate-200 bg-slate-50 px-4 pb-3 pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <Gavel size={15} className="shrink-0 text-slate-400" />
        <b className="text-naglowek">Werdykt</b>
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
        {/* ── WIADOMOŚĆ WERDYKTU RAZ I KRÓTKO (@wydanie) ──────────────────────
            Stała w całości w stopce, która się nie przewija, więc długa
            zjadała okno rozmowy nad nią. Zwija się do czterech linii jak
            nasza wypowiedź na osi. Gdy Allegro oddało ją w rozmowie jako
            naszą wiadomość, tu już jej nie ma — to samo zdanie dwa razy
            to dwa miejsca do przeczytania. */}
        {r.werdyktWiadomosc && !wRozmowie && <div className="mt-2 flex items-start gap-2 rounded bg-slate-50 p-2">
          <div className="min-w-0 flex-1">
            <DlugaTresc key={r.id} tekst={r.werdyktWiadomosc} className="text-tresc text-slate-800"
              etykieta="Pokaż całą" />
          </div>
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
          <b className="text-naglowek">Towar do odesłania?</b>
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
                  Towar do odesłania</Przycisk>
                <Przycisk className="text-xs" disabled={trwaTowar}
                  onClick={() => { setTowar("niewymagany"); setTrescTowaru(ZDANIE_O_TOWARZE.niewymagany); }}>
                  Bez odsyłania</Przycisk>
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
              {trwaTowar ? "Wysyłam…" : "Wyślij stanowisko"}</Przycisk>
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

  return <section aria-label="Werdykt" className="border-t-4 border-slate-200 bg-slate-50 px-4 pb-3 pt-5">
    <div className="flex flex-wrap items-center gap-2">
      <Gavel size={15} className="shrink-0 text-slate-400" />
      <b className="text-naglowek">Werdykt</b>
      {nieudany && <span className="text-xs font-semibold text-ranga-zle">
        Nieudany: {r.werdyktBlad ?? "Allegro odmówiło"}</span>}
      {galaz === null && <>
        {nieudany
          ? <Przycisk className="text-xs text-ranga-uwaga" disabled={trwa}
              onClick={() => otworz(uznana ? "uznaje" : "odrzucam", {
                kod: r.werdykt as KodWerdyktu, wiadomosc: r.werdyktWiadomosc ?? "",
                kwota: r.werdyktKwotaGrosze,
              })}>Spróbuj jeszcze raz</Przycisk>
          : <>
            {/* Zdaniem, nie wersalikami (@wydanie) — tak piszą przyciski skrzynki. */}
            <Przycisk className="text-xs text-ranga-ok" disabled={trwa}
              onClick={() => otworz("uznaje")}><Check size={14} />Uznaję</Przycisk>
            <Przycisk className="text-xs text-ranga-zle" disabled={trwa}
              onClick={() => otworz("odrzucam")}><Ban size={14} />Odrzucam</Przycisk>
          </>}
      </>}
    </div>

    {galaz !== null && <div className="mt-2 space-y-2 border-t pt-2">
      <label className="block text-xs font-semibold text-slate-600">
        {galaz === "uznaje" ? "Sposób uznania" : "Powód odrzucenia"}
        {/* ── ZMIANA DECYZJI ZDEJMUJE ZGODĘ (0.424.0) ────────────────────
            0.424.0 kazało zdaniu zgody nazywać werdykt i zdanie przepisuje się
            natychmiast — ale PTASZEK ZOSTAWAŁ. Agent, który potwierdził jedną
            decyzję i zmienił zdanie, miał przycisk żywy pod decyzją, której
            nigdy nie potwierdził. Zgoda dotyczy KONKRETNEGO werdyktu, więc
            razem z nim traci ważność. To samo przy kwocie: „na 40 zł"
            potwierdzone, a wysłane „na 400 zł" byłoby tą samą pomyłką. */}
        <select className="field mt-1 w-full text-sm" aria-label="Wartość werdyktu"
          value={kod} onChange={(e) => { setKod(e.target.value as KodWerdyktu); setZgoda(false); }}>
          {(galaz === "uznaje" ? UZNANIA : ODMOWY).map((k) =>
            <option key={k} value={k}>{NAZWA_WERDYKTU[k]}</option>)}
        </select>
      </label>

      {czesciowy && <label className="block text-xs font-semibold text-slate-600">
        Kwota zwrotu ({r.waluta})
        <input className="field mt-1 w-full text-sm tabular-nums" inputMode="decimal"
          aria-label="Kwota zwrotu" value={kwota} placeholder="np. 40,00"
          onChange={(e) => { setKwota(e.target.value); setZgoda(false); }} />
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
        {/* LICZNIK TYLKO PRZY LIMICIE (@wydanie) — ta sama reguła co w polu
            odpowiedzi: „0 znaków" pod każdym werdyktem niczego nie rozstrzygał. */}
        {znakow > LIMIT_ZNAKOW - PROG_LICZNIKA && <span className={`mt-1 block font-semibold tabular-nums ${
          zaDlugo ? "text-ranga-zle" : "text-ranga-uwaga"}`}>
          {znakow} / {LIMIT_ZNAKOW}{zaDlugo ? ` — o ${znakow - LIMIT_ZNAKOW} za dużo` : ""}</span>}
      </label>

      {/* ── ZGODA NAZYWA WERDYKT PO IMIENIU (0.424.0) ────────────────────────
          Do 0.423.0 stało tu samo „werdykt jest nieodwracalny". To zdanie jest
          prawdziwe przy każdej z jedenastu wartości listy, więc pasowało tak
          samo do uznania z pełnym zwrotem, jak i do odmowy — a potwierdzało
          niby konkretną decyzję. Agent, który pomylił pozycję w liście, nie
          miał na całej ścieżce ANI JEDNEGO miejsca, gdzie pomyłka byłaby
          widoczna: nazwa werdyktu stała wyżej, w zwiniętym `select`.

          Zdanie bierze nazwę i kwotę ZE STANU FORMULARZA, więc zmiana listy
          przepisuje je natychmiast. Kwota wchodzi tylko wtedy, gdy jest
          prawidłowa — przy `null` przycisk i tak jest martwy, a zdanie ma
          mówić o tym, co naprawdę poleci. */}
      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={zgoda} onChange={(e) => setZgoda(e.target.checked)} />
        <span>Wysyłam <b>{NAZWA_WERDYKTU[kod]}</b>
          {czesciowy && grosze !== null && grosze > 0 &&
            <> na <b className="tabular-nums">{zlote(grosze, r.waluta)}</b></>}
          {" "}— nieodwracalnie, razem z wiadomością do kupującego.</span>
      </label>

      <div className="flex items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={trwa || !gotowe}
          onClick={() => onWerdykt({ werdykt: kod, wiadomosc: wiadomosc.trim(), kwotaGrosze: czesciowy ? grosze : null })}>
          {trwa ? "Wysyłam…" : "Wyślij werdykt"}</Przycisk>
        <Przycisk className="text-xs" onClick={() => setGalaz(null)}>Anuluj</Przycisk>
      </div>
    </div>}

    {blad && <p className="mt-2 text-xs font-semibold text-ranga-zle">{blad}</p>}
  </section>;
}
