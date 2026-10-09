import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, Bot, Check, ChevronRight, ChevronUp, Clock, Copy, Image, LifeBuoy,
  Package, PackageCheck, Store, Ticket, User, type LucideIcon,
} from "lucide-react";
import type { WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";
import { pobierzZalacznik } from "../api/reklamacje";
import { useZdjecieZalacznikaReklamacji } from "../towar/useZdjecie";
import { KartaZalacznika, ListaZalacznikow } from "../towar/Zalacznik";
import { czas, dniSlowo, dzienMiesiac, godzina, ile, NaglowekSekcji, odmien, Pusto } from "../ui";
import { kopiujDoSchowka } from "../ui/kopiuj";
import { PLAKIETKA_PRZESYLKI, type ZdarzeniePrzesylki } from "./przesylki";
import { DlugaTresc, rozbierzFormularz, Tresc, zawieraOpis } from "./tresc";

/* ── Rozmowa w sprawie reklamacyjnej ─────────────────────────────────────────
   Treść zgłoszenia i czat są tym, po co agent otwiera ten ekran, więc stoją
   w GŁÓWNYM oknie — tak samo jak produkty przy zwrocie od 0.167.0. Kolumna
   dowodów niesie fakty o sprawie, nie jej treść.

   ROLA AUTORA JEST PODPISEM, a nie ozdobą. Rozmowa reklamacyjna bywa
   trójstronna: `BUYER`, `SELLER` i `ADMIN`, czyli doradca Allegro. Bez
   wyraźnego podpisu agent odpowiadałby doradcy tak, jak odpowiada klientowi. */

/* ── KTO MÓWI, WIDAĆ BEZ CZYTANIA (0.416.0, dobór barw z 0.418.0) ───────────
   Dwa zgłoszenia właściciela ze zrzutami. Pierwsze: „wiadomości nasze, klienta
   i Allegro powinny być łatwo wizualnie rozpoznawalne". Drugie, po 0.416.0:
   „oznaczenie na granicy powinno być po drugiej stronie dla nas, a dla klienta
   na innej; kolor tła dla każdego powinien być inny" — plus prośba o oparcie
   tego na badaniach o szybkości znajdowania informacji.

   CO MÓWIĄ BADANIA, w trzech zdaniach.

   1. BARWA JEST PREATENTYWNA. Teoria integracji cech (Treisman i Gelade, 1980)
      dzieli wyszukiwanie na dwa tryby: cecha POJEDYNCZA — barwa, orientacja,
      rozmiar — jest kodowana równolegle na całym polu widzenia, więc czas
      znalezienia celu nie rośnie z liczbą elementów. Wyszukiwanie po KONIUNKCJI
      cech idzie szeregowo i jest znacznie wolniejsze. Wniosek dla tej osi:
      „czyja to wiadomość" ma być JEDNĄ cechą — barwą tła — a nie kombinacją
      odcienia ramki z wcięciem, którą trzeba składać po kolei.
   2. BARWA NIGDY SAMA. WCAG 2, kryterium 1.4.1: barwa nie może być jedynym
      nośnikiem informacji. Około jeden mężczyzna na dwunastu ma zaburzenie
      widzenia barw. Kodujemy więc TRZY razy: barwą tła, stroną karty i ikoną
      przy podpisie — przy braku barwy zostają dwa czytelne sygnały.
   3. STRONA JEST DARMOWA. Odsunięcie naszej wypowiedzi w prawo i listwa przy
      PRAWEJ krawędzi to układ znany z każdego komunikatora; rozpoznanie
      „to moje" nie wymaga wtedy uczenia się niczego nowego.

   BURSZTYN ZOSTAJE PRZY KLIENCIE, tak jak na osi skrzynki od 0.247.0: to ta
   sama rozmowa z tym samym człowiekiem, tylko innym wejściem. Nasza strona
   cichnie (0.265.0) — chłodna szarość i listwa po prawej. Automat Allegro
   dostaje biel i listwę PRZERYWANĄ, bo nie jest człowiekiem, a doradca własny
   błękit, bo jest człowiekiem, ale nie naszym klientem.

   CZTERY KLASY, NIE WIĘCEJ. Prawo Hicka: każda dołożona kategoria wydłuża
   wybór. Pięć ról dzieli się na cztery wyglądy, bo magazyn Allegro i automat
   są dla agenta tym samym — maszyną po drugiej stronie. */
const ROLE: Record<string, {
  etykieta: string; klasa: string; listwa: string; Ikona: LucideIcon; nasza: boolean;
}> = {
  BUYER: {
    etykieta: "Klient", Ikona: User, nasza: false,
    klasa: "bg-amber-50 border-amber-200", listwa: "border-l-4 border-l-wertis-amber",
  },
  SELLER: {
    etykieta: "My", Ikona: Store, nasza: true,
    /* LISTWA PO PRAWEJ — przy tej krawędzi, przy której stoi karta. */
    klasa: "bg-slate-100 border-slate-200", listwa: "border-r-4 border-r-slate-400",
  },
  ADMIN: {
    etykieta: "Doradca Allegro", Ikona: LifeBuoy, nasza: false,
    klasa: "bg-sky-50 border-sky-200", listwa: "border-l-4 border-l-sky-500",
  },
  /* Automat nie jest człowiekiem i ma tak wyglądać: biel bez barwy i listwa
     PRZERYWANA — przerwa czyta się jako „to nie jest czyjaś wypowiedź". */
  SYSTEM: {
    etykieta: "Allegro (automat)", Ikona: Bot, nasza: false,
    klasa: "bg-white border-slate-200", listwa: "border-l-4 border-dashed border-l-slate-400",
  },
  FULFILLMENT: {
    etykieta: "Magazyn Allegro", Ikona: Bot, nasza: false,
    klasa: "bg-white border-slate-200", listwa: "border-l-4 border-dashed border-l-slate-400",
  },
};

/**
 * Zdjęcie klienta WPROST na osi (0.223.0), od wydania „wspólny załącznik"
 * tą samą powłoką co skrzynka (`towar/Zalacznik.tsx`).
 *
 * W sklepie z częściami zdjęcie pękniętego elementu bywa CAŁYM zgłoszeniem,
 * a nazwa pliku nie mówi o nim nic. Ta sama lekcja, którą skrzynka kupiła
 * w 0.218.0 — tylko że tam bramką był stan `SAFE` z Centrum Wiadomości,
 * a tu rozstrzygają BAJTY po stronie serwera.
 *
 * `podglad` to podpowiedź z NAZWY pliku, więc bywa nieprawdziwa: plik nazwany
 * `usterka.jpg`, który obrazem nie jest, dostaje z trasy 415 i zostaje przy
 * samej nazwie z pobraniem. To odpowiedź, nie awaria. Awaria (502 Allegro
 * odmówiło, 503 droga do Allegro) MÓWI zdaniem pod nazwą i daje ponowienie —
 * do tego wydania czat reklamacji milczał w obu przypadkach jednakowo.
 *
 * Opakowanie per źródło, bo obraz wisi na haku REKLAMACJI, a haka nie wolno
 * wołać w pętli ani warunkowo.
 */
export function ZalacznikSprawy({ reklamacjaId, z }: {
  reklamacjaId: number; z: ZalacznikReklamacji;
}) {
  const obraz = useZdjecieZalacznikaReklamacji(reklamacjaId, z.podglad ? z.id : null);
  /* Zawsze do pobrania: `PostPurchaseIssueAttachment` nie niesie stanu
     `SAFE`/`UNSAFE`, więc nie mamy podstaw, żeby pobranie zablokować. */
  return <KartaZalacznika nazwa={z.nazwa || "załącznik"} podglad={z.podglad} obraz={obraz}
    pobierz={() => pobierzZalacznik(reklamacjaId, z.id, z.nazwa)} />;
}

function Zalaczniki({ reklamacjaId, lista }: {
  reklamacjaId: number; lista: ZalacznikReklamacji[];
}) {
  if (!lista.length) return null;
  return <ListaZalacznikow>
    {lista.map((z) => <ZalacznikSprawy key={z.id} reklamacjaId={reklamacjaId} z={z} />)}
  </ListaZalacznikow>;
}

/**
 * Odnośniki do zdjęć, które stoją w kolumnie obok rozmowy.
 *
 * Wiadomość zachowuje MIEJSCE zdjęcia w wątku, ale nie jego wysokość. Agent
 * widzi, że klient coś przysłał właśnie tu, a kliknięcie pokazuje to zdjęcie
 * w kolumnie i przenosi na nie fokus. Znak `Z1` jest tym samym, którym
 * dowody biura odsyłają do zdjęcia, więc wątek i wpis mówią jednym numerem.
 */
function OdnosnikiZdjec({ lista, onPokaz, znak }: {
  lista: ZalacznikReklamacji[]; onPokaz: (id: number) => void;
  znak?: (id: number) => string | null;
}) {
  if (!lista.length) return null;
  return <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
    {lista.map((z) => {
      const nazwa = z.nazwa || "zdjęcie";
      const numer = znak?.(z.id) ?? null;
      /* WIDOCZNY TEKST NA POCZĄTKU NAZWY (WCAG 2.5.3). Z numerem przycisk
         pokazuje „Z1 usterka.jpg", więc tak zaczyna się jego nazwa, a sterujący
         głosem mówi „kliknij Z1". Bez numeru nazwa zostaje jak w dyskusjach,
         bo tam widoczny tekst to sama nazwa pliku i reguła jest spełniona. */
      const etykieta = numer ? `${numer} ${nazwa} — pokaż zdjęcie w kolumnie`
        : `Pokaż zdjęcie w kolumnie: ${nazwa}`;
      return <li key={z.id} className="min-w-0">
        <button type="button" onClick={() => onPokaz(z.id)} aria-label={etykieta}
          className="inline-flex min-h-6 max-w-full items-center gap-1 font-semibold text-slate-700
            underline underline-offset-2 hover:text-slate-900">
          <Image size={12} aria-hidden="true" className="shrink-0 text-slate-500" />
          {/* Spacja jest dla tekstu przycisku, nie dla układu: flex jej nie
              rysuje, a „Z1 usterka.jpg" czyta się jako dwa słowa. */}
          {numer && <><span className="shrink-0 tabular-nums">{numer}</span>{" "}</>}
          <span className="truncate">{nazwa}</span>
          <span aria-hidden="true">→</span>
        </button>
      </li>;
    })}
  </ul>;
}

/** Rola autora z kształtem NIEZNANEGO dla wartości spoza zbioru (niżej powód). */
const rolaWiadomosci = (w: WiadomoscReklamacji) => ROLE[w.autorRola ?? ""] ?? {
  etykieta: w.autorRola ?? "Nieznany autor", Ikona: User, nasza: false,
  klasa: "bg-white border-slate-200", listwa: "border-l-4 border-dotted border-l-slate-400",
};

/** Kto napisał wiadomość — ten sam podpis w wątku i w kolumnie zdjęć ekranu. */
export const etykietaRoli = (w: WiadomoscReklamacji) => rolaWiadomosci(w).etykieta;

/* ── STARSZA WIADOMOŚĆ KLIENTA CICHNIE (na życzenie ekranu) ─────────────────
   Przy długiej rozmowie każda karta klienta świeciła tym samym bursztynem,
   więc ten jeden odcień nie mówił już, która wypowiedź czeka na nas. Ekran
   reklamacji prosi o bursztyn wyłącznie przy OSTATNIEJ wiadomości klienta.
   Starsze dostają neutralne tło i szarą listwę, a strona, ikona i podpis
   zostają — barwa nigdy nie była jedynym znakiem autora (WCAG 1.4.1). */
const STARSZA_KLIENTA = {
  klasa: "bg-white border-slate-200", listwa: "border-l-4 border-l-slate-400",
};

/**
 * Tyle o sprawie, ile ten komponent naprawdę czyta.
 *
 * KSZTAŁT STRUKTURALNY, nie `Reklamacja`, od 0.245.0 — bo ten sam czat rysuje
 * dyskusję, a dyskusja nie ma ani powodu, ani oferty, ani terminu. Trzymanie
 * tu pełnego typu reklamacji kazałoby albo zduplikować komponent, albo podać
 * dyskusji dwadzieścia pól z `null`, z których żadne nie jest prawdą o niej.
 *
 * `opisZgloszenia` skleja go WOŁAJĄCY: przy reklamacji to `powodOpis` z zejściem
 * na `opis`, przy dyskusji sam `opis`. Rozstrzyganie tego tutaj wymagałoby
 * z powrotem wiedzy o rodzaju sprawy.
 */
export interface SprawaCzatu {
  id: number;
  /** Zgłoszenie własnymi słowami klienta; `null`, gdy nic nie napisał. */
  opisZgloszenia: string | null;
  /** Ile wiadomości widzi Allegro — po tym poznaje się rozmowę niepełną. */
  wiadomosciIle: number;
  /** Czy rozmowę urwał NASZ bezpiecznik stron — wtedy reszta NIE dojdzie sama. */
  czatUrwany: boolean;
}

/* ── JEDNA WIADOMOŚĆ (0.415.0) ───────────────────────────────────────────────
   Formularz Allegro składa się pod zdanie klienta, a „pokaż całość" rozwija go
   słowo w słowo — z adresem do zwrotu włącznie. Chowamy POWTÓRZENIE, nigdy
   treść: powód i oczekiwanie stoją już w głowicy sprawy, a tytuł prawny
   w zwijce „Sprawa" — po polsku i każde w jednym miejscu.

   STAN JEST NA WIADOMOŚCI, nie na osi: rozwinięcie jednego formularza nie ma
   prawa rozwijać drugiego, a oś bywa jedenastowiadomościowa. */
function TrescKarty({ tekst, nasza }: { tekst: string; nasza: boolean }) {
  const [calosc, setCalosc] = useState(false);
  const formularz = rozbierzFormularz(tekst);
  /* NASZA DŁUGA ZWIJA SIĘ DO CZTERECH LINII (0.511.0). Do tej pory zwijał się
     tylko formularz Allegro, a nasza odpowiedź ze stopką stała w całości —
     ta sama ściana, którą skrzynka zdjęła w 0.506.0. Cudzych nie zwijamy:
     zdanie klienta albo doradcy jest tym, co agent przyszedł przeczytać. */
  if (nasza && !formularz) {
    return <DlugaTresc tekst={tekst} className="mt-1 text-tresc text-slate-800" />;
  }
  if (!formularz || calosc) {
    return <>
      <Tresc tekst={tekst} className="mt-1 text-tresc text-slate-800" />
      {formularz && <button type="button" onClick={() => setCalosc(false)}
        className="mt-1 text-podpis font-semibold text-slate-600 underline underline-offset-2">
        zwiń formularz Allegro</button>}
    </>;
  }
  return <>
    <Tresc tekst={formularz.opis} className="mt-1 text-tresc text-slate-800" />
    <button type="button" onClick={() => setCalosc(true)}
      className="mt-1 text-podpis font-semibold text-slate-600 underline underline-offset-2">
      pokaż całość — formularz Allegro z adresem do zwrotu</button>
  </>;
}

/** Zdjęcia w kolumnie ekranu: `pokaz` przewija do zdjęcia, `znak` podaje numer `Z1`. */
export interface ZdjeciaObok {
  pokaz: (zalacznikId: number) => void;
  znak?: (zalacznikId: number) => string | null;
}

/* ── DWIE DROGI ZDJĘĆ, NIGDY OBIE NARAZ ─────────────────────────────────────
   `kolumnaZdjec` rysuje kolumnę zdjęć SAMA rozmowa — tak ma ją ekran dyskusji,
   który poza zdjęciami nie ma obok czego postawić. `zdjeciaObok` oddaje
   kolumnę ekranowi reklamacji, bo tam obok zdjęć stoją dowody biura i to, co
   wysłaliśmy. Obie naraz dałyby dwie kolumny tych samych zdjęć, więc typ
   pozwala na jedną z nich. */
type ZdjeciaCzatu =
  | { kolumnaZdjec?: boolean; zdjeciaObok?: undefined }
  | { kolumnaZdjec?: false; zdjeciaObok?: ZdjeciaObok };

/* ── AUTOMAT ALLEGRO TO ZDARZENIE, NIE WYPOWIEDŹ ─────────────────────────────
   Makieta właściciela: wiadomość automatu stoi cienkim wierszem z ikoną
   w kółku, krótką nazwą i czasem po prawej, bez dymka. Automat nie jest
   rozmówcą, więc dymek obok klienta i doradcy udawałby trzecią osobę
   w rozmowie i zabierał jej wysokość.

   NAZWA Z TREŚCI, PEŁNA TREŚĆ POD ROZWINIĘCIEM. Rozpoznajemy po słowach,
   bo Allegro nie nadaje automatom rodzaju. Wzorców nie sprawdzono na żywych
   treściach, więc pomyłka kosztuje najwyżej ogólną nazwę: pełne zdanie,
   z odnośnikiem do formularza, stoi zawsze jedno kliknięcie dalej.

   KOLEJNE AUTOMATY POD RZĄD TO JEDEN WIERSZ. Etykieta i nadanie tej samej
   paczki to jedna historia, a dwa wiersze to dwa miejsca do przeczytania.
   Przypomnienie o terminie stoi osobno, bo niesie barwę uwagi, a w złożonym
   wierszu by ją zgubiło. */

export type RodzajAutomatu = "termin" | "etykieta" | "nadanie" | "doreczenie" | "inny";

export interface Automat {
  rodzaj: RodzajAutomatu;
  nazwa: string;
  /** Fakt wyciągnięty z treści, gdy jest; inaczej `null`. */
  fakt: string | null;
  /** Numer przesyłki: pierwszy ciąg co najmniej dziesięciu cyfr. */
  numer: string | null;
}

/* Dziesięć cyfr to najkrótszy numer listu przewoźników w Polsce. Krótszy
   ciąg bywa kwotą, kodem pocztowym albo numerem sprawy. */
const NUMER = /(?<!\d)\d{10,}(?!\d)/;
const DNI = /(\d+)\s*(?:dni|dzień|dnia)\b/i;

/** Co mówi wiadomość automatu: rodzaj, krótka nazwa, wyciągnięty fakt i numer paczki. */
export function rozpoznajAutomat(tresc: string): Automat {
  const t = tresc.toLowerCase();
  const numer = tresc.match(NUMER)?.[0] ?? null;
  if (/etykiet/.test(t)) return { rodzaj: "etykieta", nazwa: "Etykieta wygenerowana", fakt: null, numer };
  if (/nadan|nadał/.test(t)) return { rodzaj: "nadanie", nazwa: "Paczka nadana", fakt: null, numer };
  const dni = tresc.match(DNI);
  if (dni && /decyzj|rozpatrz|odpowied|termin/.test(t)) {
    const n = Number(dni[1]);
    return { rodzaj: "termin", nazwa: "Przypomnienie Allegro", numer,
      fakt: `do decyzji ${odmien(n, "został", "zostały", "zostało")} ${dniSlowo(n)}` };
  }
  if (/doręcz|dostarcz/.test(t)) return { rodzaj: "doreczenie", nazwa: "Paczka doręczona", fakt: null, numer };
  /* Pierwsze zdanie jako fakt: tyle mieści się w wierszu, a resztę ucina
     klasa `truncate`, nie nożyczki na napisie. */
  const zdanie = tresc.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return { rodzaj: "inny", nazwa: "Automat Allegro", fakt: zdanie || null, numer };
}

const IKONA_AUTOMATU: Record<RodzajAutomatu, LucideIcon> = {
  termin: Clock, etykieta: Ticket, nadanie: Package, doreczenie: PackageCheck, inny: Bot,
};

/** Chwila w wierszu zdarzenia — „05.10, 09:00”, jak na makiecie. */
const chwila = (v: string | null | undefined) => (v ? `${dzienMiesiac(v)}, ${godzina(v)}` : "");

/* Grupa w jednym dniu mówi dzień raz: „30.09, 13:39–14:16”. */
function zakresChwil(od: string | null, doo: string | null): string {
  if (!od || !doo || od === doo) return chwila(od ?? doo);
  return dzienMiesiac(od) === dzienMiesiac(doo)
    ? `${dzienMiesiac(od)}, ${godzina(od)}–${godzina(doo)}` : `${chwila(od)} – ${chwila(doo)}`;
}

/**
 * Numer przesyłki jako chip do skopiowania.
 *
 * Skrócony W ŚRODKU, bo numer listu rozpoznaje się po początku (przewoźnik)
 * i po końcu (to, co dyktuje klient). Pełny numer stoi w nazwie i w dymku.
 * Kopiuje `kopiujDoSchowka`, bo biuro pracuje po zwykłym HTTP.
 */
export function NumerPrzesylki({ numer }: { numer: string }) {
  const [stan, setStan] = useState<"gotowe" | "zrobione" | "blad">("gotowe");
  const kopiuj = () => {
    void kopiujDoSchowka(numer).then((udalo) => {
      setStan(udalo ? "zrobione" : "blad");
      setTimeout(() => setStan("gotowe"), udalo ? 1500 : 3000);
    });
  };
  const skrot = numer.length > 16 ? `${numer.slice(0, 10)}…${numer.slice(-6)}` : numer;
  return <>
    <button type="button" onClick={kopiuj} title={numer} aria-label={`Kopiuj numer przesyłki ${numer}`}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-xs text-wertis-ink ${
        stan === "zrobione" ? "border-ranga-ok bg-emerald-50"
          : stan === "blad" ? "border-ranga-zle bg-white" : "border-slate-200 bg-white"}`}>
      <span>{skrot}</span>
      {stan === "zrobione" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
    {/* Skutek kliknięcia mówi się poza przyciskiem: nazwa przycisku z
        `aria-label` zasłoniłaby zmianę w jego środku. */}
    <span className="sr-only" aria-live="polite">
      {stan === "zrobione" ? "Numer skopiowany" : stan === "blad" ? "Nie udało się skopiować numeru" : ""}</span>
  </>;
}

function WierszAutomatow({ lista, dodatki }: {
  lista: WiadomoscReklamacji[];
  /** Załączniki automatu: odnośniki i pliki rysuje rozmowa, bo zna kolumnę zdjęć. */
  dodatki: (w: WiadomoscReklamacji) => React.ReactNode;
}) {
  const [otwarty, setOtwarty] = useState(false);
  const rozpoznane = lista.map((w) => rozpoznajAutomat(w.tresc));
  const pierwszy = rozpoznane[0];
  const termin = pierwszy.rodzaj === "termin";
  const Ikona = IKONA_AUTOMATU[pierwszy.rodzaj];
  const nazwa = rozpoznane.map((a, i) => (i ? a.nazwa.toLowerCase() : a.nazwa)).join(" → ");
  const fakt = lista.length === 1 ? pierwszy.fakt : null;
  const numer = rozpoznane.find((a) => a.numer)?.numer ?? null;
  return <li className="flex flex-col gap-0.5">
    <button type="button" aria-expanded={otwarty} onClick={() => setOtwarty((o) => !o)}
      className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left hover:bg-slate-50">
      <span aria-hidden="true" className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border ${
        termin ? "border-amber-200 bg-amber-50 text-ranga-uwaga" : "border-slate-200 bg-white text-slate-600"}`}>
        <Ikona size={15} />
      </span>
      <span className={`min-w-0 truncate text-sm ${termin ? "text-ranga-uwaga" : "text-slate-600"}`}>
        <b className={`font-semibold ${termin ? "" : "text-wertis-ink"}`}>{nazwa}</b>
        {fakt && <> · {fakt}</>}
      </span>
      <span className="flex-1" />
      <span className="whitespace-nowrap text-xs text-slate-600">
        {zakresChwil(lista[0].utworzonoAt, lista[lista.length - 1].utworzonoAt)}</span>
      <ChevronRight size={16} aria-hidden="true"
        className={`flex-none text-slate-500 transition-transform ${otwarty ? "rotate-90" : ""}`} />
    </button>
    {numer && <div className="flex items-center gap-2 pl-[42px] text-xs text-slate-600">
      <span>Nr przesyłki</span><NumerPrzesylki numer={numer} />
    </div>}
    {otwarty && <ol className="ml-[17px] mt-1 flex flex-col gap-2 border-l-2 border-slate-200 pl-6">
      {lista.map((w, i) => {
        const a = rozpoznane[i];
        const IkonaWpisu = IKONA_AUTOMATU[a.rodzaj];
        return <li key={w.id} className="text-sm">
          <div className="flex min-h-7 items-center gap-2">
            <IkonaWpisu size={14} aria-hidden="true" className="flex-none text-slate-500" />
            <span className="font-semibold text-wertis-ink">{a.nazwa}</span>
            <span className="flex-1" />
            <span className="whitespace-nowrap text-xs text-slate-600">{chwila(w.utworzonoAt)}</span>
          </div>
          <Tresc tekst={w.tresc} className="text-sm text-slate-700" />
          {dodatki(w)}
        </li>;
      })}
    </ol>}
  </li>;
}

/* ── PRZESYŁKI NA OSI (makieta „Przesyłki”) ─────────────────────────────────
   Od nas: pełne niebieskie koło ze strzałką na zewnątrz, po prawej, po
   stronie sklepu. Od klienta: puste szare koło ze strzałką do środka, po
   lewej. Kierunek niosą strona, kształt i słowo, więc barwa nie stoi sama. */

const TLO_RANGI = {
  nic: "bg-slate-100 text-slate-700",
  uwaga: "bg-amber-50 text-ranga-uwaga",
  ok: "bg-emerald-50 text-ranga-ok",
  zle: "bg-red-50 text-ranga-zle",
} as const;

function napisPlakietki(z: ZdarzeniePrzesylki): string | null {
  if (!z.plakietka) return null;
  const { etykieta } = PLAKIETKA_PRZESYLKI[z.plakietka];
  if (z.plakietka !== "doreczona") return etykieta;
  /* Czas stanu znamy tylko przy doręczeniu. Inne plakietki zostają bez
     godziny, bo godzina nadania pod nimi opisywałaby inny stan. */
  const komu = z.kierunek === "od_nas" ? "klientowi" : "do nas";
  return `${etykieta} ${komu}${z.stanAt ? ` ${chwila(z.stanAt)}` : ""}`;
}

function WierszPrzesylki({ z }: { z: ZdarzeniePrzesylki }) {
  const odNas = z.kierunek === "od_nas";
  const napis = napisPlakietki(z);
  const ranga = z.plakietka ? PLAKIETKA_PRZESYLKI[z.plakietka].ranga : "nic";
  const plakietka = napis && <span className={`whitespace-nowrap rounded-full px-2 py-px text-xs font-bold ${
    TLO_RANGI[ranga]}`}>{napis}</span>;
  const kolo = odNas
    ? <span aria-hidden="true" title="Przesyłka od nas do klienta"
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-blue-700 text-white">
        <ArrowUpRight size={14} strokeWidth={2.6} /></span>
    : <span aria-hidden="true" title="Przesyłka od klienta do nas"
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 border-slate-400 bg-white text-slate-700">
        <ArrowDownLeft size={14} strokeWidth={2.6} /></span>;
  const opis = <span className={`text-sm text-slate-600 ${odNas ? "text-right" : ""}`}>
    <b className="font-semibold text-wertis-ink">{odNas ? "Od nas" : "Od klienta"}</b>
    {` · ${z.opis}`}{z.przewoznik && ` · ${z.przewoznik}`}</span>;
  const dopiski = [z.nadanoAt && `nadana ${chwila(z.nadanoAt)}`, z.uwaga].filter(Boolean).join(" · ");
  return <li aria-label={odNas ? "Przesyłka od nas do klienta" : "Przesyłka od klienta do nas"}
    className={`flex max-w-[86%] flex-col gap-1 ${odNas ? "items-end self-end" : "items-start self-start"}`}>
    <div className="flex min-h-8 flex-wrap items-center gap-2.5">
      {odNas ? <>{plakietka}{opis}{kolo}</> : <>{kolo}{opis}{plakietka}</>}
    </div>
    {(z.waybill || dopiski) && <div className={`flex flex-wrap items-center gap-2 text-xs text-slate-600 ${
      odNas ? "pr-[38px]" : "pl-[38px]"}`}>
      {z.waybill && <><span>Nr</span><NumerPrzesylki numer={z.waybill} /></>}
      {dopiski && <span>{z.waybill ? `· ${dopiski}` : dopiski}</span>}
    </div>}
  </li>;
}

/* Wpis osi: wiadomość, złożony wiersz automatów albo przesyłka. */
type WpisOsi =
  | { typ: "wiadomosc"; w: WiadomoscReklamacji }
  | { typ: "automaty"; lista: WiadomoscReklamacji[] }
  | { typ: "przesylka"; z: ZdarzeniePrzesylki };

const msOd = (v: string | null) => (v ? Date.parse(v) : NaN);

/**
 * Oś po czasie: wiadomości w kolejności rozmowy, przesyłki wstawione między
 * nie według chwili, automaty pod rząd złożone w jeden wiersz.
 *
 * Przesyłka bez chwili stoi na końcu, bo to stan bieżący. Przesyłka starsza
 * od pierwszej widocznej wiadomości chowa się razem ze zwiniętymi, inaczej
 * stanęłaby na górze w złym miejscu historii.
 */
export function ulozOs(wiadomosci: WiadomoscReklamacji[], zdarzenia: ZdarzeniePrzesylki[],
  odChwili: string | null = null): WpisOsi[] {
  const prog = msOd(odChwili);
  const zDatą = zdarzenia.filter((z) => z.moment !== null && !(msOd(z.moment) < prog))
    .sort((a, b) => msOd(a.moment) - msOd(b.moment));
  const bezDaty = zdarzenia.filter((z) => z.moment === null);
  const os: WpisOsi[] = [];
  let k = 0;
  for (const w of wiadomosci) {
    const t = msOd(w.utworzonoAt);
    /* Równa chwila zostawia wiadomość pierwszą: to ona zwykle ogłasza paczkę. */
    while (k < zDatą.length && msOd(zDatą[k].moment) < t) os.push({ typ: "przesylka", z: zDatą[k++] });
    const poprzedni = os[os.length - 1];
    const automat = w.autorRola === "SYSTEM";
    if (automat && poprzedni?.typ === "automaty"
      && rozpoznajAutomat(poprzedni.lista[0].tresc).rodzaj !== "termin"
      && rozpoznajAutomat(w.tresc).rodzaj !== "termin") {
      poprzedni.lista.push(w);
    } else {
      os.push(automat ? { typ: "automaty", lista: [w] } : { typ: "wiadomosc", w });
    }
  }
  for (; k < zDatą.length; k++) os.push({ typ: "przesylka", z: zDatą[k] });
  for (const z of bezDaty) os.push({ typ: "przesylka", z });
  return os;
}

export function Czat({ sprawa, czat, zalaczniki, edytor, przypnijZgloszenie = false,
  zwinStarsze, bursztynTylkoOstatniej = false, kolumnaZdjec = false, zdjeciaObok, zdarzenia = [] }: ZdjeciaCzatu & {
  sprawa: SprawaCzatu;
  czat: WiadomoscReklamacji[];
  /** Przesyłki sprawy (`zdarzeniaPrzesylek`) — staną na osi według chwili. */
  zdarzenia?: ZdarzeniePrzesylki[];
  /** Załączniki SAMEJ sprawy — te spoza rozmowy. */
  zalaczniki: ZalacznikReklamacji[];
  /* Edytor wstrzykiwany, nie wołany stąd: cały katalog `reklamacje/` trzyma
     komponenty czyste, a mutacje mieszkają w ekranie (wzorzec `skrzynka/`). */
  edytor?: React.ReactNode;
  /* ── TRZY ZACHOWANIA NA ŻYCZENIE EKRANU ───────────────────────────────────
     Rozmowę rysuje też ekran dyskusji i tam nic się nie zmienia: każde z nich
     jest domyślnie wyłączone, a włącza je wyłącznie ekran reklamacji. */
  /** Zgłoszenie stoi nad rozmową, poza przewijaniem — objaw zawsze w zasięgu oka. */
  przypnijZgloszenie?: boolean;
  /** Ile OSTATNICH wiadomości widać od razu; starsze chowa jeden przycisk. */
  zwinStarsze?: number;
  /** Bursztyn tylko na ostatniej wiadomości klienta, starsze cichną. */
  bursztynTylkoOstatniej?: boolean;
}) {
  /* Ile wiadomości Allegro widzi, a ilu jeszcze nie mamy. Rozmowa dociąga się
     taktem synchronizacji, więc świeża sprawa bywa przez chwilę niepełna —
     i ekran ma to POWIEDZIEĆ, zamiast pokazywać urwaną rozmowę jak całą. */
  const brakuje = Math.max(0, sprawa.wiadomosciIle - czat.length);

  /* ── KOTWICA PRZY NAJNOWSZEJ (0.415.0) ───────────────────────────────────
     Rozmowa reklamacyjna bywa jedenastowiadomościowa, a czyta się ją od
     KOŃCA: pierwsze pytanie agenta brzmi „co on napisał ostatnio". Do tego
     wydania ekran otwierał ją na pierwszej wiadomości i przewijanie było
     pierwszą czynnością przy każdej sprawie.

     RAZ NA SPRAWĘ, NIE PRZY KAŻDYM RENDERZE, i to jest cała ostrożność tego
     ruchu. Od 0.410.0 wejście w reklamację odświeża ją z Allegro, więc oś
     potrafi się przerysować sekundę po otwarciu — przewijanie przy każdej
     zmianie wyrywałoby agentowi miejsce czytania spod oka. Znacznik pamięta,
     którą sprawę już zakotwiczyliśmy; rozmowa dociąga się asynchronicznie,
     więc czekamy z tym na pierwszą wiadomość. */
  /* Kotwica stoi ZA edytorem, nie na ostatniej wiadomości: zwinięty edytor
     przykleja się do dolnej krawędzi i zakryłby jej ostatnie linie. */
  const koniec = useRef<HTMLDivElement | null>(null);
  const zakotwiczona = useRef<number | null>(null);
  useEffect(() => {
    if (czat.length === 0 || zakotwiczona.current === sprawa.id) return;
    zakotwiczona.current = sprawa.id;
    /* `jsdom` tej metody nie ma, a i przeglądarka bywa starsza od niej. */
    koniec.current?.scrollIntoView?.({ block: "nearest" });
  }, [sprawa.id, czat.length]);

  /* ── STARSZE WIADOMOŚCI ZWINIĘTE ─────────────────────────────────────────
     Rozmowę czyta się od końca, a przy dwudziestu wiadomościach pierwszych
     osiemnaście to historia, którą agent zna. Zwinięte zostają za JEDNYM
     przyciskiem z liczbą — nic nie znika, a ostatnie słowa stoją na wierzchu.
     Jedna schowana wiadomość nie dostaje przycisku, bo przycisk zająłby jej
     miejsce i niczego by nie oszczędził. Rozwinięcie pamięta sprawę, więc
     przejście do następnej znów pokazuje ją zwiniętą. */
  const [rozwinieta, setRozwinieta] = useState<number | null>(null);
  const nadmiar = zwinStarsze === undefined || rozwinieta === sprawa.id
    ? 0 : Math.max(0, czat.length - zwinStarsze);
  const schowanych = nadmiar >= 2 ? nadmiar : 0;
  const widoczne = czat.slice(schowanych);

  /* ── ZGŁOSZENIE RAZ, NIE DWA (0.412.0) ──────────────────────────────────
     Allegro przy części spraw wpisuje ten sam tekst w dwa miejsca ładunku:
     w opis zgłoszenia i w pierwszą wiadomość kupującego. Ekran pokazywał oba,
     jeden pod drugim — agent czytał to samo zdanie dwa razy, zanim doszedł do
     czegokolwiek, co je rozstrzyga.

     ZOSTAJE ROZMOWA, znika ramka: wiadomość ma autora, godzinę i swoje
     miejsce w wątku, a ramka nie ma żadnej z tych rzeczy. Gdy zgłoszenie
     NIE jest dublem — a bywa, bo opis idzie z formularza reklamacji —
     ramka stoi jak dotąd.

     BLIZNA WŁASNA (0.415.0): do tego wydania porównywaliśmy teksty na
     RÓWNOŚĆ, więc warunek nie trafiał nigdy. Allegro wkłada zdanie klienta
     w swój formularz, a wtedy dublem jest ZAWARCIE, nie równość. Znalazł to
     zrzut właściciela, nie test — bo test karmiliśmy wymyśloną parą.

     ZAŁĄCZNIKI SPRAWY nie są dublem NIGDY: wiszą na sprawie, nie na
     wiadomości. Dubel zdejmuje więc zdanie, a nie sekcję. */
  /* Przy zwiniętej rozmowie dublem jest tylko to, co WIDAĆ: gdy pierwsza
     wiadomość klienta siedzi pod przyciskiem, zgłoszenie jest jedynym miejscem,
     w którym ten objaw w ogóle stoi na ekranie. */
  const pierwszaKlienta = czat.findIndex((w) => w.autorRola === "BUYER");
  const dubel = sprawa.opisZgloszenia !== null && pierwszaKlienta >= schowanych
    && pierwszaKlienta >= 0 && zawieraOpis(czat[pierwszaKlienta].tresc, sprawa.opisZgloszenia);
  const opisWart = !dubel;
  const ostatniaKlienta = bursztynTylkoOstatniej
    ? [...czat].reverse().find((w) => w.autorRola === "BUYER")?.id ?? null : null;

  /* ── ROZMOWA PRZEWIJA SIĘ SAMA (0.418.0) ─────────────────────────────────
     Zgłoszenie właściciela ze zrzutem: „werdykt nie jest przyklejony". Na
     zrzucie pasek werdyktu leżał w połowie wątku, między tekstem wiadomości
     a jej zdjęciem — bo cała kolumna była JEDNYM obszarem przewijania,
     w którym oś, pole odpowiedzi i werdykt płynęły razem.

     Przewija się wyłącznie rozmowa z odpowiedzią. Wszystko, co ma stać
     w miejscu — werdykt reklamacji, pasek zakończenia dyskusji — rysuje
     ekran poza tym komponentem. Pole odpowiedzi nie potrzebuje osobnego
     pasa: przykleja się do krawędzi samo (niżej). */
  /* ── ZDJĘCIA OBOK ROZMOWY ────────────────────────────────────────────────
     Zgłoszenie właściciela: zdjęcia zajmowały dużą część czatu. Kafel ma
     do 256 px wysokości, więc trzy zdjęcia z telefonu wypychały następną
     wiadomość poza ekran, a rozmowę czyta się od końca.

     Zdjęcie idzie do kolumny obok, a w wątku zostaje odnośnik w tym samym
     miejscu. Kolejność czytania się nie zmienia, zmienia się tylko wysokość
     wiadomości. Plik bez podglądu zostaje w wątku: to jedna linia z nazwą,
     a odnośnik do niej byłby tej samej wysokości.

     Kolumnę rysuje rozmowa (`kolumnaZdjec`, prawa ćwiartka) albo ekran
     (`zdjeciaObok`). Własna kolumna rozmowy przewija się osobno, bo zdjęć
     bywa więcej niż wiadomości, a bez zdjęć nie ma jej wcale, żeby rozmowa
     nie traciła ćwiartki na pustkę. */
  const przedrostek = useId();
  const idZdjecia = (z: number) => `${przedrostek}-zdjecie-${z}`;
  const wlasnaKolumna = kolumnaZdjec && !zdjeciaObok;
  const zdjecia = (lista: ZalacznikReklamacji[]) => lista.filter((z) => z.podglad);
  const pliki = (lista: ZalacznikReklamacji[]) =>
    wlasnaKolumna || zdjeciaObok ? lista.filter((z) => !z.podglad) : lista;
  const grupyZdjec = !wlasnaKolumna ? [] : [
    { klucz: "zgloszenie", podpis: "Zgłoszenie", lista: zdjecia(zalaczniki) },
    ...czat.map((w) => ({
      klucz: `w-${w.id}`,
      podpis: `${rolaWiadomosci(w).etykieta} · ${czas(w.utworzonoAt)}`,
      lista: zdjecia(w.zalaczniki),
    })),
  ].filter((g) => g.lista.length > 0);
  const zKolumna = grupyZdjec.length > 0;
  /* Fokus, nie samo przewinięcie: obramowanie fokusu pokazuje, KTÓRE zdjęcie
     z kolumny jest tym z wiadomości, a czytnik ekranu idzie za nim. */
  const pokazZdjecie = (z: number) => {
    const el = document.getElementById(idZdjecia(z));
    el?.scrollIntoView?.({ block: "nearest" });
    el?.focus();
  };
  const odnosniki = (lista: ZalacznikReklamacji[]) => zdjeciaObok
    ? <OdnosnikiZdjec lista={zdjecia(lista)} onPokaz={zdjeciaObok.pokaz} znak={zdjeciaObok.znak} />
    : zKolumna ? <OdnosnikiZdjec lista={zdjecia(lista)} onPokaz={pokazZdjecie} /> : null;
  const sekcjaZgloszenia = opisWart || pliki(zalaczniki).length > 0
    || ((zKolumna || Boolean(zdjeciaObok)) && zdjecia(zalaczniki).length > 0);

  const zgloszenie = sekcjaZgloszenia &&
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <NaglowekSekcji jako="h3">
        {opisWart ? "Zgłoszenie" : "Załączniki zgłoszenia"}</NaglowekSekcji>
      {opisWart && (sprawa.opisZgloszenia === null
        ? <p className="mt-1 text-sm text-slate-800">
            Klient nie opisał sprawy własnymi słowami.</p>
        /* Przypięte zgłoszenie stoi poza przewijaniem, więc długie zwija się
           do czterech linii — inaczej zabrałoby rozmowie całą wysokość. */
        : przypnijZgloszenie
          ? <DlugaTresc tekst={sprawa.opisZgloszenia} className="mt-1 text-sm text-slate-800"
              etykieta="Pokaż całe zgłoszenie" />
          : <Tresc tekst={sprawa.opisZgloszenia} className="mt-1 text-sm text-slate-800" />)}
      {odnosniki(zalaczniki)}
      <Zalaczniki reklamacjaId={sprawa.id} lista={pliki(zalaczniki)} />
    </section>;

  const rozmowa = <div className="flex min-h-0 flex-1 flex-col">
    {przypnijZgloszenie && zgloszenie &&
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">{zgloszenie}</div>}
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
    {!przypnijZgloszenie && zgloszenie}

    {/* DWA POWODY NIEPEŁNEJ ROZMOWY I DWA RÓŻNE ZDANIA (0.273.0). Do 0.272.0
        stało tu jedno: „Reszta dojdzie następną synchronizacją". Przy rozmowie
        urwanej naszym bezpiecznikiem stron była to nieprawda — nie dochodziła
        nigdy, bo po drugą stronę rozmowy nikt nie szedł. Obietnica bez pokrycia
        jest gorsza od przyznania się, czego nie mamy. */}
    {brakuje > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <b>Ta rozmowa jest niepełna:</b> Allegro widzi {sprawa.wiadomosciIle} wiadomości,
      a mamy {czat.length}.{" "}
      {sprawa.czatUrwany
        ? "To rozmowa wyjątkowo długa — resztę przeczytasz w Centrum Sprzedaży."
        : "Reszta dojdzie następną synchronizacją."}
    </p>}

    {czat.length === 0
      ? <Pusto waga="lista">
          Rozmowy jeszcze nie pobrano.</Pusto>
      : <>
        {schowanych > 0 && <button type="button" aria-expanded="false"
          onClick={() => setRozwinieta(sprawa.id)}
          className="inline-flex min-h-6 items-center gap-1 self-start text-xs font-semibold
            text-slate-700 underline underline-offset-2 hover:text-slate-900">
          <ChevronUp size={14} aria-hidden="true" />
          {ile(schowanych, "wcześniejsza wiadomość", "wcześniejsze wiadomości", "wcześniejszych wiadomości")}
        </button>}
        <ol className="flex flex-col gap-2">
          {ulozOs(widoczne, zdarzenia, schowanych > 0 ? widoczne[0]?.utworzonoAt ?? null : null).map((wpis) => {
            if (wpis.typ === "przesylka") return <WierszPrzesylki key={wpis.z.klucz} z={wpis.z} />;
            if (wpis.typ === "automaty") return <WierszAutomatow key={`a-${wpis.lista[0].id}`} lista={wpis.lista}
              dodatki={(w) => <>{odnosniki(w.zalaczniki)}
                <Zalaczniki reklamacjaId={sprawa.id} lista={pliki(w.zalaczniki)} /></>} />;
            const { w } = wpis;
            /* Rola spoza zbioru dostaje kształt NIEZNANEGO, a nie kształt
               klienta: schemat Allegro może dołożyć wartość, a wtedy ekran ma
               powiedzieć „nie wiem, kto to", zamiast zgadywać stronę. */
            const rola = rolaWiadomosci(w);
            const cicha = ostatniaKlienta !== null && w.autorRola === "BUYER" && w.id !== ostatniaKlienta;
            const wyglad = cicha ? STARSZA_KLIENTA : rola;
            return <li key={w.id}
              className={`rounded-lg border p-3 ${wyglad.klasa} ${wyglad.listwa} ${
                rola.nasza ? "ml-8" : "mr-8"}`}>
              <div className="flex items-center gap-2 text-xs">
                <rola.Ikona size={13} aria-hidden="true" className="shrink-0 text-slate-600" />
                <b className="text-slate-700">{rola.etykieta}</b>
                {/* Login bywa PUSTY i to jest udokumentowane: schemat mówi „not
                    present if role is ADMIN, SYSTEM or FULFILLMENT". */}
                {/* `slate-600`, nie `slate-500`: nasza karta ma teraz tło
                    `slate-100`, a na nim `slate-500` daje 4,34:1 przy progu
                    4,5:1 — para z listy strażnika kontrastu. */}
                {w.autorLogin && <span className="text-slate-600">{w.autorLogin}</span>}
                <span className="ml-auto text-slate-600">{czas(w.utworzonoAt)}</span>
              </div>
              <TrescKarty tekst={w.tresc} nasza={rola.nasza} />
              {odnosniki(w.zalaczniki)}
              <Zalaczniki reklamacjaId={sprawa.id} lista={pliki(w.zalaczniki)} />
            </li>;
          })}
        </ol>
      </>}

    {/* ── ODPOWIEDŹ JEST OSTATNIĄ WYPOWIEDZIĄ WĄTKU (0.549.0) ──────────────
        Decyzja właściciela z 28 września, ten sam układ co w skrzynce. Pole
        stoi w pasie przewijania, bo pod ręką trzyma je sam edytor: pusty jest
        jednym rzędem przyklejonym do dolnej krawędzi, a pasek wysyłki pływa.
        Osobny pas pod rozmową zabierałby jej stałą wysokość przy każdej
        sprawie. Werdykt stoi poza rozmową (`Werdykt.tsx`), bo nieodwracalne
        ma stać w jednym miejscu. */}
    {edytor}
    <div ref={koniec} aria-hidden="true" />
    </div>
  </div>;

  if (!zKolumna) return rozmowa;
  return <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
    {rozmowa}
    <aside aria-label="Zdjęcia w sprawie"
      className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-slate-50 px-2 py-3">
      <NaglowekSekcji jako="h3">Zdjęcia</NaglowekSekcji>
      {grupyZdjec.map((g) => <section key={g.klucz} aria-label={`Zdjęcia: ${g.podpis}`}>
        <p className="text-podpis text-slate-600">{g.podpis}</p>
        <div className="mt-1 flex flex-col gap-2">
          {g.lista.map((z) => <React.Fragment key={z.id}>
            {/* Cel odnośnika z wątku. `tabIndex={-1}` przyjmuje fokus z kodu,
                ale nie dokłada przystanku tabulatora przed każdym zdjęciem. */}
            <div id={idZdjecia(z.id)} tabIndex={-1}
              className="rounded focus:outline-none focus:ring-2 focus:ring-slate-400">
              <ListaZalacznikow className="!mt-0">
                <ZalacznikSprawy reklamacjaId={sprawa.id} z={z} />
              </ListaZalacznikow>
            </div>
          </React.Fragment>)}
        </div>
      </section>)}
    </aside>
  </div>;
}
