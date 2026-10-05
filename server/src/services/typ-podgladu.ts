/* Moduł-liść: nie importuje żadnego serwisu i tak ma zostać. Listę czytają
   skrzynka, reklamacje i zdjęcia Copilota. W `skrzynka.ts` zamknęłaby cykl
   importów (skrzynka → szkic Copilota → zdjęcia → skrzynka). */

/**
 * Typy obrazu, które oś rysuje WPROST, bez klikania.
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * W sklepie z częściami do maszyn ogrodniczych zdjęcie pękniętego elementu
 * bywa CAŁĄ treścią pytania. Sama nazwa pliku na osi to za mało: agent
 * musiałby kliknąć, ściągnąć plik na dysk i otworzyć go w przeglądarce zdjęć,
 * żeby zobaczyć, o co klient pyta. Właściciel: „wyświetlaj w czacie, nie każ
 * mi w nie klikać".
 *
 * ── DLACZEGO LISTA, A NIE `image/*` ───────────────────────────────────────
 * `image/svg+xml` JEST obrazem i JEST dokumentem ze skryptem. Wpuszczony do
 * `<img>` skryptu nie odpali, ale ta lista broni się sama, bez polegania na
 * tym, gdzie dokładnie przeglądarka stawia granicę — plik przychodzi od obcego
 * i leci przez nasz origin. To ta sama ostrożność, co nagłówek
 * `content-disposition: attachment` przy pobieraniu.
 *
 * Cztery formaty rastrowe pokrywają wszystko, co wychodzi z telefonu.
 */
export const TYPY_PODGLADU = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/**
 * Typ do odesłania w podglądzie albo `null`, gdy plik nie jest obrazem z listy.
 *
 * ZWRACAMY WARTOŚĆ Z LISTY, nie z bazy. `mime_type` przyszedł od Allegro,
 * a nagłówek `content-type` przepisany z cudzego pola to cudzy tekst
 * w naszej odpowiedzi.
 */
export function typPodgladu(mime: string | null | undefined): string | null {
  if (mime == null) return null;
  /* Sam typ, bez parametrów w rodzaju `; charset=` — i bez wielkości liter,
     bo RFC 2045 mówi, że typ jest nieczuły na wielkość, a nadawcy bywają różni. */
  const czysty = String(mime).split(";")[0]!.trim().toLowerCase();
  return TYPY_PODGLADU.find((t) => t === czysty) ?? null;
}
