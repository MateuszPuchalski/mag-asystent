import { useFirma, type DaneFirmy } from "../api/ustawienia";
import type { Firma } from "./szablony";

/* ── Dane firmy do druków dostawców (0.435.0, serwer od 0.444.0) ──────────
   Druki GEKO i PARTNER pytają o dane ZGŁASZAJĄCEGO — nazwę, NIP, adres,
   osobę kontaktową. Przez lata mieszkały w `localStorage` przeglądarki biura
   pod kluczem `wertis.firma`, więc każde biurko miało własny komplet, a nowe
   drukowało protokół z pustym nagłówkiem. Od 0.444.0 stoją na serwerze
   (`/api/biuro/firma`) i wpisuje je karta „Dane firmy" w Ustawieniach.

   KLUCZ PRZEGLĄDARKI ZOSTAJE JAKO ZAPAS NA JEDNO WYDANIE. Dzień wdrożenia
   zastaje serwer pusty, a dane w przeglądarce; bez zapasu pierwszy protokół
   po aktualizacji wyszedłby bez nagłówka. Zapas działa WYŁĄCZNIE, dopóki nikt
   nie zapisał danych na serwerze — potem serwer wygrywa zawsze, także pustym
   polem, bo puste pole zapisał człowiek.

   ZAPAS PRZEŻYŁ PRZEŁĄCZENIE (0.446.0), choć plan kazał go zdjąć. Wydania
   wchodzą na serwer przez `git pull`, więc biuro może przeskoczyć z wersji
   sprzed 0.444.0 wprost na tę — i wtedy nikt jeszcze nie kliknął
   „Przenieś na serwer". Zapas nic nie kosztuje, a jego brak to protokół bez
   nagłówka. Zejdzie, gdy serwer ma dane na każdej instalacji.

   Automatycznego przepisania z przeglądarki na serwer nie ma: otwarcie druku
   nie może niczego zapisywać. Robi to przycisk w Ustawieniach. */

const KLUCZ = "wertis.firma";

/** Komplet z przeglądarki w kształcie druku (klucze z wielkiej litery, jak w biurze). */
export function firmaZPrzegladarki(): Firma {
  try {
    const f = JSON.parse(localStorage.getItem(KLUCZ) ?? "null") as unknown;
    return f && typeof f === "object" ? (f as Firma) : {};
  } catch { return {}; }
}

/** Czy przeglądarka ma cokolwiek do przeniesienia. */
export const przegladarkaMaFirme = () => Object.values(firmaZPrzegladarki()).some((v) => typeof v === "string" && v.trim() !== "");

/** Serwer → kształt druku. Szablony zostały przy kluczach biura, bo to wierne kopie cudzych formularzy. */
export const naDruk = (d: DaneFirmy): Firma => ({
  Nazwa: d.nazwa, Nip: d.nip, Adres: d.adres, Miejscowosc: d.miejscowosc, Osoba: d.osoba, Telefon: d.telefon,
});

/** Przeglądarka → kształt serwera, dla przycisku przeniesienia. */
export const zDruku = (f: Firma): DaneFirmy => ({
  nazwa: f.Nazwa ?? "", nip: f.Nip ?? "", adres: f.Adres ?? "",
  miejscowosc: f.Miejscowosc ?? "", osoba: f.Osoba ?? "", telefon: f.Telefon ?? "",
});

/**
 * Dane firmy dla druku: `undefined` do chwili odpowiedzi serwera — druk
 * czeka, zamiast wyjść raz z zapasem, a raz z serwera. Błąd odczytu też
 * spada na zapas: protokół bez nagłówka jest gorszy niż protokół z kopią
 * z tej przeglądarki.
 */
export function useFirmaDruku(): Firma | undefined {
  const f = useFirma();
  if (f.isPending) return undefined;
  if (f.data?.zmieniono) return naDruk(f.data.dane);
  return firmaZPrzegladarki();
}
