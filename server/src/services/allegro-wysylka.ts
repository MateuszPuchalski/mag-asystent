import { urlWiadomosci, zapytajAllegro } from "../adapters/allegro.http.js";
import { config } from "../config.js";

/**
 * Wysyłka wiadomości do Centrum Wiadomości Allegro.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  [WERYFIKUJ] KSZTAŁT ŻĄDANIA POCHODZI Z PAMIĘCI, NIE Z DOKUMENTACJI.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §8.2 projektu panelu zabrania mapowania z pamięci i ta reguła kosztowała już
 * jedno wydanie. Właściciel polecił mimo to zbudować wysyłkę, bo dokumentacja
 * Allegro jest niedostępna z tego środowiska. Decyzja jest zapisana; ten
 * komentarz jest jej rachunkiem.
 *
 * Zgadywana jest WYŁĄCZNIE zawartość ciała i kształt odpowiedzi:
 *   - ciało       `{ "text": string }`
 *   - odpowiedź   obiekt wiadomości z polem `id`
 *
 * Nie jest zgadywane nic poza tym. Ścieżka stoi w repo od 0.142.1
 * (`urlWiadomosci` — ten sam adres co przy odczycie), a `zapytajAllegro`
 * ma już negocjację wersji zasobu po 406, obowiązkowy User-Agent oraz
 * obsługę 401, 403, 404 i 429 z `Retry-After`.
 *
 * Założenie o polu `text` NIE jest nowe: `payloadAllegroWiadomosci`
 * w `services/conversations.ts` zwraca dokładnie `{ text }` od 0.144.0.
 *
 * Gdy kształt okaże się inny, Allegro odpowie 400 albo 422, a kolejka zapisze
 * to jako `send_failed` razem z treścią odpowiedzi — czyli pierwszy prawdziwy
 * strzał sam poda właściwy kształt. Nic nie wyjdzie do klienta po cichu.
 *
 * Poprawka po zdobyciu dokumentacji obejmuje TĘ funkcję, jeden fixture
 * i sekcję „Wysyłka" w `docs/allegro-ksztalt.md`.
 */
export interface WyslanaWiadomosc { externalMessageId: string | null }

export type WyslijDoAllegro = (threadId: string, tresc: string) => Promise<WyslanaWiadomosc>;

export const wyslijDoAllegro: WyslijDoAllegro = async (threadId, tresc) => {
  const odp = await zapytajAllegro(urlWiadomosci(config.allegro.apiUrl, threadId), {
    metoda: "POST",
    body: { text: tresc },
  });
  const id = (odp as { id?: unknown } | null)?.id;
  /* Brak identyfikatora NIE jest błędem wysyłki: wiadomość mogła pójść,
     a my nie umiemy jej nazwać. Rozstrzygnie synchronizacja wątku. */
  return { externalMessageId: id == null ? null : String(id) };
};
