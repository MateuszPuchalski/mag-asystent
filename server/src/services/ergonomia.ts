import { db } from "../db/db.js";
import { GRANICA_OKNA, OKNO } from "./raporty.js";
import { etykietaUrzadzenia } from "./szukanie-kolektora.js";

/* ── Ergonomia w liczbach ────────────────────────────────────────────────────
   Pytanie właściciela: „jak sprawić, żeby kolektor był przyjemny w pracy?".
   Odpowiedź z opinii to lista życzeń. Ten raport zamienia ją na ranking
   z NASZEJ hali, liczony z dziennika, który i tak się zbiera.

   Pięć pytań, każde z gotowym „co zrobić":
   - gdzie jest WOLNO — udział odpowiedzi powyżej 300 ms per ekran, trasa
     i kolektor;
   - gdzie ludzie skanują DWA RAZY, bo pierwszy skan „nie zadziałał";
   - co serwer NAJCZĘŚCIEJ ODRZUCA — trasa i powód, czyli zdanie do przepisania;
   - który kolektor GUBI SIEĆ — przerwy per urządzenie;
   - ile pracy się POPRAWIA — cofnięcia i korekty na sto czynności.

   ŻADNEJ LICZBY PER OSOBA. Raport mierzy narzędzie, nie ludzi. Kolektor,
   który gubi sieć, to sprawa punktu dostępowego; wysoki udział poprawek to
   ekran, który prowokuje pomyłkę. Rozbicie na nazwiska zamieniłoby pytanie
   „co naprawić" w pytanie „kogo rozliczyć", a dane o ludziach mają w tym
   repo osobną trasę z podstawą prawną (`raportWydajnosci`).

   DWA POMIARY CZASU I RAPORT MÓWI, KTÓRY JEST KTÓRY. `scan_timing` wysyła
   wyłącznie wspólna droga skanu (`ScanRouter`), a woła ją tylko ekran
   główny. Do 0.482.0 była to jedyna liczba o czasie — i „p95 hali" w panelu
   mówiło o jednej czynności. Od 0.482.0 kolektor mierzy KAŻDE żądanie
   (`czasy_zadan`, kubełki per ekran i trasa), więc rozkładanie dostaw, koszy
   i kartonów ma wreszcie własne liczby. Stary pomiar zostaje pod własną,
   wąską nazwą, bo to jedyna historia sprzed tego wydania.

   Każdy `json_extract` stoi za `json_valid` — jeden ucięty payload w oknie
   kładł kiedyś całe raporty (patrz `zrodloZdarzenia` w `raporty.ts`). */

/** Dwa skany tego samego kodu z jednego kolektora w tym czasie to powtórka. */
export const POWTORKA_MS = 2_000;

/** Ile wierszy odrzuceń pokazać — więcej to już nie „najczęstsze". */
const TOP_ODRZUCEN = 20;

/** Ile tras pokazać w tabeli czasów — te z największą liczbą wolnych odpowiedzi. */
const TOP_TRAS = 25;

/**
 * Górne granice kubełków czasu w ms; ostatni kubełek to „powyżej 1000".
 * MUSZĄ być równe `KUBELKI_MS` w `android/core/.../net/CzasyZadan.kt` —
 * pilnuje tego test. Rozjazd przesunąłby liczby o przedział bez błędu.
 */
export const KUBELKI_MS = [100, 150, 300, 600, 1000];

/** Próg, od którego ludzie skanują dwa razy (plan §10). Musi być granicą kubełka. */
const PROG_MS = 300;
const OD_KUBELKA_POWYZEJ_PROGU = KUBELKI_MS.indexOf(PROG_MS) + 1;

const pole = (sciezka: string) => `CASE WHEN json_valid(payload) THEN json_extract(payload, '${sciezka}') END`;

export interface Czasy {
  n: number;
  p50: number | null;
  p95: number | null;
}

/** Kubełki zsumowane: ile odpowiedzi, ile powyżej progu i przedział p95. */
export interface Kubelki {
  n: number;
  powyzejProgu: number;
  udzialPowyzejProgu: number;
  /** Przedział, w którym leży p95 — „≤ 300 ms" albo „> 1000 ms". */
  p95: string | null;
}

export interface Ergonomia {
  days: number;
  /** Najświeższe zdarzenie w oknie — do kiedy sięga raport. */
  daneDo: string | null;
  /** Próg „wolnej" odpowiedzi w ms — ten sam w każdej kolumnie raportu. */
  progMs: number;
  czasy: Kubelki & {
    wgTrasy: Array<Kubelki & { ekran: string; trasa: string }>;
    wgKolektora: Array<Kubelki & { device: string | null; etykieta: string }>;
  };
  /** Stary pomiar: wyłącznie skan na ekranie głównym (patrz nagłówek pliku). */
  skanGlowny: Czasy & { wgKolektora: Array<Czasy & { device: string | null; etykieta: string }> };
  powtorzoneSkany: Array<{ device: string | null; etykieta: string; skanow: number; powtorzonych: number; udzial: number }>;
  odrzucenia: Array<{ trasa: string; status: number | null; powod: string; ile: number; urzadzen: number }>;
  przerwy: Array<{ device: string | null; etykieta: string; przerw: number; minutRazem: number; najdluzszaMin: number }>;
  poprawki: Array<{ czynnosc: string; wykonane: number; poprawek: number; udzial: number | null; rozbicie: Record<string, number> }>;
}

/** Percentyl z tablicy; `null` przy braku danych. */
export function percentyl(wartosci: number[], p: number): number | null {
  if (!wartosci.length) return null;
  const s = [...wartosci].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

const czasy = (ms: number[]): Czasy => ({ n: ms.length, p50: percentyl(ms, 0.5), p95: percentyl(ms, 0.95) });

/** Przedział p95 z kubełków — dokładniej się nie da i raport tego nie udaje. */
export function p95Kubelkow(k: number[]): string | null {
  const n = k.reduce((a, b) => a + b, 0);
  if (!n) return null;
  let suma = 0;
  for (let i = 0; i < k.length; i++) {
    suma += k[i];
    if (suma >= Math.ceil(0.95 * n)) {
      return i < KUBELKI_MS.length ? `≤ ${KUBELKI_MS[i]} ms` : `> ${KUBELKI_MS[KUBELKI_MS.length - 1]} ms`;
    }
  }
  return null;
}

function zKubelkow(k: number[]): Kubelki {
  const n = k.reduce((a, b) => a + b, 0);
  const powyzejProgu = k.slice(OD_KUBELKA_POWYZEJ_PROGU).reduce((a, b) => a + b, 0);
  return { n, powyzejProgu, udzialPowyzejProgu: n ? powyzejProgu / n : 0, p95: p95Kubelkow(k) };
}

/** Dodaje kubełki paczki do sumy; wiersz o obcym kształcie się pomija. */
function dodaj(suma: number[], k: unknown): void {
  if (!Array.isArray(k) || k.length !== KUBELKI_MS.length + 1) return;
  k.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) suma[i] += v;
  });
}

const pusteKubelki = () => new Array<number>(KUBELKI_MS.length + 1).fill(0);

const etykieta = (device: string | null) => (device ? etykietaUrzadzenia(device) : "bez urządzenia");

/**
 * Trasa bez identyfikatorów: `/api/delivery/12/lines/34/cofnij` →
 * `/api/delivery/:x/lines/:x/cofnij`. Każdy człon z cyfrą to identyfikator
 * albo kod — bez tego każda dostawa byłaby osobną „najczęstszą" trasą.
 */
export function wzorTrasy(sciezka: string): string {
  return sciezka
    .split("/")
    .map((c) => (/\d/.test(c) ? ":x" : c))
    .join("/");
}

/**
 * Powód bez liczb: „Nieznany kod kreskowy: 5901234567890" i ten sam powód
 * z innym kodem to JEDEN problem z ekranem, nie tysiąc różnych.
 */
export function wzorPowodu(powod: string | null): string {
  return (powod ?? "(bez komunikatu)").replace(/\d{3,}/g, "#").trim();
}

/** Grupowanie po kluczu z zachowaniem kolejności wejścia. */
function grupuj<T, K>(wiersze: T[], klucz: (w: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const w of wiersze) {
    const k = klucz(w);
    const lista = m.get(k);
    if (lista) lista.push(w);
    else m.set(k, [w]);
  }
  return m;
}

/* Czynność → zdarzenia wykonania i zdarzenia poprawki. Poprawka to każdy
   ruch, który odwraca albo zmienia już zapisaną pracę. Nazwy zdarzeń stoją
   tu dosłownie; test sprawdza, że każda nadal pada gdzieś w serwisach. */
export const CZYNNOSCI: ReadonlyArray<{ czynnosc: string; wykonane: string[]; poprawki: string[] }> = [
  {
    czynnosc: "Rozkładanie dostaw",
    wykonane: ["putaway_line_done"],
    poprawki: ["putaway_cofniete", "putaway_qty_fixed", "putaway_polka_zmieniona", "delivery_reopened",
      "problem_wycofany"],
  },
  {
    czynnosc: "Rozkładanie zwrotów (kosze)",
    wykonane: ["kosz_putaway", "kosz_pozycja_pominieta"],
    poprawki: ["kosz_putaway_poprawka", "kosz_putaway_cofniete", "kosz_pominiecie_cofniete",
      "kosz_zakonczenie_cofniete"],
  },
  {
    czynnosc: "Kartony",
    wykonane: ["karton_pozycja"],
    poprawki: ["karton_pozycja_usunieta", "karton_ilosc"],
  },
];

export function ergonomia(days = 7): Ergonomia {
  const od = OKNO(days);
  const d = db();

  const daneDo = (d.prepare(`SELECT MAX(created_at) AS t FROM events WHERE created_at >= ${GRANICA_OKNA}`)
    .get(od) as { t: string | null }).t;

  /* ── Czas odpowiedzi każdego żądania ── */
  const paczki = d.prepare(
    `SELECT device_id AS device, ${pole("$.czasy")} AS czasy FROM events
      WHERE type = 'czasy_zadan' AND created_at >= ${GRANICA_OKNA}`
  ).all(od) as Array<{ device: string | null; czasy: unknown }>;
  const trasy = new Map<string, { ekran: string; trasa: string; k: number[] }>();
  const kolektory = new Map<string | null, number[]>();
  const razem = pusteKubelki();
  for (const p of paczki) {
    let wiersze: unknown;
    try {
      wiersze = typeof p.czasy === "string" ? JSON.parse(p.czasy) : null;
    } catch {
      wiersze = null;
    }
    if (!Array.isArray(wiersze)) continue;
    const kol = kolektory.get(p.device) ?? pusteKubelki();
    kolektory.set(p.device, kol);
    for (const w of wiersze as Array<{ ekran?: unknown; trasa?: unknown; kubelki?: unknown }>) {
      if (typeof w?.ekran !== "string" || typeof w?.trasa !== "string") continue;
      const klucz = `${w.ekran}\u0000${w.trasa}`;
      const t = trasy.get(klucz) ?? { ekran: w.ekran, trasa: w.trasa, k: pusteKubelki() };
      trasy.set(klucz, t);
      dodaj(t.k, w.kubelki);
      dodaj(kol, w.kubelki);
      dodaj(razem, w.kubelki);
    }
  }
  const czasyTras = [...trasy.values()]
    .map((t) => ({ ekran: t.ekran, trasa: t.trasa, ...zKubelkow(t.k) }))
    .filter((t) => t.n > 0)
    .sort((a, b) => b.powyzejProgu - a.powyzejProgu || b.n - a.n)
    .slice(0, TOP_TRAS);
  const czasyKolektorow = [...kolektory.entries()]
    .map(([device, k]) => ({ device, etykieta: etykieta(device), ...zKubelkow(k) }))
    .filter((k) => k.n > 0)
    .sort((a, b) => b.udzialPowyzejProgu - a.udzialPowyzejProgu);

  /* ── Skan na ekranie głównym (stary pomiar) ── */
  const pomiary = (d.prepare(
    `SELECT device_id AS device, ${pole("$.ms")} AS ms FROM events
      WHERE type = 'scan_timing' AND created_at >= ${GRANICA_OKNA}`
  ).all(od) as Array<{ device: string | null; ms: unknown }>)
    .filter((r): r is { device: string | null; ms: number } => typeof r.ms === "number");
  const skanWgKolektora = [...grupuj(pomiary, (r) => r.device).entries()]
    .map(([device, rs]) => ({ device, etykieta: etykieta(device), ...czasy(rs.map((r) => r.ms)) }))
    .sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));

  /* ── Powtórzone skany ──
     Czyta wyłącznie `scan` (nie `manual_entry`): wpis z klawiatury powtarza
     się świadomie, skan w dwie sekundy — bo pierwszy „nie zadziałał". */
  const skany = d.prepare(
    `SELECT device_id AS device, ${pole("$.code")} AS kod, created_at AS t FROM events
      WHERE type = 'scan' AND created_at >= ${GRANICA_OKNA}
      ORDER BY device_id, created_at`
  ).all(od) as Array<{ device: string | null; kod: unknown; t: string }>;
  const powtorzoneSkany = [...grupuj(skany, (r) => r.device).entries()]
    .map(([device, rs]) => {
      let powtorzonych = 0;
      for (let i = 1; i < rs.length; i++) {
        const dt = Date.parse(rs[i].t) - Date.parse(rs[i - 1].t);
        if (rs[i].kod != null && rs[i].kod === rs[i - 1].kod && dt >= 0 && dt <= POWTORKA_MS) powtorzonych++;
      }
      return { device, etykieta: etykieta(device), skanow: rs.length, powtorzonych,
        udzial: rs.length ? powtorzonych / rs.length : 0 };
    })
    .sort((a, b) => b.udzial - a.udzial || b.powtorzonych - a.powtorzonych);

  /* ── Odrzucenia ── */
  const odrzucone = d.prepare(
    `SELECT device_id AS device, ${pole("$.sciezka")} AS sciezka, ${pole("$.status")} AS status,
            ${pole("$.powod")} AS powod FROM events
      WHERE type = 'http_rejected' AND created_at >= ${GRANICA_OKNA}`
  ).all(od) as Array<{ device: string | null; sciezka: unknown; status: unknown; powod: unknown }>;
  const odrzucenia = [...grupuj(odrzucone, (r) => {
    const trasa = wzorTrasy(typeof r.sciezka === "string" ? r.sciezka : "?");
    const powod = wzorPowodu(typeof r.powod === "string" ? r.powod : null);
    return `${trasa}\u0000${typeof r.status === "number" ? r.status : ""}\u0000${powod}`;
  }).entries()]
    .map(([klucz, rs]) => {
      const [trasa, status, powod] = klucz.split("\u0000");
      return { trasa, status: status ? Number(status) : null, powod, ile: rs.length,
        urzadzen: new Set(rs.map((r) => r.device)).size };
    })
    .sort((a, b) => b.ile - a.ile)
    .slice(0, TOP_ODRZUCEN);

  /* ── Przerwy w łączności ── */
  const przerwyWiersze = d.prepare(
    `SELECT device_id AS device, ${pole("$.trwanieMs")} AS ms FROM events
      WHERE type = 'siec_przerwa' AND created_at >= ${GRANICA_OKNA}`
  ).all(od) as Array<{ device: string | null; ms: unknown }>;
  const przerwy = [...grupuj(przerwyWiersze, (r) => r.device).entries()]
    .map(([device, rs]) => {
      const ms = rs.map((r) => (typeof r.ms === "number" ? r.ms : 0));
      return { device, etykieta: etykieta(device), przerw: rs.length,
        minutRazem: Math.round(ms.reduce((s, v) => s + v, 0) / 6_000) / 10,
        najdluzszaMin: Math.round(Math.max(0, ...ms) / 6_000) / 10 };
    })
    .sort((a, b) => b.minutRazem - a.minutRazem);

  /* ── Poprawki per czynność ── */
  const typy = [...new Set(CZYNNOSCI.flatMap((c) => [...c.wykonane, ...c.poprawki]))];
  const liczby = new Map(
    (d.prepare(
      `SELECT type, COUNT(*) AS n FROM events
        WHERE created_at >= ${GRANICA_OKNA} AND type IN (${typy.map(() => "?").join(",")})
        GROUP BY type`
    ).all(od, ...typy) as Array<{ type: string; n: number }>).map((r) => [r.type, r.n])
  );
  const poprawki = CZYNNOSCI.map((c) => {
    const wykonane = c.wykonane.reduce((s, t) => s + (liczby.get(t) ?? 0), 0);
    const rozbicie = Object.fromEntries(c.poprawki.map((t) => [t, liczby.get(t) ?? 0]));
    const poprawek = Object.values(rozbicie).reduce((s, n) => s + n, 0);
    return { czynnosc: c.czynnosc, wykonane, poprawek, udzial: wykonane ? poprawek / wykonane : null, rozbicie };
  });

  return {
    days,
    daneDo,
    progMs: PROG_MS,
    czasy: { ...zKubelkow(razem), wgTrasy: czasyTras, wgKolektora: czasyKolektorow },
    skanGlowny: { ...czasy(pomiary.map((r) => r.ms)), wgKolektora: skanWgKolektora },
    powtorzoneSkany,
    odrzucenia,
    przerwy,
    poprawki,
  };
}
