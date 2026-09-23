import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pasuje-do-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── „Pasuje do" ze wszystkich ofert: zbiórka i sprawdzenie ─────────────────
   Allegro udaje funkcja `query` — ani jednego żądania do sieci. Pilnujemy
   pięciu obietnic. Lista ofert konta trafia do snapshotu i mówi, czy jest
   następna strona. Zbiórka bierze wyłącznie oferty z PEWNĄ kartoteką, nie
   dubluje maszyny znanej wiedzy i znakuje ofertę jako zebraną. Limit Allegro
   przerywa partię z czasem, o który prosi. Sprawdzenie to czysty odczyt,
   a sprzeczność z negatywem stoi przed brakiem.                            */

let db: typeof import("../db/db.js").db;
let P: typeof import("./pasuje-do-ofert.js");
let W: typeof import("./wiedza.js");
let BladLimitu: typeof import("../adapters/allegro.js").BladLimituAllegro;
let biuro = 0;

const NOZ = 801; const FILTR = 802; const BEZ_SKU = 803;

before(async () => {
  ({ db } = await import("../db/db.js"));
  P = await import("./pasuje-do-ofert.js");
  W = await import("./wiedza.js");
  ({ BladLimituAllegro: BladLimitu } = await import("../adapters/allegro.js"));
  const t = db().prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)");
  t.run(NOZ, "NOZ-HECHT-46", "Nóż do kosiarki 46 cm");
  t.run(FILTR, "F-GX160", "Filtr powietrza GX160");
  t.run(BEZ_SKU, "X-1", "Część bez oferty");
});

let zadania: string[] = [];
const OFERTY = [
  { id: "1001", name: "Nóż do kosiarki Hecht 5484", external: { id: "NOZ-HECHT-46" }, publication: { status: "ACTIVE" } },
  { id: "1002", name: "Filtr powietrza Honda GX160", external: { id: "F-GX160" }, publication: { status: "ACTIVE" } },
  /* Sygnatura, której nie ma w kartotece — oferta bez pewnej kartoteki. */
  { id: "1003", name: "Coś innego", external: { id: "NIEMA-1" }, publication: { status: "ACTIVE" } },
];
const TRESC: Record<string, unknown> = {
  "1001": { parameters: [{ name: "Numer katalogowy części", values: ["25400205001"] }],
    compatibilityList: { type: "MANUAL", items: [
      { type: "TEXT", text: "Hecht 5484" }, { type: "TEXT", text: "Hecht 1803S" },
      { type: "TEXT", text: "Wiele modeli" }, { type: "TEXT", text: "Kosiarka Xyz 99Q" }] } },
  "1002": { parameters: [], compatibilityList: { type: "MANUAL", items: [{ type: "TEXT", text: "Honda GX160" }] } },
  "1003": { parameters: [], compatibilityList: { type: "MANUAL", items: [{ type: "TEXT", text: "Honda GX200" }] } },
};
const query = async (url: string) => {
  zadania.push(url);
  if (url.includes("/sale/offers?")) return { offers: OFERTY, totalCount: OFERTY.length };
  const id = url.split("/sale/product-offers/")[1];
  return TRESC[decodeURIComponent(id)] ?? null;
};
const deps = (n: Partial<import("./pasuje-do-ofert.js").PasujeDoDeps> = {}) =>
  ({ query, czekaj: async () => {}, los: () => 0.5, apiUrl: "https://api.test", accountId: "sprzedawca", ...n });

beforeEach(() => {
  zadania = [];
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "model_z_opisu", "model_urzadzenia", "towar_identyfikator",
    "offer_snapshot", "oferta_kartoteka", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
});

const ALA = () => ({ userId: biuro, name: "A. Lewandowska" });
const zatwierdzone = (twId: number, marka: string, nazwa: string, polaryzacja: "pasuje" | "nie_pasuje" = "pasuje",
  warunki: Record<string, unknown> | null = null) => {
  const z = W.zaproponujZastosowanie({ twId, model: { rodzaj: "maszyna", marka, nazwa }, polaryzacja, zrodlo: "reczne",
    powodNegatywny: polaryzacja === "nie_pasuje" ? "niewlasciwy_rozstaw" : null, warunki,
    dowod: { rodzaj: "producent", tresc: "katalog" } }, ALA())!;
  return W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);
};

test("lista ofert konta trafia do snapshotu, mówi o następnej stronie i zostawia ślad w dzienniku", async () => {
  const r = await P.spiszOferty(0, biuro, deps());
  assert.deepEqual(r, { zapisano: 3, nastepny: null, razem: 3 });
  assert.match(zadania[0], /\/sale\/offers\?publication\.status=ACTIVE&limit=1000&offset=0$/);
  assert.equal(P.stanPasujeDo().ofert, 3);
  assert.equal(P.stanPasujeDo().zKartoteka, 2, "oferta z sygnaturą spoza kartoteki nie ma pewnej kartoteki");
  assert.ok(P.stanPasujeDo().listaAt, "ekran wie, kiedy ostatnio pobrano listę");
  /* Strona pełna bez `totalCount` — jest następna; pusta — koniec. */
  const pelna = Array.from({ length: P.STRONA }, (_, i) => ({ id: `x${i}`, name: "x", publication: { status: "ACTIVE" } }));
  assert.equal((await P.spiszOferty(0, biuro, deps({ query: async () => ({ offers: pelna }) }))).nastepny, P.STRONA);
  assert.equal((await P.spiszOferty(P.STRONA, biuro, deps({ query: async () => ({ offers: [] }) }))).nastepny, null);
});

test("zbiórka: pewna kartoteka, numery z parametrów, maszyna znana pominięta, reszta do wiedzy — i znacznik zebrania", async () => {
  await P.spiszOferty(0, biuro, deps());
  /* Marka znana słownikowi — tak automat z 0.341.0 rozpoznaje ją na czele pozycji. */
  W.upewnijModel({ rodzaj: "maszyna", marka: "Hecht", nazwa: "5484" }, ALA());
  zatwierdzone(NOZ, "Hecht", "5484");
  zadania = [];
  const w = await P.zbierzPartie(biuro, deps());
  assert.equal(w.przejrzano, 2);
  assert.equal(w.pobrano, 2);
  assert.ok(zadania.every((u) => !u.includes("/1003")), "oferta bez pewnej kartoteki nie kosztuje żądania");
  assert.equal(w.znanych, 1, "Hecht 5484 już stoi przy nożu — nie wraca do kolejki");
  assert.equal(w.numerow, 1, "numer katalogowy z parametru trafia do identyfikatorów");
  assert.equal(w.pozostalo, 0);
  /* Marka na czele pozycji — automat z 0.341.0 składa klucz sam.
     „Kosiarka Xyz 99Q" zaczyna się słowem, które może być marką albo opisem,
     więc marka z tytułu oferty („Hecht") NIE jest doklejana — wiersz czeka
     na człowieka. Tak samo „Honda GX160": marki nie zna ani słownik, ani
     tytuł nie niesie JEDNEJ znanej marki. */
  const noze = W.zastosowaniaTowaru(NOZ).potwierdzone.map((z) => z.model.etykieta).sort();
  assert.deepEqual(noze, ["Hecht 1803S", "Hecht 5484"]);
  const kolejka = (db().prepare("SELECT tekst FROM model_z_opisu WHERE stan='nowy' ORDER BY tekst").all() as Array<{ tekst: string }>)
    .map((r) => r.tekst);
  assert.deepEqual(kolejka, ["Honda GX160", "Kosiarka Xyz 99Q"], "brak pewnej marki — pozycja czeka na człowieka");
  /* Druga zbiórka: nic do zebrania, ani jednego żądania. */
  zadania = [];
  const drugi = await P.zbierzPartie(biuro, deps());
  assert.deepEqual([drugi.przejrzano, zadania.length], [0, 0]);
});

test("pozycja sprzeczna z negatywem nie idzie do zapisu — automat nie zatwierdza jej obok „nie pasuje”", async () => {
  await P.spiszOferty(0, biuro, deps());
  W.upewnijModel({ rodzaj: "maszyna", marka: "Hecht", nazwa: "5484" }, ALA());
  zatwierdzone(NOZ, "Hecht", "1803S", "nie_pasuje");
  const w = await P.zbierzPartie(biuro, deps());
  assert.equal(w.sprzecznych, 1);
  assert.deepEqual(W.zastosowaniaTowaru(NOZ).potwierdzone.map((z) => z.model.etykieta), ["Hecht 5484"]);
  assert.deepEqual(W.zastosowaniaTowaru(NOZ).negatywne.map((z) => z.model.etykieta), ["Hecht 1803S"],
    "negatyw stoi sam — bez pozytywu obok");
  assert.equal(P.sprawdzOferty().sprzecznych, 1, "rozjazd pokazuje sprawdzenie ofert");
});

test("tekst z własną marką nie dostaje marki z tytułu — „Lifan 168F” pod gaźnikiem Hondy to nie „Honda Lifan 168F”", async () => {
  const { markaZKontekstu } = await import("./wiedza-automat.js");
  db().prepare("INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,synced_at) VALUES (1,'9001','Gaźnik Honda GX160 GX200','x')").run();
  assert.equal(markaZKontekstu(db(), FILTR, "9001", "Lifan 168F", ["Honda"]), null);
  assert.equal(markaZKontekstu(db(), FILTR, "9001", "Kosiarka Xyz 99Q", ["Honda"]), null);
  assert.deepEqual(markaZKontekstu(db(), FILTR, "9001", "GX200", ["Honda"]),
    { rodzaj: "maszyna", marka: "Honda", nazwa: "GX200" }, "goły model dalej dostaje markę z tytułu");
  assert.equal(markaZKontekstu(db(), FILTR, "9001", "LS 46-450", ["Honda"])?.marka, "Honda",
    "krótki przedrostek modelu to nie marka");
});

test("limit Allegro przerywa partię z czasem, o który prosi, a przerwana oferta nie jest znakowana", async () => {
  await P.spiszOferty(0, biuro, deps());
  const w = await P.zbierzPartie(biuro, deps({ query: async () => { throw new BladLimitu("429", 30_000); } }));
  assert.deepEqual(w.przerwano, { powod: "limit", poIluMs: 30_000 });
  assert.equal(w.przejrzano, 0);
  assert.equal(w.pozostalo, 2);
});

test("hala nie zbiera i nie pobiera listy — zapis to decyzja biura", async () => {
  const hala = Number(db().prepare("INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','magazynier')").run().lastInsertRowid);
  await assert.rejects(() => P.spiszOferty(0, hala, deps()), /biura/);
  await assert.rejects(() => P.zbierzPartie(hala, deps()), /biura/);
  assert.equal(zadania.length, 0);
});

test("sprawdzenie: sprzeczność z negatywem przed brakiem, z warunkiem w zdaniu — i bez zapisu", async () => {
  await P.spiszOferty(0, biuro, deps());
  await P.zbierzPartie(biuro, deps());
  /* Hala zmierzyła: Hecht 1803S NIE pasuje do tego noża, a oferta dalej go wymienia. */
  zatwierdzone(NOZ, "Hecht", "1803S", "nie_pasuje");
  /* Filtr: wiedza zna Hondę GX200 (z warunkiem), a lista oferty jej nie wymienia. */
  zatwierdzone(FILTR, "Honda", "GX200", "pasuje", { rokOd: 2016 });

  const przed = ["events", "zastosowanie", "offer_snapshot"].map((t) =>
    (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n);
  const s = P.sprawdzOferty();
  assert.deepEqual(["events", "zastosowanie", "offer_snapshot"].map((t) =>
    (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n), przed, "sprawdzenie niczego nie zapisuje");

  assert.deepEqual([s.sprawdzonych, s.bezTresci, s.sprzecznych, s.brakujacych], [2, 0, 1, 1]);
  assert.equal(s.oferty[0].ofertaId, "1001", "sprzeczność stoi pierwsza — to zwrot, który czeka");
  assert.deepEqual(s.oferty[0].sprzeczne.map((x) => [x.pozycja, x.maszyna, x.powod]),
    [["Hecht 1803S", "Hecht 1803S", "niewłaściwy rozstaw"]]);
  assert.deepEqual(s.oferty[1].brakujace.map((x) => [x.maszyna, x.warunki]), [["Honda GX200", "rocznik od 2016"]]);
});
