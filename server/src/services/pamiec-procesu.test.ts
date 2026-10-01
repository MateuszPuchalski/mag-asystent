import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  MAKS_PROBEK,
  MIN_PROBEK_DO_TRENDU,
  liniaLogu,
  stanPamieci,
  trendDna,
  wyczyscProbkiDlaTestow,
  zapiszProbke,
  type OdczytPamieci,
  type Probka,
} from "./pamiec-procesu.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pamiec-")), "t.db");
process.env.LOG_LEVEL = "silent";

/* Pamięć procesu ma odpowiadać na jedno pytanie: czy DNO rośnie. Testy
   przybijają trzy rzeczy, od których zależy wiarygodność odpowiedzi: szczyt
   nie jest trendem, wolny stały wzrost dna jest, a niewystarczająca liczba
   próbek nie daje wniosku zamiast wniosku fałszywego. */

const GODZINA = 3_600_000;
const T0 = Date.parse("2026-10-01T00:00:00.000Z");

/** Próbki co godzinę z podanych odczytów procesu w MB. */
function serie(rssMb: number[]): Probka[] {
  return rssMb.map((r, i) => ({ at: new Date(T0 + i * GODZINA).toISOString(), rssMb: r, stertaMb: Math.round(r / 3) }));
}

const odczyt = (rssMb: number): OdczytPamieci => ({
  rss: rssMb * 1024 * 1024,
  heapUsed: Math.round(rssMb / 3) * 1024 * 1024,
  external: 8 * 1024 * 1024,
  heapLimit: 4096 * 1024 * 1024,
});

beforeEach(() => wyczyscProbkiDlaTestow());

test("poniżej sześciu próbek nie ma trendu, bo dno z trzech odczytów nic nie mówi", () => {
  assert.equal(trendDna(serie([400, 500, 450, 480, 520])), null);
  assert.equal(MIN_PROBEK_DO_TRENDU, 6);
});

test("falowanie wokół jednej wartości nie jest wzrostem, nawet gdy ostatni odczyt jest szczytem", () => {
  /* Piła z odświeżaniem read-modelu: dno ~400, szczyty do 620. Ostatni odczyt
     jest najwyższy w oknie, a mimo to dno stoi w miejscu. */
  const t = trendDna(serie([400, 560, 410, 600, 405, 580, 402, 620]));
  assert.ok(t);
  assert.equal(t.dnoStarszejPolowyMb, 400);
  assert.equal(t.dnoMlodszejPolowyMb, 402);
  assert.equal(t.rosnie, false);
});

test("stały wzrost dna jest wzrostem, także gdy szczyty falują", () => {
  const t = trendDna(serie([400, 520, 430, 560, 470, 600, 510, 640, 550, 690]));
  assert.ok(t);
  assert.equal(t.dnoStarszejPolowyMb, 400);
  assert.equal(t.dnoMlodszejPolowyMb, 510);
  assert.equal(t.wzrostMb, 110);
  assert.equal(t.rosnie, true);
  assert.ok(t.wzrostNaGodzineMb >= 10, `tempo ${t.wzrostNaGodzineMb}`);
});

test("wzrost mniejszy niż 100 MB mieści się w szumie", () => {
  const t = trendDna(serie([400, 410, 420, 430, 440, 450, 460, 470]));
  assert.ok(t);
  assert.equal(t.wzrostMb, 40);
  assert.equal(t.rosnie, false);
});

test("wzrost wolniejszy niż 10 MB na godzinę nie jest alarmem, choć suma jest duża", () => {
  /* 48 próbek, dno rośnie o 120 MB między połówkami okna, czyli 5 MB/h. Przy
     limicie sterty rzędu gigabajtów to miesiące do kłopotu, nie dni. */
  const rss = Array.from({ length: 48 }, (_, i) => 400 + i * 5);
  const t = trendDna(serie(rss));
  assert.ok(t);
  assert.ok(t.wzrostMb >= 100, `wzrost ${t.wzrostMb}`);
  assert.ok(t.wzrostNaGodzineMb < 10, `tempo ${t.wzrostNaGodzineMb}`);
  assert.equal(t.rosnie, false);
});

test("spadek dna nie jest wzrostem (po restarcie usługi okno zaczyna się od nowa)", () => {
  const t = trendDna(serie([700, 690, 680, 500, 480, 470]));
  assert.ok(t);
  assert.ok(t.wzrostMb < 0);
  assert.equal(t.rosnie, false);
});

test("dwa dna z tej samej chwili nie dają tempa ani dzielenia przez zero", () => {
  const p = serie([400, 410, 420, 430, 440, 450]).map((x) => ({ ...x, at: new Date(T0).toISOString() }));
  assert.equal(trendDna(p), null);
});

test("okno trzyma ostatnie dwie doby, starsze próbki odpadają", () => {
  for (let i = 0; i < MAKS_PROBEK + 10; i++) zapiszProbke(new Date(T0 + i * GODZINA), odczyt(400 + i));
  const s = stanPamieci(odczyt(500), T0);
  assert.equal(s.probek, MAKS_PROBEK);
  /* Dno starszej połowy to NAJSTARSZA zachowana próbka, nie pierwsza zapisana:
     dziesięć pierwszych odpadło. */
  assert.equal(s.trend?.dnoStarszejPolowyMb, 410);
});

test("stan niesie zaokrąglone megabajty, limit sterty i brak trendu przy świeżym starcie", () => {
  const s = stanPamieci(odczyt(534), Date.now());
  assert.equal(s.rssMb, 534);
  assert.equal(s.stertaMb, 178);
  assert.equal(s.limitSteryMb, 4096);
  assert.equal(s.zewnetrznaMb, 8);
  assert.equal(s.probek, 0);
  assert.equal(s.trend, null);
});

test("linia logu ma stały początek, po którym szuka się osi czasu", () => {
  const p = zapiszProbke(new Date(T0), odczyt(534));
  const linia = liniaLogu(p, odczyt(534));
  assert.equal(linia, "[pamiec] proces 534 MB, sterta 178 z 4096 MB");
});

/* ── Trasa zdrowia ───────────────────────────────────────────────────────── */

let app: FastifyInstance;

before(async () => {
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

test("/api/health niesie blok pamięci, a trend nie wchodzi do problemów", async () => {
  /* Zdrowie służy instalatorowi do decyzji o wycofaniu wydania. Blok pamięci
     ma być daną; gdyby jego trend dopisywał zdanie do `problemy`, wolny
     wzrost pamięci mógłby cofnąć aktualizację. */
  for (let i = 0; i < 10; i++) zapiszProbke(new Date(T0 + i * GODZINA), odczyt(400 + i * 40));
  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.equal(typeof h.pamiec.rssMb, "number");
  assert.ok(h.pamiec.rssMb > 0);
  assert.ok(h.pamiec.limitSteryMb > 0);
  assert.equal(h.pamiec.probek, 10);
  assert.equal(h.pamiec.trend.rosnie, true);
  const zdania: string[] = h.problemy ?? [];
  assert.ok(!zdania.some((z) => /pami[ęe]ć/i.test(z)), `pamięć w problemach: ${zdania.join(" | ")}`);
});
