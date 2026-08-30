import { config } from "../config.js";
import { WERSJA } from "../wersja.js";

/* ── Allegro — wspólne kawałki połączenia ────────────────────────────────────
   Do 0.137.2 ten plik trzymał kontrakt adaptera i komplet typów domenowych
   zwrotów, wątków, dyskusji i opinii. Wszystkie opisywały kształt JSON-a
   wymyślony w testach i nigdy niesprawdzony na żywym koncie — dlatego odeszły
   razem z obsługą klienta (0.138.0), a nie zostały przepisane.

   Zostaje to, co dotyczy samego POŁĄCZENIA i nie zależy od żadnego kształtu:
   nagłówek User-Agent, odczyt 429 i wybór trybu. Implementacja siedzi
   w `allegro.http.ts`, tryb `dev` nie ma dziś adaptera — znaczy tyle, że
   konto nie jest podłączone i nie ma czego parować.                         */

/**
 * `Retry-After` z 429 → milisekundy oczekiwania. Nagłówek bywa liczbą sekund
 * albo datą HTTP; śmieci i przeszłość dają NULL (żadnego zgadywania — takt
 * użyje wtedy zwykłego interwału). Eksport dla testów.
 */
export function retryAfterMs(naglowek: string | null, terazMs: number): number | null {
  if (!naglowek) return null;
  const sekundy = Number(naglowek);
  if (Number.isFinite(sekundy) && sekundy >= 0) return Math.round(sekundy * 1000);
  const data = Date.parse(naglowek);
  if (Number.isFinite(data) && data > terazMs) return data - terazMs;
  return null;
}

/**
 * Allegro prosi o przerwę (HTTP 429). Osobna klasa, nie zdanie w Error:
 * takt tickerów ma po niej ROZPOZNAĆ limit i wydłużyć następny przebieg
 * o `poIluMs`, zamiast uderzać ponownie dokładnie po interwale — równe
 * ponawianie po odmowie to prosta droga do blokady konta albo adresu.
 * Ponowień nadal nie ma: błąd przerywa bieżącą pętlę jak każdy inny.
 */
export class BladLimituAllegro extends Error {
  constructor(
    komunikat: string,
    /** Ile poczekać wg nagłówka `Retry-After`; null = Allegro nie podało. */
    public readonly poIluMs: number | null
  ) {
    super(komunikat);
  }
}

/**
 * User-Agent do KAŻDEGO żądania (auth i API) — Allegro wymaga go wprost,
 * a brak prawidłowego nagłówka grozi zablokowaniem klucza. Wartość
 * wygenerowaną na developer.allegro.pl wkleja się w `ALLEGRO_USER_AGENT`;
 * fallback identyfikuje nas nazwą i wersją, nigdy domyślnym „node".
 */
export function allegroUserAgent(): string {
  return config.allegro.userAgent || `WERTIS/${WERSJA}`;
}

/**
 * Tryb faktycznie użyty: jawny `ALLEGRO_MODE` wygrywa, puste wynika
 * z `SGT_MODE` — ten sam wzorzec co `sferaMode`.
 */
export function allegroTryb(): "dev" | "http" {
  if (config.allegro.mode) return config.allegro.mode;
  return config.sgtMode === "mssql" ? "http" : "dev";
}

