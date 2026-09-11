import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { kopiujDoSchowka } from "./kopiuj";

/* Prymitywy stoją na warstwie `@layer components` z `index.css` (`.card`,
   `.btn-primary`, `.field`). Druga, równoległa konwencja klas kosztowałaby
   więcej, niż daje — a ekranów w panelu ma być kilka, nie kilkadziesiąt. */

export const Karta = ({ className = "", ...p }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={`card ${className}`} {...p} />;

type PrzyciskProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  wariant?: "glowny" | "drugi";
};
export const Przycisk = ({ wariant = "drugi", className = "", ...p }: PrzyciskProps) =>
  <button className={`${wariant === "glowny" ? "btn-primary" : "btn-secondary"} ${className}`} {...p} />;

/**
 * Nagłówek sekcji w kolumnie kontekstu (0.249.0).
 *
 * Trzy sekcje tej samej rangi — Oferta, Zamówienie, Subiekt GT — miały trzy
 * różne kształty: dwie `<b>` w 14 px przy ikonie 15 px, trzecia plakietkę
 * z wersalikami. Czytelnik nie ma jak wiedzieć, że to jeden poziom.
 *
 * Nagłówek CICHNIE do etykiety, zamiast rosnąć. Nazwa towaru pod nim jest
 * treścią sekcji i to ona ma być w niej najgłośniejsza; nagłówek mówi tylko,
 * czyje to dane — a §4.3 żąda, żeby to było widać przy każdym fakcie.
 */
/**
 * Etykieta pojedynczej WARTOŚCI (0.256.0).
 *
 * To nie jest nagłówek sekcji, choć wygląda podobnie i dlatego rozjechało się
 * na cztery zapisy: dwa razy 12 px bez wagi, raz 11 px bez wagi, raz 10 px
 * półgrubo. Nagłówek nazywa BLOK, ta etykieta nazywa jedną liczbę albo jedno
 * zdanie stojące tuż obok.
 *
 * Dlatego NIE jest pogrubiona, a nagłówek sekcji jest: waga to jedyne, co je
 * na ekranie rozróżnia, gdy obie są drobne i w wersalikach. Przy „Dostępny"
 * pogrubienie było wręcz szkodliwe — etykieta konkurowała z liczbą 24 px,
 * którą podpisuje.
 */
export const EtykietaWartosci = ({ className = "", children }: {
  className?: string; children: React.ReactNode;
}) =>
  <span className={`text-podpis uppercase tracking-wide text-slate-500 ${className}`}>
    {children}</span>;

/* ── ROZSZERZONY NA CAŁY PANEL (0.256.0) ─────────────────────────────────────
   Do 0.255.0 używały go trzy pliki, a obok stało SIEDEMNAŚCIE ręcznie
   sklejonych nagłówków tej samej rangi, w pięciu wagach (`font-bold`,
   `font-semibold`, gołe) i dwóch rozmiarach (11 px i 12 px). Pięć zapisów
   jednej roli to nie jest wariant — to brak decyzji.

   `jako` istnieje, bo znacznik niesie ZNACZENIE, nie tylko wygląd: tam, gdzie
   stało `<h3>`, czytnik ekranu ma dalej słyszeć nagłówek. Domyślny `<span>`
   zostaje dla nagłówków, które siedzą w rzędzie obok numeru i plakietek.

   `ton` bierze wyłącznie barwę, nie resztę łańcucha — nagłówek „Wiedza:
   pasowania części" jest zielony, bo mówi o innym źródle danych, a nie
   dlatego, że jest ważniejszy. */
export function NaglowekSekcji({ ikona, ton = "text-slate-500", jako: Znacznik = "span",
  className = "", children }: {
  ikona?: React.ReactNode;
  /** Sama barwa. Domyślnie szara; zielona i bursztynowa mówią o źródle. */
  ton?: string;
  /** Znacznik HTML — `h3` tam, gdzie to naprawdę nagłówek dokumentu. */
  jako?: "span" | "h3" | "p" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  return <Znacznik className={`flex items-center gap-1.5 text-podpis font-bold uppercase tracking-wider ${ton} ${className}`}>
    {ikona}{children}
  </Znacznik>;
}

export const Pole = ({ className = "", ...p }: React.InputHTMLAttributes<HTMLInputElement>) =>
  <input className={`field ${className}`} {...p} />;

/** Plakietka statusu — barwy z tokenów, żeby §7 miało jedno źródło. */
export const KLASA_STATUSU: Record<string, string> = {
  "new": "bg-stan-new text-stan-new-tekst",
  "open": "bg-stan-open text-stan-open-tekst",
  "waiting_for_customer": "bg-stan-klient text-stan-klient-tekst",
  /* „Czeka na nas" pożycza barwę stanu wewnętrznego: oba znaczą „piłka po
     naszej stronie", tylko jeden czeka na słowo, a drugi na pomiar. */
  "waiting_for_us": "bg-stan-wewnetrzne text-stan-wewnetrzne-tekst",
  "waiting_for_internal": "bg-stan-wewnetrzne text-stan-wewnetrzne-tekst",
  "resolved": "bg-stan-zrobione text-stan-zrobione-tekst",
  "snoozed": "bg-stan-odlozona text-stan-odlozona-tekst",
  "closed": "bg-stan-zamknieta text-stan-zamknieta-tekst",
  "spam": "bg-stan-spam text-stan-spam-tekst",
};
export const Plakietka = ({ status, children, className = "" }:
  { status?: string; children: React.ReactNode; className?: string }) =>
  <span className={`rounded px-1.5 py-0.5 text-podpis font-bold uppercase tracking-wide ${
    KLASA_STATUSU[status ?? ""] ?? "bg-slate-100 text-slate-600"} ${className}`}>{children}</span>;

/* ── JEDEN KSZTAŁT WYBORU NA CAŁY PANEL ──────────────────────────────────────
   Rząd pigułek, z których jedna jest wybrana, stał w panelu SZEŚĆ RAZY
   w TRZECH kształtach. Atrament na szarej bieżni (kubełki skrzynki, zakładki
   kontekstu), atrament bez tła nieaktywnego na własnej białej bieżni (filtr
   zadań) i bursztyn bez tła nieaktywnego (kubełki zwrotów, reklamacji
   i dyskusji — ten sam kod przepisany trzy razy, znak w znak). Do tego trzy
   rozmiary pisma, dwa promienie i dwie wagi.

   Agent przechodzący ze Skrzynki na Zwroty musiał za każdym razem odczytać na
   nowo, co tu znaczy „wybrane". Trzy zapisy jednej roli to nie są warianty,
   tylko brak decyzji — ta sama diagnoza, co przy nagłówku sekcji w 0.256.0.

   WYGRAŁ ATRAMENT NA SZAREJ BIEŻNI i to nie jest wybór większościowy, tylko
   dwa argumenty. Po pierwsze, nieaktywna pigułka Z TŁEM mówi „wybiera się
   JEDEN z tych", a bez tła mówi „oto kilka rzeczy do kliknięcia" — dokładnie
   ten argument postawiło 0.247.0 przy przełączniku edytora. Po drugie,
   bursztyn niesie już markę, akcję główną, kropkę nieprzeczytanego i pasmo
   ostrzeżenia; zdjęcie mu piątego znaczenia jest zaliczką na ustalenie 02.

   PRÓG DOTYKU WCHODZI DO KOMPONENTU. `py-1` przy interlinii 12/16 daje 24 px,
   czyli próg 2.5.8 z WCAG 2.2 AA. Do 0.261.0 pilnowała tego bramka osobno
   w każdym pliku — i przegapiła kategorie Copilota, bo szukała znacznika
   `<button` trzy linie nad klasą, a tam stał cztery. Wysokość wpisana raz,
   w jednym miejscu, nie ma jak się rozjechać.

   KOMPONENT ODDAJE SAME PIGUŁKI, nie pasmo. Pojemniki są w każdym miejscu
   inne — `<nav>` z obwódką, pasmo z polem szukania obok, rząd z przyciskiem
   „pokaż wszystkie" na końcu — a wspólna jest PIGUŁKA. Opakowanie zostaje
   tam, gdzie zna swoich sąsiadów.                                            */

/** Barwy stanu: [wybrana, niewybrana]. */
const TON_FILTRA: [string, string] =
  ["bg-wertis-ink text-white", "bg-slate-100 text-slate-600 hover:bg-slate-200"];

export type PozycjaFiltra<T> = {
  klucz: T;
  etykieta: string;
  /** Licznik obok etykiety. `undefined` znaczy „bez licznika", `0` znaczy zero. */
  ile?: number;
  /** Podpowiedź pod kursorem — pytanie kubełka i jego klawisz skrótu. */
  podpowiedz?: string;
};

export function FiltrSegmentowy<T extends string | null>({
  wybrany, onWybierz, pozycje, rowne = false, ton = TON_FILTRA,
}: {
  wybrany: T;
  onWybierz: (v: T) => void;
  pozycje: Array<PozycjaFiltra<T>>;
  /** Równa szerokość pozycji — dla dwóch zakładek dzielących kolumnę na pół. */
  rowne?: boolean;
  /**
   * Podmiana samych barw. To jest WYJĄTEK, nie wariant — dziś ma go jedno
   * miejsce: kategorie Copilota są fioletowe, bo niosą PRZYPUSZCZENIE maszyny,
   * a nie fakt. Kształt, rozmiar i próg dotyku zostają te same, bo wyjątkiem
   * jest znaczenie barwy, a nie prawo do własnej pigułki.
   */
  ton?: [string, string];
}) {
  const [wybrana, niewybrana] = ton;
  return <>
    {pozycje.map((p) => <button key={String(p.klucz)} type="button"
      aria-pressed={wybrany === p.klucz}
      title={p.podpowiedz}
      onClick={() => onWybierz(p.klucz)}
      className={`rounded px-2 py-1 text-xs font-semibold ${rowne ? "flex-1" : ""} ${
        wybrany === p.klucz ? wybrana : niewybrana}`}>
      {p.etykieta}
      {/* SPACJA, nie `ml-1`: margines rysuje odstęp, ale nie wchodzi do nazwy
          dostępnej — czytnik ekranu przeczytałby wtedy „Do decyzji3". Kubełki
          zwrotów robiły dokładnie to od 0.209.0.

          `tabular-nums`, bo Barlow ma cyfry PROPORCJONALNE. Zmierzone na
          wczytanym foncie, przy 12 px: dwucyfrowy licznik zajmuje od 8,44 px
          („11") do 13,23 px („44"), czyli waha się o 4,8 px zależnie wyłącznie
          od tego, KTÓRE cyfry pokazuje. Z tabularnymi każda dwucyfrowa wartość
          ma 12,66 px i rząd stoi.

          Czego ta klasa NIE robi: nie ratuje przejścia 9 → 10. Tam przybywa
          cyfra, więc pigułka rośnie i tak ma być. */}
      {p.ile !== undefined && <>{" "}
        <span className="font-normal tabular-nums">{p.ile}</span></>}
    </button>)}
  </>;
}

/**
 * Zakładki jednej kolumny (0.180.0).
 *
 * Kolumna dowodów przy ZWROCIE ma sekcje jedna pod drugą, bo to jedna lista
 * faktów o jednej sprawie. Kolumna kontekstu przy ROZMOWIE ma zakładki, bo
 * niesie dwa RÓWNORZĘDNE tematy: co klient kupuje i co mamy na półce.
 * Sekcje kazałyby przewijać obok tematu, którego akurat nie czytasz.
 *
 * `aria-pressed` zamiast roli `tab`: pełny wzorzec zakładek żąda strzałek,
 * `aria-controls` i zarządzania ogniskiem, a to są dwa przyciski przełączające
 * treść pod spodem. Ta sama decyzja co przy kubełkach kolejki.
 *
 * ZOSTAJE jako osobna nazwa, choć pigułki bierze z `FiltrSegmentowy`: dwa
 * wywołania czytają się lepiej przez „zakładki" niż przez „filtr", bo tu
 * wybiera się WIDOK, a nie zawężenie listy. Różnica kształtu jest jedna —
 * równa szerokość — i mieszka w `rowne`.
 */
export function Zakladki<T extends string>({ wybrana, onWybierz, pozycje }: {
  wybrana: T;
  onWybierz: (v: T) => void;
  pozycje: Array<{ klucz: T; etykieta: string }>;
}) {
  return <div className="flex gap-1 border-b border-slate-200 px-2 py-2">
    <FiltrSegmentowy<T> wybrany={wybrana} onWybierz={onWybierz} pozycje={pozycje} rowne />
  </div>;
}

/* ── PUSTKA MA DWIE WAGI, BO ODPOWIADA NA DWA PYTANIA (0.267.0) ────────────────
   Ustalenie 10 z audytu. Puste stany stały w panelu w kilku kształtach naraz:
   `Pusto` obsługiwał dziesięć miejsc, a obok stały akapity sklejone ręcznie —
   `p-6 text-center text-sm`, `p-4 text-sm` i gołe `text-sm` — czyli trzy
   zapisy jednej roli.

   DWIE WAGI, NIE JEDNA. „Wybierz rozmowę z listy" wypełnia całą kolumnę i jest
   jedyną rzeczą na ekranie. „Ten kubełek jest pusty" opisuje LISTĘ wewnątrz
   kolumny, w której nagłówek, filtry i pole szukania dalej stoją. Zrównanie
   ich zrobiłoby z pustej listy drugi ekran powitalny — a ekran powitalny
   z ikoną 38 px w miejscu wiersza kolejki zjadłby pół kolumny.

   CZEGO `Pusto` NIE OBEJMUJE: drobnych podpisów w kartach („brak
   identyfikatorów w opisie"). To są etykiety WARTOŚCI, nie puste stany —
   stoją obok pól, które wartości mają, i mają własną rolę od 0.256.0
   (`EtykietaWartosci`). Pierwsze podejście do tego wydania wciągnęło je tutaj
   wzorcem po klasach i dało czterdzieści sześć zamian zamiast dziewiętnastu.

   `Pusto` NIE MIAŁ KLASY ROZMIARU i dziedziczył 16 px z `body` — jedyny taki
   w panelu po 0.258.0. Wchodzi na drabinę: `text-tresc`, bo to jest zdanie,
   które się CZYTA, a nie etykieta, którą się rozpoznaje.

   IKONA IDZIE REFERENCJĄ, NIE ELEMENTEM. Do 0.265.0 wywołujący podawał gotowy
   `<Inbox size={38} />` i przez to rozmiar rozjechał się na 32, 38 i 40 px,
   a `text-slate-300` trafiło na trzy ikony z dziesięciu. Referencja komponentu
   odbiera tę możliwość: rozmiar i barwę ustala jedno miejsce.               */

/** Ile miejsca zajmuje pustka: cała kolumna czy lista w jej środku. */
type WagaPustki = "ekran" | "lista";

const KSZTALT_PUSTKI: Record<WagaPustki, string> = {
  ekran: "grid flex-1 place-items-center p-16 text-center text-tresc font-semibold",
  lista: "p-4 text-center text-sm",
};

/** Rozmiar ikony pustego ekranu. Jedna wartość, bo do 0.265.0 były trzy. */
const IKONA_PUSTKI = 38;

export function Pusto({ waga = "ekran", ikona: Ikona, children }: {
  waga?: WagaPustki;
  /** Komponent ikony, nie gotowy element — rozmiar i barwę ustala `Pusto`. */
  ikona?: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return <div className={`text-slate-500 ${KSZTALT_PUSTKI[waga]}`}>
    {Ikona && <Ikona size={IKONA_PUSTKI} className="text-slate-300" />}
    <p className={Ikona ? "mt-3" : ""}>{children}</p>
  </div>;
}

export const Blad = ({ children }: { children: React.ReactNode }) =>
  children ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{children}</p> : null;

/**
 * Trzy kolumny obu ekranów obsługi — JEDNA definicja (0.198.0).
 *
 * §10.1 mówi: „jeden nawyk, nie dwa" i wymienia wprost układ, SZEROKOŚCI
 * kolumn i przewijanie. Mimo to skrzynka miała kolejkę 22 rem, a zwroty
 * 320 px — rozjazd o 32 piksele, którego nikt nie zdecydował. Stoi tu, żeby
 * następna zmiana szerokości nie musiała trafić w dwa pliki.
 *
 * Kolumny ROSNĄ z ekranem, bo do 0.197.4 nie rosły wcale: `<main>` miał
 * `max-w-[1500px]`, więc monitor 1920 oddawał 210 pikseli na margines
 * z każdej strony, a 2560 — po 530. Właściciel nazwał to wprost:
 * „rozszerzenie kolumn, nie zostawiać niepotrzebnych marginesów po bokach".
 *
 * Rosną SKRAJNE, nie środkowa. W kolejce i w kontekście szerokość zamienia
 * się w treść: mniej uciętych nazw, więcej wiersza tabeli, szersze zdjęcie.
 * W środku zamieniłaby się w dłuższą linijkę tekstu, a linijka na sto
 * dwadzieścia znaków czyta się GORZEJ, nie lepiej — dlatego wypowiedzi mają
 * własny próg czytelności (`Os.tsx`), a nie ten z okna.
 */
export const SIATKA_TRZECH_KOLUMN =
  "grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] " +
  "lg:grid-cols-[21rem_minmax(0,1fr)_21rem] " +
  "xl:grid-cols-[23rem_minmax(0,1fr)_24rem] " +
  "2xl:grid-cols-[25rem_minmax(0,1fr)_28rem]";

/** Czas w formacie, który czyta biuro — jedna funkcja na cały panel. */
/* ── ZNACZNIK CZASU BEZ SEKUND (0.272.0) ───────────────────────────────────────
   Ustalenie 13 z audytu. `toLocaleString("pl")` bez opcji oddaje
   „10.09.2026, 14:23:05" — z sekundami, zawsze, we wszystkich 52 wywołaniach.
   Sekunda nie rozstrzyga w tym panelu NICZEGO: ani kiedy klient napisał, ani
   kiedy przebiegła synchronizacja, ani kiedy hala oddała pomiar.

   Kod wiedział o tym wcześniej niż audyt. TRZY miejsca obcinały sekundy ręcznie
   przez `czas(...).slice(-8, -3)` — wycinek liczony od KOŃCA sformatowanego
   napisu, czyli zakład o to, ile znaków ma data. Zakład przestawał wychodzić
   dokładnie w chwili, w której ta funkcja przestaje dawać sekundy: na
   „10.09.2026, 14:23" ten sam wycinek daje „6, 14". Dlatego jedno i drugie
   musiało wejść jednym wydaniem.

   `godzina()` istnieje właśnie po to i pyta o godzinę WPROST, zamiast wycinać
   ją z dłuższego napisu.                                                     */

/** Data i godzina, bez sekund — „10.09.2026, 14:23". */
export const czas = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pl", { dateStyle: "short", timeStyle: "short" }) : "—";

/** Sama godzina — „14:23". Tam, gdzie data jest oczywista z kontekstu. */
export const godzina = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleTimeString("pl", { timeStyle: "short" }) : "—";

/**
 * Kopiowanie tekstu, którego nikt nie przepisuje z ekranu ręcznie:
 * identyfikatora zamówienia (UUID) i numeru dokumentu z Subiekta.
 *
 * Stało to od 0.166.0 w `zwroty/Dowody.tsx`. Od 0.176.0 numer paragonu też ma
 * ten przycisk — dopóki kliknięcie nie otwiera dokumentu w Subiekcie (byłby
 * do tego potrzebny program na stanowisku, patrz `docs/architektura.md` §4),
 * schowek jest najkrótszą drogą do okna „Znajdź dokument".
 */
export function Skopiuj({ tekst, tytul = "Kopiuj" }: { tekst: string; tytul?: string }) {
  const { stan, kopiuj } = useKopiowanie(tekst);
  return <button type="button" title={stan === "blad" ? "Nie udało się skopiować" : tytul}
    onClick={kopiuj}
    className={`rounded p-1 hover:bg-slate-100 ${
      stan === "blad" ? "text-ranga-zle" : "text-slate-400 hover:text-slate-700"}`}>
    <Copy size={13} />
    <span className="sr-only">{
      stan === "zrobione" ? "Skopiowano" : stan === "blad" ? "Nie udało się skopiować" : "Kopiuj"}</span>
  </button>;
}

/**
 * Wspólny stan kopiowania: „gotowe", „skopiowano" i „nie udało się".
 *
 * TRZECI STAN JEST TU NAJWAŻNIEJSZY. Do 0.227.0 nieudane kopiowanie kończyło
 * się `.catch(() => {})`, więc ekran mrugał „skopiowano" nad pustym schowkiem —
 * a człowiek dowiadywał się o tym dopiero przy wklejaniu, gdzie indziej.
 * Uzasadnienie samego kopiowania po HTTP stoi w `ui/kopiuj.ts`.
 */
function useKopiowanie(tekst: string) {
  const [stan, setStan] = useState<"gotowe" | "zrobione" | "blad">("gotowe");
  const kopiuj = () => {
    void kopiujDoSchowka(tekst).then((udalo) => {
      setStan(udalo ? "zrobione" : "blad");
      setTimeout(() => setStan("gotowe"), udalo ? 1500 : 3000);
    });
  };
  return { stan, kopiuj };
}

/**
 * LOGIN KLIENTA, KTÓRY KOPIUJE SIĘ KLIKNIĘCIEM (0.228.0).
 *
 * Decyzja właściciela: „loginy klientów powinny być kopiowalne przez
 * kliknięcie". Login jest tym, po czym szuka się klienta w panelu Allegro
 * i w Subiekcie, a przepisywany z ekranu bywa przekręcony — `bagslublin`
 * i `bags1ublin` wyglądają na monitorze tak samo.
 *
 * KLIKALNY JEST SAM LOGIN, nie ikona obok. Ikona zostaje jako znak, że da się
 * kliknąć, ale cel dotyku to całe słowo — mniejszy cel to więcej chybień
 * (`docs/ergonomia-magazynu.md` p. 2).
 *
 * `title` mówi, co się stanie PRZED kliknięciem; `sr-only` mówi, co się stało
 * PO nim. Bez tego drugiego czytnik ekranu milczy o skutku.
 */
export function LoginKlienta({ login, className = "" }: { login: string; className?: string }) {
  const { stan, kopiuj } = useKopiowanie(login);
  return <button type="button" onClick={kopiuj}
    title={stan === "blad" ? "Nie udało się skopiować" : `Kopiuj login: ${login}`}
    className={`group inline-flex max-w-full items-center gap-1 rounded hover:bg-slate-100 ${
      stan === "blad" ? "text-ranga-zle" : ""} ${className}`}>
    <span className="truncate">{login}</span>
    {stan === "zrobione"
      ? <Check size={12} className="shrink-0 text-ranga-ok" />
      : <Copy size={12} className="shrink-0 text-slate-300 group-hover:text-slate-500" />}
    <span className="sr-only">{
      stan === "zrobione" ? "Skopiowano login" : stan === "blad"
        ? "Nie udało się skopiować loginu" : "Kopiuj login"}</span>
  </button>;
}
