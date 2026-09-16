import React, { useRef, useState } from "react";
import { PackageX, RefreshCw, ScanLine, Search, X } from "lucide-react";
import { zlote, type PaczkaKlienta, type WynikSkanu } from "../api/zwroty";
import { czas } from "../ui";
import { SeriaWPolu } from "../skaner";
/* `ile` jest tu już nazwą propsa (liczba trafień), więc pomocnik wchodzi pod
   aliasem — dwie różne rzeczy o tej samej nazwie czytałoby się gorzej. */
import { ile as liczba } from "../ui";

/* ── Szukanie zwrotu: czytnikiem albo ręką (0.163.0, rozszerzone w 0.165.0) ──
   Paczka wraca do biura wcześniej niż wiedza o tym, który to zwrot. Czytnik
   USB pisze prosto w ekran (`useSkaner`), więc typowe użycie NIE WYMAGA nawet
   kliknięcia w to pole.

   Od 0.165.0 to samo pole SZUKA. Każdy wpisany znak zawęża kolejkę po
   fragmencie — bez debounce'u, bo filtr liczy się w pamięci ekranu i czekanie
   opóźniałoby to, co i tak jest natychmiastowe. Enter idzie na serwer, bo
   tylko ta droga zna numer listu przewozowego: w modelu pracy go nie ma
   i lista zwrotów w panelu też go nie niesie.

   Dwa pola na jeden kod byłyby dwoma nawykami do wyuczenia. Komunikaty mówią,
   CZEGO szukano — „nie znalazłem" bez tej informacji wygląda przy czytniku
   identycznie jak zepsuty czytnik.

   SKAN W POLU ZASTĘPUJE, NIE DOPISUJE (0.329.0). Gdy kursor stoi w tym polu,
   `useSkaner` milczy, a znaki czytnika lecą tu jak pisanie — więc druga
   zeskanowana etykieta doklejała się do pierwszej i szukanie po sklejeniu nie
   znajdowało nic. Rozpoznaje to `SeriaWPolu` tym samym podpisem czytnika,
   którego używa hook: gęsta seria dłuższa niż `MIN_DLUGOSC`.                */

/**
 * Przewoźnicy, których operator rozpoznaje z naklejki (0.367.0).
 *
 * Kody są TE SAME, co przychodzą z Allegro przy zwrotach — inaczej paczka
 * nieodebrana i zwrot od tej samej firmy byłyby w danych dwiema firmami,
 * a lista rozwijana nad kolejką pokazywałaby obie. Lista jest krótka
 * świadomie: to wybór z pudła w ręku, nie katalog branży.
 */
const PRZEWOZNICY_NAKLEJKI: Array<[string, string]> = [
  ["INPOST", "InPost / Paczkomat"],
  ["DPD", "DPD"],
  ["POCZTA", "Poczta Polska"],
  ["DHL", "DHL"],
  ["GLS", "GLS"],
  ["UPS", "UPS"],
  ["FEDEX", "FedEx"],
  ["UNKNOWN", "Inny"],
];

export function Szukanie({
  wynik, kod, fraza, szuka, dociaga, blad, ile, rejestruje = false,
  paczki = null, szukaPaczek = false, synchronizuje = false, bladSync = "",
  onFraza, onSzukaj, onDociagnij, onWybierz, onNieodebrana, onLogin, onSynchronizuj,
}: {
  wynik: WynikSkanu | null;
  kod: string;
  fraza: string;
  szuka: boolean;
  dociaga: boolean;
  blad: string;
  /** Ile zwrotów pasuje do frazy — `null`, gdy pole jest puste. */
  ile: number | null;
  onFraza: (v: string) => void;
  onSzukaj: (kod: string) => void;
  onDociagnij: (kod: string) => void;
  onWybierz: (id: number) => void;
  /** Rejestracja paczki nieodebranej; brak = ekran jej nie proponuje. */
  rejestruje?: boolean;
  onNieodebrana?: (dane: {
    waybill: string; orderId: string; notatka: string;
    login: string; odbiorcaNazwa: string; przewoznik: string;
  }) => void;
  /** Paczki z historii tego klienta; `null` = jeszcze o nie nie pytano. */
  paczki?: PaczkaKlienta[] | null;
  szukaPaczek?: boolean;
  /** Prośba o historię klienta — wysyłana po dopisaniu uchwytu, nie z każdego znaku. */
  onLogin?: (szukane: string) => void;
  /**
   * Synchronizacja z Allegro (0.370.0).
   *
   * Stała we własnym paśmie razem z filtrami przewoźnika i dat. Po ich zdjęciu
   * zostałaby sama i kosztowała CAŁE PASMO na jeden przycisk — a pasmo nad
   * listą to wiersze kolejki, bo to ona jest treścią tej kolumny (blizna
   * 0.193.0 ze skrzynki). Wchodzi więc do rzędu pola, tą samą drogą, którą
   * w audycie 15 września przeszedł przycisk NIEODEBRANA.
   */
  synchronizuje?: boolean;
  bladSync?: string;
  onSynchronizuj?: () => void;
}) {
  /* Seria żyje MIĘDZY zdarzeniami klawiszy, więc nie może być stanem: zmiana
     stanu przerysowuje ekran, a czytnik wysyła kolejny znak po kilku
     milisekundach. */
  const seria = useRef(new SeriaWPolu());
  const [nieodebrana, setNieodebrana] = useState(false);
  const [zamowienie, setZamowienie] = useState("");
  /* JEDNO POLE NA UCHWYT CZŁOWIEKA (0.367.0): login albo nazwisko z naklejki.
     Do 0.366.0 pytaliśmy o sam login, a przy paczce nieodebranej operator
     najczęściej go nie ma — ma karton, a na nim nazwisko. Dwa pola kazałyby
     mu najpierw rozstrzygnąć, czym jest to, co przepisuje; zasady dopasowania
     rozstrzyga serwer. */
  const [kto, setKto] = useState("");
  /* Co wybór z listy USTALIŁ. Trzymamy osobno od `kto`, bo w polu zostaje to,
     co człowiek wpisał — a na serwer jedzie to, co wskazał. */
  const [login, setLogin] = useState("");
  const [odbiorca, setOdbiorca] = useState("");
  const [przewoznik, setPrzewoznik] = useState("");
  const [notatka, setNotatka] = useState("");
  /* Numer listu WPISANY, gdy formularz otwarto przyciskiem, a nie po nieudanym
     skanie (0.338.0). Przy skanie numer jest już w `kod` i pola nie ma. */
  const [list, setList] = useState("");
  const brak = wynik?.trafienie === null;
  const wiele = wynik?.trafienie === "wiele";
  /* Numer listu: ze skanu, gdy formularz wyszedł z nieudanego szukania,
     a z pola, gdy operator otworzył go sam. */
  const zeSkanu = brak && Boolean(kod);
  const numerListu = (zeSkanu ? kod : list).trim();

  const formularz = onNieodebrana
    ? <div className="mt-2 rounded-lg border border-amber-300 bg-white p-2 text-xs">
        <p className="text-slate-600">
          Klient nie odebrał przesyłki i wróciła do nas. To NIE jest zwrot
          zgłoszony przez klienta — panel oznaczy ją wprost.</p>
        {zeSkanu
          ? <p className="mt-1 text-slate-500">
              Numer listu: <b className="break-all font-mono">{kod}</b></p>
          /* Bez skanu numer trzeba WPISAĆ: to jedyny uchwyt takiej paczki,
             bo Allegro nie zna zwrotu, którego klient nie zgłosił. */
          : <input className="field mt-2 h-7 text-xs" value={list} autoFocus
              aria-label="Numer listu przewozowego" placeholder="Numer listu z naklejki"
              onChange={(e) => setList(e.target.value)} />}
        <input className="field mt-2 h-7 text-xs" value={zamowienie}
          aria-label="Numer zamówienia" placeholder="Numer zamówienia (jeśli znasz)"
          onChange={(e) => setZamowienie(e.target.value)} />
        <p className="mt-1 text-slate-500">
          Z numerem zamówienia paczka dostanie pozycje i będzie co wycenić.</p>
        {/* ── KTO TO: LOGIN ALBO NAZWISKO Z NAKLEJKI (0.367.0) ───────────────
            Zgłoszenie właściciela: „szukanie nieodebranych paczek odbywa się
            głównie za pomocą loginu użytkownika i innych informacji na
            przesyłce". Login przyszedł w 0.365.0 i był połową odpowiedzi:
            przy paczce, której klient nie odebrał, operator loginu najczęściej
            NIE MA — ma karton, a na nim nazwisko i logo przewoźnika.

            JEDNO POLE NA OBA, bo człowiek przepisuje to, co widzi, a nie to,
            co system woli. Login dopasowuje się w całości, nazwisko po
            fragmencie — ale to rozstrzyga serwer, nie operator. */}
        <input className="field mt-2 h-7 text-xs" value={kto}
          aria-label="Login albo nazwisko z naklejki"
          placeholder="Login klienta albo nazwisko z naklejki"
          onChange={(e) => setKto(e.target.value)}
          /* PYTAMY PO DOPISANIU UCHWYTU, nie po każdym znaku (0.365.0). Enter
             i wyjście z pola to dwa ruchy, które operator i tak wykonuje —
             a zapytanie na znak byłoby dwunastoma odczytami na jedno nazwisko,
             i dwunastoma wpisami w dzienniku odczytów cudzych danych. */
          onBlur={() => onLogin?.(kto.trim())}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            onLogin?.(kto.trim());
          }} />
        <p className="mt-1 text-slate-500">
          Po tym znajdziesz paczkę później — szukanie zna login i nazwisko tak
          samo jak numery. Enter pokaże paczki tego klienta.</p>

        {/* ── PRZEWOŹNIK Z NAKLEJKI (0.367.0) ────────────────────────────────
            Przy paczce nieodebranej Allegro nie zna przewoźnika wcale, więc
            kolumna zostawała pusta — a operator ma logo przed oczami. Lista,
            nie pole: wybór nie wymaga pisania, a wpisane „inpost" i „InPost"
            byłyby dwiema różnymi firmami w danych. */}
        <select className="field mt-2 h-7 text-xs" value={przewoznik}
          aria-label="Przewoźnik" onChange={(e) => setPrzewoznik(e.target.value)}>
          <option value="">Przewoźnik z naklejki (jeśli widzisz)</option>
          {PRZEWOZNICY_NAKLEJKI.map(([kod, nazwa]) =>
            <option key={kod} value={kod}>{nazwa}</option>)}
        </select>

        {/* ── WYBÓR PACZKI Z HISTORII KLIENTA (0.365.0) ──────────────────────
            Zgłoszenie właściciela: „kupujący może mieć wiele paczek kupionych
            w historii sklepu, więc muszę mieć możliwość wybrania paczki".
            Numer zamówienia przepisywany z panelu Allegro był jedyną drogą,
            a to przepisywanie dwudziestu znaków z drugiego ekranu.

            Wybór WPISUJE numer do pola wyżej, zamiast trzymać go osobno:
            operator ma widzieć, co pojedzie na serwer, a nie ufać, że klik
            gdzieś się zapamiętał. */}
        {szukaPaczek && <p className="mt-1 text-slate-500">Szukam paczek…</p>}
        {paczki !== null && !szukaPaczek && (paczki.length === 0
          ? <p className="mt-1 text-slate-500">
              Nie mam paczek tego klienta. Numer zamówienia wpisz ręcznie —
              albo zostaw puste, paczka i tak się zarejestruje.</p>
          : <ul className="mt-2 space-y-1">
              {paczki.map((k) => {
                const wybrana = k.orderId === zamowienie;
                return <li key={k.orderId}>
                  {/* Klik USTALA trzy rzeczy naraz (0.367.0): numer zamówienia,
                      login i nazwę odbiorcy. Do 0.366.0 wpisywał sam numer,
                      a login jechał z pola — więc paczka wskazana po nazwisku
                      zapisywała się bez loginu, choć serwer go właśnie podał. */}
                  <button type="button" onClick={() => {
                    setZamowienie(k.orderId);
                    setOdbiorca(k.odbiorcaNazwa ?? "");
                    setLogin(k.kupujacyLogin ?? "");
                  }}
                    className={`w-full rounded border p-1.5 text-left text-xs ${wybrana
                      ? "border-sky-400 bg-sky-50 text-sky-900"
                      : "border-slate-200 hover:bg-slate-50"}`}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <b className="font-mono">{k.orderId}</b>
                      <span className="text-slate-500">{czas(k.kupionoAt)}</span>
                      <span className="tabular-nums">{zlote(k.sumaGrosze, k.waluta)}</span>
                      {/* Zwrot na tym zamówieniu NIE blokuje: jedno zamówienie
                          bywa dwiema paczkami. Ale to jest ostrzeżenie, którego
                          operator sam by nie miał. */}
                      {k.maZwrot && <span className="text-amber-700">ma już zwrot</span>}
                      {/* Nazwa odbiorcy stoi na wierszu, bo fragment nazwiska
                          POKAŻE cudze zakupy, gdy dwoje ludzi nazywa się tak
                          samo. To jest cena szukania po fragmencie i dlatego
                          wybiera człowiek, patrząc na wszystkie trafienia. */}
                      {k.odbiorcaNazwa &&
                        <span className="text-slate-600">{k.odbiorcaNazwa}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-slate-600">{k.zawartosc}</span>
                  </button>
                </li>;
              })}
            </ul>)}
        <input className="field mt-2 h-7 text-xs" value={notatka}
          aria-label="Notatka" placeholder="Notatka, np. awizo dwa razy"
          onChange={(e) => setNotatka(e.target.value)} />
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={rejestruje || !numerListu}
            /* Uchwyt z pola idzie jako LOGIN, gdy nic go nie ustaliło. Serwer
               i tak przytnie go i zapisze do kolumny, a fałszywy login przy
               paczce nieodebranej jest mniej szkodliwy niż brak uchwytu:
               szukanie porównuje obie kolumny tak samo. */
            onClick={() => onNieodebrana({
              waybill: numerListu, orderId: zamowienie.trim(), notatka: notatka.trim(),
              login: (login || kto).trim(), odbiorcaNazwa: odbiorca.trim(),
              przewoznik,
            })}
            className="btn-primary text-xs">
            {rejestruje ? "Rejestruję…" : "Zarejestruj paczkę"}</button>
          <button type="button" className="btn-secondary text-xs"
            onClick={() => {
              setNieodebrana(false); setList(""); setKto("");
              setLogin(""); setOdbiorca(""); setPrzewoznik("");
            }}>Wróć</button>
        </div>
      </div>
    : null;

  return <div className="shrink-0 border-b border-slate-200 p-2">
    <div className="flex items-center gap-2">
      <ScanLine size={16} className="shrink-0 text-slate-400" />
      <div className="relative flex min-w-0 flex-1 items-center">
      <input
        className={`field h-8 w-full text-sm ${fraza ? "pr-8" : ""}`}
        placeholder="Zeskanuj etykietę albo szukaj: numer, login, nazwisko, przewoźnik"
        value={fraza}
        onChange={(e) => onFraza(e.target.value)}
        onKeyDown={(e) => {
          /* ESC ODDAJE KLAWISZE EKRANOWI (audyt zwrotów, 15 września 2026).
             Skróty milkną, gdy kursor stoi w polu — i słusznie — ale z pola
             nie było wyjścia bez myszy. Na nagraniu z biura `P` po skanie nie
             działało, a zwrot przyjmowało kliknięcie. Treść zostaje. */
          if (e.key === "Escape") { seria.current.przerwij(); e.currentTarget.blur(); return; }
          const { podmien, kod } = seria.current.klawisz(e, fraza);
          /* Podmiana zjada znak i wstawia SAMĄ serię — inaczej szósty znak
             kodu doleciałby jeszcze do starej treści. */
          if (podmien !== null) { e.preventDefault(); onFraza(podmien); return; }
          if (e.key !== "Enter") return;
          const v = (kod ?? fraza).trim();
          if (!v) return;
          /* Pole pokazuje to, po czym naprawdę szukamy. Zostawienie w nim
             sklejenia kazałoby operatorowi zgadywać, czego dotyczy wynik. */
          if (v !== fraza) onFraza(v);
          onSzukaj(v);
        }}
      />
      {/* Bez krzyżyka powrót do kubełka znaczy kasowanie znak po znaku —
          a przy dwudziestoczteroznakowej etykiecie to osobna czynność. */}
      {fraza && <button type="button" onClick={() => { seria.current.przerwij(); onFraza(""); }}
        aria-label="Wyczyść szukanie"
        className="absolute right-2 rounded p-0.5 text-slate-400 hover:bg-slate-100">
        <X size={14} /></button>}
      </div>
      {szuka && <span className="shrink-0 text-xs text-slate-500">Szukam…</span>}

      {/* DROGA PIERWSZOPLANOWA, TERAZ W RZĘDZIE POLA (0.338.0; audyt, 15
          września 2026). Zgłoszenie właściciela: „jest sporo paczek, które po
          prostu zostały nieodebrane i wracają do nas — znajdź sposób, aby
          wyświetlały mi się w zakładce zwroty". Wyświetlały się od 0.172.0 —
          tylko DROGA DO NICH szła przez ślepy zaułek: trzeba było najpierw
          zeskanować kod, dostać „nie znam kodu" i dopiero wtedy zobaczyć
          przycisk.

          Front zostaje, schodzi tylko z własnego wiersza: stał pod polem
          i kosztował 35 px kolumny kolejki na stałe. Etykieta krótsza, pełne
          zdanie w `title` — przycisk dalej widać bez skanowania czegokolwiek,
          a to było w tamtym zgłoszeniu całą rzeczą. */}
      {onNieodebrana && !nieodebrana && !brak &&
        <button type="button" onClick={() => setNieodebrana(true)}
          title="Paczka nieodebrana — klient nie zgłosił zwrotu, przesyłka wróciła sama"
          className="btn-secondary h-8 shrink-0 gap-1 px-2 text-xs">
          <PackageX size={12} />Nieodebrana</button>}

      {/* Takt zwrotów chodzi rzadko, bo zwrot ma termin w dniach. Biuro, które
          właśnie przyjęło paczkę, wie o zwrocie wcześniej niż panel. */}
      {onSynchronizuj &&
        <button type="button" disabled={synchronizuje} onClick={onSynchronizuj}
          title="Pobierz nowe zwroty z Allegro teraz"
          className="btn-secondary h-8 shrink-0 gap-1 px-2 text-xs">
          <RefreshCw size={12} className={synchronizuje ? "animate-spin" : ""} />
          {synchronizuje ? "Pobieram…" : "Synchronizuj"}</button>}
    </div>

    {/* Odmowa Allegro CAŁYM zdaniem: mówi, co naprawić — token, uprawnienie,
        przerwę — a sam kod HTTP nie mówi nic. */}
    {bladSync && <p className="mt-1 text-xs text-red-700">{bladSync}</p>}

    {/* Filtr PRZEBIJA kubełek, więc ekran musi to powiedzieć. Inaczej wynik
        z kubełka ZAMKNIĘTE wyglądałby jak zwrot czekający na pracę. */}
    {ile !== null && <p className="mt-1 text-xs text-slate-500">
      {ile
        ? `${liczba(ile, "zwrot pasuje", "zwroty pasują", "zwrotów pasuje")} — szukam po wszystkich kubełkach.`
        /* Podpowiedź o spacji stoi PRZY ZERZE, nie nad polem: przy trafieniu
           byłaby szumem, a dokładnie tu człowiek zastanawia się, co dalej. */
        : "Żaden zwrot nie pasuje. Spacja zawęża dalej („nazwisko inpost”), Enter pyta o numer listu."}
    </p>}

    {/* Kod pokazujemy przy KAŻDYM wyniku: operator ma widzieć, co czytnik
        naprawdę wpisał, gdy naklejka jest pomięta albo skan urwany. */}
    {brak && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      <p>Nie znam kodu <b className="break-all font-mono">{kod}</b>.</p>
      {/* ── KOLEJNOŚĆ ODWRÓCONA W 0.367.0 ───────────────────────────────────
          Do 0.366.0 pierwszym wyjściem było pytanie do Allegro, a rejestracja
          stała za nim — na założeniu, że nietrafiony skan to zwykły wyścig
          synchronizacji. Właściciel to założenie obalił: paczki nakleja klient
          albo kurier i tych numerów w Allegro NIE MA. Numeru z wracającego
          kartonu nasz system nie widział nigdy i nie zobaczy, więc pierwszy
          skan takiej paczki chybia z definicji, a nie z opóźnienia.

          Pytanie do Allegro zostaje, bo etykieta zwrotna ZGŁOSZONEGO zwrotu
          wygląda tak samo i tamtą drogą się ją znajduje. Schodzi na drugie
          miejsce, nie znika. */}
      <p className="mt-1 text-amber-800">
        Szukałem po numerze listu, numerze i identyfikatorze zwrotu, numerze
        zamówienia, numerze korekty, loginie i nazwisku — we wszystkich
        kubełkach. Przy paczce, której klient nie odebrał, to normalne:
        naklejał ją klient albo kurier, więc tego numeru nigdy u nas nie było.</p>
      {onNieodebrana && !nieodebrana &&
        <button type="button" onClick={() => setNieodebrana(true)}
          className="btn-primary mt-2 inline-flex items-center gap-1 text-xs">
          <PackageX size={12} />To nieodebrana paczka</button>}
      <button type="button" disabled={dociaga}
        onClick={() => onDociagnij(kod)}
        className="btn-secondary ml-2 mt-2 inline-flex items-center gap-1 text-xs">
        <Search size={12} />{dociaga ? "Pytam Allegro…" : "Poszukaj w Allegro"}
      </button>
    </div>}


    {onNieodebrana && nieodebrana && formularz}

    {/* Dwa trafienia to brak trafienia — wybiera człowiek, patrząc na oba. */}
    {wiele && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      <p>Ten kod pasuje do {wynik.zwroty.length} zwrotów. Wskaż właściwy:</p>
      <ul className="mt-1 space-y-1">
        {wynik.zwroty.map((z) => <li key={z.id}>
          <button type="button" onClick={() => onWybierz(z.id)}
            className="font-semibold text-sky-700 underline underline-offset-2">
            {z.numer ?? z.externalId}</button>
        </li>)}
      </ul>
    </div>}

    {blad && <p className="mt-2 text-xs text-red-700">{blad}</p>}
  </div>;
}
