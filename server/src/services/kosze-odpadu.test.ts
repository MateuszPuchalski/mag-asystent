import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "../db/db.js";

/* ── Koszyk odpadu (0.211.0) ────────────────────────────────────────────────
   Decyzja właściciela: „utylizacja powinna przenosić na magazyn odpad ODP".
   Do 0.210.0 ocena zapisywała się i na tym koniec — bez dokumentu, bez ruchu
   stanu, bez listy. Towar leżał, a w Subiekcie nie było po nim śladu.

   MAGAZYN USTAWIAMY PRZED IMPORTEM. `config` powstaje raz, przy wczytaniu
   modułu, więc test z innym ustawieniem musi mieszkać w OSOBNYM pliku —
   jeden proces to jedna konfiguracja. Plik obok (`kosze-zwrotow.test.ts`)
   biegnie bez `MAG_ID_ODP` i pilnuje zachowania sprzed tego wydania.       */

process.env.MAG_ID_ODP = "9";

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

let kosze: typeof import("./kosze-zwrotow.js");
let zwroty: typeof import("./zwroty.js");
let migrate: typeof import("../db/db.js").migrate;

before(async () => {
  /* WSZYSTKO dynamicznie, także `db.js`. Statyczny import wciągnąłby
     `config.js`, a ten czyta `process.env` przy wczytaniu modułu — czyli
     ZANIM wykona się linia z `MAG_ID_ODP` wyżej. Moduły ESM wczytują się
     przed ciałem pliku i ta kolejność nie podlega negocjacji. */
  ({ migrate } = await import("../db/db.js"));
  kosze = await import("./kosze-zwrotow.js");
  zwroty = await import("./zwroty.js");
});

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

function biuro(d: Db) {
  const id = Number(d.prepare("INSERT INTO app_user(name,role) VALUES ('Ala','biuro')")
    .run().lastInsertRowid);
  return { id, name: "Ala" };
}

/** Zwrot przyjęty, dwie pozycje na kartotekach 11 i 12. */
function zwrot(d: Db, kto: { id: number; name: string }) {
  for (const tw of [11, 12]) {
    d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
      .run(tw, `SYM-${tw}`, `Towar ${tw}`);
  }
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'z1','2026-09-01T08:00:00Z','2026-09-01T08:00:00Z')`).run().lastInsertRowid);
  const poz = [11, 12].map((tw, i) => Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta,tw_id)
    VALUES (?,?,?,?,2,5000,'PLN',?)`)
    .run(id, `k${i}`, `of${i}`, `Część ${i}`, tw).lastInsertRowid));
  zwroty.rozstrzygnijZwrot(d, id, "przyjety", null, 1, kto);
  return { id, poz };
}

test("utylizacja idzie do OSOBNEGO koszyka, a nie do koszyka zwrotów", () => {
  /* Dwa pudła przy jednym biurku. Bez rozdzielenia po rodzaju złom wpadłby
     do pierwszego z brzegu i pojechał na regał zwrotów. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrot(d, KTO);

  const naStan = kosze.dolozDoKosza(d, poz[0], KTO, new Date(), "zwroty")!;
  const naOdpad = kosze.dolozDoKosza(d, poz[1], KTO, new Date(), "odpad")!;
  assert.notEqual(naStan, naOdpad, "to są dwa różne koszyki");

  const otwarte = kosze.otwarteKoszyki(d, KTO);
  assert.deepEqual(otwarte.map((k) => k.rodzaj).sort(), ["odpad", "zwroty"]);
  assert.equal(otwarte.find((k) => k.rodzaj === "odpad")!.pozycji, 1);
});

test("ocena „utylizacja” sama dokłada do koszyka odpadu", () => {
  /* Naciśnięcie, które operator i tak wykonuje, JEST dołożeniem — tak samo
     jak przy „na stan" od 0.192.0. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrot(d, KTO);

  const wynik = zwroty.ocenPozycje(d, poz[0], "utylizacja", 2, KTO);
  assert.notEqual(wynik.koszyk, null, "utylizacja przestała być ślepym zaułkiem");
  const odpad = kosze.stanOtwartegoKosza(d, KTO, "odpad")!;
  assert.equal(odpad.pozycji, 1);
  assert.equal(kosze.stanOtwartegoKosza(d, KTO, "zwroty"), null);
});

test("zmiana oceny PRZENOSI pozycję między pudłami, nie zostawia jej w obu", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrot(d, KTO);

  zwroty.ocenPozycje(d, poz[0], "stan", 2, KTO);
  assert.equal(kosze.stanOtwartegoKosza(d, KTO, "zwroty")!.pozycji, 1);

  zwroty.ocenPozycje(d, poz[0], "utylizacja", 3, KTO);
  /* Pudło zwrotów ZOSTAJE otwarte, tylko puste — operator zaraz dołoży do
     niego następną pozycję. Pusty koszyk nie pokazuje się na pasku (punkt 2
     dekalogu), ale wiersz w bazie jest poprawny. */
  assert.equal(kosze.stanOtwartegoKosza(d, KTO, "zwroty")!.pozycji, 0,
    "z regału zwrotów zeszła");
  assert.equal(kosze.stanOtwartegoKosza(d, KTO, "odpad")!.pozycji, 1);
});

test("MM koszyka odpadu idzie na MAGAZYN ODPADU i czeka na korektę", () => {
  /* Bramka korekty obowiązuje odpad TAK SAMO jak zwroty: towar wraca na
     magazyn główny dopiero po korekcie, więc MM zdjęłoby stan, którego
     jeszcze nie ma. To ta sama lekcja co 0.200.0. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, poz } = zwrot(d, KTO);
  zwroty.ocenPozycje(d, poz[0], "utylizacja", 2, KTO);
  zwroty.ocenPozycje(d, poz[1], "utylizacja", 3, KTO);
  const kosz = kosze.stanOtwartegoKosza(d, KTO, "odpad")!;

  const bezKorekty = kosze.zamknijKosz(d, kosz.id, KTO);
  assert.equal(bezKorekty.queueId, null, "bez korekty MM nie ma prawa wyjść");
  assert.equal(kosze.koszykiCzekajaceNaKorekty(d).find((k) => k.id === kosz.id)?.rodzaj,
    "odpad", "czekający koszyk mówi, na który koniec hali czeka papier");

  d.prepare("UPDATE zwrot_klienta SET korekta_numer='KFS 1/2026' WHERE id=?").run(id);
  assert.equal(kosze.wypuscGotoweKoszyki(d), 1);

  const q = d.prepare("SELECT payload, label, detail FROM sfera_queue WHERE type='mm'")
    .get() as { payload: string; label: string; detail: string };
  const p = JSON.parse(q.payload) as { magFrom: number; magTo: number; items: unknown[] };
  assert.equal(p.magTo, 9, "magazyn docelowy z MAG_ID_ODP, nie regał zwrotów");
  assert.notEqual(p.magFrom, 9);
  assert.equal(p.items.length, 2);
  /* Etykieta mówi magazynierowi, DOKĄD idzie — dokument MM sam z siebie nie. */
  assert.match(q.label, /Koszyk odpadu/);
  assert.match(q.detail, /magazyn odpadu/);
});
