import type { DatabaseSync } from "node:sqlite";
import { config, oknoPrzedPraca } from "../config.js";
import { db as defaultDb } from "../db/db.js";
import { dataLokalna, godzinaLokalna } from "../czas.js";
import { logEvent } from "./events.js";
import { subiekt as domyslnySubiekt } from "../context.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota, BladPrzeciazeniaCopilota,
} from "../adapters/copilot.js";
import { nadawcaAnthropic, nadawcaSzkicuAnthropic } from "../adapters/copilot.anthropic.js";
import {
  CEL_KLASYFIKACJI, sklasyfikujRozmowy, type Autor, type NadawcaKlasyfikacji,
} from "./copilot-klasyfikacja.js";
import { ulozSzkic, type AutorSzkicu, type NadawcaSzkicu } from "./copilot-szkic.js";
import { czekajaNaSzkic } from "./copilot-szkic-po-rozpoznaniu.js";
import { TAKSONOMIA_WERSJA } from "./klasyfikacja-slownik.js";

/* ── Szkice przed pracą (26 września 2026, decyzja właściciela) ──────────────
   PROBLEM. Rozpoznanie i szkic z taktu mają sufity godzinowe: sześćdziesiąt
   rozpoznań i trzydzieści szkiców. W zwykłej godzinie chronią portfel.
   W poniedziałek rano zaległość z weekendu trafiała na ten sufit dokładnie
   wtedy, gdy przychodzili agenci. Pierwsza godzina dostawała około trzydziestu
   szkiców, a resztę kolejki agenci pisali od zera w największym ruchu.

   ROZWIĄZANIE. Okno przed biurem (domyślnie 6–8 czasu magazynu), w którym ta
   sama droga — rozpoznanie, potem szkic — biegnie z WŁASNYM limitem na
   poranek. Najpierw rozmowy PILNE, potem najdłużej czekające: to jest
   kolejność kolejki (`listaRozmow`), więc szkic stoi tam, gdzie agent
   spojrzy najpierw. Przebieg kończy się z końcem okna, limitem albo zaległością.

   NIE ZABIERA PIERWSZEJ GODZINY. Wywołania idą do księgi pod własnymi
   zadaniami (`klasyfikacja_przed_praca`, `szkic_przed_praca`). Sufity dnia
   liczą wyłącznie `klasyfikacja` i `szkic`, a liczą w oknie przesuwnym:
   szkic z 7:50 ważyłby w suficie do 8:50. Gdyby poranek liczył się do
   sufitu dnia, odebrałby agentom połowę pierwszej godziny — dokładnie to,
   co ta funkcja ma naprawić. Koszt trzyma limit poranka, liczony z tej samej
   księgi, razem z błędami, więc restart go nie zeruje.

   OKNO NALEŻY DO TEGO PRZEBIEGU. Zwykłe takty rozpoznania i szkicu w oknie
   odpuszczają (`przedPracaTrwa` w `main()`). Dwie drogi na tych samych
   rozmowach naraz płaciłyby dwa razy za to samo pytanie, a zwykła droga
   wydawałaby sufit dnia przed biurem. Wiadomość, która przyjdzie po
   wyczerpaniu limitu, czeka do końca okna — nikt jej wtedy jeszcze nie czyta.

   NIE PŁACI DWA RAZY. Szkic, który odpowiada już na bieżącą wiadomość pod
   bieżącą decyzją, zostaje: świeżość mierzy `czekajaNaSzkic`
   (`szkic_copilota.decyzja_id`), ta sama reguła co po rozpoznaniu. Szkic
   nieudany z winy ROZMOWY (odmowa, sprawdzenie, maskowanie) nie wraca na
   tę samą wiadomość tego ranka. Powtórka przy takcie co dwie minuty
   zjadłaby limit na jedną rozmowę. Stan dostawcy (limit, przeciążenie,
   łącze, klucz) rozmowy NIE skreśla: wraca w następnym takcie, jak przy
   rozpoznaniu. Nowa wiadomość klienta dostaje nową próbę.

   NIC NIE IDZIE DO KLIENTA. Szkic czeka na agenta z pustą oceną, jak każdy
   szkic automatu. */

/** Autor rozpoznań poranka: ten sam „automat", własne zadanie w księdze. */
export const AUTOMAT_PRZED_PRACA_KLASYFIKACJA: Autor = {
  id: null, name: "automat", zadanie: "klasyfikacja_przed_praca",
};
/** Autor szkiców poranka. Ekran dalej pokazuje „automat" — to ta sama ręka. */
export const AUTOMAT_PRZED_PRACA_SZKIC: AutorSzkicu = {
  id: null, name: "automat", zadanie: "szkic_przed_praca",
};

/**
 * Rytm taktu. Przebieg robi całą zaległość naraz, więc takt służy tylko
 * wejściu w okno i wiadomościom, które przyjdą w trakcie. Dwie minuty,
 * jak rozpoznanie: wiadomość z 6:30 ma szkic, zanim ktoś przyjdzie.
 */
export const TAKT_PRZED_PRACA_MS = 120_000;

/** Czy chwila leży w oknie przed pracą (pełne godziny czasu magazynu). */
export function wOkniePrzedPraca(teraz: Date, okno: string = config.copilot.przedPracaOkno): boolean {
  const o = oknoPrzedPraca(okno);
  if (!o) return false;
  const h = godzinaLokalna(teraz.toISOString());
  return h >= o.od && h < o.do;
}

/**
 * Czy zwykłe takty Copilota mają teraz odpuścić. Pyta `main()`; powód
 * w nagłówku pliku („okno należy do tego przebiegu").
 */
export function przedPracaTrwa(teraz: Date = new Date(), wlaczony = config.copilot.przedPraca): boolean {
  return wlaczony && wOkniePrzedPraca(teraz);
}

/**
 * Wiersze księgi z DZISIEJSZEGO poranka dla zadania. Doba lokalna, nie
 * ostatnie N godzin: okno nie przechodzi przez północ (`oknoPrzedPraca`),
 * więc data lokalna oddziela dzisiejszy poranek od wczorajszego bez
 * arytmetyki na zmianie czasu. Dwadzieścia sześć godzin wstecz to zapas
 * na dobę dwudziestopięciogodzinną.
 */
function zuzyteRano(database: DatabaseSync, zadanie: string, teraz: Date): number {
  const dzis = dataLokalna(teraz.toISOString());
  return (database.prepare(`SELECT at FROM copilot_wywolanie WHERE zadanie=? AND at >= ?`)
    .all(zadanie, new Date(teraz.getTime() - 26 * 3_600_000).toISOString()) as Array<{ at: string }>)
    .filter((w) => dataLokalna(w.at) === dzis).length;
}

/**
 * Wiadomości, na które szkic tego ranka już się nie udał z winy rozmowy —
 * jako `rozmowa:wiadomość`. Z dziennika, nie z księgi: księga nie odróżnia
 * odmowy modelu od przeciążenia dostawcy, a przebieg w chwili błędu wie.
 *
 * Dzień bierzemy z ładunku (zegar przebiegu). `created_at` stawia baza
 * zegarem ściennym, więc służy tylko za tani próg skanu.
 */
function nieudaneRano(database: DatabaseSync, dzien: string): Set<string> {
  const wynik = new Set<string>();
  const wpisy = database.prepare(`SELECT payload FROM events WHERE type='copilot_przed_praca' AND created_at >= ?`)
    .all(new Date(Date.now() - 26 * 3_600_000).toISOString()) as Array<{ payload: string | null }>;
  for (const { payload } of wpisy) {
    const p = JSON.parse(payload ?? "{}") as { dzien?: string; nieudane?: Array<[number, number]> };
    if (p.dzien !== dzien) continue;
    for (const [r, m] of p.nieudane ?? []) wynik.add(`${r}:${m}`);
  }
  return wynik;
}

/**
 * Rozmowy, w których klient czeka: PILNE, potem najdłużej czekające.
 *
 * „Czeka" znaczy: ostatnia wiadomość poza echem autoodpowiedzi jest jego.
 * Rozmowa, w której już odpisaliśmy, szkicu nie potrzebuje — rano nikt go
 * nie otworzy, a zapłacić trzeba by tak samo.
 *
 * Okno dni to samo co przy takcie rozpoznania: bez niego pierwszy poranek
 * przerabiałby historię skrzynki. Pusta wiadomość bez załącznika odpada
 * już tu, tak jak w takcie rozpoznania — zajmowałaby miejsce w limicie.
 */
const KOLEJKA = `
  SELECT c.id AS rozmowa, m.id AS wiadomosc,
         EXISTS (SELECT 1 FROM decyzja_klasyfikacji k
                  WHERE k.message_id = m.id AND k.aktywna = 1
                    AND k.taksonomia_wersja = '${TAKSONOMIA_WERSJA}') AS rozpoznana
    FROM conversation c
    JOIN message m ON m.id = ${CEL_KLASYFIKACJI}
   WHERE m.sent_at >= ?
     AND m.id = (SELECT m2.id FROM message m2
                  WHERE m2.conversation_id = c.id AND m2.auto_odpowiedz = 0
                  ORDER BY m2.sent_at DESC, m2.id DESC LIMIT 1)
     AND (TRIM(COALESCE(m.body,'')) <> ''
          OR EXISTS (SELECT 1 FROM message_attachment a WHERE a.message_id = m.id))
   ORDER BY CASE c.priorytet WHEN 'pilny' THEN 0 ELSE 1 END, m.sent_at, m.id`;

export interface PrzedPracaDeps {
  database?: DatabaseSync;
  nadajKlasyfikacji?: NadawcaKlasyfikacji;
  nadajSzkic?: NadawcaSzkicu;
  subiekt?: SubiektAdapter;
  now?: () => Date;
  wlaczony?: boolean;
  okno?: string;
  limit?: number;
  oknoDni?: number;
}

export interface WynikPrzedPraca {
  rozpoznanych: number;
  ulozonych: number;
  /** Rozmowy, przy których szkic nie powstał; powód stoi w księdze. */
  bledow: number;
  /** Zdanie dla dziennika, gdy przebieg stanął przed końcem zaległości. */
  przerwane: string | null;
}

const NIC: WynikPrzedPraca = { rozpoznanych: 0, ulozonych: 0, bledow: 0, przerwane: null };

/** Stan dostawcy, nie tej rozmowy — dalsze wywołania kosztowałyby bez szansy. */
const stanDostawcy = (e: unknown) => e instanceof BladLimituCopilota || e instanceof BladKluczaCopilota
  || e instanceof BladPrzeciazeniaCopilota || e instanceof BladLacznosciCopilota;

/**
 * Jeden przebieg taktu. Wołany WYŁĄCZNIE z `main()` — `buildApp()` nie ma
 * prawa strzelać do dostawcy modelu, a testy tras nie mają płacić.
 */
export async function szkicePrzedPraca(deps: PrzedPracaDeps = {}): Promise<WynikPrzedPraca> {
  const wlaczony = deps.wlaczony ?? config.copilot.przedPraca;
  const now = deps.now ?? (() => new Date());
  const okno = deps.okno ?? config.copilot.przedPracaOkno;
  if (!wlaczony || !wOkniePrzedPraca(now(), okno)) return { ...NIC };

  const database = deps.database ?? defaultDb();
  const limit = deps.limit ?? config.copilot.przedPracaLimit;
  const oknoDni = deps.oknoDni ?? config.copilot.klasyfikacjaOknoDni;
  const nadajK = deps.nadajKlasyfikacji ?? nadawcaAnthropic;
  const nadajS = deps.nadajSzkic ?? nadawcaSzkicuAnthropic;
  const subiekt = deps.subiekt ?? domyslnySubiekt;

  const start = now();
  const zuzyteK = () => zuzyteRano(database, AUTOMAT_PRZED_PRACA_KLASYFIKACJA.zadanie!, now());
  const zuzyteS = () => zuzyteRano(database, AUTOMAT_PRZED_PRACA_SZKIC.zadanie!, now());
  /* Limit wyczerpany już na wejściu: cisza. Wpis padł w przebiegu, który
     go wyczerpał; powtarzany co dwie minuty do końca okna byłby szumem. */
  if (zuzyteK() >= limit && zuzyteS() >= limit) return { ...NIC };

  const dzien = dataLokalna(start.toISOString());
  const od = new Date(start.getTime() - oknoDni * 86_400_000).toISOString();
  const kolejka = database.prepare(KOLEJKA).all(od) as
    Array<{ rozmowa: number; wiadomosc: number; rozpoznana: number }>;
  const nieudane = nieudaneRano(database, dzien);
  /* Nieudane w TYM przebiegu — trafią do ładunku zdarzenia dla następnych. */
  const noweNieudane: Array<[number, number]> = [];

  const w: WynikPrzedPraca = { ...NIC };
  /* Rozmowy, które czekały na pracę, a nie zmieściły się w limicie. Bez tej
     liczby przebieg, który skończył kolejkę na samym pominięciu, mówiłby
     „doszedł do końca", choć zostawił rozmowy bez szkicu. */
  let poLimicie = 0;
  for (const { rozmowa, wiadomosc, rozpoznana } of kolejka) {
    const r = Number(rozmowa);
    const m = Number(wiadomosc);
    /* Zegar sprawdzany przy KAŻDEJ rozmowie: szkic trwa sekundy, a setka
       zaległości przebiegu nie ma prawa wejść w godziny biura. */
    if (!wOkniePrzedPraca(now(), okno)) { w.przerwane = "koniec okna przed pracą"; break; }
    const budzetK = limit - zuzyteK();
    const budzetS = limit - zuzyteS();
    if (budzetK <= 0 && budzetS <= 0) { w.przerwane = "limit poranka wyczerpany"; break; }

    if (!Number(rozpoznana)) {
      if (budzetK <= 0) { poLimicie++; continue; }
      const k = await sklasyfikujRozmowy(database, [r], AUTOMAT_PRZED_PRACA_KLASYFIKACJA, nadajK, now());
      w.rozpoznanych += k.sklasyfikowane;
      if (k.przerwane) { w.przerwane = k.przerwane; break; }
    }

    if (nieudane.has(`${r}:${m}`)) continue;
    /* Po rozpoznaniu, nie przed: „nic do zrobienia" i rozpoznanie zastępcze
       szkicu nie dają, a świeży szkic zostaje — reguła jest jedna. */
    if (czekajaNaSzkic(database, [r]).length === 0) continue;
    if (budzetS <= 0) { poLimicie++; continue; }
    try {
      await ulozSzkic(r, AUTOMAT_PRZED_PRACA_SZKIC, nadajS, subiekt, now());
      w.ulozonych++;
    } catch (e) {
      if (stanDostawcy(e)) { w.przerwane = e instanceof Error ? e.message : String(e); break; }
      w.bledow++;
      noweNieudane.push([r, m]);
    }
  }

  if (!w.przerwane && poLimicie > 0) w.przerwane = "limit poranka wyczerpany";

  /* Zdarzenie zbiorcze na przebieg, gdy było co liczyć. Pojedyncze decyzje
     i szkice zapisują już ich serwisy. */
  if (w.rozpoznanych || w.ulozonych || w.bledow || w.przerwane) {
    logEvent("copilot_przed_praca", AUTOMAT_PRZED_PRACA_SZKIC.name, null,
      { ...w, limit, poLimicie, czekalo: kolejka.length, dzien, nieudane: noweNieudane }, null, database);
  }
  return w;
}
