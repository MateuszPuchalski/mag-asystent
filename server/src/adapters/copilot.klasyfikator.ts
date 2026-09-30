import type { NadawcaKlasyfikacji } from "../services/copilot-klasyfikacja.js";
import { nadawcaAnthropic } from "./copilot.anthropic.js";

/**
 * Jedyne wejście do rozpoznawania wiadomości klientów. Trzy drogi — takt,
 * przebieg przed pracą i ręczne kliknięcie — muszą iść do tego samego
 * dostawcy. Gdyby każda wybierała sama, pomiar trafności zmieszałby dwa
 * klasyfikatory. Dziś dostawcą jest Claude; kolejny wpina się tutaj, a nie
 * w trasie ani w takcie.
 */
export const nadawcaKlasyfikacji: NadawcaKlasyfikacji = (tresc) => nadawcaAnthropic(tresc);
