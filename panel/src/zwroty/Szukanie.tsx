import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, ScanLine, Search, UserSearch, X } from "lucide-react";
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

export function Szukanie({
  wynik, kod, fraza, szuka, dociaga, blad, ile,
  paczki = null, szukaPaczek = false, pytaAllegro = false, bladAllegro = "",
  synchronizuje = false, bladSync = "", towar = null,
  onFraza, onSzukaj, onSkan, onDociagnij, onWybierz, onLogin, onSynchronizuj,
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
  /**
   * Kod, który przyszedł SERIĄ CZYTNIKA, a nie ręką (0.468.0). Ekran sam
   * rozstrzyga, czy to etykieta, czy EAN towaru. Enter po wpisaniu ręką
   * dalej tylko szuka — człowiek, który przepisuje cyfry, pyta o zwrot.
   */
  onSkan?: (kod: string) => void;
  /** Co zrobił ostatni skan towaru — jedno zdanie albo odmowa. */
  towar?: { tekst: string; blad: boolean } | null;
  onDociagnij: (kod: string) => void;
  onWybierz: (id: number) => void;
  /** Paczki z historii tego klienta; `null` = jeszcze o nie nie pytano. */
  paczki?: PaczkaKlienta[] | null;
  szukaPaczek?: boolean;
  /**
   * Prośba o paczki klienta — wysyłana po dopisaniu uchwytu, nie z każdego
   * znaku. Brak = ekran nie proponuje szukania paczek wcale.
   */
  onLogin?: (szukane: string) => void;
  /** Allegro właśnie szuka zamówień tego loginu (0.450.0). */
  pytaAllegro?: boolean;
  /** Odmowa Allegro całym zdaniem; lista z naszej bazy stoi mimo niej. */
  bladAllegro?: string;
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
  /* ── REJESTRACJI PACZKI JUŻ NIE MA (0.451.0) ─────────────────────────
     Decyzja właściciela: „usuń opcję rejestracji paczki — ja tylko wyszukuję
     ją w Allegro". Od 0.172.0 formularz zakładał tu zwrot od zera: numer
     listu, zamówienie, przewoźnik, notatka. Biuro z niego nie korzystało,
     a sześć pól zasłaniało jedno, po które przychodziło — login.

     Zostaje SAMO SZUKANIE. Wynik prowadzi do zamówienia w panelu Allegro,
     bo tam ta praca się kończy. Zwroty zarejestrowane wcześniej zostają
     i dalej noszą znacznik „nieodebrana" — ich nikt nie wycofuje. */
  const [szukaKlienta, setSzukaKlienta] = useState(false);
  /* JEDNO POLE NA UCHWYT CZŁOWIEKA (0.367.0): login, nazwisko z naklejki albo
     telefon. Zasady dopasowania rozstrzyga serwer, nie operator. */
  const [kto, setKto] = useState("");
  const brak = wynik?.trafienie === null;
  const wiele = wynik?.trafienie === "wiele";
  /* NIEZNANY KOD OTWIERA SZUKANIE PO KLIENCIE (0.479.0). Przegląd
     zwrotów z 23 września: po chybionym skanie operator i tak klikał „Szukaj
     po kliencie" — przy nieodebranej paczce numer z naklejki nie trafia
     z definicji (0.367.0), a login albo nazwisko tak. Klik, który zawsze
     następuje, to klik do zdjęcia. Kluczem jest WYNIK, nie `brak`: każdy
     kolejny chybiony skan otwiera pole od nowa, także po Escape. Następny
     skan etykiety w tym polu i tak rozpoznaje nasłuch ekranu (0.468.0). */
  useEffect(() => {
    if (brak && onLogin) setSzukaKlienta(true);
  }, [wynik]); // eslint-disable-line react-hooks/exhaustive-deps

  const panelKlienta = onLogin
    ? <div className="mt-2 rounded-lg border border-sky-200 bg-white p-2 text-xs">
        {/* ── KTO TO: LOGIN, NAZWISKO Z NAKLEJKI ALBO TELEFON (0.367.0) ──────
            Zgłoszenie właściciela: „szukanie nieodebranych paczek odbywa się
            głównie za pomocą loginu użytkownika i innych informacji na
            przesyłce". JEDNO POLE NA TRZY, bo człowiek przepisuje to, co widzi,
            a nie to, co system woli. Login dopasowuje się w całości, nazwisko
            po fragmencie, telefon po końcówce cyfr — rozstrzyga serwer.

            AUTOFOCUS, bo to pole jest jedynym powodem otwarcia tego panelu. */}
        <input className="field h-7 text-xs" value={kto} autoFocus
          aria-label="Login, nazwisko albo telefon"
          placeholder="Login klienta, nazwisko z naklejki albo telefon"
          onChange={(e) => setKto(e.target.value)}
          /* PYTAMY PO DOPISANIU UCHWYTU, nie po każdym znaku (0.365.0). Enter
             i wyjście z pola to dwa ruchy, które operator i tak wykonuje —
             a zapytanie na znak byłoby dwunastoma odczytami na jedno nazwisko,
             i dwunastoma wpisami w dzienniku odczytów cudzych danych. */
          onBlur={() => onLogin(kto.trim())}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setSzukaKlienta(false); return; }
            if (e.key !== "Enter") return;
            e.preventDefault();
            onLogin(kto.trim());
          }} />
        <p className="mt-1 text-slate-500">
          Enter pokaże zamówienia tego klienta. Login sprawdzam też w Allegro,
          więc znajdę zamówienie, którego u nas jeszcze nie było.</p>
        {/* „Szukam" trwa, DOPÓKI pyta którakolwiek strona. Pusta lista
            z naszej bazy pokazana w trakcie pytania do Allegro mówiłaby „nie
            ma", a sekundę później lista by się pojawiła — czyli ekran
            skłamałby dokładnie w chwili, w której operator czyta. */}
        {(szukaPaczek || pytaAllegro) && <p className="mt-1 text-slate-500">
          {pytaAllegro ? "Szukam paczek, pytam też Allegro…" : "Szukam paczek…"}</p>}
        {bladAllegro && <p className="mt-1 text-red-700">
          Allegro nie odpowiedziało: {bladAllegro} Pokazuję to, co mamy u siebie.</p>}
        {paczki !== null && !szukaPaczek && !pytaAllegro && (paczki.length === 0
          ? <p className="mt-1 text-slate-500">
              Nie mam paczek tego klienta — ani u nas, ani pod tym loginem
              w Allegro. Allegro szuka wyłącznie po pełnym loginie.</p>
          : <ul className="mt-2 space-y-1">
              {paczki.map((k) => {
                /* CAŁY WIERSZ JEST ODNOŚNIKIEM do zamówienia w panelu Allegro
                   (0.451.0). Do tego wydania klik wpisywał numer do
                   rejestracji; rejestracja odeszła, a praca kończy się na
                   stronie zamówienia. Bez skonfigurowanego adresu wiersz
                   zostaje samym opisem — link donikąd jest gorszy od braku. */
                const tresc = <>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <b className="inline-flex items-center gap-1 font-mono">{k.orderId}
                        {k.link && <ExternalLink size={11} className="text-sky-700" />}</b>
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
                    {/* ── ADRES W WIERSZU (0.422.0) ──────────────────────────
                        Sama nazwa nie wystarczała: dwaj Kowalscy z jednego
                        miasta wyglądali w tej liście identycznie, a z tego
                        ekranu wychodzi się z czyimś numerem zamówienia w ręku.
                        ULICA rozstrzyga, miasto samo nie. Telefon stoi obok,
                        bo to po nim się tu teraz szuka — agent widzi, czy
                        trafił w numer, który podał klient. */}
                    {(k.odbiorcaUlica || k.odbiorcaMiasto || k.odbiorcaTelefon) &&
                      <span className="mt-0.5 block truncate text-slate-600">
                        {[k.odbiorcaUlica,
                          [k.odbiorcaKod, k.odbiorcaMiasto].filter(Boolean).join(" "),
                          k.odbiorcaTelefon].filter(Boolean).join(" · ")}
                      </span>}
                    <span className="mt-0.5 block truncate text-slate-600">{k.zawartosc}</span>
                </>;
                const klasa = "block w-full rounded border border-slate-200 p-1.5 text-left text-xs";
                return <li key={k.orderId}>
                  {k.link
                    ? <a href={k.link} target="_blank" rel="noopener noreferrer"
                        title="Otwórz zamówienie w Allegro"
                        className={`${klasa} hover:border-sky-300 hover:bg-sky-50`}>{tresc}</a>
                    : <div className={klasa}>{tresc}</div>}
                </li>;
              })}
            </ul>)}
        <button type="button" className="mt-2 text-slate-500 underline underline-offset-2"
          onClick={() => { setSzukaKlienta(false); setKto(""); }}>Zamknij</button>
      </div>
    : null;

  return <div className="shrink-0 border-b border-slate-200 p-2">
    <div className="flex items-center gap-2">
      <ScanLine size={16} className="shrink-0 text-slate-400" />
      <div className="relative flex min-w-0 flex-1 items-center">
      {/* `data-skan-wlasny` (0.468.0): to pole czyta czytnik samo, przez
          `SeriaWPolu`. Nasłuch ekranu je omija — dwie drogi naraz szukałyby
          tego samego kodu dwa razy. */}
      <input
        data-skan-wlasny=""
        className={`field h-8 w-full text-sm ${fraza ? "pr-8" : ""}`}
        placeholder="Zeskanuj etykietę albo szukaj: numer, login, nazwisko, przewoźnik, notatka"
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
          /* Seria czytnika idzie tą samą drogą co skan poza polem — tam ekran
             odróżnia etykietę od EAN-u towaru. */
          if (kod !== null && onSkan) { e.preventDefault(); onSkan(kod.trim()); return; }
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

      {/* DROGA PIERWSZOPLANOWA W RZĘDZIE POLA (0.338.0, przemianowana
          w 0.451.0). Stał tu przycisk NIEODEBRANA otwierający
          rejestrację paczki. Rejestracja odeszła decyzją właściciela, a z tego
          formularza biuro brało tylko jedno — szukanie klienta po loginie.
          Przycisk mówi więc wprost, co robi. */}
      {/* IKONA, NIE NAPIS (0.454.0) — zgłoszenie właściciela „ulżyj
          przeładowaniu tekstem". Obie akcje tego rzędu są codzienne i stoją
          zawsze w tym samym miejscu, więc rozpoznaje się je po ikonie; nazwa
          zostaje w podpowiedzi i w nazwie dostępnej. Pole szukania zyskuje
          szerokość, a to ono jest tu pierwszą czynnością. */}
      {onLogin && !szukaKlienta &&
        <button type="button" onClick={() => setSzukaKlienta(true)}
          aria-label="Paczki klienta"
          title="Paczki klienta — po loginie, nazwisku albo telefonie"
          className="btn-secondary h-8 w-8 shrink-0 justify-center p-0">
          <UserSearch size={16} aria-hidden="true" /></button>}

      {/* Takt zwrotów chodzi rzadko, bo zwrot ma termin w dniach. Biuro, które
          właśnie przyjęło paczkę, wie o zwrocie wcześniej niż panel. */}
      {onSynchronizuj &&
        <button type="button" disabled={synchronizuje} onClick={onSynchronizuj}
          aria-label={synchronizuje ? "Pobieram zwroty z Allegro…" : "Synchronizuj z Allegro"}
          title="Pobierz nowe zwroty z Allegro teraz"
          className="btn-secondary h-8 w-8 shrink-0 justify-center p-0">
          {/* Obrót ikony mówi „pobieram" — napis przestał być potrzebny. */}
          <RefreshCw size={16} aria-hidden="true" className={synchronizuje ? "animate-spin" : ""} /></button>}
    </div>

    {/* Skan towaru mówi, CO SIĘ STAŁO z produktem — koszyk i liczba sztuk.
        Bez tego zdania skan EAN-u wyglądałby jak skan, który nic nie zrobił. */}
    {towar && <p role="status"
      className={`mt-1 text-xs ${towar.blad ? "text-red-700" : "text-emerald-800"}`}>{towar.tekst}</p>}

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
      {/* JEDNA LINIJKA ZAMIAST AKAPITU (0.479.0). Lista pól, po których
          szukałem, stała tu przy każdym chybionym skanie, a czytało się ją
          raz. Zostaje w podpowiedzi; na ekranie zostaje to, co robić dalej. */}
      <p className="mt-1 text-amber-800"
        title={"Szukałem po numerze listu, numerze i identyfikatorze zwrotu, numerze zamówienia, "
          + "numerze korekty, loginie i nazwisku — we wszystkich kubełkach. "
          + "Paczkę nieodebraną naklejał klient albo kurier, więc tego numeru nigdy u nas nie było."}>
        {onLogin ? "Nieodebrana paczka? Szukaj po kliencie." : "Szukałem we wszystkich kubełkach."}</p>
      {/* Drugie wyjście: szukanie po kliencie. Przy nieodebranej paczce
          numer listu nie trafi nigdy, a login albo nazwisko z naklejki tak.
          Od 0.479.0 otwiera się samo; przycisk zostaje na powrót po Escape. */}
      {onLogin && !szukaKlienta &&
        <button type="button" onClick={() => setSzukaKlienta(true)}
          className="btn-secondary mt-2 inline-flex items-center gap-1 text-xs">
          <UserSearch size={12} />Szukaj po kliencie</button>}
      <button type="button" disabled={dociaga}
        onClick={() => onDociagnij(kod)}
        className="btn-secondary ml-2 mt-2 inline-flex items-center gap-1 text-xs">
        <Search size={12} />{dociaga ? "Pytam Allegro…" : "Poszukaj w Allegro"}
      </button>
    </div>}


    {szukaKlienta && panelKlienta}

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
