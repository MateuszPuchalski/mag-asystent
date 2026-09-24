import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  policzRozliczonePozaAplikacja, skasujRozliczonePozaAplikacja,
} from "./zwroty-sprzatanie.js";
import { ocenPozycje, rozstrzygnijZwrot } from "./zwroty.js";

/* ── Kasowanie zwrotów rozliczonych poza aplikacją (0.340.0) ────────────────
   Zgłoszenie właściciela: „wywal zwroty rozliczone poza aplikacją".

   Testy pilnują JEDNEJ rzeczy w dwie strony: znika dokładnie to, po czym nie
   ma u nas żadnego śladu, i nie znika nic innego. Każdy ślad zostawiony bez
   bramki kosztuje inaczej — zapis przelewu bywa jedynym dowodem wypłaty,
   a `kosz_pozycja.zwrot_pozycja_id` nie ma klucza obcego, więc skasowanie
   zwrotu zostawiłoby w pudle wiersz wskazujący na nieistniejącą pozycję.  */

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

/** Zwrot rozliczony po stronie Allegro, bez jednego naszego kliknięcia. */
function rozliczonyPrzezAllegro(d: Db, klucz: string, status = "FINISHED") {
  d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (11,'SYM-11','Towar')").run();
  d.prepare("INSERT OR IGNORE INTO sgt_stan(tw_id,mag_id,stan) VALUES (11,1,0)").run();
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,reference_number,created_at,synced_at,status_allegro)
    VALUES (1,?,?,'2026-09-01T08:00:00Z','2026-09-01T08:00:00Z',?)`)
    .run(klucz, klucz.toUpperCase(), status).lastInsertRowid);
  const poz = Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta,tw_id)
    VALUES (?,'k0','of0','Część',2,5000,'PLN',11)`).run(id).lastInsertRowid);
  return { id, poz };
}

test("znika zwrot rozliczony przez Allegro, po którym nie ma u nas śladu", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  rozliczonyPrzezAllegro(d, "zw-1");
  rozliczonyPrzezAllegro(d, "zw-2", "FINISHED_APT");
  /* Zwrot w drodze zostaje — pieniędzy jeszcze nie ma. */
  rozliczonyPrzezAllegro(d, "zw-3", "DELIVERED");

  const przed = policzRozliczonePozaAplikacja(d);
  assert.equal(przed.doSkasowania, 2, "FINISHED i FINISHED_APT, bez DELIVERED");
  assert.equal(przed.pozycji, 2);
  assert.deepEqual(przed.numery, ["ZW-1", "ZW-2"]);

  skasujRozliczonePozaAplikacja(d, KTO);
  const zostalo = (d.prepare("SELECT external_id FROM zwrot_klienta ORDER BY id")
    .all() as Array<{ external_id: string }>).map((z) => z.external_id);
  assert.deepEqual(zostalo, ["zw-3"]);
  /* Pozycje schodzą kaskadą — bez nich zostałyby sieroty bez zwrotu. */
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM zwrot_klienta_pozycja")
    .get() as { n: number }).n, 1);
});

test("paczki nieodebranej nie kasuje, choć pieniądze oddano w Allegro (0.493.0)", () => {
  /* Biuro zakłada ją samo, więc skasowana nie wróci z synchronizacji. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id } = rozliczonyPrzezAllegro(d, "nieodebrana:620000111222", "");
  d.prepare(`UPDATE zwrot_klienta SET zrodlo='nieodebrana', status_allegro=NULL,
    rozliczony_allegro_at='2026-09-20T10:00:00Z' WHERE id=?`).run(id);
  assert.equal(policzRozliczonePozaAplikacja(d).doSkasowania, 0);
  skasujRozliczonePozaAplikacja(d, KTO);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM zwrot_klienta").get() as { n: number }).n, 1);
});

test("NASZ ślad zatrzymuje kasowanie, a raport mówi KTÓRY", () => {
  /* Zwrot bywa zatrzymany przez dwie rzeczy naraz, a człowiek ma wiedzieć,
     która go trzyma — inaczej zdejmie jedną i zdziwi się, że wiersz stoi. */
  const d = stanowisko();
  rozliczonyPrzezAllegro(d, "zw-platnosc");
  rozliczonyPrzezAllegro(d, "zw-przelew");
  rozliczonyPrzezAllegro(d, "zw-korekta");
  d.prepare("UPDATE zwrot_klienta SET zwrot_pieniedzy_id='ref-1' WHERE external_id='zw-platnosc'").run();
  d.prepare("UPDATE zwrot_klienta SET przelew_at='2026-09-02T10:00:00Z' WHERE external_id='zw-przelew'").run();
  d.prepare("UPDATE zwrot_klienta SET korekta_numer='KFS 1/2026' WHERE external_id='zw-korekta'").run();

  const p = policzRozliczonePozaAplikacja(d);
  assert.equal(p.doSkasowania, 0, "każdy z trzech ma własny ślad");
  assert.equal(p.zostaja.zNaszymZwrotemPlatnosci, 1);
  assert.equal(p.zostaja.zNotatkaOPrzelewie, 1);
  assert.equal(p.zostaja.zKorekta, 1);
});

test("pozycja w KOSZYKU zatrzymuje kasowanie — wiersz pudła nie ma klucza obcego", () => {
  /* `kosz_pozycja.zwrot_pozycja_id` dodano `addColumn`, bez `REFERENCES`.
     Skasowanie zwrotu nie wywróciłoby więc zapisu, tylko zostawiło w pudle
     wiersz wskazujący na nieistniejącą pozycję. Po cichu. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, poz } = rozliczonyPrzezAllegro(d, "zw-kosz");
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, KTO);
  ocenPozycje(d, poz, "stan", 2, KTO);

  const p = policzRozliczonePozaAplikacja(d);
  assert.equal(p.doSkasowania, 0);
  assert.equal(p.zostaja.wKoszyku, 1);

  skasujRozliczonePozaAplikacja(d, KTO);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM zwrot_klienta").get() as { n: number }).n, 1,
    "zwrot z towarem w pudle zostaje");
});

test("kasowanie NIE rusza kursora synchronizacji", () => {
  /* Różnica wobec `zwroty-reset`: tam celem było pobranie wszystkiego od
     nowa, tutaj — pozbycie się wierszy na dobre. Cofnięty kursor przywróciłby
     je przy najbliższym takcie, czyli skasowanie nie znaczyłoby nic. */
  const d = stanowisko();
  const KTO = biuro(d);
  rozliczonyPrzezAllegro(d, "zw-1");
  d.prepare(`INSERT INTO allegro_zwroty_sync_state(id,cursor_id,cursor_at)
    VALUES (1,'ostatni','2026-09-01T08:00:00Z')`).run();

  skasujRozliczonePozaAplikacja(d, KTO);
  assert.equal((d.prepare("SELECT cursor_id FROM allegro_zwroty_sync_state WHERE id=1")
    .get() as { cursor_id: string } | undefined)?.cursor_id, "ostatni");
});

test("kasowanie zostawia ŚLAD w dzienniku, bo historii się nie przepisuje", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  rozliczonyPrzezAllegro(d, "zw-1");
  skasujRozliczonePozaAplikacja(d, KTO);
  const w = d.prepare("SELECT type, payload FROM events WHERE type='zwroty_rozliczone_skasowane'")
    .get() as { type: string; payload: string } | undefined;
  assert.ok(w, "wpis w dzienniku");
  assert.equal(JSON.parse(String(w!.payload)).zwrotow, 1);
});

test("pusta baza nie zapisuje niczego — raport ma zostać raportem", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  assert.equal(skasujRozliczonePozaAplikacja(d, KTO).doSkasowania, 0);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n, 0,
    "nic nie skasowano, więc nie ma czego wpisywać do dziennika");
});
