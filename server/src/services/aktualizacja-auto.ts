import { config, oknoAktualizacji } from "../config.js";
import { godzinaLokalna } from "../czas.js";
import { WERSJA } from "../wersja.js";
import {
  maUruchamiacz, pamiecWydan, porownajWersje, sprawdzWydania, stanAktualizacji, stanZadania, trwaAktualizacja,
  zlecAktualizacje,
  type Pamiec, type StanZadania,
} from "./aktualizacja-serwera.js";
import { logEvent } from "./events.js";
import { ostatniRuch } from "./ruch.js";

/* ── Aktualizacja automatyczna (0.494.0) ────────────────────────────────────
   Przycisk z 0.492.0 zrobił jedną aktualizację tanią, ale ktoś wciąż musiał
   kliknąć — przy trzydziestu wydaniach dziennie serwer stał na wersji, którą
   ktoś ostatnio pamiętał wgrać. Automat klika sam, przez to samo zadanie
   Harmonogramu i z tym samym wycofaniem przy porażce.

   Kiedy NIE klika, i dlaczego każda z tych bramek jest osobno:
   - „[wymaga działania]" w którymkolwiek wpisie po drodze — takie wydanie
     potrzebuje człowieka, więc automat zatrzymuje się na ostatnim przed nim;
   - CHANGELOG nieprzeczytany — wtedy nie wiadomo, czy coś wymaga działania;
   - wydanie młodsze niż `dojrzaloscGodz` — czas na zauważenie błędu na dev;
   - kanarek (dev) nie pracuje jeszcze na tej wersji albo nie odpowiada;
   - wersja, która już raz się nie udała — drugi raz sama nie wejdzie;
   - poza oknem godzin albo gdy ktoś w ostatnich 10 minutach coś zapisał.

   Decyzja jest czystą funkcją: panel pokazuje to samo zdanie, którym automat
   się kieruje, a otwarcie karty niczego nie zleca ani nie pobiera. */

export type TrybAuto = "noc" | "zaraz" | "wylaczona";

export interface UstawieniaAuto {
  tryb: TrybAuto;
  okno: { od: number; do: number };
  dojrzaloscGodz: number;
  kanarek: string;
}

/** Ruch z ostatnich tylu minut odkłada aktualizację — tyle trwa typowa przerwa. */
export const CISZA_MIN = 10;
/** Nieudane zlecenie (np. brak zadania) nie ponawia się częściej. */
const PONOW_PO_MS = 6 * 3_600_000;

export function ustawieniaAuto(a = config.aktualizacja): UstawieniaAuto {
  const tryb = (["noc", "zaraz", "wylaczona"].includes(a.tryb) ? a.tryb : "wylaczona") as TrybAuto;
  return { tryb, okno: oknoAktualizacji(a.okno) ?? { od: 3, do: 5 }, dojrzaloscGodz: a.dojrzaloscGodz, kanarek: a.kanarek };
}

export interface Decyzja {
  /** Wersja, którą automat wgra, gdy zgodzą się pora i cisza; `null` = żadna. */
  kandydat: string | null;
  /** Czy zlecić TERAZ. */
  teraz: boolean;
  /** Jedno zdanie dla panelu: co i dlaczego. */
  powod: string;
}

export function wOknie(okno: { od: number; do: number }, godzina: number): boolean {
  return okno.od < okno.do
    ? godzina >= okno.od && godzina < okno.do
    : godzina >= okno.od || godzina < okno.do;
}

export interface WejscieDecyzji {
  ust: UstawieniaAuto;
  obecna: string;
  pamiec: Pamiec;
  stan: StanZadania | null;
  teraz: string;
  ostatniRuch: number | null;
  /** `undefined` = kanarka nie ma; `null` = nie odpowiedział; tekst = jego wersja. */
  kanarek?: string | null;
  /** Ostatnie zlecenie automatu w tym procesie. */
  proba?: { wersja: string; kiedy: number } | null;
  /** Zlecenie leży i czeka na zadanie — to też „trwa". */
  czekaZlecenie?: boolean;
}

export function decyzjaAuto(w: WejscieDecyzji): Decyzja {
  const { ust, obecna, pamiec, stan } = w;
  const nic = (powod: string, kandydat: string | null = null): Decyzja => ({ kandydat, teraz: false, powod });
  const tnow = Date.parse(w.teraz);

  if (ust.tryb === "wylaczona") return nic("Aktualizacja automatyczna wyłączona — zostaje przycisk.");
  if (w.czekaZlecenie || trwaAktualizacja(stan, tnow)) return nic("Aktualizacja właśnie trwa.");
  if (!pamiec.sprawdzono) return nic("Serwer jeszcze nie sprawdził wydań od startu.");
  if (!pamiec.wydania.length) return nic("To najnowsza wersja.");
  if (!pamiec.zmianyZnane) {
    return nic("Nie udało się przeczytać CHANGELOG-u, więc nie wiadomo, czy wydanie wymaga działania. Zostaje przycisk.");
  }

  const nieudana = stan?.etap === "blad" ? stan.wersja : null;
  const dojrzale = (opublikowano: string | null) =>
    ust.dojrzaloscGodz <= 0 || (!!opublikowano && tnow - Date.parse(opublikowano) >= ust.dojrzaloscGodz * 3_600_000);
  const wymagaDo = (wersja: string) =>
    pamiec.zmiany.find((z) => z.wymagaDzialania && porownajWersje(z.wersja, obecna) > 0 && porownajWersje(z.wersja, wersja) <= 0);

  /* Od najnowszej w dół: pierwsza, która przejdzie wszystkie bramki. Zdanie
     o PIERWSZEJ odrzuconej mówi, dlaczego nie ma nowszej. */
  let dlaczegoNieNajnowsza: string | null = null;
  let kandydat: string | null = null;
  for (const wyd of pamiec.wydania) {
    const odmowa = !wyd.maPaczke ? `Wydanie ${wyd.wersja} nie ma jeszcze paczki.`
      : wyd.wersja === nieudana ? `Wydanie ${wyd.wersja} już raz się nie udało — drugi raz samo nie wejdzie.`
      : wymagaDo(wyd.wersja) ? `Wydanie ${wymagaDo(wyd.wersja)!.wersja} wymaga działania — zaktualizuj przyciskiem po przeczytaniu.`
      : !dojrzale(wyd.opublikowano) ? `Wydanie ${wyd.wersja} ma mniej niż ${ust.dojrzaloscGodz} h.`
      : w.kanarek === null ? "Kanarek nie odpowiada — automat czeka."
      : typeof w.kanarek === "string" && porownajWersje(w.kanarek, wyd.wersja) < 0
        ? `Kanarek pracuje na ${w.kanarek}, nie na ${wyd.wersja}.`
      : null;
    if (!odmowa) { kandydat = wyd.wersja; break; }
    dlaczegoNieNajnowsza ??= odmowa;
  }
  if (!kandydat) return nic(dlaczegoNieNajnowsza ?? "Brak wydania do wgrania.");
  const dopisek = kandydat === pamiec.wydania[0]!.wersja ? "" : ` ${dlaczegoNieNajnowsza}`;

  if (w.proba && w.proba.wersja === kandydat && tnow - w.proba.kiedy < PONOW_PO_MS) {
    return nic(`Zlecenie ${kandydat} nie ruszyło — następna próba za kilka godzin.${dopisek}`, kandydat);
  }
  if (ust.tryb === "noc" && !wOknie(ust.okno, godzinaLokalna(w.teraz))) {
    return nic(`Wgram ${kandydat} w oknie ${ust.okno.od}:00–${ust.okno.do}:00.${dopisek}`, kandydat);
  }
  if (w.ostatniRuch !== null && tnow - w.ostatniRuch < CISZA_MIN * 60_000) {
    return nic(`Wgram ${kandydat}, gdy nikt nie będzie pracował przez ${CISZA_MIN} minut.${dopisek}`, kandydat);
  }
  return { kandydat, teraz: true, powod: `Wgrywam ${kandydat}.${dopisek}` };
}

/* ── Takt ───────────────────────────────────────────────────────────────── */

let proba: { wersja: string; kiedy: number } | null = null;
let kanarekOstatnio: string | null | undefined = undefined;

/** Kanarek to `/api/health` instancji dev; odpowiedź bez wersji = nie odpowiada. */
export async function wersjaKanarka(url: string, pobierz: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await pobierz(`${url.replace(/\/+$/, "")}/api/health`, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { wersja?: unknown };
    return typeof j.wersja === "string" ? j.wersja : null;
  } catch {
    return null;
  }
}

/** Decyzja na teraz, bez sieci i bez zapisu — to samo widzi panel. */
export function decyzjaTeraz(teraz: string = new Date().toISOString()): Decyzja {
  const ust = ustawieniaAuto();
  return decyzjaAuto({
    ust, obecna: WERSJA, pamiec: pamiecWydan(), stan: stanZadania(), teraz,
    ostatniRuch: ostatniRuch(), kanarek: ust.kanarek ? kanarekOstatnio ?? null : undefined, proba,
    czekaZlecenie: stanAktualizacji().czekaZlecenie,
  });
}

/**
 * Jeden przebieg automatu — takt w `main()`, co pięć minut. Wydania pobiera
 * sam, gdy pamięć ma więcej niż godzinę; takt `wydania` robi to i tak.
 */
export async function taktAuto(teraz: string = new Date().toISOString()): Promise<Decyzja | null> {
  if (!maUruchamiacz()) return null;
  const ust = ustawieniaAuto();
  if (ust.tryb === "wylaczona") return null;
  const p = pamiecWydan();
  if (!p.sprawdzono || Date.parse(teraz) - Date.parse(p.sprawdzono) > 60 * 60_000) await sprawdzWydania();
  if (ust.kanarek) kanarekOstatnio = await wersjaKanarka(ust.kanarek);
  const d = decyzjaTeraz(teraz);
  if (!d.teraz || !d.kandydat) return d;

  proba = { wersja: d.kandydat, kiedy: Date.parse(teraz) };
  await zlecAktualizacje(d.kandydat, "automat");
  logEvent("aktualizacja_automatyczna", "system", null, { z: WERSJA, na: d.kandydat, tryb: ust.tryb });
  return d;
}

/** Tylko do testów. */
export function _wyczyscAuto(): void {
  proba = null;
  kanarekOstatnio = undefined;
}
