import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kosze zwrotowe — serwis ─────────────────────────────────────────────────
   Dwa niezmienniki z cichym trybem awarii:

   1. ADRES PRZED SPRZEDAWALNOŚCIĄ. Zapis lokalizacji z odkładania musi stanąć
      w kolejce PRZED zadaniem MM tego samego towaru.
   2. ZAKOŃCZENIE NIE WYSTAWIA DOKUMENTU. Kosz przyjechał dokumentem MM
      z Subiekta i dokument powrotny też wystawia biuro — drugie MM z aplikacji
      przesuwałoby towar, którego nikt nie ruszał.

   Trzeci niezmiennik — „kosz wiąże się z dokumentem korekty" — zniknął
   w 0.138.0 razem z rejestrem zwrotów. Kosz powstaje teraz WYŁĄCZNIE
   z dokumentu MM ZWROTY wystawionego w Subiekcie (`otworzPrzyjecie`), więc
   dokument jest warunkiem jego istnienia, a nie regułą do pilnowania.      */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kosz-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let K: typeof import("./kosze.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  K = await import("./kosze.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["kosz_pozycja", "kosz", "sgt_towar", "sgt_stan", "sgt_magazyn",
    "sfera_queue",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const ins = d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,?)"
  );
  ins.run(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta", "", "A01-02-03");
  ins.run(900_037, "TEST-LINIA-DONE", "Pozycja odłożona w całości", "5900000000037", "");
  ins.run(900_029, "TEST-ROTUJACY", "Szybkorotujący", "", "C01-01-01");
  /* Magazyny i stany — do linijki „gdzie tego jeszcze jest" pod pozycją kosza.
     ZWR jest tu najciekawszy: to z niego rozkładany towar właśnie schodzi. */
  const mag = d.prepare("INSERT INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)");
  mag.run(1, "MAG", "Główny");
  mag.run(2, "MGP", "Przyjęcia");
  mag.run(3, "ZWR", "Regał zwrotów");
  mag.run(9, "SERW", "Serwis");
  const stan = d.prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,0)");
  stan.run(900_036, 1, 12);
  stan.run(900_036, 3, 3);
  stan.run(900_036, 2, 0); // zerowy — nie ma prawa wejść na listę
  stan.run(900_037, 9, 4);
});

/**
 * Kosz gotowy do rozkładania — dokładnie taki, jaki rodzi `otworzPrzyjecie`
 * z dokumentu MM ZWROTY: od razu ZAMKNIĘTY, z pozycjami i bez ani jednego
 * odwołania do zwrotu. Wstawiamy go SQL-em, a nie przez przyjęcia, żeby ten
 * plik testował rozkładanie, a nie import dokumentu (ten ma własny test
 * w `przyjecia.test.ts`).
 */
function koszDoRozkladania(kod = "KZ-01"): ReturnType<typeof K.szczegolKosza> {
  const d = db();
  const teraz = new Date().toISOString();
  const kosz = d
    .prepare(
      `INSERT INTO kosz(kod, status, mm_dok_id, mm_numer, utworzono_at, utworzono_przez,
                        zamknieto_at, zamknieto_przez)
       VALUES (?, 'zamkniety', 1209, ?, ?, 'Test', ?, 'Test')`
    )
    .run(kod, kod, teraz, teraz);
  const koszId = Number(kosz.lastInsertRowid);
  const ins = d.prepare(
    "INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc) VALUES (?,?,?,?,?)"
  );
  ins.run(koszId, 900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta", 1);
  ins.run(koszId, 900_037, "TEST-LINIA-DONE", "Pozycja odłożona w całości", 2);
  return K.szczegolKosza(koszId);
}

test("snapshot przy zamknięciu: pozycje pełnowartościowe z symbolem i ilością", async () => {
  const kosz = koszDoRozkladania();
  assert.equal(kosz.status, "zamkniety");
  assert.equal(kosz.pozycje.length, 2);
  // sortowanie alejkowe: towar z adresem przed towarem bez adresu
  assert.equal(kosz.pozycje[0].symbol, "TEST-LINIA-TODO");
  assert.equal(kosz.pozycje[0].lokOczekiwana, "A01-02-03");
  assert.equal(kosz.pozycje[1].lokOczekiwana, null);
  assert.deepEqual(K.koszeDlaKolektora().map((k) => k.kod), ["KZ-01"]);
});

test("skan towaru wskazuje pozycję kosza; cudzy towar mówi „nie z tego kosza”", async () => {
  const kosz = koszDoRozkladania();
  const poEan = K.skanTowaruKosza(kosz.id, "5900000000037");
  assert.ok("pozycjaId" in poEan);
  const poSymbolu = K.skanTowaruKosza(kosz.id, "test-linia-todo");
  assert.ok("pozycjaId" in poSymbolu);
  db().prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1, 'OBCY', 'Obcy towar', '5901111111111', '')").run();
  assert.deepEqual(K.skanTowaruKosza(kosz.id, "5901111111111"), { poza: true, symbol: "OBCY" });
  assert.deepEqual(K.skanTowaruKosza(kosz.id, "0000000000000"), { nieznany: true });
});

test("odłożenie: zapis adresu tylko przy zmianie, zawsze PRZED zadaniem MM", async () => {
  const kosz = koszDoRozkladania();
  const [zAdresem, bezAdresu] = kosz.pozycje;

  // towar wraca na SWOJĄ półkę → zero zapisu lokalizacji
  const r1 = K.odlozPozycje(zAdresem.id, "A01-02-03", "Magazynier");
  assert.equal(r1.mismatch, false);
  // towar bez adresu w kartotece → zapis lokalizacji idzie do kolejki
  K.odlozPozycje(bezAdresu.id, "B02-01-01", "Magazynier");
  const setLoc = db()
    .prepare("SELECT id, tw_id FROM sfera_queue WHERE type='set_location'")
    .all() as Array<{ id: number; tw_id: number }>;
  assert.deepEqual(setLoc.map((s) => s.tw_id), [900_037]);

  /* Do 0.79.0 stała tu odmowa „pozycja jest już odłożona". Zniknęła razem
     z dopuszczeniem POPRAWKI: zły regał zeskanowany pomyłkowo prostuje się
     skanem właściwego, bo COFNIJ po zapisie do Subiekta jest zamknięte,
     a magazynier nie może zostać z towarem na złej półce i bez wyjścia. */
  K.odlozPozycje(zAdresem.id, "D04-04-04", "Magazynier");
  const poprawiona = K.szczegolKosza(kosz.id).pozycje.find((x) => x.id === zAdresem.id);
  assert.equal(poprawiona?.lokFaktyczna, "D04-04-04", "nowy adres nadpisuje stary");
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='set_location'").get() as { n: number }).n,
    2,
    "poprawka to DRUGI zapis adresu — kartoteka musi się dowiedzieć o zmianie"
  );

  assert.throws(() => K.zakonczKosz(0, "Magazynier"), /nie istnieje/);

  const rozlozony = K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal(rozlozony.status, "rozlozony");
  /* Zakończenie kosza z dokumentu NIE kolejkuje MM: przesunięcie powrotne
     wystawia biuro w Subiekcie. Drugi dokument na ten sam towar byłby
     przesunięciem, którego nikt nie zamawiał. */
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n,
    0,
    "kolektor zapisuje adresy, dokumenty wystawia biuro"
  );
  // drugie kliknięcie ZAKOŃCZ niczego nie powtarza
  K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal(K.szczegolKosza(kosz.id).status, "rozlozony");

  /* Kod wraca do obiegu: rozłożony kosz zwalnia etykietę, więc następne
     przyjęcie może ją nosić. Pilnuje tego indeks częściowy `ix_kosz_kod_aktywny`
     — bez zwolnienia drugie wstawienie rozbiłoby się o unikalność. */
  const nastepny = koszDoRozkladania("KZ-01");
  assert.equal(nastepny.kod, "KZ-01");
  assert.equal(K.listaKoszy().filter((k) => k.kod === "KZ-01").length, 2);
});

test("zakończenie odmawia, dopóki cokolwiek leży w koszu", async () => {
  const kosz = koszDoRozkladania();
  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");
  assert.throws(() => K.zakonczKosz(kosz.id, "Magazynier"), /Nieodłożone pozycje/);
});

/* ── Pełne rozkładanie kosza (0.77.0) ────────────────────────────────────────
   Kosz zwrotowy dostał to, co linia dostawy: jednostkę, stany magazynów
   i podpowiedź strefy. Do tego POMIŃ — bo pozycja, której w koszu nie ma,
   blokowała wcześniej zakończenie i cały obieg.                             */

test("pozycja niesie jednostkę i stany niezerowe, malejąco", async () => {
  const kosz = koszDoRozkladania();

  const p = kosz.pozycje.find((x) => x.twId === 900_036);
  assert.ok(p);
  assert.deepEqual(
    p.stany.map((s) => [s.kod, s.stan]),
    [["MAG", 12], ["ZWR", 3]],
    "magazyn ze stanem zero nie jest odpowiedzią na żadne pytanie przy półce"
  );
  /* ROLA jedzie razem ze stanem (0.118.0): kolektor wyróżnia po niej regał
     zwrotów, bo to jego licznik schodzi do zera w miarę rozkładania. Kod
     magazynu jest napisem z konfiguracji klienta, więc rozpoznawanie po nim
     byłoby magicznym łańcuchem psującym się przy zmianie w Subiekcie. */
  assert.deepEqual(
    p.stany.map((s) => s.rola),
    ["MAG", "ZWROTY"]
  );
  // magazyn bez roli też się liczy — towar bywa u serwisu
  const drugi = kosz.pozycje.find((x) => x.twId === 900_037);
  assert.deepEqual(drugi?.stany.map((s) => s.kod), ["SERW"]);
  assert.deepEqual(drugi?.stany.map((s) => s.rola), [null], "magazyn bez roli mówi null");
});

test("pominięcie: powód obowiązkowy, ZAKOŃCZ przechodzi, MM tylko dla odłożonych", async () => {
  const kosz = koszDoRozkladania();
  assert.equal(kosz.pozycje.length, 2);

  assert.throws(() => K.pominPozycjeKosza(kosz.pozycje[0].id, "  ", "Magazynier"), /Podaj powód/);

  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");
  K.pominPozycjeKosza(kosz.pozycje[1].id, "nie ma w koszu", "Magazynier");
  // idempotentne — drugi klik zmienia najwyżej powód
  K.pominPozycjeKosza(kosz.pozycje[1].id, "uszkodzony", "Magazynier");

  const rozlozony = K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal(rozlozony.status, "rozlozony");
  const pominieta = rozlozony.pozycje.find((p) => p.status === "skipped");
  assert.equal(pominieta?.powod, "uszkodzony");

  /* Sedno POMINIĘCIA: pozycja, której w koszu nie było, nie blokuje obiegu,
     ale zostaje widoczna z powodem — biuro dostaje ją na osobnej liście. */
  const wPominietych = K.pominietePozycje().filter((p) => p.kod === kosz.kod);
  assert.equal(wPominietych.length, 1, "pominięta trafia na listę pracy biura");
});

test("odłożenie cofa pominięcie — znaleziony towar nie wymaga odklikiwania", async () => {
  const kosz = koszDoRozkladania();

  K.pominPozycjeKosza(kosz.pozycje[0].id, "nie ma w koszu", "Magazynier");
  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");

  const po = K.szczegolKosza(kosz.id).pozycje.find((p) => p.id === kosz.pozycje[0].id);
  assert.equal(po?.status, "done");
  assert.equal(po?.powod, null, "powód znika razem z pominięciem");
  // odłożonej nie da się pominąć — pomijanie dotyczy towaru, którego nie ma
  assert.throws(() => K.pominPozycjeKosza(kosz.pozycje[0].id, "uszkodzony", "X"), /odłożona/);
});

/* ── Cofanie pomyłek i „wrócę do tego" (0.79.0) ──────────────────────────────
   Granica przechodzi przez SUBIEKTA: dopóki zapis czeka w kolejce, aplikacja
   cofa wszystko bez śladu; po zapisie nie cofa nic i mówi to wprost.        */

test("cofnięcie odłożenia anuluje zapis adresu, dopóki ten czeka w kolejce", async () => {
  const kosz = koszDoRozkladania();
  const p = kosz.pozycje.find((x) => x.twId === 900_037)!; // bez adresu w kartotece

  K.odlozPozycje(p.id, "B02-01-01", "Magazynier");
  K.cofnijOdlozenie(p.id, "Magazynier");

  const po = K.szczegolKosza(kosz.id).pozycje.find((x) => x.id === p.id);
  assert.equal(po?.status, "todo", "pozycja wraca do pracy");
  assert.equal(po?.lokFaktyczna, null, "adres znika razem z odłożeniem");
  const q = db()
    .prepare("SELECT status FROM sfera_queue WHERE type='set_location'")
    .all() as Array<{ status: string }>;
  assert.deepEqual(q.map((x) => x.status), ["cancelled"], "zapis do Subiekta anulowany");
});

test("po zapisie adresu do Subiekta cofnięcie odmawia i mówi, co zrobić", async () => {
  const kosz = koszDoRozkladania();
  const p = kosz.pozycje.find((x) => x.twId === 900_037)!;

  K.odlozPozycje(p.id, "B02-01-01", "Magazynier");
  // worker zabrał zadanie i zapisał je w bazie firmy
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();

  assert.throws(() => K.cofnijOdlozenie(p.id, "Magazynier"), /już w Subiekcie/);
  // droga wyjścia zostaje: poprawka adresu kolejnym skanem
  K.odlozPozycje(p.id, "C03-03-03", "Magazynier");
  assert.equal(
    K.szczegolKosza(kosz.id).pozycje.find((x) => x.id === p.id)?.lokFaktyczna,
    "C03-03-03"
  );
});

test("cofnięcie zakończenia zdejmuje ślad rozłożenia, praca zostaje", () => {
  const kosz = koszDoRozkladania();
  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "C01-01-01", "Magazynier");
  K.zakonczKosz(kosz.id, "Magazynier");

  /* Ślad rozłożenia jedzie na ekran biura. Druga połowa tej samej reguły:
     kosz cofnięty NIE jest rozłożony przez nikogo. Nazwisko, które zostałoby
     po cofnięciu, byłoby gorsze niż jego brak — mówiłoby o pracy, której
     w tej chwili nie ma. */
  const poZakonczeniu = K.szczegolKosza(kosz.id);
  assert.equal(poZakonczeniu.rozlozonoPrzez, "Magazynier");
  assert.ok(poZakonczeniu.rozlozonoAt);

  const cofniety = K.cofnijZakonczenie(kosz.id, "Magazynier");
  assert.equal(cofniety.status, "zamkniety", "kosz wraca do rozkładania");
  assert.equal(cofniety.pozycje.every((p) => p.status === "done"), true, "praca zostaje");
  assert.equal(cofniety.rozlozonoPrzez, null, "ślad rozłożenia znika razem z rozłożeniem");
  assert.equal(cofniety.rozlozonoAt, null);
  assert.equal(K.listaKoszy()[0].rozlozonoPrzez, null, "lista biura mówi to samo co szczegół");
  /* Zapisów adresu cofnięcie NIE rusza: towar naprawdę leży tam, gdzie go
     odłożono, a kartoteka ma o tym wiedzieć niezależnie od stanu kosza. */
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='set_location' AND status='cancelled'").get() as { n: number }).n,
    0
  );
});
test("odłożenie na PÓŹNIEJ zsuwa pozycję na koniec listy, bez pomijania jej", async () => {
  const kosz = koszDoRozkladania();
  const pierwsza = kosz.pozycje[0];

  const po = K.przesunNaKoniec(pierwsza.id, "Magazynier");
  assert.equal(po.pozycje[po.pozycje.length - 1].id, pierwsza.id, "zjeżdża na sam koniec");
  const zsunieta = po.pozycje.find((x) => x.id === pierwsza.id);
  assert.equal(zsunieta?.status, "todo", "to nie jest pominięcie — kosz nadal jej czeka");
  assert.ok(zsunieta?.pozniejAt, "znacznik czasu trzyma kolejność między odłożonymi");

  // ZAKOŃCZ nadal jej nie przepuszcza
  assert.throws(() => K.zakonczKosz(kosz.id, "Magazynier"), /Nieodłożone pozycje/);
  // odłożenie kasuje znacznik i przywraca porządek alejkowy
  K.odlozPozycje(pierwsza.id, "A01-02-03", "Magazynier");
  assert.equal(
    K.szczegolKosza(kosz.id).pozycje.find((x) => x.id === pierwsza.id)?.pozniejAt,
    null
  );
});

test("cofnięcie pominięcia przywraca pozycję do pracy", async () => {
  const kosz = koszDoRozkladania();
  const p = kosz.pozycje[0];

  K.pominPozycjeKosza(p.id, "nie ma w koszu", "Magazynier");
  const po = K.cofnijPozycje(p.id, "Magazynier"); // jedno „cofnij" — serwer wie, co cofa
  const wrocila = po.pozycje.find((x) => x.id === p.id);
  assert.equal(wrocila?.status, "todo");
  assert.equal(wrocila?.powod, null, "powód znika razem z pominięciem");
});

test("odłożona pozycja zjeżdża na koniec listy, kolejna zostaje na górze", async () => {
  /* Lista kosza odpowiada na jedno pytanie: „co jeszcze zostało". Zwinięty
     pasek zrobionej pozycji dalej zajmuje ekran, więc przy koszu na dwadzieścia
     pozycji do roboty trzeba było PRZEWIJAĆ przez robotę już wykonaną. Ta sama
     lekcja, którą rozkładanie dostaw odrobiło w 0.35.0. */
  const kosz = koszDoRozkladania();
  const [pierwsza, druga] = kosz.pozycje;

  K.odlozPozycje(pierwsza.id, "A01-02-03", "Magazynier");
  const po = K.szczegolKosza(kosz.id);
  assert.deepEqual(
    po.pozycje.map((p) => [p.id, p.status]),
    [[druga.id, "todo"], [pierwsza.id, "done"]],
    "odłożona schodzi pod czekającą, mimo kolejności alejkowej"
  );

  /* Pominięta też jest zrobiona — jedna grupa na dole, w kolejności
     wykonania, żeby ostatnio tknięta stała tam, gdzie szuka się jej,
     wracając po cofnięcie. Znaczniki czasu wpisujemy ręką: dwa wywołania
     w tej samej milisekundzie dałyby remis i test mierzyłby zegar,
     a nie regułę. */
  K.pominPozycjeKosza(druga.id, "nie ma w koszu", "Magazynier");
  const d = db();
  d.prepare("UPDATE kosz_pozycja SET odlozono_at='2026-08-22T10:00:00.000Z' WHERE id=?").run(pierwsza.id);
  d.prepare("UPDATE kosz_pozycja SET pominieto_at='2026-08-22T09:00:00.000Z' WHERE id=?").run(druga.id);
  assert.deepEqual(
    K.szczegolKosza(kosz.id).pozycje.map((p) => p.id),
    [druga.id, pierwsza.id],
    "wcześniej tknięta stoi wyżej"
  );

  // cofnięcie odłożenia przywraca pozycję na trasę, czyli NAD zrobione
  K.cofnijPozycje(pierwsza.id, "Magazynier");
  assert.deepEqual(
    K.szczegolKosza(kosz.id).pozycje.map((p) => [p.id, p.status]),
    [[pierwsza.id, "todo"], [druga.id, "skipped"]]
  );
});

test("pozycja niesie WSZYSTKIE półki towaru, pickingową pierwszą", async () => {
  /* Zwrot wraca pojedynczo i najtaniej dołożyć go tam, gdzie ten towar już
     leży. Kolektor znał dotąd sam adres pickingowy, więc po resztę trzeba było
     wyjść z kosza do karty towaru — czyli zgubić wskazaną pozycję. */
  db().prepare("UPDATE sgt_towar SET lokalizacja=? WHERE tw_id=?")
    .run("A01-02-03 B04-01-02", 900_036);
  const kosz = koszDoRozkladania();

  const p = kosz.pozycje.find((x) => x.twId === 900_036);
  assert.deepEqual(p?.lokalizacje, ["A01-02-03", "B04-01-02"]);
  assert.equal(p?.lokOczekiwana, "A01-02-03", "pickingowa zostaje adresem docelowym");
  // towar bez adresu w kartotece nie dostaje zgadywanki, tylko pustkę
  assert.deepEqual(kosz.pozycje.find((x) => x.twId === 900_037)?.lokalizacje, []);

  /* Lista jest ŻYWA tak samo jak adres pickingowy: zadanie czekające
     w kolejce liczy się, zanim worker dopisze je do Subiekta. */
  K.odlozPozycje(p!.id, "C09-09-09", "Magazynier");
  assert.deepEqual(
    K.szczegolKosza(kosz.id).pozycje.find((x) => x.twId === 900_036)?.lokalizacje,
    ["C09-09-09", "B04-01-02"]
  );
});

test("karton nie miesza się z obiegiem zwrotów", async () => {
  /* Karton (0.122.0) mieszka w tej samej tabeli, bo rozkłada się go tak samo.
     Wszystko PRZED rozkładaniem jest jednak inne i granica musi być twarda:
     zawartość kartonu zbiera hala, a kosz przyjeżdża dokumentem z Subiekta. */
  const KA = await import("./karton.js");
  const karton = KA.zalozKarton("Magazynier");
  const kosz = koszDoRozkladania();

  assert.equal(K.koszPoKodzie(karton.kod), undefined, "kod kartonu nie jest kodem kosza");
  assert.throws(
    () => KA.dodajDoKartonu(kosz.id, { code: "TEST-LINIA-TODO" }, 1, "Magazynier"),
    /to zwroty/
  );
});
