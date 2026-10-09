import React from "react";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";
import { zlote } from "../api/zwroty";
import { useKartaTowaru } from "../api/rozmowy";
import { CenyKartoteki } from "../skrzynka/OsCenKartoteki";
import { STATUS_PACZKI } from "../skrzynka/statusy";
import { PRZEWOZNICY } from "../zwroty/Dowody";
import { ZdjecieOferty } from "../towar/Zdjecie";
import { PrzyciskTowaru } from "../towar/Szuflada";
import { czas, dataCyfrowa, dniSlowo, kiedy, Skopiuj } from "../ui";
import { OCZEKIWANIA, POWODY } from "./Kolejka";
import { PRAWO } from "./statusy";
import { ileReklamacji } from "./etap";

/* ── Produkt i zamówienie: o co jest spór ────────────────────────────────────
   Jedna karta, dwie sekcje. Produkt odpowiada na „co to jest, czy mamy i ile
   kosztuje”, zamówienie na „kiedy kupił, ile zapłacił i czy to dostał”.
   Stoi pod decyzją, bo z tych faktów decyzję się wydaje.

   Wszystko tu jest ODCZYTEM. Jedynym zapisem jest pytanie o paczkę, i to
   jawnym kliknięciem, nie skutkiem ubocznym patrzenia.

   BRAK WIEDZY MILCZY ALBO MÓWI SŁOWEM, nigdy zerem. Wiersz stanu bez karty
   Subiekta nie staje wcale, bo „0 szt.” przy braku karty to kłamstwo, a nie
   ostrożność (`panel/CLAUDE.md`).

   BEZ COPILOTA I BEZ „ZLEĆ HALI”. Decyzja właściciela przy przebudowie ekranu:
   nic tu nie woła modelu ani nie zleca pracy hali. Strażnik:
   `BezCopilota.test.tsx`. */

/* ── JEDNA KARTOTEKA NA CAŁĄ SPRAWĘ ──────────────────────────────────────────
   Symbol, stan, półka i cennik pytają o TĘ SAMĄ rzecz: która to kartoteka
   u nas. Każdy element pyta tej funkcji, bo osobne pytania się rozjeżdżają.

   KOLEJNOŚĆ ZA SERWEREM: najpierw `r.twId`, który niesie paragon albo
   wskazanie człowieka, potem `kartotekaOferty`. Z niej bierzemy wyłącznie
   POWIĄZANIE, czyli `sku` i `pamiec`. Symbol zdublowany przychodzi bez
   `twId` i zostaje brakiem, bo dwie kartoteki pod jednym symbolem
   rozstrzyga człowiek. */
export type ZrodloKartoteki = "paragon" | "mapowanie" | "sku";

export interface KartotekaSprawy {
  twId: number | null;
  symbol: string | null;
  zrodlo: ZrodloKartoteki | null;
}

export const NAPIS_ZRODLA: Record<ZrodloKartoteki, string> = {
  paragon: "z paragonu",
  mapowanie: "z mapowania oferty",
  sku: "z SKU oferty",
};

export function kartotekaSprawy(szczegol: Pick<SzczegolReklamacji, "reklamacja" | "kartoteka">): KartotekaSprawy {
  const r = szczegol.reklamacja;
  if (r.twId !== null) {
    return { twId: r.twId, symbol: r.twSymbol, zrodlo: r.twZParagonu ? "paragon" : "mapowanie" };
  }
  const k = szczegol.kartoteka;
  if (k && k.twId !== null && (k.pewnosc === "sku" || k.pewnosc === "pamiec")) {
    return { twId: k.twId, symbol: k.symbol, zrodlo: k.pewnosc === "sku" ? "sku" : "mapowanie" };
  }
  return { twId: null, symbol: null, zrodlo: null };
}

/** Formy płatności po polsku; nieznana zostaje surowa, bo Allegro nie zamyka listy. */
const PLATNOSCI: Record<string, string> = {
  ONLINE: "online", CASH_ON_DELIVERY: "za pobraniem", WIRE_TRANSFER: "przelew",
  SPLIT_PAYMENT: "podzielona", EXTENDED_TERM: "odroczona",
};

/** Wielka litera na początku pozycji listy — słownik trzyma słowa małymi. */
const zWielkiej = (t: string) => t.charAt(0).toLocaleUpperCase("pl") + t.slice(1);

/**
 * Po ilu pełnych dniach od zakupu klient zgłosił sprawę.
 *
 * Serwer liczy to sam; starszy go nie zna, więc wtedy liczymy z jego dwóch
 * dat. Obie są z serwera, więc zegar przeglądarki w tym nie bierze udziału.
 */
function zgloszonoPoDniach(r: Reklamacja): number | null {
  if (r.zgloszonoPoDniach !== undefined) return r.zgloszonoPoDniach;
  if (!r.kupionoAt || !r.otwartoAt) return null;
  const dni = Math.floor((Date.parse(r.otwartoAt) - Date.parse(r.kupionoAt)) / 86_400_000);
  return Number.isFinite(dni) && dni >= 0 ? dni : null;
}

/**
 * Stan paczki jednym zdaniem — to jest odpowiedź, którą widać bez otwierania.
 *
 * Trzy różne braki mówią trzy różne zdania, bo każdy każe co innego zrobić:
 * „nie pytaliśmy”, „Allegro nie ma numeru” i „przewoźnik milczy”.
 */
function stanPaczki(p: NonNullable<SzczegolReklamacji["przesylka"]>): string {
  if (p.dostarczonoAt && p.waybill !== null) return `doręczona ${dataCyfrowa(p.dostarczonoAt)}`;
  if (p.sprawdzonoAt === null) return "nie pytaliśmy jeszcze Allegro";
  if (p.waybill === null) return "Allegro nie ma numeru przesyłki";
  if (p.status === null) return "przewoźnik nie podał statusu";
  return STATUS_PACZKI[p.status] ?? `przewoźnik podał: ${p.status}`;
}

const Wiersz = ({ nazwa, children }: { nazwa: string; children: React.ReactNode }) => <>
  <dt className="text-slate-600">{nazwa}</dt>
  <dd className="m-0 min-w-0 break-words">{children}</dd>
</>;

/** Wejście do Allegro z ikoną strzałki; bez adresu nie ma martwego łącza. */
const DoAllegro = ({ href, nazwa, children }: { href: string | null; nazwa: string; children: React.ReactNode }) =>
  href
    ? <a href={href} target="_blank" rel="noopener noreferrer" title={nazwa}
        className="min-w-0 truncate text-sm font-semibold text-sky-700 underline-offset-2 hover:underline">
        {children} →<span className="sr-only"> ({nazwa}, otwiera się w Allegro)</span></a>
    : null;

export function Produkt({ szczegol, onSprawdzPrzesylke, sprawdzaPrzesylke = false, bladPrzesylki = "" }: {
  szczegol: SzczegolReklamacji;
  /* Pytanie o paczkę jest opcjonalne: czego nie da się zrobić, tego nie ma
     na ekranie. */
  onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean;
  bladPrzesylki?: string;
}) {
  const r = szczegol.reklamacja;
  const towar = kartotekaSprawy(szczegol);
  /* Ten sam hak, co w skrzynce — TanStack trzyma kartę pod jednym kluczem,
     więc otwarcie sprawy nie pyta serwera drugi raz o tę samą kartotekę. */
  const karta = useKartaTowaru(towar.twId);
  const k = karta.data;
  /* POZIOM 0 TO CENA ZAKUPU, nie cennik sprzedaży: kolumny `tw_Cena` liczą
     się od zera, a nazwy od jedynki. Na osi stoją wyłącznie ceny sprzedaży. */
  const sprzedaz = (k?.ceny ?? []).filter((c) => c.poziom !== 0);
  const oferta = r.ofertaCenaGrosze != null ? { grosze: r.ofertaCenaGrosze, waluta: r.waluta } : null;
  const zakup = r.cenaParagonuGrosze != null ? { grosze: r.cenaParagonuGrosze, waluta: r.waluta } : null;
  const chce = r.oczekiwanie ? (OCZEKIWANIA[r.oczekiwanie] ?? r.oczekiwanie) : null;
  const powod = r.powodTyp ? (POWODY[r.powodTyp] ?? r.powodTyp) : null;
  const prawo = r.prawo ? (PRAWO[r.prawo] ?? r.prawo) : null;
  const historiaTowaru = szczegol.historia?.towar ?? null;
  const z = szczegol.zamowienie;
  const p = szczegol.przesylka;
  const poDniach = zgloszonoPoDniach(r);

  return <section aria-label="Produkt i zamówienie" className="card flex flex-col">
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-naglowek font-bold text-slate-900">Produkt</h2>
        <DoAllegro href={r.linkOferty} nazwa="oferta w Allegro">Oferta</DoAllegro>
      </div>
      <div className="flex gap-3">
        <ZdjecieOferty externalId={r.offerId} stan={r.ofertaZdjecie} rozmiar={72}
          nazwa={r.ofertaNazwa ?? "Zdjęcie oferty"} />
        <div className="flex min-w-0 flex-col gap-0.5">
          {r.ofertaNazwa
            ? <span className="font-semibold text-slate-900">{r.ofertaNazwa}</span>
            : <span className="text-slate-600">Oferty nie pobrano</span>}
          <span className="text-sm text-slate-600">
            {/* SYGNATURA MÓWI, SKĄD JEST: z paragonu albo z dzisiejszego
                mapowania oferty to dwie różne rzeczy po przepięciu dostawy. */}
            {towar.symbol
              ? <PrzyciskTowaru twId={towar.twId}>
                  <span title={towar.zrodlo ? `Symbol ${NAPIS_ZRODLA[towar.zrodlo]}` : undefined}
                    className="font-mono text-slate-800">{towar.symbol}</span></PrzyciskTowaru>
              /* Przy braku stoi ZDANIE serwera, nie kod powodu. */
              : <span>{szczegol.kartoteka?.zrodlo ?? "bez kartoteki"}</span>}
            {" · "}{r.ilosc ?? 1} szt.
          </span>
          {/* Wiersz stoi wyłącznie przy karcie z Subiekta: bez niej nie wiemy,
              a „nie wiemy” przy każdej sprawie bez kartoteki to szum. */}
          {k && <span className="text-sm text-slate-600">
            W Subiekcie: <b className={k.mag.avail > 0 ? "text-ranga-ok" : "text-ranga-zle"}>
              {k.mag.avail > 0 ? `${k.mag.avail} ${k.unit || "szt."}` : "brak na stanie"}</b>
            {k.locs.length > 0 && <> · półka {k.locs.join(", ")}</>}
          </span>}
        </div>
      </div>
      {/* Ceny służą do triażu, więc stoją bez klikania. Pusty cennik nie
          rysuje ramki: brak danych nie jest informacją wartą miejsca. */}
      {sprzedaz.length > 0 && <div className="rounded-lg bg-wertis-paper px-3 pb-2 pt-2.5">
        <p className="text-xs font-bold text-slate-700">Ceny tego towaru w Subiekcie</p>
        <CenyKartoteki ceny={sprzedaz} ramka={false} oferta={oferta} zakup={zakup} />
      </div>}
      <dl className="m-0 grid grid-cols-[6.25rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <Wiersz nazwa="Chce">
          <b className="font-semibold text-slate-900">{chce ? zWielkiej(chce) : "Nie podał"}</b>
          {r.oczekiwanaKwotaGrosze !== null &&
            <span className="tabular-nums"> · {zlote(r.oczekiwanaKwotaGrosze, r.waluta)}</span>}
        </Wiersz>
        <Wiersz nazwa="Podstawa">
          {[prawo ? zWielkiej(prawo) : "Tytuł nieznany", powod].filter(Boolean).join(" · ")}
        </Wiersz>
        {/* Pierwsza sprawa przy tym towarze nie jest informacją o towarze,
            więc wiersz staje dopiero przy historii. */}
        {historiaTowaru && <Wiersz nazwa="Ten towar">{ileReklamacji(historiaTowaru)}</Wiersz>}
      </dl>
    </div>

    <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-naglowek font-bold text-slate-900">Zamówienie</h2>
        {r.orderId && <span className="flex min-w-0 items-center gap-1">
          {r.linkZamowienia
            ? <DoAllegro href={r.linkZamowienia} nazwa="zamówienie w Allegro">
                <span className="font-mono">{r.orderId}</span></DoAllegro>
            : <span className="min-w-0 truncate font-mono text-sm text-slate-700">{r.orderId}</span>}
          <Skopiuj tekst={r.orderId} tytul="Kopiuj numer zamówienia" />
        </span>}
      </div>
      <dl className="m-0 grid grid-cols-[6.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <Wiersz nazwa="Kupiono">
          {r.kupionoAt
            ? <>{dataCyfrowa(r.kupionoAt)}{poDniach !== null &&
                <> · {poDniach === 0 ? "w dniu zgłoszenia" : `${dniSlowo(poDniach)} przed zgłoszeniem`}</>}</>
            : "nie wiemy"}
        </Wiersz>
        <Wiersz nazwa="Płatność">
          {/* Kwota z zamówienia, nie z żądania: żądanie stoi przy „Chce”. */}
          {z
            ? <>
                <b className={`font-semibold ${z.platnoscAt ? "text-ranga-ok" : "text-slate-900"}`}>
                  {z.platnoscAt ? "Opłacono " : ""}{z.sumaGrosze !== null ? zlote(z.sumaGrosze, z.waluta) : "kwota nieznana"}</b>
                {[z.platnoscTyp ? (PLATNOSCI[z.platnoscTyp] ?? z.platnoscTyp) : null,
                  z.platnoscAt ? dataCyfrowa(z.platnoscAt) : null].filter(Boolean).map((t) => ` · ${t}`).join("")}
              </>
            : "zamówienia jeszcze nie pobraliśmy"}
        </Wiersz>
        <Wiersz nazwa="Przesyłka">
          {p
            ? <span className="flex flex-col gap-0.5">
                <span>{stanPaczki(p)}
                  {p.waybill !== null && p.przewoznik && <> · {PRZEWOZNICY[p.przewoznik] ?? p.przewoznik}</>}</span>
                {/* Numer listu mono, bo czyta się go znak po znaku z naklejki. */}
                {p.waybill !== null && <span className="flex items-center gap-1 text-xs">
                  <span className="min-w-0 break-all font-mono text-slate-800">{p.waybill}</span>
                  <Skopiuj tekst={p.waybill} tytul="Kopiuj numer przesyłki" />
                </span>}
                <span className="text-xs text-slate-600"
                  title={p.sprawdzonoAt ? `Pytaliśmy Allegro ${czas(p.sprawdzonoAt)}` : undefined}>
                  {p.sprawdzonoAt ? `sprawdzone ${kiedy(p.sprawdzonoAt)}` : null}
                  {onSprawdzPrzesylke && <>{p.sprawdzonoAt ? " · " : ""}
                    <button type="button" disabled={sprawdzaPrzesylke} onClick={onSprawdzPrzesylke}
                      className="min-h-6 font-semibold text-slate-700 underline underline-offset-2 disabled:opacity-50">
                      {sprawdzaPrzesylke ? "pytam…" : p.sprawdzonoAt ? "sprawdź jeszcze raz" : "sprawdź"}</button>
                  </>}
                </span>
                {bladPrzesylki && <span className="text-xs text-ranga-zle">{bladPrzesylki}</span>}
              </span>
            /* Bez zamówienia nie ma przesyłki, o którą można zapytać. */
            : "bez danych o przesyłce"}
        </Wiersz>
      </dl>
    </div>
  </section>;
}
