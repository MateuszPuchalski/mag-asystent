import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BladZlecenia, _wyczyscPamiec, porownajWersje, postepZPliku, problemAktualizacji, sekcjeZmian, sprawdzWydania,
  stanAktualizacji, stanZadania, trwaAktualizacja, ustawUruchamiacz, wydaniaNowsze, wynikDoDziennika, zlecAktualizacje,
  type Pobieracz,
} from "./aktualizacja-serwera.js";

/* Aktualizacja z panelu (0.492.0). Najważniejsze gwarancje:
   - do wyboru są wyłącznie wydania NOWSZE i Z PACZKĄ;
   - zlecenie powstaje tylko wtedy, gdy zadanie ruszyło — inaczej wisiałoby
     jako „trwa" i blokowało przycisk na zawsze;
   - bez uruchamiacza (poza NSSM) nie da się zlecić niczego. */

const kat = () => fs.mkdtempSync(path.join(os.tmpdir(), "wertis-akt-"));

const CHANGELOG = `# Historia

## 0.493.0 — 25 września 2026

**Nowość.** Opis.

**[wymaga działania]** Coś trzeba zrobić.

## 0.492.1 — 25 września 2026

Poprawka.

## 0.492.0 — 24 września 2026

Obecna.

---
`;

const WYDANIA = [
  { tag_name: "v0.493.0", published_at: "2026-09-25T10:00:00Z",
    assets: [{ name: "wertis-0.493.0.zip" }, { name: "wertis-0.493.0.zip.sha256" }, { name: "wertis-kolektor-0.493.0.apk" }] },
  { tag_name: "v0.492.1", published_at: "2026-09-25T08:00:00Z", assets: [{ name: "wertis-kolektor-0.492.1.apk" }] },
  { tag_name: "v0.492.0", published_at: "2026-09-24T08:00:00Z", assets: [] },
  { tag_name: "v0.491.0", published_at: "2026-09-23T08:00:00Z", assets: [] },
  { tag_name: "nightly", published_at: null, assets: [] },
];

const pobieracz = (mapa: Record<string, string | number>): Pobieracz => async (url) => {
  const v = mapa[url];
  if (typeof v === "number") return { ok: false, status: v, text: async () => "" };
  if (v === undefined) return { ok: false, status: 404, text: async () => "" };
  return { ok: true, status: 200, text: async () => v };
};

const API = "https://api.github.com/repos/MateuszPuchalski/mag-asystent/releases?per_page=30";
const RAW = "https://raw.githubusercontent.com/MateuszPuchalski/mag-asystent/v0.493.0/CHANGELOG.md";

beforeEach(() => { _wyczyscPamiec(); ustawUruchamiacz(null); });

test("wersje porównują się liczbowo, nie tekstowo", () => {
  assert.ok(porownajWersje("0.500.0", "0.99.0") > 0);
  assert.equal(porownajWersje("0.492.0", "0.492.0"), 0);
  assert.ok(porownajWersje("0.491.9", "0.492.0") < 0);
});

test("do wyboru tylko nowsze wydania, od najnowszego; paczka rozpoznana po obu plikach", () => {
  const w = wydaniaNowsze(WYDANIA, "0.492.0");
  assert.deepEqual(w.map((x) => [x.wersja, x.maPaczke]), [["0.493.0", true], ["0.492.1", false]]);
});

test("zmiany: sekcje między obecną a docelową, z flagą wymaga działania", () => {
  const z = sekcjeZmian(CHANGELOG, "0.492.0", "0.493.0");
  assert.deepEqual(z.map((s) => [s.wersja, s.wymagaDzialania]), [["0.493.0", true], ["0.492.1", false]]);
  assert.equal(z[1]!.tresc, "Poprawka.");
  assert.deepEqual(sekcjeZmian(CHANGELOG, "0.492.0", "0.492.1").map((s) => s.wersja), ["0.492.1"]);
});

test("sprawdzenie wydań wypełnia pamięć; błąd sieci zostawia starą listę ze zdaniem", async () => {
  const k = kat();
  await sprawdzWydania(pobieracz({ [API]: JSON.stringify(WYDANIA), [RAW]: CHANGELOG }), "0.492.0");
  let s = stanAktualizacji(k);
  assert.deepEqual(s.wydania.map((w) => w.wersja), ["0.493.0", "0.492.1"]);
  assert.equal(s.zmiany.length, 2);
  assert.equal(s.bladSprawdzenia, null);

  await sprawdzWydania(pobieracz({ [API]: 503 }), "0.492.0");
  s = stanAktualizacji(k);
  assert.equal(s.wydania.length, 2, "chwilowy brak sieci skasował listę");
  assert.match(s.bladSprawdzenia ?? "", /503/);
});

test("poza NSSM przycisk jest zablokowany zdaniem i zlecenie odmawia", async () => {
  const k = kat();
  await sprawdzWydania(pobieracz({ [API]: JSON.stringify(WYDANIA), [RAW]: CHANGELOG }), "0.492.0");
  assert.match(stanAktualizacji(k).blokada ?? "", /usługa Windows/);
  await assert.rejects(() => zlecAktualizacje("0.493.0", "Anna", k), (e: unknown) => e instanceof BladZlecenia && e.kod === 409);
  assert.ok(!fs.existsSync(path.join(k, "zlecenie.json")));
});

test("zlecenie: plik z wersją i osobą, zadanie uruchomione po nazwie", async () => {
  const k = kat();
  await sprawdzWydania(pobieracz({ [API]: JSON.stringify(WYDANIA), [RAW]: CHANGELOG }), "0.491.0");
  const wolane: string[] = [];
  ustawUruchamiacz(async (n) => { wolane.push(n); });
  /* WERSJA serwera w testach jest niższa niż 0.493.0 tylko przypadkiem,
     więc wybieramy wydanie, które na pewno jest na liście. */
  const wersja = stanAktualizacji(k).wydania.find((w) => w.maPaczke)!.wersja;
  await zlecAktualizacje(wersja, "Anna", k, "2026-09-25T10:00:00.000Z");
  const z = JSON.parse(fs.readFileSync(path.join(k, "zlecenie.json"), "utf8"));
  assert.deepEqual(z, { wersja, kto: "Anna", at: "2026-09-25T10:00:00.000Z" });
  assert.deepEqual(wolane, ["WERTIS aktualizacja"]);
  /* Drugie kliknięcie w trakcie — odmowa, nie druga aktualizacja. */
  await assert.rejects(() => zlecAktualizacje(wersja, "Anna", k), /już trwa/);
});

test("zadanie, które nie ruszyło, nie zostawia zlecenia", async () => {
  const k = kat();
  await sprawdzWydania(pobieracz({ [API]: JSON.stringify(WYDANIA), [RAW]: CHANGELOG }), "0.491.0");
  ustawUruchamiacz(async () => { throw new Error("ERROR: The system cannot find the file specified."); });
  const wersja = stanAktualizacji(k).wydania.find((w) => w.maPaczke)!.wersja;
  await assert.rejects(() => zlecAktualizacje(wersja, "Anna", k), /-Aktualizuj/);
  assert.ok(!fs.existsSync(path.join(k, "zlecenie.json")), "zlecenie bez wykonawcy blokowałoby przycisk");
});

test("wydanie bez paczki i wersja spoza listy — odmowa", async () => {
  const k = kat();
  await sprawdzWydania(pobieracz({ [API]: JSON.stringify(WYDANIA), [RAW]: CHANGELOG }), "0.491.0");
  ustawUruchamiacz(async () => {});
  const bezPaczki = stanAktualizacji(k).wydania.find((w) => !w.maPaczke);
  if (bezPaczki) await assert.rejects(() => zlecAktualizacje(bezPaczki.wersja, "Anna", k), /nie ma jeszcze paczki/);
  await assert.rejects(() => zlecAktualizacje("9.9.9", "Anna", k), /nie ma wśród wydań/);
  await assert.rejects(() => zlecAktualizacje("0.493.0; del", "Anna", k), /nie ma wśród wydań/);
});

test("„trwa” starsze niż 45 minut nie blokuje przycisku", () => {
  const teraz = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(trwaAktualizacja({ etap: "trwa", wersja: "0.493.0", od: "2026-09-25T11:30:00Z" }, teraz), true);
  assert.equal(trwaAktualizacja({ etap: "trwa", wersja: "0.493.0", od: "2026-09-25T11:00:00Z" }, teraz), false);
});

test("wynik trafia do dziennika raz, przy pierwszym starcie po aktualizacji", () => {
  const k = kat();
  const zalogowane: unknown[] = [];
  fs.writeFileSync(path.join(k, "stan.json"),
    "﻿" + JSON.stringify({ etap: "gotowe", wersja: "0.493.0", kto: "Anna", od: "2026-09-25T10:00:00.000Z" }));
  assert.ok(wynikDoDziennika((s) => zalogowane.push(s), k));
  assert.equal(wynikDoDziennika((s) => zalogowane.push(s), k), null, "drugi start nie loguje drugi raz");
  assert.equal(zalogowane.length, 1);
});

test("nieudana aktualizacja w zdrowiu przez dobę", () => {
  const stan = { etap: "blad" as const, wersja: "0.493.0", od: "2026-09-25T10:00:00Z", do: "2026-09-25T10:03:00Z" };
  assert.match(problemAktualizacji(stan, Date.parse("2026-09-25T12:00:00Z")) ?? "", /nie powiodła się/);
  assert.equal(problemAktualizacji(stan, Date.parse("2026-09-27T12:00:00Z")), null);
  assert.equal(problemAktualizacji({ ...stan, etap: "gotowe" }, Date.parse("2026-09-25T12:00:00Z")), null);
});

/* Pasek postępu (@wydanie): krok z pliku instalatora trafia do stanu tylko
   w trakcie, tylko w poprawnym kształcie i tylko z TEJ aktualizacji. */
test("postęp: poprawny kształt przechodzi, reszta odpada", () => {
  const at = "2026-09-25T16:48:10.000Z";
  assert.deepEqual(postepZPliku({ krok: 3, z: 4, nazwa: " Zamiana wersji ", at }),
    { krok: 3, z: 4, nazwa: "Zamiana wersji", at });
  for (const zly of [null, "x", { krok: 5, z: 4, nazwa: "a", at }, { krok: 0, z: 4, nazwa: "a", at },
    { krok: 1.5, z: 4, nazwa: "a", at }, { krok: 1, z: 4, nazwa: "", at }, { krok: 1, z: 4, nazwa: "a".repeat(121), at },
    { krok: 1, z: 4, nazwa: "a", at: "wczoraj" }, { krok: 1, z: 40, nazwa: "a", at }]) {
    assert.equal(postepZPliku(zly), null, JSON.stringify(zly));
  }
});

test("postęp dochodzi do stanu tylko w trakcie i tylko z tej aktualizacji", () => {
  const k = kat();
  const stan = { etap: "trwa", wersja: "0.503.0", od: "2026-09-25T16:48:00.000Z" };
  fs.writeFileSync(path.join(k, "stan.json"), "\uFEFF" + JSON.stringify(stan));
  assert.equal(stanZadania(k)?.postep, undefined, "bez pliku postępu nie ma kroku");

  fs.writeFileSync(path.join(k, "postep.json"),
    "\uFEFF" + JSON.stringify({ krok: 2, z: 4, nazwa: "Rozpakowanie", at: "2026-09-25T16:48:30.000Z" }));
  assert.deepEqual(stanZadania(k)?.postep, { krok: 2, z: 4, nazwa: "Rozpakowanie", at: "2026-09-25T16:48:30.000Z" });

  fs.writeFileSync(path.join(k, "postep.json"),
    JSON.stringify({ krok: 4, z: 4, nazwa: "Stary krok", at: "2026-09-25T10:00:00.000Z" }));
  assert.equal(stanZadania(k)?.postep, undefined, "krok sprzed startu jest z poprzedniej aktualizacji");

  fs.writeFileSync(path.join(k, "postep.json"),
    JSON.stringify({ krok: 4, z: 4, nazwa: "Uruchomienie", at: "2026-09-25T16:50:00.000Z" }));
  fs.writeFileSync(path.join(k, "stan.json"), JSON.stringify({ ...stan, etap: "gotowe", do: "2026-09-25T16:51:00.000Z" }));
  assert.equal(stanZadania(k)?.postep, undefined, "po zakończeniu pasek znika");
  fs.writeFileSync(path.join(k, "postep.json"), "{\"krok\": 2, \"z\"");
  fs.writeFileSync(path.join(k, "stan.json"), JSON.stringify(stan));
  assert.equal(stanZadania(k)?.postep, undefined, "połowa zapisu nie rysuje niczego");
});
