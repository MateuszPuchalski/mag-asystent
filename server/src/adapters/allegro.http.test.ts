import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rodzinaKoncowki,
  scopeDlaUrl,
  urlWnioskuORabat,
  urlDyskusji,
  urlListyZwrotow,
  urlRoszczenProwizji,
  urlOpinii,
  urlOstatnichZamowien,
  urlWatkow,
  urlWiadomosci,
  urlWiadomosciDyskusji,
  pobierzZalacznik,
  urlZwrotu,
} from "./allegro.http.js";
import { allegroUserAgent, retryAfterMs } from "./allegro.js";
import { config } from "../config.js";
import {
  czyOdswiezyc,
  czyStronaBlokady,
  interwalParowania,
  powodBrakuKonta,
  problemUserAgenta,
} from "../services/allegro-token.js";

/* ── Allegro HTTP — połączenie, bez mapowania (0.140.0) ──────────────────────
   Do 0.137.2 ten plik testował KSZTAŁT odpowiedzi na fixturach pisanych ręką.
   To był dokładnie ten kształt, który nigdy nie został sprawdzony na żywym
   koncie — testy zieleniły się na naszym własnym wyobrażeniu. Zniknęły razem
   z mapowaniem; nowe powstaną z raportu sondy, na kształcie zmierzonym.

   Zostaje to, co da się sprawdzić bez zgadywania o treści: budowa URL-i,
   rozdział rodzin końcówek (nauka nagłówka `Accept`), scope w komunikacie 403
   i rytm parowania.                                                          */

test("URL wątków trzyma limit Allegro i nie przyjmuje ujemnego offsetu", () => {
  assert.equal(
    urlWatkow("https://api.allegro.pl", 0),
    "https://api.allegro.pl/messaging/threads?limit=20&offset=0"
  );
  assert.match(urlWatkow("https://api.allegro.pl", -5), /offset=0$/);
  assert.equal(
    urlWiadomosci("https://api.allegro.pl", "a/b"),
    "https://api.allegro.pl/messaging/threads/a%2Fb/messages"
  );
});

test("identyfikator w ścieżce jest kodowany — ukośnik nie dokłada segmentu", () => {
  /* Sonda podstawia identyfikatory prosto z listy. Niekodowany ukośnik
     zrobiłby z jednej sprawy dwa segmenty ścieżki, czyli 404 wyglądające
     jak „Allegro nie zna tej dyskusji". */
  assert.equal(
    urlWiadomosciDyskusji("https://api.allegro.pl", "a/b"),
    "https://api.allegro.pl/sale/issues/a%2Fb/chat?limit=100"
  );
});

test("listy stronicują setkami i nie przyjmują ujemnego offsetu", () => {
  assert.match(urlDyskusji("https://api.allegro.pl", -3), /limit=100&offset=0$/);
  assert.match(urlOpinii("https://api.allegro.pl", 0), /user-ratings\?limit=100&offset=0$/);
  assert.match(urlListyZwrotow("https://api.allegro.pl", null, 0), /customer-returns\?limit=100/);
});

test("filtr daty w liście zwrotów jest kodowany albo znika, gdy go nie ma", () => {
  const z = urlListyZwrotow("https://api.allegro.pl", "2026-08-01T00:00:00Z", 0);
  assert.match(z, /createdAt\.gte=2026-08-01T00%3A00%3A00Z$/);
  assert.equal(urlListyZwrotow("https://api.allegro.pl", null, 0).includes("createdAt"), false);
  assert.match(
    urlOstatnichZamowien("https://api.allegro.pl", "2026-08-01T00:00:00Z", -1),
    /updatedAt\.gte=2026-08-01T00%3A00%3A00Z&limit=100&offset=0&sort=-updatedAt$/
  );
});

test("kursor `from` w liście zwrotów jest kodowany i znika, gdy go nie ma", () => {
  /* `from` to identyfikator ostatnio widzianego zwrotu, nie liczba. Kodowanie
     jest tu istotne, bo identyfikatory Allegro bywają UUID-ami z myślnikami,
     a kiedyś potrafiły nieść znak spoza zestawu bezpiecznego dla URL-a. */
  const z = urlListyZwrotow("https://api.allegro.pl", null, 0, "abc/123");
  assert.match(z, /&from=abc%2F123$/);
  assert.equal(urlListyZwrotow("https://api.allegro.pl", null, 0).includes("from="), false);
});

test("szczegół zwrotu i roszczenia prowizji stoją we własnych rodzinach", () => {
  /* Rodzina decyduje o zapamiętanym nagłówku `Accept`. Zwroty i roszczenia
     są w becie, więc muszą negocjować wersję OSOBNO od zamówień — inaczej
     jedno 406 przestawiłoby wersję całej rodzinie `/order/`. */
  assert.equal(
    urlZwrotu("https://api.allegro.pl", "zw 1"),
    "https://api.allegro.pl/order/customer-returns/zw%201"
  );
  assert.equal(rodzinaKoncowki(urlZwrotu("https://api.allegro.pl", "x")), "customer-returns");
  assert.match(urlRoszczenProwizji("https://api.allegro.pl", -2), /refund-claims\?limit=100&offset=0$/);
  assert.equal(
    rodzinaKoncowki(urlRoszczenProwizji("https://api.allegro.pl", 0)),
    "refund-claims"
  );
});

test("rodzina końcówki rozdziela wersje zasobów — beta jednej nie przestawia drugiej", () => {
  /* 406 na zasobie w becie nie ma prawa przestawić nagłówka `Accept`
     zamówieniom, które chodzą po public.v1. */
  assert.equal(
    rodzinaKoncowki(urlListyZwrotow("https://api.allegro.pl", null, 0)),
    "customer-returns"
  );
  assert.equal(rodzinaKoncowki(urlDyskusji("https://api.allegro.pl", 0)), "issues");
  assert.equal(rodzinaKoncowki(urlWatkow("https://api.allegro.pl", 0)), "threads");
  assert.equal(rodzinaKoncowki(urlOpinii("https://api.allegro.pl", 0)), "user-ratings");
  assert.equal(
    rodzinaKoncowki(urlOstatnichZamowien("https://api.allegro.pl", "2026-08-01T00:00:00Z", 0)),
    "checkout-forms"
  );
  assert.equal(rodzinaKoncowki("https://api.allegro.pl/me"), "inne");
});

test("komunikat 403 wskazuje uprawnienie właściwe dla końcówki", () => {
  /* Rozjazd scope'ów jest pierwszą awarią wdrożenia — zdanie ma prowadzić
     do naprawy, a nie mówić o zamówieniach przy czytaniu wiadomości. */
  assert.equal(
    scopeDlaUrl("https://api.allegro.pl/messaging/threads/1/messages"),
    "allegro:api:messaging"
  );
  assert.equal(
    scopeDlaUrl("https://api.allegro.pl/sale/offers?name=x"),
    "allegro:api:sale:offers:read"
  );
  assert.equal(scopeDlaUrl("https://api.allegro.pl/sale/issues"), "allegro:api:disputes");
  assert.equal(scopeDlaUrl("https://api.allegro.pl/sale/issues/1/chat"), "allegro:api:disputes");
  /* Opinie mają WŁASNE uprawnienie. Do 0.155.0 ten adres wpadał w domyślne
     `orders:read`, więc odmowa kazała dodać uprawnienie, którym sonda w tym
     samym przebiegu pobrała sto zamówień. */
  assert.equal(
    scopeDlaUrl("https://api.allegro.pl/sale/user-ratings"),
    "allegro:api:ratings"
  );
  assert.equal(
    scopeDlaUrl("https://api.allegro.pl/order/customer-returns"),
    "allegro:api:orders:read"
  );
});

test("każda rodzina końcówek sondy ma nazwane uprawnienie, nie domyślne", () => {
  /* Luka przy `user-ratings` wzięła się stąd, że nikt nie sprawdził KOMPLETU
     adresów, których sonda używa. Domyślne `orders:read` jest poprawne tylko
     dla rodziny `/order/` — wszędzie indziej znaczy „zapomniano o gałęzi". */
  const poza = [
    "https://api.allegro.pl/sale/issues?limit=100",
    "https://api.allegro.pl/sale/issues/abc/chat",
    "https://api.allegro.pl/sale/user-ratings?limit=100",
    "https://api.allegro.pl/messaging/threads?limit=20",
    "https://api.allegro.pl/messaging/threads/abc/messages",
  ];
  for (const url of poza) {
    assert.notEqual(scopeDlaUrl(url), "allegro:api:orders:read",
      `${url} dostaje uprawnienie od zamówień, czyli brakuje mu gałęzi`);
  }
});

test("adres rozmowy w sprawie istnieje w specyfikacji Allegro", () => {
  /* Do 0.155.0 kod pukał do `/sale/disputes/{id}/messages`, a w całym
     `docs/allegro/swagger.yaml` nie ma ani jednej ścieżki `/sale/disputes`.
     Sonda oddawała zero rekordów przy sprawach, które miały `messagesCount`
     większy od zera. */
  const url = urlWiadomosciDyskusji("https://api.allegro.pl", "abc-1");
  assert.equal(url, "https://api.allegro.pl/sale/issues/abc-1/chat?limit=100");
  assert.equal(url.includes("/sale/disputes"), false);
  /* `limit` JAWNIE (0.164.0): przy tej jednej końcówce specyfikacja daje
     domyślne 10, nie 100 jak przy listach obok. Bez tego próbka sondy była
     cicho przycięta do dziesięciu wiadomości na sprawę. */
  assert.match(url, /limit=100$/);
});

test("User-Agent: wygenerowany z env wygrywa, fallback nazywa nas po imieniu", () => {
  /* Allegro grozi blokadą klucza za brak prawidłowego nagłówka — domyślne
     „node" z fetcha nie ma prawa wyjść na zewnątrz. */
  const bylo = config.allegro.userAgent;
  try {
    (config.allegro as { userAgent: string }).userAgent = "";
    assert.match(allegroUserAgent(), /^WERTIS\/\d+\.\d+\.\d+/);
    (config.allegro as { userAgent: string }).userAgent = "Wygenerowany/1.0 (abc123)";
    assert.equal(allegroUserAgent(), "Wygenerowany/1.0 (abc123)");
  } finally {
    (config.allegro as { userAgent: string }).userAgent = bylo;
  }
});

test("Retry-After czytany z liczby i z daty, śmieci dają NULL", () => {
  /* Takt tickerów wydłuża po 429 następny przebieg o tę wartość. Zgadywanie
     przy nieczytelnym nagłówku byłoby gorsze niż zwykły interwał. */
  const teraz = Date.parse("2026-08-18T12:00:00Z");
  assert.equal(retryAfterMs("90", teraz), 90_000);
  assert.equal(retryAfterMs("Tue, 18 Aug 2026 12:01:00 GMT", teraz), 60_000);
  assert.equal(retryAfterMs("nie-data", teraz), null);
  assert.equal(retryAfterMs(null, teraz), null);
});

test("odświeżenie tokena: 5 minut zapasu i odporność na śmieci w dacie", () => {
  const teraz = Date.parse("2026-08-18T12:00:00Z");
  assert.equal(czyOdswiezyc("2026-08-18T13:00:00Z", teraz), false);
  assert.equal(czyOdswiezyc("2026-08-18T12:04:00Z", teraz), true); // mniej niż zapas
  assert.equal(czyOdswiezyc("nie-data", teraz), true); // uszkodzony wiersz → odśwież
});

/* ── Rytm parowania i anti-bot Allegro (0.106.0) ────────────────────────────
   Endpointy OAuth stoją na apeksie `allegro.pl`, za tym samym edge'em co
   sklep. Odpytywanie stanu parowania jest więc jedynym ruchem aplikacji,
   który widzi anti-bot — i to on wygenerował blokadę adresu IP.            */

test("parowanie: odstęp ma podłogę 5 s i rośnie z czasem czekania", () => {
  // Allegro może podać `interval: 1` — my i tak nie schodzimy poniżej 5 s
  assert.equal(interwalParowania(0, 1000), 5000);
  assert.equal(interwalParowania(0, 5000), 5000);
  // baza większa od podłogi zostaje bazą
  assert.equal(interwalParowania(0, 8000), 8000);
  /* Człowiek potwierdza kod w kilkanaście sekund. Cisza po minucie i po
     trzech znaczy, że odszedł od komputera — pytanie co pięć sekund przez
     kolejne pół godziny niczego nie przyspiesza, a buduje ślad maszyny. */
  assert.equal(interwalParowania(61_000, 5000), 10_000);
  assert.equal(interwalParowania(181_000, 5000), 20_000);
  // `slow_down` z Allegro (baza + 5 s) kumuluje się z naszym zwalnianiem
  assert.equal(interwalParowania(181_000, 25_000), 25_000);
});

test("strona blokady rozpoznana, zanim JSON.parse wywali się na HTML-u", () => {
  const html = "<!doctype html><html><body>Zostałeś zablokowany.</body></html>";
  assert.equal(czyStronaBlokady("text/html; charset=utf-8", html), true);
  assert.equal(czyStronaBlokady(null, html), true, "bez nagłówka rozstrzyga kształt treści");
  assert.equal(czyStronaBlokady("application/json", '{"error":"authorization_pending"}'), false);
  assert.equal(czyStronaBlokady(null, '{"access_token":"x"}'), false);
  // puste ciało to nie blokada — tak odpowiada część endpointów auth
  assert.equal(czyStronaBlokady(null, "   "), false);
});

test("brak ALLEGRO_USER_AGENT to zdanie w /api/health, nie cisza", () => {
  /* Allegro ostrzega przy rejestracji aplikacji, że brak własnego nagłówka
     grozi zablokowaniem klucza. Do 0.106.0 aplikacja nie mówiła o tym nic —
     objawem był dopiero blok, czyli moment, w którym jest już za późno. */
  const bylUA = config.allegro.userAgent;
  const bylTryb = config.allegro.mode;
  try {
    (config.allegro as { mode: string }).mode = "http";
    (config.allegro as { userAgent: string }).userAgent = "";
    assert.match(problemUserAgenta() ?? "", /ALLEGRO_USER_AGENT/);
    (config.allegro as { userAgent: string }).userAgent = "Wygenerowany/1.0 (abc123)";
    assert.equal(problemUserAgenta(), null);
    // w trybie dev nikt do Allegro nie dzwoni — zdanie byłoby szumem
    (config.allegro as { mode: string }).mode = "dev";
    (config.allegro as { userAgent: string }).userAgent = "";
    assert.equal(problemUserAgenta(), null);
  } finally {
    (config.allegro as { userAgent: string }).userAgent = bylUA;
    (config.allegro as { mode: string }).mode = bylTryb;
  }
});

/* ── Powód odmowy dla narzędzia z konsoli (0.153.1) ─────────────────────────
   Sonda odmawiała jednym zdaniem dla wszystkich stanów: „konto nie jest
   sparowane — sparuj w panelu". Trafiało to obok dwa razy. Tryb `dev` nie
   ma czego parować (panel mówi to wprost), a zdanie prowadziło w dodatku do
   zakładki REJESTRY, skasowanej w 0.140.0.                                 */

test("tryb dev NIE odsyła do parowania — w panelu nie ma czego kliknąć", () => {
  const p = powodBrakuKonta("dev", "C:\\wertis\\wertis.env");
  assert.match(p, /SGT_MODE=mssql/, "wyjściem jest konfiguracja, nie przycisk w panelu");
  assert.match(p, /ALLEGRO_MODE=http/);
  assert.doesNotMatch(p, /sparuj/i, "parowanie w trybie demo to ślepa uliczka");
});

test("BRAK wertis.env jest NAZWANY — to on robi z konsoli tryb demo", () => {
  /* Sedno tej zmiany. `npm run sonda` startuje w katalogu workspace'u, a plik
     leży piętro wyżej: proces widział pustą konfigurację i mówił „konto nie
     jest sparowane" o koncie, które usługa obok ma sparowane. */
  assert.match(powodBrakuKonta("dev", null), /nie znalazł wertis\.env/);
  assert.match(
    powodBrakuKonta("dev", "C:\\wertis\\wertis.env"),
    /C:\\wertis\\wertis\.env/,
    "gdy plik JEST, zdanie ma go nazwać — inaczej nie da się porównać z usługą"
  );
});

test("każdy stan bez połączenia ma własną drogę wyjścia", () => {
  const stany = ["dev", "wylaczone", "niepolaczone", "zle_srodowisko"] as const;
  const zdania = stany.map((s) => powodBrakuKonta(s, null));
  assert.equal(new Set(zdania).size, stany.length, "żadne dwa stany nie dostają tego samego zdania");
  assert.match(powodBrakuKonta("wylaczone", null), /ALLEGRO_CLIENT_ID/);
  assert.match(powodBrakuKonta("zle_srodowisko", null), /ALLEGRO_SANDBOX/);
  // parowanie ma sens dokładnie w dwóch stanach i tam ma prowadzić do KARTY
  assert.match(powodBrakuKonta("niepolaczone", null), /STAN SYSTEMU → KONTO ALLEGRO/);
  assert.match(powodBrakuKonta("zle_srodowisko", null), /STAN SYSTEMU → KONTO ALLEGRO/);
  for (const z of zdania) assert.doesNotMatch(z, /REJESTRY/, "zakładka odeszła w 0.140.0");
});

test("pobranie załącznika nie idzie poza Allegro", async () => {
  /* Adres bierze się z ODPOWIEDZI Allegro, więc jest cudzym wejściem. Bez tej
     bramki nasz serwer stałby się pośrednikiem do dowolnego miejsca w sieci,
     dokładającym po drodze Bearera konta firmy. */
  for (const zly of [
    "https://przyklad.test/plik.jpg",
    "https://upload.allegro.pl.zly.test/plik.jpg",
    "nie-adres",
  ]) {
    await assert.rejects(() => pobierzZalacznik(zly), /poza Allegro|poprawnym URL/);
  }
});

test("ZAPIS na zamówieniach żąda innego uprawnienia niż odczyt", () => {
  /* Blizna 0.155.0 w nowym miejscu. Odmowa 403 niesie NAZWĘ uprawnienia i to
     jedyna rzecz, od której da się zacząć naprawę — a nazwa wskazująca
     uprawnienie, które konto już ma, wysyła człowieka po nic i każe mu
     sparować konto ponownie bez skutku. */
  const wniosek = "https://api.allegro.pl/order/refund-claims";
  assert.equal(scopeDlaUrl(wniosek), "allegro:api:orders:read", "odczyt listy wniosków");
  assert.equal(scopeDlaUrl(wniosek, "POST"), "allegro:api:orders:write",
    "złożenie wniosku to ZAPIS");
  assert.equal(scopeDlaUrl("https://api.allegro.pl/order/refund-claims/rc-1", "DELETE"),
    "allegro:api:orders:write", "anulowanie też");
  /* Rodziny spoza zamówień zachowują swoje uprawnienia niezależnie od metody. */
  assert.equal(scopeDlaUrl("https://api.allegro.pl/messaging/threads/1/messages", "POST"),
    "allegro:api:messaging");
});

test("adres pojedynczego wniosku koduje identyfikator", () => {
  assert.equal(
    urlWnioskuORabat("https://api.allegro.pl", "rc/1"),
    "https://api.allegro.pl/order/refund-claims/rc%2F1"
  );
});
