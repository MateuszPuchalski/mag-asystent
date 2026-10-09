import type { SladHistorii } from "../api/typy";
import { ile, odmien } from "../ui";

/* ── Słowa o stanie sprawy, wspólne dla głowicy i karty produktu ─────────────
   Stoją tu funkcje, które mają więcej niż jednego czytelnika albo regułę
   języka, której nie wolno przepisywać na miejscu. Zdania o etapie sprawy
   mieszkają w `DrogaSprawy.tsx`, bo etap rysuje wyłącznie droga pod głowicą. */

/** Podpowiedź plakietki statusu: dokładna wartość Allegro zostaje pod kursorem. */
export const tytulStatusu = (kod: string | null): string =>
  kod ? `Status w Allegro: ${kod}` : "Allegro nie podało statusu";

/**
 * „3 reklamacje (2 uznane, 1 odrzucona)” — licznik historii jednym zdaniem.
 *
 * Jedna funkcja, żeby ta sama liczba nie brzmiała w dwóch miejscach inaczej.
 * `dopisek` staje przed nawiasem: „2 reklamacje u nas (1 uznana, 1 odrzucona)”.
 */
export function ileReklamacji(s: SladHistorii, dopisek = ""): string {
  const ogon = [
    s.uznanych > 0 ? `${s.uznanych} ${odmien(s.uznanych, "uznana", "uznane", "uznanych")}` : null,
    s.odrzuconych > 0
      ? `${s.odrzuconych} ${odmien(s.odrzuconych, "odrzucona", "odrzucone", "odrzuconych")}` : null,
  ].filter(Boolean).join(", ");
  return `${ile(s.ile, "reklamacja", "reklamacje", "reklamacji")}${dopisek}${ogon ? ` (${ogon})` : ""}`;
}
