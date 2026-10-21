/* ── Plik z dysku do ciała JSON (0.274.0) ────────────────────────────────────
   Wydzielone, bo robi to kilka miejsc: załączniki skrzynki (od 0.195.0),
   reklamacja i zdjęcia do dopytania Copilota. Druga kopia rozjechałaby się
   przy pierwszej poprawce jednej z nich, a objawem byłby plik wysłany
   z jednego miejsca i odrzucony z drugiego.

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
export async function naBase64(plik: Blob): Promise<string> {
  const bajty = new Uint8Array(await plik.arrayBuffer());
  let napis = "";
  for (let i = 0; i < bajty.length; i += PORCJA) {
    napis += String.fromCharCode(...bajty.subarray(i, i + PORCJA));
  }
  return btoa(napis);
}

/** Dłuższy bok miniatury. Tyle wystarcza, żeby w historii poznać kartkę albo część. */
const BOK_MINIATURY = 320;
/** Granica serwera dla jednej miniatury. Większej nie zapisze, więc nie ma po co jej wysyłać. */
const BAJTOW_MINIATURY = 100_000;

/**
 * Miniatura JPEG obrazu jako base64 albo `null`.
 *
 * Robi ją PRZEGLĄDARKA, nie serwer: ma dekoder każdego formatu, który agent
 * wklei, a serwer musiałby po to dostać bibliotekę obrazów.
 *
 * `null` ZAMIAST WYJĄTKU. Miniatura służy tylko historii, a zdjęcie i tak idzie
 * do modelu w oryginale. Pytanie nie może przepaść dlatego, że przeglądarka
 * (albo jsdom w testach) nie ma płótna albo nie zdekodowała pliku.
 */
export async function miniaturaJpeg(plik: Blob): Promise<string | null> {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
    const obraz = await createImageBitmap(plik);
    const skala = Math.min(1, BOK_MINIATURY / Math.max(obraz.width, obraz.height, 1));
    const szer = Math.max(1, Math.round(obraz.width * skala));
    const wys = Math.max(1, Math.round(obraz.height * skala));
    const plotno = document.createElement("canvas");
    plotno.width = szer;
    plotno.height = wys;
    const kontekst = plotno.getContext("2d");
    if (!kontekst) { obraz.close(); return null; }
    /* JPEG nie ma przezroczystości. Bez białego tła przezroczysty zrzut PNG
       wychodzi czarny i w historii nie widać na nim nic. */
    kontekst.fillStyle = "white";
    kontekst.fillRect(0, 0, szer, wys);
    kontekst.drawImage(obraz, 0, 0, szer, wys);
    obraz.close();
    const jpeg = await new Promise<Blob | null>((gotowe) => plotno.toBlob(gotowe, "image/jpeg", 0.8));
    if (!jpeg || jpeg.size > BAJTOW_MINIATURY) return null;
    return await naBase64(jpeg);
  } catch {
    return null;
  }
}
