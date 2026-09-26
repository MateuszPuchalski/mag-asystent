import React from "react";
import { Sparkles } from "lucide-react";
import { Przycisk, czas } from "../ui";
import { OdczytZdjec } from "./OdczytZdjec";
import { ProcesCopilota } from "./ProcesCopilota";
import type { OsRozmowy, StanCopilota, SzkicCopilota, WymianaCopilota } from "../api/typy";
import { Dopytanie } from "./Dopytanie";
import { useSkrotyDzialaja } from "../nawigacja/fokus";

/**
 * Szkic odpowiedzi z Copilota (§14.6, 0.231.0) — przycisk i karta pod edytorem.
 *
 * Propozycja modelu NIE wchodzi do pola sama. Stoi obok jako karta, a do
 * szkicu agenta trafia jednym kliknięciem „Wstaw do odpowiedzi" (do 0.500.0
 * „Popraw w edytorze").
 *
 * ── JEDEN PRZYCISK ZAMIAST „WSTAW" I „ZASTĄP" (22 września 2026) ──────────
 * Decyzja właściciela. Od kiedy szkic czeka na agenta przy każdej wiadomości,
 * pole agenta jest przy otwarciu zwykle puste — a wtedy oba przyciski robiły
 * to samo. Przycisk jest więc jeden i przy pustym polu wstawia. Przy
 * niepustym ZMIENIA NAPIS na „Zastąp mój szkic": nadpisanie cudzej pracy ma
 * być świadome, a napis mówi, co się stanie, zanim ktoś kliknie.
 *
 * Bez kroku „to kosztuje": klik w jednej rozmowie JEST intencją. Partia nad
 * kolejką miała potwierdzenie, bo była kroplówką na dwadzieścia rozmów naraz.
 */
export interface PropsSzkicuCopilota {
  /** `undefined` = stan jeszcze nie przyszedł — wtedy nie ma ani przycisku, ani zdania. */
  stan: StanCopilota | undefined;
  szkic: SzkicCopilota | null;
  /** Klient dopisał po tym, jak szkic powstał — propozycja odpowiada na stare pytanie. */
  nieswiezy: boolean;
  /** Bieżąca wersja doboru; inna niż w szkicu = fakty się zmieniły od szkicu. `null` = nieznana. */
  doborWersja: number | null;
  /** Nazwy pól doboru, które Copilot rozpoznał w rozmowie, a agent jeszcze nie ma (liczy `propozycjaDoboru`). */
  nowePolaDoboru: string[];
  /** Para „X → Y" rozpoznana w rozmowie, jeszcze bez decyzji agenta (liczy `paraPasowania`). */
  paraPasowania: string | null;
  uklada: boolean;
  blad: string;
  /** Szkic agenta jest niepusty — przycisk mówi wtedy „Zastąp mój szkic". */
  maSzkicAgenta: boolean;
  /**
   * Pole agenta trzyma TEN szkic, do edycji wprost (0.499.0). Ustawia go
   * ekran, gdy sam wstawił szkic do pustego pola albo agent kliknął „Popraw
   * w edytorze"; gaśnie przy wyczyszczeniu pola i przy zmianie rozmowy.
   */
  wPolu?: boolean;
  wylaczony: boolean;
  /**
   * DOPYTANIE (0.332.0). `undefined` = rozmowa jeszcze się nie wczytała.
   * Pole stoi w propsach szkicu, a nie osobno, bo dopytanie jest pytaniem
   * O SZKIC: bez niego nie ma o czym rozmawiać i nie ma czego kwestionować.
   */
  dopytanie?: {
    wymiany: WymianaCopilota[];
    blad: string | null;
    pracuje: boolean;
    onPytaj: (pytanie: string) => void;
    limitZnakow: number;
    /** „Zapisz jako propozycję” przy pasowaniu z sieci (0.528.0). */
    onZapiszPasowanie?: (wymianaId: number, nr: number) => void;
    zapisuje?: boolean;
  };
  onUloz: () => void;
  /** Treść szkicu do pola agenta — wstawia przy pustym, zastępuje przy pełnym. */
  onPopraw: () => void;
  onOdrzuc: () => void;
}

/**
 * Czy szkic na ekranie jest nieaktualny: klient dopisał albo dobór się
 * zmienił. Zero w szkicu = wiersz sprzed migracji, o którym nic nie wiemy.
 */
function doborZmienil(p: PropsSzkicuCopilota): boolean {
  const s = p.szkic;
  return s !== null && p.doborWersja !== null && s.doborWersja > 0 && s.doborWersja !== p.doborWersja;
}

/**
 * Czy szkic może stanąć W POLU agenta (0.495.0). Tylko świeży i jeszcze
 * nieoceniony: stary odpowiada na pytanie, którego już nie ma, a wpisany
 * w pole wyglądałby jak gotowa odpowiedź na bieżące. Taki zostaje w karcie,
 * z nazwaną nieświeżością i przyciskiem „Ułóż ponownie".
 */
export function szkicDoPola(p: PropsSzkicuCopilota): boolean {
  return p.szkic !== null && p.szkic.ocena === null && !p.nieswiezy && !doborZmienil(p) && !p.wylaczony;
}

/* ── SZKIC WCHODZI DO POLA JAKO TEKST, NIE JAKO PODPOWIEDŹ (0.499.0) ────────
   Zgłoszenie właściciela z nagraniem: „wydaje mi się, że edycja powinna być
   w tym samym oknie, z opcją wyczyszczenia wszystkiego". Od 0.495.0 szkic
   stał w pustym polu jako szara podpowiedź. Pierwsza litera agenta ją
   zasłaniała, a pod polem wyskakiwała karta z „Zastąp mój szkic". Poprawka
   jednego słowa w szkicu wymagała więc najpierw przyjęcia go Tabem — kroku,
   o którym nagranie pokazuje, że się go nie domyśla nikt.

   Szkic wchodzi teraz do pola jako zwykły tekst, gotowy do poprawiania.
   Reguła z 0.231.0 — „propozycja nie wchodzi do pola sama" — ODCHODZI
   decyzją właściciela, a jej sens zostaje w dwóch miejscach:
   - do klienta nic nie wychodzi bez kliknięcia „Wyślij" — to się nie zmienia;
   - wstawienie jest STANEM EKRANU, nie zapisem. Pole nie jest zapisywane
     na serwer, więc otwarcie rozmowy dalej niczego nie mutuje.

   Wstawiamy tylko do PUSTEGO pola i tylko świeży szkic swojej rozmowy.
   Zapisany szkic zespołu wygrywa zawsze — to czyjaś praca. */

/** Tekst do wstawienia w pole przy otwarciu rozmowy albo `null`, gdy nie wolno. */
export function szkicNaStart(p: PropsSzkicuCopilota, zapisanySzkic: string): string | null {
  if (zapisanySzkic.trim() !== "" || !szkicDoPola(p)) return null;
  return p.szkic?.tresc ?? null;
}

/**
 * To samo, liczone wprost z rozmowy — tak woła to ekran skrzynki. Świeżość
 * i cudzość tą samą regułą, co karta: szkic świeży, gdy odpowiada na
 * OSTATNIĄ wiadomość klienta; cudza rozmowa to cudzy szkic.
 */
export function szkicNaStartRozmowy(dane: OsRozmowy, mojeId: number | null): string | null {
  const ostatniaKlienta = [...dane.os].reverse()
    .find((w) => w.rodzaj === "wiadomosc" && w.odKlienta)?.messageId ?? null;
  const wl = dane.rozmowa.wlascicielId;
  return szkicNaStart({
    stan: undefined, szkic: dane.szkicCopilota,
    nieswiezy: (dane.szkicCopilota?.messageId ?? null) !== ostatniaKlienta,
    doborWersja: dane.dobor.wersja, nowePolaDoboru: [], paraPasowania: null,
    uklada: false, blad: "", maSzkicAgenta: false,
    wylaczony: wl != null && wl !== mojeId,
    onUloz: () => {}, onPopraw: () => {}, onOdrzuc: () => {},
  }, dane.szkic?.body ?? "");
}

/**
 * Copilot W JEDNEJ LINII, bez własnego rzędu (0.249.0).
 *
 * Zgłoszenie właściciela: „niepotrzebnie ułóż odpowiedź i add attachment mają
 * swój własny rząd". Miał rację — dwa rzędy szły na dwie rzeczy, z których
 * jedna jest pomocą przy pisaniu, a druga czynnością od święta.
 *
 * 0.247.0 próbowało już wciągnąć ten przycisk do rzędu przełącznika trybu
 * i zostało WYCOFANE, bo z Copilotem wyłączonym komponent renderuje ZDANIE
 * z serwera, nie przycisk, a zdanie łamało rząd na dwa wiersze. Wycofanie
 * leczyło objaw. Przyczyną było to, że jeden komponent zwracał raz przycisk,
 * raz akapit — więc wołający nie miał jak wiedzieć, ile miejsca zajmie.
 *
 * Teraz nie zajmuje NIGDY więcej niż jedną linię: zdanie się ucina, a całość
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
  /* ── PRZYCISK TYLKO WTEDY, GDY SZKICU BRAK ALBO JEST STARY (22 września 2026)
     Decyzja właściciela. Takt układa szkic sam, więc przy świeżej karcie
     „Ułóż odpowiedź" kazałby zapłacić drugi raz za to samo. Przycisk wraca,
     gdy karty nie ma (takt wyłączony, limit godzinowy, szkic odrzucony) albo
     gdy leży na starych faktach — i wtedy mówi „ponownie". */
  const swiezy = p.szkic !== null && p.szkic.ocena === null && !p.nieswiezy && !doborZmienil(p);
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
 * `wPolu` (0.499.0): treść STOI W POLU jako tekst agenta, więc nie ma czego
 * przyjmować ani wstawiać. Zostaje „Odrzuć", które mierzy los szkicu,
 * i zdanie mówiące, skąd tekst w polu. Przyjmowanie Tabem z 0.495.0
 * odeszło razem z podpowiedzią.
 */
export function PasekSzkicu({ p, wPolu = false }: { p: PropsSzkicuCopilota; wPolu?: boolean }) {
  /* Znaczki E i R tylko wtedy, gdy klawisze działają — powód w `nawigacja/fokus.ts`. */
  const skrotyDzialaja = useSkrotyDzialaja();
  const s = p.szkic;
  if (!s) return null;
  /* ── METRYKA W DYMKU, NIE W WIERSZU (0.517.0) ────────────────────────
     Model, godzina, kto i liczba znaków stały zawsze widoczne obok nazwy.
     Agent sięga po nie wyjątkowo — przy reklamacji szkicu, nie przy
     czytaniu — więc zeszły do podpowiedzi nad napisem. Liczba znaków
     została widoczna w podpisie zwiniętej treści, gdzie decyduje
     o rozwinięciu. Zeszło też „— poprawiaj wprost w polu": tekst stoi
     w polu z kursorem, a zdanie powtarzało to, co widać. */
  return <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <b className="cursor-help text-violet-900"
        title={`${s.model} · ${czas(s.at)} · ${s.przez} · ${s.tresc.length} znaków`}>
        <Sparkles size={12} className="inline" /> Szkic Copilota{wPolu && " w polu"}</b>
      {p.nieswiezy && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
        powstał przed nową wiadomością klienta</span>}
      {/* Drugi rodzaj nieświeżości (przyrost trzeci): dane doboru zmieniły się
          po szkicu — zwykle dlatego, że agent właśnie wpisał to, co Copilot
          rozpoznał. Fakty są inne, więc szkic trzeba ułożyć jeszcze raz. */}
      {doborZmienil(p) &&
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
          dane doboru zmieniły się od szkicu — ułóż ponownie</span>}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {!wPolu && <Przycisk wariant="glowny" className="text-xs" disabled={p.wylaczony} onClick={p.onPopraw}
          aria-keyshortcuts="E">
          {/* „WSTAW DO ODPOWIEDZI", NIE „POPRAW W EDYTORZE" (0.500.0). Przycisk
              niczego nie poprawia — przenosi szkic do pola. Napis ma nazywać
              SKUTEK, bo po skutek się klika (Nielsen: zgodność z rzeczywistością). */}
          {p.maSzkicAgenta ? "Zastąp mój szkic" : "Wstaw do odpowiedzi"}
          {skrotyDzialaja && <kbd aria-hidden="true" className="ml-1 rounded bg-black/10 px-1 font-sans">E</kbd>}
        </Przycisk>}
        {/* „Odrzuć SZKIC": samo „Odrzuć" stało w panelu także przy zwrotach
            i propozycjach wiedzy — jedno słowo, trzy różne czynności. */}
        <Przycisk className="text-xs" onClick={p.onOdrzuc} aria-keyshortcuts="R">Odrzuć szkic
          {skrotyDzialaja && <kbd aria-hidden="true" className="ml-1 rounded bg-slate-100 px-1 font-sans">R</kbd>}
        </Przycisk>
      </span>
    </div>;
}

/**
 * Uwagi modelu — czego nie znalazł w faktach (0.495.0: „uwagi na marginesie").
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
 * Tematy paska „Przy okazji" — podpis zwiniętego paska (0.517.0). Nazwy
 * mówią, GDZIE rzecz trafiła, bo po to agent rozwija: żeby sprawdzić swoje
 * miejsce, nie żeby przeczytać wszystko. Pusta lista = paska nie ma.
 */
function przyOkazji(p: PropsSzkicuCopilota, s: SzkicCopilota): string[] {
  const l = s.lukiKartoteki;
  return [
    p.nowePolaDoboru.length > 0 && "dane doboru",
    !!p.paraPasowania && "pasowanie",
    l.numery.length > 0 && "numery w kartotece",
    (l.wpisane.length > 0 || l.modele.length > 0 || l.czeka > 0) && "wiedza",
  ].filter((x): x is string => x !== false);
}

/**
 * Karta szkicu. `wPolu` znaczy, że treść stoi już w polu agenta (0.495.0,
 * od 0.499.0 jako zwykły tekst) — wtedy karta nie powtarza ani treści, ani
 * paska z przyciskami, bo oba stoją nad polem. Zostaje to, na czym szkic stoi.
 */
export function KartaSzkicu({ p, wPolu = false, zwinieta = false }: {
  p: PropsSzkicuCopilota;
  wPolu?: boolean;
  /** Agent właśnie wyczyścił pole (0.499.0) — treść nie wraca rozwinięta pod pustym polem. */
  zwinieta?: boolean;
}) {
  const s = p.szkic;
  /* Oceniony szkic zniknął z ekranu: odrzucony nie ma po co wisieć. Wiersz
     w bazie zostaje dla pomiaru. WYJĄTEK od 0.499.0: szkic stojący w polu
     zostaje z tym, na czym stoi — uwagami, odczytem zdjęć i dopytaniem —
     także po „Wstaw do odpowiedzi", bo agent właśnie go poprawia. */
  if (!s || (s.ocena !== null && !(wPolu && s.ocena !== "odrzucony"))) return null;
  const tematy = przyOkazji(p, s);
  /* PRZYCISKI NA GÓRZE (0.232.1) — patrz `PasekSzkicu`. */
  return <section className={wPolu ? "mt-2" : "mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3"}
    aria-label={wPolu ? "Na czym stoi szkic Copilota" : "Szkic Copilota"}>
    {!wPolu && <PasekSzkicu p={p} />}
    {/* ── SZKIC PŁYNIE, NIE PRZEWIJA SIĘ W OKIENKU (0.342.0) ─────────────────
        Do 0.341.0 stało tu `max-h-56 overflow-y-auto`. Komentarz z 0.232.1
        tłumaczył to tak: długi szkic rozpychał edytor, oś rozmowy zwijała się
        do jednej linii, a dół karty — z przyciskami — ginął pod krawędzią.

        Powód zniknął, a ograniczenie zostało. Przyciski przeniesiono NA GÓRĘ
        w tym samym wydaniu, więc dół nie zabiera już niczego, co trzeba
        kliknąć. Oś chroni `max-h-[60vh]` na edytorze — siatka założona
        dokładnie po to, żeby wewnętrzne nie były potrzebne.

        Zostawało więc okienko wysokości 224 px na tekst, który agent ma
        PRZECZYTAĆ przed wysłaniem do klienta: pięćset znaków przez szparę,
        w trzecim zagnieżdżonym pasku przewijania. Właściciel rozstrzygnął
        spór wprost: czytelność szkicu wygrywa. Cena jest jawna — przy długim
        szkicu bloki pod nim schodzą poniżej krawędzi i trzeba do nich
        przewinąć. */}
    {/* ── TREŚĆ ZWINIĘTA, GDY AGENT MA WŁASNĄ (0.495.0) ─────────────────
        Przy pustym polu treść stoi W POLU, więc tu jej nie ma wcale. Karta
        z treścią zostaje w dwóch przypadkach: agent pisze swoje albo szkic
        jest nieświeży. Przy pierwszym treść jest zwinięta: agent zaczął
        pisać i pięćset rozwiniętych znaków pod polem wpychałoby jego tekst
        pod krawędź. Rozwija się jednym kliknięciem, bez nowego żądania.
        Siatki `max-h-[60vh]`, o której mówi komentarz wyżej, już nie ma:
        edytor stoi na końcu osi, w jednym przewijaniu z rozmową. */}
    {!wPolu && <details open={!p.maSzkicAgenta && !zwinieta} className="mb-2">
      <summary className="cursor-pointer text-xs font-semibold text-violet-900">
        Treść szkicu · {s.tresc.length} znaków</summary>
      <pre className="mt-1 whitespace-pre-wrap font-sans text-tresc text-slate-800"
        data-testid="szkic-copilota-tresc">{s.tresc}</pre>
    </details>}
    <div>
      {/* ── JEDEN PASEK „PRZY OKAZJI", NIE TRZY (0.342.0) ───────────────────
          Do 0.341.0 stały tu dwa osobne akapity (dane doboru, pasowanie),
          a trzeci — pokwitowanie wiedzy z oferty — pod całą kartą. Każdy
          w ramce, każdy zjadający wiersz, wszystkie mówiące wariant tego
          samego zdania: „Copilot zrobił coś obok szkicu".

          Rozdzielone miały sens, gdy każde niosło PRZYCISK. Przycisków nie ma
          od 0.341.0 — dane wchodzą same — więc został sam komunikat, a trzy
          ramki na jeden komunikat to ścisk, nie porządek.

          `data-testid` zostaje HISTORYCZNY (`luki-kartoteki`), bo po nim
          sięgają testy, a zmiana nazwy kupiłaby wyłącznie ładniejsze słowo.

          ── ZWINIĘTY DO JEDNEJ LINII (0.517.0) ────────────────────────────
          Pasek bywał sześcioma zdaniami pod każdym szkicem, a żadne nie
          prosi o ruch: dane weszły same, pasowanie czeka w Doborze, wiedza
          w swojej kolejce. Zwinięty mówi, CZEGO dotyczy, a treść stoi
          o jedno kliknięcie. Ostrzeżenia modelu stoją niżej, rozwinięte. */}
      {tematy.length > 0 &&
        <details className="mb-2 rounded border border-sky-200 bg-white p-2 text-xs text-sky-900"
          data-testid="luki-kartoteki">
          <summary className="cursor-pointer">
            <b className="text-sky-950">Przy okazji:</b> {tematy.join(", ")}</summary>
          <p className="mt-1">
          {p.nowePolaDoboru.length > 0 && <>
            Do doboru wpisano: <b>{p.nowePolaDoboru.join(", ")}</b> (popraw w Doborze po prawej,
            jeśli się myli).{" "}
          </>}
          {p.paraPasowania && <>
            Rozpoznane pasowanie <b>{p.paraPasowania}</b> — zaproponuj je w Doborze po prawej.{" "}
          </>}
          {s.lukiKartoteki.numery.length > 0 && <>
            Z oferty do kartoteki {s.lukiKartoteki.symbol}:{" "}
            <b>{s.lukiKartoteki.numery.map((n) => n.wartosc).join(", ")}</b>.{" "}
          </>}
          {/* WPISANE PRZED ODŁOŻONYMI (0.341.0): najpierw to, co już JEST
              w wiedzy, potem to, co dopiero czeka. */}
          {s.lukiKartoteki.wpisane.length > 0 && <>
            Z listy zgodności do wiedzy: <b>{s.lukiKartoteki.wpisane.join(", ")}</b>.{" "}
          </>}
          {s.lukiKartoteki.modele.length > 0 && <>
            Bez rozpoznanej marki, do kolejki Wiedzy:{" "}
            <b>{s.lukiKartoteki.modele.join(", ")}</b>.{" "}
          </>}
          {s.lukiKartoteki.czeka > 0 && <>Tej kartoteki czeka tam {s.lukiKartoteki.czeka}.</>}
          </p>
        </details>}
      {s.zastrzezenia.length > 0 && <UwagiSzkicu uwagi={s.zastrzezenia} />}
    </div>
    {/* Rachunek POD tekstem, nie w nim (0.253.0): klient ma dostać gładką
        odpowiedź, a agent — to, na czym ona stoi. Klucz z czasu szkicu, żeby
        nowy szkic otwierał okno od nowa wg własnych twierdzeń. */}
    {/* ODCZYT PRZED RACHUNKIEM, bo jest materiałem, na którym rachunek stoi.
        Agent czyta go z miniaturą na osi przed oczami; dopiero potem ma sens
        pytanie, czy twierdzenie oparte na tym odczycie jest do przyjęcia. */}
    <OdczytZdjec odczyt={s.odczytZeZdjec} />
    <ProcesCopilota key={s.at} twierdzenia={s.twierdzenia} />
    {/* DOPYTANIE POD SZKICEM, nie obok: agent czyta szkic, rodzi mu się
        wątpliwość, pyta. Odwrotna kolejność kazałaby pytać na ślepo. */}
    {p.dopytanie && <Dopytanie
      wymiany={p.dopytanie.wymiany}
      wylaczony={p.wylaczony}
      blad={p.dopytanie.blad}
      pracuje={p.dopytanie.pracuje}
      onPytaj={p.dopytanie.onPytaj}
      onZapiszPasowanie={p.dopytanie.onZapiszPasowanie}
      zapisuje={p.dopytanie.zapisuje}
      limitZnakow={p.dopytanie.limitZnakow} />}
  </section>;
}
