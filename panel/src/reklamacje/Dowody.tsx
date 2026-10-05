import React, { useEffect, useState } from "react";
import { Coins, ExternalLink, Gavel, NotebookPen, Receipt } from "lucide-react";
import type {
  CenaPoziomu, PozycjaZamowienia, Reklamacja, SladHistorii, SzczegolReklamacji, Tag,
} from "../api/typy";
import { TagiSprawy } from "../sprawy/Tagi";
import { DrogaZakupu, SprawyZakupu } from "../sprawy/Spoiwo";
import { PrzyciskHistorii } from "../sprawy/HistoriaKlienta";
import { zlote } from "../api/zwroty";
import {
  EtykietaWartosci, NaglowekSekcji, czas, dzien, dniSlowo, ile, LoginKlienta, odmien, Przycisk,
  Skopiuj,
} from "../ui";
import { CenyKartoteki } from "../skrzynka/TowarRozmowy";
import { useKartaTowaru } from "../api/rozmowy";
import { Zwijka } from "../skrzynka/Zwijka";
import { kartotekaKolumny } from "./Glowica";

/* ── Kolumna faktów o reklamacji ─────────────────────────────────────────────
   Trzecia kolumna obszaru sprawy, za rozmową i dowodami biura. Jedna lista
   faktów o jednej sprawie, więc SEKCJE jedna pod drugą, a nie zakładki — ta
   sama decyzja co przy zwrocie w 0.180.0. Zakładki mają sens tam, gdzie
   kolumna niesie dwa RÓWNORZĘDNE tematy; tutaj jest jeden.

   Wszystko poniżej to ODCZYT. Notatka, tagi i pytanie o paczkę zapisują,
   ale każde jawnym kliknięciem, nie skutkiem ubocznym patrzenia. */

/* ── GĘSTOŚĆ KOLUMNY (0.389.0) ───────────────────────────────────────────────
   Zgłoszenie właściciela ze zrzutem: kolumna dowodów nie mieściła się
   w oknie, a agent przewijał, żeby zobaczyć termin. Rusztowanie samych
   sekcji — nagłówek plus dwa paddingi plus krawędź — zjadało około połowy
   wysokości, którą miały zająć fakty.

   Zwężamy ODDECH, nie treść: ani jeden fakt nie zszedł z ekranu. Etykieta
   z `w-32` na `w-28` (najdłuższa, „Zamówienie złożone", i tak łamie się na
   dwie linie w obu wariantach), `py-1` na `py-0.5`, sekcja z `py-3` na `py-2`.
   Dekalog, punkt 2: pierwszeństwo ma to, co rozstrzyga bieżącą czynność. */
const Wiersz = ({ etykieta, children }: { etykieta: string; children: React.ReactNode }) =>
  <div className="flex items-baseline gap-2 py-0.5 text-sm">
    <EtykietaWartosci className="w-28 shrink-0">{etykieta}</EtykietaWartosci>
    <span className="min-w-0 flex-1 text-slate-800">{children}</span>
  </div>;

const Sekcja = ({ tytul, children }: { tytul: string; children: React.ReactNode }) =>
  <section className="border-t border-slate-200 px-4 py-2 first:border-t-0">
    <NaglowekSekcji jako="h3" className="mb-0.5">{tytul}</NaglowekSekcji>
    {children}
  </section>;

const Link = ({ href, children }: { href: string | null; children: React.ReactNode }) =>
  href
    ? <a href={href} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-wertis-ink">
        {children}<ExternalLink size={12} /></a>
    : <>{children}</>;

/**
 * Notatka biura — nasze ustalenia, których Allegro nie zna.
 *
 * Zapis JAWNYM przyciskiem, nie przy każdym znaku: notatka pisze się zdaniami,
 * a zapis po każdej literze podnosiłby wersję rekordu i wywracał kontrolę
 * świeżości u kolegi przy drugim biurku.
 */
function Notatka({ reklamacja, trwa, blad, onZapisz, onCofnij }: {
  reklamacja: Reklamacja;
  trwa: boolean;
  blad: string;
  onZapisz: (tekst: string) => void;
  /* Cofnięcie jest OPCJONALNE tym samym wzorcem co reszta: czego nie da się
     zrobić, tego nie ma na ekranie. */
  onCofnij?: () => void;
}) {
  const [tekst, setTekst] = useState(reklamacja.notatka ?? "");
  /* Przełączenie sprawy podmienia treść pola. Bez tego notatka poprzedniej
     zostawałaby w edytorze i dało się ją zapisać na cudzej reklamacji. */
  useEffect(() => { setTekst(reklamacja.notatka ?? ""); }, [reklamacja.id, reklamacja.notatka]);
  const zmienione = tekst.trim() !== (reklamacja.notatka ?? "").trim();
  return <div className="flex flex-col gap-2">
    <label className="sr-only" htmlFor="notatka-reklamacji">Notatka biura</label>
    <textarea id="notatka-reklamacji" rows={3} value={tekst}
      onChange={(e) => setTekst(e.target.value)}
      placeholder="Ustalenia, których Allegro nie zna"
      className="field resize-y text-sm" />
    {blad && <p className="text-xs text-red-700">{blad}</p>}
    {/* ZAPIS DOPIERO PRZY ZMIANIE (0.511.0). Martwy bursztynowy przycisk
        stał pod każdą notatką i był najgłośniejszą rzeczą w kolumnie faktów,
        choć przy czytaniu nie ma czego zapisać. Pojawia się z pierwszą
        zmienioną literą i znika po zapisie, gdy pole równa się notatce. */}
    {zmienione && <Przycisk wariant="glowny" disabled={trwa}
      onClick={() => onZapisz(tekst)}>
      {trwa ? "Zapisuję…" : "Zapisz notatkę"}
    </Przycisk>}
    {/* ── CO SIĘ Z NIĄ STAŁO I JAK TO COFNĄĆ (0.280.0) ─────────────────────
        §25a.5: cofnięcie zamiast potwierdzenia, i to jest ZDANIE, nie ramka
        z decyzją. Notatka jest polem swobodnym, które nadpisuje ten, kto pisze
        ostatni — do tego wydania skasowanego zdania nie dało się odzyskać
        niczym, bo do dziennika idzie świadomie sama długość.

        Autor i godzina stoją TU, a nie w osobnej sekcji: pytanie „kto to
        napisał" zadaje się patrząc na notatkę, nie szukając jej autora. */}
    {reklamacja.notatkaPrzez && <p className="text-podpis text-slate-600">
      Zmiana: {reklamacja.notatkaPrzez}, {czas(reklamacja.notatkaAt)}
      {onCofnij && reklamacja.maPoprzedniaNotatke && <>
        {" · "}
        <button type="button" disabled={trwa} onClick={onCofnij}
          className="py-1 font-semibold text-slate-700 underline disabled:opacity-50">
          cofnij zmianę</button>
      </>}
    </p>}
  </div>;
}

/**
 * Co stoi w tagach i notatce — jedno zdanie do zamkniętego nagłówka.
 *
 * Bez niego zwinięty blok kazałby otwierać go tylko po to, żeby sprawdzić,
 * czy ktoś już coś zapisał. To ten jeden klik, dla którego blok się zwija.
 */
function podpisPracy(r: Reklamacja): string {
  const ma: string[] = [];
  if (r.tagi.length > 0) ma.push(ile(r.tagi.length, "tag", "tagi", "tagów"));
  if (r.notatka) ma.push("notatka");
  return ma.length ? ma.join(" · ") : "pusto";
}

export function Dowody({
  szczegol, trwa, bladZapisu, onNotatka, onCofnijNotatke,
  onSprawdzPrzesylke, sprawdzaPrzesylke = false, bladPrzesylki = "",
  tagi,
}: {
  szczegol: SzczegolReklamacji;
  trwa: boolean;
  bladZapisu: string;
  onNotatka: (tekst: string) => void;
  /** Cofnięcie ZMIANY notatki (0.280.0) — §25a.5. */
  onCofnijNotatke?: () => void;
  /* Tagi są OPCJONALNE: czego nie da się zrobić, tego nie ma na ekranie —
     sekcja bez obsługi byłaby obietnicą bez pokrycia. */
  tagi?: {
    slownik: Tag[];
    trwa: boolean;
    blad: string;
    onPrzypnij: (tagId: number) => void;
    onOdepnij: (tagId: number) => void;
    onNowy: (nazwa: string) => void;
  };
  /* Sprawdzenie przesyłki (0.393.0) — opcjonalne tym samym wzorcem co reszta:
     czego nie da się zrobić, tego nie ma na ekranie. */
  onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean;
  bladPrzesylki?: string;
}) {
  const r = szczegol.reklamacja;
  /* Pozycja paragonu tej właśnie oferty — z niej bierze się ilość i cena
     przy wierszu towaru. Reklamacja dotyczy JEDNEJ oferty, więc jednej
     pozycji; ta sama oferta dwa razy na zamówieniu niesie tę samą cenę. */
  const pozycja = szczegol.zamowienie?.pozycje
    .find((p) => p.offerId !== null && p.offerId === r.offerId) ?? null;
  const towar = kartotekaKolumny(szczegol);

  return <div className="flex min-h-0 flex-col">
    {/* ── GŁOWICA I TOWAR STOJĄ NAD KOLUMNAMI ──────────────────────────────
        Kwota żądania, termin, powód, towar i jego sygnatura przeszły do
        głowicy sprawy (`Glowica.tsx`) — na całą szerokość, nad rozmową.
        Zdjęcia oferty i kartoteki stoją w kolumnie zdjęć pod „Wysłaliśmy".
        Tu zostają fakty do decyzji i zwijki ze szczegółem. */}
    <Triaz szczegol={szczegol} pozycja={pozycja} twId={towar.twId} />
    <Paczka przesylka={szczegol.przesylka} onSprawdz={onSprawdzPrzesylke}
      trwa={sprawdzaPrzesylke} blad={bladPrzesylki} />

    <div className="px-2">
      <Zwijka
        tytul="Zakup"
        Ikona={Receipt}
        podpis={podpisZakupu(szczegol)}
        /* ── ZAMKNIĘTA OD 0.414.0 ──────────────────────────────────────────
           Otwarto ją w 0.403.0 z dobrym powodem: „kwoty rozstrzygają spór
           o zwrot pieniędzy". Ten powód przestał dotyczyć TEJ zwijki, gdy
           0.413.0 postawiło kwoty rozstrzygające w kostkach nad nią —
           otwarta powtarzała je, zamiast dokładać cokolwiek. W środku zostaje
           to, po co się ją naprawdę otwiera: reszta pozycji zamówienia,
           dostawa i los paczki. */
        pamietajJako="wertis.reklamacje.zakup"
      >
        <div className="px-2 py-2">
          {szczegol.zamowienie ? <>
            {/* ── CENY (0.393.0, układ z 0.403.0) ──────────────────────────
                DOSTAWA OSOBNO OD SUMY, bo klient żądający zwrotu pyta czasem
                właśnie o nią. Sklejenie ich kazałoby liczyć w głowie.

                Pozycja reklamowana jest POGRUBIONA: zamówienie bywa
                kilkupozycyjne, a spór dotyczy jednej rzeczy. */}
            <ul className="flex flex-col gap-1">
              {szczegol.zamowienie.pozycje.map((p, i) => {
                const sporna = p.offerId !== null && p.offerId === r.offerId;
                return <li key={`${p.offerId ?? p.sku ?? i}`}
                  className={`flex items-baseline gap-2 text-sm ${
                    sporna ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                  <span className="min-w-0 flex-1 truncate">{p.nazwa}</span>
                  <span className="shrink-0 tabular-nums">
                    {p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
                </li>;
              })}
            </ul>
            {/* ── „RAZEM" WRÓCIŁO TUTAJ (0.416.0) ────────────────────────
                0.414.0 wyniosło sumę do podpisu zwijki, żeby nie stała dwa
                razy. Wyszło gorzej: przy zamówieniu jednopozycyjnym podpis
                powtarzał wtedy kostkę „Klient zapłacił", a to jest ten sam
                dubel piętro wyżej. Suma wraca do środka, gdzie stoi obok
                dostawy i pozostałych pozycji — czyli tam, gdzie mówi coś
                więcej niż cena reklamowanej rzeczy. */}
            <div className="mt-2 border-t border-slate-200 pt-1">
              <Wiersz etykieta="Dostawa">
                {zlote(szczegol.zamowienie.dostawaGrosze, szczegol.zamowienie.waluta)}
                {szczegol.zamowienie.dostawaMetoda &&
                  <span className="text-slate-500"> · {szczegol.zamowienie.dostawaMetoda}</span>}
              </Wiersz>
              <Wiersz etykieta="Razem">
                <b className="tabular-nums">
                  {zlote(szczegol.zamowienie.sumaGrosze, szczegol.zamowienie.waluta)}</b>
              </Wiersz>
            </div>
          </> : <p className="text-sm text-slate-600">zamówienia nie pobraliśmy</p>}

          <div className="mt-1 border-t border-slate-200 pt-1">
            <Wiersz etykieta="Zamówienie">
              {r.orderId
                ? <><Link href={r.linkZamowienia}>{r.orderId}</Link>
                    <Skopiuj tekst={r.orderId} tytul="Kopiuj numer zamówienia" /></>
                : "reklamacja bez numeru zamówienia"}
            </Wiersz>
            {/* ── DATA ZAKUPU MA JEDEN DOM (0.282.0, przeniesione w 0.414.0)
                ETYKIETA MÓWI, KTÓRY TO ZEGAR — i to zdanie z 0.282.0 dalej
                obowiązuje, tylko nie tutaj. Data stała w trzech miejscach
                naraz: w kostce „Kupione" (wiek plus nazwa zegara), w podpisie
                tej zwijki i w tym wierszu. Wiek i nazwa zegara są na górze,
                data bezwzględna w podpisie — a podpis widać także przy
                otwartym bloku, więc ten wiersz nie dokładał niczego. */}
            <Wiersz etykieta="Oferta">
              {r.offerId ? <Link href={r.linkOferty}>{r.offerId}</Link> : "—"}
            </Wiersz>
          </div>
        </div>
      </Zwijka>

      {/* ── SPRAWA ZWINIĘTA, BO GŁOWICA JĄ JUŻ POWIEDZIAŁA (0.403.0) ─────────
          Termin, kwota, powód i werdykt stoją w głowicy nad kolumnami — tu
          zostają IDENTYFIKATORY, tytuł prawny i stan rozmowy, czyli to, czego
          szuka się wtedy, gdy trzeba coś skopiować albo sprawdzić, czy Allegro
          jeszcze słucha. */}
      <Zwijka
        tytul="Sprawa"
        Ikona={Gavel}
        podpis={podpisSprawy(r)}
        pamietajJako="wertis.reklamacje.sprawa"
      >
        <div className="px-2 py-2">
          <Wiersz etykieta="Numer">
            <Link href={r.link}>{r.numer ?? r.externalId}</Link>
            <Skopiuj tekst={r.numer ?? r.externalId} tytul="Kopiuj numer reklamacji" />
          </Wiersz>
          <Wiersz etykieta="Kupujący">{r.kupujacyLogin
            ? <span className="inline-flex flex-wrap items-center gap-2"><LoginKlienta login={r.kupujacyLogin} />
                <PrzyciskHistorii rodzaj="sprawa" id={r.id} tutaj="tą reklamacją" /></span>
            : "—"}</Wiersz>
          <Wiersz etykieta="Zgłoszono">{czas(r.otwartoAt)}</Wiersz>
          {/* Rękojmia i gwarancja to dwie różne rozmowy z klientem, więc tytuł
              stoi słowem, a nie kodem Allegro. Status Allegro stoi surowo:
              głowica tłumaczy go na werdykt, a tu szuka się dokładnej wartości. */}
          <Wiersz etykieta="Tytuł">
            <b className="font-semibold">{r.prawo === "COMPLAINT" ? "rękojmia"
              : r.prawo === "WARRANTY" ? "gwarancja" : "tytuł nieznany"}</b></Wiersz>
          {r.statusAllegro && <Wiersz etykieta="Status Allegro">{r.statusAllegro}</Wiersz>}
          <Wiersz etykieta="Rozmowa">
            {r.czatAktywny ? "otwarta" : "zamknięta przez Allegro"}
            {` · ${r.wiadomosciIle} wiadomości`}
          </Wiersz>
        </div>
      </Zwijka>

      {/* ── „PROWADZI" ZESZŁO DO ŚRODKOWEJ KOLUMNY (0.392.0) ─────────────────
          Wzięcie sprawy jest CZYNNOŚCIĄ, a ta kolumna odpowiada na pytanie
          „co wiemy". Zostają tu tagi i notatka, bo to zapiski O SPRAWIE. */}
      <Zwijka
        tytul="Praca biura"
        Ikona={NotebookPen}
        podpis={podpisPracy(r)}
        domyslnieOtwarte={Boolean(r.notatka) || r.tagi.length > 0}
        pamietajJako="wertis.reklamacje.praca"
      >
        <div className="px-2 py-2">
          {/* TAGI NAD NOTATKĄ, bo odpowiadają na pytanie zadawane częściej:
              „czego ta sprawa czeka". Notatka jest dłuższa i czyta się ją
              wtedy, gdy tag nie wystarczy. */}
          {tagi && <TagiSprawy przypiete={r.tagi} slownik={tagi.slownik} trwa={tagi.trwa}
            blad={tagi.blad} onPrzypnij={tagi.onPrzypnij} onOdepnij={tagi.onOdepnij}
            onNowy={tagi.onNowy} />}
          <div className={tagi ? "mt-3" : ""}>
            <Notatka reklamacja={r} trwa={trwa} blad={bladZapisu} onZapisz={onNotatka}
              onCofnij={onCofnijNotatke} />
          </div>
        </div>
      </Zwijka>
    </div>

    {/* ── JEDNA SEKCJA ZAMIAST CZTERECH (0.416.0) ────────────────────────────
        Zgłoszenie właściciela ze zrzutem: „widzę jeszcze trochę powtórzeń".
        Pod kolumną stały CZTERY sekcje o jednym zakupie: „Zwroty tego
        zamówienia", „Inne sprawy tego zakupu", „Droga tego zakupu"
        i „Rozmowy o tym zakupie". Na jego zrzucie ta sama dyskusja stała
        w dwóch z nich, a to samo pytanie — w dwóch innych.

        DROGA JEST NADZBIOREM I TO JEST FAKT ZE ŹRÓDŁA, nie wrażenie:
        `services/droga-klienta.ts` składa przystanki z DOKŁADNIE tych samych
        tabel, z których biorą się tamte trzy listy — rozmów po
        `related_order_id`, reklamacji i dyskusji po `order_id`, zwrotów po
        `order_id`. Każdy przystanek niesie odnośnik do swojej kolejki, więc
        z drogi da się wejść wszędzie tam, gdzie prowadziły tamte sekcje.

        ZOSTAJE RODZEŃSTWO SPRAW, bo niesie to, czego droga nie ma: termin
        cudzej sprawy, kto ją prowadzi i czy jest otwarta. Przystanek mówi
        „dyskusja, 21 września"; wiersz mówi, że tamta dyskusja czeka na
        odpowiedź od trzech dni i siedzi na niej kolega z drugiego biurka. */}
    {(szczegol.droga.length > 1 || szczegol.sprawy.length > 0) &&
      <Sekcja tytul="Ten zakup u nas">
        {szczegol.droga.length > 1 && <DrogaZakupu droga={szczegol.droga}
          tutaj={{ rodzaj: "reklamacja", id: r.id }} wSekcji />}
        {szczegol.sprawy.length > 0 && <div className={szczegol.droga.length > 1 ? "mt-1.5" : ""}>
          <SprawyZakupu sprawy={szczegol.sprawy} wSekcji />
        </div>}
      </Sekcja>}

    {/* ── BEZ COPILOTA I BEZ „ZLEĆ HALI" ─────────────────────────────────────
        Decyzja właściciela przy przebudowie ekranu reklamacji: karta „Co
        wyczytał Copilot", jego rada i zlecenie dla hali na razie tu nie stoją.
        Dlatego nic w tej kolumnie nie woła modelu ani nie zleca pracy hali.
        Zapisane karty zostają w bazie, a `ZlecHali` dalej służy zwrotom
        i dyskusjom. Strażnik: `BezCopilota.test.tsx` i `Notatka.test.tsx`. */}
  </div>;
}

/* ── TRIAŻ: CZY MAMY I ILE NAS KOSZTUJE (0.411.0, kształt z 0.412.0) ────────
   Zgłoszenie właściciela: „nadal nie widzę cen w reklamacjach", a zaraz potem
   powód: „są kluczowe do szybkiego oceniania, czy warto rozpatrywać
   reklamację". To drugie zdanie rozstrzyga KSZTAŁT, nie samo istnienie bloku:
   liczba używana do triażu nie może stać za kliknięciem.

   0.411.0 postawiło tu goły cennik — sześć poziomów w jednej wadze. To było za
   mało i za dużo naraz. Za mało, bo przy żądaniu WYMIANY całą decyzję
   rozstrzyga pytanie „czy mamy czym wymienić", a tej liczby na ekranie
   reklamacji nie było wcale; skrzynka ma ją od 0.404.0. Za dużo, bo sześć
   równorzędnych kwot nie odpowiada na żadne pytanie — agent szukał wśród nich
   ceny zakupu, zamiast ją przeczytać.

   TRZY KOSTKI, RESZTA POD SPODEM. Mamy · zapłacił · nasz zakup. Dekalog
   ergonomii, punkt 2: pierwszeństwo ma to, co rozstrzyga bieżącą czynność.
   Pozostałe poziomy zostają w zwijce OTWARTEJ domyślnie — nic nie znika
   z ekranu, a kto ich nie używa, zamyka je raz na stanowisko.

   NIC SIĘ TU NIE ODEJMUJE. „Zapłacił" jest kwotą BRUTTO z paragonu, „nasz
   zakup" — netto z kartoteki. Różnica tych dwóch liczb nie jest marżą, a stawki
   VAT ten ładunek nie niesie. Dwie liczby obok siebie mówią prawdę; jedna
   wyliczona z nich kłamałaby z dokładnością do podatku.

   BRAK KARTOTEKI MÓWI O SOBIE (punkt 10 z `docs/obsluga-klienta-calosc.md`:
   czego nie wiemy, ekran mówi wprost). Pusty slot po stanie czytałby się jak
   „nie mamy", a to dwie różne odpowiedzi klientowi i dwie różne decyzje. */
function Triaz({ szczegol, pozycja, twId }: {
  szczegol: SzczegolReklamacji; pozycja: PozycjaZamowienia | null;
  /** Kartoteka całej kolumny — ta sama, której symbol stoi w wierszu towaru. */
  twId: number | null;
}) {
  const r = szczegol.reklamacja;
  /* Ten sam hak, co w skrzynce — TanStack trzyma to pod jednym kluczem, więc
     otwarcie sprawy nie pyta serwera drugi raz o tę samą kartotekę. */
  const karta = useKartaTowaru(twId);
  const ceny = karta.data?.ceny ?? [];
  /* POZIOM 0 TO CENA ZAKUPU. Kolumny `tw_Cena` numerują się od zera, a widok
     nazw od jedynki — dlatego ten jeden poziom nie ma nazwy i mieć nie musi
     (`adapters/subiekt.mssql.ts`, `rozwinCeny`). Nie zgadujemy go „najniższą
     ceną z listy": najtańszy cennik sprzedaży to nadal sprzedaż. */
  const zakup = ceny.find((c) => c.poziom === 0) ?? null;
  const pozostale = ceny.filter((c) => c.poziom !== 0);
  const mag = karta.data?.mag ?? null;
  const stanZnany = mag !== null;

  /* ── STAN CZYTA SIĘ PRZECIW ŻĄDANIU (0.413.0) ─────────────────────────────
     `offer.quantity` leży w ładunku sprawy od przyrostu trzeciego i do tego
     wydania nie było go na ekranie ANI RAZU. „Mamy 2 szt." przy sprawie o trzy
     sztuki wygląda jak dobra wiadomość i nią nie jest — wymiany z tego nie
     będzie. Porównanie robi więc ekran, nie agent w głowie. */
  const zadane = r.ilosc !== null && r.ilosc > 1 ? r.ilosc : null;
  const starczy = mag !== null && zadane !== null ? mag.avail >= zadane : null;
  const wiek = wiekZakupuSlowem(r.dniOdZakupu);

  /* ── PUSTY PASEK NIE STAJE, ALE LICZY SIĘ KAŻDA KOSTKA Z OSOBNA (0.414.0)
     Do tego wydania warunek pytał wyłącznie o kartotekę i o pozycję paragonu —
     więc sprawa, o której wiedzieliśmy tylko KIEDY ją kupiono, nie dostawała
     paska wcale i wiek zakupu przepadał razem z nim. Warunek liczy teraz to,
     co naprawdę miałoby stanąć: pasek znika dopiero, gdy nie stanęłaby ani
     jedna kostka i nie ma żadnego poziomu cen. */
  const kostek = (stanZnany || twId === null ? 1 : 0) + (wiek ? 1 : 0)
    + (pozycja ? 1 : 0) + (zakup ? 1 : 0);
  if (kostek === 0 && pozostale.length === 0) return null;

  return <div className="border-b border-slate-200 px-4 py-2">
    <div className="flex flex-wrap gap-2">
      {stanZnany
        ? <Kostka etykieta="Mamy"
            wartosc={mag.avail > 0 ? `${mag.avail} ${karta.data?.unit || "szt."}` : "brak na stanie"}
            kolor={mag.avail > 0 && starczy !== false ? "text-ranga-ok" : "text-ranga-zle"}
            pod={[
              zadane ? `sprawa o ${zadane} szt.` : null,
              karta.data?.locs?.length ? karta.data.locs.join(", ") : "bez półki",
            ].filter(Boolean).join(" · ")} />
        : twId === null
          ? <Kostka etykieta="Mamy" wartosc="nie wiadomo" kolor="text-slate-700"
              pod="sprawa bez kartoteki Subiekta" />
          : null}
      {wiek && <Kostka etykieta="Kupione" wartosc={wiek.napis}
        /* Bursztyn, nie czerwień, i nie wyrok: rękojmia biegnie dwa lata od
           WYDANIA rzeczy, a my mierzymy od zamówienia albo od złożenia
           koszyka. Ekran mówi, że warto sprawdzić — nie że sprawa przepadła. */
        kolor={wiek.poDwochLatach ? "text-ranga-uwaga" : "text-slate-900"}
        pod={r.kupionoZrodlo === "zamowienie" ? "data z zamówienia" : "data z ładunku sprawy"} />}
      {pozycja && <Kostka etykieta="Klient zapłacił"
        wartosc={zlote(pozycja.cenaGrosze, pozycja.waluta)} kolor="text-slate-900"
        pod={pozycja.ilosc > 1 ? `za sztukę · ${pozycja.ilosc} szt. na paragonie` : "brutto, za sztukę"} />}
      {zakup && <Kostka etykieta="Nasz zakup"
        wartosc={zlote(zakup.nettoGrosze ?? zakup.bruttoGrosze, zakup.waluta)}
        kolor="text-slate-900"
        pod={zakup.nettoGrosze !== null ? "netto z kartoteki" : "brutto z kartoteki"} />}
    </div>

    <Historia historia={szczegol.historia} />

    {pozostale.length > 0 && <Zwijka
      tytul="Pozostałe poziomy cen"
      Ikona={Coins}
      podpis={podpisCennika(pozostale)}
      /* ── ZAMKNIĘTA OD 0.414.0 ──────────────────────────────────────────
         0.411.0 postawiło cennik na wierzchu, bo właściciel nazwał ceny
         „kluczowymi do szybkiej oceny, czy warto rozpatrywać". Liczba, która
         to rozstrzyga, stoi od 0.413.0 w kostce „Nasz zakup" — zawsze,
         bez kliknięcia. Pozostałe pięć poziomów to cenniki SPRZEDAŻY:
         przydają się przy rozmowie o wymianie, nie przy werdykcie. */
      pamietajJako="wertis.reklamacje.cennik"
    >
      <div className="px-2 py-2">
        <CenyKartoteki ceny={pozostale} />
      </div>
    </Zwijka>}
  </div>;
}

/* ── CZY TO SIĘ JUŻ ZDARZAŁO (0.413.0) ──────────────────────────────────────
   Cennik mówi, ile kosztuje ustąpienie. Te dwie liczby mówią, czy w ogóle jest
   o co się spierać: towar z pięcioma reklamacjami, z których cztery
   uznaliśmy, to wada partii, a nie sprawa do rozstrzygania od zera. Druga
   strona tej samej monety — klient z czterema odmowami — też jest inną
   rozmową niż pierwsza.

   JEDEN WIERSZ, NIE SEKCJA. To jest tło decyzji, a nie sama decyzja: dostaje
   tyle miejsca, ile potrzeba na dwie liczby, i ani piksela więcej. Brak
   historii nie rysuje się wcale — pierwsza sprawa przy tym towarze nie jest
   informacją o towarze.                                                     */
function Historia({ historia }: { historia: SzczegolReklamacji["historia"] }) {
  /* Czytamy OSTROŻNIE, choć typ mówi, że pole jest. Panel i serwer wdrażają
     się jednym `git pull`, ale nie w tej samej sekundzie: przez chwilę nowy
     panel pyta starego serwera, a ładunek bez tego pola wywracałby CAŁĄ
     kolumnę dowodów zamiast pominąć jeden wiersz. */
  const czesci = [
    slad("Ten towar", historia?.towar ?? null),
    slad("Ten klient", historia?.klient ?? null),
  ].filter(Boolean) as string[];
  if (czesci.length === 0) return null;
  return <p className="border-b border-slate-200 px-4 py-1.5 text-podpis text-slate-700">
    {czesci.join(" · ")}
  </p>;
}

/** „Ten towar: 3 reklamacje, 2 uznane". Bez rozstrzygnięć — sam licznik. */
function slad(kto: string, s: SladHistorii | null): string | null {
  if (!s) return null;
  const ogon = [
    s.uznanych > 0 ? `${s.uznanych} ${odmien(s.uznanych, "uznana", "uznane", "uznanych")}` : null,
    s.odrzuconych > 0
      ? `${s.odrzuconych} ${odmien(s.odrzuconych, "odrzucona", "odrzucone", "odrzuconych")}` : null,
  ].filter(Boolean).join(", ");
  const ile_ = ile(s.ile, "reklamacja", "reklamacje", "reklamacji");
  return `${kto}: ${ile_}${ogon ? ` (${ogon})` : ""}`;
}

/**
 * Wiek zakupu jednym słowem — „14 miesięcy temu" zamiast „17 lipca 2025".
 *
 * Ta sama zamiana, co przy terminie decyzji: pytanie, które agent zadaje
 * patrząc na datę zakupu, brzmi „ile to już leży", a nie „który to był dzień".
 * Do dwóch miesięcy liczą się DNI, bo przy „uszkodzone w transporcie" różnica
 * między trzecim a trzydziestym dniem jest całą sprawą; dalej miesiące, bo
 * nikt nie liczy czterystu dni w głowie.
 *
 * `poDwochLatach` to FAKT ARYTMETYCZNY, nie wyrok: rękojmia biegnie dwa lata
 * od wydania rzeczy, a nasz zegar startuje od zamówienia albo od złożenia
 * koszyka — obie daty są WCZEŚNIEJSZE niż wydanie, więc próg wypada dla nas
 * bezpiecznie i sam niczego nie przesądza.
 */
function wiekZakupuSlowem(dni: number | null): { napis: string; poDwochLatach: boolean } | null {
  if (dni === null) return null;
  const poDwochLatach = dni > 730;
  if (dni < 60) {
    return { napis: dni === 0 ? "dziś" : `${dniSlowo(dni)} temu`, poDwochLatach };
  }
  /* 30,44 dnia to średnia długość miesiąca w roku zwykłym i przestępnym
     naraz. Dzielenie przez 30 dawałoby „12 miesięcy" przy 360 dniach, czyli
     przy dacie, która do roku jeszcze nie doszła. */
  const mies = Math.floor(dni / 30.44);
  if (mies < 24) return { napis: `${ile(mies, "miesiąc", "miesiące", "miesięcy")} temu`, poDwochLatach };
  const lata = Math.floor(dni / 365.25);
  return { napis: `${ile(lata, "rok", "lata", "lat")} temu`, poDwochLatach };
}

/* ── GDZIE JEST PACZKA (0.393.0, przeniesione w 0.414.0) ────────────────────
   „Czy on to w ogóle dostał" jest przy reklamacji pytaniem PIERWSZYM, a przy
   powodach „nie otrzymałem produktu" i „nie dostałem towaru po zapłacie" —
   całą sprawą. Do 0.413.0 ta odpowiedź leżała w zwijce Zakup, co uchodziło,
   dopóki zwijka stała otwarta. Zamknięcie jej zabrałoby sprawdzenie paczki
   pod kliknięcie, więc wiersz wychodzi na wierzch razem z resztą faktów
   decyzji, zamiast trzymać cały blok otwarty dla jednej linijki.

   Ładunek zamówienia numeru przesyłki NIE MA — stoi pod osobną końcówką
   `/order/checkout-forms/{id}/shipments`, a status pod tą samą, którą zwroty
   odpytują od 0.187.0. Dwa żądania, więc pytamy na JAWNE kliknięcie: żądanie
   u dostawcy nie wychodzi z patrzenia.                                      */
function Paczka({ przesylka, onSprawdz, trwa, blad }: {
  przesylka: SzczegolReklamacji["przesylka"];
  onSprawdz?: () => void;
  trwa: boolean;
  blad: string;
}) {
  if (!przesylka) return null;
  return <div className="border-b border-slate-200 px-4 py-1.5 text-sm">
    <span className="mr-2 text-podpis font-semibold uppercase tracking-wide text-slate-600">
      Paczka</span>
    {przesylka.sprawdzonoAt === null
      ? <span className="text-slate-600">nie pytaliśmy jeszcze Allegro</span>
      : przesylka.waybill === null
        ? <span className="text-slate-600">Allegro nie ma numeru — paczka jeszcze
            nienadana albo nadana poza Allegro</span>
        : <>
            {przesylka.dostarczonoAt
              ? <b className="text-ranga-ok">doręczona {czas(przesylka.dostarczonoAt)}</b>
              : <span>{przesylka.status ?? "przewoźnik nie podał statusu"}</span>}
            <span className="text-slate-600"> · {przesylka.przewoznik}{" "}
              <span className="font-mono">{przesylka.waybill}</span></span>
          </>}
    {onSprawdz && <button type="button" disabled={trwa} onClick={onSprawdz}
      className="ml-2 font-semibold underline underline-offset-2 disabled:opacity-50">
      {trwa ? "pytam…" : "sprawdź"}</button>}
    {blad && <p className="text-xs text-red-700">{blad}</p>}
  </div>;
}

/** Jedna liczba triażu: etykieta, kwota grubym drukiem, zdanie pod spodem. */
function Kostka({ etykieta, wartosc, kolor, pod }: {
  etykieta: string; wartosc: string; kolor: string; pod: string;
}) {
  return <div className="min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
    <EtykietaWartosci className="block">{etykieta}</EtykietaWartosci>
    <p className={`mt-0.5 text-lg font-bold leading-tight tabular-nums ${kolor}`}>{wartosc}</p>
    <p className="text-podpis text-slate-600">{pod}</p>
  </div>;
}

/** Co stoi w cenniku — ile poziomów, żeby zamknięta zwijka nie kazała zgadywać. */
function podpisCennika(ceny: CenaPoziomu[]): string {
  return ile(ceny.length, "poziom", "poziomy", "poziomów");
}

/**
 * Co stoi w zakupie — ile pozycji i z którego dnia (0.416.0).
 *
 * KWOTY TU NIE MA, choć stała tu od 0.403.0. Przy zamówieniu jednopozycyjnym —
 * czyli przy większości reklamacji — suma zamówienia jest tą samą liczbą, co
 * kostka „Klient zapłacił" dwa centymetry wyżej. Podpis ma mówić, CO jest
 * w środku; suma wróciła do wiersza „Razem", gdzie stoi obok dostawy i reszty
 * pozycji, czyli tam, gdzie znaczy coś więcej niż powtórzenie.
 */
function podpisZakupu(szczegol: SzczegolReklamacji): string {
  const z = szczegol.zamowienie;
  if (!z) return "zamówienia nie pobraliśmy";
  const kiedy = z.kupionoAt ?? szczegol.reklamacja.kupionoAt;
  return [ile(z.pozycje.length, "pozycja", "pozycje", "pozycji"),
    kiedy ? dzien(kiedy) : null].filter(Boolean).join(" · ");
}

/** Co stoi w sprawie — identyfikatory i długość rozmowy. */
function podpisSprawy(r: Reklamacja): string {
  return [r.numer ?? r.externalId, r.kupujacyLogin,
    `${r.wiadomosciIle} wiadomości`].filter(Boolean).join(" · ");
}
