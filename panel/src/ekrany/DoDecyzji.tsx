import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Barcode, ChevronRight, CircleCheck, Inbox, ListChecks, MessageSquareReply,
  FlaskConical, MessagesSquare, Package, PackageSearch, PlugZap, ShieldQuestion, Truck, Undo2,
  ClipboardList, AtSign, Briefcase,
} from "lucide-react";
import { useDoDecyzji, type Obszar, type PozycjaDecyzji, type ZrodloDecyzji } from "../api/decyzje";
import { useMojeSprawy, useWzmianki } from "../api/rozmowy";
import { useSledzDosylkeZwrotu } from "../api/zwroty";
import type { DosylkaZalozona } from "../api/typy";
import { Blad, FiltrSegmentowy, Karta, NaglowekSekcji, Przycisk, Pusto, wiek } from "../ui";
import { Moje, widoczneSprawy } from "./Moje";
import { Wzmianki } from "./Wzmianki";

/* ── DO DECYZJI — ekran startowy biura (0.435.0) ───────────────────────────
   Cel biura z `docs/obsluga-klienta.md` §7: rozstrzyga to, czego hala nie
   rozstrzygnie sama. Ten ekran jest tym celem w jednym widoku — dlatego
   stoi pod `/obsluga/`, a Zadania poszły pod `/obsluga/zadania`.

   WIERSZ PROWADZI TAM, GDZIE SPRAWĘ SIĘ ROZSTRZYGA. Tu nie ma przycisków
   decyzji: wyjątek dostawy rozstrzyga się przy fakturze i jej zdjęciach,
   reklamację przy czacie z kupującym. Przycisk „uznaj" na tej liście
   kazałby decydować bez dowodów — a to jest dokładnie to, czego biuro
   robić nie powinno. Ta sama zasada co w „Moje".

   JEDEN WYJĄTEK (0.541.0, decyzja właściciela z 27 września 2026): „Śledź
   dosyłkę” przy odmowie złożonej w panelu Allegro. Decyzja już zapadła —
   biuro odmówiło kodem „Wysłaliśmy nowy towar” — a przycisk ją rejestruje
   w sprawie klienta. Dowodów do tego nie trzeba, a wiersz prowadzący na
   zwrot kosztowałby drugie kliknięcie za nic. Jeden skutek nie jest samą
   rejestracją: krok „dosłać” zastępuje krok ustawiony ręką, więc ekran
   mówi, co zastąpił. */

const IKONY: Record<ZrodloDecyzji, React.ComponentType<{ size?: number; className?: string }>> = {
  dostawy: Truck, odpowiedzi: MessageSquareReply, kosze: Package, zapisy: AlertTriangle,
  kody: Barcode, allegro: PlugZap, reklamacje: ShieldQuestion, zwroty: Undo2,
  skrzynka: Inbox, dyskusje: MessagesSquare, sonda: FlaskConical,
  /* Zadanie odesłane przez halę (0.502.0) — `odeslaneZadania` w `do-decyzji.ts`. */
  zadania: ClipboardList,
  dosylki: PackageSearch,
};

const NAZWY: Record<ZrodloDecyzji, string> = {
  dostawy: "Dostawy", odpowiedzi: "Odpowiedź z hali", kosze: "Kosze", zapisy: "Zapis do Subiekta",
  kody: "Kody kreskowe", allegro: "Konto Allegro", reklamacje: "Reklamacje", zwroty: "Zwroty",
  skrzynka: "Skrzynka", dyskusje: "Dyskusje", sonda: "Test na żywo", zadania: "Zadanie hali",
  dosylki: "Dosyłka",
};

type Filtr = "wszystko" | Obszar;

function Wiek({ p }: { p: PozycjaDecyzji }) {
  if (!p.od) return p.pilne
    ? <span className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-ranga-zle">pilne</span>
    : null;
  const ms = Math.max(0, Date.now() - Date.parse(p.od));
  /* Czerwień TYLKO przy pilnym — kolor zapalany zawsze uczy go ignorować
     (ta sama reguła co przy terminie w „Moje"). */
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold tabular-nums ${
    p.pilne ? "bg-red-100 text-ranga-zle" : "bg-slate-100 text-slate-600"}`}
    title={p.pilne ? "Termin minął albo mija" : "Od kiedy czeka"}>{wiek(ms)}</span>;
}

/* ── PYTANIE RAZ, SPRAWY POD NIM (@wydanie) ─────────────────────────────
   Decyzja właściciela z 27 września 2026, wariant B z makiet. Każdy wiersz
   powtarzał pytanie i źródło: sześć wierszy niosło trzy pytania, a nazwa
   źródła stała obok ikony, która mówiła to samo. Pytanie stoi teraz raz,
   w nagłówku grupy, a wiersz niesie tylko sprawę i jej wiek.

   PANEL NICZEGO NIE SORTUJE. Grupy stają tam, gdzie serwer postawił
   pierwszą sprawę z danym pytaniem, a w grupie zostaje kolejność serwera.
   Powód reguły z `do-decyzji.ts` — dwie reguły sortowania rozjechałyby się
   — dalej trzyma: tu nie ma drugiej reguły, jest podział listy serwera.
   Ceną jest to, że młodsza sprawa znanego pytania staje nad starszą
   sprawą innego. Biuro i tak rozstrzyga pytanie naraz dla całej grupy. */
export function grupujPoPytaniu(pozycje: PozycjaDecyzji[]): PozycjaDecyzji[][] {
  const grupy = new Map<string, PozycjaDecyzji[]>();
  for (const p of pozycje) {
    const klucz = `${p.zrodlo}\n${p.pytanie}`;
    const g = grupy.get(klucz);
    if (g) g.push(p); else grupy.set(klucz, [p]);
  }
  return [...grupy.values()];
}

function Grupa({ pozycje, onZalozona }: { pozycje: PozycjaDecyzji[]; onZalozona: (w: DosylkaZalozona) => void }) {
  const [pierwsza] = pozycje;
  const Ikona = IKONY[pierwsza!.zrodlo];
  return <li className="border-t border-slate-200 first:border-t-0">
    <h4 className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
        <Ikona size={16} /></span>
      <b>{pierwsza!.pytanie}</b>
      <span className="text-sm text-slate-600">{NAZWY[pierwsza!.zrodlo]} · {pozycje.length}</span>
    </h4>
    <ul className="pb-1.5">{pozycje.map((p) => <Wiersz key={p.klucz} p={p} onZalozona={onZalozona} />)}</ul>
  </li>;
}

function Wiersz({ p, onZalozona }: { p: PozycjaDecyzji; onZalozona: (w: DosylkaZalozona) => void }) {
  /* Wcięcie pod tekstem pytania, nie pod ikoną: oko zjeżdża z pytania
     prosto na sprawy, które ono obejmuje. */
  const tresc = <>
    <span className="min-w-0 flex-1 truncate text-sm">{p.co}</span>
    <Wiek p={p} />
  </>;
  if (p.akcja?.rodzaj === "sledz_dosylke") {
    return <WierszDosylki p={p} zwrotId={p.akcja.zwrotId} tresc={tresc} onZalozona={onZalozona} />;
  }
  /* Nazwa odnośnika niesie też pytanie: czytnik ekranu dostaje wiersz
     bez nagłówka grupy, a „FZ 802 · 2 wyjątki" samo nie mówi, co zrobić. */
  return <li>
    <Link to={p.cel.panel} aria-label={`${p.pytanie} — ${p.co}`}
      className="flex items-center gap-3 py-1.5 pl-14 pr-4 hover:bg-slate-50">{tresc}
      <ChevronRight size={18} className="shrink-0 text-slate-600" aria-hidden /></Link>
  </li>;
}

/**
 * Wiersz odmowy z panelu Allegro z przyciskiem „Śledź dosyłkę” (0.541.0).
 *
 * Przycisk stoi OBOK odnośnika, nie w nim: przycisk w `<a>` to niepoprawny
 * HTML, a kliknięcie łapałyby oba. Wiersz dalej prowadzi na zwrot — kto chce
 * spojrzeć na dowody przed kliknięciem, ma je o jedno kliknięcie dalej.
 * Po sukcesie wiersz schodzi sam, bo serwer liczy listę od nowa. Wynik
 * oddaje więc wyżej, zanim zniknie — zdanie o zastąpionym kroku musi go
 * przeżyć.
 */
function WierszDosylki({ p, zwrotId, tresc, onZalozona }: {
  p: PozycjaDecyzji; zwrotId: number; tresc: React.ReactNode; onZalozona: (w: DosylkaZalozona) => void;
}) {
  const sledz = useSledzDosylkeZwrotu();
  return <li>
    <div className="flex items-center gap-2 pr-4 hover:bg-slate-50">
      <Link to={p.cel.panel} aria-label={`${p.pytanie} — ${p.co}`}
        className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pl-14">{tresc}</Link>
      <Przycisk className="shrink-0 text-xs" disabled={sledz.isPending} aria-busy={sledz.isPending}
        aria-label={`Śledź dosyłkę — ${p.co}`}
        onClick={() => sledz.mutate({ id: zwrotId }, { onSuccess: onZalozona })}>
        {sledz.isPending ? "Zakładam…" : "Śledź dosyłkę"}</Przycisk>
    </div>
    {sledz.error && <p role="alert" className="pb-2 pl-14 pr-4 text-xs font-semibold text-ranga-zle">
      Śledzenia dosyłki nie założono — {(sledz.error as Error).message}</p>}
  </li>;
}

/* ── JEDNA LISTA „DO ZROBIENIA" (23 września 2026) ──────────────────────────
   „Do decyzji", „Moje" i „Wzmianki" odpowiadały na to samo pytanie — co mam
   teraz zrobić — i stały w trzech zakładkach. Agent obchodził je po kolei, a
   prośba kolegi czekała, aż ktoś zajrzy do trzeciej. Tu stoją jedna pod drugą:
   najpierw to, o co prosi człowiek, potem moje sprawy, na końcu decyzje biura.

   TO DALEJ SĄ TRZY ODCZYTY, nie piąta kolejka. Każda sekcja czyta swoją trasę
   i prowadzi na ekran, gdzie sprawę się załatwia; wspólnego statusu nie ma.
   Pusta sekcja zajmuje jedną linijkę, więc nie spycha decyzji pod krawędź. */
export function DoDecyzji() {
  const dane = useDoDecyzji();
  const [filtr, setFiltr] = useState<Filtr>("wszystko");
  /* Kroki zastąpione kliknięciem „Śledź dosyłkę” (0.541.0). Sprawa klienta
     mogła mieć krok, który ktoś ustawił sam — np. „Oddzwonić w sprawie
     faktury” — a dosyłka go zastępuje. Wiersz znika po kliknięciu, więc bez
     tego zdania stary krok przepadłby po cichu: dziennik niesie tylko jego
     długość. To samo zdanie stoi na ekranie zwrotu przy odmowie z WERTIS. */
  const [zastapione, setZastapione] = useState<DosylkaZalozona[]>([]);
  const poZalozeniu = (w: DosylkaZalozona) => {
    if (w.zastapil) setZastapione((z) => [...z, w]);
  };
  const pozycje = (dane.data?.pozycje ?? []).filter((p) => filtr === "wszystko" || p.obszar === filtr);
  const l = dane.data?.liczniki;

  /* ── PUSTE SEKCJE JEDNĄ LINIJKĄ (@wydanie) ─────────────────────────────
     Wariant B, ta sama decyzja. „Wspomniano o mnie · 0" i „Moje sprawy · 0"
     stały jako dwie karty z nagłówkiem nad listą decyzji i zabierały
     170 px tylko po to, żeby powiedzieć „nic". Pusta sekcja schodzi do
     jednej linijki nad decyzjami; pełna wraca w swoim kształcie.

     Te same zapytania co w sekcjach, więc żadnego żądania więcej. Sekcja
     wczytywana albo z błędem zostaje pełna: błąd ma być widać, a „pusto"
     przed odpowiedzią serwera byłoby nieprawdą. */
  const wzmianki = useWzmianki();
  const mojeSprawy = useMojeSprawy();
  const [historiaWzmianek, setHistoriaWzmianek] = useState(false);
  const odhaczonych = (wzmianki.data?.wzmianki ?? []).filter((w) => w.odhaczona).length;
  const wzmiankiPuste = wzmianki.isSuccess && !historiaWzmianek
    && (wzmianki.data.wzmianki ?? []).every((w) => w.odhaczona);
  const mojePuste = mojeSprawy.isSuccess && widoczneSprawy(mojeSprawy.data).length === 0;

  /* Własny scroller — jak w Zadaniach; rama panelu nie przewija za ekrany.

     TYTUŁ „Do zrobienia" ZESZEDŁ (0.524.0), bo powtarzał podświetloną
     zakładkę tuż nad nim. Zeszedł też podpis „najpilniejsze pierwsze": opisywał
     kolejkę, którą widać po plakietkach wieku, a nie mówił, co zrobić.

     TRZY SEKCJE, JEDEN NAGŁÓWEK (0.524.0). Każda miała inny kształt licznika:
     „1 do zajęcia się", „3 w pracy" i liczba w pigułce sita. Teraz wszystkie
     trzy biorą `NaglowekSekcji` i licznik po kropce, jak „Zawartość · 4"
     w koszu. Oko czyta jeden wzór zamiast trzech. */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    {(wzmiankiPuste || mojePuste) && <div data-puste-sekcje=""
      className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-sm text-slate-600">
      {wzmiankiPuste && <span className="flex flex-wrap items-center gap-x-1.5">
        <AtSign size={14} aria-hidden /><b className="text-slate-800">Wspomniano o mnie</b>
        · {odhaczonych ? "wszystko odhaczone" : "nikt Cię nie wzmiankował"}
        {/* Historia to dowód „pisałam ci o tym w środę" — zostaje o jedno
            kliknięcie, jak w pełnej sekcji. */}
        {odhaczonych > 0 && <button type="button" onClick={() => setHistoriaWzmianek(true)}
          className="min-h-6 underline underline-offset-2 hover:text-slate-900">
          pokaż odhaczone ({odhaczonych})</button>}
      </span>}
      {mojePuste && <span className="flex items-center gap-x-1.5">
        <Briefcase size={14} aria-hidden /><b className="text-slate-800">Moje sprawy</b>
        · nic nie prowadzisz</span>}
    </div>}
    {!wzmiankiPuste && <Wzmianki zHistoriaNaStart={historiaWzmianek} />}
    {!mojePuste && <Moje />}
    <Karta className="overflow-hidden p-0" role="region" aria-label="Do decyzji biura">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <NaglowekSekcji jako="h3" ikona={<ListChecks size={14} />} className="mr-auto">
          Do decyzji biura{l ? ` · ${l.wszystko}` : ""}</NaglowekSekcji>
        {/* „Wszystko" bez licznika (0.524.0): tę samą liczbę niesie już
            nagłówek, a dwie kopie jednego faktu to jedna za dużo. */}
        <FiltrSegmentowy<Filtr> wybrany={filtr} onWybierz={setFiltr} pozycje={[
          { klucz: "wszystko", etykieta: "Wszystko" },
          { klucz: "magazyn", etykieta: "Magazyn", ile: l?.magazyn },
          { klucz: "obsluga", etykieta: "Obsługa klienta", ile: l?.obsluga },
        ]} />
      </div>
      <Blad>{(dane.error as Error | null)?.message}</Blad>
      {dane.isLoading
        ? <Pusto waga="lista">Wczytuję…</Pusto>
        : pozycje.length === 0
          ? <p className="flex items-center gap-2 px-4 py-2 text-sm text-slate-500">
              <CircleCheck size={16} />Nic nie czeka na biuro.</p>
          : <ul>{grupujPoPytaniu(pozycje).map((g) =>
              <Grupa key={g[0]!.klucz} pozycje={g} onZalozona={poZalozeniu} />)}</ul>}
      {zastapione.map((w, i) => <p key={i} role="status"
        className="flex flex-wrap items-center gap-x-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
        <span>Krok sprawy klienta {w.login}: „{w.krok}” zamiast „{w.zastapil}”</span>
        <Link to={`/obsluga/klient/${encodeURIComponent(w.login)}`}
          className="text-sky-700 underline underline-offset-2 hover:text-sky-900">profil klienta</Link>
      </p>)}
    </Karta>
  </div>;
}
