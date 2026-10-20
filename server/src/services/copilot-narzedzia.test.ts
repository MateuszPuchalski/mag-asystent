import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-narzedzia-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Narzędzia Copilota ─────────────────────────────────────────────────────
   Model wybiera wywołania sam, więc granice pilnuje KOD, nie instrukcja:

   1. Zero zapisu. Żadne narzędzie samo nie zmienia ani jednego wiersza.
   2. Sieć tylko przez wstrzyknięte zapytanie ofert po sygnaturze, wyłącznie
      w `oferty_towaru` i najwyżej raz na symbol. Allegro odcina za serie
      z jednego adresu, a model decyduje, ile razy sięgnie po narzędzie.
   3. Półka nie wychodzi (§10.4), choć karta towaru ją niesie.             */

let db: typeof import("../db/db.js").db;
let N: typeof import("./copilot-narzedzia.js");
let subiekt: typeof import("../context.js").subiekt;
type LinkDoOferty = import("./allegro-oferty-po-sygnaturze.js").LinkDoOferty;

const GAZNIK = 701;
const FILTR = 702;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ subiekt } = await import("../context.js"));
  N = await import("./copilot-narzedzia.js");
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis,lokalizacja) VALUES (?,?,?,?,?,?)")
    .run(GAZNIK, "GAZ-MS250", "Gaźnik Stihl MS 250", "5900000000017", "OEM: 1123 120 0650", "R-07-3");
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis,lokalizacja) VALUES (?,?,?,?,?,?)")
    .run(FILTR, "FIL-GX160", "Filtr powietrza Honda GX160", "", "", "R-01-1");
  d.prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,at)
    VALUES (?,?,?,?,?,?,?,?)`).run(GAZNIK, "GAZ-MS250", "oem", "1123 120 0650", "11231200650", "opis", "import",
    "2026-09-01T00:00:00Z");
  dodajLancuchy();
});

beforeEach(() => {
  const d = db();
  for (const t of ["offer_snapshot", "oferta_kartoteka", "events", "channel_account", "sgt_cena"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

/** Atrapa odczytu ofert Allegro: liczy pytania, a domyślnie nic nie znajduje. */
function atrapaOfert(odp: (symbole: readonly string[]) => Map<string, LinkDoOferty> = () => new Map()) {
  const pytania: string[][] = [];
  const ofertyPoSygnaturze = async (symbole: readonly string[]) => {
    pytania.push([...symbole]);
    return odp(symbole);
  };
  return { ofertyPoSygnaturze, pytania };
}

/* Każdy test idzie przez atrapę: żaden nie ma prawa strzelić do Allegro. */
const zestaw = (oferty = atrapaOfert()) => N.zestawNarzedzi(subiekt, db(), oferty);
const wykonaj = async (nazwa: string, zapytanie: string) => zestaw().wykonaj(nazwa, { zapytanie });
const tekst = async (nazwa: string, zapytanie: string) => String((await wykonaj(nazwa, zapytanie)).wynik);

/** Liczba wierszy we WSZYSTKICH tabelach — odcisk stanu bazy. */
function odcisk(): string {
  const d = db();
  const tabele = (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>).map((t) => t.name);
  return tabele.map((t) => `${t}:${(d.prepare(`SELECT count(*) n FROM "${t}"`).get() as { n: number }).n}`).join(",");
}

test("zestaw to wyłącznie odczyt towaru i ofert", async () => {
  assert.deepEqual(N.DEFINICJE.map((d) => d.name), ["szukaj_towaru", "karta_towaru", "tresc_oferty", "oferty_towaru"]);
});

test("żadne narzędzie nie zapisuje, a sieć idzie wyłącznie przez odczyt ofert", async () => {
  const przed = odcisk();
  const fetchBylo = globalThis.fetch;
  let zawolano = 0;
  globalThis.fetch = (async () => { zawolano += 1; throw new Error("sieć zakazana"); }) as typeof fetch;
  const oferty = atrapaOfert();
  try {
    for (const d of N.DEFINICJE) {
      for (const q of ["GAZ-MS250", "Stihl MS 250", "1123 120 0650", "nic-takiego"]) {
        const w = await zestaw(oferty).wykonaj(d.name, { zapytanie: q });
        assert.ok(!String(w.wynik).includes("wywróciło"), `${d.name}(${q}) wywróciło się: ${w.wynik}`);
      }
    }
  } finally {
    globalThis.fetch = fetchBylo;
  }
  assert.equal(zawolano, 0, "narzędzie sięgnęło do sieci obok wstrzykniętego odczytu");
  assert.deepEqual(oferty.pytania, [["GAZ-MS250"]], "pyta tylko oferty_towaru, o istniejący symbol i bez kopii");
  assert.equal(odcisk(), przed, "narzędzie coś zapisało");
});

test("szukanie po numerze OEM znajduje kartotekę, a karta nie zdradza półki", async () => {
  const s = await tekst("szukaj_towaru", "1123 120 0650");
  assert.ok(s.includes("GAZ-MS250"), s);
  const k = await tekst("karta_towaru", "GAZ-MS250");
  assert.ok(k.includes("1123 120 0650"), "numer OEM stoi na karcie");
  assert.ok(!k.includes("R-07-3"), "adres regału nie wychodzi do modelu (§10.4)");
});

test("treść oferty idzie z kopii w bazie, przez powiązanie oferty z kartoteką", async () => {
  const d = db();
  const konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at,opis,pasuje_do_json,tresc_synced_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(konto, "777", "Gaźnik do Stihl", "INNY-SKU", "2026-09-01T00:00:00Z",
    "Gaźnik zamiennik.", JSON.stringify(["Stihl MS 250", "Stihl MS 230"]), "2026-09-01T00:00:00Z");
  d.prepare(`INSERT INTO oferta_kartoteka(channel_account_id,offer_id,tw_id,tw_symbol,wskazano_at,wskazano_przez)
    VALUES (?,?,?,?,?,?)`).run(konto, "777", GAZNIK, "GAZ-MS250", "2026-09-01T00:00:00Z", "test");
  const t = await tekst("tresc_oferty", "GAZ-MS250");
  assert.ok(t.includes("Stihl MS 250 | Stihl MS 230"), t);
  assert.ok((await tekst("tresc_oferty", "FIL-GX160")).includes("Nie mamy w bazie oferty"));
});

test("zły symbol, puste zapytanie i nieznane narzędzie wracają do modelu jako błąd, nie wyjątek", async () => {
  assert.ok((await tekst("karta_towaru", "XX-NIE-MA")).includes("szukaj_towaru"),
    "zły symbol podpowiada właściwe narzędzie");
  assert.equal((await wykonaj("karta_towaru", "   ")).blad, true);
  assert.match(await tekst("szukaj_towaru", "ZZZ-NIC-TAKIEGO"), /Nie znaleźliśmy.*To nie znaczy, że takiej części nie ma/,
    "pusty wynik to brak wiedzy, nie „nie pasuje”");
  assert.equal((await wykonaj("kasuj_wszystko", "GAZ-MS250")).blad, true);
});

/* ── Ceny sprzedaży i nasze oferty ──────────────────────────────────────────
   Szkic dla klienta czyta te same narzędzia, więc wynik może dojść do klienta.
   Poziom 0 to cena zakupu: kwota 123,45 nie ma prawa stać w ŻADNYM wyniku. */

const ZAKUP = 12345;

function ofertaZeStatusem(konto: number, id: string, status: string, cena: number) {
  db().prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at,cena_grosze,waluta,status)
    VALUES (?,?,?,?,?,?,?,?)`).run(konto, id, `Gaźnik ${id}`, "GAZ-MS250", "2026-09-01T00:00:00Z", cena, "PLN", status);
}

function przygotujCenyIOferty(): void {
  const d = db();
  const cena = d.prepare("INSERT INTO sgt_cena(tw_id,poziom,nazwa,netto_grosze,brutto_grosze) VALUES (?,?,?,?,?)");
  cena.run(GAZNIK, 0, "zakupu", ZAKUP, ZAKUP);
  cena.run(GAZNIK, 1, "detaliczna", 7000, 8610);
  cena.run(GAZNIK, 2, "hurtowa", 0, 0);
  const konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  ofertaZeStatusem(konto, "9001", "ACTIVE", 8999);
  ofertaZeStatusem(konto, "9002", "ENDED", 7999);
}

test("karta towaru niesie cennik sprzedaży, bez poziomu zakupu i bez zerowych kwot", async () => {
  przygotujCenyIOferty();
  const k = await tekst("karta_towaru", "GAZ-MS250");
  assert.ok(k.includes("Cennik sklepu (kartoteka): detaliczna 86,10 zł brutto"), k);
  assert.ok(!k.includes("hurtowa"), "zerowa kwota to brak wiedzy, nie cena");
});

test("żadne narzędzie nie zdradza ceny zakupu (poziom 0)", async () => {
  przygotujCenyIOferty();
  for (const d of N.DEFINICJE) {
    for (const q of ["GAZ-MS250", "Stihl MS 250", "1123 120 0650"]) {
      const w = await tekst(d.name, q);
      for (const slad of ["123,45", "123.45", String(ZAKUP), "zakupu"]) {
        assert.ok(!w.includes(slad), `${d.name}(${q}) zdradza cenę zakupu: ${w}`);
      }
    }
  }
});

test("oferty_towaru z aktywną ofertą w kopii nie pyta Allegro", async () => {
  przygotujCenyIOferty();
  const oferty = atrapaOfert(() => { throw new Error("kopia wystarczyła, pytanie zbędne"); });
  const w = String((await zestaw(oferty).wykonaj("oferty_towaru", { zapytanie: "GAZ-MS250" })).wynik);
  assert.ok(w.includes("https://allegro.pl/oferta/9001"), w);
  assert.ok(w.includes("89,99 zł"), w);
  assert.ok(w.includes("stan z kopii z 2026-09-01"), "cena z kopii mówi, z kiedy jest");
  assert.ok(!w.includes("9002"), "zakończona oferta nie jest naszą aktywną aukcją");
  assert.equal(oferty.pytania.length, 0, "żadnego żądania, gdy kopia zna ofertę");
});

/* ── Link na żywo, gdy kopia nie zna oferty ──────────────────────────────────
   Przypadek łańcucha 11103: nasza aukcja istniała, ale nikt pod nią nie
   pisał, więc kopia jej nie znała, a szkic wyszedł bez linku. */

const LINK_FILTRA: LinkDoOferty = {
  symbol: "FIL-GX160", ofertaId: "17945046579", nazwa: "Filtr powietrza do Honda GX160",
  link: "https://allegro.pl/oferta/17945046579", cenaGrosze: 2490, waluta: "PLN",
};

test("oferty_towaru bez kopii pyta Allegro o sygnaturę i oddaje link z ceną", async () => {
  const oferty = atrapaOfert(() => new Map([["filgx160", LINK_FILTRA]]));
  const w = String((await zestaw(oferty).wykonaj("oferty_towaru", { zapytanie: "fil-gx160" })).wynik);
  assert.ok(w.includes("https://allegro.pl/oferta/17945046579"), w);
  assert.ok(w.includes("Filtr powietrza do Honda GX160"), w);
  assert.ok(w.includes("24,90 zł"), w);
  assert.ok(w.includes("stan z Allegro teraz"), "wynik mówi, skąd jest stan");
  assert.deepEqual(oferty.pytania, [["FIL-GX160"]], "w żądaniu sam symbol kartoteki, raz");
});

test("oferty_towaru: błąd Allegro to ten sam tekst co pusta kopia, nie wyjątek", async () => {
  const oferty = atrapaOfert(() => { throw new Error("429 Too Many Requests"); });
  const w = await zestaw(oferty).wykonaj("oferty_towaru", { zapytanie: "FIL-GX160" });
  assert.equal(w.blad, false);
  assert.equal(String(w.wynik), "W naszej kopii nie ma aktywnej oferty tego towaru. To nie znaczy, że jej nie ma.");
  const pusto = await zestaw(atrapaOfert()).wykonaj("oferty_towaru", { zapytanie: "FIL-GX160" });
  assert.equal(String(pusto.wynik), String(w.wynik));
});

test("oferty_towaru: ten sam symbol w jednym zestawie pyta Allegro raz", async () => {
  const oferty = atrapaOfert(() => new Map([["filgx160", LINK_FILTRA]]));
  const z = zestaw(oferty);
  const [a, b] = await Promise.all([
    z.wykonaj("oferty_towaru", { zapytanie: "FIL-GX160" }),
    z.wykonaj("oferty_towaru", { zapytanie: "fil-gx160" }),
  ]);
  const c = await z.wykonaj("oferty_towaru", { zapytanie: "FIL-GX160" });
  for (const w of [a, b, c]) assert.ok(String(w.wynik).includes("17945046579"), String(w.wynik));
  assert.equal(oferty.pytania.length, 1, "drugie i trzecie wywołanie z pamięci zestawu");
  await zestaw(oferty).wykonaj("oferty_towaru", { zapytanie: "FIL-GX160" });
  assert.equal(oferty.pytania.length, 2, "nowy zestaw, czyli nowy szkic, pyta od nowa");
});

/* ── Łańcuch do Stihl MS 231: zamiennik z opisu i podział zapisany różnie ────
   Dane jak w kartotece: MF381356 wskazuje w opisie „S11103”, a nasza
   kartoteka 11103 ma ten sam łańcuch z podziałem zapisanym „3/8lp”. */

const LANCUCH_56 = 711;
const LANCUCH_LP = 712;
const LANCUCH_50 = 713;
const PROWADNICA = 714;

function dodajLancuchy(): void {
  const d = db();
  const tw = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis,lokalizacja) VALUES (?,?,?,?,?,?)");
  tw.run(LANCUCH_56, "MF381356", "Łańcuch do piły 16'' 56og 3/8'' 1,3mm do Partner", "5907580156354",
    "G74040 // S11103", "H01-01");
  tw.run(LANCUCH_LP, "11103", "Łańcuch do piły 16'' 56og 3/8lp, 1,3mm do Partner", "5907589360356",
    "G74040 // S11103 3/8lp,050\"", "H01-02");
  tw.run(LANCUCH_50, "MF381350", "Łańcuch do piły 14'' 50og 3/8'' 1,3mm do Stihl", "5907580104560",
    "Zamiennie: G74050 // S11100", "H01-03");
  /* Prowadnica o symbolu z samych cyfr: cyfry z opisu łańcucha nie mają prawa
     zrobić z niej zamiennika, bo to inny rodzaj towaru. */
  tw.run(PROWADNICA, "11100", "Prowadnica 14'' 3/8'' 1,3mm", "", "", "H02-01");
  const stan = d.prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,0)");
  stan.run(LANCUCH_56, 1, 2);
  stan.run(LANCUCH_LP, 1, 7);
  stan.run(LANCUCH_50, 1, 4);
}

test("karta rozwiązuje zamiennik z opisu „S11103” na naszą kartotekę 11103 ze stanem", async () => {
  const k = await tekst("karta_towaru", "MF381356");
  assert.ok(k.includes("Nasze zamienniki z opisu: 11103 — Łańcuch do piły 16'' 56og 3/8lp, 1,3mm do Partner"
    + " — dostępne dziś: 7 szt. (w opisie: S11103)"), k);
  assert.ok(k.includes("Podział zapisany różnie"), "karta z „3/8''” i zamiennikiem „3/8lp” ostrzega");
  assert.ok(!k.includes("H01-02"), "półka zamiennika też nie wychodzi (§10.4)");
});

test("zamiennik z opisu nie łapie innego rodzaju towaru ani samego siebie", async () => {
  const k50 = await tekst("karta_towaru", "MF381350");
  assert.ok(!k50.includes("Nasze zamienniki z opisu"), `„S11100” to prowadnica 11100, nie łańcuch: ${k50}`);
  const klp = await tekst("karta_towaru", "11103");
  assert.ok(!/Nasze zamienniki z opisu: 11103/.test(klp), "opis 11103 wskazuje sam siebie");
});

test("szukanie łańcucha z podziałem „3/8lp” oddaje też „3/8''” i ostrzega o zapisie", async () => {
  const w = await tekst("szukaj_towaru", "łańcuch 56og 3/8lp 1,3");
  assert.ok(w.includes("11103 — Łańcuch do piły 16'' 56og 3/8lp, 1,3mm do Partner"), w);
  assert.ok(w.includes("MF381356 — Łańcuch do piły 16'' 56og 3/8'' 1,3mm do Partner"), w);
  assert.ok(w.indexOf("11103") < w.indexOf("MF381356"), "zapis pytającego trafia pierwszy");
  assert.ok(w.includes("Podział zapisany różnie (3/8, 3/8lp, 3/8P): sprawdź w nazwie, "
    + "czy to łańcuch 3/8 LP (Picco), czy pełny 3/8."), w);
  for (const q of ["łańcuch 56og 3/8\" 1,3", "łańcuch 56og 3/8 P 1,3", "łańcuch 56og 3/8P"]) {
    const v = await tekst("szukaj_towaru", q);
    assert.ok(v.includes("11103") && v.includes("MF381356"), `${q}: ${v}`);
  }
});

test("szukanie bez podziału nie dostaje ostrzeżenia, a „13/8” podziałem nie jest", async () => {
  assert.ok(!(await tekst("szukaj_towaru", "łańcuch 56og")).includes("Podział zapisany"));
  assert.ok(!(await tekst("szukaj_towaru", "łańcuch 13/8")).includes("Podział zapisany"));
});
