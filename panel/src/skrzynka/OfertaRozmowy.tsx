import React, { useState } from "react";
import { Check, ChevronRight, Package, Tag } from "lucide-react";
import type { OfertaRozmowy as Dane, ZgodnoscOferty } from "../api/typy";
import { zlote } from "../api/zwroty";
import { KafelOferty } from "../towar/Kafel";
import { NaglowekSekcji, czas } from "../ui";
import { OdnosnikAllegro } from "./odnosniki";

/**
 * Oferta, pod którą padło pytanie (0.178.0).
 *
 * Do 0.177.1 panel pokazywał przy wiadomości SAM NUMER oferty, a mail
 * powiadamiający z Allegro miał w bloku „Wiadomość dotyczy” tytuł, cenę
 * i zdjęcie. Panel miał więc mniej niż powiadomienie, od którego wszystko się
 * zaczyna — i agent szedł po tytuł do panelu Allegro, czyli tam, gdzie §25
 * obiecuje nie zaglądać.
 *
 * Blok ma dwa stany i każdy mówi co innego: tytuł z ceną (gdy ticker
 * dociągnął snapshot) albo zdanie, że tytuł dopiero przyjedzie. Milczenie
 * w drugim stanie wyglądałoby jak usterka.
 *
 * ── ZDJĘCIE OFERTY JEST OD 0.213.0 ─────────────────────────────────────────
 * Do 0.210.0 stało tu zdanie „zdjęcia z Allegro nie ma świadomie", bo obrazek
 * z ich serwera znaczyłby wyjście przeglądarki biura poza własną sieć. Zakaz
 * dotyczył HOTLINKA i obowiązuje dalej — `<img src="https://a.allegroimg.com/…">`
 * w tym pliku nie stanie. Plik ciągnie SERWER i podaje go z naszej trasy
 * `/api/obsluga/oferta/:externalId/zdjecie`, dokładnie tak, jak od 0.30.0
 * podaje zdjęcia kartotek.
 *
 * DWA ZDJĘCIA W JEDNEJ ZAKŁADCE I OBA SĄ POTRZEBNE. Tutaj stoi to, co klient
 * WIDZIAŁ, kupując; w bloku towaru niżej — to, co mamy na półce. Zbieżność
 * nie jest przesądzona i właśnie ta różnica bywa treścią pytania. Kafle mają
 * więc podpisy: źródło musi być widać (§4.3).
 *
 * Zdjęcie oferty zakrywa też dziurę, której kartoteka zakryć nie umie: pytanie
 * SPRZED zakupu przychodzi zwykle bez kartoteki, a większość kartotek i tak
 * zdjęcia nie ma. Oferta ma je prawie zawsze.
 */
export function OfertaRozmowy({ oferta, zTytulem = true, cenaZakupuGrosze = null }: {
  oferta: Dane;
  /**
   * Tytuł, SKU, cena i zdjęcie oferty. `false`, gdy pokazuje je karta zakupu
   * nad osią (`ofertaWKarcie`) — drugi dom tych faktów kazał porównywać dwa
   * miejsca, czy mówią to samo.
   */
  zTytulem?: boolean;
  /** Cena tej oferty w zamówieniu rozmowy; przy różnicy linia mówi dzisiejszą. */
  cenaZakupuGrosze?: number | null;
}) {
  const o = oferta.pobrana;
  /* Cena oferty bez tytułu staje tylko przy RÓŻNICY z ceną zakupu. Kwotę
     zakupu mówi karta, a dzisiejsza cena jest wtedy odpowiedzią na „czemu
     teraz drożej". Równa byłaby tylko drugim zapisem tej samej liczby. */
  const innaCena = !zTytulem && o?.cenaGrosze != null && cenaZakupuGrosze !== null
    && o.cenaGrosze !== cenaZakupuGrosze;
  /* PŁASKO, BEZ KARTY W KARCIE. Zrzut właściciela: pięć ramek w jednej
     kolumnie, każda z innym tłem. Kreskę między blokami daje kolumna,
     a odstęp wewnątrz bloku — jego rodzic. */
  return <section aria-label="Oferta" className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <NaglowekSekcji ikona={<Package size={13} />}>Oferta</NaglowekSekcji>
      <span className="font-mono text-podpis text-slate-500">{oferta.externalId}</span>
      {/* Status oferty („aktywna", „zakończona") mówi streszczenie wiersza,
          słowem po polsku. Surowy kod z Allegro obok numeru był drugim
          zapisem tego samego faktu. */}
      {/* Skąd numer (0.215.0). Numer z wiadomości klienta jest faktem z Allegro
          i nie potrzebuje podpisu; dwa pozostałe to wnioski — agenta albo
          serwera z jedynej pozycji zamówienia — i §4.3 każe je podpisać. */}
      {/* Plakietka PODPISUJE wniosek, nie ogłasza go (0.249.0). W bursztynie
          i półgrubej ważyła więcej niż numer oferty obok, choć mówi tylko,
          skąd ten numer wiemy. Bursztyn zostaje przy wskazaniu człowieka —
          tam jest decyzją; wywód serwera z jedynej pozycji jest rutyną. */}
      {oferta.zrodlo === "reczne" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-podpis font-semibold text-amber-900">
        wskazana przez agenta</span>}
      {oferta.zrodlo === "zamowienie" && <span className="text-podpis text-slate-500">
        z jedynej pozycji zamówienia</span>}
      {innaCena && o && <span className="text-podpis text-slate-600" title={`stan oferty z ${czas(o.syncedAt)}`}>
        cena w ofercie <b className="tabular-nums text-slate-900">{zlote(o.cenaGrosze, o.waluta ?? "PLN")}</b></span>}
      {/* Wyjście do Allegro cichnie: to nawigacja, nie treść, a błękit ciągnął
          wzrok mocniej niż nazwa towaru. Kształt trzyma `odnosniki.tsx`. */}
      {oferta.link && <span className="ml-auto"><OdnosnikAllegro href={oferta.link} etykieta="Otwórz w Allegro" /></span>}
    </div>

    {/* Tytuł, SKU i zdjęcie stoją tu tylko wtedy, gdy karta zakupu ich nie
        pokazuje: oferta spoza zamówienia albo bez treści. Inaczej byłyby
        drugim domem tych samych faktów. */}
    {zTytulem && (o
      ? <div className="flex items-start gap-3">
          {/* Kafel tylko wtedy, gdy Allegro podało adres. Stan liczy SERWER —
              bez niego oferta bez obrazu pytałaby naszej trasy o 404 przy
              każdym otwarciu rozmowy. */}
          {o.zdjecie === "jest" && <KafelOferty externalId={oferta.externalId} rozmiar={56}
            nazwa={o.nazwa} symbol={o.sku} />}
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold">{o.nazwa}</span>
            {/* SKU sprzedawcy z `external.id` OFERTY — mostek do kartoteki dla
                pytania sprzed zakupu, gdzie zamówienia jeszcze nie ma. */}
            {o.sku && <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Tag size={11} />{o.sku}</span>}
            {o.cenaGrosze != null && <span className="ml-auto shrink-0 tabular-nums text-sm font-bold">
              {zlote(o.cenaGrosze, o.waluta ?? "PLN")}</span>}
            {/* PODPIS ŹRÓDŁA czyta tylko czytnik ekranu. Blok towaru niżej
                pokazuje zdjęcie z Subiekta, a §4.3 nie pozwala mieszać źródeł.
                Widać je i tak: kafel stoi pod nagłówkiem „Oferta", a zdjęcie
                Subiekta — pod „Subiekt GT". */}
            {o.zdjecie === "jest" && <span className="sr-only">
              Zdjęcie z oferty Allegro — to widział klient.</span>}
            {/* ── MILCZENIE WYGLĄDAŁO JAK BRAK ─────────────────────────────
                Starszy snapshot nie ma kolumny z adresem, więc zdjęcia nie ma —
                ale to znaczy „nie pytaliśmy", nie „Allegro nie ma obrazu". Bez
                tego zdania ekran kłamał: właściciel przysłał zrzut oferty,
                która na Allegro zdjęcie miała. Naprawia się samo, więc zdanie
                mówi KIEDY. */}
            {o.zdjecie === "nieznane" && <span className="w-full text-podpis text-slate-500">
              Zdjęcie oferty dociągnie najbliższa synchronizacja (do 7 min).</span>}
          </div>
        </div>
      : <p className="text-xs text-slate-500">
          Tytułu oferty jeszcze nie pobrano — dociągnie go najbliższa synchronizacja (do 7 min).
        </p>)}
    {oferta.zgodnosc && <PasujeDo z={oferta.zgodnosc} />}
  </section>;
}

/**
 * Lista „Pasuje do" z oferty (23 września 2026).
 *
 * Decyzja właściciela po zrzucie sekcji „Pasuje do kosiarek" z Allegro.
 * Listę mieliśmy od 0.253.0 i czytał ją wyłącznie model; agent szedł po nią
 * do Allegro. Tamto wyjście zabrania §25.
 *
 * ZWINIĘTA, BO BYWA NA DWIEŚCIE POZYCJI. Na wierzchu stoi jedna rzecz, która
 * rozstrzyga: czy maszyna z doboru jest na liście. Dopasowanie liczy serwer
 * tą samą funkcją, która pisze fakt szkicu — ekran i szkic nie mogą mówić
 * o dwóch różnych pozycjach.
 *
 * „NIE MA NA LIŚCIE" NIE JEST „NIE PASUJE". Lista to deklaracja sprzedawcy
 * i bywa niepełna; zdanie mówi to wprost, żeby nie przeszło do odpowiedzi.
 * Treść oferty dociąga układanie szkicu, więc bez niego bloku nie ma —
 * otwarcie rozmowy niczego nie pobiera.
 */
function PasujeDo({ z }: { z: ZgodnoscOferty }) {
  const [otwarta, setOtwarta] = useState(false);
  const trafienia = new Set(z.trafienia);
  return <div className="text-xs" aria-label="Pasuje do">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <button type="button" aria-expanded={otwarta} onClick={() => setOtwarta((o) => !o)}
        title="Lista zgodności z oferty Allegro — deklaracja sprzedawcy, nie pomiar"
        className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900">
        <ChevronRight size={12} aria-hidden="true" className={`transition-transform ${otwarta ? "rotate-90" : ""}`} />
        Pasuje do ({z.lista.length})</button>
      {z.maszyna && (z.trafienia.length > 0
        ? <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-900">
            <Check size={11} aria-hidden="true" />{z.maszyna} jest na liście
            {!z.wariantSprawdzony && <span className="font-normal"> · wariant niesprawdzony</span>}</span>
        : <span className="text-slate-600">
            {z.maszyna} — nie ma na liście; to nie dowód, że nie pasuje</span>)}
    </div>
    {otwarta && <ul className="mt-1.5 columns-2 gap-4">
      {z.lista.map((p, i) => <li key={`${p}-${i}`} className={`break-inside-avoid py-0.5 ${trafienia.has(p)
        ? "rounded bg-emerald-100 px-1 font-semibold text-emerald-900" : "text-slate-700"}`}>
        {p}{trafienia.has(p) && <span className="sr-only"> — maszyna klienta</span>}</li>)}
    </ul>}
  </div>;
}
