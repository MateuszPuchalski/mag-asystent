import { config } from "../config.js";
import type { NadawcaKlasyfikacji } from "../services/copilot-klasyfikacja.js";
import { nadawcaAnthropic } from "./copilot.anthropic.js";
import { MODEL_JEV, nadawcaJev } from "./copilot.jev.js";

/**
 * Jedyne wejście do rozpoznawania wiadomości klientów. Trzy drogi — takt,
 * przebieg przed pracą i ręczne kliknięcie — muszą iść do tego samego
 * dostawcy. Gdyby każda wybierała sama, pomiar trafności zmieszałby dwa
 * klasyfikatory.
 *
 * Dostawcę wybiera sam klucz TypeSafe: jest — rozpoznaje Jev, nie ma — Claude.
 * Osobny przełącznik pozwalałby na stan „Jev bez klucza”, w którym serwer nie
 * rozpoznaje wiadomości wcale. Szkice zawsze robi Claude, bo Jev nie generuje
 * tekstu. Pole czytamy przy każdym wywołaniu, żeby test mógł je przestawić.
 */
export const nadawcaKlasyfikacji: NadawcaKlasyfikacji = (tresc) =>
  (config.copilot.kluczJev ? nadawcaJev : nadawcaAnthropic)(tresc);

/** Model, który naprawdę rozpoznaje. To pokazuje ekran, a nie zgadywaną nazwę. */
export const modelKlasyfikatora = (): string =>
  config.copilot.kluczJev ? MODEL_JEV : config.copilot.modelKlasyfikacji;
