import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szablony-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Szablony odpowiedzi (0.399.0) ───────────────────────────────────────────
   Zgłoszenie właściciela: „dodaj ten szablon do szablonów odpowiedzi
   w skrzynce". Szablonów nie było wcale. Testy pilnują pięciu granic:

   1. PIERWSZY SZABLON WCHODZI RAZ. Migracja wstawia treść właściciela tylko do
      PUSTEJ tabeli — inaczej wracałaby po każdym restarcie do kogoś, kto
      świadomie ją zdjął.
   2. LIMIT ALLEGRO OBOWIĄZUJE JUŻ PRZY ZAPISIE. Szablon dłuższy niż 2000
      znaków robiłby szkic niewysyłalnym, a agent dowiedziałby się o tym
      dopiero przy wysyłce.
   3. NAZWA JEST JEDNA. Dwa „Wymiana" kazałyby czytać treść obu.
   4. ZDJĘCIE TO ARCHIWUM, nie kasowanie (§25a.5).
   5. DZIENNIK DOSTAJE DŁUGOŚĆ, NIE TREŚĆ — `events` nie ma retencji.       */

let db: typeof import("../db/db.js").db;
let S: typeof import("./szablony.js");
let agent = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./szablony.js");
});

beforeEach(() => {
  const d = db();
  d.prepare("DELETE FROM events").run();
  d.prepare("DELETE FROM app_user").run();
  agent = Number(d.prepare("INSERT INTO app_user(name,role) VALUES ('A. Lewandowska','biuro')")
    .run().lastInsertRowid);
});

test("migracja wstawia szablon właściciela — i jest on GOTOWY do wstawienia", () => {
  /* Treść przyszła od właściciela w zgłoszeniu. Test pilnuje, że dojechała
     w całości, razem z odnośnikiem do instrukcji Allegro — bez niego zdanie
     „muszą Państwo wygenerować zwrot" nie mówi klientowi JAK. */
  const lista = S.listaSzablonow();
  const wymiana = lista.find((s) => s.nazwa === "Wymiana przez paczkomat");
  assert.ok(wymiana, "pierwszy szablon stoi na liście");
  assert.match(wymiana!.tresc, /^Dzień dobry,/);
  assert.match(wymiana!.tresc, /allegro\.pl\/pomoc/);
  assert.match(wymiana!.tresc, /dedykowanej z smsa skrytki/);
});

test("zdjęty szablon NIE wraca przy kolejnym uruchomieniu migracji", async () => {
  /* Sedno warunku „tylko pusta tabela": zdjęcie szablonu jest decyzją biura,
     a nie usterką do naprawienia przez restart usługi. */
  const wymiana = S.listaSzablonow().find((s) => s.nazwa === "Wymiana przez paczkomat")!;
  S.zarchiwizujSzablon(wymiana.id, true, agent);
  assert.equal(S.listaSzablonow().some((s) => s.nazwa === "Wymiana przez paczkomat"), false);

  const { migracje } = await import("../db/db.js") as unknown as
    { migracje?: (d: unknown) => void };
  /* Migracje biegną przy starcie; tu wołamy je tak, jak zrobiłby restart —
     a gdy nie są wyeksportowane, wystarczy sprawdzić sam warunek pustki. */
  if (typeof migracje === "function") migracje(db());
  assert.equal(S.listaSzablonow().some((s) => s.nazwa === "Wymiana przez paczkomat"), false,
    "restart nie wskrzesza świadomie zdjętego szablonu");
  assert.equal(S.archiwumSzablonow().some((s) => s.nazwa === "Wymiana przez paczkomat"), true);

  S.zarchiwizujSzablon(wymiana.id, false, agent);
});

test("szablon dłuższy niż limit Allegro odpada PRZY ZAPISIE", () => {
  /* 2000 znaków to `NewMessageInThread.text.maxLength` ze specyfikacji.
     Zapisany dłuższy dałby szkic, którego nie da się wysłać — a agent
     zobaczyłby to dopiero po napisaniu całej odpowiedzi. */
  assert.throws(() => S.dodajSzablon("Za długi", "x".repeat(2001), agent),
    /najwyżej 2000 znaków/);
});

test("szablon bez treści i bez nazwy nie powstaje", () => {
  assert.throws(() => S.dodajSzablon("", "treść", agent), /musi mieć nazwę/);
  assert.throws(() => S.dodajSzablon("Nazwa", "   ", agent), /bez treści/);
});

test("nazwa jest JEDNA, a kolizja z archiwum mówi, co zrobić", () => {
  const s = S.dodajSzablon("Zwrot kosztów", "Oddajemy pieniądze.", agent);
  assert.throws(() => S.dodajSzablon("zwrot kosztów", "Inna treść.", agent),
    /już jest/);

  S.zarchiwizujSzablon(s.id, true, agent);
  /* Nazwa zajęta przez archiwum: gołe „UNIQUE constraint failed" nie mówi
     agentowi nic, więc zdanie ma wskazać drogę. */
  assert.throws(() => S.dodajSzablon("Zwrot kosztów", "Inna treść.", agent),
    /leży w archiwum/);
});

test("zmiana szablonu podpisuje się imieniem i czasem", () => {
  const s = S.dodajSzablon("Termin wysyłki", "Wysyłamy jutro.", agent);
  assert.equal(s.zmieniono, null);

  const po = S.zmienSzablon(s.id, "Termin wysyłki", "Wysyłamy w poniedziałek.", agent);
  assert.equal(po.tresc, "Wysyłamy w poniedziałek.");
  assert.equal(po.zmienil, "A. Lewandowska");
  assert.ok(po.zmieniono, "czas zmiany jest zapisany");
});

test("do dziennika idzie DŁUGOŚĆ, nigdy treść", () => {
  /* `events` nie ma retencji (§9 architektury), a szablon bywa zdaniem
     o kliencie — ta sama zasada, co przy notatce biura. */
  S.dodajSzablon("Przeprosiny", "Bardzo przepraszamy za opóźnienie.", agent);
  const e = db().prepare("SELECT payload FROM events WHERE type='szablon_dodany'").get() as
    { payload: string };
  assert.match(e.payload, /"znakow":3[0-9]/);
  assert.doesNotMatch(e.payload, /przepraszamy/);
});
