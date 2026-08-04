import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── Seed scenariuszy ────────────────────────────────────────────────────────
   Dane demo psują się inaczej niż kod: nic nie rzuca wyjątkiem, po prostu
   scenariusz przestaje istnieć. Wyjątek bez zdjęcia, kolejka bez wiersza
   w `error`, katalog opisany w dokumentacji, której nikt nie dopisał — każde
   z tego wygląda na ekranie jak „u mnie działa".

   Ten plik pilnuje trzech rzeczy, których oko nie upilnuje:
     • katalog scenariuszy jest OPISANY w `docs/scenariusze-testowe.md`,
     • seed jest idempotentny i nie tyka danych spoza swojego zakresu,
     • pokrycie jest pełne — każdy status kolejki i każdy typ wyjątku ma wiersz.

   To ta sama lekcja, co `tools/docs_check.py`: zgodności dokumentacji z repo
   nie pilnuje komentarz, tylko mechanizm.                                    */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KATALOG_MD = path.resolve(__dirname, "../../../docs/scenariusze-testowe.md");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-scen-")), "t.db");

let S: typeof import("./seed-scenariusze.js");
let db: typeof import("./db.js").db;
let config: typeof import("../config.js").config;

before(async () => {
  S = await import("./seed-scenariusze.js");
  ({ db } = await import("./db.js"));
  ({ config } = await import("../config.js"));
  S.zbudujScenariusze();
});

const liczba = (sql: string, ...args: unknown[]): number =>
  (db().prepare(sql).get(...(args as never[])) as { n: number }).n;

const wartosci = (sql: string): string[] =>
  (db().prepare(sql).all() as Array<Record<string, string>>).map((r) => Object.values(r)[0]);

test("identyfikatory scenariuszy są unikalne", () => {
  const id = S.KATALOG.map((s) => s.id);
  assert.equal(new Set(id).size, id.length);
});

test("każdy scenariusz z katalogu jest opisany w dokumentacji", () => {
  const doc = fs.readFileSync(KATALOG_MD, "utf8");
  const brakujace = S.KATALOG.filter((s) => !doc.includes(s.id)).map((s) => s.id);
  assert.deepEqual(brakujace, [], `bez opisu w docs/scenariusze-testowe.md: ${brakujace.join(", ")}`);
});

test("dokumentacja nie opisuje scenariuszy, których seed nie buduje", () => {
  const doc = fs.readFileSync(KATALOG_MD, "utf8");
  const znane = new Set(S.KATALOG.map((s) => s.id));
  // nagłówki pozycji katalogu w dokumentacji: `### S07 — …`
  const opisane = [...doc.matchAll(/^### (S\d{2})\b/gm)].map((m) => m[1]);
  const nadmiarowe = opisane.filter((id) => !znane.has(id));
  assert.deepEqual(nadmiarowe, [], `opisane, ale niebudowane: ${nadmiarowe.join(", ")}`);
});

test("kolejka pokrywa wszystkie statusy workera", () => {
  const statusy = new Set(wartosci("SELECT DISTINCT status FROM sfera_queue"));
  for (const s of ["pending", "processing", "waiting_for_doc", "done", "error"]) {
    assert.ok(statusy.has(s), `brak zadania w statusie ${s}`);
  }
});

test("wyjątki pokrywają pięć kategorii formularza i klucze historyczne", async () => {
  const { PROBLEM_TYPES } = await import("../services/problems.js");
  const typy = new Set(wartosci("SELECT DISTINCT typ FROM problem"));
  for (const t of PROBLEM_TYPES) assert.ok(typy.has(t), `brak wyjątku typu ${t}`);
  for (const t of ["qty_short", "qty_over", "no_space", "unknown_barcode", "ean_conflict"]) {
    assert.ok(typy.has(t), `brak historycznego wyjątku ${t}`);
  }
});

test("linie dostawy pokrywają wszystkie statusy", () => {
  const statusy = new Set(wartosci("SELECT DISTINCT status FROM delivery_line"));
  for (const s of ["todo", "done", "partial", "skipped", "problem"]) {
    assert.ok(statusy.has(s), `brak linii w statusie ${s}`);
  }
});

test("wyjątek z linią zawsze wskazuje linię w statusie `problem`", () => {
  /* Reguła serwisu: zgłoszenie wyjątku ustawia linii status `problem`. Seed,
     który tego nie odwzorowuje, produkuje stan nieosiągalny z aplikacji —
     czyli demo kłamiące o własnych regułach. */
  const zle = liczba(
    `SELECT COUNT(*) AS n FROM problem p JOIN delivery_line l ON l.id = p.line_id
      WHERE l.status <> 'problem'`
  );
  assert.equal(zle, 0);
});

test("zdjęcie dowodowe leży na dysku, a jedna referencja celowo nie ma pliku", async () => {
  const { photoRefOf, photoPath } = await import("../services/problems.js");
  const zFoto = (db().prepare("SELECT id, foto_ref FROM problem WHERE foto_ref IS NOT NULL").all() as Array<{
    id: number;
    foto_ref: string;
  }>);
  assert.ok(zFoto.length >= 2);
  const istnieje = zFoto.filter((p) => photoPath(photoRefOf(p.id)!) !== null);
  assert.ok(istnieje.length >= 1, "żadne zdjęcie nie trafiło na dysk");
  assert.equal(zFoto.length - istnieje.length, 1, "dokładnie jedna referencja ma być bez pliku");
});

test("historia pobrań daje raportowi materiał na cztery listy", () => {
  const wz = liczba("SELECT COUNT(*) AS n FROM sgt_dokument WHERE typ = ?", S.TYP_WZ);
  assert.ok(wz > 0, "brak dokumentów WZ");
  // szybkorotujący poza strefą złotą i martwy indeks w strefie — patrz S63
  const rotujacy = liczba(
    `SELECT COUNT(*) AS n FROM sgt_pozycja p JOIN sgt_dokument d ON d.dok_id = p.dok_id
      WHERE d.typ = ? AND p.tw_id = 900029`,
    S.TYP_WZ
  );
  assert.equal(rotujacy, 40);
  const martwy = liczba(
    `SELECT COUNT(*) AS n FROM sgt_pozycja p JOIN sgt_dokument d ON d.dok_id = p.dok_id
      WHERE d.typ = ? AND p.tw_id = 900028`,
    S.TYP_WZ
  );
  assert.equal(martwy, 0);
});

test("konta scenariuszowe pokrywają wszystkie role i jedno jest wyłączone", async () => {
  const { ROLE } = await import("../services/users.js");
  const role = wartosci("SELECT DISTINCT role FROM app_user WHERE login IS NOT NULL");
  // lista ról jest zamknięta od 0.24.0 — scenariusze mają pokrywać ją w całości,
  // bo różnice między rolami widać wyłącznie na odmowach
  for (const r of ROLE) assert.ok(role.includes(r), `brak konta o roli ${r}`);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM app_user WHERE active = 0"), 1);
  // konto-ślad: audyt ma na co wskazywać, zalogować się nie da
  assert.ok(liczba("SELECT COUNT(*) AS n FROM app_user WHERE login IS NULL") >= 1);
});

test("dziennik niesie zdarzenia bez konta — materiał do migracji historii", () => {
  assert.ok(liczba("SELECT COUNT(*) AS n FROM events WHERE user_ref IS NULL") >= 3);
});

test("ponowne uruchomienie nie mnoży danych", () => {
  const stan = () => ({
    towary: liczba("SELECT COUNT(*) AS n FROM sgt_towar"),
    dokumenty: liczba("SELECT COUNT(*) AS n FROM sgt_dokument"),
    pozycje: liczba("SELECT COUNT(*) AS n FROM sgt_pozycja"),
    dostawy: liczba("SELECT COUNT(*) AS n FROM delivery"),
    linie: liczba("SELECT COUNT(*) AS n FROM delivery_line"),
    problemy: liczba("SELECT COUNT(*) AS n FROM problem"),
    kolejka: liczba("SELECT COUNT(*) AS n FROM sfera_queue"),
    konta: liczba("SELECT COUNT(*) AS n FROM app_user"),
    sesje: liczba("SELECT COUNT(*) AS n FROM device_session"),
    zdarzenia: liczba("SELECT COUNT(*) AS n FROM events"),
    kolizje: liczba("SELECT COUNT(*) AS n FROM ean_conflict"),
  });
  const przed = stan();
  S.zbudujScenariusze();
  assert.deepEqual(stan(), przed);
});

test("seed nie tyka danych spoza swojego zakresu", () => {
  /* Kartoteka z `npm run seed` numeruje się od 1. Podstawiamy wiersze w tym
     zakresie i sprawdzamy, że drugie uruchomienie zostawia je nietknięte —
     bo seed scenariuszy uruchamia się NA istniejącym demo, nie zamiast niego. */
  const d = db();
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, opis, lokalizacja) VALUES (7,'W32-0203','Towar z eksportu','','szt.','','A01-02-03')"
  ).run();
  d.prepare(
    "INSERT OR REPLACE INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze) VALUES (7,'FZ','FZ 7/08/2026','2026-08-01',?,'Dostawca z eksportu',0)"
  ).run(config.magId.MAG);
  d.prepare(
    "INSERT INTO app_user(login, haslo_hash, name, role, active, created_at) VALUES ('kierownik','x:y','Kierownik firmy','biuro',1,'2026-01-01T00:00:00.000Z')"
  ).run();
  d.prepare(
    "INSERT INTO events(type, tw_id, payload, user_id, device_id, user_ref, created_at) VALUES ('scan',7,NULL,'Kierownik firmy',NULL,NULL,'2026-01-01T00:00:00.000Z')"
  ).run();

  S.zbudujScenariusze();

  assert.equal(liczba("SELECT COUNT(*) AS n FROM sgt_towar WHERE tw_id = 7"), 1);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM sgt_dokument WHERE dok_id = 7"), 1);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM app_user WHERE login = 'kierownik'"), 1);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM events WHERE user_id = 'Kierownik firmy'"), 1);
});

test("na bazie podpiętej do Subiekta seed odmawia startu", () => {
  /* Konta ze znanym hasłem i gotowe tokeny sesji są tym, czego na produkcji
     robić nie wolno. Odmowa jest tu jedynym zabezpieczeniem, bo `npm run
     seed:scenariusze` wygląda równie niewinnie jak `npm run seed`. */
  const tryb = config.sgtMode;
  try {
    (config as { sgtMode: string }).sgtMode = "mssql";
    assert.throws(() => S.zbudujScenariusze(), /SGT_MODE=mssql/);
  } finally {
    (config as { sgtMode: string }).sgtMode = tryb;
  }
});
