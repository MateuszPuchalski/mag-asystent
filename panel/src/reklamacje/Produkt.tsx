import React from "react";
import type { DokumentParagonu, ParagonReklamacji, SzczegolReklamacji } from "../api/typy";
import { zlote } from "../api/zwroty";
import { useKartaTowaru } from "../api/rozmowy";
import { CenyKartoteki } from "../skrzynka/OsCenKartoteki";
import { ZdjecieOferty } from "../towar/Zdjecie";
import { PrzyciskTowaru } from "../towar/Szuflada";
import { OCZEKIWANIA, POWODY } from "./Kolejka";
import { PRAWO } from "./statusy";
import { ileReklamacji } from "./etap";
import { dataCyfrowa, dniSlowo, SymbolTowaru } from "../ui";

/* ── Produkt: o co jest spór ─────────────────────────────────────────────────
   Karta odpowiada na „co to jest, czy mamy i ile kosztuje”. Stoi pod decyzją,
   bo z tych faktów decyzję się wydaje. Fakty zamówienia („kiedy kupił, ile
   zapłacił i czy dostał”) stoją na drodze sprawy, przy swoich krokach.

   Wszystko tu jest ODCZYTEM i nic nie wysyła żądań poza odczytem karty.

   BRAK WIEDZY MILCZY ALBO MÓWI SŁOWEM, nigdy zerem. Wiersz stanu bez karty
   Subiekta nie staje wcale, bo „0 szt.” przy braku karty to kłamstwo, a nie
   ostrożność (`panel/CLAUDE.md`).

   BEZ COPILOTA I BEZ „ZLEĆ HALI”. Decyzja właściciela przy przebudowie ekranu:
   nic tu nie woła modelu ani nie zleca pracy hali. Strażnik:
   `BezCopilota.test.tsx`. */

/* ── KUPIONY TOWAR: TYLKO Z DOKUMENTU SUBIEKTA ───────────────────────────────
   Decyzja właściciela: symbol w reklamacji bierze się z paragonu albo faktury
   zamówienia, a bez dokumentu karta mówi „brak paragonu”. Symbol z oferty,
   mapowania czy SKU Allegro tu nie wraca, bo oferta przepięta na inną dostawę
   wskazuje dziś inny towar niż ten, który wyjechał w paczce.

   CAŁY DOKUMENT, nie sama sporna pozycja. Przy kilku towarach w zamówieniu
   agent widzi, co jeszcze klient kupił, i sam sprawdza wskazanie serwera.

   WYRÓŻNIENIE JEST NEUTRALNE: tło slate i napis „reklamowany”. Bursztyn
   znaczy w panelu „uwaga”, a sporna pozycja to fakt, nie ostrzeżenie. */
const NAZWA_DOKUMENTU: Record<DokumentParagonu["typ"], string> = { PA: "Paragon", FS: "Faktura" };

/** Zdanie o tym, czemu dokumentu nie ma — powód, który agent może sprawdzić. */
export function powodBrakuParagonu(p: ParagonReklamacji): string | null {
  switch (p.brak) {
    case "poza-oknem":
      return `Zakup starszy niż ${dniSlowo(p.oknoDni)} — tak daleko Subiekt nie jest kopiowany.`;
    case "nie-znaleziono":
      return "Dokument jeszcze niewystawiony albo bez numeru zamówienia.";
    case "bez-zamowienia":
      return "Reklamacja bez zamówienia.";
    default:
      return null;
  }
}

/* Ilość bez jednostki: dokument jej nie niesie, a „szt.” przy wężu na metry
   byłoby zmyśleniem. Przecinek, bo tak pisze ilość Subiekt. */
const zapisIlosci = (n: number) => String(n).replace(".", ",");

function Dokument({ d }: { d: DokumentParagonu }) {
  return <table className="w-full border-collapse text-sm">
    <caption className="pb-1 text-left text-sm text-slate-700">
      <span className="font-semibold text-slate-900">{NAZWA_DOKUMENTU[d.typ]} {d.numer}</span>
      {" · "}{dataCyfrowa(d.data)}
    </caption>
    <thead>
      <tr className="text-left text-xs text-slate-600">
        <th scope="col" className="py-0.5 pr-2 font-normal">Symbol</th>
        <th scope="col" className="py-0.5 pr-2 font-normal">Nazwa</th>
        <th scope="col" className="py-0.5 text-right font-normal">Ilość</th>
      </tr>
    </thead>
    <tbody>
      {d.pozycje.map((p) => <tr key={p.twId}
        className={p.sporna ? "bg-slate-100 font-semibold text-slate-900"
          : p.usluga ? "text-slate-500" : "text-slate-800"}>
        <td className="py-1 pl-1 pr-2 align-top">
          {/* Usługa nie ma czego szukać w Subiekcie, więc nie dostaje celu.
              Brak symbolu to kreska z opisem, bo kolumna jest wąska, a pusty
              przycisk kopiowania obiecywałby coś, czego nie ma. */}
          {p.symbol === null
            ? <span className="text-slate-600" title="Brak symbolu w kopii kartoteki">
                <span aria-hidden="true">—</span><span className="sr-only">brak symbolu w kopii kartoteki</span></span>
            : p.usluga ? <span className="font-mono">{p.symbol}</span> : <SymbolTowaru symbol={p.symbol} />}
        </td>
        <td className="min-w-0 break-words py-1 pr-2 align-top">
          {/* Bez nazwy nie ma też karty, więc szuflada przekroju nie otworzyłaby
              niczego i przycisk byłby martwym celem. */}
          {p.nazwa === null
            ? <span className="font-normal text-slate-600">nazwa nieznana</span>
            : p.usluga ? p.nazwa : <PrzyciskTowaru twId={p.twId}>{p.nazwa}</PrzyciskTowaru>}
          {p.sporna && <span className="ml-1.5 whitespace-nowrap rounded border border-slate-400 bg-white px-1 text-xs font-semibold text-slate-700">
            reklamowany</span>}
        </td>
        <td className="py-1 pr-1 text-right align-top tabular-nums">{zapisIlosci(p.ilosc)}</td>
      </tr>)}
    </tbody>
  </table>;
}

/* Bez pola `paragon` sekcja milczy: to „serwer jeszcze nie powiedział”,
   a „brak paragonu” w tej chwili byłby fałszywym faktem. */
function KupionyTowar({ paragon }: { paragon: ParagonReklamacji }) {
  const { dokumenty } = paragon;
  const nieSporna = dokumenty.flatMap((d) => d.pozycje).filter((p) => !p.usluga);
  /* Przy jednym towarze nie ma czego rozstrzygać. Przy kilku bez wskazania
     zdanie mówi, że wybór należy do agenta, zamiast udawać pewność. */
  const bezWskazania = !nieSporna.some((p) => p.sporna) && nieSporna.length > 1;
  return <section aria-label="Kupiony towar" className="flex flex-col gap-2">
    <h3 className="text-xs font-bold text-slate-700">Kupiony towar</h3>
    {dokumenty.length > 0
      ? <>
          {dokumenty.map((d) => <Dokument key={d.dokId} d={d} />)}
          {bezWskazania && <p className="text-sm text-slate-600">
            Dokument nie wskazuje, którą pozycję klient reklamuje.</p>}
        </>
      : <div className="flex flex-col gap-0.5 text-sm">
          <span className="font-semibold text-slate-900">Brak paragonu ani faktury w Subiekcie</span>
          {powodBrakuParagonu(paragon) && <span className="text-slate-600">{powodBrakuParagonu(paragon)}</span>}
        </div>}
  </section>;
}

/** Wielka litera na początku pozycji listy — słownik trzyma słowa małymi. */
const zWielkiej = (t: string) => t.charAt(0).toLocaleUpperCase("pl") + t.slice(1);

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

/* Pytania o paczkę karta nie niesie: stoi ono przy kroku doręczenia na
   drodze sprawy (`DrogaSprawy`), obok stanu paczki. */
export function Produkt({ szczegol }: { szczegol: SzczegolReklamacji }) {
  const r = szczegol.reklamacja;
  const paragon = szczegol.paragon;
  /* Stan, półka i cennik pytają o kartotekę SPORNEJ pozycji dokumentu.
     Bez jednoznacznego wskazania nie pytają o nic: cennik cudzego towaru
     z tego samego paragonu prowadziłby werdykt w złą stronę. */
  const twId = paragon?.spornaTwId ?? null;
  /* Ten sam hak, co w skrzynce — TanStack trzyma kartę pod jednym kluczem,
     więc otwarcie sprawy nie pyta serwera drugi raz o tę samą kartotekę. */
  const karta = useKartaTowaru(twId);
  const k = twId !== null ? karta.data : undefined;
  /* POZIOM 0 TO CENA ZAKUPU, nie cennik sprzedaży: kolumny `tw_Cena` liczą
     się od zera, a nazwy od jedynki. Na osi stoją wyłącznie ceny sprzedaży. */
  const sprzedaz = (k?.ceny ?? []).filter((c) => c.poziom !== 0);
  const oferta = r.ofertaCenaGrosze != null ? { grosze: r.ofertaCenaGrosze, waluta: r.waluta } : null;
  const zakup = r.cenaParagonuGrosze != null ? { grosze: r.cenaParagonuGrosze, waluta: r.waluta } : null;
  const chce = r.oczekiwanie ? (OCZEKIWANIA[r.oczekiwanie] ?? r.oczekiwanie) : null;
  const powod = r.powodTyp ? (POWODY[r.powodTyp] ?? r.powodTyp) : null;
  const prawo = r.prawo ? (PRAWO[r.prawo] ?? r.prawo) : null;
  const historiaTowaru = szczegol.historia?.towar ?? null;

  return <section aria-label="Produkt" className="card flex flex-col">
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-naglowek font-bold text-slate-900">Produkt</h2>
        <DoAllegro href={r.linkOferty} nazwa="oferta w Allegro">Oferta</DoAllegro>
      </div>
      {/* Nazwa i zdjęcie to OFERTA, którą klient widział w Allegro. Co
          naprawdę wyjechało, mówi dokument niżej. */}
      <div className="flex gap-3">
        <ZdjecieOferty externalId={r.offerId} stan={r.ofertaZdjecie} rozmiar={72}
          nazwa={r.ofertaNazwa ?? "Zdjęcie oferty"} />
        <div className="flex min-w-0 flex-col gap-0.5">
          {r.ofertaNazwa
            ? <span className="font-semibold text-slate-900">{r.ofertaNazwa}</span>
            : <span className="text-slate-600">Oferty nie pobrano</span>}
          {/* Nieznana ilość milczy: jedna sztuka z domysłu udawałaby fakt. */}
          {r.ilosc !== null && <span className="text-sm text-slate-600">W reklamacji: {r.ilosc} szt.</span>}
        </div>
      </div>
      {paragon && <KupionyTowar paragon={paragon} />}
      {/* Wiersz stoi wyłącznie przy karcie z Subiekta: bez niej nie wiemy,
          a „nie wiemy” przy każdej sprawie bez kartoteki to szum. */}
      {k && <p className="text-sm text-slate-600">
        W Subiekcie: <b className={k.mag.avail > 0 ? "text-ranga-ok" : "text-ranga-zle"}>
          {k.mag.avail > 0 ? `${k.mag.avail} ${k.unit || "szt."}` : "brak na stanie"}</b>
        {k.locs.length > 0 && <> · półka {k.locs.join(", ")}</>}
      </p>}
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

  </section>;
}
