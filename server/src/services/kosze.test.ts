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
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='pending'").get() as { n: number }).n,
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
function koszAplikacji(
  kod = "Z-7", rodzaj = "zwroty", naRegale = true,
): ReturnType<typeof K.szczegolKosza> {
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
  /* MM NA regał już w Subiekcie — tak wygląda kosz, któremu korekty doszły
     przed rozłożeniem. Kosz rozłożony wcześniej ma osobne testy niżej. */
  if (naRegale) {
    const q = Number(d.prepare(
      `INSERT INTO sfera_queue(type, status, payload, created_at, created_by)
       VALUES ('mm', 'done', '{}', ?, 'Biuro')`).run(teraz).lastInsertRowid);
    d.prepare("UPDATE kosz SET mm_queue_id=? WHERE id=?").run(q, koszId);
  }
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
    .prepare("SELECT payload, tw_id FROM sfera_queue WHERE type='mm' AND status='pending'")
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
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='pending'").get() as { n: number }).n,
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
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='pending'").get() as { n: number }).n,
    0,
    "adresy jeszcze nie weszły — dokument nie ma prawa powstać"
  );
  assert.equal(K.szczegolKosza(kosz.id).powrot, null);

  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();
  assert.equal(K.wypuscPowrotyKoszy(), 1, "adres zapisany — powrót wychodzi");
  assert.equal(K.wypuscPowrotyKoszy(), 0, "i tylko raz");
  assert.equal(K.szczegolKosza(kosz.id).powrot?.status, "pending");
});

/* ── Sklejanie powtórzonych kartotek (0.359.0) ───────────────────────────────
   Ten sam towar z dwóch zwrotów to dwa wiersze `kosz_pozycja` — tak musi być,
   bo każdy wiersz niesie ślad na oś swojego zwrotu. Na ekranie były jednak
   dwie linijki, dwa skany i dwa podejścia do tej samej półki. Cena błędu przy
   sklejaniu jest jedna i zawsze ta sama: ekran pokazuje trzy sztuki, a zapis
   dotyczy jednej.                                                             */

test("ten sam towar z dwóch zwrotów to jedna linijka z sumą sztuk", async () => {
  const kosz = koszAplikacji("Z-40");
  assert.equal(kosz.pozycje.length, 2, "trzy wiersze bazy, dwie linijki na ekranie");
  const sklejona = kosz.pozycje.find((p) => p.twId === 900_036)!;
  assert.equal(sklejona.ilosc, 3, "1 + 2 sztuki z dwóch zwrotów");
  assert.equal(sklejona.sklejone.length, 1, "drugi wiersz stoi za tą linijką");
  /* Lider to wiersz o najniższym id — kolejność zwrotów zostaje. */
  assert.ok(sklejona.sklejone.every((id) => id > sklejona.id));
});

test("odłożenie sklejonej linijki zapisuje WSZYSTKIE jej wiersze, jednym adresem", async () => {
  const kosz = koszAplikacji("Z-41");
  const sklejona = kosz.pozycje.find((p) => p.twId === 900_036)!;
  K.odlozPozycje(sklejona.id, "D04-01-02", "Magazynier");

  const wiersze = db().prepare(
    "SELECT status, lok_faktyczna, loc_queue_id FROM kosz_pozycja WHERE kosz_id=? AND tw_id=900036")
    .all(kosz.id) as Array<{ status: string; lok_faktyczna: string; loc_queue_id: number | null }>;
  assert.equal(wiersze.length, 2);
  assert.ok(wiersze.every((w) => w.status === "done" && w.lok_faktyczna === "D04-01-02"),
    "ekran pokazywał trzy sztuki — zapis ma dotyczyć trzech");
  /* JEDNO zadanie adresu na cały ruch: drugie i tak zapisałoby to samo pole
     tą samą wartością, a w kolejce wyglądałoby na drugą decyzję człowieka. */
  const zadania = db().prepare(
    "SELECT COUNT(*) AS n FROM sfera_queue WHERE type='set_location'").get() as { n: number };
  assert.equal(zadania.n, 1);
  assert.equal(new Set(wiersze.map((w) => w.loc_queue_id)).size, 1,
    "oba wiersze wskazują TO SAMO zadanie — cofnięcie anuluje dokładnie je");

  /* Jedno zdarzenie na ruch człowieka, z sumaryczną ilością: trzy wpisy w tej
     samej sekundzie zawyżyłyby tempo w raporcie wydajności. */
  /* Po koszu, nie po typie: `events` nie jest czyszczone między testami. */
  const zdarzenia = (db().prepare(
    "SELECT payload FROM events WHERE type='kosz_putaway'").all() as Array<{ payload: string }>)
    .map((z) => JSON.parse(z.payload) as { koszId: number; qty: number; pozycje: number[] })
    .filter((z) => z.koszId === kosz.id);
  assert.equal(zdarzenia.length, 1);
  const p = zdarzenia[0];
  assert.equal(p.qty, 3);
  assert.equal(p.pozycje.length, 2);
});

test("sklejenie NIE zabiera śladu osobnym zwrotom", async () => {
  /* To jest cena, której sklejanie mieć nie może. Wiersz `kosz_pozycja`
     istnieje właśnie po to, żeby na oś SWOJEGO zwrotu dopisać „towar wrócił na
     półkę X" (0.269.0). Jedna linijka na ekranie ma zostawić dwa ślady, bo
     czeka na nie dwóch klientów. */
  const d = db();
  const teraz = new Date().toISOString();
  /* Konto BEZ narzuconego id: `channel_account` ma AUTOINCREMENT, a wpisane
     ręcznie „1" podbija licznik i następny test dostaje id=2 przy zapytaniu
     o 1 — czyli FOREIGN KEY z cudzej osi. */
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k-44')")
    .run().lastInsertRowid);
  const koszId = Number(d.prepare(
    `INSERT INTO kosz(kod,status,rodzaj,utworzono_at,utworzono_przez,zamknieto_at,zamknieto_przez)
     VALUES ('Z-44','zamkniety','zwroty',?,'Ala',?,'Ala')`).run(teraz, teraz).lastInsertRowid);
  for (const nr of ["a", "b"]) {
    const zwrotId = Number(d.prepare(
      `INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,
         korekta_numer,created_at,synced_at)
       VALUES (?,?,?,'KFS 1/2026',?,?)`)
      .run(konto, `zw-${nr}`, `N4QZ-${nr}`, teraz, teraz).lastInsertRowid);
    const pozId = Number(d.prepare(
      `INSERT INTO zwrot_klienta_pozycja(zwrot_id,klucz,nazwa,ilosc,cena_grosze,waluta,tw_id)
       VALUES (?,?,'Sekator',1,4999,'PLN',900036)`).run(zwrotId, `k-${nr}`).lastInsertRowid);
    d.prepare(
      `INSERT INTO kosz_pozycja(kosz_id,tw_id,symbol,nazwa,ilosc,zwrot_pozycja_id)
       VALUES (?,900036,'TEST-LINIA-TODO','Pozycja',1,?)`).run(koszId, pozId);
  }

  const linijka = K.szczegolKosza(koszId).pozycje;
  assert.equal(linijka.length, 1, "dwa zwroty, jedna linijka");
  assert.equal(linijka[0].ilosc, 2);

  K.odlozPozycje(linijka[0].id, "D04-01-02", "Magazynier");
  const slady = d.prepare(
    "SELECT COUNT(*) AS n FROM zwrot_zdarzenie WHERE rodzaj='rozlozenie'").get() as { n: number };
  assert.equal(slady.n, 2, "każdy zwrot dostaje swoje zdanie na osi");
});

test("cofnięcie, pominięcie i „później” też biorą całą linijkę", async () => {
  const kosz = koszAplikacji("Z-42");
  const sklejona = () => K.szczegolKosza(kosz.id).pozycje.find((p) => p.twId === 900_036)!;
  const stany = () => (db().prepare(
    "SELECT status, pozniej_at FROM kosz_pozycja WHERE kosz_id=? AND tw_id=900036")
    .all(kosz.id) as Array<{ status: string; pozniej_at: string | null }>);

  K.przesunNaKoniec(sklejona().id, "Magazynier");
  assert.equal(new Set(stany().map((w) => w.pozniej_at)).size, 1,
    "ten sam znacznik czasu — inaczej rodzeństwo rozjechałoby się na końcu listy");
  assert.equal(sklejona().ilosc, 3, "linijka została jedna");

  K.pominPozycjeKosza(sklejona().id, "brak_w_koszu", "Magazynier");
  assert.ok(stany().every((w) => w.status === "skipped"));
  assert.equal(K.szczegolKosza(kosz.id).pozycje.find((p) => p.twId === 900_036)!.ilosc, 3);

  K.cofnijPozycje(sklejona().id, "Magazynier");
  assert.ok(stany().every((w) => w.status === "todo"));

  K.odlozPozycje(sklejona().id, "D04-01-02", "Magazynier");
  K.cofnijPozycje(sklejona().id, "Magazynier");
  assert.ok(stany().every((w) => w.status === "todo" && w.pozniej_at === null),
    "cofnięcie odłożenia wraca CAŁĄ linijką, nie połową");
});

test("sklejone są tylko wiersze NIEODRÓŻNIALNE na ekranie", async () => {
  /* Gdyby klucz pomijał adres, wiersz odłożony na D04 skleiłby się z wierszem
     leżącym jeszcze w koszu — a licznik ODŁOŻONE x/y przestałby się zgadzać
     z tym, co magazynier widzi. */
  const kosz = koszAplikacji("Z-43");
  const wiersze = db().prepare(
    "SELECT id FROM kosz_pozycja WHERE kosz_id=? AND tw_id=900036 ORDER BY id")
    .all(kosz.id) as Array<{ id: number }>;
  /* Ręcznie rozjeżdżamy stan jednego wiersza — tak, jak zrobiłaby to praca
     sprzed sklejania (kosz zaczęty na starszym wydaniu). */
  db().prepare("UPDATE kosz_pozycja SET status='done', lok_faktyczna='Z09-01-01' WHERE id=?")
    .run(wiersze[1].id);
  const widok = K.szczegolKosza(kosz.id).pozycje.filter((p) => p.twId === 900_036);
  assert.equal(widok.length, 2, "inny stan i inny adres to dwie linijki");
  assert.deepEqual(widok.map((p) => p.ilosc).sort(), [1, 2]);
});

test("różna odpowiedź biura rozdziela pominięcia, choć towar ten sam", async () => {
  /* 0.358.0 dało kolektorowi zdanie biura przy pominięciu, bo pominięcie bez
     widocznej odpowiedzi uczy jednego: nie zgłaszać. Sklejenie dwóch wierszy
     z RÓŻNYMI odpowiedziami schowałoby jedną z nich — czyli cofnęłoby tamto
     wydanie po cichu, przez klucz w innym pliku. */
  const kosz = koszAplikacji("Z-45");
  const sklejona = K.szczegolKosza(kosz.id).pozycje.find((p) => p.twId === 900_036)!;
  K.pominPozycjeKosza(sklejona.id, "brak_w_koszu", "Magazynier");

  const wiersze = db().prepare(
    "SELECT id FROM kosz_pozycja WHERE kosz_id=? AND tw_id=900036 ORDER BY id")
    .all(kosz.id) as Array<{ id: number }>;
  assert.equal(K.szczegolKosza(kosz.id).pozycje.filter((p) => p.twId === 900_036).length, 1,
    "dopóki odpowiedzi nie ma, pominięcia stoją w jednej linijce");

  /* Biuro zamyka sprawę JEDNEGO ze zwrotów — drugi wciąż czeka. */
  db().prepare(
    `UPDATE kosz_pozycja SET zalatwione_at=?, zalatwione_przez='Ala',
            zalatwione_notatka='towar znalazł się przy pakowaniu' WHERE id=?`)
    .run(new Date().toISOString(), wiersze[0].id);

  const widok = K.szczegolKosza(kosz.id).pozycje.filter((p) => p.twId === 900_036);
  assert.equal(widok.length, 2, "zamknięte i niezamknięte to dwie różne linijki");
  assert.equal(widok.filter((p) => p.zalatwioneNotatka !== null).length, 1);
});

test("pominięta pozycja nie wraca z bufora — nikt jej nie przeniósł", async () => {
  const kosz = koszAplikacji("Z-9");
  /* Dwa wiersze na 900036 (dwa zwroty) są od 0.359.0 JEDNĄ linijką, więc
     odłożenie bierze obie sztuki naraz. Pominięta zostaje druga kartoteka. */
  assert.equal(kosz.pozycje.length, 2, "trzy wiersze, dwie linijki");
  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");
  K.pominPozycjeKosza(kosz.pozycje[1].id, "brak_w_koszu", "Magazynier");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();

  K.zakonczKosz(kosz.id, "Magazynier");

  const mm = db().prepare("SELECT payload FROM sfera_queue WHERE type='mm' AND status='pending'").all() as
    Array<{ payload: string }>;
  assert.equal(mm.length, 1);
  const items = (JSON.parse(mm[0].payload) as { items: Array<{ twId: number; qty: number }> }).items;
  assert.deepEqual(items.map((i) => [i.twId, i.qty]), [[900_036, 3]],
    "z bufora schodzi WYŁĄCZNIE to, co magazynier naprawdę odłożył");
});

test("rozłożenie i pominięcie zostawiają ślad na osi ZWROTU", async () => {
  /* Kosz wie, z której pozycji zwrotu wziął towar, od 0.192.0 — ale nikt nie
     czytał tego w drugą stronę. Biuro patrzące na zwrot nie widziało ani
     tego, że towar wrócił na półkę, ani tego, że go w koszu nie było. */
  const d = db();
  /* Id konta BIERZEMY Z ZAPISU, nie zakładamy „1": `channel_account` ma
     AUTOINCREMENT, a `beforeEach` kasuje wiersze bez zerowania licznika. Każdy
     wcześniejszy test z kontem przesuwał więc ten numer i wywracał ten tutaj
     na FOREIGN KEY. */
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')")
    .run().lastInsertRowid);
  const zwrotId = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,created_at,synced_at)
    VALUES (?,'zw-slad','2026-09-01T08:00:00Z','2026-09-01T09:00:00Z')`)
    .run(konto).lastInsertRowid);
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

  const mm = db().prepare("SELECT payload FROM sfera_queue WHERE type='mm' AND status='pending'").all() as
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
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='pending'").get() as { n: number }).n,
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
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='pending'").get() as { n: number }).n,
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
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='pending'").get() as { n: number }).n,
    0
  );
});

test("koszyk wirtualny nie trafia na kolektor — halę rozkłada kosz z jego MM", async () => {
  /* 0.350.0, decyzja właściciela: koszyk złożony w panelu zbiera towar, rodzi
     MM i się kończy. Na produkcji Z-7 wisiał na kolektorze obok przyjęcia 1352
     z tego samego MM — dwie jednostki pracy na jeden towar. */
  const wirtualny = koszAplikacji("Z-7");
  const zDokumentu = koszDoRozkladania("KZ-01");
  const naKolektorze = K.koszeDlaKolektora().map((k) => k.id);
  assert.equal(naKolektorze.includes(wirtualny.id), false);
  assert.equal(naKolektorze.includes(zDokumentu.id), true);
  /* Biuro widzi go dalej — to tam śledzi się jego dokument MM. */
  const wBiurze = K.listaKoszy().find((k) => k.id === wirtualny.id);
  assert.equal(wBiurze?.wirtualny, true);
  assert.equal(K.listaKoszy().find((k) => k.id === zDokumentu.id)?.wirtualny, false);
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

/* ── Kosz rozłożony PRZED korektą (audyt zwrotów, 15 września 2026) ──────────
   Hala rozkłada kosz, zanim biuro wpisze korekty — zamknięcie jest czynnością
   fizyczną. ZAKOŃCZ zamawiało wtedy powrót z regału, na który nic nie weszło,
   a MM na regał nie wychodziło nigdy: automat patrzył tylko na kosze
   zamknięte. Cofnięcie zakończenia nie widziało zaś powrotu wcale.          */

/** Odkłada wszystko na własne półki i udaje workera, który zapisał adresy. */
function rozloz(koszId: number) {
  for (const p of K.szczegolKosza(koszId).pozycje) K.odlozPozycje(p.id, "A01-02-03", "Magazynier");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();
  K.zakonczKosz(koszId, "Magazynier");
}

test("powrót nie wychodzi, dopóki MM na regał nie weszło do Subiekta", async () => {
  const kosz = koszAplikacji("Z-23", "zwroty", false);
  rozloz(kosz.id);
  assert.equal(K.szczegolKosza(kosz.id).powrot, null);
  assert.equal(K.wypuscPowrotyKoszy(), 0, "zdjęłoby z regału stan, którego tam nie ma");
});

test("kosz rozłożony przed korektą: najpierw MM na regał, potem powrót", async () => {
  const { wypuscGotoweKoszyki } = await import("./kosze-zwrotow.js");
  const koszId = koszZeZwrotu("Z-20", null);
  rozloz(koszId);
  const mm = () => db()
    .prepare("SELECT id, status, payload FROM sfera_queue WHERE type='mm' ORDER BY id")
    .all() as Array<{ id: number; status: string; payload: string }>;
  assert.deepEqual(mm(), [], "bez korekty nie ma ani MM na regał, ani powrotu");
  assert.equal(K.listaKoszy().find((k) => k.id === koszId)!.mmStan, "czeka_na_korekte",
    "rozłożony kosz dalej mówi, na co czeka");

  db().prepare("UPDATE zwrot_klienta SET korekta_numer='ZW 413/MAG/09/2026'").run();
  assert.equal(wypuscGotoweKoszyki(db()), 1, "rozłożony kosz też dostaje swoje MM na regał");
  assert.equal(K.wypuscPowrotyKoszy(), 0, "powrót czeka, aż tamto MM wejdzie do Subiekta");

  const [naRegal] = mm();
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(naRegal.id);
  assert.equal(K.wypuscPowrotyKoszy(), 1);
  const [, powrot] = mm();
  assert.ok(powrot.id > naRegal.id, "kolejka wykonuje zadania po id — przyjazd przed powrotem");
  assert.equal((JSON.parse(powrot.payload) as { magFrom: number }).magFrom, 3,
    "powrót schodzi z regału zwrotów");
});

test("cofnięcie zakończenia anuluje czekający powrót, a ponowne ZAKOŃCZ zamawia świeży", async () => {
  const kosz = koszAplikacji("Z-21");
  rozloz(kosz.id);
  assert.equal(K.szczegolKosza(kosz.id).powrot?.status, "pending");

  K.cofnijZakonczenie(kosz.id, "Magazynier");
  assert.equal(K.szczegolKosza(kosz.id).powrot, null,
    "karta nie pokazuje dokumentu, którego nie będzie");
  const policz = (status: string) => (db()
    .prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status=?")
    .get(status) as { n: number }).n;
  assert.equal(policz("cancelled"), 1, "stare zadanie nie ma prawa pojechać do Subiekta");

  /* Do tej poprawki drugie ZAKOŃCZ oddawało STARE zadanie — z zawartością
     sprzed cofnięcia. */
  K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal(policz("pending"), 1);
  assert.equal(policz("cancelled"), 1);
});

test("po wejściu powrotu do Subiekta cofnięcie zakończenia odmawia", async () => {
  const kosz = koszAplikacji("Z-22");
  rozloz(kosz.id);
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='mm' AND status='pending'").run();

  assert.throws(() => K.cofnijZakonczenie(kosz.id, "Magazynier"),
    /MM powrotne kosza Z-22 jest już w Subiekcie/);
  assert.equal(K.szczegolKosza(kosz.id).status, "rozlozony", "stan kosza zostaje nietknięty");
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

/* ── Kosz złożony w aplikacji: czego panel biura potrzebuje (0.333.0) ────────
   Zgłoszenie właściciela: „nie utworzyło MM przy zamknięciu zwrotu, nie widzę
   MM w Subiekcie". Dokument nie zginął — czeka na numery korekt, bo towar
   wraca na magazyn główny dopiero korektą (bramka z 0.200.0). Ekran o tym
   milczał, więc czekanie wyglądało jak awaria.

   Przy okazji wyszło, że panel czytał DWA POLA, których serwer nigdy nie
   oddawał: `zwrotow` na liście i `zwroty` w podglądzie. Pierwsze rysowało
   „undefined zwr.", drugie wywracało cały podgląd. Nie wyszło wcześniej, bo
   kosze Z DOKUMENTU mają `mmNumer` i trafiają w drugą gałąź tego zdania —
   a własne kosze biuro zaczęło składać dopiero teraz.                       */

/** Kosz złożony w aplikacji, z pozycją wniesioną przez zwrot. */
function koszZeZwrotu(kod: string, korekta: string | null) {
  const d = db();
  const teraz = new Date().toISOString();
  d.prepare("INSERT OR IGNORE INTO channel_account(id,channel,external_account_id) VALUES (1,'allegro','k')").run();
  const zwrotId = Number(d.prepare(
    `INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,
       korekta_numer,created_at,synced_at)
     VALUES (1,'zw-1',?,?,?,?)`).run(`N4QZ-${kod}`, korekta, teraz, teraz).lastInsertRowid);
  const pozId = Number(d.prepare(
    `INSERT INTO zwrot_klienta_pozycja(zwrot_id,klucz,nazwa,ilosc,cena_grosze,waluta,tw_id)
     VALUES (?,?,'Sekator',1,4999,'PLN',900036)`).run(zwrotId, `k-${kod}`).lastInsertRowid);
  const koszId = Number(d.prepare(
    `INSERT INTO kosz(kod,status,rodzaj,utworzono_at,utworzono_przez,zamknieto_at,zamknieto_przez)
     VALUES (?, 'zamkniety', 'zwroty', ?, 'Ala', ?, 'Ala')`)
    .run(kod, teraz, teraz).lastInsertRowid);
  d.prepare(
    `INSERT INTO kosz_pozycja(kosz_id,tw_id,symbol,nazwa,ilosc,zwrot_pozycja_id)
     VALUES (?,900036,'TEST-LINIA-TODO','Pozycja',1,?)`).run(koszId, pozId);
  return koszId;
}

test("kosz bez korekty mówi, że CZEKA — a nie udaje, że MM zginęła", () => {
  const koszId = koszZeZwrotu("Z-3", null);
  const w = K.listaKoszy().find((k) => k.id === koszId)!;

  assert.equal(w.zwrotow, 1, "panel rysował tu »undefined zwr.«");
  assert.equal(w.brakujeKorekt, 1);
  assert.equal(w.mmStan, "czeka_na_korekte");
  assert.equal(w.mmNumer, null);
});

test("po dojściu korekty kosz przestaje czekać", () => {
  const koszId = koszZeZwrotu("Z-4", "KFS 12/2026");
  const w = K.listaKoszy().find((k) => k.id === koszId)!;
  assert.equal(w.brakujeKorekt, 0);
  /* MM jeszcze nie zamówiona — wypuszcza ją takt albo zamknięcie kosza. */
  assert.equal(w.mmStan, "brak");
});

test("zamówiona MM i MM w błędzie to DWIE różne odpowiedzi", () => {
  /* Bez tego rozróżnienia biuro szukałoby korekty tam, gdzie stoi zepsute
     zadanie kolejki — czyli robiłoby nie tę pracę. */
  const koszId = koszZeZwrotu("Z-5", "KFS 13/2026");
  const d = db();
  const q = Number(d.prepare(
    `INSERT INTO sfera_queue(type,status,payload,created_at,created_by)
     VALUES ('mm','pending','{}',?, 'Ala')`).run(new Date().toISOString()).lastInsertRowid);
  d.prepare("UPDATE kosz SET mm_queue_id=? WHERE id=?").run(q, koszId);
  assert.equal(K.listaKoszy().find((k) => k.id === koszId)!.mmStan, "zamowiona");

  d.prepare("UPDATE sfera_queue SET status='error' WHERE id=?").run(q);
  assert.equal(K.listaKoszy().find((k) => k.id === koszId)!.mmStan, "blad");
});

test("podgląd kosza niesie ZWROTY — bez nich panel się wywracał", () => {
  const koszId = koszZeZwrotu("Z-6", null);
  const k = K.szczegolKosza(koszId);
  assert.equal(k.zwroty.length, 1);
  assert.equal(k.zwroty[0].numer, "N4QZ-Z-6");
  assert.equal(k.zwroty[0].korektaNumer, null, "po tym polu ekran mówi, na co czeka");
});

test("kosz Z DOKUMENTU nie czeka na żadną korektę", () => {
  /* Tamten towar przyjechał już przesunięciem z Subiekta — korekta go nie
     dotyczy, a pastylka »czeka« byłaby tam zwykłym kłamstwem. */
  const kosz = koszDoRozkladania("KZ-09");
  const w = K.listaKoszy().find((k) => k.id === kosz.id)!;
  assert.equal(w.zwrotow, 0);
  assert.equal(w.brakujeKorekt, 0);
  assert.equal(w.mmStan, "gotowa", "ten kosz ma numer MM z dokumentu");
});

test("ZWIĄZANY koszyk wraca trasą z konfiguracji, choćby dokument nie znał nadawcy", async () => {
  /* 0.377.0. Związanie koszyka z jego dokumentem (0.376.0) przestawiło go do
     gałęzi „kosz z dokumentu", a ta bierze cel WYŁĄCZNIE z `mm_mag_z`. Kolumna
     read-modelu jest nullowalna, więc koszyk tracił trasę, którą przed
     związaniem miał pewną — powrót nie wychodził wcale, a towar zostawał na
     regale zwrotów.

     To MY zleciliśmy tamto MM i wiemy, że poszło MAG→ZWROTY, więc nadawca
     dokumentu niczego tu nie dodaje. */
  const kosz = koszDoRozkladania("KZ-88");
  const q = Number(db().prepare(
    `INSERT INTO sfera_queue(type, status, payload, sgt_doc_number, created_at, created_by)
     VALUES ('mm','done','{}','MM 1209/MAG/2026', ?, 'Biuro')`)
    .run(new Date().toISOString()).lastInsertRowid);
  db().prepare("UPDATE kosz SET mm_queue_id=?, mm_mag_z=NULL WHERE id=?").run(q, kosz.id);

  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "A01-02-03", "Magazynier");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE type='set_location'").run();
  K.zakonczKosz(kosz.id, "Magazynier");

  const mm = db().prepare(
    "SELECT payload FROM sfera_queue WHERE type='mm' AND status='pending'").all() as
    Array<{ payload: string }>;
  assert.equal(mm.length, 1, "powrót wychodzi mimo pustego nadawcy w dokumencie");
  const p = JSON.parse(mm[0].payload) as { magFrom: number; magTo: number };
  assert.equal(p.magFrom, 3);
  assert.equal(p.magTo, 1, "na magazyn główny — tak, jak koszyk stamtąd wyjechał");
});

/* ── Kosze z kłopotem MM (0.501.0) ─────────────────────────────────────────
   Zgłoszenie właściciela: „zaznacz koszyki, w których był problem z MM —
   muszę sprawdzić stany z Subiektem". Wiersz kolejki pamięta tylko ostatnie
   podejście, więc MM odrzucona i przepuszczona PONÓW-em wyglądała jak czysta. */

function koszZMm(kod: string, pola: { status?: string; rozlozono?: string; queueStatus: string;
  blad?: string | null; wPozycji?: boolean }) {
  const d = db();
  const teraz = new Date().toISOString();
  const q = Number(d.prepare(`INSERT INTO sfera_queue(type,payload,status,error_msg,created_by)
    VALUES ('mm','{}',?,?,'Test')`).run(pola.queueStatus, pola.blad ?? null).lastInsertRowid);
  const k = Number(d.prepare(`INSERT INTO kosz(kod,status,utworzono_at,utworzono_przez,rozlozono_at,mm_queue_id)
    VALUES (?,?,?,'Test',?,?)`).run(kod, pola.status ?? "zamkniety", teraz, pola.rozlozono ?? null,
    pola.wPozycji ? null : q).lastInsertRowid);
  if (pola.wPozycji) {
    d.prepare(`INSERT INTO kosz_pozycja(kosz_id,tw_id,symbol,nazwa,ilosc,mm_queue_id)
      VALUES (?,900036,'S','N',1,?)`).run(k, q);
  }
  return { koszId: k, queueId: q };
}

function zdarzenie(typ: string, dane: Record<string, unknown>, kiedy = new Date().toISOString()) {
  db().prepare("INSERT INTO events(type,payload,user_id,created_at) VALUES (?,?,'Test',?)")
    .run(typ, JSON.stringify(dane), kiedy);
}

test("MM przepuszczona po odmowie zostaje zaznaczona — z treścią odmowy", () => {
  db().prepare("DELETE FROM events").run();
  const { koszId, queueId } = koszZMm("Z-40", { queueStatus: "done" });
  zdarzenie("queue_retry", { queueId, typ: "mm", proba: 1, max: 3, blad: "Brak towaru w magazynie" });
  zdarzenie("queue_ponowione_recznie", { queueId });
  const w = K.listaKoszy().find((k) => k.id === koszId)!;
  assert.equal(w.problemMm?.prob, 1, "ręczne PONÓW nie jest nieudaną próbą");
  assert.equal(w.problemMm?.ostatniBlad, "Brak towaru w magazynie");
  assert.equal(w.problemMm?.nierozwiazany, false, "MM weszła — trzeba tylko sprawdzić stany");
});

test("MM pozycji stojąca w błędzie jest kłopotem nierozwiązanym, także bez zdarzeń", () => {
  db().prepare("DELETE FROM events").run();
  const { koszId } = koszZMm("Z-41", { queueStatus: "error", blad: "Kartoteka w edycji", wPozycji: true });
  const w = K.listaKoszy().find((k) => k.id === koszId)!;
  assert.equal(w.problemMm?.nierozwiazany, true);
  assert.equal(w.problemMm?.ostatniBlad, "Kartoteka w edycji");
});

test("czekanie na otwarty dokument i cudze zadania kłopotem nie są", () => {
  db().prepare("DELETE FROM events").run();
  const { koszId, queueId } = koszZMm("Z-42", { queueStatus: "done" });
  zdarzenie("queue_retry", { queueId, typ: "mm", blad: "Dokument otwarty", blokada: true });
  zdarzenie("queue_failed", { queueId: queueId + 999, typ: "mm", blad: "Cudze" });
  assert.equal(K.listaKoszy().find((k) => k.id === koszId)!.problemMm, null);
});

test("kosz z kłopotem MM zostaje na liście po oknie dwóch tygodni", () => {
  db().prepare("DELETE FROM events").run();
  const dawno = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const zKlopotem = koszZMm("Z-43", { status: "rozlozony", rozlozono: dawno, queueStatus: "done" });
  zdarzenie("queue_failed", { queueId: zKlopotem.queueId, typ: "mm", blad: "Brak towaru" },
    new Date(Date.now() - 39 * 86_400_000).toISOString());
  const bez = koszZMm("Z-44", { status: "rozlozony", rozlozono: dawno, queueStatus: "done" });
  const lista = K.listaKoszy();
  assert.ok(lista.some((k) => k.id === zKlopotem.koszId), "biuro sprawdza stany także po starszych");
  assert.ok(!lista.some((k) => k.id === bez.koszId), "reszta historii zostaje w audycie");
});

/* ── Ponowienie MM kosza (0.503.0) ────────────────────────────────────────
   Zgłoszenie właściciela przy kubełku „Problem z MM": „dodaj, abym mógł
   wywołać ponownie". Jeden ruch na kosz, a nie PONÓW na każde zadanie. */

test("ponowienie wraca do kolejki WSZYSTKIE MM kosza w błędzie, z wpisem w dzienniku", () => {
  db().prepare("DELETE FROM events").run();
  const { koszId, queueId } = koszZMm("Z-50", { queueStatus: "error", blad: "Brak towaru w magazynie" });
  const drugie = Number(db().prepare(`INSERT INTO sfera_queue(type,payload,status,error_msg,created_by)
    VALUES ('mm','{}','error','Brak towaru','Test')`).run().lastInsertRowid);
  db().prepare(`INSERT INTO kosz_pozycja(kosz_id,tw_id,symbol,nazwa,ilosc,mm_queue_id)
    VALUES (?,900036,'S','N',1,?)`).run(koszId, drugie);
  const zrobione = Number(db().prepare(`INSERT INTO sfera_queue(type,payload,status,created_by)
    VALUES ('mm','{}','done','Test')`).run().lastInsertRowid);
  db().prepare(`INSERT INTO kosz_pozycja(kosz_id,tw_id,symbol,nazwa,ilosc,mm_queue_id)
    VALUES (?,900037,'S2','N2',1,?)`).run(koszId, zrobione);

  assert.deepEqual(K.ponowMmKosza(db(), koszId, "Ala"), { ponowione: 2 });
  const stany = db().prepare("SELECT id, status, attempts, error_msg FROM sfera_queue WHERE id IN (?,?,?)")
    .all(queueId, drugie, zrobione) as Array<{ id: number; status: string; attempts: number; error_msg: string | null }>;
  assert.deepEqual(stany.map((z) => z.status).sort(), ["done", "pending", "pending"],
    "zrobione MM nie idzie drugi raz");
  assert.ok(stany.filter((z) => z.status === "pending").every((z) => z.attempts === 0 && z.error_msg === null));
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE type='queue_ponowione_recznie'")
    .get() as { n: number }).n, 2);
  /* Kłopot zostaje zaznaczony po ponowieniu — stany i tak trzeba sprawdzić. */
  const w = K.listaKoszy().find((k) => k.id === koszId)!;
  assert.equal(w.problemMm?.nierozwiazany, false);
  assert.ok(w.problemMm);
});

test("MM przerwane w trakcie zapisu ponawia się dopiero po sprawdzeniu w Subiekcie", () => {
  const { koszId, queueId } = koszZMm("Z-51", { queueStatus: "error",
    blad: "Worker Sfery przerwany w trakcie zapisu — SPRAWDŹ w Subiekcie, czy dokument powstał" });
  assert.throws(() => K.ponowMmKosza(db(), koszId, "Ala"), (e: Error & { kod?: number }) =>
    e.kod === 409 && /Sprawdź w Subiekcie/.test(e.message));
  assert.equal((db().prepare("SELECT status FROM sfera_queue WHERE id=?").get(queueId) as { status: string }).status,
    "error", "odmowa niczego nie rusza");
  assert.deepEqual(K.ponowMmKosza(db(), koszId, "Ala", true), { ponowione: 1 });
});

test("kosz bez MM w błędzie odmawia zamiast udawać ponowienie", () => {
  const { koszId } = koszZMm("Z-52", { queueStatus: "done" });
  assert.throws(() => K.ponowMmKosza(db(), koszId, "Ala"), (e: Error & { kod?: number }) => e.kod === 409);
});

/* ── Kosz bez MM powrotnego na liście koszy (0.505.0) ───────────────────────
   Zgłoszenie właściciela: „jak mogę sprawdzić, do których koszyków po
   rozłożeniu nie została zrobiona MM powrotna?" — a potem „zrób to". */

function rozlozonyZDokumentu(kod: string, rozlozono: string, powrotQueue: number | null = null) {
  const d = db();
  const k = Number(d.prepare(`INSERT INTO kosz(kod,status,mm_dok_id,mm_numer,utworzono_at,utworzono_przez,
      rozlozono_at,powrot_queue_id) VALUES (?,'rozlozony',1209,?,?,'Test',?,?)`)
    .run(kod, kod, rozlozono, rozlozono, powrotQueue).lastInsertRowid);
  d.prepare(`INSERT INTO kosz_pozycja(kosz_id,tw_id,symbol,nazwa,ilosc,status)
    VALUES (?,900036,'S','N',1,'done')`).run(k);
  return k;
}

test("kosz rozłożony ponad dobę bez MM powrotnego ma znacznik — też po dwóch tygodniach", () => {
  db().prepare("DELETE FROM events").run();
  const dawno = rozlozonyZDokumentu("1284", new Date(Date.now() - 20 * 86_400_000).toISOString());
  const swiezy = rozlozonyZDokumentu("1285", new Date(Date.now() - 2 * 3_600_000).toISOString());
  const q = Number(db().prepare(`INSERT INTO sfera_queue(type,payload,status,created_by)
    VALUES ('mm','{}','done','Test')`).run().lastInsertRowid);
  const zPowrotem = rozlozonyZDokumentu("1286", new Date(Date.now() - 3 * 86_400_000).toISOString(), q);
  const lista = K.listaKoszy();
  assert.equal(lista.find((k) => k.id === dawno)?.bezPowrotu, "kierunek",
    "dokument bez znanego magazynu źródłowego — powrót robi biuro, a kosz nie wypada po oknie");
  assert.equal(lista.find((k) => k.id === swiezy)?.bezPowrotu, null, "doba zapasu na zapis adresów");
  assert.equal(lista.find((k) => k.id === zPowrotem)?.bezPowrotu, null);
  assert.deepEqual(K.koszeBezPowrotu().map((k) => k.kod), ["1284"],
    "ta sama definicja, którą czyta rekoncyliacja");
});

test("przyczyna braku powrotu: adres w błędzie odróżnia się od nieznanego kierunku", () => {
  db().prepare("DELETE FROM kosz_pozycja").run();
  db().prepare("DELETE FROM kosz").run();
  const k = rozlozonyZDokumentu("1290", new Date(Date.now() - 2 * 86_400_000).toISOString());
  db().prepare("UPDATE kosz SET mm_mag_z=1 WHERE id=?").run(k);
  const adres = Number(db().prepare(`INSERT INTO sfera_queue(type,payload,status,error_msg,created_by)
    VALUES ('set_location','{}','error','Kartoteka w edycji','Test')`).run().lastInsertRowid);
  db().prepare("UPDATE kosz_pozycja SET loc_queue_id=? WHERE kosz_id=?").run(adres, k);
  assert.equal(K.listaKoszy().find((x) => x.id === k)?.bezPowrotu, "adresy",
    "powrót wyjdzie sam po zapisie adresu — do sprawdzenia jest kolejka, nie Subiekt");
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(adres);
  assert.equal(K.listaKoszy().find((x) => x.id === k)?.bezPowrotu, "nieznany");
});

/* ── Który towar blokuje MM (0.530.0) ───────────────────────────────────────
   Zgłoszenie właściciela przy koszu 1205: „brak towaru w MM, gdy chcę
   przerzucić z powrotem na główny — i nie pokazuje, o jaki towar chodzi". */

test("karta kosza nazywa kartotekę, której brakuje na magazynie źródłowym MM", () => {
  db().prepare("DELETE FROM events").run();
  const k = koszDoRozkladania("1205");
  /* Powrót z regału zwrotów (mag 3): 900036 ma tam 3 szt., 900037 — nic. */
  db().prepare("UPDATE sgt_stan SET stan_rez=2 WHERE tw_id=900036 AND mag_id=3").run();
  const q = Number(db().prepare(`INSERT INTO sfera_queue(type,payload,status,attempts,error_msg,created_by)
    VALUES ('mm',?,'pending',1,'Sfera odrzuciła „MM.Zapisz()”: Brak towaru w magazynie.','Test')`)
    .run(JSON.stringify({ magFrom: 3, magTo: 1, items: [
      { twId: 900036, qty: 2 }, { twId: 900037, qty: 1 }] })).lastInsertRowid);
  db().prepare("UPDATE kosz SET powrot_queue_id=? WHERE id=?").run(q, k.id);
  db().prepare("INSERT INTO events(type,payload,user_id) VALUES ('queue_retry',?,'Test')")
    .run(JSON.stringify({ queueId: q, typ: "mm", proba: 1, max: 3, blad: "Brak towaru w magazynie." }));

  const braki = K.szczegolKosza(k.id).brakiMm;
  assert.deepEqual(braki.map((b) => [b.symbol, b.magazyn, b.potrzeba, b.stan, b.rezerwacja]), [
    ["TEST-LINIA-TODO", "ZWR", 2, 3, 2],
    ["TEST-LINIA-DONE", "ZWR", 1, 0, 0],
  ], "rezerwacja blokuje tak samo jak brak stanu — Subiekt jej nie przesunie");

  /* Powrót czeka na kolejną próbę — to nie jest „weszło po błędzie". */
  const w = K.listaKoszy().find((x) => x.id === k.id)!;
  assert.equal(w.problemMm?.ponawiane, true);
  assert.equal(w.problemMm?.nierozwiazany, false);

  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(q);
  assert.deepEqual(K.szczegolKosza(k.id).brakiMm, [], "MM, które weszło, niczego już nie blokuje");
  assert.equal(K.listaKoszy().find((x) => x.id === k.id)!.problemMm?.ponawiane, false);
});

test("kartotekę, która blokuje MM, zdejmuje się z dokumentu — reszta idzie dalej (0.530.0)", () => {
  /* Zgłoszenie właściciela przy koszu 1205: „daj możliwość usunięcia tego
     towaru z tej MM". */
  db().prepare("DELETE FROM events").run();
  const k = koszDoRozkladania("1206");
  const q = Number(db().prepare(`INSERT INTO sfera_queue(type,payload,status,attempts,error_msg,created_by)
    VALUES ('mm',?,'error',3,'Brak towaru w magazynie.','Test')`)
    .run(JSON.stringify({ magFrom: 3, magTo: 1, items: [
      { twId: 900036, qty: 2 }, { twId: 900037, qty: 1 }] })).lastInsertRowid);
  db().prepare("UPDATE kosz SET powrot_queue_id=? WHERE id=?").run(q, k.id);

  assert.deepEqual(K.usunZMmKosza(db(), k.id, 900037, "Ala"),
    { zadan: 1, anulowanych: 0, ilosc: 1, magazyn: 3 });
  const z = db().prepare("SELECT status, payload FROM sfera_queue WHERE id=?").get(q) as
    { status: string; payload: string };
  assert.deepEqual(JSON.parse(z.payload).items, [{ twId: 900036, qty: 2 }]);
  assert.equal(z.status, "error", "błąd zostaje — resztę puszcza „Ponów MM”, nie cicha zmiana");
  const e = db().prepare("SELECT tw_id, payload FROM events WHERE type='kosz_mm_pozycja_zdjeta'").get() as
    { tw_id: number; payload: string };
  assert.equal(e.tw_id, 900037);
  assert.equal(JSON.parse(e.payload).magazyn, 3, "ślad, skąd towar trzeba jeszcze przesunąć ręką");

  /* Ostatnia linia anuluje zadanie zamiast zostawić MM bez pozycji. */
  assert.equal(K.usunZMmKosza(db(), k.id, 900036, "Ala").anulowanych, 1);
  assert.equal((db().prepare("SELECT status FROM sfera_queue WHERE id=?").get(q) as { status: string }).status,
    "cancelled");
});

test("MM w trakcie zapisu i kartoteki spoza MM się nie rusza", () => {
  const k = koszDoRozkladania("1207");
  const q = Number(db().prepare(`INSERT INTO sfera_queue(type,payload,status,created_by)
    VALUES ('mm',?,'processing','Test')`)
    .run(JSON.stringify({ magFrom: 3, magTo: 1, items: [{ twId: 900036, qty: 1 }] })).lastInsertRowid);
  db().prepare("UPDATE kosz SET powrot_queue_id=? WHERE id=?").run(q, k.id);
  assert.throws(() => K.usunZMmKosza(db(), k.id, 900036, "Ala"),
    (e: Error & { kod?: number }) => e.kod === 409 && /zapisuje/.test(e.message));
  assert.throws(() => K.usunZMmKosza(db(), k.id, 900029, "Ala"),
    (e: Error & { kod?: number }) => e.kod === 409 && /nie ma w żadnym MM/.test(e.message));
});
