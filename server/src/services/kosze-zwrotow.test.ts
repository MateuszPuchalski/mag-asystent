import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  brakujaceKorekty, dolozDoKosza, otwarteKoszyki, koszDoDolozenia, stanOtwartegoKosza,
  wypuscGotoweKoszyki, wypuscMmMimoKorekt, zamknijKosz, zdejmijZKosza,
  dolozTowar, zdejmijTowar, koszykiBezDokumentu, koszykiCzekajaceNaKorekty,
  MAX_SZTUK_RECZNIE, powodPozaMagazynem, zwiazKoszykiZDokumentami, zaznaczSkladnik,
  zalozKoszyk, usunKoszyk,
} from "./kosze-zwrotow.js";
import { ocenPozycje, rozstrzygnijZwrot } from "./zwroty.js";
import { zapamietajSklad } from "./komplety.js";
import { koszeZwrotu } from "./kosze.js";

/* ── Koszyk zwrotów składany w panelu (0.192.0) ─────────────────────────────
   Obieg właściciela: pusta MM przy zasiadaniu do zwrotów, dokładanie pozycja
   po pozycji, domknięcie gdy kosz się zapełni, i tak w kółko.

   Te testy pilnują trzech rzeczy, których pomyłka kosztuje towar na hali:
   dokłada WYŁĄCZNIE „na stan", zmiana oceny zdejmuje, a zamknięty kosz jest
   nietykalny.                                                              */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

function biuro(d: Db) {
  const id = Number(d.prepare(
    "INSERT INTO app_user(name,role) VALUES ('Ala','biuro')")
    .run().lastInsertRowid);
  return { id, name: "Ala" };
}

/** Zwrot przyjęty, z pozycjami wiszącymi na kartotekach. */
function zwrotZTowarem(d: Db, twIdy: Array<number | null>, kto: { id: number; name: string },
  extId = "z1") {
  for (const tw of twIdy) {
    if (tw === null) continue;
    d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
      .run(tw, `SYM-${tw}`, `Towar ${tw}`);
    /* WIERSZ STANU, bo od 0.372.2 kartoteka bez niego nie wchodzi do pudła.
       Towar, który wyszedł ze sprzedaży, jest magazynowi znany — fikstura bez
       tego wiersza opisywałaby usługę, a nie część. */
    d.prepare("INSERT OR IGNORE INTO sgt_stan(tw_id,mag_id,stan) VALUES (?,1,0)").run(tw);
  }
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,created_at,synced_at)
    VALUES (1,?,'2026-09-01T08:00:00Z','2026-09-01T08:00:00Z')`).run(extId).lastInsertRowid);
  const poz = twIdy.map((tw, i) => Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta,tw_id)
    VALUES (?,?,?,?,?,?, 'PLN', ?)`)
    .run(id, `k${i}`, `of${i}`, `Część ${i}`, 2, 5000, tw).lastInsertRowid));
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, kto);
  return { id, poz };
}

/** Korekta wystawiona w Subiekcie — bez niej MM nie ma z czego zejść. */
function skorygowany(d: Db, zwrotId: number, numer = "KFS 1/2026") {
  d.prepare("UPDATE zwrot_klienta SET korekta_numer=? WHERE id=?").run(numer, zwrotId);
}

test("ocena „na stan\" DOKŁADA do koszyka, a inne oceny nie", () => {
  /* To jest cała sztuczka z prędkości: naciśnięcie, które operator i tak
     wykonuje, jest dołożeniem do MM. Osobnego ruchu nie ma. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, [11, 12, 13], KTO);

  assert.equal(ocenPozycje(d, poz[0], "stan", 2, KTO).koszyk !== null, true);
  assert.equal(ocenPozycje(d, poz[1], "utylizacja", 3, KTO).koszyk, null,
    "utylizacja ma zejść ze stanu, nie pojechać na regał zwrotów");
  /* Trzecia pozycja zostaje BEZ OCENY i to też jest wypowiedź: brak oceny nie
     dokłada niczego do koszyka. Do 0.209.0 stała tu „przecena" — ocena, która
     nie prowadziła donikąd i dlatego zeszła razem z przyciskiem. */
  assert.equal(ocenPozycje(d, poz[2], null, 4, KTO).koszyk, null,
    "bez oceny nie ma czego dokładać do MM");

  const kosz = stanOtwartegoKosza(d, KTO);
  assert.equal(kosz?.pozycji, 1);
  assert.equal(kosz?.sztuk, 2, "sztuki idą z pozycji zwrotu, nie po jednej");
  assert.match(kosz!.kod, /^Z-\d+$/,
    "kod z przedrostkiem — gołe liczby są przestrzenią numerów MM z kartek");
});

test("zwrot wie, w którym koszu jedzie jego towar (0.438.0)", () => {
  /* Druga połowa wiązania kosz ↔ zwrot. Kosz od dawna wymieniał swoje zwroty;
     zwrot pisał tylko „w koszyku zwrotów", bez nazwy i bez drogi — a pytanie
     „gdzie jest towar z tego zwrotu" pada właśnie przy zwrocie. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, poz } = zwrotZTowarem(d, [21], KTO);
  assert.deepEqual(koszeZwrotu(id, d), [], "przed oceną towar nie leży w żadnym koszu");
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  assert.deepEqual(koszeZwrotu(id, d), [{ id: kosz.id, kod: kosz.kod, status: "otwarty" }]);
  /* Zdjęcie z kosza zdejmuje też wiązanie — zwrot nie może pokazywać kosza,
     w którym jego towaru już nie ma. */
  ocenPozycje(d, poz[0], null, 3, KTO);
  assert.deepEqual(koszeZwrotu(id, d), []);
});

test("zmiana oceny ZDEJMUJE z koszyka, a powtórzenie nie dubluje sztuk", () => {
  /* Bez zdejmowania „na stan\", potem „utylizacja\" zostawiłoby towar na
     dokumencie, którego nikt nie chce na regale. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, [11], KTO);

  ocenPozycje(d, poz[0], "stan", 2, KTO);
  ocenPozycje(d, poz[0], "stan", 3, KTO);
  assert.equal(stanOtwartegoKosza(d, KTO)?.pozycji, 1, "ta sama pozycja to jeden wiersz");

  ocenPozycje(d, poz[0], "utylizacja", 4, KTO);
  assert.equal(stanOtwartegoKosza(d, KTO)?.pozycji, 0);

  ocenPozycje(d, poz[0], null, 5, KTO);
  assert.equal(stanOtwartegoKosza(d, KTO)?.pozycji, 0, "cofnięcie oceny też zdejmuje");
});

test("pozycja BEZ KARTOTEKI nie wchodzi na dokument, a ocena i tak się zapisuje", () => {
  /* MM przesuwa stany kartotek, a nie nazwy. Ocena jest faktem o towarze,
     więc zostaje — ale ekran musi wiedzieć, czego nie zrobiono. Cicha strata
     byłaby najgorsza: karton pojechałby z towarem spoza dokumentu. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, [null], KTO);

  assert.equal(ocenPozycje(d, poz[0], "stan", 2, KTO).koszyk, null);
  assert.equal((d.prepare("SELECT ocena FROM zwrot_klienta_pozycja WHERE id=?")
    .get(poz[0]) as { ocena: string }).ocena, "stan");
  assert.equal(stanOtwartegoKosza(d, KTO), null, "pustego kosza nie zakładamy na zapas");
});

test("domknięcie kolejkuje MM z magazynu głównego na regał zwrotów", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id: zwrotId, poz } = zwrotZTowarem(d, [11, 11, 12], KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  ocenPozycje(d, poz[1], "stan", 3, KTO);
  ocenPozycje(d, poz[2], "stan", 4, KTO);
  /* Korekta MUSI być wcześniej: MM zdejmuje towar z magazynu głównego,
     a wraca on tam dopiero po korekcie w Subiekcie. */
  skorygowany(d, zwrotId);

  const kosz = stanOtwartegoKosza(d, KTO)!;
  const at = "2026-09-04T11:22:33.000Z";
  const wynik = zamknijKosz(d, kosz.id, KTO, new Date(at));
  assert.equal(wynik.pozycji, 3);
  assert.equal(wynik.brakujeKorekt, 0);

  const z = d.prepare(
    "SELECT type, payload, status, tw_id, created_at FROM sfera_queue WHERE id=?")
    .get(wynik.queueId) as { type: string; payload: string; status: string;
      tw_id: number | null; created_at: string };
  assert.equal(z.type, "mm");
  assert.equal(z.status, "pending");
  /* Bez `tw_id`, bo zadanie jest WIELOPOZYCYJNE — i to jest dokładnie ten
     kształt, który guard kolejności workera przepuszcza (MM na bufor nie
     czyni towaru sprzedawalnym). Ustawione `tw_id` znaczyłoby, że koszyk
     rozbito na zadania jednopozycyjne, a wtedy jeden fizyczny kosz dałby
     magazynierowi kilka kartek. */
  assert.equal(z.tw_id, null);
  /* Czas ZAMKNIĘCIA kosza, nie chwila wstawienia wiersza: przy koszyku, który
     czekał na korektę, dzieli je nawet doba. */
  assert.equal(z.created_at, at);
  const p = JSON.parse(z.payload) as { magFrom: number; magTo: number;
    items: Array<{ twId: number; qty: number }> };
  assert.notEqual(p.magFrom, p.magTo, "MM z magazynu głównego NA regał zwrotów");
  /* Ten sam towar z dwóch zwrotów to JEDNA linia dokumentu — inaczej
     magazynier liczyłby ten sam symbol dwa razy przy tym samym regale. */
  assert.deepEqual(p.items.sort((a, b) => a.twId - b.twId),
    [{ twId: 11, qty: 4 }, { twId: 12, qty: 2 }]);

  assert.equal(stanOtwartegoKosza(d, KTO), null, "zamknięty kosz przestaje być otwarty");
  const k = d.prepare("SELECT status, mm_queue_id FROM kosz WHERE id=?")
    .get(kosz.id) as { status: string; mm_queue_id: number };
  assert.equal(k.status, "zamkniety", "hala ma co rozkładać, nie czekając na numer");
  assert.equal(Number(k.mm_queue_id), wynik.queueId);
});

test("na dokument MM idzie to, CO WRÓCIŁO, a nie deklaracja klienta (0.212.0)", () => {
  /* Magazynier rozkłada sztuki, nie zamiary. Gdyby kosz brał deklarację,
     dokument MM przesuwałby więcej, niż fizycznie leży w pudle. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, [11], KTO);
  d.prepare("UPDATE zwrot_klienta_pozycja SET ilosc_zwrocona=1 WHERE id=?").run(poz[0]);

  ocenPozycje(d, poz[0], "stan", 2, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  assert.equal(kosz.sztuk, 1, "zgłoszono 2, wróciła 1 — na dokument idzie 1");
});

test("BEZ MAG_ID_ODP utylizacja zachowuje się jak przed 0.211.0", () => {
  /* Ten plik biegnie bez `MAG_ID_ODP` w środowisku, więc mierzy dokładnie to,
     co zobaczy firma, która wdroży wydanie i nie ustawi numeru magazynu:
     ocena się zapisuje, koszyka nie ma, żaden dokument nie wychodzi.
     Zgadnięty numer przesunąłby złom w cudze miejsce, a MM się nie cofa
     jednym kliknięciem — dlatego domyślna wartość to zero, nie „jakiś". */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, [11], KTO);

  const wynik = ocenPozycje(d, poz[0], "utylizacja", 2, KTO);
  assert.equal(wynik.koszyk, null, "bez magazynu odpadu nie ma dokąd jechać");
  assert.equal((d.prepare("SELECT ocena FROM zwrot_klienta_pozycja WHERE id=?")
    .get(poz[0]) as { ocena: string }).ocena, "utylizacja", "ocena to fakt o towarze");
  assert.deepEqual(otwarteKoszyki(d, KTO).map((k) => k.rodzaj), [],
    "wyłączony odpad nie pokazuje się nawet jako pusty koszyk");
});

test("kosza Z DOKUMENTEM nie da się opróżnić ani zamknąć drugi raz", () => {
  /* BRAMKĄ JEST DOKUMENT, NIE ZAMKNIĘCIE (0.334.0). Do tego wydania blokowało
     samo zamknięcie — a kosz bywa zamknięty tygodniami, czekając na komplet
     korekt. Zgłoszenie właściciela: „dodałem zestaw, a powinienem rozbić go
     przed dodaniem do MM", i nie dało się tego poprawić, choć papieru nie było.
     Tu kosz ma już numer MM, więc odmowa zostaje. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, [11], KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  zamknijKosz(d, kosz.id, KTO);
  d.prepare("UPDATE kosz SET mm_numer='MM 1333/MAG/2026' WHERE id=?").run(kosz.id);

  assert.equal(zdejmijZKosza(d, poz[0], KTO), null);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id=?")
    .get(kosz.id) as { n: number }).n, 1);
  assert.throws(() => zamknijKosz(d, kosz.id, KTO), /jest już zamkniety/);

  /* Zmiana oceny po domknięciu ODMAWIA i nazywa kosz (0.202.0). Do tego
     wydania przechodziła w ciszy „zostawiając kosz w spokoju" — brzmiało to
     bezpiecznie, a znaczyło: towar zostaje na dokumencie, który pojechał na
     halę, tyle że bez oceny, która go tam posłała. Zawartość kosza jest
     nietknięta tak samo jak wcześniej; nowe jest to, że nietknięta zostaje
     też ocena, a człowiek dostaje kod kosza. */
  assert.throws(() => ocenPozycje(d, poz[0], "utylizacja", 3, KTO), new RegExp(kosz.kod));
  assert.throws(() => ocenPozycje(d, poz[0], null, 3, KTO), /zamkniętym koszyku/);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id=?")
    .get(kosz.id) as { n: number }).n, 1);
  assert.equal((d.prepare("SELECT ocena FROM zwrot_klienta_pozycja WHERE id=?")
    .get(poz[0]) as { ocena: string | null }).ocena, "stan");
});

test("pusty koszyk odmawia domknięcia", () => {
  /* Sfera odrzuciłaby go i tak — ale dopiero w workerze, czyli po tym, jak
     operator odszedłby od biurka. */
  const d = stanowisko();
  const KTO = biuro(d);
  const id = koszDoDolozenia(d, KTO);
  assert.throws(() => zamknijKosz(d, id, KTO), /pusty/);
});

test("każdy operator ma SWÓJ otwarty koszyk", () => {
  /* Fizyczny kosz stoi przy jednym biurku. Dwie osoby przy zwrotach nie
     mieszają towaru w jednym dokumencie — decyzja właściciela. */
  const d = stanowisko();
  const ala = biuro(d);
  const bok = Number(d.prepare(
    "INSERT INTO app_user(name,role) VALUES ('Bo','biuro')")
    .run().lastInsertRowid);
  const bo = { id: bok, name: "Bo" };
  const { poz } = zwrotZTowarem(d, [11, 12], ala);

  ocenPozycje(d, poz[0], "stan", 2, ala);
  dolozDoKosza(d, poz[1], bo);

  assert.equal(stanOtwartegoKosza(d, ala)?.pozycji, 1);
  assert.equal(stanOtwartegoKosza(d, bo)?.pozycji, 1);
  assert.notEqual(stanOtwartegoKosza(d, ala)?.kod, stanOtwartegoKosza(d, bo)?.kod);
});

test("koszyk bez kompletu korekt CZEKA, a ostatni numer go wypuszcza", () => {
  /* Sedno błędu zgłoszonego przez właściciela: MM zdejmuje towar z magazynu
     głównego, a ze zwrotu trafia on tam dopiero po korekcie. Dokument szedł
     więc na stan, którego jeszcze nie było. */
  const d = stanowisko();
  const KTO = biuro(d);
  const a = zwrotZTowarem(d, [11], KTO);
  const b = zwrotZTowarem(d, [12], KTO, "z2");
  ocenPozycje(d, a.poz[0], "stan", 2, KTO);
  ocenPozycje(d, b.poz[0], "stan", 2, KTO);
  skorygowany(d, a.id);   // jeden z dwóch — komplet to jeszcze nie jest

  const kosz = stanOtwartegoKosza(d, KTO)!;
  const wynik = zamknijKosz(d, kosz.id, KTO);
  assert.equal(wynik.queueId, null, "MM nie ma prawa wyjść przed korektą");
  assert.equal(wynik.brakujeKorekt, 1);
  assert.equal(Number((d.prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'")
    .get() as { n: number }).n), 0);

  const k = d.prepare("SELECT status FROM kosz WHERE id=?").get(kosz.id) as { status: string };
  assert.equal(k.status, "zamkniety",
    "zamknięcie jest czynnością FIZYCZNĄ — kosz odchodzi od biurka mimo braku papieru");

  assert.equal(wypuscGotoweKoszyki(d), 0, "wciąż brakuje jednej korekty");

  skorygowany(d, b.id, "KFS 2/2026");
  assert.equal(wypuscGotoweKoszyki(d), 1);
  const q = d.prepare("SELECT type, status FROM sfera_queue WHERE type='mm'")
    .get() as { type: string; status: string };
  assert.equal(q.status, "pending");

  assert.equal(wypuscGotoweKoszyki(d), 0,
    "drugi przebieg NIE tworzy drugiego dokumentu na jeden fizyczny kosz");
  assert.equal(Number((d.prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'")
    .get() as { n: number }).n), 1);
});

test("brakujące korekty wymieniają zwroty Z IMIENIA", () => {
  /* Człowiek ma wiedzieć, czego szukać w Subiekcie, a nie samo „czekam". */
  const d = stanowisko();
  const KTO = biuro(d);
  const a = zwrotZTowarem(d, [11], KTO);
  d.prepare("UPDATE zwrot_klienta SET reference_number='ZW-7' WHERE id=?").run(a.id);
  ocenPozycje(d, a.poz[0], "stan", 2, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  zamknijKosz(d, kosz.id, KTO);

  const braki = brakujaceKorekty(d, kosz.id);
  assert.deepEqual(braki, [{ zwrotId: a.id, numer: "ZW-7" }]);
});

/* ── Wypuszczenie MM mimo brakujących korekt (0.368.0) ──────────────────────
   Decyzja właściciela: „dodaj opcję sforsowania zamknięcia koszyka, nawet
   jeśli nie ma wszystkich ZW". Bramka z 0.200.0 zostaje domyślna — to wyjście
   awaryjne obok niej, nie jej zdjęcie. Koszt jest realny i te testy go
   utrwalają razem z drogą.                                                  */

test("wymuszenie wypuszcza MM mimo braku korekt i zostawia ślad Z IMIONAMI", () => {
  /* Gdy MM wywróci się na braku stanu, pierwsze pytanie brzmi „na czyją
     korektę nie doczekaliśmy". Zdarzenie ma na nie odpowiedzieć bez
     odtwarzania stanu bazy sprzed wypuszczenia. */
  const d = stanowisko();
  const KTO = biuro(d);
  const a = zwrotZTowarem(d, [11], KTO);
  const b = zwrotZTowarem(d, [12], KTO, "z2");
  d.prepare("UPDATE zwrot_klienta SET reference_number='ZW-7' WHERE id=?").run(a.id);
  d.prepare("UPDATE zwrot_klienta SET reference_number='ZW-8' WHERE id=?").run(b.id);
  ocenPozycje(d, a.poz[0], "stan", 2, KTO);
  ocenPozycje(d, b.poz[0], "stan", 2, KTO);

  const kosz = stanOtwartegoKosza(d, KTO)!;
  const w = wypuscMmMimoKorekt(d, kosz.id, KTO);
  assert.equal(w.pominietoKorekt, 2);
  assert.ok(w.queueId > 0, "dokument wychodzi mimo braków");
  assert.equal((d.prepare("SELECT status FROM kosz WHERE id=?")
    .get(kosz.id) as { status: string }).status, "zamkniety",
  "kosz otwarty zamyka się po drodze — jedna droga na oba stany");

  const e = d.prepare("SELECT payload FROM events WHERE type='kosz_zwrotow_mm_mimo_korekt'")
    .get() as { payload: string };
  assert.deepEqual(JSON.parse(e.payload).zwroty, ["ZW-7", "ZW-8"]);
});

test("wymuszenie działa TAKŻE na koszu już zamkniętym, który czeka tygodniami", () => {
  /* To jest przypadek z życia: kosz stoi zamknięty, korekty nie ma, a pudło
     blokuje pracę hali. Osobna opcja przy zamykaniu nie pomogłaby wcale. */
  const d = stanowisko();
  const KTO = biuro(d);
  const a = zwrotZTowarem(d, [11], KTO);
  ocenPozycje(d, a.poz[0], "stan", 2, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  assert.equal(zamknijKosz(d, kosz.id, KTO).queueId, null, "normalną drogą czeka");

  const w = wypuscMmMimoKorekt(d, kosz.id, KTO);
  assert.equal(w.pominietoKorekt, 1);
  assert.equal(Number((d.prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'")
    .get() as { n: number }).n), 1);
});

test("wymuszenie NIE robi drugiego dokumentu na jeden fizyczny kosz", () => {
  /* Idempotencja stoi na `kosz.mm_queue_id`, tak samo jak przy automacie.
     Dwa kliknięcia w jeden przycisk to scenariusz normalny, nie wypadek. */
  const d = stanowisko();
  const KTO = biuro(d);
  const a = zwrotZTowarem(d, [11], KTO);
  ocenPozycje(d, a.poz[0], "stan", 2, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  wypuscMmMimoKorekt(d, kosz.id, KTO);
  assert.throws(() => wypuscMmMimoKorekt(d, kosz.id, KTO), /ma już dokument MM/);
  assert.equal(Number((d.prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'")
    .get() as { n: number }).n), 1);
});

test("wymuszenie odmawia koszowi pustemu i rozliczonemu poza aplikacją", () => {
  /* Te odmowy nie są ostrożnością, tylko brakiem czegokolwiek do zrobienia:
     dokument bez linii nie jest dokumentem, a towar kosza rozliczonego ręką
     przesunął już ktoś inny. */
  const d = stanowisko();
  const KTO = biuro(d);
  const pusty = koszDoDolozenia(d, KTO);
  assert.throws(() => wypuscMmMimoKorekt(d, pusty, KTO), /pusty/);

  const a = zwrotZTowarem(d, [11], KTO);
  ocenPozycje(d, a.poz[0], "stan", 2, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  d.prepare("UPDATE kosz SET powrot_poza_aplikacja=1 WHERE id=?").run(kosz.id);
  assert.throws(() => wypuscMmMimoKorekt(d, kosz.id, KTO), /poza aplikacją/);
});

test("komplet korekt nie zmienia drogi — wymuszenie wypuszcza tak samo", () => {
  /* Przycisk ma działać także wtedy, gdy braków nie ma: człowiek nie musi
     najpierw sprawdzać, czy wolno mu go nacisnąć. Licznik pominiętych mówi
     wtedy zero i to jest cała różnica. */
  const d = stanowisko();
  const KTO = biuro(d);
  const a = zwrotZTowarem(d, [11], KTO);
  ocenPozycje(d, a.poz[0], "stan", 2, KTO);
  skorygowany(d, a.id);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  const w = wypuscMmMimoKorekt(d, kosz.id, KTO);
  assert.equal(w.pominietoKorekt, 0);
  assert.ok(w.queueId > 0);
});

/* ── Towar dołożony ręką: skan albo kartoteka (0.365.0) ─────────────────────
   Zgłoszenie właściciela, a zaraz po nim jego granica: „tylko z poziomu
   obsługi zwrotów, jak jeszcze nie jest zamknięty". Pudło bywa pełniejsze niż
   zgłoszenie — paczka nieodebrana bez numeru zamówienia nie ma ani jednej
   pozycji, a towar leży na biurku.                                          */

/** Kartoteka, którą można zeskanować. */
function kartoteka(d: Db, twId: number, symbol = `SYM-${twId}`,
  prowadzona = true) {
  d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(twId, symbol, `Towar ${twId}`);
  /* `prowadzona = false` opisuje USŁUGĘ: kartotekę bez ani jednego wiersza
     w `tw_Stan`, czyli taką, jakiej dokument MM nie ruszy (0.372.2). */
  if (prowadzona) {
    d.prepare("INSERT OR IGNORE INTO sgt_stan(tw_id,mag_id,stan) VALUES (?,1,0)").run(twId);
  }
}

test("skan dokłada towar do koszyka, a drugi skan DOLICZA sztukę", () => {
  /* Magazynier liczy sztuki skanowaniem — to ten sam ruch co przy dostawie.
     Osobne wiersze kazałyby potem sumować je wzrokiem. */
  const d = stanowisko();
  const KTO = biuro(d);
  kartoteka(d, 21, "SEK-1");

  const raz = dolozTowar(d, 21, 1, KTO);
  assert.equal(raz.symbol, "SEK-1");
  assert.equal(raz.ilosc, 1);
  const dwa = dolozTowar(d, 21, 1, KTO);
  assert.equal(dwa.pozycjaId, raz.pozycjaId, "ten sam wiersz, nie drugi");
  assert.equal(dwa.ilosc, 2);

  const stan = stanOtwartegoKosza(d, KTO)!;
  assert.equal(stan.pozycji, 1);
  assert.equal(stan.sztuk, 2);
  assert.equal(stan.pozycje[0].zeZwrotu, false, "ekran ma wiedzieć, którą drogą to weszło");
});

test("dołożony towar jedzie na MM i NIE trzyma go bramką korekt", () => {
  /* Wiersz bez zwrotu nie ma ceny ani zgłoszenia, więc nie wnosi nic do
     rozliczenia z klientem. Przesuwa wyłącznie towar — i ma pojechać nawet
     wtedy, gdy w pudle nie ma ani jednej pozycji ze zwrotu. */
  const d = stanowisko();
  const KTO = biuro(d);
  kartoteka(d, 22);
  dolozTowar(d, 22, 3, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;

  assert.deepEqual(brakujaceKorekty(d, kosz.id), [], "nie ma zwrotu, więc nie ma na co czekać");
  const w = zamknijKosz(d, kosz.id, KTO);
  assert.equal(w.brakujeKorekt, 0);
  assert.ok(w.queueId, "MM wychodzi od razu");
  const zadanie = d.prepare("SELECT payload FROM sfera_queue WHERE id=?").get(w.queueId) as
    { payload: string };
  assert.deepEqual((JSON.parse(zadanie.payload) as { items: Array<{ twId: number; qty: number }> })
    .items, [{ twId: 22, qty: 3 }]);
});

test("z koszyka BEZ DOKUMENTU schodzi każdy wiersz, a ze zwrotu razem z oceną", () => {
  /* ODWRÓCENIE REGUŁY z 0.365.0 („wiersz ze zwrotu schodzi cofnięciem oceny"),
     zgłoszone przez właściciela: „pozwól edytować te koszyki".

     Reguła była słuszna w zamyśle — jedna droga na jeden skutek — a zostawiła
     koszyki bez wyjścia. Z-8 na produkcji odbił się od Sfery na kartotece
     usługowej przyniesionej OCENĄ: nie miał ani jednego wiersza ze skanu,
     więc nie miał ani jednego krzyżyka.

     OCENA SCHODZI RAZEM Z WIERSZEM i to jest warunek spójności: to ona wsadziła
     towar do pudła, więc wyjęcie bez jej zdjęcia zostawiłoby kartę zwrotu
     mówiącą o regale, którego dokument tej sztuki nie niesie. */
  const d = stanowisko();
  const KTO = biuro(d);
  const z = zwrotZTowarem(d, [11], KTO);
  ocenPozycje(d, z.poz[0], "stan", 2, KTO);
  const wiersz = d.prepare(
    "SELECT id FROM kosz_pozycja WHERE zwrot_pozycja_id=?").get(z.poz[0]) as { id: number };

  zdejmijTowar(d, Number(wiersz.id), KTO);

  assert.equal(otwarteKoszyki(d, KTO)[0].pozycji, 0, "wiersz schodzi z pudła");
  const poz = d.prepare("SELECT ocena FROM zwrot_klienta_pozycja WHERE id=?")
    .get(z.poz[0]) as { ocena: string | null };
  assert.equal(poz.ocena, null, "ocena schodzi razem z nim");
  const slad = d.prepare(
    `SELECT COUNT(*) AS n FROM zwrot_zdarzenie WHERE zwrot_id=? AND rodzaj='ocena_cofnieta'`)
    .get(z.id) as { n: number };
  assert.equal(slad.n, 1, "oś zwrotu mówi, że sztuka wyszła z koszyka");
});

test("koszyk zamknięty BEZ DOKUMENTU wciąż oddaje wiersz dołożony ręką", () => {
  /* Zgłoszenie właściciela (0.371.0): „pozwól mi edytować koszyki zwrotowe,
     z których nie zostały jeszcze utworzone MM". Granica z 0.365.0 („jak
     jeszcze nie jest zamknięty") kosztowała koszyk Z-8: wszedł do niego skanem
     KOSZT PRZESYŁKI, kartoteka bez stanu, więc Sfera odrzuciła MM zdaniem
     „Brak towaru w magazynie" — a wiersza nie dało się zdjąć nigdzie. */
  const d = stanowisko();
  const KTO = biuro(d);
  kartoteka(d, 41);
  const dolozony = dolozTowar(d, 41, 1, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  zamknijKosz(d, kosz.id, KTO);

  zdejmijTowar(d, dolozony.pozycjaId, KTO);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id=?")
    .get(kosz.id) as { n: number }).n, 0, "wiersz zszedł z zamkniętego pudła");
  /* Zadanie MM ułożone dla starej zawartości traci ważność — inaczej papier
     pojechałby z tym, co już zdjęto. */
  assert.equal((d.prepare("SELECT mm_queue_id FROM kosz WHERE id=?")
    .get(kosz.id) as { mm_queue_id: number | null }).mm_queue_id, null);

  /* Dołożenie po zamknięciu dalej zakłada NOWY koszyk — przy biurku stoi nowe
     pudło, a nie dosypuje się do tego, które pojechało. Poprawianie pomyłki
     i dokładanie świeżego towaru to dwie różne czynności. */
  const nowy = dolozTowar(d, 41, 1, KTO);
  assert.notEqual(nowy.koszId, kosz.id);
});

test("koszyk Z DOKUMENTEM nie oddaje nic — papier pojechał na halę", () => {
  /* Druga strona tej samej bramki. Po wystawieniu MM zdjęcie wiersza
     rozjechałoby dokument z zawartością, a magazynier szukałby towaru,
     którego nikt nie wyjął z kartonu. */
  const d = stanowisko();
  const KTO = biuro(d);
  kartoteka(d, 42);
  const dolozony = dolozTowar(d, 42, 1, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  zamknijKosz(d, kosz.id, KTO);
  d.prepare("UPDATE kosz SET mm_numer='MM 1/ZWR/2026' WHERE id=?").run(kosz.id);

  assert.throws(() => zdejmijTowar(d, dolozony.pozycjaId, KTO), /ma już dokument MM/);
});

test("odmowy mówią, co jest nie tak: sztuki i nieznana kartoteka", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  kartoteka(d, 51);
  assert.throws(() => dolozTowar(d, 51, 0, KTO), /ile sztuk/);
  assert.throws(() => dolozTowar(d, 51, MAX_SZTUK_RECZNIE + 1, KTO), /Najwyżej/);
  assert.throws(() => dolozTowar(d, 999_999, 1, KTO), /Nie znam takiej kartoteki/);
});

test("kosz z ODRZUCONĄ MM widać w panelu — z odmową Sfery i wierszem do zdjęcia", () => {
  /* Koszyk Z-8 wypadł z panelu przez dwa warunki naraz: lista wymagała
     BRAKUJĄCEJ KOREKTY (a miał komplet) i braku zadania (a miał zadanie
     w błędzie). Kosz stał na hali, dokumentu nie było i nic o tym nie mówiło —
     cisza gorsza od złej wiadomości (0.371.0). */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id: zwrotId, poz } = zwrotZTowarem(d, [71], KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  skorygowany(d, zwrotId);
  kartoteka(d, 72, "KOSZT-PRZESYLKI");
  const dolozony = dolozTowar(d, 72, 1, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  zamknijKosz(d, kosz.id, KTO);

  const queueId = (d.prepare("SELECT mm_queue_id FROM kosz WHERE id=?")
    .get(kosz.id) as { mm_queue_id: number }).mm_queue_id;
  d.prepare("UPDATE sfera_queue SET status='error', error_msg=? WHERE id=?")
    .run("Brak towaru w magazynie", queueId);

  const lista = koszykiBezDokumentu(d);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].blad, "Brak towaru w magazynie");
  /* CAŁA zawartość od 0.379.0, nie tylko wiersze ze skanu: koszyk Z-8 odbił
     się na kartotece przyniesionej OCENĄ i nie miał czym się odetkać. */
  assert.deepEqual(lista[0].pozycje.map((p) => p.symbol).sort(),
    ["KOSZT-PRZESYLKI", "SYM-71"]);
  assert.deepEqual(lista[0].pozycje.map((p) => p.zeZwrotu).sort(), [false, true]);
  assert.equal(lista[0].brakuje.length, 0);
  /* `reconcile` mówi „brakuje: ..." i o koszu z kompletem korekt nie miałby co
     powiedzieć — wężysza lista nie ma prawa go złapać. */
  assert.equal(koszykiCzekajaceNaKorekty(d).length, 0);

  /* Zdjęcie pomyłki odpina zadanie: kosz przestaje mieć błąd, a panel dostaje
     stan, w którym wolno wystawić MM jeszcze raz. */
  zdejmijTowar(d, dolozony.pozycjaId, KTO);
  const po = koszykiBezDokumentu(d);
  assert.equal(po.length, 1);
  assert.equal(po[0].blad, null);
  assert.deepEqual(po[0].pozycje.map((p) => p.symbol), ["SYM-71"],
    "zostaje wiersz ze zwrotu — jego zdjęcie cofa przy okazji ocenę");
});

test("kosz z zadaniem W TOKU nie pokazuje się — papier jest w drodze", () => {
  /* Jedyną odpowiedzią byłoby „czekaj", a pasek mówiący „czekaj" uczy patrzeć
     w kolejkę zadań zamiast w pracę. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id: zwrotId, poz } = zwrotZTowarem(d, [73], KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  skorygowany(d, zwrotId);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  zamknijKosz(d, kosz.id, KTO);
  const queueId = (d.prepare("SELECT mm_queue_id FROM kosz WHERE id=?")
    .get(kosz.id) as { mm_queue_id: number }).mm_queue_id;

  d.prepare("UPDATE sfera_queue SET status='processing' WHERE id=?").run(queueId);
  assert.equal(koszykiBezDokumentu(d).length, 0);
  /* Tak samo po wystawieniu dokumentu — wtedy nie ma już czego poprawiać. */
  d.prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(queueId);
  d.prepare("UPDATE kosz SET mm_numer='MM 2/ZWR/2026' WHERE id=?").run(kosz.id);
  assert.equal(koszykiBezDokumentu(d).length, 0);
});

/* ── Kartoteka, której dokument MM nie ruszy (0.372.2) ──────────────────────
   Blizna Z-8: koszt przesyłki wszedł do pudła skanem, kosz się zamknął, a MM
   odbiła się od Sfery zdaniem „Brak towaru w magazynie". Odmowa ma paść przy
   dokładaniu, bo tam stoi człowiek z przedmiotem w ręku.                    */

test("usługi nie da się dołożyć do pudła — odmowa mówi, czego dotyczy", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  kartoteka(d, 943, "PRZESYLKA", false);

  assert.throws(() => dolozTowar(d, 943, 1, KTO),
    /PRZESYLKA.*nie jest prowadzona magazynowo/s,
    "odmowa niesie symbol i powód, a nie sam kod błędu");
  assert.equal(otwarteKoszyki(d, KTO).length, 0, "pudło nie powstaje dla odmowy");
});

test("kartoteka przesyłki odpada po numerze z konfiguracji, mimo wiersza stanu", () => {
  /* Ta sama kartoteka bywa prowadzona magazynowo — wtedy zostaje jej numer
     z `wertis.env`, ten sam, którego pilnuje automat ZW. Asymetria znaczyłaby,
     że jedna droga ją wpuszcza, a druga nie. */
  const d = stanowisko();
  kartoteka(d, 943, "PRZESYLKA");

  assert.equal(powodPozaMagazynem(d, 943, 943)?.includes("kartoteka przesyłki"), true);
  assert.equal(powodPozaMagazynem(d, 943, 0), null, "bez numeru w konfiguracji nie zgadujemy");
});

test("ocena „na stan” pozycji przesyłkowej NIE dokłada jej do pudła", () => {
  /* Wiersz przesyłki stoi na paragonie obok towaru, więc ta sama ocena, którą
     operator naciska na części, wpuściłaby go tą samą drogą. */
  const d = stanowisko();
  const KTO = biuro(d);
  const z = zwrotZTowarem(d, [77], KTO);
  d.prepare("DELETE FROM sgt_stan WHERE tw_id=77").run();

  const kosz = dolozDoKosza(d, z.poz[0], KTO);
  assert.equal(kosz, null, "pozycja nie wchodzi do koszyka");
  assert.equal(otwarteKoszyki(d, KTO).length, 0, "i nie zakłada pudła");
  const slad = d.prepare("SELECT COUNT(*) AS n FROM events WHERE type='kosz_zwrotow_odmowa'")
    .get() as { n: number };
  assert.equal(slad.n, 1, "odmowa zostawia ślad — cisza byłaby tu najgorsza");
});

/* ── Jedno pudło, jedno imię (0.376.0) ──────────────────────────────────────
   Karton nosił dwa imiona: „Z-7" w panelu i „1209" na hali. Wiązanie daje
   koszykowi jego własny dokument, zamiast pozwolić hali zrodzić sobowtóra. */

/** Koszyk zamknięty, z zadaniem MM w podanym stanie. */
function koszykZZadaniem(d: Db, numer: string | null, status = "done") {
  const teraz = "2026-09-16T10:00:00Z";
  const q = Number(d.prepare(
    `INSERT INTO sfera_queue(type, status, payload, sgt_doc_number, created_at, created_by)
     VALUES ('mm', ?, '{}', ?, ?, 'Biuro')`).run(status, numer, teraz).lastInsertRowid);
  const id = Number(d.prepare(
    `INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez, mm_queue_id)
     VALUES ('Z-9', 'zamkniety', 'zwroty', ?, 'Ala', ?)`).run(teraz, q).lastInsertRowid);
  return id;
}

const dokument = (d: Db, dokId: number, nrPelny: string, numer: string) =>
  d.prepare(`INSERT INTO sgt_mm_zwrot(dok_id, nr_pelny, numer, data_wyst, mag_z, mag_do)
     VALUES (?,?,?,'2026-09-16',1,3)`).run(dokId, nrPelny, numer);

test("koszyk dostaje SWÓJ dokument, gdy ten wejdzie do read-modelu", () => {
  const d = stanowisko();
  const koszId = koszykZZadaniem(d, "MM 1209/MAG/2026");

  assert.equal(zwiazKoszykiZDokumentami(d), 0, "bez dokumentu nie ma czego wiązać");

  dokument(d, 41209, "MM 1209/MAG/2026", "1209");
  assert.equal(zwiazKoszykiZDokumentami(d), 1);

  const k = d.prepare("SELECT mm_dok_id, mm_numer, mm_mag_z FROM kosz WHERE id=?").get(koszId) as
    { mm_dok_id: number; mm_numer: string; mm_mag_z: number };
  assert.equal(k.mm_dok_id, 41209);
  assert.equal(k.mm_numer, "MM 1209/MAG/2026");
  /* MAGAZYN ŹRÓDŁOWY RAZEM Z DOKUMENTEM. Od związania trasę powrotu liczy
     gałąź „kosz z dokumentu", a ta bierze cel wyłącznie stąd — bez tej
     kolumny towar zostałby na regale zwrotów. */
  assert.equal(k.mm_mag_z, 1, "powrót ma dokąd wrócić");
  assert.equal(zwiazKoszykiZDokumentami(d), 0, "drugi takt nie wiąże drugi raz");
});

test("wiązanie idzie po PEŁNYM numerze — liczba powtarza się co rok", () => {
  /* Dopasowanie po samej liczbie zderzyłoby dzisiejszy karton z zeszłorocznym:
     numery MM w Subiekcie startują od nowa z każdym rokiem. */
  const d = stanowisko();
  const koszId = koszykZZadaniem(d, "MM 1209/MAG/2026");
  dokument(d, 40209, "MM 1209/MAG/2025", "1209");

  assert.equal(zwiazKoszykiZDokumentami(d), 0, "zeszłoroczny dokument to nie ten karton");
  assert.equal((d.prepare("SELECT mm_dok_id FROM kosz WHERE id=?").get(koszId) as
    { mm_dok_id: number | null }).mm_dok_id, null);
});

test("koszyk z zadaniem W TOKU nie wiąże się z niczym", () => {
  /* Dopóki Sfera nie oddała numeru, dokumentu nie ma — a kosz związany
     z cudzym dokumentem posłałby halę do nie tego pudła. */
  const d = stanowisko();
  koszykZZadaniem(d, null, "pending");
  dokument(d, 41209, "MM 1209/MAG/2026", "1209");

  assert.equal(zwiazKoszykiZDokumentami(d), 0);
});

/* ── Poprawki z przeglądu 0.377.0 ───────────────────────────────────────────
   Trzy dziury znalezione w przeglądzie własnego diffu, każda z ceną w towarze. */

test("dokument, który ma już swój kosz hali, NIE wiąże się z koszykiem", () => {
  /* Wyścig: między importem a taktem workera mija do minuty, a magazynier
     bywa szybszy. Drugi kosz z tym samym `mm_dok_id` dałby dwa wiersze
     w liście przyjęć i drugie MM powrotne na towar, który już wrócił. */
  const d = stanowisko();
  const koszId = koszykZZadaniem(d, "MM 1209/MAG/2026");
  dokument(d, 41209, "MM 1209/MAG/2026", "1209");
  d.prepare(`INSERT INTO kosz(kod, status, rodzaj, mm_dok_id, utworzono_at, utworzono_przez)
     VALUES ('1209','zamkniety','zwroty',41209,'2026-09-16T10:30:00Z','Jan')`).run();

  assert.equal(zwiazKoszykiZDokumentami(d), 0);
  assert.equal((d.prepare("SELECT mm_dok_id FROM kosz WHERE id=?").get(koszId) as
    { mm_dok_id: number | null }).mm_dok_id, null, "koszyk zostaje bez dokumentu");
  const slad = d.prepare(
    "SELECT COUNT(*) AS n FROM events WHERE type='kosz_zwrotow_zwiazanie_pominiete'")
    .get() as { n: number };
  assert.equal(slad.n, 1, "pominięcie zostawia ślad — cisza kazałaby szukać usterki");
});

test("kartoteki NIEZNANEJ read-modelowi nie sądzimy — to towar zablokowany", () => {
  /* Importer bierze wyłącznie kartoteki odblokowane i tylko dla nich wstawia
     wiersze stanu. Towar zablokowany w Subiekcie nie ma tu ani jednego wiersza,
     a leży na regale zwrotów najczęściej ze wszystkich. Brak stanu znaczy
     „usługa" DOPIERO wtedy, gdy kartotekę skądinąd znamy. */
  const d = stanowisko();
  assert.equal(powodPozaMagazynem(d, 900_099), null, "nieznana kartoteka przechodzi");

  kartoteka(d, 900_098, "SYM-98", false);
  assert.notEqual(powodPozaMagazynem(d, 900_098), null, "znana i bez stanu — to usługa");
});

test("ptaszek składnika NIE jest obejściem bramki kartotek", () => {
  /* Koszyk napełniony przed 0.374.0 dostawał wiersz usługowy z powrotem przez
     odznaczenie i zaznaczenie go na nowo. Jedna reguła, jedno miejsce.

     Pozycja musi mieć DWA składniki, bo ostatniego wiersza kosz nie oddaje —
     zapamiętany komplet daje taki skład bez sięgania po paragon. */
  const d = stanowisko();
  const KTO = biuro(d);
  const z = zwrotZTowarem(d, [11], KTO);
  d.prepare("UPDATE zwrot_klienta_pozycja SET tw_id=NULL WHERE id=?").run(z.poz[0]);
  const oferta = (d.prepare("SELECT offer_id FROM zwrot_klienta_pozycja WHERE id=?")
    .get(z.poz[0]) as { offer_id: string }).offer_id;
  kartoteka(d, 12, "SYM-12");
  zapamietajSklad(d, 1, oferta,
    [{ twId: 11, symbol: "SYM-11", nazwa: "Towar 11", ilosc: 1 },
     { twId: 12, symbol: "SYM-12", nazwa: "Towar 12", ilosc: 1 }],
    () => 1, "biuro", KTO);

  const koszId = ocenPozycje(d, z.poz[0], "stan", 2, KTO).koszyk;
  assert.notEqual(koszId, null, "komplet wchodzi do pudła dwoma wierszami");

  /* Kartoteka traci stan już PO wejściu do pudła — tak wygląda wiersz sprzed
     bramki, widziany dzisiejszymi oczami. */
  d.prepare("DELETE FROM sgt_stan WHERE tw_id=11").run();
  zaznaczSkladnik(d, z.poz[0], 11, false, KTO);

  assert.throws(() => zaznaczSkladnik(d, z.poz[0], 11, true, KTO),
    /nie wejdzie do pudła/, "ta sama odmowa co przy dokładaniu");
});

/* ── Koszyk zakładany WPROST (0.378.0) ──────────────────────────────────────
   Zgłoszenie właściciela: „potrzebuję tworzenia koszy zwrotowych i dodawania
   produktów do nich jako oddzielna opcja". Pusty karton staje przy biurku,
   ZANIM otworzy się pierwszą paczkę.                                         */

test("NOWY KOSZYK zakłada pudło bez ani jednej pozycji", () => {
  const d = stanowisko();
  const KTO = biuro(d);

  const kosz = zalozKoszyk(d, KTO);

  assert.equal(kosz.pozycji, 0, "pudło jest puste i to jest cały sens tej drogi");
  assert.equal(kosz.rodzaj, "zwroty");
  assert.match(kosz.kod, /^Z-\d+$/);
  assert.equal(otwarteKoszyki(d, KTO).length, 1);
});

test("drugie naciśnięcie zakłada DRUGIE pudło, a ocena pyta, do którego", () => {
  /* ODWRÓCENIE decyzji z 3 września („jeden koszyk na operatora"). Przy biurku
     stoi czasem kilka kartonów, a zamykanie pierwszego po to, żeby zacząć
     drugi, wystawia dokument na pudło, które jeszcze nie odjechało.

     Cena tej swobody: przy kilku pudłach ocena PYTA. Zgadywanie „do
     najnowszego" byłoby tanie w kodzie i drogie na hali. */
  const d = stanowisko();
  const KTO = biuro(d);

  const raz = zalozKoszyk(d, KTO);
  const dwa = zalozKoszyk(d, KTO);

  assert.notEqual(dwa.id, raz.id);
  assert.equal(otwarteKoszyki(d, KTO).length, 2);

  const z = zwrotZTowarem(d, [11], KTO);
  assert.throws(() => ocenPozycje(d, z.poz[0], "stan", 2, KTO), /wskaż, do którego/);

  /* Ze wskazaniem przechodzi i trafia DOKŁADNIE tam, gdzie kazano. */
  const wynik = ocenPozycje(d, z.poz[0], "stan", 2, KTO, new Date(), dwa.id);
  assert.equal(wynik.koszyk, dwa.id);
  assert.equal(otwarteKoszyki(d, KTO).find((k) => k.id === raz.id)!.pozycji, 0);
});

test("koszyk schodzi CAŁY — także napełniony, a oceny wracają", () => {
  /* Zgłoszenie właściciela (0.380.0): „zrób, żeby można było usunąć cały
     koszyk zwrotowy". Do 0.379.0 schodził wyłącznie pusty, więc pudło odrzucone
     przez Sferę trzeba było opróżniać wiersz po wierszu.

     OCENY WRACAJĄ tą samą regułą co przy zdejmowaniu jednego wiersza: to one
     wsadziły towar do pudła. */
  const d = stanowisko();
  const KTO = biuro(d);
  const z = zwrotZTowarem(d, [11], KTO);
  ocenPozycje(d, z.poz[0], "stan", 2, KTO);
  kartoteka(d, 21, "SEK-1");
  const kosz = otwarteKoszyki(d, KTO)[0];
  dolozTowar(d, 21, 1, KTO, new Date(), "zwroty", kosz.id);

  const wynik = usunKoszyk(d, kosz.id, KTO);

  assert.equal(wynik.pozycji, 2, "schodzi cała zawartość, nie po wierszu");
  assert.equal(wynik.zwrotow, 1);
  assert.equal(otwarteKoszyki(d, KTO).length, 0, "pudła nie ma");
  assert.equal((d.prepare("SELECT ocena FROM zwrot_klienta_pozycja WHERE id=?")
    .get(z.poz[0]) as { ocena: string | null }).ocena, null, "ocena wróciła");
  /* Dziennik jest jedynym miejscem, gdzie zostaje odpowiedź „co w nim było". */
  const slad = d.prepare(
    "SELECT payload FROM events WHERE type='kosz_zwrotow_usuniety'").get() as
    { payload: string };
  assert.match(slad.payload, /SEK-1/);
});

test("koszyk ZAMKNIĘTY bez dokumentu też schodzi — to on blokuje pasek", () => {
  /* Pudła odrzucone przez Sferę stoją zamknięte i to właśnie one zajmowały
     właścicielowi pół ekranu. Bramką jest DOKUMENT, nie zamknięcie. */
  const d = stanowisko();
  const KTO = biuro(d);
  const z = zwrotZTowarem(d, [11], KTO);
  skorygowany(d, z.id);
  ocenPozycje(d, z.poz[0], "stan", 2, KTO);
  const kosz = otwarteKoszyki(d, KTO)[0];
  zamknijKosz(d, kosz.id, KTO);

  assert.equal(usunKoszyk(d, kosz.id, KTO).kod, kosz.kod);
  assert.equal(koszykiBezDokumentu(d).length, 0, "pasek pustoszeje");
  const zadanie = d.prepare("SELECT status FROM sfera_queue WHERE type='mm'")
    .get() as { status: string } | undefined;
  assert.notEqual(zadanie?.status, "pending",
    "zadanie MM schodzi razem z koszykiem — inaczej wisiałoby nad niczym");
});

test("koszyka Z DOKUMENTEM nie usuwa nikt", () => {
  /* Papier pojechał na halę, ktoś rozkłada z niego towar, a stan w Subiekcie
     już się przesunął. Kasowanie kosza u nas nie cofnęłoby ani jednej z tych
     rzeczy — zostawiłoby tylko halę bez listy. */
  const d = stanowisko();
  const KTO = biuro(d);
  const kosz = zalozKoszyk(d, KTO);
  d.prepare("UPDATE kosz SET mm_dok_id=41209, status='zamkniety' WHERE id=?").run(kosz.id);

  assert.throws(() => usunKoszyk(d, kosz.id, KTO), /ma już dokument MM/);
});

test("usunięcie koszyka z zadaniem W BŁĘDZIE zdejmuje także to zadanie", () => {
  /* Pudło odrzucone przez Sferę ma przy sobie zadanie w błędzie. Zostawione
     bez kosza wisiałoby w kolejce jako praca nad czymś, czego nie ma. */
  const d = stanowisko();
  const KTO = biuro(d);
  const kosz = zalozKoszyk(d, KTO);
  const q = Number(d.prepare(
    `INSERT INTO sfera_queue(type, status, payload, error_msg, created_at, created_by)
     VALUES ('mm','error','{}','Brak towaru w magazynie','2026-09-17T08:00:00Z','Ala')`)
    .run().lastInsertRowid);
  d.prepare("UPDATE kosz SET mm_queue_id=? WHERE id=?").run(q, kosz.id);

  usunKoszyk(d, kosz.id, KTO);

  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM kosz WHERE id=?")
    .get(kosz.id) as { n: number }).n, 0);
});

test("pasek mówi, KTÓREGO towaru brakuje na magazynie (0.381.0)", () => {
  /* Produkcja, 17 września: „dostaję brak towaru w magazynie, ale nie mówi
     jakiego, abym mógł go usunąć z koszyka". Sfera nie nazywa wiersza —
     nazywamy go za nią, stanem z read-modelu. */
  const d = stanowisko();
  const KTO = biuro(d);
  const z = zwrotZTowarem(d, [11], KTO);
  skorygowany(d, z.id);
  ocenPozycje(d, z.poz[0], "stan", 2, KTO);
  kartoteka(d, 21, "S10111");
  const kosz = otwarteKoszyki(d, KTO)[0];
  dolozTowar(d, 21, 5, KTO, new Date(), "zwroty", kosz.id);
  /* Na magazynie głównym leżą DWA sekatory — dokładnie tyle, ile bierze
     koszyk — i ani jednej usługi. */
  d.prepare("UPDATE sgt_stan SET stan=2 WHERE tw_id=11 AND mag_id=1").run();
  zamknijKosz(d, kosz.id, KTO);
  const q = (d.prepare("SELECT mm_queue_id FROM kosz WHERE id=?").get(kosz.id) as
    { mm_queue_id: number }).mm_queue_id;
  d.prepare("UPDATE sfera_queue SET status='error', error_msg=? WHERE id=?")
    .run('Sfera odrzuciła "MM.Zapisz()": Brak towaru w magazynie.', q);

  const czeka = koszykiBezDokumentu(d)[0];

  const wg = new Map(czeka.pozycje.map((p) => [p.symbol, p]));
  assert.equal(wg.get("S10111")!.brakNaMag, true, "usługa nie ma czym się przesunąć");
  assert.equal(wg.get("S10111")!.stanMag, 0);
  assert.equal(wg.get("SYM-11")!.brakNaMag, false, "sekator ma pokrycie");
  assert.equal(wg.get("SYM-11")!.stanMag, 2);
});

test("poprawka GASI stare zadanie w błędzie — PONÓW nie wskrzesi duplikatu", () => {
  /* Koszyk Z-23 zebrał tak TRZY żywe zadania MM naraz (0.420.0). W czasie
     awarii pustej sesji Sfery każde zadanie tego kosza schodziło w `error`,
     każda poprawka zawartości odpinała je i zamawiała nowe, a biuro naciskało
     PONÓW na starych wierszach — w kolejce wyglądały jak zwykła praca do
     odzyskania. Każde wskrzeszone zadanie wystawia WŁASNY dokument MM na to
     samo pudło, czyli ten sam towar przesunięty trzy razy. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id: zwrotId, poz } = zwrotZTowarem(d, [81], KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  skorygowany(d, zwrotId);
  kartoteka(d, 82, "KOSZT-PRZESYLKI");
  const dolozony = dolozTowar(d, 82, 1, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  zamknijKosz(d, kosz.id, KTO);

  const stare = (d.prepare("SELECT mm_queue_id FROM kosz WHERE id=?").get(kosz.id) as
    { mm_queue_id: number }).mm_queue_id;
  d.prepare("UPDATE sfera_queue SET status='error', error_msg=? WHERE id=?")
    .run("GT.Uruchom oddał pustą sesję", stare);

  zdejmijTowar(d, dolozony.pozycjaId, KTO);

  const po = d.prepare("SELECT status, error_msg FROM sfera_queue WHERE id=?").get(stare) as
    { status: string; error_msg: string | null };
  assert.equal(po.status, "cancelled",
    "stare zadanie ma być ZGASZONE — PONÓW przyjmuje wyłącznie `error`");
  /* Ślad po nieudanej próbie zostaje: anulowanie nie kasuje `error_msg`, więc
     uzasadnienie starej reguły („ślad w kolejce") nic nie traci. */
  assert.equal(po.error_msg, "GT.Uruchom oddał pustą sesję");
  assert.equal((d.prepare("SELECT mm_queue_id FROM kosz WHERE id=?").get(kosz.id) as
    { mm_queue_id: number | null }).mm_queue_id, null, "kosz wraca pod automat");

  wypuscGotoweKoszyki(d);
  const zywe = (d.prepare(
    `SELECT COUNT(*) AS n FROM sfera_queue
      WHERE type='mm' AND status IN ('pending','processing','waiting_for_doc')`)
    .get() as { n: number }).n;
  assert.equal(zywe, 1, "jedno pudło, jedno żywe zadanie MM");
});
