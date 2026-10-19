/* Moduł-liść: nie importuje żadnego serwisu i tak ma zostać. Listę czytają
   skrzynka, reklamacje, trasy podglądu i zdjęcia Copilota. W `skrzynka.ts`
   zamknęłaby cykl importów (skrzynka → szkic Copilota → zdjęcia → skrzynka). */

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

/**
 * Typy dokumentu, które oś pokazuje miniaturą, a klik otwiera w panelu.
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Paragon, faktura i protokół z serwisu przychodzą od klienta jako PDF.
 * Właściciel: „w czacie powinno pokazywać pliki pdf do podglądu". Bez tego
 * agent ściąga plik na dysk, żeby przeczytać jedno zdanie.
 *
 * ── DLACZEGO OSOBNA LISTA, A NIE DOPISEK DO `TYPY_PODGLADU` ───────────────
 * `TYPY_PODGLADU` czyta też Copilot i każdy wpis tam to plik wysłany
 * dostawcy modelu. PDF do modelu nie idzie, więc nie może stać na liście,
 * którą model dziedziczy. Druga lista zostawia tamtą decyzję nietkniętą.
 *
 * PDF niesie JavaScript i formularze. Rysuje go pdf.js w przeglądarce
 * z wyłączonymi skryptami, a trasa dokłada `content-security-policy: sandbox`
 * — gdyby ktoś wszedł na adres paskiem, skrypt pliku nie dostanie naszego
 * origin.
 */
export const TYPY_DOKUMENTU = ["application/pdf"] as const;

/**
 * Typ do odesłania na osi: obraz z `TYPY_PODGLADU` albo PDF; reszta `null`.
 *
 * Czytają go trasy podglądu i podpowiedź `pdf` w skrzynce. Copilot zostaje
 * przy `typPodgladu`, bo tam PDF nie ma prawa przejść.
 */
export function typPodgladuOsi(mime: string | null | undefined): string | null {
  const obraz = typPodgladu(mime);
  if (obraz !== null) return obraz;
  if (mime == null) return null;
  const czysty = String(mime).split(";")[0]!.trim().toLowerCase();
  return TYPY_DOKUMENTU.find((t) => t === czysty) ?? null;
}

/**
 * Czy nazwa pliku obiecuje PDF. PODPOWIEDŹ UKŁADU, nie prawda.
 *
 * Panel rysuje po niej miniaturę zamiast samej nazwy. O wydaniu decydują
 * bajty na trasie podglądu: `paragon.pdf` bez sygnatury `%PDF-` dostaje 415.
 */
export const czyPdfZNazwy = (nazwa: string | null | undefined): boolean =>
  /\.pdf$/i.test((nazwa ?? "").trim());

/**
 * Sufit bajtów podglądu na osi: 20 MiB.
 *
 * Podgląd rysuje się sam przy otwarciu sprawy, bez kliknięcia agenta. Bez
 * sufitu jeden skan na sto stron wciąga do pamięci serwera wszystko naraz,
 * przy każdym agencie, który otworzy rozmowę. Skan paragonu z telefonu waży
 * kilka megabajtów, więc 20 MiB zostawia zapas na wielostronicową fakturę.
 * Pobranie na dysk sufitu nie ma: to jawna czynność, jeden plik naraz.
 */
export const SUFIT_PODGLADU_BAJTOW = 20 * 1024 * 1024;
