import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Ten raport opisuje LUDZI, więc jego testy pilnują nie tyle liczb, co reguł:
   zgłoszony problem nie jest błędem, mała próbka nie jest wynikiem, a zdarzenie
   bez konta nie zostaje doklejone do kogokolwiek.                             */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wyd-")), "t.db");

let db: typeof import("../db/db.js").db;
let W: typeof import("./wydajnosc.js");
let U: typeof import("./users.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  W = await import("./wydajnosc.js");
  U = await import("./users.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
  db().prepare("DELETE FROM app_user").run();
});

/** Zdarzenie `typ` sprzed `minutTemu`, przypisane do konta (albo do nikogo). */
function ev(typ: string, userRef: number | null, minutTemu: number, name = "x") {
  db()
    .prepare("INSERT INTO events(type, user_id, user_ref, created_at) VALUES (?,?,?,?)")
    .run(typ, name, userRef, new Date(Date.now() - minutTemu * 60_000).toISOString());
}

/** `ile` odłożeń co minutę, kończąc `odMinut` temu — seria pracy ciągłej. */
function seriaPracy(userRef: number, ile: number, odMinut = 60, name = "x") {
  for (let i = 0; i < ile; i++) ev("putaway_line_done", userRef, odMinut - i, name);
}

type Raport = Awaited<ReturnType<typeof import("./wydajnosc.js").raportWydajnosci>>;

const wiersz = (r: Raport, osoba: string) => r.wiersze.find((w) => w.osoba === osoba);

/* ── Reguła 1: zgłoszenie problemu NIE jest błędem zgłaszającego ─────────── */

test("zgłoszone problemy mają własną kolumnę i nie psują tempa", () => {
  // gdyby zgłoszenie liczyło się na czyjąś niekorzyść, ludzie przestaliby
  // zgłaszać — a problemy nie zniknęłyby, tylko przestały być widoczne
  const jan = U.createUser("Jan Kowalski");
  const ewa = U.createUser("Ewa Nowak");
  seriaPracy(jan.userId, 30);
  seriaPracy(ewa.userId, 30);
  for (let i = 0; i < 10; i++) ev("problem_raised", ewa.userId, 40 - i);

  const r = W.raportWydajnosci(1);
  const j = wiersz(r, "Jan Kowalski")!;
  const e = wiersz(r, "Ewa Nowak")!;
  assert.equal(e.zgloszoneProblemy, 10);
  assert.equal(j.zgloszoneProblemy, 0);
  assert.equal(e.pozycje, j.pozycje, "zgłoszenia nie zmieniają liczby pozycji");
  assert.equal(e.tempo, j.tempo, "ani tempa — to nie jest miara błędu");
});

test("raport nie ma kolumny błędów, bo aplikacja nie ma zdarzenia „pomyłka”", () => {
  // location_mismatch znaczy „adres w Subiekcie był nieaktualny" — to odkrycie,
  // nie pomyłka człowieka. Zmyślona kolumna byłaby gorsza niż jej brak.
  const jan = U.createUser("Jan Kowalski");
  seriaPracy(jan.userId, 25);
  const w = wiersz(W.raportWydajnosci(1), "Jan Kowalski")!;
  assert.ok(!("bledy" in w), "żadnej kolumny udającej ocenę");
  assert.deepEqual(
    Object.keys(w).filter((k) => /blad|blend|error|ocen/i.test(k)),
    []
  );
});

/* ── Reguła 2: mała próbka to nie wynik ──────────────────────────────────── */

test("poniżej progu tempo jest NULL, nie „mała liczba”", () => {
  const jan = U.createUser("Jan Kowalski");
  seriaPracy(jan.userId, W.PROG_WIARYGODNOSCI - 1);
  const w = wiersz(W.raportWydajnosci(1), "Jan Kowalski")!;
  assert.equal(w.wiarygodne, false);
  assert.equal(w.tempo, null, "liczba obok ostrzeżenia i tak zostałaby przeczytana jako wynik");
  assert.ok(w.pozycje > 0, "ale sama praca jest widoczna");
});

test("na progu tempo się pojawia", () => {
  const jan = U.createUser("Jan Kowalski");
  seriaPracy(jan.userId, W.PROG_WIARYGODNOSCI);
  const w = wiersz(W.raportWydajnosci(1), "Jan Kowalski")!;
  assert.equal(w.wiarygodne, true);
  assert.ok(w.tempo && w.tempo > 0);
});

/* ── Reguła 3: nie zgadujemy, kto to był ─────────────────────────────────── */

test("zdarzenia bez konta są liczone osobno, nigdy doklejane do kogoś", () => {
  const jan = U.createUser("Jan Kowalski");
  seriaPracy(jan.userId, 25);
  for (let i = 0; i < 7; i++) ev("putaway_line_done", null, 10 + i, "Jan");

  const r = W.raportWydajnosci(1);
  assert.equal(r.nieprzypisanychZdarzen, 7);
  assert.equal(wiersz(r, "Jan Kowalski")!.pozycje, 25, "sprzed kont nie dolicza się nikomu");
  assert.equal(r.wiersze.length, 1);
});

test("warianty tej samej osoby to JEDEN wiersz — grupujemy po koncie, nie po tekście", () => {
  const jan = U.createUser("Jan Kowalski");
  seriaPracy(jan.userId, 12, 60, "Jan");
  seriaPracy(jan.userId, 13, 40, "jan k");
  const r = W.raportWydajnosci(1);
  assert.equal(r.wiersze.length, 1);
  assert.equal(r.wiersze[0].pozycje, 25);
});

/* ── Czas aktywny ────────────────────────────────────────────────────────── */

test("przerwa dłuższa niż próg nie jest pracą", () => {
  const t = (min: number) => Date.parse("2026-07-25T08:00:00Z") + min * 60_000;
  // 10 minut pracy, dwie godziny rozładunku auta, 10 minut pracy
  const ciagle = W.czasAktywny([t(0), t(5), t(10)]);
  const zPrzerwa = W.czasAktywny([t(0), t(5), t(10), t(130), t(135), t(140)]);
  assert.equal(ciagle, 10);
  assert.equal(zPrzerwa, 20, "przerwa 120 min wypada, dwie serie po 10 min zostają");
});

test("czas aktywny jest ZANIŻONY, nie zawyżony", () => {
  // ostatnia pozycja w serii nie dokłada nic — zawyżone tempo krzywdziłoby
  // ludzi, zaniżone najwyżej niedoszacowuje
  const t = (min: number) => Date.parse("2026-07-25T08:00:00Z") + min * 60_000;
  assert.equal(W.czasAktywny([t(0)]), 0, "jedno zdarzenie to zero minut, nie „chwila”");
  assert.equal(W.czasAktywny([]), 0);
});

test("kolejność zdarzeń nie zmienia wyniku", () => {
  const t = (min: number) => Date.parse("2026-07-25T08:00:00Z") + min * 60_000;
  assert.equal(W.czasAktywny([t(10), t(0), t(5)]), W.czasAktywny([t(0), t(5), t(10)]));
});

/* ── Obowiązek formalny jedzie z danymi ──────────────────────────────────── */

test("raport niesie podstawę prawną monitoringu", () => {
  // kod tego nie blokuje — decyzja należy do pracodawcy — ale informacja
  // ma być tam, gdzie ktoś pierwszy raz otwiera zestawienie
  const r = W.raportWydajnosci(1);
  assert.match(r.podstawaPrawna, /22²/);
  assert.match(r.podstawaPrawna, /regulamin/i);
  assert.match(r.podstawaPrawna, /uprzedz/i);
});

test("pusty magazyn daje pusty raport, a nie zera przypisane komukolwiek", () => {
  U.createUser("Jan Kowalski");
  const r = W.raportWydajnosci(1);
  assert.deepEqual(r.wiersze, [], "konto bez pracy nie jest wierszem z zerem");
});
