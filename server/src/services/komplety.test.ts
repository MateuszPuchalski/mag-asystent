import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { skladPozycji, wierszeDokumentuZwrotu } from "./komplety.js";
import { wskazSklad } from "./zwroty.js";
import {
  dolozDoKosza, przeliczKosz, skladDoZaznaczenia, wypuscGotoweKoszyki, zamknijKosz,
  zaznaczSkladnik, zdejmijZKosza,
} from "./kosze-zwrotow.js";

/* ── Komplet rozbity na paragonie (0.328.0) ─────────────────────────────────
   Zgłoszenie właściciela: oferta sprzedaje się jako komplet, a na magazynie
   leży osobno; do koszyka mają iść kartoteki Z PARAGONU, bo tam komplet jest
   rozbity na wiersze. Reguła, zapisana dosłownie: „kartotekę tak, z paragonu,
   ale ilość bierze ze zwrotu".

   Sześć rzeczy warte testu, bo każda kładzie towar na złej półce albo podnosi
   stan o sztuki, których nikt nie oddał:

   1. ILOŚĆ ZE ZWROTU, nie z paragonu. Paragon niesie całe zamówienie.
   2. KOMPLET ROZBIJA SIĘ na wiersze dokumentu.
   3. CUDZA OFERTA ZABIERA SWOJE — reszta należy do kompletu.
   4. DWIE OFERTY BEZ KARTOTEKI: automat MILCZY, zamiast zgadywać.
   5. NA JEDEN KOMPLET, nie na zamówienie: dwa kupione, jeden zwracany.
   6. ZAPAMIĘTANY SKŁAD rozstrzyga przy następnym zwrocie.                   */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

function biuro(d: Db) {
  const id = Number(d.prepare("INSERT INTO app_user(name,role) VALUES ('Ala','biuro')")
    .run().lastInsertRowid);
  return { id, name: "Ala" };
}

function towar(d: Db, twId: number) {
  d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(twId, `SYM-${twId}`, `Towar ${twId}`);
}

/** Paragon z rozbitymi pozycjami — tak wystawia go Subiekt. */
function paragon(d: Db, dokId: number, linie: Array<[number, number]>) {
  d.prepare(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,data_wyst)
    VALUES (?,'PA',?, '2026-09-01')`).run(dokId, `PA ${dokId}/2026`);
  for (const [twId, ilosc] of linie) {
    towar(d, twId);
    d.prepare("INSERT INTO sgt_faktura_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)")
      .run(dokId, twId, ilosc);
  }
  return dokId;
}

/** Zamówienie z ofertami — po nim odejmuje się to, co NIE jest kompletem. */
function zamowienie(d: Db,
  oferty: Array<{ offerId: string; ilosc: number; sku?: string | null }>) {
  const id = Number(d.prepare(`INSERT INTO zamowienie_klienta
    (channel_account_id,external_id,status,dostawa_grosze,suma_grosze,waluta,synced_at)
    VALUES (1,'ord-1','READY_FOR_PROCESSING',0,10000,'PLN','2026-09-01T08:00:00Z')`)
    .run().lastInsertRowid);
  for (const o of oferty) {
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja
      (zamowienie_id,external_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
      VALUES (?,?,?,?,?,?,5000,'PLN')`)
      .run(id, `li-${o.offerId}`, o.offerId, `Oferta ${o.offerId}`,
        o.sku ?? null, o.ilosc);
  }
  return id;
}

function mapuj(d: Db, offerId: string, twId: number) {
  towar(d, twId);
  d.prepare(`INSERT INTO oferta_kartoteka
    (channel_account_id,offer_id,tw_id,tw_symbol,wskazano_at,wskazano_przez)
    VALUES (1,?,?,?, '2026-09-01T08:00:00Z','Ala')`).run(offerId, twId, `SYM-${twId}`);
}

/** Zwrot z pozycjami; `twId` null = oferta bez kartoteki, czyli komplet. */
let kolejnyZwrot = 0;
function zwrot(d: Db, dokId: number | null,
  pozycje: Array<{ offerId: string; twId: number | null; ilosc: number; zwrocona?: number }>) {
  /* Własny numer na każdy zwrot: jeden test bada DWA zwroty tego samego
     zamówienia, a `external_id` jest unikalny w obrębie konta. */
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,created_at,synced_at,faktura_dok_id)
    VALUES (1,?,'ord-1','2026-09-02T08:00:00Z','2026-09-02T08:00:00Z',?)`)
    .run(`zw-${++kolejnyZwrot}`, dokId).lastInsertRowid);
  const poz = pozycje.map((p, i) => {
    if (p.twId != null) towar(d, p.twId);
    return Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
      (zwrot_id,klucz,offer_id,nazwa,ilosc,ilosc_zwrocona,cena_grosze,waluta,tw_id)
      VALUES (?,?,?,?,?,?,5000,'PLN',?)`)
      .run(id, `k${i}`, p.offerId, `Pozycja ${i}`, p.ilosc, p.zwrocona ?? null, p.twId)
      .lastInsertRowid);
  });
  return { id, poz };
}

test("zwykła pozycja bierze kartotekę z paragonu, a ILOŚĆ ze zwrotu", () => {
  /* Paragon niesie CAŁE zamówienie. Klient kupił pięć, oddaje dwie — gdyby
     ilość szła z dokumentu, na półkę wróciłoby pięć sztuk, a trzy zostałyby
     u klienta i na stanie naraz. */
  const d = stanowisko();
  const dok = paragon(d, 900, [[11, 5]]);
  zamowienie(d, [{ offerId: "of-A", ilosc: 5 }]);
  mapuj(d, "of-A", 11);
  const { poz } = zwrot(d, dok, [{ offerId: "of-A", twId: 11, ilosc: 2 }]);

  const s = skladPozycji(d, poz[0]);
  assert.equal(s.zrodlo, "paragon");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[11, 2]]);
});

test("komplet rozbija się na wiersze paragonu", () => {
  /* Oferta jest jedna, a na magazynie leżą trzy kartoteki. Mapowanie oferty
     nie ma jak ich wskazać — klucz `oferta_kartoteka` to (konto, oferta). */
  const d = stanowisko();
  const dok = paragon(d, 901, [[21, 1], [22, 1], [23, 2]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.equal(s.zrodlo, "paragon");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 1], [22, 1], [23, 2]]);
});

test("cudza oferta zabiera SWOJE sztuki, reszta należy do kompletu", () => {
  /* Klient kupił komplet i osobno sekator. Bez odejmowania sekator wjechałby
     do koszyka jako część kompletu — a klient go zatrzymał. */
  const d = stanowisko();
  const dok = paragon(d, 902, [[21, 1], [22, 1], [30, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-SEK", ilosc: 1 }]);
  mapuj(d, "of-SEK", 30);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.deepEqual(s.skladniki.map((x) => x.twId), [21, 22]);
});

test("ten sam towar w komplecie I osobno — odejmuje się SZTUKI, nie wiersz", () => {
  /* Sekator jest częścią kompletu i został dokupiony osobno: na paragonie
     stoi jedną pozycją na dwie sztuki. Skreślenie całego wiersza zabrałoby
     komplet jego składnika. */
  const d = stanowisko();
  const dok = paragon(d, 903, [[21, 1], [30, 2]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-SEK", ilosc: 1 }]);
  mapuj(d, "of-SEK", 30);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 1], [30, 1]]);
});

test("cudza oferta zabiera swoje po SKU, gdy nikt jej jeszcze nie mapował (0.343.0)", () => {
  /* TO JEST POWÓD, DLA KTÓREGO AUTOMAT MILCZAŁ. `oferta_kartoteka` wypełnia
     się dopiero przy zwrocie DANEJ oferty, więc w zamówieniu na kilka różnych
     rzeczy pozostałe oferty nie mają mapowania prawie nigdy. Rozbicie
     kompletu odmawiało nie dlatego, że dane są złe, tylko dlatego, że
     pytaliśmy nie o to źródło. */
  const d = stanowisko();
  const dok = paragon(d, 940, [[21, 1], [22, 1], [30, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 },
    { offerId: "of-INNY", ilosc: 1, sku: "SYM-30" }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.equal(s.zrodlo, "paragon", "komplet wchodzi, choć nikt nie mapował drugiej oferty");
  assert.deepEqual(s.skladniki.map((x) => x.twId), [21, 22], "SYM-30 zabrała cudza oferta");
});

test("SKU trafiające w DWIE kartoteki to brak trafienia", () => {
  /* Symbol miał być unikalny; skoro nie jest, zgadywanie przypisałoby wiersze
     paragonu cudzej ofercie — czyli położyłoby na półkę towar, którego nikt
     nie oddał. Ta sama zasada co przy propozycji kartoteki. */
  const d = stanowisko();
  const dok = paragon(d, 941, [[21, 1], [30, 1]]);
  /* Druga kartoteka o tym samym symbolu, innym numerze. */
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (31,'SYM-30','Dubel')").run();
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 },
    { offerId: "of-INNY", ilosc: 1, sku: "SYM-30" }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  assert.match(String(skladPozycji(d, poz[0]).powod), /nie umiem rozdzielić/);
});

test("dopasowanie po SKU NIE zapisuje się do pamięci wskazań", () => {
  /* `oferta_kartoteka` jest pamięcią CZŁOWIEKA (§4.3 panelu): wynik automatu
     nie ma udawać czyjejś decyzji. Tutaj odpowiadamy tylko na pytanie, czyj
     jest ten wiersz paragonu. */
  const d = stanowisko();
  const dok = paragon(d, 942, [[21, 1], [30, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 },
    { offerId: "of-INNY", ilosc: 1, sku: "SYM-30" }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  skladPozycji(d, poz[0]);

  assert.equal((d.prepare(
    "SELECT COUNT(*) AS n FROM oferta_kartoteka WHERE offer_id='of-INNY'")
    .get() as { n: number }).n, 0);
});

test("dwie oferty bez kartoteki: automat MILCZY i mówi dlaczego", () => {
  /* Zgadnięty podział kładzie na półkę cudzy towar i podnosi stan o sztuki,
     których nikt nie oddał. Wychodzi to przy inwentaryzacji, czyli za późno. */
  const d = stanowisko();
  const dok = paragon(d, 904, [[21, 1], [22, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-INNY", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.deepEqual(s.skladniki, []);
  assert.match(String(s.powod), /nie umiem rozdzielić/);
});

test("dwa komplety kupione, jeden zwracany — sztuki dzielą się NA KOMPLET", () => {
  const d = stanowisko();
  const dok = paragon(d, 905, [[21, 2], [23, 4]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 2 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 1], [23, 2]]);
});

test("liczy się to, co WRÓCIŁO, a nie deklaracja klienta", () => {
  /* Ta sama reguła co przy kwocie (0.212.0): `ilosc_zwrocona` wypełnia biuro
     po otwarciu kartonu i ona rozstrzyga. */
  const d = stanowisko();
  const dok = paragon(d, 906, [[21, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 3 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 3, zwrocona: 0 }]);

  assert.deepEqual(skladPozycji(d, poz[0]).skladniki.map((x) => x.ilosc), [0, 0]);
});

test("bez wskazanego dokumentu zostaje droga sprzed tego wydania", () => {
  /* Zwrot, przy którym nikt nie wskazał paragonu, ma dalej działać: kartoteka
     z mapowania oferty, ilość ze zwrotu. */
  const d = stanowisko();
  const { poz } = zwrot(d, null, [{ offerId: "of-A", twId: 11, ilosc: 2 }]);

  const s = skladPozycji(d, poz[0]);
  assert.equal(s.zrodlo, "oferta");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[11, 2]]);
});

test("koszyk dostaje WSZYSTKIE kartoteki kompletu, a zdjęcie zabiera wszystkie", () => {
  /* Zdjęcie jednego wiersza zostawiłoby resztę zestawu na dokumencie MM —
     towar na papierze, którego nikt nie wyjął z pudła. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 907, [[21, 1], [22, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const koszId = dolozDoKosza(d, poz[0], kto);
  assert.notEqual(koszId, null);
  const { n } = d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE zwrot_pozycja_id=?")
    .get(poz[0]) as { n: number };
  assert.equal(n, 3);

  assert.notEqual(zdejmijZKosza(d, poz[0], kto), null, "oddaje kosz, z którego zdjęto");
  const { n: po } = d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE zwrot_pozycja_id=?")
    .get(poz[0]) as { n: number };
  assert.equal(po, 0);
});

test("skład policzony raz obowiązuje przy następnym zwrocie tej oferty", () => {
  /* Bez pamięci ten sam komplet raz wchodziłby do koszyka, a raz nie —
     zależnie od tego, co klient dokupił w tamtym zamówieniu. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 908, [[21, 1], [23, 2]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const pierwszy = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  dolozDoKosza(d, pierwszy.poz[0], kto);

  const { n } = d.prepare("SELECT COUNT(*) AS n FROM oferta_komplet WHERE offer_id='of-KPL'")
    .get() as { n: number };
  assert.equal(n, 2, "skład ma zostać zapamiętany przy ofercie");

  /* Drugi zwrot: BEZ dokumentu i z dwiema sztukami — pamięć rozstrzyga,
     a sztuki skalują się liczbą zwracanych kompletów. */
  d.prepare("DELETE FROM zwrot_klienta_pozycja").run();
  d.prepare("DELETE FROM zwrot_klienta").run();
  const drugi = zwrot(d, null, [{ offerId: "of-KPL", twId: null, ilosc: 2 }]);
  const s = skladPozycji(d, drugi.poz[0]);
  assert.equal(s.zrodlo, "paragon");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 2], [23, 4]]);
});

test("pozycja bez składu NIE wchodzi do koszyka po cichu", () => {
  /* Cicha utrata jest tu najgorszym wyjściem: karton pojechałby na halę
     z towarem, którego nie ma na żadnym dokumencie. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 909, [[21, 1], [22, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-INNY", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  assert.equal(dolozDoKosza(d, poz[0], kto), null);
  const { n } = d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja").get() as { n: number };
  assert.equal(n, 0, "nic nie wchodzi, dopóki nie wiadomo CO wchodzi");
});

/* ── Przeliczenie zamkniętego kosza (0.334.0) ────────────────────────────────
   Zgłoszenie właściciela: „dodałem zestaw, a powinienem rozbić go przed
   dodaniem do MM — nie chce się zrobić". Kosze złożone przed 0.328.0 niosą
   zestaw jako JEDEN wiersz, a takiej MM Sfera nie wystawi: na magazynie leżą
   składniki osobno. Wyjmowanie i wkładanie pozycji po kolei byłoby drogą
   ręczną przez kilkanaście kliknięć — i rozdzieliłoby papier od pudła.      */

test("zamknięty kosz z ZESTAWEM przelicza się na kartoteki paragonu", () => {
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 910, [[21, 1], [22, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const koszId = dolozDoKosza(d, poz[0], kto)!;
  /* Tak wygląda kosz sprzed 0.328.0: jeden wiersz „zestaw" zamiast trzech
     kartotek. Odtwarzamy go wprost, bo dzisiejszy kod już go nie zrobi. */
  d.prepare("DELETE FROM kosz_pozycja WHERE kosz_id=?").run(koszId);
  towar(d, 99);
  d.prepare(`INSERT INTO kosz_pozycja(kosz_id,tw_id,symbol,nazwa,ilosc,zwrot_pozycja_id)
    VALUES (?,?,?,?,1,?)`).run(koszId, 99, "SYM-99", "Zestaw", poz[0]);
  zamknijKosz(d, koszId, kto);

  const w = przeliczKosz(d, koszId, kto);
  assert.deepEqual([w.przed, w.po], [1, 3], "jeden zestaw schodzi, trzy kartoteki wchodzą");
  const wiersze = d.prepare("SELECT tw_id, ilosc FROM kosz_pozycja WHERE kosz_id=? ORDER BY tw_id")
    .all(koszId) as Array<{ tw_id: number; ilosc: number }>;
  assert.deepEqual(wiersze.map((x) => [x.tw_id, x.ilosc]), [[21, 1], [22, 1], [23, 1]]);
  /* Kosz ZOSTAJE zamknięty: towar leży w tamtym pudle, przeliczenie zmienia
     tylko papier, który z niego wyjdzie. */
  assert.equal((d.prepare("SELECT status FROM kosz WHERE id=?")
    .get(koszId) as { status: string }).status, "zamkniety");
});

test("przeliczenie ODMAWIA, gdy dokument MM już wyszedł", () => {
  /* Po numerze MM papier jest w Subiekcie i towar zszedł z magazynu głównego.
     Zmiana zawartości w aplikacji rozjechałaby dwa stany, których nikt potem
     nie zestawi. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 911, [[21, 1], [22, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  const koszId = dolozDoKosza(d, poz[0], kto)!;
  zamknijKosz(d, koszId, kto);
  d.prepare("UPDATE kosz SET mm_numer='MM 1333/MAG/2026' WHERE id=?").run(koszId);

  assert.throws(() => przeliczKosz(d, koszId, kto), /dokument MM/);
});

test("przeliczenie UNIEWAŻNIA zadanie MM ułożone dla starej zawartości", () => {
  /* Zadanie czeka w kolejce z wierszami sprzed poprawki. Zostawione wystawiłoby
     dokładnie ten papier, dla którego biuro sięgnęło po przeliczenie. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 912, [[21, 1], [22, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const { id, poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  const koszId = dolozDoKosza(d, poz[0], kto)!;
  d.prepare("UPDATE zwrot_klienta SET korekta_numer='KFS 1/2026' WHERE id=?").run(id);
  const { queueId } = zamknijKosz(d, koszId, kto);
  assert.notEqual(queueId, null, "komplet korekt wypuszcza MM od razu");

  przeliczKosz(d, koszId, kto);
  assert.equal((d.prepare("SELECT mm_queue_id FROM kosz WHERE id=?")
    .get(koszId) as { mm_queue_id: number | null }).mm_queue_id, null);
  assert.equal((d.prepare("SELECT status FROM sfera_queue WHERE id=?")
    .get(queueId!) as { status: string }).status, "cancelled");
  /* Kosz bez zadania i z kompletem korekt wraca pod `wypuscGotoweKoszyki`
     i dostaje ŚWIEŻE zadanie — z tym, co w pudle leży naprawdę. */
  assert.equal(wypuscGotoweKoszyki(d), 1);
  const swieze = (d.prepare("SELECT mm_queue_id FROM kosz WHERE id=?")
    .get(koszId) as { mm_queue_id: number | null }).mm_queue_id;
  assert.notEqual(swieze, null);
  assert.notEqual(swieze, queueId);
});

/* ── Ptaszki przy składnikach kompletu (0.335.0) ─────────────────────────────
   Zgłoszenie właściciela: „powinno rozbijać na komponenty do zaznaczania,
   które idą do MM". Komplet wchodził dotąd w całości albo wcale, a wracają
   z niego nieraz same części.

   Ptaszek rusza WIERSZ KOSZYKA, bo `kosz_pozycja` jest prawdą o tym, co
   pojedzie na dokument. Osobna lista zaznaczeń znaczyłaby dwa źródła dla
   jednego papieru i pytanie, które wygrywa, zadane przy wystawianiu MM.    */

/** Komplet trzech kartotek, już dołożony do koszyka. */
function kompletWKoszyku(d: Db, kto: { id: number; name: string }, dokId: number) {
  const dok = paragon(d, dokId, [[21, 1], [22, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const { id, poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  const koszId = dolozDoKosza(d, poz[0], kto)!;
  return { id, pozycjaId: poz[0], koszId };
}

const wKoszyku = (d: Db, koszId: number) =>
  (d.prepare("SELECT tw_id FROM kosz_pozycja WHERE kosz_id=? ORDER BY tw_id")
    .all(koszId) as Array<{ tw_id: number }>).map((x) => Number(x.tw_id));

test("odznaczony składnik NIE jedzie na MM, a reszta kompletu zostaje", () => {
  const d = stanowisko();
  const kto = biuro(d);
  const { pozycjaId, koszId } = kompletWKoszyku(d, kto, 920);
  assert.deepEqual(wKoszyku(d, koszId), [21, 22, 23]);

  const sklad = zaznaczSkladnik(d, pozycjaId, 22, false, kto);
  assert.deepEqual(wKoszyku(d, koszId), [21, 23], "środkowy schodzi z dokumentu");
  /* Odznaczony NIE ZNIKA z ekranu — inaczej nie dałoby się go przywrócić. */
  assert.deepEqual(sklad.skladniki.map((s) => [s.twId, s.wKoszyku]),
    [[21, true], [22, false], [23, true]]);
});

test("ptaszek wraca i składnik wraca razem z nim", () => {
  /* Cofnięcie zamiast potwierdzenia (§25a.5): odznaczenie idzie jednym
     kliknięciem, więc musi mieć drogę powrotną tej samej długości. */
  const d = stanowisko();
  const kto = biuro(d);
  const { pozycjaId, koszId } = kompletWKoszyku(d, kto, 921);
  zaznaczSkladnik(d, pozycjaId, 22, false, kto);
  zaznaczSkladnik(d, pozycjaId, 22, true, kto);
  assert.deepEqual(wKoszyku(d, koszId), [21, 22, 23]);
  /* Drugie kliknięcie w tę samą stronę nie podwaja wiersza. */
  zaznaczSkladnik(d, pozycjaId, 22, true, kto);
  assert.deepEqual(wKoszyku(d, koszId), [21, 22, 23]);
});

test("OSTATNIEGO składnika nie zdejmiesz ptaszkiem — od tego jest cofnięcie oceny", () => {
  /* Pozycja bez żadnego wiersza w koszyku znaczy „nic z niej nie jedzie na
     MM", a na to jest starsza droga. Dwa sposoby na ten sam skutek kosztują
     pytanie, czym się różnią. */
  const d = stanowisko();
  const kto = biuro(d);
  const { pozycjaId, koszId } = kompletWKoszyku(d, kto, 922);
  zaznaczSkladnik(d, pozycjaId, 21, false, kto);
  zaznaczSkladnik(d, pozycjaId, 22, false, kto);
  assert.throws(() => zaznaczSkladnik(d, pozycjaId, 23, false, kto), /cofnięciem oceny/);
  assert.deepEqual(wKoszyku(d, koszId), [23], "odmowa niczego nie rusza");
});

test("kartoteki SPOZA składu pozycji nie wolno dopisać do MM", () => {
  /* Inaczej literówka w numerze kładłaby na dokument towar, którego nikt nie
     zwrócił — a to wychodzi dopiero przy inwentaryzacji. */
  const d = stanowisko();
  const kto = biuro(d);
  const { pozycjaId, koszId } = kompletWKoszyku(d, kto, 923);
  towar(d, 77);
  assert.throws(() => zaznaczSkladnik(d, pozycjaId, 77, true, kto), /nie ma w składzie/);
  assert.deepEqual(wKoszyku(d, koszId), [21, 22, 23]);
});

test("ptaszek na zamkniętym koszu UNIEWAŻNIA jego zadanie MM", () => {
  /* Zadanie ułożone dla starej zawartości wystawiłoby papier ze składnikiem,
     który właśnie odznaczono. */
  const d = stanowisko();
  const kto = biuro(d);
  const { id, pozycjaId, koszId } = kompletWKoszyku(d, kto, 924);
  d.prepare("UPDATE zwrot_klienta SET korekta_numer='KFS 1/2026' WHERE id=?").run(id);
  const { queueId } = zamknijKosz(d, koszId, kto);
  assert.notEqual(queueId, null);

  zaznaczSkladnik(d, pozycjaId, 22, false, kto);
  assert.equal((d.prepare("SELECT status FROM sfera_queue WHERE id=?")
    .get(queueId!) as { status: string }).status, "cancelled");
  assert.equal(wypuscGotoweKoszyki(d), 1, "kosz wraca po świeże zadanie");
});

test("po wystawieniu MM ptaszek ODMAWIA i nazywa koszyk", () => {
  const d = stanowisko();
  const kto = biuro(d);
  const { pozycjaId, koszId } = kompletWKoszyku(d, kto, 925);
  zamknijKosz(d, koszId, kto);
  d.prepare("UPDATE kosz SET mm_numer='MM 1333/MAG/2026' WHERE id=?").run(koszId);

  assert.throws(() => zaznaczSkladnik(d, pozycjaId, 22, false, kto), /dokument MM/);
  assert.deepEqual(wKoszyku(d, koszId), [21, 22, 23]);
});

test("koszyk starszy niż dzisiejsze reguły też ma swoje ptaszki", () => {
  /* Kosz złożony przed 0.328.0 niesie zestaw JEDNYM wierszem, którego
     rozbicie z paragonu już nie zaproponuje. Pominięcie takiego wiersza
     znaczyłoby towar na dokumencie, o którym ekran milczy. */
  const d = stanowisko();
  const kto = biuro(d);
  const { pozycjaId, koszId } = kompletWKoszyku(d, kto, 926);
  towar(d, 99);
  d.prepare(`INSERT INTO kosz_pozycja(kosz_id,tw_id,symbol,nazwa,ilosc,zwrot_pozycja_id)
    VALUES (?,?,?,?,1,?)`).run(koszId, 99, "SYM-99", "Zestaw", pozycjaId);

  const sklad = skladDoZaznaczenia(d, pozycjaId);
  assert.deepEqual(sklad.skladniki.map((s) => [s.twId, s.wKoszyku]),
    [[21, true], [22, true], [23, true], [99, true]]);
  /* I da się go odznaczyć — inaczej zostałby na papierze na zawsze. */
  zaznaczSkladnik(d, pozycjaId, 99, false, kto);
  assert.deepEqual(wKoszyku(d, koszId), [21, 22, 23]);
});

/* ── Skład wskazany ręką biura (0.336.0) ─────────────────────────────────────
   Zgłoszenie właściciela: „rozwiąż «nie weszła do koszyka» — nie wiem, gdzie
   to wskazać". Automat odsyłał do ręcznej drogi zdaniem „wskaż skład ręcznie",
   a drogi nie było: kolumna `zrodlo='biuro'` stała w schemacie od 0.328.0
   i nie miał jej kto wypełnić.                                              */

test("biuro wskazuje skład i pozycja WCHODZI do koszyka bez powtarzania oceny", () => {
  /* Pozycja ma już ocenę „na stan" — odbiła się wyłącznie od braku rozbicia.
     Kazanie operatorowi cofnąć ocenę i postawić ją drugi raz byłoby pytaniem
     o to, co już powiedział. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 930, [[21, 1], [22, 2]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-A", ilosc: 1 },
    { offerId: "of-B", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  /* Trzy oferty bez kartoteki — automat MILCZY i odsyła do człowieka. */
  assert.match(String(skladPozycji(d, poz[0]).powod), /wskaż skład ręcznie/);
  d.prepare("UPDATE zwrot_klienta_pozycja SET ocena='stan' WHERE id=?").run(poz[0]);

  const w = wskazSklad(d, poz[0], [{ twId: 21, naKomplet: 1 }, { twId: 22, naKomplet: 2 }], kto);
  assert.equal(w.sklad.zrodlo, "biuro", "wynik automatu nie udaje decyzji człowieka");
  assert.deepEqual(w.sklad.skladniki.map((s) => [s.twId, s.ilosc]), [[21, 1], [22, 2]]);
  assert.notEqual(w.koszyk, null, "pozycja wchodzi do koszyka od razu");
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE zwrot_pozycja_id=?")
    .get(poz[0]) as { n: number }).n, 2);
});

test("ilość jest NA KOMPLET, więc dwa zwracane komplety dają dwa razy tyle", () => {
  /* Tak stoi w tabeli i tak myśli człowiek patrzący na zestaw: „w środku są
     dwie sztuki tego". Przeliczenie na zwracane sztuki robi `skladPozycji`. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 931, [[21, 4]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 2 }, { offerId: "of-A", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 2 }]);

  const w = wskazSklad(d, poz[0], [{ twId: 21, naKomplet: 2 }], kto);
  assert.deepEqual(w.sklad.skladniki.map((s) => s.ilosc), [4], "2 sztuki × 2 komplety");
});

test("poprawiony skład ZASTĘPUJE poprzedni, a nie dokłada się do niego", () => {
  /* Bez kasowania nie dałoby się USUNĄĆ składnika wpisanego przez pomyłkę —
     a pomyłka w składzie kładzie na MM towar, którego nikt nie zwrócił. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 932, [[21, 1], [22, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-A", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  wskazSklad(d, poz[0], [{ twId: 21, naKomplet: 1 }, { twId: 99, naKomplet: 1 }].slice(0, 1), kto);
  const w = wskazSklad(d, poz[0], [{ twId: 22, naKomplet: 1 }], kto);
  assert.deepEqual(w.sklad.skladniki.map((s) => s.twId), [22], "stary składnik znika");
});

test("wskazany skład obowiązuje przy NASTĘPNYM zwrocie tej oferty", () => {
  /* Inaczej ten sam zestaw trzeba by składać ręcznie za każdym razem —
     a właśnie temu służy pamięć przy ofercie. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 933, [[21, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-A", ilosc: 1 }]);
  const pierwszy = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  wskazSklad(d, pierwszy.poz[0], [{ twId: 21, naKomplet: 3 }], kto);

  d.prepare("DELETE FROM zwrot_klienta_pozycja").run();
  d.prepare("DELETE FROM zwrot_klienta").run();
  const drugi = zwrot(d, null, [{ offerId: "of-KPL", twId: null, ilosc: 2 }]);
  const s = skladPozycji(d, drugi.poz[0]);
  assert.equal(s.zrodlo, "biuro");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 6]]);
});

test("skład ODMAWIA tego, co wywróciłoby dokument MM", () => {
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 934, [[21, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-A", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  assert.throws(() => wskazSklad(d, poz[0], [], kto), /choć jedną kartotekę/);
  assert.throws(() => wskazSklad(d, poz[0], [{ twId: 21, naKomplet: 0 }], kto), /większa od zera/);
  /* Kartoteka spoza kopii Subiekta: Sfera odrzuciłaby dokument dopiero
     w workerze, czyli po odejściu operatora od biurka. */
  assert.throws(() => wskazSklad(d, poz[0], [{ twId: 4242, naKomplet: 1 }], kto),
    /nie ma w kopii Subiekta/);
  /* Ta sama kartoteka dwa razy: klucz tabeli scaliłby ją po cichu, biorąc
     ostatnią wartość — cisza jest tu gorsza od odmowy. */
  assert.throws(() => wskazSklad(d, poz[0],
    [{ twId: 21, naKomplet: 1 }, { twId: 21, naKomplet: 2 }], kto), /dwa razy/);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM oferta_komplet").get() as { n: number }).n, 0);
});

test("wiersze dokumentu to MATERIAŁ dla człowieka, a bez dokumentu jest pusto", () => {
  /* Paragon, a nie wyszukiwarka kartotek: dowolna kartoteka znaczyłaby drogę,
     którą na MM trafia towar nieobecny na żadnej sprzedaży. */
  const d = stanowisko();
  const dok = paragon(d, 935, [[22, 2], [21, 1]]);
  const { id } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  assert.deepEqual(wierszeDokumentuZwrotu(d, id).map((w) => [w.symbol, w.naDokumencie]),
    [["SYM-21", 1], ["SYM-22", 2]], "po symbolu, bo tak czyta się paragon");

  const bezDok = zwrot(d, null, [{ offerId: "of-X", twId: null, ilosc: 1 }]);
  assert.deepEqual(wierszeDokumentuZwrotu(d, bezDok.id), []);
});
