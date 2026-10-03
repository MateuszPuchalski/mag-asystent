import React, { useEffect, useRef, useState } from "react";
import {
  AlarmClock, Bell, BellOff, Eye, Inbox, MessageSquare, RefreshCw, Ruler, Search, UserCheck, Wrench, X,
} from "lucide-react";
import type {
  Rozmowa, StanCopilota, StanSkrzynki, StatusRozmowy, WynikPartii,
} from "../api/typy";
import { Blad, czas, Plakietka, Pusto } from "../ui";
import { FiltrZWiecej } from "../ui/FiltrZWiecej";
import { klawiszZajety } from "../nawigacja/fokus";
import { BARWA_STANU_DOBORU, NAZWA, NAZWA_STANU_DOBORU } from "./statusy";
import { CZESTE, PasekCopilota, ZnakCopilota, ZnakKategorii, doRozpoznania, nazwaNaPlakietce } from "./Copilot";
import { Czekanie } from "./Czekanie";
import { SlownikZnakow } from "./SlownikZnakow";
import type { StanPowiadomien } from "./Sygnaly";
import { useNoweKlucze } from "./Ruch";

/* Kubełki kolejki z §10.1: „Nieprzypisane, Moje, Oczekujące". Filtr jest po
   stronie EKRANU, bo lista i tak przyjeżdża w całości — dokładanie parametru
   do trasy nic by dziś nie oszczędziło, a rozmnożyłoby reguły przynależności
   na dwie strony.

   Znacznik „po terminie" na wierszu liczy dalej SERWER (`poTerminie`), bo
   odłożenia zapisane przed 22 września 2026 wciąż wygasają. Nowych nikt nie
   nadaje, więc kubełek na nie odszedł, a znacznik zgaśnie sam. */
type Kubelek = "doOdpowiedzi" | "nieprzypisane" | "moje" | "oczekujace" | "zakonczone" | "wszystkie";

/* ── Kolejność listy (0.215.0) ───────────────────────────────────────────────
   Domyślna zostaje po serwerze: PILNE, potem najdłużej czekające pytanie —
   decyzja właściciela z 0.181.0 i odpowiedź na pytanie „za co się wziąć".
   „Od najnowszych" odpowiada na INNE pytanie — „co właśnie przyszło" — i jest
   przełącznikiem, nie nową regułą, tym samym wzorem co data nadania przy
   zwrotach. PILNE zostaje na górze w obu porządkach: flaga ręczna przebija
   automat, bez względu na to, który automat wybrano. Wybór pamięta
   przeglądarka, bo kolejność to nawyk stanowiska, nie decyzja na jedno
   otwarcie ekranu. */
type Porzadek = "czekanie" | "najnowsze";
const KLUCZ_PORZADKU = "wertis.kolejka.porzadek";

function zapamietanyPorzadek(): Porzadek {
  try {
    return localStorage.getItem(KLUCZ_PORZADKU) === "najnowsze" ? "najnowsze" : "czekanie";
  } catch { return "czekanie"; }
}

/** Kolejność dla „od najnowszych": PILNE przed resztą, potem ostatnia wiadomość malejąco. */
export function odNajnowszych(rozmowy: Rozmowa[]): Rozmowa[] {
  return [...rozmowy].sort((a, b) =>
    Number(b.priorytet === "pilny") - Number(a.priorytet === "pilny")
    || b.ostatniaWiadomoscAt.localeCompare(a.ostatniaWiadomoscAt)
    || b.id - a.id);
}

/** Kubełki przeglądania, nie pracy — pod „Więcej" (0.506.0). */
const POD_WIECEJ: ReadonlyArray<Kubelek> = ["oczekujace", "zakonczone", "wszystkie"];

/* ── „DO ODPOWIEDZI" JEST PIERWSZY I DOMYŚLNY (0.533.0) ─────────────────────
   Decyzja właściciela z 26 września 2026. Wejście stawało na „Wszystkie",
   a tam stoją też zakończone — i to NA GÓRZE, bo serwer układa po najstarszym
   pytaniu klienta (0.181.0), a pytanie sprzed miesięcy jest najstarsze.
   „Następna" po wysyłce potrafiła więc trafić w archiwum. Praca dzieliła się
   za to na dwa kubełki: dopisek klienta, któremu już odpisałem, stał
   w „Moje", nowe pytanie — w „Nieprzypisane".

   „Do odpowiedzi" to nasz ruch bez cudzych: niczyje i moje razem. Kolega
   ma swoje u siebie, a jego rozmowę dalej widać w „Wszystkie". „Wszystkie"
   schodzi pod „Więcej" — to przeglądanie, nie praca. */
const KUBELKI: Array<{ klucz: Kubelek; etykieta: string }> = [
  { klucz: "doOdpowiedzi", etykieta: "Do odpowiedzi" },
  { klucz: "nieprzypisane", etykieta: "Nieprzypisane" },
  { klucz: "moje", etykieta: "Moje" },
  { klucz: "oczekujace", etykieta: "Oczekujące" },
  /* Zakończone (23 września 2026): ręką agenta albo samo — podziękowanie,
     dwa dni ciszy, wątek zamknięty w Allegro. Osobno, żeby pomyłkowe
     zakończenie dało się znaleźć i otworzyć, a nie tylko w „Wszystkie". */
  { klucz: "zakonczone", etykieta: "Zakończone" },
  { klucz: "wszystkie", etykieta: "Wszystkie" },
  /* Odłożone stoją w „Oczekujących" (0.533.0) — czekają na termin, jak
     tamte na klienta albo halę. Osobny kubełek byłby czwartym miejscem do
     sprawdzania, a po terminie rozmowa i tak wraca sama do „Do odpowiedzi". */
];

/* Spam znika z kolejki roboczej, ale NIE z panelu: widać go w „Wszystkie".
   Ukrycie go wszędzie znaczyłoby, że pomyłki nie da się cofnąć. */

/* ── KTÓRY STATUS ZASŁUGUJE NA PLAKIETKĘ (0.251.0) ───────────────────────────
   Do 0.249.1 każdy wiersz zaczynał się od plakietki statusu — a w kubełkach
   roboczych („Nieprzypisane", „Moje") status jest praktycznie STAŁY. Najgłośniejszy
   element wiersza powtarzał więc w kółko to samo słowo i nie rozróżniał niczego,
   podczas gdy rzecz, która wiersze RÓŻNI — czas oczekiwania — stała drobnym
   drukiem na końcu skanowania.

   `waiting_for_us` niesie dokładnie ten sam fakt co zegar: serwer zwraca ten
   status wtedy i tylko wtedy, gdy ostatnia wiadomość jest przychodząca
   (`statusZKierunku`), a zegar liczy się od ostatniej wiadomości przychodzącej.
   Jeden fakt, dwa miejsca; zostaje to, które niesie LICZBĘ.

   Statusy poniżej wynikają za to z decyzji człowieka albo z ruchu hali i nie
   da się ich odczytać z niczego innego w wierszu — te zostają plakietkami. */
const WYJATKOWE: ReadonlySet<StatusRozmowy> = new Set([
  "waiting_for_internal", "snoozed", "resolved", "closed", "spam",
]);

/* Statusy, przy których piłka jest PO NASZEJ STRONIE. Tylko przy nich zegar
   mierzy dług — patrz komentarz przy wierszu. */
const NASZ_RUCH: ReadonlySet<StatusRozmowy> = new Set([
  "new", "waiting_for_us",
  /* Zlecenie pomiaru leży na HALI, ale klient czeka tak samo — i to jego czas
     mierzy zegar. Plakietka mówi DLACZEGO, zegar ILE; jedno nie zastępuje drugiego. */
  "waiting_for_internal",
]);

/* ── KUBEŁKI ROBOCZE TO NASZ RUCH (23 września 2026) ─────────────────────────
   Zgłoszenie właściciela: „potrzebuję sposobu, żeby rozmowa była rozwiązana".
   „Nieprzypisane" i „Moje" patrzyły wyłącznie na prowadzącego, więc rozmowa
   po naszej odpowiedzi stała w nich na zawsze — a czekanie na klienta to nie
   praca. Teraz robocze trzymają tylko to, przy czym ruch jest nasz;
   czekanie ma „Oczekujące", koniec — „Zakończone". */
const CZEKA_NA_KOGOS = ["waiting_for_customer", "waiting_for_internal", "snoozed"];
const ZAKONCZONA = ["resolved", "closed"];

function wKubelku(r: Rozmowa, kubelek: Kubelek, mojeId: number | null): boolean {
  if (kubelek === "wszystkie") return true;
  if (r.status === "spam") return false;
  if (kubelek === "zakonczone") return ZAKONCZONA.includes(r.status);
  if (ZAKONCZONA.includes(r.status)) return false;
  if (kubelek === "oczekujace") return CZEKA_NA_KOGOS.includes(r.status);
  if (CZEKA_NA_KOGOS.includes(r.status)) return false;
  if (kubelek === "nieprzypisane") return r.wlascicielId === null;
  if (kubelek === "doOdpowiedzi") return r.wlascicielId === null || (mojeId !== null && r.wlascicielId === mojeId);
  return mojeId !== null && r.wlascicielId === mojeId;
}

/* Kolejka pokazuje moment ostatniej synchronizacji, bo pusta lista o 9:00
   znaczy co innego, gdy synchronizator stanął o 6:00, a co innego, gdy
   przebiegł minutę temu. Bez tej daty ekran kłamałby ciszą. */
export function Kolejka({ rozmowy, stan, copilot, klasyfikacja, onRozpoznaj = () => {},
  wybranaId, mojeId = null, onWybierz, onWidoczne, powiadomienia, onOdswiez, laduje, nieswieza,
  bladBezDanych = null, odswieza = false }: {
  rozmowy: Rozmowa[];
  stan: StanSkrzynki;
  /** Stan Copilota (§14, etap F). `undefined` = jeszcze nie wiadomo, milcz. */
  copilot?: StanCopilota;
  /* Przebieg ostatniej partii. Kolejka go nie wywołuje — wywołanie mieszka
     w `ekrany/Skrzynka.tsx`, tak jak każdy inny hak zapytania w tym panelu. */
  klasyfikacja?: { trwa: boolean; wynik: WynikPartii | null; blad: string | null };
  onRozpoznaj?: (rozmowyId: number[]) => void;
  wybranaId: number | null;
  /** Bez tego „Moje" nie ma znaczenia — kubełek zostaje wtedy pusty, nie mylący. */
  mojeId?: number | null;
  onWybierz: (id: number) => void;
  /** Identyfikatory WIDOCZNYCH wierszy po kubełku i szukaniu — dla „następnej
      rozmowy" po wysyłce (23 września 2026). Kolejka trzyma te sita u siebie. */
  onWidoczne?: (ids: number[]) => void;
  /** Przełącznik powiadomień systemowych (23 września 2026) — patrz `Sygnaly.ts`.
      Brak = przeglądarka ich nie zna, więc przycisku nie ma. */
  powiadomienia?: { stan: StanPowiadomien; przelacz: () => void };
  onOdswiez: () => void;
  laduje: boolean;
  /** Trwa odświeżanie w tle lub z przycisku — ikona wtedy się kręci (albo ciemnieje). */
  odswieza?: boolean;
  /* Kolejka nieświeża wygląda inaczej, bo znaczy co innego. Pusta lista przy
     stojącym synchronizatorze to nie „brak pytań", tylko „nie wiem". */
  nieswieza?: boolean;
  /* Lista nie przyszła wcale (0.546.0). Wtedy kolejka nie wie, ile czeka,
     więc nie mówi „brak rozmów" ani „0" — mówi, że nie wie, i dlaczego. */
  bladBezDanych?: string | null;
}) {
  const [kubelek, setKubelek] = useState<Kubelek>("doOdpowiedzi");
  /* Wiersze, które WESZŁY do „Do odpowiedzi" po pierwszym odczycie: nowy wątek
     albo wątek, który wrócił po odpowiedzi klienta. Klucz liczy się z CAŁEJ
     listy, nie z widocznego kubełka, więc przełączanie zakładek niczego nie
     błyska. Bez `mojeId` „moje" jeszcze się nie rozstrzygnęły — czekamy, bo
     inaczej wszystkie moje wątki weszłyby do kubełka przy starcie. */
  const doOdpowiedziKlucze = rozmowy
    .filter((r) => wKubelku(r, "doOdpowiedzi", mojeId)).map((r) => String(r.id));
  const nowe = useNoweKlucze(doOdpowiedziKlucze, !laduje && mojeId !== null);
  /* ── Szukanie w kolejce (0.195.0) ──────────────────────────────────────────
     Zwroty mają wyszukiwarkę od 0.165.0, skrzynka nie miała żadnej: kubełek
     mówi „czyje to", a pytania „czy TA rozmowa gdzieś
     tu jest" nie zadawał nikt — bo nie było jak. „Klient pisał o tym miesiąc
     temu" znaczyło przewijanie listy.

     Filtr liczy się W PAMIĘCI EKRANU, bez debounce'u i bez ruchu do serwera —
     lista i tak przyjeżdża w całości, ten sam wzorzec co przy kubełkach. */
  const [fraza, setFraza] = useState("");
  const [porzadek, setPorzadek] = useState<Porzadek>(zapamietanyPorzadek);
  const ustawPorzadek = (p: Porzadek) => {
    setPorzadek(p);
    try { localStorage.setItem(KLUCZ_PORZADKU, p); } catch { /* prywatne okno — wybór na jedno otwarcie */ }
  };
  const szukane = fraza.trim().toLowerCase();
  const uporzadkowane = porzadek === "najnowsze" ? odNajnowszych(rozmowy) : rozmowy;
  const wKubelkuTeraz = uporzadkowane.filter((r) => wKubelku(r, kubelek, mojeId));
  /* Szukamy po LOGINIE i po TREŚCI. Login, bo tak się wraca do znanej sprawy;
     treść, bo tak się szuka sprawy, której loginu nikt nie pamięta. Właściciel
     rozmowy dochodzi trzeci: „co ma Ola" jest pytaniem zadawanym na głos. */
  const widoczne = szukane === "" ? wKubelkuTeraz : wKubelkuTeraz.filter((r) =>
    r.klient.toLowerCase().includes(szukane)
    || r.ostatniaWiadomosc.toLowerCase().includes(szukane)
    || (r.wlasciciel ?? "").toLowerCase().includes(szukane));

  /* ── WIERSZ MÓWI, NA CZYM TRAFIŁ (0.425.0) ────────────────────────────────
     Szukanie po TREŚCI jest potrzebne i zostaje — tak się wraca do sprawy,
     której loginu nikt nie pamięta. Ma jednak skutek, którego wiersz nie
     pokazywał: wpisane nazwisko trafia też w cudzą wiadomość, w której to
     nazwisko padło. Agent szukający „Kowalski" dostawał wtedy rozmowę INNEGO
     klienta, wyglądającą dokładnie jak trafienie po nazwisku.

     Login stoi w wierszu od zawsze, ale jako jeden z dziewięciu drobnych
     znaczników pod treścią — a treść jest tym, co wzrok czyta pierwsze.
     Znacznik nazywa więc powód trafienia i pojawia się WYŁĄCZNIE tam, gdzie
     login się nie zgadza. Na trafieniu po loginie milczy: znak zapalany przy
     każdym wierszu przestaje być znakiem. */
  const kluczWidocznych = widoczne.map((r) => r.id).join(",");
  useEffect(() => { onWidoczne?.(widoczne.map((r) => r.id)); }, [kluczWidocznych]);

  const powodTrafienia = (r: { klient: string; wlasciciel?: string | null }): string | null => {
    if (szukane === "" || r.klient.toLowerCase().includes(szukane)) return null;
    return (r.wlasciciel ?? "").toLowerCase().includes(szukane)
      ? "trafienie po prowadzącym" : "trafienie w treści, nie w loginie";
  };

  /* ── KLAWIATURA W SKRZYNCE (0.383.0) ─────────────────────────────────
     Cztery kolejki obsługi, trzy chodziły z klawiatury od 0.245.0 — zwroty,
     reklamacje i dyskusje. Skrzynka nie miała ANI JEDNEGO klawisza, a to na
     niej agent siedzi najdłużej z całego panelu (patrz `Edytor.tsx`, 0.247.0).
     Żadna decyzja tego nie wybrała; po prostu nikt jej tu nie dorobił.

     NASŁUCH MIESZKA W KOLEJCE, nie w ekranie, i to jest różnica wobec tamtych
     trzech. Tam ekran zna listę, więc wie, co jest „następne". Tutaj kubełek
     i szukanie są stanem TEJ kolejki, a ekran widzi wyłącznie
     `wybranaId` — liczyłby więc „następną" z listy nieprzefiltrowanej
     i przeskakiwał na rozmowy, których nie widać. Podnoszenie tego stanu na
     ekran byłoby większą zmianą niż cały ten skrót.

     POLE TEKSTOWE WYGRYWA ZAWSZE. Na tym ekranie agent PISZE — bez tej bramki
     `j` w słowie „już" przerzucałoby rozmowę spod kursora.

     Strażnik jest WSPÓLNY, z `nawigacja/fokus.ts` (0.522.0). Własny nie znał
     SELECT-a, a kolejka ma dwa: „Więcej" i kolejność. Strzałka w otwartej
     liście zmieniała wtedy naraz jej wartość i rozmowę pod kursorem.
     Od 0.546.0 strażnik milczy też pod oknem modalnym (`klawiszZajety`). */
  const naKlawisz = useRef<(e: KeyboardEvent) => void>(() => {});
  naKlawisz.current = (e: KeyboardEvent) => {
    if (klawiszZajety(e.target)) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowUp" || e.key === "k") {
      if (!widoczne.length) return;
      e.preventDefault();
      const o = e.key === "ArrowDown" || e.key === "j" ? 1 : -1;
      const i = widoczne.findIndex((r) => r.id === wybranaId);
      /* Bez zaznaczenia `j` bierze PIERWSZĄ, a `k` ostatnią — ruch w dół z niczego
         zaczyna od góry listy, nie od jej końca. */
      const cel = i < 0 ? (o > 0 ? 0 : widoczne.length - 1) : i + o;
      const nast = widoczne[Math.min(widoczne.length - 1, Math.max(0, cel))];
      if (nast && nast.id !== wybranaId) onWybierz(nast.id);
      return;
    }
    /* Cyfra mapuje się wprost na indeks listy: „Do odpowiedzi" to 1,
       a „Wszystkie" od 0.533.0 ostatnia — jak w tamtych trzech ekranach. */
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= KUBELKI.length) {
      e.preventDefault();
      setKubelek(KUBELKI[Number(e.key) - 1].klucz);
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => naKlawisz.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  return <section className="card flex min-h-0 flex-col overflow-hidden">
    {/* `shrink-0` nad scrollerem i `min-h-0` na nim (0.180.0). Bez tego przy
        węższej kolumnie kubełki zawijają się na trzy rzędy, a lista — jedyny
        blok z bazą 0 — kurczy się do zera. Wzorzec z kolumn zwrotów. */}
    {/* JEDNO PASMO ZAMIAST DWÓCH (0.193.0). Data synchronizacji stała we
        WŁASNYM pasku pod nagłówkiem, a pigułka „Synchronizacja 18:29 · 0 błędów"
        niesie tę samą rzecz w pasku górnym, na każdym ekranie panelu. Pięć
        pasm sterujących nad pierwszym wierszem zjadało ćwierć wysokości
        kolumny — a kolumna kolejki istnieje po to, żeby pokazywać PYTANIA.

        Dlaczego data w ogóle tu jest: pusta lista o 9:00 znaczy co innego, gdy
        synchronizator stanął o 6:00, a co innego, gdy przebiegł minutę temu.
        Tego zdania nie usuwamy — schodzi obok tytułu, w rozmiar podpisu. */}
    {/* NAGŁÓWEK W JEDNYM WIERSZU (0.251.0). Tytuł i data synchronizacji stały
        jeden pod drugim i kosztowały 73 px — czyli więcej niż wiersz z pytaniem
        klienta. Data ZOSTAJE (patrz akapit wyżej: pusta lista o 9:00 znaczy co
        innego przy stojącym synchronizatorze), tylko schodzi obok tytułu,
        w rozmiar podpisu, i ustępuje mu miejsca przy wąskiej kolumnie. */}
    <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
      <Inbox size={16} className="shrink-0" />
      <b className="text-naglowek shrink-0">Rozmowy</b>
      <p className="mr-auto min-w-0 truncate text-podpis font-normal text-slate-500">
        synchronizacja {czas(stan.ostatniaSynchronizacja)}
        {stan.bledy > 0 && <span className="ml-1 font-bold text-amber-700">· błędów: {stan.bledy}</span>}
      </p>
      {/* JEDEN „?" ZAMIAST DWÓCH (0.522.0). Słownik znaków stał w nagłówku,
          skróty klawiszy w paśmie szukania — dwa znaki zapytania o dwóch
          regułach otwierania. Pomoc tej kolejki jest jedna, więc otwiera się
          jednym przyciskiem i zamyka jak każde okienko panelu. */}
      <SlownikZnakow kubelkow={KUBELKI.length} />
      {powiadomienia && powiadomienia.stan !== "brak" && <button type="button"
        aria-pressed={powiadomienia.stan === "wlaczone"}
        disabled={powiadomienia.stan === "zablokowane"}
        onClick={powiadomienia.przelacz}
        aria-label="Powiadomienia o pilnych rozmowach"
        title={powiadomienia.stan === "wlaczone"
          ? "Powiadomienia włączone: prośba o człowieka i czekanie ponad godzinę. Kliknij, żeby wyłączyć."
          : powiadomienia.stan === "zablokowane"
            ? "Przeglądarka zablokowała powiadomienia — zmień to w ustawieniach strony."
            : "Włącz powiadomienia: prośba o człowieka i czekanie ponad godzinę."}
        className={`rounded p-1 hover:bg-slate-100 disabled:opacity-50 ${
          powiadomienia.stan === "wlaczone" ? "text-wertis-ink" : "text-slate-500"}`}>
        {powiadomienia.stan === "wlaczone" ? <Bell size={16} /> : <BellOff size={16} />}</button>}
      <ZnakCopilota stan={copilot} kandydaci={doRozpoznania(wKubelkuTeraz, copilot)} />
      {/* Plakietka „STAN Z …" zeszła (0.522.0). Zapalała się wyłącznie przy
          alarmie synchronizacji, a baner alarmu nad kolumnami mówi już „dane
          sprzed…" pełnym zdaniem. Godzinę niesie zdanie obok tytułu. */}
      <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onOdswiez}
        title="Odśwież" aria-label="Odśwież" aria-busy={odswieza}>
        {/* Kręci się tylko z `motion-safe:`; bez animacji w systemie ikona
            ciemnieje, żeby kliknięcie nadal coś pokazywało. */}
        <RefreshCw size={16} className={odswieza ? "motion-safe:animate-spin motion-reduce:opacity-40" : ""} /></button>
    </header>
    {/* ── CEL KLIKALNY MA 24 px, A ZA WYSOKOŚĆ PŁACI PASMO (0.255.0) ─────────
        0.251.0 ścisnęło pigułki z `py-1` do `py-0.5`, żeby odzyskać wysokość
        dla listy pytań. Zmierzone: dało to cele 20 px przy progu 24×24 z WCAG
        2.2 AA (2.5.8). Odzyskane piksele nie były moje do wzięcia.

        Pigułka wraca na `py-1`, a rachunek pokrywa własne wypełnienie pasma:
        `py-1.5` → `py-1`. Kubełki zawijają się na dwa rzędy przy kolumnie
        400 px, więc pigułki kosztują +8 px, a pasmo oddaje 4 px. Netto +4 px
        chromu — cena, której próg dostępności jest wart. */}
    {/* ── TRZY KUBEŁKI NA WIERZCHU, DWA POD „WIĘCEJ" (0.506.0) ─────────────
        Zgłoszenie agenta: „przytłacza". Pięć pigułek zawijało się na dwa rzędy
        nad pierwszym pytaniem. Robota dzieje się w trzech; „Oczekujące"
        i „Zakończone" to przeglądanie — stoją pod „Więcej" z liczbą, a cyfry
        4 i 5 dalej je wybierają. Od 0.522.0 ten układ mieszka
        w `ui/FiltrZWiecej.tsx`, bo te same „Więcej" dostały inne kolejki.

        „WIĘCEJ" W RZĘDZIE KUBEŁKÓW (0.548.0, wariant C). Lista brała resztę
        rzędu, więc po zawinięciu robiła się pełnoszerokim paskiem pod
        pigułkami — drugim pasmem sterowania nad pytaniami. Tryb zwarty mierzy
        ją treścią: stoi obok „Moje" i schodzi niżej tylko, gdy się nie mieści. */}
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
      <FiltrZWiecej<Kubelek> zwarty wybrany={kubelek} onWybierz={setKubelek} wiecej={POD_WIECEJ}
        pozycje={KUBELKI.map((k) => ({ klucz: k.klucz, etykieta: k.etykieta,
          ile: bladBezDanych ? undefined : rozmowy.filter((r) => wKubelku(r, k.klucz, mojeId)).length }))} />
    </div>
    {/* Pole stoi POD kubełkami, nie nad nimi: kubełek wybiera się raz na
        wejście, a szuka się w środku tego, co się wybrało. Kolejność obok
        pola, w tym samym paśmie: to trzecie sito na tę samą listę, a osobny
        rząd zjadałby wysokość kolumny, która ma pokazywać PYTANIA. */}
    <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
      <div className="relative min-w-0 flex-1">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
        {/* Podpowiedź MIEŚCI SIĘ w polu (0.546.0). „Szukaj: login, treść,
            prowadzący" potrzebowało 192 px, a pole ma 136 px przy 1280 i 1440
            — agent czytał „prc". „Szukaj" mówi lupa i nazwa pola, a miejsce
            na krzyżyk rezerwujemy dopiero, gdy krzyżyk stoi: to daje 156 px
            na 150 px podpowiedzi. Pomiar w Chromium, czcionka panelu. */}
        <input value={fraza} onChange={(e) => setFraza(e.target.value)}
          aria-label="Szukaj w rozmowach"
          placeholder="Login, treść, prowadzący"
          className={`field w-full py-1 pl-7 text-sm ${fraza !== "" ? "pr-7" : "pr-2"}`} />
        {fraza !== "" && <button type="button" onClick={() => setFraza("")}
          aria-label="Wyczyść szukanie"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={14} /></button>}
      </div>
      <select className="field w-auto shrink-0 py-1 text-xs" aria-label="Kolejność" value={porzadek}
        onChange={(e) => ustawPorzadek(e.target.value as Porzadek)}>
        <option value="czekanie">najdłużej czekające</option>
        <option value="najnowsze">od najnowszych</option>
      </select>
      {/* Skróty klawiszy zeszły stąd do „?" w nagłówku (0.522.0) — obok
          słownika znaków, jedną pomocą zamiast dwóch. */}
    </div>
    <PasekCopilota stan={copilot} kandydaci={doRozpoznania(wKubelkuTeraz, copilot)}
      trwa={klasyfikacja?.trwa} wynik={klasyfikacja?.wynik} blad={klasyfikacja?.blad}
      onRozpoznaj={onRozpoznaj} />
    {/* ── PIGUŁEK KATEGORII NIE MA (22 września 2026) ──────────────────────
        Decyzja właściciela. Pasek liczył kategorie w kubełku i zawężał listę
        po PRZYPUSZCZENIU maszyny — przy piętnastu klasach potrafił zająć trzy
        rzędy nad pierwszym pytaniem. Kategoria zostaje na wierszu i w nagłówku
        rozmowy. Zakaz przestawiania kolejki po kategorii stoi dalej: kolejność
        niosą fakty — flaga „pilne" i czas oczekiwania. */}
    <div className={`min-h-0 flex-1 overflow-y-auto ${nieswieza ? "opacity-60" : ""}`}>
      {/* Klawisze NA EKRANIE, wzorem reklamacji (0.281.0). Dekalog p. 2:
          rozpoznanie jest tańsze od pamiętania, a skrót, o którym nikt nie wie,
          nie skraca niczyjej pracy. Sit „moje"/„niczyje" skrzynka nie ma —
          „Moje" jest tu KUBEŁKIEM, więc siedzi już pod cyfrą i drugi raz nie
          ma po co stać. */}
      {laduje && <Pusto waga="lista">Wczytuję…</Pusto>}
      {!laduje && !rozmowy.length && (bladBezDanych
        ? <Blad>{bladBezDanych}</Blad>
        : <Pusto waga="lista">Brak rozmów w zsynchronizowanej skrzynce.</Pusto>)}
      {/* Pusty KUBEŁEK to co innego niż pusta skrzynka: „nic nie czeka na
          mnie" nie znaczy „nic nie przyszło", a jedno zdanie mniej kazałoby
          agentowi zgadywać, czy synchronizacja stanęła. */}
      {/* Pusty KUBEŁEK to co innego niż pusty FILTR. „Zajrzyj do Wszystkie"
          przy włączonym filtrze kategorii wysłałoby agenta w złą stronę —
          rozmowy są, tylko sito je zasłania. */}
      {/* Pusty WYNIK SZUKANIA to co innego niż pusty kubełek i niż pusty filtr:
          rozmowy są, tylko żadna nie pasuje do frazy. Zdanie mówi frazę, bo
          literówki w polu wyszukiwania widać dopiero wtedy, gdy się je zacytuje. */}
      {!laduje && rozmowy.length > 0 && !widoczne.length && szukane !== "" &&
        <Pusto waga="lista">
          Nic nie pasuje do „{fraza.trim()}" w tym kubełku.{" "}
          <button type="button" className="underline" onClick={() => setFraza("")}>
            Wyczyść szukanie</button></Pusto>}
      {!laduje && rozmowy.length > 0 && !widoczne.length && szukane === "" &&
        <Pusto waga="lista">Ten kubełek jest pusty — zajrzyj do „Wszystkie".</Pusto>}
      {widoczne.map((r) => {
        /* ── ZEGAR MIERZY NASZ DŁUG, NIE WIEK ROZMOWY (0.251.0) ───────────
           `czekaOdMs` liczy się od ostatniej wiadomości KLIENTA. Przy statusie
           „Czeka na klienta" znaczy to, że odpisaliśmy — a wiersz i tak pisał
           „czeka 15 g", czyli mierzył czas komuś, kto na nic nie czeka. Słowo
           „czeka" musi być prawdziwe, bo po nim układa się kolejność pracy
           (§10.2) i po nim serwer sortuje domyślną listę. */
        const zegar = NASZ_RUCH.has(r.status) ? r.czekaOdMs : null;
        const wyjatkowy = WYJATKOWE.has(r.status);
        const trafienie = powodTrafienia(r);
        /* ── ZNACZNIKI POD PYTANIEM (0.548.0, wariant C) ─────────────────
           Rząd staje tylko wtedy, gdy ma co nieść. Kolejność jak dotąd:
           najpierw to, co krzyczy (reklamacyjna, status-wyjątek), potem
           fakty wyciszone. Lista zamiast warunku na każdym dziecku, bo pusty
           rząd z marginesem wyglądałby jak ucięty wiersz. */
        const znaczniki: React.ReactNode[] = [];
        /* ZNACZNIK REKLAMACYJNY (0.390.0) przed statusem: mówi, JAK prowadzimy
           sprawę, a nie co się z nią stało. Sprawy w Allegro za nim nie ma —
           założyć ją może tylko kupujący. */
        if (r.reklamacyjna) znaczniki.push(<span key="rekl"
          className="rounded bg-violet-100 px-1.5 py-0.5 text-podpis font-bold text-violet-900">
          REKLAMACYJNA</span>);
        /* Statusy z decyzji człowieka albo z ruchu hali dalej są plakietką —
           patrz `WYJATKOWE`. */
        if (wyjatkowy) znaczniki.push(<Plakietka key="status" status={r.status}>{NAZWA[r.status]}</Plakietka>);
        /* Status bez plakietki nie znika — schodzi do podpisu. §4.3: fakt
           wolno wyciszyć, nie wolno schować. Milczy tylko tam, gdzie zegar
           mówi to samo innymi słowami. */
        if (zegar === null && !wyjatkowy) znaczniki.push(<span key="nazwa"
          className="shrink-0 text-slate-500">{NAZWA[r.status]}</span>);
        /* Liczba DOPISKÓW klienta od naszej odpowiedzi. Nie nazywamy jej
           „nieprzeczytane": tego Allegro nie podaje, a ekran nie ma prawa
           obiecywać pomiaru, którego nie robi. */
        if (r.nowychOdOdpowiedzi > 1) znaczniki.push(<span key="dopiski"
          title={`${r.nowychOdOdpowiedzi} wiadomości klienta od naszej odpowiedzi`}
          className="flex items-center gap-0.5 font-bold text-slate-600">
          <MessageSquare size={12} aria-hidden="true" />{r.nowychOdOdpowiedzi}
          <span className="sr-only"> dopiski klienta</span></span>);
        if (r.zadanieWToku) znaczniki.push(<span key="zadanie" title="zadanie w toku"
          className="flex items-center text-slate-600">
          <Ruler size={13} aria-hidden="true" /><span className="sr-only">zadanie w toku</span></span>);
        /* Stan DOBORU znakiem. `pusty` i `nie_dotyczy` milczą: znak „nie
           zaczęty" na każdym wierszu nie mówiłby niczego, a „nie dotyczy" to
           wiersz, przy którym doboru NIE trzeba robić. Barwa niesie wagę
           (mapa w `statusy.ts`), a nazwę `title` i czytnik. */
        const barwaDoboru = BARWA_STANU_DOBORU[r.dobor];
        if (barwaDoboru) znaczniki.push(<span key="dobor"
          title={`dobór: ${NAZWA_STANU_DOBORU[r.dobor]}`} className={`flex items-center ${barwaDoboru}`}>
          <Wrench size={13} aria-hidden="true" />
          <span className="sr-only">{NAZWA_STANU_DOBORU[r.dobor]}</span></span>);
        /* Rzadka kategoria dostaje SŁOWO obok znaku — patrz `CZESTE`. Znak
           stoi w pierwszej linii, słowo tutaj: w pierwszej ścisnęłoby login. */
        if (r.kopilot && r.kopilot.status !== "FAILED" && !r.podziekowal
          && !CZESTE.has(r.kopilot.kategoria)) znaczniki.push(<span key="kategoria"
          className="font-semibold text-violet-800">{nazwaNaPlakietce(r.kopilot)}</span>);
        if (r.wlasciciel) znaczniki.push(<span key="prowadzi"
          className="flex items-center gap-1 font-semibold text-slate-600">
          <UserCheck size={12} />{r.wlasciciel}</span>);
        /* Odłożona mówi DO KIEDY (0.533.0): „Odłożona" bez daty każe
           otworzyć rozmowę, żeby się dowiedzieć, czy to jutro, czy za tydzień. */
        if (r.status === "snoozed" && r.odlozoneDo && !r.poTerminie) znaczniki.push(<span key="odlozona"
          className="flex items-center gap-1 text-slate-600">
          <AlarmClock size={12} aria-hidden="true" />do {czas(r.odlozoneDo)}</span>);
        if (r.poTerminie) znaczniki.push(<span key="termin" title="termin odłożenia minął"
          className="flex items-center text-ranga-uwaga">
          <AlarmClock size={13} aria-hidden="true" /><span className="sr-only">po terminie</span></span>);
        /* Kolega SIEDZI przy tym pytaniu (0.159.0). Bez tego znaku dwóch
           agentów pisze tę samą odpowiedź, a dowiadują się o tym dopiero
           przy wysyłce — czyli po straconej pracy. */
        if (r.oglada && r.oglada.userId !== mojeId) znaczniki.push(<span key="oglada"
          className="flex items-center gap-1 font-semibold text-violet-700">
          <Eye size={12} />{r.oglada.name}</span>);
        return <button key={r.id} onClick={() => onWybierz(r.id)}
          aria-current={wybranaId === r.id}
          /* Znacznik dla Entera „do pola odpowiedzi" (`Edytor.tsx`): z wiersza
             kolejki Enter prowadzi do pisania, a nie klika wiersza drugi raz. */
          data-wiersz-kolejki=""
          /* ── ZAZNACZENIE PRZESTAJE BYĆ BURSZTYNOWE (0.265.0) ───────────────
             `bg-amber-50` znaczyło w panelu naraz „wybrany wiersz" i „coś tu
             jest nie tak": tym samym `#FFFBEB` malowały się pasmo braku oferty,
             konflikt przejęcia, ostrzeżenie Copilota, notatka wewnętrzna
             i formularz pomiaru. Dwa z tych znaczeń są PRZECIWSTAWNE.

             Zaznaczenie schodzi na szarość, bo jest stanem STRUKTURALNYM, nie
             znaczeniowym — a wolnej rodziny barw już nie ma: czerwień to błąd,
             zieleń powodzenie, fiolet przypuszczenie Copilota, błękit zdarzenia
             doboru. Marka zostaje na belce 3 px, gdzie nie udaje pasma.

             STOPIEŃ SZAROŚCI ZMIERZONY, nie dobrany okiem. `slate-100` różni się
             od `slate-50` (czyli od najechania kursorem) o ΔE 2,2, a próg
             zauważalności dla dużych płaszczyzn to ok. 2,3 — wiersz wybrany
             wyglądałby jak wiersz pod kursorem. `slate-200` daje ΔE 7,3 wobec
             najechania i 14,4 wobec pasma ostrzeżenia, przy kontraście tekstu
             8,4:1. Dalej, na `slate-300`, wiersz zaczyna wyglądać na wyłączony.

             `border-l-[3px]` stoi PRZY KAŻDYM wierszu, nie tylko przy wybranym:
             dokładana dopiero przy zaznaczeniu przesuwała treść o trzy piksele
             w prawo, więc kliknięcie w wiersz szarpało tekstem. */
          className={`flex w-full flex-col gap-1 border-b border-l-[3px] px-3 py-2 text-left ${
            wybranaId === r.id
              ? "wiersz-wybrany border-l-wertis-amber bg-slate-200"
              : "border-l-transparent hover:bg-slate-50"} ${
            /* Wybrany wiersz nie błyska: jest już szary. */
            wybranaId !== r.id && nowe.has(String(r.id)) ? "motion-safe:animate-wiersz-nowy" : ""}`}>
          {/* ── WARIANT C: KTO I ILE CZEKA, POTEM PYTANIE (0.548.0) ───────────
              Decyzja właściciela z 28 września 2026. Pierwsza linia to login
              i wiek, pod nią do dwóch linii pytania. Kafla kategorii po lewej
              nie ma: zabierał szerokość, którą pytanie dostaje w drugiej linii.

              To odwraca dwie wcześniejsze decyzje i świadomie. 0.193.0 dało
              pierwszy plan treści, bo „login nie mówi nic". Treść zostaje
              najcięższym blokiem wiersza, a login stoi nad nią drobno i mono,
              bo od drogi klienta jest kluczem sprawy. 23 września pytanie
              zeszło do jednej linii („za dużo tekstu"). Wróciły dwie, bo
              zniknęły kafel i osobny rząd loginu, które tamte piksele jadły. */}
          <span className="flex w-full min-w-0 items-center gap-2">
            {/* KROPKA, NIE SŁOWO (0.193.0). Stało tu „NOWE", a obok, w plakietce
                statusu, „NOWA" — dwa różne fakty jednym wyrazem. Kropka to znak
                nieprzeczytanego znany ze wszystkich skrzynek; nazwę niesie
                `title` i tekst dla czytnika ekranu. Stoi tam, gdzie wzrok
                wchodzi w wiersz — od wariantu C to pierwsza linia. */}
            {r.nieprzeczytana && <span title="Nieprzeczytana wiadomość"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-wertis-amber">
              <span className="sr-only">NOWE</span></span>}
            {/* ZNAK KATEGORII NA POCZĄTKU (23 września 2026). Kategoria, prośba
                o człowieka i podziękowanie czytają się, zanim wzrok dojdzie do
                treści — patrz `ZnakKategorii`. Od 0.548.0 bez kafla. */}
            <ZnakKategorii kopilot={r.kopilot} podziekowal={r.podziekowal} />
            <span className="min-w-0 truncate font-mono text-sm font-bold text-slate-800">{r.klient}</span>
            {/* PILNE w linii loginu: odpowiada na to samo pytanie co wiek po
                prawej — „za co się wziąć". Flagę stawia człowiek, patrz
                `ustawPriorytet`. Reszta plakietek schodzi pod pytanie, bo
                w linii loginu ścisnęłaby go do zera w kolumnie 336 px. */}
            {r.priorytet === "pilny" &&
              <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-podpis font-bold text-ranga-zle">
                PILNE</span>}
            {/* WIEK NA PRAWEJ KRAWĘDZI, w barwie pilności — `Czekanie`. Stoi
                w jednej kolumnie przez całą przewijaną listę. Data ustępuje
                zegarowi (0.251.0), bo przy „czeka na nas" oba mierzą tę samą
                wiadomość; gdy zegara nie ma, data jest jedynym czasem wiersza. */}
            <span className="ml-auto shrink-0 pl-1">
              {zegar !== null
                ? <Czekanie ms={zegar} />
                : <span className="text-podpis text-slate-500">{czas(r.ostatniaWiadomoscAt)}</span>}
            </span>
          </span>
          {/* ── WIERSZ MÓWI, NA CZYM TRAFIŁ (0.425.0) ──────────────────────
              Powód trafienia STOI PRZY LOGINIE, bo to jego dotyczy: mówi „ten
              login nie zawiera tego, czego szukasz". Pod loginem, nie w jego
              linii — tam zepchnąłby login i wiek, a pojawia się tylko przy
              szukaniu. */}
          {trafienie && <span className="flex items-center gap-1 text-podpis font-semibold text-slate-600">
            <Search size={12} aria-hidden="true" />{trafienie}</span>}
          {/* Podgląd to słowa KLIENTA (0.166.0). Gdy klient nic nie napisał, stoi
              nasza wiadomość — ale z podpisem, bo bez niego czytałoby się ją jak
              pytanie. Autoodpowiedź konta Allegro wyglądała tak przez pół roku.
              Podziękowanie jest przygaszone, bo nie czeka na nas — przez barwę
              pisma, nie przez przezroczystość, która zbiłaby kontrast. */}
          <span className={`line-clamp-2 break-words text-tresc ${
            r.podziekowal ? "text-slate-600" : "text-slate-800"}`}>
            {!r.ostatniaOdKlienta && r.ostatniaWiadomosc &&
              <span className="font-semibold text-slate-500">Biuro: </span>}
            {r.ostatniaWiadomosc}</span>
          {znaczniki.length > 0 &&
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-podpis text-slate-500">
              {znaczniki}</span>}
        </button>;
      })}
      {/* Stopka „Dalsze wiersze mogą istnieć w Allegro…" zeszła (0.522.0):
          stała tylko przy alarmie, a baner alarmu mówi to samo — „nowe pytania
          mogą już czekać, a ich tu nie widać". Przygaszona lista zostaje. */}
    </div>
  </section>;
}
