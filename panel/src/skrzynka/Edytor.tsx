import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Eraser, Lock, MessageSquare, Send, Undo2 } from "lucide-react";
import { Przycisk } from "../ui";
import { PrzyciskZalacznika, ZalacznikiWysylki } from "./ZalacznikiWysylki";
import { KartaSzkicu, PasekSzkicu, PrzyciskSzkicu, UwagiSzkicu,
  type PropsSzkicuCopilota } from "./SzkicCopilota";
import type { ZalacznikSzkicu } from "../api/rozmowy";
import { doSprawdzenia } from "./ProcesCopilota";
import { useOkienko } from "./MenuRozmowy";
import { polePisania, useSkrotyDzialaja } from "../nawigacja/fokus";

/**
 * Ms od otwarcia rozmowy, przed którymi Ctrl+Enter SPOZA POLA milczy.
 * Po wysyłce ekran przechodzi dalej, a następna rozmowa ma zwykle szkic
 * Copilota w polu — podwójne Ctrl+Enter wysłałoby go bez jednego spojrzenia.
 * Sekunda to mniej, niż trwa przeczytanie pytania, i więcej niż odbicie palca.
 */
export const ZWLOKA_KLAWISZA_MS = 1000;

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
  komentarz, onKomentarz, onDodajKomentarz, komentuje, agenci, wzmianki, onWzmianki, doNotatki,
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
  /** Licznik zmian z ekranu: każda przełącza tryb na notatkę (prośba o przekazanie). */
  doNotatki?: number;
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
  /* Prośba o przekazanie pisze do notatki (0.533.0) — edytor ma wtedy
     stać na notatce, żeby agent widział, gdzie leży tekst. Porównanie
     z wartością z montowania, bo ekran montuje edytor od nowa przy każdej
     rozmowie, a stary licznik nie jest nową prośbą. */
  const doNotatkiNaStart = useRef(doNotatki);
  useEffect(() => {
    if (doNotatki !== undefined && doNotatki !== doNotatkiNaStart.current) setTryb("komentarz");
  }, [doNotatki]);

  /* ── KLAWIATURA OD LISTY DO WYSYŁKI (0.533.0) ──────────────────────────
     Ctrl+Enter wysyłał tylko z pola, a po przejściu do następnej rozmowy
     fokus stoi na tle strony (i tak ma być — pole z autofokusem zabiłoby
     j/k, `zwroty/klawisze.ts`). Każda rozmowa kosztowała więc ruch ręki do
     myszy, nawet gdy szkic w polu był gotowy. Dwa klawisze to zamykają:

     ENTER — do pola, kursor na końcu. Tylko z tła strony albo z wiersza
     kolejki; na przycisku Enter dalej go naciska.
     CTRL+ENTER (i Ctrl+Shift+Enter) — wysyłka także spoza pola, tym samym
     warunkiem co przycisk. Nie w trybie notatki: tam przycisku wysyłki nie
     ma w drzewie (§10.4) i skrót nie może go udawać. */
  const pole = useRef<HTMLTextAreaElement>(null);
  const zamontowany = useRef(Date.now());
  const skrotyDzialaja = useSkrotyDzialaja();
  const klawisz = useRef<(e: KeyboardEvent) => void>(() => {});
  klawisz.current = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || wKomentarzu || e.altKey || e.isComposing || polePisania(e.target)) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (Date.now() - zamontowany.current < ZWLOKA_KLAWISZA_MS) return;
      if (!cudza && !wysyla && szkic.trim()) {
        if (e.shiftKey && onWyslijIZakoncz) onWyslijIZakoncz(); else onWyslij();
      }
      return;
    }
    if (e.shiftKey || cudza) return;
    const cel = e.target as HTMLElement | null;
    if (cel && cel !== document.body && !cel.closest("[data-wiersz-kolejki]")) return;
    e.preventDefault();
    const el = pole.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => klawisz.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  /* ── SZKIC W POLU: ZWYKŁY TEKST DO POPRAWIANIA (0.499.0) ─────────────────
     Do 0.499.0 szkic stał w pustym polu jako szara podpowiedź przyjmowana
     Tabem (0.495.0). Nagranie właściciela pokazało, że nikt się tego kroku
     nie domyśla: pierwsza litera zasłaniała szkic, a pod polem wyskakiwała
     karta. Szkic wstawia teraz do pola ekran, jako zwykły tekst — powód
     i granice przy `szkicNaStart` w `SzkicCopilota.tsx`. Edytor wie tylko,
     że pole trzyma szkic, i mówi to nad nim. */
  const wPolu = !wKomentarzu && Boolean(copilot?.wPolu) && szkic !== "";
  /* ── „WYCZYŚĆ WSZYSTKO" Z COFNIĘCIEM (0.499.0) ─────────────────────────
     Druga połowa zgłoszenia: „z opcją wyczyszczenia wszystkiego". Kasowanie
     pięciuset znaków zaznaczaniem to ruch na kilka sekund i łatwy do
     pomylenia. Czyszczenie niczego nie zapisuje, więc do pomyłki potrzebne
     jest cofnięcie — trzymane, dopóki agent nie zacznie pisać od nowa. */
  const [wyczyszczone, setWyczyszczone] = useState<string | null>(null);
  /* ── TARCIE PRZY WYSYŁCE NIETKNIĘTEGO SZKICU (0.500.0) ─────────────────
     Szkic stoi w polu gotowy do wysłania, więc przyjęcie go bez czytania
     kosztuje jedno kliknięcie. Randomizowane badanie z 2025 (NEJM AI):
     lekarze po dwudziestu godzinach szkolenia z AI wypadali o 18 punktów
     procentowych gorzej, gdy model podsuwał błąd — szkolenie nie chroni.

     Stąd tarcie w interfejsie, ale WĄSKIE: tylko szkic nietknięty i tylko
     z twierdzeniami spoza naszej bazy. Buçinca i in. (CSCW 2021) pokazali,
     że wymuszanie namysłu zmniejsza nadmierne zaufanie, ale ludzie oceniają
     je najgorzej — więc bez okna dialogowego (klikane z przyzwyczajenia,
     Anderson i in., CHI 2015). Przycisk mówi, co się stanie, a twierdzenia
     stoją obok. Porównanie po zwinięciu białych znaków, tak jak `losSzkicu`
     na serwerze liczy „bez zmian". */
  const zwin = (t: string) => t.replace(/\s+/g, " ").trim();
  const niezmieniony = !wKomentarzu && copilot?.szkic != null && szkic.trim() !== ""
    && zwin(szkic) === zwin(copilot.szkic.tresc);
  const niesprawdzone = niezmieniony ? (copilot?.szkic?.twierdzenia ?? []).filter(doSprawdzenia) : [];
  const wyczysc = () => { setWyczyszczone(szkic); onZmiana(""); };
  /* Uwagi modelu PRZEŻYWAJĄ przyjęcie — patrz `UwagiSzkicu`. Znikają razem
     z tekstem agenta i przy nieświeżym szkicu, bo wtedy mówią o innym tekście. */
  const uwagiPoPrzyjeciu = !wKomentarzu && !wPolu && copilot?.szkic && szkic.trim() !== "" && !copilot.nieswiezy
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
      ? "border-amber-300 bg-amber-50" : wPolu ? "border-violet-300 bg-white" : "border-slate-300 bg-white"}`}>
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
      {!wKomentarzu && <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
        {copilot && <PrzyciskSzkicu p={copilot} />}
        {szkic !== "" && !cudza && <button type="button" onClick={wyczysc}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <Eraser size={13} />Wyczyść wszystko</button>}
        {szkic === "" && wyczyszczone !== null && <button type="button"
          onClick={() => { onZmiana(wyczyszczone); setWyczyszczone(null); }}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-sky-800 hover:bg-sky-50">
          <Undo2 size={13} />Cofnij wyczyszczenie</button>}
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
          {wPolu && copilot && <PasekSzkicu p={copilot} wPolu />}
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
              dostaje próg i `resize-y`, czyli to, co było, tylko niższe. */}
          <textarea ref={pole} className={`field min-h-[7.5rem] resize-y text-tresc [field-sizing:content] ${
            wPolu ? "bg-violet-50" : ""}`} value={szkic}
            aria-label="Szkic odpowiedzi" aria-keyshortcuts="Control+Enter"
            onChange={(e) => { if (e.target.value !== "") setWyczyszczone(null); onZmiana(e.target.value); }}
            /* CTRL+ENTER WYSYŁA (23 września 2026). Ten sam warunek co przycisk
               niżej — skrót nie ma prawa ominąć blokady cudzej rozmowy. Sam
               Enter zostaje nową linią, bo odpowiedź ma akapity. */
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
              e.preventDefault();
              /* Ctrl+Shift+Enter — „Wyślij i zakończ" (23 września 2026). */
              if (!cudza && !wysyla && szkic.trim()) {
                if (e.shiftKey && onWyslijIZakoncz) onWyslijIZakoncz(); else onWyslij();
              }
            }}
            /* Podpowiedź Entera tylko wtedy, gdy Enter prowadzi do pola —
               w samym polu robi nową linię (dekalog p. 2, `nawigacja/fokus.ts`). */
            placeholder={skrotyDzialaja && !cudza
              ? "Szkic odpowiedzi — współdzielony z zespołem · Enter, żeby pisać"
              : "Szkic odpowiedzi — współdzielony z zespołem"} />
          {uwagiPoPrzyjeciu.length > 0 && <div className="mt-2"><UwagiSzkicu uwagi={uwagiPoPrzyjeciu} /></div>}
          {/* Po „Wyczyść wszystko" karta stoi zwinięta: pusty znaczy pusty,
              a szkic wraca jednym kliknięciem „Wstaw do odpowiedzi". */}
          {copilot && <KartaSzkicu p={copilot} wPolu={wPolu} zwinieta={wyczyszczone !== null} />}
          {/* Lista dołożonych plików stoi POD treścią (0.247.0): należy do
              komponowanej wiadomości, nie do przycisków. Sam spinacz jedzie
              w pasku działań — nie zasługuje na własny rząd. */}
          <ZalacznikiWysylki lista={zalaczniki} blad={bladZalacznika}
            onUsun={onUsunZalacznik} wylaczone={cudza} />
          {niesprawdzone.length > 0 && <section aria-label="Do sprawdzenia przed wysłaniem"
            className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <b>Szkic bez zmian — te twierdzenia nie pochodzą z naszej bazy:</b>
            <ul className="mt-1 list-disc pl-4">
              {niesprawdzone.slice(0, 3).map((t, i) => <li key={i}>{t.teza}</li>)}
            </ul>
            {niesprawdzone.length > 3 && <p className="mt-1">i {niesprawdzone.length - 3} więcej w „Skąd to wiem".</p>}
          </section>}
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
          {/* LICZNIK I ZDANIE ZESZŁY (0.523.0), tą samą regułą co licznik
              odpowiedzi w 0.506.0: stoi tylko to, co zmienia decyzję. Notatka
              nie ma limitu znaków — serwer żadnego nie trzyma — więc licznik
              nie miał progu, przy którym by coś znaczył. „Widoczna tylko dla
              zespołu" mówią już zakładka, pole i jego podpis; zostaje
              w podpowiedzi przycisku, tuż przed kliknięciem. */}
          {/* Komentowanie NIE wymaga prowadzenia rozmowy: notatka zespołu to
              nie odpowiedź, a kolega ma prawo dopisać „to ten sam klient co
              wczoraj" bez przejmowania sprawy. */}
          <Przycisk wariant="glowny" disabled={komentuje || !komentarz.trim()}
            title="Widoczna tylko dla zespołu — klient jej nie zobaczy"
            onClick={onDodajKomentarz} className="px-5 py-2.5 text-tresc shadow-sm">
            <MessageSquare size={17} />{komentuje ? "Zapisuję…" : "Dodaj notatkę"}
          </Przycisk>
        </>
      : <>
          {/* LICZNIK TYLKO PRZY LIMICIE (0.506.0). „0 znaków" stało przy każdej
              odpowiedzi, a liczy się wyłącznie blisko progu Allegro — tam, gdzie
              zmienia decyzję. Wtedy staje, a za progiem czerwienieje. */}
          {szkic.length >= LIMIT_ALLEGRO - 400 && <span className={`whitespace-nowrap text-podpis font-semibold ${
            szkic.length > LIMIT_ALLEGRO ? "text-ranga-zle" : "text-ranga-uwaga"}`}>
            {szkic.length} / {LIMIT_ALLEGRO}</span>}
          <PrzyciskZalacznika dodaje={dodajeZalacznik}
            onDodaj={onDodajZalacznik} wylaczone={cudza} />
          {/* ── JEDNO DZIAŁANIE MA BYĆ NAJGŁOŚNIEJSZE (0.247.0) ───────────────
              Wysyłka jest jedyną drogą, którą treść wychodzi z WERTIS na
              zewnątrz, i idzie WYŁĄCZNIE na kliknięcie człowieka — innej drogi
              wysyłki w kodzie nie ma. Dostaje większy stopień pisma, wyższy
              padding i cień; zapis szkicu schodzi do zwykłego tekstu.
              Od 0.495.0 stoi NA PRAWYM KOŃCU paska, pod kciukiem myszy
              przesuwanej od dymka — tam, gdzie kończy się czytanie odpowiedzi. */}
          <Przycisk wariant="glowny" onClick={onWyslij} disabled={cudza || wysyla || !szkic.trim()}
            className="whitespace-nowrap px-5 py-2.5 text-tresc shadow-sm">
            <Send size={17} />{wysyla ? "Wysyłam…" : niesprawdzone.length ? "Wyślij bez zmian" : "Wyślij do klienta"}
            {/* Skrót NA PRZYCISKU (dekalog, punkt 2): o skrócie, o którym nikt
                nie wie, nikt nie skorzysta. Poza nazwą dostępną przycisku. */}
            {/* Przy tarciu w miejscu podpisu skrótu staje liczba twierdzeń:
                pasek ma zostać w jednym rzędzie, a skrót działa dalej
                i zostaje w `aria-keyshortcuts`. */}
            {niesprawdzone.length
              ? <span className="ml-1 rounded bg-white/70 px-1 text-podpis text-amber-950">
                  {niesprawdzone.length} do sprawdzenia</span>
              : <kbd aria-hidden="true" className="ml-1 rounded bg-black/10 px-1 font-sans text-podpis">Ctrl+Enter</kbd>}
          </Przycisk>
          <InneWysylki onZapisz={onZapisz} zapisuje={zapisuje} cudza={cudza}
            onWyslijIZakoncz={onWyslijIZakoncz} mozeWyslac={!cudza && !wysyla && !!szkic.trim()} />
        </>}
  </div>
  </>;
}

/** Limit treści `NewMessageInThread` w Allegro — ten sam, którego pilnuje serwer (`LIMIT_ZNAKOW`). */
const LIMIT_ALLEGRO = 2000;

/* ── „▾" OBOK WYSYŁKI (0.506.0) ─────────────────────────────────────────────
   Pasek niósł pięć rzeczy: licznik, spinacz, „Zapisz szkic", „Wyślij
   i zakończ" z napisem skrótu i „Wyślij do klienta" z drugim. Najgłośniejsze
   ma zostać jedno — wysyłka (0.247.0). Dwie rzadsze drogi stoją pod
   strzałką, a „Wyślij i zakończ" dalej chodzi z klawiatury Ctrl+Shift+Enter.
   Okienko otwiera się W GÓRĘ, bo pasek pływa przy dolnej krawędzi osi. */
function InneWysylki({ onZapisz, zapisuje, cudza, onWyslijIZakoncz, mozeWyslac }: {
  onZapisz: () => void; zapisuje: boolean; cudza: boolean;
  onWyslijIZakoncz?: () => void; mozeWyslac: boolean;
}) {
  const { otwarte, setOtwarte, ramka } = useOkienko<HTMLDivElement>();
  return <div ref={ramka} className="relative">
    <button type="button" aria-label="Inne sposoby wysłania" aria-expanded={otwarte}
      title="Wyślij i zakończ · Zapisz szkic" onClick={() => setOtwarte((o) => !o)}
      className="inline-flex h-10 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
      <ChevronDown size={17} /></button>
    {otwarte && <div role="group" aria-label="Inne sposoby wysłania"
      className="absolute bottom-full right-0 z-30 mb-2 flex w-64 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
      {/* Zakończenie jedzie z wysyłką w tej samej transakcji (23 września 2026):
          nieudana wysyłka niczego nie kończy. */}
      {onWyslijIZakoncz && <button type="button" disabled={!mozeWyslac}
        aria-keyshortcuts="Control+Shift+Enter" title="Ctrl+Shift+Enter"
        onClick={() => { setOtwarte(false); onWyslijIZakoncz(); }}
        className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
        Wyślij i zakończ<span className="text-podpis font-normal text-slate-600">Ctrl+Shift+Enter</span></button>}
      <button type="button" disabled={cudza || zapisuje}
        onClick={() => { setOtwarte(false); onZapisz(); }}
        className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {zapisuje ? "Zapisuję…" : "Zapisz szkic"}</button>
    </div>}
  </div>;
}
