import { createHash } from "node:crypto";

/* ── Rdzeń idempotencji wysyłek (0.224.0) ────────────────────────────────────
   Dwie funkcje wyjęte z `services/wysylka.ts`, gdzie stały od 0.148.0. Obie są
   w całości niezależne od domeny — biorą liczby i łańcuchy, nie dotykają bazy
   ani Allegro — a od tego wydania potrzebuje ich drugi moduł: odpowiedź
   w reklamacji.

   WYJĘTE, NIE SKOPIOWANE. Druga kopia rozjechałaby się z pierwszą przy
   pierwszej poprawce, a objawem rozjazdu byłaby wysyłka wychodząca dwa razy
   w jednym z dwóch modułów — czyli dokładnie to, przed czym te funkcje mają
   chronić.

   MASZYNY STANU OUTBOXU NIE UOGÓLNIAMY. Silnik sparametryzowany nazwą tabeli
   znaczy SQL sklejany z łańcuchów, a bramki obu modułów i tak są różne:
   skrzynka ma właściciela rozmowy i uchwyt obecności, reklamacja — zamknięty
   czat po stronie Allegro. Powtarzamy WZORZEC, nie kod.                      */

/**
 * Klucz idempotencji wylicza SERWER, nie klient.
 *
 * Gdyby podawał go klient, dwie zakładki albo podwójne kliknięcie dałyby dwa
 * różne klucze i dwie odpowiedzi u kupującego. Wyliczony z rekordu, ostatniej
 * cudzej wiadomości i treści jest identyczny dla tego samego zamiaru — a inny,
 * gdy agent poprawił choć jedno słowo.
 *
 * `prefiks` nazywa RODZINĘ wysyłki (`snd-` skrzynka, `rkl-` reklamacje).
 * Bez niego dwa moduły wyliczyłyby ten sam klucz dla rozmowy i reklamacji
 * o tym samym numerze wewnętrznym. Kolumny `idempotency_key` są wprawdzie
 * osobne i każda UNIQUE we własnej tabeli, więc kolizja niczego by dziś nie
 * zepsuła — ale klucz trafia do ładunku 409 i na ekran agenta, a dwa różne
 * byty pod jedną nazwą to pomyłka czekająca na swój dzień.
 */
export function kluczWysylki(
  prefiks: string, rekordId: number, ostatniaId: number | null,
  tresc: string, zalaczniki: string[] = [],
): string {
  /* ZAŁĄCZNIKI WCHODZĄ DO KLUCZA (0.195.0). Bez nich „ten sam tekst z innym
     zdjęciem" miałby klucz identyczny z wysyłką sprzed chwili, a strażnik
     dubletu oddałby stan tamtej próby zamiast wysłać poprawiony komplet —
     czyli zdjęcie po cichu nie poszłoby do klienta. Kolejność sortowana, bo
     ta sama para plików dodana odwrotnie to ten sam zamiar. */
  const material = zalaczniki.length === 0
    ? tresc
    : `${tresc}\u0000${[...zalaczniki].sort().join(",")}`;
  const skrot = createHash("sha256").update(material).digest("hex").slice(0, 4);
  return `${prefiks}${rekordId}-${ostatniaId ?? 0}-${skrot}`;
}

/**
 * Czy porażka wysyłki jest NIEJEDNOZNACZNA.
 *
 * Niejednoznaczny timeout to NIE to samo co odmowa. Odmowę widać w kodzie HTTP
 * i wiadomo, że nic nie poszło; po timeoucie żądanie mogło dojść. §8.5: takiej
 * wysyłki nie ponawiamy automatycznie — rozstrzyga ją dopiero synchronizacja.
 */
export const niejednoznaczny = (e: unknown): boolean =>
  /timeout|abort|ECONNRESET|socket hang up/i.test(e instanceof Error ? e.message : String(e));
