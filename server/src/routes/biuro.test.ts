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
  /* Stan Allegro dla ikony w pasku (0.114.0). Publicznie wolno mu nieść
     TYLKO stan, środowisko i datę wygaśnięcia — nigdy login ani token. */
  assert.ok(typeof h.allegro?.stan === "string");
  assert.deepEqual(
    Object.keys(h.allegro).filter((k) => !["stan", "srodowisko", "wygasa"].includes(k)),
    [],
    "health jest bez sesji — pole allegro nie może przemycać niczego ponad stan"
  );
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
    16,
    "Po kasacji obsługi klienta (0.140.0) zostają zapisy MAGAZYNU i ADMINA:\n" +
      "logowanie, zamknięcie dostawy poza WERTIS, cofnięcie zamknięcia, " +
      "notatka do dostawy, odczyt odpowiedzi na notatkę, zamknięcie wyjątku, " +
      "import zbiórek, załatwienie pominiętej pozycji kosza, parowanie konta " +
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
      "Reguła się NIE zmienia: liczba rośnie wyłącznie ŚWIADOMIE, a żaden " +
      "zapis nie dzieje się przy samym patrzeniu na ekran."
  );
  assert.equal(
    (html.match(/method:\s*"PUT"/g) ?? []).length,
    2,
    "PUT to komplet reguł strefy złotej i wgranie logo dostawcy — obie " +
      "rzeczy z ustawień, obie po jawnym kliknięciu ZAPISZ"
  );
  assert.equal(
    (html.match(/method:\s*"DELETE"/g) ?? []).length,
    2,
    "DELETE zostały dwa: rozłączenie konta Allegro (za potwierdzeniem, rola " +
      "admin) i skasowanie logo dostawcy z ustawień."
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
  assert.match(html, /biuro\/dostawcy\/\$\{khId\}\/logo/, "wgranie logo dostawcy");
  /* Konwersja formatów MUSI zostać po stronie przeglądarki: serwer przyjmuje
     wyłącznie PNG, a loga przychodzą też jako SVG i WebP. Bez `<canvas>`
     panel odsyłałby plik w oryginale i połowa wgrań kończyłaby się odmową. */
  assert.match(html, /toDataURL\("image\/png"\)/, "normalizacja logo do PNG");
  assert.match(html, /problems\/\$\{id\}\/resolve/, "biuro zamyka wyjątek");
  assert.match(html, /pominiete\/\$\{[^}]+\}\/zalatwione/, "biuro zamyka sprawę pominięcia");
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
    ["dostawy", "magazyn", "analiza", "dziennik", "nadzor"],
    "pasek boczny po 0.140.0: SPRAWY i REJESTRY odeszły razem z obsługą " +
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

  assert.equal(
    (nav.match(/class="grupa-nazwa"/g) ?? []).length,
    2,
    "dwie grupy (Praca, Wgląd), każda podpisana — Archiwum odeszło w 0.140.0 " +
      "razem z rejestrami obsługi klienta"
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
  for (const pole of ["reguly", "firmaNazwa", "dostawcy"]) {
    assert.ok(ustawienia.includes(`id="${pole}"`), `${pole} należy do ustawień`);
  }

  const analiza = wycinek('id="widokAnaliza"', 'id="widokDostawcy"');
  assert.ok(!analiza.includes('id="reguly"'), "reguły zeszły z ANALIZY");
  assert.ok(analiza.includes("Ustawieniach"), "ANALIZA mówi, gdzie ustawia się reguły");
  const dostawy = wycinek('id="widokDostawy"', 'id="widokMagazyn"');
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
  /* W MAGAZYNIE praca przed jej wyjątkami: kosze nad listą pominiętych
     pozycji, bo pominięcie jest skutkiem rozkładania, nie jego wstępem. */
  przed("koszeKarta", "pominieteKarta", "praca hali nad jej wyjątkami");
  /* Rozprężenie z 0.125.0 nie może się cofnąć po cichu, a po 0.140.0 pilnuje
     też kasacji: widoku SPRAW nie ma, a jego karty nie wróciły bokiem do
     magazynu. */
  assert.equal(html.indexOf('id="widokSprawy"'), -1, "widok SPRAW zniknął (0.140.0)");
  const magazyn = html.slice(html.indexOf('id="widokMagazyn"'), html.indexOf('id="widokNadzor"'));
  for (const id of ["zwrotListaKarta", "dyskusjeKarta", "pytaniaListaKarta", "opinieKarta"]) {
    assert.ok(!magazyn.includes(`id="${id}"`), `${id} nie wróciła do magazynu`);
  }
});

test("konsola to tafle, a powierzchnia do czytania zostaje kartą", () => {
  /* Makieta rozdziela dwa wyglądy i panel do 0.112.0 znał tylko jeden.
     `Main.dc.html` robi konsolę pracy jako płaskie tafle stykające się
     krawędziami — `.kontekst` ma tam `border-left`, zero promienia, zero
     cienia. `Analiza.dc.html` robi z bloków KARTY: promień 14, cień, odstęp.

     Panel dawał kartę wszędzie, bo `.card` jest jedną klasą na cały arkusz,
     więc trzy strefy pracy pływały na papierze jak trzy osobne dokumenty.
     Ten test pilnuje OBU połówek naraz: że konsola zrobiła się taflą i że
     zmiana NIE rozlała się na karty analizy. Pierwsze porządkowanie CSS
     scaliłoby te dwa wyglądy z powrotem, i nikt by nie zauważył. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );

  /* Margines strony stoi w JEDNYM miejscu, bo konsola musi go odjąć, żeby
     dotknąć krawędzi okna. Dwie kopie tej liczby to dwa miejsca do rozjazdu —
     ta sama reguła, co przy progach szerokości. */
  assert.match(html, /--brzeg:/, "margines strony ma własną zmienną");
  assert.match(html, /padding: 0 var\(--brzeg\)/, "strona bierze margines ze zmiennej");
  assert.match(
    html,
    /margin-inline: calc\(-1 \* var\(--brzeg\)\)/,
    "konsola wyłamuje się z marginesu strony DOKŁADNIE o niego"
  );

  /* Trzy rzeczy naraz robiły te przerwy i wszystkie trzy muszą zniknąć —
     sam `gap: 0` zostawiłby zaokrąglone rogi stykające się bokami. */
  const konsola = html.slice(html.indexOf(".widok.konsola {"));
  assert.match(konsola.slice(0, 400), /gap: 0/, "strefy stykają się bez odstępu");
  assert.match(html, /\.widok\.konsola > \.kontekst \{[\s\S]{0,80}border-radius: 0/,
    "strefy tracą promień");

  /* A karta ZOSTAJE kartą. Bez tej połówki „uprośćmy CSS" skasowałoby różnicę
     między stanowiskiem pracy a zestawieniem do czytania. */
  assert.match(
    html,
    /\.card \{ background: var\(--card\);[^}]*border-radius: 14px;[^}]*box-shadow: var\(--cien\)/,
    "karta dalej ma promień 14 i cień — analiza i stan systemu na nich stoją"
  );

  /* Kolejka bywa STOSEM kart (lista + brakujące paczki przy zwrocie, lista +
     „poza WERTIS" przy dostawach). Bez odstępu zlałyby się w jedną płaszczyznę
     bez szwu, więc rozdziela je kreska. */
  assert.match(
    html,
    /\.widok\.konsola > \.card ~ \.card \{ border-top: 1px solid/,
    "stos kart w kolejce ma szew"
  );
});

test("ustawienia to jedna tafla, a odstępy niesie arkusz", () => {
  /* Trzecie zgłoszenie tej samej treści od właściciela: „pozbądź się zaokrągleń
     i niepotrzebnych marginesów". Po konsoli spraw (0.112.0) i całej zakładce
     SPRAWY (0.116.0) ustawienia były ostatnią zakładką na pięciu pływających
     kartkach — a są JEDNYM kompletem rzeczy ustawianych raz.

     Test pilnuje obu połówek, tak jak ten wyżej pilnuje ich dla konsoli:
     ustawienia spłaszczyły się, a `.card` NIE stracił promienia globalnie.
     Trzecia asercja jest o odstępach: widok niósł osiemnaście atrybutów
     `style` z ośmioma różnymi marginesami dobranymi z palca. Liczba zamiast
     opisu, bo liczba nie zestarzeje się po cichu. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  const a = html.indexOf('id="widokDostawcy"');
  assert.notEqual(a, -1, "widok ustawień istnieje");
  const ustawienia = html.slice(a, html.indexOf("</main>", a));
  assert.equal(
    (ustawienia.match(/style="/g) ?? []).length,
    0,
    "odstępy w ustawieniach niesie arkusz, nie atrybuty w znaczniku"
  );

  assert.match(
    html,
    /#widokDostawcy > \.card \{[\s\S]{0,80}border-radius: 0; box-shadow: none/,
    "sekcje ustawień tracą promień i cień"
  );
  assert.match(
    html,
    /#widokDostawcy \{[\s\S]{0,400}gap: 0/,
    "sekcje ustawień stykają się bez odstępu"
  );
  assert.match(
    html,
    /#widokDostawcy > \.card \{[\s\S]{0,160}border-top: 1px solid var\(--border\)/,
    "sekcje rozdziela kreska, skoro nie rozdziela ich odstęp"
  );

  /* Druga połówka. Ktoś porządkujący USTAWIENIA sięgnąłby po globalne
     `border-radius: 0` — i skasowałby różnicę, której pilnuje test wyżej. */
  assert.match(
    html,
    /\.card \{ background: var\(--card\);[^}]*border-radius: 14px/,
    "karta poza ustawieniami dalej ma promień 14"
  );
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
  /* Po 0.140.0 szuflada została JEDNA — przy dostawie. Trzy sprawy klienta,
     które miały własne, odeszły razem z obsługą klienta; mechanizm zostaje
     i przyjmie następną sekcję kontekstu bez zmian. */
  assert.equal((html.match(/data-szuflada>/g) ?? []).length, 1,
    "przycisk KONTEKST stoi przy dostawie");
  assert.equal((html.match(/data-szuflada-zamknij>/g) ?? []).length, 1,
    "i szuflada ma własne ZAMKNIJ");
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
  assert.ok(ikony.length >= 10, `ikon objaśnień: ${ikony.length}`);
  assert.equal(ikony.length, bloki.length, "każda ikona ma swój blok");
  assert.match(
    html,
    /<\/h2>\s*<div class="objasnienie" hidden>/,
    "blok stoi bezpośrednio po nagłówku — inaczej delegacja go nie znajdzie"
  );
  assert.match(html, /h2 \.info/, "ikona ma własny styl");
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

test("panel naprawia, nie tylko patrzy: kolejka, ratunek serwera, konta (0.111.0)", () => {
  /* Miejsce, w którym problem widać, musi być miejscem, w którym da się go
     naprawić. Kolejka błędów dostała PONÓW/ANULUJ (te same trasy co
     kolektor), karta SERWER dwie operacje ratunkowe zza DEPLOY.md, a karta
     KONTA I SESJE kładzie kres administrowaniu kontami przez curl. Odmowę
     roli wypowiada serwer (konwencja ustawień) — panel roli nie zna. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /data-kolejka-ponow/, "błąd kolejki ponawia się z panelu");
  assert.match(html, /data-kolejka-anuluj/, "oczekujące zadanie da się anulować");
  assert.match(html, /id="serwerResync"/, "resync zszedł z DEPLOY.md na przycisk");
  assert.match(html, /id="serwerZdjecia"/, "odświeżenie zdjęć też");
  assert.match(html, /id="kontaKarta"/, "karta kont w ustawieniach");
  assert.match(html, /data-konto-wyloguj/, "zgubiony kolektor ma swój przycisk");
  assert.match(html, /\$\("widokNadzor"\)\.addEventListener\("click"/, "nadzór deleguje z sekcji");
  assert.match(html, /\$\("kontaKarta"\)\.addEventListener\("click"/, "konta delegują z sekcji");
  assert.match(html, /id="fOsoba"/, "dziennik filtruje po osobie, nie tylko urządzeniu");
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

  // 1. `brak` przestał być `czekam`: kończy pętlę i oddaje guzik.
  assert.ok(
    !html.includes('d.stan === "czekam" || d.stan === "brak"'),
    "`brak` nie może kręcić pętli odpytywania jak `czekam`"
  );
  /* Kotwica na samej pętli — `d.stan === "brak"` pada w skrypcie także przy
     rysowaniu tickera, a tam wolno mu znaczyć co innego. */
  const poll = html.slice(html.indexOf("async function pollParowania"));
  const galazBrak = poll.slice(
    poll.indexOf('d.stan === "brak"'),
    poll.indexOf('d.stan === "polaczone"')
  );
  assert.match(galazBrak, /SESJA PAROWANIA PRZEPADŁA/, "panel mówi, co się stało");
  assert.match(galazBrak, /data-polacz/, "guzik POŁĄCZ wraca od razu, bez przeładowania");
  assert.ok(
    !/setTimeout\(pollParowania/.test(galazBrak),
    "po `brak` nie ma czego odpytywać — sesji na serwerze już nie ma"
  );

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
  assert.match(html, /\$\("bok"\)\.addEventListener\("click"/,
    "stan deleguje z paska bocznego — stamtąd, gdzie stoją ikony");
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

