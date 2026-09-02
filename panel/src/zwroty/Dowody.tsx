import React, { useState } from "react";
import { Rabat } from "./Rabat";
import {
  CalendarClock, Check, Copy, ExternalLink, Package, Receipt, RefreshCw, ShoppingCart, Undo2,
  X as Krzyzyk,
} from "lucide-react";
import type { PozycjaZwrotu, Zwrot } from "../api/typy";
import { useDociagnijZamowienia, usePotwierdzKartoteke, zlote } from "../api/zwroty";
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
        {/* „zatwierdzona propozycja", a nie „z SKU oferty": od 0.154.0 automat
            proponuje z czterech źródeł (SKU, pamięć wskazań, jedyna pozycja
            zamówienia, nazwa w zamówieniu), a wszystkie zapisują się tym samym
            `sku`. Dawny podpis kłamałby przy trzech z czterech. */}
        {p.twZrodlo === "sku" ? "· zatwierdzona propozycja" : "· wskazana ręcznie"}
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
    {prop?.twId != null
      /* Propozycja nie udaje faktu: mówi, skąd się wzięła, i czeka na
         zatwierdzenie. Projekt panelu §4.3 i §11.3. Warunek stoi na `twId`,
         a nie na jednej wartości pewności — inaczej propozycja z pamięci
         wskazań (ta najpewniejsza, bo za nią stoi człowiek) nie dostałaby
         przycisku i wymagałaby ręcznego wskazania po raz drugi. */
      ? <div className="flex flex-wrap items-center gap-2 text-amber-800">
          <span>Propozycja: <b>{prop.symbol}</b>
            <span className="text-slate-500"> · {prop.zrodlo}</span></span>
          <button type="button" disabled={zapisz.isPending}
            onClick={() => ustaw(prop.twId, "sku")}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check size={12} />Zatwierdź</button>
        </div>
      /* POWÓD, nie samo „Bez kartoteki". Do 0.153.1 sześć różnych zerwań
         łańcucha wyglądało tu identycznie i operator nie miał jak odróżnić
         „sprzedawca nie wypełnił SKU" od „kod ma błąd". Zdanie pisze SERWER
         (`dopasowanie-sku.ts`) — druga kopia tej reguły w panelu rozjechałaby
         się przy pierwszej poprawce jednej z nich. */
      : <p className="text-slate-500">
          Bez kartoteki{prop?.zrodlo ? <> · <span className="text-slate-600">{prop.zrodlo}</span></> : null}</p>}

    {szukam
      ? <div className="mt-1">
          <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
            onWybierz={(t: Towar | null) => t && ustaw(t.id, "reczne")} />
        </div>
      /* Własny wiersz, nie doklejka do zdania o powodzie: „…jeszcze nie
         pobranowskaż kartotekę" czytało się jak jedno słowo. */
      : <button type="button" onClick={() => setSzukam(true)}
          className="mt-1 block text-slate-500 underline underline-offset-2 hover:text-slate-800">
          wskaż kartotekę</button>}
    {zapisz.error && <p className="mt-1 text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
}

/**
 * Ręczne dociągnięcie zamówień.
 *
 * Stoi DOKŁADNIE tam, gdzie widać jego brak — w sekcji zamówienia, pod
 * zdaniem „jeszcze nie pobrano". Bez niego jedyną odpowiedzią na „czemu ta
 * pozycja nie ma kartoteki" było czekanie dziesięciu minut na ticker.
 *
 * To jest ZAPIS na ekranie, który poza tym tylko czyta, i dlatego wymaga
 * kliknięcia: „zero zapisu przy patrzeniu" znaczy, że otwarcie ekranu niczego
 * nie mutuje, a nie że ekran nie ma prawa mieć przycisku.
 */
function DociagnijZamowienia() {
  const dociagnij = useDociagnijZamowienia();
  return <div className="mt-2">
    <button type="button" disabled={dociagnij.isPending}
      onClick={() => dociagnij.mutate()}
      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      <RefreshCw size={12} className={dociagnij.isPending ? "animate-spin" : ""} />
      {dociagnij.isPending ? "Pobieram…" : "Dociągnij teraz"}
    </button>
    {dociagnij.error && <p className="mt-1 text-xs text-red-700">
      {(dociagnij.error as Error).message}</p>}
    {dociagnij.isSuccess && <p className="mt-1 text-xs text-slate-500">
      Pobrano zamówień: {dociagnij.data?.pobrano ?? 0}.</p>}
  </div>;
}

export function Dowody({ zwrot, trwaRabat = false, bladRabatu = "", onZglosRabat }: {
  zwrot: Zwrot;
  trwaRabat?: boolean;
  bladRabatu?: string;
  onZglosRabat?: (pozycjaId: number) => void;
}) {
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
              {zwrot.orderId
                ? `Treści zamówienia jeszcze nie pobrano — dociągnie ją najbliższa
                   synchronizacja. Bez niej pozycje zwrotu nie mają skąd wziąć kartoteki.`
                : `Allegro nie podało przy tym zwrocie numeru zamówienia. Bez niego
                   nie ma czego dociągnąć ani z czego wziąć kartoteki.`}</p>
            {/* Przycisk tylko wtedy, gdy JEST co pobrać. Przy zwrocie bez numeru
                zamówienia dociąganie nie zmieni niczego, a obiecywałoby, że
                zmieni. */}
            {zwrot.orderId && <DociagnijZamowienia />}
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
                  <span className="truncate font-semibold">{p.nazwa}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{zlote(p.cenaGrosze, p.waluta)}</span>
                </div>
                <div className="text-xs text-slate-600">
                  {p.ilosc} szt.{p.powod ? ` · ${POWODY[p.powod] ?? p.powod}` : ""}
                  {p.ocena ? ` · ocena: ${p.ocena}` : ""}
                </div>
                {/* Odnośnik JAWNY i podpisany. Od 0.153.0 był nim sama nazwa
                    towaru — istniał, ale nikt go nie widział: podkreślenie nie
                    mówi, dokąd prowadzi, a pod nazwą równie dobrze mogłaby stać
                    nasza kartoteka. Gdy adresu nie ma, ekran mówi to wprost —
                    milczenie wygląda jak usterka panelu, a jest brakiem danych
                    po stronie Allegro. */}
                <p className="mt-0.5 text-xs">
                  {p.url
                    ? <Link href={p.url}>Zobacz ofertę</Link>
                    : <span className="text-slate-400">Allegro nie podało adresu oferty</span>}
                </p>
                {p.powodKomentarz && <p className="mt-1 text-xs italic text-slate-600">
                  „{p.powodKomentarz}"</p>}
                <Kartoteka p={p} />
                {/* Rabat stoi przy POZYCJI, nie przy zwrocie: wniosek składa się
                    na pozycję zamówienia, więc zwrot z dwiema pozycjami ma dwa
                    osobne rabaty i dwa osobne przyciski. */}
                <Rabat rabat={p.rabat} trwa={trwaRabat} blad={bladRabatu}
                  onZglos={() => onZglosRabat?.(p.id)} />
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
