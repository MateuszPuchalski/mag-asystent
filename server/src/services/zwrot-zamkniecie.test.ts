import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { ZwrotConflict, listaZwrotow } from "./zwroty.js";
import { otworzZwrotPoRecznymZamknieciu, zamknijZwrotRecznie } from "./zwrot-zamkniecie.js";

/* Ręczne zamknięcie to decyzja człowieka, więc testy pilnują czterech rzeczy:
   że zwrot naprawdę schodzi z kolejki (także gdy pieniądze jeszcze nie wyszły),
   że nie da się zamknąć tego, co zamknąć nie wolno, że wersja chroni przed
   cudzą zmianą i że cofnięcie przywraca stan sprzed zamknięcia. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
let biuro = { id: 0, name: "Ewa" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  /* Klucz obcy trzyma `zamkniecie_reczne_user_id`, więc użytkownik musi istnieć. */
  biuro = { id: Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ewa','Ewa','biuro')").run().lastInsertRowid), name: "Ewa" };
  return d as unknown as Db;
}

function zwrot(d: Db, ext = "ret1", extra: Record<string, unknown> = {}) {
  const kol = { werdykt: null, zamkniety_at: null, rejection_code: null, zrodlo: "allegro", ...extra };
  return Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id, external_id, order_id, created_at, synced_at, werdykt, zamkniety_at,
     rejection_code, zrodlo)
    VALUES (1,?,?,?,?,?,?,?,?)`)
    .run(ext, `ord-${ext}`, "2026-09-01T08:00:00Z", "2026-09-22T08:00:00Z",
      kol.werdykt, kol.zamkniety_at, kol.rejection_code, kol.zrodlo).lastInsertRowid);
}

const wersja = (d: Db, id: number) =>
  Number((d.prepare("SELECT wersja FROM zwrot_klienta WHERE id=?").get(id) as { wersja: number }).wersja);

test("zamknięcie ręczne zapisuje kto, kiedy i dlaczego, i podnosi wersję", () => {
  const d = stanowisko();
  const id = zwrot(d);
  const w0 = wersja(d, id);
  const wynik = zamknijZwrotRecznie(d, id, w0, "  oddane przelewem z konta  ", biuro,
    new Date("2026-10-14T10:00:00Z"));
  assert.equal(wynik.zamknietyAt, "2026-10-14T10:00:00.000Z");
  assert.equal(wynik.wersja, w0 + 1);
  const w = d.prepare(`SELECT zamkniety_at, zamkniecie_reczne_przez AS przez,
      zamkniecie_reczne_powod AS powod, korekta_numer FROM zwrot_klienta WHERE id=?`).get(id) as
    Record<string, string | null>;
  assert.equal(w.zamkniety_at, "2026-10-14T10:00:00.000Z");
  assert.equal(w.przez, "Ewa");
  assert.equal(w.powod, "oddane przelewem z konta");
  assert.equal(w.korekta_numer, null, "bez korekty — to jest sens tego zamknięcia");
  const os = d.prepare("SELECT rodzaj FROM zwrot_zdarzenie WHERE zwrot_id=?").all(id) as Array<{ rodzaj: string }>;
  assert.deepEqual(os.map((o) => o.rodzaj), ["zamkniecie_reczne"]);
  const ev = d.prepare("SELECT COUNT(*) AS n FROM events WHERE type='zwrot_zamkniecie_reczne'").get() as { n: number };
  assert.equal(ev.n, 1);
});

test("ręcznie zamknięty zwrot zostaje w zamkniętych, choć pieniądze nie wyszły", () => {
  const d = stanowisko();
  /* Paczka nieodebrana z kwotą i werdyktem czeka na pieniądze bez terminu —
     po samej korekcie wracałaby do DO ZWROTU. */
  const id = zwrot(d, "nieodebrana:1", { zrodlo: "nieodebrana", werdykt: "przyjety" });
  d.prepare("UPDATE zwrot_klienta SET kwota_grosze=5000, zamkniety_at='2026-10-01T00:00:00Z' WHERE id=?").run(id);
  const przed = listaZwrotow(d).find((z) => z.id === id)!;
  assert.equal(przed.kubelek, "zwrot", "zamknięty korektą, a niezapłacony, wraca do DO ZWROTU");

  d.prepare("UPDATE zwrot_klienta SET zamkniety_at=NULL WHERE id=?").run(id);
  zamknijZwrotRecznie(d, id, wersja(d, id), null, biuro);
  const po = listaZwrotow(d).find((z) => z.id === id)!;
  assert.equal(po.kubelek, "zamkniety");
  assert.equal(po.pieniadzeCzekaja, false);
  assert.equal(po.zamknietyRecznie?.przez, "Ewa");
});

test("nie zamyka zwrotu zamkniętego, odrzuconego ani ze starą wersją", () => {
  const d = stanowisko();
  const zamkniety = zwrot(d, "a", { zamkniety_at: "2026-10-01T00:00:00Z" });
  const odrzucony = zwrot(d, "b", { werdykt: "odrzucony" });
  const zAllegro = zwrot(d, "c", { rejection_code: "REFUND_REJECTED" });
  const swiezy = zwrot(d, "d");
  assert.throws(() => zamknijZwrotRecznie(d, zamkniety, wersja(d, zamkniety), null, biuro), /już zamknięty/);
  assert.throws(() => zamknijZwrotRecznie(d, odrzucony, wersja(d, odrzucony), null, biuro), /odrzucony/);
  assert.throws(() => zamknijZwrotRecznie(d, zAllegro, wersja(d, zAllegro), null, biuro), /odrzucony/);
  assert.throws(() => zamknijZwrotRecznie(d, swiezy, wersja(d, swiezy) + 5, null, biuro), ZwrotConflict);
  assert.throws(() => zamknijZwrotRecznie(d, swiezy, wersja(d, swiezy), "x".repeat(251), biuro), /najwyżej 250/);
});

test("nie zamyka zwrotu, którego towar leży w koszyku czekającym na korektę", () => {
  const d = stanowisko();
  const id = zwrot(d);
  const p = Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id, klucz, nazwa, ilosc, cena_grosze, waluta) VALUES (?,?,?,?,?,?)`).run(id, "k1", "Sekator", 1, 1000, "PLN").lastInsertRowid);
  const kosz = Number(d.prepare(`INSERT INTO kosz(kod, status, utworzono_at, utworzono_przez)
    VALUES ('1','otwarty','2026-10-01T00:00:00Z','Ewa')`).run().lastInsertRowid);
  d.prepare(`INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, zwrot_pozycja_id)
    VALUES (?,?,?,?,?,?)`).run(kosz, 1, "S1", "Sekator", 1, p);
  assert.throws(() => zamknijZwrotRecznie(d, id, wersja(d, id), null, biuro), /koszyku/);

  d.prepare("UPDATE kosz SET status='rozlozony' WHERE id=?").run(kosz);
  zamknijZwrotRecznie(d, id, wersja(d, id), null, biuro);
});

test("cofnięcie otwiera zwrot ponownie, a zamknięcie korektą cofa się osobno", () => {
  const d = stanowisko();
  const id = zwrot(d);
  zamknijZwrotRecznie(d, id, wersja(d, id), "historia", biuro);
  otworzZwrotPoRecznymZamknieciu(d, id, wersja(d, id), biuro);
  const w = d.prepare(`SELECT zamkniety_at, zamkniecie_reczne_at, zamkniecie_reczne_powod
    FROM zwrot_klienta WHERE id=?`).get(id) as Record<string, string | null>;
  assert.deepEqual({ ...w }, { zamkniety_at: null, zamkniecie_reczne_at: null, zamkniecie_reczne_powod: null });
  const os = d.prepare("SELECT rodzaj FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY id").all(id) as Array<{ rodzaj: string }>;
  assert.deepEqual(os.map((o) => o.rodzaj), ["zamkniecie_reczne", "zamkniecie_reczne_cofniete"]);

  const korekta = zwrot(d, "k", { zamkniety_at: "2026-10-01T00:00:00Z" });
  assert.throws(() => otworzZwrotPoRecznymZamknieciu(d, korekta, wersja(d, korekta), biuro),
    /nie został zamknięty ręcznie/);
});
