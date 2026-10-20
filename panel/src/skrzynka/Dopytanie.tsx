import React from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Przycisk, czas, godzina, ile } from "../ui";
import { ProcesCopilota } from "./ProcesCopilota";
import { RoznicaSzkicu } from "./RoznicaSzkicu";
import { Zwijka } from "./Zwijka";
import { lukaReczna, wersjaWPolu, wersjeSzkicu, type WersjaSzkicu } from "./wersjeSzkicu";
import type { SzkicCopilota, UzycieNarzedziaCopilota, WymianaCopilota } from "../api/typy";

/* Nazwy narzędzi po ludzku. Serwer mówi `karta_towaru`, agent czyta
   „karta towaru”; nieznana nazwa (nowsze narzędzie, starszy panel) zostaje
   jak przyszła, bo lepsza surowa nazwa niż zniknięte sprawdzenie.
   `pasowanie_towaru` i `czesci_do_maszyny` stoją w wymianach zapisanych
   w bazie, choć serwer już ich nie daje modelowi. */
const NAZWY: Record<string, string> = {
  szukaj_towaru: "szukanie w kartotece",
  karta_towaru: "karta towaru",
  pasowanie_towaru: "pasowanie",
  czesci_do_maszyny: "części do maszyny",
  tresc_oferty: "treść oferty",
};

/**
 * CO COPILOT SPRAWDZIŁ W BAZIE (0.507.0). Jedna linijka pod odpowiedzią.
 * Odpowiedź „nie mamy” po sprawdzeniu kartoteki waży co innego niż ta sama
 * odpowiedź z pamięci modelu — i agent ma to widzieć, zanim uwierzy.
 * Brak linijki znaczy „nie sięgał”, więc pusta lista nie rysuje nic.
 */
function Sprawdzono({ narzedzia }: { narzedzia: UzycieNarzedziaCopilota[] }) {
  if (!narzedzia.length) return null;
  return <p className="mt-1 text-xs text-slate-600">
    Sprawdził w bazie: {narzedzia.map((n) => `${NAZWY[n.nazwa] ?? n.nazwa} „${n.argument}”`).join(", ")}
  </p>;
}

/**
 * Nowa wersja szkicu z jednej wymiany: numer, różnica i droga do pola.
 *
 * Najnowsza stoi rozwinięta, bo to ją agent właśnie czyta. Starsze zwijają
 * różnicę pod jedną linijką: historia ma być pod ręką, nie w oczach.
 *
 * Przycisk nie stoi przy wersji, która JUŻ jest w polu. Wstawienie jej drugi
 * raz niczego nie zmienia, a przycisk sugerowałby, że zmienia.
 */
function Wersja({ w, po, wersja, najnowsza, wPolu, wylaczony, onWstaw }: {
  w: WymianaCopilota;
  po: string;
  /** `null` = poprawka wcześniejszego szkicu, spoza historii obecnego. */
  wersja: WersjaSzkicu | null;
  najnowsza: boolean;
  wPolu: boolean;
  wylaczony: boolean;
  onWstaw: (tresc: string) => void;
}) {
  const nazwa = wersja ? `Wersja ${wersja.nr}` : "Wersja wcześniejszego szkicu";
  const napis = najnowsza ? "Wstaw do odpowiedzi" : "Przywróć tę wersję";
  return <div role="group" aria-label={nazwa} className="mt-2 rounded border border-violet-200 p-2">
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs font-semibold text-violet-900" title={czas(w.at)}>{nazwa} · {godzina(w.at)}</p>
      {/* Poprawka starego szkicu nie ma przycisku. Odpowiada na fakty sprzed
          „Ułóż ponownie”, a tarcie przy wysyłce liczy tylko wersje obecnego. */}
      {/* Numer wersji w nazwie dla czytnika: „Wstaw do odpowiedzi” stoi też
          przy oryginale w karcie szkicu, a „Przywróć” przy każdej starszej. */}
      {wersja && (wPolu
        ? <span className="ml-auto text-xs font-semibold text-violet-900">w polu</span>
        : <Przycisk className="ml-auto text-xs" wariant={najnowsza ? "glowny" : "drugi"}
            aria-label={`${napis} — wersja ${wersja.nr}`}
            disabled={wylaczony} onClick={() => onWstaw(po)}>{napis}</Przycisk>)}
    </div>
    <RoznicaSzkicu przed={w.szkicPrzed ?? ""} po={po} zwinieta={!najnowsza} />
    <ProcesCopilota key={`${w.id}-${w.at}-wersja`} twierdzenia={w.szkicTwierdzenia ?? []} />
  </div>;
}

/**
 * DOPYTANIE COPILOTA — polecenie albo pytanie agenta o szkic w polu.
 *
 * Właściciel: „dodaj możliwość kontynuowania rozmowy z modelem, możliwość
 * dopytania, rozwiania wątpliwości”. I drugie: Copilot ma POPRAWIAĆ szkic,
 * a nie mówić, co poprawić, i trzymać historię wersji, bo przepisywanie
 * cudzej rady do pola to praca, którą model zrobi sam.
 *
 * Model sam rozpoznaje, co dostał. Polecenie daje nową wersję szkicu
 * i notkę, co zmienił. Pytanie daje samą odpowiedź.
 *
 * NOTKA NIE MA PRZYCISKU „WSTAW”. Czyta ją agent, a przycisk byłby obejściem
 * wszystkich sit szkicu jednym kliknięciem. Przycisk ma tylko WERSJA, bo
 * serwer przepuścił ją przez te same sita co szkic. Nowa wersja wchodzi do
 * pola sama, z różnicą słów i paskiem „Cofnij” (`ekrany/Skrzynka.tsx`).
 *
 * KSZTAŁT JEST ROZMOWĄ, NIE KARTĄ. Polecenie i to, co z nim zrobił model,
 * stoją naprzemiennie, bo druga prośba zwykle wynika z pierwszej odpowiedzi.
 * Każda odpowiedź i każda wersja niesie swoje okno „Skąd to wiem”.
 *
 * Bez bursztynu: to nie jest ostrzeżenie ani zaznaczenie.
 *
 * ZWINIĘTE, DOPÓKI NIE MA O CO PYTAĆ. Pole i przycisk zajmowały wysokość
 * w każdej rozmowie, a wątpliwość rodzi się dopiero po przeczytaniu szkicu.
 * Blok z odbytą wymianą otwiera się sam, bo jest w nim treść do przeczytania.
 */
export function Dopytanie(p: {
  wymiany: WymianaCopilota[];
  /** Szkic Copilota, od którego liczy się historia wersji; `null` = brak szkicu. */
  szkic: SzkicCopilota | null;
  /** Tekst pola odpowiedzi. Po nim blok poznaje wersję, która stoi „w polu”. */
  pole: string;
  /** Wersja do pola odpowiedzi — ekran stawia przy tym pasek „Cofnij”. */
  onWstaw: (tresc: string) => void;
  wylaczony: boolean;
  /** `null` gdy nic nie leci; łańcuch = zdanie o tym, co poszło nie tak. */
  blad: string | null;
  pracuje: boolean;
  onPytaj: (pytanie: string) => void;
  limitZnakow: number;
}) {
  const [tekst, setTekst] = React.useState("");
  const zaDlugie = tekst.length > p.limitZnakow;
  const gotowe = tekst.trim().length > 0 && !zaDlugie && !p.pracuje && !p.wylaczony;

  const wersje = wersjeSzkicu(p.szkic, p.wymiany);
  const wPolu = wersjaWPolu(wersje, p.pole);
  const poprawki = wersje.filter((v) => v.zrodlo === "wymiana");
  const ostatnia = poprawki[poprawki.length - 1];
  const wersjaWymiany = (id: number) =>
    poprawki.find((v) => v.zrodlo === "wymiana" && v.wymianaId === id) ?? null;

  /* PODPIS MÓWI, CO JEST W ŚRODKU, gdy blok jest zamknięty: ile wymian
     i ile z nich poprawiło szkic. Bez wymian mówi, co da się tu zrobić. */
  const podpis = p.wymiany.length > 0
    ? [ile(p.wymiany.length, "wymiana", "wymiany", "wymian"),
      poprawki.length > 0 ? ile(poprawki.length, "poprawka", "poprawki", "poprawek") : ""]
      .filter(Boolean).join(" · ")
    : "poprawi szkic albo odpowie";

  return <Zwijka
    tytul="Dopytaj Copilota"
    Ikona={MessageCircleQuestion}
    podpis={podpis}
    domyslnieOtwarte={p.wymiany.length > 0}
  >
    {p.wymiany.length > 0 && <ul className="divide-y divide-slate-100" aria-label="Wymiany z Copilotem">
      {p.wymiany.map((w) => {
        const po = typeof w.szkicPo === "string" && w.szkicPo !== "" ? w.szkicPo : null;
        const wersja = wersjaWymiany(w.id);
        const luka = lukaReczna(wersje, w);
        return <li key={w.id} className="p-2">
          <p className="text-xs font-semibold text-slate-700">{w.przez}: {w.pytanie}</p>
          {/* Ręczne zmiany agenta przed poleceniem. Różnica wersji niżej
              pokazuje tylko zmiany modelu, więc te stałyby się niewidoczne. */}
          {luka && <details className="mt-1">
            <summary className="cursor-pointer text-xs text-slate-700">Twoje zmiany przed poprawką</summary>
            <RoznicaSzkicu przed={luka.poprzednia.tresc} po={luka.przed} />
          </details>}
          <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">{w.odpowiedz}</pre>
          <Sprawdzono narzedzia={w.narzedzia ?? []} />
          <ProcesCopilota key={`${w.id}-${w.at}`} twierdzenia={w.twierdzenia ?? []} />
          {po !== null && <Wersja w={w} po={po} wersja={wersja}
            najnowsza={wersja !== null && wersja === ostatnia}
            wPolu={wersja !== null && wersja === wPolu}
            wylaczony={p.wylaczony} onWstaw={p.onWstaw} />}
          {/* Zdanie przychodzi z serwera całe, z podmiotem i skutkiem („…więc
              szkic został bez zmian”), bo tylko serwis wie, które sito je dało. */}
          {w.szkicOdrzucony && <p className="mt-1 text-xs text-red-700">{w.szkicOdrzucony}</p>}
        </li>;
      })}
    </ul>}

    <div className="p-2">
      <label className="sr-only" htmlFor="dopytanie-tresc">Polecenie albo pytanie do Copilota</label>
      <textarea
        id="dopytanie-tresc"
        className="w-full resize-y rounded border border-slate-300 p-2 text-sm text-slate-800"
        rows={2}
        placeholder="np. dodaj link do drugiej wersji gaźnika albo zapytaj: skąd wiesz, że pasuje?"
        value={tekst}
        disabled={p.wylaczony}
        onChange={(e) => setTekst(e.target.value)}
      />
      <div className="mt-1 flex items-center gap-2">
        {/* Licznik pokazuje się dopiero BLISKO limitu. Stale widoczny uczy
            pisać krótko zamiast pisać jasno, a limit jest tu hamulcem na
            wklejony szkic, nie zachętą do skrótów. */}
        {tekst.length > p.limitZnakow - 150 && <span
          className={zaDlugie ? "text-xs font-semibold text-red-700" : "text-xs text-slate-600"}>
          {tekst.length} / {p.limitZnakow}
        </span>}
        {p.blad && <span className="text-xs text-red-700">{p.blad}</span>}
        <Przycisk
          className="ml-auto text-xs"
          wariant="glowny"
          disabled={!gotowe}
          onClick={() => { p.onPytaj(tekst.trim()); setTekst(""); }}
        >
          {p.pracuje ? "Pytam…" : "Zapytaj"}
        </Przycisk>
      </div>
    </div>
  </Zwijka>;
}
