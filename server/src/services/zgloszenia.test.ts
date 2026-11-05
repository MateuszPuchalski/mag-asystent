import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zgloszenia-serwis-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Umowa serwisu zgłoszeń ─────────────────────────────────────────────────
   Trasy sprawdza `routes/zgloszenia.test.ts`. Tu stoi to, czego przez HTTP
   sprawdzić się nie da: zapis wszystko-albo-nic przy awarii w połowie zdjęć
   i dokładny próg rozmiaru, liczony przed dekodowaniem. */

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zgloszenia.js");
let foto: typeof import("./foto.js");
let jan: { id: number; name: string };
let ola: { id: number; name: string };
let szef: { id: number; name: string };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");

const zgl = (o: Record<string, unknown> = {}) => ({
  rodzaj: "przeszkadza", opis: "Przycisk za mały", ekran: "/obsluga/zwroty", zrodlo: "panel", ...o,
});

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zgloszenia.js");
  foto = await import("./foto.js");
  const { createUser } = await import("./users.js");
  const u = (n: string, r: "magazynier" | "biuro" | "admin") => {
    const k = createUser(n, r, `${n}${Math.random()}`, "tajnehaslo");
    return { id: k.userId, name: k.name };
  };
  jan = u("Jan", "magazynier");
  ola = u("Ola", "biuro");
  szef = u("Szef", "admin");
});

beforeEach(() => {
  for (const t of ["zgloszenie_zdjecie", "zgloszenie_pracownika", "events"]) db().prepare(`DELETE FROM ${t}`).run();
});

const zdarzenia = () =>
  (db().prepare("SELECT type, payload FROM events WHERE type LIKE 'zgloszenie_%' ORDER BY id").all() as
    Array<{ type: string; payload: string }>).map((e) => ({ type: e.type, payload: JSON.parse(e.payload) }));

test("ekran traci zapytanie i kotwicę, bo niosą to, czego pracownik szukał", () => {
  const z = Z.zlozZgloszenie(zgl({ ekran: "/obsluga/zwroty?szukaj=Kowalski#wiersz-3" }), jan, null);
  assert.equal(z.ekran, "/obsluga/zwroty");
  assert.equal(Z.zlozZgloszenie(zgl({ ekran: "/obsluga/klient#login" }), jan, null).ekran, "/obsluga/klient");
  assert.equal(Z.zlozZgloszenie(zgl({ ekran: "/obsluga/klient/jan_kowalski88/zwroty?x=1" }), jan, null).ekran,
    "/obsluga/klient/:login/zwroty", "login kupującego nie trafia do bazy, nawet gdy front go nie wytnie");
  assert.throws(() => Z.zlozZgloszenie(zgl({ ekran: "?szukaj=Kowalski" }), jan, null), Z.BladZgloszenia,
    "sam adres zapytania to brak ekranu, nie pusty ekran");
  assert.throws(() => Z.zlozZgloszenie(zgl({ ekran: "/" + "a".repeat(200) }), jan, null), Z.BladZgloszenia);
});

test("walidacja pól z kontraktu", () => {
  const zle: Array<Record<string, unknown>> = [
    { rodzaj: "skarga" }, { zrodlo: "telefon" }, { opis: "   " }, { opis: "x".repeat(4001) },
    { wersja: "1".repeat(41) }, { zdjecia: "nie-lista" }, { zdjecia: [42] }, { ekran: undefined },
  ];
  for (const o of zle) assert.throws(() => Z.zlozZgloszenie(zgl(o), jan, null), Z.BladZgloszenia, JSON.stringify(o));
  const z = Z.zlozZgloszenie(zgl({ opis: "  x".padEnd(4002, "y"), wersja: "  " }), jan, null);
  assert.equal(z.opis.length, 4000, "limit liczy się po przycięciu");
  assert.equal(z.wersja, null, "pusta wersja to brak wersji");
  assert.equal(zdarzenia().length, 1, "odrzucone zgłoszenia nie zostawiają śladu w dzienniku");
});

test("zgłoszenie wraca w kształcie z kontraktu i trafia do dziennika bez opisu", () => {
  const z = Z.zlozZgloszenie(zgl({ zrodlo: "kolektor", wersja: "0.618.0", zdjecia: [JPEG] }), jan, " TC21-03 ");
  assert.deepEqual(Object.keys(z).sort(), ["at", "autor", "ekran", "id", "odpowiedz", "opis", "rodzaj", "status",
    "statusAt", "statusPrzez", "urzadzenie", "wersja", "zdjecia", "zrodlo"].sort());
  assert.equal(z.status, "nowe");
  assert.equal(z.autor, "Jan");
  assert.equal(z.urzadzenie, "TC21-03");
  assert.equal(z.zdjecia.length, 1);
  assert.deepEqual(zdarzenia(), [{ type: "zgloszenie_pracownika", payload: { id: z.id, rodzaj: "przeszkadza", zrodlo: "kolektor" } }]);
  const plik = Z.sciezkaZdjeciaZgloszenia(z.id, z.zdjecia[0].id);
  assert.ok(plik && fs.readFileSync(plik).equals(Buffer.from(JPEG, "base64")));
  assert.equal(Z.sciezkaZdjeciaZgloszenia(z.id + 1, z.zdjecia[0].id), null, "zdjęcie należy do swojego zgłoszenia");
});

test("najwyżej cztery zdjęcia, każde najwyżej 1024 kB po zdekodowaniu", () => {
  assert.throws(() => Z.zlozZgloszenie(zgl({ zdjecia: Array(5).fill(JPEG) }), jan, null), /najwyżej 4/);
  const naProgu = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024 * 1024 - 3, 7)]).toString("base64");
  const ponad = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024 * 1024 + 1 - 3, 7)]).toString("base64");
  assert.throws(() => Z.zlozZgloszenie(zgl({ zdjecia: [ponad] }), jan, null), /najwyżej 1024 kB/);
  const z = Z.zlozZgloszenie(zgl({ zdjecia: [`data:image/jpeg;base64,${naProgu}`, JPEG, JPEG, JPEG] }), jan, null);
  assert.equal(z.zdjecia.length, 4, "próg jest włącznie, a prefiks data: nie liczy się do rozmiaru");
  assert.throws(() => Z.zlozZgloszenie(zgl({ zdjecia: ["===="] }), jan, null), /puste/);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
  assert.throws(() => Z.zlozZgloszenie(zgl({ zdjecia: [png] }), jan, null), /nie jest plikiem JPEG/,
    "trasa oddaje plik jako image/jpeg, więc inny typ nie wchodzi");
});

test("awaria zapisu w połowie zdjęć nie zostawia nic w bazie ani na dysku", () => {
  const zapisane: string[] = [];
  let n = 0;
  const zapisz = (b64: string, prefiks: string) => {
    if (++n === 2) throw new Error("dysk pełny");
    const nazwa = `${prefiks}test.jpg`;
    fs.writeFileSync(path.join(foto.katalogZdjec(), nazwa), Buffer.from(b64, "base64"));
    zapisane.push(path.join(foto.katalogZdjec(), nazwa));
    return nazwa;
  };
  assert.throws(() => Z.zlozZgloszenie(zgl({ zdjecia: [JPEG, JPEG, JPEG] }), jan, null, zapisz), /dysk pełny/);
  assert.equal(zapisane.length, 1);
  assert.equal(fs.existsSync(zapisane[0]), false, "plik pierwszego zdjęcia znika razem ze zgłoszeniem");
  const ile = (t: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  assert.equal(ile("zgloszenie_pracownika"), 0);
  assert.equal(ile("zgloszenie_zdjecie"), 0);
  assert.equal(zdarzenia().length, 0);
});

test("moje: tylko własne, najnowsze pierwsze, najwyżej dwadzieścia", () => {
  for (let i = 0; i < 22; i++) Z.zlozZgloszenie(zgl({ opis: `Jan ${i}` }), jan, null);
  Z.zlozZgloszenie(zgl({ opis: "Ola" }), ola, null);
  const moje = Z.mojeZgloszenia(jan.id);
  assert.equal(moje.length, 20);
  assert.equal(moje[0].opis, "Jan 21");
  assert.ok(moje.every((z) => z.autor === "Jan"));
});

test("lista właściciela filtruje po statusie, a liczniki liczą wszystko", () => {
  const a = Z.zlozZgloszenie(zgl(), jan, null);
  Z.zlozZgloszenie(zgl({ rodzaj: "blad" }), ola, null);
  Z.zmienStatus(a.id, { status: "przyjete" }, szef);
  const wszystko = Z.listaZgloszen();
  assert.equal(wszystko.zgloszenia.length, 2);
  assert.deepEqual(wszystko.liczniki, { nowe: 1, przyjete: 1, zrobione: 0, odrzucone: 0 });
  const nowe = Z.listaZgloszen("nowe");
  assert.deepEqual(nowe.zgloszenia.map((z) => z.rodzaj), ["blad"]);
  assert.deepEqual(nowe.liczniki, wszystko.liczniki);
  assert.throws(() => Z.listaZgloszen("zgubione"), Z.BladZgloszenia);
});

test("decyzja: status z odpowiedzią, pominięta odpowiedź zostaje, pusta znika", () => {
  const a = Z.zlozZgloszenie(zgl(), jan, null);
  let z = Z.zmienStatus(a.id, { status: "przyjete", odpowiedz: "  Zrobimy w tym miesiącu  " }, szef);
  assert.equal(z.status, "przyjete");
  assert.equal(z.odpowiedz, "Zrobimy w tym miesiącu");
  assert.equal(z.statusPrzez, "Szef");
  assert.ok(z.statusAt);
  z = Z.zmienStatus(a.id, { status: "zrobione" }, szef);
  assert.equal(z.odpowiedz, "Zrobimy w tym miesiącu", "zmiana statusu nie kasuje przeczytanego zdania");
  z = Z.zmienStatus(a.id, { status: "zrobione", odpowiedz: "" }, szef);
  assert.equal(z.odpowiedz, null);
  assert.throws(() => Z.zmienStatus(a.id, { status: "zgubione" }, szef), Z.BladZgloszenia);
  assert.throws(() => Z.zmienStatus(a.id, { status: "nowe", odpowiedz: "x".repeat(1001) }, szef), Z.BladZgloszenia);
  assert.throws(() => Z.zmienStatus(a.id + 100, { status: "nowe" }, szef), Z.BrakZgloszenia);
  assert.deepEqual(zdarzenia().filter((e) => e.type === "zgloszenie_pracownika_status").map((e) => e.payload.status),
    ["przyjete", "zrobione", "zrobione"]);
});

