import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  dolozDoKosza, otwartyKosz, stanOtwartegoKosza, zamknijKosz, zdejmijZKosza,
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
function zwrotZTowarem(d: Db, twIdy: Array<number | null>, kto: { id: number; name: string }) {
  for (const tw of twIdy) {
    if (tw === null) continue;
    d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
      .run(tw, `SYM-${tw}`, `Towar ${tw}`);
  }
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'z1','2026-09-01T08:00:00Z','2026-09-01T08:00:00Z')`).run().lastInsertRowid);
  const poz = twIdy.map((tw, i) => Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta,tw_id)
    VALUES (?,?,?,?,?,?, 'PLN', ?)`)
    .run(id, `k${i}`, `of${i}`, `Część ${i}`, 2, 5000, tw).lastInsertRowid));
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, kto);
  return { id, poz };
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
  assert.equal(ocenPozycje(d, poz[2], "przecena", 4, KTO).koszyk, null,
    "przecena zostaje poza tą ścieżką — decyzja właściciela");

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
  const { poz } = zwrotZTowarem(d, [11, 11, 12], KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  ocenPozycje(d, poz[1], "stan", 3, KTO);
  ocenPozycje(d, poz[2], "stan", 4, KTO);

  const kosz = stanOtwartegoKosza(d, KTO)!;
  const wynik = zamknijKosz(d, kosz.id, KTO);
  assert.equal(wynik.pozycji, 3);

  const z = d.prepare("SELECT type, payload, status FROM sfera_queue WHERE id=?")
    .get(wynik.queueId) as { type: string; payload: string; status: string };
  assert.equal(z.type, "mm");
  assert.equal(z.status, "pending");
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

  /* Zmiana oceny po domknięciu zostawia kosz w spokoju: towar fizycznie
     w nim leży, a dokument już powstał. */
  ocenPozycje(d, poz[0], "utylizacja", 3, KTO);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id=?")
    .get(kosz.id) as { n: number }).n, 1);
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
