import { BladLimituAllegro } from "../adapters/allegro.js";

/* ── Takt tickerów Allegro — jeden rytm, trzy pętle ──────────────────────────
   Zapowiedzi, pytania i dyskusje tykały dotąd trzema `setInterval` o wspólnej
   bazie: startowały w tej samej sekundzie i biły w Allegro równym, zegarowym
   rytmem z jednego adresu. Dokładnie taka sygnatura maszyny skończyła się
   w sierpniu 2026 blokadą IP przy parowaniu — anti-bot nie pyta, czy ruch
   jest grzeczny, tylko czy wygląda jak człowiek.

   Ten moduł daje trzem pętlom wspólny takt z dwiema poprawkami:
   1. ROZRZUT ±10% na każdym odstępie i losowe opóźnienie startu — pętle
      rozjeżdżają się od pierwszej minuty i nie wracają do synchronizacji.
   2. RESPEKT DLA 429 — gdy przebieg skończy się `BladLimituAllegro`, następny
      czeka co najmniej tyle, ile prosi `Retry-After`. Ponowień w środku
      przebiegu nadal NIE MA; wydłuża się wyłącznie odstęp do kolejnego.     */

/**
 * Następny odstęp: baza ±10% (los ∈ [0,1) wstrzykiwany — czysta arytmetyka,
 * testowalna bez zegara), a po limicie z Allegro nie krócej niż prosi.
 */
export function nastepnyOdstep(
  bazaMs: number,
  los: number,
  poLimicieMs: number | null = null
): number {
  const baza = Math.max(bazaMs, 0);
  const rdzen = poLimicieMs !== null ? Math.max(baza, poLimicieMs) : baza;
  /* los=0 → 0.9×, los→1 → 1.1× — środek przedziału to dokładnie baza. */
  return Math.round(rdzen * (0.9 + 0.2 * los));
}

/**
 * Samoplanująca pętla przebiegu. Start po losowym `0..baza/3`, żeby trzy
 * tickery jednego serwera nie ruszały w tej samej sekundzie. Błąd przebiegu
 * nie zatrzymuje pętli — ląduje w logu, jak w dotychczasowych tickerach.
 */
export function uruchomTakt(
  etykieta: string,
  bazaMs: number,
  przebieg: () => Promise<void>
): void {
  if (bazaMs <= 0) return;

  const zaplanuj = (odstepMs: number) => {
    const t = setTimeout(async () => {
      let poLimicieMs: number | null = null;
      try {
        await przebieg();
      } catch (e) {
        if (e instanceof BladLimituAllegro) {
          poLimicieMs = e.poIluMs ?? bazaMs * 2;
          console.warn(`[${etykieta}] ${e.message} — następny przebieg później.`);
        } else {
          console.error(
            `[${etykieta}] przebieg nieudany:`,
            e instanceof Error ? e.message : e
          );
        }
      }
      zaplanuj(nastepnyOdstep(bazaMs, Math.random(), poLimicieMs));
    }, odstepMs);
    /* Ticker nie ma trzymać procesu przy życiu — testy i `--watch` kończą się
       same, tak jak przy dotychczasowym `setInterval` bez `unref` kończyły
       się dlatego, że tickery w testach w ogóle nie startowały. */
    t.unref?.();
  };

  zaplanuj(Math.floor(Math.random() * (bazaMs / 3)));
}
