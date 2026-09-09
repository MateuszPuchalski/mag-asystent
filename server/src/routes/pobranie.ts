import type { FastifyReply } from "fastify";
import { BladOdpowiedziAllegro } from "../adapters/allegro.js";

/**
 * Błąd POBRANIA załącznika od Allegro — inny kod niż `blad()` tras, bo to inna wina.
 *
 * 400 mówi „źle poprosiłeś", a przy załączniku prośba jest dobra: to Allegro
 * odmówiło (502 ze zdaniem z adaptera) albo nie dało się do niego dojść —
 * timeout, konto niepołączone, adres poza Allegro (503). Do 0.244.0 wszystko
 * szło jako 400 z JSON-em, więc panel nie odróżniał „Allegro nie oddało" od
 * 415 „to nie obraz" i rysował pustą linię pod nazwą pliku.
 *
 * JEDEN POMOCNIK DLA OBU ROZMÓW (wydanie „wspólny załącznik"). Skrzynka
 * dostała te kody w 0.244.0, reklamacje zostały przy 400 — i czat reklamacji
 * dalej milczał przy tej samej odmowie. Wspólna powłoka w panelu zakłada,
 * że obie trasy mówią tym samym językiem kodów.
 */
export const bladPobrania = (reply: FastifyReply, e: unknown) =>
  reply.code(e instanceof BladOdpowiedziAllegro ? 502 : 503)
    .send({ error: e instanceof Error ? e.message : String(e) });
