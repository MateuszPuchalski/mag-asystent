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
 * Nagłówek sekcji w kolumnie kontekstu.
 *
 * Sekcje tej samej rangi — Oferta, Zamówienie, Subiekt GT — mają jeden
 * kształt, żeby czytelnik widział, że to jeden poziom.
 *
 * Nagłówek CICHNIE do etykiety, zamiast rosnąć. Nazwa towaru pod nim jest
 * treścią sekcji i to ona ma być w niej najgłośniejsza; nagłówek mówi tylko,
 * czyje to dane — a §4.3 żąda, żeby to było widać przy każdym fakcie.
 */
/**
 * Etykieta pojedynczej WARTOŚCI.
 *
 * To nie jest nagłówek sekcji, choć wygląda podobnie. Nagłówek nazywa BLOK,
 * ta etykieta nazywa jedną liczbę albo jedno zdanie stojące tuż obok.
 *
 * Dlatego NIE jest pogrubiona, a nagłówek sekcji jest: waga to jedyne, co je
 * na ekranie rozróżnia, gdy obie są drobne i w wersalikach. Przy „Dostępny"
 * pogrubienie byłoby wręcz szkodliwe — etykieta konkurowałaby z liczbą 24 px,
 * którą podpisuje.
 */
export const EtykietaWartosci = ({ className = "", children }: {
  className?: string; children: React.ReactNode;
}) =>
  <span className={`text-podpis uppercase tracking-wide text-slate-500 ${className}`}>
    {children}</span>;

/* ── JEDEN NAGŁÓWEK SEKCJI NA CAŁY PANEL ─────────────────────────────────────
   Kilka zapisów jednej roli to nie jest wariant — to brak decyzji.

   `jako` istnieje, bo znacznik niesie ZNACZENIE, nie tylko wygląd: tam, gdzie
   stało `<h3>`, czytnik ekranu ma dalej słyszeć nagłówek. Domyślny `<span>`
   zostaje dla nagłówków, które siedzą w rzędzie obok numeru i plakietek.

   `ton` bierze wyłącznie barwę, nie resztę łańcucha — barwa mówi o źródle
   albo randze treści pod nagłówkiem, a nie o innym kształcie nagłówka. */
export function NaglowekSekcji({ ikona, ton = "text-slate-500", jako: Znacznik = "span",
  className = "", children }: {
  ikona?: React.ReactNode;
  /** Sama barwa. Domyślnie szara; inna mówi o źródle albo randze treści. */
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
/** Ranga i jej barwa pisma — JEDNA mapa dla stanu integracji i zdań o dosyłce. */
export type Ranga = "zle" | "uwaga" | "ok" | "nic";
export const BARWA_RANGI: Record<Ranga, string> = {
  zle: "text-ranga-zle", uwaga: "text-ranga-uwaga", ok: "text-ranga-ok", nic: "text-ranga-nic",
};

/**
 * Barwa zdania z tonem serwera — dziś zdania o dosyłce.
 *
 * To samo zdanie pada na ekranie zwrotu, na profilu i przy historii kolejek,
 * więc barwę bierze z mapy wyżej, nie z własnej. Bez tonu pismo jest zwykłe,
 * bo kolor zapalany zawsze uczy go ignorować.
 */
export const barwaTonu = (ton: "ok" | "uwaga" | "zle" | null | undefined) => BARWA_RANGI[ton ?? "nic"];

export const Plakietka = ({ status, children, className = "" }:
  { status?: string; children: React.ReactNode; className?: string }) =>
  <span className={`rounded px-1.5 py-0.5 text-podpis font-bold uppercase tracking-wide ${
    KLASA_STATUSU[status ?? ""] ?? "bg-slate-100 text-slate-600"} ${className}`}>{children}</span>;

/* ── JEDEN KSZTAŁT WYBORU NA CAŁY PANEL ──────────────────────────────────────
   Rząd pigułek, z których jedna jest wybrana, ma w panelu jeden kształt.
   Agent przechodzący ze Skrzynki na Zwroty nie musi odczytywać na nowo, co
   tu znaczy „wybrane".

   ATRAMENT NA SZAREJ BIEŻNI, z dwóch powodów. Po pierwsze, nieaktywna
   pigułka Z TŁEM mówi „wybiera się JEDEN z tych", a bez tła mówi „oto kilka
   rzeczy do kliknięcia". Po drugie, bursztyn niesie już markę, akcję główną,
   kropkę nieprzeczytanego i pasmo ostrzeżenia.

   PRÓG DOTYKU WCHODZI DO KOMPONENTU. `py-1` przy interlinii 12/16 daje 24 px,
   czyli próg 2.5.8 z WCAG 2.2 AA. Wysokość wpisana raz, w jednym miejscu,
   nie ma jak się rozjechać.

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
  /**
   * Licznik obok etykiety. `undefined` znaczy „bez licznika", `0` znaczy zero,
   * a „—” znaczy „nie wiemy”: zero przy awarii czytałoby się jak koniec pracy.
   */
  ile?: number | "—";
  /** Podpowiedź pod kursorem — pytanie kubełka i jego klawisz skrótu. */
  podpowiedz?: string;
  /** Ikona pozycji — rysuje się wyłącznie w trybie `kafle`. */
  ikona?: React.ReactNode;
};

/* `number` w ograniczeniu: tagi identyfikuje NUMER wiersza, a nie nazwa —
   nazwa jest edytowalna i zmiana literki nie ma prawa zgubić filtru. */
export function FiltrSegmentowy<T extends string | number | null>({
  wybrany, onWybierz, pozycje, rowne = false, ton = TON_FILTRA, kafle = false,
}: {
  /**
   * KAFLE zamiast pigułek — kubełki zwrotów. Kafel kładzie liczbę na
   * pierwszym planie, bo to po niej operator wybiera, a etykieta schodzi pod
   * nią, drobniej.
   *
   * TO JEST TRYB TEGO SAMEGO WYBORU, nie osobny komponent: ten sam
   * `aria-pressed`, te same barwy i ten sam próg dotyku, tylko inny układ
   * wnętrza. Siatkę daje rodzic, bo tylko on zna szerokość kolumny.
   */
  kafle?: boolean;
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
  if (kafle) {
    return <>
      {pozycje.map((p) => <button key={String(p.klucz)} type="button"
        aria-pressed={wybrany === p.klucz}
        title={p.podpowiedz}
        onClick={() => onWybierz(p.klucz)}
        className={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
          wybrany === p.klucz ? wybrana : niewybrana}`}>
        {p.ikona && <span aria-hidden="true" className="shrink-0">{p.ikona}</span>}
        <span className="flex min-w-0 flex-col leading-tight">
          {/* Liczba PIERWSZA, bo po niej się wybiera; w nazwie dostępnej stoi
              przed etykietą, a czytnik czyta „743 Do decyzji" — tak jak widać. */}
          {/* SPACJA między liczbą a etykietą, jak w pigułce niżej: kolumna
              flex jej nie rysuje, ale bez niej nazwa dostępna brzmi
              „743Do decyzji". */}
          {p.ile !== undefined && <><span className="text-sm font-bold tabular-nums">{p.ile}</span>{" "}</>}
          <span className="truncate text-xs font-medium">{p.etykieta}</span>
        </span>
      </button>)}
    </>;
  }
  return <>
    {pozycje.map((p) => <button key={String(p.klucz)} type="button"
      aria-pressed={wybrany === p.klucz}
      title={p.podpowiedz}
      onClick={() => onWybierz(p.klucz)}
      className={`rounded px-2 py-1 text-xs font-semibold ${rowne ? "flex-1" : ""} ${
        wybrany === p.klucz ? wybrana : niewybrana}`}>
      {p.etykieta}
      {/* SPACJA, nie `ml-1`: margines rysuje odstęp, ale nie wchodzi do nazwy
          dostępnej — czytnik ekranu przeczytałby wtedy „Do decyzji3".

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

/* ── PUSTKA MA DWIE WAGI, BO ODPOWIADA NA DWA PYTANIA ─────────────────────────
   „Wybierz rozmowę z listy" wypełnia całą kolumnę i jest jedyną rzeczą na
   ekranie. „Ten kubełek jest pusty" opisuje LISTĘ wewnątrz kolumny, w której
   nagłówek, filtry i pole szukania dalej stoją. Zrównanie ich zrobiłoby
   z pustej listy drugi ekran powitalny — a ekran powitalny z ikoną 38 px
   w miejscu wiersza kolejki zjadłby pół kolumny.

   CZEGO `Pusto` NIE OBEJMUJE: drobnych podpisów w kartach („brak
   identyfikatorów w opisie"). To są etykiety WARTOŚCI, nie puste stany —
   stoją obok pól, które wartości mają (`EtykietaWartosci`).

   `text-tresc`, bo to jest zdanie, które się CZYTA, a nie etykieta, którą
   się rozpoznaje.

   IKONA IDZIE REFERENCJĄ, NIE ELEMENTEM. Gotowy element pozwalałby każdemu
   wywołującemu dać inny rozmiar i barwę. Referencja komponentu odbiera tę
   możliwość: rozmiar i barwę ustala jedno miejsce.                          */

/** Ile miejsca zajmuje pustka: cała kolumna czy lista w jej środku. */
type WagaPustki = "ekran" | "lista";

const KSZTALT_PUSTKI: Record<WagaPustki, string> = {
  ekran: "grid flex-1 place-items-center p-16 text-center text-tresc font-semibold",
  lista: "p-4 text-center text-sm",
};

/** Rozmiar ikony pustego ekranu — jedna wartość dla całego panelu. */
const IKONA_PUSTKI = 38;

export function Pusto({ waga = "ekran", ikona: Ikona, children }: {
  waga?: WagaPustki;
  /** Komponent ikony, nie gotowy element — rozmiar i barwę ustala `Pusto`. */
  ikona?: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  /* Ikona i zdanie w JEDNEJ grupie. Waga „ekran" to siatka, a siatka
     z dwojgiem dzieci dzieli kolumnę na dwa wiersze i rozsuwa je o setki
     pikseli. Jedno dziecko siatka centruje całe. */
  return <div className={`text-slate-500 ${KSZTALT_PUSTKI[waga]}`}>
    <div>
      {Ikona && <Ikona size={IKONA_PUSTKI} className="mx-auto text-slate-300" />}
      <p className={Ikona ? "mt-3" : ""}>{children}</p>
    </div>
  </div>;
}

export const Blad = ({ children }: { children: React.ReactNode }) =>
  children ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{children}</p> : null;

/**
 * Trzy kolumny obu ekranów obsługi — JEDNA definicja.
 *
 * §10.1 mówi: „jeden nawyk, nie dwa" i wymienia wprost układ, SZEROKOŚCI
 * kolumn i przewijanie. Stoi tu, żeby zmiana szerokości nie musiała trafić
 * w dwa pliki.
 *
 * Kolumny ROSNĄ z ekranem, żeby szeroki monitor nie oddawał setek pikseli
 * na puste marginesy.
 *
 * Rosną SKRAJNE, nie środkowa. W kolejce i w kontekście szerokość zamienia
 * się w treść: mniej uciętych nazw, więcej wiersza tabeli, szersze zdjęcie.
 * W środku zamieniłaby się w dłuższą linijkę tekstu, a linijka na sto
 * dwadzieścia znaków czyta się GORZEJ, nie lepiej — dlatego wypowiedzi mają
 * własny próg czytelności (`Os.tsx`), a nie ten z okna.
 *
 * NA NAJWĘŻSZYM PROGU ŚRODEK NIE MOŻE BYĆ NAJWĘŻSZY. Na `lg` oddaje
 * KONTEKST, nie kolejka: środek ma ok. 360 px przy 1024 i jest najszerszy
 * z trzech. Kolejka zostaje przy 21 rem, bo przy 19 rem kafelki kubełków
 * w Zwrotach ucinają etykiety („Do decy…", „Zamkni…"). Kontekst pokazuje
 * dowody i liczby, które przy 16 rem układają się w dwie kolumny.
 */
export const SIATKA_TRZECH_KOLUMN =
  "grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] " +
  "lg:grid-cols-[21rem_minmax(0,1fr)_16rem] " +
  "xl:grid-cols-[23rem_minmax(0,1fr)_24rem] " +
  "2xl:grid-cols-[25rem_minmax(0,1fr)_28rem]";

/** Czas w formacie, który czyta biuro — jedna funkcja na cały panel. */
/* ── ZNACZNIK CZASU BEZ SEKUND ─────────────────────────────────────────────────
   Sekunda nie rozstrzyga w tym panelu NICZEGO: ani kiedy klient napisał, ani
   kiedy przebiegła synchronizacja, ani kiedy hala oddała pomiar.

   `godzina()` pyta o godzinę WPROST, zamiast wycinać ją z dłuższego napisu:
   wycinek liczony od końca to zakład o to, ile znaków ma data.             */

/** Data i godzina, bez sekund — „10.09.2026, 14:23". */
export const czas = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pl", { dateStyle: "short", timeStyle: "short" }) : "—";

/**
 * Termin z dniem tygodnia — „pt., 02.10, 08:00".
 *
 * Dla odłożenia rozmowy: o terminie powrotu myśli się dniem tygodnia („wróci
 * w poniedziałek"), a rok nic nie rozstrzyga, bo odłożenie ma najwyżej
 * trzydzieści dni. Stoi tutaj, bo `Czas.test.ts` trzyma formaty w jednym pliku.
 */
export const termin = (v: Date | string) =>
  new Date(v).toLocaleString("pl", { weekday: "short", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit" });

/**
 * Data i godzina Z SEKUNDAMI — „10.09.2026, 14:23:05".
 *
 * Jedyny wyjątek od `czas()` i ma jednego odbiorcę: DZIENNIK. Ślad audytowy
 * to diagnostyka, a tam sekunda rozstrzyga — kolejność skanu i odrzucenia,
 * które przyszły w tej samej minucie, albo dwa kliknięcia jednej osoby.
 * Stoi tutaj, bo `Czas.test.ts` trzyma formaty dat w jednym pliku.
 */
export const stempel = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pl", { dateStyle: "short", timeStyle: "medium" }) : "—";

/**
 * Wiek po ludzku — „41 min", „2 g 36 min", „3 dni".
 *
 * Dwóch odbiorców: alarm synchronizacji i zegar zadań terenowych.
 *
 * DOBA ROZBIJA SIĘ NA DNI. Zadanie terenowe potrafi czekać tydzień, a
 * „172 g 12 min" to liczba, którą czytelnik musi podzielić w głowie, żeby się
 * przestraszyć. Dni liczy `dniSlowo`, żeby odmiana stała w jednym miejscu.
 */
export function wiek(ms: number | null): string {
  if (ms == null) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "poniżej minuty";
  const g = Math.floor(min / 60);
  if (g >= 24) return dniSlowo(Math.floor(g / 24));
  return g ? `${g} g ${min % 60} min` : `${min} min`;
}

/** Sama godzina — „14:23". Tam, gdzie data jest oczywista z kontekstu. */
export const godzina = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleTimeString("pl", { timeStyle: "short" }) : "—";

/**
 * Sam dzień, słownie — „1 lipca 2026". Tam, gdzie godzina nic nie wnosi.
 *
 * Powstało dla progu kolejki spraw: próg jest decyzją o DNIU, a „01.07.2026,
 * 02:00" z `czas()` kazałoby czytelnikowi zastanawiać się nad drugą w nocy,
 * która jest wyłącznie skutkiem zapisu północy czasu lokalnego w UTC.
 *
 * Stoi TUTAJ, a nie przy pasku, bo strażnik `Czas.test.ts` ma rację: drugi
 * format daty w panelu zaczyna się właśnie od `toLocaleDateString` napisanego
 * na miejscu, w ekranie.
 */
export const dzien = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("pl", { day: "numeric", month: "long", year: "numeric" })
    : "—";

/**
 * Dzień i miesiąc cyframi — „30.09”.
 *
 * Dla podpowiedzi przy doręczonej dosyłce. Serwer pisze tę samą datę w zdaniu
 * dosyłki jako „DD.MM”, a podpowiedź stoi tuż pod nim — dwa zapisy jednego
 * dnia obok siebie czytałyby się jak dwa różne dni. Rok nic tu nie
 * rozstrzyga: dosyłkę śledzimy najwyżej trzydzieści dni.
 */
export const dzienMiesiac = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("pl", { day: "2-digit", month: "2-digit" }) : "—";

/**
 * Data cyframi z rokiem — „28.09.2026”.
 *
 * Dla dat, które agent przepisuje klientowi albo porównuje z Allegro: dnia
 * zgłoszenia i zakupu. Allegro pisze je w tym kształcie, więc słowne
 * „28 września 2026” obok numeru sprawy kazałoby tłumaczyć w głowie.
 */
export const dataCyfrowa = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("pl", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";

/**
 * Miesiąc słownie — „październik 2026” z „2026-10”.
 *
 * Dla rejestru pomyłek, który biuro rozlicza miesiącami. Stoi tutaj, bo
 * `Czas.test.ts` trzyma formaty dat w jednym pliku. Dzień pierwszy liczony
 * lokalnie, żeby północ w UTC nie cofnęła miesiąca o jeden.
 */
export function miesiacSlownie(rrrrMm: string): string {
  const [r, m] = rrrrMm.split("-").map(Number);
  if (!r || !m) return rrrrMm;
  return new Date(r, m - 1, 1).toLocaleDateString("pl", { month: "long", year: "numeric" });
}

/** „RRRR-MM" jako skrót miesiąca pod słupkiem wykresu: „paź". */
export function miesiacKrotko(rrrrMm: string): string {
  const [r, m] = rrrrMm.split("-").map(Number);
  if (!r || !m) return rrrrMm;
  return new Date(r, m - 1, 1).toLocaleDateString("pl", { month: "short" });
}

/**
 * Chwila w wierszu listy — „15:32", „wczoraj", „04.10" albo „04.10.2025".
 *
 * Dla prawej krawędzi kolejki, którą oko przebiega w dół. Pełne „5.10.2026,
 * 15:32" było czterokrotnie szersze od wieku obok i ścinało login, czyli
 * klucz sprawy. Rok i godzina sprzed dni niczego tam nie rozstrzygają.
 * Dokładną chwilę niesie `title` z `czas()`.
 *
 * Dzień liczy się od lokalnej północy, nie co 24 godziny. Inaczej wiadomość
 * z 23:50 pokazałaby rano samą godzinę, czyli fałszywe „dzisiaj". `Math.round`
 * łyka dobę 23- i 25-godzinną przy zmianie czasu.
 */
export function kiedy(v: string | null | undefined, teraz: Date = new Date()): string {
  if (!v) return "—";
  const d = new Date(v);
  const polnoc = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dni = Math.round((polnoc(teraz) - polnoc(d)) / 86_400_000);
  if (dni === 0) return godzina(v);
  if (dni === 1) return "wczoraj";
  if (d.getFullYear() === teraz.getFullYear()) return dzienMiesiac(v);
  return d.toLocaleDateString("pl", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Wiersz kolejki biura — rama wspólna dla dostaw i koszy.
 *
 * Belka 3 px przy KAŻDYM wierszu, bursztynowa przy wybranym, i szare tło —
 * ten sam zapis co w kolejkach zwrotów i skrzynki, żeby ręka nie uczyła się
 * drugiej listy.
 *
 * Wybór DOGANIA widok (`scrollIntoView` z `nearest`) — powód przy tej samej
 * linijce w `zwroty/Kolejka.tsx`.
 */
export function WierszKolejki({ aktywny, onKlik, children }: {
  aktywny: boolean; onKlik: () => void; children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => { if (aktywny) ref.current?.scrollIntoView({ block: "nearest" }); }, [aktywny]);
  return <li>
    <button ref={ref} aria-current={aktywny ? "true" : undefined} onClick={onKlik}
      className={`flex w-full flex-col border-l-[3px] px-4 py-2 text-left ${aktywny
        ? "wiersz-wybrany border-l-wertis-amber bg-slate-200"
        : "border-l-transparent hover:bg-slate-50"}`}>
      {children}
    </button>
  </li>;
}

/**
 * Data lokalna jako „2026-09-22" — dla druków dla dostawców.
 *
 * Protokół idzie do dostawcy z datą sporządzenia, a doba liczona w UTC
 * dawałaby po północy czasu polskiego datę dnia poprzedniego. Format cyfrowy,
 * nie słowny, bo tak wypełnia się pole daty na cudzym formularzu.
 */
export function dataLokalna(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const dwa = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dwa(d.getMonth() + 1)}-${dwa(d.getDate())}`;
}

/**
 * Kopiowanie tekstu, którego nikt nie przepisuje z ekranu ręcznie:
 * identyfikatora zamówienia (UUID) i numeru dokumentu z Subiekta.
 *
 * Kliknięcie nie otwiera dokumentu w Subiekcie (byłby do tego potrzebny
 * program na stanowisku, patrz `docs/architektura.md` §4), więc schowek jest
 * najkrótszą drogą do okna „Znajdź dokument".
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
 * Kopiowanie z napisem, dla całych list: ikona bez słowa przy takim
 * przycisku nie mówi, CO trafi do schowka. Ten sam stan co `Skopiuj`.
 */
export function PrzyciskKopiuj({ tekst, children }: { tekst: string; children: React.ReactNode }) {
  const { stan, kopiuj } = useKopiowanie(tekst);
  return <Przycisk onClick={kopiuj}>
    <Copy size={14} />
    {stan === "zrobione" ? "Skopiowano" : stan === "blad" ? "Nie udało się skopiować" : children}
  </Przycisk>;
}

/**
 * Wspólny stan kopiowania: „gotowe", „skopiowano" i „nie udało się".
 *
 * TRZECI STAN JEST TU NAJWAŻNIEJSZY. Bez niego ekran mrugałby „skopiowano"
 * nad pustym schowkiem, a człowiek dowiadywałby się o tym dopiero przy
 * wklejaniu, gdzie indziej. Uzasadnienie kopiowania po HTTP stoi
 * w `ui/kopiuj.ts`.
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
 * LOGIN KLIENTA, KTÓRY KOPIUJE SIĘ KLIKNIĘCIEM.
 *
 * Login jest tym, po czym szuka się klienta w panelu Allegro i w Subiekcie,
 * a przepisywany z ekranu bywa przekręcony — `bagslublin` i `bags1ublin`
 * wyglądają na monitorze tak samo.
 *
 * KLIKALNY JEST SAM LOGIN, nie ikona obok. Ikona zostaje jako znak, że da się
 * kliknąć, ale cel dotyku to całe słowo — mniejszy cel to więcej chybień
 * (`docs/ergonomia-magazynu.md` p. 2).
 *
 * `title` mówi, co się stanie PRZED kliknięciem; `sr-only` mówi, co się stało
 * PO nim. Bez tego drugiego czytnik ekranu milczy o skutku.
 *
 * `min-h-6`: 24 px to próg WCAG 2.2 dla celu (2.5.8).
 */
export function LoginKlienta({ login, className = "" }: { login: string; className?: string }) {
  const { stan, kopiuj } = useKopiowanie(login);
  return <button type="button" onClick={kopiuj}
    title={stan === "blad" ? "Nie udało się skopiować" : `Kopiuj login: ${login}`}
    className={`group inline-flex min-h-6 max-w-full items-center gap-1 rounded hover:bg-slate-100 ${
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

/**
 * Symbol towaru z Subiekta, który kopiuje się kliknięciem.
 *
 * Symbol wpisuje się potem w Subiekcie albo w zamówieniu u dostawcy, a „14-31051"
 * i „14-31015" przepisane z ekranu różnią się jedną zamianą cyfr. Klikalne jest
 * całe słowo, jak przy loginie, bo większy cel to mniej chybień.
 */
export function SymbolTowaru({ symbol }: { symbol: string }) {
  const { stan, kopiuj } = useKopiowanie(symbol);
  return <button type="button" onClick={kopiuj}
    title={stan === "blad" ? "Nie udało się skopiować" : `Kopiuj symbol: ${symbol}`}
    className={`group inline-flex min-h-6 max-w-full items-center gap-1 rounded font-mono hover:bg-slate-200 ${
      stan === "blad" ? "text-ranga-zle" : "text-slate-800"}`}>
    <span className="break-all text-left">{symbol}</span>
    {stan === "zrobione"
      ? <Check size={12} className="shrink-0 text-ranga-ok" />
      : <Copy size={12} className="shrink-0 text-slate-300 group-hover:text-slate-500" />}
    <span className="sr-only">{
      stan === "zrobione" ? "Skopiowano symbol" : stan === "blad"
        ? "Nie udało się skopiować symbolu" : "Kopiuj symbol"}</span>
  </button>;
}

/* ── Trzy formy liczby mnogiej ────────────────────────────────────────────────
   Polszczyzna ma przy liczebniku TRZY formy, nie dwie: „1 pozycja",
   „2 pozycje", „5 pozycji". Dwuformowe wyrażenie daje „5 pozycje" albo —
   co gorsza, bo wygląda poprawnie — „2 pasujących zwrotów".

   REGUŁA STOI W JEDNYM MIEJSCU, bo każda kopia dwuformowego wyrażenia to
   miejsce na osobny błąd. Ekran nie jest miejscem na regułę języka.
   `dniSlowo` stoi tu z tego samego powodu.                                 */

/**
 * „1 dzień", ale „2 dni" i „12 dni".
 *
 * Wygląda na dwie formy i jest trzema: dla „dni" środkowa i ostatnia brzmią
 * tak samo. „1 dni" na ekranie, który ma się czytać w biegu, zatrzymuje oko na
 * pół sekundy — a to jest dokładnie ten koszt, który kolejki miały zdjąć.
 */
export const dniSlowo = (n: number) => ile(n, "dzień", "dni", "dni");

/**
 * Forma rzeczownika przy liczbie `n`.
 *
 * @param jeden mianownik liczby pojedynczej — „pozycja"
 * @param dwa   forma dla 2–4 — „pozycje"
 * @param piec  dopełniacz liczby mnogiej — „pozycji"
 */
export function odmien(n: number, jeden: string, dwa: string, piec: string): string {
  /* Bierzemy WARTOŚĆ BEZWZGLĘDNĄ, bo `-2 % 10` daje w JS −2 i cała reguła
     rozsypuje się po cichu. Liczników ujemnych ekran nie pokazuje, ale reguła
     języka nie ma zależeć od tego, czy ktoś tego kiedyś nie policzy. */
  const l = Math.abs(n);
  if (l === 1) return jeden;
  const r10 = l % 10, r100 = l % 100;
  /* Nastki są wyjątkiem i tylko one: „12 pozycji", nie „12 pozycje". */
  return r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? dwa : piec;
}

/** To samo z liczbą z przodu: „5 pozycji". */
export const ile = (n: number, jeden: string, dwa: string, piec: string): string =>
  `${n} ${odmien(n, jeden, dwa, piec)}`;
