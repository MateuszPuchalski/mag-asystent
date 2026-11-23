import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pomiar-id-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Pomiar parsera identyfikatorów ─────────────────────────────────────────
   Pomiar ma mówić prawdę o dwóch rzeczach naraz: ile numerów zostało w opisach
   poza tabelą i ile z tego to nie numery. Pomyłka w pierwszej chowa lukę,
   pomyłka w drugiej każe poprawiać parser pod szum. Tabela niżej pilnuje
   klasyfikacji na opisach z kartoteki, a test na pełnym seedzie pilnuje, że
   liczby się domykają i że pomiar niczego nie zapisuje. */

let db: typeof import("../db/db.js").db;
let I: typeof import("./identyfikatory.js");
let P: typeof import("./identyfikatory-pomiar.js");
let zwin: typeof import("../tekst.js").zwin;

before(async () => {
  ({ db } = await import("../db/db.js"));
  const { config } = await import("../config.js");
  ({ zwin } = await import("../tekst.js"));
  I = await import("./identyfikatory.js");
  P = await import("./identyfikatory-pomiar.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  assert.ok(rows.length > 3000, `kartoteka wygląda na niekompletną: ${rows.length}`);
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  I.przebudujIdentyfikatory(d);
});

/** Skrót: ciągi jednego opisu jako `numer → to, co o nim wiemy`. */
function ciagi(opis: string, sym: string, wTabeli: string[] = [], nasze: string[] = [], ean = "") {
  const lista = P.ciagiOpisu(opis, sym, ean, wTabeli.map((w) => zwin(w)), new Set(nasze.map((n) => zwin(n))));
  return new Map(lista.map((c) => [c.numer, c]));
}

test("ciąg w tabeli, symbol naszej kartoteki i model po `Modele:` to trzy różne rzeczy", () => {
  const c = ciagi("OEM: 41307131600 Modele: FS200 FS250 Zamiennik: 24-04003", "FTC272", ["41307131600"], ["24-04003"]);
  assert.equal(c.get("41307131600")?.klasa, "w_tabeli");
  assert.equal(c.get("24-04003")?.klasa, "nasz_symbol", "symbol innej kartoteki nie jest luką parsera");
  const model = c.get("FS200");
  assert.equal(model?.klasa, "poza_tabela");
  assert.equal(model?.pochodzenie, "nieznana_etykieta");
  assert.equal(model?.etykieta, "modele");
  assert.equal(model?.szum, "model_maszyny", "numer po `Modele:` nie zawyża liczby zgubionych");
});

test("własny symbol i EAN nie liczą się wcale", () => {
  const c = ciagi("G02800 FT-OA419 S10540 5907580110455", "FT-OA419", [], [], "5907580110455");
  assert.equal(c.get("FT-OA419")?.klasa, "wlasny");
  assert.equal(c.get("5907580110455")?.klasa, "wlasny");
  assert.equal(c.get("G02800")?.klasa, "poza_tabela");
});

test("ogon numeru ze spacjami jest w tabeli, gdy jest w niej cały numer", () => {
  /* Kształt numeru nie obejmuje spacji, więc z `537 02 40-03` widzi `40-03`.
     Bez porównania przez zawieranie każdy numer Husqvarny byłby „zgubiony". */
  const c = ciagi("Nr.oryg.: 537 02 40-03; 537 02 40-02", "04-05002", ["537 02 40-03", "537 02 40-02"]);
  assert.equal(c.get("40-03")?.klasa, "w_tabeli");
  assert.equal(c.get("40-02")?.klasa, "w_tabeli");
});

test("pochodzenie: sama lista, lista po `//` wśród słów i proza", () => {
  const lista = ciagi("76-007 GCG15 G81066G M83115", "W09-0414");
  assert.equal(lista.get("G81066G")?.pochodzenie, "sama_lista");
  assert.equal(lista.get("G81066G")?.szum, null);
  const zUkosnikami = ciagi("6 frezów czerwona 50-009 // M83096", "FTC42");
  assert.equal(zUkosnikami.get("M83096")?.pochodzenie, "lista_z_ukosnikami");
  const proza = ciagi("Honda M798941 ZBIORNIKGX", "W58-0201");
  assert.equal(proza.get("M798941")?.pochodzenie, "proza");
});

test("pochodzenie: etykieta nieznana, znana i zestaw", () => {
  const marka = ciagi("OEM: MTD: 723-0156, 723-3018, MURRAY: 021031", "RO2210");
  assert.equal(marka.get("723-0156")?.pochodzenie, "nieznana_etykieta");
  assert.equal(marka.get("723-0156")?.etykieta, "mtd");
  assert.equal(marka.get("021031")?.etykieta, "murray");

  /* Oznaczenie świecy ma jedną cyfrę i odpada na progu parsera, choć stoi pod
     etykietą, którą parser czyta. To inna luka niż nieznana etykieta. */
  const swieca = ciagi("Zastępuje: BP6ES N9YC W7DC LR17YC", "11-06033", ["LR17YC"]);
  assert.equal(swieca.get("BP6ES")?.pochodzenie, "znana_etykieta");
  assert.equal(swieca.get("BP6ES")?.zaMaloCyfr, true);
  assert.equal(swieca.get("LR17YC")?.klasa, "w_tabeli");

  const zestaw = ciagi("OEM: 1234567 W zestawie uszczelka - 97-001", "Q", ["1234567"]);
  assert.equal(zestaw.get("97-001")?.pochodzenie, "zestaw", "zawartość kompletu parser pomija z decyzji");
});

test("numery sklejone ukośnikiem liczą się osobno, sufiks `/0` zostaje przy numerze", () => {
  const c = ciagi("Zamiennik: S10250/PF10249", "FT531125", ["S10250"]);
  assert.equal(c.get("S10250")?.klasa, "w_tabeli");
  assert.equal(c.get("PF10249")?.klasa, "poza_tabela");
  const ggp = ciagi("OEM: 81001145 / 81001145/0", "470002", ["81001145", "81001145/0"]);
  assert.equal(ggp.get("81001145/0")?.klasa, "w_tabeli");
});

test("litery spoza ASCII należą do numeru, nie do tła", () => {
  const c = ciagi("OEM: F7RTC // ŚWI-019B // BPR7ES", "2023", [], ["ŚWI-019B"]);
  assert.equal(c.get("ŚWI-019B")?.klasa, "nasz_symbol");
  assert.equal(c.has("WI-019B"), false);
});

test("reguła szumu: wymiary, gwinty, jednostki i modele — ale nie numery do nich podobne", () => {
  const szum = (numer: string, etykieta: string | null = null) => P.rodzajSzumu(numer, numer, etykieta);
  assert.equal(szum("M10x1"), "gwint");
  assert.equal(szum("25x47x7"), "wymiar");
  assert.equal(szum("TCT300X40"), "wymiar");
  assert.equal(szum("48cm"), "jednostka");
  assert.equal(szum("2014"), "rok");
  assert.equal(szum("56-30"), "urywek");
  assert.equal(szum("5200"), "krotka_liczba");
  assert.equal(szum("MS170"), "model_maszyny");
  assert.equal(szum("240R"), "model_maszyny");
  assert.equal(szum("DYM1576", "modele"), "model_maszyny");
  assert.equal(P.rodzajSzumu("60303460773462e", "4.60303460773462e+23", null), "zepsuta_liczba");
  /* Druga strona: te ciągi wyglądają podobnie, a są numerami części. */
  for (const numer of ["34279A", "1011G", "FTC272", "M83115", "81001145/0", "532165630", "DYM1576", "16100-ZE2-W71"]) {
    assert.equal(szum(numer), null, `${numer} to numer, nie szum`);
  }
});

test("na pełnej kartotece liczby się domykają", () => {
  const p = P.zmierzIdentyfikatory(db());
  const z = p.zIdentyfikatorem; const bez = p.bezIdentyfikatora;

  assert.equal(z.kartotek + bez.kartotek, p.zOpisem, "każda kartoteka z opisem jest w jednej z dwóch grup");
  assert.ok(p.zOpisem > 2000 && p.zOpisem < p.kartotek);
  for (const g of [z, bez]) {
    assert.equal(g.wTabeli + g.naszeSymbole + g.szum + g.zgubione, g.ciagow, "ciąg ma dokładnie jedną klasę");
    assert.ok(g.zeZgubionymi <= g.zCiagami && g.zCiagami <= g.kartotek);
  }
  assert.equal(bez.wTabeli, 0, "kartoteka bez identyfikatora nie ma czego mieć w tabeli");

  const pozaTabela = z.szum + z.zgubione + bez.szum + bez.zgubione;
  const pochodzenia = Object.values(p.pochodzenie);
  assert.equal(pochodzenia.reduce((s, w) => s + w.ciagow, 0), pozaTabela, "każdy ciąg spoza tabeli ma pochodzenie");
  assert.equal(pochodzenia.reduce((s, w) => s + w.szum, 0), z.szum + bez.szum);
  assert.equal(Object.values(p.szum).reduce((s, n) => s + n, 0), z.szum + bez.szum);
  assert.equal(p.etykiety.reduce((s, w) => s + w.ciagow, 0), p.pochodzenie.nieznana_etykieta.ciagow);

  /* Ranking pokazuje WYŁĄCZNIE etykiety, których parser nie czyta. Etykieta
     znana w rankingu znaczyłaby, że pomiar i parser mają różne listy. */
  for (const w of p.etykiety) assert.equal(I.rodzajEtykiety(`${w.etykieta}:`), null, w.etykieta);
  for (let i = 1; i < p.etykiety.length; i++) {
    const a = p.etykiety[i - 1]; const b = p.etykiety[i];
    assert.ok(a.ciagow - a.szum >= b.ciagow - b.szum, "ranking po numerach, nie po szumie");
  }

  /* Rząd wielkości z kartoteki demo. Główna luka to listy bez etykiety, a nie
     etykiety nieznane: gdyby te proporcje się odwróciły, zmienił się parser
     albo pomiar i trzeba przeczytać raport od nowa. */
  assert.ok(bez.kartotek > 1100 && bez.kartotek < 1400, `bez identyfikatora: ${bez.kartotek}`);
  assert.ok(p.pochodzenie.sama_lista.ciagow > 2 * p.pochodzenie.nieznana_etykieta.ciagow);
  /* Urywki numerów ze spacjami (`4238`, `91-01`) były w tabeli w 83 wierszach.
     Ten próg pilnuje, że nie wrócą po cichu. */
  assert.ok(p.szumWTabeli.wgReguly.urywek <= 10, `urywków w tabeli: ${p.szumWTabeli.wgReguly.urywek}`);
  assert.ok(p.szumWTabeli.wierszy < 300, `wierszy-szumu w tabeli: ${p.szumWTabeli.wierszy}`);
});

test("pomiar niczego nie zapisuje", () => {
  const d = db();
  const stan = () => ["towar_identyfikator", "events", "sgt_towar"].map((t) =>
    Number((d.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n)).join("/");
  const przed = stan();
  const zmiany = Number((d.prepare("SELECT total_changes() n").get() as { n: number }).n);
  P.raportPomiaru(P.zmierzIdentyfikatory(d), "2026-01-01 00:00:00");
  assert.equal(stan(), przed);
  assert.equal(Number((d.prepare("SELECT total_changes() n").get() as { n: number }).n), zmiany,
    "ani jednego INSERT-a, UPDATE-a i DELETE — pomiar chodzi na bazie magazynu");
});

test("raport odpowiada na pięć pytań i mówi, czym jest szum", () => {
  const raport = P.raportPomiaru(P.zmierzIdentyfikatory(db()), "2026-01-01 00:00:00");
  for (const naglowek of ["## 1. Kartoteki", "## 2. Kartoteki bez identyfikatora", "## 3. Kartoteki z identyfikatorami",
    "## 4. Skąd pochodzą ciągi spoza tabeli", "## 5. Szum", "## 6. Druga strona", "## Granice pomiaru"]) {
    assert.ok(raport.includes(naglowek), naglowek);
  }
  assert.ok(raport.includes("Zdjęto: 2026-01-01 00:00:00."));
  assert.ok(/\| `mtd:` \|/.test(raport), "etykieta marki stoi w rankingu nieznanych");
  assert.ok(!/\| `oem:` \|/.test(raport), "etykieta znana nie ma prawa stać w rankingu nieznanych");
});

test("baza bez read-modelu to brak danych, nie zero numerów", () => {
  const pusta = new DatabaseSync(":memory:");
  assert.deepEqual(P.brakujaceTabele(pusta), ["sgt_towar", "towar_identyfikator"]);
  assert.deepEqual(P.brakujaceTabele(db()), []);
});
