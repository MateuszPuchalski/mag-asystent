import { test } from "node:test";
import assert from "node:assert/strict";
import { config, bledyKonfiguracji, bezpiecznaWartosc } from "./config.js";

/* Kody Subiekta jako test, nie jako komentarz.
   ─────────────────────────────────────────────────────────────────────────
   Te liczby były wcześniej zgadywane i jedna z nich była błędna: `DOK_TYP_PZ`
   wynosiło 5, czyli KFZ — korektę faktury zakupu. Na prawdziwej bazie aplikacja
   listowałaby korekty jako dostawy i nie zobaczyła ani jednego PZ, a objawiłoby
   się to dopiero na wdrożeniu, w postaci „pustej listy dostaw".

   Teraz pochodzą wprost z oficjalnego opisu struktury InsERT GT dla wersji bazy
   1.8731.31.6933 (docs/subiekt-gt-struktura.md):
     1-FZ  2-FS  3-RZ  4-RS  5-KFZ  6-KFS  9-MM  10-PZ  11-WZ  12-PW
     13-RW  14-ZW  15-ZD  16-ZK  21-PA  29-IW
   i `dok_Status`: {0-wycofany, 1-wykonany, 2-unieważniony, 3-odłożony, …}.

   Test pilnuje, żeby nikt ich po cichu nie „poprawił" z powrotem.            */

test("dok_Typ dostaw: FZ=1, PZ=10 (5 to KFZ, nie PZ)", () => {
  assert.equal(config.mssql.dokTypFZ, 1);
  assert.equal(config.mssql.dokTypPZ, 10);
  assert.notEqual(config.mssql.dokTypPZ, 5);
});

test("bufor to dokument ODŁOŻONY (3), nie wycofany (0)", () => {
  assert.match(config.mssql.bufferExpr, /dok_Status\s*=\s*3/);
  assert.doesNotMatch(config.mssql.bufferExpr, /dok_Status\s*=\s*0/);
});

test("limit lokalizacji = realny rozmiar tw_Pole1..8 (varchar(50))", () => {
  assert.equal(config.locFieldLimit, 50);
});

test("magazyny rozstrzygają o trybie, więc muszą być różne", () => {
  const { MAG, MGP, ZWROTY } = config.magId;
  assert.equal(new Set([MAG, MGP, ZWROTY]).size, 3);
});

/* ── Walidacja konfiguracji wdrożenia ────────────────────────────────────────
   Te reguły istniały wcześniej wyłącznie w głowie autora dokumentacji albo jako
   test na wartościach domyślnych. Teraz pracują na produkcji, więc muszą mieć
   pokrycie na wartościach BŁĘDNYCH — bo to one są tym, przed czym bronią.     */

test("te same id magazynow to blad, nie ostrzezenie", () => {
  // magazyn skutku rozstrzyga, którym trybem idzie dokument; dwa te same id
  // znaczą, że dostawa i kontener trafiają do jednej zakładki — a wygląda to
  // jak „brakuje dostaw", nie jak literówka w wertis.env
  const zly = { ...config, magId: { MAG: 1, MGP: 1, ZWROTY: 3 } };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /muszą być różne/);
  assert.match(bledy[0], /sl_Magazyn/, "komunikat ma prowadzić do zapytania, nie tylko stwierdzać fakt");
});

test("SFERA_WORKER=1 przy seeded to blad — zadania mm nie mialyby wykonawcy", () => {
  // w demo MM obsługuje DevSferaAdapter w workerze Node; włączony przełącznik
  // kazałby Node'owi omijać mm, które wisiałyby w pending na zawsze
  const zly = { ...config, sferaWorker: true, sgtMode: "seeded" as const };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /SFERA_WORKER=1 wymaga SGT_MODE=mssql/);
});

/* Zdjęcia kartotek: każda z tych pomyłek daje TEN SAM objaw — pusty slot na
   karcie towaru — i żadna nie prowadzi do przyczyny, bo kartoteka bez zdjęcia
   wygląda dokładnie tak samo jak zła nazwa kolumny. Dlatego łapiemy je przy
   starcie, a nie przy pierwszym otwarciu karty. */

test("nieznane ZDJECIA_ZRODLO nie przechodzi startu", () => {
  const zly = { ...config, zdjecia: { ...config.zdjecia, zrodlo: "sftp" as "blob" } };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /dozwolone: puste \(bez zdjęć\), blob, plik/);
});

test("ZDJECIA_ZRODLO=blob bez nazwy kolumny nie przechodzi startu", () => {
  const zly = {
    ...config,
    sgtMode: "mssql" as const,
    mssql: { ...config.mssql, database: "b", user: "u", password: "p" },
    zdjecia: { ...config.zdjecia, zrodlo: "blob" as const, kolumna: "" },
  };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /ZDJECIA_KOLUMNA/);
});

test("ZDJECIA_ZRODLO=blob przy seeded to blad — nie ma skad wziac zdjec", () => {
  const zly = {
    ...config,
    sgtMode: "seeded" as const,
    zdjecia: { ...config.zdjecia, zrodlo: "blob" as const, kolumna: "zdj_Dane" },
  };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /wymaga SGT_MODE=mssql/);
});

test("osobna tabela zdjec bez kolumny kolejnosci nie przechodzi startu", () => {
  // tw_ZdjecieTw.zd_IdTowar jest kluczem OBCYM — bez zd_Id porządek nie
  // rozstrzyga, które z kilku zdjęć towaru wziąć, a objawem byłby ruch
  // sieciowy (skaczący ETag), nie błąd
  const zly = {
    ...config,
    sgtMode: "mssql" as const,
    mssql: { ...config.mssql, database: "b", user: "u", password: "p" },
    zdjecia: {
      ...config.zdjecia,
      zrodlo: "blob" as const,
      tabela: "tw_ZdjecieTw",
      kolumna: "zd_Zdjecie",
      kolumnaKolejnosc: "",
    },
  };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /ZDJECIA_KOLUMNA_KOLEJNOSC/);
  assert.match(bledy[0], /zd_Id/, "komunikat ma podać gotową wartość, nie tylko nazwę klucza");
});

test("pamiec braku zdjecia dluzsza niz doba nie przechodzi startu", () => {
  /* Kolektor pamięta brak przez 24 h i na tym stoi obietnica „dodane dziś,
     widoczne jutro". Dłuższa pamięć serwera unieważnia ją po cichu: kolektor
     pyta po dobie i dostaje 404 ze starego wpisu. Dokładnie ten błąd siedział
     w kodzie do 0.32.1, tyle że jako JEDEN próg na oba stany. */
  const zly = {
    ...config,
    zdjecia: { ...config.zdjecia, zrodlo: "plik" as const, katalog: "/tmp/z", brakTtlH: 24 },
  };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /ZDJECIA_BRAK_TTL_H/);
  assert.match(bledy[0], /dob/, "komunikat ma powiedzieć, skąd bierze się granica");
});

test("ZDJECIA_ZRODLO=plik bez katalogu nie przechodzi startu", () => {
  const zly = { ...config, zdjecia: { ...config.zdjecia, zrodlo: "plik" as const, katalog: "" } };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /ZDJECIA_KATALOG/);
});

test("SGT_MODE=mssql bez danych logowania nie przechodzi startu", () => {
  // wcześniej puste dane przechodziły, a awaria wychodziła przy pierwszym
  // zapytaniu — czyli PO tym, jak instalator uznał, że skończył
  const zly = {
    ...config,
    sgtMode: "mssql" as const,
    mssql: { ...config.mssql, database: "", user: "", password: "" },
  };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  for (const k of ["MSSQL_DATABASE", "MSSQL_USER", "MSSQL_PASSWORD"]) {
    assert.match(bledy[0], new RegExp(k), `${k} ma być wymienione z nazwy`);
  }
});

test("tryb seeded nie wymaga danych logowania", () => {
  // demo ma działać bez niczego — to jest cała jego wartość
  const demo = { ...config, sgtMode: "seeded" as const, mssql: { ...config.mssql, database: "", user: "", password: "" } };
  assert.deepEqual(bledyKonfiguracji(demo as typeof config), []);
});

test("zepsuty wzorzec lokalizacji wychodzi przy starcie, nie przy skanie", () => {
  const zly = { ...config, locPatterns: ["^[A-Z\\d{2}$"] };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /wyrażeniem regularnym/);
});

test("wszystkie problemy naraz, nie po jednym na restart", () => {
  // naprawianie konfiguracji metodą „restart po każdym błędzie" to najgorszy
  // możliwy sposób spędzania czasu przy wdrożeniu
  const zly = {
    ...config,
    sgtMode: "mssql" as const,
    magId: { MAG: 2, MGP: 2, ZWROTY: 2 },
    mssql: { ...config.mssql, database: "", user: "", password: "" },
    locPatterns: ["("],
  };
  assert.equal(bledyKonfiguracji(zly as typeof config).length, 3);
});

test("domyslna konfiguracja jest poprawna", () => {
  assert.deepEqual(bledyKonfiguracji(), []);
});

/* Zakładka Dostawy pokazuje SAME faktury zakupu
   ─────────────────────────────────────────────────────────────────────────
   U tego klienta towar wchodzi wyłącznie na FZ, a PZ powstaje z innego procesu
   i na liście pracy magazyniera byłoby szumem. Domyślne było wcześniej `1,10`.

   Test pilnuje domyślnego, bo skutek pomyłki jest cichy: PZ na liście wygląda
   jak zwykła dostawa, więc nikt nie zgłosi, że coś jest nie tak — po prostu
   ktoś rozłoży dokument, którego rozkładać nie miał.                         */

test("domyślne typy dostaw: sama FZ, bez PZ", () => {
  assert.deepEqual(config.mssql.dokTypyDostaw, [config.mssql.dokTypFZ]);
  assert.ok(!config.mssql.dokTypyDostaw.includes(config.mssql.dokTypPZ));
});

test("okno listy dostaw: 14 dni domyślnie", () => {
  // Ta sama liczba stała wcześniej ZASZYTA w trasie `/api/delivery/documents`
  // i w nagłówku kolektora, więc `DOK_DNI_WSTECZ` rządziło tylko importem.
  assert.equal(config.mssql.dokDniWstecz, 14);
});

/* Komunikat o błędnej konfiguracji nie przepisuje sekretu na dysk
   ─────────────────────────────────────────────────────────────────────────
   Z produkcji (0.84.1): klucz Anthropic trafił do `AI_PROVIDER` zamiast do
   `ANTHROPIC_API_KEY` — te pola sąsiadują ze sobą w `wertis.env.example`.
   Serwer odmówił startu i wypisał WARTOŚĆ zmiennej do komunikatu, a NSSM
   podnosił go w pętli, dopisując kolejną kopię klucza do dziennika przy
   każdym obiegu. Klucz trzeba było unieważnić.

   Test pilnuje dwóch rzeczy naraz, bo jedna bez drugiej jest bezużyteczna:
   sekret ma NIE trafić do komunikatu, a komunikat ma dalej mówić, co zrobić.
   Sama maska zostawiłaby człowieka z „coś jest źle" i bez wskazówki.        */

test("wartość wyglądająca na klucz API nie trafia do komunikatu", () => {
  for (const klucz of ["sk-ant-api03-TAJNE", "sk-TAJNE", "Bearer TAJNE"]) {
    const bezpieczna = bezpiecznaWartosc(klucz);
    assert.ok(!bezpieczna.includes("TAJNE"), `sekret przeciekł: ${bezpieczna}`);
    assert.match(bezpieczna, /klucz API/, "maska ma powiedzieć, CO to było");
  }
});

test("literówkę w nazwie trybu dalej widać w całości", () => {
  // Maska bez tego byłaby lekiem gorszym od choroby: „antropic" trzeba
  // zobaczyć, żeby zauważyć brakującą literę.
  assert.equal(bezpiecznaWartosc("antropic"), "antropic");
  assert.equal(bezpiecznaWartosc(""), "");
});

test("długa wartość spoza listy prefiksów też schodzi pod maskę", () => {
  /* Nie każdy sekret zaczyna się od `sk-`. Nazwa trybu ma najwyżej kilka
     znaków, więc wszystko dłuższe jest już podejrzane — a pierwsze dwanaście
     znaków wystarcza, żeby rozpoznać, co człowiek wkleił. */
  const dlugi = "x".repeat(120);
  const bezpieczna = bezpiecznaWartosc(dlugi);
  assert.ok(bezpieczna.length < 40);
  assert.match(bezpieczna, /120 znaków/);
});

test("komunikat o złym trybie nie wynosi tego, co człowiek wkleił", () => {
  /* Do 0.140.1 pilnował tego przypadek AI_PROVIDER, bo tam najłatwiej było
     wkleić klucz w pole trybu. Dostawcy AI nie ma, ale pomyłka jest ta sama
     i dotyczy każdego pola trybu: wartość idzie do komunikatu, komunikat do
     logu, a log bywa wysyłany dalej. Maskowanie ma działać na całej drodze
     przez `bledyKonfiguracji`, nie tylko w samej `bezpiecznaWartosc`. */
  const zly = structuredClone(config) as typeof config;
  (zly.allegro as { mode: string }).mode = "sk-ant-api03-TAJNE";
  const bledy = bledyKonfiguracji(zly);
  const o = bledy.find((b) => b.startsWith("ALLEGRO_MODE="));
  assert.ok(o, "brak zdania o ALLEGRO_MODE");
  assert.ok(!o.includes("TAJNE"), "komunikat wyniósł sekret");
  assert.match(o, /dev, http/, "bez listy dozwolonych wartości człowiek zgaduje drugi raz");
});
