import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wiedza-oferty-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Wiedza z ofert trafia do bazy i JEST OD RAZU ZNAJDOWANA (0.264.0) ───────
   Obietnica tego wydania brzmi: numer, który sprzedawca wpisał w opisie
   NASZEJ oferty, przestaje ginąć razem z rozmową. Sprawdzalny jest tylko
   jeden jej kształt — po zapisie pytanie o ten numer ma prowadzić do towaru
   szczeblem OEM, trzecim z jedenastu. Ten plik stoi na PRAWDZIWEJ kartotece
   z seeda, jak `kandydaci.test.ts`, właśnie po to.

   Reszta pilnuje granic zapisu: co się nim NIE staje (moc silnika, EAN),
   pod czyim podpisem staje (żadnym — kliknięcie mówi dziennik) i że drugie
   kliknięcie nie mnoży wierszy ani wpisów w księdze.                       */

let db: typeof import("../db/db.js").db;
let Z: typeof import("./wiedza-z-oferty.js");
let I: typeof import("./identyfikatory.js");
let kandydaciDoboru: typeof import("./kandydaci.js").kandydaciDoboru;
let zapiszDane: typeof import("./dobor.js").zapiszDane;
let config: typeof import("../config.js").config;
let subiekt: typeof import("../context.js").subiekt;

let biuro = 0;
let konto = 0;
let rozmowa = 0;
/* `FTC272` — ta sama kartoteka, na której stoją testy kandydatów. */
const FTC272 = 14;
const OFERTA = "14023867457";
const KTO = { id: 0, name: "A. Lewandowska" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ subiekt } = await import("../context.js"));
  Z = await import("./wiedza-z-oferty.js");
  I = await import("./identyfikatory.js");
  ({ kandydaciDoboru } = await import("./kandydaci.js"));
  ({ zapiszDane } = await import("./dobor.js"));
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  const stan = d.prepare("INSERT INTO sgt_stan(tw_id,mag_id,stan,stan_rez) VALUES (?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => {
    ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || "");
    stan.run(i + 1, config.magId.MAG, Number(r[3]) || 0, Number(r[4]) || 0);
  });
  d.exec("COMMIT");
  assert.equal((d.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(FTC272) as { symbol: string }).symbol, "FTC272");
  I.przebudujIdentyfikatory(d);
});

beforeEach(() => {
  const d = db();
  for (const t of ["model_z_opisu", "dowod_zastosowania", "zastosowanie", "model_urzadzenia",
    "dobor_rozmowy", "conversation_event", "message",
    "conversation", "channel_account", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  d.prepare("DELETE FROM towar_identyfikator WHERE zrodlo!='opis'").run();
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  KTO.id = biuro;
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-1','zielony_ogrod')`).run(konto).lastInsertRowid);
});

const CEL = () => ({ twId: FTC272, symbol: "FTC272", ofertaId: OFERTA });
const zapisz = (wiedza: { numery?: Array<{ rodzaj: "oem" | "nr_oryg"; wartosc: string }>; modele?: string[] }) =>
  Z.zapiszWiedzeZOferty(CEL(), { numery: wiedza.numery ?? [], modele: wiedza.modele ?? [] }, KTO, db());

test("numer z oferty JEST OD RAZU znajdowany szczeblem OEM — to cała obietnica wydania", () => {
  /* Bez tego zapisu numer stał w opisie oferty i nie prowadził donikąd:
     `przebudujIdentyfikatory` czyta opisy KARTOTEK, nie ofert. */
  const numer = "41307131699";
  assert.deepEqual(I.szukajPoIdentyfikatorze(numer, db()), [], "numeru nie ma prawa być przed zapisem");

  const p = zapisz({ numery: [{ rodzaj: "oem", wartosc: numer }] });
  assert.equal(p.numery.length, 1);

  zapiszDane(rozmowa, { oem: numer }, 1, biuro, db());
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(drogi.find((d) => d.droga === "oem")!.wynikow, 1, "szczebel OEM ma trafić");
  const k = kandydaci.find((c) => c.symbol === "FTC272");
  assert.ok(k, `kartoteka nie wróciła; kandydaci: ${kandydaci.map((c) => c.symbol).join(", ")}`);
  /* Zdanie źródła mówi, że numer jest Z NASZEJ OFERTY, a nie z opisu
     kartoteki. Do 0.263.0 stał tu wybór dwugałęziowy i ekran skłamałby. */
  assert.match(k!.zrodlo, /z opisu NASZEJ oferty/);
  assert.match(k!.zrodlo, new RegExp(OFERTA));
  assert.doesNotMatch(k!.zrodlo, /z opisu kartoteki/);
});

test("wpis nie jest podpisany agentem — kliknięcie mówi dziennik, nie kartoteka", () => {
  /* `dodal_user_id` NULL to decyzja o źródle wyrażona w danych. Numeru nie
     napisał agent; agent kliknął „Ułóż odpowiedź". Podpisanie go człowiekiem
     zrównałoby deklarację sprzedawcy z katalogiem sprawdzonym przez biuro. */
  zapisz({ numery: [{ rodzaj: "oem", wartosc: "41307131698" }] });
  const w = db().prepare(`SELECT zrodlo, dodal, dodal_user_id, oferta_id FROM towar_identyfikator
    WHERE wartosc='41307131698'`).get() as Record<string, unknown>;
  assert.equal(w.zrodlo, "oferta");
  assert.equal(w.dodal, "oferta");
  assert.equal(w.dodal_user_id, null);
  assert.equal(w.oferta_id, OFERTA);

  const zd = db().prepare("SELECT type, user_id, payload FROM events ORDER BY id DESC LIMIT 1")
    .get() as { type: string; user_id: string; payload: string };
  assert.equal(zd.type, "wiedza_z_oferty_zapisana");
  assert.equal(zd.user_id, "A. Lewandowska", "KTO kliknął, mówi księga");
});

test("pozycja listy zgodności idzie do KOLEJKI, z marką — klucz modelu składa człowiek", () => {
  /* Decyzja 0.186.0 zostaje nietknięta: automat nie zgaduje marki. Dlatego
     nie `FS250`, tylko `STIHL FS250` — bez marki nie ma z czego złożyć klucza. */
  const p = zapisz({ modele: ["STIHL FS250", "STIHL FR450"] });
  assert.deepEqual(p.modele, ["STIHL FS250", "STIHL FR450"]);
  assert.equal(p.czeka, 2);
  const w = db().prepare(`SELECT tekst, zrodlo, oferta_id, stan FROM model_z_opisu
    WHERE tekst='STIHL FS250'`).get() as Record<string, unknown>;
  assert.equal(w.zrodlo, "oferta");
  assert.equal(w.oferta_id, OFERTA);
  assert.equal(w.stan, "nowy");
});

test("przerobiony wiersz z oferty daje propozycję ze źródłem `oferta`, nie `opis`", () => {
  /* Po tym polu mierzy się skuteczność źródeł, a ekran tłumaczy je na zdanie.
     Zrównanie oferty z opisem kartoteki zabrałoby jedno i drugie. */
  zapisz({ modele: ["STIHL FS250"] });
  const wiersz = I.listaModeliZOpisow(db()).wiersze[0]!;
  assert.equal(wiersz.zrodlo, "oferta");
  const z = I.przerobModelZOpisu(wiersz.id,
    { rodzaj: "maszyna", marka: "STIHL", nazwa: "FS 250" }, biuro, db());
  assert.equal(z.zrodlo, "oferta");
  const d = db().prepare("SELECT tresc FROM dowod_zastosowania WHERE zastosowanie_id=?")
    .get(z.id) as { tresc: string };
  assert.match(d.tresc, /z listy zgodności naszej oferty/);
  assert.match(d.tresc, new RegExp(OFERTA));
});

test("przebudowa po imporcie NIE kasuje wiersza z oferty — nie ma z czego go odtworzyć", () => {
  /* `przebudujModeleZOpisu` jest odświeżaczem tabeli pochodnej od opisów
     kartotek: kasuje `nowy` spoza świeżego zbioru. Wiersz z oferty nigdy
     w tym zbiorze nie stanie, więc bez zawężenia ginąłby przy pierwszym
     imporcie po zapisie. Bez tego testu wróciłby ten sam błąd. */
  zapisz({ modele: ["STIHL FS250"] });
  I.przebudujModeleZOpisu(db());
  assert.equal(Z.czekaWKolejce(FTC272, db()) >= 1, true);
  assert.equal(Number((db().prepare(
    "SELECT count(*) n FROM model_z_opisu WHERE zrodlo='oferta'").get() as { n: number }).n), 1);
});

test("drugie kliknięcie nie mnoży wierszy ani wpisów w księdze", () => {
  /* Dziesiąte kliknięcie pod tą samą ofertą nie ma prawa produkować
     zdarzenia „zapisano 0 i 0" — księga zdarzeń bez treści uczy jej nieczytania. */
  zapisz({ numery: [{ rodzaj: "oem", wartosc: "41307131697" }], modele: ["STIHL FS250"] });
  const zdarzen = Number((db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n);

  const drugi = zapisz({ numery: [{ rodzaj: "oem", wartosc: "41307131697" }], modele: ["STIHL FS250"] });

  assert.deepEqual(drugi.numery, []);
  assert.deepEqual(drugi.modele, []);
  assert.equal(drugi.czeka, 1, "licznik kolejki jest stanem, nie przyrostem — pokazuje się i tak");
  assert.equal(Number((db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n), zdarzen);
  assert.equal(Number((db().prepare(
    "SELECT count(*) n FROM towar_identyfikator WHERE wartosc='41307131697'").get() as { n: number }).n), 1);
});

test("ten sam numer pod innym rodzajem nie wchodzi drugi raz", () => {
  /* `UNIQUE` jest po trójce `(tw_id, rodzaj, wartosc_norm)`, więc bazy przed
     tym nie broni. Jeden numer w dwóch wierszach przy jednej kartotece kłamie
     o swojej wadze: wyglądałby na dwa niezależne świadectwa. */
  zapisz({ numery: [{ rodzaj: "oem", wartosc: "41307131696" }] });
  const p = zapisz({ numery: [{ rodzaj: "nr_oryg", wartosc: "413 071 316-96" }] });
  assert.deepEqual(p.numery, [], "ten sam numer po `zwin`, inny rodzaj — dalej ten sam numer");
});

test("nasz własny symbol nie wchodzi jako identyfikator obcy", () => {
  /* Ta sama reguła, co przy przebudowie po imporcie (0.234.0), i dlatego
     jedna funkcja `naszeSymbole` dla obu zapisujących. Nasza kartoteka
     znajdzie się po symbolu; wpisana tutaj mnożyłaby ten sam fakt. */
  const p = zapisz({ numery: [{ rodzaj: "oem", wartosc: "24-04003" }] });
  assert.deepEqual(p.numery, []);
});

test("porcja jest ograniczona, a następne kliknięcie dobiera dalszą część", () => {
  /* Lista zgodności bywa na dwieście pozycji, a kolejka Wiedzy jest wspólna
     dla całego magazynu. Reszta dochodzi przy następnym szkicu: zapisane
     przestają być lukami, więc porcja przesuwa się sama. */
  const wszystkie = Array.from({ length: Z.PORCJA_Z_OFERTY + 5 }, (_, i) => `STIHL FS${300 + i}`);
  const pierwszy = zapisz({ modele: wszystkie });
  assert.equal(pierwszy.modele.length, Z.PORCJA_Z_OFERTY);

  const drugi = zapisz({ modele: wszystkie });
  assert.equal(drugi.modele.length, 5, "druga porcja to reszta, nie te same pozycje");
  assert.equal(drugi.czeka, Z.PORCJA_Z_OFERTY + 5);
});
