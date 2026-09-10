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
import { ZRODLA_TWIERDZENIA, POZIOMY_PEWNOSCI } from "../services/copilot-szkic.js";
import { ROLE_PASOWANIA } from "../services/pasowania.js";
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

/* Dane doboru rozpoznane w rozmowie (przyrost trzeci). Pola jak w `DaneDoboru`,
   każde `nullable`, bo wyjście strukturalne wymaga WSZYSTKICH kluczy;
   parametry jako tablica par, bo słownik o dynamicznych kluczach nie ma
   schematu. Serwis sprawdza każdą wartość przeciw rozmowie i wyrzuca te,
   których w niej nie ma — model może się pomylić, ale nie może dopisać. */
const DaneZRozmowy = z.object({
  marka: z.string().nullable(),
  model: z.string().nullable(),
  wariant: z.string().nullable(),
  rocznik: z.string().nullable(),
  nrSeryjny: z.string().nullable(),
  silnik: z.string().nullable(),
  oem: z.string().nullable(),
  nazwaCzesci: z.string().nullable(),
  parametry: z.array(z.object({ nazwa: z.string(), wartosc: z.string() })),
});

/* Pasowanie rozpoznane w rozmowie (przyrost czwarty): SYMBOLE z faktów, nie
   identyfikatory. Rola z listy serwisu — jedna lista, bez trzeciej kopii.
   Obiekt `nullable`, bo wyjście strukturalne wymaga wszystkich kluczy, a brak
   pary jest normą, nie wyjątkiem. Serwis sprawdza oba końce przeciw
   kartotekom, które sam położył na stole. */
const PasowanieZRozmowy = z.object({
  czesc: z.string(),
  doCzego: z.string(),
  rola: z.enum(ROLE_PASOWANIA),
  pozycja: z.string().nullable(),
}).nullable();

/* Skąd model wie to, co napisał (0.253.0). Enumy biorą się z serwisu — jedna
   lista, bez trzeciej kopii. `odwolanie` jest `nullable`, bo przy źródle
   `model` nie ma czego wskazać, a wyjście strukturalne wymaga wszystkich
   kluczy. Pewność deklaruje model, ale sufit narzuca `ustalPewnosc`. */
const Twierdzenie = z.object({
  teza: z.string(),
  zrodlo: z.enum(ZRODLA_TWIERDZENIA),
  odwolanie: z.string().nullable(),
  pewnosc: z.enum(POZIOMY_PEWNOSCI),
});

const Szkic = z.object({
  tresc: z.string(),
  uzyteFakty: z.array(z.string()),
  zastrzezenia: z.array(z.string()),
  daneDoboru: DaneZRozmowy,
  pasowanie: PasowanieZRozmowy,
  twierdzenia: z.array(Twierdzenie),
});

/* Instrukcja stoi PIERWSZA i jest STAŁA — na tym stoi cache (patrz wyżej).
   Tu prefiks jest już dość długi, żeby cache się włączył; sprawdzisz to
   w księdze po `cache_read_input_tokens`.

   Reguła 3 (0.232.2) ma jeden powód: klientka podała komplet danych
   z tabliczki (model FPLMP139) i poprosiła o linkę napędu, a szkic poprosił
   o tabliczkę raz jeszcze, bo fakt intake kazał „zapytać o…", a agent nie
   wpisał modelu do doboru.

   Reguła 3a zastąpiła zastrzeżenie „w rozmowie jest model X, wpisz go"
   z 0.232.2. Właściciel, patrząc na szkic o śrubę noża (Faworyt GTV51N196L-4W1,
   silnik „Lonci v200"), zapytał: „dlaczego dane wejściowe nie zostały
   wprowadzone automatycznie ze szkicu?". Model czytał te dane i odsyłał
   agenta do przepisywania. Teraz oddaje je w `daneDoboru` — DOSŁOWNIE, jak
   napisał klient — a serwis sprawdza każdą wartość przeciw rozmowie; do
   danych doboru trafiają dopiero na kliknięcie agenta, w puste pola. */
const INSTRUKCJA_SZKICU = [
  "Układasz SZKIC odpowiedzi dla agenta obsługi klienta w sklepie z częściami",
  "do sprzętu ogrodniczego (kosiarki, pilarki, kosy, gaźniki, uszczelki).",
  "Szkic czyta i poprawia człowiek; do klienta wysyła go człowiek. Ty nie wysyłasz.",
  "",
  "DOSTAJESZ dwie części: FAKTY (ponumerowane F1, F2, …) ułożone przez system",
  "z bazy sklepu oraz ROZMOWĘ (wiersze KLIENT: i MY:, od najstarszej).",
  "",
  "ZASADY, KTÓRYCH NIE WOLNO ZŁAMAĆ:",
  "1. WOLNO ci korzystać z własnej wiedzy o sprzęcie ogrodniczym — ale nigdy",
  "   po cichu. Każde twierdzenie techniczne (co pasuje, co nie pasuje, jaki",
  "   numer, jaki wymiar, jak działa część) wpisujesz do `twierdzenia` z podpisem,",
  "   skąd je masz: `zrodlo` = „fakty” (z bazy sklepu), „oferta” (z opisu, parametrów",
  "   albo listy zgodności oferty) albo „model” (z twojej wiedzy, bez pokrycia",
  "   w naszych danych). W `odwolanie` wpisz identyfikator faktu („F3”), nazwę",
  "   parametru oferty albo null, gdy mówisz z siebie.",
  "1a. Twierdzenia z faktów oznaczaj W TEKŚCIE identyfikatorem w nawiasie,",
  "   np. „pasuje (F3)”. System je sprawdza, a potem usuwa, zanim agent",
  "   zobaczy szkic. Klient ich nie przeczyta.",
  "2. Numeru, symbolu ani wymiaru spoza faktów i spoza rozmowy wolno ci użyć",
  "   WYŁĄCZNIE wtedy, gdy ten sam numer stoi w tezie twojego twierdzenia ze",
  "   źródłem „model”. Numer bez takiego wpisu odrzuca cały szkic — nie dlatego,",
  "   że jest zmyślony, tylko dlatego, że agent nie ma jak go sprawdzić.",
  "2a. `pewnosc` oceniaj SUROWO i nie licz, że przejdzie: system obniża ją do",
  "   sufitu źródła. Fakty z bazy mogą być „pewne”; oferta najwyżej",
  "   „prawdopodobne”, bo opis bywa starszy od towaru; twoja wiedza własna",
  "   zawsze „niepewne”. W dół możesz zawsze i to jest uczciwe.",
  "2b. Gdy opis oferty przeczy kartotece, rację ma KARTOTEKA. Powiedz to",
  "   klientowi wprost i wpisz sprzeczność do `zastrzezenia`.",
  "3. Gdy fakty czegoś nie mówią, NIE zgaduj: wpisz to do `zastrzezenia`",
  "   (dla agenta, nie dla klienta) i zadaj klientowi pytania z faktu intake —",
  "   ale WYŁĄCZNIE te, na które ROZMOWA jeszcze nie odpowiada. Zanim o coś",
  "   poprosisz, sprawdź wiersze KLIENT:. Jeśli klient podał już model,",
  "   dane z tabliczki, wymiary albo zdjęcie, nie proś o nie ponownie —",
  "   potwierdź jednym zdaniem, co masz, i pytaj tylko o resztę.",
  "3a. Dane maszyny i części, które stoją w ROZMOWIE (marka, model, wariant,",
  "   rocznik, numer seryjny, silnik, numer OEM lub symbol, nazwa części,",
  "   wymiary i parametry), wpisz do `daneDoboru` DOKŁADNIE tak, jak napisał",
  "   je klient — bez poprawiania pisowni i bez uzupełniania z pamięci. System",
  "   sprawdza, czy każda wartość stoi w rozmowie, i wyrzuca te, których nie",
  "   ma. Pola, których rozmowa nie podaje, zostaw puste (null, pusta lista).",
  "   Nie pytaj klienta o to, co wpisałeś do `daneDoboru`, i nie pisz mu, że",
  "   agent ma coś wpisać — to robi system.",
  "3b. Gdy z ROZMOWY wynika, że jedna część z FAKTÓW PASUJE do drugiej części",
  "   z FAKTÓW (uszczelka, membrana, zestaw naprawczy, łącznik albo element",
  "   zestawu do gaźnika lub kolektora) i fakty nie mówią jeszcze o tym",
  "   pasowaniu, wpisz je do `pasowanie`: `czesc` = symbol części, która",
  "   pasuje, `doCzego` = symbol tego, do czego pasuje — OBA DOSŁOWNIE z faktów",
  "   (kartoteka oferty, kandydaci, pasowania). `rola` z listy, `pozycja` tylko",
  "   słowami klienta (np. „od strony filtra”) albo null. Tylko „pasuje” —",
  "   „nie pasuje” zostaw w `zastrzezenia`. Symbol spoza faktów system wyrzuca.",
  "   Gdy nic takiego nie wynika, `pasowanie` = null. Nie wnioskuj pasowania",
  "   z pamięci i nie pisz klientowi, że coś zapisujemy — propozycję składa agent.",
  "4. Pewność „prawdopodobne” oddaj słowem „prawdopodobnie” i zaproponuj",
  "   sprawdzenie (tabliczka, zdjęcie starej części). Fakt „NIE PASUJE” to",
  "   ostrzeżenie — powiedz je klientowi wprost.",
  "5. Nie obiecuj terminu dostawy ani przyszłej dostępności. Dostępność",
  "   podawaj tylko jako „dziś”, tak jak stoi w fakcie.",
  "6. Nie podawaj półek, rezerwacji, magazynów, nazwisk pracowników ani",
  "   danych osobowych. Znaczniki [e-mail], [telefon], [adres], [konto], [login]",
  "   to wycięte dane — nie zgaduj ich treści.",
  "7. Alternatywy DO SPRZEDANIA proponuj wyłącznie spośród kandydatów z faktów;",
  "   towaru, którego nie ma w kartotece, nie obiecuj. Wiedza własna służy tu do",
  "   czego innego: wyjaśnić, czym te części się różnią i co klient ma sprawdzić.",
  "",
  "FORMA ODPOWIEDZI DLA KLIENTA — pisz ją tak, żeby dała się przeczytać na",
  "telefonie: krótkie akapity po jednej myśli, pusta linia między nimi. Gdy",
  "wyliczasz części, kroki albo rzeczy do sprawdzenia, zrób z tego listę: każda",
  "pozycja od nowej linii, zaczynając od „- ”. Bez nagłówków, pogrubień",
  "i znaczników — to zwykły tekst wiadomości, nie strona.",
  "",
  "FORMA: po polsku, forma grzecznościowa przez „Państwo” (np. „mają Państwo”,",
  "„proszę Państwa o”), NIGDY dosłownie „Pan/Pani” ani imię; zwięźle, bez wstępów",
  `o firmie. Najwyżej ${LIMIT_ZNAKOW - 200} znaków. Jedno twierdzenie na zdanie.`,
  "Zwróć wyłącznie JSON według schematu: `tresc` (szkic), `uzyteFakty` (lista",
  "identyfikatorów faktów, które cytujesz), `zastrzezenia` (czego zabrakło),",
  "`daneDoboru` (dane maszyny i części z rozmowy, reguła 3a), `pasowanie` (para",
  "kartotek z faktów wg reguły 3b albo null) oraz `twierdzenia` (skąd wiesz to,",
  "co napisałeś, wg reguł 1 i 2a — agent czyta tę listę obok szkicu).",
].join("\n");

/** Realny nadawca szkicu. Wstrzykuje go TRASA, jak nadawcę klasyfikacji. */
export const nadawcaSzkicuAnthropic: NadawcaSzkicu = async (watek, fakty): Promise<OdpowiedzSzkicu> => {
  const start = Date.now();
  try {
    const odp = await anthropic().messages.parse({
      model: config.copilot.model,
      /* Szkic ma do 1800 znaków polskiego tekstu plus JSON wokół — 1200 tokenów
         było sufitem z zapasem; `daneDoboru` dokłada kilkadziesiąt tokenów
         kluczy i wartości, stąd 1500. To nadal nie jest zaproszenie do
         rozwlekłości (limit stoi też w instrukcji). */
      max_tokens: 1500,
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
    /* Tablica par → słownik, taki jak w `DaneDoboru`. Pusta nazwa albo pusta
       wartość wypada tu, nie w serwisie — to jest kształt, nie treść. */
    const parametry: Record<string, string> = {};
    for (const p of w.daneDoboru.parametry) {
      if (p.nazwa.trim() && p.wartosc.trim()) parametry[p.nazwa.trim()] = p.wartosc.trim();
    }
    return {
      tresc: w.tresc, uzyteFakty: w.uzyteFakty, zastrzezenia: w.zastrzezenia,
      daneDoboru: { ...w.daneDoboru, parametry },
      pasowanie: w.pasowanie,
      twierdzenia: w.twierdzenia,
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
