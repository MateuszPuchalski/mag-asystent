import React from "react";
import { ExternalLink, Package, Tag } from "lucide-react";
import type { OfertaRozmowy as Dane } from "../api/typy";
import { zlote } from "../api/zwroty";
import { KafelOferty } from "../towar/Kafel";
import { NaglowekSekcji } from "../ui";
import { ZnakAllegro } from "../ui/ZnakAllegro";

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
export function OfertaRozmowy({ oferta }: { oferta: Dane }) {
  const o = oferta.pobrana;
  return <section className="border-b bg-slate-50 px-4 py-3 text-sm" aria-label="Oferta">
    <div className="flex flex-wrap items-center gap-2">
      <NaglowekSekcji ikona={<Package size={13} />}>Oferta</NaglowekSekcji>
      <span className="font-mono text-podpis text-slate-500">{oferta.externalId}</span>
      {/* Status oferty stoi przy numerze, nie przy tytule: „zakończona” zmienia
          sens całej odpowiedzi, a agent czyta tę linijkę pierwszą. */}
      {o?.status && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-podpis font-bold text-slate-700">
        {o.status}</span>}
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
      {oferta.link && <a href={oferta.link} target="_blank" rel="noopener noreferrer"
        aria-label="Otwórz w Allegro"
        /* Odnośnik CICHNIE (0.249.0): był jedynym błękitem w kolumnie, więc
           ciągnął wzrok mocniej niż nazwa towaru — a to nawigacja, nie treść. */
        className="inline-flex items-center gap-1 text-podpis font-semibold text-slate-500 hover:text-slate-800">
        {/* Znak ZASTĘPUJE wyraz „Allegro" (0.252.0): to logotyp słowny, więc
            obok tego wyrazu byłby jego powtórzeniem. Dostępna nazwa odnośnika
            zostaje ta sama — niesie ją `aria-label` znaku. */}
        Otwórz w <ZnakAllegro wysokosc={10} /><ExternalLink size={11} /></a>}
    </div>

    {o
      ? <div className="mt-2 flex items-start gap-3 rounded bg-white px-2 py-1.5">
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
            {/* PODPIS ŹRÓDŁA. Blok towaru niżej pokazuje zdjęcie z Subiekta,
                a §4.3 nie pozwala mieszać źródeł — bez tej linijki dwa obrazy
                obok siebie wyglądałyby jak dwa ujęcia tej samej rzeczy. */}
            {o.zdjecie === "jest" && <span className="w-full text-podpis text-slate-500">
              Zdjęcie z oferty Allegro — to widział klient.</span>}
            {/* ── MILCZENIE WYGLĄDAŁO JAK BRAK (0.214.0) ────────────────────
                Snapshot sprzed 0.213.0 nie ma jeszcze kolumny z adresem, więc
                zdjęcia nie ma — ale to znaczy „nie pytaliśmy", nie „Allegro
                nie ma obrazu". Bez tego zdania ekran kłamał: właściciel
                przysłał zrzut oferty, która na Allegro zdjęcie miała.
                Naprawia się samo, więc zdanie mówi KIEDY. */}
            {o.zdjecie === "nieznane" && <span className="w-full text-podpis text-slate-500">
              Zdjęcie oferty dociągnie najbliższa synchronizacja (do 7 min).</span>}
          </div>
        </div>
      : <p className="mt-1 text-xs text-slate-500">
          Tytułu oferty jeszcze nie pobrano — dociągnie go najbliższa synchronizacja (do 7 min).
        </p>}
  </section>;
}
