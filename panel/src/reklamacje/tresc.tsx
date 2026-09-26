import React from "react";

/* ── TREŚĆ WIADOMOŚCI REKLAMACYJNEJ (0.415.0) ────────────────────────────────
   Trzy rzeczy, które robi się z tekstem przychodzącym z Allegro, w jednym
   pliku — bo wszystkie trzy dotyczą TEGO SAMEGO napisu i rozjechałyby się,
   gdyby stały przy trzech różnych komponentach.

   NIC TU NIE PARSUJE „NA WSZELKI WYPADEK". Każda z tych funkcji ma wyraźny
   warunek trafienia i zwraca `null` albo wejście bez zmian, gdy go nie ma.
   Psujemy się w stronę CISZY — czyli pokazania całości — nigdy w stronę
   ukrycia czegoś, czego nie rozpoznaliśmy.                                  */

/**
 * Ten sam tekst mimo innego oddechu.
 *
 * Allegro potrafi oddać jedno zdanie raz ze złamaniami wiersza, raz bez, więc
 * porównanie znak w znak przepuszczałoby dubla przy co drugiej sprawie.
 * Porównujemy SAM TEKST, nigdy jego formatowanie.
 */
export function scisle(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Od ilu znaków zawieranie jest dowodem, a nie zbiegiem okoliczności.
 *
 * „Dzień dobry" mieści się w niemal każdej wiadomości i nie znaczy, że opis
 * sprawy jest jej częścią. Dwadzieścia pięć znaków to mniej więcej cztery
 * słowa — krótszego opisu nie uznajemy za dubla i zostawiamy obie karty.
 */
const PROG_DUBLA = 25;

/**
 * Czy wiadomość ZAWIERA opis zgłoszenia (0.415.0).
 *
 * BLIZNA 0.412.0, ZNALEZIONA NA ZRZUCIE WŁAŚCICIELA. Tamto wydanie usuwało
 * ramkę „Zgłoszenie", gdy była DOSŁOWNIE równa pierwszej wiadomości klienta —
 * i nie usuwało jej nigdy, bo Allegro wkłada zdanie kupującego w swój
 * formularz: „Problem: … / Opis: <zdanie> / Oczekiwane rozwiązanie: …".
 * Teksty nie są wtedy równe, a dublem są.
 *
 * Zawieranie liczymy po normalizacji i dopiero od progu długości.
 */
export function zawieraOpis(wiadomosc: string, opis: string): boolean {
  const o = scisle(opis);
  if (o.length < PROG_DUBLA) return false;
  return scisle(wiadomosc).includes(o);
}

/* ── FORMULARZ ALLEGRO (0.415.0) ─────────────────────────────────────────────
   Pierwsza wiadomość kupującego w reklamacji nie jest jego wiadomością: to
   formularz Allegro z etykietami, w którym jedno pole niesie jego własne
   słowa. Trzy z pięciu etykiet powtarzają to, co głowica kolumny dowodów
   mówi już po polsku — powód, oczekiwanie i tytuł prawny.

   ROZPOZNAJEMY PO ETYKIETACH, NIE PO KOLEJNOŚCI ANI PO POZYCJI. Allegro
   kiedyś te teksty zmieni i wtedy wiadomość zostaje w całości — tak ma być.
   Wymagamy DWÓCH trafionych etykiet, żeby zdanie klienta zaczynające się od
   słowa „Opis" nie udawało formularza.                                     */
const ETYKIETY = [
  "Problem:", "Opis:", "Oczekiwane rozwiązanie:", "Warunki reklamacji:",
  "Adres kupującego:",
] as const;

/** Ile etykiet musi trafić, żeby uznać tekst za formularz. */
const PROG_FORMULARZA = 2;

export interface Formularz {
  /** Wartość pola „Opis" — jedyne zdanie, które napisał człowiek. */
  opis: string;
  /** Cała wiadomość bez zmian; pokazuje ją „pokaż całość". */
  calosc: string;
}

/**
 * Formularz Allegro rozebrany na zdanie klienta i resztę; `null`, gdy to nie
 * jest formularz albo gdy nie ma w nim pola „Opis".
 *
 * Bez pola „Opis" NIE ZWRACAMY NICZEGO, choć etykiety trafiły: składanie
 * wiadomości, z której nie umiemy wyjąć treści, zostawiłoby na ekranie samą
 * zapowiedź „pokaż całość" nad pustym miejscem.
 */
export function rozbierzFormularz(tekst: string): Formularz | null {
  const trafione = ETYKIETY.filter((e) => tekst.includes(e));
  if (trafione.length < PROG_FORMULARZA) return null;
  const start = tekst.indexOf("Opis:");
  if (start === -1) return null;
  const po = tekst.slice(start + "Opis:".length);
  /* Koniec pola to NAJBLIŻSZA następna etykieta, nie pierwsza z listy:
     kolejność pól w formularzu nie jest niczym obiecana. */
  const konce = ETYKIETY.map((e) => po.indexOf(e)).filter((i) => i > -1);
  const opis = (konce.length ? po.slice(0, Math.min(...konce)) : po).trim();
  if (opis === "") return null;
  return { opis, calosc: tekst };
}

/* ── ADRESY W TREŚCI (0.415.0) ───────────────────────────────────────────────
   Automat Allegro odsyła klienta do formularza zwrotu LINKIEM w wiadomości,
   a my rysowaliśmy go jako czysty tekst — agent zaznaczał go myszą i kopiował
   do paska adresu. Przy każdej sprawie, w której poprosiliśmy o odesłanie
   towaru, czyli przy każdym uznaniu z wymianą.

   BEZ `dangerouslySetInnerHTML`: tekst dzielimy na kawałki i sklejamy
   elementami Reacta. Treść przychodzi od kupującego i od Allegro, więc
   wstrzykiwanie jej jako HTML byłoby dziurą, a nie skrótem.

   `noopener noreferrer` i nowa karta: to jest cudzy odnośnik. */
const ADRES = /(https?:\/\/[^\s<>"']+)/g;

/** Ogon interpunkcyjny nie należy do adresu: „…/wysylka/abc." kończy zdanie. */
const OGON = /[.,;:!?)\]}]+$/;

export function Tresc({ tekst, className = "" }: { tekst: string; className?: string }) {
  const kawalki = tekst.split(ADRES);
  return <p className={`whitespace-pre-wrap ${className}`}>
    {kawalki.map((k, i) => {
      /* Dzielenie po grupie chwytającej stawia adresy na NIEPARZYSTYCH
         pozycjach — to jest kontrakt `String.prototype.split`, nie zgadywanie. */
      if (i % 2 === 0) return <React.Fragment key={i}>{k}</React.Fragment>;
      const ogon = OGON.exec(k);
      const adres = ogon ? k.slice(0, k.length - ogon[0].length) : k;
      return <React.Fragment key={i}>
        <a href={adres} target="_blank" rel="noopener noreferrer"
          className="break-all underline underline-offset-2 hover:text-wertis-ink">{adres}</a>
        {ogon ? ogon[0] : null}
      </React.Fragment>;
    })}
  </p>;
}

/* ── DŁUGA TREŚĆ ZWINIĘTA DO CZTERECH LINII (0.511.0) ──────────────────────
   Wzorzec `NaszaTresc` ze skrzynki (0.506.0), skopiowany, bo tamten nie jest
   eksportowany. Powód ten sam: własną odpowiedź agent już zna, a długa
   zajmowała całą oś i spychała pytanie klienta pod krawędź okna.

   Progi te same co w skrzynce, 320 znaków albo pięć linii, żeby zwijało się
   jednakowo na każdej kolejce. Puste wiersze ponad jeden ściskamy WYŁĄCZNIE
   na ekranie: treść w bazie i w Allegro zostaje taka, jaka poszła.

   Stan zwinięcia jest LOKALNY, nie w bazie: rozwinięcie to patrzenie,
   a patrzenie niczego nie zapisuje. */
export const PROG_ZWINIECIA = 320;

export function DlugaTresc({ tekst, className = "", etykieta = "Pokaż całą wiadomość" }: {
  tekst: string; className?: string; etykieta?: string;
}) {
  const [cala, setCala] = React.useState(false);
  const zwarta = tekst.replace(/\n[ \t]*(\n[ \t]*){2,}/g, "\n\n").trim();
  const dluga = zwarta.length > PROG_ZWINIECIA || zwarta.split("\n").length > 5;
  return <>
    <Tresc tekst={zwarta} className={`${className} ${dluga && !cala ? "line-clamp-4" : ""}`} />
    {dluga && <button type="button" onClick={() => setCala((c) => !c)} aria-expanded={cala}
      className="mt-1 text-xs font-semibold text-sky-800 underline underline-offset-2">
      {cala ? "Zwiń" : etykieta}</button>}
  </>;
}
