import React from "react";
import { Bell, Inbox, Ruler } from "lucide-react";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import type { Kategoria, OsRozmowy, SzczegolyKonfliktu, WpisOsi } from "../api/typy";
import type { Obecnosc } from "../api/zdarzenia";
import { LoginKlienta, Przycisk, Pusto } from "../ui";
import { Os } from "./Os";
import { Edytor } from "./Edytor";
import { KonfliktPrzejecia } from "./KonfliktPrzejecia";
import { BrakOferty } from "./BrakOferty";
import { Status } from "./Status";
import { EtykietaKategorii } from "./Copilot";
import { WierszMenu } from "./MenuRozmowy";
import { ProwadziZnak } from "./ProwadziZnak";
import { Obecni } from "./Obecni";

/**
 * Pytanie bez żadnego powiązania z towarem (§4.3).
 *
 * Do 0.165.0 liczyła się sama oferta. Zamówienie nazywa towar DOKŁADNIEJ niż
 * oferta (pozycje z nazwą i SKU), więc rozmowa z numerem zamówienia nie
 * dostaje bloku „brak powiązania z ofertą" — dostaje blok zamówienia.
 * Ekran dalej nie podstawia oferty zgadniętej z treści — tak wygrywały
 * kiedyś „zdemontowanym" i „Pozdrawiam".
 */
export function brakPowiazania(os: WpisOsi[],
  znane?: Pick<OsRozmowy, "zamowienie" | "oferta">): boolean {
  /* Baner mówi „nie wiemy, o co pyta", więc milknie, gdy wiemy to inną drogą
     (0.506.0). Zamówienie wskazane z kandydatów albo z numeru w treści nie
     trafia na oś jako `zamowienieId`, a prawa kolumna już je pokazuje. Runda
     krytyki złapała obie kolumny naraz: „brak powiązania" nad „Zamówił 1 ×". */
  if (znane?.zamowienie || znane?.oferta) return false;
  return os.some((w) => w.rodzaj === "wiadomosc" && w.odKlienta && !w.ofertaId && !w.zamowienieId)
    && !os.some((w) => w.ofertaId || w.zamowienieId);
}

export function Rozmowa(p: {
  dane: OsRozmowy | undefined;
  mojeId: number | null;
  /** Kto jeszcze siedzi przy tej rozmowie — stan chwilowy z szyny zdarzeń. */
  obecni: Obecnosc[];
  nowaWiadomosc: boolean;
  szkic: string;
  zapisuje: boolean;
  zrodloPomiaru: number | null;
  wskazowka: string;
  towar: Towar | null;
  onPokazNowa: () => void;
  onSzkic: (v: string) => void;
  onZapiszSzkic: () => void;
  onZrodlo: (id: number | null) => void;
  onWskazowka: (v: string) => void;
  onTowar: (t: Towar | null) => void;
  onZlec: () => void;
  wysyla: boolean;
  onWyslij: () => void;
  komentarz: string;
  onKomentarz: (v: string) => void;
  onDodajKomentarz: () => void;
  komentuje: boolean;
  agenci: Array<{ userId: number; name: string }>;
  wzmianki: number[];
  onWzmianki: (v: number[]) => void;
  /* Załączniki do odpowiedzi (0.195.0). Stan i mutacje mieszkają w
     `ekrany/Skrzynka.tsx`, jak każdy inny hak zapytania w tym panelu. */
  zalaczniki: import("../api/rozmowy").ZalacznikSzkicu[];
  dodajeZalacznik: boolean;
  bladZalacznika: string;
  onDodajZalacznik: (plik: File) => void;
  onUsunZalacznik: (id: number) => void;
  /** Szkic z Copilota (0.231.0). Stan i mutacje w `ekrany/Skrzynka.tsx`, jak reszta. */
  copilot: import("./SzkicCopilota").PropsSzkicuCopilota;
  konflikt: SzczegolyKonfliktu | null;
  mozeWymusic: boolean;
  wymusza: boolean;
  bladKonfliktu: string;
  zapisujeOferte: boolean;
  bladOferty: string;
  onZamknijKonflikt: () => void;
  onPoprosOPrzekazanie: () => void;
  onWymus: (powod: string) => void;
  onWskazOferte: (ofertaId: string) => void;
  onDopytajOOferte: () => void;
  onOtworzRozmowe: (id: number) => void;
  onPriorytet: (priorytet: "normalny" | "pilny") => void;
  zapisujePriorytet: boolean;
  /* Znacznik reklamacyjny (0.390.0) — opcjonalny, jak reszta rzeczy, których
     ten sam komponent bywa rysowany bez obsługi. */
  onReklamacyjna?: (reklamacyjna: boolean) => void;
  zapisujeReklamacyjna?: boolean;
  /* Zakończ / Otwórz ponownie (23 września 2026) — opcjonalne tym samym wzorcem. */
  onWyslijIZakoncz?: () => void;
  onZakoncz?: (mimoPytania: boolean) => void;
  onOtworz?: () => void;
  zmieniaStatus?: boolean;
  /* Etykieta człowieka o kategorii (22 września 2026, wcześniej kciuki).
     Opcjonalna, bo rozmowa bez rozpoznania nie ma czego potwierdzać — a każdy
     istniejący test tego ekranu opisuje właśnie taką rozmowę. */
  poprawia?: boolean;
  onPoprawKategorie?: (kategoria: Kategoria) => void;
  bladStatusu: string;
}) {
  /* Licznik jawnych zjazdów osi na dół (0.260.0). „Pokaż" pod banerem nowej
     wiadomości do 0.259.0 tylko odświeżał dane i nie ruszał widoku — obiecywał
     pokazanie i nie pokazywał. Licznik, nie `boolean`: dwa kliknięcia pod rząd
     mają dać dwa zjazdy. Hak stoi PRZED wczesnym `return`, bo rozmowa niewybrana
     wychodzi z tej funkcji wcześniej, a hak warunkowy to złamana zasada haków. */
  const [zjazdy, setZjazdy] = React.useState(0);

  if (!p.dane) {
    return <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <Pusto ikona={Inbox}>Wybierz rozmowę z listy</Pusto>
    </section>;
  }
  const { rozmowa, os } = p.dane;
  const moja = rozmowa.wlascicielId !== null && rozmowa.wlascicielId === p.mojeId;
  const cudza = rozmowa.wlascicielId != null && rozmowa.wlascicielId !== p.mojeId;
  const bezOferty = brakPowiazania(os, p.dane);
  const wskazanaRecznie = Boolean(p.dane.ofertaWskazana);

  return <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
    {/* `shrink-0` na wszystkim poza osią (0.180.0): po zwężeniu kolumny do
        ~700 px nagłówki zawijają się na dwie linie, a `Os` jest jedynym
        blokiem z bazą 0 — bez tych klauzul kurczyłaby się treść rozmowy,
        czyli jedyna rzecz, po którą agent tu przyszedł. */}
    {/* ── HIERARCHIĘ ROBIĄ TRZY NARZĘDZIA NARAZ (0.247.0) ─────────────────────
        Login, „Twoja rozmowa", ocena kategorii i status stały w jednym rzędzie
        w tym samym stopniu pisma i niemal tej samej wadze — cztery rzeczy
        walczyły o pierwsze spojrzenie, choć tylko jedna jest tematem ekranu.

        Login rośnie i ciemnieje, kto prowadzi — schodzi pod niego w 12 px.
        Skala urosła z dwóch stopni do czterech, a rozmiar, waga i barwa mówią
        teraz to samo, zamiast każde co innego.

        NAGŁÓWEK MA JEDEN RZĄD (0.395.0). Drugi niósł „Prowadzi nikt" i przycisk
        przejęcia; po zdjęciu przycisku zostałyby dwa słowa na całą linię, a linia
        w tej kolumnie spycha pytanie klienta niżej. Znacznik schodzi więc POD
        login, w tej samej kolumnie tytułowej, i nie zabiera własnego pasma. */}
    <header className="shrink-0 border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <LoginKlienta login={rozmowa.klient}
            className="text-naglowek font-bold tracking-tight text-wertis-ink" />
        {/* ── PRZEJĘCIE DZIEJE SIĘ SAMO (0.395.0) ────────────────────────────
            Zgłoszenie właściciela ze zrzutem: „usuń guzik przejmuję rozmowę,
            to powinno dziać się automatycznie". I dzieje się — od 0.159.0
            wysyłka odpowiedzi przypisuje rozmowę niczyją w tej samej
            transakcji, co wiadomość. Guzik prosił o kliknięcie, które i tak
            padało minutę później przy odpowiedzi.

            ZOSTAJE ZDANIE, nie sama pustka: bez niego agent po zniknięciu
            przycisku nie ma skąd wiedzieć, kiedy rozmowa stanie się jego.

            Czego to NIE daje, świadomie: mocnego zamka PRZED odpowiedzią.
            Dwóch agentów przy jednej niczyjej rozmowie rozstrzyga odtąd sam
            uchwyt obecności (§6.3) i jawna zgoda „odpowiedz mimo to" — ta
            sama droga, którą i tak trzeba było przejść, gdy kolega siedział
            przy rozmowie nieprzejętej. */}
        </div>
          {/* PROWADZĄCY ZNAKIEM (23 września 2026, „za dużo tekstu"). Zdanie
              „Prowadzi nikt — przypisze pierwsza odpowiedź" zajmowało linię
              pod loginem. Zostaje kółko: puste przerywane, gdy nikt, z inicjałem,
              gdy ktoś — a całe zdanie w dymku i dla czytnika ekranu. */}
          {/* ZNAK TYLKO PRZY WYJĄTKU (0.506.0): cudza rozmowa zmienia decyzję
              o pisaniu, więc zostaje na wierzchu. „Nikt" i „Ty" to norma — stoją
              w menu „⋯", żeby nagłówek nie powtarzał jej przy każdej rozmowie. */}
          {rozmowa.wlasciciel && !moja && <ProwadziZnak prowadzi={rozmowa.wlasciciel} ja={false} />}
      {/* Status stoi w nagłówku, nie przy edytorze: odpowiada na pytanie „co
          z tą sprawą", a nie „co napisać". Zmienić go może każdy z biura,
          także bez prowadzenia rozmowy — zamknięcie cudzej sprawy załatwionej
          w telefonie nie jest przejęciem jej. */}
      {/* Etykieta o propozycji Copilota stoi PRZY NIEJ, nie za zębatką: ocenia
          się to, na co się właśnie patrzy. Za zębatką mieszka SUMA etykiet,
          czyli pomiar — ekran pracy niesie to, co woła o reakcję (0.168.0). */}
      {/* KATEGORIA POD „⋯" (0.506.0). Pierwsze wdrożenie zostawiło na
          wierzchu samą plakietkę; runda krytyki na ekranie 1366 px pokazała, że
          łamie ona nagłówek na dwa rzędy i spycha pytanie klienta. Kategorię
          niesie już kafel wiersza w kolejce i nagłówek soczewki po prawej,
          więc tu byłaby trzecim zapisem. Poprawka została w menu. */}
        <Status rozmowa={rozmowa} blad={p.bladStatusu}
          onPriorytet={p.onPriorytet} zapisujePriorytet={p.zapisujePriorytet}
          onReklamacyjna={p.onReklamacyjna} zapisujeReklamacyjna={p.zapisujeReklamacyjna}
          onZakoncz={p.onZakoncz} onOtworz={p.onOtworz} zmieniaStatus={p.zmieniaStatus}
          menu={<>
            <WierszMenu etykieta="Prowadzi">
              <span className="text-slate-700">{rozmowa.wlasciciel
                ? (moja ? "Ty" : rozmowa.wlasciciel) : "nikt — przypisze pierwsza odpowiedź"}</span>
            </WierszMenu>
            {rozmowa.kopilot && <WierszMenu etykieta="Kategoria">
              <EtykietaKategorii kopilot={rozmowa.kopilot}
                zapisuje={p.poprawia} onPopraw={p.onPoprawKategorie ?? (() => {})} />
            </WierszMenu>}
          </>} />
      </div>

    </header>

    {/* Obecność IDZIE PRZED sprawą: „ktoś tu już siedzi" zmienia decyzję
        o pisaniu odpowiedzi, a sprawa zmienia tylko sposób czytania. */}
    <Obecni obecni={p.obecni} mojeId={p.mojeId} />

    {/* Oferta, towar i zamówienie przeniosły się do KOLUMNY KONTEKSTU
        (0.180.0). Cztery bloki jeden pod drugim spychały pytanie klienta
        poniżej krawędzi okna, a to ono jest powodem, dla którego agent tu
        przyszedł. Środkowa kolumna niesie odtąd rozmowę i nic poza nią. */}

    {p.nowaWiadomosc && <p className="flex shrink-0 items-center gap-2 border-b bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
      <Bell size={16} />Klient dopisał nową wiadomość.
      {/* Zjazd IDZIE OBOK odświeżenia, a nie zamiast niego: `onPokazNowa`
          dociąga wpis z serwera, a licznik zjeżdża oś na dół. Kolejność jest
          bez znaczenia — odpowiedź serwera dorzuci wpis i efekt „nowy wpis"
          dogoni dół po raz drugi, bo agent po tym kliknięciu już tam stoi. */}
      <button className="underline"
        onClick={() => { setZjazdy((n) => n + 1); p.onPokazNowa(); }}>Pokaż</button></p>}

    {p.konflikt && <KonfliktPrzejecia
      szczegoly={p.konflikt}
      mojaWersja={rozmowa.wersja}
      czasPrzejecia={p.konflikt.assignedAt ?? null}
      mozeWymusic={p.mozeWymusic}
      wymusza={p.wymusza}
      blad={p.bladKonfliktu}
      onZamknij={p.onZamknijKonflikt}
      onPoprosOPrzekazanie={p.onPoprosOPrzekazanie}
      onWymus={p.onWymus} />}

    {/* Wskazana ręcznie oferta ląduje na osi jako wybór agenta, więc blok
        znika dopiero wtedy, gdy oś ją zobaczy — nie zaraz po kliknięciu. */}
    {bezOferty && !wskazanaRecznie && <BrakOferty
      zapisuje={p.zapisujeOferte} blad={p.bladOferty}
      onWskaz={p.onWskazOferte} onDopytaj={p.onDopytajOOferte} />}

    {/* ── EDYTOR NA KOŃCU OSI (0.495.0) — powód w `Edytor.tsx`. ─────────────
        Formularz pomiaru jedzie tą samą drogą i stoi PRZED edytorem: zlecenie
        dla hali to zwykle krok przed odpowiedzią klientowi, nie po niej. */}
    <Os wpisy={os} rozmowaId={rozmowa.id} skokNaDol={zjazdy}
      zrodloPomiaru={p.zrodloPomiaru} mozeZlecac={!cudza}
      onZrodlo={p.onZrodlo}
      powiazanie={{ ofertaId: p.dane.oferta?.externalId ?? null,
        zamowienieId: p.dane.zamowienie?.externalId ?? null }}
      onWstawDoSzkicu={(t) => p.onSzkic(p.szkic ? `${p.szkic}\n${t}` : t)}
      koniec={<>
        {p.zrodloPomiaru && <div className="ml-auto w-full max-w-[75ch] rounded-lg border border-amber-300 bg-amber-50 p-4">
          {/* Kartoteki nie wywiedziemy dziś z oferty, więc agent może ją wskazać.
              Zadanie zapisze, że to jego wybór, a nie fakt z Allegro. */}
          <div className="mb-3">
            <div className="mb-1 text-sm font-semibold">Kartoteka dla hali
              <span className="font-normal text-slate-500"> (opcjonalnie)</span></div>
            <Wyszukiwarka wybrany={p.towar} onWybierz={p.onTowar} etykieta="Wskazana przez Ciebie" />
          </div>
          {/* ── POLECENIE JEST OBOWIĄZKOWE (0.408.0) ─────────────────────────────
              Zgłoszenie właściciela: „zadania zlecane dla magazynu mają za dużo
              informacji; powinno być tylko, jakiego produktu dotyczy zadanie — lub
              bez produktu — i co ma zrobić".

              To pole było opcjonalne, bo hala dostawała w zastępstwie CAŁY kontekst
              rozmowy: pytanie kupującego, numer oferty, zdanie o kartotece. Skoro
              kontekst zszedł z kolektora do karty zadania w biurze, pustej
              wskazówki nie ma już czym zastąpić — a zadanie bez zdania „co zrobić"
              jest nie do wykonania. Przetłumaczenie pytania klienta na polecenie
              dla hali to praca agenta, nie magazyniera w rękawicy. */}
          <label className="block text-sm font-semibold">Co ma zrobić hala
            <input className="field mt-1" value={p.wskazowka}
              onChange={(e) => p.onWskazowka(e.target.value)}
              placeholder="Np. zmierz rozstaw otworów, podaj w milimetrach" /></label>
          {/* Przycisk MARTWY przy pustym poleceniu, a nie błąd po kliknięciu:
              serwer i tak odmówi, tylko o jeden strzał i jedno zdanie później. */}
          {/* Zwykłą wielkością liter (@wydanie): wersaliki krzyczały głośniej
              niż „Wyślij do klienta" tuż pod spodem, a to wysyłka jest główna. */}
          <Przycisk wariant="glowny" className="mt-3" onClick={p.onZlec}
            disabled={!p.wskazowka.trim()}>
            <Ruler size={16} />Zleć pomiar</Przycisk>
        </div>}

        <Edytor szkic={p.szkic} cudza={cudza} wlasciciel={rozmowa.wlasciciel}
          zapisuje={p.zapisuje} wysyla={p.wysyla}
          onZmiana={p.onSzkic} onZapisz={p.onZapiszSzkic} onWyslij={p.onWyslij}
          onWyslijIZakoncz={p.onWyslijIZakoncz}
          komentarz={p.komentarz} onKomentarz={p.onKomentarz}
          onDodajKomentarz={p.onDodajKomentarz} komentuje={p.komentuje}
          agenci={p.agenci} wzmianki={p.wzmianki} onWzmianki={p.onWzmianki}
          zalaczniki={p.zalaczniki} dodajeZalacznik={p.dodajeZalacznik}
          bladZalacznika={p.bladZalacznika}
          onDodajZalacznik={p.onDodajZalacznik} onUsunZalacznik={p.onUsunZalacznik}
          copilot={p.copilot} />
      </>} />
  </section>;
}
