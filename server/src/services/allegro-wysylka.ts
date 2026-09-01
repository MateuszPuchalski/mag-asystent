import { urlWiadomosci, zapytajAllegro } from "../adapters/allegro.http.js";
import { config } from "../config.js";

/**
 * Wysyłka wiadomości do Centrum Wiadomości Allegro.
 *
 * Kształt pochodzi ze specyfikacji Allegro i jest opisany w sekcji „Wysyłka"
 * w `docs/allegro-ksztalt.md`. `POST /messaging/threads/{id}/messages`
 * przyjmuje `{ text, attachments? }` i oddaje obiekt wiadomości z polem `id`.
 * Załączników nie wysyłamy, więc pola na nie nie budujemy.
 *
 * DO 0.150.0 TA FUNKCJA NIOSŁA `[WERYFIKUJ]`: ciało powstało z pamięci, bo
 * `developer.allegro.pl` był niedostępny ze środowiska, w którym pisano kod,
 * a właściciel polecił mimo to zbudować wysyłkę wbrew §8.2 projektu panelu.
 * Specyfikacja potwierdziła to zgadnięcie co do znaku — i warto zapisać, że
 * potwierdziła, bo dokładnie w tym samym wydaniu okazało się, że mapowanie
 * ODCZYTU, które żadnego znacznika nie nosiło, było błędne w każdym polu.
 * Znacznik nie jest miarą ryzyka; jest miarą tego, komu się przyznano.
 *
 * Ścieżka stoi w repo od 0.142.1 (`urlWiadomosci` — ten sam adres co przy
 * odczycie), a `zapytajAllegro` ma negocjację wersji zasobu po 406,
 * obowiązkowy User-Agent oraz obsługę 401, 403, 404 i 429 z `Retry-After`.
 *
 * (Specyfikacja zna też `POST /messaging/messages` z `recipient` i `order` —
 * to końcówka do ZAKŁADANIA wątku. My odpisujemy w istniejącym.)
 */
export interface WyslanaWiadomosc { externalMessageId: string | null }

export type WyslijDoAllegro = (threadId: string, tresc: string) => Promise<WyslanaWiadomosc>;

/**
 * Numer wiadomości z odpowiedzi Allegro.
 *
 * Osobno od samego strzału, żeby dało się to sprawdzić testem na fixturze
 * (`fixtures/allegro-inbox/wyslana.json`) zamiast na obiekcie wymyślonym
 * w teście — a to właśnie wymyślone obiekty w testach są tu powodem, dla
 * którego skrzynka nie działała przez dwa wydania.
 *
 * Brak identyfikatora NIE jest błędem wysyłki: wiadomość mogła pójść, a my nie
 * umiemy jej nazwać. Rozstrzyga wtedy synchronizacja wątku, a kolejka `outbox`
 * trzyma stan `send_uncertain`.
 */
export function numerWiadomosci(odpowiedz: unknown): string | null {
  const id = (odpowiedz as { id?: unknown } | null)?.id;
  return id == null ? null : String(id);
}

export const wyslijDoAllegro: WyslijDoAllegro = async (threadId, tresc) => {
  const odp = await zapytajAllegro(urlWiadomosci(config.allegro.apiUrl, threadId), {
    metoda: "POST",
    body: { text: tresc },
  });
  return { externalMessageId: numerWiadomosci(odp) };
};
