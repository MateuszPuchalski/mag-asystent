import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import { retryAfterMs } from "./allegro.js";
import {
  BladKluczaCopilota, BladLimituCopilota, BladOdpowiedziCopilota,
} from "./copilot.js";
import {
  KATEGORIE, PEWNOSCI, type NadawcaKlasyfikacji, type OdpowiedzModelu,
} from "../services/copilot-klasyfikacja.js";

/* ── Wyjście do Anthropic (etap F) ───────────────────────────────────────────

   Ten plik jest JEDYNYM miejscem, w którym treść rozmowy opuszcza firmę.
   Przyjmuje `TrescBezpieczna`, więc goły `string` nie wejdzie tu nawet przez
   pomyłkę — maskowania pilnuje kompilator, nie przegląd kodu.

   KLUCZA NIE CZYTAMY SAMI. `new Anthropic()` bierze `ANTHROPIC_API_KEY` ze
   środowiska; własna kopia w `config` byłaby trzecim miejscem, z którego
   sekret mógłby wyciec do komunikatu błędu — a dokładnie tak zginął klucz
   w 0.84.1.                                                                  */

/* Schemat odpowiedzi. Kategoria jest ENUM-em, więc model nie ma jak wymyślić
   własnej wartości — a sygnałem „słownik za krótki" jest kategoria `inne`,
   która stoi w słowniku i liczy się w pomiarze. Walidacja po naszej stronie
   (`copilot-klasyfikacja.ts`) zostaje mimo to: odmowa albo ucięcie odpowiedzi
   dają `parsed_output === null` i to też musi mieć obsługę. */
const Wynik = z.object({
  kategoria: z.enum(KATEGORIE),
  pewnosc: z.enum(PEWNOSCI),
  uzasadnienie: z.string(),
});

/* INSTRUKCJA JEST STAŁA I STOI PIERWSZA — na tym stoi cache. Dopasowanie idzie
   po prefiksie, więc jeden zmienny bajt tutaj (data, numer rozmowy, imię
   agenta) unieważniałby wszystko po nim i płacilibyśmy pełną stawkę za każdą
   rozmowę. Treść wiadomości idzie osobno, jako `messages`. */
const INSTRUKCJA = [
  "Jesteś klasyfikatorem wiadomości w sklepie z częściami do sprzętu ogrodniczego.",
  "Dostajesz JEDNĄ wiadomość klienta i przypisujesz jej dokładnie jedną kategorię.",
  "",
  "Kategorie:",
  "- dobor: czy część pasuje do konkretnej maszyny, jakiej części szukać",
  "- dostepnosc: czy towar jest, kiedy będzie, ile sztuk, cena",
  "- wysylka: gdzie paczka, termin dostawy, zmiana adresu, kurier",
  "- zwrot: odstąpienie od umowy, zwrot towaru albo pieniędzy",
  "- reklamacja: towar wadliwy, uszkodzony, nie działa",
  "- dokumenty: faktura, paragon, dane do faktury",
  "- inne: rozumiesz pytanie, ale nie pasuje do żadnej z powyższych",
  "- nie_wiadomo: za mało treści, żeby rozstrzygnąć",
  "",
  "Pewność: wysoka, srednia albo niska.",
  "Uzasadnienie: jedno krótkie zdanie po polsku, do dziesięciu słów.",
  "W uzasadnieniu NIE powtarzaj danych osobowych ani numerów z wiadomości.",
  "Znaczniki [e-mail], [telefon], [adres], [konto], [login] to wycięte dane —",
  "traktuj je jako informację, że klient je podał, i nie zgaduj ich treści.",
].join("\n");

let klient: Anthropic | null = null;
const anthropic = (): Anthropic => (klient ??= new Anthropic());

/** Wyłącznie dla testów: podmiana klienta bez sięgania do sieci. */
export function _ustawKlienta(c: Anthropic | null): void {
  klient = c;
}

/**
 * Realny nadawca klasyfikacji. Wstrzykuje go TRASA, nie serwis — ten sam
 * wzorzec, co przy `zglosRabat` i `zwrocPlatnosc`.
 */
export const nadawcaAnthropic: NadawcaKlasyfikacji = async (tresc): Promise<OdpowiedzModelu> => {
  const start = Date.now();
  try {
    const odp = await anthropic().messages.parse({
      model: config.copilot.model,
      /* Klasyfikacja to kilka słów. Duży limit kosztowałby tyle samo, ale
         wydłużałby najgorszy przypadek przy odpowiedzi, która się rozgada. */
      max_tokens: 256,
      system: [{ type: "text", text: INSTRUKCJA, cache_control: { type: "ephemeral" } }],
      output_config: {
        /* Najniższy wysiłek: to nie jest trudne zadanie, a wysiłek jest
           pierwszą dźwignią kosztu. Myślenia NIE wyłączamy — na tym modelu
           wyłączone ma udokumentowane tryby awarii. */
        effort: "low",
        format: zodOutputFormat(Wynik),
      },
      messages: [{ role: "user", content: String(tresc) }],
    });

    const u = odp.usage;
    const zuzycie = {
      wej: u?.input_tokens ?? 0,
      wyj: u?.output_tokens ?? 0,
      cacheZapis: u?.cache_creation_input_tokens ?? 0,
      cacheOdczyt: u?.cache_read_input_tokens ?? 0,
    };

    /* `parsed_output` bywa puste: odmowa, ucięcie na `max_tokens`, brzeg
       gramatyki. Cisza byłaby najgorszą odpowiedzią — wywołanie było płatne
       i musi zostawić ślad w księdze jako błąd. */
    const w = odp.parsed_output;
    if (!w) {
      throw new BladOdpowiedziCopilota(
        `Model nie oddał rozstrzygnięcia (stop: ${odp.stop_reason ?? "?"})`, 200);
    }

    return {
      kategoria: w.kategoria,
      pewnosc: w.pewnosc,
      uzasadnienie: w.uzasadnienie,
      model: odp.model ?? config.copilot.model,
      zuzycie,
      ms: Date.now() - start,
    };
  } catch (e) {
    throw naNasz(e);
  }
};

/**
 * Błąd SDK na nasze klasy — od najbardziej szczegółowej.
 *
 * Limit ma własną klasę, bo woła o INNĄ reakcję niż odmowa: przy limicie się
 * czeka, przy złym kluczu naprawia konfigurację. Ten sam podział, co przy
 * Allegro, i z tego samego powodu — partia musi umieć rozpoznać, czy ma się
 * zatrzymać, czy lecieć dalej.
 */
function naNasz(e: unknown): Error {
  if (e instanceof BladOdpowiedziCopilota || e instanceof BladLimituCopilota
    || e instanceof BladKluczaCopilota) return e;

  if (e instanceof Anthropic.RateLimitError) {
    /* `Retry-After` czyta TA SAMA funkcja, co przy Allegro. Ona jest o
       nagłówku HTTP, nie o Allegro — druga kopia byłaby drugą prawdą o tym,
       co ten nagłówek znaczy. */
    const naglowek = czytajNaglowek(e, "retry-after");
    return new BladLimituCopilota(
      "Anthropic poprosiło o przerwę (429).", retryAfterMs(naglowek, Date.now()));
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return new BladKluczaCopilota(
      "Anthropic odrzuciło klucz (401) — sprawdź ANTHROPIC_API_KEY w wertis.env " +
      "i zrestartuj usługę.");
  }
  if (e instanceof Anthropic.APIError) {
    return new BladOdpowiedziCopilota(
      `Anthropic odpowiedziało ${e.status ?? "?"}: ${String(e.message).slice(0, 200)}`,
      e.status ?? 0);
  }
  return new BladOdpowiedziCopilota(
    `Brak połączenia z Anthropic — sprawdź internet na serwerze. ` +
    `(${e instanceof Error ? e.message : String(e)})`, 0);
}

/* Nagłówki błędu SDK bywają `Headers`, bywają zwykłym obiektem — czytamy
   ostrożnie, bo od tej wartości zależy tylko ładniejszy komunikat, a nie
   poprawność. Brak nagłówka daje `null` i zdanie bez zmyślonej liczby. */
function czytajNaglowek(e: unknown, nazwa: string): string | null {
  const h = (e as { headers?: unknown }).headers;
  if (!h) return null;
  if (typeof (h as Headers).get === "function") return (h as Headers).get(nazwa);
  const rec = h as Record<string, string | undefined>;
  return rec[nazwa] ?? rec[nazwa.toLowerCase()] ?? null;
}
