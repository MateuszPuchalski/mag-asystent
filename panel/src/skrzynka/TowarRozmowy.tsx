import React, { useState } from "react";
import { Check, Database, PackageSearch, X as Krzyzyk } from "lucide-react";
import { EtykietaWartosci, NaglowekSekcji } from "../ui";
import type { KartaTowaru, OfertaRozmowy, PasowaniaTowaru } from "../api/typy";
import { useKartaTowaru, useWskazKartoteke } from "../api/rozmowy";
import { useWiedzaTowaru } from "../api/wiedza";
import { Wyszukiwarka, type Towar as TowarZWyszukiwarki } from "../wyszukiwarka";
import { Kafel } from "../towar/Kafel";

/**
 * Towar z Subiekta przy rozmowie (0.179.0).
 *
 * SKU sprzedawcy leżało w `offer_snapshot` od 0.178.0 i nie prowadziło
 * donikąd: żeby sprawdzić stan i półkę, agent otwierał Subiekta — czyli robił
 * to, czego §25 zabrania („agent obsłuży typowe pytanie bez otwierania panelu
 * Allegro" ma ten sam sens co „bez otwierania Subiekta").
 *
 * Blok ma trzy stany i każdy każe co innego zrobić: powiązana kartoteka
 * (widać stan i półkę), propozycja z automatu (jedno kliknięcie), brak
 * z POWODEM (wiadomo, które ogniwo pękło i czy naprawi się samo).
 *
 * ── JEDNO TRAFIENIE PO SYGNATURZE TO POWIĄZANIE (0.219.0) ──────────────────
 * Do 0.218.0 kartoteka z SKU była propozycją i czekała na „Zatwierdź", choć
 * ten sam wynik dobór brał za kandydata bez klikania, a zwroty wiązały go
 * same od 0.169.0. Właściciel zapytał, po co klikać, skoro sygnatura trafia
 * jeden do jednego — i zdecydował: łączyć automatycznie. Kliknięcie było
 * zapisem pamięci wskazań; patrzenie na stan i półkę niczego nie zapisuje,
 * więc nie ma za co brać opłaty w kliknięciach. Pamięć zostaje dla wskazań
 * ręcznych i obowiązuje, dopóki sprzedawca nie przepnie sygnatury
 * (`pamiecAktualna` na serwerze).
 *
 * ŹRÓDŁA SIĘ NIE MIESZAJĄ (§4.3). Wszystko pod nagłówkiem „Subiekt GT" jest
 * z Subiekta, a podpis przy kartotece mówi, czy stoi za nią SKU z Allegro,
 * czy decyzja człowieka.
 */
export function TowarRozmowy({ oferta, rozmowaId, onWstawDoSzkicu }: {
  oferta: OfertaRozmowy;
  rozmowaId: number;
  /** Wstawka do szkicu. Opcjonalna: blok bywa też oglądany bez edytora obok. */
  onWstawDoSzkicu?: (tresc: string) => void;
}) {
  const [szukam, setSzukam] = useState(false);
  const zapisz = useWskazKartoteke();
  const k = oferta.kartoteka;
  /* Powiązana: człowiek (pamięć wskazań) albo JEDNO trafienie po sygnaturze
     (0.219.0). Pozostałe stopnie pewności zostają propozycją z przyciskiem. */
  const potwierdzona = k.pewnosc === "pamiec" || k.pewnosc === "sku" ? k.twId : null;
  const karta = useKartaTowaru(potwierdzona);
  /* Wiedza pyta o KAŻDĄ znaną kartotekę, także propozycję: „3 potwierdzone,
     1 negatywne" to argument za kliknięciem albo przeciw niemu. */
  const wiedza = useWiedzaTowaru(k.twId);

  const ustaw = (twId: number | null) => zapisz.mutate(
    { id: rozmowaId, ofertaId: oferta.externalId, twId },
    { onSuccess: () => setSzukam(false) });

  return <div className="space-y-3 p-4">
    <div className="flex items-center gap-2">
      {/* Ten sam kształt, co „Oferta" i „Zamówienie" wyżej (0.249.0): trzy
          sekcje tej samej rangi miały trzy różne kształty, więc nie było jak
          odczytać, że stoją na jednym poziomie. Plakietka z obwódką ważyła
          przy tym więcej niż nazwa towaru pod nią. */}
      <NaglowekSekcji ikona={<Database size={13} />}>Subiekt GT</NaglowekSekcji>
      {/* OSOBNA plakietka, poza blokiem Subiekta: §4.3 nie miesza źródeł, a to
          jest nasza baza wiedzy, nie dane z ERP. */}
      {wiedza.data && (wiedza.data.potwierdzone.length > 0 || wiedza.data.negatywne.length > 0) &&
        <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
          Wiedza: {wiedza.data.potwierdzone.length} potwierdzonych · {wiedza.data.negatywne.length} negatywnych
        </span>}
    </div>

    {potwierdzona !== null
      ? <>
          <div className="flex items-start gap-3">
            <Kafel twId={potwierdzona} rozmiar={72} nazwa={karta.data?.name ?? k.symbol ?? ""}
              symbol={k.symbol} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{karta.data?.name ?? k.symbol}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-600">{k.symbol}</p>
              <p className="mt-1 text-xs text-slate-500">
                {/* Puste `sku` w pamięci znaczy „wskazał człowiek". Serwer pisze
                    to zdanie; panel go nie układa drugi raz. */}
                {k.zrodlo}
              </p>
            </div>
            {/* Zdjąć da się WSKAZANIE człowieka (kasuje pamięć). Powiązanie
                po sygnaturze nie ma czego zdjąć — wróciłoby przy następnym
                odczycie; tu właściwym ruchem jest wskazanie INNEJ kartoteki. */}
            {k.pewnosc === "pamiec" && <button type="button" title="Zdejmij powiązanie" disabled={zapisz.isPending}
              onClick={() => ustaw(null)}
              className="ml-auto h-6 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
              <Krzyzyk size={14} />
            </button>}
          </div>
          {k.pewnosc === "sku" && (szukam
            ? <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
                onWybierz={(t: TowarZWyszukiwarki | null) => t && ustaw(t.id)} />
            : <button type="button" onClick={() => setSzukam(true)}
                className="block text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
                wskaż inną kartotekę</button>)}

          {karta.isLoading && <p className="text-xs text-slate-500">Wczytuję stan z Subiekta…</p>}
          {karta.error && <p className="text-xs text-red-700">{(karta.error as Error).message}</p>}
          {karta.data && <>
            <StanTowaru karta={karta.data} />
            {/* WYŁĄCZNIE ODCZYT — blok jest „Źródło: Subiekt GT" (§4.3 nie miesza
                źródeł), a wiedza stoi tu jako osobna plakietka. Dopisuje się
                w Doborze (z pracy) albo w Wiedza → Sprawdź kartotekę. */}
            {wiedza.data?.pasowania && <PasowaniaKartoteki dane={wiedza.data.pasowania} />}
            <OpisKartoteki desc={karta.data.desc} />
            {/* Przycisk stoi POD tabelą, nie nad nią: agent najpierw sprawdza,
                czy to ta kartoteka, a dopiero potem przepisuje ją do odpowiedzi.
                Nad tabelą zapraszałby do wstawienia czegoś nieprzeczytanego. */}
            {onWstawDoSzkicu && <button type="button"
              onClick={() => onWstawDoSzkicu(parametryDoSzkicu(karta.data!))}
              className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
              Wstaw parametry do szkicu</button>}
          </>}
        </>
      : <div className="text-xs">
          {k.twId !== null
            /* Propozycja nie udaje faktu — mówi, skąd się wzięła, i czeka na
               zatwierdzenie (§4.3, §11.3).

               Zdjęcie przy PROPOZYCJI (0.203.0). Do 0.202.0 kafel dostawała
               wyłącznie kartoteka potwierdzona — czyli ta, przy której nikt
               już niczego nie rozstrzyga. Propozycja automatu jest dokładnie
               tym miejscem, gdzie człowiek decyduje, i decydował po samym
               symbolu: „FTC272" nie mówi, czy to podkładka, czy szarpak.
               Zdjęcie zamienia zatwierdzenie w spojrzenie. */
            ? <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-2">
                <Kafel twId={k.twId} rozmiar={56} nazwa={k.symbol ?? "Propozycja kartoteki"}
                  symbol={k.symbol} />
                <div className="min-w-0 flex-1 text-amber-900">
                  <p>Propozycja: <b className="font-mono text-sm">{k.symbol}</b></p>
                  <p className="mt-0.5 text-slate-500">{k.zrodlo}</p>
                  <button type="button" disabled={zapisz.isPending} onClick={() => ustaw(k.twId)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                    <Check size={12} />Zatwierdź</button>
                </div>
              </div>
            /* POWÓD, nie samo „bez kartoteki": „oferty jeszcze nie pobrano"
               naprawi się samo w kilka minut, a „oferta bez SKU" nigdy. */
            : <p className="flex items-start gap-2 text-slate-500">
                <PackageSearch size={14} className="mt-0.5 shrink-0" />
                <span>Bez kartoteki · <span className="text-slate-600">{k.zrodlo}</span></span>
              </p>}

          {szukam
            ? <div className="mt-2">
                <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
                  onWybierz={(t: TowarZWyszukiwarki | null) => t && ustaw(t.id)} />
              </div>
            : <button type="button" onClick={() => setSzukam(true)}
                className="mt-2 block text-slate-500 underline underline-offset-2 hover:text-slate-800">
                wskaż kartotekę</button>}
        </div>}

    {zapisz.error && <p className="text-xs text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
}

/**
 * Stan magazynowy. „Dostępny" stoi OSOBNO od stanu, bo to on odpowiada na
 * pytanie klienta — stan bez odjętych rezerwacji obiecuje towar, który jest
 * już czyjś.
 */
/**
 * Parametry towaru jako tekst do szkicu (§10.4, makieta `Main.dc.html`).
 *
 * SZKIC IDZIE DO KLIENTA i to jest cała trudność tej funkcji. Blok Subiekta
 * pokazuje na ekranie sześć wierszy, ale trzy z nich są WEWNĘTRZNE: półka,
 * rezerwacje i rozbicie na magazyny. Adres regału w odpowiedzi do kupującego
 * nie znaczy dla niego nic, a mówi obcemu, jak zbudowany jest nasz magazyn.
 * Wstawka bierze więc tożsamość towaru i dostępność — czyli to, po co klient
 * napisał — i ani jednego pola więcej.
 *
 * Zdanie układa PANEL, nie serwer, i to jest różnica względem doboru (§14.3):
 * tam zdanie niesie TWIERDZENIE o pasowaniu i musi cytować dowód, więc pisze
 * je serwer. Tu nie ma twierdzenia — są wartości pól kartoteki, przepisane
 * jeden do jednego z tego, co agent ma przed oczami.
 *
 * Brak stanu mówi „brak na stanie", nie „0 szt.". Zero w tabeli czyta agent,
 * a zdanie czyta klient — i „0 szt." brzmi jak awaria systemu, nie jak
 * odpowiedź. Terminu dostawy wstawka NIE obiecuje, bo go nie zna.
 */
export function parametryDoSzkicu(karta: KartaTowaru): string {
  const jednostka = karta.unit ?? "szt.";
  const linie = [`${karta.name} (symbol ${karta.sym})`];
  if (karta.ean) linie.push(`EAN: ${karta.ean}`);
  const numery = (karta.identyfikatory ?? []).map((i) => i.wartosc);
  if (numery.length > 0) linie.push(`Numery: ${numery.join(", ")}`);
  linie.push(karta.mag.avail > 0
    ? `Dostępność: ${karta.mag.avail} ${jednostka}`
    : "Dostępność: brak na stanie");
  return linie.join("\n");
}

/**
 * Opis kartoteki z Subiekta (0.198.0).
 *
 * Pole `desc` jechało w odpowiedzi `/api/products/:twId` od dawna i panel NIE
 * pokazywał go nigdzie. A to w nim ta firma trzyma wymiary, gwinty, rozstawy
 * i sekcje „Modele:" — czyli odpowiedzi na pytania, które klienci zadają
 * najczęściej. Właściciel przysłał zrzut, na którym klient prosi o wymiar
 * gwintu korka; opis kartoteki stał wtedy w pobranych danych, niewidoczny.
 *
 * ZWINIĘTY DO SZEŚCIU LINII, bo opisy bywają na pół ekranu, a kolumna niesie
 * też stan i półkę. Rozwinięcie jest jednym kliknięciem i nie idzie po sieć.
 *
 * BEZ PRZYCISKU „wstaw do szkicu" i to jest decyzja. Wstawka parametrów
 * (`parametryDoSzkicu`) wybiera pola świadomie, bo szkic idzie DO KLIENTA;
 * opis to wolny tekst, w którym bywa notatka dla magazynu. Agent może
 * skopiować zdanie, które przeczytał — ale nie wyśle całości jednym kliknięciem,
 * nie wiedząc, co w niej stoi.
 */
function OpisKartoteki({ desc }: { desc?: string }) {
  const [calosc, setCalosc] = useState(false);
  const tresc = (desc ?? "").trim();
  if (!tresc) return null;

  return <div className="rounded-lg border border-slate-200 p-3">
    <NaglowekSekcji jako="p" className="mb-1">Opis kartoteki</NaglowekSekcji>
    <p className={`whitespace-pre-wrap text-xs text-slate-700 ${calosc ? "" : "line-clamp-6"}`}>
      {tresc}</p>
    {/* Przycisk tylko wtedy, gdy jest co rozwijać. Linii nie liczymy w kodzie
        — `line-clamp` robi to w przeglądarce. Sześć, a nie osiem, bo domyślna
        skala Tailwinda kończy się na sześciu, a `line-clamp-8` nie powstałoby
        w arkuszu i opis jechałby CAŁY. */}
    {tresc.length > 320 && <button type="button" onClick={() => setCalosc((c) => !c)}
      className="mt-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
      {calosc ? "zwiń opis" : "pokaż cały opis"}</button>}
  </div>;
}

function StanTowaru({ karta }: { karta: KartaTowaru }) {
  /* Stan, rezerwacje, dostępny i lokalizacja wyszły z tej listy do nagłówka
     bloku — zostają fakty do WYSZUKANIA, nie do decyzji. */
  const pozostale: Array<[string, string]> = [
    ["EAN", karta.ean || "brak"],
    /* Identyfikatory z opisu (E3): to, po czym klient pyta, gdy nie zna naszego symbolu. */
    ["Identyfikatory", karta.identyfikatory?.length ? karta.identyfikatory.map((i) => i.wartosc).join(" · ") : "brak"],
    /* Zamienniki JEDZIŁY w JSON-ie od dawna i rysował je tylko kolektor. Bez
       nich agent widzi kandydata „przez zamiennik EX055" i nie ma jak
       sprawdzić, skąd ten EX055. Obce tylko jako licznik — to szary tekst dla
       rozmowy z dostawcą, nie klikalna lista. */
    ["Zamienniki", karta.zamienniki?.znane.length
      ? karta.zamienniki.znane.map((z) => z.sym).join(" · ")
        + (karta.zamienniki.obce.length ? ` (+${karta.zamienniki.obce.length} numery obce w opisie)` : "")
      : karta.zamienniki?.obce.length ? `brak naszych; ${karta.zamienniki.obce.length} numery obce w opisie` : "brak"],
  ];
  /* ── ODPOWIEDŹ WYCHODZI PRZED DANE (0.249.0) ────────────────────────────────
     Osiem wierszy stało w jednej wadze 12 px, a dwa z nich są odpowiedzią na
     pytanie, po które agent w ogóle otwiera tę kolumnę: CZY MAMY i GDZIE.
     „Identyfikatory brak" ważyło tyle samo co „Dostępny 1 szt." — a jedno jest
     decyzją, drugie zapasową ścieżką wyszukiwania.

     `Dostępny` staje się liczbą, którą widać z drugiego końca biurka, bo to
     ona rozstrzyga, czy odpowiedź brzmi „wysyłamy dziś". Lokalizacja stoi
     obok, bo pytanie „gdzie" pada zaraz po „czy". `Stan` i `Rezerwacje`
     schodzą pod spód drobnym drukiem: one tę liczbę TŁUMACZĄ, nie zastępują.

     Reszta zostaje w całości — §4.3 nie pozwala chować faktów — ale wartości
     „brak" gasną. Brak identyfikatorów jest normą, a norma nie ma prawa
     wyglądać jak ustalenie. */
  const jednostka = karta.unit ?? "szt.";
  const brakStanu = karta.mag.avail <= 0;
  const lokalizacje = karta.locs.length ? karta.locs.join(" · ") : null;

  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
      <div>
        <EtykietaWartosci className="block">Dostępny</EtykietaWartosci>
        <div className={`flex items-baseline gap-1 tabular-nums ${
          brakStanu ? "text-ranga-zle" : "text-slate-900"}`}>
          <span className="text-2xl font-bold leading-none">{karta.mag.avail}</span>
          <span className="text-xs font-semibold">{jednostka}</span>
        </div>
      </div>
      {/* Lokalizacja jako plakietka, nie wiersz tabeli: to jedyna wartość z tej
          grupy, którą ktoś przepisuje na kartkę i niesie na halę. */}
      {lokalizacje
        ? <span className="rounded bg-white px-2 py-1 font-mono text-xs font-semibold text-slate-800 shadow-sm">
            {lokalizacje}</span>
        : <span className="text-xs text-slate-500">bez lokalizacji</span>}
      <span className="ml-auto text-[11px] text-slate-500">
        stan {karta.mag.stan} · rezerwacje {karta.mag.rez}
      </span>
    </div>

    <div className="mt-2.5 space-y-1 border-t border-slate-200 pt-2.5">
      {pozostale.map(([nazwa, wartosc]) => <div key={nazwa} className="flex items-baseline gap-2 text-xs">
        <span className="w-24 shrink-0 text-slate-500">{nazwa}</span>
        <span className={wartosc === "brak" ? "text-slate-500" : "font-semibold text-slate-900"}>
          {wartosc}</span>
      </div>)}
      {karta.magazyny.length > 0 && <p className="pt-0.5 text-[11px] text-slate-500">
        Inne magazyny: {karta.magazyny.map((m) => `${m.kod} ${m.stan}`).join(" · ")}
      </p>}
    </div>
  </div>;
}

/**
 * Pasowania część↔część przy kartotece (§11.2): przy gaźniku „Pasujące do
 * niego", przy uszczelce „Pasuje do". Przechodnie przez zamiennik z dopiskiem
 * (nigdy „potwierdzone"), negatywy na czerwono. Pusty blok nie renderuje się
 * wcale — brak wiedzy to nie informacja, którą warto zajmować kolumnę.
 */
function PasowaniaKartoteki({ dane }: { dane: PasowaniaTowaru }) {
  if (dane.pasujeDo.length + dane.pasujace.length + dane.negatywne.length === 0) return null;
  const wiersz = (t: { czesc: { symbol: string; nazwa: string }; doCzego: { symbol: string; nazwa: string };
    pasowanie: { nazwaRoli: string; pozycja: string | null }; pewnosc: string; przezZamiennik: string | null; zdanie: string },
    strona: "czesc" | "doCzego") =>
    <li key={`${t.czesc.symbol}>${t.doCzego.symbol}`} className="text-xs">
      <b className="font-mono">{t[strona].symbol}</b> <span className="text-slate-600">{t[strona].nazwa}</span>
      <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px]">{t.pasowanie.nazwaRoli}{t.pasowanie.pozycja ? ` · ${t.pasowanie.pozycja}` : ""}</span>
      <span className={`ml-1 rounded px-1 py-0.5 text-[10px] font-bold ${t.pewnosc === "potwierdzone"
        ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{t.pewnosc}</span>
      {t.przezZamiennik && <span className="ml-1 text-[10px] text-slate-500">przez zamiennik</span>}
      <p className="text-[11px] text-slate-500">{t.zdanie}</p>
    </li>;
  return <div className="rounded-lg border border-emerald-200 p-3">
    <NaglowekSekcji jako="p" ton="text-emerald-800" className="mb-1">Wiedza: pasowania części</NaglowekSekcji>
    {dane.pasujace.length > 0 && <>
      <p className="text-[11px] font-semibold text-slate-600">Do tej części pasują</p>
      <ul className="mb-1 space-y-1">{dane.pasujace.map((t) => wiersz(t, "czesc"))}</ul></>}
    {dane.pasujeDo.length > 0 && <>
      <p className="text-[11px] font-semibold text-slate-600">Ta część pasuje do</p>
      <ul className="mb-1 space-y-1">{dane.pasujeDo.map((t) => wiersz(t, "doCzego"))}</ul></>}
    {dane.negatywne.length > 0 && <ul className="space-y-1">
      {dane.negatywne.map((p) => <li key={p.id} className="text-xs text-red-900">
        <b className="font-mono">{p.czesc.symbol}</b> ⇏ <b className="font-mono">{p.doCzego.symbol}</b>: {p.zdaniePowodu}
        <span className="block text-[11px] text-slate-500">{p.zdanieZrodla}</span></li>)}
    </ul>}
  </div>;
}
