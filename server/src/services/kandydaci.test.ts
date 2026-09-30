import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kandydaci-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Kandydaci doboru w trzech grupach, na PRAWDZIWEJ kartotece ──────────────
   Kartoteka to ten sam plik, z którego powstaje seed. Testy pilnują blizn:
   szukanie tylko z danych doboru i bez literówek (szarpak), znacznik trafienia
   po numerze (TC38), wpis bez wariantu jako druga próba (HECHT), najsłabsze
   ogniwo przez silnik, warunki wpisu, numer bez kartoteki i negatywy.      */

let db: typeof import("../db/db.js").db;
let kandydaciDoboru: typeof import("./kandydaci.js").kandydaciDoboru;
let zapiszDane: typeof import("./dobor.js").zapiszDane;
let W: typeof import("./wiedza.js");
let S: typeof import("./silniki.js");
let P: typeof import("./pasowania.js");
let T: typeof import("./tokeny-silnikow.js");
let config: typeof import("../config.js").config;
let subiekt: typeof import("../context.js").subiekt;

let biuro = 0;
let konto = 0;
let rozmowa = 0;
/* `FTC272`: „OEM: 41307131600 Modele: FS200 FS250 Zamiennik: 24-04003" —
   jeden zamiennik, który JEST w kartotece. */
const FTC272 = 14;
const ZAMIENNIK_FTC272 = 1654;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ subiekt } = await import("../context.js"));
  ({ kandydaciDoboru } = await import("./kandydaci.js"));
  ({ zapiszDane } = await import("./dobor.js"));
  W = await import("./wiedza.js");
  S = await import("./silniki.js");
  P = await import("./pasowania.js");
  T = await import("./tokeny-silnikow.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  assert.ok(rows.length > 3000, `kartoteka wygląda na niekompletną: ${rows.length} pozycji`);
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  const stan = d.prepare("INSERT INTO sgt_stan(tw_id,mag_id,stan,stan_rez) VALUES (?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => {
    ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || "");
    stan.run(i + 1, config.magId.MAG, Number(r[3]) || 0, Number(r[4]) || 0);
  });
  d.exec("COMMIT");
  assert.equal((d.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(FTC272) as { symbol: string }).symbol, "FTC272");
  /* Numery i pełny tekst czytają pochodne po imporcie, nie kartotekę. */
  const { przebudujIdentyfikatory } = await import("./identyfikatory.js");
  const { przebudujFts } = await import("./pelnotekst.js");
  przebudujIdentyfikatory(d);
  assert.ok(przebudujFts(d), "FTS5 ma być dostępne w node:sqlite testów");
});

beforeEach(() => {
  const d = db();
  for (const t of ["import_odsylaczy", "zamiennosc_oem", "pasowanie_czesci", "dowod_zastosowania", "zastosowanie",
    "alias_silnika", "zabudowa_silnika", "token_silnika_kartoteka", "token_silnika", "model_urzadzenia",
    "dobor", "offer_snapshot", "oferta_kartoteka", "conversation_event", "message", "conversation", "channel_account",
    "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','zielony_ogrod')`).run(konto).lastInsertRowid);
});

function pytaniePodOferta(ofertaId: string, sku: string | null) {
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_object_type,related_object_id,sent_at) VALUES (?,?,'m-1','incoming','Pasuje do FS250?','OFFER',?,'2026-09-01T07:00:00Z')`)
    .run(rozmowa, konto, ofertaId);
  db().prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,?,'Podkładka STIHL',?,'2026-09-01T07:05:00Z')`).run(konto, ofertaId, sku);
}

const tw = (symbol: string) =>
  (db().prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(symbol) as { tw_id: number }).tw_id;
const kandydat = (twId: number) => kandydaciDoboru(rozmowa, subiekt).kandydaci.find((k) => k.twId === twId);
const dane = (d: Parameters<typeof zapiszDane>[1]) => zapiszDane(rozmowa, d, 1, biuro);
const autor = () => ({ userId: biuro, name: "A. Lewandowska" });

test("bez oferty i bez danych nic nie ma, a `brakuje` mówi zdaniami czego — i nic nie zapisuje", () => {
  const przed = (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  const k = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual([k.kandydaci, k.bezKartoteki, k.negatywne], [[], [], []]);
  for (const zdanie of [/marki i modelu/, /numeru części/, /bez oferty/, /nazwy części/]) {
    assert.ok(k.brakuje.some((b) => zdanie.test(b)), `brak zdania ${zdanie}`);
  }
  assert.equal((db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n, przed);
  assert.equal((db().prepare("SELECT count(*) n FROM dobor").get() as { n: number }).n, 0);
});

test("bez nazwy części, ale z maszyną, `brakuje` mówi, że szukano samą marką i modelem", () => {
  dane({ marka: "NAC", model: "LS 46-450" });
  const { brakuje } = kandydaciDoboru(rozmowa, subiekt);
  assert.ok(brakuje.includes("Brak nazwy części — po nazwie szukano tylko marką i modelem."), brakuje.join(" | "));
  assert.ok(!brakuje.some((b) => /nie ma czego szukać po nazwie/.test(b)));
});

/* ── Numer: co wskazał klient ─────────────────────────────────────────────── */

test("kartoteka oferty i zamiennik z opisu stoją w grupie „numer”; zamiennik do sprawdzenia", () => {
  pytaniePodOferta("14892374512", "FTC272");
  const { kandydaci, brakuje } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(kandydaci.map((k) => [k.twId, k.grupa, k.pewnosc]),
    [[FTC272, "numer", "prawdopodobne"], [ZAMIENNIK_FTC272, "numer", "do_sprawdzenia"]]);
  assert.match(kandydaci[0].powod, /Kartoteka oferty 14892374512 — SKU oferty „FTC272/);
  assert.match(kandydaci[1].powod, /Zamiennik z opisu kartoteki „FTC272”/);
  assert.ok(!brakuje.some((b) => /oferty/.test(b)));
});

test("zatwierdzona para przez numer oryginału wchodzi jako „prawdopodobne” — kandydat w kolejce nie", async () => {
  const Z = await import("./zamiennosc-oem.js");
  pytaniePodOferta("14892374513", "W09-1307");
  assert.equal(kandydat(tw("76-080")), undefined, "sam wspólny numer nie jest zamiennikiem");
  Z.rozstrzygnijZamiennosc(tw("W09-1307"), tw("76-080"), "zatwierdz", null, biuro);
  const k = kandydat(tw("76-080"))!;
  assert.equal(k.grupa, "numer");
  assert.equal(k.pewnosc, "prawdopodobne", "człowiek porównał części — mocniej niż goły opis, słabiej niż oferta");
  assert.match(k.powod, /W09-1307 i 76-080 są zamienne: wspólne numery oryginału/);
});

test("oferta bez SKU trafia do `brakuje` ze zdaniem z mostka", () => {
  pytaniePodOferta("14892374512", "");
  const { kandydaci, brakuje } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(kandydaci, []);
  assert.ok(brakuje.some((b) => /^Oferta 14892374512 bez kartoteki: .*bez SKU/.test(b)), brakuje.join(" | "));
});

test("symbol z danych i kartoteka oferty to JEDEN kandydat, a drugie źródło idzie do `takze`", () => {
  pytaniePodOferta("14892374512", "FTC272");
  dane({ nazwaCzesci: "ftc272" });
  const ftc = kandydaciDoboru(rozmowa, subiekt).kandydaci.filter((k) => k.twId === FTC272);
  assert.equal(ftc.length, 1);
  assert.match(ftc[0].powod, /^Dokładny symbol „ftc272” z danych doboru — trafienie po IDENTYFIKATORZE/);
  assert.ok(ftc[0].takze.some((t) => /^Kartoteka oferty/.test(t)));
});

test("literówka w symbolu NIE prowadzi do cudzej kartoteki — blizna szarpaka", () => {
  dane({ oem: "FTC27Z" });
  /* Wyszukiwarka pytana ZAWSZE bez furtki na literówki: sama równość symbolu
     niżej to druga zapora, nie pierwsza. */
  const opcje: unknown[] = [];
  const podgladany = { ...subiekt, search: (q: string, n: number, o?: { literowki?: boolean }) => {
    opcje.push(o);
    return subiekt.search(q, n, o);
  } } as typeof subiekt;
  const { kandydaci, bezKartoteki } = kandydaciDoboru(rozmowa, podgladany);
  assert.ok(opcje.length > 0);
  assert.ok(opcje.every((o) => (o as { literowki?: boolean } | undefined)?.literowki === false));
  assert.deepEqual(kandydaci, []);
  /* Zostaje wyłącznie numer bez kartoteki — „nie mamy" jest odpowiedzią. */
  assert.deepEqual(bezKartoteki.map((b) => b.numer), ["FTC27Z"]);
});

test("kod EAN z danych trafia w kartotekę ze znacznikiem identyfikatora", () => {
  dane({ oem: "5907580110455" });
  const { kandydaci } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(kandydaci.length, 1);
  assert.equal(kandydaci[0].twId, FTC272);
  assert.match(kandydaci[0].powod, /^Kod EAN 5907580110455 z danych doboru — trafienie po IDENTYFIKATORZE/);
});

test("nazwa części słowami nie trafia po numerze — wyłącznie w „podobne”", () => {
  dane({ nazwaCzesci: "podkładka przekładni" });
  const { kandydaci } = kandydaciDoboru(rozmowa, subiekt);
  assert.ok(kandydaci.length > 0);
  assert.ok(kandydaci.every((k) => k.grupa === "podobne"));
});

test("numer OEM z opisu niesie znacznik TC38, a ta sama kartoteka z zamiennika stoi raz", () => {
  /* Blizna koła pasowego TC38: mocna droga, która nie mówi o sobie, że jest
     mocna, przegrywa w szkicu z domysłem z nazwy maszyny. */
  pytaniePodOferta("14892374512", "FTC272");
  dane({ oem: "41307131600" });
  const { kandydaci, bezKartoteki } = kandydaciDoboru(rozmowa, subiekt);
  const ftc = kandydaci.find((k) => k.twId === FTC272)!;
  assert.equal(ftc.powod,
    "numer OEM 41307131600 z opisu kartoteki „FTC272” — trafienie po IDENTYFIKATORZE, nie po opisie ani nazwie");
  assert.equal(kandydaci.filter((k) => k.twId === ZAMIENNIK_FTC272).length, 1);
  assert.equal(kandydaci.find((k) => k.twId === ZAMIENNIK_FTC272)!.pewnosc, "prawdopodobne",
    "numer podnosi zamiennik z opisu ponad „do sprawdzenia”");
  assert.deepEqual(bezKartoteki, [], "numer z kartoteką nie jest numerem, którego nie mamy");
});

test("numer z tabeli odsyłaczy dostawcy mówi, skąd jest", async () => {
  const O = await import("./odsylacze-dostawcow.js");
  try {
    O.importujOdsylacze({ dostawca: "Kramp", tresc: { csv: "Symbol;OEM\nFTC272;4130 713 9999" },
      mapowanie: { symbol: 0, ean: null, numery: [1], rodzaj: "oem" } }, true, biuro);
    dane({ oem: "41307139999" });
    assert.match(kandydat(FTC272)!.powod, /numer OEM 4130 713 9999 z tabeli odsyłaczy dostawcy Kramp przy kartotece „FTC272”/);
  } finally {
    db().prepare("DELETE FROM towar_identyfikator WHERE zrodlo='dostawca'").run();
  }
});

test("numer bez kartoteki nie znika i nie udaje trafienia; numer jako NAZWA części go nie daje", () => {
  dane({ oem: "999999999" });
  const { bezKartoteki } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(bezKartoteki.length, 1);
  assert.equal(bezKartoteki[0].numer, "999999999");
  assert.doesNotMatch(bezKartoteki[0].zdanie, /IDENTYFIKATORZE/, "karta bez kartoteki niczym nie trafiła");
  zapiszDane(rozmowa, { oem: null, nazwaCzesci: "123456789" }, 2, biuro);
  assert.deepEqual(kandydaciDoboru(rozmowa, subiekt).bezKartoteki, []);
});

/* ── Wiedza: co potwierdza baza ───────────────────────────────────────────── */

const STIHL = { rodzaj: "maszyna" as const, marka: "STIHL", nazwa: "FS 250" };
const zaproponuj = (twId: number, n: Partial<Parameters<typeof W.zaproponujZastosowanie>[0]> = {}) =>
  W.zaproponujZastosowanie({ twId, model: STIHL, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024" }, ...n }, autor())!;
const zatwierdz = (z: { id: number }) => W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);

test("zatwierdzone zastosowanie daje kandydata z wiedzy; propozycja w kolejce nie jest wiedzą", () => {
  dane({ marka: "stihl", model: "fs250" });
  zatwierdz(zaproponuj(tw("24-04003")));
  zaproponuj(FTC272, { dowod: { rodzaj: "rozmowa", tresc: "dobór" } });
  const { kandydaci } = kandydaciDoboru(rozmowa, subiekt);
  const k = kandydaci.find((x) => x.grupa === "wiedza")!;
  assert.equal(k.twId, ZAMIENNIK_FTC272);
  assert.equal(k.pewnosc, "potwierdzone");
  assert.match(k.powod, /^potwierdzone zastosowanie do STIHL FS 250 — katalog dostawcy, /);
  assert.equal(kandydaci.some((x) => x.twId === FTC272 && x.grupa === "wiedza"), false);
});

test("kartoteka z numeru i z wiedzy stoi w „numer”, ale z pewnością i zdaniem wiedzy", () => {
  pytaniePodOferta("14892374512", "FTC272");
  dane({ marka: "STIHL", model: "FS 250" });
  zatwierdz(zaproponuj(ZAMIENNIK_FTC272));
  const k = kandydat(ZAMIENNIK_FTC272)!;
  assert.equal(k.grupa, "numer", "pierwsza grupa z kolejności");
  assert.equal(k.pewnosc, "potwierdzone", "najmocniejsze źródło");
  assert.match(k.powod, /^Zamiennik z opisu/);
  assert.ok(k.takze.some((t) => /^potwierdzone zastosowanie do STIHL FS 250/.test(t)), "dowód nie znika ze szkicu");
});

test("negatyw stoi osobno i jako ostrzeżenie przy kandydacie z innej grupy", () => {
  pytaniePodOferta("14892374512", "FTC272");
  dane({ marka: "STIHL", model: "FS 250" });
  zatwierdz(zaproponuj(FTC272, { polaryzacja: "nie_pasuje", powodNegatywny: "tylko_inny_wariant",
    dowod: { rodzaj: "decyzja_biura", tresc: "pasuje tylko z przekładnią nową" } }));
  zatwierdz(zaproponuj(1, { polaryzacja: "nie_pasuje", powodNegatywny: "niewlasciwy_rozstaw",
    dowod: { rodzaj: "pomiar_wlasny", tresc: "rozstaw 140 mm" } }));
  const { kandydaci, negatywne } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(negatywne.map((n) => n.twId).sort((a, b) => a - b), [1, FTC272]);
  const oferta = kandydaci.find((k) => k.twId === FTC272)!;
  assert.equal(oferta.grupa, "numer", "negatyw nie wyrzuca kandydata — ostrzega przy nim");
  assert.match(oferta.ostrzezenia[0], /innego wariantu — nie pasuje do STIHL FS 250/);
  assert.equal(kandydaci.some((k) => k.twId === 1), false);
});

test("HECHT: wpis bez wariantu, gdy dokładny klucz milczy — najwyżej „prawdopodobne”", () => {
  dane({ marka: "STIHL", model: "FS 250", wariant: "C-E" });
  zatwierdz(zaproponuj(ZAMIENNIK_FTC272));
  const k = kandydat(ZAMIENNIK_FTC272)!;
  assert.equal(k.grupa, "wiedza");
  assert.equal(k.pewnosc, "prawdopodobne", "dowód dla modelu bazowego nie potwierdza wariantu");
  assert.match(k.powod, /bez wariantu, wariant niesprawdzony$/);
});

test("HECHT: wpis DLA wariantu wygrywa — druga próba nie rozmywa go wpisem ogólnym", () => {
  dane({ marka: "STIHL", model: "FS 250", wariant: "C-E" });
  zatwierdz(zaproponuj(FTC272, { model: { ...STIHL, wariant: "C-E" } }));
  zatwierdz(zaproponuj(ZAMIENNIK_FTC272));
  const z = kandydaciDoboru(rozmowa, subiekt).kandydaci.filter((x) => x.grupa === "wiedza");
  assert.deepEqual(z.map((x) => [x.twId, x.pewnosc]), [[FTC272, "potwierdzone"]]);
});

test("warunek spełniony: kandydat potwierdzony, a źródło mówi, CO sprawdziliśmy", () => {
  dane({ marka: "STIHL", model: "FS 250", rocznik: "2016", nrSeryjny: "175 123 456" });
  zatwierdz(zaproponuj(ZAMIENNIK_FTC272, { warunki: { rokOd: 2014, rokDo: 2018, seryjnyOd: "175000000" } }));
  const k = kandydat(ZAMIENNIK_FTC272)!;
  assert.equal(k.pewnosc, "potwierdzone");
  assert.match(k.powod, /; rocznik 2016 mieści się w: roczniki 2014–2018; nr seryjny 175 123 456 mieści się w/);
  assert.deepEqual(k.ostrzezenia, []);
});

test("warunek nieznany: kandydat do sprawdzenia z pytaniem o tabliczkę", () => {
  dane({ marka: "STIHL", model: "FS 250" });
  zatwierdz(zaproponuj(ZAMIENNIK_FTC272, { warunki: { seryjnyOd: "175000000" } }));
  const k = kandydat(ZAMIENNIK_FTC272)!;
  assert.equal(k.pewnosc, "do_sprawdzenia", "zgubić go byłoby gorzej — często to jedyna właściwa część");
  assert.deepEqual(k.ostrzezenia, ["pasuje warunkowo: nr seryjny od 175000000 — w doborze brak numeru seryjnego, zapytaj o tabliczkę"]);
});

test("warunek złamany: nie kandydat z wiedzy, tylko negatyw — także przy tej samej części z oferty", () => {
  pytaniePodOferta("14892374512", "FTC272");
  dane({ marka: "STIHL", model: "FS 250", rocznik: "2012" });
  zatwierdz(zaproponuj(FTC272, { warunki: { rokOd: 2014 } }));
  const { kandydaci, negatywne } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(negatywne.map((n) => [n.twId, n.powod]),
    [[FTC272, "poza zakresem wpisu: wpis obejmuje rocznik od 2014, a w doborze rocznik 2012"]]);
  const oferta = kandydaci.find((k) => k.twId === FTC272)!;
  assert.equal(oferta.pewnosc, "prawdopodobne", "złamany wpis niczego nie podnosi");
  assert.deepEqual(oferta.takze, []);
  assert.match(oferta.ostrzezenia[0], /^poza zakresem wpisu: .* — potwierdzone zastosowanie do STIHL FS 250 \(rocznik od 2014\)/);
});

test("negatyw z warunkiem: złamany milknie, nieznany ostrzega z dopiskiem „o ile”", () => {
  dane({ marka: "STIHL", model: "FS 250", rocznik: "2012" });
  zatwierdz(zaproponuj(FTC272, { polaryzacja: "nie_pasuje", powodNegatywny: "niewlasciwy_rozstaw", warunki: { rokOd: 2014 } }));
  zatwierdz(zaproponuj(1, { polaryzacja: "nie_pasuje", powodNegatywny: "niewlasciwy_rozstaw",
    warunki: { warunek: "wersja z gaźnikiem Walbro" } }));
  assert.deepEqual(kandydaciDoboru(rozmowa, subiekt).negatywne.map((n) => [n.twId, n.powod]), [[1,
    "niewłaściwy rozstaw — o ile: warunek: wersja z gaźnikiem Walbro — sprawdź z klientem"]]);
});

/* ── Przez silnik: zabudowa jako drugie ogniwo łańcucha ───────────────────── */

const BS450 = { rodzaj: "silnik" as const, marka: "Briggs & Stratton", nazwa: "450E" };
const HONDA = { rodzaj: "silnik" as const, marka: "Honda", nazwa: "GCV160" };

function zabuduj(silnik: typeof BS450, rodzajDowodu: Parameters<typeof S.zaproponujZabudowe>[0]["rodzajDowodu"] = "producent") {
  const z = S.zaproponujZabudowe({ maszyna: STIHL, silnik, rodzajDowodu, dowodTresc: "karta katalogowa", zrodlo: "reczne" }, autor())!;
  return S.rozstrzygnijZabudowe(z.id, "zatwierdz", null, biuro);
}

function doSilnika(twId: number, silnik: typeof BS450, rodzaj: "katalog_dostawcy" | "rozmowa" = "katalog_dostawcy") {
  return zatwierdz(W.zaproponujZastosowanie({ twId, model: silnik, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj, tresc: "katalog 2024" } }, autor())!);
}

test("nieznany silnik maszyny trafia do `brakuje`, a sam alias nie daje kandydatów", () => {
  dane({ marka: "STIHL", model: "FS 250" });
  const sam = kandydaciDoboru(rozmowa, subiekt).brakuje;
  assert.ok(sam.includes("Nie wiadomo, jaki silnik stoi w STIHL FS 250."), sam.join(" | "));
  zapiszDane(rozmowa, { silnik: "B&S 450E" }, 2, biuro);
  assert.ok(kandydaciDoboru(rozmowa, subiekt).brakuje.some((b) => /„B&S 450E” nie ma w słowniku silników/.test(b)));
  S.dodajAliasSilnika({ tekst: "B&S 450E", silnik: BS450 }, autor());
  doSilnika(FTC272, BS450);
  const k = kandydaciDoboru(rozmowa, subiekt);
  assert.ok(k.brakuje.some((b) => /to silnik Briggs & Stratton 450E wg słownika, ale zabudowy nikt nie zatwierdził/.test(b)));
  assert.equal(k.kandydaci.some((x) => x.grupa === "wiedza"), false, "kandydatów z samego aliasu nie ma");
});

test("część silnika wchodzi potwierdzona, a zdanie nazywa OBA ogniwa", () => {
  dane({ marka: "STIHL", model: "FS 250" });
  zabuduj(BS450);
  doSilnika(FTC272, BS450);
  const { kandydaci, brakuje } = kandydaciDoboru(rozmowa, subiekt);
  const k = kandydaci.find((x) => x.twId === FTC272)!;
  assert.equal(k.pewnosc, "potwierdzone", "dowód techniczny po obu stronach łańcucha");
  assert.match(k.powod, /zastosowanie do silnik Briggs & Stratton 450E.*; silnik Briggs & Stratton 450E stoi w STIHL FS 250/);
  assert.deepEqual(k.ostrzezenia, []);
  assert.ok(!brakuje.some((b) => /silnik/.test(b)), "silnik znany — nie ma czego brakować");
});

test("zastosowanie z tokenu w nazwie kartoteki karmi drogę przez silnik jak wpis ręczny", () => {
  const GX160 = { rodzaj: "silnik" as const, marka: "Honda", nazwa: "GX160" };
  dane({ marka: "STIHL", model: "FS 250" });
  zabuduj(GX160);
  const t = T.dodajToken({ token: "GX160", silnik: GX160 }, autor());
  const gaznik = tw("W09-0211");
  T.rozstrzygnijToken(t.id, { zatwierdz: [gaznik], pomin: [] }, biuro);
  const k = kandydat(gaznik)!;
  assert.equal(k.grupa, "wiedza");
  assert.equal(k.pewnosc, "potwierdzone");
  assert.match(k.powod, /potwierdzone zastosowanie do silnik Honda GX160 — decyzja biura/);
});

test("kilka silników: nigdy „potwierdzone” i zawsze ostrzeżenie o tabliczce", () => {
  dane({ marka: "STIHL", model: "FS 250" });
  zabuduj(BS450);
  zabuduj(HONDA);
  doSilnika(FTC272, BS450);
  const k = kandydat(FTC272)!;
  assert.equal(k.pewnosc, "prawdopodobne");
  assert.deepEqual(k.ostrzezenia, ["STIHL FS 250 bywa z kilkoma silnikami — potwierdź z tabliczki znamionowej"]);
});

test("najsłabsze ogniwo: ślad rozmowy po którejkolwiek stronie łańcucha daje „prawdopodobne”", () => {
  dane({ marka: "STIHL", model: "FS 250" });
  zabuduj(BS450, "rozmowa");
  doSilnika(FTC272, BS450);
  assert.equal(kandydat(FTC272)!.pewnosc, "prawdopodobne");
});

test("warunek wpisu do SILNIKA to pytanie o tabliczkę silnika, nigdy wyrok z rocznika maszyny", () => {
  dane({ marka: "STIHL", model: "FS 250", rocznik: "2022" });
  zabuduj(BS450);
  zatwierdz(W.zaproponujZastosowanie({ twId: FTC272, model: BS450, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024" }, warunki: { rokDo: 2018 } }, autor())!);
  const k = kandydat(FTC272)!;
  assert.equal(k.pewnosc, "do_sprawdzenia");
  assert.deepEqual(k.ostrzezenia, ["pasuje warunkowo: rocznik do 2018 silnika — sprawdź z tabliczki silnika"]);
});

test("negatyw przez silnik jest widoczny i cytuje oba dowody", () => {
  dane({ marka: "STIHL", model: "FS 250" });
  zabuduj(BS450);
  zatwierdz(W.zaproponujZastosowanie({ twId: FTC272, model: BS450, polaryzacja: "nie_pasuje",
    powodNegatywny: "tylko_inny_wariant", zrodlo: "reczne", dowod: { rodzaj: "pomiar_wlasny", tresc: "inny gwint" } }, autor())!);
  const { negatywne } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(negatywne.map((n) => n.twId), [FTC272]);
  assert.match(negatywne[0].zrodlo, /nie pasuje do silnik Briggs & Stratton 450E.*stoi w STIHL FS 250/);
});

test("zastosowanie do maszyny i przez silnik: jeden kandydat, drugie zdanie w `takze`", () => {
  dane({ marka: "STIHL", model: "FS 250" });
  zabuduj(BS450);
  zabuduj(HONDA);
  doSilnika(FTC272, BS450);
  zatwierdz(zaproponuj(FTC272));
  const k = kandydaciDoboru(rozmowa, subiekt).kandydaci.filter((x) => x.twId === FTC272);
  assert.equal(k.length, 1);
  assert.equal(k[0].pewnosc, "potwierdzone", "wpis wprost do maszyny nie ma słabego ogniwa");
  assert.match(k[0].powod, /^potwierdzone zastosowanie do STIHL FS 250/);
  assert.ok(k[0].takze.some((t) => /stoi w STIHL FS 250/.test(t)));
});

test("propozycja zabudowy i zabudowa wycofana NIE karmią drogi przez silnik", () => {
  dane({ marka: "STIHL", model: "FS 250" });
  S.zaproponujZabudowe({ maszyna: STIHL, silnik: HONDA, rodzajDowodu: "producent", dowodTresc: "karta", zrodlo: "reczne" }, autor());
  doSilnika(FTC272, HONDA);
  assert.equal(kandydat(FTC272), undefined, "propozycja nie jest wiedzą");
  const zab = zabuduj(BS450);
  doSilnika(ZAMIENNIK_FTC272, BS450);
  assert.equal(kandydat(ZAMIENNIK_FTC272)?.grupa, "wiedza");
  S.wycofajZabudowe(zab.id, "pomyłka: to inna wersja kosiarki", biuro);
  assert.equal(kandydat(ZAMIENNIK_FTC272), undefined);
});

/* ── Pasowanie do kotwicy: scenariusz GX160 z seedu ───────────────────────────
   Gaźniki `W09-0211` ≡ `EX055`, uszczelki `LC170430140-0001` ≡ `06-12038`. */

const pasuje = (czesc: string, doCzego: string, n: Record<string, unknown> = {}) =>
  P.rozstrzygnijPasowanie(P.zaproponujPasowanie({ twId: tw(czesc), doTwId: tw(doCzego), rola: "uszczelka",
    polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog", zrodlo: "reczne", ...n } as never,
  autor())!.id, "zatwierdz", null, biuro);

test("klient nazwał gaźnik: symbol daje kotwicę, wiedza — jego uszczelki wprost i przez zamiennik", () => {
  pasuje("LC170430140-0001", "W09-0211", { pozycja: "od strony filtra" });
  dane({ oem: "W09-0211", nazwaCzesci: "uszczelka" });
  const { kandydaci, kotwice } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(kotwice.map((k) => k.symbol), ["W09-0211"]);
  const wprost = kandydaci.find((k) => k.symbol === "LC170430140-0001")!;
  assert.deepEqual([wprost.grupa, wprost.pewnosc], ["wiedza", "potwierdzone"]);
  assert.match(wprost.powod, /^uszczelka \(od strony filtra\) LC170430140-0001 pasuje do W09-0211 — katalog dostawcy/);
  const przez = kandydaci.find((k) => k.symbol === "06-12038")!;
  assert.equal(przez.pewnosc, "prawdopodobne");
  assert.equal(kandydaci.find((k) => k.symbol === "W09-0211")!.grupa, "numer", "kotwica nie znika z listy");
});

test("kotwica z zamiennika gaźnika: EX055 dziedziczy uszczelki W09-0211 jako prawdopodobne", () => {
  pasuje("LC170430140-0001", "W09-0211");
  dane({ oem: "EX055" });
  const k = kandydat(tw("LC170430140-0001"))!;
  assert.equal(k.pewnosc, "prawdopodobne");
  assert.match(k.powod, /EX055 podaje W09-0211 jako zamiennik/);
});

test("oferta to uszczelka, klient pyta o gaźnik: uszczelka z oferty niesie pewność i zdanie pasowania", () => {
  pasuje("06-12038", "W09-0211");
  pytaniePodOferta("14892374513", "06-12038");
  dane({ oem: "W09-0211" });
  const u = kandydat(tw("06-12038"))!;
  assert.equal(u.grupa, "numer");
  assert.equal(u.pewnosc, "potwierdzone");
  assert.ok(u.takze.some((t) => /pasuje do W09-0211/.test(t)), "dowód pasowania nie znika ze szkicu");
});

test("negatyw pasowania do kotwicy stoi na liście negatywów", () => {
  dane({ oem: "W09-0211" });
  pasuje("170430138-0001", "W09-0211", { polaryzacja: "nie_pasuje", powodNegatywny: "tylko_inny_wariant",
    rodzajDowodu: "pomiar_wlasny", dowodTresc: "inny rozstaw" });
  const { negatywne } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(negatywne.map((n) => n.symbol), ["170430138-0001"]);
  assert.match(negatywne[0].zrodlo, /nie pasuje do W09-0211/);
});

/* ── Podobne: po nazwie ───────────────────────────────────────────────────── */

test("pełny tekst daje „podobne” do sprawdzenia ze zdaniem „nie dowód”", () => {
  dane({ nazwaCzesci: "podkładka przekładni", marka: "STIHL", model: "FS 250" });
  const pt = kandydaciDoboru(rozmowa, subiekt).kandydaci.filter((k) => k.grupa === "podobne");
  assert.ok(pt.length >= 1 && pt.length <= 5, "górna zapora: pięć trafień bm25");
  assert.ok(pt.every((k) => k.pewnosc === "do_sprawdzenia"));
  assert.match(pt[0].powod, /^trafienie po treści kartoteki dla „podkładka przekładni STIHL FS 250” — nie dowód/);
  assert.ok(pt.some((k) => k.twId === FTC272));
});

test("bez FTS5 `brakuje` to mówi, a reszta działa", async () => {
  const { udawajBrakFts } = await import("../db/db.js");
  pytaniePodOferta("14892374512", "FTC272");
  dane({ nazwaCzesci: "podkładka przekładni" });
  udawajBrakFts(true);
  try {
    const { kandydaci, brakuje } = kandydaciDoboru(rozmowa, subiekt);
    assert.ok(brakuje.some((b) => /SQLite bez FTS5/.test(b)));
    assert.equal(kandydaci[0].twId, FTC272);
  } finally {
    udawajBrakFts(false);
  }
});

test("kolejność: grupa, potem pewność, potem dostępność malejąco", () => {
  pytaniePodOferta("14892374512", "FTC272");
  dane({ marka: "STIHL", model: "FS 250", nazwaCzesci: "podkładka przekładni" });
  zatwierdz(zaproponuj(tw("24-04003")));
  const { kandydaci } = kandydaciDoboru(rozmowa, subiekt);
  const grupy = kandydaci.map((k) => k.grupa);
  assert.deepEqual(grupy, [...grupy].sort((a, b) => ["numer", "wiedza", "podobne"].indexOf(a) - ["numer", "wiedza", "podobne"].indexOf(b)));
  const sila = { potwierdzone: 3, prawdopodobne: 2, do_sprawdzenia: 1 };
  for (let i = 1; i < kandydaci.length; i++) {
    const [a, b] = [kandydaci[i - 1], kandydaci[i]];
    if (a.grupa !== b.grupa) continue;
    assert.ok(sila[a.pewnosc] > sila[b.pewnosc] || (sila[a.pewnosc] === sila[b.pewnosc] && (a.stan ?? -1) >= (b.stan ?? -1)),
      `${a.symbol} przed ${b.symbol}`);
  }
  /* Zamiennik z opisu jest do sprawdzenia, ale wiedza go potwierdza — więc
     w swojej grupie wyprzedza kartotekę oferty. */
  assert.equal(kandydaci[0].twId, ZAMIENNIK_FTC272);
});
