import type { FastifyReply } from "fastify";
import { BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { BladRozmiaruZalacznika } from "../adapters/allegro.http.js";

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

/**
 * Błąd PODGLĄDU na osi: jak `bladPobrania`, plus 413 przy pliku ponad sufit.
 *
 * 413, bo to odpowiedź, nie awaria: plik jest i da się go pobrać na dysk,
 * tylko na oś go nie wciągamy. Zdanie mówi, co zrobić zamiast tego.
 */
export const bladPodgladu = (reply: FastifyReply, e: unknown, nazwa: string) => {
  if (e instanceof BladRozmiaruZalacznika) {
    return reply.code(413).send({
      error: `Załącznik „${nazwa}" ma ${(e.bajtow / 1024 / 1024).toFixed(1)} MB, ` +
        `a podgląd przyjmuje do ${Math.round(e.sufit / 1024 / 1024)} MB. Pobierz go na dysk.`,
    });
  }
  return bladPobrania(reply, e);
};

/**
 * Odpowiedź podglądu na osi — wspólna dla skrzynki i reklamacji.
 *
 * `typ` przychodzi z listy (`typPodgladuOsi`), nigdy z bazy ani od Allegro.
 * `nosniff` zabrania przeglądarce zgadywać lepiej niż sygnatura.
 *
 * `content-security-policy: sandbox` stoi przy KAŻDYM podglądzie, choć
 * potrzebuje go PDF. PDF niesie JavaScript, a ten adres otwiera się też
 * paskiem przeglądarki; piaskownica odbiera skryptowi nasz origin. Obrazowi
 * w `<img>` nagłówek nie szkodzi, a jedna odpowiedź to jedno miejsce
 * do pomyłki mniej.
 */
export const wyslijPodglad = (reply: FastifyReply, typ: string, bajty: Buffer, etag: string) =>
  reply
    .header("content-type", typ)
    .header("content-length", String(bajty.byteLength))
    .header("x-content-type-options", "nosniff")
    .header("content-disposition", "inline")
    .header("content-security-policy", "sandbox")
    .header("etag", etag)
    .header("cache-control", "private, max-age=86400")
    .send(bajty);
