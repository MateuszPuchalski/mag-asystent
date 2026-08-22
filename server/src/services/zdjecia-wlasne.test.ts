import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Zdjęcia dodane z kolektora ──────────────────────────────────────────────
   Serwis trzyma dwie rzeczy o różnym cyklu życia i to jest cała jego trudność:
   ZAPISANE ZDJĘCIE, którego nikt nie odtworzy, i PODGLĄD, który ma zniknąć sam.
   Pomylenie ich kończy się albo bazą pełną porzuconych kadrów, albo skasowanym
   zdjęciem, po które ktoś szedł z towarem do regału.                          */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjw-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";
process.env.ZDJECIA_DODAWANIE = "wertis";
process.env.ZDJECIA_UPLOAD_MAX_KB = "64";
process.env.ZDJECIA_PODGLAD_MIN = "15";

let db: typeof import("../db/db.js").db;
let M: typeof import("./zdjecia-wlasne.js");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  M = await import("./zdjecia-wlasne.js");
});

beforeEach(() => {
  for (const t of ["zdjecie_wlasne", "zdjecie_podglad"]) db().prepare(`DELETE FROM ${t}`).run();
});

// ── Walidacja bajtów ────────────────────────────────────────────────────────

test("JPEG i PNG przechodzą, typ bierze się z BAJTÓW", () => {
  const j = M.bajtyZeZdjecia(JPEG.toString("base64"));
  assert.ok(j.ok && j.mime === "image/jpeg");
  const p = M.bajtyZeZdjecia(PNG.toString("base64"));
  assert.ok(p.ok && p.mime === "image/png");
});

test("nagłówek data: jest zdejmowany, nie odrzucany", () => {
  const r = M.bajtyZeZdjecia(`data:image/jpeg;base64,${JPEG.toString("base64")}`);
  assert.ok(r.ok);
});

test("treść, która nie jest obrazem, odpada", () => {
  const r = M.bajtyZeZdjecia(Buffer.from("zwykły tekst").toString("base64"));
  assert.ok(!r.ok && /JPEG ani PNG/.test(r.error));
});

test("limit rozmiaru odmawia i NAZYWA drogę wyjścia", () => {
  const wielkie = Buffer.concat([JPEG, Buffer.alloc(70 * 1024)]);
  const r = M.bajtyZeZdjecia(wielkie.toString("base64"));
  assert.ok(!r.ok);
  assert.match(r.error, /kolektor zmniejsza obraz sam/);
});

// ── Podgląd ────────────────────────────────────────────────────────────────

test("podgląd trzyma OBIE wersje — „ZOSTAW TŁO” nie wysyła zdjęcia drugi raz", () => {
  const id = M.zapiszPodglad(1, JPEG, "image/jpeg", PNG);
  const w = M.podglad(id, 1);
  assert.ok(w);
  assert.deepEqual(w.oryginal, JPEG);
  assert.deepEqual(w.bezTla, PNG);
});

test("podgląd innego towaru jest niewidoczny", () => {
  const id = M.zapiszPodglad(1, JPEG, "image/jpeg", null);
  assert.equal(M.podglad(id, 2), null);
});

/* Wiersz z dwoma obrazami nie ma prawa czekać w bazie bez końca — prób bywa
   kilka pod rząd, a arkusz zamknięty w połowie nie sprząta po sobie. */
test("przeterminowany podgląd znika przy odczycie", () => {
  const id = M.zapiszPodglad(1, JPEG, "image/jpeg", null);
  const stare = new Date(Date.now() - 60 * 60_000).toISOString();
  db().prepare("UPDATE zdjecie_podglad SET utworzone_at = ? WHERE id = ?").run(stare, id);
  assert.equal(M.podglad(id, 1), null);
  const { ile } = db().prepare("SELECT COUNT(*) AS ile FROM zdjecie_podglad").get() as { ile: number };
  assert.equal(ile, 0, "odczyt ma po sobie posprzątać, nie tylko odmówić");
});

test("sprzątanie kasuje stare, a świeżych nie rusza", () => {
  const stary = M.zapiszPodglad(1, JPEG, "image/jpeg", null);
  const swiezy = M.zapiszPodglad(2, JPEG, "image/jpeg", null);
  db()
    .prepare("UPDATE zdjecie_podglad SET utworzone_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 60 * 60_000).toISOString(), stary);
  assert.equal(M.posprzatajPodglady(), 1);
  assert.ok(M.podglad(swiezy, 2));
});

// ── Zapisane zdjęcie ───────────────────────────────────────────────────────

test("zapis niesie ETag z TREŚCI — to po nim idzie 304", () => {
  const a = M.zapiszWlasne({
    twId: 1, obraz: PNG, mime: "image/png", tloUsuniete: true,
    dodaneBy: "Jan", dodaneByRef: null,
  });
  for (const t of ["zdjecie_wlasne"]) db().prepare(`DELETE FROM ${t}`).run();
  const b = M.zapiszWlasne({
    twId: 1, obraz: PNG, mime: "image/png", tloUsuniete: true,
    dodaneBy: "Jan", dodaneByRef: null,
  });
  assert.equal(a.etag, b.etag, "te same bajty to ten sam znacznik — inaczej kolektor pobiera w kółko");
});

test("powtórne dodanie PODMIENIA, nie dokłada wiersza", () => {
  M.zapiszWlasne({ twId: 1, obraz: JPEG, mime: "image/jpeg", tloUsuniete: false, dodaneBy: "Jan", dodaneByRef: null });
  M.zapiszWlasne({ twId: 1, obraz: PNG, mime: "image/png", tloUsuniete: true, dodaneBy: "Jan", dodaneByRef: null });
  const w = M.wlasneZdjecie(1);
  assert.ok(w);
  assert.deepEqual(w.obraz, PNG);
  assert.equal(w.tloUsuniete, true);
});

/* Podmiana MUSI zerować `queue_id` i `w_subiekcie_at`. Bez tego drugie zdjęcie
   nosiłoby numer zadania pierwszego, a stan „już w Subiekcie" kazałby skasować
   wiersz, którego do Subiekta nikt jeszcze nie wysłał. */
test("podmiana zeruje ślad poprzedniego zadania", () => {
  M.zapiszWlasne({ twId: 1, obraz: JPEG, mime: "image/jpeg", tloUsuniete: false, dodaneBy: "Jan", dodaneByRef: null });
  M.przypiszZadanie(1, 42);
  assert.equal(M.wlasneZdjecie(1)?.queueId, 42);
  M.zapiszWlasne({ twId: 1, obraz: PNG, mime: "image/png", tloUsuniete: true, dodaneBy: "Jan", dodaneByRef: null });
  assert.equal(M.wlasneZdjecie(1)?.queueId, null);
});

/* Wiersz znika DOPIERO po udanym zapisie do Subiekta — od tej chwili źródłem
   jest znowu Subiekt i poprawka zrobiona tam dociera na kolektor. */
test("oznaczenie „już w Subiekcie” zdejmuje zapasową kopię", () => {
  M.zapiszWlasne({ twId: 1, obraz: PNG, mime: "image/png", tloUsuniete: true, dodaneBy: "Jan", dodaneByRef: null });
  M.oznaczWSubiekcie(1);
  assert.equal(M.wlasneZdjecie(1), null);
});

test("statystyki liczą to, co czeka na wejście do Subiekta", () => {
  M.zapiszWlasne({ twId: 1, obraz: PNG, mime: "image/png", tloUsuniete: true, dodaneBy: "Jan", dodaneByRef: null });
  M.zapiszWlasne({ twId: 2, obraz: JPEG, mime: "image/jpeg", tloUsuniete: false, dodaneBy: "Jan", dodaneByRef: null });
  const s = M.statystykiWlasnych();
  assert.equal(s.sztuk, 2);
  assert.equal(s.bajtow, PNG.length + JPEG.length);
});
