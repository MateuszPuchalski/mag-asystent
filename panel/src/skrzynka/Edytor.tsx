import React, { useId, useState } from "react";
import { Lock, MessageSquare, Send } from "lucide-react";
import { Przycisk } from "../ui";
import { PrzyciskZalacznika, ZalacznikiWysylki } from "./ZalacznikiWysylki";
import { KartaSzkicu, PasekSzkicu, PrzyciskSzkicu, UwagiSzkicu, szkicDoPola,
  type PropsSzkicuCopilota } from "./SzkicCopilota";
import type { ZalacznikSzkicu } from "../api/rozmowy";

/**
 * Edytor odpowiedzi (§10.4).
 *
 * DWA TRYBY, DWA POLA, DWA PRZYCISKI — i to jest tu najważniejsza decyzja.
 * §10.4 żąda, żeby przycisk komentarza i przycisk wysyłki do klienta były
 * jednoznacznie rozdzielone; §6.4 dodaje, że komentarz „nie może przypadkiem
 * trafić do klienta", a §25 stawia to wśród kryteriów gotowości.
 *
 * Rozdzielamy najmocniej, jak się da: w trybie komentarza przycisk wysyłki
 * NIE ISTNIEJE W DRZEWIE. Wyłączony przycisk da się kliknąć, gdy tryb zmieni
 * się o ułamek sekundy za późno albo gdy stan się rozjedzie — przycisku,
 * którego nie ma, nie da się kliknąć nigdy.
 *
 * Pola też są osobne. Gdyby oba tryby dzieliły jeden tekst, notatka „klient
 * bywa trudny" zostawałaby w szkicu po przełączeniu z powrotem i czekała na
 * kliknięcie WYŚLIJ.
 *
 * ── OSTATNIA WYPOWIEDŹ W WĄTKU, NIE PAS POD NIM (0.495.0) ─────────────────
 * Zgłoszenie właściciela ze zrzutem: „za dużo odstępów w środkowej kolumnie,
 * miejsce pracy jest ściśnięte". Zmierzone na tamtym zrzucie: rozmowa 166 px,
 * czyli 19% kolumny; puste pole 212 px; pod nim karta szkicu z tą samą
 * odpowiedzią, zepchnięta pod krawędź do DRUGIEGO paska przewijania.
 *
 * Przyczyna leżała w kształcie, nie w odstępach. Kolumna miała dwa pasy
 * o sztywnym podziale: oś `flex-1`, edytor `shrink-0` z siatką 60vh. Każdy
 * piksel edytora był odjęty rozmowie, a szkic Copilota stał w nim DWA razy —
 * pustym polem i kartą z treścią. Żaden odstęp tego nie naprawiał.
 *
 * Decyzja właściciela z kanwy („A + B"), dwie zmiany naraz:
 * A — szkic Copilota stoi W POLU jako podpowiedź, Tab go przyjmuje;
 * B — edytor jest ostatnią wypowiedzią osi, z jednym przewijaniem na całość,
 *     a przyciski wysyłki pływają przy dolnej krawędzi.
 * Komponent zwraca więc DWA elementy: dymek i pływający pasek działań.
 * Wołający (`Os` przez `Rozmowa`) wstawia oba na koniec listy wypowiedzi.
 */
export function Edytor({
  szkic, cudza, wlasciciel, zapisuje, wysyla, onZmiana, onZapisz, onWyslij, onWyslijIZakoncz,
  komentarz, onKomentarz, onDodajKomentarz, komentuje, agenci, wzmianki, onWzmianki,
  zalaczniki, dodajeZalacznik, bladZalacznika, onDodajZalacznik, onUsunZalacznik, copilot,
}: {
  szkic: string;
  cudza: boolean;
  wlasciciel: string | null;
  zapisuje: boolean;
  wysyla: boolean;
  onZmiana: (v: string) => void;
  onZapisz: () => void;
  onWyslij: () => void;
  /** „Wyślij i zakończ" (23 września 2026) — większość spraw kończy się ostatnią odpowiedzią. */
  onWyslijIZakoncz?: () => void;
  komentarz: string;
  onKomentarz: (v: string) => void;
  onDodajKomentarz: () => void;
  komentuje: boolean;
  agenci: Array<{ userId: number; name: string }>;
  wzmianki: number[];
  onWzmianki: (v: number[]) => void;
  /* Załączniki (0.195.0) — TYLKO w trybie odpowiedzi. Komentarz wewnętrzny
     nigdzie nie wychodzi, więc dołączanie do niego pliku nie miałoby dokąd
     pójść, a przycisk obok notatki sugerowałby, że ma. */
  zalaczniki: ZalacznikSzkicu[];
  dodajeZalacznik: boolean;
  bladZalacznika: string;
  onDodajZalacznik: (plik: File) => void;
  onUsunZalacznik: (id: number) => void;
  /* Szkic z Copilota (0.231.0) — TYLKO w trybie odpowiedzi: propozycja jest
     dla klienta, a w komentarzu nie ma czego układać. Opcjonalny, bo edytor
     reklamacji i testy komentarza nie mają Copilota wcale. */
  copilot?: PropsSzkicuCopilota;
}) {
  const [tryb, setTryb] = useState<"odpowiedz" | "komentarz">("odpowiedz");
  const wKomentarzu = tryb === "komentarz";

  /* ── SZKIC W POLU JAKO PODPOWIEDŹ (0.495.0) ────────────────────────────
     Treść modelu NIE wchodzi do wartości pola — reguła z 0.231.0 zostaje.
     Stoi POD pustym polem jako warstwa, którą agent czyta tam, gdzie będzie
     pisał, i przyjmuje Tabem. Pierwsza litera agenta ją zasłania. Wartość
     pola zmienia się dopiero na jawny ruch, więc wysyłka nigdy nie wyśle
     tekstu, którego agent nie przyjął.

     Tylko przy pustym polu i swojej rozmowie. Przy tekście agenta podpowiedź
     przykryłaby jego pracę; w cudzej rozmowie nie ma prawa przyjąć. */
  const duch = !wKomentarzu && !cudza && szkic === "" && copilot !== undefined && szkicDoPola(copilot);
  const idDucha = useId();
  /* Uwagi modelu PRZEŻYWAJĄ przyjęcie — patrz `UwagiSzkicu`. Znikają razem
     z tekstem agenta i przy nieświeżym szkicu, bo wtedy mówią o innym tekście. */
  const uwagiPoPrzyjeciu = !wKomentarzu && copilot?.szkic && szkic.trim() !== "" && !copilot.nieswiezy
    && (copilot.szkic.ocena === "wstawiony" || copilot.szkic.ocena === "zastapiony")
    ? copilot.szkic.zastrzezenia : [];

  const przelacz = (id: number) => onWzmianki(
    wzmianki.includes(id) ? wzmianki.filter((x) => x !== id) : [...wzmianki, id]);

  /* SIATKI 60vh JUŻ NIE MA (0.495.0). Stała od 0.232.1, bo edytor był
     `shrink-0` pod osią i rozepchnięty zjadał rozmowę. Na końcu osi nie ma
     czego zjadać: dymek i wątek przewijają się razem, a wysoki szkic
     wydłuża przewijanie, zamiast ściskać rozmowę do jednej linii.

     Dymek stoi po NASZEJ stronie osi (`ml-auto`, jak nasze odpowiedzi),
     bo jest następną naszą wypowiedzią. Przerywana ramka mówi, że jeszcze
     nie wyszła. Pełna szerokość progu 75ch, bo w nim się pisze. */
  return <>
  <article aria-label={wKomentarzu ? "Twoja notatka" : "Twoja odpowiedź"}
    className={`ml-auto w-full max-w-[75ch] rounded-lg border-2 border-dashed p-3 ${wKomentarzu
      ? "border-amber-300 bg-amber-50" : duch ? "border-violet-300 bg-white" : "border-slate-300 bg-white"}`}>
    {/* ── PRZEŁĄCZNIK JEST JEDNYM ELEMENTEM, NIE DWOMA (0.247.0) ──────────────
        Dwa luźne przyciski o tej samej wadze nie mówiły, że wybiera się JEDEN
        z dwóch — mówiły, że są dwie rzeczy do kliknięcia. Bieżnia z tłem
        i wyniesiony kafelek aktywny to ten sam kształt, co przełącznik
        w każdym innym programie, więc nie wymaga czytania.

        Przełącznik stoi NAD polem, żeby było widać, gdzie się pisze, zanim
        się zacznie pisać. */}
    <div className="mb-2.5 flex items-center gap-2">
      <div className={`flex gap-0.5 rounded-lg p-0.5 ${wKomentarzu ? "bg-amber-100" : "bg-slate-100"}`}>
        <button className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${!wKomentarzu
          ? "bg-white font-semibold text-slate-900 shadow-sm" : "font-medium text-slate-500"}`}
          onClick={() => setTryb("odpowiedz")}>Odpowiedź do klienta</button>
        <button className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${wKomentarzu
          ? "bg-white font-semibold text-amber-900 shadow-sm" : "font-medium text-slate-500"}`}
          onClick={() => setTryb("komentarz")}>
          {/* ── JEDNA NAZWA, NIE DWIE (0.260.0) ──────────────────────────────
              Edytor mówił „Komentarz wewnętrzny" i „Dodaj komentarz", a oś
              rozmowy dwa centymetry wyżej — „NOTATKA WEWNĘTRZNA". To samo
              okno, ta sama rzecz, dwa słowa. Decyzja właściciela: notatka.
              Reklamacje i dyskusje mają zresztą `notatka` już w API, więc
              „komentarz" był tu ostatnim śladem, nie regułą. Nazwy w kodzie
              (`komentarz`, `onDodajKomentarz`, token `os-komentarz`) zostają:
              ekran ich nie pokazuje, a przemianowanie ich w tym samym wydaniu
              utopiłoby trzy widoczne zmiany w diffie bez jednej widocznej. */}
          <MessageSquare size={13} />Notatka wewnętrzna
        </button>
      </div>
      {/* ── COPILOT W TYM SAMYM RZĘDZIE (0.249.0) ────────────────────────────
          Zgłoszenie właściciela: „niepotrzebnie ułóż odpowiedź i add
          attachment mają swój własny rząd". 0.247.0 próbowało już tego i
          zostało wycofane, bo z Copilotem WYŁĄCZONYM komponent renderował
          akapit, nie przycisk, i łamał rząd. Naprawiona jest przyczyna:
          `PrzyciskSzkicu` nie zajmuje już nigdy więcej niż jednej linii. */}
      {!wKomentarzu && <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
        {copilot && <PrzyciskSzkicu p={copilot} />}
      </div>}
    </div>

    {wKomentarzu
      ? <>
          <textarea className="field min-h-[88px] text-tresc [field-sizing:content]" value={komentarz}
            aria-label="Notatka wewnętrzna — zobaczy ją tylko zespół"
            onChange={(e) => onKomentarz(e.target.value)}
            placeholder="Notatka dla zespołu — klient tego nie zobaczy" />
          {agenci.length > 0 && <fieldset className="mt-2">
            <legend className="text-xs font-bold text-slate-600">Wzmianki</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {agenci.map((a) => <label key={a.userId} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={wzmianki.includes(a.userId)}
                  onChange={() => przelacz(a.userId)} />
                {a.name}
              </label>)}
            </div>
          </fieldset>}
        </>
      : <>
          {cudza && <p className="mb-2 flex items-center gap-2 text-xs text-slate-500">
            <Lock size={13} />Rozmowę prowadzi {wlasciciel} — szkic zapisze tylko właściciel.</p>}
          {duch && copilot && <PasekSzkicu p={copilot} wPolu />}
          {/* POLE MA WYGLĄDAĆ NA MIEJSCE DO PISANIA (0.247.0). Miało 80 px
              wysokości i tekst 14 px — tyle samo, co każdy inny wiersz ekranu,
              choć agent spędza w nim najwięcej czasu z całego panelu. */}
          {/* ── POLE ROŚNIE Z TREŚCIĄ, NIE STOI NA 200 PX (0.495.0) ─────────
              0.404.0 dało polu stałe 200 px i powiedziało wprost, czemu nie
              elastyczne: przy DŁUGIM wątku rozciągnięty edytor zwijał oś do
              `min-h-40`. Ten powód odszedł razem z osobnym pasem — pole stoi
              w tym samym przewijaniu co rozmowa i niczego jej nie odejmuje.
              Zostało to, co 200 px robiło źle: puste pole zajmowało ćwierć
              kolumny, zanim agent napisał choć słowo.

              `field-sizing: content` rośnie z tekstem od progu 120 px, bez
              skryptu mierzącego wysokość. Przeglądarka bez tej własności
              dostaje próg i `resize-y`, czyli to, co było, tylko niższe.

              POLE I PODPOWIEDŹ W JEDNEJ KOMÓRCE SIATKI. Wyższa z nich ustala
              wysokość, więc długi szkic nie chowa się pod dolną krawędzią
              pustego pola. Pole jest ZAWSZE w tym samym miejscu drzewa: gdyby
              podpowiedź zmieniała mu rodzica, pierwsza litera agenta
              przemontowałaby pole i zgubiła kursor. */}
          <div className="grid">
            {duch && copilot?.szkic && <div id={idDucha} data-testid="szkic-w-polu"
              className="pointer-events-none col-start-1 row-start-1 whitespace-pre-wrap break-words rounded-lg border border-transparent bg-violet-50 px-3 py-2 text-tresc text-violet-950">
              {copilot.szkic.tresc}</div>}
            <textarea className={`field col-start-1 row-start-1 min-h-[7.5rem] resize-y text-tresc [field-sizing:content] ${
              duch ? "bg-transparent" : ""}`} value={szkic}
              aria-label="Szkic odpowiedzi" aria-keyshortcuts="Control+Enter"
              aria-describedby={duch ? idDucha : undefined}
              onChange={(e) => onZmiana(e.target.value)}
              /* CTRL+ENTER WYSYŁA (23 września 2026). Ten sam warunek co przycisk
                 niżej — skrót nie ma prawa ominąć blokady cudzej rozmowy. Sam
                 Enter zostaje nową linią, bo odpowiedź ma akapity. */
              onKeyDown={(e) => {
                /* TAB PRZYJMUJE PODPOWIEDŹ (0.495.0) — i tylko wtedy, gdy
                   jakaś stoi w polu. Bez niej Tab przenosi fokus jak zawsze,
                   a Shift+Tab nie jest przechwytywany nigdy: wyjście z pola
                   klawiaturą zostaje otwarte także nad podpowiedzią. */
                if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
                  && duch && copilot) {
                  e.preventDefault();
                  copilot.onPopraw();
                  return;
                }
                if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                /* Ctrl+Shift+Enter — „Wyślij i zakończ" (23 września 2026). */
                if (!cudza && !wysyla && szkic.trim()) {
                  if (e.shiftKey && onWyslijIZakoncz) onWyslijIZakoncz(); else onWyslij();
                }
              }}
              /* Nad podpowiedzią placeholder nachodziłby na jej pierwszy wiersz. */
              placeholder={duch ? undefined : "Szkic odpowiedzi — współdzielony z zespołem"} />
          </div>
          {uwagiPoPrzyjeciu.length > 0 && <div className="mt-2"><UwagiSzkicu uwagi={uwagiPoPrzyjeciu} /></div>}
          {copilot && <KartaSzkicu p={copilot} wPolu={duch} />}
          {/* Lista dołożonych plików stoi POD treścią (0.247.0): należy do
              komponowanej wiadomości, nie do przycisków. Sam spinacz jedzie
              w pasku działań — nie zasługuje na własny rząd. */}
          <ZalacznikiWysylki lista={zalaczniki} blad={bladZalacznika}
            onUsun={onUsunZalacznik} wylaczone={cudza} />
        </>}
  </article>

  {/* ── PASEK DZIAŁAŃ PŁYWA (0.495.0) ───────────────────────────────────────
      `sticky bottom-2` na końcu listy wypowiedzi: gdy agent stoi na dole,
      pasek leży zwyczajnie pod dymkiem; gdy przewinie w górę, żeby doczytać
      wątek, pasek zostaje przy krawędzi. Wysłać można więc z każdego miejsca
      rozmowy, a pasek nie zabiera jej stałego pasma, jak robił rząd pod polem.

      Białe tło z cieniem, nie ciemne: przyciski niosą swoje barwy z reszty
      panelu, a na grafitowym tle trzeba by każdą przemalować. */}
  {/* JEDEN RZĄD ZAWSZE. Zawinięty na dwa wiersze pasek zakrywał przy
      przewiniętym wątku dwa razy więcej rozmowy, niż zakrywa rząd. Na węższej
      kolumnie (ekran 1440 px) chowają się więc rzeczy wtórne: licznik znaków
      i podpis drugiego skrótu. Skrót ZOSTAJE w podpowiedzi i w nazwie
      dostępnej, a podpis głównego — Ctrl+Enter — nie chowa się nigdy. */}
  <div className={`sticky bottom-2 z-10 ml-auto flex w-fit max-w-full items-center gap-3 rounded-xl border px-2 py-1.5 shadow-lg ${
    wKomentarzu ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
    role="group" aria-label={wKomentarzu ? "Działania notatki" : "Działania odpowiedzi"}>
    {wKomentarzu
      ? <>
          <span className="text-podpis text-amber-700/70">{komentarz.length} znaków</span>
          <span className="text-xs text-amber-800">Widoczna tylko dla zespołu.</span>
          {/* Komentowanie NIE wymaga prowadzenia rozmowy: notatka zespołu to
              nie odpowiedź, a kolega ma prawo dopisać „to ten sam klient co
              wczoraj" bez przejmowania sprawy. */}
          <Przycisk wariant="glowny" disabled={komentuje || !komentarz.trim()}
            onClick={onDodajKomentarz} className="px-5 py-2.5 text-tresc shadow-sm">
            <MessageSquare size={17} />{komentuje ? "Zapisuję…" : "Dodaj notatkę"}
          </Przycisk>
        </>
      : <>
          <span className="hidden whitespace-nowrap text-podpis text-slate-500 2xl:inline">{szkic.length} znaków</span>
          <PrzyciskZalacznika dodaje={dodajeZalacznik}
            onDodaj={onDodajZalacznik} wylaczone={cudza} />
          <button type="button" onClick={onZapisz} disabled={cudza || zapisuje}
            className="whitespace-nowrap text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:text-slate-300">
            {zapisuje ? "Zapisuję…" : "Zapisz szkic"}</button>
          {/* DRUGI, CICHSZY (23 września 2026): wysyłka zostaje jedynym
              najgłośniejszym działaniem, a zakończenie jedzie z nią w tej
              samej transakcji — nieudana wysyłka niczego nie kończy. */}
          {onWyslijIZakoncz && <button type="button" onClick={onWyslijIZakoncz}
            disabled={cudza || wysyla || !szkic.trim()} aria-keyshortcuts="Control+Shift+Enter"
            title="Wyślij i zakończ — Ctrl+Shift+Enter"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-600 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
            Wyślij i zakończ
            <kbd aria-hidden="true" className="hidden rounded bg-black/10 px-1 font-sans text-podpis 2xl:inline">Ctrl+Shift+Enter</kbd>
          </button>}
          {/* ── JEDNO DZIAŁANIE MA BYĆ NAJGŁOŚNIEJSZE (0.247.0) ───────────────
              Wysyłka jest jedyną drogą, którą treść wychodzi z WERTIS na
              zewnątrz, i idzie WYŁĄCZNIE na kliknięcie człowieka — innej drogi
              wysyłki w kodzie nie ma. Dostaje większy stopień pisma, wyższy
              padding i cień; zapis szkicu schodzi do zwykłego tekstu.
              Od 0.495.0 stoi NA PRAWYM KOŃCU paska, pod kciukiem myszy
              przesuwanej od dymka — tam, gdzie kończy się czytanie odpowiedzi. */}
          <Przycisk wariant="glowny" onClick={onWyslij} disabled={cudza || wysyla || !szkic.trim()}
            className="whitespace-nowrap px-5 py-2.5 text-tresc shadow-sm">
            <Send size={17} />{wysyla ? "Wysyłam…" : "Wyślij do klienta"}
            {/* Skrót NA PRZYCISKU (dekalog, punkt 2): o skrócie, o którym nikt
                nie wie, nikt nie skorzysta. Poza nazwą dostępną przycisku. */}
            <kbd aria-hidden="true" className="ml-1 rounded bg-black/10 px-1 font-sans text-podpis">Ctrl+Enter</kbd>
          </Przycisk>
        </>}
  </div>
  </>;
}
