import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Trasy biura po zniknięciu strony `/biuro` (0.446.0) ──────────────────
   Do 0.446.0 te testy stały w `biuro.test.ts` obok strażników struktury
   `biuro.html`. Strona zniknęła, a strażnicy struktury razem z nią — ich
   gwarancje przejęły testy ekranów panelu, każda nazwana w tamtym pliku
   w wydaniu, które przeniosło widok. Tu zostaje to, co dotyczy SERWERA:

   1. Stare adresy (`/`, `/biuro`, `/biuro/…`) prowadzą do panelu.
   2. DANE biura są za bramką sesji, a zapisy — za bramką roli.
   3. Build nie kopiuje katalogu, którego nie ma, i niesie panel.
   4. Strażnicy źródeł panelu, które przeszły tu z testów strony: podstawa
      prawna raportu per osoba, kolejność stanu systemu, parowanie Allegro. */

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

test("stare adresy biura prowadzą do panelu, tymczasowo", async () => {
  /* 302, nie 301: stałe przekierowanie przeglądarka zapamiętuje na zawsze.
     `/biuro/…` też — ikona i fonty mieszkały pod tym prefiksem, a historia
     przeglądarki podpowiada takie adresy jeszcze długo. */
  for (const url of ["/", "/biuro", "/biuro/", "/biuro/fonty/barlow_bold.ttf", "/biuro/ikona.webp"]) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 302, url);
    assert.equal(r.headers.location, "/obsluga/", url);
  }
});

test("strona biura nie wraca, a build nie kopiuje jej katalogu", () => {
  /* Blizna z 0.420.1: build kopiował do `dist/web` pliki wymienione z nazwy
     i jeden zapomniany plik położył usługę przy starcie. Od 0.446.0
     `src/web` nie istnieje wcale — `cpSync` na nim rzuciłby przy KAŻDYM
     buildzie, więc build go nie woła. Panel jedzie do `dist/web/obsluga`. */
  const web = path.resolve(import.meta.dirname, "../web");
  assert.ok(!fs.existsSync(path.join(web, "biuro.html")), "biuro.html wrócił");
  const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as
    { scripts: Record<string, string> };
  assert.doesNotMatch(pkg.scripts.build, /cpSync\('src\/web'/, "build kopiuje katalog, którego nie ma");
  assert.match(pkg.scripts.build, /cpSync\('\.\.\/panel\/dist','dist\/web\/obsluga'/, "build niesie panel");
  const trasy = fs.readFileSync(new URL("./biuro.ts", import.meta.url), "utf8");
  assert.doesNotMatch(trasy, /readFileSync/, "trasy biura nie czytają już plików przy starcie");
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
    // Archiwum dostaw (0.235.0) — historia z nazwiskami i adresami półek.
    "/api/biuro/dostawy/archiwum",
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
  /* Stan Allegro dla ikony w pasku (0.114.0). Publicznie wolno mu nieść
     TYLKO stan, środowisko i datę wygaśnięcia — nigdy login ani token. */
  assert.ok(typeof h.allegro?.stan === "string");
  assert.deepEqual(
    Object.keys(h.allegro).filter((k) => !["stan", "srodowisko", "wygasa"].includes(k)),
    [],
    "health jest bez sesji — pole allegro nie może przemycać niczego ponad stan"
  );
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


test("dostawa spoza okna importu daje się otworzyć z panelu (0.235.0)", async () => {
  /* Sedno całej zmiany po stronie trasy. Do 0.235.0 podgląd zaczynał się od
     read-modelu i kończył na 404 — a 404 wygląda w panelu identycznie jak
     dokument, którego nigdy nie było. */
  const DOK = 91_235;
  const d = db();
  const id = Number(
    d
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, status,
                              opened_at, closed_at, source_mag_id)
         VALUES (?,?,?,?, 'done', ?, ?, 1)`
      )
      .run(DOK, "FZ 91235/MAG/01/2026", "OGRÓD-POL", "2026-01-15",
           "2026-01-15T08:00:00.000Z", "2026-01-15T12:00:00.000Z").lastInsertRowid
  );
  d.prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok,
                               ilosc_odlozona, lok_faktyczna, status, done_at, done_by)
     VALUES (?, 4242, 'LS51-139', 'Gaźnik kompletny', 4, 4, 'A01-02-03', 'done', ?, 'Krzysiek')`
  ).run(id, "2026-01-15T10:00:00.000Z");

  const lista = await app.inject({
    method: "GET",
    url: "/api/biuro/dostawy/archiwum",
    ...jako("biuro"),
  });
  assert.equal(lista.statusCode, 200);
  const w = lista.json().documents.find((x: { dokId: number }) => x.dokId === DOK);
  assert.ok(w, "dostawa bez dokumentu w read-modelu jest w archiwum");
  assert.equal(w.nrPelny, "FZ 91235/MAG/01/2026");

  const szczegol = await app.inject({
    method: "GET",
    url: `/api/biuro/dokument/${DOK}`,
    ...jako("biuro"),
  });
  assert.equal(szczegol.statusCode, 200, "wejście w wiersz archiwum nie kończy się odmową");
  const p = szczegol.json();
  assert.equal(p.archiwalny, true, "panel wie, że to nasz zapis, a nie dzisiejsza faktura");
  assert.equal(p.lines[0].doneBy, "Krzysiek", "nazwisko odkładającego przeżyło okno importu");
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
     regresja prawna, nie kosmetyczna.

     Od 0.440.0 sekcja mieszka w analizie PANELU i test czyta tamto źródło.
     Gwarancja przeszła razem z widokiem, a nie została w pliku, z którego
     widok zniknął — zielony test nad pustym miejscem niczego by nie pilnował.
     Zachowanie (karta z podstawą dla admina, brak karty dla roli biuro)
     sprawdza `panel/src/ekrany/Analiza.test.tsx`. */
  const zrodlo = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src/analiza/ZakresHali.tsx"),
    "utf8"
  );
  assert.match(zrodlo, /Wydajność per osoba/, "sekcja imienna zniknęła z analizy");
  assert.match(zrodlo, /wydajnosc\.podstawaPrawna/, "analiza nie pokazuje podstawy prawnej monitoringu");
  assert.match(zrodlo, /nie są miarą błędu/, "zdanie o problemach jako nie-błędach musi zostać");
});


test("filtr stoi w pasku wtedy i tylko wtedy, gdy rządzi całą zakładką", () => {
  /* Od 0.94.0 reguła wglądu brzmi: PASEK NAD KARTAMI OBIECUJE, ŻE RZĄDZI
     CAŁYM WIDOKIEM. Dziennik i analiza (0.440.0) oraz stan systemu
     (0.441.0) przeszły do panelu i reguła przeszła z nimi — ten test
     czyta teraz ich źródła.

     Przy stanie systemu pasek byłby kłamstwem: kolejka zapisów, kolizje kodów
     i serwer mówią o TERAZ i żaden zakres dni ich nie rusza. Jedyne okno
     należy do tabeli wymiany i stoi w JEJ karcie. Wyniesienie go „dla
     spójności" byłoby regresją, która nie wygląda na regresję. */
  const panel = (plik: string) => fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src", plik), "utf8");
  assert.doesNotMatch(panel("ekrany/Stan.tsx"), /FiltrSegmentowy/,
    "stan systemu nie ma paska filtrów — nie ma filtra, który rządziłby całą zakładką");
  assert.match(panel("stan/Wymiana.tsx"), /akcje=\{<div role="group" aria-label="Okno tabeli wymiany"/,
    "okno tabeli wymiany stoi w nagłówku JEJ karty");
});


test("parowanie Allegro nie wygląda jak robot (0.106.0)", () => {
  /* Endpoint parowania stoi na apeksie allegro.pl — tym samym hoście co
     sklep — więc to jedyne odpytywanie, które widzi anti-bot Allegro.
     Blokada adresu IP w sierpniu 2026 przyszła dokładnie w trakcie parowania.

     Od 0.441.0 parowanie mieszka w panelu (`panel/src/stan/parowanie.ts`)
     i tam ZACHOWANIE sprawdza `ekrany/Stan.test.tsx`: jedna pętla, rytm
     serwera, PRZERWIJ bez żądania. Ten test pilnuje dwóch rzeczy, których
     test zachowania nie widzi: że biuro nie ma DRUGIEJ pętli, i że zdanie
     o stronie blokady przeszło razem z kartą. */
  const panel = (plik: string) => fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src", plik), "utf8");
  assert.match(panel("stan/parowanie.ts"), /d\.nastepnyPollMs \?\? 5000/, "rytm odpytywania dyktuje serwer");
  assert.match(panel("stan/parowanie.ts"), /if \(trwa\.current\) return;/, "drugi klik nie startuje drugiej pętli");
  assert.match(panel("stan/Allegro.tsx"), /stronę blokady/, "karta mówi, co zrobić, gdy Allegro zablokuje adres");
});


test("panel naprawia, nie tylko patrzy: kolejka, ratunek serwera, konta (0.111.0)", () => {
  /* Miejsce, w którym problem widać, musi być miejscem, w którym da się go
     naprawić. Kolejka błędów dostała PONÓW/ANULUJ, karta SERWER dwie operacje
     ratunkowe zza DEPLOY.md, a karta KONTA I SESJE kładzie kres
     administrowaniu kontami przez curl.

     Od 0.441.0 kolejka i serwer mieszkają w stanie systemu panelu — test
     czyta tamte źródła, a zachowanie (PONÓW bez pytania, ANULUJ za
     potwierdzeniem) sprawdza `ekrany/Stan.test.tsx`. Konta przeszły
     w 0.444.0 do ustawień panelu; ich zachowanie sprawdza
     `ekrany/Ustawienia.test.tsx`. */
  const stan = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/api/stan.ts"), "utf8");
  assert.match(stan, /\/api\/queue\/\$\{id\}\/\$\{ruch\}/, "błąd kolejki ponawia się i anuluje z panelu");
  assert.match(stan, /\/api\/admin\/resync/, "resync zszedł z DEPLOY.md na przycisk");
  assert.match(stan, /\/api\/admin\/zdjecia\/odswiez/, "odświeżenie zdjęć też");
  const konta = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/ustawienia/Konta.tsx"), "utf8");
  assert.match(konta, /useWylogujWszedzie/, "zgubiony kolektor ma swój przycisk");
  assert.match(konta, /useResetHasla/, "reset hasła zszedł z curl na przycisk");
  assert.match(konta, /type="password"/, "nowe hasło wpisuje się w pole maskowane, nie w prompt()");
  /* Dziennik przeszedł do panelu (0.440.0) razem z filtrem osoby. */
  const dziennik = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src/ekrany/Dziennik.tsx"), "utf8");
  assert.match(dziennik, /zmien\("userRef"/, "dziennik filtruje po osobie, nie tylko urządzeniu");
});


test("awaria najmłodszej tabeli nie wywraca dwóch starszych (0.364.0)", () => {
  /* Blizna z 0.361.0: `.catch` stał za `.json()`, a `api()` rzuca przy każdej
     odpowiedzi spoza 2xx — czyli PRZED `.json()`. Zabezpieczenie nie łapało
     niczego, co naprawdę pada, i 500 z najmłodszej trasy zabierało z ekranu
     metryki oraz kolizje kodów, bo trzy tabele czytał JEDEN `Promise.all`.

     Od 0.441.0 tabele stoją w panelu i każda ma WŁASNE zapytanie — awaria
     jednej nie ma jak dotknąć drugiej, bo nic ich nie łączy. Test pilnuje tej
     rozłączności w źródle, a w biurze — reguły łańcucha tam, gdzie zostały
     jeszcze odczyty z `.catch`. */
  const panel = (plik: string) => fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src", plik), "utf8");
  assert.doesNotMatch(panel("ekrany/Stan.tsx"), /Promise\.all/, "karty stanu nie czytają się jednym łańcuchem");
  assert.match(panel("stan/Wymiana.tsx"), /useWymiana\(dni\)/, "tabela wymiany ma własne zapytanie");
  assert.match(panel("stan/Kolizje.tsx"), /useKolizje\(\)/, "kolizje mają własne zapytanie");
});


test("STAN SYSTEMU zaczyna od tego, co czeka na biuro (0.427.0)", () => {
  /* Od 0.441.0 stan systemu stoi w panelu (`ekrany/Stan.tsx`) i test czyta
     tamtą kolejność kart. Najpierw rzeczy, które czekają na ruch biura, potem
     rzeczy do czytania. Powód każdego przestawienia stoi w komentarzu ekranu. */
  const stan = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/ekrany/Stan.tsx"), "utf8");
  const karty = stan.slice(stan.indexOf("return <div"));
  const poz = (znacznik: string) => {
    const i = karty.indexOf(`<${znacznik}`);
    assert.ok(i >= 0, `${znacznik} jest w STANIE SYSTEMU`);
    return i;
  };
  assert.ok(poz("KartaKolejki") < poz("KartaArkusza"), "arkusz tuż pod kolejką — ta kolejka wykonuje jego skutek");
  assert.ok(poz("KartaArkusza") < poz("KartaKolizji"), "kolizje po arkuszu");
  assert.ok(poz("KartaKolizji") < poz("KartaRekoncyliacji"), "decyzja o kolizji przed sprawdzeniem na żądanie");
  assert.ok(poz("KartaRekoncyliacji") < poz("KartaWymiany"), "czytana tabela wymiany po kartach z przyciskiem");
  assert.ok(poz("KartaWymiany") < poz("StanIntegracji") && poz("StanIntegracji") < poz("KartaSerwera"),
    "tło integracji i serwer na końcu");
});


test("żaden komunikat nie odsyła do zakładki, której nie ma", () => {
  /* Komunikaty serwera mówią człowiekowi, dokąd iść: „/obsluga → STAN
     SYSTEMU → …". Pierwszy człon wielkimi literami musi być zakładką, która
     jest — nazwy stoją w `panel/src/main.tsx` jako `etykieta`, w obu rzędach
     nagłówka. Małe litery („/obsluga → zębatka") opisują drogę, nie zakładkę.

     Od 0.446.0 stron biura nie ma, więc komunikat „/biuro → …" nie ma
     prawa się pojawić wcale: prowadziłby do przekierowania na DO DECYZJI,
     a nie tam, gdzie obiecuje. `sonda-run.ts` przez dwanaście wydań kazał
     iść do zakładki, która zniknęła — stąd ten test. */
  const pliki: string[] = [];
  const zbierz = (dir: string): void => {
    for (const w of fs.readdirSync(dir, { withFileTypes: true })) {
      const pelna = path.join(dir, w.name);
      if (w.isDirectory()) zbierz(pelna);
      else if (w.name.endsWith(".ts") && !w.name.endsWith(".test.ts")) pliki.push(pelna);
    }
  };
  zbierz(path.resolve(import.meta.dirname, ".."));
  const rama = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/main.tsx"), "utf8");
  const wPanelu = new Set([...rama.matchAll(/etykieta: "([^"]+)"/g)].map((m) => m[1].toUpperCase()));

  let znalezione = 0;
  for (const plik of pliki) {
    const tekst = fs.readFileSync(plik, "utf8");
    for (const m of tekst.matchAll(/\/biuro\s*→/g)) {
      assert.fail(`${path.basename(plik)} odsyła do „${m[0]}", a strony biura już nie ma`);
    }
    for (const m of tekst.matchAll(/\/obsluga\s*→\s*([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ ]*)/g)) {
      znalezione++;
      const cel = m[1].trim();
      assert.ok(wPanelu.has(cel),
        `${path.basename(plik)} odsyła do „${cel}", a nagłówek panelu zna: ${[...wPanelu].join(", ")}`);
    }
  }
  assert.ok(znalezione >= 3, "wzorzec przestał cokolwiek znajdować — test pilnowałby pustki");
});
