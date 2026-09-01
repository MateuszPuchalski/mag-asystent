import React, { useState } from "react";
import {
  CalendarClock, Check, Copy, ExternalLink, Package, Receipt, ShoppingCart, Undo2, X as Krzyzyk,
} from "lucide-react";
import type { PozycjaZwrotu, Zwrot } from "../api/typy";
import { usePotwierdzKartoteke, zlote } from "../api/zwroty";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import { czas } from "../ui";
import { Zdjecie } from "./Zdjecie";
import { Powiekszenie } from "./Powiekszenie";

/* Kolumna dowodów: wszystko, co trzeba przeczytać, ZANIM padnie decyzja.
   Akcji tu nie ma — te stoją w pasku werdyktu i mają być jedynym miejscem,
   gdzie coś się dzieje. Wyjątkiem są odnośniki: one nie zmieniają niczego
   u nas, tylko skracają drogę do Allegro, gdy naprawdę trzeba tam wejść. */

const POWODY: Record<string, string> = {
  NONE: "bez powodu", MISTAKE: "pomyłka klienta", TRANSPORT: "uszkodzenie w transporcie",
  DAMAGED: "towar uszkodzony", NOT_AS_DESCRIBED: "niezgodny z opisem",
  DONT_LIKE_IT: "nie spodobał się", OVERDUE_DELIVERY: "dostawa po terminie",
  INCOMPLETE: "niekompletny", HIDDEN_FLAW: "wada ukryta", OTHER_FLAW: "inna wada",
  DIFFERENT: "inny towar",
};

const ODRZUCENIA: Record<string, string> = {
  REFUND_REJECTED: "odmowa zwrotu pieniędzy",
  NEW_ITEM_SENT: "wysłano nowy towar",
  ITEM_FIXED: "towar naprawiono",
  MISSING_PART_SENT: "dosłano brakującą część",
};

const Sekcja = ({ ikona, tytul, children }: {
  ikona: React.ReactNode; tytul: string; children: React.ReactNode;
}) => <section className="border-b border-slate-200 p-4 last:border-0">
  <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
    {ikona}{tytul}</h3>
  {children}
</section>;

/** Odnośnik na zewnątrz. Bez adresu zostaje sam tekst — link donikąd jest gorszy. */
const Link = ({ href, children }: { href: string | null; children: React.ReactNode }) =>
  href
    ? <a href={href} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
        {children}<ExternalLink size={13} /></a>
    : <span>{children}</span>;

/** Identyfikator zamówienia to UUID — nikt go nie przepisuje z ekranu ręcznie. */
function Skopiuj({ tekst }: { tekst: string }) {
  const [zrobione, setZrobione] = useState(false);
  return <button type="button" title="Kopiuj identyfikator"
    onClick={() => {
      void navigator.clipboard?.writeText(tekst).then(() => {
        setZrobione(true);
        setTimeout(() => setZrobione(false), 1500);
      }).catch(() => {});
    }}
    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
    <Copy size={13} />
    <span className="sr-only">{zrobione ? "Skopiowano" : "Kopiuj"}</span>
  </button>;
}

/**
 * Kartoteka pozycji: potwierdzona, proponowana albo żadna — zawsze ze źródłem.
 *
 * Propozycję zatwierdza JEDNO kliknięcie, bo o to w tym ekranie chodzi.
 * Wskazanie ręczne otwiera się dopiero na żądanie: wyszukiwarka pod każdą
 * pozycją byłaby ścianą pól tam, gdzie w większości przypadków wystarczy
 * potwierdzić to, co automat już policzył.
 */
function Kartoteka({ p }: { p: PozycjaZwrotu }) {
  const [szukam, setSzukam] = useState(false);
  const zapisz = usePotwierdzKartoteke();

  const ustaw = (twId: number | null, zrodlo: "sku" | "reczne") =>
    zapisz.mutate({ pozycjaId: p.id, twId, zrodlo }, { onSuccess: () => setSzukam(false) });

  if (p.twId !== null) {
    return <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
      Kartoteka <b>{p.twSymbol}</b>
      <span className="text-slate-500">
        {p.twZrodlo === "sku" ? "· z SKU oferty, zatwierdzone" : "· wskazana ręcznie"}
      </span>
      <button type="button" title="Zdejmij powiązanie" disabled={zapisz.isPending}
        onClick={() => ustaw(null, "reczne")}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
        <Krzyzyk size={12} />
      </button>
    </p>;
  }

  const prop = p.propozycja;
  return <div className="mt-1 text-xs">
    {prop?.pewnosc === "sku"
      /* Propozycja nie udaje faktu: mówi, skąd się wzięła, i czeka na
         zatwierdzenie. Projekt panelu §4.3 i §11.3. */
      ? <div className="flex flex-wrap items-center gap-2 text-amber-800">
          <span>Propozycja: <b>{prop.symbol}</b>
            <span className="text-slate-500"> · {prop.zrodlo}</span></span>
          <button type="button" disabled={zapisz.isPending}
            onClick={() => ustaw(prop.twId, "sku")}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check size={12} />Zatwierdź</button>
        </div>
      : <span className="text-slate-500">
          Bez kartoteki{prop?.zrodlo ? ` · ${prop.zrodlo}` : ""}</span>}

    {szukam
      ? <div className="mt-1">
          <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
            onWybierz={(t: Towar | null) => t && ustaw(t.id, "reczne")} />
        </div>
      : <button type="button" onClick={() => setSzukam(true)}
          className="mt-1 text-slate-500 underline underline-offset-2 hover:text-slate-800">
          wskaż kartotekę</button>}
    {zapisz.error && <p className="mt-1 text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
}

export function Dowody({ zwrot }: { zwrot: Zwrot }) {
  const [powiekszony, setPowiekszony] = useState<PozycjaZwrotu | null>(null);
  const zam = zwrot.zamowienie;

  return <div className="text-sm">
    <Sekcja ikona={<CalendarClock size={14} />} tytul="Zegar ustawowy">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-slate-500">Zgłoszony</dt><dd>{czas(zwrot.utworzono)}</dd>
        <dt className="text-slate-500">Termin</dt>
        <dd className={zwrot.dniDoTerminu <= 3 ? "font-bold text-ranga-zle" : ""}>
          {czas(zwrot.terminAt)}</dd>
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        Termin liczony od zgłoszenia zwrotu. Ustawa liczy go od otrzymania
        oświadczenia — te dwa momenty nie muszą być tym samym.</p>
    </Sekcja>

    <Sekcja ikona={<Undo2 size={14} />} tytul="Zwrot">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
        <dt className="text-slate-500">Numer</dt>
        <dd><Link href={zwrot.linkZwrotu}>{zwrot.numer ?? zwrot.externalId}</Link></dd>
      </dl>
    </Sekcja>

    <Sekcja ikona={<ShoppingCart size={14} />} tytul="Zamówienie">
      {!zam
        ? <>
            <div className="flex items-center gap-1">
              <span className="break-all font-mono text-xs">{zwrot.orderId ?? "—"}</span>
              {zwrot.orderId && <Skopiuj tekst={zwrot.orderId} />}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Treści zamówienia jeszcze nie pobrano — dociągnie ją najbliższa
              synchronizacja.</p>
          </>
        : <>
            <div className="flex items-center gap-1">
              <Link href={zam.link}>Otwórz w Allegro</Link>
              <Skopiuj tekst={zam.externalId} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {zam.kupionoAt && <><dt className="text-slate-500">Kupione</dt>
                <dd>{czas(zam.kupionoAt)}</dd></>}
              {zam.dostawaMetoda && <><dt className="text-slate-500">Dostawa</dt>
                <dd>{zam.dostawaMetoda} · {zlote(zam.dostawaGrosze, zam.waluta)}</dd></>}
              <dt className="text-slate-500">Zapłacono</dt>
              <dd className="tabular-nums">{zlote(zam.sumaGrosze, zam.waluta)}</dd>
            </dl>
            {/* CAŁE zamówienie, nie tylko zwracane pozycje: „kupił trzy,
                oddaje jedną" jest kontekstem decyzji, a nie ciekawostką. */}
            <ul className="mt-3 space-y-1">
              {zam.pozycje.map((p, i) => <li key={`${p.offerId}-${i}`}
                className={`flex items-baseline gap-2 rounded px-2 py-1 text-xs ${
                  p.zwracana ? "bg-amber-50 font-semibold" : "text-slate-600"}`}>
                <span className="truncate">{p.nazwa}</span>
                <span className="ml-auto shrink-0 tabular-nums">
                  {p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
                {p.zwracana && <span className="shrink-0 rounded bg-amber-200 px-1 text-[10px] uppercase">
                  wraca</span>}
              </li>)}
            </ul>
          </>}
    </Sekcja>

    <Sekcja ikona={<Package size={14} />} tytul="Paczka zwrotna">
      {zwrot.paczkaAt
        ? <p>Wróciła {czas(zwrot.paczkaAt)}.</p>
        : <p className="font-semibold text-ranga-uwaga">
            Towar jeszcze nie wrócił, a termin biegnie.</p>}
      <p className="mt-2 text-xs text-slate-500">
        Danych nadawcy i konta bankowego nie pobieramy.</p>
    </Sekcja>

    <Sekcja ikona={<Receipt size={14} />} tytul="Zwracane pozycje">
      {zwrot.pozycje.length === 0
        ? <p className="text-slate-500">Zwrot bez pozycji — nie ma czego wycenić.</p>
        : <ul className="space-y-2">
            {zwrot.pozycje.map((p) => <li key={p.id} className="flex gap-3 rounded-lg bg-slate-50 p-2">
              <Zdjecie twId={p.twId} rozmiar={56} nazwa={p.nazwa}
                onKlik={p.twId !== null ? () => setPowiekszony(p) : undefined} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-semibold">
                    <Link href={p.url}>{p.nazwa}</Link></span>
                  <span className="ml-auto shrink-0 tabular-nums">{zlote(p.cenaGrosze, p.waluta)}</span>
                </div>
                <div className="text-xs text-slate-600">
                  {p.ilosc} szt.{p.powod ? ` · ${POWODY[p.powod] ?? p.powod}` : ""}
                  {p.ocena ? ` · ocena: ${p.ocena}` : ""}
                </div>
                {p.powodKomentarz && <p className="mt-1 text-xs italic text-slate-600">
                  „{p.powodKomentarz}"</p>}
                <Kartoteka p={p} />
              </div>
            </li>)}
          </ul>}
      <div className="mt-3 space-y-1 border-t border-slate-200 pt-2">
        <div className="flex items-baseline justify-between">
          <span className="text-slate-500">Suma pozycji</span>
          <span className="tabular-nums">{zlote(zwrot.sumaPozycjiGrosze, zwrot.waluta)}</span>
        </div>
        {zwrot.kwotaPelnaGrosze === null
          /* Ekran mówi, czego NIE wie: koszt dostawy stoi przy zamówieniu,
             a tego jeszcze nie pobrano. */
          ? <p className="text-xs text-slate-500">
              Kwoty pełnej nie znamy bez zamówienia — koszt dostawy stoi przy nim.</p>
          : <div className="flex items-baseline justify-between">
              <span className="font-bold">Z dostawą</span>
              <span className="text-lg font-bold tabular-nums">
                {zlote(zwrot.kwotaPelnaGrosze, zwrot.waluta)}</span>
            </div>}
      </div>
    </Sekcja>

    {zwrot.rejectionCode && <Sekcja ikona={<Receipt size={14} />} tytul="Rozstrzygnięte w Allegro">
      <p className="font-semibold">{ODRZUCENIA[zwrot.rejectionCode] ?? zwrot.rejectionCode}</p>
    </Sekcja>}

    {powiekszony?.twId != null && <Powiekszenie
      twId={powiekszony.twId} nazwa={powiekszony.nazwa} symbol={powiekszony.twSymbol}
      zamknij={() => setPowiekszony(null)} />}
  </div>;
}
