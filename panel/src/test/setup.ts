import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { zainstalujObserwator, zapomnijObserwatorow } from "./kadr";

/* Bez sprzątania po każdym teście kolejny render widzi poprzedni ekran
   i asercje „jest dokładnie jeden wiersz" kłamią. */
afterEach(cleanup);

/* jsdom nie liczy układu, więc nie ma `scrollIntoView` — a kolejka zwrotów
   dogania nim kursor od 0.165.0. Atrapa jest tu, nie w pojedynczym teście,
   bo woła ją każdy ekran renderujący kolejkę. Sam fakt, że atrapa jest
   potrzebna, dobrze opisuje granicę jsdomu: przewijanie sprawdza się okiem
   w przeglądarce, nie tutaj. */
Element.prototype.scrollIntoView = vi.fn();

/* ── MAGAZYN KARTY CZYŚCI SIĘ MIĘDZY TESTAMI (0.423.0) ───────────────────────
   Od kiedy szkic odpowiedzi w reklamacji i dyskusji trwa w `sessionStorage`
   (`sprawy/useSzkicSprawy.ts`), pisanie w jednym teście dopisywało się do
   pola w następnym: jsdom trzyma magazyn przez cały plik, a obie sprawy mają
   ten sam numer. Dwa testy ekranu reklamacji zobaczyły przez to treść
   podwojoną i potrojoną — i miały rację, że się o to wywróciły.

   Każdy test jest ŚWIEŻĄ KARTĄ PRZEGLĄDARKI i tak ma wyglądać jego start.
   To nie jest obejście asercji: żadna się nie zmieniła, zmienił się stan
   wejściowy, który i tak był przypadkowy. `try`, bo magazyn bywa głuchy. */
afterEach(() => {
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch { /* jak w hooku — brak magazynu nie jest awarią testu */ }
});

/* Obserwator przecięć (0.260.0) — powód i granice stoją w `kadr.ts`. Instalacja
   jest tutaj, bo dotyczy KAŻDEGO testu renderującego oś rozmowy, a nie jednego
   pliku. Rejestr czyścimy po każdym teście z tego samego powodu, co ekran:
   obserwator z poprzedniego renderu odpowiadałby na sygnał następnego. */
zainstalujObserwator();
afterEach(zapomnijObserwatorow);
