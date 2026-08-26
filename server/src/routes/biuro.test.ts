import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Podgląd biura ───────────────────────────────────────────────────────────
   Strona pod /biuro jest jedynym interfejsem biura, więc dwa niezmienniki są
   warte testu:

   1. SAMA STRONA jest dostępna bez sesji — logowanie odbywa się na niej, więc
      gdyby bramka ją objęła, biuro nie miałoby jak wpisać badge'a.
   2. DANE za nią nie są: trasy API, z których strona czyta, odpadają bez
      tokenu. Strona bez sesji ma pokazać formularz logowania, nie dane.      */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-biuro-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
type Rola = import("../services/users.js").Rola;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

/** Konto danej roli + gotowa sesja; zwraca nagłówki do `app.inject`. */
let kolejny = 0;
function jako(rola: Rola): { headers: { "x-session": string } } {
  // login unikalny per wywołanie: ten sam plik zakłada konto tej samej roli
  // w kilku testach, a `app_user.login` ma UNIQUE
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}-${++kolejny}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "biuro-pc", teraz, teraz);
  return { headers: { "x-session": token } };
}

test("strona /biuro jest serwowana bez sesji", async () => {
  const r = await app.inject({ method: "GET", url: "/biuro" });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"] as string, /text\/html/);
  assert.match(r.body, /Podgląd biura/);
});

test("korzeń przekierowuje do podglądu", async () => {
  const r = await app.inject({ method: "GET", url: "/" });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "/biuro");
});

test("trasa /sw.js wyszła razem z pogrzebem starej PWA", async () => {
  // jednorazowe sprzątanie po PWA z 0.3.0 skończyło się w 0.26.0
  const r = await app.inject({ method: "GET", url: "/sw.js" });
  assert.equal(r.statusCode, 404);
});

test("dane strony zostają za bramką sesji", async () => {
  // dokładnie trasy, z których strona czyta — regresja w którejkolwiek
  // otworzyłaby dane magazynu każdemu w LAN
  for (const url of [
    "/api/delivery/documents",
    "/api/problems/unresolved",
    "/api/delivery/1/problems",
    "/api/delivery/1/problems.csv",
    "/api/problems/1/photo",
    /* Zakładka STAN SYSTEMU i DZIENNIK (0.27.0). Metryki i kolejka mówią, ile
       kto zeskanował i co się nie zapisało, a ślad audytowy mówi to imiennie —
       więc bramka obejmuje je tak samo jak dostawy. */
    "/api/metrics",
    "/api/queue",
    "/api/reconcile",
    "/api/ean-conflicts",
    "/api/events",
    "/api/events/csv",
    "/api/analiza",
    "/api/analiza/csv",
    // Pozycje dokumentu (0.36.0) — mówią, co przyjechało, po ile i gdzie leży.
    "/api/biuro/dokument/1",
    // Dostawy zdjęte z listy pracy (0.40.0) — niosą nazwiska i powody.
    "/api/biuro/zamkniete-poza",
  ]) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 401, url);
  }
});

test("zapisy biura odpadają bez sesji, zanim ktokolwiek spojrzy na rolę", async () => {
  /* Kolejność bramek ma znaczenie: 401 przed 403. Trasa, która najpierw pyta
     o rolę, musiałaby najpierw czegoś się o wołającym domyślić — a bez sesji
     nie ma o kim. */
  for (const url of ["/api/biuro/dokument/1/zamknij", "/api/biuro/dokument/1/otworz"]) {
    const r = await app.inject({ method: "POST", url, payload: { powod: "cokolwiek" } });
    assert.equal(r.statusCode, 401, url);
  }
});

test("strona czyta stan serwera bez sesji — i tylko to", async () => {
  /* `/api/health` jest jedyną trasą, z której pasek stanu korzysta przed
     zalogowaniem, i jedyną, która ma prawo być otwarta: mówi o PROCESIE
     (wersja, tryb, czy worker żyje), nie o towarze ani o ludziach. */
  const r = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(r.statusCode, 200);
  const h = r.json();
  assert.ok(typeof h.wersja === "string");
  assert.ok("worker" in h);
});

test("formularze dostawców siedzą w stronie obok protokołu WERTIS", () => {
  /* GEKO i PARTNER mają własne druki reklamacyjne — wydruk ma wyglądać jak
     ich formularz, nie jak nasz protokół. Wybór idzie po nazwie dostawcy
     z dokumentu FZ; dane firmy do nadruku żyją w localStorage przeglądarki. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /Protokół zgłoszenia reklamacji B2B/, "szablon GEKO");
  assert.match(html, /PROTOKÓŁ ZGŁOSZENIA REKLAMACJI/, "szablon PARTNER");
  assert.match(html, /SZABLONY_DOSTAWCOW/, "wybór szablonu po dostawcy");
  assert.match(html, /wertis\.firma/, "dane firmy w localStorage");
});

test("strona biura zapisuje TYLKO wyliczone rzeczy", () => {
  /* „ZERO ZAPISU" było regułą tego pliku od 0.18.0 i skończyło się w 0.40.0:
     doszło oznaczenie dostawy jako rozłożonej poza WERTIS i cofnięcie tego.
     Reguła nie zniknęła, tylko dostała jawną listę — bo pilnuje czegoś, co
     nadal obowiązuje. W 0.50.0 lista urosła o import zbiórek i reguły strefy
     złotej, w 0.53.0 — o zwroty Allegro (skan, wybór kandydata, decyzje,
     pozycja ręczna, stempel środków, parowanie konta, dopasowanie dokumentu),
     w 0.56.0 — o logo dostawcy (wgranie i skasowanie), w 0.57.0 — o zamknięcie
     wyjątku przez biuro (trasa istniała od dawna, ale jej jedynym klientem był
     kolektor: reklamację prowadziło biuro, a domykał ją magazynier na hali)
     oraz o potwierdzenie odczytu odpowiedzi na notatkę. W 0.58.0 doszło
     zlecenie korekty zwrotu z MM na bufor, w 0.59.0 — kosze zwrotowe
     (przypięcie do kosza, zamknięcie kosza) i rozpatrzenie reklamacji.
     W 0.77.0 doszło ZAŁATWIENIE POMINIĘCIA: hala zgłasza brak towaru, a biuro
     zamyka sprawę. To zapis w naszej bazie, nie w Subiekcie, i wymaga
     kliknięcia — mieści się więc w regule, choć powiększa listę.

     To ostatnie ZMIENIA regułę i dlatego jest wypisane osobno: pierwszy zapis
     z tej strony, który trafia do `sfera_queue`, czyli do bazy firmy. Reszta
     dotyczy danych, których w Subiekcie nie ma. Wspólne zostaje to, co
     naprawdę pilnuje ta lista: rola biuro|admin, jawne kliknięcie i zero
     zapisu przy samym PATRZENIU na ekran.

     Zakazany jest wciąż `POST /api/delivery/documents/:dokId/open`: różni się
     od trasy podglądu o jeden człon ścieżki i zwróciłby to samo, a kosztem
     byłoby otwarcie dostawy przez samo PATRZENIE — zabranie blokad komuś przy
     półce i dokument W TOKU, którego nikt nie zaczął. Zamknięcie poza WERTIS
     jest tego przeciwieństwem: nie otwiera pracy, tylko ją zdejmuje, i nie
     dzieje się przy wejściu na ekran, lecz po kliknięciu i wpisaniu powodu. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.equal(
    (html.match(/method:\s*"POST"/g) ?? []).length,
    30,
    "logowanie, zamknięcie poza WERTIS, cofnięcie, notatka, import zbiórek, " +
      "zamknięcie wyjątku, odczyt odpowiedzi na notatkę, CZTERNAŚCIE zapisów " +
      "zwrotów Allegro (skan, utworzenie, decyzja, pozycja ręczna, środki, " +
      "parowanie, korekta z MM, kosz, zamknięcie kosza, reklamacja, " +
      "schowanie zapowiedzi, załatwienie pominięcia, POBRANIE ZAPOWIEDZI " +
      "z 0.85.0 oraz PRZEJĘCIE REKLAMACJI), pięć zapisów pytań klientów " +
      "(synchronizacja, wklejka, szkic, wysyłka odpowiedzi, " +
      "zamknięcie/pominięcie — dwa ostatnie jedną pętlą) i cztery zapisy " +
      "dyskusji Allegro (pobranie do rejestru, zmiana statusu, szkic, " +
      "wysyłka odpowiedzi) — nic ponadto.\n\n" +
      "Dwa ostatnie POST-y (0.104.0) domykają proces dyskusji w aplikacji: " +
      "GENERUJ liczy szkic, WYŚLIJ posyła odpowiedź do sprawy w Allegro — " +
      "oba za jawnym kliknięciem, wysyłka dodatkowo za potwierdzeniem. " +
      "Liczba rośnie tu ŚWIADOMIE i to jedyny sposób, w jaki wolno ją " +
      "podnosić — żaden zapis nie dzieje się przy samym patrzeniu."
  );
  assert.equal(
    (html.match(/method:\s*"PUT"/g) ?? []).length,
    8,
    "PUT to komplet reguł strefy złotej, ręczny wybór dokumentu zwrotu, " +
      "wgranie logo dostawcy, półka reklamacyjna, notatka do dyskusji " +
      "Allegro, prompt eksperta i fakty firmowe (0.80.0) oraz przełącznik " +
      "automatycznego szkicu AI (0.107.0) — ten ostatni po to, by biuro " +
      "samo decydowało, czy model pracuje w tle, czy dopiero na kliknięcie"
  );
  assert.equal(
    (html.match(/method:\s*"DELETE"/g) ?? []).length,
    4,
    "DELETE to odpięcie dokumentu zwrotu, odpięcie kosza, rozłączenie " +
      "konta Allegro i skasowanie logo dostawcy"
  );
  /* Jedna strona, jeden <script> — więc dwie funkcje o tej samej nazwie nie
     są kolizją teoretyczną, tylko cichym przesłonięciem. Tak zniknęła lista
     wyjątków dostawy: `rysujReklamacje` istniało w dwóch egzemplarzach, bo
     zwroty dostały własną listę reklamacji o tej samej nazwie (0.59.0). */
  const nazwy = [...html.matchAll(/^function\s+([\w$]+)\s*\(/gm)].map((m) => m[1]);
  const zdublowane = nazwy.filter((n, i) => nazwy.indexOf(n) !== i);
  assert.deepEqual(zdublowane, [], "funkcje o tej samej nazwie przesłaniają się nawzajem");

  assert.ok(!/documents\/[^"'`]*\/open/.test(html), "strona otwiera dostawę");
  assert.match(html, /\/api\/biuro\/dokument\//, "strona czyta trasę podglądu");
  assert.match(html, /dokument\/\$\{dokId\}\/zamknij/, "zamknięcie poza WERTIS");
  assert.match(html, /dokument\/\$\{dokId\}\/otworz/, "droga powrotna");
  assert.match(html, /zbiorki\/import/, "import zbiórek z Sellasist");
  assert.match(html, /zwroty\/skan/, "skan etykiety zwrotu Allegro");
  assert.match(html, /biuro\/dostawcy\/\$\{khId\}\/logo/, "wgranie logo dostawcy");
  /* Konwersja formatów MUSI zostać po stronie przeglądarki: serwer przyjmuje
     wyłącznie PNG, a loga przychodzą też jako SVG i WebP. Bez `<canvas>`
     panel odsyłałby plik w oryginale i połowa wgrań kończyłaby się odmową. */
  assert.match(html, /toDataURL\("image\/png"\)/, "normalizacja logo do PNG");
  assert.match(html, /problems\/\$\{id\}\/resolve/, "biuro zamyka wyjątek");
  assert.match(html, /pominiete\/\$\{[^}]+\}\/zalatwione/, "biuro zamyka sprawę pominięcia");
  /* Odpowiedź do klienta wysyła CZŁOWIEK i to się nie zmienia. Model pisze
     szkic, biuro go czyta i klika — automatycznej wysyłki tu nie ma i test
     pilnuje, żeby nie weszła bokiem. */
  assert.match(html, /pytania\/\$\{id\}\/wyslij/, "wysyłka odpowiedzi po kliknięciu");
  assert.match(html, /WYŚLIJ PRZEZ ALLEGRO/, "wysyłka jest jawnym przyciskiem");
  assert.match(html, /potwierdz\(\{[\s\S]{0,200}WYSŁANIE ODPOWIEDZI DO KLIENTA/, "wysyłka za potwierdzeniem");
});

test("dyskusje Allegro: rejestr pracy i cała sprawa w aplikacji", () => {
  /* 0.103.0 zrobiło z dyskusji rejestr pracy (lista z NASZEJ tabeli, status,
     prowadzący, pigułka uwagi na zakładce). 0.104.0 domknęło proces: rozmowę
     czyta się i odpowiedź wysyła stąd, przez API dyskusji — przeskok do
     panelu Allegro zostaje tylko degradacją, gdy API nie zna sprawy.
     Wysyłka jest jawnym kliknięciem za potwierdzeniem, jak przy pytaniach —
     automatycznej wysyłki nie ma i ten test pilnuje, żeby nie weszła bokiem. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /id="dyskusjeKarta"/, "dyskusje mają własną kartę pracy");
  assert.match(html, /api\(`\/api\/biuro\/dyskusje\$\{q\}`\)/, "lista czyta lokalny rejestr za sesją");
  assert.match(html, /"\/api\/biuro\/dyskusje\/odswiez"/, "pobranie z Allegro jest jawnym przyciskiem");
  assert.match(html, /data-dysk-status/, "status sprawy zmienia kliknięcie");
  assert.match(html, /dyskusje\/\$\{[^}]+\}\/notatka/, "notatka z ustaleń zostaje u nas");
  // cała sprawa w aplikacji (0.104.0)
  assert.match(html, /id="dyskusjaSzczegol"/, "sprawa ma pełnoekranowy szczegół");
  assert.match(html, /dyskusje\/\$\{[^}]+\}\/wiadomosci/, "rozmowa czytana z Allegro na klik");
  assert.match(html, /dyskusje\/\$\{[^}]+\}\/generuj/, "szkic pisze model na jawne kliknięcie");
  assert.match(html, /dyskusje\/\$\{[^}]+\}\/wyslij/, "odpowiedź wysyła się z aplikacji");
  assert.match(
    html,
    /potwierdz\(\{[\s\S]{0,200}WYSŁANIE ODPOWIEDZI DO KLIENTA/,
    "wysyłka do dyskusji za potwierdzeniem"
  );
  assert.match(html, /Rozmowa niedostępna przez API/, "degradacja do panelu, gdy API nie zna sprawy");
  assert.match(html, /id="zwrotyLicznik" class="tabLicznik"/, "pigułka uwagi na zakładce ZWROTY");
  assert.match(html, /"\/api\/biuro\/zwroty\/licznik"/, "pigułka ma własną tanią trasę");
  assert.match(html, /data-rekl-prowadzi/, "jawne przejęcie reklamacji przyciskiem");
});

test("kopiowanie odpowiedzi ma zejście awaryjne bez HTTPS", () => {
  /* `navigator.clipboard` istnieje wyłącznie w bezpiecznym kontekście, a panel
     biura chodzi po LAN-ie pod gołym http — czyli dokładnie tam, gdzie tego
     API nie ma. Bez `execCommand` przycisk KOPIUJ byłby martwy na produkcji
     i żywy w każdym teście przeglądarkowym. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /navigator\.clipboard\.writeText/, "droga główna");
  assert.match(html, /document\.execCommand\("copy"\)/, "zejście awaryjne bez HTTPS");
});

test("lista dostaw sygnalizuje wyjątki", () => {
  /* Pasek postępu tego NIE powie i powiedzieć nie może: wyjątek liczy się jako
     pozycja domknięta (D8). Bez osobnego sygnału dostawa z trzema reklamacjami
     wygląda w biurze dokładnie jak bezproblemowa — zielony pasek 100%. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /d\.wyjatkiOtwarte/, "wiersz listy czyta licznik wyjątków");
  assert.match(html, /badge err">\$\{d\.wyjatkiOtwarte\}/, "licznik jako plakietka błędu");
});

test("pasek niesie tylko pracę — ustawienia siedzą za zębatką", () => {
  /* Zakładki dostały grupy (0.74.1), a w 0.76.0 z paska wyszły USTAWIENIA:
     grupa z jedną pastylką `DOSTAWCY` ważyła w rzędzie tyle samo co DOSTAWY,
     choć biuro wchodzi tam raz na kilka tygodni.

     Ta zmiana ma dwie ciche drogi do zepsucia i test pilnuje obu. Pierwsza to
     przycisk, który przy przenoszeniu wypadł POZA `div.grupa`: klika się,
     widok się otwiera, tyle że stoi bez podpisu i bez grupy — czyli dokładnie
     tak, jak wyglądał pasek przed 0.74.1. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  /* Wycinek bierze się po ZNACZNIKU OTWIERAJĄCYM, nie po jego dosłownej
     treści. Do 0.95.0 stał tu literał `<nav class="zakladki">` i wystarczyło,
     że pasek dostał `hidden` — potrzebne, odkąd mieszka w nagłówku, czyli
     poza `#panel`, i samo schowanie panelu przestało go zdejmować z ekranu
     logowania — a test przestawał znajdować cokolwiek. Padał wtedy na
     wszystkim naraz, nie mówiąc, co się zmieniło. */
  const otwarcie = html.match(/<nav class="zakladki"[^>]*>/);
  assert.ok(otwarcie, "pasek zakładek istnieje i nosi swoją klasę");
  const nav = html.slice(otwarcie.index!, html.indexOf("</nav>"));

  const widoki = [...nav.matchAll(/data-widok="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    widoki,
    ["dostawy", "sprawy", "zwroty", "pytania", "nadzor", "dziennik", "analiza"],
    "w pasku tylko zakładki pracy — dostawcy tu nie wracają. SPRAWY (0.108.0) " +
      "stoją PRZED dwiema zakładkami, które w następnym wydaniu zastąpią"
  );

  /* Dopasowanie idzie po ZAWARTOŚCI `grupa-btny`, nie po rozbiciu paska na
     grupy: rozbicie przepuszczało przycisk stojący PO zamknięciu ostatniej
     grupy, czyli dokładnie tę sierotę, przed którą ten test miał bronić.
     `grupa-btny` nie zawiera zagnieżdżonych `div`, więc leniwe `</div>`
     zatrzymuje się na własnym zamknięciu. */
  const wGrupach = [...nav.matchAll(/<div class="grupa-btny">([\s\S]*?)<\/div>/g)]
    .flatMap((m) => [...m[1].matchAll(/data-widok="(\w+)"/g)].map((x) => x[1]));
  assert.deepEqual(
    [...wGrupach].sort(),
    [...widoki].sort(),
    "żaden przycisk poza grupą — sierota wygląda prawie normalnie i tylko test ją złapie"
  );

  assert.equal(
    (nav.match(/class="grupa-nazwa"/g) ?? []).length,
    2,
    "dwie grupy, każda podpisana"
  );

  /* Druga cicha droga: widok zostaje w pliku, ale przestaje do niego cokolwiek
     prowadzić. Wtedy wszystko wygląda dobrze — po prostu nie da się już wejść
     w DOSTAWCÓW. Zębatka jest jedynym wejściem, więc musi być dokładnie jedna
     i musi nieść ten sam `data-widok`, po którym działa cały mechanizm. */
  const zebatki = [...html.matchAll(/<button id="ustawienia"[\s\S]*?>/g)];
  assert.equal(zebatki.length, 1, "jedna zębatka w nagłówku");
  assert.match(zebatki[0][0], /data-widok="dostawcy"/, "zębatka prowadzi do dostawców");
  assert.match(zebatki[0][0], /aria-label="Ustawienia"/, "ikona bez napisu musi mieć nazwę");

  /* Delegacja kliknięcia MUSI stać poza `nav` — zębatka jest w nagłówku,
     a przy dawnym `nav.zakladki` byłaby klikalna i bez skutku. */
  assert.doesNotMatch(
    html,
    /querySelector\("nav\.zakladki"\)\.addEventListener/,
    "obsługa kliknięcia nie może być przypięta do samego paska"
  );
});

test("przyciski sprawy noszą delegację, która przeżyje ich przenosiny", () => {
  /* TRZECI raz ta sama usterka, więc trzeci raz jest ostatni.

     W 0.92.0 delegacja dostaw została na `#szczegolNaglowek` — dokładnie na
     elemencie, który przyciski opuściły. W 0.93.0 to samo groziło zwrotom.
     W 0.96.0 przyciski sprawy rozeszły się na trzy miejsca (przy tytule, przy
     etykiecie ODPOWIEDŹ, pod polem), a nasłuch dalej wisiał na `#pytanieAkcje`
     — czyli na rzędzie, z którego cztery z nich wyszły. PRZELICZ SZKIC,
     PRZYWRÓĆ SZKIC, ZAŁATWIONE POZA APLIKACJĄ i POMIŃ klikały się bez skutku.

     Wygląd był bez zarzutu, wszystkie 974 testy przechodziły, a zrzut ekranu
     niczego nie pokazywał — bo martwy przycisk wygląda jak żywy. Jedyne, co to
     łapie, to nasłuch na POJEMNIKU, który przetrwa przenosiny w środku. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );

  /* Nasłuch, który wymienia POJEMNIKI WEWNĘTRZNE z nazwy, jest zaproszeniem do
     tego błędu przy każdej kolejnej zmianie układu: dołożenie trzeciego bloku
     nie wywala niczego, tylko cicho go pomija. Delegacja ma siedzieć na SEKCJI
     sprawy — ona przeżyje przenosiny w środku. */
  const zakazane = [
    "pytanieAkcje",         // rząd przycisków pod polem odpowiedzi (0.96.0)
    "szczegolNaglowek",     // nagłówek dostawy — stąd wyjechały notatki (0.92.0)
    "szczegolLinie",        // tabela pozycji — wyjątki wyszły nad nią (0.97.0)
    "szczegolBezLinii",
    "zwrotPozycje",         // lista pozycji zwrotu (0.98.0)
    "zwrotDokumenty",       // blok korekty — stąd wyszło OCEŃ I ZLEĆ (0.98.0)
    /* Trzy karty wglądu, które w 0.99.0 przejechały CAŁĄ ZAKŁADKĘ — ze
       ZWROTÓW do ANALIZY. Nasłuch na karcie przeżyłby same przenosiny (jechał
       z blokiem), ale nie przeżył CELU: klik w wiersz „co stoi teraz" otwiera
       kosz, który został w zakładce pracy, więc obsługa musi stać nad kartą
       i umieć przełączyć widok. */
    "raportZwrotowKarta",
    "statystykiKarta",
    "czasyKarta",           // klik wiersza „co stoi teraz" (0.99.0)
  ];
  for (const id of zakazane) {
    assert.doesNotMatch(
      html,
      new RegExp(`\\$\\("${id}"\\)\\.addEventListener\\("click"`),
      `delegacja nie może wisieć na \`${id}\` — to pojemnik w środku sprawy`
    );
  }

  /* Bezpieczny wzorzec jest już tylko JEDEN: delegacja z poziomu sekcji.

     Zwroty trzymały się do 0.97.0 innego — każdy blok kontekstu niósł własny
     nasłuch, więc przeniesienie bloku zabierało nasłuch ze sobą. Działało,
     dopóki wędrowały BLOKI. W 0.98.0 wywędrował sam przycisk: „OCEŃ I ZLEĆ
     KOREKTĘ" przeszło ze sprawy (`#zwrotDokumenty`) do kontekstu
     (`#zwrotRozliczenie`) i zostawiło nasłuch za sobą. Ten wzorzec broni
     jedynie przed przeprowadzką całego bloku, a nie przed przeprowadzką
     przycisku — dlatego zwroty dołączyły do sekcji. */
  for (const sekcja of [
    "pytanieSzczegol", "szczegol", "zwrotSzczegol", "zwrotKontekst", "widokAnaliza",
  ]) {
    assert.ok(html.includes(`id="${sekcja}"`), `${sekcja} istnieje`);
    assert.match(
      html,
      new RegExp(`\\$\\("${sekcja}"\\)\\.addEventListener\\("click"`),
      `${sekcja} deleguje z poziomu sekcji, nie z pojemnika w środku`
    );
  }
});

test("pasek zakładek mieszka w nagłówku i sam pilnuje swojej widoczności", () => {
  /* Od 0.95.0 zakładki stoją w ciemnym nagłówku, a nie we własnej białej
     karcie pod nim. Chodziło o pion: trzecie pasmo chromu kosztowało ~60 px
     NA KAŻDEJ zakładce, a panel bywa otwarty na laptopie obok Subiekta.

     Przeprowadzka wyniosła pasek POZA `#panel` i to jest jej jedyny haczyk.
     Cała reszta chromu sesji chowa się, bo `#panel` dostaje `hidden`; pasek
     stojący w nagłówku nie schowa się od tego NIGDY. Bez własnego `hidden`
     w znaczniku i bez odsłonięcia w `start()` sześć pastylek świeciłoby nad
     formularzem logowania — klikalnych, prowadzących do pustych widoków. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const otwarcie = html.match(/<nav class="zakladki"[^>]*>/);
  assert.ok(otwarcie, "pasek zakładek istnieje");
  assert.ok(otwarcie.index! < html.indexOf("</header>"),
    "pasek stoi w nagłówku — po to wyjechał z osobnego pasma");
  assert.ok(otwarcie.index! < html.indexOf('id="chrome"'),
    "pasek nie wrócił do `#chrome`, gdzie został sam pasek stanu");
  assert.match(otwarcie[0], /\bhidden\b/,
    "pasek startuje schowany — `#panel` już go nie zasłania");

  for (const [co, po] of [["hidden = false", "zalogowaniu"], ["hidden = true", "wylogowaniu"]]) {
    assert.ok(html.includes(`zakladki().${co}`),
      `pasek zmienia widoczność po ${po}`);
  }
});

test("pasek stanu niesie licznik odpowiedzi na notatki", () => {
  /* Pasek widać z KAŻDEJ zakładki i to jest cały sens tego sygnału: do 0.57.0
     odpowiedź widać było wyłącznie po wejściu w tę konkretną dostawę, a biuro
     nie miało powodu tam wracać. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /odpowiedziNaNotatki\.length/, "pasek stanu czyta licznik");
  assert.match(html, /biuro\/notatki\/odpowiedzi/, "licznik ma własną trasę za sesją");
  /* Licznik jedzie przez `api()`, nie przez gołe `fetch` — i to jest cała
     różnica: `api()` dokłada `x-session`. Gdyby ktoś dołożył ten licznik do
     `/api/health` (trasa z listy BEZ_SESJI, wołana tu gołym `fetch`), dane
     biura wystawiłyby się każdemu bez logowania. */
  assert.match(html, /api\("\/api\/biuro\/notatki\/odpowiedzi"\)/);
  assert.ok(
    !/fetch\("\/api\/biuro\/notatki\/odpowiedzi"/.test(html),
    "licznik odpowiedzi musi iść przez api(), czyli za sesją"
  );
});

test("licznik prowadzi do karty, a karta stoi nad tabelą dostaw", () => {
  /* Zgłoszenie z 20 sierpnia: „mam na górze zaznaczone odpowiedź na notatkę,
     ale nie wiem gdzie ta odpowiedź jest, jak klikam w licznik też nic się nie
     dzieje". Sygnał był poprawny, dane były na miejscu — zawiodła DROGA do
     nich. Karta stała pod tabelą dostaw, a ta bywa na kilkadziesiąt wierszy;
     kafel wołał zaś tylko przełączenie na zakładkę, na której biuro już było.

     Stąd dwie asercje, których nie da się spełnić przypadkiem: kolejność
     sekcji w dokumencie i przewijanie do celu. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.ok(
    html.indexOf('id="kartaOdpowiedzi"') < html.indexOf('id="kartaDostaw"'),
    "karta odpowiedzi ma stać NAD tabelą dostaw — pod nią wypada poza ekran"
  );
  assert.match(html, /data-do="dostawy" data-cel="kartaOdpowiedzi"/, "kafel wskazuje cel");
  assert.match(html, /dataset\.cel/, "obsługa paska czyta cel kafla");
  assert.match(html, /scrollIntoView/, "kliknięcie licznika ma doprowadzić do karty");
});

test("żądania BEZ CIAŁA nie deklarują typu treści", () => {
  /* Zgłoszenie z biura: „Nie usunięto: Bad Request" przy kasowaniu logo.
     Wina była w `api()`, wspólnym opakowaniu WSZYSTKICH wywołań panelu:
     `content-type: application/json` jechał zawsze, także bez ciała. Domyślny
     parser Fastify odrzuca taką parę (FST_ERR_CTP_EMPTY_JSON_BODY, 400), więc
     martwe były cztery czynności naraz — a trzy z nich milczały miesiącami,
     bo robi się je raz na jakiś czas.

     Bramka pilnuje SAMEJ REGUŁY, nie jednego przycisku: nagłówek musi stać za
     sprawdzeniem `opts.body`. Test na trasie by tego nie złapał, bo `inject`
     nie wysyła nagłówków przeglądarki — i dokładnie dlatego usterka przeszła
     przez komplet testów tras. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  /* Zasięg zawężony do SAMEJ `api()`. Panel ma dwa surowe `fetch` — logowanie
     i skan zwrotu — i tam nagłówek bezwarunkowy jest słuszny, bo oba wysyłają
     ciało. Bramka o szerokości całego pliku wywalałaby się na poprawnym
     kodzie, a taka uczy tylko obchodzenia jej. */
  const od = html.indexOf("async function api(");
  const api = html.slice(od, html.indexOf("\n}\n", od));
  assert.ok(od > 0 && api.includes("await fetch"), "nie znalazłem ciała api()");
  assert.ok(
    /opts\.body !== undefined/.test(api),
    "`content-type` w api() musi zależeć od obecności ciała"
  );
  assert.ok(
    !/headers:\s*\{\s*"content-type"/.test(api),
    "nagłówek nie ma prawa wrócić do bezwarunkowego obiektu"
  );

  // czworo wywołań, które ta reguła utrzymuje przy życiu
  assert.match(html, /dokument\/\$\{dokId\}\/otworz`,\s*\{\s*method:\s*"POST"/);
  assert.match(html, /zwroty\/\$\{otwartyZwrot\}\/dokument`,\s*\{\s*method:\s*"DELETE"/);
  assert.match(html, /"\/api\/biuro\/allegro",\s*\{\s*method:\s*"DELETE"/);
  assert.match(html, /dostawcy\/\$\{khId\}\/logo`,\s*\{\s*method:\s*"DELETE"/);
});

test("podgląd pokazuje, kto odłożył pozycję", () => {
  /* `done_by` i `done_at` leżały w bazie od 0.17.0 bez ani jednego czytelnika.
     Wyleciałyby z widoku niezauważone przy pierwszym porządkowaniu tabeli. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /doneBy/);
  assert.match(html, /KTO ODŁOŻYŁ/);
});

test("raport per osoba jedzie z podstawą prawną — nigdy bez niej", () => {
  /* ODWRÓCENIE decyzji z 0.27.0, na polecenie właściciela (8.08.2026, wpis
     0.48.0 w CHANGELOG). Do 0.47.x ten test pilnował, żeby strona raportu
     wydajności NIE miała — monitoring pracowniczy (Kodeks pracy art. 22²)
     wymaga zapisu w regulaminie i uprzedzenia załogi, a przycisk obok metryk
     robiłby z obowiązku formalnego przypadek.

     Właściciel został o tym uprzedzony i świadomie zdecydował inaczej. Test
     pilnuje więc tego, co przy tej decyzji pozostaje niezbywalne: sekcja
     imienna istnieje RAZEM z miejscem na podstawę prawną, którą serwer
     wysyła w odpowiedzi. Zniknięcie któregokolwiek z tych elementów to
     regresja prawna, nie kosmetyczna. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /WYDAJNOŚĆ PER OSOBA/, "sekcja imienna zniknęła ze strony");
  assert.match(html, /podstawaPrawna/, "strona nie pokazuje podstawy prawnej monitoringu");
  assert.match(html, /nie są miarą błędu/, "zdanie o problemach jako nie-błędach musi zostać");
});

test("zdjęcie dostawy z listy jest zastrzeżone dla biura", async () => {
  /* `services/auth.test.ts` sprawdza samą mapę uprawnień i NIE widzi, czy
     trasa w ogóle o nią pyta. Bez tego testu mapa może być bez zarzutu, a
     magazynier i tak zdejmie dostawę z listy jednym żądaniem. */
  const z = await app.inject({
    method: "POST",
    url: "/api/biuro/dokument/1/zamknij",
    ...jako("magazynier"),
    payload: { powod: "cokolwiek" },
  });
  assert.equal(z.statusCode, 403);
  assert.match(z.json().error, /biura/i);
  // to samo dla drogi powrotnej — inaczej cofnąć mógłby każdy
  const r = await app.inject({
    method: "POST",
    url: "/api/biuro/dokument/1/otworz",
    ...jako("magazynier"),
  });
  assert.equal(r.statusCode, 403);
});

test("biuro przechodzi bramkę roli i dopiero wtedy dostaje odpowiedź o dokumencie", async () => {
  /* 400, nie 403: rola się zgadza, tylko dokumentu nie ma w read-modelu.
     Rozróżnienie jest tu całym testem — pomylone znaczyłoby, że bramka roli
     odrzuca biuro albo że nie ma jej wcale. */
  const r = await app.inject({
    method: "POST",
    url: "/api/biuro/dokument/424242/zamknij",
    ...jako("biuro"),
    payload: { powod: "rozłożone starą aplikacją" },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /Nie znaleziono/);
});

test("pusty powód odpada na trasie, a nie dopiero w bazie", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/biuro/dokument/424242/zamknij",
    ...jako("biuro"),
    payload: { powod: "   " },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /powód/i);
});

test("podgląd kosza w biurze czyta tę samą trasę, co karta zwrotu", () => {
  /* Zawartość kosza ma JEDNO źródło prawdy. Gdyby podgląd liczył pozycje po
     swojemu — z listy koszy albo z osobnej trasy — biuro i hala zaczęłyby
     widzieć różne kosze, a rozjazd wyszedłby dopiero przy sporze o brakujący
     towar. Ten test pilnuje, że panel pyta `/api/biuro/kosze/:id`. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /api\/biuro\/kosze\/\$\{id\}/, "podgląd pyta o szczegół kosza");
  assert.match(html, /koszPodglad/, "panel podglądu");
  assert.match(html, /KOSZ NIEKOMPLETNY/, "pominięcia widoczne dla biura");
  assert.match(html, /stanPozycjiKosza/, "stan pozycji jednym zdaniem");
  assert.match(html, /pominieteKarta/, "lista pominięć jako karta pracy");
  assert.match(html, /koszSzukaj/, "szukanie towaru w koszach");
});

test("konfiguracja siedzi za zębatką, nie na zakładkach pracy", () => {
  /* Prompt eksperta stał do 0.85.0 na PYTANIACH, reguły strefy na ANALIZIE,
     a dane firmy w środku karty REKLAMACJE. Wspólne dla nich jest to, że
     ustawia się je razy kilka w roku, a pion zabierały codziennie.

     Test celuje w POŁOŻENIE, bo nic innego go nie trzyma: pola mają te same
     `id` co przedtem, więc zapis działałby tak samo z powrotem wklejony na
     zakładkę pracy — i nikt by tego nie zauważył do następnego zrzutu ekranu. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const wycinek = (od: string, doo: string) => {
    const a = html.indexOf(od);
    assert.notEqual(a, -1, `brak ${od}`);
    const b = html.indexOf(doo, a);
    assert.notEqual(b, -1, `brak ${doo} po ${od}`);
    return html.slice(a, b);
  };
  const ustawienia = wycinek('id="widokDostawcy"', "</main>");
  for (const pole of ["pytaniaPrompt", "pytaniaFakty", "reguly", "firmaNazwa", "dostawcy"]) {
    assert.ok(ustawienia.includes(`id="${pole}"`), `${pole} należy do ustawień`);
  }

  const pytania = wycinek('id="widokPytania"', 'id="widokNadzor"');
  assert.ok(!pytania.includes('id="pytaniaPrompt"'), "prompt zszedł z zakładki pracy");
  const analiza = wycinek('id="widokAnaliza"', 'id="widokDostawcy"');
  assert.ok(!analiza.includes('id="reguly"'), "reguły zeszły z ANALIZY");
  assert.ok(analiza.includes("Ustawieniach"), "ANALIZA mówi, gdzie ustawia się reguły");
  const dostawy = wycinek('id="widokDostawy"', 'id="widokZwroty"');
  assert.ok(!dostawy.includes('id="firmaNazwa"'), "dane firmy zeszły z REKLAMACJI");
});

test("praca stoi przed archiwum i przed ścieżką poboczną", () => {
  /* Siatka układa karty w kolejności dokumentu, więc kolejność w HTML JEST
     kolejnością na ekranie. Nic w JS jej nie pilnuje — przestawienie sekcji
     przy następnej zmianie przeszłoby bez śladu. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const przed = (a: string, b: string, czemu: string) => {
    const ia = html.indexOf(`id="${a}"`);
    const ib = html.indexOf(`id="${b}"`);
    assert.ok(ia !== -1 && ib !== -1, `${a} albo ${b} nie istnieje`);
    assert.ok(ia < ib, czemu);
  };
  przed("kartaReklamacji", "kartaPozaWertis", "wyjątki do rozwiązania przed zamkniętymi dostawami");
  przed("pytaniaListaKarta", "pytaniaWklejkaKarta", "lista pytań przed wklejką z poczty");
});

test("konsola pytań ma trzy strefy, a próg szerokości jest jeden", () => {
  /* Od 0.91.0 zakładka PYTANIA rozkłada się na kolejkę, sprawę i kontekst.
     Żeby kontekst mógł być TRZECIĄ KOLUMNĄ siatki, musi być rodzeństwem
     szczegółu wewnątrz `#widokPytania` — wsunięty do środka karty sprawy
     wygląda tak samo w kodzie, a na ekranie wraca pod odpowiedź. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const widok = html.slice(
    html.indexOf('id="widokPytania"'),
    html.indexOf('id="widokNadzor"')
  );
  const szczegol = widok.indexOf('id="pytanieSzczegol"');
  const kontekst = widok.indexOf('id="pytanieKontekst"');
  const konsczegolu = widok.indexOf("</section>", szczegol);
  assert.ok(szczegol !== -1 && kontekst !== -1, "obie strefy istnieją");
  assert.ok(kontekst > konsczegolu, "kontekst jest OBOK sprawy, nie w jej środku");
  assert.match(html, /#widokPytania\.zSzczegolem \{ grid-template-columns:/,
    "trzy kolumny opisane jedną regułą");

  /* Progi stoją w DWÓCH miejscach — w arkuszu i w skrypcie — i nic ich nie
     pilnowało. Rozjazd nie wywraca niczego głośno: szczegół po prostu
     zasłania kolejkę na jednej szerokości okna i nikt nie wie dlaczego.

     Do 0.101.0 próg był jeden i test brał z HTML PIERWSZE dopasowanie. Od
     0.101.0 są dwa — 1280 px dla trzech stref i 1024 px dla pasma, w którym
     kontekst jest szufladą — więc sprawdzamy KOMPLET: drugi próg wpisany
     tylko do skryptu dawałby szufladę bez stylów, czyli kontekst znikający
     bez śladu na jednej szerokości okna. */
  const wCss = [...html.matchAll(/@media \(min-width: (\d+)px\)/g)].map((m) => m[1]);
  const wJs = [...html.matchAll(/matchMedia\("\(min-width: (\d+)px\)"\)/g)].map((m) => m[1]);
  assert.ok(wJs.length >= 2, "skrypt zna oba progi — trzy strefy i pasmo szuflady");
  for (const prog of wJs) {
    assert.ok(wCss.includes(prog), `próg ${prog} ze skryptu musi istnieć w arkuszu`);
  }
});

test("kontekst ma szufladę na wąskim oknie, a szuflada ma trzy wyjścia", () => {
  /* Od 0.101.0 kontekst nie spada już pod sprawę poniżej 1280 px — wjeżdża
     jako szuflada z prawej, a kolejka zostaje widoczna obok sprawy. Makieta
     `Waski` rysuje to dla PYTAŃ; powłoka trzech stref jest wspólna od 0.93.0,
     więc szuflada obejmuje wszystkie trzy zakładki spraw. Ten test pilnuje
     rzeczy, które da się złamać po cichu, przestawiając układ.

     TRZY WYJŚCIA, bo panel zasłania sprawę: przycisk w jego głowie, klik
     w przyciemnienie i Escape. Wysunięty panel bez widocznego wyjścia czyta
     się jak coś, co się zacięło, a mysz nie zgadnie dwóch pozostałych dróg. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );

  /* Liczymy ZNACZNIK, nie selektor: `data-szuflada>` kończy atrybut, więc nie
     łapie ani `data-szuflada-zamknij`, ani `[data-szuflada]` z obsługi kliknięć. */
  assert.equal((html.match(/data-szuflada>/g) ?? []).length, 3,
    "przycisk KONTEKST stoi w każdej z trzech spraw");
  assert.equal((html.match(/data-szuflada-zamknij>/g) ?? []).length, 3,
    "i każda szuflada ma własne ZAMKNIJ");
  assert.match(html, /id="szufladaCien"/, "przyciemnienie istnieje");

  /* Klasy są UMOWĄ między arkuszem a skryptem: pasmo ustawia jedna, stan
     wysunięcia druga. Skasowanie którejkolwiek po jednej stronie zostawia
     szufladę, która nigdy się nie pokaże albo nigdy nie schowa. */
  for (const klasa of ["zSzuflada", "szufladaOtwarta"]) {
    assert.ok(html.includes(`.widok.${klasa}`) || html.includes(`.${klasa}`),
      `${klasa} opisana w arkuszu`);
    assert.ok(html.includes(`"${klasa}"`), `${klasa} ustawiana w skrypcie`);
  }

  /* Escape musi zdejmować NAJWYŻSZĄ warstwę i na tym kończyć. Bez wyjścia
     z obsługi jeden klawisz zamykałby szufladę i sprawę pod nią naraz —
     czyli wychodził z pracy, a nie z panelu obok niej. */
  assert.match(html, /if \(szufladaW\) return ustawSzuflade\(szufladaW, false\);/,
    "Escape zamyka szufladę i nie leci dalej do zamknięcia sprawy");
});

test("filtr stoi w pasku wtedy i tylko wtedy, gdy rządzi całą zakładką", () => {
  /* Od 0.94.0 zakładki wglądu — STAN SYSTEMU, DZIENNIK, ANALIZA — mają jedną
     strefę i pasek filtrów, zamiast wyglądać dokładnie jak zakładki pracy.

     Ten test pilnuje reguły, a nie samego istnienia paska. PASEK NAD KARTAMI
     OBIECUJE, ŻE RZĄDZI CAŁYM WIDOKIEM. Przy dzienniku i analizie to prawda:
     każda kontrolka zmienia wszystko, co niżej. Przy stanie systemu prawdą
     NIE jest — OKNO dotyczy wyłącznie metryk, bo kolejka zapisów, kolizje
     kodów i stan serwera mówią o TERAZ i żaden zakres dni ich nie rusza.
     Dlatego STAN SYSTEMU paska nie ma, a jego OKNO siedzi w karcie metryk.

     Wyniesienie go „dla spójności" byłoby regresją, która nie wygląda na
     regresję: układ zrobiłby się równiejszy, a interfejs zacząłby kłamać. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const wycinek = (od: string, doo: string) => {
    const a = html.indexOf(od);
    assert.notEqual(a, -1, `brak ${od}`);
    const b = html.indexOf(doo, a);
    assert.notEqual(b, -1, `brak ${doo} po ${od}`);
    return html.slice(a, b);
  };

  for (const w of ["widokNadzor", "widokDziennik", "widokAnaliza"]) {
    assert.match(html, new RegExp(`id="${w}" class="widok wglad"`),
      `${w} jest zakładką wglądu, nie pracy`);
  }

  /* Pasek to CHROM, nie treść — i dlatego nie nosi klasy `card`. Nosił ją
     w pierwszym podejściu i przegrywał specyficznością z regułą `.card`
     stojącą niżej w arkuszu: renderował się jako biała płachta z cieniem,
     przy analizie prawie pusta. */
  assert.ok(!/class="[^"]*card[^"]*pasekFiltrow/.test(html),
    "pasek filtrów nie jest kartą");

  const dziennik = wycinek('id="widokDziennik"', 'id="widokAnaliza"');
  const analiza = wycinek('id="widokAnaliza"', 'id="widokDostawcy"');
  for (const [nazwa, widok, pola] of [
    ["dziennik", dziennik, ["fOd", "fDo", "fTyp", "fTw", "fDev", "fLimit",
                            "szukajDziennik", "csvDziennik"]],
    /* Od 0.96.0 pasek analizy niesie też ZAKRES i OSOBĘ, a OKNO jest czipami,
       nie `<select>`-em — stąd `oknoAnalizy` zamiast `dniAnalizy`. Reguła
       została ta sama: w pasku stoi to, co rządzi całym widokiem. ZAKRES
       rządzi nim najdosłowniej ze wszystkiego — decyduje, które karty w ogóle
       są na ekranie. */
    ["analiza", analiza, ["oknoAnalizy", "zakresAnalizy", "osobaAnalizy", "csvAnalizy"]],
  ] as [string, string, string[]][]) {
    const pasek = widok.indexOf('class="pelna pasekFiltrow"');
    assert.notEqual(pasek, -1, `${nazwa} ma pasek filtrów`);
    /* Prefiks, nie pełny literał: od 0.96.0 karty analizy noszą obok `card`
       także `zakresPytania`/`zakresAudyt`, więc `<section class="card">`
       w tym widoku nie występuje już wcale — a `indexOf` zwracał wtedy -1
       i asercja przechodziła przez przypadek w drugą stronę. */
    assert.ok(pasek < widok.indexOf('<section class="card'),
      `pasek ${nazwa} stoi NAD kartami, nie w środku pierwszej`);
    const koniec = widok.indexOf("</section>", pasek);
    for (const pole of pola) {
      const gdzie = widok.indexOf(`id="${pole}"`);
      assert.ok(gdzie > pasek && gdzie < koniec,
        `${pole} rządzi całą zakładką ${nazwa}, więc mieszka w pasku`);
    }
  }

  const nadzor = wycinek('id="widokNadzor"', 'id="widokDziennik"');
  assert.ok(!nadzor.includes("pasekFiltrow"),
    "STAN SYSTEMU nie ma paska — nie ma filtra, który rządziłby całą zakładką");
  assert.ok(nadzor.includes('id="dniMetryk"'), "OKNO metryk zostaje przy metrykach");
});

test("kontekst zwrotu jest rodzeństwem sprawy, a delegacja stoi na sekcji", () => {
  /* Od 0.93.0 zakładka ZWROTY rozkłada się jak PYTANIA i DOSTAWY: kolejka,
     ocena pozycji, kontekst sprawy. Ten test pilnuje DWÓCH rzeczy, bo przy
     dostawach (0.92.0) obie dały się złamać po cichu.

     PIERWSZA: kontekst musi być RODZEŃSTWEM szczegółu, nie jego dzieckiem.
     Wsunięty do środka karty sprawy wygląda w kodzie tak samo, a na ekranie
     wraca pod tabelę pozycji — czyli dokładnie tam, skąd go zabraliśmy.

     DRUGA: delegacja kliknięć musi siedzieć NAD wszystkimi blokami. Do 0.97.0
     wisiała na samych blokach i to wystarczało, dopóki wędrowały bloki.
     W 0.98.0 wywędrował sam przycisk — „OCEŃ I ZLEĆ KOREKTĘ" przeszło ze
     sprawy do kontekstu i zostawiło nasłuch za sobą, czyli powtórzyło usterkę
     dostaw z 0.92.0. Nasłuch na SEKCJI przeżywa jedno i drugie. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const widok = html.slice(
    html.indexOf('id="widokZwroty"'),
    html.indexOf('id="widokPytania"')
  );
  const szczegol = widok.indexOf('id="zwrotSzczegol"');
  const kontekst = widok.indexOf('id="zwrotKontekst"');
  assert.ok(szczegol !== -1 && kontekst !== -1, "obie strefy istnieją");
  assert.ok(kontekst > widok.indexOf("</section>", szczegol),
    "kontekst stoi OBOK sprawy, nie w jej środku");
  assert.match(html, /#widokZwroty\.zSzczegolem \{ grid-template-columns:/,
    "trzy kolumny opisane jedną regułą");

  for (const blok of ["zwrotDokument", "zwrotKlient", "zwrotWiadomosci", "zwrotKosz", "zwrotRozliczenie"]) {
    assert.ok(widok.includes(`id="${blok}"`), `${blok} istnieje w zakładce`);
    assert.ok(widok.indexOf(`id="${blok}"`) > kontekst,
      `${blok} mieszka w kontekście, a nie w sprawie`);
  }
  assert.ok(html.includes('$("zwrotKontekst").addEventListener'),
    "kontekst deleguje z poziomu sekcji — przycisk może wędrować między blokami");
  assert.ok(html.includes('$("zwrotSzczegol").addEventListener'),
    "sprawa deleguje z poziomu sekcji");
});

test("objaśnienie karty ma ikonę, a ikona ma objaśnienie", () => {
  /* Ikona bez bloku obok siebie jest przyciskiem, który nic nie robi, a blok
     bez ikony jest tekstem, którego nie da się otworzyć. Delegacja szuka
     bloku jako NASTĘPNEGO rodzeństwa nagłówka, więc obie połówki muszą
     istnieć w równej liczbie — i w tej samej karcie. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const ikony = html.match(/class="info"/g) ?? [];
  const bloki = html.match(/class="objasnienie"/g) ?? [];
  assert.ok(ikony.length >= 15, `ikon objaśnień: ${ikony.length}`);
  assert.equal(ikony.length, bloki.length, "każda ikona ma swój blok");
  assert.match(
    html,
    /<\/h2>\s*<div class="objasnienie" hidden>/,
    "blok stoi bezpośrednio po nagłówku — inaczej delegacja go nie znajdzie"
  );
  assert.match(html, /h2 \.info/, "ikona ma własny styl");
});

test("statystyki pytań nie jadą po dane, gdy nikt na nie nie patrzy", () => {
  /* REGUŁA ZOSTAJE, MECHANIZM SIĘ ZMIENIŁ — i to jest cała treść tej zmiany.

     Do 0.95.0 statystyki były zwijaną sekcją na zakładce PYTANIA, a oszczędność
     polegała na tym, że zwinięta NIE jechała po dane przy każdym wejściu na
     zakładkę pracy. W 0.96.0 przeniosły się na ANALIZĘ, pod filtr ZAKRES:
     zakładki pracy zostają czystą kolejką spraw, zgodnie z podziałem, który
     pasek zakładek ogłasza od 0.74.1.

     Reguła obowiązuje dalej, tylko spełnia ją co innego. Wejście na PYTANIA
     nie tyka już statystyk wcale, a ANALIZA pobiera WYŁĄCZNIE wybrany zakres.
     Gdyby `odswiezAnalize` przestało rozgałęziać się na zakresie, każde wejście
     na ANALIZĘ ciągnęłoby komplet danych z każdego zakresu i nikt by tego nie
     zobaczył poza serwerem. W 0.99.0 doszedł trzeci zakres — zwroty — więc
     stawka tego rozgałęzienia urosła o trzy kolejne trasy. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );

  const wejscie = html.match(/if \(nowy === "pytania"\).*/)?.[0] ?? "";
  assert.ok(
    !wejscie.includes("Statystyk") && !wejscie.includes("statystyk"),
    "wejście na zakładkę pracy nie tyka statystyk — one mieszkają na ANALIZIE"
  );

  assert.match(html, /function odswiezAnalize\(\)[\s\S]*?zakresAnalizy\(\) === "pytania"[\s\S]*?return odswiezStatystykiPytan\(\)/,
    "ANALIZA pobiera tylko wybrany zakres, nie oba naraz");
  assert.match(html, /function odswiezAnalize\(\)[\s\S]*?zakresAnalizy\(\) === "zwroty"[\s\S]*?return odswiezAnalizeZwrotow\(\)/,
    "zakres zwrotów też ma własną gałąź, nie leci przy każdym wejściu");

  /* Klasa zakresu, nie CAŁY atrybut `class`: układ karty (`pelna`) to inna
     decyzja niż jej przynależność do zakresu i wolno ją zmieniać bez ruszania
     tego testu. Do 0.99.0 wzorzec obejmował oba i wywrócił się na dopisaniu
     jednego słowa, nie mówiąc nic o regule, której pilnuje. */
  for (const klasa of ["zakresPytania", "zakresAudyt", "zakresZwroty"]) {
    assert.match(html, new RegExp(`class="[^"]*\\b${klasa}\\b`),
      `karty zakresu ${klasa} znają swój zakres`);
  }
});

test("przesyłki klienta: sekcja na klik i szybki guzik statusu (0.105.0)", () => {
  /* „Kiedy dojdzie paczka" ma dwie drogi: automatyczną (blok w kontekście
     szkicu — testują services/pytania.test.ts) i ręczną — tę sekcję.
     Pilnujemy trzech rzeczy: dane jadą leniwie po otwarciu (do ~7 zapytań
     do Allegro nie ma prawa jechać z każdym otwarciem sprawy), wstawienie
     statusu to jawny przycisk, a strona nigdzie nie renderuje adresu
     dostawy — do odpowiedzi wystarczy status, kurier i numer. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /id="pytaniePrzesylki"/, "sekcja przesyłek w szufladzie kontekstu");
  assert.match(html, /PRZESYŁKI KLIENTA/, "nagłówek sekcji");
  assert.match(html, /pytania\/\$\{id\}\/przesylki/, "dane jadą osobną trasą na klik");
  assert.match(html, /addEventListener\("toggle", pokazPrzesylki\)/, "pobranie dopiero po otwarciu");
  assert.match(html, /data-wstaw-status/, "wstawienie statusu jest jawnym przyciskiem");
  assert.match(html, /jeszcze nie nadane/, "zamówienie bez paczki to stan, nie błąd");
});

test("parowanie Allegro nie wygląda jak robot (0.106.0)", () => {
  /* Endpoint parowania stoi na apeksie allegro.pl — tym samym hoście co
     sklep — więc to jedyne odpytywanie z tej strony, które widzi anti-bot
     Allegro. Blokada adresu IP w sierpniu 2026 przyszła dokładnie w trakcie
     parowania. Trzy rzeczy mają tu zostać: JEDNA pętla zamiast wielu (drugi
     klik POŁĄCZ nie startuje kolejnej), rytm dyktowany przez serwer zamiast
     sztywnych trzech sekund, i jawne wyjście z czekania. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /if \(parowanieTrwa\) return;/, "drugi klik nie startuje drugiej pętli");
  assert.match(html, /d\.nastepnyPollMs \?\? 5000/, "rytm odpytywania dyktuje serwer");
  assert.ok(
    !/setTimeout\(pollParowania,\s*3000\)/.test(html),
    "sztywne 3 s wróciły — to one zbudowały ślad maszyny"
  );
  assert.match(html, /id="allegroPrzerwij"/, "czekanie da się przerwać bez przeładowania strony");
  assert.match(html, /stronę blokady/, "panel mówi, co zrobić, gdy Allegro zablokuje adres");
});

test("pytania: oferta z wiadomości i szkic AI jako wybór biura (0.107.0)", () => {
  /* Dwie skargi z jednego dnia. Pierwsza: nagłówek sprawy pokazywał tytuł
     wątku, a klient pyta o KONKRETNĄ aukcję — ta jedzie w `relatedObject`
     wiadomości, nie w wątku. Druga: model pisał szkice do wszystkiego, co
     przyszło z synchronizacji, także do spraw, których nikt nie otworzy.
     Domyślnie ma milczeć, a biuro włącza go świadomie przełącznikiem. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /id="pytaniaAutoSzkic"/, "przełącznik automatycznego szkicu w karcie AI");
  assert.match(html, /pytania\/auto-szkic/, "przełącznik zapisuje się od razu, bez ZAPISZ");
  assert.match(html, /PYTANIE O TĘ AUKCJĘ/, "nagłówek sprawy nazywa aukcję z wiadomości");
  assert.match(html, /AUKCJA ZAKOŃCZONA/, "znikła oferta to stan do pokazania, nie pusty nagłówek");
});

test("sprawy: jedna kolejka czterech rejestrów, karta klienta drugim poziomem (0.108.0)", () => {
  /* Osią pracy jest SPRAWA, nie klient: kolejka odpowiada na „co mam teraz
     zrobić?" jedną listą pytań, zwrotów, dyskusji i reklamacji. Karta
     klienta (360) otwiera się klikiem w login — z kolejki albo z nagłówka
     otwartej sprawy. Wszystko tu wyłącznie CZYTA: liczniki POST/PUT/DELETE
     wyżej pilnują, że zakładka nie przemyciła żadnego zapisu. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /id="kolejkaSprawKarta"/, "kolejka spraw jest kartą sekcji");
  assert.match(html, /api\(`\/api\/biuro\/sprawy\$\{q\}`\)/, "kolejka czyta agregat przez api()");
  assert.match(html, /id="sprawyLicznik" class="tabLicznik"/, "pigułka na zakładce");
  assert.match(html, /\/api\/biuro\/sprawy\/licznik/, "pigułka ma własną tanią trasę");
  assert.match(html, /BEZ LOGINU/, "sprawy bez konta Allegro mają kubełek, nie nicość");
  assert.match(html, /data-klient360/, "login jest wejściem do karty klienta");
  assert.match(
    html,
    /\$\("kolejkaSprawKarta"\)\.addEventListener\("click"/,
    "kolejka deleguje z poziomu sekcji"
  );
  assert.match(
    html,
    /\$\("klientSzczegol"\)\.addEventListener\("click"/,
    "karta klienta deleguje z poziomu sekcji"
  );
  /* Powiązania: ciąg jednego problemu (zwrot → dyskusja → reklamacja) widać
     z kontekstu sprawy; pobierane leniwie, po otwarciu — jak historia. */
  assert.match(html, /POWIĄZANE SPRAWY/, "kontekst pokazuje ciąg jednej sprawy");
  assert.match(html, /addEventListener\("toggle", pokazPowiazanePytania\)/, "leniwie przy pytaniu");
  assert.match(html, /addEventListener\("toggle", pokazPowiazaneZwrotu\)/, "leniwie przy zwrocie");
  assert.match(html, /REKLAMACJE TEGO KLIENTA/, "historia klienta zna czwarty rejestr");
});
