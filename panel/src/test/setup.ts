import "@testing-library/jest-dom/vitest";
import { afterEach, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { zainstalujObserwator, zapomnijObserwatorow } from "./kadr";
import { sprawdzDostepnosc } from "./dostepnosc";

/* Bez sprzątania po każdym teście kolejny render widzi poprzedni ekran
   i asercje „jest dokładnie jeden wiersz" kłamią. */
afterEach(cleanup);

/* jsdom nie liczy układu, więc nie ma `scrollIntoView` — a kolejka zwrotów
   dogania nim kursor. Atrapa jest tu, nie w pojedynczym teście,
   bo woła ją każdy ekran renderujący kolejkę. Sam fakt, że atrapa jest
   potrzebna, dobrze opisuje granicę jsdomu: przewijanie sprawdza się okiem
   w przeglądarce, nie tutaj. */
Element.prototype.scrollIntoView = vi.fn();

/* ── MAGAZYN KARTY CZYŚCI SIĘ MIĘDZY TESTAMI ─────────────────────────────────
   Szkic odpowiedzi trwa w `sessionStorage` (`sprawy/useSzkicSprawy.ts`),
   a jsdom trzyma magazyn przez cały plik. Pisanie w jednym teście
   dopisywałoby się do pola w następnym, bo obie sprawy mają ten sam numer.

   Każdy test jest ŚWIEŻĄ KARTĄ PRZEGLĄDARKI i tak ma wyglądać jego start.
   `try`, bo magazyn bywa głuchy. */
afterEach(() => {
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch { /* jak w hooku — brak magazynu nie jest awarią testu */ }
});

/* Obserwator przecięć — powód i granice stoją w `kadr.ts`. Instalacja
   jest tutaj, bo dotyczy KAŻDEGO testu renderującego oś rozmowy, a nie jednego
   pliku. Rejestr czyścimy po każdym teście z tego samego powodu, co ekran:
   obserwator z poprzedniego renderu odpowiadałby na sygnał następnego. */
zainstalujObserwator();
afterEach(zapomnijObserwatorow);

/* Dostępność ekranu — powód, zakres i granice w `dostepnosc.ts`.
   Rejestrowane PO `cleanup`, a Vitest woła `afterEach` od ostatniego
   zarejestrowanego, więc axe widzi jeszcze wyrenderowany ekran. */
afterEach(() => sprawdzDostepnosc(expect.getState().testPath));
