import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Aktualizacja automatyczna (0.494.0). Każda bramka z nagłówka
   `aktualizacja-auto.ts` ma tu własny przypadek, bo każda chroni przed innym
   nieszczęściem: wymagające działania wydanie wgrane bez człowieka, zepsuta
   wersja wgrywana co pięć minut, przerwa w środku rozkładania. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-auto-"));
process.env.DB_PATH = path.join(dir, "t.db");
process.env.WERTIS_ENV_FILE = path.join(dir, "brak.env");
process.env.LOG_LEVEL = "silent";

type Auto = typeof import("./aktualizacja-auto.js");
type Serwis = typeof import("./aktualizacja-serwera.js");
let A: Auto;
let S: Serwis;
before(async () => {
  A = await import("./aktualizacja-auto.js");
  S = await import("./aktualizacja-serwera.js");
});

/* 01:30 UTC to 03:30 w Warszawie (czas letni) — w oknie 3–5. */
const NOC = "2026-09-25T01:30:00.000Z";
const DZIEN = "2026-09-25T10:00:00.000Z";
const godzinTemu = (h: number, od = NOC) => new Date(Date.parse(od) - h * 3_600_000).toISOString();

const ust = (z: Partial<import("./aktualizacja-auto.js").UstawieniaAuto> = {}) =>
  ({ tryb: "noc" as const, okno: { od: 3, do: 5 }, dojrzaloscGodz: 6, kanarek: "", ...z });

function pamiec(z: Partial<import("./aktualizacja-serwera.js").Pamiec> = {}) {
  return {
    sprawdzono: NOC, blad: null, zmianyZnane: true,
    wydania: [
      { wersja: "0.494.0", opublikowano: godzinTemu(8), maPaczke: true },
      { wersja: "0.493.0", opublikowano: godzinTemu(20), maPaczke: true },
    ],
    zmiany: [
      { wersja: "0.494.0", tytul: "", tresc: "", wymagaDzialania: false },
      { wersja: "0.493.0", tytul: "", tresc: "", wymagaDzialania: false },
    ],
    ...z,
  };
}

const decyzja = (z: Partial<import("./aktualizacja-auto.js").WejscieDecyzji> = {}) =>
  A.decyzjaAuto({ ust: ust(), obecna: "0.492.0", pamiec: pamiec(), stan: null, teraz: NOC, ostatniRuch: null, ...z });

test("noc, cisza, dojrzałe wydanie: wgrywa najnowsze", () => {
  assert.deepEqual(decyzja(), { kandydat: "0.494.0", teraz: true, powod: "Wgrywam 0.494.0." });
});

test("wyłączona, bez sprawdzenia, bez wydań, bez CHANGELOG-u: nic", () => {
  assert.match(decyzja({ ust: ust({ tryb: "wylaczona" }) }).powod, /wyłączona/);
  assert.match(decyzja({ pamiec: pamiec({ sprawdzono: null }) }).powod, /nie sprawdził/);
  assert.equal(decyzja({ pamiec: pamiec({ wydania: [], zmiany: [] }) }).powod, "To najnowsza wersja.");
  const bez = decyzja({ pamiec: pamiec({ zmianyZnane: false }) });
  assert.deepEqual([bez.kandydat, bez.teraz], [null, false]);
  assert.match(bez.powod, /CHANGELOG/);
});

test("poza oknem: kandydat znany, ale czeka — panel mówi kiedy", () => {
  const d = decyzja({ teraz: DZIEN });
  assert.deepEqual([d.kandydat, d.teraz], ["0.494.0", false]);
  assert.match(d.powod, /w oknie 3:00–5:00/);
  /* Tryb „zaraz" (dev) okna nie zna. */
  assert.equal(decyzja({ teraz: DZIEN, ust: ust({ tryb: "zaraz" }) }).teraz, true);
});

test("ktoś zapisał 5 minut temu — czeka; 15 minut temu — wgrywa", () => {
  const t = Date.parse(NOC);
  const d = decyzja({ ostatniRuch: t - 5 * 60_000 });
  assert.deepEqual([d.kandydat, d.teraz], ["0.494.0", false]);
  assert.match(d.powod, /nikt nie będzie pracował/);
  assert.equal(decyzja({ ostatniRuch: t - 15 * 60_000 }).teraz, true);
});

test("[wymaga działania] w najnowszym: automat staje na ostatnim przed nim", () => {
  const d = decyzja({ pamiec: pamiec({ zmiany: [
    { wersja: "0.494.0", tytul: "", tresc: "", wymagaDzialania: true },
    { wersja: "0.493.0", tytul: "", tresc: "", wymagaDzialania: false },
  ] }) });
  assert.deepEqual([d.kandydat, d.teraz], ["0.493.0", true]);
  assert.match(d.powod, /0\.494\.0 wymaga działania/);
});

test("[wymaga działania] po drodze blokuje też wszystko nowsze", () => {
  const d = decyzja({ pamiec: pamiec({ zmiany: [
    { wersja: "0.494.0", tytul: "", tresc: "", wymagaDzialania: false },
    { wersja: "0.493.0", tytul: "", tresc: "", wymagaDzialania: true },
  ] }) });
  assert.deepEqual([d.kandydat, d.teraz], [null, false]);
  assert.match(d.powod, /0\.493\.0 wymaga działania — zaktualizuj przyciskiem/);
});

test("za młode najnowsze: bierze starsze dojrzałe; dev (0 h) bierze od razu", () => {
  const p = pamiec({ wydania: [
    { wersja: "0.494.0", opublikowano: godzinTemu(2), maPaczke: true },
    { wersja: "0.493.0", opublikowano: godzinTemu(20), maPaczke: true },
  ] });
  const d = decyzja({ pamiec: p });
  assert.deepEqual([d.kandydat, d.teraz], ["0.493.0", true]);
  assert.match(d.powod, /0\.494\.0 ma mniej niż 6 h/);
  assert.equal(decyzja({ pamiec: p, ust: ust({ dojrzaloscGodz: 0 }) }).kandydat, "0.494.0");
});

test("wersja, która raz się nie udała, drugi raz sama nie wchodzi", () => {
  const d = decyzja({ stan: { etap: "blad", wersja: "0.494.0", od: godzinTemu(24), do: godzinTemu(24) } });
  assert.equal(d.kandydat, "0.493.0");
  assert.match(d.powod, /już raz się nie udało/);
});

test("bez paczki — pomija", () => {
  const d = decyzja({ pamiec: pamiec({ wydania: [
    { wersja: "0.494.0", opublikowano: godzinTemu(8), maPaczke: false },
    { wersja: "0.493.0", opublikowano: godzinTemu(20), maPaczke: true },
  ] }) });
  assert.equal(d.kandydat, "0.493.0");
});

test("kanarek: wgrywa najwyżej to, na czym pracuje dev; milczący kanarek wstrzymuje", () => {
  const k = ust({ kanarek: "http://localhost:3002" });
  assert.equal(decyzja({ ust: k, kanarek: "0.493.0" }).kandydat, "0.493.0");
  assert.equal(decyzja({ ust: k, kanarek: "0.494.0" }).kandydat, "0.494.0");
  const cisza = decyzja({ ust: k, kanarek: null });
  assert.deepEqual([cisza.kandydat, cisza.teraz], [null, false]);
  assert.match(cisza.powod, /Kanarek nie odpowiada/);
});

test("trwająca aktualizacja i świeża nieudana próba nie zlecają drugi raz", () => {
  assert.match(decyzja({ stan: { etap: "trwa", wersja: "0.494.0", od: godzinTemu(0.1) } }).powod, /trwa/);
  const d = decyzja({ proba: { wersja: "0.494.0", kiedy: Date.parse(NOC) - 60_000 } });
  assert.deepEqual([d.kandydat, d.teraz], ["0.494.0", false]);
  assert.match(d.powod, /nie ruszyło/);
});

test("okno przez północ", () => {
  const o = { od: 23, do: 2 };
  assert.deepEqual([23, 0, 1, 2, 12].map((g) => A.wOknie(o, g)), [true, true, true, false, false]);
});

test("ustawienia: literówka w trybie to „wyłączona”, nie cała doba", () => {
  assert.equal(A.ustawieniaAuto({ tryb: "nocc", okno: "3-5", dojrzaloscGodz: 6, kanarek: "" }).tryb, "wylaczona");
  assert.deepEqual(A.ustawieniaAuto({ tryb: "noc", okno: "23-2", dojrzaloscGodz: 6, kanarek: "" }).okno, { od: 23, do: 2 });
});

/* ── Takt: od decyzji do zlecenia ─────────────────────────────────────── */

const WYDANIA = [{ tag_name: "v9.1.0", published_at: "2026-09-24T01:00:00Z",
  assets: [{ name: "wertis-9.1.0.zip" }, { name: "wertis-9.1.0.zip.sha256" }] },
  { tag_name: "v9.2.0", published_at: "2026-09-24T02:00:00Z", prerelease: true,
    assets: [{ name: "wertis-9.2.0.zip" }, { name: "wertis-9.2.0.zip.sha256" }] }];
const pobierz = async (url: string) => ({ ok: true, status: 200,
  text: async () => (url.includes("api.github.com") ? JSON.stringify(WYDANIA) : "## 9.1.0 — x\n\nNowe.\n") });

beforeEach(() => {
  S._wyczyscPamiec(); S.ustawUruchamiacz(null); A._wyczyscAuto();
  fs.rmSync(path.join(dir, "aktualizacja"), { recursive: true, force: true });
});

test("takt bez uruchamiacza (poza NSSM) nic nie robi i nie pyta sieci", async () => {
  assert.equal(await A.taktAuto(NOC), null);
});

test("takt w nocy zleca, loguje i nie powtarza; wycofane (pre-release) pomija", async () => {
  await S.sprawdzWydania(pobierz, undefined, NOC);
  const wolane: string[] = [];
  S.ustawUruchamiacz(async (n) => { wolane.push(n); });
  const d = await A.taktAuto(NOC);
  assert.equal(d?.kandydat, "9.1.0", "wycofane 9.2.0 nie może być kandydatem");
  assert.equal(d?.teraz, true);
  assert.deepEqual(wolane, ["WERTIS aktualizacja"]);
  const z = JSON.parse(fs.readFileSync(path.join(dir, "aktualizacja", "zlecenie.json"), "utf8"));
  assert.deepEqual([z.wersja, z.kto], ["9.1.0", "automat"]);
  const { db } = await import("../db/db.js");
  const wpis = db().prepare("SELECT payload FROM events WHERE type = 'aktualizacja_automatyczna' ORDER BY id DESC")
    .get() as { payload: string };
  assert.equal(JSON.parse(wpis.payload).na, "9.1.0");
  /* Następny takt: zlecenie czeka, więc trwa — drugiego nie ma. */
  const drugi = await A.taktAuto(new Date(Date.parse(NOC) + 5 * 60_000).toISOString());
  assert.equal(drugi?.teraz, false);
  assert.equal(drugi?.powod, "Aktualizacja właśnie trwa.");
  assert.deepEqual(wolane, ["WERTIS aktualizacja"]);
});

test("takt: zadanie, które nie ruszyło, nie wraca co pięć minut", async () => {
  await S.sprawdzWydania(pobierz, undefined, NOC);
  let wolan = 0;
  S.ustawUruchamiacz(async () => { wolan++; throw new Error("brak zadania"); });
  await assert.rejects(() => A.taktAuto(NOC), /-Aktualizuj/);
  const d = await A.taktAuto(new Date(Date.parse(NOC) + 5 * 60_000).toISOString());
  assert.equal(d?.teraz, false);
  assert.match(d?.powod ?? "", /nie ruszyło/);
  assert.equal(wolan, 1);
});

test("kanarek: /api/health z wersją; błąd i brak wersji to milczenie", async () => {
  const f = (odp: unknown, ok = true) => (async () => ({ ok, json: async () => odp })) as unknown as typeof fetch;
  assert.equal(await A.wersjaKanarka("http://dev:3002/", f({ wersja: "0.493.0" })), "0.493.0");
  assert.equal(await A.wersjaKanarka("http://dev:3002", f({}, true)), null);
  assert.equal(await A.wersjaKanarka("http://dev:3002", f({ wersja: "x" }, false)), null);
  assert.equal(await A.wersjaKanarka("http://dev:3002", (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch), null);
});
