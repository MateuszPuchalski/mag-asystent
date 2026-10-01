import v8 from "node:v8";

/* ── Pamięć procesu API: odczyt, próbki godzinne i trend dna ─────────────────
   Pytanie „czy serwer przecieka" nie ma odpowiedzi z jednego pomiaru. Sterta
   Node faluje przy każdym odświeżeniu read-modelu Subiekta: zapytania wnoszą
   do pamięci całe wyniki, a V8 oddaje je dopiero przy zbieraniu śmieci. Szczyt
   mówi więc o ostatnim odświeżeniu, nie o wycieku.

   Wyciek widać na DNIE. Jeśli najniższy odczyt młodszej połowy okna leży
   wyraźnie wyżej niż najniższy odczyt starszej, to proces trzyma coś, czego
   zbieranie śmieci nie odzyskuje. Dlatego porównujemy minima połówek, nie
   średnie ani ostatni odczyt.

   Trend jest DANĄ w `/api/health`, nigdy zdaniem w `problemy`. Instalator
   odpytuje tę trasę po aktualizacji i wycofuje wydanie, gdy `ok` jest
   fałszywe; wolna zmiana pamięci nie ma prawa uruchomić wycofania.          */

const MB = 1024 * 1024;

/** Dwie doby przy próbce co godzinę: dość na dwa pełne cykle pracy biura. */
export const MAKS_PROBEK = 48;
/** Poniżej sześciu próbek połówki mają po trzy odczyty i dno nic nie mówi. */
export const MIN_PROBEK_DO_TRENDU = 6;
/** Wzrost dna, od którego mówimy „rośnie": mniejszy mieści się w szumie. */
export const PROG_WZROSTU_MB = 100;
/** Tempo wzrostu dna, od którego mówimy „rośnie": wolniejsze nie dobije do limitu w tydzień. */
export const PROG_TEMPA_MB_NA_GODZINE = 10;

export interface Probka {
  at: string;
  rssMb: number;
  stertaMb: number;
}

export interface TrendDna {
  probek: number;
  dnoStarszejPolowyMb: number;
  dnoMlodszejPolowyMb: number;
  wzrostMb: number;
  wzrostNaGodzineMb: number;
  /** Prawda, gdy wzrost przekracza oba progi. Konwencja, nie dowód wycieku. */
  rosnie: boolean;
}

export interface StanPamieci {
  rssMb: number;
  stertaMb: number;
  limitSteryMb: number;
  zewnetrznaMb: number;
  czasPracyGodzin: number;
  probek: number;
  /** `null` do czasu, aż uzbiera się dość próbek. Brak trendu to brak wniosku. */
  trend: TrendDna | null;
}

export interface OdczytPamieci {
  rss: number;
  heapUsed: number;
  external: number;
  heapLimit: number;
}

export function odczytajPamiec(): OdczytPamieci {
  const m = process.memoryUsage();
  return {
    rss: m.rss,
    heapUsed: m.heapUsed,
    external: m.external,
    heapLimit: v8.getHeapStatistics().heap_size_limit,
  };
}

const mb = (bajty: number): number => Math.round(bajty / MB);

/**
 * Trend dna z próbek od najstarszej. Czysta arytmetyka: czas i próbki
 * wchodzą z zewnątrz, więc test nie potrzebuje zegara ani godzin czekania.
 */
export function trendDna(probki: Probka[]): TrendDna | null {
  if (probki.length < MIN_PROBEK_DO_TRENDU) return null;
  const polowa = Math.floor(probki.length / 2);
  const dno = (od: Probka[]): Probka =>
    od.reduce((n, p) => (p.rssMb < n.rssMb ? p : n));
  const starsze = dno(probki.slice(0, polowa));
  const mlodsze = dno(probki.slice(polowa));
  const wzrost = mlodsze.rssMb - starsze.rssMb;
  /* Godziny liczymy między samymi dnami, bo to one są punktami trendu. Dwa dna
     z tej samej sekundy nie dają tempa, a dzielenie przez zero byłoby gorsze
     od braku liczby. */
  const godziny = (Date.parse(mlodsze.at) - Date.parse(starsze.at)) / 3_600_000;
  if (!(godziny > 0)) return null;
  const tempo = wzrost / godziny;
  return {
    probek: probki.length,
    dnoStarszejPolowyMb: starsze.rssMb,
    dnoMlodszejPolowyMb: mlodsze.rssMb,
    wzrostMb: wzrost,
    wzrostNaGodzineMb: Math.round(tempo * 10) / 10,
    rosnie: wzrost >= PROG_WZROSTU_MB && tempo >= PROG_TEMPA_MB_NA_GODZINE,
  };
}

const probki: Probka[] = [];
const start = Date.now();

/** Dopisuje próbkę i przycina okno do ostatnich dwóch dób. */
export function zapiszProbke(
  teraz: Date = new Date(),
  odczyt: OdczytPamieci = odczytajPamiec()
): Probka {
  const p: Probka = { at: teraz.toISOString(), rssMb: mb(odczyt.rss), stertaMb: mb(odczyt.heapUsed) };
  probki.push(p);
  if (probki.length > MAKS_PROBEK) probki.splice(0, probki.length - MAKS_PROBEK);
  return p;
}

export function stanPamieci(
  odczyt: OdczytPamieci = odczytajPamiec(),
  teraz: number = Date.now()
): StanPamieci {
  return {
    rssMb: mb(odczyt.rss),
    stertaMb: mb(odczyt.heapUsed),
    limitSteryMb: mb(odczyt.heapLimit),
    zewnetrznaMb: mb(odczyt.external),
    czasPracyGodzin: Math.round(((teraz - start) / 3_600_000) * 10) / 10,
    probek: probki.length,
    trend: trendDna(probki),
  };
}

/** Jedna linia do logu usługi: tyle, żeby `Select-String "\[pamiec\]"` dał oś czasu. */
export function liniaLogu(p: Probka, odczyt: OdczytPamieci = odczytajPamiec()): string {
  return `[pamiec] proces ${p.rssMb} MB, sterta ${p.stertaMb} z ${mb(odczyt.heapLimit)} MB`;
}

/** Tylko dla testów: zeruje okno próbek. */
export function wyczyscProbkiDlaTestow(): void {
  probki.length = 0;
}
