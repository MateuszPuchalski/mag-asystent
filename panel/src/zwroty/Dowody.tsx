import React, { useEffect, useState } from "react";
import {
  CalendarClock, CalendarDays, CreditCard, History, MessageSquare, NotebookPen, Package, Receipt,
  RefreshCw, Scale, ShoppingCart, Truck, Undo2, UserCheck, Wallet,
} from "lucide-react";
import type { Tag } from "../api/typy";
import type { KandydatFaktury, PozycjaZwrotu, PrzystanekDrogi, SprawaZakupu, WpisOsiZwrotu, Zwrot }
  from "../api/typy";
import { Os } from "./Os";
import { Dokument, ikonaDokumentu } from "./Dokument";
import { useDociagnijZamowienia, zlote } from "../api/zwroty";
import { czas, NaglowekSekcji, Plakietka, Przycisk, Skopiuj } from "../ui";
import { Link } from "./Link";
import { ZnakAllegro } from "../ui/ZnakAllegro";
import { KafelOferty } from "../towar/Kafel";
import { DrogaZakupu, SprawyZakupu } from "../sprawy/Spoiwo";
import { Link as RouterLink } from "react-router-dom";

/* Kolumna dowodów: wszystko, co trzeba przeczytać, ZANIM padnie decyzja.
   Akcji tu nie ma — te stoją w pasku werdyktu i mają być jedynym miejscem,
   gdzie coś się dzieje. Wyjątkiem są odnośniki: one nie zmieniają niczego
   u nas, tylko skracają drogę do Allegro, gdy naprawdę trzeba tam wejść.

   Od 0.167.0 to kolumna o ZWROCIE, nie o towarze: zegar ustawowy, numery,
   zamówienie klienta, fakt powrotu paczki. Produkty przeniosły się do
   głównego okna (`Pozycje.tsx`), bo 340 px ucinało im nazwy w połowie. */

/* Przewoźnicy i formy płatności po polsku. Kod nieznany pokazuje się SUROWY,
   bo Allegro nie publikuje zamkniętej listy przewoźników — sonda złapała
   `UNKNOWN`, którego nie ma w żadnej specyfikacji. */
const PRZEWOZNICY: Record<string, string> = {
  INPOST: "InPost", DPD: "DPD", ALLEGRO: "Allegro", POCZTA_POLSKA: "Poczta Polska",
  DHL: "DHL", UPS: "UPS", GLS: "GLS", FEDEX: "FedEx", UNKNOWN: "nieznany",
};

const PLATNOSCI: Record<string, string> = {
  ONLINE: "online", CASH_ON_DELIVERY: "za pobraniem", WIRE_TRANSFER: "przelew",
  SPLIT_PAYMENT: "podzielona", EXTENDED_TERM: "odroczona",
};

/* Statusy przesyłki z `/order/carriers/{id}/tracking` (0.187.0). Osiem kodów
   wymienia specyfikacja; nieznany pokazuje się SUROWY, jak przewoźnik. */
const PRZESYLKA: Record<string, string> = {
  PENDING: "Przygotowana, czeka na nadanie.",
  IN_TRANSIT: "W drodze do nas.",
  RELEASED_FOR_DELIVERY: "Wydana do doręczenia.",
  AVAILABLE_FOR_PICKUP: "Czeka do odbioru.",
  NOTICE_LEFT: "Awizo — próba doręczenia nie powiodła się.",
  ISSUE: "Problem z przesyłką.",
  RETURNED: "Wraca do nadawcy.",
};

const ODRZUCENIA: Record<string, string> = {
  REFUND_REJECTED: "odmowa zwrotu pieniędzy",
  NEW_ITEM_SENT: "wysłano nowy towar",
  ITEM_FIXED: "towar naprawiono",
  MISSING_PART_SENT: "dosłano brakującą część",
};

/** Stan kosza słowem — te same słowa co pasek kroków na ekranie koszy. */
const STAN_KOSZA: Record<string, string> = {
  otwarty: "otwarty — zbiera towar", zamkniety: "na hali", rozlozony: "rozłożony", anulowany: "anulowany",
};

const Sekcja = ({ ikona, tytul, children }: {
  ikona: React.ReactNode; tytul: string; children: React.ReactNode;
}) => <section className="border-b border-slate-200 p-4 last:border-0">
  <NaglowekSekcji jako="h3" ikona={ikona} className="mb-2">{tytul}</NaglowekSekcji>
  {children}
</section>;

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
    {/* LICZBY, nie samo „gotowe" (0.220.0). Zero pobranych zamówień przy
        dwunastu powiązanych kartotekach znaczy „zamówienia były, brakowało
        wiązania" — a to jest odpowiedź na pytanie, z którym się tu klika. */}
    {dociagnij.isSuccess && <p className="mt-1 text-xs text-slate-500">
      Pobrano zamówień: {dociagnij.data?.pobrano ?? 0} · powiązano kartotek:{" "}
      {dociagnij.data?.kartoteki ?? 0}.</p>}
  </div>;
}

/**
 * Notatka biura — nasze ustalenia, których Allegro nie zna.
 *
 * STOI W TEJ SAMEJ KOLUMNIE CO PRZY REKLAMACJI (0.280.0) i to jest cała
 * decyzja o miejscu: dwa ekrany obsługi mają mieć jeden nawyk, nie dwa.
 *
 * Zapis JAWNYM przyciskiem, nie przy każdym znaku: notatka pisze się zdaniami,
 * a zapis po każdej literze podnosiłby wersję zwrotu i wywracał kontrolę
 * świeżości u kolegi przy drugim biurku.
 */
function Notatka({ zwrot, trwa, blad, onZapisz, onCofnij }: {
  zwrot: Zwrot;
  trwa: boolean;
  blad: string;
  onZapisz: (tekst: string) => void;
  /* Cofnięcie jest OPCJONALNE tym samym wzorcem co reszta: czego nie da się
     zrobić, tego nie ma na ekranie. */
  onCofnij?: () => void;
}) {
  const [tekst, setTekst] = useState(zwrot.notatka ?? "");
  /* Przełączenie zwrotu podmienia treść pola. Bez tego notatka poprzedniej
     sprawy zostawałaby w edytorze i dało się ją zapisać na cudzym zwrocie. */
  useEffect(() => { setTekst(zwrot.notatka ?? ""); }, [zwrot.id, zwrot.notatka]);
  const zmienione = tekst.trim() !== (zwrot.notatka ?? "").trim();
  return <div className="flex flex-col gap-2">
    <label className="sr-only" htmlFor="notatka-zwrotu">Notatka biura</label>
    <textarea id="notatka-zwrotu" rows={3} value={tekst}
      onChange={(e) => setTekst(e.target.value)}
      placeholder="Ustalenia, których Allegro nie zna"
      className="field resize-y text-sm" />
    {blad && <p className="text-xs text-red-700">{blad}</p>}
    <Przycisk wariant="glowny" disabled={!zmienione || trwa}
      onClick={() => onZapisz(tekst)}>
      {trwa ? "Zapisuję…" : "Zapisz notatkę"}
    </Przycisk>
    {/* Autor i godzina stoją TU, a nie w osobnej sekcji: pytanie „kto to
        napisał" zadaje się patrząc na notatkę. Cofnięcie jest ZDANIEM, nie
        ramką z decyzją — §25a.5. */}
    {zwrot.notatkaPrzez && <p className="text-podpis text-slate-600">
      Zmiana: {zwrot.notatkaPrzez}, {czas(zwrot.notatkaAt)}
      {onCofnij && zwrot.maPoprzedniaNotatke && <>
        {" · "}
        <button type="button" disabled={trwa} onClick={onCofnij}
          className="py-1 font-semibold text-slate-700 underline disabled:opacity-50">
          cofnij zmianę</button>
      </>}
    </p>}
  </div>;
}

/**
 * Etykieta wiersza zamówienia jako ikona (0.455.0).
 *
 * `<dt>` dalej NIESIE słowo — w `sr-only` i w podpowiedzi — więc lista opisów
 * zostaje listą opisów dla czytnika ekranu, a nie rzędem wartości bez pytań.
 */
function Etykieta({ ikona, nazwa }: { ikona: React.ReactNode; nazwa: string }) {
  return <dt title={nazwa} className="flex text-slate-500">
    <span aria-hidden="true">{ikona}</span><span className="sr-only">{nazwa}</span>
  </dt>;
}

export function Dowody({ zwrot, kandydaciFaktury = [], fakturaTrwa = false,
  fakturaBlad = "", onFaktura, os = [], sprawy = [], droga = [], kosze = [],
  trwaNotatka = false, bladNotatki = "", onNotatka, onCofnijNotatke,
  }: {
  zwrot: Zwrot;
  kandydaciFaktury?: KandydatFaktury[];
  fakturaTrwa?: boolean;
  fakturaBlad?: string;
  /** Brak = kolumna nie proponuje wskazania (przycisk bez działania kłamie). */
  onFaktura?: (dokId: number | null) => void;
  /** Przebieg sprawy (0.313.0); pusta lista nie rysuje sekcji. */
  os?: WpisOsiZwrotu[];
  /* Spoiwo kolejek (S1 i S3). Domyślnie puste, bo kolumna bywa rysowana bez
     szczegółu — a wtedy pusta lista po prostu nie rysuje sekcji. */
  sprawy?: SprawaZakupu[];
  droga?: PrzystanekDrogi[];
  /** Kosze z towarem tego zwrotu (0.438.0) — druga strona wiązania kosz ↔ zwrot. */
  kosze?: Array<{ id: number; kod: string; status: string }>;
  trwaNotatka?: boolean;
  bladNotatki?: string;
  /** Brak = kolumna notatki nie pokazuje (pole bez zapisu kłamie). */
  onNotatka?: (tekst: string) => void;
  onCofnijNotatke?: () => void;
}) {
  const zam = zwrot.zamowienie;

  return <div className="text-sm">
    <Sekcja ikona={<CalendarClock size={14} />} tytul="Zegar obsługi">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-slate-500">Zgłoszony</dt><dd>{czas(zwrot.utworzono)}</dd>
        <dt className="text-slate-500">Termin</dt>
        {/* BRAK TERMINU TO ZDANIE, nie pusta komórka (0.339.0): pusta wygląda
            jak usterka panelu, a to jest stan — paczka jeszcze jedzie. */}
        <dd className={zwrot.dniDoTerminu !== null && zwrot.dniDoTerminu <= 3
          ? "font-bold text-ranga-zle" : ""}>
          {zwrot.terminAt ? czas(zwrot.terminAt) : "rusza, gdy paczka wróci"}</dd>
      </dl>
      {/* DWÓCH ZDAŃ O TYM, JAK LICZY ALLEGRO, TU JUŻ NIE MA (0.370.0).
          Powtarzały się przy KAŻDYM zwrocie, a mówiły o systemie, nie o tej
          sprawie — po trzecim otwarciu ekranu nikt ich nie czyta, a miejsce
          zajmują dalej. Zasada zegara stoi w `docs/panel-obslugi-klienta.md`
          i w pastylce terminu, która mówi liczbę dla TEGO zwrotu. */}
    </Sekcja>

    {/* SEKCJI „ZWROT" TU JUŻ NIE MA (0.207.0). Numer i login kupującego stoją
        w nagłówku sprawy, po lewej: tożsamość zwrotu czyta się jako pierwszą
        i to ją się przepisuje, a numer stał dotąd w dwóch miejscach naraz.
        Przewoźnik został — i przeniósł się do PACZKI ZWROTNEJ, bo mówi
        o paczce, nie o zwrocie jako sprawie. */}
    <Sekcja ikona={<ShoppingCart size={14} />} tytul="Zamówienie">
      {!zam
        ? <>
            <div className="flex items-center gap-1">
              <span className="break-all font-mono text-xs">{zwrot.orderId ?? "—"}</span>
              {zwrot.orderId && <Skopiuj tekst={zwrot.orderId} />}
            </div>
            {/* OBA ZDANIA KOŃCZĄ SIĘ RUCHEM (audyt, 15 września 2026). Pierwsze
                odsyłało do CZEKANIA na synchronizację, choć przycisk „Dociągnij
                teraz" stoi dwa wiersze niżej — operator czekał na coś, co miał pod
                ręką. Drugie kończyło się ścianą: bez numeru zamówienia panel nie ma
                czego dociągnąć, ale zwrot da się doprowadzić do końca i tak. */}
            <p className="mt-2 text-xs text-slate-500">
              {zwrot.orderId
                ? `Treści zamówienia jeszcze nie pobrano — bez nich pozycje zwrotu nie
                   mają skąd wziąć kartoteki. Dociągnij je przyciskiem niżej albo
                   poczekaj na najbliższą synchronizację.`
                : `Allegro nie podało przy tym zwrocie numeru zamówienia. Bez niego
                   nie ma czego dociągnąć ani z czego wziąć kartoteki — wycenę robisz
                   z pozycji, a zwrot zamyka numer korekty z Subiekta.`}</p>
          </>
        : <>
            <div className="flex items-center gap-1">
              <Link href={zam.link}>Otwórz w <ZnakAllegro wysokosc={11} /></Link>
              <Skopiuj tekst={zam.externalId} />
            </div>
            {/* ── IKONA ZAMIAST ETYKIETY (0.455.0) ──────────────────────────
                Zgłoszenie właściciela: „ulżyj przeładowaniu tekstem". Pięć
                etykiet stało przy każdym zwrocie w tej samej kolejności, więc
                po tygodniu czyta się je miejscem, nie słowem. Ikona trzyma
                miejsce, słowo zostaje w podpowiedzi i dla czytnika ekranu —
                „Klient chciał faktury" dalej brzmi jak zdanie, a nie jak
                sama wartość bez pytania. */}
            <dl className="mt-2 grid grid-cols-[1rem_1fr] items-center gap-x-2.5 gap-y-1">
              {zam.kupionoAt && <><Etykieta ikona={<CalendarDays size={15} />} nazwa="Kupione" />
                <dd>{czas(zam.kupionoAt)}</dd></>}
              {zam.dostawaMetoda && <><Etykieta ikona={<Truck size={15} />} nazwa="Dostawa" />
                <dd>{zam.dostawaMetoda} · {zlote(zam.dostawaGrosze, zam.waluta)}</dd></>}
              <Etykieta ikona={<Wallet size={15} />} nazwa="Zapłacono" />
              <dd className="tabular-nums">{zlote(zam.sumaGrosze, zam.waluta)}</dd>
              {/* Forma płatności to przy zwrocie nie ciekawostka: przy pobraniu
                  nie ma karty, na którą oddać pieniądze. */}
              {zam.platnoscTyp && <><Etykieta ikona={<CreditCard size={15} />} nazwa="Płatność" />
                <dd>{PLATNOSCI[zam.platnoscTyp] ?? zam.platnoscTyp}</dd></>}
              {/* NAZWA WIERSZA, nie treść (0.176.0). Stało tu „Dokument" i to
                  samo słowo tytułowało sekcję z numerem paragonu z Subiekta —
                  więc „Dokument: nie wiadomo" czytało się jako „nie znaleziono
                  dokumentu sprzedaży", stojąc obok znalezionego. To zdanie
                  mówi o ŻYCZENIU KLIENTA i tylko o nim.

                  `null` znaczy „nie wiadomo" i tak się pokazuje — paragon
                  wpisany na ślepo kazałby wystawić niewłaściwą korektę. */}
              <Etykieta ikona={<Receipt size={15} />} nazwa="Klient chciał" />
              <dd>{zam.fakturaZadana == null
                ? <span className="text-slate-500">nie wiadomo</span>
                : zam.fakturaZadana ? "faktury" : "paragonu"}</dd>
            </dl>
            {/* CAŁE zamówienie, nie tylko zwracane pozycje: „kupił trzy,
                oddaje jedną" jest kontekstem decyzji, a nie ciekawostką. */}
            <ul className="mt-3 space-y-1">
              {zam.pozycje.map((p, i) => <li key={`${p.offerId}-${i}`}
                className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                  p.zwracana ? "bg-amber-50 font-semibold" : "text-slate-600"}`}>
                {/* ── ZDJĘCIE PRZY POZYCJI ZAMÓWIENIA (0.217.0) ─────────────
                    Zgłoszenie właściciela: „wszędzie, gdzie jest odniesienie
                    do produktu, powinno być zdjęcie". Ta lista była ostatnim
                    miejscem w obsłudze, które wymieniało towary samym tekstem
                    — a odpowiada na pytanie „co klient w ogóle kupił", czyli
                    takie, przy którym nazwa ucięta w połowie nie wystarcza.

                    Kafel jest MNIEJSZY niż przy pozycji zwrotu (32 px wobec
                    72) i to jest hierarchia, nie oszczędność: pozycja zwrotu
                    to praca, pozycja zamówienia to kontekst tej pracy.

                    Tu stoi WYŁĄCZNIE zdjęcie oferty. Co mamy na półce, mówi
                    kolumna środkowa przy pozycji zwrotu; powtórzenie tego
                    obok byłoby szumem (dekalog, punkt 5). */}
                <KafelOferty externalId={p.offerId} stan={p.ofertaZdjecie} rozmiar={32}
                  nazwa={`${p.nazwa} — zdjęcie oferty`} symbol={p.sku} />
                {/* NAZWA W DWÓCH LINIACH, nie ucięta w jednej. Ta kolumna ma
                    21 rem przy węższym oknie, a kafel zabiera z niej 32 px;
                    `truncate` zostawiał wtedy „NAKRĘTKA DO…", czyli nazwę,
                    z której nie da się rozpoznać towaru. Cena schodzi do
                    drugiego wiersza, bo odpowiada na inne pytanie niż „co to
                    jest" i nie musi stać w tej samej linii. */}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">{p.nazwa}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
                    {/* `whitespace-nowrap`: obok stoi plakietka WRACA i bez
                        tego kwota łamała się w środku, na „1 ×", „13,93",
                        „EUR" w trzech wierszach. */}
                    <span className="whitespace-nowrap tabular-nums">
                      {p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
                {/* PLAKIETKA NIESIE SZTUKI (0.176.0). Samo „wraca" stało obok
                    liczby KUPIONYCH sztuk, więc „2 × 18,99 wraca" czytało się
                    jako „wracają dwie" przy zwrocie jednej. Przy zwrocie
                    całości „z 2" byłoby szumem — dlatego pada tylko wtedy,
                    gdy część zakupu zostaje u klienta. */}
                    {/* STRZAŁKA POWROTU zamiast wersalików (0.455.0). Słowo
                        „wraca" zostaje dla czytnika ekranu i w podpowiedzi,
                        a liczba — jedyne, co się tu zmienia — stoi obok ikony. */}
                    {p.zwracana && <span title="Wraca w tym zwrocie"
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-200 px-1.5 text-podpis font-bold">
                      <Undo2 size={11} aria-hidden="true" /><span className="sr-only">wraca </span>
                      {p.wracaIlosc}{p.wracaIlosc < p.ilosc ? ` z ${p.ilosc}` : ""}</span>}
                  </span>
                </span>
              </li>)}
            </ul>
          </>}

      {/* PRZYCISK POD OBIEMA GAŁĘZIAMI (0.220.0). Do tego wydania stał tylko
          przy zamówieniu NIEPOBRANYM — czyli znikał dokładnie tam, gdzie jest
          jedyną ręczną drogą do wiązania. Zamówienie bywa pobrane, a kartoteki
          i tak nie ma: wiąże ją przebieg, który ten przycisk uruchamia.

          Bez numeru zamówienia przycisku dalej nie ma. Dociąganie nie zmieni
          wtedy niczego, a obiecywałoby, że zmieni. */}
      {zwrot.orderId && <DociagnijZamowienia />}

      {/* ── Dokument sprzedaży (0.174.0, wciągnięty do zamówienia w 0.176.0) ──
          Do 0.175.0 stał osobną sekcją NA DNIE kolumny, pod wiadomościami —
          czyli daleko od zamówienia, którego dotyczy, i pod wierszem
          „Dokument", który mówił o czym innym. Właściciel powiedział wprost:
          „dokument sprzedaży powinien być w zamówieniu". To jego druga strona:
          zamówienie mówi, co klient kupił w Allegro, dokument — pod jakim
          numerem ta sprzedaż stoi w Subiekcie. Po tym numerze biuro wystawia
          korektę.

          Stoi POZA rozgałęzieniem `zam`, bo wiąże go numer zamówienia, a nie
          jego pobrana treść: dokument bywa znany, zanim ticker dociągnie
          pozycje. */}
      {onFaktura && <div className="mt-3 border-t border-slate-200 pt-2">
        <NaglowekSekcji jako="p" ikona={ikonaDokumentu} className="mb-1">
          Dokument sprzedaży</NaglowekSekcji>
        <Dokument faktura={zwrot.faktura} kandydaci={kandydaciFaktury}
          trwa={fakturaTrwa} blad={fakturaBlad} onWskaz={onFaktura}
          enter={zwrot.kubelek === "korekta"} />
      </div>}
    </Sekcja>

    <Sekcja ikona={<Package size={14} />} tytul="Paczka zwrotna">
      {/* „Nadana", nie „wróciła" (0.169.0): przy paczce stoi data jej
          UTWORZENIA przez klienta. Do 0.167.0 ekran nazywał ją powrotem
          towaru i to było nieprawdą.

          DRUGA NIEPRAWDA, zdjęta w 0.187.0: stało tu „Allegro nie podaje daty
          doręczenia do nas". Podaje — tyle że nie w obiekcie zwrotu, lecz
          w `/order/carriers/{id}/tracking`, gdzie każda zmiana statusu ma
          `occurredAt`. Zdanie wzięło się ze zbyt wąskiego czytania jednego
          schematu i przez trzy wydania mówiło operatorowi, że czegoś nie da
          się wiedzieć. */}
      {zwrot.paczkaAt
        ? <>
            {/* Paczka nieodebrana nie została NADANA PRZEZ KLIENTA — wróciła
                sama od przewoźnika, a `paczka_at` jest przy niej datą, w której
                biuro wpisało ją do kolejki. Do 0.188.0 stało tu zdanie
                o kliencie, który tej paczki właśnie nigdy nie nadał. */}
            <p>{zwrot.zrodlo === "nieodebrana"
              ? <>Wróciła nieodebrana, zapisana {czas(zwrot.paczkaAt)}.</>
              : <>Nadana przez klienta {czas(zwrot.paczkaAt)}.</>}</p>
            {zwrot.dostarczonoAt
              ? <p className="mt-1 font-semibold text-ranga-ok">
                  Doręczona do nas {czas(zwrot.dostarczonoAt)}.</p>
              : zwrot.przesylkaStatus
                ? <p className="mt-1 font-semibold text-ranga-uwaga">
                    {PRZESYLKA[zwrot.przesylkaStatus]
                      ?? `Przewoźnik mówi: ${zwrot.przesylkaStatus}.`}</p>
                /* BRAK WIEDZY MÓWI O SOBIE, a nie udaje wiedzy (0.188.0).
                   Stało tu „Jeszcze do nas nie dotarła" — zdanie twierdzące,
                   którego nie mieliśmy z czego postawić, bo przewoźnik po
                   prostu jeszcze nic nie powiedział. Ten sam błąd co dwa razy
                   wcześniej w tej sekcji: ekran orzekał zamiast przyznać, że
                   nie wie. */
                : <p className="mt-1 font-semibold text-ranga-uwaga">
                    Nie wiadomo, czy dotarła — przewoźnik nic jeszcze nie podał.</p>}
          </>
        : <p className="font-semibold text-ranga-uwaga">
            Klient nie nadał jeszcze paczki, a termin biegnie.</p>}
      {/* Przewoźnik mówi o PACZCE, nie o zwrocie jako sprawie — do 0.206.0
          stał w sekcji „Zwrot" razem z numerem i loginem. */}
      {zwrot.przewoznik && <p className="mt-1 text-slate-600">
        Przewoźnik: {PRZEWOZNICY[zwrot.przewoznik] ?? zwrot.przewoznik}</p>}
      {/* NUMER LISTU OD 0.344.0. Do 0.343.0 panel go nie znał — polityka
          0.163.0 trzymała numer wyłącznie w kopii odpowiedzi Allegro.
          Decyzja właściciela: „zapisuj numery paczek". Stoi przy przewoźniku,
          bo razem odpowiadają na jedno pytanie: którą paczką to jechało.
          `font-mono`, bo czyta się go znak po znaku z naklejki. */}
      {zwrot.waybill && <p className="mt-1 text-slate-600">
        Numer listu: <b className="break-all font-mono">{zwrot.waybill}</b></p>}
      <p className="mt-2 text-xs text-slate-500">
        Danych nadawcy i konta bankowego nie pobieramy.</p>
    </Sekcja>

    {/* ── Wiadomości o tym zakupie (0.169.0) ─────────────────────────────────
        Mostkiem jest numer zamówienia przy wiadomości (`related_order_id`,
        mapowany od 0.166.0) — ani jednego nowego żądania do Allegro.

        Pusty wynik mówi „Allegro nic nie powiązało", a nie „klient nie
        pisał". To dwa różne zdania i tylko pierwsze jest prawdziwe: Allegro
        oznacza zamówieniem tylko część wiadomości, a klient piszący z poziomu
        oferty tym mostkiem się nie znajdzie. */}
    {/* SEKCJA MILCZY, GDY NIE MA CZEGO POWIEDZIEĆ (0.370.0). Przy typowym
        zwrocie mostek nie trafia w nic, więc ikona, nagłówek i ramka stały tu
        po to, żeby napisać „nie powiązało" — czyli zdanie o Allegro, nie
        o sprawie. Dekalog p. 2: na wierzchu to, co rozstrzyga bieżącą
        czynność. Że wiadomości bywają, mówi dokumentacja i ta sekcja wtedy,
        gdy naprawdę są. */}
    {/* Reklamacje i dyskusje tego zakupu (S1 spoiwa). Zwrot widział rozmowy
        od 0.169.0, a spraw posprzedażowych nie widział wcale — biuro oddawało
        pieniądze, nie wiedząc o otwartej reklamacji o ten sam towar. */}
    {sprawy.length > 0 &&
    <Sekcja ikona={<Scale size={14} />} tytul="Sprawy tego zakupu">
      <SprawyZakupu sprawy={sprawy} />
    </Sekcja>}

    {/* KOSZE Z TOWAREM TEGO ZWROTU (0.438.0). Pozycja pisała „w koszyku
        zwrotów" bez nazwy i bez drogi, a pytanie „gdzie jest towar z tego
        zwrotu" pada właśnie tutaj. Kosz wymieniał swoje zwroty od dawna —
        dopiero z tą sekcją wiązanie działa w obie strony. */}
    {kosze.length > 0 &&
    <Sekcja ikona={<Package size={14} />} tytul="Towar w koszach">
      <ul className="space-y-1">
        {kosze.map((k) => <li key={k.id}>
          <RouterLink to={`/obsluga/zwroty/kosze/${k.id}`} className="font-semibold underline">
            {k.kod}</RouterLink>
          <span className="ml-2 text-slate-600">{STAN_KOSZA[k.status] ?? k.status}</span>
        </li>)}
      </ul>
    </Sekcja>}

    {droga.length > 1 &&
    <Sekcja ikona={<MessageSquare size={14} />} tytul="Droga tego zakupu">
      <DrogaZakupu droga={droga} tutaj={{ rodzaj: "zwrot", id: zwrot.id }} />
    </Sekcja>}

    {zwrot.rozmowy.length > 0 &&
    <Sekcja ikona={<MessageSquare size={14} />} tytul="Wiadomości o tym zakupie">
      {<ul className="space-y-1">
            {zwrot.rozmowy.map((r) => <li key={r.id}>
              <a href={`/obsluga/skrzynka/${r.id}`}
                className="block rounded-lg bg-slate-50 px-2 py-1 hover:bg-slate-100">
                <span className="font-semibold text-sky-700 underline underline-offset-2">
                  {r.temat?.trim() || "Rozmowa bez tematu"}</span>
                <span className="ml-2 text-xs text-slate-500">{czas(r.ostatniaAt)}</span>
                <Plakietka status={r.status} className="ml-2">{r.status}</Plakietka>
              </a>
            </li>)}
          </ul>}
    </Sekcja>}

    {zwrot.rejectionCode && <Sekcja ikona={<Receipt size={14} />} tytul="Rozstrzygnięte w Allegro">
      <p className="font-semibold">{ODRZUCENIA[zwrot.rejectionCode] ?? zwrot.rejectionCode}</p>
    </Sekcja>}

    {/* SEKCJI „PRACA BIURA" TU JUŻ NIE MA (0.370.0). Stała tu od 0.315.0 ze
        znacznikiem prowadzącego i tagami sprawy; zgłoszenie właściciela
        „uprość panel zwrotów do wymaganego minimum" zdjęło oba przy zwrotach.
        Przy reklamacji i dyskusji zostają — tam prowadzący odpowiada na
        prawdziwe pytanie, bo sprawę bierze konkretna osoba. */}

    {onNotatka && <Sekcja ikona={<NotebookPen size={14} />} tytul="Notatka biura">
      <Notatka zwrot={zwrot} trwa={trwaNotatka} blad={bladNotatki}
        onZapisz={onNotatka} onCofnij={onCofnijNotatke} />
    </Sekcja>}

    {/* OŚ STOI NA KOŃCU KOLUMNY i to jest jej miejsce: reszta dowodów odpowiada
        na „co zdecydować", a oś na „co się już stało". Pierwsze czyta się przed
        decyzją, drugie po fakcie — najczęściej przy zwrocie zamkniętym, gdy
        sprawa wraca pytaniem. */}
    {os.length > 0 && <Sekcja ikona={<History size={14} />} tytul="Przebieg sprawy">
      <Os wpisy={os} />
    </Sekcja>}

  </div>;
}
