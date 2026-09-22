import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Etykiety z 0.191.0 przechodzą do decyzji jako HISTORIA ──────────────────
   Baza sprzed tego wydania ma `klasyfikacja_rozmowy`. Migracja ma przenieść
   jej wiersze jako NIEAKTYWNE wersje 1 i skasować tabelę — dwa razy
   uruchomiona nie może niczego podwoić (API i worker wołają ją razem).     */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function bazaSprzed() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`CREATE TABLE klasyfikacja_rozmowy (
    conversation_id INTEGER PRIMARY KEY, kategoria TEXT NOT NULL, pewnosc TEXT NOT NULL,
    uzasadnienie TEXT, message_id INTEGER, model TEXT NOT NULL, at TEXT NOT NULL,
    przez TEXT NOT NULL, przez_user_id INTEGER, ocena TEXT, ocenil_user_id INTEGER, ocena_at TEXT)`);
  d.prepare("INSERT INTO channel_account(id,channel,external_account_id) VALUES (1,'allegro','k')").run();
  for (const [r, ocena] of [[1, "trafna"], [2, "nietrafna"], [3, null]] as const) {
    d.prepare(`INSERT INTO conversation(id,channel_account_id,external_conversation_id)
      VALUES (?,1,?)`).run(r, `w-${r}`);
    d.prepare(`INSERT INTO message(id,conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
      VALUES (?,?,1,?,'incoming','pytanie','2026-09-10T10:00:00Z')`).run(r * 10, r, `m-${r}`);
    d.prepare(`INSERT INTO klasyfikacja_rozmowy
      (conversation_id,kategoria,pewnosc,message_id,model,at,przez,ocena)
      VALUES (?,'dobor','wysoka',?,'claude-opus-5','2026-09-10T11:00:00Z','Ala',?)`).run(r, r * 10, ocena);
  }
  return d;
}

test("stare etykiety wchodzą jako nieaktywna historia v1, a tabela znika", () => {
  const d = bazaSprzed();
  migrate(d);
  migrate(d);

  assert.equal(d.prepare("SELECT 1 FROM sqlite_master WHERE name='klasyfikacja_rozmowy'").get(), undefined);
  const w = d.prepare("SELECT * FROM decyzja_klasyfikacji ORDER BY conversation_id").all() as any[];
  assert.equal(w.length, 3, "drugie uruchomienie niczego nie podwaja");
  for (const x of w) {
    assert.equal(x.aktywna, 0, "etykieta z ośmiu kategorii nie może udawać decyzji z piętnastu");
    assert.equal(x.taksonomia_wersja, "v1");
    assert.equal(x.wersja, 1);
  }
  assert.equal(w[0].kategoria_czlowieka, "dobor", "„trafna” to potwierdzenie etykiety modelu");
  assert.equal(w[1].kategoria_czlowieka, null, "„nietrafna” nie mówiła, jak powinno być");
  assert.ok(JSON.parse(w[1].kody_polityki).includes("V1_NIETRAFNA"));
});
