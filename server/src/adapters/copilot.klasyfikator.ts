import { config } from "../config.js";
import type { NadawcaKlasyfikacji } from "../services/copilot-klasyfikacja.js";
import { nadawcaAnthropic } from "./copilot.anthropic.js";
import { nadawcaJev } from "./copilot.jev.js";

/**
 * Nadawca klasyfikacji wybrany przez `KLASYFIKATOR_DOSTAWCA`. Wybór zapada przy
 * KAŻDYM wywołaniu, nie przy imporcie: powrót do Claude ma być jedną zmianą
 * w `wertis.env` i restartem, a test ma móc przełączyć dostawcę bez
 * przeładowywania modułów.
 *
 * Jedno miejsce, bo trzy drogi rozpoznawania (takt, przebieg przed pracą,
 * ręczne kliknięcie) muszą iść do tego samego dostawcy. Gdyby każda wybierała
 * sama, jedna wysłałaby wątek do Claude, kiedy dwie pozostałe wysyłają go
 * do Jeva, i pomiar trafności zmieszałby dwa klasyfikatory.
 */
export const nadawcaKlasyfikacji: NadawcaKlasyfikacji = (tresc) =>
  (config.copilot.klasyfikator === "jev" ? nadawcaJev : nadawcaAnthropic)(tresc);
