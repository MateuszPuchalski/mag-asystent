import {
  AKCEPT_BETA, urlDeklaracjiZalacznika, urlPrzeczytaniaWatku, urlWgraniaZalacznika, urlWiadomosci,
  zapytajAllegro,
} from "../adapters/allegro.http.js";
import { config } from "../config.js";
import { db as defaultDb, type Db } from "../db/db.js";

/**
 * Wysyłka wiadomości do Centrum Wiadomości Allegro.
 *
 * Kształt pochodzi ze specyfikacji Allegro i jest opisany w sekcji „Wysyłka"
 * w `docs/allegro-ksztalt.md`. `POST /messaging/threads/{id}/messages`
 * przyjmuje `{ text, attachments? }` i oddaje obiekt wiadomości z polem `id`.
 * Od 0.195.0 wysyłamy też załączniki — pole `attachments` w `NewMessageInThread`
 * to lista `{ id }`, a identyfikatory pochodzą z dwukrokowego wgrania niżej.
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

export type WyslijDoAllegro = (
  threadId: string, tresc: string, zalaczniki?: string[],
) => Promise<WyslanaWiadomosc>;

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

/**
 * Wersja zasobu do zapisu w wątku: `beta.v1` dla Problemu z zakupem,
 * negocjowana dla reszty.
 *
 * Allegro obsługuje Problemy z zakupem wyłącznie w `beta.v1` i każe
 * wtedy podawać ten nagłówek. Zwykły wątek zostaje przy negocjacji, którą
 * chodził zawsze — nowa funkcja nie zmienia kształtu żądań, które jej nie
 * dotyczą. Typ wątku zapisuje synchronizacja skrzynki, więc pytamy bazę,
 * a nie Allegro: wysyłka nie płaci za niego dodatkowym żądaniem.
 */
export function wersjaWatku(threadId: string, database: Db = defaultDb()): typeof AKCEPT_BETA | undefined {
  const w = database.prepare("SELECT watek_typ FROM allegro_inbox_thread WHERE id=?")
    .get(threadId) as { watek_typ: string | null } | undefined;
  return w?.watek_typ === "POST_PURCHASE_ISSUE" ? AKCEPT_BETA : undefined;
}

export const wyslijDoAllegro: WyslijDoAllegro = async (threadId, tresc, zalaczniki = []) => {
  const odp = await zapytajAllegro(urlWiadomosci(config.allegro.apiUrl, threadId), {
    metoda: "POST",
    /* Ciało `NewMessageInThread` jest w obu wersjach to samo; różni się
       nagłówek. Zamknięty Problem z zakupem Allegro odrzuca 422
       `THREAD_CLOSED`, a `zapytajAllegro` zamienia to na zdanie dla agenta. */
    akcept: wersjaWatku(threadId),
    /* Pola `attachments` NIE wysyłamy pustego. Schemat dopuszcza `nullable`,
       ale wiadomość bez załączników ma wyglądać dokładnie tak, jak wyglądała
       przez cztery wydania — nowa funkcja nie zmienia kształtu żądań, które
       jej nie używają. */
    body: zalaczniki.length === 0
      ? { text: tresc }
      : { text: tresc, attachments: zalaczniki.map((id) => ({ id })) },
  });
  return { externalMessageId: numerWiadomosci(odp) };
};

/* ── Wątek przeczytany (0.195.0) ─────────────────────────────────────────────
   Odpowiedź wysłana z panelu ZOSTAWIAŁA wątek nieprzeczytany w Centrum
   Wiadomości Allegro. Skutek był taki, że im lepiej działał panel, tym
   bardziej kłamał licznik u właściciela: czerwona plakietka przy sprawach
   dawno załatwionych, a po niej nie da się poznać, co jeszcze czeka.

   Stoi PO wysyłce i nie ma prawa jej wywrócić: wiadomość już poszła do
   klienta, a nieoznaczony wątek to niedogodność, nie utrata pracy. Dlatego
   wołający łapie błąd i zapisuje go w audycie, zamiast oddawać agentowi
   „nie udało się wysłać" przy odpowiedzi, która wyszła.                      */
export type OznaczPrzeczytany = (threadId: string) => Promise<void>;

export const oznaczPrzeczytanyWAllegro: OznaczPrzeczytany = async (threadId) => {
  /* `ThreadReadFlag` żąda pola `read` — bez niego Allegro oddaje 422
     „missing flag in the request body", co wprost stoi w specyfikacji. */
  await zapytajAllegro(urlPrzeczytaniaWatku(config.allegro.apiUrl, threadId), {
    metoda: "PUT",
    /* `ThreadReadFlagVBeta1` ma ten sam kształt `{ read }`, więc ciało
       zostaje; wersja idzie za typem wątku, jak przy wysyłce. */
    body: { read: true },
    akcept: wersjaWatku(threadId),
  });
};

/* ── Załącznik: deklaracja, potem binaria (0.195.0) ──────────────────────────
   Allegro dzieli wgranie na DWA żądania i nie da się tego skrócić:
   `POST /messaging/message-attachments` z `{ filename, size }` oddaje `{ id }`,
   a dopiero `PUT /messaging/message-attachments/{id}` niesie bajty. Rozmiar
   podaje się z góry, więc kłamstwo w deklaracji Allegro wyłapie samo.        */

/** Największy plik wg `NewAttachmentDeclaration.size` — `maximum: 5242880`. */
export const LIMIT_ZALACZNIKA = 5 * 1024 * 1024;

/** Typy z `requestBody` wgrania. Innych specyfikacja NIE wymienia. */
export const TYPY_ZALACZNIKA = [
  "image/png", "image/gif", "image/bmp", "image/tiff", "image/jpeg", "application/pdf",
] as const;

export type WgrajZalacznik = (
  nazwa: string, typ: string, dane: Uint8Array,
) => Promise<{ id: string }>;

export const wgrajZalacznikDoAllegro: WgrajZalacznik = async (nazwa, typ, dane) => {
  const deklaracja = await zapytajAllegro(urlDeklaracjiZalacznika(config.allegro.apiUrl), {
    metoda: "POST",
    body: { filename: nazwa, size: dane.byteLength },
  }) as { id?: unknown } | null;
  const id = deklaracja?.id == null ? null : String(deklaracja.id);
  if (!id) throw new Error("Allegro nie oddało numeru deklaracji załącznika");

  /* Binaria idą TĄ SAMĄ deklaracją, więc rozmiar musi się zgadzać co do bajtu
     z tym, co poszło wyżej — stąd jedna zmienna na dane, nie dwie ścieżki. */
  await zapytajAllegro(urlWgraniaZalacznika(config.allegro.apiUrl, id), {
    metoda: "PUT",
    plik: { dane, typ },
  });
  return { id };
};
