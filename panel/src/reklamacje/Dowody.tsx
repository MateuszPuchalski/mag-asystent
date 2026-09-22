import React, { useEffect, useState } from "react";
import { Bot, Coins, ExternalLink, Gavel, NotebookPen, Receipt, Undo2 } from "lucide-react";
import type {
  CenaPoziomu, PozycjaZamowienia, RadaMaszyny, Reklamacja, SladHistorii, SzczegolReklamacji, Tag,
  Werdykt, ZdjecieKarty,
} from "../api/typy";
import { TagiSprawy } from "../sprawy/Tagi";
import { DrogaZakupu, SprawyZakupu } from "../sprawy/Spoiwo";
import { zlote } from "../api/zwroty";
import {
  EtykietaWartosci, NaglowekSekcji, czas, dzien, dniSlowo, ile, LoginKlienta, odmien, Przycisk,
  Skopiuj,
} from "../ui";
import { Kafel, KafelOferty } from "../towar/Kafel";
import { CenyKartoteki } from "../skrzynka/TowarRozmowy";
import { useKartaTowaru } from "../api/rozmowy";
import { OCZEKIWANIA, POWODY } from "./Kolejka";
import { NAZWA_WERDYKTU } from "./statusy";
import { Zwijka } from "../skrzynka/Zwijka";

/* ── Kolumna dowodów o reklamacji ────────────────────────────────────────────
   Jedna lista faktów o jednej sprawie, więc SEKCJE jedna pod drugą, a nie
   zakładki — ta sama decyzja co przy zwrocie w 0.180.0. Zakładki mają sens
   tam, gdzie kolumna niesie dwa RÓWNORZĘDNE tematy; tutaj jest jeden.

   Wszystko poniżej to ODCZYT. Jedyne dwa zapisy tego ekranu — „prowadzę"
   i notatka — są jawnymi kliknięciami, nie skutkiem ubocznym patrzenia. */

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
    <Przycisk wariant="glowny" disabled={!zmienione || trwa}
      onClick={() => onZapisz(tekst)}>
      {trwa ? "Zapisuję…" : "Zapisz notatkę"}
    </Przycisk>
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
 * Karta faktów Copilota (0.275.0) — CO WYCZYTAŁ, nigdy co radzi.
 *
 * Werdyktu tu nie ma i nie będzie: uznanie i odrzucenie są nieodwracalne wobec
 * kupującego i należą do człowieka. Najcenniejsza pozycja to „brakuje" —
 * sprawa stoi tygodniami nie dlatego, że nikt nie umie zdecydować, tylko
 * dlatego, że nikt nie zapytał o zdjęcie tabliczki.
 *
 * Każde zdanie niesie CYTAT, czyli numer wiadomości. Bez niego karta byłaby
 * drugą wersją rozmowy, a nie skrótem tej, którą agent ma przed oczami.
 */
function KartaFaktow({ karta, trwa, blad, onRozpoznaj }: {
  karta: SzczegolReklamacji["karta"];
  trwa: boolean;
  blad: string;
  onRozpoznaj: () => void;
}) {
  return <section className="border-t border-slate-200 px-4 pb-3 pt-1 first:border-t-0">
    {/* ── KARTA ZWIJA SIĘ (0.389.0) ─────────────────────────────────────────
        Zgłoszenie właściciela: „zasłania sporo ekranu po prawej stronie".
        Ta kolumna jest DOWODAMI — zamówieniem, ofertą, kartoteką, rozmowami
        o tym zakupie — a karta maszyny rosła nad nimi i spychała je poniżej
        krawędzi okna. Dekalog ergonomii, punkt 2: na wierzchu to, co
        rozstrzyga bieżącą czynność; reszta zwinięta, nie na drugim ekranie.

        DOMYŚLNIE OTWARTA, a nie zamknięta: zwinięcie na starcie zabrałoby
        kartę tym, którzy jej używają, a zgłoszenie mówiło o MOŻLIWOŚCI
        zwinięcia, nie o ukryciu. Jedno kliknięcie zamyka ją na stałe.

        Podpis niesie treść karty w jednym zdaniu, więc zamknięta mówi, czy
        warto ją otwierać — inaczej agent klikałby, żeby się dowiedzieć. */}
    <Zwijka
      tytul="Co wyczytał Copilot"
      Ikona={Bot}
      podpis={podpisKarty(karta)}
      plakietka={karta && karta.brakuje.length > 0
        ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-podpis font-bold text-amber-900">
            {ile(karta.brakuje.length, "brak", "braki", "braków")}</span>
        : undefined}
      /* ZWINIĘTA DOMYŚLNIE — decyzja właściciela z 18 września 2026, po
         zobaczeniu wersji otwartej na własnym ekranie.
         
         Odradzałem to w 0.389.0: zamknięty blok chowa „PRZECZYTAJ SPRAWĘ" za
         kliknięciem przy każdej nieprzeczytanej sprawie. Właściciel zna ten
         koszt i wybrał miejsce na ekranie — jego decyzja, jego kolumna.
         
         Cena jest mniejsza, niż wyglądała: `pamietajJako` pamięta ROZWINIĘCIE
         tak samo jak zwinięcie, więc agent pracujący z Copilotem otwiera blok
         raz, a nie przy każdej sprawie. Podpis nagłówka mówi, co w środku,
         więc zamknięty blok nie każe zgadywać. */
      pamietajJako="wertis.reklamacje.copilot"
    >
    <div className="px-2 py-2">
    {blad && <p className="py-1 text-xs text-red-700">{blad}</p>}
    {karta ? <>
      {karta.rada && <Rada rada={karta.rada} ocena={karta.ocena} />}
      {karta.usterka && <Wiersz etykieta="Usterka">
        {karta.usterka.tresc} <Cytat z={karta.usterka.zrodlo} zdjecia={karta.zdjecia} /></Wiersz>}
      {karta.kiedy && <Wiersz etykieta="Od kiedy">
        {karta.kiedy.tresc} <Cytat z={karta.kiedy.zrodlo} zdjecia={karta.zdjecia} /></Wiersz>}
      {karta.oczekiwanie && <Wiersz etykieta="Klient chce">
        {karta.oczekiwanie.tresc} <Cytat z={karta.oczekiwanie.zrodlo} zdjecia={karta.zdjecia} /></Wiersz>}
      {karta.dowody.length > 0 && <Wiersz etykieta="Dowody">
        {karta.dowody.map((d, i) => <span key={i} className="mr-2">
          {d.tresc} <Cytat z={d.zrodlo} zdjecia={karta.zdjecia} /></span>)}
      </Wiersz>}
      {karta.brakuje.length > 0 && <div className="mt-1 rounded-lg bg-amber-50 px-3 py-2">
        <EtykietaWartosci>Brakuje do rozstrzygnięcia</EtykietaWartosci>
        <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
          {karta.brakuje.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </div>}
      {/* ── CO KARTA PRZECZYTAŁA (0.283.0) ──────────────────────────────────
          Bez tej liczby „Copilot nic nie zobaczył na zdjęciu" i „Copilot nie
          dostał zdjęć" wyglądają na ekranie identycznie — a to dwie zupełnie
          różne sprawy i dwa różne następne ruchy agenta. */}
      <p className="pt-2 text-xs text-slate-500">
        {karta.przez ?? "—"}, {czas(karta.at)} · {karta.model}
        {karta.zdjecia.length > 0 && ` · przeczytał ${zdjecSlowo(karta.zdjecia.length)}`}
      </p>
    </> : <p className="pt-1 text-xs text-slate-500">Werdykt zostaje przy Tobie.</p>}
    <Przycisk className="mt-2 !px-2 !py-1 !text-xs" disabled={trwa} onClick={onRozpoznaj}>
      {trwa ? "CZYTAM…" : karta ? "PRZECZYTAJ JESZCZE RAZ" : "PRZECZYTAJ SPRAWĘ"}
    </Przycisk>
    </div>
    </Zwijka>
  </section>;
}

/**
 * Co stoi w karcie — jedno zdanie do nagłówka zamkniętego bloku.
 *
 * Bez niego zamknięta karta mówiłaby wyłącznie „Copilot" i agent musiałby ją
 * otwierać, żeby sprawdzić, czy jest tam cokolwiek. To jest dokładnie ten
 * jeden klik, dla którego blok się zwija.
 */
function podpisKarty(karta: SzczegolReklamacji["karta"]): string {
  /* Bez karty podpis tłumaczy, CO ten blok robi — to samo zdanie, które do
     0.388.1 stało w trzech linijkach prozy nad przyciskiem. W nagłówku zajmuje
     jedną linię i znika, gdy karta już jest. */
  if (!karta) return "wyczyta usterkę, oczekiwanie i braki";
  const ma: string[] = [];
  if (karta.rada) ma.push("rada");
  if (karta.usterka) ma.push("usterka");
  if (karta.oczekiwanie) ma.push("oczekiwanie klienta");
  if (karta.dowody.length > 0) ma.push("dowody");
  return ma.length ? ma.join(", ") : "przeczytał, ale nic nie wyczytał";
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

/**
 * Rada maszyny (0.276.0) — PODPISANA, żeby nie pomylić autora.
 *
 * Do 0.275.0 Copilot nie radził wcale; właściciel odwrócił tę decyzję.
 * Rada stoi więc na ekranie, ale w ramce z własnym nagłówkiem i nigdy nie
 * dotyka formularza werdyktu: agent klika „UZNAJĘ" sam i sam potwierdza
 * zgodę. Allegro nie przyjmie drugiego werdyktu w sprawie, więc różnica
 * między „przeczytaj i zdecyduj" a „potwierdź" jest tu nieodwracalna.
 *
 * „Czego nie wiem" stoi PRZY pewności, nie pod spodem: deklaracja pewności
 * bez tej listy byłaby brawurą, a serwer odrzuca takie karty.
 */
function Rada({ rada, ocena }: { rada: RadaMaszyny; ocena: string | null }) {
  const nazwa = rada.co === "POPROSIC_O_DOWODY"
    ? "Poprosić o dowody — nie ma jeszcze czego rozstrzygać"
    : NAZWA_WERDYKTU[rada.co as Werdykt] ?? rada.co;
  return <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
    <div className="flex flex-wrap items-baseline gap-2">
      <EtykietaWartosci>Copilot radzi</EtykietaWartosci>
      <b className="text-sm text-slate-800">{nazwa}</b>
      <span className="text-podpis text-slate-600">pewność {rada.pewnosc}</span>
      {/* Trafność liczy się z werdyktu, który agent naprawdę wysłał — nie
          z ankiety. Przed werdyktem nie ma jej wcale i tak ma być. */}
      {ocena && <span className={`rounded px-1 text-podpis ${
        ocena === "trafna" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
        rada {ocena}</span>}
    </div>
    <p className="mt-1 text-sm text-slate-800">
      {rada.uzasadnienie.tresc} <Cytat z={rada.uzasadnienie.zrodlo} />
    </p>
    {rada.czegoNieWiem.length > 0 && <p className="mt-1 text-podpis text-slate-600">
      Czego nie wie: {rada.czegoNieWiem.join(", ")}
    </p>}
    <p className="mt-2 text-podpis text-slate-600">
      Werdykt wydajesz Ty — ta rada nie wypełnia formularza.
    </p>
  </div>;
}

/**
 * Numer wiadomości, z której model wziął zdanie.
 *
 * Szczebel `podpis` z drabiny, nie arbitralne piksele — i `text-slate-600`,
 * bo `slate-500` na `slate-100` daje 4,34:1 przy progu 4,5. Obie rzeczy
 * wyłapały strażnice panelu, zanim zobaczył je człowiek; zostawiam to zdanie,
 * żeby następny nie sprawdzał tego drugi raz.
 */
/** „1 zdjęcie", „2 zdjęcia", „5 zdjęć" — trzy formy, jak przy sprawach. */
function zdjecSlowo(n: number): string {
  const ostatnia = n % 10;
  const dwie = n % 100;
  if (n === 1) return "1 zdjęcie";
  if (ostatnia >= 2 && ostatnia <= 4 && !(dwie >= 12 && dwie <= 14)) return `${n} zdjęcia`;
  return `${n} zdjęć`;
}

const Cytat = ({ z, zdjecia = [] }: { z: string; zdjecia?: ZdjecieKarty[] }) => {
  /* ── CYTAT ZE ZDJĘCIA MUSI DAĆ SIĘ SPRAWDZIĆ (0.283.0) ────────────────────
     `W3` agent znajdzie w rozmowie obok. `Z2` bez nazwy pliku jest numerem
     donikąd, a sprawdzalny cytat jest całą doktryną tej karty — dlatego
     podpowiedź mówi, o który plik chodziło. */
  const plik = zdjecia.find((p) => p.numer === z);
  return <span title={plik ? `Zdjęcie: ${plik.nazwa}` : undefined}
    className="rounded bg-slate-100 px-1 font-mono text-podpis text-slate-600">{z}</span>;
};

export function Dowody({
  szczegol, trwa, bladZapisu, onNotatka, onCofnijNotatke,
  rozpoznaje = false, bladRozpoznania = "", onRozpoznaj,
  onSprawdzPrzesylke, sprawdzaPrzesylke = false, bladPrzesylki = "",
  tagi,
}: {
  szczegol: SzczegolReklamacji;
  trwa: boolean;
  bladZapisu: string;
  onNotatka: (tekst: string) => void;
  /** Cofnięcie ZMIANY notatki (0.280.0) — §25a.5. */
  onCofnijNotatke?: () => void;
  /* Tagi są OPCJONALNE tym samym wzorcem co Copilot: czego nie da się zrobić,
     tego nie ma na ekranie — sekcja bez obsługi byłaby obietnicą bez pokrycia. */
  tagi?: {
    slownik: Tag[];
    trwa: boolean;
    blad: string;
    onPrzypnij: (tagId: number) => void;
    onOdepnij: (tagId: number) => void;
    onNowy: (nazwa: string) => void;
  };
  /* Copilot jest OPCJONALNY w propsach, bo ten sam komponent rysuje sprawę
     także tam, gdzie rozpoznania nie ma po co wołać. */
  rozpoznaje?: boolean;
  bladRozpoznania?: string;
  onRozpoznaj?: () => void;
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

  return <div className="flex min-h-0 flex-col">
    <Glowica r={r} />
    <Towar szczegol={szczegol} pozycja={pozycja} />
    <Triaz szczegol={szczegol} pozycja={pozycja} />

    <div className="px-2">
      <Zwijka
        tytul="Zakup"
        Ikona={Receipt}
        podpis={podpisZakupu(szczegol)}
        /* OTWARTY DOMYŚLNIE, jako jedyny z trzech: kwoty rozstrzygają spór
           o zwrot pieniędzy, a to najczęstsze oczekiwanie w sondzie. */
        domyslnieOtwarte
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

          {/* ── GDZIE JEST PACZKA (0.393.0) ─────────────────────────────────
              Przy reklamacji to pytanie pierwsze: „czy on to w ogóle dostał".

              Ładunek zamówienia numeru przesyłki NIE MA — stoi pod osobną
              końcówką `/order/checkout-forms/{id}/shipments`, a status pod tą
              samą, którą zwroty odpytują od 0.187.0. Dwa żądania, więc pytamy
              na JAWNE kliknięcie: żądanie u dostawcy nie wychodzi z patrzenia. */}
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

          <div className="mt-1 border-t border-slate-200 pt-1">
            <Wiersz etykieta="Zamówienie">
              {r.orderId
                ? <><Link href={r.linkZamowienia}>{r.orderId}</Link>
                    <Skopiuj tekst={r.orderId} tytul="Kopiuj numer zamówienia" /></>
                : "reklamacja bez numeru zamówienia"}
            </Wiersz>
            {/* ── DATA ZAKUPU NA EKRANIE (0.282.0) ──────────────────────────
                ETYKIETA MÓWI, KTÓRY TO ZEGAR: „Kupiono" bierze się z pozycji
                zamówienia, „Zamówienie złożone" z ładunku sprawy i bywa
                wcześniejsze. Blizna 0.121.0 wzięła się z nazwania jednego
                zegara drugim, więc nie sklejamy ich pod jedną etykietą. */}
            {r.kupionoAt && <Wiersz
              etykieta={r.kupionoZrodlo === "zamowienie" ? "Kupiono" : "Zamówienie złożone"}>
              {czas(r.kupionoAt)}
            </Wiersz>}
            <Wiersz etykieta="Oferta">
              {r.offerId ? <Link href={r.linkOferty}>{r.offerId}</Link> : "—"}
            </Wiersz>
          </div>
        </div>
      </Zwijka>

      {/* ── SPRAWA ZWINIĘTA, BO GŁOWICA JĄ JUŻ POWIEDZIAŁA (0.403.0) ─────────
          Termin, kwota, tytuł prawny, powód i status stoją wyżej — tu zostają
          IDENTYFIKATORY i stan rozmowy, czyli to, czego szuka się wtedy, gdy
          trzeba coś skopiować albo sprawdzić, czy Allegro jeszcze słucha. */}
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
            ? <LoginKlienta login={r.kupujacyLogin} /> : "—"}</Wiersz>
          <Wiersz etykieta="Zgłoszono">{czas(r.otwartoAt)}</Wiersz>
          {/* Statusu Allegro tu NIE MA i to nie jest przeoczenie: stoi
              znacznikiem w głowicy. Dwa miejsca na jedną wartość to dwa
              miejsca do przeczytania i jedno do rozjechania się. */}
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

    {/* Zwroty tego zamówienia — mostkiem jest numer zamówienia, ten sam
        mechanizm co przy rozmowie od 0.221.0. Reklamacja NIE zakłada zwrotu
        i nie wiąże go: to dwa różne tytuły prawne. */}
    {szczegol.zwroty.length > 0 && <Sekcja tytul="Zwroty tego zamówienia">
      <ul className="flex flex-col gap-1">
        {szczegol.zwroty.map((z) => <li key={z.id} className="text-sm">
          <a href={`/obsluga/zwroty/${z.id}`}
            className="inline-flex items-center gap-1 underline underline-offset-2">
            <Undo2 size={12} />{z.numer ?? z.externalId}</a>
          <span className="ml-2 text-slate-500">{czas(z.utworzono)}</span>
        </li>)}
      </ul>
    </Sekcja>}

    {/* Rodzeństwo posprzedażowe i droga zakupu (S1 i S3 spoiwa,
        `docs/obsluga-klienta-calosc.md`). Reklamacja i dyskusja leżą w JEDNEJ
        tabeli i do 0.386.0 nie widziały się nawzajem — dyskusja, która urosła
        w tę reklamację, była osobnym wierszem bez śladu po przejściu. */}
    {szczegol.sprawy.length > 0 && <Sekcja tytul="Inne sprawy tego zakupu">
      <SprawyZakupu sprawy={szczegol.sprawy} wSekcji />
    </Sekcja>}

    {szczegol.droga.length > 1 && <Sekcja tytul="Droga tego zakupu">
      <DrogaZakupu droga={szczegol.droga} tutaj={{ rodzaj: "reklamacja", id: r.id }} wSekcji />
    </Sekcja>}

    {szczegol.rozmowy.length > 0 && <Sekcja tytul="Rozmowy o tym zakupie">
      <ul className="flex flex-col gap-1">
        {szczegol.rozmowy.map((c) => <li key={c.id} className="text-sm">
          <a href={`/obsluga/skrzynka/${c.id}`} className="underline underline-offset-2">
            {c.temat ?? `Rozmowa ${c.id}`}</a>
          <span className="ml-2 text-slate-500">{czas(c.ostatniaAt)}</span>
        </li>)}
      </ul>
    </Sekcja>}

    {/* ── COPILOT NA DOLE (0.403.0) ───────────────────────────────────────────
        Do tego wydania karta maszyny stała PIERWSZA, nad faktami sprawy.
        Kolejność czytania powinna iść za kolejnością zaufania: najpierw to,
        co przyszło z Allegro i z paragonu, dopiero potem to, co wyczytał
        model. Karta i tak jest zwinięta (decyzja właściciela z 18 września),
        więc zejście na dół nie zabiera ani jednego kliknięcia. */}
    {onRozpoznaj && <KartaFaktow karta={szczegol.karta} trwa={rozpoznaje}
      blad={bladRozpoznania} onRozpoznaj={onRozpoznaj} />}
  </div>;
}

/* ── GŁOWICA NIESIE WERDYKT (0.403.0) ────────────────────────────────────────
   Zgłoszenie właściciela ze zrzutem całego ekranu: „panel wygląda chaotycznie".
   Prawa kolumna miała dwadzieścia jeden wierszy w JEDNEJ WADZE — „Tytuł:
   rękojmia" ważyło dokładnie tyle, co kwota żądania i termin decyzji.

   Trzy rzeczy rozstrzygają, czy agent uzna, czy odrzuci: ILE klient chce,
   DO KIEDY trzeba zdecydować i z JAKIEGO tytułu. One idą na górę, w stopniu
   widocznym z drugiego końca biurka; reszta schodzi do zwijek. Dekalog
   ergonomii, punkt 2 (pierwszeństwo tego, co rozstrzyga bieżącą czynność)
   i punkt 1 (mniej decyzji przy jednym spojrzeniu).

   KWOTA NA PIERWSZYM MIEJSCU tylko wtedy, gdy Allegro ją podało. Bez kwoty
   w tym miejscu staje SŁOWO oczekiwania — pusty slot po kwocie kazałby
   szukać liczby, której nie ma. */
function Glowica({ r }: { r: Reklamacja }) {
  const termin = terminSlowem(r);
  const oczekiwanie = r.oczekiwanie ? (OCZEKIWANIA[r.oczekiwanie] ?? r.oczekiwanie) : null;
  const kwota = r.oczekiwanaKwotaGrosze !== null
    ? zlote(r.oczekiwanaKwotaGrosze, r.waluta) : null;
  return <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0">
        <EtykietaWartosci>Klient chce</EtykietaWartosci>
        <p className="mt-0.5 text-2xl font-bold leading-none tracking-tight text-slate-900">
          <span className={kwota ? "tabular-nums" : ""}>{kwota ?? oczekiwanie ?? "—"}</span>
        </p>
        <p className="mt-1 text-xs text-slate-700">
          {kwota && oczekiwanie ? `${oczekiwanie} · ` : ""}
          {r.zwrotWymagany === null ? "zwrot towaru nierozstrzygnięty"
            : r.zwrotWymagany ? "zwrot towaru wymagany" : "zwrot towaru niewymagany"}
        </p>
      </div>
      <div className="ml-auto shrink-0 text-right">
        <EtykietaWartosci>Decyzja do</EtykietaWartosci>
        <p className={`mt-0.5 text-lg font-bold leading-tight ${
          termin.pilny ? "text-ranga-zle" : "text-slate-900"}`}>{termin.napis}</p>
        <p className="mt-0.5 text-xs text-slate-700">
          {r.decyzjaDo ? czas(r.decyzjaDo) : "Allegro nie podało terminu"}</p>
      </div>
    </div>
    {/* Tytuł prawny, powód i status Allegro jako ZNACZNIKI, nie wiersze:
        każde z nich to jedno słowo odpowiedzi, a etykieta obok podwajałaby
        wysokość bez dokładania treści. Tytuł jest mocny, bo rękojmia
        i gwarancja to dwie różne rozmowy z klientem. */}
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Znacznik mocny>
        {r.prawo === "COMPLAINT" ? "rękojmia" : r.prawo === "WARRANTY" ? "gwarancja" : "tytuł nieznany"}
      </Znacznik>
      {r.powodTyp && <Znacznik>{POWODY[r.powodTyp] ?? r.powodTyp}</Znacznik>}
      {r.statusAllegro && <Znacznik>{r.statusAllegro}</Znacznik>}
    </div>
  </div>;
}

const Znacznik = ({ children, mocny = false }: { children: React.ReactNode; mocny?: boolean }) =>
  <span className={`rounded-full border border-slate-300 bg-white px-2 py-0.5 text-podpis ${
    mocny ? "font-semibold text-slate-900" : "text-slate-700"}`}>{children}</span>;

/**
 * Termin jednym słowem — „za 6 dni" zamiast „24.09.2026, 23:59".
 *
 * Data bezwzględna zostaje pod spodem, bo agent czasem jej potrzebuje. Ale
 * pytanie, które zadaje patrząc na sprawę, brzmi „ile mam czasu", a nie
 * „który to dzień" — i odjęcie jednej daty od drugiej w głowie to praca,
 * którą kolumna miała zdjąć. Ta sama zamiana co w kolejce od 0.121.0.
 */
function terminSlowem(r: Reklamacja): { napis: string; pilny: boolean } {
  if (r.poTerminie) return { napis: "po terminie", pilny: true };
  if (r.decyzjaDo === null || r.dniDoTerminu === null) {
    return { napis: "bez terminu", pilny: false };
  }
  if (r.dniDoTerminu === 0) return { napis: "dziś", pilny: true };
  return { napis: `za ${dniSlowo(r.dniDoTerminu)}`, pilny: r.dniDoTerminu <= 3 };
}

/* ── DWA OBRAZY, DWA ŹRÓDŁA (0.223.0) ────────────────────────────────────────
   Lewy to oferta Allegro: dokładnie to, co widział klient, kupując. Prawy to
   kartoteka Subiekta: to, co leży u nas na półce. Przy reklamacji różnica
   między nimi bywa całą sprawą — „niezgodny z opisem" to siedemnaście spraw
   na sto w sondzie.

   SYGNATURA MÓWI, SKĄD JEST (0.403.0). Po 0.400.0 symbol bywa wzięty
   z PARAGONU, a bywa z dzisiejszego mapowania oferty — i to są dwie różne
   rzeczy, gdy sprzedawca przepiął sygnaturę po wyczerpaniu dostawy. Wiersz
   bez tej adnotacji kazał ufać jednakowo obu. */
function Towar({ szczegol, pozycja }: {
  szczegol: SzczegolReklamacji;
  pozycja: PozycjaZamowienia | null;
}) {
  const r = szczegol.reklamacja;
  const symbol = r.twSymbol ?? szczegol.kartoteka?.symbol ?? null;
  return <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3">
    <KafelOferty externalId={r.offerId} stan={r.ofertaZdjecie} rozmiar={56}
      nazwa={r.ofertaNazwa ?? "Oferta"} symbol={r.offerId} />
    <Kafel twId={r.twId} rozmiar={56} nazwa={r.ofertaNazwa ?? "Kartoteka"} symbol={r.twSymbol} />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold leading-snug text-slate-900">
        {r.ofertaNazwa ?? "Oferty nie pobrano"}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-600">
        {symbol
          ? <span className="font-mono font-semibold text-slate-800">{symbol}</span>
          : <span>{szczegol.kartoteka?.powod ?? "bez kartoteki"}</span>}
        {symbol && <span>{r.twZParagonu ? "z paragonu" : "z mapowania oferty"}</span>}
        {pozycja && <span className="tabular-nums">
          {pozycja.ilosc} × {zlote(pozycja.cenaGrosze, pozycja.waluta)}</span>}
      </p>
    </div>
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
function Triaz({ szczegol, pozycja }: {
  szczegol: SzczegolReklamacji; pozycja: PozycjaZamowienia | null;
}) {
  const r = szczegol.reklamacja;
  /* Ten sam hak, co w skrzynce — TanStack trzyma to pod jednym kluczem, więc
     otwarcie sprawy nie pyta serwera drugi raz o tę samą kartotekę. */
  const karta = useKartaTowaru(r.twId);
  const ceny = karta.data?.ceny ?? [];
  /* POZIOM 0 TO CENA ZAKUPU. Kolumny `tw_Cena` numerują się od zera, a widok
     nazw od jedynki — dlatego ten jeden poziom nie ma nazwy i mieć nie musi
     (`adapters/subiekt.mssql.ts`, `rozwinCeny`). Nie zgadujemy go „najniższą
     ceną z listy": najtańszy cennik sprzedaży to nadal sprzedaż. */
  const zakup = ceny.find((c) => c.poziom === 0) ?? null;
  const pozostale = ceny.filter((c) => c.poziom !== 0);
  const mag = karta.data?.mag ?? null;
  const stanZnany = mag !== null;
  /* Sprawa bez potwierdzonej kartoteki nie ma czego pokazać poza zdaniem
     o tym braku — a samo zdanie nie jest warte paska, gdy nie ma przy nim
     ani ceny z paragonu, ani niczego innego. */
  if (!stanZnany && r.twId !== null && ceny.length === 0 && !pozycja) return null;
  if (!stanZnany && r.twId === null && !pozycja) return null;

  /* ── STAN CZYTA SIĘ PRZECIW ŻĄDANIU (0.413.0) ─────────────────────────────
     `offer.quantity` leży w ładunku sprawy od przyrostu trzeciego i do tego
     wydania nie było go na ekranie ANI RAZU. „Mamy 2 szt." przy sprawie o trzy
     sztuki wygląda jak dobra wiadomość i nią nie jest — wymiany z tego nie
     będzie. Porównanie robi więc ekran, nie agent w głowie. */
  const zadane = r.ilosc !== null && r.ilosc > 1 ? r.ilosc : null;
  const starczy = mag !== null && zadane !== null ? mag.avail >= zadane : null;
  const wiek = wiekZakupuSlowem(r.dniOdZakupu);

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
        : r.twId === null
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
      /* OTWARTA DOMYŚLNIE: 0.411.0 postawiło te wiersze na wierzchu decyzją
         właściciela i to wydanie ich stamtąd nie zdejmuje — daje tylko sposób
         na zamknięcie ich raz, komu nie są potrzebne. */
      domyslnieOtwarte
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

/** Co stoi w zakupie — kwota i dzień, czyli to, po co się tę zwijkę otwiera. */
function podpisZakupu(szczegol: SzczegolReklamacji): string {
  const z = szczegol.zamowienie;
  if (!z) return "zamówienia nie pobraliśmy";
  const kiedy = z.kupionoAt ?? szczegol.reklamacja.kupionoAt;
  return [zlote(z.sumaGrosze, z.waluta), kiedy ? dzien(kiedy) : null]
    .filter(Boolean).join(" · ");
}

/** Co stoi w sprawie — identyfikatory i długość rozmowy. */
function podpisSprawy(r: Reklamacja): string {
  return [r.numer ?? r.externalId, r.kupujacyLogin,
    `${r.wiadomosciIle} wiadomości`].filter(Boolean).join(" · ");
}
