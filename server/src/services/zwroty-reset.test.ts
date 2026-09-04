import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { policzZwroty, wyczyscZwroty } from "./zwroty-reset.js";
import { ocenPozycje, rozstrzygnijZwrot } from "./zwroty.js";
import { zamknijKosz } from "./kosze-zwrotow.js";

/* ── Czyszczenie zwrotów przed ponownym pobraniem (0.199.0) ─────────────────
   Cztery rzeczy, których pomyłka kosztuje najwięcej: kursor musi wrócić do
   zera, zamknięty koszyk musi PRZEŻYĆ, zadanie w kolejce musi przeżyć,
   a oddane pieniądze mają zatrzymać całość.                                */

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
    "INSERT INTO app_user(name,role) VALUES ('Ala','biuro')").run().lastInsertRowid);
  return { id, name: "Ala" };
}

function zwrotZTowarem(d: Db, kto: { id: number; name: string }, klucz = "z1") {
  d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (11,'SYM-11','Towar')").run();
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,created_at,synced_at)
    VALUES (1,?,'2026-09-01T08:00:00Z','2026-09-01T08:00:00Z')`)
    .run(klucz).lastInsertRowid);
  const poz = Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta,tw_id)
    VALUES (?,'k0','of0','Część',2,5000,'PLN',11)`).run(id).lastInsertRowid);
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, kto);
  return { id, poz };
}

test("czyszczenie kasuje zwroty, pozycje i OTWARTE koszyki, a kursor wraca do zera", () => {
  /* Bez cofnięcia kursora Allegro odda już tylko zwroty nowsze niż ostatni
     widziany — czyli nic. Ekran pokazałby pustkę wyglądającą na awarię. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, KTO);
  ocenPozycje(d, poz, "stan", 2, KTO);
  d.prepare(`INSERT INTO allegro_zwroty_sync_state(id,cursor_id,cursor_at)
    VALUES (1,'ostatni','2026-09-01T08:00:00Z')`).run();

  const przed = policzZwroty(d);
  assert.equal(przed.zwrotow, 1);
  assert.equal(przed.koszykiOtwarte, 1);
  assert.equal(przed.pozycjiWKoszykachOtwartych, 1);

  wyczyscZwroty(d, KTO);

  assert.equal(policzZwroty(d).zwrotow, 0);
  assert.equal(policzZwroty(d).pozycji, 0, "pozycje schodzą kaskadą");
  assert.equal(policzZwroty(d).koszykiOtwarte, 0);
  assert.equal(policzZwroty(d).pozycjiWKoszykachOtwartych, 0);
  const kursor = d.prepare("SELECT COUNT(*) AS n FROM allegro_zwroty_sync_state")
    .get() as { n: number };
  assert.equal(Number(kursor.n), 0, "kursor musi zniknąć, inaczej nic nie wróci");
});

test("ZAMKNIĘTY koszyk i jego zadanie mm zostają nietknięte", () => {
  /* Zamknięty koszyk pojechał na halę z wystawionym papierem, a zadanie ma
     własny ładunek. Skasowanie ich rozjechałoby papier z zawartością. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { poz } = zwrotZTowarem(d, KTO);
  const koszId = ocenPozycje(d, poz, "stan", 2, KTO).koszyk!;
  zamknijKosz(d, koszId, KTO);

  const przed = policzZwroty(d);
  assert.equal(przed.koszykiZamkniete, 1);
  assert.equal(przed.zadaniaMmWKolejce, 1);
  assert.equal(przed.koszykiOtwarte, 0, "zamknięty nie jest już otwarty");

  wyczyscZwroty(d, KTO);

  const po = policzZwroty(d);
  assert.equal(po.koszykiZamkniete, 1);
  assert.equal(po.zadaniaMmWKolejce, 1);
  assert.equal(Number((d.prepare(
    "SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id=?").get(koszId) as { n: number }).n), 1,
    "pozycje zamkniętego koszyka to SNAPSHOT — przeżywają skasowanie zwrotu");
});

test("oddane pieniądze ZATRZYMUJĄ czyszczenie, dopóki człowiek nie powie inaczej", () => {
  /* Wiersz ze zwrotem płatności jest jedynym śladem, że pieniądze wyszły do
     klienta. „Wiem, że nie klikałem" i „sprawdziłem" to dwie różne rzeczy. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id } = zwrotZTowarem(d, KTO);
  d.prepare("UPDATE zwrot_klienta SET zwrot_pieniedzy_id='REF-1', reference_number='ZW-9' WHERE id=?")
    .run(id);

  assert.equal(policzZwroty(d).zOddanymiPieniedzmi, 1);
  assert.throws(() => wyczyscZwroty(d, KTO), /ZW-9/);
  assert.equal(policzZwroty(d).zwrotow, 1, "odmowa nie kasuje NICZEGO");

  wyczyscZwroty(d, KTO, { mimoPieniedzy: true });
  assert.equal(policzZwroty(d).zwrotow, 0);
});

test("raport nie zapisuje ani jednego wiersza", () => {
  /* Domyślny tryb narzędzia. „Zero zapisu przy patrzeniu" obowiązuje też
     narzędzia konserwacyjne. */
  const d = stanowisko();
  const KTO = biuro(d);
  zwrotZTowarem(d, KTO);
  const ile = () => Number((d.prepare("SELECT COUNT(*) AS n FROM events")
    .get() as { n: number }).n);

  const przed = ile();
  policzZwroty(d);
  policzZwroty(d);
  assert.equal(ile(), przed, "raport nie dopisuje nawet zdarzenia o sobie");
});
