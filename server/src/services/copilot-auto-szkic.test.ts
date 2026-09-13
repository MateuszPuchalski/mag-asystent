import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-auto-szkic-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Szkic sam dla nowego pytania pod ofertą (0.317.0) ───────────────────────
   Ta funkcja WYDAJE PIENIĄDZE BEZ KLIKNIĘCIA i cała jej ostrożność siedzi
   w dwóch hamulcach oraz w doborze rozmów. Testy pilnują dokładnie tego:
   kogo takt bierze, kogo pomija, ile naraz i kiedy staje.

   Nadawca jest ATRAPĄ — test nie ma prawa strzelać do dostawcy ani płacić. */

let db: typeof import("../db/db.js").db;
let A: typeof import("./copilot-auto-szkic.js");
let subiekt: typeof import("../context.js").subiekt;

let konto = 0;
let wywolan = 0;

const nadaj: import("./copilot-szkic.js").NadawcaSzkicu = async () => {
  wywolan++;
  return {
    tresc: "Dzień dobry, ten gaźnik pasuje (F1).", uzyteFakty: ["F1"], zastrzezenia: [],
    daneDoboru: null, pasowanie: null, twierdzenia: [], model: "atrapa", ms: 5,
    zuzycie: { wej: 10, wyj: 5, cacheZapis: 0, cacheOdczyt: 0 },
  };
};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ subiekt } = await import("../context.js"));
  A = await import("./copilot-auto-szkic.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["szkic_copilota", "copilot_wywolanie", "conversation_event", "message",
    "conversation", "channel_account", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  wywolan = 0;
});

/** Rozmowa z jedną wiadomością; `oferta=null` znaczy „pytanie bez oferty". */
function rozmowa(zewn: string, opcje: {
  oferta?: string | null; kierunek?: "incoming" | "outgoing"; auto?: 0 | 1; kiedy?: string;
} = {}): number {
  const d = db();
  const id = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id)
    VALUES (?,?)`).run(konto, zewn).lastInsertRowid);
  dopisz(id, zewn, opcje);
  return id;
}

function dopisz(id: number, zewn: string, opcje: {
  oferta?: string | null; kierunek?: "incoming" | "outgoing"; auto?: 0 | 1; kiedy?: string;
} = {}): number {
  const oferta = opcje.oferta === undefined ? "of-1" : opcje.oferta;
  return Number(db().prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at,
     auto_odpowiedz,related_object_type,related_object_id)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, konto, `m-${zewn}-${Math.random()}`, opcje.kierunek ?? "incoming",
    "Czy ten gaźnik pasuje?", opcje.kiedy ?? new Date().toISOString(),
    opcje.auto ?? 0, oferta === null ? null : "OFFER", oferta).lastInsertRowid);
}

const biegnij = (n: Partial<import("./copilot-auto-szkic.js").AutoSzkicDeps> = {}) =>
  A.ulozZalegleSzkice({ database: db(), nadaj, subiekt, naPrzebieg: 5, naGodzine: 30, ...n });

test("pytanie pod ofertą dostaje szkic, a podpisuje go AUTOMAT, nie człowiek", async () => {
  /* `przez_user_id` puste to decyzja o źródle wyrażona w danych. Podpisanie
     automatycznego szkicu kontem zalogowanego agenta zafałszowałoby jedyny
     pomiar, jaki mamy — jego ocenę przez człowieka. */
  const r = rozmowa("w-1");
  const w = await biegnij();

  assert.equal(w.ulozonych, 1);
  assert.equal(wywolan, 1);
  const s = db().prepare("SELECT przez, przez_user_id FROM szkic_copilota WHERE conversation_id=?")
    .get(r) as { przez: string; przez_user_id: number | null };
  assert.equal(s.przez, "automat");
  assert.equal(s.przez_user_id, null);
});

test("pytanie BEZ oferty nie dostaje nic — to rozstrzygnięcie właściciela o zakresie", async () => {
  /* Przy „dziękuję", zmianie adresu i reklamacji szkic z faktów doboru
     niewiele wnosi, a kosztuje tyle samo. */
  rozmowa("w-1", { oferta: null });
  const w = await biegnij();
  assert.equal(w.ulozonych, 0);
  assert.equal(wywolan, 0, "ani jednego wywołania, czyli ani złotówki");
});

test("nasza własna wiadomość i autoodpowiedź nie są pytaniem klienta", async () => {
  /* Autoodpowiedź liczona jako wiadomość klienta kazałaby układać szkic na
     własne potwierdzenie (blizna 0.227.0). */
  rozmowa("w-1", { kierunek: "outgoing" });
  const r2 = rozmowa("w-2");
  dopisz(r2, "w-2", { auto: 1, kiedy: new Date(Date.now() + 1000).toISOString() });
  const w = await biegnij();
  assert.equal(w.ulozonych, 1, "ma wejść tylko rozmowa, w której ostatnie słowo ma klient");
  assert.equal(wywolan, 1);
});

test("szkic odpowiadający na NAJNOWSZE pytanie nie jest układany drugi raz", async () => {
  /* Świeżość mierzy `message_id` — to samo pole, którym ekran mówi „klient
     dopisał, propozycja jest nieświeża". Drugi przebieg bez nowej wiadomości
     nie ma prawa zapłacić po raz drugi. */
  rozmowa("w-1");
  assert.equal((await biegnij()).ulozonych, 1);
  const drugi = await biegnij();
  assert.equal(drugi.ulozonych, 0);
  assert.equal(wywolan, 1, "drugi przebieg nie zapłacił");
});

test("DOPISEK klienta czyni szkic nieświeżym i wtedy powstaje nowy", async () => {
  const r = rozmowa("w-1");
  await biegnij();
  dopisz(r, "w-1", { kiedy: new Date(Date.now() + 60_000).toISOString() });

  const w = await biegnij();
  assert.equal(w.ulozonych, 1, "nowe pytanie klienta zasługuje na nową propozycję");
  assert.equal(wywolan, 2);
});

test("najstarsze pierwsze, bo agent pracuje kolejkę od najdłużej czekającego", async () => {
  /* Gdyby takt układał od najnowszych, agent idący od góry kolejki
     znajdowałby same rozmowy bez propozycji. */
  const stara = rozmowa("w-stara", { kiedy: new Date(Date.now() - 3 * 3600_000).toISOString() });
  rozmowa("w-nowa", { kiedy: new Date().toISOString() });

  await biegnij({ naPrzebieg: 1 });
  assert.equal(Number((db().prepare(
    "SELECT count(*) n FROM szkic_copilota WHERE conversation_id=?").get(stara) as { n: number }).n), 1);
  assert.equal(Number((db().prepare("SELECT count(*) n FROM szkic_copilota").get() as { n: number }).n), 1);
});

test("hamulec na przebieg: reszta czeka do następnego razu", async () => {
  for (let i = 0; i < 5; i++) rozmowa(`w-${i}`);
  const w = await biegnij({ naPrzebieg: 2 });
  assert.equal(w.ulozonych, 2);
  assert.equal(wywolan, 2);
});

test("sufit godzinowy liczy się z KSIĘGI, razem z wywołaniami nieudanymi", async () => {
  /* Nieudane wywołanie też kosztuje, a licznik w pamięci zerowałby się przy
     restarcie usługi — rachunek u dostawcy nie. */
  const d = db();
  for (let i = 0; i < 3; i++) {
    d.prepare(`INSERT INTO copilot_wywolanie(zadanie,model,wynik,blad) VALUES ('szkic','m','blad','x')`).run();
  }
  rozmowa("w-1");
  const w = await biegnij({ naGodzine: 3 });

  assert.equal(w.ulozonych, 0);
  assert.equal(w.przerwane, "sufit godzinowy wyczerpany");
  assert.equal(wywolan, 0);
  /* Cisza przy wyczerpanym suficie byłaby gorsza od wpisu: takt stoi,
     a rachunek rośnie. */
  assert.equal(Number((d.prepare(
    "SELECT count(*) n FROM events WHERE type='copilot_auto_szkic_sufit'").get() as { n: number }).n), 1);
});

test("stare wywołania spod sufitu wypadają — okno jest godzinne, nie wieczne", async () => {
  const d = db();
  d.prepare(`INSERT INTO copilot_wywolanie(zadanie,model,wynik,at)
    VALUES ('szkic','m','ok',strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'))`).run();
  rozmowa("w-1");
  assert.equal((await biegnij({ naGodzine: 1 })).ulozonych, 1);
});

test("odmowa przy JEDNEJ rozmowie nie zabiera pozostałych", async () => {
  /* Szkic odrzucony przez sprawdzenie dotyczy jednej rozmowy. Zabranie
     reszty przebiegu kosztowałoby propozycje, które powstałyby bez problemu. */
  rozmowa("w-1");
  rozmowa("w-2", { kiedy: new Date(Date.now() + 1000).toISOString() });
  let pierwsze = true;
  const kapryśny: import("./copilot-szkic.js").NadawcaSzkicu = async (watek, fakty) => {
    if (pierwsze) { pierwsze = false; throw new Error("model wyszedł poza fakty"); }
    return nadaj(watek, fakty);
  };
  const w = await biegnij({ nadaj: kapryśny });
  assert.equal(w.bledow, 1);
  assert.equal(w.ulozonych, 1);
  assert.equal(w.przerwane, null);
});

test("LIMIT dostawcy przerywa przebieg — dalsze wywołania pogłębiają przerwę", async () => {
  const { BladLimituCopilota } = await import("../adapters/copilot.js");
  rozmowa("w-1");
  rozmowa("w-2", { kiedy: new Date(Date.now() + 1000).toISOString() });
  const w = await biegnij({
    nadaj: async () => { wywolan++; throw new BladLimituCopilota("limit dostawcy", null); },
  });
  assert.equal(w.ulozonych, 0);
  assert.match(String(w.przerwane), /limit/);
  assert.equal(wywolan, 1, "po limicie nie wołamy drugi raz");
});
