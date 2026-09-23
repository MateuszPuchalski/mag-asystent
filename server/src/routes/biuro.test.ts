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

test("formularze dostawców przeszły do panelu razem z dostawami (0.435.0)", () => {
  /* GEKO i PARTNER mają własne druki reklamacyjne — wydruk ma wyglądać jak
     ich formularz, nie jak nasz protokół. Do 0.435.0 szablony siedziały
     tutaj; przeszły do panelu z ekranem dostaw, a ich treść pilnuje
     `panel/src/druk/szablony.test.ts`. Tu zostają dwie rzeczy: szablonów
     nie ma w dwóch miejscach naraz, a dane firmy mają JEDNO źródło.

     Od 0.444.0 tym źródłem jest serwer (`/api/biuro/firma`). Formularz
     w tej stronie zniknął; druk czyta serwer, a klucz przeglądarki zostaje
     w panelu wyłącznie jako zapas na dzień wdrożenia — zachowanie sprawdza
     `panel/src/druk/firma.test.tsx`. */
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  const druk = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src/druk/szablony.ts"), "utf8");
  const firma = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src/druk/firma.ts"), "utf8");
  assert.doesNotMatch(html, /SZABLONY_DOSTAWCOW/, "drugi egzemplarz szablonów rozjechałby się z pierwszym");
  assert.match(druk, /Protokół zgłoszenia reklamacji B2B/, "szablon GEKO w panelu");
  assert.match(druk, /PROTOKÓŁ ZGŁOSZENIA REKLAMACJI/, "szablon PARTNER w panelu");
  assert.doesNotMatch(html, /wertis\.firma/, "formularz danych firmy przeszedł do panelu (0.444.0)");
  assert.match(firma, /useFirma\(\)/, "druk czyta dane firmy z serwera");
  assert.match(firma, /f\.data\?\.zmieniono/, "zapas z przeglądarki działa tylko przy pustym serwerze");
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
    1,
    "Licznik SPADŁ z 4 do 1 w 0.444.0: ustawienia przeszły do panelu, a z nimi " +
      "trzy mutacje kont admina — reset hasła, włącz/wyłącz, wyloguj wszędzie. Te " +
      "same trasy woła `panel/src/api/ustawienia.ts`, a zero zapisu przy patrzeniu " +
      "pilnuje `ekrany/Ustawienia.test.tsx`. Zostało jedno: logowanie.\n\n" +
      "Licznik SPADŁ z 10 do 4 w 0.441.0: STAN SYSTEMU przeszedł do panelu, " +
      "a z nim sześć zapisów — PONÓW/ANULUJ kolejki Sfery, decyzja o kolizji " +
      "kodu, RESYNC, odświeżenie zdjęć, parowanie Allegro i masowa zmiana " +
      "lokalizacji z arkusza. Te same trasy woła `panel/src/api/stan.ts`, a zero " +
      "zapisu przy patrzeniu pilnuje `ekrany/Stan.test.tsx`. Zostały: " +
      "logowanie i trzy mutacje kont admina w ustawieniach.\n\n" +
      "Licznik SPADŁ z 11 do 10 w 0.440.0: ANALIZA przeszła do panelu, a z nią " +
      "import zbiórek strefy złotej. Ta sama trasa, to samo `{ csv }` — woła ją " +
      "teraz `analiza/Strefa.tsx`, a jedyność tego zapisu przy patrzeniu " +
      "pilnuje `ekrany/Analiza.test.tsx`. DZIENNIK nie zapisywał niczego, więc " +
      "przeprowadzka nie zmieniła tu nic więcej.\n\n" +
      "Licznik SPADŁ z 13 do 11 w 0.438.0: kosze przeszły do panelu, do " +
      "zakładki Zwroty, a z nimi dwa zapisy — załatwienie pominiętej pozycji " +
      "i PRZELICZ ZE ZWROTÓW. Zero zapisu przy patrzeniu pilnuje tam " +
      "`ekrany/Kosze.test.tsx`.\n\n" +
      "Licznik SPADŁ z 18 do 13 w 0.435.0 i to jest cały ślad przeprowadzki " +
      "dostaw do panelu w tym teście. Odeszło pięć zapisów razem z widokiem: " +
      "zamknięcie dostawy poza WERTIS, cofnięcie zamknięcia, notatka do " +
      "dostawy, odczyt odpowiedzi na notatkę i zamknięcie wyjątku. Te same " +
      "trasy woła teraz panel, a zero zapisu przy patrzeniu pilnuje tam " +
      "`ekrany/Dostawy.test.tsx` — po zachowaniu, nie po źródle.\n\n" +
      "Po kasacji obsługi klienta (0.140.0) zostały zapisy MAGAZYNU i ADMINA:\n" +
      "logowanie, import zbiórek, parowanie konta " +
      "Allegro, PONÓW/ANULUJ kolejki Sfery (jedno wywołanie o dwóch trasach) " +
      "oraz trzy mutacje kont admina (reset hasła, włącz/wyłącz, wyloguj " +
      "wszędzie), RESYNC z odświeżeniem zdjęć w karcie SERWER i masowa " +
      "zmiana lokalizacji z arkusza.\n\n" +
      "Licznik SPADŁ z 47 do 16 — i to jest cały ślad tego wydania w tym " +
      "teście. Zapisy obsługi klienta (skan zwrotu, decyzje, dokumenty, " +
      "kosze, reklamacje, pytania, dyskusje, opinie, tagi, reguły, szablony) " +
      "odeszły razem z ekranami, które je wywoływały.\n\n" +
      "Zapis szesnasty przyszedł z 0.138.0 i ZOSTAJE: masowa zmiana " +
      "lokalizacji to jedno wywołanie, nie dwa, choć czynności są dwie. " +
      "Ta sama trasa liczy podgląd (`zastosuj` pominięte) i wykonuje zapis " +
      "(`zastosuj: true`), więc nie da się zastosować czegoś innego, niż " +
      "się widziało na ekranie. Patrzenie nadal nic nie zapisuje — pilnuje " +
      "tego `routes/lokalizacje-masowe.test.ts`.\n\n" +
      "Zapis siedemnasty przyszedł z 0.334.0: PRZELICZ ZE ZWROTÓW w podglądzie " +
      "kosza. Kosz zamknięty przed 0.328.0 niesie zestaw jako jedną pozycję, " +
      "a MM z takiej pozycji nie powstanie — składniki leżą na magazynie " +
      "osobno. Przycisk stoi WYŁĄCZNIE przy koszu bez dokumentu i wymaga " +
      "kliknięcia; wejście na ekran nadal nic nie przelicza.\n\n" +
      "Zapis osiemnasty przyszedł z 0.360.0: DECYZJA O KOLIZJI KODU. " +
      "`ean_conflict` był do 0.358.0 dziennikiem bez wyjścia — kolizja " +
      "wpadała na listę i zostawała tam na zawsze w tej samej postaci co " +
      "pierwszego dnia. Obie strony patrzyły na TĘ SAMĄ listę (biuro tutaj, " +
      "hala na ekranie wyjątków kolektora) i żadna nie mogła drugiej nic " +
      "powiedzieć. Zapis wymaga kliknięcia POPRAWIONE albo DOPUSZCZONE oraz " +
      "przejścia przez dialog — samo otwarcie karty nadzoru nadal nie " +
      "zapisuje niczego, a odczyt kolizji jest i zostaje GET-em.\n\n" +
      "Reguła się NIE zmienia: liczba rośnie wyłącznie ŚWIADOMIE, a żaden " +
      "zapis nie dzieje się przy samym patrzeniu na ekran."
  );
  assert.equal(
    (html.match(/method:\s*"PUT"/g) ?? []).length,
    0,
    "PUT zszedł do zera w 0.444.0: komplet reguł strefy złotej i wgranie logo " +
      "dostawcy przeszły z ustawieniami do panelu. Do nich doszedł trzeci PUT, " +
      "danych firmy — wcześniej zapisywanych w przeglądarce, bez serwera."
  );
  assert.equal(
    (html.match(/method:\s*"DELETE"/g) ?? []).length,
    0,
    "DELETE zszedł do zera w 0.444.0: skasowanie logo dostawcy przeszło " +
      "z ustawieniami do panelu. Rozłączenie konta Allegro odeszło w 0.441.0."
  );
  /* Jedna strona, jeden <script> — więc dwie funkcje o tej samej nazwie nie
     są kolizją teoretyczną, tylko cichym przesłonięciem. Tak zniknęła lista
     wyjątków dostawy: `rysujReklamacje` istniało w dwóch egzemplarzach, bo
     zwroty dostały własną listę reklamacji o tej samej nazwie (0.59.0). */
  const nazwy = [...html.matchAll(/^function\s+([\w$]+)\s*\(/gm)].map((m) => m[1]);
  const zdublowane = nazwy.filter((n, i) => nazwy.indexOf(n) !== i);
  assert.deepEqual(zdublowane, [], "funkcje o tej samej nazwie przesłaniają się nawzajem");

  assert.ok(!/documents\/[^"'`]*\/open/.test(html), "strona otwiera dostawę");
  /* Zapisy dostaw są w panelu, nie w dwóch miejscach naraz (0.435.0). */
  assert.doesNotMatch(html, /dokument\/\$\{dokId\}\/(zamknij|otworz|notatka)/,
    "zapisy dostaw przeszły do panelu");
  /* Import zbiórek przeszedł z ANALIZĄ do panelu (0.440.0). */
  assert.doesNotMatch(html, /zbiorki\/import/, "import zbiórek przeszedł do panelu");
  /* Konwersja formatów MUSI zostać po stronie przeglądarki: serwer przyjmuje
     wyłącznie PNG, a loga przychodzą też jako SVG i WebP. Bez `<canvas>`
     panel odsyłałby plik w oryginale i połowa wgrań kończyłaby się odmową.
     Od 0.444.0 robi to panel (`lib/logo.ts`, rachunek w `logo.test.ts`). */
  assert.doesNotMatch(html, /dostawcy\/\$\{khId\}\/logo/, "logo dostawcy przeszło do panelu");
  const logo = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/lib/logo.ts"), "utf8");
  assert.match(logo, /toDataURL\("image\/png"\)/, "normalizacja logo do PNG");
  assert.doesNotMatch(html, /problems\/\$\{id\}\/resolve/, "wyjątek zamyka się w panelu, przy fakturze");
  assert.doesNotMatch(html, /pominiete\/\$\{[^}]+\}\/zalatwione/, "pominięcia zamyka się w panelu, przy koszu");
  /* Po 0.140.0 panel NIE MA ani jednej drogi do klienta i to jest teraz
     przedmiotem strażnika: żadnej wysyłki, żadnego szkicu, żadnego pola
     odpowiedzi. Nowa obsługa klienta przyniesie je razem z własnym testem
     i własnym uzasadnieniem przy liczniku wyżej. */
  assert.ok(!/api\/biuro\/(pytania|dyskusje)[^"'`]*wyslij/.test(html),
    "panel nie ma ani jednej trasy wysyłki do klienta");
  assert.ok(!/WYŚLIJ PRZEZ ALLEGRO/.test(html), "przycisku wysyłki nie ma");
});

/**
 * Kod panelu bez komentarzy i bez tekstu dla człowieka.
 *
 * Przejście znak po znaku, a nie łańcuch podstawień: proza po polsku niesie
 * apostrofy i odwrotne apostrofy (`nazwaFunkcji`), a adresy w napisach niosą
 * `//`. Każde podstawienie z osobna myliło jedno z drugim i zostawiało ogonki
 * słów wyglądające jak wywołania. Wnętrza `${…}` w szablonach ZOSTAJĄ — tam
 * siedzą prawdziwe wywołania.
 */
function kodPanelu(html: string): string {
  return bezTekstu(html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>")));
}

function bezTekstu(src: string): string {
  let out = "";
  let i = 0;
  /* Ukośnik zaczyna wyrażenie regularne albo dzielenie — rozstrzyga ostatni
     znaczący znak przed nim. Ta sama heurystyka, co w każdym podświetlaczu. */
  const poOperatorze = () => {
    const t = out.trimEnd();
    return t === "" || "(,=:[!&|?{};+-*%<>~^".includes(t[t.length - 1]) || /\breturn$|\btypeof$/.test(t);
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i = src.indexOf("*/", i + 2);
      i = i === -1 ? src.length : i + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
      continue;
    }
    if (c === "`") {
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") {
          /* Wnętrze `${…}` bywa zagnieżdżone (szablon w szablonie), więc
             liczymy klamry zamiast szukać pierwszej zamykającej. */
          let glebokosc = 1;
          i += 2;
          const od = i;
          while (i < src.length && glebokosc > 0) {
            if (src[i] === "{") glebokosc++;
            if (src[i] === "}") glebokosc--;
            i++;
          }
          /* Rekurencja, bo szablon bywa zagnieżdżony w szablonie: bez niej
             wnętrze wracało surowe i proza z tego drugiego wyglądała jak kod. */
          out += bezTekstu(src.slice(od, i - 1)) + ";";
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === "/" && poOperatorze()) {
      i++;
      let wKlasie = false;
      while (i < src.length && (wKlasie || src[i] !== "/")) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") wKlasie = true;
        if (src[i] === "]") wKlasie = false;
        i++;
      }
      i++;
      while (i < src.length && /[a-z]/.test(src[i])) i++;   // flagi
      out += "0";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* Druga strona tej samej monety co test dubli: funkcja WOŁANA, ale nigdzie
   nie zdefiniowana. Przeglądarka mówi o tym dopiero przy kliknięciu, i tylko
   w konsoli — a `rysujDostawy` wołające skasowany `wiekPytania` przestało
   rysować CAŁĄ tabelę dostaw w ciszy (0.140.0, złapane dopiero w Playwrighcie).

   Skanowanie idzie po tekście, bo panel nie ma parsera i mieć nie będzie.
   Żeby nie zgadywać, wycinamy najpierw komentarze i literały tekstowe —
   proza po polsku niesie nawiasy i wyglądałaby jak wywołanie. Bierzemy tylko
   wywołania BEZ kropki przed nazwą: metody obiektów wbudowanych i DOM-u nie
   są naszymi funkcjami i nie mamy skąd znać ich listy. */
test("panel nie woła funkcji, której nie ma", () => {
  const html = fs.readFileSync(
    path.join(import.meta.dirname, "..", "web", "biuro.html"),
    "utf8"
  );
  const js = kodPanelu(html);

  const zdefiniowane = new Set<string>();
  for (const re of [
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
  ]) {
    for (const m of js.matchAll(re)) zdefiniowane.add(m[1]);
  }
  // parametry funkcji i strzałek — też są nazwami wołalnymi (callbacki)
  for (const m of js.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const p of m[1].split(",")) {
      const nazwa = p.trim().split("=")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nazwa)) zdefiniowane.add(nazwa);
    }
  }

  /* Globalne przeglądarki i słowa kluczowe, po których stoi nawias. Lista
     jest krótka świadomie: rośnie tylko wtedy, gdy panel naprawdę sięgnie po
     coś nowego z platformy, i wtedy ma to być widoczne w diffie. */
  const platforma = new Set(
    ("if for while switch catch return typeof function new delete void await do else " +
      "async " +
      "setTimeout setInterval clearTimeout clearInterval fetch alert confirm prompt " +
      "encodeURIComponent decodeURIComponent parseInt parseFloat isNaN Number String " +
      "Boolean Array Object JSON Math Date Promise Map Set URL URLSearchParams Blob " +
      "FormData Error RegExp requestAnimationFrame matchMedia getComputedStyle " +
      "structuredClone AbortController Image FileReader Option " +
      // rozbieranie arkusza .xlsx w przeglądarce (0.138.0)
      "DecompressionStream DOMParser Response Uint8Array DataView TextDecoder").split(" ")
  );

  const brakujace = [
    ...new Set([...js.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])),
  ]
    .filter((n) => !zdefiniowane.has(n) && !platforma.has(n))
    .sort();

  assert.deepEqual(
    brakujace,
    [],
    "panel woła funkcje, których nie ma — przy kasowaniu ekranu zabrano " +
      "pomocnika, z którego korzystał ktoś jeszcze"
  );

});

test("strona nie sięga po element, którego nie ma (0.440.0)", () => {
  /* Przeprowadzka DZIENNIKA i ANALIZY zostawiła w `pokaz()` dwie linie
     `$("widokDziennik").hidden = …`. Test wywołań milczał, bo to nie jest
     wywołanie funkcji, tylko sięgnięcie po element — `$()` oddaje `null`,
     a przypisanie do `null.hidden` wywraca start strony. Biuro wstawało
     puste i dopiero przeglądarka to pokazała. Każde następne wydanie
     przeprowadzki kasuje kolejne elementy, więc ta sama pomyłka czeka
     w każdym z nich.

     Identyfikator liczy się jako istniejący także wtedy, gdy stoi w napisie
     HTML składanym przez skrypt (`innerHTML`) — tak powstają przyciski
     parowania i arkusza. Wystarczy, że `id="…"` jest gdziekolwiek w pliku. */
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  const skrypt = html.slice(html.lastIndexOf("<script>"));
  const szukane = new Set([...skrypt.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]));
  const brak = [...szukane].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(brak, [], "skrypt sięga po elementy, których strona już nie ma");
});

test("panel wstaje z zapamiętanego tokenu i sam napędza cykl", () => {
  /* Strażnik odwrotnej strony niż test wyżej. Tamten pilnuje funkcji WOŁANEJ,
     a nieistniejącej; ta blizna była lustrzana — funkcja istniała, a wywołanie
     zniknęło. 0.138.0 skasowało obsługę klienta razem z ogonem pliku, w którym
     stał rozruch strony, i nikt tego nie zauważył przez trzydzieści kilka wydań.

     Objaw pierwszy: każde odświeżenie wyglądało na wylogowanie. Token leżał
     ważny w localStorage, ale panel odsłania `start()`, a `start()` wołało
     wyłącznie logowanie. Objaw drugi: cykl 30 s nie chodził w ogóle, więc
     lista dostaw i ikona zdrowia stały do ręcznego kliknięcia.

     Dlatego sprawdzamy WYWOŁANIA, nie definicje: obie funkcje były na miejscu
     przez cały ten czas. */
  const html = fs.readFileSync(
    path.join(import.meta.dirname, "..", "web", "biuro.html"),
    "utf8"
  );
  const js = kodPanelu(html);

  assert.match(js, /if\s*\(\s*token\s*\)\s*start\(\)/,
    "panel nie wstaje z zapamiętanego tokenu — po odświeżeniu człowiek widzi " +
    "formularz logowania nad wciąż ważną sesją");
  assert.match(js, /setInterval\([\s\S]{0,120}?odswiez\(\)/,
    "nic nie napędza cyklu 30 s — `odswiez` bez wołającego znaczy listę dostaw " +
    "i ikonę zdrowia stojące do ręcznego kliknięcia");
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
    [],
    "Od 0.441.0 pasek nie niesie ANI JEDNEJ zakładki tej strony — STAN " +
      "SYSTEMU poszedł ostatni. Każda pozycja to wyjście do panelu (`data-panel`), " +
      "a ustawienia za zębatką przeszły do panelu w 0.444.0. " +
      "Od 0.440.0 ANALIZA i DZIENNIK prowadzą do panelu. " +
      "Od 0.435.0 DOSTAWY, a od 0.438.0 MAGAZYN ZWROTÓW nie są już zakładkami " +
      "tej strony — prowadzą do panelu (`data-panel`), sprawdzane niżej. " +
      "Pasek boczny po 0.140.0: SPRAWY i REJESTRY odeszły razem z obsługą " +
      "klienta, zostaje praca magazynu i wgląd. REJESTRY nie mogą wrócić " +
      "pustą zakładką — konto Allegro mieszka w STANIE SYSTEMU. " +
      "Dostawcy dalej za zębatką — konfiguracja to nie praca"
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

  /* Wyjście do przeniesionego widoku stoi W GRUPIE, jak zakładka: ręka szuka
     DOSTAW tam, gdzie były. Sierota poza grupą byłaby tu tą samą usterką. */
  const praca = nav.match(/<div class="grupa-btny">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(praca, /data-panel="\/obsluga\/dostawy"/, "DOSTAWY prowadzą do panelu z grupy Praca");
  assert.match(praca, /data-panel="\/obsluga\/zwroty\/kosze"/, "KOSZE prowadzą do zakładki Zwroty w panelu");
  const wglad = [...nav.matchAll(/<div class="grupa-btny">([\s\S]*?)<\/div>/g)][1]?.[1] ?? "";
  assert.match(wglad, /data-panel="\/obsluga\/analiza"/, "ANALIZA prowadzi do panelu z grupy Wgląd (0.440.0)");
  assert.match(wglad, /data-panel="\/obsluga\/dziennik"/, "DZIENNIK prowadzi do panelu z grupy Wgląd (0.440.0)");
  assert.match(wglad, /data-panel="\/obsluga\/stan"/, "STAN SYSTEMU prowadzi do panelu z grupy Wgląd (0.441.0)");

  assert.equal(
    (nav.match(/class="grupa-nazwa"/g) ?? []).length,
    2,
    "dwie grupy (Praca, Wgląd), każda podpisana — Archiwum odeszło w 0.140.0 " +
      "razem z rejestrami obsługi klienta"
  );

  /* Zębatka zostaje tam, gdzie ręka jej szuka, ale od 0.444.0 jest
     wyjściem do ustawień PANELU, jak pozycje paska — ustawienia były
     ostatnim widokiem tej strony. */
  const zebatki = [...html.matchAll(/<button id="ustawienia"[\s\S]*?>/g)];
  assert.equal(zebatki.length, 1, "jedna zębatka w nagłówku");
  assert.match(zebatki[0][0], /data-panel="\/obsluga\/ustawienia"/, "zębatka prowadzi do ustawień panelu");
  assert.match(zebatki[0][0], /aria-label="Ustawienia"/, "ikona bez napisu musi mieć nazwę");
  assert.doesNotMatch(html, /data-widok=/, "strona nie ma już ani jednej zakładki własnej");

  /* Delegacja kliknięcia MUSI stać poza `nav` — zębatka jest w nagłówku,
     a przy dawnym `nav.zakladki` byłaby klikalna i bez skutku. */
  assert.doesNotMatch(
    html,
    /querySelector\("nav\.zakladki"\)\.addEventListener/,
    "obsługa kliknięcia nie może być przypięta do samego paska"
  );
});

test("zakładki mieszkają w pasku bocznym i same pilnują swojej widoczności", () => {
  /* Historia domu: karta pod nagłówkiem (0.74.1) → ciemny nagłówek (0.95.0)
     → pion po lewej (0.125.0). Za każdym razem chodziło o to samo: chrom nad
     treścią kosztuje na KAŻDEJ zakładce. Pion oddał treści ostatnie 52 px —
     nad nią nie stoi już nic.

     Haczyk z 0.95.0 obowiązuje dalej: pasek stoi POZA `#panel`, więc samo
     schowanie panelu go nie zdejmuje. Bez własnego `hidden` w znaczniku
     i bez odsłonięcia w `start()` pozycje świeciłyby nad formularzem
     logowania — klikalne, prowadzące do pustych widoków. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const otwarcie = html.match(/<nav class="zakladki"[^>]*>/);
  assert.ok(otwarcie, "pasek zakładek istnieje");
  assert.ok(html.includes('<aside id="bok">'), "pasek boczny istnieje");
  assert.ok(html.indexOf('<aside id="bok">') < otwarcie.index!
    && otwarcie.index! < html.indexOf("</aside>"),
    "zakładki stoją w pasku bocznym — po to pojechały w pion");
  /* Nagłówka i paska stanu nie ma W OGÓLE — jedno pasmo chromu skurczyło się
     do zera pasm. Odtworzenie któregokolwiek to cofnięcie tej przeprowadzki. */
  assert.ok(!/<header[\s>]/.test(html), "nagłówek nie wrócił nad treść");
  assert.ok(!html.includes('id="chrome"'),
    "pasek stanu nie wrócił jako drugie pasmo chromu");
  assert.match(otwarcie[0], /\bhidden\b/,
    "pasek startuje schowany — `#panel` go nie zasłania");

  for (const [co, po] of [["hidden = false", "zalogowaniu"], ["hidden = true", "wylogowaniu"]]) {
    assert.ok(html.includes(`zakladki().${co}`),
      `pasek zmienia widoczność po ${po}`);
  }

  /* Wysokość chromu nad treścią jest odtąd STAŁĄ, nie pomiarem — skrypt
     mierzący nagłówek zszedł razem z nim, a zmienną czyta kilkanaście reguł
     konsoli. Pomiar `offsetHeight` nieistniejącego elementu wywaliłby cały
     skrypt przy starcie. */
  assert.match(html, /--hChrome: 0px;/, "chrom nad treścią = zero, jako stała");
  assert.ok(!html.includes("mierzChrome"), "po pomiarach nie ma śladu");
});

test("nagłówek niesie licznik odpowiedzi na notatki", () => {
  /* Nagłówek widać z KAŻDEJ zakładki i to jest cały sens tego sygnału: do 0.57.0
     odpowiedź widać było wyłącznie po wejściu w tę konkretną dostawę, a biuro
     nie miało powodu tam wracać. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /odpowiedziNaNotatki\.length/, "nagłówek czyta licznik");
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

test("licznik odpowiedzi prowadzi do dostaw w panelu, z sesją (0.435.0)", () => {
  /* Zgłoszenie z 20 sierpnia: „mam na górze zaznaczone odpowiedź na notatkę,
     ale nie wiem gdzie ta odpowiedź jest". Sygnał bez drogi do treści jest
     sygnałem zgubionym. Od 0.435.0 treść mieszka w panelu, więc droga
     prowadzi tam — i niesie token, bo inaczej kończyłaby się logowaniem. */
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  assert.match(html, /data-panel="\/obsluga\/dostawy"`?\s*\n?\s*title="\$\{n\}/,
    "plakietka odpowiedzi prowadzi do dostaw w panelu");
  assert.match(html, /closest\("\[data-panel\]"\)/, "jedna delegacja dla wszystkich wyjść do panelu");
  assert.match(html, /localStorage\.setItem\("wertis-panel-token", token\)/,
    "wyjście do panelu podaje mu sesję tej strony");
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

  /* Wywołania bez ciała odeszły do panelu jedno po drugim: przywrócenie
     dostawy (0.435.0), przeliczenie kosza (0.438.0), rozłączenie Allegro
     (0.441.0), a w 0.444.0 skasowanie logo i WYLOGUJ WSZĘDZIE. Panel ma
     własnego strażnika tej reguły (`panel/src/api/klient.test.ts`), a oba
     ostatnie wywołania sprawdza po zachowaniu `ekrany/Ustawienia.test.tsx`.
     Tutaj reguła zostaje, bo `api()` zostaje — cykl paska jeździ przez nie. */
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
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  assert.doesNotMatch(html, /WYDAJNOŚĆ PER OSOBA/,
    "raport per osoba wrócił do biura — dwa miejsca to dwie podstawy prawne do pilnowania");
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

test("kosze odeszły do panelu razem ze swoimi strażnikami (0.438.0)", () => {
  /* MAGAZYN ZWROTÓW przeszedł do zakładki Zwroty w panelu, decyzją
     właściciela. Test, który stał tutaj, pilnował, że podgląd kosza czyta
     JEDNO źródło prawdy o zawartości (`/api/biuro/kosze/:id`) — tę gwarancję
     przejął `panel/src/ekrany/Kosze.test.tsx` razem z wiązaniem kosz ↔ zwrot
     w obie strony. Tu zostaje pilnowanie, że stara maszyneria nie została
     w pliku półżywa. */
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  for (const slad of ['id="widokMagazyn"', 'id="koszeLista"', 'id="pominieteKarta"', 'id="koszSzukaj"',
    "function rysujKosze", "function pokazPodgladKosza", "magazynKropka", "function zakolejkuj"]) {
    assert.ok(!html.includes(slad), `ślad po koszach: ${slad}`);
  }
  assert.ok(fs.existsSync(path.resolve(import.meta.dirname, "../../../panel/src/ekrany/Kosze.test.tsx")),
    "strażnik koszy w panelu");
});

test("ustawienia przeszły do panelu razem ze swoimi strażnikami (0.444.0)", () => {
  /* Ostatni widok tej strony. Stały tu trzy testy ustawień: położenie
     konfiguracji za zębatką, arkusz bez zaokrągleń i ikony objaśnień.
     Gwarancje zmieniły adres, jak każe `CLAUDE.md`:

       konfiguracja za zębatką, nie na pracy  → ten test, po źródle panelu
       zero zapisu przy otwarciu, role kont,
       przeniesienie danych firmy przyciskiem → `panel/src/ekrany/Ustawienia.test.tsx`
       normalizacja logo do PNG               → `panel/src/lib/logo.test.ts`
       dane firmy na serwerze                 → `routes/firma.test.ts`

     Arkusz bez zaokrągleń i ikony „i" odeszły bez następcy: panel ma jeden
     kształt karty (`KartaWgladu`) ze zdaniem pod nagłówkiem, jawnie. */
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  for (const slad of ['id="widokDostawcy"', 'id="kontaKarta"', 'id="reguly"', 'id="firmaNazwa"',
    'id="plikLogo"', 'id="dialogW"', 'id="toasty"', 'class="info"', 'class="objasnienie"',
    "function naPng", "function pokaz(", "function toast", "wertis.widok"]) {
    assert.ok(!html.includes(slad), `ślad po ustawieniach: ${slad}`);
  }
  const panel = (plik: string) => fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src", plik), "utf8");
  const ekran = panel("ekrany/Ustawienia.tsx");
  for (const karta of ["<DaneFirmy", "<RegulyStrefy", "<Konta", "<SlownikTagow", "<LogoDostawcow"]) {
    assert.ok(ekran.includes(karta), `${karta} stoi w ustawieniach panelu`);
  }
  /* Analiza prowadzi do reguł strefy — już nie mostem do tej strony. */
  const strefa = panel("analiza/Strefa.tsx");
  assert.ok(!strefa.includes("/api/biuro/strefa"), "reguły nie zeszły z ustawień do analizy");
  assert.match(strefa, /\/obsluga\/ustawienia\?karta=strefa/, "analiza prowadzi do karty reguł w panelu");
  assert.ok(!fs.existsSync(path.resolve(import.meta.dirname, "../../../panel/src/mostBiura.ts")),
    "most do biura zniknął razem z ostatnim widokiem");
});

test("widok SPRAW nie wraca bokiem (0.140.0)", () => {
  /* Test pilnował kolejności kart pracy przed archiwum w DOSTAWACH i w
     MAGAZYNIE. Oba widoki przeszły do panelu (0.435.0, 0.438.0), gdzie
     kolejność niesie pierwszy kubełek kolejki. Zostaje trzecia gwarancja:
     kasacja SPRAW z 0.140.0 nie cofa się po cichu. */
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  assert.equal(html.indexOf('id="widokSprawy"'), -1, "widok SPRAW zniknął (0.140.0)");
  for (const id of ["zwrotListaKarta", "dyskusjeKarta", "pytaniaListaKarta", "opinieKarta"]) {
    assert.ok(!html.includes(`id="${id}"`), `${id} nie wróciła do biura`);
  }
});

test("karta zostaje kartą, a jej wygląd stoi w JEDNYM miejscu", () => {
  /* Do 0.140.1 ten test pilnował DWÓCH połówek: że konsola pracy jest taflą
     i że zmiana nie rozlała się na karty. Konsola była układem ekranu SPRAW
     i odeszła razem z nim — reguły `.widok.konsola` nie miały już czego
     trafić. Została połówka druga i ona jest tu cała: powierzchnia do
     czytania ma promień i cień, bo na nich stoją ANALIZA i STAN SYSTEMU.

     Bez tej asercji pierwsze porządkowanie CSS zdejmie promień „bo nikt tego
     nie widzi" i nikt nie zauważy, dopóki właściciel nie otworzy analizy. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(
    html,
    /\.card \{ background: var\(--card\);[^}]*border-radius: 14px;[^}]*box-shadow: var\(--cien\)/,
    "karta dalej ma promień 14 i cień — analiza i stan systemu na nich stoją"
  );

  /* Margines strony stoi w JEDNYM miejscu. Dwie kopie tej liczby to dwa
     miejsca do rozjazdu — ta sama reguła, co przy progach szerokości. */
  assert.match(html, /--brzeg:/, "margines strony ma własną zmienną");
  assert.match(html, /padding: 0 var\(--brzeg\)/, "strona bierze margines ze zmiennej");
});

test("dostawy odeszły do panelu razem ze swoimi strażnikami (0.435.0)", () => {
  /* Widok DOSTAWY przeszedł do `panel/` (`docs/obsluga-klienta.md` §7) i razem
     z nim odeszło z tego pliku pięć testów tej strony, a dwa pilnują odtąd
     nowej drogi. Gwarancje nie zniknęły, tylko zmieniły adres — `CLAUDE.md`
     każe przenosić strażnika razem z widokiem:

       sygnał wyjątku w wierszu, kto odłożył pozycję,
       archiwum szukane przez serwer, powiększenie dowodu,
       zero zapisu przy wejściu w dokument   → `panel/src/ekrany/Dostawy.test.tsx`
       szablony GEKO i PARTNER               → `panel/src/druk/szablony.test.ts`

     Szuflada kontekstu i pasma szerokości odeszły bez następcy: panel ma
     trzy kolumny z jednej definicji (`SIATKA_TRZECH_KOLUMN`), a nie własny
     mechanizm na każdy ekran. Ten test pilnuje, że stara maszyneria nie
     została w pliku półżywa — kod bez widoku to kod, którego nikt nie czyta. */
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  for (const slad of ['id="widokDostawy"', 'id="szczegol"', 'id="lupa"', 'id="szufladaCien"',
    "data-szuflada", "function rysujDostawy", "function otworzFormularz", "ustawSzuflade"]) {
    assert.ok(!html.includes(slad), `ślad po dostawach: ${slad}`);
  }
  for (const plik of ["ekrany/Dostawy.test.tsx", "druk/szablony.test.ts"]) {
    assert.ok(fs.existsSync(path.resolve(import.meta.dirname, "../../../panel/src", plik)),
      `strażnik dostaw w panelu: ${plik}`);
  }
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
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  for (const w of ["widokNadzor", "widokDziennik", "widokAnaliza"]) {
    assert.ok(!html.includes(`id="${w}"`), `${w} przeszedł do panelu i nie wraca`);
  }
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
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  assert.doesNotMatch(html, /allegro\/parowanie/, "drugiej pętli parowania w biurze być nie może");
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
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
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
  /* Do 0.113.0 kulejący cykl miał własny znacznik `#cyklBlad`; od 0.114.0
     jest bursztynem ikony zdrowia — sygnał zostaje, znacznik nie. */
  assert.match(html, /kulawyCykl/, "kulejący cykl nadal ma sygnał — jako składnik ikony zdrowia");
  assert.ok(!/console\.warn\(e\)/.test(html), "nieme połykanie błędów cyklu zniknęło");
});

test("pasek to dwie ikony z tooltipem, a `brak` kończy parowanie (0.114.0)", () => {
  /* Zgłoszenie właściciela: „nie działa mi guzik do połączenia z Allegro".
     Sesja parowania żyje w pamięci procesu serwera, więc restart w trakcie
     (typowe wdrożenie) kończył się odpowiedzią `brak` — a front kręcił nią
     pętlę jak `czekam`, w nieskończoność. `parowanieTrwa` zostawało true
     i dwa guardy czyniły guzik martwym aż do przeładowania strony. Druga
     część zgłoszenia: rząd kafli „serwer OK · worker OK…" zredukowany do
     jednej ikony koloru problemu, z pełną treścią w `title`.               */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );

  /* 1. `brak` kończy pętlę i oddaje guzik — od 0.441.0 w panelu,
     sprawdzane zachowaniem w `ekrany/Stan.test.tsx`. */
  const parowanie = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src/stan/parowanie.ts"), "utf8");
  assert.ok(!parowanie.includes('d.stan === "czekam" || d.stan === "brak"'),
    "`brak` nie może kręcić pętli odpytywania jak `czekam`");

  // 2. Dwie ikony w pasku, każda z natywnym tooltipem i nawigacją z sekcji.
  assert.match(html, /id="ikonaZdrowia"/, "zdrowie systemu to jedna ikona, nie rząd kafli");
  assert.match(html, /id="ikonaAllegro"/, "wejście do parowania stoi w pasku");
  /* Obie ikony stoją W PASKU BOCZNYM (0.119.1 nagłówek → 0.125.0 aside),
     nie w osobnym paśmie chromu. */
  assert.ok(html.indexOf('id="ikonaZdrowia"') < html.indexOf("</aside>"),
    "ikona zdrowia mieszka w pasku bocznym");
  assert.ok(html.indexOf('id="ikonaAllegro"') < html.indexOf("</aside>"),
    "ikona Allegro mieszka w pasku bocznym");
  /* Pasek nie chowa się razem z `#panel`, więc ikony muszą chować się same —
     inaczej świecą nad formularzem logowania, jak zakładki przed 0.95.0. */
  assert.match(html, /const IKONY_STANU = /, "ikony mają jedną listę na trzy miejsca");
  for (const co of ["hidden = true", "hidden = false"]) {
    assert.ok(html.includes(`for (const id of IKONY_STANU) $(id).${co}`),
      `ikony stanu same pilnują swojej widoczności (${co})`);
  }
  assert.match(html, /ik\.title = linie\.join\("\\n"\)/, "tooltip niesie pełne zdania kafli");
  /* DELEGACJA WYJEŻDŻA RAZEM Z IKONAMI za każdą przeprowadzką (`#chrome` →
     nagłówek 0.119.1 → aside 0.125.0), zawsze w tym samym commicie. Zostawiona
     w starym domu byłaby kolejną odsłoną usterki z 0.92.0, 0.96.0, 0.97.0,
     0.98.0 i 0.101.0 — tym razem głośną: starego domu nie ma, `$(…)`/
     `querySelector` oddaje `null` i wywala cały skrypt przy starcie. */
  /* Od 0.441.0 ikony i plakietki prowadzą do panelu przez `data-panel`,
     obsługiwany delegacją na DOKUMENCIE — przeżywa każde przerysowanie
     i każdą przeprowadzkę ikon, bo nie wisi na żadnym ich domu. */
  for (const id of ["ikonaZdrowia", "ikonaAllegro"]) {
    assert.match(html, new RegExp(`id="${id}" data-panel="/obsluga/stan`), `${id} prowadzi do stanu systemu w panelu`);
  }
  assert.match(html, /document\.addEventListener\("click", \(e\) => \{\s*const b = e\.target\.closest\("\[data-panel\]"\)/,
    "wyjścia do panelu delegują z dokumentu");
  assert.ok(!/\$\("chrome"\)/.test(html), "nic już nie sięga po nieistniejący #chrome");
  assert.ok(!/querySelector\("header"\)/.test(html),
    "nic już nie sięga po nieistniejący nagłówek");
  assert.ok(
    !/\$\("stan"\)\.addEventListener/.test(html),
    "nasłuch nie wisi na #stan — to pojemnik przerysowywany co cykl"
  );

  // 3. Stan Allegro płynie z /api/health — ikona żyje na każdej zakładce.
  assert.match(html, /h\.allegro/, "ikona Allegro czyta stan z health, nie tylko z listy zwrotów");
});


/* ── Instrukcja nawigacji nie może wskazywać zakładki, której nie ma ─────────
   `sonda-run.ts` przez dwanaście wydań kazał iść do „/biuro → REJESTRY →
   KONTO ALLEGRO". Zakładka REJESTRY odeszła w 0.140.0, a karta konta stoi od
   tamtej pory w STANIE SYSTEMU. Nic tego nie zgłaszało: zdanie żyje w stringu,
   a stringów nie sprawdza ani kompilator, ani przegląd — czyta je wyłącznie
   człowiek, który już ma problem i szuka wyjścia.

   Test bierze PIERWSZY człon każdej takiej instrukcji z kodu serwera
   i sprawdza go wobec paska zakładek. Dalsze człony (karta, przycisk) zostają
   poza sprawdzeniem: pasek jest jedynym zbiorem nazw, który da się odczytać
   z HTML-a bez zgadywania.                                                   */

test("żaden komunikat nie odsyła do zakładki, której nie ma", () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  const otwarcie = html.match(/<nav class="zakladki"[^>]*>/);
  assert.ok(otwarcie, "pasek zakładek istnieje");
  const nav = html.slice(otwarcie.index!, html.indexOf("</nav>"));

  /* Dozwolone są NAZWY Z PASKA i identyfikatory widoków. Widok bywa dostępny
     spoza paska — USTAWIENIA otwiera zębatka i `data-widok="dostawcy"` jest
     jedynym miejscem, w którym ta nazwa stoi w HTML-u. */
  const dozwolone = new Set([
    ...[...nav.matchAll(/<span class="et">([^<]+)<\/span>/g)].map((m) => m[1].trim().toUpperCase()),
    ...[...html.matchAll(/data-widok="(\w+)"/g)].map((m) => m[1].toUpperCase()),
  ]);

  const pliki: string[] = [];
  const zbierz = (dir: string): void => {
    for (const w of fs.readdirSync(dir, { withFileTypes: true })) {
      const pelna = path.join(dir, w.name);
      if (w.isDirectory()) zbierz(pelna);
      else if (w.name.endsWith(".ts") && !w.name.endsWith(".test.ts")) pliki.push(pelna);
    }
  };
  zbierz(path.resolve(import.meta.dirname, ".."));

  /* Od 0.441.0 komunikaty prowadzą także do PANELU (`/obsluga → STAN
     SYSTEMU → …`) — stan systemu przeszedł tam ostatni z wglądu. Nazwy
     zakładek panelu stoją w `main.tsx` jako `etykieta`, w obu rzędach
     nagłówka. Ta sama reguła: pierwszy człon musi być zakładką, która jest. */
  const rama = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/main.tsx"), "utf8");
  const wPanelu = new Set([...rama.matchAll(/etykieta: "([^"]+)"/g)].map((m) => m[1].toUpperCase()));

  let znalezione = 0;
  for (const plik of pliki) {
    const tekst = fs.readFileSync(plik, "utf8");
    /* Człon zapisany WIELKIMI literami — tak wyglądają nazwy zakładek na
       pasku. Małe litery („/biuro → zębatka") opisują drogę, nie zakładkę. */
    for (const [wzor, znane, gdzie] of [
      [/\/biuro\s*→\s*([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ ]*)/g, dozwolone, "pasek biura"],
      [/\/obsluga\s*→\s*([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ ]*)/g, wPanelu, "nagłówek panelu"],
    ] as Array<[RegExp, Set<string>, string]>) {
      for (const m of tekst.matchAll(wzor)) {
        znalezione++;
        const cel = m[1].trim();
        assert.ok(znane.has(cel),
          `${path.basename(plik)} odsyła do „${cel}", a ${gdzie} zna: ${[...znane].join(", ")}`);
      }
    }
  }
  assert.ok(znalezione >= 5, "wzorzec przestał cokolwiek znajdować — test pilnowałby pustki");
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

test("spóźniona sprawa ma własną plakietkę i drogę do treści (0.364.0)", () => {
  /* Cztery rzeczy, bez których ten sygnał byłby gorszy niż jego brak.      */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );

  /* 1. ALARM CHODZI W CYKLU, nie na wejściu na zakładkę. Własność „Wiek"
        mówi: widać, co czeka najdłużej, BEZ PYTANIA KOGOKOLWIEK. Sygnał
        pobierany dopiero po wejściu na STAN SYSTEMU odpowiadałby wyłącznie
        temu, kto już poszedł sprawdzić — czyli nikomu, kto go potrzebuje. */
  /* Wycinek do końca funkcji, nie do `odswiezEtap3()`: takiej funkcji nie
     ma od dawna, `indexOf` oddawał -1 i wycinek sięgał końca pliku — test
     przechodził na czymkolwiek, co stało dalej. */
  const odLicznikow = html.indexOf("async function odswiezLiczniki()");
  const liczniki = html.slice(odLicznikow, html.indexOf("\n}\n", odLicznikow));
  assert.match(liczniki, /\/api\/biuro\/alarm-wymiany/,
    "alarm pobiera się w cyklu, a cykl chodzi na każdej zakładce");

  /* 2. OKNO ALARMU JEST STAŁE. Suwak przy tabeli rządzi tabelą; plakietka
        w nagłówku ma znaczyć jedno, niezależnie od tego, co ktoś wybrał. */
  assert.ok(
    !/alarm-wymiany\?dni=/.test(html),
    "alarm nie bierze okna z ekranu — inaczej ta sama sprawa raz jest spóźniona, raz nie"
  );

  /* 3. PLAKIETKA MA DROGĘ DO TREŚCI. Zgłoszenie z 20 sierpnia: sygnał bez
        drogi do treści jest sygnałem zgubionym. */
  /* Od 0.441.0 tabela mieszka w stanie systemu PANELU, a plakietka
     prowadzi wprost do jej karty. */
  assert.match(html, /data-panel="\/obsluga\/stan\?karta=wymiana"/,
    "plakietka prowadzi na tabelę, która ją wyjaśnia");
  const wymiana = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/stan/Wymiana.tsx"), "utf8");
  assert.match(wymiana, /id="karta-wymiana"/, "cel skoku istnieje");
  const alarmWPanelu = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/api/stan.ts"), "utf8");
  assert.ok(!/alarm-wymiany\?dni=/.test(alarmWPanelu), "panel też bierze alarm z okna stałego");

  /* 4. SPÓŹNIENIE NIE BARWI IKONY ZDROWIA. Ikona odpowiada na pytanie „czy
        system działa". Sprawa stojąca trzeci dzień to zdrowy system i
        kulejąca praca — czerwień od niej świeciłaby cały dzień i nauczyłaby
        biuro ignorować ikonę także wtedy, gdy naprawdę padnie worker. */
  const rysujStan = html.slice(
    html.indexOf("function rysujStan("),
    html.indexOf("rysujIkoneAllegro();")
  );
  assert.ok(
    !/czerwone\.push\("wymiana"\)|czerwone\.push\("spoznione"\)/.test(rysujStan),
    "spóźniona sprawa nie zabiera czerwieni awariom systemu"
  );
  assert.match(rysujStan, /spoznionychRazem/, "plakietka liczy się w pasku stanu");
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
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  assert.ok(!/\)\)\.json\(\)\s*\.catch\(/.test(html),
    "`.catch` za samym `.json()` nie łapie odmowy trasy — ma stać na całym łańcuchu");
  const panel = (plik: string) => fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src", plik), "utf8");
  assert.doesNotMatch(panel("ekrany/Stan.tsx"), /Promise\.all/, "karty stanu nie czytają się jednym łańcuchem");
  assert.match(panel("stan/Wymiana.tsx"), /useWymiana\(dni\)/, "tabela wymiany ma własne zapytanie");
  assert.match(panel("stan/Kolizje.tsx"), /useKolizje\(\)/, "kolizje mają własne zapytanie");
});

/* ── Ikona karty przeglądarki (0.419.0) ──────────────────────────────────────
   Decyzja właściciela: obie karty mają nosić znak firmy. Biuro rysowało literę
   „W" wklejoną jako SVG, panel obsługi nie miał ikony wcale.

   Test pilnuje PARY: adresu nazwanego w stronie i trasy, która go obsługuje.
   Rozjazd między nimi nie wywraca niczego — daje pustą ikonę i 404 w logu,
   czyli usterkę, której nikt nie zgłosi i nikt nie zauważy.                 */

test("ikona biura wychodzi z trasy nazwanej w stronie", async () => {
  const html = fs.readFileSync(
    new URL("../web/biuro.html", import.meta.url), "utf8");
  const adres = /<link rel="icon"[^>]*href="([^"]+)"/.exec(html)?.[1];
  assert.equal(adres, "/biuro/ikona.webp", "strona nazywa inny adres ikony");

  const r = await app.inject({ method: "GET", url: adres! });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-type"], "image/webp");
  /* Tydzień cache'u, jak fonty: plik zmienia się wyłącznie z wydaniem,
     a wydanie restartuje usługę. */
  assert.match(String(r.headers["cache-control"]), /max-age=604800/);
});

test("ikona NIE jest już wklejona w dokument", () => {
  /* Wklejony `data:` URI wracał przy każdym otwarciu strony w treści HTML-a.
     Zarzut, dla którego tam stał — 404 na `/favicon.ico` — nie dotyczy adresu,
     który strona nazywa sama. */
  const html = fs.readFileSync(
    new URL("../web/biuro.html", import.meta.url), "utf8");
  assert.ok(!/<link rel="icon"[^>]*data:image/.test(html),
    "ikona wróciła do dokumentu jako data:");
});

/* ── BUILD KOPIUJE TO, CO TRASY CZYTAJĄ (0.420.1) ────────────────────────────
   Blizna z produkcji: 0.419.0 dołożyło `src/web/ikona-biuro.webp`, a `build`
   serwera kopiował do `dist/web` trzy pliki WYMIENIONE Z NAZWY. Ikony wśród
   nich nie było, więc `readFileSync` przy rejestracji tras rzucił ENOENT
   i usługa nie wstała wcale — przez obrazek w pasku karty.

   Testy nie widziały tego, bo biegną na ŹRÓDLE, gdzie plik jest na miejscu.
   Ten test patrzy na jedno i drugie: czy każdy plik czytany z `../web/`
   naprawdę tam leży i czy `build` kopiuje ten katalog W CAŁOŚCI, zamiast
   wymieniać pliki po nazwie.                                                */

test("każdy plik czytany z `web/` naprawdę tam leży", () => {
  const zrodlo = fs.readFileSync(new URL("./biuro.ts", import.meta.url), "utf8");
  const nazwy = [...zrodlo.matchAll(/"\.\.\/web\/([\w.-]+)"/g)].map((m) => m[1]);
  assert.ok(nazwy.length > 0, "nie znalazłem ani jednego odczytu z web/");
  for (const nazwa of nazwy) {
    assert.ok(fs.existsSync(new URL(`../web/${nazwa}`, import.meta.url)),
      `trasa czyta web/${nazwa}, a tego pliku nie ma w źródle`);
  }
});

test("`build` kopiuje CAŁY katalog web, a nie pliki po nazwie", () => {
  /* Wymienianie z nazwy działa do pierwszego nowego pliku — i wtedy kładzie
     usługę, a nie psuje jednego ekranu. */
  const pkg = JSON.parse(fs.readFileSync(
    new URL("../../package.json", import.meta.url), "utf8")) as
    { scripts: Record<string, string> };
  assert.match(pkg.scripts.build, /cpSync\('src\/web','dist\/web'/,
    "build przestał kopiować cały katalog web/");
});

/* ── Przeprojektowanie biura (0.427.0) ───────────────────────────────────────
   Pięć niezmienników z jednego wydania. Każdy stoi, bo jego złamanie nie
   daje błędu w konsoli — daje ekran, który wygląda prawie dobrze.          */

test("każda karta panelu stoi wewnątrz swojego widoku (0.427.0)", () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  /* Blizna z tego samego wydania: przestawienie kart STANU SYSTEMU wyniosło
     arkusz lokalizacji za `</div>` widoku. Karta wisiała wtedy pod KAŻDĄ
     zakładką naraz, a wszystkie testy były zielone. */
  const start = html.indexOf('<main id="panel"');
  const panel = html.slice(start, html.indexOf("</main>", start)).replace(/<!--[\s\S]*?-->/g, "");
  let glebokosc = 0;
  let wWidoku = false;
  for (const m of panel.matchAll(/<(\/?)(div|section|details)\b([^>]*)>/g)) {
    const [, zamkniecie, tag, atrybuty] = m;
    if (tag === "div") {
      if (zamkniecie) {
        glebokosc--;
        if (glebokosc === 0) wWidoku = false;
      } else {
        if (glebokosc === 0) wWidoku = /class="widok\b/.test(atrybuty);
        glebokosc++;
      }
      continue;
    }
    if (!zamkniecie) {
      assert.ok(wWidoku, `<${tag}${atrybuty}> stoi poza widokiem — pokaże się pod każdą zakładką`);
    }
  }
  assert.equal(glebokosc, 0, "znaczniki <div> w panelu się nie domykają");
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
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  assert.ok(!html.includes('id="widokNadzor"'), "STAN SYSTEMU przeszedł do panelu i nie wraca");
});

test("strona jest drogowskazem: karta do panelu, bez pamięci widoku (0.444.0)", () => {
  /* Do 0.444.0 stał tu strażnik pamięci widoku: nazwa zakładki sprzed
     przeprowadzki dawała pusty panel, więc lista ISTNIEJĄCYCH widoków
     cofała ją na ustawienia. Widoków nie ma już żadnych, więc nie ma
     czego pamiętać — a stara nazwa w `localStorage` niczego nie psuje.

     Dymek błędu (0.427.0) i mały przycisk odeszły z ostatnimi zapisami:
     strona nie ma już czynności, której błąd trzeba by pokazać. W panelu
     błąd stoi przy karcie, w `Blad`, i zostaje do następnej próby. */
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../web/biuro.html"), "utf8");
  const start = html.indexOf('<main id="panel"');
  const panel = html.slice(start, html.indexOf("</main>", start));
  assert.match(panel, /BIURO PRZESZŁO DO PANELU/, "karta mówi, gdzie jest praca");
  assert.match(panel, /data-panel="\/obsluga\/"/, "karta prowadzi do panelu, z sesją");
  assert.match(panel, /przekieruje/, "karta zapowiada przekierowanie w następnym wydaniu");
  assert.doesNotMatch(html, /localStorage\.(get|set)Item\("wertis\.widok"/, "pamięci widoku już nie ma");
});
