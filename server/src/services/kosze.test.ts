import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kosze zwrotowe — serwis ─────────────────────────────────────────────────
   Trzy niezmienniki z cichym trybem awarii:

   1. KOSZ WIĄŻE SIĘ Z DOKUMENTEM. Przypięcie przed zleceniem korekty i MM
      albo zamknięcie, zanim dokumenty weszły do Subiekta, kończy się później
      cofnięciem bufora, na którym towaru nigdy nie było — ujemnym stanem.
   2. ADRES PRZED SPRZEDAWALNOŚCIĄ. Zapis lokalizacji z odkładania musi stanąć
      w kolejce PRZED zadaniem MM tego samego towaru.
   3. COFNIĘCIE BUFORA IDZIE SAMO — po zakończeniu każda pozycja ma zadanie
      MM ZWROTY→MAG, jednopozycyjne i z tw_id (przez wzgląd na guard).       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kosz-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zwroty.js");
let K: typeof import("./kosze.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zwroty.js");
  K = await import("./kosze.js");
});

beforeEach(() => {
  const d = db();
  for (const t of [
    "kosz_pozycja", "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot", "kosz",
    "sgt_sprzedaz_pozycja", "sgt_sprzedaz", "sgt_towar", "sgt_stan", "sgt_magazyn",
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
  d.prepare(
    "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, mag_id) VALUES (101,'FS','FS 101/08/2026','dev-ord-1',?, 'ALLEGRO', 1)"
  ).run(new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10));
  const poz = d.prepare("INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (101,?,?)");
  poz.run(900_036, 1);
  poz.run(900_037, 2);

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

/** Zwrot z wystawionymi dokumentami — punkt startu Etapu 3. */
async function zwrotZDokumentami(dokDone = true): Promise<number> {
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") throw new Error("oczekiwano utworzenia");
  for (const p of w.zwrot.pozycje) Z.zapiszDecyzje(w.zwrot.id, p.id, "pelnowartosciowy", null, "Test");
  const queueId = Z.wystawDokumenty(w.zwrot.id, "Test").dokumenty.queueId;
  if (dokDone) {
    db().prepare("UPDATE sfera_queue SET status='done', sgt_doc_number='KFS 1/08/2026' WHERE id=?").run(queueId);
  }
  return w.zwrot.id;
}

test("kosz nie przyjmie zwrotu bez zleconych dokumentów", async () => {
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.throws(() => K.przypnijZwrot(w.zwrot.id, "KZ-01", "Test"), /korektę i MM/);
});

test("przypięcie tworzy kosz przy pierwszym skanie i jest idempotentne", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, " kz-01 ", "Test"); // trim + upper — skan i wpis się spotykają
  K.przypnijZwrot(id, "KZ-01", "Test");   // drugi skan tego samego kosza
  const kosze = K.listaKoszy();
  assert.equal(kosze.length, 1);
  assert.equal(kosze[0].kod, "KZ-01");
  assert.equal(kosze[0].zwrotow, 1);
  assert.throws(() => K.przypnijZwrot(id, "KZ-02", "Test"), /innym koszu/);
  K.odepnijZwrot(id, "Test");
  K.przypnijZwrot(id, "KZ-02", "Test");
});

test("zamknięcie czeka, aż dokumenty NAPRAWDĘ wejdą do Subiekta", async () => {
  const id = await zwrotZDokumentami(false); // zadanie korekty wciąż pending
  K.przypnijZwrot(id, "KZ-01", "Test");
  const koszId = K.listaKoszy()[0].id;
  assert.throws(() => K.zamknijKosz(koszId, "Test"), /nie weszły do Subiekta/);
});

test("snapshot przy zamknięciu: pozycje pełnowartościowe z symbolem i ilością", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
  assert.equal(kosz.status, "zamkniety");
  assert.equal(kosz.pozycje.length, 2);
  // sortowanie alejkowe: towar z adresem przed towarem bez adresu
  assert.equal(kosz.pozycje[0].symbol, "TEST-LINIA-TODO");
  assert.equal(kosz.pozycje[0].lokOczekiwana, "A01-02-03");
  assert.equal(kosz.pozycje[1].lokOczekiwana, null);
  assert.deepEqual(K.koszeDlaKolektora().map((k) => k.kod), ["KZ-01"]);
});

test("skan towaru wskazuje pozycję kosza; cudzy towar mówi „nie z tego kosza”", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
  const poEan = K.skanTowaruKosza(kosz.id, "5900000000037");
  assert.ok("pozycjaId" in poEan);
  const poSymbolu = K.skanTowaruKosza(kosz.id, "test-linia-todo");
  assert.ok("pozycjaId" in poSymbolu);
  db().prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1, 'OBCY', 'Obcy towar', '5901111111111', '')").run();
  assert.deepEqual(K.skanTowaruKosza(kosz.id, "5901111111111"), { poza: true, symbol: "OBCY" });
  assert.deepEqual(K.skanTowaruKosza(kosz.id, "0000000000000"), { nieznany: true });
});

test("odłożenie: zapis adresu tylko przy zmianie, zawsze PRZED zadaniem MM", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
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
  const mm = db()
    .prepare("SELECT id, tw_id, payload FROM sfera_queue WHERE type='mm' ORDER BY id")
    .all() as Array<{ id: number; tw_id: number; payload: string }>;
  assert.equal(mm.length, 2, "MM jednopozycyjne per pozycja kosza");
  for (const zadanie of mm) {
    const p = JSON.parse(zadanie.payload);
    assert.equal(p.magFrom, 3, "z bufora zwrotów");
    assert.equal(p.magTo, 1, "na magazyn główny");
    assert.ok(zadanie.tw_id, "tw_id ustawione — guard kolejności musi widzieć towar");
  }
  // niezmiennik: zapis adresu stoi w kolejce PRZED cofnięciem bufora tego towaru
  const mm37 = mm.find((z) => z.tw_id === 900_037)!;
  assert.ok(setLoc[0].id < mm37.id, "set_location przed mm dla tego samego towaru");

  // drugie kliknięcie ZAKOŃCZ nie dubluje dokumentów
  K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n, 2);

  // kod wraca do obiegu: nowy kosz pod tym samym kodem (inny zwrot — DEVTW0002)
  const w2 = await Z.utworzZeSkanu("DEVTW0002", "Test");
  if (w2.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  for (const p of w2.zwrot.pozycje) Z.zapiszDecyzje(w2.zwrot.id, p.id, "pelnowartosciowy", null, "Test");
  Z.ustawDokument(w2.zwrot.id, 101, "Test");
  const q2 = Z.wystawDokumenty(w2.zwrot.id, "Test").dokumenty.queueId;
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(q2);
  K.przypnijZwrot(w2.zwrot.id, "KZ-01", "Test");
  assert.equal(K.listaKoszy().filter((k) => k.kod === "KZ-01" && k.status === "otwarty").length, 1);
});

test("zakończenie odmawia, dopóki cokolwiek leży w koszu", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");
  assert.throws(() => K.zakonczKosz(kosz.id, "Magazynier"), /Nieodłożone pozycje/);
});

/* ── Pełne rozkładanie kosza (0.77.0) ────────────────────────────────────────
   Kosz zwrotowy dostał to, co linia dostawy: jednostkę, stany magazynów
   i podpowiedź strefy. Do tego POMIŃ — bo pozycja, której w koszu nie ma,
   blokowała wcześniej zakończenie i cały obieg.                             */

test("pozycja niesie jednostkę i stany niezerowe, malejąco", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");

  const p = kosz.pozycje.find((x) => x.twId === 900_036);
  assert.ok(p);
  assert.deepEqual(
    p.stany.map((s) => [s.kod, s.stan]),
    [["MAG", 12], ["ZWR", 3]],
    "magazyn ze stanem zero nie jest odpowiedzią na żadne pytanie przy półce"
  );
  // magazyn bez roli też się liczy — towar bywa u serwisu
  const drugi = kosz.pozycje.find((x) => x.twId === 900_037);
  assert.deepEqual(drugi?.stany.map((s) => s.kod), ["SERW"]);
});

test("pominięcie: powód obowiązkowy, ZAKOŃCZ przechodzi, MM tylko dla odłożonych", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
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

  /* Sedno: MM cofa bufor tylko dla towaru, który NAPRAWDĘ wrócił na halę.
     Przesunięcie pominiętej pozycji zdejmowałoby z bufora coś, czego nikt
     nie ruszył — a to ten sam błąd co dokument wystawiony drugi raz. */
  const mm = db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number };
  assert.equal(mm.n, 1, "jedno MM: za odłożoną pozycję, nie za pominiętą");
});

test("odłożenie cofa pominięcie — znaleziony towar nie wymaga odklikiwania", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");

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
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
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
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
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

test("cofnięcie zakończenia: anuluje MM w kolejce, odmawia po zapisie", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "C01-01-01", "Magazynier");
  K.zakonczKosz(kosz.id, "Magazynier");

  /* Sprawdzenie WSZYSTKICH zadań przed anulowaniem czegokolwiek: jedno MM
     przetworzone ma zablokować całość, a nie zostawić połowy anulowanej. */
  const mm = db().prepare("SELECT id FROM sfera_queue WHERE type='mm'").all() as Array<{ id: number }>;
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(mm[0].id);
  assert.throws(() => K.cofnijZakonczenie(kosz.id, "Magazynier"), /już w Subiekcie/);
  assert.equal(K.szczegolKosza(kosz.id).status, "rozlozony", "kosz nie ruszył się z miejsca");
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='cancelled'").get() as { n: number }).n,
    0,
    "żadne MM nie zostało anulowane przy odmowie"
  );

  db().prepare("UPDATE sfera_queue SET status='pending' WHERE id=?").run(mm[0].id);
  const cofniety = K.cofnijZakonczenie(kosz.id, "Magazynier");
  assert.equal(cofniety.status, "zamkniety", "kosz wraca do rozkładania");
  assert.equal(cofniety.pozycje.every((p) => p.status === "done"), true, "praca zostaje");
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='cancelled'").get() as { n: number }).n,
    mm.length,
    "wszystkie MM anulowane"
  );
});

test("odłożenie na PÓŹNIEJ zsuwa pozycję na koniec listy, bez pomijania jej", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
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
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
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
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
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
