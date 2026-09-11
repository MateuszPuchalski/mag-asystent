import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kosze zwrotowe — serwis ─────────────────────────────────────────────────
   Dwa niezmienniki z cichym trybem awarii:

   1. ADRES PRZED SPRZEDAWALNOŚCIĄ. Zapis lokalizacji z odkładania musi stanąć
      w kolejce PRZED zadaniem MM tego samego towaru.
   2. POWRÓT WRACA TAM, SKĄD TOWAR PRZYJECHAŁ. Kosz złożony w aplikacji
      (0.192.0) sam wysłał towar na regał, więc od 0.266.0 sam go stamtąd
      zdejmuje jednym MM ZWROTY→MAG. Kosz z dokumentu MM robi od 0.277.0
      dokładnie to samo, tylko kierunek bierze z TAMTEGO dokumentu
      (`kosz.mm_mag_z`), a nie z konfiguracji. Nieznany kierunek to brak
      dokumentu — zgadnięty magazyn przesuwałby towar naprawdę.

   3. POWRÓT CZEKA NA ADRESY. MM na magazyn sprzedażowy czyni towar
      sprzedawalnym, a guard workera pilnuje kolejności po kolumnie `tw_id` —
      dokument wielopozycyjny przechodzi obok niego. Dlatego zadanie powstaje
      dopiero wtedy, gdy każdy adres z tego kosza siedzi już w Subiekcie.  */

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
    /* Oś zwrotu doszła w 0.269.0: rozkładanie dopisuje na nią ślad, więc
       zdarzenia z poprzedniego testu policzyłyby się w następnym. */
    "zwrot_zdarzenie", "zwrot_klienta_pozycja", "zwrot_klienta", "channel_account",
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
      `INSERT INTO kosz(kod, status, mm_dok_id, mm_numer, mm_mag_z,
                        utworzono_at, utworzono_przez, zamknieto_at, zamknieto_przez)
       VALUES (?, 'zamkniety', 1209, ?, 1, ?, 'Test', ?, 'Test')`
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
  /* Dokumentu jeszcze nie ma i to NIE dlatego, że kosz jest z dokumentu
     (do 0.276.x tak właśnie było) — dwa adresy wiszą w kolejce, a powrót czeka
     na nie tak samo jak przy koszu z panelu. */
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n,
    0,
    "adres przed sprzedawalnością — najpierw kartoteka, potem stan"
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

/**
 * Kosz złożony w APLIKACJI: bez `mm_dok_id`, bo przesunięcie na regał zamówił
 * panel (`kosze-zwrotow.ts`). To ten kosz zdejmuje towar z bufora po
 * rozłożeniu — i tylko ten.
 */
function koszAplikacji(kod = "Z-7", rodzaj = "zwroty"): ReturnType<typeof K.szczegolKosza> {
  const d = db();
  const teraz = new Date().toISOString();
  const kosz = d
    .prepare(
      `INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez,
                        zamknieto_at, zamknieto_przez)
       VALUES (?, 'zamkniety', ?, ?, 'Biuro', ?, 'Biuro')`
    )
    .run(kod, rodzaj, teraz, teraz);
  const koszId = Number(kosz.lastInsertRowid);
  const ins = d.prepare(
    "INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc) VALUES (?,?,?,?,?)"
  );
  /* Ten sam towar dwa razy — dwie pozycje z dwóch zwrotów. Dokument ma je
     ZSUMOWAĆ w jedną linię, tak samo jak MM na bufor. */
  ins.run(koszId, 900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta", 1);
  ins.run(koszId, 900_036, "TEST-LINIA-TODO", "Ta sama kartoteka z drugiego zwrotu", 2);
  ins.run(koszId, 900_037, "TEST-LINIA-DONE", "Pozycja odłożona w całości", 1);
  return K.szczegolKosza(koszId);
}

test("kosz z aplikacji cofa bufor JEDNYM MM ZWROTY→MAG", async () => {
  /* Blizna: do 0.264.0 łańcuch kończył się na zapisie adresów. Towar leżał
     na półce, a stan wisiał na regale zwrotów — sprzedawalny nie był, dopóki
     biuro nie wystawiło drugiego dokumentu ręką. */
  const kosz = koszAplikacji();
  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "A01-02-03", "Magazynier");
  /* Adresy muszą wejść do Subiekta PRZED dokumentem — tu udajemy workera. */
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();

  K.zakonczKosz(kosz.id, "Magazynier");

  const mm = db()
    .prepare("SELECT payload, tw_id FROM sfera_queue WHERE type='mm'")
    .all() as Array<{ payload: string; tw_id: number | null }>;
  assert.equal(mm.length, 1, "jeden kosz to jeden dokument — decyzja właściciela");
  const p = JSON.parse(mm[0].payload) as { magFrom: number; magTo: number; items: Array<{ twId: number; qty: number }> };
  assert.equal(p.magFrom, 3, "z regału zwrotów");
  assert.equal(p.magTo, 1, "na halę");
  assert.deepEqual(
    p.items.map((i) => [i.twId, i.qty]).sort((a, b) => a[0] - b[0]),
    [[900_036, 3], [900_037, 1]],
    "ta sama kartoteka z dwóch zwrotów to JEDNA linia dokumentu"
  );

  const szczegol = K.szczegolKosza(kosz.id);
  assert.equal(szczegol.powrot?.status, "pending", "biuro czyta stan powrotu z karty kosza");

  /* Drugie ZAKOŃCZ nie wystawia drugiego dokumentu — kolumna `powrot_queue_id`
     jest tu pamięcią, nie ozdobą. */
  K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n,
    1
  );
});

test("powrót czeka na zapis adresów i wychodzi dopiero po nim", async () => {
  /* Niezmiennik „adres przed sprzedawalnością". Guard workera pilnuje go po
     kolumnie `tw_id`, a ten dokument jest wielopozycyjny — więc pilnuje go
     kod, nie SQL: dopóki adres wisi w kolejce, dokumentu nie ma wcale. */
  const kosz = koszAplikacji("Z-8");
  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "B02-01-01", "Magazynier");
  K.zakonczKosz(kosz.id, "Magazynier");

  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n,
    0,
    "adresy jeszcze nie weszły — dokument nie ma prawa powstać"
  );
  assert.equal(K.szczegolKosza(kosz.id).powrot, null);

  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();
  assert.equal(K.wypuscPowrotyKoszy(), 1, "adres zapisany — powrót wychodzi");
  assert.equal(K.wypuscPowrotyKoszy(), 0, "i tylko raz");
  assert.equal(K.szczegolKosza(kosz.id).powrot?.status, "pending");
});

test("pominięta pozycja nie wraca z bufora — nikt jej nie przeniósł", async () => {
  const kosz = koszAplikacji("Z-9");
  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");
  K.pominPozycjeKosza(kosz.pozycje[1].id, "brak_w_koszu", "Magazynier");
  K.pominPozycjeKosza(kosz.pozycje[2].id, "brak_w_koszu", "Magazynier");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();

  K.zakonczKosz(kosz.id, "Magazynier");

  const mm = db().prepare("SELECT payload FROM sfera_queue WHERE type='mm'").all() as
    Array<{ payload: string }>;
  assert.equal(mm.length, 1);
  const items = (JSON.parse(mm[0].payload) as { items: Array<{ twId: number; qty: number }> }).items;
  assert.deepEqual(items.map((i) => [i.twId, i.qty]), [[900_036, 1]],
    "z bufora schodzi WYŁĄCZNIE to, co magazynier naprawdę odłożył");
});

test("rozłożenie i pominięcie zostawiają ślad na osi ZWROTU", async () => {
  /* Kosz wie, z której pozycji zwrotu wziął towar, od 0.192.0 — ale nikt nie
     czytał tego w drugą stronę. Biuro patrzące na zwrot nie widziało ani
     tego, że towar wrócił na półkę, ani tego, że go w koszu nie było. */
  const d = db();
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  const zwrotId = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-slad','2026-09-01T08:00:00Z','2026-09-01T09:00:00Z')`).run().lastInsertRowid);
  const pozZwrotu = Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,klucz)
    VALUES (?,'111','Sekator',1,4999,'PLN','111|Sekator')`).run(zwrotId).lastInsertRowid);

  const kosz = koszAplikacji("Z-12");
  d.prepare("UPDATE kosz_pozycja SET zwrot_pozycja_id=? WHERE id=?")
    .run(pozZwrotu, kosz.pozycje[0].id);

  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");
  K.pominPozycjeKosza(kosz.pozycje[1].id, "brak_w_koszu", "Magazynier");

  const os = d.prepare("SELECT rodzaj, tresc, kto FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY id")
    .all(zwrotId) as Array<{ rodzaj: string; tresc: string; kto: string }>;
  assert.deepEqual(os.map((z) => z.rodzaj), ["rozlozenie"],
    "pominięta pozycja należała do innego zwrotu — cudzej osi nie zaśmieca");
  assert.match(os[0].tresc, /A01-02-03/, "zdanie mówi, GDZIE leży towar");
  assert.match(os[0].tresc, /Z-12/);
  assert.equal(os[0].kto, "Magazynier");

  /* Ta sama pozycja pominięta po odłożeniu dopisuje DRUGIE zdanie: obie
     decyzje hali są faktami o tym samym towarze. */
  d.prepare("UPDATE kosz_pozycja SET status='todo' WHERE id=?").run(kosz.pozycje[0].id);
  K.pominPozycjeKosza(kosz.pozycje[0].id, "jednak go nie ma", "Magazynier");
  const po = d.prepare("SELECT rodzaj FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY id")
    .all(zwrotId) as Array<{ rodzaj: string }>;
  assert.deepEqual(po.map((z) => z.rodzaj), ["rozlozenie", "kosz_pominiety"]);
});

test("kosz bez zwrotu rozkłada się bez śladu — nie ma gdzie go dopisać", async () => {
  /* Kosz z dokumentu MM z Subiekta i karton nie mają zwrotu. Brak osi nie
     jest awarią rozkładania i nie ma prawa wywrócić odłożenia. */
  const kosz = koszDoRozkladania("KZ-slad");
  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM zwrot_zdarzenie").get() as { n: number }).n, 0);
});

test("kosz z dokumentu wraca NA MAGAZYN, z którego dokument go wysłał", async () => {
  /* Usterka zgłoszona 11 września 2026: „przesunięcia nie robią się
     automatycznie, gdy zamyka się rozłożony koszyk na magazyn główny". Kosz
     z kartki kończył się zapisaniem adresów, a drugi dokument wystawiało biuro
     ręką — dokładnie ta sama blizna, którą kosze z panelu zamknęły w 0.266.0.

     Magazyn docelowy bierze się z DOKUMENTU (`mm_mag_z`), nie z konfiguracji:
     filtr importu pilnuje wyłącznie odbiorcy przesunięcia, o nadawcy nie mówi
     nic. Dlatego tu stoi dwójka (MGP), a nie domyślna jedynka. */
  const kosz = koszDoRozkladania("KZ-77");
  db().prepare("UPDATE kosz SET mm_mag_z=2 WHERE id=?").run(kosz.id);
  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "A01-02-03", "Magazynier");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();

  K.zakonczKosz(kosz.id, "Magazynier");

  const mm = db().prepare("SELECT payload FROM sfera_queue WHERE type='mm'").all() as
    Array<{ payload: string }>;
  assert.equal(mm.length, 1, "jeden kosz to jeden dokument, tak samo jak przy koszu z panelu");
  const p = JSON.parse(mm[0].payload) as
    { magFrom: number; magTo: number; items: Array<{ twId: number; qty: number }> };
  assert.equal(p.magFrom, 3, "z regału zwrotów — importer bierze tylko dokumenty z tym odbiorcą");
  assert.equal(p.magTo, 2, "na magazyn, który towar wysłał, a nie na domyślny główny");
  assert.deepEqual(
    p.items.map((i) => [i.twId, i.qty]).sort((a, b) => a[0] - b[0]),
    [[900_036, 1], [900_037, 2]]
  );
  assert.equal(K.szczegolKosza(kosz.id).powrot?.status, "pending");

  /* Drugie ZAKOŃCZ nie wystawia drugiego dokumentu — przesunięcie zrobione
     dwa razy zdjęłoby z regału stan, którego nikt nie przeniósł. */
  K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n,
    1
  );
});

test("kosz z dokumentu bez znanego magazynu źródłowego powrotu nie dostaje", async () => {
  /* Lustro `sgt_mm_zwrot` sięga tyle dni wstecz, ile mówi MM_ZWROTY_DNI_WSTECZ,
     a kosz otwarty przed 0.277.0 snapshotu nie ma. Zgadnięty magazyn przesuwa
     towar NAPRAWDĘ i nie cofa się jednym kliknięciem, więc dokumentu nie ma
     wcale — kosz zgłosi się w rekoncyliacji i zamknie go biuro ręką. */
  const kosz = koszDoRozkladania("KZ-78");
  db().prepare("UPDATE kosz SET mm_mag_z=NULL WHERE id=?").run(kosz.id);
  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "A01-02-03", "Magazynier");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();

  K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal(K.zakolejkujPowrot(kosz.id, "Magazynier"), null);
  assert.equal(K.wypuscPowrotyKoszy(), 0);
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n,
    0
  );

  /* Ten sam kosz z magazynem wskazującym na regał zwrotów też milczy:
     przesunięcie samo do siebie nie jest dokumentem, tylko pomyłką. */
  db().prepare("UPDATE kosz SET mm_mag_z=3 WHERE id=?").run(kosz.id);
  assert.equal(K.zakolejkujPowrot(kosz.id, "Magazynier"), null);
});

test("kosz rozłożony przed 0.266.0 powrotu nie dostaje", async () => {
  /* Rozliczyło go biuro ręką w Subiekcie. Dokument wystawiony dziś przesunąłby
     stan DRUGI raz, po miesiącach, na towar, którego nikt nie ruszał — więc
     migracja stempluje zastane kosze, a serwis ten stempel czyta. */
  const kosz = koszAplikacji("Z-11");
  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "A01-02-03", "Magazynier");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();
  db().prepare("UPDATE kosz SET status='rozlozony', powrot_poza_aplikacja=1 WHERE id=?")
    .run(kosz.id);

  assert.equal(K.zakolejkujPowrot(kosz.id, "Magazynier"), null);
  assert.equal(K.wypuscPowrotyKoszy(), 0);
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n,
    0
  );
});

test("koszyk odpadu nie jest pracą hali i nie cofa bufora", async () => {
  /* 0.211.0 dołożyło rodzaj koszy i nie ruszyło listy dla kolektora, więc
     kosz odpadu wyglądał tam jak każdy inny. Magazynier odłożyłby złom na
     regał i wpisał mu adres pickingowy do kartoteki. */
  const odpad = koszAplikacji("Z-10", "odpad");
  assert.equal(
    K.koszeDlaKolektora().some((k) => k.id === odpad.id),
    false,
    "utylizacja ma ze stanu ZEJŚĆ, a nie wrócić na półkę"
  );
  /* Nawet postawiony na siłę w stanie „rozłożony" powrotu nie dostaje —
     bramka stoi na RODZAJU, nie na tym, że kosz odpadu nie trafia na halę. */
  db().prepare("UPDATE kosz SET status='rozlozony' WHERE id=?").run(odpad.id);
  db().prepare("UPDATE kosz_pozycja SET status='done' WHERE kosz_id=?").run(odpad.id);
  assert.equal(K.zakolejkujPowrot(odpad.id, "Magazynier"), null);
  assert.equal(K.wypuscPowrotyKoszy(), 0);
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
