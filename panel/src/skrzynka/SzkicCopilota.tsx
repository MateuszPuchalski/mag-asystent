import React from "react";
import { Sparkles } from "lucide-react";
import { Przycisk, czas } from "../ui";
import { OdczytZdjec } from "./OdczytZdjec";
import { ProcesCopilota } from "./ProcesCopilota";
import type { StanCopilota, SzkicCopilota, WymianaCopilota } from "../api/typy";
import { Dopytanie } from "./Dopytanie";

/**
 * Szkic odpowiedzi z Copilota (§14.6, 0.231.0) — przycisk i karta pod edytorem.
 *
 * Propozycja modelu NIE wchodzi do pola sama. Stoi obok jako karta, a do
 * szkicu agenta trafia jednym kliknięciem „Popraw w edytorze".
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
 * `wPolu` (0.495.0): treść stoi w polu agenta jako podpowiedź, więc
 * przycisk nie „poprawia w edytorze", tylko PRZYJMUJE to, co agent już
 * czyta. Klawisz Tab, a nie E — bo kursor stoi w polu, a tam „e" jest
 * literą. Tab przyjmuje podpowiedź w każdym edytorze kodu, więc nie
 * trzeba go uczyć. E zostaje poza polem, jak było.
 */
export function PasekSzkicu({ p, wPolu = false }: { p: PropsSzkicuCopilota; wPolu?: boolean }) {
  const s = p.szkic;
  if (!s) return null;
  return <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <b className="text-violet-900"><Sparkles size={12} className="inline" /> Szkic Copilota{wPolu && " w polu"}</b>
      <span className="text-slate-500">{s.model} · {czas(s.at)} · {s.przez} · {s.tresc.length} znaków</span>
      {wPolu && <span className="text-slate-600">— pisanie zaczyna od zera</span>}
      {p.nieswiezy && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
        powstał przed nową wiadomością klienta</span>}
      {/* Drugi rodzaj nieświeżości (przyrost trzeci): dane doboru zmieniły się
          po szkicu — zwykle dlatego, że agent właśnie wpisał to, co Copilot
          rozpoznał. Fakty są inne, więc szkic trzeba ułożyć jeszcze raz. */}
      {doborZmienil(p) &&
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
          dane doboru zmieniły się od szkicu — ułóż ponownie</span>}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={p.wylaczony} onClick={p.onPopraw}
          aria-keyshortcuts={wPolu ? "Tab" : "E"}>
          {wPolu ? "Przyjmij szkic" : p.maSzkicAgenta ? "Zastąp mój szkic" : "Popraw w edytorze"}
          <kbd aria-hidden="true" className="ml-1 rounded bg-black/10 px-1 font-sans">{wPolu ? "Tab" : "E"}</kbd></Przycisk>
        <Przycisk className="text-xs" onClick={p.onOdrzuc} aria-keyshortcuts="R">Odrzuć
          <kbd aria-hidden="true" className="ml-1 rounded bg-slate-100 px-1 font-sans">R</kbd></Przycisk>
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
 * Karta szkicu. `wPolu` znaczy, że treść stoi już w polu agenta jako
 * podpowiedź (0.495.0) — wtedy karta nie powtarza ani treści, ani paska
 * z przyciskami, bo oba stoją nad polem. Zostaje to, na czym szkic stoi.
 */
export function KartaSzkicu({ p, wPolu = false }: { p: PropsSzkicuCopilota; wPolu?: boolean }) {
  const s = p.szkic;
  /* Oceniony szkic zniknął z ekranu: wstawiony już jest w polu, odrzucony
     nie ma po co wisieć. Wiersz w bazie zostaje dla pomiaru. */
  if (!s || s.ocena !== null) return null;
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
    {!wPolu && <details open={!p.maSzkicAgenta} className="mb-2">
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
          sięgają testy, a zmiana nazwy kupiłaby wyłącznie ładniejsze słowo. */}
      {(p.nowePolaDoboru.length > 0 || p.paraPasowania || s.lukiKartoteki.numery.length > 0
        || s.lukiKartoteki.wpisane.length > 0 || s.lukiKartoteki.modele.length > 0
        || s.lukiKartoteki.czeka > 0) &&
        <p className="mb-2 rounded border border-sky-200 bg-white p-2 text-xs text-sky-900"
          data-testid="luki-kartoteki">
          <b className="text-sky-950">Przy okazji.</b>{" "}
          {p.nowePolaDoboru.length > 0 && <>
            Do doboru wpisano: <b>{p.nowePolaDoboru.join(", ")}</b> (popraw w zakładce Dobór,
            jeśli się myli).{" "}
          </>}
          {p.paraPasowania && <>
            Rozpoznane pasowanie <b>{p.paraPasowania}</b> — zaproponuj je w zakładce Dobór.{" "}
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
        </p>}
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
      limitZnakow={p.dopytanie.limitZnakow} />}
  </section>;
}
