import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-siec-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Pasowanie z sieci (0.507.0) ────────────────────────────────────────────
   Właściciel: „bądź ostrożny, nie chcę dostać bana na Allegro. Z innych stron
   możesz ściągnąć". Testy pilnują czterech granic:

   1. ALLEGRO. Moduł nie importuje adaptera Allegro, a znalezisko z domeny
      Allegro odpada na sicie, nawet gdyby wyszukiwarka je przepuściła.
   2. SITO. Cytat musi stać na przeczytanej stronie, model w cytacie, a nasz
      numer na stronie. Zmyślony cytat z prawdziwym linkiem nie przechodzi.
   3. NIC SAMO SIĘ NIE ZATWIERDZA. Automat składa propozycje, człowiek decyduje.
   4. KOSZT. Sufit na noc liczy się z księgi, a kartoteka nie wraca co noc.  */

let db: typeof import("../db/db.js").db;
let S: typeof import("./pasowanie-z-sieci.js");
let BladLimituCopilota: typeof import("../adapters/copilot.js").BladLimituCopilota;

const GAZNIK = 801;
const BEZ_NUMERU = 802;
const ZNANY = 803;
const TERAZ = new Date("2026-09-25T02:00:00Z");
const STRONA = "https://czesci.example.com/stihl/1123-120-0650";
const TEKST = "Gaźnik Zama C1Q-S126. Nr oryginalny 1123 120 0650. Pasuje do: Stihl MS 250, MS 230, 025.";

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./pasowanie-z-sieci.js");
  ({ BladLimituCopilota } = await import("../adapters/copilot.js"));
  const d = db();
  const tw = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)");
  tw.run(GAZNIK, "GAZ-MS250", "Gaźnik Stihl");
  tw.run(BEZ_NUMERU, "NOZ-46", "Nóż kosiarki 46 cm");
  tw.run(ZNANY, "FIL-GX160", "Filtr Honda");
  const id = d.prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,at)
    VALUES (?,?,?,?,?,'opis','import','2026-09-01T00:00:00Z')`);
  id.run(GAZNIK, "GAZ-MS250", "oem", "1123 120 0650", "11231200650");
  id.run(ZNANY, "FIL-GX160", "nr_oryg", "17211-ZE1-517", "17211ze1517");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "model_urzadzenia", "pasowanie_siec",
    "copilot_wywolanie", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  /* Kartoteka ZNANY ma już żywe zastosowanie — automat uzupełnia luki,
     nie dokłada drugiego zdania tam, gdzie pierwsze stoi. */
  const model = Number(d.prepare(`INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
    VALUES ('silnik','Honda','GX160','silnik|hondagx160','test')`).run().lastInsertRowid);
  d.prepare(`INSERT INTO zastosowanie(tw_id,tw_symbol,model_id,polaryzacja,stan,zrodlo_propozycji,zaproponowal)
    VALUES (?,?,?,'pasuje','zatwierdzone','reczne','test')`).run(ZNANY, "FIL-GX160", model);
});

const znalezisko = (n: Partial<import("./pasowanie-z-sieci.js").ZnaleziskoSurowe> = {}) => ({
  rodzaj: "maszyna" as const, marka: "Stihl", model: "MS 250", wariant: null,
  url: STRONA, cytat: "Pasuje do: Stihl MS 250, MS 230", zrodloStrony: "katalog_dostawcy" as const, ...n,
});
const STRONY = [{ url: STRONA, tekst: TEKST }];
const NUMERY = ["1123 120 0650"];

test("sito przepuszcza znalezisko z przeczytanej strony, z cytatem, modelem i naszym numerem", () => {
  assert.equal(S.sprawdzZnalezisko(znalezisko(), STRONY, NUMERY), null);
  assert.equal(S.sprawdzZnalezisko(znalezisko({ url: `${STRONA}/#tabela` }), STRONY, NUMERY), null,
    "kotwica i ukośnik nie robią z tej samej strony innej");
});

test("sito odrzuca każde znalezisko, które nie stoi na stronie", () => {
  const przypadki: Array<[Partial<import("./pasowanie-z-sieci.js").ZnaleziskoSurowe>, string]> = [
    [{ url: "ftp://x" }, "zly_adres"],
    [{ url: "https://allegro.pl/oferta/123" }, "allegro"],
    [{ url: "https://czesci.allegro.pl/x" }, "allegro"],
    [{ url: "https://inna.example.com/x" }, "strona_nieprzeczytana"],
    [{ cytat: "Pasuje do: Stihl MS 260" }, "cytat_spoza_strony"],
    [{ model: "MS 230", cytat: "Nr oryginalny 1123 120 0650" }, "model_spoza_cytatu"],
    [{ model: "25", cytat: "MS 250, MS 230, 025" }, "za_krotki_model"],
    [{ marka: "Husqvarna" }, "marka_spoza_strony"],
  ];
  for (const [n, powod] of przypadki) {
    assert.equal(S.sprawdzZnalezisko(znalezisko(n), STRONY, NUMERY), powod, JSON.stringify(n));
  }
  assert.equal(S.sprawdzZnalezisko(znalezisko(), STRONY, ["9999 999 9999"]), "numer_spoza_strony",
    "strona bez naszego numeru mówi o innej części");
});

test("Allegro rozpoznaje się po domenie i każdej subdomenie, a nie po podobnej nazwie", () => {
  for (const h of ["allegro.pl", "ALLEGRO.PL", "www.allegro.pl", "a.allegroimg.com", "allegrolokalnie.pl"]) {
    assert.equal(S.czyAllegro(h), true, h);
  }
  assert.equal(S.czyAllegro("notallegro.pl"), false);
});

test("moduł nie sięga do Allegro — ani importem, ani żądaniem", () => {
  const tu = path.dirname(fileURLToPath(import.meta.url));
  const zrodlo = fs.readFileSync(path.join(tu, "pasowanie-z-sieci.ts"), "utf8");
  const importy = [...zrodlo.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(importy.every((i) => !/allegro/i.test(i)), `import Allegro: ${importy.join(", ")}`);
  assert.ok(!/\bfetch\s*\(/.test(zrodlo), "automat nie woła sieci sam — robią to serwery Anthropic");
});

test("kandydaci: tylko z numerem, tylko bez żywego zastosowania, i nie co noc ta sama", () => {
  assert.deepEqual(S.kandydaciDoSieci(10, TERAZ).map((k) => k.symbol), ["GAZ-MS250"]);
  db().prepare(`INSERT INTO pasowanie_siec(tw_id,at,wynik) VALUES (?,?,'ok')`)
    .run(GAZNIK, "2026-08-01T00:00:00Z");
  assert.deepEqual(S.kandydaciDoSieci(10, TERAZ), [], "sprawdzona niedawno wraca dopiero po 90 dniach");
  assert.deepEqual(S.kandydaciDoSieci(10, new Date("2026-11-15T02:00:00Z")).map((k) => k.symbol), ["GAZ-MS250"]);
});

test("błąd dostawcy nie wyłącza kartoteki na kwartał — wraca po tygodniu", () => {
  db().prepare(`INSERT INTO pasowanie_siec(tw_id,at,wynik,blad) VALUES (?,?,'blad','przeciążenie')`)
    .run(GAZNIK, "2026-09-20T02:00:00Z");
  assert.deepEqual(S.kandydaciDoSieci(10, TERAZ), [], "pięć dni po błędzie jeszcze czeka");
  assert.deepEqual(S.kandydaciDoSieci(10, new Date("2026-09-28T02:00:00Z")).map((k) => k.symbol), ["GAZ-MS250"]);
});

function nadawca(znaleziska = [znalezisko(), znalezisko({ model: "MS 260", cytat: "MS 260" })]) {
  const pytania: Array<import("./pasowanie-z-sieci.js").ZapytanieOPasowanie> = [];
  const nadaj: import("./pasowanie-z-sieci.js").NadawcaPasowaniaSieci = async (z) => {
    pytania.push(z);
    return {
      znaleziska, strony: STRONY, wyszukiwan: 2, model: "claude-opus-5",
      zuzycie: { wej: 5000, wyj: 400, cacheZapis: 0, cacheOdczyt: 1000, wyszukiwania: 2 }, ms: 30,
    };
  };
  return { nadaj, pytania };
}

test("przebieg: propozycja z linkiem trafia do kolejki, NIC się nie zatwierdza, sito liczy odrzuty", async () => {
  const n = nadawca();
  const w = await S.szukajPasowaniaWSieci({ nadaj: n.nadaj, naNoc: 10, teraz: () => TERAZ });

  assert.deepEqual(n.pytania, [{ symbol: "GAZ-MS250", nazwa: "Gaźnik Stihl", numery: ["1123 120 0650"] }]);
  assert.equal(w.sprawdzono, 1);
  assert.equal(w.zaproponowano, 1);
  assert.deepEqual(w.odrzucono, { cytat_spoza_strony: 1 }, "MS 260 nie stoi na stronie");

  const z = db().prepare(`SELECT z.stan, z.zrodlo_propozycji AS zrodlo, z.zaproponowal, m.marka, m.nazwa,
      d.rodzaj, d.link, d.tresc FROM zastosowanie z JOIN model_urzadzenia m ON m.id=z.model_id
      JOIN dowod_zastosowania d ON d.zastosowanie_id=z.id WHERE z.tw_id=?`).all(GAZNIK) as Array<Record<string, string>>;
  assert.equal(z.length, 1);
  assert.equal(z[0]!.stan, "propozycja", "automat nie zatwierdza — człowiek tak");
  assert.equal(z[0]!.zrodlo, "copilot");
  assert.equal(z[0]!.zaproponowal, "automat (siec)", "wpis automatu da się wylistować do prostowania");
  assert.deepEqual([z[0]!.marka, z[0]!.nazwa], ["Stihl", "MS 250"]);
  assert.equal(z[0]!.rodzaj, "katalog_dostawcy");
  assert.equal(z[0]!.link, STRONA);
  assert.ok(z[0]!.tresc.includes("Pasuje do: Stihl MS 250"));

  const k = db().prepare("SELECT zadanie, model, tokeny_wej, wyszukiwania, wynik FROM copilot_wywolanie").get() as
    Record<string, unknown>;
  assert.deepEqual({ ...k }, { zadanie: "pasowanie_siec", model: "claude-opus-5", tokeny_wej: 5000, wyszukiwania: 2, wynik: "ok" });
  const p = db().prepare("SELECT wynik, zaproponowano, odrzucone FROM pasowanie_siec").get() as Record<string, unknown>;
  assert.deepEqual({ ...p }, { wynik: "ok", zaproponowano: 1, odrzucone: JSON.stringify({ cytat_spoza_strony: 1 }) });
});

test("sufit na noc liczy się z księgi, więc restart serwera go nie zeruje", async () => {
  const wstaw = db().prepare(`INSERT INTO copilot_wywolanie(zadanie,model,wynik,at) VALUES ('pasowanie_siec','m','ok',?)`);
  wstaw.run("2026-09-25T00:30:00Z");
  wstaw.run("2026-09-25T01:30:00Z");
  const n = nadawca();
  const w = await S.szukajPasowaniaWSieci({ nadaj: n.nadaj, naNoc: 2, teraz: () => TERAZ });
  assert.equal(n.pytania.length, 0, "dwie kartoteki tej nocy już sprawdzono");
  assert.equal(w.sprawdzono, 0);
});

test("limit dostawcy zatrzymuje przebieg i zostawia ślad kosztu", async () => {
  const nadaj: import("./pasowanie-z-sieci.js").NadawcaPasowaniaSieci = async () => {
    throw Object.assign(new BladLimituCopilota("Anthropic poprosiło o przerwę (429).", 60_000),
      { zuzycie: { wej: 700, wyj: 0, cacheZapis: 0, cacheOdczyt: 0, wyszukiwania: 1 } });
  };
  const w = await S.szukajPasowaniaWSieci({ nadaj, naNoc: 10, teraz: () => TERAZ });
  assert.match(w.przerwane ?? "", /429/);
  const k = db().prepare("SELECT wynik, tokeny_wej, wyszukiwania FROM copilot_wywolanie").get() as Record<string, unknown>;
  assert.deepEqual({ ...k }, { wynik: "blad", tokeny_wej: 700, wyszukiwania: 1 });
  assert.equal((db().prepare("SELECT count(*) n FROM zastosowanie WHERE tw_id=?").get(GAZNIK) as { n: number }).n, 0);
});
