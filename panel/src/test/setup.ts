import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/* Bez sprzątania po każdym teście kolejny render widzi poprzedni ekran
   i asercje „jest dokładnie jeden wiersz" kłamią. */
afterEach(cleanup);

/* jsdom nie liczy układu, więc nie ma `scrollIntoView` — a kolejka zwrotów
   dogania nim kursor od 0.165.0. Atrapa jest tu, nie w pojedynczym teście,
   bo woła ją każdy ekran renderujący kolejkę. Sam fakt, że atrapa jest
   potrzebna, dobrze opisuje granicę jsdomu: przewijanie sprawdza się okiem
   w przeglądarce, nie tutaj. */
Element.prototype.scrollIntoView = vi.fn();
