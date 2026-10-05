import React, { useEffect, useId, useRef, useState } from "react";
import { Bot, ChevronUp, Image, LifeBuoy, Store, User, type LucideIcon } from "lucide-react";
import type { Reklamacja, WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";
import { pobierzZalacznik } from "../api/reklamacje";
import { useZdjecieZalacznikaReklamacji } from "../towar/useZdjecie";
import { KartaZalacznika, ListaZalacznikow } from "../towar/Zalacznik";
import { czas, ile, NaglowekSekcji, Pusto } from "../ui";
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

export function Czat({ sprawa, czat, zalaczniki, edytor, przypnijZgloszenie = false,
  zwinStarsze, bursztynTylkoOstatniej = false, kolumnaZdjec = false, zdjeciaObok }: ZdjeciaCzatu & {
  sprawa: SprawaCzatu;
  czat: WiadomoscReklamacji[];
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
          {widoczne.map((w) => {
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
