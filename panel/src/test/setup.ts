import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/* Bez sprzątania po każdym teście kolejny render widzi poprzedni ekran
   i asercje „jest dokładnie jeden wiersz" kłamią. */
afterEach(cleanup);
