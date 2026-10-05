import React, { useEffect, useState } from "react";
import { Coins, ExternalLink, NotebookPen, PackageSearch, Receipt, Route } from "lucide-react";
import type {
  CenaPoziomu, PozycjaZamowienia, Reklamacja, SzczegolReklamacji, Tag,
} from "../api/typy";
import { TagiSprawy } from "../sprawy/Tagi";
import { DrogaZakupu, SprawyZakupu } from "../sprawy/Spoiwo";
import { zlote } from "../api/zwroty";
import { EtykietaWartosci, czas, dzien, dniSlowo, ile, Przycisk, Skopiuj } from "../ui";
import { CenyKartoteki } from "../skrzynka/TowarRozmowy";
import { dopisekDostaw } from "../skrzynka/PasmoOdpowiedzi";
import { STATUS_PACZKI } from "../skrzynka/statusy";
import { PRZEWOZNICY } from "../zwroty/Dowody";
import { useKartaTowaru } from "../api/rozmowy";
import { Zwijka } from "../skrzynka/Zwijka";
import { kartotekaKolumny } from "./Glowica";
import { ileReklamacji, poWerdykcie } from "./etap";

/* ── Kolumna faktów o reklamacji ─────────────────────────────────────────────
   Trzecia kolumna obszaru sprawy, za rozmową i dowodami biura. Trzyma tylko
   to, czego głowica nie mówi: kostki do decyzji, blok werdyktu z czynnościami
   i zwijki ze szczegółem. Uwaga właściciela: „informacje powtarzają się".
   Kto, numer, zgłoszenie, tytuł prawny, status Allegro i stan rozmowy mają
   dom w głowicy, więc tu nie wracają. Jeden dom na fakt.

   ZWIJKI PODPISUJE ZDANIE, nie licznik. Zamknięta zwijka ma powiedzieć, co
   jest w środku, żeby nie trzeba było jej otwierać tylko po to, by
   sprawdzić, czy jest tam coś ważnego. Kody przewoźnika i statusów stoją
   słowami — surowy kod nie mówi agentowi nic.

   Wszystko poniżej to ODCZYT. Notatka, tagi, pytanie o paczkę i wstrzyknięty
   werdykt zapisują, ale każde jawnym kliknięciem, nie skutkiem ubocznym
   patrzenia. */

/** Odnośnik do Allegro z ikoną wyjścia; bez adresu zostaje sam tekst. */
const Link = ({ href, title, children }: { href: string | null; title?: string; children: React.ReactNode }) =>
  href
    ? <a href={href} target="_blank" rel="noopener noreferrer" title={title}
        className="inline-flex min-h-6 items-center gap-1 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
        {children}<ExternalLink size={12} aria-hidden="true" /></a>
    : <span title={title}>{children}</span>;

/* Powody, przy których pytanie „czy on to w ogóle dostał" jest całą sprawą.
   Przed werdyktem otwierają paczkę same, bo odpowiedź leży w niej. */
const POWODY_DORECZENIA = new Set([
  "NO_PRODUCT_RECEIVED", "NO_PRODUCT_IN_PARCEL",
  "PRODUCT_AND_PARCEL_DAMAGED_IN_TRANSIT", "RECEIVED_INCOMPLETE_ORDER",
]);

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
 * Co zapisało biuro — nazwy tagów i początek notatki, a nie ich liczba.
 *
 * Zwinięty blok czyta treść w podpisie, więc nie trzeba go otwierać tylko
 * po to, by sprawdzić, czy ktoś już coś zapisał. „Nic nie zapisano" mówi
 * to wprost, zamiast „pusto", które czytało się jak awaria.
 */
function podpisPracy(r: Reklamacja): string {
  const ma = r.tagi.map((t) => t.nazwa);
  if (r.notatka?.trim()) ma.push(`notatka: „${poczatek(r.notatka, 40)}”`);
  return ma.length ? ma.join(" · ") : "nic nie zapisano";
}

/** Początek tekstu do około `ile` znaków, ucięty na granicy wyrazu, nie w jego środku. */
function poczatek(tekst: string, ile: number): string {
  const n = tekst.trim().replace(/\s+/g, " ");
  if (n.length <= ile) return n;
  const ciecie = n.slice(0, ile);
  const spacja = ciecie.lastIndexOf(" ");
  return `${(spacja > ile / 2 ? ciecie.slice(0, spacja) : ciecie).replace(/[\s,.;:—-]+$/, "")}…`;
}

export function Dowody({
  szczegol, trwa, bladZapisu, onNotatka, onCofnijNotatke,
  onSprawdzPrzesylke, sprawdzaPrzesylke = false, bladPrzesylki = "",
  tagi, decyzja, pokazZakup,
}: {
  szczegol: SzczegolReklamacji;
  trwa: boolean;
  bladZapisu: string;
  onNotatka: (tekst: string) => void;
  /** Cofnięcie ZMIANY notatki — §25a.5: cofnięcie zamiast potwierdzenia. */
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
  /* Sprawdzenie przesyłki — opcjonalne tym samym wzorcem co reszta: czego
     nie da się zrobić, tego nie ma na ekranie. */
  onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean;
  bladPrzesylki?: string;
  /* Werdykt WSTRZYKIWANY, jak edytor w rozmowie: kolumna zostaje czysta,
     a zapisy i ich błędy mieszkają w ekranie. Stoi pod faktami, z których
     się go wydaje, i nad zwijkami ze szczegółem. */
  decyzja?: React.ReactNode;
  /* Sygnał z głowicy: wskaźnik innej otwartej sprawy tego zakupu przewija
     do zwijki „Ten zakup u nas" i ją otwiera. Każde kliknięcie podbija
     licznik, więc drugie kliknięcie działa tak samo jak pierwsze. */
  pokazZakup?: number;
}) {
  const r = szczegol.reklamacja;
  /* Pozycja paragonu tej właśnie oferty — z niej bierze się cena w kostce
     „Klient zapłacił". Reklamacja dotyczy JEDNEJ oferty, więc jednej
     pozycji; ta sama oferta dwa razy na zamówieniu niesie tę samą cenę. */
  const pozycja = szczegol.zamowienie?.pozycje
    .find((p) => p.offerId !== null && p.offerId === r.offerId) ?? null;
  const towar = kartotekaKolumny(szczegol);
  /* Ten sam hak, co w skrzynce — TanStack trzyma to pod jednym kluczem, więc
     otwarcie sprawy nie pyta serwera drugi raz o tę samą kartotekę. Pyta
     o kartotekę CAŁEJ sprawy: tę samą, której symbol stoi w głowicy. */
  const karta = useKartaTowaru(towar.twId);
  const ceny = karta.data?.ceny ?? [];
  /* POZIOM 0 TO CENA ZAKUPU. Kolumny `tw_Cena` numerują się od zera, a widok
     nazw od jedynki — dlatego ten jeden poziom nie ma nazwy i mieć nie musi
     (`adapters/subiekt.mssql.ts`, `rozwinCeny`). Nie zgadujemy go „najniższą
     ceną z listy": najtańszy cennik sprzedaży to nadal sprzedaż. */
  const zakup = ceny.find((c) => c.poziom === 0) ?? null;
  const pozostale = ceny.filter((c) => c.poziom !== 0);
  const polki = karta.data?.locs ?? [];

  /* ── ZWIJKI OTWIERA ETAP SPRAWY, NIE PAMIĘĆ STANOWISKA ───────────────────
     Inna otwarta sprawa tego zakupu to klient, który czeka też gdzie indziej.
     Przed werdyktem powód o doręczeniu otwiera paczkę, a żądanie pieniędzy
     otwiera zamówienie, bo koszt dostawy i suma kształtują kwotę. Te trzy
     zwijki nie pamiętają wyboru: zapamiętane „zwinięte" chowałoby właśnie
     ten alarm. Klucz sprawy liczy ich stan od nowa przy każdej sprawie. */
  const przedWerdyktem = !poWerdykcie(r);
  const otwartaInnaSprawa = szczegol.sprawy.some((s) => s.otwarta);

  return <div className="flex min-h-0 flex-col">
    {/* ── STAŁA KOLEJNOŚĆ: FAKTY, HISTORIA, WERDYKT, SZCZEGÓŁ ──────────────
        Tu stoi to, z czego wydaje się werdykt, sam werdykt i zwijki ze
        szczegółem. Kolejność się nie zmienia, więc oko szuka faktu tam,
        gdzie był. */}
    <Triaz szczegol={szczegol} pozycja={pozycja} twId={towar.twId} karta={karta} zakup={zakup} />
    <Historia historia={szczegol.historia} />

    {decyzja}

    <div className="px-2 pb-2">
      {/* ── TEN ZAKUP U NAS: PIERWSZA POD WERDYKTEM ──────────────────────────
          Droga jest nadzbiorem sekcji o jednym zakupie: `services/droga-
          klienta.ts` składa przystanki z tych samych tabel, a każdy przystanek
          niesie odnośnik do swojej kolejki. Rodzeństwo spraw zostaje, bo niesie
          to, czego droga nie ma: termin cudzej sprawy, kto ją prowadzi i czy
          jest otwarta. To wiązanie drogi klienta w obie strony. */}
      {(szczegol.droga.length > 1 || szczegol.sprawy.length > 0) && <Zwijka
        key={`zakup-${r.id}`}
        tytul="Ten zakup u nas"
        Ikona={Route}
        podpis={podpisDrogi(szczegol)}
        domyslnieOtwarte={otwartaInnaSprawa}
        otworz={pokazZakup}
      >
        <div className="px-2 py-2">
          {szczegol.droga.length > 1 && <DrogaZakupu droga={szczegol.droga}
            tutaj={{ rodzaj: "reklamacja", id: r.id }} wSekcji />}
          {szczegol.sprawy.length > 0 && <div className={szczegol.droga.length > 1 ? "mt-1.5" : ""}>
            <SprawyZakupu sprawy={szczegol.sprawy} wSekcji />
          </div>}
        </div>
      </Zwijka>}

      {szczegol.przesylka && <Paczka key={`paczka-${r.id}`} przesylka={szczegol.przesylka}
        onSprawdz={onSprawdzPrzesylke} trwa={sprawdzaPrzesylke} blad={bladPrzesylki}
        domyslnieOtwarte={przedWerdyktem && POWODY_DORECZENIA.has(r.powodTyp ?? "")} />}

      <Zwijka
        key={`zamowienie-${r.id}`}
        tytul="Zamówienie"
        Ikona={Receipt}
        podpis={podpisZamowienia(szczegol)}
        domyslnieOtwarte={przedWerdyktem && (r.oczekiwanie === "REFUND" || r.oczekiwanie === "PARTIAL_REFUND")}
      >
        <Zamowienie szczegol={szczegol} />
      </Zwijka>

      {/* ── CENY I PÓŁKA ──────────────────────────────────────────────────────
          Cena zakupu stoi w kostce „Klient zapłacił", więc poziom 0 tu nie
          wraca. Zostają cenniki SPRZEDAŻY — przydają się przy rozmowie
          o wymianie, nie przy werdykcie — i półka. Zwijka pamięta wybór, bo
          to nawyk stanowiska, a nie etap sprawy. */}
      {towar.twId !== null && (pozostale.length > 0 || polki.length > 0) && <Zwijka
        tytul="Ceny i półka"
        Ikona={Coins}
        podpis={podpisCen(pozostale, polki)}
        pamietajJako="wertis.reklamacje.cennik"
      >
        <div className="px-2 py-2">
          {polki.length > 0 && <p className="text-sm text-slate-800">Półka {polki.join(", ")}.</p>}
          {pozostale.length > 0 && <div className={polki.length > 0 ? "mt-1" : ""}>
            <CenyKartoteki ceny={pozostale} /></div>}
        </div>
      </Zwijka>}

      {/* ── PRACA BIURA ───────────────────────────────────────────────────────
          Zapiski O SPRAWIE: tagi i notatka. Zwinięta, bo podpis czyta już
          ich treść; pamięta wybór, bo to nawyk stanowiska. „Prowadzi" stoi
          w głowicy, bo wzięcie sprawy jest czynnością, a nie zapiskiem. */}
      <Zwijka
        tytul="Praca biura"
        Ikona={NotebookPen}
        podpis={podpisPracy(r)}
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

    {/* ── BEZ COPILOTA I BEZ „ZLEĆ HALI" ─────────────────────────────────────
        Decyzja właściciela przy przebudowie ekranu reklamacji: karta „Co
        wyczytał Copilot", jego rada i zlecenie dla hali na razie tu nie stoją.
        Dlatego nic w tej kolumnie nie woła modelu ani nie zleca pracy hali.
        Zapisane karty zostają w bazie, a `ZlecHali` dalej służy zwrotom
        i dyskusjom. Strażnik: `BezCopilota.test.tsx` i `Notatka.test.tsx`. */}
  </div>;
}

/* ── CZTERY KOSTKI: CZY MAMY, KIEDY, ZA ILE, OD KOGO ─────────────────────────
   Zgłoszenie właściciela: ceny „są kluczowe do szybkiego oceniania, czy warto
   rozpatrywać reklamację". To zdanie rozstrzyga KSZTAŁT: liczba używana do
   triażu nie może stać za kliknięciem. Cztery pytania, cztery kostki w siatce
   dwa na dwa — każda zawsze w tym samym miejscu, więc oko nie szuka.

   „Mamy" — przy żądaniu WYMIANY to jest cała decyzja, a pod spodem stoi, co
   jedzie od dostawcy, bo „nie mamy" bez „będzie we wtorek" to pół odpowiedzi.
   „Kupione" — wiek zakupu i to, po ilu dniach klient się zgłosił. „Klient
   zapłacił" — kwota z paragonu i obok nasz zakup. „Dostawca" — od kogo jest
   ta partia, czyli u kogo reklamujemy dalej.

   NIC SIĘ TU NIE ODEJMUJE. „Zapłacił" jest kwotą BRUTTO z paragonu, „nasz
   zakup" — netto z kartoteki. Różnica tych dwóch liczb nie jest marżą, a stawki
   VAT ten ładunek nie niesie. Dwie liczby obok siebie mówią prawdę; jedna
   wyliczona z nich kłamałaby z dokładnością do podatku.

   BRAK WIEDZY MÓWI O SOBIE (punkt 10 z `docs/obsluga-klienta-calosc.md`:
   czego nie wiemy, ekran mówi wprost). Kostka bez danych nie znika, tylko
   mówi „nie wiemy" — pusty slot czytałby się jak „nie mamy", a zero jak
   wiedza, której nie ma. */
function Triaz({ szczegol, pozycja, twId, karta, zakup }: {
  szczegol: SzczegolReklamacji; pozycja: PozycjaZamowienia | null;
  /** Kartoteka całej sprawy — ta sama, której symbol stoi w głowicy. */
  twId: number | null;
  karta: ReturnType<typeof useKartaTowaru>;
  zakup: CenaPoziomu | null;
}) {
  const r = szczegol.reklamacja;
  const mag = karta.data?.mag ?? null;

  /* ── STAN CZYTA SIĘ PRZECIW ŻĄDANIU (0.413.0) ─────────────────────────────
     „Mamy 2 szt." przy sprawie o trzy sztuki wygląda jak dobra wiadomość
     i nią nie jest — wymiany z tego nie będzie. Porównanie robi więc ekran,
     nie agent w głowie. */
  const zadane = r.ilosc !== null && r.ilosc > 1 ? r.ilosc : null;
  const starczy = mag !== null && zadane !== null ? mag.avail >= zadane : null;
  const wiek = wiekZakupuSlowem(r.dniOdZakupu);
  const poDniach = zgloszonoPoDniach(r);

  const cena = pozycja?.cenaGrosze ?? r.cenaParagonuGrosze ?? null;
  const waluta = pozycja?.waluta ?? r.waluta;
  const naszZakup = zakup && (zakup.nettoGrosze ?? zakup.bruttoGrosze)
    ? `nasz zakup ${zlote(zakup.nettoGrosze ?? zakup.bruttoGrosze, zakup.waluta)} ${
      zakup.nettoGrosze !== null ? "netto" : "brutto"}`
    : null;
  /* Czytamy ostrożnie: starszy serwer pola nie zna, a jego brak ma znaczyć
     „nie wiemy", nie wywracać kolumny. */
  const dostawa = szczegol.dostawa ?? null;

  return <div className="grid grid-cols-2 gap-2 border-b border-slate-200 px-4 py-2">
    {twId === null
      ? <Kostka etykieta="Mamy" wartosc="nie wiadomo" kolor="text-slate-700"
          pod="sprawa bez kartoteki Subiekta" />
      : mag
        ? <Kostka etykieta="Mamy"
            wartosc={mag.avail > 0 ? `${mag.avail} ${karta.data?.unit || "szt."}` : "brak na stanie"}
            kolor={mag.avail > 0 && starczy !== false ? "text-ranga-ok" : "text-ranga-zle"}
            pod={[
              zadane ? `sprawa o ${zadane} szt.` : null,
              karta.data ? dopisekDostaw({ ...karta.data, mag }) : null,
            ].filter(Boolean).join(" · ")} />
        : <Kostka etykieta="Mamy" wartosc={karta.isLoading ? "…" : "nie wiemy"} kolor="text-slate-700"
            pod={karta.isLoading ? "pytam Subiekta" : "Subiekt nie podał stanu"} />}

    <Kostka etykieta="Kupione" wartosc={wiek?.napis ?? "nie wiemy"}
      /* Bursztyn, nie czerwień, i nie wyrok: rękojmia biegnie dwa lata od
         WYDANIA rzeczy, a my mierzymy od zamówienia albo od złożenia
         koszyka. Ekran mówi, że warto sprawdzić — nie że sprawa przepadła. */
      kolor={!wiek ? "text-slate-700" : wiek.poDwochLatach ? "text-ranga-uwaga" : "text-slate-900"}
      /* KTÓRY TO ZEGAR, mówi podpowiedź kostki: data z zamówienia i data
         z ładunku sprawy to dwie różne daty pod jedną etykietą. */
      tytul={r.kupionoAt ? `Data zakupu: ${dzien(r.kupionoAt)}, ${ZEGAR[r.kupionoZrodlo ?? "sprawa"]}` : undefined}
      /* Data zakupu stoi na widoku, nie tylko w podpowiedzi: podpowiedzi nie
         czyta klawiatura ani dotyk, a datę przepisuje się klientowi. */
      pod={poDniach !== null && r.kupionoAt ? `${dzien(r.kupionoAt)} · zgłoszone ${dniSlowo(poDniach)} po zakupie`
        : r.kupionoAt ? `${dzien(r.kupionoAt)} · ${ZEGAR[r.kupionoZrodlo ?? "sprawa"]}` : "brak daty zakupu"} />

    <Kostka etykieta="Klient zapłacił"
      wartosc={cena !== null ? zlote(cena, waluta) : "nie wiemy"}
      kolor={cena !== null ? "text-slate-900" : "text-slate-700"}
      pod={[cena !== null ? "brutto" : "paragonu nie mamy", naszZakup].filter(Boolean).join(" · ")} />

    <Kostka etykieta="Dostawca"
      wartosc={dostawa?.dostawca ?? "nie wiemy"}
      kolor={dostawa ? "text-slate-900" : "text-slate-700"}
      /* W kostce stoi SYMBOL kontrahenta, bo pełnej nazwy serwer nie
         importuje. Podpowiedź mówi to wprost, żeby nikt nie szukał nazwy. */
      tytul={dostawa ? `Symbol dostawcy w Subiekcie${
        dostawa.numer ? `. Dokument dostawy: ${dostawa.numer}` : ""}` : undefined}
      /* Partia SPRZED zakupu to ta, z której klient dostał sztukę. Gdy takiej
         nie ma, ostatnia dostawa w ogóle jest tylko tropem i tak się nazywa. */
      pod={dostawa
        ? `${dostawa.przedZakupem ? "dostawa przed zakupem" : "ostatnia dostawa"} ${dzien(dostawa.data)}`
        : twId === null ? "bez kartoteki nie znamy dostaw" : "nie znamy dostawy tego towaru"} />
  </div>;
}

/** Skąd jest data zakupu — dwa zegary, dwie nazwy. */
const ZEGAR: Record<string, string> = {
  zamowienie: "data z zamówienia", sprawa: "data z ładunku sprawy",
};

/**
 * Po ilu pełnych dniach od zakupu klient zgłosił sprawę.
 *
 * Serwer liczy to sam; starszy go nie zna, więc wtedy liczymy z jego dwóch
 * dat — obie są z serwera, więc zegar przeglądarki w tym nie bierze udziału.
 */
function zgloszonoPoDniach(r: Reklamacja): number | null {
  if (r.zgloszonoPoDniach !== undefined) return r.zgloszonoPoDniach;
  if (!r.kupionoAt || !r.otwartoAt) return null;
  const dni = Math.floor((Date.parse(r.otwartoAt) - Date.parse(r.kupionoAt)) / 86_400_000);
  return Number.isFinite(dni) && dni >= 0 ? dni : null;
}

/* ── CZY TEN TOWAR SIĘ JUŻ SYPAŁ ─────────────────────────────────────────────
   Cennik mówi, ile kosztuje ustąpienie. Ta liczba mówi, czy w ogóle jest
   o co się spierać: towar z pięcioma reklamacjami, z których cztery
   uznaliśmy, to wada partii, a nie sprawa do rozstrzygania od zera.

   Tylko TOWAR. O kliencie mówi rząd klienta w głowicy, obok jego loginu,
   bo tam szuka się wszystkiego o kupującym. Jeden dom na fakt.

   JEDEN WIERSZ, NIE SEKCJA. To jest tło decyzji, a nie sama decyzja. Brak
   historii nie rysuje się wcale — pierwsza sprawa przy tym towarze nie jest
   informacją o towarze. */
function Historia({ historia }: { historia: SzczegolReklamacji["historia"] }) {
  /* Czytamy OSTROŻNIE, choć typ mówi, że pole jest. Panel i serwer wdrażają
     się jednym `git pull`, ale nie w tej samej sekundzie: przez chwilę nowy
     panel pyta starego serwera, a ładunek bez tego pola wywracałby CAŁĄ
     kolumnę dowodów zamiast pominąć jeden wiersz. */
  const towar = historia?.towar ?? null;
  if (!towar) return null;
  return <p className="border-b border-slate-200 px-4 py-1.5 text-podpis text-slate-700">
    Ten towar: {ileReklamacji(towar)}
  </p>;
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

/* ── GDZIE JEST PACZKA DO KLIENTA ────────────────────────────────────────────
   „Czy on to w ogóle dostał" jest przy reklamacji pytaniem PIERWSZYM, a przy
   powodach „nie otrzymałem produktu" — całą sprawą. Dlatego odpowiedź stoi
   w PODPISIE zwijki i widać ją przy zamkniętej. W środku dwa zdania: którą
   paczką to jechało i kiedy pytaliśmy, z pytaniem od nowa.

   Ładunek zamówienia numeru przesyłki NIE MA — stoi pod osobną końcówką
   `/order/checkout-forms/{id}/shipments`. Pytamy na JAWNE kliknięcie: żądanie
   u dostawcy nie wychodzi z patrzenia. */
function Paczka({ przesylka: p, onSprawdz, trwa, blad, domyslnieOtwarte }: {
  przesylka: NonNullable<SzczegolReklamacji["przesylka"]>;
  onSprawdz?: () => void;
  trwa: boolean;
  blad: string;
  domyslnieOtwarte: boolean;
}) {
  return <Zwijka
    tytul="Paczka do klienta"
    Ikona={PackageSearch}
    podpis={podpisPaczki(p)}
    domyslnieOtwarte={domyslnieOtwarte}
  >
    <div className="flex flex-col gap-1 px-2 py-2 text-sm text-slate-800">
      {/* Przewoźnik słowem ze wspólnego słownika zwrotów, numer listu mono,
          bo czyta się go znak po znaku z naklejki. */}
      {p.waybill !== null
        ? <p>List <span className="break-all font-mono">{p.waybill}</span>
            {p.przewoznik && <>, przewoźnik {PRZEWOZNICY[p.przewoznik] ?? p.przewoznik}</>}.</p>
        : p.sprawdzonoAt !== null
          && <p className="text-slate-600">Paczka jeszcze nienadana albo nadana poza Allegro.</p>}
      <p className="text-slate-700">
        {p.sprawdzonoAt ? `Pytaliśmy Allegro ${czas(p.sprawdzonoAt)}.` : "Allegro jeszcze nie pytaliśmy."}
        {onSprawdz && <>{" "}<button type="button" disabled={trwa} onClick={onSprawdz}
          className="min-h-6 font-semibold underline underline-offset-2 disabled:opacity-50">
          {trwa ? "pytam…" : p.sprawdzonoAt ? "sprawdź jeszcze raz" : "sprawdź"}</button></>}
      </p>
      {blad && <p className="text-xs text-red-700">{blad}</p>}
    </div>
  </Zwijka>;
}

/**
 * Stan paczki jednym zdaniem — to jest odpowiedź, którą widać bez otwierania.
 *
 * Kod przewoźnika idzie przez słownik skrzynki, bo „IN_TRANSIT" nie mówi
 * agentowi nic. Kod spoza słownika stoi z dopiskiem, skąd jest: kod da się
 * dopisać do słownika, a pustego miejsca nikt nie zauważy.
 */
function podpisPaczki(p: NonNullable<SzczegolReklamacji["przesylka"]>): string {
  if (p.sprawdzonoAt === null) return "nie pytaliśmy jeszcze Allegro";
  if (p.waybill === null) return "Allegro nie ma numeru";
  if (p.dostarczonoAt) return `doręczona ${dzien(p.dostarczonoAt)}`;
  if (p.status === null) return "przewoźnik nie podał statusu";
  return STATUS_PACZKI[p.status] ?? `przewoźnik podał: ${p.status}`;
}

/** Jedna liczba triażu: etykieta, kwota grubym drukiem, zdanie pod spodem. */
function Kostka({ etykieta, wartosc, kolor, pod, tytul }: {
  etykieta: string; wartosc: string; kolor: string; pod: string;
  /** Podpowiedź pod kursorem — to, co nie mieści się w kostce, a bywa potrzebne. */
  tytul?: string;
}) {
  return <div title={tytul} className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
    <EtykietaWartosci className="block">{etykieta}</EtykietaWartosci>
    <p className={`mt-0.5 break-words text-lg font-bold leading-tight tabular-nums ${kolor}`}>{wartosc}</p>
    {pod && <p className="text-podpis text-slate-600">{pod}</p>}
  </div>;
}

/** Pozycja sporna i reszta zamówienia — po ofercie, której dotyczy reklamacja. */
function pozycjeZamowienia(pozycje: PozycjaZamowienia[], offerId: string | null) {
  const sporna = (p: PozycjaZamowienia) => p.offerId !== null && p.offerId === offerId;
  return { sporne: pozycje.filter(sporna), inne: pozycje.filter((p) => !sporna(p)) };
}

/**
 * Co jest w zamówieniu poza reklamowanym towarem — i ile razem.
 *
 * Przy jednej pozycji suma byłaby tą samą liczbą, co kostka „Klient zapłacił"
 * dwa centymetry wyżej, więc podpis mówi wtedy tylko „tylko ten towar".
 * Gdy żadna pozycja nie pasuje do oferty, podpis liczy wszystkie.
 */
function podpisZamowienia(szczegol: SzczegolReklamacji): string {
  const z = szczegol.zamowienie;
  if (!z) return "zamówienia nie pobraliśmy";
  const { sporne, inne } = pozycjeZamowienia(z.pozycje, szczegol.reklamacja.offerId);
  if (sporne.length > 0 && inne.length === 0) return "tylko ten towar";
  const razem = z.sumaGrosze !== null ? `razem ${zlote(z.sumaGrosze, z.waluta)}` : null;
  const ileInnych = sporne.length > 0
    ? `+${ile(inne.length, "inna pozycja", "inne pozycje", "innych pozycji")}`
    : ile(z.pozycje.length, "pozycja", "pozycje", "pozycji");
  return [ileInnych, razem].filter(Boolean).join(" · ");
}

/* ── ZAMÓWIENIE: TO, CZEGO NIE MÓWI ANI GŁOWICA, ANI KOSTKI ──────────────────
   Pozycji spornej się nie powtarza: nazwa stoi w głowicy, cena w kostce.
   Zostaje reszta zamówienia, dostawa i odnośniki do Allegro. DOSTAWA STOI
   OSOBNO, bo klient żądający zwrotu pyta czasem właśnie o nią.

   SUMA MA JEDEN DOM. Gdy podpis niesie „razem", w środku jej nie ma, bo
   podpis widać także przy otwartej zwijce. Przy jednej pozycji podpis sumy
   nie ma, więc wtedy stoi w środku obok dostawy.

   Identyfikatory zamówienia i oferty stoją w podpowiedzi odnośnika
   i w schowku. Jako tekst wiersza nie mówiły agentowi nic. */
function Zamowienie({ szczegol }: { szczegol: SzczegolReklamacji }) {
  const r = szczegol.reklamacja;
  const z = szczegol.zamowienie;
  const { sporne, inne } = z ? pozycjeZamowienia(z.pozycje, r.offerId) : { sporne: [], inne: [] };
  const lista = sporne.length > 0 ? inne : (z?.pozycje ?? []);
  const sumaWPodpisie = sporne.length === 0 || inne.length > 0;
  return <div className="flex flex-col gap-1.5 px-2 py-2 text-sm text-slate-800">
    {lista.length > 0 && <div>
      <p className="text-slate-700">{sporne.length > 0 ? "Poza reklamowanym towarem:" : "Pozycje zamówienia:"}</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {lista.map((p, i) => <li key={`${p.offerId ?? p.sku ?? i}`} className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">{p.nazwa}</span>
          <span className="shrink-0 tabular-nums">{p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
        </li>)}
      </ul>
    </div>}
    {z && <p>
      Dostawa {zlote(z.dostawaGrosze, z.waluta)}{z.dostawaMetoda ? ` (${z.dostawaMetoda})` : ""}.
      {!sumaWPodpisie && z.sumaGrosze !== null &&
        <> Razem <b className="tabular-nums">{zlote(z.sumaGrosze, z.waluta)}</b>.</>}
    </p>}
    <p className="flex flex-wrap items-center gap-x-3 text-xs">
      {r.orderId
        ? <span className="inline-flex items-center gap-1">
            <Link href={r.linkZamowienia} title={`Zamówienie ${r.orderId}`}>
              {r.linkZamowienia ? "zamówienie w Allegro" : <span className="font-mono">{r.orderId}</span>}</Link>
            <Skopiuj tekst={r.orderId} tytul="Kopiuj numer zamówienia" />
          </span>
        : <span className="text-slate-600">reklamacja bez numeru zamówienia</span>}
      {/* Bez łącza z konfiguracji numer stoi na widoku: identyfikator tylko
          w podpowiedzi albo w schowku nie istnieje dla klawiatury i dotyku. */}
      {r.offerId && (r.linkOferty
        ? <Link href={r.linkOferty} title={`Oferta ${r.offerId}`}>oferta w Allegro</Link>
        : <span>oferta <span className="font-mono">{r.offerId}</span></span>)}
    </p>
  </div>;
}

/** Co stoi w cenach — ile cenników sprzedaży i półka, żeby zamknięta nie kazała zgadywać. */
function podpisCen(ceny: CenaPoziomu[], polki: string[]): string {
  return [
    ceny.length ? ile(ceny.length, "cena sprzedaży", "ceny sprzedaży", "cen sprzedaży") : null,
    polki.length ? `półka ${polki[0]}${polki.length > 1 ? ` i ${polki.length - 1} inne` : ""}` : null,
  ].filter(Boolean).join(" · ");
}

/** Co stoi w drodze zakupu — ile innych spraw i ile przystanków. */
function podpisDrogi(szczegol: SzczegolReklamacji): string {
  return [
    szczegol.sprawy.length
      ? ile(szczegol.sprawy.length, "inna sprawa", "inne sprawy", "innych spraw") : null,
    szczegol.droga.length > 1
      ? ile(szczegol.droga.length, "przystanek", "przystanki", "przystanków") : null,
  ].filter(Boolean).join(" · ");
}
