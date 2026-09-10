import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  LITERY,
  naLike,
  odkodujEncje,
  odlegloscOgraniczona,
  progLiterowki,
  sqlZloz,
  sqlZwin,
  tokeny,
  zloz,
  zwin,
} from "./tekst.js";

/* ── Składanie tekstu ────────────────────────────────────────────────────────
   Te funkcje są czyste, więc testują się bez bazy — poza JEDNYM przypadkiem,
   który jest tu najważniejszy: zgodnością strony JS ze stroną SQL. Zapytanie
   składa JavaScript, kolumnę składa SQLite, a rozjazd o jedną literę wyłącza
   wyszukiwanie dla tej litery BEZ ŻADNEGO OBJAWU. Dlatego ten jeden test
   otwiera prawdziwą bazę w pamięci i porównuje oba wyniki znak po znaku.     */

/** Baza w pamięci — bez pliku, bez konfiguracji aplikacji. */
const sqlite = new DatabaseSync(":memory:");
const przezSql = (wyrazenie: string, wejscie: string): string =>
  (sqlite.prepare(`SELECT ${wyrazenie} AS v`).get(wejscie) as { v: string }).v;

// ── Poziom pierwszy: litery i wielkość ──────────────────────────────────────

test("polskie znaki schodzą do ASCII, wielkość liter znika", () => {
  assert.equal(zloz("GAŹNIK"), "gaznik");
  assert.equal(zloz("Gaźnik"), "gaznik");
  assert.equal(zloz("ŻARÓWKA"), "zarowka");
  assert.equal(zloz("Świeca zapłonowa"), "swieca zaplonowa");
});

test("ł i Ł też — a to jest ta litera, na której NFD milczy", () => {
  /* `"ł".normalize("NFD").length === 1` — ta litera NIE MA rozkładu
     kanonicznego. Gotowe „usuń znaki łączące" przepuściłoby ją nietkniętą,
     a błąd zostałby uznany za naprawiony. Stąd jawna mapa i ten test. */
  assert.equal(zloz("ŁAŃCUCH"), "lancuch");
  assert.equal(zloz("łożysko"), "lozysko");
  assert.equal(zloz("Łódź"), "lodz");
});

test("znak spoza mapy zostaje nietknięty", () => {
  // Świadomie NIE składamy niemieckich przegłosów: strona SQL też ich nie zna,
  // a asymetria znaczyłaby, że wpisane „Müller" nie trafia w „Müller".
  assert.equal(zloz("Müller"), "müller");
});

// ── Poziom drugi: oddzielacze ───────────────────────────────────────────────

test("myślniki, spacje i kropki znikają z formy zwiniętej", () => {
  assert.equal(zwin("LS51-139-HSD-LI-068"), "ls51139hsdli068");
  assert.equal(zwin("W08 0502"), "w080502");
  assert.equal(zwin("SW-40"), "sw40");
});

test("forma złożona ZOSTAWIA spacje — na niej pracuje furtka literówkowa", () => {
  assert.equal(zloz("Gaźnik do kosy"), "gaznik do kosy");
});

// ── Zgodność JS ↔ SQL ───────────────────────────────────────────────────────

test("dla KAŻDEJ litery z mapy SQL składa dokładnie tak samo jak JS", () => {
  /* Iterujemy po tablicy, a nie po wypisanej liście — dopisanie litery do
     `LITERY` automatycznie obejmuje ten test. Bez tego nowa litera wchodziłaby
     do jednej strony i cicho psuła drugą. */
  for (const [z] of LITERY) {
    const probka = `X${z}Y`;
    assert.equal(przezSql(sqlZloz("?"), probka), zloz(probka), `zloz rozjechało się na „${z}"`);
    assert.equal(przezSql(sqlZwin("?"), probka), zwin(probka), `zwin rozjechało się na „${z}"`);
  }
});

test("zgodność JS ↔ SQL na prawdziwych łańcuchach z kartoteki", () => {
  for (const p of ["Gaźnik kompletny", "ŚWIECA ZAPŁONOWA NGK", "LS51-139-HSD", "W08-0502", "Łódź żółw"]) {
    assert.equal(przezSql(sqlZloz("?"), p), zloz(p), `zloz: ${p}`);
    assert.equal(przezSql(sqlZwin("?"), p), zwin(p), `zwin: ${p}`);
  }
});

// ── Tokeny ──────────────────────────────────────────────────────────────────

test("zapytanie rozpada się na słowa, każde zwinięte", () => {
  assert.deepEqual(tokeny("  gaźnik   ssanie "), ["gaznik", "ssanie"]);
  assert.deepEqual(tokeny("GAŹNIK"), ["gaznik"]);
});

test("wejście bez ani jednego słowa daje PUSTĄ tablicę", () => {
  /* Ten wynik jest istotny, a nie pusty: koniunkcja po pustym zbiorze jest
     prawdziwa, więc bez sprawdzenia go przez wywołującego wyszukiwarka
     oddałaby całą kartotekę na zapytanie „-". */
  assert.deepEqual(tokeny("-"), []);
  assert.deepEqual(tokeny("///"), []);
  assert.deepEqual(tokeny("   "), []);
  assert.deepEqual(tokeny(""), []);
});

test("wklejony opis nie zamienia się w trzydzieści tokenów", () => {
  const dlugie = Array.from({ length: 30 }, (_, i) => `slowo${i}`).join(" ");
  assert.equal(tokeny(dlugie).length, 6);
});

// ── Metaznaki LIKE ──────────────────────────────────────────────────────────

test("procent i podkreślenie przestają być wieloznacznikami", () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE t(n TEXT)");
  for (const v of ["filtr 100%", "filtr 1005", "wal_korbowy", "walxkorbowy"]) {
    d.prepare("INSERT INTO t VALUES (?)").run(v);
  }
  const ile = (q: string) =>
    (d.prepare("SELECT COUNT(*) AS n FROM t WHERE n LIKE '%' || ? || '%' ESCAPE '\\'").get(naLike(q)) as {
      n: number;
    }).n;
  assert.equal(ile("100%"), 1, "procent ma być zwykłym znakiem, nie „cokolwiek dalej\"");
  assert.equal(ile("wal_"), 1, "podkreślenie ma być zwykłym znakiem, nie „dowolny znak\"");
  assert.equal(ile("filtr"), 2, "zwykłe zapytanie działa jak dotąd");
});

// ── Odległość edycyjna ──────────────────────────────────────────────────────

test("liczy odległość do progu i nie liczy dalej", () => {
  assert.equal(odlegloscOgraniczona("gaznik", "gaznik", 2), 0);
  assert.equal(odlegloscOgraniczona("gaznik", "gaznk", 2), 1, "brakująca litera");
  assert.equal(odlegloscOgraniczona("gaznik", "gzanik", 2), 2, "przestawione litery");
  assert.equal(odlegloscOgraniczona("gaznik", "swieca", 2), 3, "ponad progiem wraca max+1, nie prawda");
});

test("różnica długości większa od progu ucina bez liczenia", () => {
  assert.equal(odlegloscOgraniczona("kosa", "kosaspalinowadohondy", 2), 3);
});

test("wynik nie zależy od kolejności argumentów", () => {
  assert.equal(odlegloscOgraniczona("gaznk", "gaznik", 2), odlegloscOgraniczona("gaznik", "gaznk", 2));
});

test("przypadki brzegowe nie wywracają liczenia", () => {
  assert.equal(odlegloscOgraniczona("", "", 2), 0);
  assert.equal(odlegloscOgraniczona("a", "", 2), 1);
  assert.equal(odlegloscOgraniczona("kosa", "kosb", 0), 1, "przy zerowym progu każda różnica to max+1");
});

test("krótkie słowa nie dostają prawa do literówki", () => {
  // jeden błąd na trzech znakach zrównuje kos = kot = koc = kod
  assert.equal(progLiterowki(3), null);
  assert.equal(progLiterowki(4), 1);
  assert.equal(progLiterowki(5), 1);
  assert.equal(progLiterowki(6), 2);
  assert.equal(progLiterowki(20), 2);
});

/* ── Encje HTML ──────────────────────────────────────────────────────────────
   Dekoder chroni bazę i ekran przed `zwr&oacute;cić` z Allegro. Przypadki
   brzegowe są ważniejsze od szczęśliwej ścieżki: podwójne kodowanie nie może
   dekodować się do końca, a nieznana encja nie może zniknąć.                 */

test("odkodujEncje: polskie encje nazwane i podstawowe", () => {
  assert.equal(odkodujEncje("zwr&oacute;ci&cacute; &zdot;arna"), "zwrócić żarna");
  assert.equal(odkodujEncje("A &amp; B &lt;c&gt; &quot;d&quot;"), 'A & B <c> "d"');
  assert.equal(odkodujEncje("&Lstrok;&aogon;ka"), "Łąka");
});

test("odkodujEncje: numeryczne dziesiętne i szesnastkowe", () => {
  assert.equal(odkodujEncje("&#380;&#243;&#322;w"), "żółw");
  assert.equal(odkodujEncje("&#x17c;&#xF3;&#x142;ty"), "żółty");
});

test("odkodujEncje: jeden poziom — &amp;lt; nie staje się <", () => {
  assert.equal(odkodujEncje("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
});

test("odkodujEncje: nieznana encja i goły ampersand zostają", () => {
  assert.equal(odkodujEncje("&foobar; Q&A x&y"), "&foobar; Q&A x&y");
  /* Surrogat i kod spoza Unicode — dosłownie, nie krzak. */
  assert.equal(odkodujEncje("&#xD800; &#1114300;"), "&#xD800; &#1114300;");
});

test("odkodujEncje: nbsp na zwykłą spację, typografia dekodowana", () => {
  assert.equal(odkodujEncje("a&nbsp;b"), "a b");
  assert.equal(odkodujEncje("&bdquo;x&rdquo; &ndash; 5&deg;"), "„x” – 5°");
});

/* ── Alfabety spoza polskiego (0.250.0) ──────────────────────────────────────
   Zgłoszenie właściciela: „często piszą do nas Węgrzy, Słowacy i Czesi
   i dostajemy takie znaki `Z&aacute;silka nebyla doručena`". Do 0.249.1
   tablica znała WYŁĄCZNIE polskie znaki, więc `&aacute;` zostawało dosłownie.

   Zdanie ze zgłoszenia jest przy okazji dowodem, że Allegro koduje
   NIEKONSEKWENTNIE: `á` przyszło jako encja, a `č` w tym samym zdaniu jako
   zwykły znak UTF-8. Test bierze je oba naraz, bo tak właśnie przychodzą. */

test("odkodujEncje: zdanie ze zgłoszenia właściciela, encja obok gołego UTF-8", () => {
  assert.equal(odkodujEncje("Z&aacute;silka nebyla doručena."), "Zásilka nebyla doručena.");
});

test("odkodujEncje: czeski, słowacki, węgierski i niemiecki", () => {
  assert.equal(
    odkodujEncje("&Scaron;koda, &zcaron;e &scaron;t&iacute;tek chyb&iacute;"),
    "Škoda, že štítek chybí");
  assert.equal(
    odkodujEncje("Ko&scaron;&iacute;k je pr&aacute;zdny, &ccaron;ak&aacute;m na v&yacute;menu"),
    "Košík je prázdny, čakám na výmenu");
  assert.equal(
    odkodujEncje("A csomagot m&eacute;g nem kaptam meg, k&ouml;sz&ouml;n&ouml;m"),
    "A csomagot még nem kaptam meg, köszönöm");
  assert.equal(odkodujEncje("Gr&uuml;&szlig;e, Ma&szlig;band fehlt"), "Grüße, Maßband fehlt");
});

test("odkodujEncje: POKRYCIE ALFABETÓW — litera, po której poznaje się język", () => {
  /* Strażnik, nie ozdoba, i deklaruje wymaganie SAM — nie zagląda do tablicy
     w `tekst.ts`. Test, który czyta implementację, przechodzi także wtedy, gdy
     implementacja jest zła; ten ma paść, gdy ktoś przytnie tablicę „bo za
     duża", i paść na literze, której brak widać w zdaniu klienta. */
  const ALFABETY: Record<string, Array<[string, string]>> = {
    czeski: [["ccaron", "č"], ["dcaron", "ď"], ["ecaron", "ě"], ["ncaron", "ň"],
      ["rcaron", "ř"], ["scaron", "š"], ["tcaron", "ť"], ["uring", "ů"],
      ["zcaron", "ž"], ["aacute", "á"], ["yacute", "ý"]],
    słowacki: [["lacute", "ĺ"], ["lcaron", "ľ"], ["racute", "ŕ"],
      ["ocirc", "ô"], ["auml", "ä"]],
    węgierski: [["odblac", "ő"], ["udblac", "ű"], ["ouml", "ö"], ["uuml", "ü"],
      ["eacute", "é"], ["iacute", "í"]],
    niemiecki: [["szlig", "ß"], ["auml", "ä"], ["ouml", "ö"], ["uuml", "ü"]],
    polski: [["aogon", "ą"], ["cacute", "ć"], ["eogon", "ę"], ["lstrok", "ł"],
      ["nacute", "ń"], ["oacute", "ó"], ["sacute", "ś"], ["zacute", "ź"],
      ["zdot", "ż"]],
    rumuński: [["abreve", "ă"], ["acirc", "â"], ["icirc", "î"]],
  };
  for (const [jezyk, pary] of Object.entries(ALFABETY)) {
    for (const [nazwa, znak] of pary) {
      assert.equal(odkodujEncje(`&${nazwa};`), znak, `${jezyk}: &${nazwa};`);
    }
  }
});

test("odkodujEncje: miękki dywiz NIE jest dekodowany", () => {
  /* `&shy;` (U+00AD) jest niewidoczny, a w bazie psułby porównania
     i wyszukiwanie tak samo jak `&nbsp;`. Zostaje dosłownie, czyli widocznie. */
  assert.equal(odkodujEncje("ge&shy;trennt"), "ge&shy;trennt");
});

/* ── Podpis bez nazwiska (0.232.1) ──────────────────────────────────────── */
import { bezPodpisu } from "./tekst.js";

test("bezPodpisu wycina autora po dacie w trzech kształtach podpisu", () => {
  assert.equal(bezPodpisu("potwierdzone — katalog dostawcy, 7.09.2026, A. Lewandowska; bez dowodu"),
    "potwierdzone — katalog dostawcy, 7.09.2026; bez dowodu");
  assert.equal(bezPodpisu("Do X pasuje Y — źródło: rozmowa, 12.09.2026, Admin Test."),
    "Do X pasuje Y — źródło: rozmowa, 12.09.2026.");
  assert.equal(bezPodpisu("pomiar własny, 1.09.2026, Anna"), "pomiar własny, 1.09.2026");
  assert.equal(bezPodpisu("bez daty, Anna"), "bez daty, Anna", "bez daty nie ma czego wycinać");
});
