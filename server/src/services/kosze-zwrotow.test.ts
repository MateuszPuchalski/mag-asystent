import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  brakujaceKorekty, dolozDoKosza, otwarteKoszyki, otwartyKosz, stanOtwartegoKosza,
  wypuscGotoweKoszyki, zamknijKosz, zdejmijZKosza,
} from "./kosze-zwrotow.js";
import { ocenPozycje, rozstrzygnijZwrot } from "./zwroty.js";

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

test("zamkniętego kosza nie da się opróżnić ani zamknąć drugi raz", () => {
  /* Kosz zamknięty pojechał na halę z wystawionym papierem. Wyjęcie wiersza
     rozjechałoby dokument z zawartością. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, [11], KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  const kosz = stanOtwartegoKosza(d, KTO)!;
  zamknijKosz(d, kosz.id, KTO);

  assert.equal(zdejmijZKosza(d, poz[0], KTO), false);
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
  const id = otwartyKosz(d, KTO);
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
