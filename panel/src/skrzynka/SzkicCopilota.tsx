import React from "react";
import { Sparkles } from "lucide-react";
import { Przycisk, czas } from "../ui";
import { OdczytZdjec } from "./OdczytZdjec";
import { ProcesCopilota } from "./ProcesCopilota";
import type { OsRozmowy, StanCopilota, SzkicCopilota, WymianaCopilota } from "../api/typy";
import { Dopytanie } from "./Dopytanie";
import { wersjaWPolu, wersjeSzkicu } from "./wersjeSzkicu";
import { LiniaPoprawki, ListaUsunietych } from "./PoprawkaWPolu";
import type { MiejsceZmiany } from "./roznica";
import { useSkrotyDzialaja } from "../nawigacja/fokus";

/**
 * Szkic odpowiedzi z Copilota (§14.6) — przycisk i karta pod edytorem.
 *
 * ── JEDEN PRZYCISK ZAMIAST „WSTAW" I „ZASTĄP" ─────────────────────────────
 * Decyzja właściciela. Szkic czeka na agenta przy każdej wiadomości, więc
 * pole agenta jest przy otwarciu zwykle puste — a wtedy oba przyciski robiłyby
 * to samo. Przycisk jest więc jeden i przy pustym polu wstawia. Przy
 * niepustym ZMIENIA NAPIS na „Zastąp mój szkic": nadpisanie cudzej pracy ma
 * być świadome, a napis mówi, co się stanie, zanim ktoś kliknie.
 *
 * Bez kroku „to kosztuje": klik w jednej rozmowie JEST intencją.
 */
export interface PropsSzkicuCopilota {
  /** `undefined` = stan jeszcze nie przyszedł — wtedy nie ma ani przycisku, ani zdania. */
  stan: StanCopilota | undefined;
  szkic: SzkicCopilota | null;
  /** Klient dopisał po tym, jak szkic powstał — propozycja odpowiada na stare pytanie. */
  nieswiezy: boolean;
  uklada: boolean;
  blad: string;
  /** Szkic agenta jest niepusty — przycisk mówi wtedy „Zastąp mój szkic". */
  maSzkicAgenta: boolean;
  /**
   * Pole agenta trzyma TEN szkic, do edycji wprost. Ustawia go
   * ekran, gdy sam wstawił szkic do pustego pola albo agent kliknął „Popraw
   * w edytorze"; gaśnie przy wyczyszczeniu pola i przy zmianie rozmowy.
   */
  wPolu?: boolean;
  /**
   * Ostatnia wersja Copilota wstawiona z dopytania i tekst pola sprzed niej.
   * Pole podświetla poprawkę, dopóki jest DOKŁADNIE równe `po`. Ekran zdejmuje
   * ją przy pierwszej zmianie agenta, przy „Cofnij” i przy zmianie rozmowy.
   */
  poprawka?: { przed: string; po: string } | null;
  wylaczony: boolean;
  /**
   * DOPYTANIE. `undefined` = rozmowa jeszcze się nie wczytała.
   * Pole stoi w propsach szkicu, a nie osobno, bo dopytanie jest pytaniem
   * O SZKIC: bez niego nie ma o czym rozmawiać i nie ma czego kwestionować.
   */
  dopytanie?: {
    wymiany: WymianaCopilota[];
    blad: string | null;
    pracuje: boolean;
    onPytaj: (pytanie: string, pliki: File[]) => void;
    limitZnakow: number;
    /** Tekst pola odpowiedzi. Po nim karta poznaje wersję szkicu, która w nim stoi. */
    pole: string;
    /** Wersja Copilota do pola — ekran stawia przy tym pasek „Cofnij”. */
    onWstaw: (tresc: string) => void;
  };
  onUloz: () => void;
  /** Treść szkicu do pola agenta — wstawia przy pustym, zastępuje przy pełnym. */
  onPopraw: () => void;
  onOdrzuc: () => void;
}

/**
 * Czy szkic może stanąć W POLU agenta. Tylko świeży i jeszcze
 * nieoceniony: stary odpowiada na pytanie, którego już nie ma, a wpisany
 * w pole wyglądałby jak gotowa odpowiedź na bieżące. Taki zostaje w karcie,
 * z nazwaną nieświeżością i przyciskiem „Ułóż ponownie".
 */
export function szkicDoPola(p: PropsSzkicuCopilota): boolean {
  return p.szkic !== null && p.szkic.ocena === null && !p.nieswiezy && !p.wylaczony;
}

/* ── SZKIC WCHODZI DO POLA JAKO TEKST, NIE JAKO PODPOWIEDŹ ──────────────────
   Zgłoszenie właściciela z nagraniem: „wydaje mi się, że edycja powinna być
   w tym samym oknie, z opcją wyczyszczenia wszystkiego". Szara podpowiedź
   kazałaby przyjmować szkic Tabem przed poprawką jednego słowa — kroku,
   którego się nie domyśla nikt.

   Szkic wchodzi więc do pola jako zwykły tekst, gotowy do poprawiania.
   Bezpieczeństwo zostaje w dwóch miejscach:
   - do klienta nic nie wychodzi bez kliknięcia „Wyślij";
   - wstawienie jest STANEM EKRANU, nie zapisem. Pole nie jest zapisywane
     na serwer, więc otwarcie rozmowy niczego nie mutuje.

   Wstawiamy tylko do PUSTEGO pola i tylko świeży szkic swojej rozmowy.
   Zapisany szkic zespołu wygrywa zawsze — to czyjaś praca. */

/** Tekst do wstawienia w pole przy otwarciu rozmowy albo `null`, gdy nie wolno. */
export function szkicNaStart(p: PropsSzkicuCopilota, zapisanySzkic: string): string | null {
  if (zapisanySzkic.trim() !== "" || !szkicDoPola(p)) return null;
  return p.szkic?.tresc ?? null;
}

/**
 * Ostatnia wiadomość KUPUJĄCEGO na osi — od niej liczy się świeżość szkicu.
 *
 * Bez wpisów doradcy Allegro (`odAllegro`): Copilot odpowiada kupującemu
 * i zapisuje szkic pod jego wiadomością. Liczona od każdej przychodzącej,
 * świeżość mówiłaby „nieświeży” po każdym zdaniu doradcy, a „Ułóż ponownie”
 * płaciłoby za model i dawało znów szkic nieświeży.
 */
export function ostatniaKupujacego(os: OsRozmowy["os"]): number | null {
  return [...os].reverse()
    .find((w) => w.rodzaj === "wiadomosc" && w.odKlienta && !w.odAllegro)?.messageId ?? null;
}

/**
 * To samo, liczone wprost z rozmowy — tak woła to ekran skrzynki. Świeżość
 * i cudzość tą samą regułą, co karta: szkic świeży, gdy odpowiada na
 * OSTATNIĄ wiadomość klienta; cudza rozmowa to cudzy szkic.
 */
export function szkicNaStartRozmowy(dane: OsRozmowy, mojeId: number | null): string | null {
  const ostatniaKlienta = ostatniaKupujacego(dane.os);
  const wl = dane.rozmowa.wlascicielId;
  return szkicNaStart({
    stan: undefined, szkic: dane.szkicCopilota,
    nieswiezy: (dane.szkicCopilota?.messageId ?? null) !== ostatniaKlienta,
    uklada: false, blad: "", maSzkicAgenta: false,
    wylaczony: wl != null && wl !== mojeId,
    onUloz: () => {}, onPopraw: () => {}, onOdrzuc: () => {},
  }, dane.szkic?.body ?? "");
}

/**
 * Copilot W JEDNEJ LINII, bez własnego rzędu.
 *
 * Zgłoszenie właściciela: „niepotrzebnie ułóż odpowiedź i add attachment mają
 * swój własny rząd".
 *
 * Z Copilotem wyłączonym komponent renderuje ZDANIE z serwera, nie przycisk.
 * Dlatego nie zajmuje NIGDY więcej niż jedną linię: zdanie się ucina, a całość
 * zostaje w podpowiedzi. `truncate` wymaga `min-w-0` u rodzica we flexie.
 */
export function PrzyciskSzkicu({ p }: { p: PropsSzkicuCopilota }) {
  if (!p.stan) return null;
  if (!p.stan.wlaczony) {
    /* Przycisk, który nie może zadziałać, uczy nie klikać — zamiast niego
       zdanie z serwera, ale skrócone do jednej linii. */
    return <span className="min-w-0 truncate text-xs text-slate-500" title={p.stan.powod ?? undefined}>
      {p.stan.powod}</span>;
  }
  /* ── PRZYCISK TYLKO WTEDY, GDY SZKICU BRAK ALBO JEST STARY
     Decyzja właściciela. Takt układa szkic sam, więc przy świeżej karcie
     „Ułóż odpowiedź" kazałby zapłacić drugi raz za to samo. Przycisk wraca,
     gdy karty nie ma (takt wyłączony, limit godzinowy, szkic odrzucony) albo
     gdy leży na starych faktach — i wtedy mówi „ponownie". */
  const swiezy = p.szkic !== null && p.szkic.ocena === null && !p.nieswiezy;
  if (swiezy && !p.uklada && !p.blad) return null;
  const etykieta = p.szkic !== null ? "Ułóż ponownie" : "Ułóż odpowiedź";
  return <span className="flex min-w-0 items-center gap-2">
    <Przycisk className="shrink-0 text-xs" disabled={p.uklada || p.wylaczony} onClick={p.onUloz}>
      <Sparkles size={14} />{p.uklada ? "Układam szkic z faktów…" : etykieta}</Przycisk>
    {p.blad && <span className="min-w-0 truncate text-xs text-red-700" title={p.blad}>{p.blad}</span>}
  </span>;
}

/**
 * Pasek szkicu: skąd, jak świeży, co z nim zrobić.
 *
 * `wPolu`: treść STOI W POLU jako tekst agenta, więc nie ma czego
 * przyjmować ani wstawiać. Zostaje „Odrzuć", które mierzy los szkicu,
 * i zdanie mówiące, skąd tekst w polu.
 */
export function PasekSzkicu({ p, wPolu = false, miejsca }: {
  p: PropsSzkicuCopilota;
  wPolu?: boolean;
  /** Miejsca poprawki z dopytania podświetlonej w polu — patrz `PoprawkaWPolu.tsx`. */
  miejsca?: MiejsceZmiany[];
}) {
  /* Znaczki E i R tylko wtedy, gdy klawisze działają — powód w `nawigacja/fokus.ts`. */
  const skrotyDzialaja = useSkrotyDzialaja();
  const [usuniete, setUsuniete] = React.useState(false);
  const idListy = React.useId();
  const s = p.szkic;
  if (!s) return null;
  const poprawka = wPolu && miejsca && miejsca.length > 0 ? miejsca : null;
  /* ── METRYKA W DYMKU, NIE W WIERSZU ──────────────────────────────────
     Model, godzinę, autora i liczbę znaków agent czyta wyjątkowo — przy
     reklamacji szkicu, nie przy czytaniu — więc stoją w podpowiedzi. Liczba
     znaków stoi też w podpisie zwiniętej treści, gdzie decyduje
     o rozwinięciu. */
  return <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <b className="cursor-help text-violet-900"
        title={`${s.model} · ${czas(s.at)} · ${s.przez} · ${s.tresc.length} znaków`}>
        <Sparkles size={12} className="inline" /> Szkic Copilota{wPolu && " w polu"}</b>
      {/* Poprawka z dopytania mówi o sobie TU, w pasku nad polem, jedną
          linią. Osobny blok pod polem powtarzałby szkic drugi raz. */}
      {poprawka && <LiniaPoprawki miejsca={poprawka} otwarte={usuniete}
        onPrzelacz={() => setUsuniete((o) => !o)} idListy={idListy} />}
      {p.nieswiezy &&<span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
        powstał przed nową wiadomością klienta</span>}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {!wPolu && <Przycisk wariant="glowny" className="text-xs" disabled={p.wylaczony} onClick={p.onPopraw}
          aria-keyshortcuts="E">
          {/* „WSTAW DO ODPOWIEDZI", NIE „POPRAW W EDYTORZE". Przycisk
              niczego nie poprawia — przenosi szkic do pola. Napis ma nazywać
              SKUTEK, bo po skutek się klika (Nielsen: zgodność z rzeczywistością). */}
          {p.maSzkicAgenta ? "Zastąp mój szkic" : "Wstaw do odpowiedzi"}
          {skrotyDzialaja && <kbd aria-hidden="true" className="ml-1 rounded bg-black/10 px-1 font-sans">E</kbd>}
        </Przycisk>}
        {/* „Odrzuć SZKIC": samo „Odrzuć" stoi w panelu także przy zwrotach
            — jedno słowo, różne czynności. */}
        <Przycisk className="text-xs" onClick={p.onOdrzuc} aria-keyshortcuts="R">Odrzuć szkic
          {skrotyDzialaja && <kbd aria-hidden="true" className="ml-1 rounded bg-slate-100 px-1 font-sans">R</kbd>}
        </Przycisk>
      </span>
      {poprawka && usuniete && <ListaUsunietych miejsca={poprawka} id={idListy} />}
    </div>;
}

/**
 * Uwagi modelu — czego nie znalazł w faktach („uwagi na marginesie").
 *
 * Osobny komponent, bo żyją dłużej niż karta. Karta znika z oceną szkicu,
 * a przyjęty tekst dalej stoi w polu i dalej opiera się na tym samym braku
 * dowodu. Uwaga, która znika w chwili przyjęcia, znika dokładnie wtedy,
 * gdy agent zaczyna przerabiać zdanie, którego dotyczy.
 */
export function UwagiSzkicu({ uwagi }: { uwagi: string[] }) {
  return <ul className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
    aria-label="Czego model nie znalazł w faktach">
    {uwagi.map((z, i) => <li key={i}>⚠ {z}</li>)}
  </ul>;
}

/**
 * Karta szkicu. `wPolu` znaczy, że treść stoi już w polu agenta jako zwykły
 * tekst — wtedy karta nie powtarza ani treści, ani
 * paska z przyciskami, bo oba stoją nad polem. Zostaje to, na czym szkic stoi.
 */
export function KartaSzkicu({ p, wPolu = false, zwinieta = false }: {
  p: PropsSzkicuCopilota;
  wPolu?: boolean;
  /** Agent właśnie wyczyścił pole — treść nie wraca rozwinięta pod pustym polem. */
  zwinieta?: boolean;
}) {
  const s = p.szkic;
  /* Oceniony szkic zniknął z ekranu: odrzucony nie ma po co wisieć. Wiersz
     w bazie zostaje dla pomiaru. WYJĄTEK: szkic stojący w polu
     zostaje z tym, na czym stoi — uwagami, odczytem zdjęć i dopytaniem —
     także po „Wstaw do odpowiedzi", bo agent właśnie go poprawia. */
  if (!s || (s.ocena !== null && !(wPolu && s.ocena !== "odrzucony"))) return null;
  /* ── NA CZYM STOI TEKST W POLU, NIE ORYGINAŁ ──────────────────────────────
     Po poprawce z dopytania w polu stoi inna wersja niż ta, którą ułożył
     takt. Jej uwagi i „Skąd to wiem” mówią o zdaniach, które agent wyśle.
     Rachunek oryginału przy poprawionym tekście kłamałby o źródłach.

     Pole poprawione ręcznie nie równa się żadnej wersji. Wtedy rachunek daje
     najnowsza wersja, bo z niej agent zwykle poprawia. Oryginał w tej chwili
     zgubiłby twierdzenia, które doszły w poprawce, po jednym przecinku.
     Karta poza polem pokazuje treść oryginału, więc i jego rachunek. */
  const wersje = wPolu ? wersjeSzkicu(s, p.dopytanie?.wymiany ?? []) : [];
  const podstawa = wPolu
    ? wersjaWPolu(wersje, p.dopytanie?.pole ?? "") ?? wersje[wersje.length - 1]
    : null;
  const zastrzezenia = podstawa ? podstawa.zastrzezenia : s.zastrzezenia;
  const twierdzenia = podstawa ? podstawa.twierdzenia : s.twierdzenia;
  /* PRZYCISKI NA GÓRZE — patrz `PasekSzkicu`. */
  return <section className={wPolu ? "mt-2" : "mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3"}
    aria-label={wPolu ? "Na czym stoi szkic Copilota" : "Szkic Copilota"}>
    {!wPolu && <PasekSzkicu p={p} />}
    {/* ── SZKIC PŁYNIE, NIE PRZEWIJA SIĘ W OKIENKU ───────────────────────────
        Przyciski stoją NA GÓRZE, więc dół nie zabiera niczego, co trzeba
        kliknąć. Tekst, który agent ma PRZECZYTAĆ przed wysłaniem do klienta,
        nie idzie przez szparę we własnym pasku przewijania. Właściciel
        rozstrzygnął: czytelność szkicu wygrywa. Cena jest jawna — przy długim
        szkicu bloki pod nim schodzą poniżej krawędzi. */}
    {/* ── TREŚĆ ZWINIĘTA, GDY AGENT MA WŁASNĄ ───────────────────────────
        Przy pustym polu treść stoi W POLU, więc tu jej nie ma wcale. Karta
        z treścią zostaje w dwóch przypadkach: agent pisze swoje albo szkic
        jest nieświeży. Przy pierwszym treść jest zwinięta: agent zaczął
        pisać i pięćset rozwiniętych znaków pod polem wpychałoby jego tekst
        pod krawędź. Rozwija się jednym kliknięciem, bez nowego żądania.
        Edytor stoi na końcu osi, w jednym przewijaniu z rozmową. */}
    {!wPolu && <details open={!p.maSzkicAgenta && !zwinieta} className="mb-2">
      <summary className="cursor-pointer text-xs font-semibold text-violet-900">
        Treść szkicu · {s.tresc.length} znaków</summary>
      <pre className="mt-1 whitespace-pre-wrap font-sans text-tresc text-slate-800"
        data-testid="szkic-copilota-tresc">{s.tresc}</pre>
    </details>}
    {zastrzezenia.length > 0 && <UwagiSzkicu uwagi={zastrzezenia} />}
    {/* Rachunek POD tekstem, nie w nim: klient ma dostać gładką
        odpowiedź, a agent — to, na czym ona stoi. Klucz z czasu szkicu, żeby
        nowy szkic otwierał okno od nowa wg własnych twierdzeń. */}
    {/* ODCZYT PRZED RACHUNKIEM, bo jest materiałem, na którym rachunek stoi.
        Agent czyta go z miniaturą na osi przed oczami; dopiero potem ma sens
        pytanie, czy twierdzenie oparte na tym odczycie jest do przyjęcia. */}
    <OdczytZdjec odczyt={s.odczytZeZdjec} />
    {/* Klucz z wersji: inna wersja w polu otwiera okno od nowa wg własnych twierdzeń. */}
    <ProcesCopilota key={podstawa ? `${podstawa.nr}-${podstawa.at}` : s.at} twierdzenia={twierdzenia} />
    {/* DOPYTANIE POD SZKICEM, nie obok: agent czyta szkic, rodzi mu się
        wątpliwość, pyta. Odwrotna kolejność kazałaby pytać na ślepo. */}
    {p.dopytanie && <Dopytanie
      wymiany={p.dopytanie.wymiany}
      szkic={s}
      pole={p.dopytanie.pole}
      onWstaw={p.dopytanie.onWstaw}
      wylaczony={p.wylaczony}
      blad={p.dopytanie.blad}
      pracuje={p.dopytanie.pracuje}
      onPytaj={p.dopytanie.onPytaj}
      limitZnakow={p.dopytanie.limitZnakow} />}
  </section>;
}
