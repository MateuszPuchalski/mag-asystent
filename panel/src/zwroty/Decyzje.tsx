import React, { useContext, useState, type MutableRefObject } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import type { KoszZwrotow, Zwrot } from "../api/typy";
import { Przycisk, Pole, Blad, Skopiuj, dzien } from "../ui";
import { useAkcjaKlawisza, type AkcjeKlawiszy } from "./klawisze";
import { kluczeZwrotow } from "../api/zwroty";
import { szybkaSciezka } from "./regulaSzybkiej";

/* ── Pasek decyzji zwrotu (0.156.0) ──────────────────────────────────────────
   Do tego wydania klawisze z §25a.2 stały tu jako PODPISY: `kubelekZwrotu`
   routował po `werdykt`, ocenie pozycji i `kwota_grosze`, a żadnej z tych
   kolumn nic nie zapisywało. Kolejka bramek była maszyną bez paliwa.

   Trzy kubełki dostały działanie w 0.156.0, czwarty — korekta — w 0.162.0.
   Korekty NIE wystawia panel: robi to człowiek w Subiekcie, a tutaj przepisuje
   jej numer. Stąd pole tekstowe zamiast przycisku „zleć" i stąd cofnięcie
   (§25a.5): literówka w przepisanym numerze jest zdarzeniem normalnym.

   Od 0.167.0 zostają tu decyzje o CAŁYM zwrocie: werdykt, korekta, cofnięcie.
   Ocena towaru i wycena dotyczą pojedynczych pozycji, więc przeniosły się na
   wiersz produktu (`Pozycje.tsx`) — operator ocenia towar, patrząc na towar,
   a nie na jego nazwę wypisaną drugi raz obok.                              */

/**
 * Pierwsze zdanie komunikatu (0.479.0). Błąd automatu ZW bywa ścianą:
 * zrzut kilkudziesięciu pól. Pierwsze zdanie mówi, co się stało — reszta jest
 * materiałem dla serwisu i rozwija się na żądanie.
 */
export function pierwszeZdanie(tekst: string, max = 160): string {
  const m = /^.*?[.!?](\s|$)/.exec(tekst);
  const zdanie = (m ? m[0] : tekst).trim();
  return zdanie.length <= max ? zdanie : zdanie.slice(0, max - 1) + "…";
}

type Props = {
  zwrot: Zwrot;
  onWerdykt: (decyzja: "przyjety" | "odrzucony", powod: string | null) => void;
  onKorekta: (numer: string) => void;
  onCofnijKorekte: () => void;
  onCofnijKwote: () => void;
  onCofnijWerdykt: () => void;
  trwa: boolean;
  blad: string;
  /** Rejestr akcji dla klawiszy kubełka (`zwroty/klawisze.ts`). */
  akcje?: MutableRefObject<AkcjeKlawiszy>;
  /**
   * Czy klawisz `Z` odda pieniądze (0.484.7). NIEUŻYWANE od 0.516.0: zdanie
   * „albo klawiszem Z" zeszło, bo klawisz stoi na przycisku w „Pieniądzach"
   * tuż niżej. Ekran dalej je podaje; prop zejdzie przy jego następnej zmianie.
   */
  moznaZwrocic?: boolean;
};

export function Decyzje({ zwrot, onWerdykt, onKorekta, onCofnijKorekte, onCofnijKwote,
  onCofnijWerdykt, trwa, blad, akcje }: Props) {
  const [odmowa, setOdmowa] = useState(false);
  const [powod, setPowod] = useState("");
  /* PRZED gałęziami kubełków, bo to hak — a gałęzie kończą się `return`.
     Klawisz `O` otwiera pole powodu; pole samo łapie kursor (`autoFocus`). */
  useAkcjaKlawisza(akcje, "odmow", () => setOdmowa(true));
  /* `Enter` w DO KOREKTY stawia kursor w polu numeru. Po `id`, bo `Pole` nie
     przekazuje referencji — a pola poza tym kubełkiem nie ma i wołanie milczy. */
  useAkcjaKlawisza(akcje, "korekta", () => document.getElementById("numer-korekty")?.focus());
  /* Numer korekty PRZEPISUJE człowiek z Subiekta — panel go nie wywiedzie
     z niczego, bo read-model zna tylko dokumenty zakupu (FZ, PZ). */
  const [numer, setNumer] = useState("");
  /* Pudła do reguły szybkiej ścieżki — Z PAMIĘCI zapytań, nie z nowego
     zapytania. Ekran subskrybuje je sam (`useKosz`), więc tu wystarczy
     odczyt: reguła ma widzieć te same pudła co przycisk „Wszystko OK",
     inaczej przeoczy przeszkodę „kilka otwartych pudeł" i zdejmie wagę
     z „Przyjmij" dokładnie wtedy, gdy to jedyna droga. Kontekst, nie
     `useQueryClient`, bo pasek renderuje się też bez dostawcy (testy). */
  const klient = useContext(QueryClientContext);
  const pudla = klient?.getQueryData<{ kosze: KoszZwrotow[] }>(kluczeZwrotow.kosz)?.kosze ?? [];

  const ramka = "border-b border-slate-200 bg-slate-50 p-4";

  if (zwrot.kubelek === "decyzja") {
    /* JEDEN GŁÓWNY PRZYCISK NA WIDOK (0.516.0, §26d). Nad paskiem stoi
       „Wszystko OK" (`SzybkiZwrot`), też główny — dwa zielone przyciski
       jeden pod drugim każą wybierać, który jest „ten". Gdy szybka ścieżka
       jest gotowa, „Przyjmij" schodzi do drugiego rzędu; klawisz P zostaje.
       Gdy szybka ścieżka stoi z przeszkodą, „Przyjmij" zostaje główny:
       wyłączony przycisk nie jest drogą. */
    const szybka = szybkaSciezka(zwrot, pudla);
    const przyjmijGlowny = !(szybka.pokaz && szybka.przeszkoda === null);
    return <div className={ramka}>
      {!odmowa
        ? <div className="flex flex-wrap gap-2">
            <Przycisk wariant={przyjmijGlowny ? "glowny" : "drugi"} disabled={trwa}
              onClick={() => onWerdykt("przyjety", null)}>
              <kbd className={`rounded border px-1 text-xs ${przyjmijGlowny
                ? "border-black/20" : "border-slate-300"}`}>P</kbd> Przyjmij
            </Przycisk>
            <Przycisk disabled={trwa} onClick={() => setOdmowa(true)}>
              <kbd className="rounded border border-slate-300 px-1 text-xs">O</kbd> Odrzuć
            </Przycisk>
          </div>
        : <div className="space-y-2">
            {/* Odmowa jest NIEODWRACALNA (§25a.5), więc dostaje potwierdzenie
                i wymaga powodu.

                ETYKIETA MÓWI PRAWDĘ OD 0.210.0. Stało tu „zobaczy go klient" —
                i to była jedyna nieprawda na tym ekranie. Allegro nie zna
                pojęcia „odrzuć zwrot": końcówka `rejection` odmawia WYPŁATY,
                nie zwrotu. Nasz werdykt jest decyzją biura i nigdzie nie
                wychodzi, więc klient nie dowie się niczego, dopóki ktoś mu
                nie napisze. Zdanie niżej mówi, co zrobić dalej. */}
            <label className="block text-xs font-bold text-slate-600" htmlFor="powod-odmowy">
              Powód odmowy — zostaje u nas
            </label>
            <Pole id="powod-odmowy" value={powod} autoFocus
              onChange={(e) => setPowod(e.target.value)}
              /* Enter w polu POTWIERDZA. Wpisany powód jest potwierdzeniem
                 z §25a.5, a sięganie po mysz po nim nie dodaje namysłu. */
              onKeyDown={(e) => {
                if (e.key === "Enter" && !trwa && powod.trim()) onWerdykt("odrzucony", powod.trim());
              }}
              placeholder="np. towar nosi ślady użycia" />
            <div className="flex gap-2">
              <Przycisk wariant="glowny" disabled={trwa || powod.trim() === ""}
                onClick={() => onWerdykt("odrzucony", powod.trim())}>
                Potwierdź odmowę
              </Przycisk>
              <Przycisk onClick={() => { setOdmowa(false); setPowod(""); }}>Wróć</Przycisk>
            </div>
            <p className="text-xs text-slate-500">
              Klientowi trzeba powiedzieć osobno — Allegro nie zna odmowy
              zwrotu, zna tylko odmowę wypłaty. Napisz do niego w skrzynce
              albo kliknij ODMÓW WYPŁATY z kodem.
            </p>
          </div>}
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  /* DO OCENY i DO ZWROTU nie mają paska: ich pytanie zadaje wiersz produktu,
     bo dotyczy pojedynczej pozycji, a nie całego zwrotu.

     WYJĄTEK: świeżo przyjęty zwrot, w którym nikt jeszcze nic nie ocenił
     (0.204.0). Przyjęcie idzie jednym kliknięciem, bez pytania o nic, więc
     pomyłka jest zdarzeniem normalnym — a wykrywa się ją natychmiast, patrząc
     na kubełek, do którego zwrot właśnie wpadł. To jedno zdanie, nie ramka
     z decyzją: pytanie ekranu dalej zadaje wiersz produktu.

     Po pierwszej ocenie klawisz znika, bo serwer i tak by odmówił — schodzi
     się po jednym szczeblu, a ocena jest szczebel niżej. */
  /* ── PIENIĄDZE CZEKAJĄ (0.476.0) ────────────────────────────────────
     Zwrot z ustaloną kwotą wraca do DO ZWROTU, póki pieniądze nie wyjdą —
     także po korekcie, którą automat ZW wystawia minutę po kwocie. Pasek mówi,
     DLACZEGO zwrot tu stoi i ILE czasu zostało. Bez tego zdania zwrot
     z numerem korekty w kubełku „do zwrotu" wyglądałby jak usterka.

     Data jest datą automatu Allegro, a nie naszą: tego dnia pieniądze wyjdą
     same, w całości — potrącenie przepada. To jest powód, dla którego ten
     zwrot w ogóle wraca do pracy (przegląd zwrotów, 23 września 2026). */
  if (zwrot.kubelek === "zwrot" && zwrot.kwotaGrosze !== null) {
    const pobranie = zwrot.zamowienie?.platnoscTyp === "CASH_ON_DELIVERY";
    const automat = zwrot.terminAt
      ? new Date(Date.parse(zwrot.terminAt) + 86_400_000).toISOString() : null;
    /* KWOTA STOI RAZ, W „PIENIĄDZACH" (0.516.0, §26d). Ta sama liczba
       stała tu, w sekcji pieniędzy i w stopce pozycji — trzy razy na jednym
       ekranie. Zeszło też „oddaj je w Allegro albo klawiszem Z": przycisk
       z klawiszem stoi linijkę niżej, a przy pobraniu drogę mówi serwer. */
    return <div className={ramka}>
      <p className="text-xs text-slate-600">
        Pieniądze jeszcze nie wyszły.
        {zwrot.korektaNumer && <> Korekta {zwrot.korektaNumer}.</>}
        {!pobranie && automat && <> Allegro odda całość samo {dzien(automat)}, bez potrącenia.</>}
      </p>
      {/* DROGA DO POPRAWKI STOI TUTAJ (0.484.7). Sygnał „kwota?" i odmowa
          wypłaty mówiły „popraw kwotę", a w tym stanie nie było ani
          przycisku kwoty, ani cofnięcia korekty. Z korektą najpierw schodzi
          ona (`cofnijKwote` odmawia, dopóki stoi), bez niej — sama kwota. */}
      {zwrot.korektaNumer
        ? <button type="button" disabled={trwa} onClick={onCofnijKorekte}
            className="mt-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
            <kbd className="rounded border border-slate-300 px-1 no-underline">R</kbd> cofnij korektę</button>
        : <button type="button" disabled={trwa} onClick={onCofnijKwote}
            className="mt-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
            popraw kwotę</button>}
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  if (zwrot.kubelek === "ocena" || zwrot.kubelek === "zwrot") {
    const nieoceniony = zwrot.kubelek === "ocena" && zwrot.pozycje.every((p) => !p.ocena);
    if (!nieoceniony) return null;
    return <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50
      px-4 py-2 text-xs text-slate-500">
      <span>Zwrot przyjęty — oceń produkty niżej.</span>
      <button type="button" disabled={trwa} onClick={onCofnijWerdykt}
        className="underline underline-offset-2 disabled:opacity-50">cofnij przyjęcie</button>
      {blad && <span className="text-ranga-zle">{blad}</span>}
    </div>;
  }

  if (zwrot.kubelek === "korekta") {
    const zw = zwrot.zw ?? null;
    const zwWDrodze = zw !== null
      && (zw.status === "pending" || zw.status === "processing" || zw.status === "waiting_for_doc");
    return <div className={ramka}>
      {/* KWOTA Z DROGĄ WYJŚCIA (0.202.0). To jedyny ekran, na którym kwota jest
          już ustalona, a jeszcze nic na jej podstawie nie wyszło z firmy —
          więc tu, i tylko tu, da się ją poprawić. Pomyłka w zaznaczeniu
          pozycji zostawała dotąd na zawsze: pasek wyceny znika razem
          z kubełkiem DO ZWROTU. */}
      {/* Sama kwota zeszła stąd (0.516.0) — stoi w „Pieniądzach" niżej.
          Zostaje droga wyjścia, bo to ona jest powodem tego bloku. */}
      {zwrot.kwotaGrosze !== null && <button type="button" disabled={trwa} onClick={onCofnijKwote}
        className="mb-2 block text-xs text-slate-500 underline underline-offset-2 disabled:opacity-50">
        popraw kwotę</button>}
      {/* KTO WYSTAWIA ZW (0.349.0). „Wystawiasz w Subiekcie" było prawdą, dopóki
          robiło to wyłącznie biuro. Przy zleconym automacie zdanie mówi, że numer
          przyjdzie sam — inaczej biuro wystawiłoby drugi dokument obok. Pole
          numeru zostaje: wpisany numer anuluje czekające zlecenie. */}
      {/* JEDNA LINIJKA ZAMIAST AKAPITU (0.479.0) — przegląd zwrotów
          z 23 września: pudełko powtarzało dwa, trzy zdania przy każdym
          zwrocie. Zostaje to, co każe coś zrobić albo czegoś nie robić;
          reszta idzie do podpowiedzi. Błąd automatu niesie od 0.456.0 cały
          zrzut pól, więc na ekranie stoi jego PIERWSZE zdanie, a całość
          rozwija się na żądanie. */}
      {zwWDrodze
        ? <p className="mb-2 text-xs text-slate-600"
            title="Numer wpisze się tu sam w ciągu minuty. Wpisany ręcznie anuluje zlecenie automatu.">
            Automat wystawia ZW — nie wystawiaj go ręcznie.
            {zw?.blad && <span className="block">Czeka: {pierwszeZdanie(zw.blad)}</span>}
          </p>
        : zw?.status === "error"
          ? <div className="mb-2 text-xs text-ranga-zle">
              <p title="Wystaw ZW w Subiekcie i przepisz tu numer — to zamyka zwrot.">
                Automat nie wystawił ZW: {pierwszeZdanie(zw.blad ?? "bez opisu błędu.")}
                {" "}Wystaw go ręcznie.</p>
              {zw.blad && zw.blad.length > pierwszeZdanie(zw.blad).length &&
                <details className="mt-1 text-slate-600">
                  <summary className="cursor-pointer">pełna treść błędu</summary>
                  <p className="mt-1 max-h-40 overflow-y-auto break-words">{zw.blad}</p>
                </details>}
            </div>
          : <p className="mb-2 text-xs text-slate-600"
              title="Numer zamyka zwrot. Wpisany ręcznie wygrywa z automatem.">
              {/* Wprost, bo inaczej ekran obiecywałby, że zrobi to sam. */}
              Korektę wystawiasz w Subiekcie — tu przepisz jej numer.
            </p>}
      <div className="flex flex-wrap items-center gap-2">
        <Pole id="numer-korekty" className="w-56" value={numer} aria-label="Numer korekty"
          placeholder="Np. ZW 413/MAG/09/2026" onChange={(e) => setNumer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && numer.trim()) onKorekta(numer.trim()); }} />
        <Przycisk wariant="glowny" disabled={trwa || !numer.trim()}
          onClick={() => onKorekta(numer.trim())}>
          <kbd className="rounded border border-black/20 px-1 text-xs">Enter</kbd> Zapisz korektę
        </Przycisk>
      </div>
      {/* Zdanie o pieniądzach ZESZŁO (0.479.0). Od 0.476.0 zwrot
          z korektą, a bez wypłaty, wraca do DO ZWROTU z własnym paskiem
          pieniędzy — przypominanie o tym tutaj przy każdym zwrocie mówiło
          to samo drugi raz, zanim było potrzebne. */}
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  /* STAN KOŃCOWY BEZ KOREKTY I POWODU NIE MA RAMKI (0.516.0, §26d).
     Stało tu „nie ma tu decyzji do podjęcia" — oś etapów wyżej mówi już
     „Zamknięty" albo „Odrzucony", a pusta ramka tylko zabierała wzrok. */
  if (!zwrot.korektaNumer && !(zwrot.kubelek === "odrzucony" && zwrot.werdyktPowod)) {
    return blad ? <div className={ramka}><Blad>{blad}</Blad></div> : null;
  }

  /* Skąd wziął się numer, jest częścią informacji — ta sama zasada co
     przy dokumencie sprzedaży (§4.3). Fakt z danych nie ma udawać
     czyjejś decyzji, a decyzja nie ma udawać faktu. Od 0.516.0 mówi to
     podpowiedź przy numerze, nie osobna linijka: czyta się ją raz. */
  const skadKorekta = zwrot.korektaZrodlo === "subiekt"
    ? "Znaleziona w Subiekcie — dokument koryguje tę sprzedaż."
    : zwrot.korektaZrodlo === "sfera"
      ? "Wystawiona automatycznie po zapisaniu kwoty."
      : "Numer przepisany w panelu.";

  return <div className={ramka}>
    {zwrot.korektaNumer
      ? <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Korekta</span>
            <b className="mr-auto" title={skadKorekta}>{zwrot.korektaNumer}</b>
            {/* Cofnięcie zamiast potwierdzenia (§25a.5) — i tak samo dostępne
                dla numeru znalezionego przez automat: cofnięcie cudzej pomyłki
                nie ma być trudniejsze niż cofnięcie własnej. */}
            <Przycisk disabled={trwa} onClick={onCofnijKorekte}>
              <kbd className="rounded border border-slate-300 px-1 text-xs">R</kbd> Cofnij korektę
            </Przycisk>
          </div>
        </>
      : zwrot.kubelek === "odrzucony" && zwrot.werdyktPowod
        /* POWÓD ODMOWY WIDOCZNY (0.210.0). Zapisywał się do bazy i nikt go nie
           czytał — ani panel, ani nic innego. Operator, który ma napisać
           klientowi, musiał pamiętać własne zdanie sprzed tygodnia albo szukać
           go w dzienniku. Z klawiszem kopiowania, bo to zdanie się przekleja. */
        ? <div className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">Odmówiono</span>
              {/* Wskazówka „napisz mu w skrzynce" zeszła do podpowiedzi
                  (0.516.0): operator zna ją po pierwszym razie. */}
              <b className="mr-auto"
                title="Powód został u nas. Jeśli klient go jeszcze nie zna, napisz mu w skrzynce.">
                {zwrot.werdyktPowod}</b>
              <Skopiuj tekst={zwrot.werdyktPowod} tytul="Kopiuj powód odmowy" />
            </div>
          </div>
        : null}
    {blad && <Blad>{blad}</Blad>}
  </div>;
}
