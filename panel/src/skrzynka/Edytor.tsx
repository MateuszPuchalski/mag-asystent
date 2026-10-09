import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Eraser, Lock, MessageSquare, Send, Undo2 } from "lucide-react";
import { Przycisk } from "../ui";
import { PrzyciskZalacznika, ZalacznikiWysylki } from "./ZalacznikiWysylki";
import { KartaSzkicu, PasekSzkicu, PrzyciskSzkicu, UwagiSzkicu,
  type PropsSzkicuCopilota } from "./SzkicCopilota";
import type { ZalacznikSzkicu } from "../api/rozmowy";
import { doSprawdzenia } from "./ProcesCopilota";
import { useOkienko } from "./MenuRozmowy";
import { klawiszZajety, useSkrotyDzialaja } from "../nawigacja/fokus";

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
 * A — szkic Copilota stoi W POLU, jako zwykły tekst do poprawiania;
 * B — edytor jest ostatnią wypowiedzią osi, z jednym przewijaniem na całość.
 * Komponent zwraca podpis i dymek z działaniami w środku. Wołający wstawia
 * je na koniec listy wypowiedzi.
 *
 * ── WĄTEK PIERWSZY: PUSTY EDYTOR TO JEDNA LINIJKA (0.548.0) ───────────────
 * Wariant C z płótna „Skrzynka — warianty”, decyzja właściciela z 28 września.
 * Przy 1180 px wątek miał około 190 px, bo pusty edytor z zakładkami i polem
 * na pięć linii stał pod nim, zanim agent napisał choć słowo. Teraz pusty
 * edytor to jeden przyklejony rząd z polem i „Wyślij” w środku. Rozwija się
 * sam, gdy jest co pokazać: pierwsza litera, szkic zespołu albo Copilota,
 * notatka, załącznik, cofnięcie wyczyszczenia. Pole jest przez cały czas TYM
 * SAMYM elementem w tym samym rodzicu, więc przy rozwinięciu nie traci
 * fokusu w pół słowa. Notatkę otwiera N z tła strony albo przycisk w rzędzie.
 *
 * ── JEDEN EDYTOR TRZECH KOLEJEK (0.549.0) ─────────────────────────────────
 * Decyzja właściciela z 28 września: reklamacje i dyskusje odpowiadają tym
 * samym edytorem, w tym samym miejscu wątku. Osobny edytor sprawy rozjeżdżał
 * się z tym przy każdym wydaniu: nie miał zwiniętego rzędu, czyszczenia
 * z cofnięciem, Entera z tła ani Ctrl+Enter spoza pola. To, co w sprawie
 * Allegro jest naprawdę inne, wchodzi ustawieniem, nie kopią:
 * - notatka z wzmiankami istnieje tylko w skrzynce, więc zakładki, przycisk
 *   „Notatka” i klawisz N żyją tylko przy `onDodajKomentarz`. W sprawach
 *   N znaczy „niczyje” i ten edytor nie ma prawa go przechwycić;
 * - etykieta wysyłki, bo w sprawie odbiorcą bywa doradca Allegro;
 * - sufit znaków (2000 w Centrum Wiadomości, 20 000 w sprawie);
 * - zamknięty czat, przy którym pola nie ma wcale.
 * Ustawienia sprawy trzyma adapter `reklamacje/Edytor.tsx`.
 */
export function Edytor({
  szkic, cudza = false, wlasciciel = null, zapisuje = false, wysyla, onZmiana, onZapisz, onWyslij,
  onWyslijIZakoncz,
  komentarz = "", onKomentarz, onDodajKomentarz, komentuje = false, agenci = [], wzmianki = [], onWzmianki,
  doNotatki, zalaczniki, dodajeZalacznik, bladZalacznika, onDodajZalacznik, onUsunZalacznik, copilot,
  etykietaWyslij = "Wyślij do klienta", limitZnakow = LIMIT_ALLEGRO, etykietaPola = "Szkic odpowiedzi",
  podpowiedz = "Szkic odpowiedzi — współdzielony z zespołem",
  podpowiedzZwinieta = "Odpowiedz klientowi…", blad = "", zamkniete = null,
  podpis = "Twoja odpowiedź · szkic, widzi go zespół",
}: {
  szkic: string;
  /** Rozmowę prowadzi ktoś inny — szkic zapisze tylko on. Tylko skrzynka. */
  cudza?: boolean;
  wlasciciel?: string | null;
  zapisuje?: boolean;
  wysyla: boolean;
  onZmiana: (v: string) => void;
  /** „Zapisz szkic” — tylko tam, gdzie szkic stoi na serwerze (skrzynka). */
  onZapisz?: () => void;
  onWyslij: () => void;
  /** „Wyślij i zakończ" (23 września 2026) — większość spraw kończy się ostatnią odpowiedzią. */
  onWyslijIZakoncz?: () => void;
  /* Notatka zespołu — cała grupa albo nic. Bez `onDodajKomentarz` nie ma
     zakładek: przełącznik z jedną pozycją niczego nie wybiera. */
  komentarz?: string;
  onKomentarz?: (v: string) => void;
  /** Licznik zmian z ekranu: każda przełącza tryb na notatkę (prośba o przekazanie). */
  doNotatki?: number;
  onDodajKomentarz?: () => void;
  komentuje?: boolean;
  agenci?: Array<{ userId: number; name: string }>;
  wzmianki?: number[];
  onWzmianki?: (v: number[]) => void;
  /* Załączniki (0.195.0) — TYLKO w trybie odpowiedzi. Komentarz wewnętrzny
     nigdzie nie wychodzi, więc dołączanie do niego pliku nie miałoby dokąd
     pójść, a przycisk obok notatki sugerowałby, że ma. Bez obsługi pliku
     spinacza nie ma: czego nie da się zrobić, tego nie ma na ekranie. */
  zalaczniki: ZalacznikSzkicu[];
  dodajeZalacznik: boolean;
  bladZalacznika: string;
  onDodajZalacznik?: (plik: File) => void;
  onUsunZalacznik?: (id: number) => void;
  /* Szkic z Copilota (0.231.0) — TYLKO w trybie odpowiedzi: propozycja jest
     dla klienta, a w komentarzu nie ma czego układać. Opcjonalny, bo sprawy
     Allegro i testy komentarza nie mają Copilota wcale. */
  copilot?: PropsSzkicuCopilota;
  /** Napis wysyłki. W sprawie „Wyślij odpowiedź”, bo odbiorcą bywa doradca Allegro. */
  etykietaWyslij?: string;
  /** Sufit treści u odbiorcy; powyżej wysyłka jest martwa, także z klawiatury. */
  limitZnakow?: number;
  /** Nazwa pola dla czytnika ekranu. */
  etykietaPola?: string;
  /** Podpowiedź w pustym rozwiniętym polu; dopisek o Enterze edytor dokleja sam. */
  podpowiedz?: string;
  /** Podpowiedź w zwiniętym rzędzie — krótka, bo dzieli rząd z przyciskami. */
  podpowiedzZwinieta?: string;
  /** Zdanie o nieudanej wysyłce, pod polem. */
  blad?: string;
  /** Zdanie, gdy odbiorca nie przyjmie już wiadomości. Pola odpowiedzi wtedy
      nie ma; notatka zespołu, jeśli edytor ją niesie, zostaje. */
  zamkniete?: string | null;
  /** Podpis nad dymkiem: kto pisze i kto zobaczy szkic, przed pierwszym „ · ” pogrubiony. */
  podpis?: string;
}) {
  const [tryb, setTryb] = useState<"odpowiedz" | "komentarz">("odpowiedz");
  const zNotatka = onDodajKomentarz !== undefined;
  const wKomentarzu = zNotatka && tryb === "komentarz";
  /* Ten sam warunek dla przycisku i obu skrótów: pusta treść, sufit znaków,
     cudza rozmowa, trwająca wysyłka i zamknięty czat blokują każdą drogę tak
     samo. Zamknięty czat liczy się osobno, bo szkic sprawy przeżywa w sesji
     przeglądarki, a Ctrl+Enter z tła strony nie patrzy, czy pole istnieje. */
  const zaDlugo = szkic.length > limitZnakow;
  const mozeWyslac = !zamkniete && !cudza && !wysyla && !zaDlugo && szkic.trim() !== "";
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

     ENTER — do pola, kursor na końcu. Tylko z tła strony albo z wybranego
     wiersza kolejki; na przycisku Enter dalej go naciska.
     CTRL+ENTER (i Ctrl+Shift+Enter) — wysyłka także spoza pola, tym samym
     warunkiem co przycisk. Nie w trybie notatki: tam przycisku wysyłki nie
     ma w drzewie (§10.4) i skrót nie może go udawać.

     Oba klawisze działają spoza pola TYLKO z tła, z wybranego wiersza albo
     z wnętrza edytora. Obok odpowiedzi w sprawie stoją werdykt i prośba
     o zakończenie: Ctrl+Enter z fokusem na ich przycisku wysyłał szkic,
     którego agent w tej chwili nie wysyłał. */
  const pole = useRef<HTMLTextAreaElement>(null);
  const dymek = useRef<HTMLElement>(null);
  const pasek = useRef<HTMLDivElement>(null);
  const poleNotatki = useRef<HTMLTextAreaElement>(null);
  /* Notatka otwarta klawiszem dostaje fokus od razu: N z tła strony ma
     kończyć się w polu, w którym pisze się dalej, nie na przełączniku. */
  const [fokusNotatki, setFokusNotatki] = useState(false);
  useEffect(() => {
    if (fokusNotatki && wKomentarzu) { poleNotatki.current?.focus(); setFokusNotatki(false); }
  }, [fokusNotatki, wKomentarzu]);
  const zamontowany = useRef(Date.now());
  const skrotyDzialaja = useSkrotyDzialaja();
  const klawisz = useRef<(e: KeyboardEvent) => void>(() => {});
  klawisz.current = (e: KeyboardEvent) => {
    /* N — NOTATKA (0.548.0). Pusty edytor chowa przełącznik zakładek, więc
       notatka potrzebuje drogi z klawiatury. N nie jest zajęte w skrzynce.
       W reklamacjach i dyskusjach znaczy „niczyje”, a tam notatki w edytorze
       nie ma, więc warunek `zNotatka` oddaje klawisz ekranowi. */
    if ((e.key === "n" || e.key === "N") && zNotatka && !wKomentarzu && !e.ctrlKey && !e.metaKey && !e.altKey
      && !e.isComposing && !klawiszZajety(e.target)) {
      e.preventDefault();
      setTryb("komentarz");
      setFokusNotatki(true);
      return;
    }
    if (e.key !== "Enter" || wKomentarzu || e.altKey || e.isComposing || klawiszZajety(e.target)) return;
    const cel = e.target as HTMLElement | null;
    /* Tylko z WYBRANEGO wiersza: na innym wierszu, do którego agent doszedł
       Tabem, Enter ma go otworzyć, a nie pisać w sprawie, która już stoi. */
    const wiersz = cel?.closest("[data-wiersz-kolejki]");
    const zTla = !cel || cel === document.body || wiersz?.getAttribute("aria-current") === "true";
    const wEdytorze = !!cel && (!!dymek.current?.contains(cel) || !!pasek.current?.contains(cel));
    if (e.ctrlKey || e.metaKey) {
      if (!zTla && !wEdytorze) return;
      e.preventDefault();
      if (Date.now() - zamontowany.current < ZWLOKA_KLAWISZA_MS) return;
      if (mozeWyslac) {
        if (e.shiftKey && onWyslijIZakoncz) onWyslijIZakoncz(); else onWyslij();
      }
      return;
    }
    if (e.shiftKey || cudza || !zTla) return;
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

  /* ZWINIĘTY = NIC DO POKAZANIA POZA POLEM. Karta Copilota liczy się tym
     samym warunkiem, którym `KartaSzkicu` decyduje, czy się rysuje. */
  const kartaSzkicu = Boolean(copilot?.szkic && (copilot.szkic.ocena === null
    || (wPolu && copilot.szkic.ocena !== "odrzucony")));
  /* Wgrywany plik, błąd załącznika i błąd wysyłki też rozwijają: jedyne
     miejsce, które je mówi, stoi w rozwiniętym dymku. Zwinięty rząd
     zostawiał po odmowie serwera ciszę. */
  const zwiniety = !wKomentarzu && szkic === "" && !cudza && zalaczniki.length === 0
    && !dodajeZalacznik && !bladZalacznika && !blad
    && wyczyszczone === null && !kartaSzkicu && niesprawdzone.length === 0;

  const przelacz = (id: number) => onWzmianki?.(
    wzmianki.includes(id) ? wzmianki.filter((x) => x !== id) : [...wzmianki, id]);

  /* Ten sam przycisk w zwiniętym rzędzie i przy zamkniętej rozmowie, żeby
     notatka miała jedno miejsce i jeden wygląd, niezależnie od stanu wątku. */
  const przyciskNotatki = zNotatka && <button type="button"
    onClick={() => { setTryb("komentarz"); setFokusNotatki(true); }}
    aria-keyshortcuts="N" aria-label="Notatka wewnętrzna"
    title="Notatka wewnętrzna — zobaczy ją tylko zespół (N)"
    className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
    <MessageSquare size={15} />Notatka
    {/* Znaczek klawisza tylko wtedy, gdy klawisz działa (0.500.0). */}
    {skrotyDzialaja && <kbd aria-hidden="true" className="rounded border border-slate-300 px-1 font-sans text-podpis text-slate-600">N</kbd>}
  </button>;

  /* ZAMKNIĘTEJ ROZMOWY NIE DA SIĘ NAPISAĆ, więc edytora NIE MA — nie jest
     wyłączony, tylko go nie ma w drzewie. Pole, w które wolno pisać, a którego
     nie da się wysłać, jest obietnicą bez pokrycia. Warunek stoi po hakach,
     bo te muszą biec przy każdym rysowaniu.

     Notatka zespołu nie idzie do Allegro, więc zamknięcie jej nie dotyczy.
     W skrzynce zamknięty Problem z zakupem dalej bywa tematem zespołu.
     Zdanie zajmuje więc miejsce pola, a obok stoi „Notatka”, jak w zwiniętym
     rzędzie. Tryb notatki rysuje się zwyczajnie, bez wysyłki w drzewie. */
  if (zamkniete && !wKomentarzu) {
    if (!przyciskNotatki) {
      return <p className="ml-auto w-[86%] max-w-[75ch] rounded-xl rounded-br border border-dashed border-slate-300 px-3.5 py-2 text-xs text-slate-600">
        {zamkniete}</p>;
    }
    return <div className="ml-auto flex w-[86%] max-w-[75ch] items-center gap-2 rounded-xl rounded-br border border-dashed border-slate-300 py-1 pl-3.5 pr-1">
      <p className="min-w-0 flex-1 py-1 text-xs text-slate-600">{zamkniete}</p>
      {przyciskNotatki}
    </div>;
  }

  /* ── DYMEK PO NASZEJ STRONIE, DZIAŁANIA W ŚRODKU ─────────────────────────
     Makieta właściciela: edytor jest następną naszą wypowiedzią, więc stoi
     dymkiem po prawej, jak nasze odpowiedzi, z tym samym „ogonkiem” w rogu.
     Pełna ramka i błękitna poświata mówią, że to miejsce pisania, a podpis
     nad dymkiem, kto zobaczy szkic. Pasek działań stoi w dymku, pod treścią,
     bo należy do tej jednej wiadomości. Pływający pasek obok pola wyglądał
     jak osobny element ekranu.

     Wysoki szkic wydłuża przewijanie, zamiast ściskać rozmowę: dymek i wątek
     przewijają się razem. Szerokość 86% jak dymki rozmowy, z progiem 75ch,
     bo dłuższy wiersz czyta się gorzej. */
  const [kto, ...reszta] = (wKomentarzu ? "Twoja notatka · zobaczy ją tylko zespół" : podpis).split(" · ");
  const narzedzia = !wKomentarzu
    && (Boolean(copilot) || (szkic !== "" && !cudza) || (szkic === "" && wyczyszczone !== null));
  const ramka = wKomentarzu ? "border-amber-300 bg-amber-50 ring-amber-100"
    : wPolu ? "border-violet-300 bg-white ring-violet-50" : "border-blue-300 bg-white ring-blue-50";
  /* Licznik stoi zawsze, bo makieta tak go pokazuje, i mówi pełną liczbą
     po polsku. Barwę dostaje dopiero przy progu, bo dopiero tam zmienia
     decyzję. Próg rośnie z sufitem, ale najwyżej do 500 znaków przed nim. */
  const blisko = szkic.length >= limitZnakow - Math.min(500, limitZnakow / 5);
  /* OPAKOWANIE STOI ZAWSZE, bo pole nie ma prawa zmienić rodziców przy
     pierwszej literze. Zwinięte przykleja się do dolnej krawędzi, a podpis
     staje w nim dopiero po rozwinięciu: rząd ma zostać jedną linijką. */
  return <div className={zwiniety ? "sticky bottom-2 z-10 ml-auto w-[86%] max-w-[75ch]"
    : "ml-auto flex w-[86%] max-w-[75ch] flex-col gap-1"}>
  {!zwiniety && <span className="text-right text-xs text-slate-600">
    <b className="font-semibold text-wertis-ink">{kto}</b>{reszta.length > 0 && ` · ${reszta.join(" · ")}`}</span>}
  <article ref={dymek} aria-label={wKomentarzu ? "Twoja notatka" : "Twoja odpowiedź"}
    className={zwiniety
      /* `focus-within`: pole w rzędzie nie ma własnej ramki, więc fokus
         pokazuje rama rzędu (WCAG 2.4.7). */
      ? "rounded-xl rounded-br border border-blue-300 bg-white py-1.5 pl-3.5 pr-1.5 shadow-lg ring-[3px] ring-blue-50 focus-within:border-blue-600"
      : `flex flex-col rounded-xl rounded-br border ring-[3px] focus-within:border-blue-600 ${ramka}`}>
    {/* ── PRZEŁĄCZNIK JEST JEDNYM ELEMENTEM, NIE DWOMA ─────────────────────
        Dwa luźne przyciski o tej samej wadze nie mówiły, że wybiera się JEDEN
        z dwóch. Bieżnia z tłem i wyniesiony kafelek to kształt przełącznika
        z każdego innego programu, więc nie wymaga czytania. Stoi NAD polem,
        żeby było widać, gdzie się pisze, zanim się zacznie pisać.

        Nieaktywna połowa ma `slate-600`: `slate-500` na bieżni `slate-100`
        daje 4.34:1 przy progu 4.5:1. */}
    {!zwiniety && (zNotatka || narzedzia) && <div className="flex items-center gap-2 px-3.5 pt-2.5">
      {zNotatka && <div className={`flex gap-0.5 rounded-lg p-0.5 ${wKomentarzu ? "bg-amber-100" : "bg-slate-100"}`}>
        <button className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${!wKomentarzu
          ? "bg-white font-semibold text-slate-900 shadow-sm" : "font-medium text-slate-600"}`}
          onClick={() => setTryb("odpowiedz")}>Odpowiedź do klienta</button>
        <button className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${wKomentarzu
          ? "bg-white font-semibold text-amber-900 shadow-sm" : "font-medium text-slate-600"}`}
          onClick={() => setTryb("komentarz")}>
          {/* JEDNA NAZWA, NIE DWIE: „notatka”, jak na osi rozmowy. Nazwy
              w kodzie (`komentarz`, `onDodajKomentarz`) zostają, bo ekran
              ich nie pokazuje. */}
          <MessageSquare size={13} />Notatka wewnętrzna
        </button>
      </div>}
      {/* Copilot w tym samym rzędzie co czyszczenie: własny rząd zabierał
          wysokość, a `PrzyciskSzkicu` nie zajmuje więcej niż jednej linii. */}
      {narzedzia && <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
        {copilot && <PrzyciskSzkicu p={copilot} />}
        {szkic !== "" && !cudza && <button type="button" onClick={wyczysc}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <Eraser size={13} />Wyczyść wszystko</button>}
        {szkic === "" && wyczyszczone !== null && <button type="button"
          onClick={() => { onZmiana(wyczyszczone); setWyczyszczone(null); }}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-sky-800 hover:bg-sky-50">
          <Undo2 size={13} />Cofnij wyczyszczenie</button>}
      </div>}
    </div>}

    {wKomentarzu
      ? <div className="px-3.5 pt-2.5">
          <textarea ref={poleNotatki}
            className="block min-h-[88px] w-full resize-y bg-transparent py-1 text-tresc text-wertis-ink outline-none [field-sizing:content]"
            value={komentarz}
            aria-label="Notatka wewnętrzna — zobaczy ją tylko zespół"
            onChange={(e) => onKomentarz?.(e.target.value)}
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
        </div>
      : <>
          {cudza && <p className="flex items-center gap-2 px-3.5 pt-2.5 text-xs text-slate-500">
            <Lock size={13} />Rozmowę prowadzi {wlasciciel} — szkic zapisze tylko właściciel.</p>}
          {wPolu && copilot && <div className="px-3.5 pt-2.5"><PasekSzkicu p={copilot} wPolu /></div>}
          {/* ── POLE ROŚNIE Z TREŚCIĄ ────────────────────────────────────────
              Pole stoi w tym samym przewijaniu co rozmowa i niczego jej nie
              odejmuje. `field-sizing: content` rośnie z tekstem od progu
              120 px, bez skryptu mierzącego wysokość. Przeglądarka bez tej
              własności dostaje próg i `resize-y`. Ramki pole nie ma, bo
              ramką jest dymek. */}
          {/* STAŁY RODZIC POLA: zwinięty rząd i rozwinięty dymek różnią się
              klasami, a nie drzewem. Inny rodzic przemontowałby pole
              i zabrał mu fokus przy pierwszej literze. */}
          <div className={zwiniety ? "flex items-center gap-2" : ""}>
          <textarea ref={pole} className={zwiniety
            /* Stała wysokość jednej linii, bez `field-sizing`: puste pole
               mierzyło się podpowiedzią i zawijało rząd na dwie linie.
               Zwinięte pole jest zawsze puste, bo pierwsza litera je rozwija. */
            ? "h-10 min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-2 text-tresc outline-none"
            : `block min-h-[7.5rem] w-full resize-y px-3.5 pb-1.5 pt-3 text-tresc text-wertis-ink outline-none [field-sizing:content] ${
              wPolu ? "bg-violet-50" : "bg-transparent"}`}
            rows={zwiniety ? 1 : undefined} value={szkic}
            aria-label={etykietaPola} aria-keyshortcuts="Control+Enter"
            onChange={(e) => { if (e.target.value !== "") setWyczyszczone(null); onZmiana(e.target.value); }}
            /* CTRL+ENTER WYSYŁA. Ten sam warunek co przycisk niżej — skrót
               nie ma prawa ominąć blokady cudzej rozmowy. Sam Enter zostaje
               nową linią, bo odpowiedź ma akapity. */
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
              e.preventDefault();
              /* Ctrl+Shift+Enter — „Wyślij i zakończ”. */
              if (mozeWyslac) {
                if (e.shiftKey && onWyslijIZakoncz) onWyslijIZakoncz(); else onWyslij();
              }
            }}
            /* Podpowiedź Entera tylko wtedy, gdy Enter prowadzi do pola —
               w samym polu robi nową linię (dekalog p. 2, `nawigacja/fokus.ts`). */
            placeholder={zwiniety
              /* Klawisz notatki stoi na jej przycisku, nie tu: podpowiedź
                 z oboma klawiszami zawijała się i ucinała przy 1180 px. */
              ? (skrotyDzialaja ? `${podpowiedzZwinieta} (Enter)` : podpowiedzZwinieta)
              : skrotyDzialaja && !cudza ? `${podpowiedz} · Enter, żeby pisać` : podpowiedz} />
          {zwiniety && <>
            {/* Copilot w rzędzie tylko jako czynność. Zdanie o wyłączonym
                Copilocie zjadłoby rząd, a nic się z nim nie zrobi. */}
            {copilot?.stan?.wlaczony && <PrzyciskSzkicu p={copilot} />}
            {przyciskNotatki}
            {onDodajZalacznik && <PrzyciskZalacznika dodaje={dodajeZalacznik}
              onDodaj={onDodajZalacznik} wylaczone={cudza || wysyla} />}
            {/* Martwa, dopóki pole jest puste. Stoi, żeby było widać, gdzie
                wysyłka będzie, zanim padnie pierwsze słowo. „Wyślij”, nie
                pełna nazwa: rząd dzieli szerokość z polem. Pełna nazwa
                zostaje dla czytnika i zawiera widoczne słowo. */}
            <Przycisk wariant="glowny" disabled aria-label={etykietaWyslij} className="shrink-0 whitespace-nowrap">
              <Send size={16} />Wyślij</Przycisk>
          </>}
          </div>
          {!zwiniety && <div className="flex flex-col px-3.5">
          {/* Błąd wysyłki PRZY POLU, nie w rogu ekranu: tu agent patrzy,
              gdy wysyłka nie wyszła, i tu poprawia treść. */}
          {blad && <p role="alert" className="mt-2 text-xs text-red-700">{blad}</p>}
          {uwagiPoPrzyjeciu.length > 0 && <div className="mt-2"><UwagiSzkicu uwagi={uwagiPoPrzyjeciu} /></div>}
          {/* Po „Wyczyść wszystko" karta stoi zwinięta: pusty znaczy pusty,
              a szkic wraca jednym kliknięciem „Wstaw do odpowiedzi". */}
          {copilot && <KartaSzkicu p={copilot} wPolu={wPolu} zwinieta={wyczyszczone !== null} />}
          {/* Lista dołożonych plików stoi POD treścią: należy do komponowanej
              wiadomości, a spinacz jedzie w pasku działań.
              W trakcie wysyłki lista i spinacz stoją: serwer bierze pliki
              na początku wysyłki i czyści listę po niej, więc plik dodany
              w tym oknie wgrałby się do Allegro i zniknął bez słowa. */}
          {onUsunZalacznik && <ZalacznikiWysylki lista={zalaczniki} blad={bladZalacznika}
            onUsun={onUsunZalacznik} wylaczone={cudza || wysyla} />}
          {niesprawdzone.length > 0 && <section aria-label="Do sprawdzenia przed wysłaniem"
            className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <b>Szkic bez zmian — te twierdzenia nie pochodzą z naszej bazy:</b>
            <ul className="mt-1 list-disc pl-4">
              {niesprawdzone.slice(0, 3).map((t, i) => <li key={i}>{t.teza}</li>)}
            </ul>
            {niesprawdzone.length > 3 && <p className="mt-1">i {niesprawdzone.length - 3} więcej w „Skąd to wiem".</p>}
          </section>}
          </div>}
        </>}

    {!zwiniety && <div ref={pasek} role="group" aria-label={wKomentarzu ? "Działania notatki" : "Działania odpowiedzi"}
      className={`mt-2 flex flex-wrap items-center gap-2 border-t py-2 pl-3.5 pr-2.5 ${
        wKomentarzu ? "border-amber-200" : "border-blue-50"}`}>
      {wKomentarzu
        ? <>
            {/* Notatka nie ma limitu znaków, bo serwer żadnego nie trzyma,
                więc licznik nie miałby progu, przy którym coś znaczy.
                Komentowanie NIE wymaga prowadzenia rozmowy: kolega ma prawo
                dopisać „to ten sam klient co wczoraj” bez przejmowania. */}
            <Przycisk wariant="glowny" disabled={komentuje || !komentarz.trim()}
              title="Widoczna tylko dla zespołu — klient jej nie zobaczy"
              onClick={() => onDodajKomentarz?.()} className="ml-auto whitespace-nowrap">
              <MessageSquare size={16} />{komentuje ? "Zapisuję…" : "Dodaj notatkę"}
            </Przycisk>
          </>
        : <>
            {onDodajZalacznik && <PrzyciskZalacznika dodaje={dodajeZalacznik}
              onDodaj={onDodajZalacznik} wylaczone={cudza || wysyla} />}
            {/* Za sufitem licznik mówi, ile skrócić, bo wysyłka jest wtedy martwa. */}
            <span className={`ml-auto whitespace-nowrap text-xs tabular-nums ${
              zaDlugo ? "font-semibold text-ranga-zle" : blisko ? "font-semibold text-ranga-uwaga" : "text-slate-600"}`}>
              {LICZBA.format(szkic.length)} / {LICZBA.format(limitZnakow)}
              {zaDlugo ? ` — o ${LICZBA.format(szkic.length - limitZnakow)} za dużo` : ""}</span>
            {/* ── JEDNO DZIAŁANIE MA BYĆ NAJGŁOŚNIEJSZE ─────────────────────
                Wysyłka jest jedyną drogą, którą treść wychodzi z WERTIS na
                zewnątrz, i idzie WYŁĄCZNIE na kliknięcie człowieka. Stoi na
                prawym końcu dymka, tam, gdzie kończy się czytanie odpowiedzi.
                Skrót mówi podpowiedź i `aria-keyshortcuts`: znaczek na
                przycisku zabierał miejsce w rzędzie, który dzieli licznik. */}
            <Przycisk wariant="glowny" onClick={onWyslij} disabled={!mozeWyslac}
              aria-keyshortcuts="Control+Enter" title="Ctrl+Enter wysyła także spoza pola"
              className="whitespace-nowrap shadow-sm">
              <Send size={16} />{wysyla ? "Wysyłam…" : niesprawdzone.length ? "Wyślij bez zmian" : etykietaWyslij}
              {/* Przy tarciu obok napisu staje liczba twierdzeń do sprawdzenia. */}
              {niesprawdzone.length > 0 && <span className="ml-1 rounded bg-white/70 px-1 text-podpis text-amber-950">
                {niesprawdzone.length} do sprawdzenia</span>}
            </Przycisk>
            {/* Strzałka tylko wtedy, gdy ma co pokazać: pusta lista pod
                przyciskiem to obietnica bez pokrycia. */}
            {(onZapisz || onWyslijIZakoncz) && <InneWysylki onZapisz={onZapisz} zapisuje={zapisuje}
              cudza={cudza} onWyslijIZakoncz={onWyslijIZakoncz} mozeWyslac={mozeWyslac} />}
          </>}
    </div>}
  </article>
  </div>;
}

/** Limit treści `NewMessageInThread` w Allegro — ten sam, którego pilnuje serwer (`LIMIT_ZNAKOW`). */
const LIMIT_ALLEGRO = 2000;

/* Licznik po polsku: „20 000”, nie „20000”. Polska norma grupuje dopiero od
   pięciu cyfr, więc sufit skrzynki stoi jako „2000”. */
const LICZBA = new Intl.NumberFormat("pl-PL");

/* ── „▾" OBOK WYSYŁKI (0.506.0) ─────────────────────────────────────────────
   Pasek niósł pięć rzeczy: licznik, spinacz, „Zapisz szkic", „Wyślij
   i zakończ" z napisem skrótu i „Wyślij do klienta" z drugim. Najgłośniejsze
   ma zostać jedno — wysyłka (0.247.0). Dwie rzadsze drogi stoją pod
   strzałką, a „Wyślij i zakończ" dalej chodzi z klawiatury Ctrl+Shift+Enter.
   Okienko otwiera się W GÓRĘ, bo dymek edytora stoi na dole osi rozmowy. */
function InneWysylki({ onZapisz, zapisuje, cudza, onWyslijIZakoncz, mozeWyslac }: {
  onZapisz?: () => void; zapisuje: boolean; cudza: boolean;
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
      {onZapisz && <button type="button" disabled={cudza || zapisuje}
        onClick={() => { setOtwarte(false); onZapisz(); }}
        className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {zapisuje ? "Zapisuję…" : "Zapisz szkic"}</button>}
    </div>}
  </div>;
}
