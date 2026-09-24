import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ChevronDown, ChevronRight, ExternalLink, MessageSquare, MessagesSquare, Scale,
  ShoppingBag, StickyNote, Undo2, UserRound,
} from "lucide-react";
import {
  useCofnijNotatkeKlienta, useNotatkaKlienta, useProfilKlienta, type ProfilKlienta as Profil,
  type RodzajSprawyKlienta,
} from "../api/spoiwo";
import { zlote } from "../api/zwroty";
import { WidokHistorii } from "../skrzynka/Klient";
import { Blad, Karta, LoginKlienta, Przycisk, Pusto, czas, dzien } from "../ui";

/* ── PROFIL KLIENTA (24 września 2026) ───────────────────────────────────────
   Zgłoszenie właściciela: „profil klienta ze wszystkim, co z nim związane,
   w jednym widoku". Do tej wersji klient nie miał adresu — jego historia
   stała zawsze PRZY sprawie, w zakładce KLIENT albo w szufladzie zwrotu.
   Teraz ma własny ekran, do którego prowadzi szukanie i każda historia.

   KOLEJNOŚĆ TO KOLEJNOŚĆ PYTAŃ agenta, który otwiera profil przed odpowiedzią:
   „czy coś się pali" (sygnały), „co jest otwarte", „co kupił", „kim jest"
   (notatka, maszyny, cała oś). Liczby w nagłówku odpowiadają na „jak duży to
   klient" jednym spojrzeniem.

   EKRAN JEST ODCZYTEM, poza notatką — jedynym zapisem, i to na kliknięcie.
   Sprawy załatwia się na ich ekranach; tu każdy wiersz do nich prowadzi. */

const IKONY: Record<RodzajSprawyKlienta, React.ComponentType<{ size?: number; className?: string }>> = {
  rozmowa: MessageSquare, zwrot: Undo2, reklamacja: Scale, dyskusja: MessagesSquare,
};
const NAZWY: Record<RodzajSprawyKlienta, string> = {
  rozmowa: "Rozmowa", zwrot: "Zwrot", reklamacja: "Reklamacja", dyskusja: "Dyskusja",
};

export function ProfilKlienta() {
  const { login = "" } = useParams();
  const p = useProfilKlienta(login);
  const nawiguj = useNavigate();

  if (p.isLoading) return <Pusto waga="lista">Wczytuję profil…</Pusto>;
  if (p.error || !p.data) {
    return <Karta className="p-4"><Pusto waga="lista" ikona={UserRound}>
      {(p.error as Error | null)?.message ?? "Nie znamy klienta o takim loginie."}</Pusto></Karta>;
  }
  const d = p.data;

  /* Własny scroller — rama panelu nie przewija za ekrany. */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Naglowek d={d} />
    {d.sygnaly.length > 0 && <Sygnaly d={d} />}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-4">
        <Otwarte d={d} />
        <Zamowienia d={d} />
      </div>
      <div className="space-y-4">
        <Notatka login={d.login} notatka={d.notatka} />
        {/* Oś i maszyny w tym samym widoku co zakładka KLIENT i szuflada —
            klienta czyta się tak samo, skądkolwiek się przyszło. */}
        <Karta className="p-0">
          <WidokHistorii historia={{ login: d.login, maszyny: d.maszyny, wpisy: d.os }}
            tutaj="tym profilem" bezProfilu onOtworzRozmowe={(r) => nawiguj(`/obsluga/skrzynka/${r}`)} />
        </Karta>
      </div>
    </div>
  </div>;
}

function Liczba({ ile, podpis }: { ile: React.ReactNode; podpis: string }) {
  return <div className="min-w-0">
    <p className="text-naglowek font-bold tabular-nums text-slate-900">{ile}</p>
    <p className="text-podpis text-slate-600">{podpis}</p>
  </div>;
}

function Naglowek({ d }: { d: Profil }) {
  const l = d.liczby;
  return <Karta className="p-4">
    <div className="flex flex-wrap items-center gap-3">
      <UserRound size={20} className="text-slate-500" />
      <LoginKlienta login={d.login} className="text-tytul font-bold text-slate-900" />
      {l.pierwszyZakup && <span className="text-sm text-slate-600">
        klient od {dzien(l.pierwszyZakup)}</span>}
    </div>
    <div className="mt-3 grid grid-cols-3 gap-4 sm:grid-cols-6">
      <Liczba ile={l.zamowien} podpis="zamówienia" />
      <Liczba ile={zlote(l.wydanoGrosze, l.waluta ?? "PLN")} podpis="zapłacone" />
      <Liczba ile={l.rozmow} podpis="rozmowy" />
      <Liczba ile={l.zwrotow} podpis="zwroty" />
      <Liczba ile={l.reklamacji} podpis="reklamacje" />
      <Liczba ile={l.dyskusji} podpis="dyskusje" />
    </div>
  </Karta>;
}

/* Sygnały na górze, bo odpowiadają na „czy coś się pali". Czerwień WYŁĄCZNIE
   przy tonie „źle" — kolor zapalany zawsze uczy go ignorować. */
function Sygnaly({ d }: { d: Profil }) {
  return <ul className="flex flex-wrap gap-2" aria-label="Sygnały">
    {d.sygnaly.map((s, i) => {
      const klasa = `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${
        s.ton === "zle" ? "bg-red-50 text-ranga-zle" : "bg-slate-100 text-slate-800"}`;
      const tresc = <><AlertTriangle size={14} />{s.tekst}</>;
      return <li key={i}>{!s.cel
        ? <span className={klasa}>{tresc}</span>
        : s.cel.startsWith("/")
          ? <Link to={s.cel} className={`${klasa} hover:underline`}>{tresc}</Link>
          : <a href={s.cel} target="_blank" rel="noreferrer"
              className={`${klasa} hover:underline`}>{tresc}<ExternalLink size={12} /></a>}</li>;
    })}
  </ul>;
}

function Otwarte({ d }: { d: Profil }) {
  return <Karta className="overflow-hidden p-0" role="region" aria-label="Otwarte sprawy">
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2"><b>Otwarte sprawy</b>
      <span className="ml-2 text-sm text-slate-600">{d.otwarte.length}</span></div>
    {d.otwarte.length === 0
      ? <p className="px-4 py-2 text-sm text-slate-500">Nic nie jest otwarte.</p>
      : <ul>{d.otwarte.map((o) => {
          const Ikona = IKONY[o.rodzaj];
          return <li key={`${o.rodzaj}-${o.id}`} className="border-t first:border-t-0">
            <Link to={o.cel} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
              <Ikona size={15} className="shrink-0 text-slate-500" />
              <span className="w-24 shrink-0 text-xs font-semibold text-slate-600">{NAZWY[o.rodzaj]}</span>
              <span className="min-w-0 flex-1 truncate">{o.opis}</span>
              <span className="shrink-0 text-xs font-semibold text-slate-700">{o.stan}</span>
              <ChevronRight size={15} className="shrink-0 text-slate-400" />
            </Link>
          </li>;
        })}</ul>}
  </Karta>;
}

/* Zamówienie rozwija się do pozycji i paczki. Zwinięte domyślnie: przy stałym
   kliencie lista ma kilkanaście zakupów, a pytanie dotyczy zwykle jednego. */
function Zamowienia({ d }: { d: Profil }) {
  const [otwarte, setOtwarte] = useState<string | null>(null);
  return <Karta className="overflow-hidden p-0" role="region" aria-label="Zamówienia">
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2"><b>Zamówienia</b>
      <span className="ml-2 text-sm text-slate-600">{d.zamowienia.length}</span></div>
    {d.zamowienia.length === 0
      ? <p className="px-4 py-2 text-sm text-slate-500">Nie kupował u nas.</p>
      : <ul>{d.zamowienia.map((z) => {
          const rozwiniete = otwarte === z.id;
          const anulowane = z.status === "CANCELLED";
          return <li key={z.id} className="border-t first:border-t-0">
            <button type="button" aria-expanded={rozwiniete}
              onClick={() => setOtwarte(rozwiniete ? null : z.id)}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50 ${
                anulowane ? "text-slate-500" : ""}`}>
              {rozwiniete ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
              <ShoppingBag size={15} className="shrink-0 text-slate-500" />
              <span className="w-32 shrink-0 whitespace-nowrap tabular-nums">{z.kupionoAt ? dzien(z.kupionoAt) : "—"}</span>
              <span className="min-w-0 flex-1 truncate">
                {z.pozycje.map((p) => p.nazwa).join(", ") || "Zamówienie bez pozycji"}</span>
              <span className="shrink-0 text-xs text-slate-600">
                {anulowane ? "anulowane" : z.przesylka ?? ""}</span>
              <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                {zlote(z.sumaGrosze, z.waluta ?? "PLN")}</span>
            </button>
            {rozwiniete && <div className="border-t border-slate-100 bg-slate-50 px-12 py-2 text-sm">
              <ul className="space-y-0.5">
                {z.pozycje.map((p, i) => <li key={i} className="flex gap-3">
                  <span className="w-10 shrink-0 tabular-nums text-slate-600">{p.ilosc}×</span>
                  <span className="min-w-0 flex-1">{p.nazwa}</span>
                  <span className="shrink-0 tabular-nums">{zlote(p.cenaGrosze, z.waluta ?? "PLN")}</span>
                </li>)}
              </ul>
              {z.link && <a href={z.link} target="_blank" rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-slate-600 underline hover:text-slate-900">
                zamówienie {z.id} w Allegro<ExternalLink size={11} /></a>}
            </div>}
          </li>;
        })}</ul>}
  </Karta>;
}

/* NOTATKA ZAPISUJE SIĘ NA KLIKNIĘCIE, nie przy każdym znaku: każdy zapis to
   wpis w dzienniku, a „zero zapisu przy patrzeniu" wyklucza zapis przy samym
   otwarciu. Cofnięcie przywraca jedno poprzednie brzmienie. */
function Notatka({ login, notatka }: { login: string; notatka: Profil["notatka"] }) {
  const [tresc, setTresc] = useState(notatka?.tresc ?? "");
  useEffect(() => { setTresc(notatka?.tresc ?? ""); }, [notatka?.tresc]);
  const zapisz = useNotatkaKlienta(login);
  const cofnij = useCofnijNotatkeKlienta(login);
  const zmieniona = tresc.trim() !== (notatka?.tresc ?? "");
  const blad = (zapisz.error ?? cofnij.error) as Error | null;
  return <Karta className="p-4" role="region" aria-label="Notatka o kliencie">
    <p className="mb-2 flex items-center gap-2"><StickyNote size={15} className="text-slate-500" />
      <b>Notatka o kliencie</b></p>
    <label className="sr-only" htmlFor="notatka-klienta">Notatka o kliencie</label>
    <textarea id="notatka-klienta" rows={3} value={tresc} maxLength={1000}
      onChange={(e) => setTresc(e.target.value)}
      placeholder="Co warto wiedzieć przed odpowiedzią — widzi cały zespół"
      className="field w-full resize-y text-sm" />
    <Blad>{blad?.message}</Blad>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Przycisk wariant="glowny" disabled={!zmieniona || zapisz.isPending}
        onClick={() => zapisz.mutate(tresc.trim() || null)}>
        {zapisz.isPending ? "ZAPISUJĘ…" : "ZAPISZ"}</Przycisk>
      {notatka?.cofalna && <Przycisk disabled={cofnij.isPending} onClick={() => cofnij.mutate()}>
        Cofnij</Przycisk>}
      {notatka && <span className="text-xs text-slate-500">{notatka.przez}, {czas(notatka.at)}</span>}
    </div>
  </Karta>;
}
