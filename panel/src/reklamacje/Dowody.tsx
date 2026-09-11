import React, { useEffect, useState } from "react";
import { ExternalLink, Undo2 } from "lucide-react";
import type {
  RadaMaszyny, Reklamacja, SzczegolReklamacji, Tag, Werdykt, ZdjecieKarty,
} from "../api/typy";
import { TagiSprawy } from "../sprawy/Tagi";
import { zlote } from "../api/zwroty";
import { EtykietaWartosci, NaglowekSekcji, czas, LoginKlienta, Przycisk, Skopiuj } from "../ui";
import { Kafel, KafelOferty } from "../towar/Kafel";
import { OCZEKIWANIA, POWODY } from "./Kolejka";
import { NAZWA_WERDYKTU } from "./statusy";

/* ── Kolumna dowodów o reklamacji ────────────────────────────────────────────
   Jedna lista faktów o jednej sprawie, więc SEKCJE jedna pod drugą, a nie
   zakładki — ta sama decyzja co przy zwrocie w 0.180.0. Zakładki mają sens
   tam, gdzie kolumna niesie dwa RÓWNORZĘDNE tematy; tutaj jest jeden.

   Wszystko poniżej to ODCZYT. Jedyne dwa zapisy tego ekranu — „prowadzę"
   i notatka — są jawnymi kliknięciami, nie skutkiem ubocznym patrzenia. */

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
  return <Sekcja tytul="Co wyczytał Copilot">
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
    </> : <p className="py-1 text-sm text-slate-500">
      Copilot może wyciągnąć z rozmowy usterkę, oczekiwanie klienta i to, czego
      brakuje do rozstrzygnięcia. Werdykt zostaje przy Tobie.
    </p>}
    <Przycisk className="mt-2 !px-2 !py-1 !text-xs" disabled={trwa} onClick={onRozpoznaj}>
      {trwa ? "CZYTAM…" : karta ? "PRZECZYTAJ JESZCZE RAZ" : "PRZECZYTAJ SPRAWĘ"}
    </Przycisk>
  </Sekcja>;
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
  szczegol, trwa, bladZapisu, onProwadze, onNotatka, onCofnijNotatke,
  rozpoznaje = false, bladRozpoznania = "", onRozpoznaj,
  tagi,
}: {
  szczegol: SzczegolReklamacji;
  trwa: boolean;
  bladZapisu: string;
  onProwadze: () => void;
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
}) {
  const r = szczegol.reklamacja;
  return <div className="flex min-h-0 flex-col">
    {onRozpoznaj && <KartaFaktow karta={szczegol.karta} trwa={rozpoznaje}
      blad={bladRozpoznania} onRozpoznaj={onRozpoznaj} />}
    <Sekcja tytul="Sprawa">
      <Wiersz etykieta="Numer">
        <Link href={r.link}>{r.numer ?? r.externalId}</Link>
        <Skopiuj tekst={r.numer ?? r.externalId} tytul="Kopiuj numer reklamacji" />
      </Wiersz>
      <Wiersz etykieta="Kupujący">{r.kupujacyLogin
        ? <LoginKlienta login={r.kupujacyLogin} /> : "—"}</Wiersz>
      {/* Rękojmia i gwarancja to dwa różne tytuły prawne i dwie różne rozmowy
          z klientem. Sonda widziała wyłącznie COMPLAINT, ale to obserwacja
          jednej próbki, a nie kontrakt. */}
      <Wiersz etykieta="Tytuł">
        {r.prawo === "COMPLAINT" ? "rękojmia" : r.prawo === "WARRANTY" ? "gwarancja" : "—"}
      </Wiersz>
      <Wiersz etykieta="Powód">
        {r.powodTyp ? (POWODY[r.powodTyp] ?? r.powodTyp) : "—"}
      </Wiersz>
      <Wiersz etykieta="Klient chce">
        {r.oczekiwanie ? (OCZEKIWANIA[r.oczekiwanie] ?? r.oczekiwanie) : "—"}
        {r.oczekiwanaKwotaGrosze !== null
          ? ` · ${zlote(r.oczekiwanaKwotaGrosze, r.waluta)}` : ""}
      </Wiersz>
      <Wiersz etykieta="Zgłoszono">{czas(r.otwartoAt)}</Wiersz>
    </Sekcja>

    <Sekcja tytul="Zegar i stan">
      {/* Termin przychodzi Z ALLEGRO. Liczba wzięta z naszego kodu
          rozjeżdżałaby się z tą, którą widzi kupujący — a rozstrzyga jego. */}
      <Wiersz etykieta="Decyzja do">
        {r.decyzjaDo
          ? <>{czas(r.decyzjaDo)}{r.poTerminie
              ? <b className="ml-2 text-ranga-zle">po terminie</b> : ""}</>
          : "Allegro nie podało terminu"}
      </Wiersz>
      <Wiersz etykieta="Status Allegro">{r.statusAllegro ?? "—"}</Wiersz>
      <Wiersz etykieta="Zwrot towaru">
        {r.zwrotWymagany === null ? "sprzedawca jeszcze nie zdecydował"
          : r.zwrotWymagany ? "wymagany" : "niewymagany"}
      </Wiersz>
      <Wiersz etykieta="Rozmowa">
        {r.czatAktywny ? "otwarta" : "zamknięta przez Allegro"}
        {` · ${r.wiadomosciIle} wiadomości`}
      </Wiersz>
    </Sekcja>

    {/* ── DWA OBRAZY, DWA ŹRÓDŁA (0.223.0) ──────────────────────────────────
        Lewy to oferta Allegro: dokładnie to, co widział klient, kupując.
        Prawy to kartoteka Subiekta: to, co leży u nas na półce. Przy
        reklamacji różnica między nimi bywa całą sprawą — „niezgodny
        z opisem" to siedemnaście spraw na sto w sondzie.

        Kafel kartoteki milczy, dopóki wiązania nie ma: `twId: null` rysuje
        znak „bez kartoteki", nie pustkę. To są dwa różne braki i dwa różne
        znaki, dokładnie jak przy zwrocie od 0.203.0. */}
    <Sekcja tytul="Towar">
      <div className="flex items-start gap-3">
        <KafelOferty externalId={r.offerId} stan={r.ofertaZdjecie} rozmiar={72}
          nazwa={r.ofertaNazwa ?? "Oferta"} symbol={r.offerId} />
        <Kafel twId={r.twId} rozmiar={72} nazwa={r.ofertaNazwa ?? "Kartoteka"}
          symbol={r.twSymbol} />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-slate-800">{r.ofertaNazwa ?? "Oferty nie pobrano"}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {r.twSymbol ?? szczegol.kartoteka?.symbol ?? szczegol.kartoteka?.powod
              ?? "bez kartoteki"}
          </p>
        </div>
      </div>
    </Sekcja>

    <Sekcja tytul="Kontekst zakupu">
      <Wiersz etykieta="Zamówienie">
        {r.orderId
          ? <><Link href={r.linkZamowienia}>{r.orderId}</Link>
              <Skopiuj tekst={r.orderId} tytul="Kopiuj numer zamówienia" /></>
          : "reklamacja bez numeru zamówienia"}
      </Wiersz>
      {/* ── DATA ZAKUPU NA EKRANIE (0.282.0) ────────────────────────────────
          Agent też jej dotąd nie widział — zwroty i skrzynka mają ją od dawna,
          reklamacje nie miały wcale. ETYKIETA MÓWI, KTÓRY TO ZEGAR: „Kupiono"
          bierze się z pozycji zamówienia, „Zamówienie złożone" z ładunku
          sprawy i bywa wcześniejsze. Blizna 0.121.0 wzięła się z nazwania
          jednego zegara drugim, więc nie sklejamy ich pod jedną etykietą. */}
      {r.kupionoAt && <Wiersz
        etykieta={r.kupionoZrodlo === "zamowienie" ? "Kupiono" : "Zamówienie złożone"}>
        {czas(r.kupionoAt)}
      </Wiersz>}
      <Wiersz etykieta="Oferta">
        {r.offerId ? <Link href={r.linkOferty}>{r.offerId}</Link> : "—"}
      </Wiersz>
    </Sekcja>

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

    {szczegol.rozmowy.length > 0 && <Sekcja tytul="Rozmowy o tym zakupie">
      <ul className="flex flex-col gap-1">
        {szczegol.rozmowy.map((c) => <li key={c.id} className="text-sm">
          <a href={`/obsluga/skrzynka/${c.id}`} className="underline underline-offset-2">
            {c.temat ?? `Rozmowa ${c.id}`}</a>
          <span className="ml-2 text-slate-500">{czas(c.ostatniaAt)}</span>
        </li>)}
      </ul>
    </Sekcja>}

    <Sekcja tytul="Praca biura">
      <Wiersz etykieta="Prowadzi">{r.prowadzi ?? "nikt"}</Wiersz>
      {/* ZNACZNIK, nie zamek: reklamacja przed werdyktem nie ma żadnego zapisu,
          przy którym nazwisko pojawiłoby się samo. Ponowne kliknięcie zdejmuje. */}
      <Przycisk className="mt-1 w-full" disabled={trwa} onClick={onProwadze}>
        {r.prowadzi ? "Odłóż sprawę" : "Prowadzę tę sprawę"}
      </Przycisk>
      {/* TAGI NAD NOTATKĄ, bo odpowiadają na pytanie, które agent zadaje
          częściej: „czego ta sprawa czeka". Notatka jest dłuższa i czyta się
          ją wtedy, gdy tag nie wystarczy. */}
      {tagi && <div className="mt-3">
        <TagiSprawy przypiete={r.tagi} slownik={tagi.slownik} trwa={tagi.trwa}
          blad={tagi.blad} onPrzypnij={tagi.onPrzypnij} onOdepnij={tagi.onOdepnij}
          onNowy={tagi.onNowy} />
      </div>}
      <div className="mt-3">
        <Notatka reklamacja={r} trwa={trwa} blad={bladZapisu} onZapisz={onNotatka}
          onCofnij={onCofnijNotatke} />
      </div>
    </Sekcja>
  </div>;
}
