import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  kartaSprawy, odsiejBezPokrycia, ponumerujRozmowe, pustaKarta, rozpoznajSprawe,
  sugerujeWerdykt, type OdpowiedzRozpoznania,
} from "./copilot-reklamacja.js";

/* ── Copilot reklamacyjny (0.275.0) ──────────────────────────────────────────
   Trzy bramki, z których dwie są deterministyczne i dlatego w ogóle warte
   zaufania:

   1. MASZYNA NIE DOTYKA WERDYKTU. Uznanie i odrzucenie są nieodwracalne wobec
      kupującego, więc karta z sugestią rozstrzygnięcia leci w całości — i robi
      to kod, nie prompt. Prompt jest prośbą; bramka jest regułą.
   2. KAŻDE ZDANIE MA CYTAT. Pole z numerem wiadomości, której nie ma w tej
      rozmowie, znika przed zapisem.
   3. WYWOŁANIE ZOSTAWIA ŚLAD, także nieudane. Próba, która nie doszła, też
      bywa płatna, a brak wiersza gubiłby tę część rachunku.                 */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','Ala','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,kupujacy_login,otwarto_at,synced_at)
    VALUES (?,'i-1','kupujacy1','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto).lastInsertRowid);
  const wiadomosc = (n: number, rola: string, tresc: string) =>
    d.prepare(`INSERT INTO reklamacja_wiadomosc
      (reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
      VALUES (?,?,?,?,?)`).run(id, `w-${n}`, rola, tresc, `2026-09-0${n}T10:00:00Z`);
  wiadomosc(1, "BUYER", "Kosiarka przestała ciąć po tygodniu, proszę o wymianę");
  wiadomosc(2, "SELLER", "Proszę o zdjęcie noża");
  return { d, id };
}

const KTO = { id: 1, name: "Ala" };
const ZUZYCIE = { wej: 100, wyj: 50, cacheZapis: 0, cacheOdczyt: 0 };

const karta = (n: Partial<OdpowiedzRozpoznania> = {}): OdpowiedzRozpoznania => ({
  usterka: { tresc: "Kosiarka przestała ciąć", zrodlo: "W1" },
  kiedy: { tresc: "po tygodniu używania", zrodlo: "W1" },
  oczekiwanie: { tresc: "wymiana", zrodlo: "W1" },
  dowody: [],
  brakuje: ["zdjęcie noża", "data zakupu"],
  model: "claude-test", zuzycie: ZUZYCIE, ms: 120, ...n,
});

test("rozmowa idzie do modelu PONUMEROWANA, żeby dało się sprawdzić cytaty", () => {
  const { watek, numery } = ponumerujRozmowe([
    { odKlienta: true, tresc: "nie działa" },
    { odKlienta: false, tresc: "proszę o zdjęcie" },
  ]);
  assert.equal(watek[0].tresc, "[W1] nie działa");
  assert.equal(watek[1].tresc, "[W2] proszę o zdjęcie");
  assert.deepEqual([...numery], ["W1", "W2"]);
});

test("słowa werdyktu rozpoznajemy niezależnie od wielkości liter i odmiany", () => {
  assert.equal(sugerujeWerdykt("Reklamacja wygląda na zasadną"), true);
  assert.equal(sugerujeWerdykt("Proponuję uznać"), true);
  assert.equal(sugerujeWerdykt("ODRZUCIĆ"), true);
  assert.equal(sugerujeWerdykt("Brakuje zdjęcia tabliczki znamionowej"), false);
  assert.equal(sugerujeWerdykt("Klient chce wymiany towaru"), false);
});

test("pole z cytatem spoza rozmowy ZNIKA, a reszta karty zostaje", () => {
  /* Inaczej niż przy szkicu, gdzie wymyślony numer kasuje wszystko: tam liczba
     wchodzi do zdania wysyłanego kupującemu, tutaj karta jest notatką dla
     agenta, który ma rozmowę przed oczami. */
  const { karta: k, odsiano } = odsiejBezPokrycia(karta({
    kiedy: { tresc: "w marcu", zrodlo: "W9" },
    dowody: [{ tresc: "zdjęcie", zrodlo: "W1" }, { tresc: "paragon", zrodlo: "W7" }],
  }), new Set(["W1", "W2"]));

  assert.equal(k.kiedy, null, "cytat spoza rozmowy nie przechodzi");
  assert.ok(k.usterka, "reszta karty zostaje");
  assert.deepEqual(k.dowody.map((x) => x.tresc), ["zdjęcie"]);
  assert.equal(odsiano, 2);
  /* `brakuje` nie ma cytatu z natury rzeczy — mówi o tym, czego w rozmowie NIE MA. */
  assert.deepEqual(k.brakuje, ["zdjęcie noża", "data zakupu"]);
});

test("karta bez ani jednego pokrycia jest pusta i nie ma po co iść na ekran", () => {
  const { karta: k } = odsiejBezPokrycia({
    usterka: { tresc: "x", zrodlo: "W9" }, kiedy: null, oczekiwanie: null,
    dowody: [], brakuje: [],
  }, new Set(["W1"]));
  assert.equal(pustaKarta(k), true);
});

test("sugestia werdyktu ODRZUCA kartę w całości i zostawia ślad w księdze", async () => {
  const { d, id } = stanowisko();
  await assert.rejects(() => rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ brakuje: ["nic — proponuję uznać reklamację"] }),
  }), /podpowiedzieć rozstrzygnięcie/);

  assert.equal(kartaSprawy(d, id), null, "odrzucona karta nie zapisuje się wcale");
  const w = d.prepare(
    "SELECT wynik, blad FROM copilot_wywolanie WHERE zadanie='rozpoznanie_reklamacji'")
    .get() as { wynik: string; blad: string };
  assert.equal(w.wynik, "blad");
  assert.match(w.blad, /sugestia werdyktu/);
});

test("udane rozpoznanie zapisuje kartę, księgę i ślad BEZ treści", async () => {
  const { d, id } = stanowisko();
  const k = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d, nadaj: async () => karta(),
  });

  assert.equal(k.usterka?.tresc, "Kosiarka przestała ciąć");
  const zapisana = kartaSprawy(d, id)!;
  assert.equal(zapisana.oczekiwanie?.tresc, "wymiana");
  assert.deepEqual(zapisana.brakuje, ["zdjęcie noża", "data zakupu"]);
  assert.equal(zapisana.przez, "Ala");

  const ksiega = d.prepare(
    "SELECT wynik, model, tokeny_wej, reklamacja_id FROM copilot_wywolanie").get() as
    Record<string, unknown>;
  assert.equal(ksiega.wynik, "ok");
  assert.equal(ksiega.model, "claude-test");
  assert.equal(Number(ksiega.tokeny_wej), 100);
  assert.equal(Number(ksiega.reklamacja_id), id, "księga wie, o którą sprawę chodziło");

  /* Dziennik niesie LICZBY, nigdy słów klienta — `events` nie ma retencji. */
  const zdarzenie = d.prepare(
    "SELECT payload FROM events WHERE type='reklamacja_rozpoznanie'").get() as
    { payload: string };
  assert.ok(!zdarzenie.payload.includes("Kosiarka"), "treść karty nie idzie do dziennika");
  assert.equal(JSON.parse(zdarzenie.payload).brakuje, 2);
});

test("ponowne rozpoznanie NADPISUJE kartę, zamiast mnożyć wiersze", async () => {
  const { d, id } = stanowisko();
  await rozpoznajSprawe({ reklamacjaId: id, kto: KTO, database: d, nadaj: async () => karta() });
  await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ oczekiwanie: { tresc: "zwrot pieniędzy", zrodlo: "W1" } }),
  });
  assert.equal(kartaSprawy(d, id)!.oczekiwanie?.tresc, "zwrot pieniędzy");
  const ile = d.prepare("SELECT count(*) n FROM reklamacja_karta").get() as { n: number };
  assert.equal(Number(ile.n), 1);
});

test("sprawa bez rozmowy mówi to zdaniem i nie płaci za nic", async () => {
  const { d } = stanowisko();
  const pusta = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,otwarto_at,synced_at)
    VALUES (1,'i-2','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`).run().lastInsertRowid);
  let strzalow = 0;
  await assert.rejects(() => rozpoznajSprawe({
    reklamacjaId: pusta, kto: KTO, database: d,
    nadaj: async () => { strzalow += 1; return karta(); },
  }), /nie ma jeszcze rozmowy/);
  assert.equal(strzalow, 0, "brak rozmowy rozstrzyga się u nas, nie u dostawcy");
});
