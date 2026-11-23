import React, { useEffect, useRef, useState } from "react";
import {
  AlarmClock, AlertTriangle, Bell, BellOff, Eye, Inbox, Lock, MessageSquare, RefreshCw, Ruler, Search, UserCheck,
} from "lucide-react";
import type {
  Rozmowa, StanCopilota, StanSkrzynki, StatusRozmowy, WynikPartii,
} from "../api/typy";
import { Blad, czas, kiedy, Plakietka, Pusto } from "../ui";
import { FiltrZWiecej } from "../ui/FiltrZWiecej";
import { KolumnaKolejki, PustaKolejka, SzukajWKolejce } from "../ui/KolumnaKolejki";
import { klawiszZajety } from "../nawigacja/fokus";
import { DYMEK_ZAMKNIETEGO_PROBLEMU, NAZWA, dymekProblemowZakupu, opisProblemuZakupu } from "./statusy";
import { CZESTE, PasekCopilota, ZnakCopilota, ZnakKategorii, doRozpoznania, nazwaNaPlakietce } from "./Copilot";
import { Czekanie } from "./Czekanie";
import { SlownikZnakow } from "./SlownikZnakow";
import type { StanPowiadomien } from "./Sygnaly";
import { useNoweKlucze } from "./Ruch";

/* Kubełki kolejki z §10.1: „Nieprzypisane, Moje, Oczekujące". Filtr jest po
   stronie EKRANU, bo lista i tak przyjeżdża w całości — dokładanie parametru
   do trasy nic by dziś nie oszczędziło, a rozmnożyłoby reguły przynależności
   na dwie strony.

   Znacznik „po terminie" na wierszu liczy SERWER (`poTerminie`). */
type Kubelek = "doOdpowiedzi" | "nieprzypisane" | "moje" | "oczekujace" | "zakonczone" | "wszystkie";

/* ── Kolejność listy ─────────────────────────────────────────────────────────
   Domyślna zostaje po serwerze: PILNE, potem najdłużej czekające pytanie —
   decyzja właściciela i odpowiedź na pytanie „za co się wziąć".
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

/** Kubełki przeglądania, nie pracy — pod „Więcej". */
const POD_WIECEJ: ReadonlyArray<Kubelek> = ["oczekujace", "zakonczone", "wszystkie"];

/* ── „DO ODPOWIEDZI" JEST PIERWSZY I DOMYŚLNY ───────────────────────────────
   Decyzja właściciela. W „Wszystkie" zakończone stoją NA GÓRZE, bo serwer
   układa po najstarszym pytaniu klienta, więc „Następna" po wysyłce
   trafiałaby w archiwum. Praca nie dzieli się też na dwa kubełki: dopisek
   klienta, któremu już odpisałem, i nowe pytanie stoją razem.

   „Do odpowiedzi" to nasz ruch bez cudzych: niczyje i moje razem. Kolega
   ma swoje u siebie, a jego rozmowę dalej widać w „Wszystkie". „Wszystkie"
   schodzi pod „Więcej" — to przeglądanie, nie praca. */
const KUBELKI: Array<{ klucz: Kubelek; etykieta: string }> = [
  { klucz: "doOdpowiedzi", etykieta: "Do odpowiedzi" },
  { klucz: "nieprzypisane", etykieta: "Nieprzypisane" },
  { klucz: "moje", etykieta: "Moje" },
  { klucz: "oczekujace", etykieta: "Oczekujące" },
  /* Zakończone: ręką agenta albo samo — podziękowanie,
     dwa dni ciszy, wątek zamknięty w Allegro. Osobno, żeby pomyłkowe
     zakończenie dało się znaleźć i otworzyć, a nie tylko w „Wszystkie". */
  { klucz: "zakonczone", etykieta: "Zakończone" },
  { klucz: "wszystkie", etykieta: "Wszystkie" },
  /* Odłożone stoją w „Oczekujących" — czekają na termin, jak
     tamte na klienta albo halę. Osobny kubełek byłby czwartym miejscem do
     sprawdzania, a po terminie rozmowa i tak wraca sama do „Do odpowiedzi". */
];

/* Spam znika z kolejki roboczej, ale NIE z panelu: widać go w „Wszystkie".
   Ukrycie go wszędzie znaczyłoby, że pomyłki nie da się cofnąć. */

/* ── KTÓRY STATUS ZASŁUGUJE NA PLAKIETKĘ ─────────────────────────────────────
   W kubełkach roboczych („Nieprzypisane", „Moje") status jest praktycznie
   STAŁY. Plakietka na każdym wierszu powtarzałaby w kółko to samo słowo,
   a wiersze RÓŻNI czas oczekiwania.

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

/* ── KUBEŁKI ROBOCZE TO NASZ RUCH ────────────────────────────────────────────
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
      rozmowy" po wysyłce. Kolejka trzyma te sita u siebie. */
  onWidoczne?: (ids: number[]) => void;
  /** Przełącznik powiadomień systemowych — patrz `Sygnaly.ts`.
      Brak = przeglądarka ich nie zna, więc przycisku nie ma. */
  powiadomienia?: { stan: StanPowiadomien; przelacz: () => void };
  onOdswiez: () => void;
  laduje: boolean;
  /** Trwa odświeżanie w tle lub z przycisku — ikona wtedy się kręci (albo ciemnieje). */
  odswieza?: boolean;
  /* Kolejka nieświeża wygląda inaczej, bo znaczy co innego. Pusta lista przy
     stojącym synchronizatorze to nie „brak pytań", tylko „nie wiem". */
  nieswieza?: boolean;
  /* Lista nie przyszła wcale. Wtedy kolejka nie wie, ile czeka,
     więc nie mówi „brak rozmów" ani „0" — mówi, że nie wie, i dlaczego. */
  bladBezDanych?: string | null;
}) {
  const [kubelek, setKubelek] = useState<Kubelek>("doOdpowiedzi");
  /* Starszy serwer pola nie wysyła. Brak wiedzy to nie alarm, więc milczymy. */
  const problemyZakupu = stan.problemyZakupu ?? null;
  /* Wiersze, które WESZŁY do „Do odpowiedzi" po pierwszym odczycie: nowy wątek
     albo wątek, który wrócił po odpowiedzi klienta. Klucz liczy się z CAŁEJ
     listy, nie z widocznego kubełka, więc przełączanie zakładek niczego nie
     błyska. Bez `mojeId` „moje" jeszcze się nie rozstrzygnęły — czekamy, bo
     inaczej wszystkie moje wątki weszłyby do kubełka przy starcie. */
  const doOdpowiedziKlucze = rozmowy
    .filter((r) => wKubelku(r, "doOdpowiedzi", mojeId)).map((r) => String(r.id));
  const nowe = useNoweKlucze(doOdpowiedziKlucze, !laduje && mojeId !== null);
  /* ── Szukanie w kolejce ────────────────────────────────────────────────────
     Kubełek mówi „czyje to", a szukanie odpowiada „czy TA rozmowa gdzieś
     tu jest". Bez niego „klient pisał o tym miesiąc temu" znaczy przewijanie
     listy.

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

  /* ── WIERSZ MÓWI, NA CZYM TRAFIŁ ──────────────────────────────────────────
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

  /* ── KLAWIATURA W SKRZYNCE ───────────────────────────────────────────
     Na skrzynce agent siedzi najdłużej z całego panelu (patrz `Edytor.tsx`),
     więc chodzi z klawiatury jak zwroty i reklamacje.

     NASŁUCH MIESZKA W KOLEJCE, nie w ekranie, i to jest różnica wobec tamtych
     trzech. Tam ekran zna listę, więc wie, co jest „następne". Tutaj kubełek
     i szukanie są stanem TEJ kolejki, a ekran widzi wyłącznie
     `wybranaId` — liczyłby więc „następną" z listy nieprzefiltrowanej
     i przeskakiwał na rozmowy, których nie widać. Podnoszenie tego stanu na
     ekran byłoby większą zmianą niż cały ten skrót.

     POLE TEKSTOWE WYGRYWA ZAWSZE. Na tym ekranie agent PISZE — bez tej bramki
     `j` w słowie „już" przerzucałoby rozmowę spod kursora.

     Strażnik jest WSPÓLNY, z `nawigacja/fokus.ts`, bo zna SELECT-a, a kolejka
     ma dwa: „Więcej" i kolejność. Strzałka w otwartej liście zmieniałaby
     naraz jej wartość i rozmowę pod kursorem. Strażnik milczy też pod oknem
     modalnym (`klawiszZajety`). */
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
       a „Wszystkie" ostatnia — jak w tamtych trzech ekranach. */
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

  /* ── JEDNA KOLUMNA LISTY, ta sama co w pozostałych kolejkach ─────────
     Układ pasm stoi w `ui/KolumnaKolejki.tsx`. Tu zostaje to, co należy do
     skrzynki: data synchronizacji obok tytułu, pomoc, powiadomienia, znak
     Copilota i odświeżenie.

     DATA SYNCHRONIZACJI ZOSTAJE: pusta lista o 9:00 znaczy co innego, gdy
     synchronizator stanął o 6:00, a co innego, gdy przebiegł minutę temu.
     Schodzi obok tytułu w rozmiar podpisu i ustępuje mu miejsca. */
  return <KolumnaKolejki tytul="Rozmowy" ikona={<Inbox size={16} />} nieswieza={nieswieza}
    opis={<>
      {stan.ostatniaSynchronizacja ? <>synchronizacja {czas(stan.ostatniaSynchronizacja)}</>
        : "bez synchronizacji"}
      {stan.bledy > 0 && <span className="ml-1 font-bold text-amber-700">· błędów: {stan.bledy}</span>}
    </>}
    akcje={<>
      {/* JEDEN „?" ZAMIAST DWÓCH: słownik znaków i skróty klawiszy to jedna
          pomoc tej kolejki, otwierana jednym przyciskiem. */}
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
      {/* Bez plakietki „STAN Z …": baner alarmu nad kolumnami mówi „dane
          sprzed…" pełnym zdaniem. */}
      <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onOdswiez}
        title="Odśwież" aria-label="Odśwież" aria-busy={odswieza}>
        {/* Kręci się tylko z `motion-safe:`; bez animacji w systemie ikona
            ciemnieje, żeby kliknięcie nadal coś pokazywało. */}
        <RefreshCw size={16} className={odswieza ? "motion-safe:animate-spin motion-reduce:opacity-40" : ""} /></button>
    </>}
    /* ── PROBLEMY Z ZAKUPEM NIE DOCHODZĄ ─────────────────────────────────
       Osobna linijka pod datą, nie dopisek do niej: zdanie o synchronizacji
       ucina się wielokropkiem, a dopisek na jego końcu znikałby pierwszy.
       Linijka staje tylko wtedy, gdy beta nie działa. Przyczyna, termin
       i co zrobić stoją w dymku i dla czytnika, bo konfiguracji z tego miejsca
       i tak nikt nie naprawi. */
    podTytulem={problemyZakupu && <p className="flex items-center gap-1.5 pb-1 text-podpis font-semibold text-ranga-uwaga"
      title={dymekProblemowZakupu(problemyZakupu)}>
      <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
      Problemy z zakupem nie dochodzą
      <span className="sr-only"> — {dymekProblemowZakupu(problemyZakupu)}</span>
    </p>}
    /* ── TRZY KUBEŁKI NA WIERZCHU, RESZTA POD „WIĘCEJ" ────────────────────
       Zgłoszenie agenta: „przytłacza". Robota dzieje się w trzech kubełkach;
       „Oczekujące", „Zakończone" i „Wszystkie" to przeglądanie, a cyfry 4–6
       je wybierają. „Więcej" mierzy się treścią, więc stoi w rzędzie pigułek. */
    kubelki={<FiltrZWiecej<Kubelek> wybrany={kubelek} onWybierz={setKubelek} wiecej={POD_WIECEJ}
      pozycje={KUBELKI.map((k) => ({ klucz: k.klucz, etykieta: k.etykieta,
        ile: bladBezDanych ? undefined : rozmowy.filter((r) => wKubelku(r, k.klucz, mojeId)).length }))} />}
    /* Pole stoi pod kubełkami: kubełek wybiera się raz na wejście, a szuka się
       w środku tego, co się wybrało. Kolejność obok pola, bo to trzecie sito
       na tę samą listę, a osobny rząd zjadałby wysokość listy.

       Podpowiedź MIEŚCI SIĘ w polu: „Szukaj: login, treść, prowadzący" nie
       mieści się w 136 px, więc „Szukaj" mówi lupa i nazwa pola. */
    szukaj={<div className="flex items-center gap-2">
      <SzukajWKolejce wartosc={fraza} onZmien={setFraza}
        etykieta="Szukaj w rozmowach" placeholder="Login, treść, prowadzący" />
      <select className="field w-auto shrink-0 py-1 text-xs" aria-label="Kolejność" value={porzadek}
        onChange={(e) => ustawPorzadek(e.target.value as Porzadek)}>
        <option value="czekanie">najdłużej czekające</option>
        <option value="najnowsze">od najnowszych</option>
      </select>
    </div>}
    nad={<PasekCopilota stan={copilot} kandydaci={doRozpoznania(wKubelkuTeraz, copilot)}
      trwa={klasyfikacja?.trwa} wynik={klasyfikacja?.wynik} blad={klasyfikacja?.blad}
      onRozpoznaj={onRozpoznaj} />}>
    {/* PIGUŁEK KATEGORII NIE MA — decyzja właściciela. Pasek liczył kategorie
        po PRZYPUSZCZENIU maszyny i potrafił zająć trzy rzędy nad pierwszym
        pytaniem. Kategoria zostaje na wierszu i w nagłówku rozmowy. Kolejność
        niosą fakty: flaga „pilne" i czas oczekiwania. */}
    <>
      {laduje && <Pusto waga="lista">Wczytuję…</Pusto>}
      {!laduje && !rozmowy.length && (bladBezDanych
        ? <Blad>{bladBezDanych}</Blad>
        : <PustaKolejka ikona={Inbox}>Brak rozmów w zsynchronizowanej skrzynce.</PustaKolejka>)}
      {/* Pusty KUBEŁEK to co innego niż pusta skrzynka i niż pusty WYNIK
          SZUKANIA: „nic nie czeka na mnie" nie znaczy „nic nie przyszło".
          Zdanie o szukaniu cytuje frazę, bo literówki widać dopiero wtedy. */}
      {!laduje && rozmowy.length > 0 && !widoczne.length && szukane !== "" &&
        <PustaKolejka ikona={Search}>
          Nic nie pasuje do „{fraza.trim()}" w tym kubełku.{" "}
          <button type="button" className="underline" onClick={() => setFraza("")}>
            Wyczyść szukanie</button></PustaKolejka>}
      {!laduje && rozmowy.length > 0 && !widoczne.length && szukane === "" &&
        <PustaKolejka ikona={Inbox}>Ten kubełek jest pusty — zajrzyj do „Wszystkie".</PustaKolejka>}
      {widoczne.map((r) => {
        /* ── ZEGAR MIERZY NASZ DŁUG, NIE WIEK ROZMOWY ─────────────────────
           `czekaOdMs` liczy się od ostatniej wiadomości KLIENTA. Przy statusie
           „Czeka na klienta" znaczy to, że odpisaliśmy — a wiersz i tak pisał
           „czeka 15 g", czyli mierzył czas komuś, kto na nic nie czeka. Słowo
           „czeka" musi być prawdziwe, bo po nim układa się kolejność pracy
           (§10.2) i po nim serwer sortuje domyślną listę. */
        const zegar = NASZ_RUCH.has(r.status) ? r.czekaOdMs : null;
        const wyjatkowy = WYJATKOWE.has(r.status);
        const trafienie = powodTrafienia(r);
        /* ── ZNACZNIKI POD PYTANIEM ───────────────────────────────────────
           Rząd staje tylko wtedy, gdy ma co nieść. Kolejność:
           najpierw to, co krzyczy (reklamacyjna, status-wyjątek), potem
           fakty wyciszone. Lista zamiast warunku na każdym dziecku, bo pusty
           rząd z marginesem wyglądałby jak ucięty wiersz. */
        const znaczniki: React.ReactNode[] = [];
        /* ZNACZNIK REKLAMACYJNY przed statusem: mówi, JAK prowadzimy
           sprawę, a nie co się z nią stało. Sprawy w Allegro za nim nie ma —
           założyć ją może tylko kupujący. */
        if (r.reklamacyjna) znaczniki.push(<span key="rekl"
          className="rounded bg-violet-100 px-1.5 py-0.5 text-podpis font-bold text-violet-900">
          REKLAMACYJNA</span>);
        /* PROBLEM Z ZAKUPEM tuż obok, ale w BŁĘKICIE, nie w fiolecie. Fiolet
           to nasza flaga i przypuszczenie Copilota. Błękit niesie w kolejce
           reklamacji obecność Allegro, a ta sprawa też jest Allegro:
           zakłada ją kupujący i biuro jej nie zdejmie.

           Powód stoi SŁOWEM, nie w dymku, bo od niego zależy pierwszy ruch,
           a dymek wymaga kursora. Słowo w barwie źródła, jak kategoria Copilota.
           Jedna grupa, żeby zawinięcie nie oderwało powodu od znacznika. */
        if (r.problemZakupu) {
          const problem = opisProblemuZakupu(r.problemZakupu);
          znaczniki.push(<span key="problem" title={problem.dymek}
            className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="rounded bg-sky-100 px-1.5 py-0.5 font-bold text-sky-900">PROBLEM Z ZAKUPEM</span>
            {problem.powod && <span className="font-semibold text-sky-800">{problem.powod}</span>}
            {/* Zamknięty przez Allegro: odpowiedź w tym wątku nie przejdzie.
                Szarość jak przy czacie zamkniętym w reklamacjach: wątek
                wygasł, ale fakt zostaje widoczny. */}
            {r.problemZakupu.zamkniety && <span title={DYMEK_ZAMKNIETEGO_PROBLEMU}
              className="inline-flex items-center gap-0.5 text-slate-600">
              <Lock size={12} aria-hidden="true" />zamknięty</span>}
          </span>);
        }
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
        /* Rzadka kategoria dostaje SŁOWO obok znaku — patrz `CZESTE`. Znak
           stoi w pierwszej linii, słowo tutaj: w pierwszej ścisnęłoby login. */
        if (r.kopilot && r.kopilot.status !== "FAILED" && !r.podziekowal
          && !CZESTE.has(r.kopilot.kategoria)) znaczniki.push(<span key="kategoria"
          className="font-semibold text-violet-800">{nazwaNaPlakietce(r.kopilot)}</span>);
        if (r.wlasciciel) znaczniki.push(<span key="prowadzi"
          className="flex items-center gap-1 font-semibold text-slate-600">
          <UserCheck size={12} />{r.wlasciciel}</span>);
        /* Odłożona mówi DO KIEDY: „Odłożona" bez daty każe
           otworzyć rozmowę, żeby się dowiedzieć, czy to jutro, czy za tydzień. */
        if (r.status === "snoozed" && r.odlozoneDo && !r.poTerminie) znaczniki.push(<span key="odlozona"
          className="flex items-center gap-1 text-slate-600">
          <AlarmClock size={12} aria-hidden="true" />do {czas(r.odlozoneDo)}</span>);
        if (r.poTerminie) znaczniki.push(<span key="termin" title="termin odłożenia minął"
          className="flex items-center text-ranga-uwaga">
          <AlarmClock size={13} aria-hidden="true" /><span className="sr-only">po terminie</span></span>);
        /* Kolega SIEDZI przy tym pytaniu. Bez tego znaku dwóch
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
          /* ── ZAZNACZENIE NIE JEST BURSZTYNOWE ──────────────────────────────
             `bg-amber-50` znaczy w panelu „coś tu jest nie tak" (pasmo braku
             oferty, ostrzeżenie Copilota, notatka wewnętrzna) — przeciwieństwo
             „wybranego wiersza".

             Zaznaczenie stoi na szarości, bo jest stanem STRUKTURALNYM, nie
             znaczeniowym — a wolnej rodziny barw już nie ma: czerwień to błąd,
             zieleń powodzenie, fiolet przypuszczenie Copilota, błękit zdarzenia
             na osi. Marka zostaje na belce 3 px, gdzie nie udaje pasma.

             STOPIEŃ SZAROŚCI ZMIERZONY, nie dobrany okiem. `slate-100` różni się
             od `slate-50` (czyli od najechania kursorem) o ΔE 2,2, a próg
             zauważalności dla dużych płaszczyzn to ok. 2,3 — wiersz wybrany
             wyglądałby jak wiersz pod kursorem. `slate-200` daje ΔE 7,3 wobec
             najechania i 14,4 wobec pasma ostrzeżenia, przy kontraście tekstu
             8,4:1. Dalej, na `slate-300`, wiersz zaczyna wyglądać na wyłączony.

             `border-l-[3px]` stoi PRZY KAŻDYM wierszu, nie tylko przy wybranym:
             dokładana dopiero przy zaznaczeniu przesuwałaby treść o trzy piksele
             w prawo.

             LEWY MARGINES JEST SZERSZY OD PRAWEGO, bo mieszka w nim kropka
             nieprzeczytanej — patrz komentarz przy niej. */
          className={`flex w-full flex-col gap-1 border-b border-l-[3px] py-2 pl-5 pr-3 text-left ${
            wybranaId === r.id
              ? "wiersz-wybrany border-l-wertis-amber bg-slate-200"
              : "border-l-transparent hover:bg-slate-50"} ${
            /* Wybrany wiersz nie błyska: jest już szary. */
            wybranaId !== r.id && nowe.has(String(r.id)) ? "motion-safe:animate-wiersz-nowy" : ""}`}>
          {/* ── KTO I ILE CZEKA, POTEM PYTANIE ────────────────────────────────
              Decyzja właściciela. Pierwsza linia to login i wiek, pod nią do
              dwóch linii pytania. Bez kafla kategorii po lewej: zabierałby
              szerokość, którą pytanie dostaje w drugiej linii.

              Treść jest najcięższym blokiem wiersza, a login stoi nad nią
              drobno i mono, bo w drodze klienta jest kluczem sprawy. */}
          <span className="flex w-full min-w-0 items-center gap-2">
            {/* KROPKA, NIE SŁOWO. Słowo „NOWE" obok plakietki statusu „NOWA"
                to dwa różne fakty jednym wyrazem. Kropka to znak
                nieprzeczytanego znany ze wszystkich skrzynek; nazwę niesie
                `title` i tekst dla czytnika ekranu. Stoi tam, gdzie wzrok
                wchodzi w wiersz — w pierwszej linii.

                KROPKA WISI NA MARGINESIE, nie w linii. W linii odpychałaby znak
                kategorii i login o 16 px, więc lewa krawędź loginów skakałaby
                z wiersza na wiersz. Oko szukało wtedy początku każdego loginu
                osobno, zamiast zjechać w dół po jednej krawędzi. `-ml-3 -mr-1`
                przy odstępie `gap-2` i marginesie `pl-5` stawia kropkę 4 px od
                znaku i 8 px od belki. Bliżej znaku, bo otwarcie rozmowy nie
                zdejmuje flagi: wybrany wiersz bywa nieprzeczytany, a bursztyn
                kropki tuż przy bursztynie belki czytałby się jak jej zgrubienie. */}
            {r.nieprzeczytana && <span title="Nieprzeczytana wiadomość"
              className="-ml-3 -mr-1 inline-block h-2 w-2 shrink-0 rounded-full bg-wertis-amber">
              <span className="sr-only">NOWE</span></span>}
            {/* ZNAK KATEGORII NA POCZĄTKU, bez kafla. Kategoria, prośba
                o człowieka i podziękowanie czytają się, zanim wzrok dojdzie do
                treści — patrz `ZnakKategorii`. */}
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
                zegarowi, bo przy „czeka na nas" oba mierzą tę samą
                wiadomość; gdy zegara nie ma, data jest jedynym czasem wiersza.
                Data jest KRÓTKA (`kiedy`), bo pełna ścinała login o rok
                i godzinę sprzed dni, których w tej kolumnie nikt nie czyta. */}
            <span className="ml-auto shrink-0 pl-1">
              {zegar !== null
                ? <Czekanie ms={zegar} />
                : <span title={czas(r.ostatniaWiadomoscAt)}
                  className="text-podpis tabular-nums text-slate-500">{kiedy(r.ostatniaWiadomoscAt)}</span>}
            </span>
          </span>
          {/* ── WIERSZ MÓWI, NA CZYM TRAFIŁ ────────────────────────────────
              Powód trafienia STOI PRZY LOGINIE, bo to jego dotyczy: mówi „ten
              login nie zawiera tego, czego szukasz". Pod loginem, nie w jego
              linii — tam zepchnąłby login i wiek, a pojawia się tylko przy
              szukaniu. */}
          {trafienie && <span className="flex items-center gap-1 text-podpis font-semibold text-slate-600">
            <Search size={12} aria-hidden="true" />{trafienie}</span>}
          {/* Podgląd to słowa KLIENTA. Gdy klient nic nie napisał, stoi
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
      {/* Bez stopki o dalszych wierszach w Allegro: baner alarmu mówi to samo —
          „nowe pytania mogą już czekać, a ich tu nie widać". */}
    </>
  </KolumnaKolejki>;
}
