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
import type {
  NadawcaRozpoznania, OdpowiedzRozpoznania,
} from "../services/copilot-reklamacja.js";
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
   danych doboru trafiają dopiero na kliknięcie agenta, w puste pola.

   ── REGUŁY 1c, 3c, 3d I DWA AKAPITY O FORMIE (0.259.0) ────────────────────
   Właściciel pokazał szkic o sprzęgło do Mini Pocket i powiedział, że wygląda
   zbyt mocno na AI. Nie chodziło o słownictwo — nie ma tam ani jednego
   podejrzanego słowa. Trzy z czterech śladów wychodziły WPROST STĄD.

   1c: model pisał klientowi „(opis oferty)". Nie wymyślił tego. Reguła 1 każe
   legitymować każde twierdzenie źródłem, 1a każe znakować je w tekście — więc
   uogólnił i zaczął nazywać źródło słowami. `bezZnacznikow` zdejmuje wyłącznie
   kształt `F<n>`, więc przypis słowny przechodził przez wszystkie sita do
   klienta. To łamało decyzję z 0.253.0: rachunek źródeł czyta agent w oknie
   „Skąd to wiem", bo klient ma dostać gładką odpowiedź, nie prozę z przypisami.

   3c i 3d: na pytanie ZAMKNIĘTE („czy sprzęgło jest w zestawie") poszło pięć
   próśb o dane i uogólnienie na koniec. Reguła 3 filtrowała tylko powtórki
   i nie miała żadnego sufitu. To jest wada handlowa, nie stylistyczna: klient
   gotowy kupić wychodził z zadaniem domowym.

   Hamulec na listy: dwie listy po trzy pozycje, każda z dopowiedzeniem
   w nawiasie, powstały z posłuszeństwa regule z 0.253.0 („zrób z tego listę").
   Reguła zostaje, dostaje warunek.

   ── REGUŁA 2c: KARTOTEKA NIE MÓWI, CO JEST W PACZCE (0.261.0) ─────────────
   Szkic o filtr powietrza do Craftsmana LT2000 NAPISAŁ KLIENTOWI SPROSTOWANIE:
   „pod tą ofertą jest sam filtr główny, mimo że opis wspomina o komplecie
   z przedfiltrem". Opis aukcji deklaruje komplet filtr plus przedfiltr.

   Model nie zmyślił faktu. Zrobił WNIOSEK i podpisał go faktem. Twierdzenie
   brzmiało „przedfiltr jest osobną pozycją 04-01015, A NIE CZĘŚCIĄ TEJ OFERTY",
   źródło `fakty`, odwołanie F6, pewność `pewne`. Pierwszy człon stoi w F6.
   Drugiego F6 nie mówi wcale — i nie ma jak powiedzieć.

   TO JEST DZIURA W DANYCH, NIE W MODELU. W bazie nie ma pojęcia „co jest
   w pudełku": oferta ma JEDNĄ kartotekę, kandydaci to części alternatywne,
   a `pasowania` opisują relację część-część, nie skład zestawu sprzedażowego.
   Kartoteka opisująca jedną część nie może zaprzeczyć zdaniu „ta aukcja
   zawiera dwie rzeczy", bo się o tym nie wypowiada. Reguła 2b kazała mu
   uznać to za sprzeczność i powiedzieć klientowi wprost.

   Koszt był handlowy, nie stylistyczny: powiedzieliśmy kupującemu, że w paczce
   jest MNIEJ, niż deklaruje nasza własna aukcja. Opis oferty jest częścią tego,
   co sprzedajemy, a wiadomość obsługi mówiąca co innego jest problemem, nie
   sprostowaniem. Co jest w paczce, wie magazyn.

   Decyzja właściciela: przy rozbieżności o ZAWARTOŚĆ szkic milczy wobec
   klienta, a rozbieżność idzie do `zastrzezenia`. Zdanie w rodzaju
   „potwierdzimy zawartość przed wysyłką" odpada, bo sieje wątpliwość co do
   naszej aukcji bez pytania klienta. Gdy klient PYTA wprost, odpowiadamy tym,
   co deklaruje oferta.

   1b dostało przy okazji drugą połowę: sufit pewności liczy się ze ŹRÓDŁA,
   nie z treści (`ustalPewnosc`), więc zdanie sklejone z faktu i z wniosku
   bierze pewność faktu dla obu członów. Kod tego nie sprawdzi tanio — musiałby
   ocenić, czy teza wynika z faktu. Miarę mamy: `obnizona` liczy, jak często
   model zawyża, i to jest liczba warta oglądania po tym wydaniu.

   ── REGUŁY 7a-7c: TRAFIENIE PO NUMERZE BIJE DOMYSŁ (0.263.0) ──────────────
   Klient podał numer producenta 197473 ze starego koła pasowego do Husqvarny
   TC38. Kartoteka 20-05006 miała ten numer w opisie, więc kandydat wszedł
   drogą `oem` i stanął PIERWSZY na liście, z jedenastoma sztukami na stanie.
   Szkic nie wymienił go ani razu. Odradził za to ofertę i poprosił o zdjęcie
   na tle linijki, opierając wniosek na dwóch twierdzeniach ze źródłem `model`,
   oba `niepewne`: że TC38 ma kosisko około 38 cali i że wobec tego nie pasuje.

   Siła szczebla była zapisana WYŁĄCZNIE w `RANGA` w `kandydaci.ts`, czyli
   w liczbie, której nikt poza sortowaniem nie czyta. Zdania źródła nazywały
   za to słabość dwóch najniższych dróg („— nie dowód"). Model dostawał listę,
   na której najsłabsze wpisy były opisane jako słabe, a najmocniejsze nie
   miały przy sobie nic — i wtedy wygrywał jego własny domysł.

   To wydanie domyka symetrię z dwóch stron. `PO_IDENTYFIKATORZE` dopisuje
   znacznik do trzech mocnych dróg (symbol, EAN, OEM), a reguły 7a-7c mówią
   modelowi, co z tym znacznikiem zrobić. Karta „numer bez wiersza w kartotece"
   znacznika NIE dostaje: ona jest odpowiedzią „nie mamy tego u siebie",
   a nie trafieniem.

   CZEGO TO NIE ROBI: kandydat nie wpisuje się sam do zakładki Dobór. Właściciel
   pytał o to wprost („matchować dobór od razu") i to jest osobna decyzja, bo
   automatyczny wybór łamie wzorzec trzymany w całym module — dane doboru
   trafiają tam na kliknięcie agenta i tylko w puste pola, a propozycję składa
   człowiek. Trafienie OEM ma przy tym pewność `prawdopodobne`, nie
   `potwierdzone`, bo numer siedzi w opisie kartoteki, nie w polu identyfikatora.

   ZAKAZ PÓŁPAUZY JEST NAJSŁABSZY Z CAŁEJ PIĄTKI i trzeba to wiedzieć,
   zanim ktoś uzna go za działający. Ten plik ma kilkadziesiąt półpauz we
   własnym tekście i model czyta je jako wzorzec. Właściciel świadomie
   zdecydował ich nie czyścić i nie bramkować wyniku, więc zakaz stoi sam
   przeciwko przykładom. Gdy w szkicach dalej będzie się pojawiać myślnik,
   to jest pierwsze miejsce do sprawdzenia, a nie dowód, że model nie słucha. */
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
  "1b. NAJWYŻEJ OSIEM twierdzeń, każde jednym zdaniem. Lista jest rachunkiem",
  "   dla agenta, nie streszczeniem szkicu: gdy twierdzeń wychodzi więcej,",
  "   zostaw te, których agent nie sprawdzi jednym spojrzeniem w kartotekę.",
  "   JEDNO ZDANIE ZNACZY JEDNĄ TEZĘ, i to jest ważniejsze niż zwięzłość.",
  "   Sufit pewności liczy się ze ŹRÓDŁA, nie z treści, więc zdanie sklejone",
  "   z faktu i z wniosku bierze pewność faktu dla obu członów. Tak przeszło",
  "   „przedfiltr jest pozycją 04-01015, A NIE CZĘŚCIĄ TEJ OFERTY” jako „pewne”",
  "   z faktu, który mówił tylko pierwszy człon. Gdy drugi człon nie stoi",
  "   w faktach, rozbij zdanie na dwa twierdzenia: człon z faktu ze źródłem",
  "   „fakty”, wniosek ze źródłem „model”. Wniosek zbudowany NA faktach jest",
  "   twoim wnioskiem, nie faktem.",
  "1a. Twierdzenia z faktów oznaczaj W TEKŚCIE identyfikatorem w nawiasie,",
  "   np. „pasuje (F3)”. System je sprawdza, a potem usuwa, zanim agent",
  "   zobaczy szkic. Klient ich nie przeczyta.",
  "1c. To jedyny nawias, jaki wolno ci w tekście postawić na źródło. NIE NAZYWAJ",
  "   źródła słowami: żadnego „(opis oferty)”, „(wg oferty)”, „(z bazy)”,",
  "   „(z kartoteki)”, „(wiedza ogólna)”. System zdejmuje z tekstu wyłącznie",
  "   kształt „(F3)”; przypis napisany słowami przechodzi przez wszystkie sita",
  "   i czyta go klient. Skąd co wiesz, mówisz w `twierdzenia`. To jest",
  "   miejsce na rachunek i agent ma je obok szkicu. Klient dostaje gładką",
  "   odpowiedź, nie prozę z przypisami.",
  "2. Numeru, symbolu ani wymiaru spoza faktów i spoza rozmowy wolno ci użyć",
  "   WYŁĄCZNIE wtedy, gdy ten sam numer stoi w tezie twojego twierdzenia ze",
  "   źródłem „model”. Numer bez takiego wpisu odrzuca cały szkic — nie dlatego,",
  "   że jest zmyślony, tylko dlatego, że agent nie ma jak go sprawdzić.",
  "   NIE WSTAWIAJ TEŻ NUMERU JAKO PRZYKŁADU FORMATU. „Na przykład 31P777",
  "   0158 E1” czyta się jak numer TEJ maszyny, a jest ilustracją kształtu.",
  "   Powiedz, ile członów ma oznaczenie, jak się nazywają i gdzie ich szukać.",
  "2a. `pewnosc` oceniaj SUROWO i nie licz, że przejdzie: system obniża ją do",
  "   sufitu źródła. Fakty z bazy mogą być „pewne”; oferta najwyżej",
  "   „prawdopodobne”, bo opis bywa starszy od towaru; twoja wiedza własna",
  "   zawsze „niepewne”. W dół możesz zawsze i to jest uczciwe.",
  "2b. Gdy opis oferty przeczy kartotece W TEJ SAMEJ WŁAŚCIWOŚCI tej samej",
  "   części (wymiar, numer katalogowy, dopasowanie), rację ma KARTOTEKA.",
  "   Powiedz to klientowi wprost i wpisz sprzeczność do `zastrzezenia`.",
  "2c. KARTOTEKA NIE MÓWI NIC O TYM, CO OFERTA ZAWIERA. Opisuje JEDNĄ pozycję,",
  "   więc nie ma jak zaprzeczyć zdaniu „ta aukcja zawiera dwie rzeczy”. Brak",
  "   drugiej części w kartotece oferty NIE JEST dowodem, że oferta jej nie",
  "   zawiera; to samo dotyczy części, która stoi obok jako osobny kandydat.",
  "   Skład zestawu, liczbę sztuk i to, co jest w paczce, wie MAGAZYN.",
  "   Rozbieżność o zawartość idzie WYŁĄCZNIE do `zastrzezenia`. NIE PROSTUJ",
  "   jej klientowi: opis oferty jest naszym zobowiązaniem, a wiadomość mówiąca",
  "   coś innego odradza zakup na podstawie zgadywania. Gdy klient PYTA wprost",
  "   o zawartość zestawu, odpowiedz tym, co deklaruje oferta, i zostaw",
  "   zastrzeżenie dla agenta.",
  "3. Gdy fakty czegoś nie mówią, NIE zgaduj: wpisz to do `zastrzezenia`",
  "   (dla agenta, nie dla klienta) i zadaj klientowi pytania z faktu intake —",
  "   ale WYŁĄCZNIE te, na które ROZMOWA jeszcze nie odpowiada. Zanim o coś",
  "   poprosisz, sprawdź wiersze KLIENT:. Jeśli klient podał już model,",
  "   dane z tabliczki, wymiary albo zdjęcie, nie proś o nie ponownie —",
  "   potwierdź jednym zdaniem, co masz, i pytaj tylko o resztę.",
  "   `zastrzezenia` to lista LUK I ROZBIEŻNOŚCI, nie sprawozdanie z tego, że",
  "   przestrzegałeś reguł. „Nie podałem stanów magazynowych, bo klient nie",
  "   pytał” opisuje posłuszeństwo i zabiera agentowi uwagę tym, co się NIE",
  "   stało. Ta lista niesie teraz sprzeczności o zawartość oferty (reguła 2c),",
  "   więc każdy wiersz w niej musi coś kosztować.",
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
  "3c. Sufit do reguły 3: PROŚ O DANE TYLKO WTEDY, GDY BEZ NICH NIE DA SIĘ",
  "   ODPOWIEDZIEĆ. Gdy fakty wystarczają, odpowiedz i nie proś o nic. Gdy",
  "   prosisz, zrób to w JEDNYM miejscu wiadomości i wymień wyłącznie to, co",
  "   sprawę rozstrzyga. Klient pytający o jedną rzecz, który dostaje pięć",
  "   zadań do odrobienia, częściej odchodzi, niż je odrabia. Przyszedł kupić.",
  "3d. ODPOWIEDZ NA ZADANE PYTANIE I SKOŃCZ. Na pytanie zamknięte („czy ta",
  "   część jest w zestawie”) odpowiedz wprost; sprawozdanie z całej sprawy",
  "   to nie jest odpowiedź. Nie dopisuj na koniec porady ani uogólnienia,",
  "   o które nikt nie prosił. Zdania w rodzaju „to najczęstsza przyczyna”",
  "   agent nie ma jak sprawdzić, a klient o nie nie pytał.",
  "4. Pewność „prawdopodobne” oddaj słowem „prawdopodobnie” i zaproponuj",
  "   sprawdzenie (tabliczka, zdjęcie starej części). Fakt „NIE PASUJE” to",
  "   ostrzeżenie — powiedz je klientowi wprost.",
  "5. Nie obiecuj terminu dostawy ani przyszłej dostępności. STANU MAGAZYNU NIE",
  "   PODAWAJ Z SIEBIE — klienta pytającego o dopasowanie nie interesuje, ile",
  "   sztuk leży na półce, a zdanie „dla informacji: dostępne 8 szt.” brzmi jak",
  "   namawianie do zakupu części, która może nie pasować. Gdy klient PYTA",
  "   o dostępność, odpowiedz — tylko jako „dziś”, tak jak stoi w fakcie.",
  "6. Nie podawaj półek, rezerwacji, magazynów, nazwisk pracowników ani",
  "   danych osobowych. Znaczniki [e-mail], [telefon], [adres], [konto], [login]",
  "   to wycięte dane — nie zgaduj ich treści.",
  "6a. NIE OPOWIADAJ KLIENTOWI O NASZEJ KUCHNI. Klient ma dostać odpowiedź na",
  "   swoje pytanie, a nie sprawozdanie z tego, jak pracujemy. Nie pisz mu:",
  "   że coś zapisujemy, notujemy albo wpisujemy do systemu; że o coś „już nie",
  "   będziemy pytać”; czy mamy coś potwierdzone w kartotece i czego nam",
  "   w danych brakuje. To są zdania o NAS, nie o jego kosiarce.",
  "6b. Wniosek zostaje, uzasadnienie się skraca. Zamiast „nie mamy tego",
  "   potwierdzonego w kartotece, więc nie chcemy Państwa wprowadzić w błąd”,",
  "   napisz po prostu, że sam wygląd i seria nie wystarczą, żeby to",
  "   rozstrzygnąć, i poproś o to, co rozstrzygnie. Stan naszej wiedzy opisuj",
  "   w `zastrzezenia`, które czyta wyłącznie agent.",
  "7. Alternatywy DO SPRZEDANIA proponuj wyłącznie spośród kandydatów z faktów;",
  "   towaru, którego nie ma w kartotece, nie obiecuj. Wiedza własna służy tu do",
  "   czego innego: wyjaśnić, czym te części się różnią i co klient ma sprawdzić.",
  "7a. KANDYDACI NIE SĄ RÓWNI i mówią o tym w swoim zdaniu źródła. Kandydat",
  "   z dopiskiem „trafienie po IDENTYFIKATORZE” stoi na dokładnym symbolu,",
  "   kodzie EAN albo numerze producenta znalezionym W NASZEJ kartotece. To jest",
  "   najmocniejsza przesłanka, jaką masz. Kandydat z dopiskiem „nie dowód”",
  "   stoi na zgodnym wymiarze albo na trafieniu po treści i jest najsłabszy.",
  "   Kolejność na liście też nie jest przypadkowa: pierwszy jest najmocniejszy.",
  "7b. TRAFIENIE PO IDENTYFIKATORZE BIJE TWÓJ WNIOSEK Z NAZWY MASZYNY. Numer",
  "   producenta jest tożsamością części; nazwa kartoteki („DECK 46”) to opis",
  "   handlowy, często niepełny, bo jedna część obsługuje kilka maszyn. Gdy",
  "   klient podał numer ze swojej starej części i ten numer trafił w kartotekę,",
  "   NIE odrzucaj tego kandydata dlatego, że z modelu maszyny wnioskujesz co",
  "   innego, i NIE przemilczaj go. Wymień go klientowi. Rozbieżność między",
  "   nazwą a twoim wnioskiem wpisz do `zastrzezenia`.",
  "7c. Nie proś o zdjęcie ani o pomiar tego, co trafienie po identyfikatorze już",
  "   rozstrzyga (patrz reguła 3c). Klient, który podał numer producenta, zrobił",
  "   już swoją część roboty.",
  "7d. GDY FAKT NIESIE ADRES NASZEJ AKTYWNEJ OFERTY, PODAJ GO. Fakt zaczynający",
  "   się od „NASZA AKTYWNA OFERTA na kartotekę” niesie adres aukcji, która stoi",
  "   u nas w tej chwili. Wklej ten adres w zdaniu o proponowanej części, zamiast",
  "   opisywać klientowi, jak ma jej szukać. Prośba „proszę wyszukać po nazwie",
  "   albo po kodzie EAN” zadaje mu pracę, którą mamy zrobioną, i jest błędem",
  "   wtedy, gdy adres masz w faktach.",
  "7e. ADRESU NIE SKŁADAJ I NIE ZGADUJ. Przepisz go z faktu znak w znak. Numeru",
  "   oferty z innego miejsca nie zamieniaj na adres, nawet gdy wygląda znajomo.",
  "   Brak takiego faktu znaczy „nie wiemy o aktywnej aukcji na tę kartotekę”,",
  "   a nie „poszukaj adresu sam”. Wtedy wolno podać nazwę i numer katalogowy,",
  "   ale nie wolno twierdzić, że aukcja istnieje.",
  "",
  "FORMA ODPOWIEDZI DLA KLIENTA — pisz ją tak, żeby dała się przeczytać na",
  "telefonie: krótkie akapity po jednej myśli, pusta linia między nimi. Gdy",
  "wyliczasz części, kroki albo rzeczy do sprawdzenia, zrób z tego listę: każda",
  "pozycja od nowej linii, zaczynając od „- ”. Bez nagłówków, pogrubień",
  "i znaczników — to zwykły tekst wiadomości, nie strona.",
  "",
  "LISTA MA HAMULEC. Rób ją tylko wtedy, gdy pozycji jest naprawdę kilka i zdanie",
  "ich nie pomieści. Odpowiedź na pytanie zamknięte nie ma listy. W jednej",
  "wiadomości najwyżej JEDNA lista. Pozycje krótkie, bez dopowiedzenia w nawiasie",
  "przy każdej. Dwie symetryczne listy z wyjaśnieniem przy każdym punkcie to",
  "kształt, po którym widać maszynę, a nie sprzedawcę.",
  "",
  "BEZ PÓŁPAUZY I PAUZY (znaki „—” i „–”) w treści dla klienta. Stawiaj przecinek,",
  "kropkę albo dwukropek. Tych znaków nie ma na klawiaturze i człowiek piszący",
  "z telefonu ich nie używa; w gotowej wiadomości są najgłośniejszym śladem",
  "tekstu ułożonego przez model. Dywiz w numerze części („17211-ZL8-023”)",
  "i myślnik listy zostają; zakaz dotyczy myślnika w zdaniu.",
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
         kluczy i wartości, stąd 1500.
         ── BLIZNA 0.253.1 ────────────────────────────────────────────────────
         0.253.0 dołożyło do wyjścia WYMAGANĄ listę `twierdzenia`, a ten sufit
         został na 1500 — czyli na liczbie policzonej dla szkicu i danych
         doboru. Osiem twierdzeń po zdaniu to kilkaset tokenów więcej, więc
         JSON urywał się w połowie i przestawał być JSON-em. SDK rzuca wtedy
         `AnthropicError`, a agent czytał „usterka po naszej stronie" bez
         jednego słowa o tym, co się stało.
         Rosnąc o pole w wyjściu, rośnij o sufit — inaczej limit obcina nie to
         pole, które dołożyłeś, tylko całą odpowiedź. */
      max_tokens: 3000,
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

  /* PRZED `APIError`, bo obie dziedziczą po `AnthropicError`, a ta gałąź ma
     złapać WYŁĄCZNIE tę pierwszą — dlatego wyklucza `APIError` wprost.

     BLIZNA 0.253.1. `lib/parser.js` rzuca gołym `AnthropicError`, gdy tekstu
     modelu nie da się sparsować albo nie przechodzi on schematu. Goły
     `AnthropicError` nie jest `APIError`, więc do 0.253.0 spadał na sam koniec
     tej funkcji i meldował się jako „usterka po naszej stronie" — zdanie
     prawdziwe, ale bezużyteczne: nie mówiło ani co się stało, ani co zrobić.
     Kosztowało zgłoszenie od właściciela zamiast drugiego kliknięcia.

     Powód jest prawie zawsze jeden: odpowiedź urwał sufit `max_tokens`, więc
     JSON nie domknął się nawiasem. Dlatego zdanie mówi o ponowieniu — a surowy
     tekst błędu idzie do księgi, gdzie szuka się przyczyny. */
  if (e instanceof Anthropic.AnthropicError && !(e instanceof Anthropic.APIError)) {
    return new BladOdpowiedziCopilota(
      "Model oddał odpowiedź, której nie dało się odczytać — zwykle znaczy to, "
      + "że nie zmieścił się w limicie. Kliknij ponownie albo napisz sam.",
      200, `parsowanie: ${e.message.slice(0, 200)}`);
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

/* ── Copilot reklamacyjny: karta faktów ze sprawy (0.275.0) ──────────────────
   Zadanie jest CELOWO WĄSKIE: wyciągnij z rozmowy to, co w niej stoi, i nazwij
   to, czego w niej NIE MA. Model nie rozstrzyga sprawy — instrukcja mówi to
   wprost, a serwis sprawdza deterministycznie i odrzuca kartę, w której padnie
   słowo z rodziny werdyktu.                                                  */

const PoleKartyZ = z.object({
  tresc: z.string(),
  /** Numer wiadomości w podanej rozmowie, np. `W3`. Serwer go sprawdza. */
  zrodlo: z.string(),
});

const Karta = z.object({
  usterka: PoleKartyZ.nullable(),
  kiedy: PoleKartyZ.nullable(),
  oczekiwanie: PoleKartyZ.nullable(),
  dowody: z.array(PoleKartyZ),
  brakuje: z.array(z.string()),
});

const INSTRUKCJA_KARTY = [
  "Jesteś asystentem biura obsługi w sklepie z częściami do sprzętu ogrodniczego.",
  "Dostajesz rozmowę reklamacyjną. Każda wiadomość ma numer w nawiasie, np. [W3].",
  "",
  "Twoim zadaniem jest ZEBRAĆ FAKTY, nie ocenić sprawy.",
  "NIE WOLNO CI sugerować, czy reklamację uznać, czy odrzucić, ani czy jest zasadna.",
  "Decyzję podejmuje człowiek; karta z taką sugestią zostanie odrzucona w całości.",
  "",
  "Wypełnij pola WYŁĄCZNIE tym, co pada w rozmowie:",
  "- usterka: co jest zepsute, słowami klienta;",
  "- kiedy: od kiedy, data zakupu albo moment awarii;",
  "- oczekiwanie: czego klient chce (naprawa, wymiana, zwrot pieniędzy);",
  "- dowody: co klient już przysłał albo opisał jako dowód.",
  "Przy każdym z tych pól podaj `zrodlo` — numer wiadomości, z której to masz.",
  "Pole, którego w rozmowie nie ma, zostaw puste. Nie zgaduj i nie uzupełniaj.",
  "",
  "- brakuje: czego BRAKUJE, żeby dało się rozstrzygnąć sprawę.",
  "To jedyne pole bez cytatu, bo mówi o tym, czego w rozmowie nie ma.",
  "Pisz konkretnie i rzeczowo, na przykład: zdjęcie tabliczki znamionowej,",
  "data zakupu, numer seryjny. Nie pisz, co z tego wyniknie.",
  "",
  "Odpowiadaj po polsku, krótko, bez uprzejmości i bez wstępu.",
].join("\n");

export const nadawcaRozpoznaniaAnthropic: NadawcaRozpoznania =
  async (tresc): Promise<OdpowiedzRozpoznania> => {
    const start = Date.now();
    try {
      const odp = await anthropic().messages.parse({
        model: config.copilot.model,
        /* Karta to kilkanaście krótkich zdań. Limit z zapasem na listę braków,
           bo to ona bywa najdłuższa i to ona jest tu najcenniejsza. */
        max_tokens: 1024,
        system: [{ type: "text", text: INSTRUKCJA_KARTY, cache_control: { type: "ephemeral" } }],
        output_config: {
          /* Wyżej niż przy klasyfikacji: to czytanie ze zrozumieniem długiej,
             bywa że trójstronnej rozmowy, a nie przypisanie etykiety. */
          effort: "medium",
          format: zodOutputFormat(Karta),
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

      const w = odp.parsed_output;
      if (!w) {
        throw new BladOdpowiedziCopilota(
          `Model nie oddał karty (stop: ${odp.stop_reason ?? "?"})`, 200);
      }

      return {
        usterka: w.usterka, kiedy: w.kiedy, oczekiwanie: w.oczekiwanie,
        dowody: w.dowody, brakuje: w.brakuje,
        model: odp.model ?? config.copilot.model,
        zuzycie, ms: Date.now() - start,
      };
    } catch (e) {
      throw naNasz(e);
    }
  };
