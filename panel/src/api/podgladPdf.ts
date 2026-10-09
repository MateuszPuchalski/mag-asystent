import { useQuery } from "@tanstack/react-query";
import { pobierzBajty } from "./klient";

/* ── Bajty PDF-a z trasy podglądu ────────────────────────────────────────────
   Miniatura w czacie i okno całego dokumentu czytają TEN SAM wpis zapytania.
   Klik w miniaturę otwiera więc okno bez drugiego pobrania, a plik z Allegro
   bywa wielomegabajtowy.

   `staleTime: Infinity`, bo załącznik wiadomości się nie zmienia: raz
   przysłany PDF zostaje tym samym plikiem. Powrót na kartę nie ma go pobierać
   drugi raz. `retry: false`, bo 404, 413 i 415 są odpowiedzią o pliku,
   a awaria drogi ma pod kaflem własne „Spróbuj ponownie”.

   To jest GET, więc otwarcie czatu z PDF-em niczego nie zapisuje. */

export const kluczPodgladuPdf = (sciezka: string) => ["podglad-pdf", sciezka] as const;

export function useBajtyPdf(sciezka: string) {
  return useQuery({
    queryKey: kluczPodgladuPdf(sciezka),
    queryFn: () => pobierzBajty(sciezka),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
