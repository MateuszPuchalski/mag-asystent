import React, { useEffect, useRef, useState } from "react";
import { Bot, LifeBuoy, Store, User, type LucideIcon } from "lucide-react";
import type { Reklamacja, WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";
import { pobierzZalacznik } from "../api/reklamacje";
import { useZdjecieZalacznikaReklamacji } from "../towar/useZdjecie";
import { KartaZalacznika, ListaZalacznikow } from "../towar/Zalacznik";
import { czas, NaglowekSekcji, Pusto } from "../ui";
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
function ZalacznikReklamacji({ reklamacjaId, z }: {
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
    {lista.map((z) => <ZalacznikReklamacji key={z.id} reklamacjaId={reklamacjaId} z={z} />)}
  </ListaZalacznikow>;
}

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
   treść: powód, oczekiwanie i tytuł prawny stoją już w głowicy kolumny
   dowodów, po polsku i w jednym miejscu.

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

export function Czat({ sprawa, czat, zalaczniki, edytor }: {
  sprawa: SprawaCzatu;
  czat: WiadomoscReklamacji[];
  /** Załączniki SAMEJ sprawy — te spoza rozmowy. */
  zalaczniki: ZalacznikReklamacji[];
  /* Edytor wstrzykiwany, nie wołany stąd: cały katalog `reklamacje/` trzyma
     komponenty czyste, a mutacje mieszkają w ekranie (wzorzec `skrzynka/`). */
  edytor?: React.ReactNode;
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
  const koniec = useRef<HTMLLIElement | null>(null);
  const zakotwiczona = useRef<number | null>(null);
  useEffect(() => {
    if (czat.length === 0 || zakotwiczona.current === sprawa.id) return;
    zakotwiczona.current = sprawa.id;
    /* `jsdom` tej metody nie ma, a i przeglądarka bywa starsza od niej. */
    koniec.current?.scrollIntoView?.({ block: "nearest" });
  }, [sprawa.id, czat.length]);

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
  const pierwszaKlienta = czat.find((w) => w.autorRola === "BUYER")?.tresc ?? null;
  const dubel = sprawa.opisZgloszenia !== null && pierwszaKlienta !== null
    && zawieraOpis(pierwszaKlienta, sprawa.opisZgloszenia);
  const opisWart = !dubel;

  /* ── ROZMOWA PRZEWIJA SIĘ, CZYNNOŚCI STOJĄ (0.418.0) ─────────────────────
     Zgłoszenie właściciela ze zrzutem: „werdykt nie jest przyklejony". Na
     zrzucie pasek werdyktu leżał w połowie wątku, między tekstem wiadomości
     a jej zdjęciem — bo cała kolumna była JEDNYM obszarem przewijania,
     w którym oś, pole odpowiedzi i werdykt płynęły razem.

     Kolumna dzieli się teraz na trzy pasy: rozmowa przewija się w środku,
     a pole odpowiedzi i pasek werdyktu zostają na dole i nie uciekają.
     Werdykt dalej stoi POD rozmową (0.412.0) — zmienia się to, że nie trzeba
     do niego przewijać jedenastu wiadomości. */
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
    {(opisWart || zalaczniki.length > 0) &&
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <NaglowekSekcji jako="h3">
          {opisWart ? "Zgłoszenie" : "Załączniki zgłoszenia"}</NaglowekSekcji>
        {opisWart && (sprawa.opisZgloszenia === null
          ? <p className="mt-1 text-sm text-slate-800">
              Klient nie opisał sprawy własnymi słowami.</p>
          : <Tresc tekst={sprawa.opisZgloszenia} className="mt-1 text-sm text-slate-800" />)}
        <Zalaczniki reklamacjaId={sprawa.id} lista={zalaczniki} />
      </section>}

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
      : <ol className="flex flex-col gap-2">
          {czat.map((w, i) => {
            /* Rola spoza zbioru dostaje kształt NIEZNANEGO, a nie kształt
               klienta: schemat Allegro może dołożyć wartość, a wtedy ekran ma
               powiedzieć „nie wiem, kto to", zamiast zgadywać stronę. */
            const rola = ROLE[w.autorRola ?? ""] ?? {
              etykieta: w.autorRola ?? "Nieznany autor", Ikona: User, nasza: false,
              klasa: "bg-white border-slate-200", listwa: "border-l-4 border-dotted border-l-slate-400",
            };
            return <li key={w.id}
              ref={i === czat.length - 1 ? koniec : undefined}
              className={`rounded-lg border p-3 ${rola.klasa} ${rola.listwa} ${
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
              <Zalaczniki reklamacjaId={sprawa.id} lista={w.zalaczniki} />
            </li>;
          })}
        </ol>}

    </div>

    {/* Od 0.224.0 pod rozmową stoi EDYTOR, a nie zdanie o tym, że odpowiedź
        wysyła się gdzie indziej. Zdanie było prawdziwe przez dwa wydania
        i przestało być — komentarz, który skłamał, jest gorszy od jego braku.
        Werdykt od 0.412.0 stoi POD rozmową (`Werdykt.tsx`) — nieodwracalne
        pyta dopiero po dowodach, a nie przed nimi.

        POZA PASEM PRZEWIJANIA od 0.418.0: pole, w które się pisze, ma być pod
        ręką niezależnie od tego, jak długa jest rozmowa. */}
    <div className="shrink-0">{edytor}</div>
  </div>;
}
