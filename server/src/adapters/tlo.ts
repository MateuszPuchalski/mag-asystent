import { config } from "../config.js";
import { rozpoznajMime } from "./zdjecia.sgt.js";

/* ── Usuwanie tła ze zdjęcia z kolektora (0.88.0) ────────────────────────────
   CAŁY kontakt z usługą `wertis-tlo` żyje w TYM pliku — z tego samego powodu,
   dla którego cały kontakt ze źródłem zdjęć żyje w `zdjecia.sgt.ts`, a wszystkie
   wywołania COM w `SferaComAdapter.cs`. Gdy usługa zmieni protokół albo model,
   zmienia się jeden plik, a nie trasa, podgląd i kolektor.

   DLACZEGO OSOBNY PROCES, A NIE BIBLIOTEKA. Model działa na runtime ONNX, czyli
   na module natywnym. Serwer WERTIS ma dwie zależności i zero modułów natywnych
   (`db/db.ts`, `services/zdjecia.ts`, `services/logo-dostawcy.ts`) — nie dlatego,
   że tak ładniej, tylko dlatego, że stoi na maszynie, na której biuro wystawia
   faktury, i ma się dać zainstalować bez kompilatora. Wzorzec na taki przypadek
   repozytorium już ma: `sfera-worker/` to trzeci proces, .NET 8, samowystarczalny
   exe pod nssm, domyślnie wyłączony. To jest czwarty.

   ROZRÓŻNIENIE, NA KTÓRYM STOI CAŁY PODGLĄD — to samo co w `zdjecia.sgt.ts`:
   `null` znaczy „tła NIE USUNIĘTO" (odpowiedź poprawna, człowiek ją zobaczy
   i zdecyduje), a wyjątek znaczy „nie dało się zapytać" (stan przejściowy).
   Zlanie ich w jedno zamieniłoby padniętą usługę w ciche „zdjęcie z tłem"
   i nikt nigdy nie skojarzyłby, że wycinanie w ogóle nie działa.               */

/**
 * Zdanie o niedziałającej usłudze tła — czytane przez `/api/health`.
 *
 * Bez niego objawem jest „zdjęcia wychodzą z tłem", czyli dokładnie to samo,
 * co magazynier wybierający „ZOSTAW TŁO". Wzorzec: `brakDostepuDoZdjec`.
 */
export let brakDostepuDoTla: string | null = null;

/* Bezpiecznik jak przy źródle zdjęć: po tylu błędach z rzędu przestajemy pytać
   usługę na `bladTtlMin`. Bez niego padnięty proces zamienia każde zrobione
   zdjęcie w kilkunastosekundowe kółko — a to wygląda jak zawieszony kolektor,
   nie jak wyłączone wycinanie tła. */
const BLEDOW_DO_ODCIECIA = 3;
let bledowZRzedu = 0;
let odciecieDo = 0;

/** Czy funkcja jest w ogóle włączona. Puste `TLO_URL` = nie ma jej i koniec. */
export function tloWlaczone(): boolean {
  return config.tlo.url !== "";
}

/**
 * Zdjęcie bez tła — PNG z przezroczystością.
 *
 * @returns `null`, gdy usługa jest wyłączona, odcięta bezpiecznikiem albo sama
 *   odmówiła wycięcia (odpowiedź poprawna: podgląd pokaże wtedy oryginał)
 * @throws gdy usługa jest włączona, a rozmowy z nią nie dało się przeprowadzić
 *   — to stan przejściowy i wołający ma prawo go odróżnić
 */
export async function usunTlo(obraz: Buffer, mime: string): Promise<Buffer | null> {
  if (!tloWlaczone()) return null;
  if (Date.now() < odciecieDo) {
    throw new Error(brakDostepuDoTla ?? "Usługa usuwania tła chwilowo odcięta po serii błędów");
  }

  let odp: Response;
  try {
    odp = await fetch(new URL("/tlo", config.tlo.url), {
      method: "POST",
      headers: { "content-type": mime },
      body: new Uint8Array(obraz),
      signal: AbortSignal.timeout(config.tlo.timeoutMs),
    });
  } catch (e) {
    throw odnotujBlad(e instanceof Error ? e.message : String(e));
  }

  /* 422 to ODMOWA, nie awaria: usługa obejrzała zdjęcie i nie znalazła na nim
     przedmiotu. Zdjęcie regału z pięcioma kartonami wygląda właśnie tak.
     Człowiek zobaczy oryginał i zapisze go przyciskiem „ZOSTAW TŁO". */
  if (odp.status === 422) {
    zerujBezpiecznik();
    return null;
  }
  if (!odp.ok) {
    throw odnotujBlad(`usługa odpowiedziała ${odp.status}`);
  }

  const bajty = Buffer.from(await odp.arrayBuffer());
  /* Typ rozpoznajemy Z BAJTÓW, nie z nagłówka — ta sama reguła co przy odczycie
     zdjęć z bazy Subiekta. Usługa, która odesłała komunikat błędu jako `text`
     z kodem 200, dałaby na karcie pusty prostokąt bez żadnego powodu. */
  if (rozpoznajMime(bajty) !== "image/png") {
    throw odnotujBlad("usługa odesłała coś, co nie jest plikiem PNG");
  }

  zerujBezpiecznik();
  return bajty;
}

function zerujBezpiecznik(): void {
  bledowZRzedu = 0;
  brakDostepuDoTla = null;
}

function odnotujBlad(powod: string): Error {
  bledowZRzedu++;
  brakDostepuDoTla =
    `Nie da się usunąć tła ze zdjęcia (${powod}). Zdjęcia zapisują się z tłem. ` +
    `Sprawdź usługę wertis-tlo pod ${config.tlo.url} — wdrożenie: DEPLOY.md §6.`;
  if (bledowZRzedu >= BLEDOW_DO_ODCIECIA) {
    odciecieDo = Date.now() + config.zdjecia.bladTtlMin * 60_000;
    console.warn(
      `[tlo] ${BLEDOW_DO_ODCIECIA} błędy z rzędu — przerwa ${config.zdjecia.bladTtlMin} min`
    );
  }
  return new Error(brakDostepuDoTla);
}

/** Wyłącznie dla testów: kasuje bezpiecznik między przypadkami. */
export function zresetujBezpiecznikTla(): void {
  bledowZRzedu = 0;
  odciecieDo = 0;
  brakDostepuDoTla = null;
}
