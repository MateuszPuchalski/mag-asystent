import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import { retryAfterMs } from "./allegro.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladOdpowiedziCopilota, BladPrzeciazeniaCopilota,
} from "./copilot.js";
import {
  KATEGORIE, PEWNOSCI, type NadawcaKlasyfikacji, type OdpowiedzModelu,
} from "../services/copilot-klasyfikacja.js";
import type { NadawcaSzkicu, OdpowiedzSzkicu } from "../services/copilot-szkic.js";
import { LIMIT_ZNAKOW } from "../services/wysylka.js";

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
      /* Punkt cache'owania, który DZIŚ NIE DZIAŁA i to jest świadome (0.193.1).
         Minimalny prefiks wchodzący do cache'u to 512-4096 tokenów zależnie od
         modelu, a `INSTRUKCJA` ma 943 znaki, czyli około 380 tokenów. API nie
         zgłasza tego błędem: po prostu nie cache'uje, a `cache_read_input_tokens`
         zostaje zerem. Sprawdzisz to bez zgadywania — księga zapisuje odczyty
         w `copilot-koszt.ts`.

         Znacznik ZOSTAJE, zamiast zniknąć, bo nic nie kosztuje, a instrukcja
         rośnie z każdą kategorią. Skasowany oznaczałby, że przy przekroczeniu
         progu cache po cichu NIE zadziała, i nikt się nie dowie dlaczego.
         Dociąganie treści na siłę, żeby próg przeskoczyć, byłoby płaceniem
         tokenami za zniżkę na tokenach — kolejne kategorie i przykłady mają
         wejść tu wtedy, gdy poprawiają trafność, nie gdy poprawiają rachunek. */
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

/* ── Szkic odpowiedzi (§14.6, przyrost drugi) ───────────────────────────────
   Drugie ZADANIE tego samego adaptera, ta sama droga błędów i ten sam klient.
   Osobna instrukcja, bo klasyfikator i redaktor to dwie różne role, a wspólny
   prefiks „jesteś klasyfikatorem" psułby jedną z nich.                       */

const Szkic = z.object({
  tresc: z.string(),
  uzyteFakty: z.array(z.string()),
  zastrzezenia: z.array(z.string()),
});

/* Instrukcja stoi PIERWSZA i jest STAŁA — na tym stoi cache (patrz wyżej).
   Tu prefiks jest już dość długi, żeby cache się włączył; sprawdzisz to
   w księdze po `cache_read_input_tokens`.

   Reguła 3 i 3a (0.232.2) mają jeden powód: klientka podała komplet danych
   z tabliczki (model FPLMP139) i poprosiła o linkę napędu, a szkic poprosił
   o tabliczkę raz jeszcze, bo fakt intake kazał „zapytać o…", a agent nie
   wpisał modelu do doboru. Model widział FPLMP139 w rozmowie i nie miał jak
   powiedzieć tego agentowi. */
const INSTRUKCJA_SZKICU = [
  "Układasz SZKIC odpowiedzi dla agenta obsługi klienta w sklepie z częściami",
  "do sprzętu ogrodniczego (kosiarki, pilarki, kosy, gaźniki, uszczelki).",
  "Szkic czyta i poprawia człowiek; do klienta wysyła go człowiek. Ty nie wysyłasz.",
  "",
  "DOSTAJESZ dwie części: FAKTY (ponumerowane F1, F2, …) ułożone przez system",
  "z bazy sklepu oraz ROZMOWĘ (wiersze KLIENT: i MY:, od najstarszej).",
  "",
  "ZASADY, KTÓRYCH NIE WOLNO ZŁAMAĆ:",
  "1. Nie znasz dopasowań części z pamięci. Każde twierdzenie techniczne",
  "   (co pasuje, co nie pasuje, jaki numer, jaki symbol) bierzesz WYŁĄCZNIE",
  "   z faktów i oznaczasz identyfikatorem w nawiasie, np. „pasuje (F3)”.",
  "   Pisz te odwołania ZAWSZE — system je sprawdza, a potem usuwa z tekstu,",
  "   zanim agent go zobaczy. Klient ich nie przeczyta.",
  "2. Nie wymyślaj numerów, symboli ani nazw części. Każdy numer w szkicu musi",
  "   stać w faktach albo w rozmowie — system to sprawdza i odrzuca szkic.",
  "3. Gdy fakty czegoś nie mówią, NIE zgaduj: wpisz to do `zastrzezenia`",
  "   (dla agenta, nie dla klienta) i zadaj klientowi pytania z faktu intake —",
  "   ale WYŁĄCZNIE te, na które ROZMOWA jeszcze nie odpowiada. Zanim o coś",
  "   poprosisz, sprawdź wiersze KLIENT:. Jeśli klient podał już model,",
  "   dane z tabliczki, wymiary albo zdjęcie, nie proś o nie ponownie —",
  "   potwierdź jednym zdaniem, co masz, i pytaj tylko o resztę.",
  "3a. Jeśli w rozmowie stoi marka, model albo numer maszyny, a żaden fakt go",
  "   nie wymienia, dopisz do `zastrzezenia` zdanie dla agenta: „w rozmowie",
  "   jest model X, w danych doboru go nie ma — wpisz go i ułóż szkic",
  "   ponownie”. Klientowi tego nie pisz.",
  "4. Pewność „prawdopodobne” oddaj słowem „prawdopodobnie” i zaproponuj",
  "   sprawdzenie (tabliczka, zdjęcie starej części). Fakt „NIE PASUJE” to",
  "   ostrzeżenie — powiedz je klientowi wprost.",
  "5. Nie obiecuj terminu dostawy ani przyszłej dostępności. Dostępność",
  "   podawaj tylko jako „dziś”, tak jak stoi w fakcie.",
  "6. Nie podawaj półek, rezerwacji, magazynów, nazwisk pracowników ani",
  "   danych osobowych. Znaczniki [e-mail], [telefon], [adres], [konto], [login]",
  "   to wycięte dane — nie zgaduj ich treści.",
  "7. Alternatywy proponuj wyłącznie spośród kandydatów z faktów.",
  "",
  "FORMA: po polsku, forma grzecznościowa przez „Państwo” (np. „mają Państwo”,",
  "„proszę Państwa o”), NIGDY dosłownie „Pan/Pani” ani imię; zwięźle, bez wstępów",
  `o firmie. Najwyżej ${LIMIT_ZNAKOW - 200} znaków. Jedno twierdzenie na zdanie.`,
  "Zwróć wyłącznie JSON według schematu: `tresc` (szkic), `uzyteFakty` (lista",
  "identyfikatorów faktów, które cytujesz), `zastrzezenia` (czego zabrakło).",
].join("\n");

/** Realny nadawca szkicu. Wstrzykuje go TRASA, jak nadawcę klasyfikacji. */
export const nadawcaSzkicuAnthropic: NadawcaSzkicu = async (watek, fakty): Promise<OdpowiedzSzkicu> => {
  const start = Date.now();
  try {
    const odp = await anthropic().messages.parse({
      model: config.copilot.model,
      /* Szkic ma do 1800 znaków polskiego tekstu plus JSON wokół — 1200 tokenów
         to sufit z zapasem, a nie zaproszenie do rozwlekłości (limit stoi też
         w instrukcji). */
      max_tokens: 1200,
      system: [{ type: "text", text: INSTRUKCJA_SZKICU, cache_control: { type: "ephemeral" } }],
      output_config: {
        /* Średni wysiłek: tu powstaje tekst dla klienta, nie etykieta. */
        effort: "medium",
        format: zodOutputFormat(Szkic),
      },
      messages: [{ role: "user", content: `FAKTY:\n${String(fakty)}\n\nROZMOWA:\n${String(watek)}` }],
    });
    const u = odp.usage;
    const w = odp.parsed_output;
    if (!w) {
      throw new BladOdpowiedziCopilota(
        `Model nie oddał szkicu (stop: ${odp.stop_reason ?? "?"})`, 200);
    }
    return {
      tresc: w.tresc, uzyteFakty: w.uzyteFakty, zastrzezenia: w.zastrzezenia,
      model: odp.model ?? config.copilot.model,
      zuzycie: {
        wej: u?.input_tokens ?? 0, wyj: u?.output_tokens ?? 0,
        cacheZapis: u?.cache_creation_input_tokens ?? 0, cacheOdczyt: u?.cache_read_input_tokens ?? 0,
      },
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
  /* PRZED `APIError`, bo `APIConnectionError` PO NIEJ DZIEDZICZY. Do 0.191.0
     gałąź o braku internetu stała na końcu funkcji i była nieosiągalna: zerwana
     sieć meldowała się jako „Anthropic odpowiedziało ?", czyli twierdziła, że
     dostawca odpowiedział — a on nie został nawet zapytany. Kolejność
     `instanceof` jest tu logiką, nie stylem. */
  if (e instanceof Anthropic.APIConnectionError) {
    return new BladLacznosciCopilota(
      "Nie ma połączenia z Anthropic — sprawdź internet i zaporę na serwerze. "
      + "Nic nie wyszło na zewnątrz.",
      `polaczenie: ${e.message}`);
  }

  if (e instanceof Anthropic.APIError) {
    /* Ślad do KSIĘGI, nie na ekran. `requestID` (tak, wielbłądem — SDK nazywa
       je inaczej niż nagłówek `request-id`) to jedyna rzecz, po której dostawca
       odszuka konkretne żądanie. Na ekranie byłby trzydziestoznakowym szumem. */
    const slad = `${e.type ?? "?"} ${e.status ?? "?"}`
      + (e.requestID ? ` ${e.requestID}` : "");

    /* PRZECIĄŻENIE TO STAN DOSTAWCY, NIE TEJ ROZMOWY — i dlatego zatrzyma
       partię. Rozpoznajemy je po `type`, bo ono mówi wprost; `status >= 500`
       zostaje jako sieć bezpieczeństwa na resztę awarii po tamtej stronie.
       Żadna z nich nie jest winą treści, którą wysłaliśmy, więc następna
       rozmowa dostałaby dokładnie tę samą odpowiedź. */
    if (e.type === "overloaded_error" || (e.status ?? 0) >= 500) {
      return new BladPrzeciazeniaCopilota(
        `Anthropic jest chwilowo przeciążone (${e.status ?? "?"}). `
        + "Nic nie zostało policzone ani opłacone — spróbuj za chwilę.",
        e.status ?? 0, slad);
    }
    /* Surowej odpowiedzi dostawcy na ekran NIE PUSZCZAMY. Do 0.191.0 szło tam
       `529 {"type":"error",…}` — agent czytał zrzut JSON-a zamiast zdania. */
    return new BladOdpowiedziCopilota(
      `Anthropic odrzuciło żądanie (${e.status ?? "?"}). To nie jest wina tej `
      + "rozmowy — zajrzyj do pomiaru Copilota za zębatką.",
      e.status ?? 0, slad);
  }
  /* Cokolwiek, co nie jest błędem SDK — nasza pomyłka po drodze. Nazywamy to
     wprost, zamiast zwalać na dostawcę, który tu nawet nie wystąpił. */
  const tekst = e instanceof Error ? e.message : String(e);
  return new BladOdpowiedziCopilota(
    "Copilot wywrócił się przed wysyłką — to usterka po naszej stronie.",
    0, `wewnetrzny: ${tekst.slice(0, 200)}`);
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
