import React, { useState } from "react";
import {
  AlarmClock, Eye, Inbox, RefreshCw, Ruler, Search, UserCheck, Wrench, X,
} from "lucide-react";
import type {
  Kategoria, Rozmowa, StanCopilota, StanSkrzynki, StatusRozmowy, WynikPartii,
} from "../api/typy";
import { Plakietka, czas } from "../ui";
import { NAZWA, NAZWA_DOBORU, NAZWA_KATEGORII } from "./statusy";
import { PasekCopilota, PlakietkaKategorii, ZnakCopilota, doRozpoznania } from "./Copilot";

/* Kubełki kolejki wprost z §10.1: „Nieprzypisane, Moje, Oczekujące, Po
   terminie". Filtr jest po stronie EKRANU, bo lista i tak przyjeżdża w
   całości — dokładanie parametru do trasy nic by dziś nie oszczędziło,
   a rozmnożyłoby reguły przynależności na dwie strony.

   „Po terminie" liczy SERWER (`poTerminie`). Ekran tej reguły nie wyprowadza
   drugi raz — kubełki zwrotów już raz pokazały, czym kończą się dwie kopie
   jednej definicji: dwiema różnymi kolejkami przy jednym liczniku. */
type Kubelek = "wszystkie" | "nieprzypisane" | "moje" | "oczekujace" | "poTerminie";

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

const KUBELKI: Array<{ klucz: Kubelek; etykieta: string }> = [
  { klucz: "wszystkie", etykieta: "Wszystkie" },
  { klucz: "nieprzypisane", etykieta: "Nieprzypisane" },
  { klucz: "moje", etykieta: "Moje" },
  { klucz: "oczekujace", etykieta: "Oczekujące" },
  { klucz: "poTerminie", etykieta: "Po terminie" },
];

/* Rozmowa zamknięta i spam znikają z kolejki roboczej, ale NIE z panelu:
   widać je w „Wszystkie". Ukrycie ich wszędzie znaczyłoby, że pomyłkowego
   zamknięcia nie da się cofnąć — a nikt nie szuka sprawy, której nie ma. */
const ZESZLA_Z_BIURKA = ["closed", "spam"];

/**
 * Czas oczekiwania po ludzku. Minuty do godziny, potem godziny do doby, dalej
 * dni — bo „czeka 3140 min" nie mówi nic, a „czeka 2 d" mówi wszystko.
 */
export function czekaOd(ms: number): string {
  const minuty = Math.floor(ms / 60_000);
  if (minuty < 60) return `${minuty} min`;
  const godziny = Math.floor(minuty / 60);
  if (godziny < 24) return `${godziny} g ${minuty % 60} min`;
  return `${Math.floor(godziny / 24)} d ${godziny % 24} g`;
}

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

function wKubelku(r: Rozmowa, kubelek: Kubelek, mojeId: number | null): boolean {
  if (kubelek === "wszystkie") return true;
  if (kubelek === "poTerminie") return r.poTerminie;
  if (ZESZLA_Z_BIURKA.includes(r.status)) return false;
  if (kubelek === "nieprzypisane") return r.wlascicielId === null;
  if (kubelek === "moje") return mojeId !== null && r.wlascicielId === mojeId;
  return r.status === "waiting_for_customer" || r.status === "waiting_for_internal"
    || r.status === "snoozed";
}

/* Kolejka pokazuje moment ostatniej synchronizacji, bo pusta lista o 9:00
   znaczy co innego, gdy synchronizator stanął o 6:00, a co innego, gdy
   przebiegł minutę temu. Bez tej daty ekran kłamałby ciszą. */
export function Kolejka({ rozmowy, stan, copilot, klasyfikacja, onRozpoznaj = () => {},
  wybranaId, mojeId = null, onWybierz, onOdswiez, laduje, nieswieza }: {
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
  onOdswiez: () => void;
  laduje: boolean;
  /* Kolejka nieświeża wygląda inaczej, bo znaczy co innego. Pusta lista przy
     stojącym synchronizatorze to nie „brak pytań", tylko „nie wiem". */
  nieswieza?: boolean;
}) {
  const [kubelek, setKubelek] = useState<Kubelek>("wszystkie");
  /* Filtr kategorii jest DRUGIM sitem, nałożonym na kubełek, a nie trzecim
     rzędem kubełków: kubełek mówi „czyje to", kategoria — „o czym to". Zlanie
     tego w jedną listę zmusiłoby agenta do wyboru między dwoma pytaniami,
     na które odpowiada naraz. */
  const [kategoria, setKategoria] = useState<Kategoria | null>(null);
  /* ── Szukanie w kolejce (0.195.0) ──────────────────────────────────────────
     Zwroty mają wyszukiwarkę od 0.165.0, skrzynka nie miała żadnej: kubełek
     mówi „czyje to", kategoria „o czym to", a pytania „czy TA rozmowa gdzieś
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
  const poKategorii = kategoria === null ? wKubelkuTeraz
    : wKubelkuTeraz.filter((r) => r.kopilot?.kategoria === kategoria);
  /* Szukamy po LOGINIE i po TREŚCI. Login, bo tak się wraca do znanej sprawy;
     treść, bo tak się szuka sprawy, której loginu nikt nie pamięta. Właściciel
     rozmowy dochodzi trzeci: „co ma Ola" jest pytaniem zadawanym na głos. */
  const widoczne = szukane === "" ? poKategorii : poKategorii.filter((r) =>
    r.klient.toLowerCase().includes(szukane)
    || r.ostatniaWiadomosc.toLowerCase().includes(szukane)
    || (r.wlasciciel ?? "").toLowerCase().includes(szukane));

  /* Skład kubełka JEDNYM SPOJRZENIEM (dekalog ergonomii, punkt 1: informacja
     w miejscu, gdzie zapada decyzja). Liczniki liczą się z tego, co widać —
     serwer nie musi ich podawać, bo lista i tak przyjeżdża w całości. */
  const liczniki = new Map<Kategoria, number>();
  for (const r of wKubelkuTeraz) {
    if (!r.kopilot || r.kopilot.nieaktualna) continue;
    liczniki.set(r.kopilot.kategoria, (liczniki.get(r.kopilot.kategoria) ?? 0) + 1);
  }
  const wgLiczby = [...liczniki.entries()].sort((a, b) => b[1] - a[1]);
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
      <ZnakCopilota stan={copilot} kandydaci={doRozpoznania(wKubelkuTeraz)} />
      {nieswieza && <span className="rounded bg-red-100 px-1.5 py-0.5 text-podpis font-bold text-ranga-zle">
        STAN Z {czas(stan.ostatniaSynchronizacja).slice(-8, -3) || "—"}</span>}
      <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onOdswiez}
        title="Odśwież" aria-label="Odśwież"><RefreshCw size={16} /></button>
    </header>
    {/* ── CEL KLIKALNY MA 24 px, A ZA WYSOKOŚĆ PŁACI PASMO (0.255.0) ─────────
        0.251.0 ścisnęło pigułki z `py-1` do `py-0.5`, żeby odzyskać wysokość
        dla listy pytań. Zmierzone: dało to cele 20 px przy progu 24×24 z WCAG
        2.2 AA (2.5.8). Odzyskane piksele nie były moje do wzięcia.

        Pigułka wraca na `py-1`, a rachunek pokrywa własne wypełnienie pasma:
        `py-1.5` → `py-1`. Kubełki zawijają się na dwa rzędy przy kolumnie
        400 px, więc pigułki kosztują +8 px, a pasmo oddaje 4 px. Netto +4 px
        chromu — cena, której próg dostępności jest wart. */}
    <div className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-1">
      {KUBELKI.map((k) => <button key={k.klucz} type="button" onClick={() => setKubelek(k.klucz)}
        aria-pressed={kubelek === k.klucz}
        className={`rounded px-2 py-1 text-xs font-semibold ${kubelek === k.klucz
          ? "bg-wertis-ink text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
        {k.etykieta} <span className="font-normal">
          {rozmowy.filter((r) => wKubelku(r, k.klucz, mojeId)).length}</span></button>)}
    </div>
    {/* Pole stoi POD kubełkami, nie nad nimi: kubełek wybiera się raz na
        wejście, a szuka się w środku tego, co się wybrało. Kolejność obok
        pola, w tym samym paśmie: to trzecie sito na tę samą listę, a osobny
        rząd zjadałby wysokość kolumny, która ma pokazywać PYTANIA. */}
    <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
      <div className="relative min-w-0 flex-1">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={fraza} onChange={(e) => setFraza(e.target.value)}
          aria-label="Szukaj w rozmowach"
          placeholder="Szukaj: login, treść, prowadzący"
          className="field w-full py-1 pl-7 pr-7 text-sm" />
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
    </div>
    <PasekCopilota stan={copilot} kandydaci={doRozpoznania(wKubelkuTeraz)}
      trwa={klasyfikacja?.trwa} wynik={klasyfikacja?.wynik} blad={klasyfikacja?.blad}
      onRozpoznaj={onRozpoznaj} />
    {/* Pasek liczników zamiast PRZESTAWIANIA kolejki i to jest decyzja.
        Dzisiejsze klucze kolejności — ręczna flaga „pilne" i czas oczekiwania
        klienta — są FAKTAMI; kategoria jest przypuszczeniem maszyny, a jedna
        pomyłka klasyfikatora zakopałaby prawdziwe pytanie na dole listy tak,
        że nikt by tego nie zauważył. Agent widzi skład skrzynki i sam wybiera,
        co bierze. Regułę kolejności wolno dołożyć dopiero wtedy, gdy pomiar
        trafności ją uzasadni (etap G). */}
    {wgLiczby.length > 0 && <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1 text-podpis">
      {wgLiczby.map(([k, ile]) => <button key={k} type="button"
        aria-pressed={kategoria === k}
        onClick={() => setKategoria(kategoria === k ? null : k)}
        className={`rounded px-1.5 py-0.5 font-semibold ${kategoria === k
          ? "bg-violet-700 text-white" : "bg-violet-50 text-violet-800 hover:bg-violet-100"}`}>
        {NAZWA_KATEGORII[k]} <span className="font-normal">{ile}</span></button>)}
      {kategoria !== null && <button type="button" className="ml-auto text-slate-500 underline"
        onClick={() => setKategoria(null)}>pokaż wszystkie</button>}
    </div>}
    <div className={`min-h-0 flex-1 overflow-y-auto ${nieswieza ? "opacity-60" : ""}`}>
      {laduje && <p className="p-4 text-sm text-slate-500">Wczytuję…</p>}
      {!laduje && !rozmowy.length &&
        <p className="p-4 text-sm text-slate-500">Brak rozmów w zsynchronizowanej skrzynce.</p>}
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
        <p className="p-4 text-sm text-slate-500">
          Nic nie pasuje do „{fraza.trim()}" w tym kubełku.{" "}
          <button type="button" className="underline" onClick={() => setFraza("")}>
            Wyczyść szukanie</button></p>}
      {!laduje && rozmowy.length > 0 && !widoczne.length && szukane === "" && kategoria !== null &&
        <p className="p-4 text-sm text-slate-500">
          Nic w kategorii „{NAZWA_KATEGORII[kategoria]}" w tym kubełku.</p>}
      {!laduje && rozmowy.length > 0 && !widoczne.length && szukane === "" && kategoria === null &&
        <p className="p-4 text-sm text-slate-500">Ten kubełek jest pusty — zajrzyj do „Wszystkie".</p>}
      {widoczne.map((r) => {
        /* ── ZEGAR MIERZY NASZ DŁUG, NIE WIEK ROZMOWY (0.251.0) ───────────
           `czekaOdMs` liczy się od ostatniej wiadomości KLIENTA. Przy statusie
           „Czeka na klienta" znaczy to, że odpisaliśmy — a wiersz i tak pisał
           „czeka 15 g", czyli mierzył czas komuś, kto na nic nie czeka. Słowo
           „czeka" musi być prawdziwe, bo po nim układa się kolejność pracy
           (§10.2) i po nim serwer sortuje domyślną listę. */
        const zegar = NASZ_RUCH.has(r.status) ? r.czekaOdMs : null;
        const wyjatkowy = WYJATKOWE.has(r.status);
        const glosne = r.priorytet === "pilny" || wyjatkowy;
        return <button key={r.id} onClick={() => onWybierz(r.id)}
          aria-current={wybranaId === r.id}
          className={`block w-full border-b px-4 py-3 text-left hover:bg-slate-50 ${
            wybranaId === r.id ? "border-l-[3px] border-l-wertis-amber bg-amber-50" : ""}`}>
          {/* ── CO CZYTA SIĘ PIERWSZE (0.193.0, doprecyzowane w 0.251.0) ────
              0.193.0 oddało pierwszy plan TREŚCI: login Allegro nie mówi nic,
              a triaż robi się po pytaniu. Ta decyzja zostaje. Zepsuł ją górny
              rząd plakietek: nad treścią stał status, czyli słowo, które
              w kubełku roboczym powtarza się w KAŻDYM wierszu. Emfaza wydana
              na stałą nie rozróżnia niczego, a innej już nie zostaje.

              Górny rząd pojawia się więc tylko wtedy, gdy niesie WYJĄTEK:
              ręczną flagę „pilne" albo status, którego z reszty wiersza nie
              da się odczytać. Zwykły wiersz zaczyna się od pytania klienta. */}
          {glosne && <div className="mb-1.5 flex items-center gap-2">
            {/* PILNE przed statusem: „co się pali" czyta się przed „co z tym
                zrobiono". Flagę stawia człowiek — patrz `ustawPriorytet`. */}
            {r.priorytet === "pilny" &&
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-podpis font-bold text-ranga-zle">
                PILNE</span>}
            {wyjatkowy && <Plakietka status={r.status}>{NAZWA[r.status]}</Plakietka>}
          </div>}
          {/* Podgląd to słowa KLIENTA (0.166.0). Gdy klient nic nie napisał, stoi
              nasza wiadomość — ale z podpisem, bo bez niego czytałoby się ją jak
              pytanie. Autoodpowiedź konta Allegro wyglądała tak przez pół roku. */}
          <p className="line-clamp-2 text-tresc font-medium text-slate-800">
            {/* KROPKA, NIE SŁOWO (0.193.0). Stało tu „NOWE", a obok, w plakietce
                statusu, „NOWA" — dwa różne fakty jednym wyrazem. Kropka to znak
                nieprzeczytanego znany ze wszystkich skrzynek; nazwę niesie
                `title` i tekst dla czytnika ekranu.

                Od 0.251.0 stoi PRZED pierwszym słowem podglądu, a nie w rzędzie
                plakietek: rząd znika na zwykłym wierszu, a znak nieprzeczytanego
                należy do miejsca, w którym wzrok wchodzi w wiersz. */}
            {r.nieprzeczytana && <span title="Nieprzeczytana wiadomość"
              className="mr-1.5 inline-block h-2 w-2 rounded-full bg-wertis-amber align-middle">
              <span className="sr-only">NOWE</span></span>}
            {!r.ostatniaOdKlienta && r.ostatniaWiadomosc &&
              <span className="font-semibold text-slate-500">Biuro: </span>}
            {r.ostatniaWiadomosc}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-podpis text-slate-500">
            {/* Czas OCZEKIWANIA, nie data: „czeka 2 g" odpowiada na pytanie
                „za co się wziąć", a data każe je dopiero policzyć w głowie.
                Otwiera podpis, bo to jedyna liczba w wierszu, po której układa
                się kolejność pracy — i jedyna, która wiersze RÓŻNI. */}
            {zegar !== null && <span className={`shrink-0 text-xs font-bold tabular-nums ${
              r.poTerminie ? "text-ranga-zle" : "text-wertis-ink"}`}>
              czeka {czekaOd(zegar)}</span>}
            {/* Status bez plakietki nie znika — schodzi do podpisu. §4.3: fakt
                wolno wyciszyć, nie wolno schować. Milczy tylko tam, gdzie zegar
                mówi to samo innymi słowami. */}
            {zegar === null && !wyjatkowy &&
              <span className="shrink-0 text-slate-500">{NAZWA[r.status]}</span>}
            <span className="font-semibold text-slate-500">{r.klient}</span>
            {/* Data ustępuje ZEGAROWI (0.251.0). Przy „czeka na nas" oba znaczniki
                mierzą TĘ SAMĄ wiadomość, więc data była drugim zapisem jednego
                faktu — i to gorszym, bo z sekundami. Gdy zegara nie ma, data
                zostaje jedynym czasem w wierszu i wraca. */}
            {zegar === null && <span>{czas(r.ostatniaWiadomoscAt)}</span>}
            {/* Liczba DOPISKÓW klienta od naszej odpowiedzi. Nie nazywamy jej
                „nieprzeczytane": tego Allegro nie podaje, a ekran nie ma prawa
                obiecywać pomiaru, którego nie robi. */}
            {r.nowychOdOdpowiedzi > 1 &&
              <span className="font-semibold text-slate-600">
                {r.nowychOdOdpowiedzi} dopiski klienta</span>}
            {r.zadanieWToku && <span className="flex items-center gap-1 font-semibold text-slate-600">
              <Ruler size={12} />zadanie w toku</span>}
            {/* Status DOBORU (§10.2, E1). `not_started` i `not_applicable` milczą:
                plakietka „nierozpoczęty" na każdym wierszu nie mówiłaby niczego,
                a „nie dotyczy" to wiersz, przy którym doboru NIE trzeba robić. */}
            {r.dobor !== "not_started" && r.dobor !== "not_applicable" &&
              <span className={`flex items-center gap-1 font-semibold ${
                r.dobor === "confirmed" ? "text-emerald-700"
                  : r.dobor === "missing_information" ? "text-ranga-zle" : "text-amber-700"}`}>
                <Wrench size={12} />{NAZWA_DOBORU[r.dobor]}</span>}
            {/* Plakietka Copilota PO statusie doboru: dobór jest faktem
                zapisanym przez człowieka, kategoria — przypuszczeniem maszyny,
                a kolejność na wierszu ma odpowiadać wadze. */}
            {r.kopilot && <PlakietkaKategorii kopilot={r.kopilot} />}
            {r.wlasciciel && <span className="flex items-center gap-1 font-semibold text-slate-600">
              <UserCheck size={12} />{r.wlasciciel}</span>}
            {r.poTerminie && <span className="flex items-center gap-1 font-bold text-ranga-uwaga">
              <AlarmClock size={12} />po terminie</span>}
            {/* Kolega SIEDZI przy tym pytaniu (0.159.0). Bez tego znaku dwóch
                agentów pisze tę samą odpowiedź, a dowiadują się o tym dopiero
                przy wysyłce — czyli po straconej pracy. */}
            {r.oglada && r.oglada.userId !== mojeId &&
              <span className="flex items-center gap-1 font-semibold text-violet-700">
                <Eye size={12} />{r.oglada.name}</span>}
          </div>
        </button>;
      })}
      {nieswieza && <p className="border-t bg-red-50 px-4 py-2 text-xs text-red-800">
        Dalsze wiersze mogą istnieć w Allegro i nie zostały jeszcze pobrane.</p>}
    </div>
  </section>;
}
