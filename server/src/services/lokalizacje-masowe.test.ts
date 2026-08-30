import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Masowa podmiana adresów z arkusza (0.138.0) ─────────────────────────────
   Funkcja zapisuje do bazy firmy SETKI kartotek jednym kliknięciem, więc test
   pilnuje przede wszystkim tego, czego NIE wolno:

     - zakolejkować wiersza, który niczego nie zmienia (arkusz jest EKSPORTEM,
       więc większość wierszy niesie adres, który już tam stoi),
     - zapisać wiersza z jednym złym kodem BEZ tego kodu — czyli po cichu
       skasować adres, którego nikt nie kazał kasować,
     - przyjąć pliku większego, niż kolejka zdąży wykonać.

   Reszta to obietnica, dla której funkcja powstała: 125 wierszy z arkusza ma
   wjechać jednym kliknięciem, a każdy z nich ma zostawić ślad w audycie.     */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-lokmas-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let L: typeof import("./lokalizacje-masowe.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  L = await import("./lokalizacje-masowe.js");
});

const PASEK = 101;
const STARTER = 102;
const TARCZA = 103;
/** Symbol czysto liczbowy — Excel podaje takie komórki jako liczby. */
const LICZBOWY = 104;
/** Kartoteka z kodami spoza wzorca, pisanymi małą literą — takie są w bazie. */
const RECZNY = 105;

beforeEach(() => {
  const d = db();
  d.prepare("DELETE FROM sfera_queue").run();
  d.prepare("DELETE FROM events").run();
  d.prepare("DELETE FROM sgt_towar").run();
  const t = d.prepare(
    "INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,lokalizacja) VALUES (?,?,?,?,?)"
  );
  t.run(PASEK, "19-25031", "Pasek napędu noży", "", "A01-01-01");
  t.run(STARTER, "08-25001", "Starter do kosiarki", "", "A05-02-02 PAL-038");
  t.run(TARCZA, "S12150", "Tarcza diamentowa", "", "");
  t.run(LICZBOWY, "440117", "Pasek MTD", "", "A02-02-02");
  // Pole w Subiekcie niesie kody pisane ręką przez lata — także małą literą.
  t.run(RECZNY, "W07-0101", "Klemy akumulatora", "", "A05-01-01 paleta64 KT1");
});

const zadan = (): number =>
  (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue").get() as { n: number }).n;

/* ── Odsiewanie wierszy, które niczego nie zmieniają ─────────────────────── */

test("wiersz identyczny z Subiektem idzie do bezZmian, nie do kolejki", () => {
  /* NAJWAŻNIEJSZY test w tym pliku. Właściciel wgrywa własny eksport
     z poprawioną jedną kolumną — gdyby liczyły się wszystkie wiersze, jedno
     kliknięcie posłałoby do Subiekta 125 zapisów, z których 124 nic nie robią.
     Kolejka stałaby wtedy dwie minuty pod pracą, która była pusta. */
  const r = L.przeliczImport([{ symbol: "19-25031", lokalizacja: "A01-01-01" }]);
  assert.equal(r.bezZmian, 1);
  assert.equal(r.doZmiany.length, 0);
});

test("inna kolejność tych samych kodów to NIE jest zmiana", () => {
  /* Arkusz bywa zapisany w innej kolejności niż pole w Subiekcie, a to jest
     ten sam adres. Porównanie po tekście pola robiłoby z tego zmianę. */
  const r = L.przeliczImport([{ symbol: "08-25001", lokalizacja: "PAL-038 A05-02-02" }]);
  assert.equal(r.bezZmian, 1);
  assert.equal(r.doZmiany.length, 0);
});

test("nadmiarowe spacje i mała litera to nadal ten sam adres", () => {
  const r = L.przeliczImport([{ symbol: "19-25031", lokalizacja: "  a01-01-01  " }]);
  assert.equal(r.bezZmian, 1);
});

test("prawdziwa zmiana trafia do doZmiany z polem PRZED i PO", () => {
  const r = L.przeliczImport([{ symbol: "19-25031", lokalizacja: "A10-06-01" }]);
  assert.equal(r.doZmiany.length, 1);
  assert.deepEqual(r.doZmiany[0], {
    symbol: "19-25031",
    twId: PASEK,
    nazwa: "Pasek napędu noży",
    przed: "A01-01-01",
    po: "A10-06-01",
    // Jedyny obecny kod schodzi, więc jest do wyboru — nikt go nie zostawił.
    znikaja: ["A01-01-01"],
    zachowane: [],
  });
});

test("towar bez adresu dostaje pierwszy — pole puste to nie to samo, co brak zmiany", () => {
  const r = L.przeliczImport([{ symbol: "S12150", lokalizacja: "A10-06-01" }]);
  assert.equal(r.doZmiany.length, 1);
  assert.equal(r.doZmiany[0].przed, "");
});

/* ── Wiersze, których nie wolno zapisać ──────────────────────────────────── */

test("zły kod odrzuca CAŁY wiersz, także dobre kody obok niego", () => {
  /* „PAL38II" stoi w prawdziwym arkuszu właściciela obok dwóch poprawnych
     adresów. Zapisanie wiersza bez palety byłoby cichym skasowaniem adresu,
     którego nikt nie kazał kasować — a po zapisie nie ma go z czego odtworzyć. */
  const r = L.przeliczImport([
    { symbol: "19-25031", lokalizacja: "A05-02-02 PAL38II A10-06-06" },
  ]);
  assert.equal(r.doZmiany.length, 0);
  assert.equal(r.odrzucone.length, 1);
  assert.match(r.odrzucone[0].powod, /PAL38II/);
});

test("symbol towaru wpisany jako adres jest odrzucany", () => {
  /* Najczęstsza pomyłka przy poprawianiu arkusza: kolumna przesunięta o jedną
     w prawo i w adresie ląduje symbol. Komunikat ma to nazwać wprost. */
  const r = L.przeliczImport([{ symbol: "19-25031", lokalizacja: "W32-0203" }]);
  assert.equal(r.doZmiany.length, 0);
  assert.match(r.odrzucone[0].powod, /kod towaru/);
});

test("pole dłuższe niż limit tw_Lokalizacja jest odrzucane, nie ucinane", () => {
  const duzo = ["A01-01-01", "A02-02-02", "A03-03-03", "A04-04-04", "A05-05-05", "A06-06-06"];
  const r = L.przeliczImport([{ symbol: "19-25031", lokalizacja: duzo.join(" ") }]);
  assert.equal(r.doZmiany.length, 0);
  assert.match(r.odrzucone[0].powod, /znaków/);
});

test("pusta lokalizacja nie kasuje adresu — wiersz odpada z wyjaśnieniem", () => {
  /* Pusta komórka w arkuszu to niedopatrzenie, nie polecenie „zdejmij adres".
     Skasowanie adresu ma zostać czynnością świadomą, z karty towaru. */
  const r = L.przeliczImport([{ symbol: "19-25031", lokalizacja: "" }]);
  assert.equal(r.doZmiany.length, 0);
  assert.equal(r.bezZmian, 0);
  assert.match(r.odrzucone[0].powod, /Pusta lokalizacja/);
});

test("nieznany symbol trafia do nieznanych i nic nie kolejkuje", () => {
  const r = L.przeliczImport([{ symbol: "NIE-MA-TAKIEGO", lokalizacja: "A10-06-01" }]);
  assert.deepEqual(r.nieznane, ["NIE-MA-TAKIEGO"]);
  assert.equal(r.doZmiany.length, 0);
});

test("symbol czysto liczbowy dopasowuje się jako tekst", () => {
  /* Excel podaje „440117" jako liczbę. Gdyby czytnik oddał ją jako `440117`
     bez konwersji, symbol nie dopasowałby się do niczego i wiersz zniknąłby
     w „nieznanych" — po cichu, bo lista nieznanych bywa długa. */
  const r = L.przeliczImport([{ symbol: "440117", lokalizacja: "A10-06-02" }]);
  assert.equal(r.doZmiany.length, 1);
  assert.equal(r.doZmiany[0].twId, LICZBOWY);
});

test("wiersz bez symbolu jest pomijany i nie liczy się do wierszy", () => {
  // Stopka albo pusty wiersz na końcu arkusza — nie jest ani zmianą, ani błędem.
  const r = L.przeliczImport([
    { symbol: "", lokalizacja: "" },
    { symbol: "19-25031", lokalizacja: "A10-06-01" },
  ]);
  assert.equal(r.wierszy, 1);
});

test("plik ponad limit jest odrzucany w całości, z podaniem liczby", () => {
  const duzy = Array.from({ length: L.LIMIT_WIERSZY + 1 }, () => ({
    symbol: "19-25031",
    lokalizacja: "A10-06-01",
  }));
  assert.throws(() => L.przeliczImport(duzy), /2000/);
});

/* ── Wybór, co zostaje z obecnego pola (0.139.0) ─────────────────────────── */

test("bez wyboru arkusz podmienia CAŁE pole — zachowanie sprzed 0.139.0", () => {
  const r = L.przeliczImport([{ symbol: "08-25001", lokalizacja: "A10-06-01" }]);
  assert.equal(r.doZmiany[0].po, "A10-06-01");
  // Do wyboru trafiają oba obecne kody, bo arkusz nie zna żadnego z nich.
  assert.deepEqual(r.doZmiany[0].znikaja, ["A05-02-02", "PAL-038"]);
  assert.deepEqual(r.doZmiany[0].zachowane, []);
});

test("zachowany kod zostaje w polu obok adresu z arkusza", () => {
  /* Kartoteka bywa w kilku miejscach naraz i nie wszystkie dotyczą regału,
     który przestawiamy: obok adresu stoi paleta albo bufor, o których arkusz
     nic nie wie. Bez tego wyboru podmiana zdejmowała je po cichu. */
  const r = L.przeliczImport([
    { symbol: "08-25001", lokalizacja: "A10-06-01", zachowaj: ["PAL-038"] },
  ]);
  assert.equal(r.doZmiany[0].po, "A10-06-01 PAL-038");
  assert.deepEqual(r.doZmiany[0].zachowane, ["PAL-038"]);
});

test("do wyboru NIE trafia kod, który arkusz i tak zostawia", () => {
  /* Kod obecny w obu miejscach zostaje niezależnie od decyzji — pytanie o niego
     byłoby wyborem bez różnicy. */
  const r = L.przeliczImport([
    { symbol: "08-25001", lokalizacja: "A10-06-01 PAL-038" },
  ]);
  assert.deepEqual(r.doZmiany[0].znikaja, ["A05-02-02"]);
});

test("zachowanie WSZYSTKIEGO przy adresie, który już jest, to brak zmiany", () => {
  /* Wynik równy stanowi obecnemu nie ma czego zapisywać — inaczej odklikanie
     wszystkich kodów zostawiałoby zadanie, które nic nie robi. */
  const r = L.przeliczImport([
    { symbol: "08-25001", lokalizacja: "A05-02-02", zachowaj: ["PAL-038"] },
  ]);
  assert.equal(r.bezZmian, 1);
  assert.equal(r.doZmiany.length, 0);
});

test("wybór liczy się do limitu pola — zostawienie kodu może go przekroczyć", () => {
  /* Zachowany kod dokłada znaków. Gdyby limit sprawdzał się przed doklejeniem,
     pole wjechałoby do Subiekta dłuższe, niż kolumna przyjmie. */
  const dlugi = "A01-01-01 A02-02-02 A03-03-03 A04-04-04";
  const r = L.przeliczImport([
    { symbol: "08-25001", lokalizacja: dlugi, zachowaj: ["A05-02-02", "PAL-038"] },
  ]);
  assert.equal(r.doZmiany.length, 0);
  assert.match(r.odrzucone[0].powod, /znaków/);
});

test("zachowanie działa dla kodu pisanego małą literą i nie zmienia pisowni", () => {
  /* Pole niesie „paleta64" i „KT1" — kody sprzed wzorca, wpisane ręką.
     Porównanie wprost gubiło te małą literą: człowiek zaznaczał „zostaw",
     a kod i tak znikał. Przepisanie ich wielkimi literami też odpada, bo to
     byłaby zmiana danych, o którą nikt nie prosił. */
  const r = L.przeliczImport([
    { symbol: "W07-0101", lokalizacja: "A10-06-01", zachowaj: ["paleta64", "KT1"] },
  ]);
  assert.equal(r.doZmiany[0].po, "A10-06-01 paleta64 KT1");
});

test("wybór kodu, którego nie ma w polu, jest ignorowany", () => {
  // Wybór z poprzedniego pliku nie ma prawa dokleić adresu spoza kartoteki.
  const r = L.przeliczImport([
    { symbol: "08-25001", lokalizacja: "A10-06-01", zachowaj: ["Z09-09-09"] },
  ]);
  assert.equal(r.doZmiany[0].po, "A10-06-01");
});

/* ── Wykonanie ───────────────────────────────────────────────────────────── */

test("zastosujImport kolejkuje dokładnie tyle zadań, ile obiecał podgląd", () => {
  const r = L.przeliczImport([
    { symbol: "19-25031", lokalizacja: "A10-06-01" },
    { symbol: "S12150", lokalizacja: "A10-06-03" },
    // te trzy nie mają prawa dołożyć zadania
    { symbol: "440117", lokalizacja: "A02-02-02" },
    { symbol: "NIE-MA", lokalizacja: "A10-06-01" },
    { symbol: "08-25001", lokalizacja: "PAL38II" },
  ]);
  assert.equal(r.doZmiany.length, 2);
  assert.equal(L.zastosujImport(r, { nazwa: "Administrator", ref: 1 }), 2);
  assert.equal(zadan(), 2);
  assert.equal(r.zakolejkowano, 2);
});

test("zmiana, która już czeka w kolejce, nie kolejkuje się drugi raz", () => {
  /* Read-model aktualizuje się dopiero po zapisie przez workera, a kolejka
     idzie jedno zadanie na sekundę. Arkusz wgrany drugi raz „dla pewności"
     widzi więc jeszcze STARE adresy — i bez tego licznika zakolejkowałby
     wszystko po raz drugi. Sto duplikatów nie psuje wyniku (ostatnie zadanie
     i tak wygrywa), ale każe czekać dwa razy dłużej. */
  const arkusz = [{ symbol: "19-25031", lokalizacja: "A10-06-01" }];
  L.zastosujImport(L.przeliczImport(arkusz), { nazwa: "Administrator", ref: 1 });
  assert.equal(zadan(), 1);

  const drugi = L.przeliczImport(arkusz);
  assert.equal(drugi.wKolejce, 1);
  assert.equal(drugi.doZmiany.length, 0);
  assert.equal(L.zastosujImport(drugi, { nazwa: "Administrator", ref: 1 }), 0);
  assert.equal(zadan(), 1);
});

test("zadanie w błędzie NIE liczy się jako czekające — bez PONÓW się nie wykona", () => {
  const arkusz = [{ symbol: "19-25031", lokalizacja: "A10-06-01" }];
  L.zastosujImport(L.przeliczImport(arkusz), { nazwa: "Administrator", ref: 1 });
  db().prepare("UPDATE sfera_queue SET status = 'error'").run();

  const drugi = L.przeliczImport(arkusz);
  assert.equal(drugi.wKolejce, 0);
  assert.equal(drugi.doZmiany.length, 1, "wiersz wraca do zrobienia");
});

test("każda zmiana zostawia ślad w audycie ze źródłem „arkusz”", () => {
  /* Zapis lokalizacji nie ma prawa dziać się bez śladu, a przy imporcie
     hurtowym pytanie „skąd to się wzięło" jest pierwsze przy reklamacji. */
  const r = L.przeliczImport([{ symbol: "19-25031", lokalizacja: "A10-06-01" }]);
  L.zastosujImport(r, { nazwa: "Administrator", ref: 1 });
  const w = db()
    .prepare("SELECT type, payload FROM events WHERE tw_id = ?")
    .all(PASEK) as Array<{ type: string; payload: string }>;
  assert.equal(w.length, 1);
  assert.equal(w[0].type, "location_set");
  const p = JSON.parse(w[0].payload) as { zrodlo: string; locsPrzed: string; result: string };
  assert.equal(p.zrodlo, "arkusz");
  assert.equal(p.locsPrzed, "A01-01-01");
  assert.equal(p.result, "A10-06-01");
});

test("zadanie kolejki niesie tw_id — bez niego guard kolejności Sfery nie działa", () => {
  /* Worker Sfery pilnuje „adres przed sprzedawalnością" po KOLUMNIE `tw_id`.
     Zadanie bez niej prześlizgnęłoby się obok guardu i mogło wejść po MM. */
  const r = L.przeliczImport([{ symbol: "19-25031", lokalizacja: "A10-06-01" }]);
  L.zastosujImport(r, { nazwa: "Administrator", ref: 1 });
  const z = db()
    .prepare("SELECT type, tw_id, payload FROM sfera_queue")
    .get() as { type: string; tw_id: number; payload: string };
  assert.equal(z.type, "set_location");
  assert.equal(z.tw_id, PASEK);
  assert.equal(JSON.parse(z.payload).newValue, "A10-06-01");
});
