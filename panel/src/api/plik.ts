/* ── Plik z dysku do ciała JSON (0.274.0) ────────────────────────────────────
   Wydzielone, bo od tego wydania robią to DWA ekrany: skrzynka (od 0.195.0)
   i reklamacja. Druga kopia rozjechałaby się przy pierwszej poprawce jednej
   z nich, a objawem byłby plik wysłany z jednego ekranu i odrzucony z drugiego.

   Bajty jadą base64 w JSON, jak zdjęcia dowodowe z kolektora: multipart
   wymagałby wtyczki Fastify dla dwóch tras.                                 */

/** Ile bajtów przerabiamy naraz przy składaniu napisu. */
const PORCJA = 8192;

/**
 * Zawartość pliku jako base64.
 *
 * PORCJAMI, NIE JEDNYM `String.fromCharCode(...tablica)`: rozwinięcie całej
 * tablicy w argumenty przepełnia stos już przy kilkuset kilobajtach, a limit
 * pliku stoi na czterech megabajtach. To nie jest optymalizacja — to jedyna
 * wersja, która nie wywraca się na normalnym zdjęciu z telefonu.
 */
export async function naBase64(plik: File): Promise<string> {
  const bajty = new Uint8Array(await plik.arrayBuffer());
  let napis = "";
  for (let i = 0; i < bajty.length; i += PORCJA) {
    napis += String.fromCharCode(...bajty.subarray(i, i + PORCJA));
  }
  return btoa(napis);
}
