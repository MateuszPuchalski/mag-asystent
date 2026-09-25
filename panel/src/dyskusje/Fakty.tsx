import React, { useEffect, useState } from "react";
import { Activity, ExternalLink, MessagesSquare } from "lucide-react";
import type { Dyskusja, SzczegolDyskusji, Tag } from "../api/typy";
import { zlote } from "../api/zwroty";
import { TagiSprawy } from "../sprawy/Tagi";
import { DrogaZakupu, SprawyZakupu } from "../sprawy/Spoiwo";
import { ZlecHali } from "../sprawy/ZlecHali";
import { PrzyciskHistorii } from "../sprawy/HistoriaKlienta";
import { EtykietaWartosci, NaglowekSekcji, czas, dzien, dniSlowo, ile, LoginKlienta, Przycisk, Skopiuj } from "../ui";
import { Zwijka } from "../skrzynka/Zwijka";

/* ── Kolumna faktów o dyskusji ───────────────────────────────────────────────
   Jedna lista faktów o jednej sprawie, więc SEKCJE jedna pod drugą, a nie
   zakładki — ta sama decyzja co przy zwrocie w 0.180.0 i przy reklamacji.

   TA KOLUMNA JEST CHUDSZA OD REKLAMACYJNEJ I MÓWI TO WPROST. Dyskusja nie
   niesie powodu, oczekiwania, tytułu prawnego, kwoty ani oferty — schemat
   opisuje każde z tych pól jako nieobecne przy `type: "DISPUTE"`. Rysowanie
   pustych wierszy „—" udawałoby, że dane są, tylko puste; sekcja, której nie
   ma, mówi prawdę taniej.

   ADRESU SAMEJ DYSKUSJI W CENTRUM SPRZEDAŻY NIE ZGADUJEMY. Wzorzec
   `/claims/{id}` dotyczy reklamacji, a wywiedziony z analogii dał już raz 404
   (blizna 0.226.1) — dlatego jedynym odnośnikiem jest ZAMÓWIENIE, adres
   sprawdzony, prowadzący tam, skąd dyskusję widać.

   Wszystko poniżej to ODCZYT. Dwa zapisy tego ekranu — „prowadzę" i notatka —
   są jawnymi kliknięciami, nie skutkiem ubocznym patrzenia.                 */

const Wiersz = ({ etykieta, children }: { etykieta: string; children: React.ReactNode }) =>
  <div className="flex items-baseline gap-2 py-1 text-sm">
    <EtykietaWartosci className="w-32 shrink-0">{etykieta}</EtykietaWartosci>
    <span className="min-w-0 flex-1 text-slate-800">{children}</span>
  </div>;

const Sekcja = ({ tytul, children }: { tytul: string; children: React.ReactNode }) =>
  <section className="border-t border-slate-200 px-4 py-3 first:border-t-0">
    <NaglowekSekcji jako="h3" className="mb-1">{tytul}</NaglowekSekcji>
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
function Notatka({ dyskusja, trwa, blad, onZapisz, onCofnij }: {
  dyskusja: Dyskusja;
  trwa: boolean;
  blad: string;
  onZapisz: (tekst: string) => void;
  /* Cofnięcie jest OPCJONALNE tym samym wzorcem co reszta: czego nie da się
     zrobić, tego nie ma na ekranie. */
  onCofnij?: () => void;
}) {
  const [tekst, setTekst] = useState(dyskusja.notatka ?? "");
  /* Przełączenie sprawy podmienia treść pola. Bez tego notatka poprzedniej
     zostawałaby w edytorze i dało się ją zapisać na cudzej dyskusji. */
  useEffect(() => { setTekst(dyskusja.notatka ?? ""); }, [dyskusja.id, dyskusja.notatka]);
  const zmienione = tekst.trim() !== (dyskusja.notatka ?? "").trim();
  return <div className="flex flex-col gap-2">
    <label className="sr-only" htmlFor="notatka-dyskusji">Notatka biura</label>
    <textarea id="notatka-dyskusji" rows={3} value={tekst}
      onChange={(e) => setTekst(e.target.value)}
      placeholder="Ustalenia, których Allegro nie zna"
      className="field resize-y text-sm" />
    {blad && <p className="text-xs text-red-700">{blad}</p>}
    {/* Przycisk staje dopiero przy ZMIANIE (@wydanie). Główny, bursztynowy
        guzik stał pod pustym polem przy każdej dyskusji i był najgłośniejszą
        rzeczą w kolumnie faktów, choć nie było czego zapisać. Wyszarzony
        zaprasza do kliknięcia i odmawia; zapis i tak zaczyna się od pisania. */}
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
    {dyskusja.notatkaPrzez && <p className="text-podpis text-slate-600">
      Zmiana: {dyskusja.notatkaPrzez}, {czas(dyskusja.notatkaAt)}
      {onCofnij && dyskusja.maPoprzedniaNotatke && <>
        {" · "}
        <button type="button" disabled={trwa} onClick={onCofnij}
          className="py-1 font-semibold text-slate-700 underline disabled:opacity-50">
          cofnij zmianę</button>
      </>}
    </p>}
  </div>;
}

export function Fakty({
  szczegol, trwa, bladZapisu, onNotatka, onCofnijNotatke, tagi,
  onSprawdzPrzesylke, sprawdzaPrzesylke = false, bladPrzesylki = "",
}: {
  szczegol: SzczegolDyskusji;
  trwa: boolean;
  bladZapisu: string;
  onNotatka: (tekst: string) => void;
  /** Cofnięcie ZMIANY notatki (0.280.0) — §25a.5. */
  onCofnijNotatke?: () => void;
  /* Pytanie o paczkę (0.393.0). Opcjonalne tym samym wzorcem co tagi: bez
     procedury zapytania przycisku nie rysujemy wcale, a nie rysujemy
     martwego. */
  onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean;
  bladPrzesylki?: string;
  /* Opcjonalne tym samym wzorcem co przy reklamacji: czego nie da się zrobić,
     tego nie ma na ekranie. */
  tagi?: {
    slownik: Tag[];
    trwa: boolean;
    blad: string;
    onPrzypnij: (tagId: number) => void;
    onOdepnij: (tagId: number) => void;
    onNowy: (nazwa: string) => void;
  };
}) {
  const d = szczegol.dyskusja;
  return <div className="flex min-h-0 flex-col">
    {/* ── SPRAWA I STAN ZWINIĘTE (@wydanie) ───────────────────────────────────
        Zgłoszenie agentów: „aplikacja przytłacza". Obie sekcje stały otwarte
        przy każdej dyskusji, a ich treść — temat, login, liczba wiadomości —
        powtarza wiersz kolejki i nagłówek rozmowy obok. Ten sam ruch co
        w kolumnie reklamacji od 0.403.0: podpis zwijki mówi najważniejsze,
        reszta jest jedno kliknięcie dalej, a wybór pamięta stanowisko. */}
    <div className="px-2 pb-2">
      <Zwijka tytul="Sprawa" Ikona={MessagesSquare} podpis={podpisSprawy(d)}
        pamietajJako="wertis.dyskusje.sprawa">
        <div className="px-2 py-2">
          <Wiersz etykieta="Temat">{d.temat ?? "bez tematu"}</Wiersz>
          <Wiersz etykieta="Kupujący">{d.kupujacyLogin
            ? <span className="inline-flex flex-wrap items-center gap-2"><LoginKlienta login={d.kupujacyLogin} />
                <PrzyciskHistorii rodzaj="sprawa" id={d.id} tutaj="tą dyskusją" /></span>
            : "—"}</Wiersz>
          <Wiersz etykieta="Otwarto">{czas(d.otwartoAt)}</Wiersz>
        </div>
      </Zwijka>

      <Zwijka tytul="Stan" Ikona={Activity} podpis={podpisStanu(d)}
        pamietajJako="wertis.dyskusje.stan">
        <div className="px-2 py-2">
          {/* TERMINU TU NIE MA i to nie jest brak danych. Allegro nie oddaje przy
              dyskusji ani `decisionDueDate`, ani `statusDueDate`; jedyną miarą
              pilności jest to, jak długo piłka leży po naszej stronie.

              Dopisek „Allegro terminu tu nie stawia" zszedł (@wydanie): to było
              zdanie programisty do agenta, a agent nie szukał tu terminu. */}
          <Wiersz etykieta="Czeka na nas">{czekaSlowem(d)}</Wiersz>
          {/* ── STATUS DOMYŚLNY NIE JEST INFORMACJĄ (@wydanie) ────────────────
              Ta sama reguła co w głowicy reklamacji od 0.414.0.
              `DISPUTE_ONGOING` ma każda trwająca dyskusja, więc wiersz mówił
              „to zwykła dyskusja". Staje tylko, gdy stan ODBIEGA od
              domyślnego — zamknięta albo nierozstrzygnięta. */}
          {d.statusAllegro && d.statusAllegro !== STATUS_DOMYSLNY &&
            <Wiersz etykieta="Status Allegro">{d.statusAllegro}</Wiersz>}
          <Wiersz etykieta="Rozmowa">
            {d.czatAktywny ? "otwarta" : "zamknięta przez Allegro"}
            {` · ${d.wiadomosciIle} wiadomości`}
          </Wiersz>
        </div>
      </Zwijka>
    </div>

    <Sekcja tytul="Kontekst zakupu">
      <Wiersz etykieta="Zamówienie">
        {d.orderId
          ? <><Link href={d.linkZamowienia}>{d.orderId}</Link>
              <Skopiuj tekst={d.orderId} tytul="Kopiuj numer zamówienia" /></>
          : "dyskusja bez numeru zamówienia"}
      </Wiersz>

      {/* ── CENY I PACZKA (0.393.0) ─────────────────────────────────────────
          Ten sam blok co w `reklamacje/Dowody.tsx` i stoi tu z tego samego
          powodu: dyskusja zwykle POPRZEDZA reklamację, więc pytanie „ile on
          zapłacił" i „czy to w ogóle dostał" pada tu wcześniej, nie później.
          Dwie kolejki mają odpowiadać jednakowo — doktryna jednej drogi.

          Dostawa osobno od sumy: klient żądający zwrotu pyta czasem właśnie
          o nią, a sklejenie kazałoby liczyć w głowie. */}
      {szczegol.zamowienie && <>
        <ul className="mt-1 space-y-0.5">
          {szczegol.zamowienie.pozycje.map((p, i) =>
            <li key={`${p.offerId ?? p.sku ?? i}`}
              className="flex items-baseline gap-2 rounded bg-slate-50 px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate">{p.nazwa}</span>
              <span className="shrink-0 tabular-nums text-slate-600">
                {p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
            </li>)}
        </ul>
        <Wiersz etykieta="Dostawa">
          {zlote(szczegol.zamowienie.dostawaGrosze, szczegol.zamowienie.waluta)}
          {szczegol.zamowienie.dostawaMetoda &&
            <span className="text-slate-500"> · {szczegol.zamowienie.dostawaMetoda}</span>}
        </Wiersz>
        <Wiersz etykieta="Razem">
          <b className="tabular-nums">
            {zlote(szczegol.zamowienie.sumaGrosze, szczegol.zamowienie.waluta)}</b>
        </Wiersz>
      </>}

      {szczegol.przesylka && <Wiersz etykieta="Przesyłka">
        {szczegol.przesylka.sprawdzonoAt === null
          ? <span className="text-slate-500">nie pytaliśmy jeszcze Allegro</span>
          : szczegol.przesylka.waybill === null
            ? <span className="text-slate-500">Allegro nie ma numeru — paczka
                jeszcze nienadana albo nadana poza Allegro</span>
            : <>
                {szczegol.przesylka.dostarczonoAt
                  ? <b className="text-ranga-ok">doręczona {czas(szczegol.przesylka.dostarczonoAt)}</b>
                  : <span>{szczegol.przesylka.status ?? "przewoźnik nie podał statusu"}</span>}
                <span className="text-slate-500"> · {szczegol.przesylka.przewoznik}{" "}
                  <span className="font-mono">{szczegol.przesylka.waybill}</span></span>
              </>}
        {onSprawdzPrzesylke && <button type="button" disabled={sprawdzaPrzesylke}
          onClick={onSprawdzPrzesylke}
          className="ml-2 font-semibold underline underline-offset-2 disabled:opacity-50">
          {sprawdzaPrzesylke ? "pytam…" : "sprawdź"}</button>}
        {bladPrzesylki && <p className="text-xs text-red-700">{bladPrzesylki}</p>}
      </Wiersz>}
    </Sekcja>

    {/* ── JEDNA SEKCJA ZAMIAST CZTERECH (@wydanie) ────────────────────────────
        Ten sam ruch, który kolumna reklamacji zrobiła w 0.416.0; pełny powód
        stoi tam, w `reklamacje/Dowody.tsx`. Pod kolumną dyskusji zostały
        CZTERY sekcje o jednym zakupie: zwroty, inne sprawy, droga i rozmowy.
        Dwie ostatnie miały przy tym podwójny nagłówek — sekcja nad blokiem,
        który rysował własny, bo nie dostał `wSekcji`.

        DROGA JEST NADZBIOREM: `services/droga-klienta.ts` składa przystanki
        z tych samych tabel, z których serwis dyskusji bierze zwroty i rozmowy
        (wspólne `kontekstZamowienia`). Każdy przystanek prowadzi do swojej
        kolejki, więc z drogi da się wejść wszędzie tam, gdzie prowadziły
        tamte listy.

        ZOSTAJE RODZEŃSTWO SPRAW, i przy dyskusji jest ważniejsze niż gdzie
        indziej. Dyskusja zwykle poprzedza reklamację, więc agent ma widzieć,
        czy sprawa poszła już dalej, i nie obiecywać w tym kanale
        rozstrzygnięcia, nad którym kanał stracił władzę. */}
    {(szczegol.droga.length > 1 || szczegol.sprawy.length > 0) &&
      <Sekcja tytul="Ten zakup u nas">
        {szczegol.droga.length > 1 && <DrogaZakupu droga={szczegol.droga}
          tutaj={{ rodzaj: "dyskusja", id: d.id }} wSekcji />}
        {szczegol.sprawy.length > 0 && <div className={szczegol.droga.length > 1 ? "mt-1.5" : ""}>
          <SprawyZakupu sprawy={szczegol.sprawy} wSekcji />
        </div>}
      </Sekcja>}

    {/* Zlecenie hali z dyskusji (0.502.0) — powód w `sprawy/ZlecHali.tsx`.
        Dyskusja nie ma numeru od Allegro (§25c.1), więc tytuł niesie temat.

        Nagłówek „Hala" zszedł (@wydanie): stał nad jednym przyciskiem, który
        sam mówi „Zleć hali", więc powtarzał jego napis. */}
    <div className="border-t border-slate-200 px-4 py-2">
      <ZlecHali zrodlo="dyskusja" zrodloRef={d.id} tytul={`Dyskusja — ${d.temat ?? `#${d.id}`}`} />
    </div>

    {/* „Prowadzi" zeszło do ŚRODKOWEJ kolumny (0.392.0) — ten sam ruch i ten
        sam powód co przy reklamacji: wzięcie sprawy jest czynnością, a ta
        kolumna niesie fakty. Oba ekrany mają zostać bliźniacze. */}
    <Sekcja tytul="Praca biura">
      {/* Tagi nad notatką — powód przy tej samej sekcji w `reklamacje/Dowody.tsx`. */}
      {tagi && <div className="mt-3">
        <TagiSprawy przypiete={d.tagi} slownik={tagi.slownik} trwa={tagi.trwa}
          blad={tagi.blad} onPrzypnij={tagi.onPrzypnij} onOdepnij={tagi.onOdepnij}
          onNowy={tagi.onNowy} />
      </div>}
      <div className="mt-3">
        <Notatka dyskusja={d} trwa={trwa} blad={bladZapisu} onZapisz={onNotatka}
          onCofnij={onCofnijNotatke} />
      </div>
    </Sekcja>
  </div>;
}

/** Status, który ma każda trwająca dyskusja — nie wołamy go wierszem. */
const STATUS_DOMYSLNY = "DISPUTE_ONGOING";

/** Jak długo piłka leży u nas — słowem, bo terminu dyskusja nie ma. */
function czekaSlowem(d: Dyskusja): string {
  if (d.czekaOdDni === null) return "ruch należy do klienta";
  return d.czekaOdDni === 0 ? "od dziś" : dniSlowo(d.czekaOdDni);
}

/** Co stoi w sprawie — kto i od kiedy, żeby zamknięta zwijka nie kazała zgadywać. */
function podpisSprawy(d: Dyskusja): string {
  return [d.kupujacyLogin, d.otwartoAt ? `otwarto ${dzien(d.otwartoAt)}` : null]
    .filter(Boolean).join(" · ");
}

/**
 * Co stoi w stanie — czyj ruch, status spoza domyślnego i ile wiadomości.
 *
 * Czekanie idzie PIERWSZE, bo przy dyskusji to jedyna miara pilności.
 * Zwinięta zwijka nie może jej chować — dlatego stoi w podpisie. Z tego
 * samego powodu staje tu status ODBIEGAJĄCY od domyślnego: wiersz, który ma
 * wołać o uwagę, nie może czekać za kliknięciem.
 *
 * Przy zamkniętej rozmowie „ruch klienta" byłoby nieprawdą — nikt już nie
 * odpisze. Serwer oddaje wtedy puste czekanie, więc rozstrzygamy to tutaj.
 */
function podpisStanu(d: Dyskusja): string {
  const ruch = !d.czatAktywny ? "rozmowa zamknięta"
    : d.czekaOdDni !== null ? `czeka na nas ${czekaSlowem(d)}`
      : d.ruchNasz ? "czeka na nas" : "ruch klienta";
  const status = d.statusAllegro && d.statusAllegro !== STATUS_DOMYSLNY ? d.statusAllegro : null;
  return [ruch, status, ile(d.wiadomosciIle, "wiadomość", "wiadomości", "wiadomości")]
    .filter(Boolean).join(" · ");
}
