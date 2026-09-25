import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-narzedzia-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Narzędzia Copilota (@wydanie) ───────────────────────────────────────────
   Model wybiera wywołania sam, więc granice pilnuje KOD, nie instrukcja:

   1. Zero zapisu. Żadne narzędzie nie zmienia ani jednego wiersza.
   2. Zero sieci. Allegro odcina za serie z jednego adresu, a model decyduje,
      ile razy sięgnie po treść oferty — więc treść idzie z kopii w bazie.
   3. Półka nie wychodzi (§10.4), choć karta towaru ją niesie.
   4. Propozycja jest opisana jako propozycja i niesie znacznik WP, zatwierdzone
      zastosowanie — WZ. Na tym stoi sufit pewności po stronie serwera.    */

let db: typeof import("../db/db.js").db;
let N: typeof import("./copilot-narzedzia.js");
let W: typeof import("./wiedza.js");
let subiekt: typeof import("../context.js").subiekt;
let biuro = 0;

const GAZNIK = 701;
const FILTR = 702;
const MS250 = { rodzaj: "maszyna" as const, marka: "Stihl", nazwa: "MS 250" };
const MS230 = { rodzaj: "maszyna" as const, marka: "Stihl", nazwa: "MS 230" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ subiekt } = await import("../context.js"));
  N = await import("./copilot-narzedzia.js");
  W = await import("./wiedza.js");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis,lokalizacja) VALUES (?,?,?,?,?,?)")
    .run(GAZNIK, "GAZ-MS250", "Gaźnik Stihl MS 250", "5900000000017", "OEM: 1123 120 0650", "R-07-3");
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis,lokalizacja) VALUES (?,?,?,?,?,?)")
    .run(FILTR, "FIL-GX160", "Filtr powietrza Honda GX160", "", "", "R-01-1");
  d.prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,at)
    VALUES (?,?,?,?,?,?,?,?)`).run(GAZNIK, "GAZ-MS250", "oem", "1123 120 0650", "11231200650", "opis", "import",
    "2026-09-01T00:00:00Z");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "model_urzadzenia", "offer_snapshot",
    "oferta_kartoteka", "events", "app_user", "channel_account"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. L.','biuro')").run().lastInsertRowid);
});

const wykonaj = (nazwa: string, zapytanie: string) => N.zestawNarzedzi(subiekt).wykonaj(nazwa, { zapytanie });

/** Liczba wierszy we WSZYSTKICH tabelach — odcisk stanu bazy. */
function odcisk(): string {
  const d = db();
  const tabele = (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>).map((t) => t.name);
  return tabele.map((t) => `${t}:${(d.prepare(`SELECT count(*) n FROM "${t}"`).get() as { n: number }).n}`).join(",");
}

function zastosowania() {
  const pewne = W.zaproponujZastosowanie({
    twId: GAZNIK, model: MS230, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "producent", tresc: "katalog Stihl 2019" },
  }, { userId: biuro, name: "A. L." })!;
  W.rozstrzygnijZastosowanie(pewne.id, "zatwierdz", null, biuro);
  const propozycja = W.zaproponujZastosowanie({
    twId: GAZNIK, model: MS250, polaryzacja: "pasuje", zrodlo: "copilot",
    dowod: { rodzaj: "katalog_dostawcy", tresc: "lista części", link: "https://example.com/ms250" },
  }, { automat: "siec" })!;
  return { pewne, propozycja };
}

test("żadne narzędzie nie zapisuje i nie woła sieci", () => {
  zastosowania();
  const przed = odcisk();
  const fetchBylo = globalThis.fetch;
  let zawolano = 0;
  globalThis.fetch = (async () => { zawolano += 1; throw new Error("sieć zakazana"); }) as typeof fetch;
  try {
    for (const d of N.DEFINICJE) {
      for (const q of ["GAZ-MS250", "Stihl MS 250", "1123 120 0650", "nic-takiego"]) {
        const w = N.zestawNarzedzi(subiekt).wykonaj(d.name, { zapytanie: q });
        assert.ok(!String(w.wynik).includes("wywróciło"), `${d.name}(${q}) wywróciło się: ${w.wynik}`);
      }
    }
  } finally {
    globalThis.fetch = fetchBylo;
  }
  assert.equal(zawolano, 0, "narzędzie sięgnęło do sieci");
  assert.equal(odcisk(), przed, "narzędzie coś zapisało");
});

test("szukanie po numerze OEM znajduje kartotekę, a karta nie zdradza półki", () => {
  const s = String(wykonaj("szukaj_towaru", "1123 120 0650").wynik);
  assert.ok(s.includes("GAZ-MS250"), s);
  const k = String(wykonaj("karta_towaru", "GAZ-MS250").wynik);
  assert.ok(k.includes("1123 120 0650"), "numer OEM stoi na karcie");
  assert.ok(!k.includes("R-07-3"), "adres regału nie wychodzi do modelu (§10.4)");
});

test("pasowanie odróżnia zatwierdzone (WZ) od propozycji (WP) i podaje źródło propozycji", () => {
  const { pewne, propozycja } = zastosowania();
  const p = String(wykonaj("pasowanie_towaru", "GAZ-MS250").wynik);
  assert.ok(p.includes(`[WZ${pewne.id}]`), p);
  assert.ok(p.includes(`[WP${propozycja.id}]`), p);
  assert.ok(p.includes("NIEZATWIERDZONE"), "propozycja mówi o sobie wprost");
  assert.ok(p.includes("https://example.com/ms250"), "agent ma móc kliknąć źródło");
});

test("części do maszyny: kierunek odwrotny, tylko zatwierdzone, a „brak” to „nie wiemy”", () => {
  const { pewne } = zastosowania();
  const m = String(wykonaj("czesci_do_maszyny", "MS 230").wynik);
  assert.ok(m.includes(`WZ${pewne.id}`) && m.includes("GAZ-MS250"), m);
  const nic = String(wykonaj("czesci_do_maszyny", "Husqvarna 135").wynik);
  assert.ok(nic.includes("nie wiemy"), nic);
});

test("treść oferty idzie z kopii w bazie, przez powiązanie oferty z kartoteką", () => {
  const d = db();
  const konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at,opis,pasuje_do_json,tresc_synced_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(konto, "777", "Gaźnik do Stihl", "INNY-SKU", "2026-09-01T00:00:00Z",
    "Gaźnik zamiennik.", JSON.stringify(["Stihl MS 250", "Stihl MS 230"]), "2026-09-01T00:00:00Z");
  d.prepare(`INSERT INTO oferta_kartoteka(channel_account_id,offer_id,tw_id,tw_symbol,wskazano_at,wskazano_przez)
    VALUES (?,?,?,?,?,?)`).run(konto, "777", GAZNIK, "GAZ-MS250", "2026-09-01T00:00:00Z", "test");
  const t = String(wykonaj("tresc_oferty", "GAZ-MS250").wynik);
  assert.ok(t.includes("Stihl MS 250 | Stihl MS 230"), t);
  assert.ok(String(wykonaj("tresc_oferty", "FIL-GX160").wynik).includes("Nie mamy w bazie oferty"));
});

test("zły symbol, puste zapytanie i nieznane narzędzie wracają do modelu jako błąd, nie wyjątek", () => {
  assert.ok(String(wykonaj("karta_towaru", "XX-NIE-MA").wynik).includes("szukaj_towaru"),
    "zły symbol podpowiada właściwe narzędzie");
  assert.equal(wykonaj("karta_towaru", "   ").blad, true);
  assert.equal(wykonaj("kasuj_wszystko", "GAZ-MS250").blad, true);
});

test("sufit pewności: WP w odwołaniu schodzi do „niepewne”, reszta zostaje", () => {
  const [a, b, c] = N.naPropozycjiNiepewne<{ odwolanie: string | null; pewnosc: string; obnizona?: boolean }>([
    { odwolanie: "WP12", pewnosc: "pewne" },
    { odwolanie: "WZ12", pewnosc: "pewne" },
    { odwolanie: null, pewnosc: "prawdopodobne" },
  ]);
  assert.deepEqual([a!.pewnosc, a!.obnizona], ["niepewne", true]);
  assert.equal(b!.pewnosc, "pewne");
  assert.equal(c!.pewnosc, "prawdopodobne");
});
