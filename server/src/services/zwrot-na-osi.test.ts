import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { faktZwrotu, zdarzeniaZwrotowRozmowy } from "./zwrot-na-osi.js";

/* ── Zwrot na osi rozmowy (@wydanie) ────────────────────────────────────────
   Pilnujemy trzech granic: na oś wchodzi tylko to, co dotyczy klienta;
   wiązanie idzie po numerze zamówienia (także wskazanym ręcznie) i po koncie;
   fakt dla szkicu nie niesie nazwisk biura.                                 */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const konto = (n: string) => Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro',?)").run(n).lastInsertRowid);
  const nasze = konto("seller-a");
  const obce = konto("seller-b");
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','Zwrot')`).run(nasze).lastInsertRowid);
  const zwrot = (k: number, zam: string, ref: string) => Number(d.prepare(`INSERT INTO zwrot_klienta(
      channel_account_id,external_id,reference_number,order_id,created_at,synced_at)
    VALUES (?,?,?,?,'2026-09-20T08:00:00Z','2026-09-20')`).run(k, `z-${ref}`, ref, zam).lastInsertRowid);
  const zdarzenie = (z: number, rodzaj: string, tresc: string, kiedy: string) => d.prepare(`INSERT INTO
      zwrot_zdarzenie(zwrot_id,rodzaj,tresc,kiedy_at,kto) VALUES (?,?,?,?,'A. Lewandowska')`)
    .run(z, rodzaj, tresc, kiedy);
  return { d, nasze, obce, rozmowa, zwrot, zdarzenie };
}

test("na oś wchodzą decyzja i pieniądze zwrotu, a nie ocena ani notatka biura", () => {
  const { d, nasze, rozmowa, zwrot, zdarzenie } = stanowisko();
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_order_id,sent_at) VALUES (?,?,'m1','incoming','gdzie pieniądze','ord-1','2026-09-21T08:00:00Z')`)
    .run(rozmowa, nasze);
  const z = zwrot(nasze, "ord-1", "Z-7");
  zdarzenie(z, "ocena", "towar bez śladów użycia", "2026-09-22T08:00:00Z");
  zdarzenie(z, "werdykt", "przyjęto zwrot", "2026-09-22T09:00:00Z");
  zdarzenie(z, "notatka", "klient marudny", "2026-09-22T10:00:00Z");
  zdarzenie(z, "pieniadze", "oddano 129,00 zł", "2026-09-23T09:00:00Z");
  const os = zdarzeniaZwrotowRozmowy(d, rozmowa);
  assert.deepEqual(os.map((e) => e.rodzaj), ["werdykt", "pieniadze"]);
  const fakt = faktZwrotu(os)!;
  assert.match(fakt, /Zwrot tego zamówienia \(Z-7\).*2026-09-23 oddano 129,00 zł/);
  assert.doesNotMatch(fakt, /Lewandowska|marudny/);
});

test("zwrot zamówienia wskazanego ręcznie też wchodzi; zwrot z cudzego konta — nie", () => {
  const { d, nasze, obce, rozmowa, zwrot, zdarzenie } = stanowisko();
  d.prepare(`INSERT INTO conversation_event(conversation_id,event_type,payload)
    VALUES (?,'order_linked_manually',json_object('externalId','ord-9'))`).run(rozmowa);
  zdarzenie(zwrot(nasze, "ord-9", "Z-9"), "korekta", "korekta KFS 12/2026", "2026-09-22T08:00:00Z");
  zdarzenie(zwrot(obce, "ord-9", "Z-OBCY"), "pieniadze", "cudze pieniądze", "2026-09-22T09:00:00Z");
  assert.deepEqual(zdarzeniaZwrotowRozmowy(d, rozmowa).map((e) => e.numer), ["Z-9"]);
});

test("rozmowa bez zamówienia nie ma zwrotu na osi, a fakt milczy", () => {
  const { d, rozmowa } = stanowisko();
  assert.deepEqual(zdarzeniaZwrotowRozmowy(d, rozmowa), []);
  assert.equal(faktZwrotu([]), null);
});
