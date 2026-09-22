import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szkic-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Copilot: szkic odpowiedzi z faktów (§14.6) ──────────────────────────────
   Na SEEDZIE, jak `pasowania.test.ts`: scenariusz GX160 jest w nim kompletny.
   Pilnujemy czterech rzeczy: co idzie do dostawcy (i czego NIE), że model nie
   ma jak przemycić numeru spoza faktów, że zapis jest jedną transakcją bez
   treści w dzienniku, i że odczyt niczego nie mutuje.                        */

let db: typeof import("../db/db.js").db;
let config: typeof import("../config.js").config;
let S: typeof import("./copilot-szkic.js");
let P: typeof import("./pasowania.js");
let W: typeof import("./wiedza.js");
let D: typeof import("./dobor.js");
let K: typeof import("./copilot-klasyfikacja.js");
let subiekt: typeof import("../context.js").subiekt;
let biuro = 0;
let konto = 0;
let rozmowa = 0;
let pytanie = 0;
const ID: Record<string, number> = {};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ subiekt } = await import("../context.js"));
  S = await import("./copilot-szkic.js");
  P = await import("./pasowania.js");
  W = await import("./wiedza.js");
  D = await import("./dobor.js");
  K = await import("./copilot-klasyfikacja.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  for (const s of ["W09-0211", "LC170430140-0001", "06-12038"]) {
    const w = d.prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(s) as { tw_id: number } | undefined;
    assert.ok(w, `scenariusz GX160 wymaga kartoteki ${s} w seedzie`);
    ID[s] = w.tw_id;
  }
  d.prepare("INSERT OR REPLACE INTO sgt_stan(tw_id,mag_id,stan,stan_rez) VALUES (?,?,5,1)").run(ID["W09-0211"], config.magId.MAG);
  d.prepare("INSERT OR REPLACE INTO sgt_stan(tw_id,mag_id,stan,stan_rez) VALUES (?,?,3,0)").run(ID["LC170430140-0001"], config.magId.MAG);
});

beforeEach(() => {
  const d = db();
  /* `dowod_zastosowania` i `zastosowanie` doszły w 0.341.0: od tego wydania
     wiedza z oferty wchodzi od razu, więc ten plik zostawia po sobie wiersze,
     które trzymają `model_urzadzenia` kluczem obcym. Kolejność jest tu
     TREŚCIĄ, nie porządkiem — dziecko przed rodzicem. */
  for (const t of ["szkic_copilota", "copilot_wywolanie", "towar_identyfikator", "model_z_opisu",
    "dowod_zastosowania", "zastosowanie",
    "alias_silnika", "model_urzadzenia", "pasowanie_czesci", "dobor_rozmowy",
    "conversation_event", "message", "conversation", "offer_snapshot", "allegro_inbox_thread",
    "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')").run().lastInsertRowid);
  const n = "2026-09-07T10:00:00Z";
  /* Login siedzi w WĄTKU Allegro, a temat rozmowy to tytuł oferty — dokładnie
     ten układ, w którym klasyfikacja do 0.230.0 nie maskowała loginu. */
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES ('w-1',1,'zielony_ogrod','{}',?)`).run(n);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','Gaźnik Honda GX160 z kranikiem')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,'of-1','Gaźnik Honda GX160 z kranikiem','W09-0211',?)`).run(konto, n);
  pytanie = Number(d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at,related_object_type,related_object_id)
    VALUES (?,?,'m-1','incoming',?,?,'OFFER','of-1')`)
    .run(rozmowa, konto, "Dzień dobry, tu zielony_ogrod. Mam gaźnik z tej oferty, jaka uszczelka pod filtr? " +
      "Stary numer ABC-1234. Tel 601 234 567", n).lastInsertRowid);
});

const KTO = () => ({ id: biuro, name: "A. Lewandowska" });
const odpowiedz = (n: Partial<import("./copilot-szkic.js").OdpowiedzSzkicu> = {}) => ({
  /* Domyślna odpowiedź cytuje wyłącznie numer, który JEST w faktach (kartoteka
     oferty) — testy sprawdzenia dokładają własne numery świadomie. */
  tresc: "Dzień dobry, gaźnik W09-0211 jest dziś dostępny (F1).",
  /* `daneDoboru: null` domyślnie — testy propozycji dokładają dane świadomie,
     a reszta nie zmienia znaczenia przez sam fakt, że model coś rozpoznał. */
  uzyteFakty: ["F1"], zastrzezenia: [], daneDoboru: null, pasowanie: null, twierdzenia: [],
  odczytZeZdjec: [],
  model: "claude-opus-5", ms: 800,
  zuzycie: { wej: 2000, wyj: 300, cacheZapis: 0, cacheOdczyt: 1500 }, ...n,
});
const nadawca = (n: Partial<import("./copilot-szkic.js").OdpowiedzSzkicu> = {}): import("./copilot-szkic.js").NadawcaSzkicu =>
  async () => odpowiedz(n);
const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;

const zatwierdzPasowanie = () => P.rozstrzygnijPasowanie(P.zaproponujPasowanie({
  twId: ID["LC170430140-0001"], doTwId: ID["W09-0211"], rola: "uszczelka", pozycja: "od strony filtra",
  polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog 2024", zrodlo: "reczne",
}, { userId: biuro, name: "A. Lewandowska" })!.id, "zatwierdz", null, biuro);

/* ── Co idzie do dostawcy ──────────────────────────────────────────────── */

test("luki w kartotece liczy KOD i to na przykładzie właściciela", () => {
  /* Cewka do FS56: oferta wymienia jedenaście modeli, kartoteka zna dwa.
     Dziewięć pozostałych nikt nigdy nie wpisał, bo nikt ich nie zobaczył
     obok siebie — właśnie to ma zaznaczyć ta lista. */
  const luki = S.lukiZOferty({
    parametry: [{ nazwa: "Kod producenta", wartosci: ["4134 400 1306"] }],
    zgodnosc: ["STIHL FS120", "STIHL FS200", "STIHL FS250", "STIHL FR450", "STIHL BT120C"],
    opis: "",
  }, "Kartoteka oferty: W02-0401 — CEWKA ZAPŁONOWA DO STIHL FS120 FS200; EAN brak");

  assert.deepEqual(luki.numery, [{ rodzaj: "oem", wartosc: "4134 400 1306" }]);
  /* CAŁE pozycje, z MARKĄ (0.264.0). Człowiek w kolejce Wiedzy składa klucz
     modelu i bez marki nie ma z czego: `FS250` nie mówi, czyj to model,
     a automat marki nie zgaduje od 0.186.0. */
  assert.deepEqual(luki.modele, ["STIHL FS250", "STIHL FR450", "STIHL BT120C"],
    "kartoteka zna FS120 i FS200, reszta jest okazją do uzupełnienia");
});

test("numer katalogowy z pola parametru zostaje W CAŁOŚCI, nie w kawałkach", () => {
  /* „4134 400 1306" rozbite na trzy liczby przestaje być numerem, po którym
     szuka człowiek. Pole to jedna wartość — czytamy je jako jedną. */
  assert.deepEqual(S.lukiZOferty(
    { parametry: [{ nazwa: "Numer katalogowy", wartosci: ["4134 400 1306"] }], zgodnosc: [], opis: "" },
    "nic").numery, [{ rodzaj: "oem", wartosc: "4134 400 1306" }]);
});

test("pole, które nie obiecuje numeru katalogowego, do tabeli numerów nie wchodzi", () => {
  /* Filtr zapisu MUSI być węższy od dawnego filtru wyświetlania (0.264.0).
     „Moc [KM]: 204" w `towar_identyfikator` znaczy, że pytanie o numer 204
     prowadzi do kosiarki. EAN odpada mimo że jest numerem: ma własny szczebel
     doboru, drugi z jedenastu, i wpisanie go jako `oem` osłabia trafienie. */
  const luki = S.lukiZOferty({
    parametry: [
      { nazwa: "Moc [KM]", wartosci: ["204"] },
      { nazwa: "EAN (GTIN)", wartosci: ["5901234123457"] },
      { nazwa: "Numer katalogowy części oryginalnej", wartosci: ["698083"] },
    ],
    zgodnosc: [], opis: "",
  }, "nic");
  assert.deepEqual(luki.numery, [{ rodzaj: "nr_oryg", wartosc: "698083" }]);
});

test("numery z OPISU oferty wchodzą, ale tylko spod etykiety z dwukropkiem", () => {
  /* Ten sam parser, którym czytamy opisy kartotek. Wymaga etykiety, więc na
     prozie sprzedażowej nie znajduje nic — a to jest cała jego obrona przed
     wciągnięciem numeru telefonu z podpisu sprzedawcy. */
  const luki = S.lukiZOferty({ parametry: [], zgodnosc: [],
    opis: "Najlepszy filtr w tej cenie, 12345678 sztuk sprzedanych. OEM: 698083 // 794422",
  }, "nic");
  assert.deepEqual(luki.numery.map((n) => n.wartosc), ["698083", "794422"]);
});

test("rok i sama liczba nie są oznaczeniem części", () => {
  /* Bez tego każda oferta motoryzacyjna zgłaszałaby zakres lat jako brak. */
  const luki = S.lukiZOferty(
    { parametry: [], zgodnosc: ["CITROËN C6 (TD_) 2005/09-2011/12 204KM/150kW"], opis: "" }, "nic");
  assert.deepEqual(luki.modele, ["CITROËN C6 (TD_) 2005/09-2011/12 204KM/150kW"],
    "pozycja wraca w całości — wykrywa ją token z literą, nie sam zakres lat");
  assert.deepEqual(luki.numery, [], "zdanie zgodności to nie jest numer katalogowy");
});

test("oznaczenie zapisane inaczej niż w kartotece nie jest brakiem", () => {
  /* „STIHL FS 120" i „FS120" to ten sam model. Porównanie po `zwin`, tak jak
     przy danych doboru — inaczej spacja sprzedawcy robiłaby fałszywy brak. */
  assert.deepEqual(S.lukiZOferty(
    { parametry: [], zgodnosc: ["STIHL FS 120"], opis: "" }, "CEWKA DO FS120").modele, []);
});

test("luki NIE wchodzą do faktów, bo to zdanie o nas, nie o maszynie klienta", () => {
  db().prepare(`UPDATE offer_snapshot SET pasuje_do_json=?,
      tresc_synced_at='2026-09-10T10:00:00Z' WHERE external_id='of-1'`)
    .run(JSON.stringify(["HONDA GX160", "HONDA GX999"]));

  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.ok(k.luki.modele.some((m) => m.includes("GX999")), "brak nie został policzony");
  const f = String(k.tekstFaktow);
  assert.equal(/brak w kartotece|luk|uzupełni/i.test(f), false,
    "lista braków poszła do modelu — ma ją widzieć wyłącznie agent");
});

test("treść oferty wchodzi do faktów i mówi o sobie, że jest słowem SPRZEDAWCY", () => {
  /* Właściciel: „często oferta ma w sobie opis, do jakich wersji pasuje,
     wymiary z oferty, dane techniczne". Fakt musi jednak nieść też to, że
     opis bywa starszy od towaru — inaczej model zrówna go z kartoteką. */
  db().prepare(`UPDATE offer_snapshot SET opis=?, parametry_json=?, pasuje_do_json=?,
      tresc_synced_at='2026-09-10T10:00:00Z' WHERE external_id='of-1'`)
    .run("Uszczelka o średnicy 46 mm, wysokość 12 mm.",
      JSON.stringify([{ nazwa: "Kod producenta", wartosci: ["16211-ZE1-000"] }]),
      JSON.stringify(["HONDA GX160", "HONDA GX200"]));

  const f = String(S.kontekstSzkicu(rozmowa, subiekt).tekstFaktow);
  assert.match(f, /średnicy 46 mm/);
  assert.match(f, /SŁOWA SPRZEDAWCY/, "opis nie mówi, skąd pochodzi");
  assert.match(f, /rację ma kartoteka/, "brak rozstrzygnięcia sporu opisu z kartoteką");
  assert.match(f, /Kod producenta: 16211-ZE1-000/);
  assert.match(f, /HONDA GX160 \| HONDA GX200/);
});

test("długa lista zgodności wchodzi przycięta i mówi, ile jej było", () => {
  const wersje = Array.from({ length: 214 }, (_, i) => `HONDA GX${100 + i}`);
  db().prepare("UPDATE offer_snapshot SET pasuje_do_json=? WHERE external_id='of-1'")
    .run(JSON.stringify(wersje));

  const f = String(S.kontekstSzkicu(rozmowa, subiekt).tekstFaktow);
  assert.match(f, /lista ma 214 pozycji, to są pierwsze 30/);
  assert.equal(f.includes("HONDA GX313"), false, "cała lista weszła do promptu");
});

test("uszkodzony JSON w snapshocie nie wywraca faktów", () => {
  db().prepare("UPDATE offer_snapshot SET parametry_json='to nie jest json' WHERE external_id='of-1'").run();
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.ok(k.fakty.length > 0);
  assert.equal(k.fakty.some((x) => x.rodzaj === "oferta_parametry"), false);
});

test("fakty niosą kartotekę oferty z dostępnością, pasowanie z pozycją i intake — bez nazwiska i loginu", () => {
  zatwierdzPasowanie();
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const f = String(k.tekstFaktow);
  assert.match(f, /Kartoteka oferty: W09-0211/);
  assert.match(f, /dostępne dziś: 4/, "stan minus rezerwacja, jak w wstawce parametrów");
  assert.match(f, /LC170430140-0001 pasuje do W09-0211/);
  assert.match(f, /od strony filtra/);
  assert.match(f, /katalog dostawcy, \d{1,2}\.\d{2}\.\d{4}/, "podpis dowodu z datą");
  assert.equal(f.includes("A. Lewandowska"), false, "nazwisko pracownika wyszło w faktach");
  assert.equal(f.includes("Lewandowska"), false);
  assert.equal(/zielony_ogrod/i.test(f), false, "login w faktach");
  assert.equal(/rezerwac|półk|regał/i.test(f), false, "półka albo rezerwacje w faktach (§10.4)");
  assert.ok(k.fakty.some((x) => x.rodzaj === "intake"), "bez potwierdzonego wyboru fakty niosą pytania intake");
  /* Typ części bierze się z DANYCH DOBORU, nie z treści pytania (blizna szarpaka) — tu ich nie ma. */
  assert.match(f, /zapytaj klienta TYLKO o to, czego w rozmowie jeszcze nie podał \(część\)/);
});

test("wątek idzie w całości, zamaskowany, z loginem z WĄTKU Allegro, nie z tematu", () => {
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-2','outgoing','Dzień dobry zielony_ogrod, sprawdzam gaźnik.','2026-09-07T11:00:00Z')`).run(rozmowa, konto);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const w = String(k.watek);
  assert.match(w, /^KLIENT: /);
  assert.match(w, /\nMY: /, "nasza odpowiedź też idzie — cały wątek");
  assert.equal(/zielony_ogrod/i.test(w), false, "login wyszedł mimo maskowania");
  assert.match(w, /\[login\]/);
  assert.equal(w.includes("601"), false, "telefon wyszedł");
  assert.match(w, /jaka uszczelka pod filtr/);
  assert.equal(k.ostatniaWiadomoscId, pytanie, "świeżość liczy się na ostatniej wiadomości KLIENTA");
});

test("fakt danych doboru niesie kanoniczny silnik ze słownika, gdy alias istnieje", async () => {
  const Sl = await import("./silniki.js");
  D.zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450", silnik: "Lonci v200" }, 1, biuro);
  let f = S.kontekstSzkicu(rozmowa, subiekt).fakty.find((x) => x.rodzaj === "dobor")!;
  assert.match(f.zdanie, /silnik Lonci v200(?!\s*\(wg)/);
  Sl.dodajAliasSilnika({ tekst: "Lonci v200", silnik: { rodzaj: "silnik", marka: "Loncin", nazwa: "V200" } },
    { userId: biuro, name: "A. Lewandowska" });
  f = S.kontekstSzkicu(rozmowa, subiekt).fakty.find((x) => x.rodzaj === "dobor")!;
  assert.match(f.zdanie, /silnik Lonci v200 \(wg słownika: silnik Loncin V200\)/);
});

test("intake milknie, gdy agent wybrał kandydata z potwierdzonym dowodem", () => {
  zatwierdzPasowanie();
  const w1 = D.zapiszDane(rozmowa, { oem: "W09-0211", nazwaCzesci: "uszczelka" }, D.doborRozmowy(rozmowa).wersja, biuro);
  D.wybierzKandydata(rozmowa, ID["LC170430140-0001"], "pasowanie", w1.wersja, biuro);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.equal(k.fakty.some((x) => x.rodzaj === "intake"), false, "przy dowodzie w bazie pytania o wymiary udawałyby niewiedzę");
  assert.match(String(k.tekstFaktow), /Część wybrana przez agenta: Do W09-0211 pasuje LC170430140-0001/);
  assert.match(String(k.tekstFaktow), /Dane doboru wpisane przez agenta: .*numer OEM lub symbol W09-0211/);
});

test("intake dobiera pytania po nazwie części z danych doboru", () => {
  D.zapiszDane(rozmowa, { nazwaCzesci: "nóż" }, D.doborRozmowy(rozmowa).wersja, biuro);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const i = k.fakty.find((x) => x.rodzaj === "intake")!;
  assert.match(i.zdanie, /\(nóż\)/);
  assert.match(i.zdanie, /otworu centralnego/);
  assert.deepEqual(S.pytaniaIntake("filtr powietrza").typ, "filtr");
  assert.deepEqual(S.pytaniaIntake(null).typ, "część");
});

test("kontekst niczego nie zapisuje", () => {
  /* Także po 0.264.0, i to jest tu treść, nie formalność. Zapis wiedzy
     z oferty wisi na `ulozSzkic`, czyli na kliknięciu, gdzie zapis i tak był.
     Przeniesienie go do `kontekstSzkicu` sprawiłoby, że SAMO OTWARCIE rozmowy
     mutuje bazę wiedzy — to jest blizna 0.18.0 z gorszą ceną. */
  db().prepare("UPDATE offer_snapshot SET pasuje_do_json=?, tresc_synced_at='2026-09-10T10:00:00Z' WHERE external_id='of-1'")
    .run(JSON.stringify(["HONDA GX999"]));
  const przed = [liczba("events"), liczba("copilot_wywolanie"), liczba("szkic_copilota"),
    liczba("conversation_event"), liczba("towar_identyfikator"), liczba("model_z_opisu")];
  S.kontekstSzkicu(rozmowa, subiekt);
  S.kontekstSzkicu(rozmowa, subiekt);
  assert.deepEqual([liczba("events"), liczba("copilot_wywolanie"), liczba("szkic_copilota"),
    liczba("conversation_event"), liczba("towar_identyfikator"), liczba("model_z_opisu")], przed);
});

/* ── Linki do naszych aktywnych aukcji (0.270.0) ─────────────────────────── */

test("link do NASZEJ oferty wchodzi do faktów, z numeracją biegnącą dalej", () => {
  /* Do 0.269.0 model nie dostawał ani jednego adresu, więc zamiast wskazać
     ofertę pisał klientowi, żeby poszukał po nazwie albo po EAN-ie. Fakt
     dokłada się PO `kontekstSzkicu`, bo wymaga sieci — a numeracja musi biec
     dalej, bo „F12" w odwołaniu modelu ma znaczyć jedno zdanie, nie dwa. */
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const symbol = [...k.kartoteki.values()][0].symbol;
  const z = S.dopiszLinkiOfert(k, new Map([[symbol.toLowerCase().replace(/[^a-z0-9]/g, ""), {
    symbol, ofertaId: "12345", nazwa: "Gaźnik Honda GX160 z kranikiem",
    link: "https://allegro.pl/oferta/12345",
  }]]));

  assert.equal(z.fakty.length, k.fakty.length + 1);
  const nowy = z.fakty[z.fakty.length - 1];
  assert.equal(nowy.id, `F${k.fakty.length + 1}`, "numeracja ma biec dalej, nie od nowa");
  assert.equal(nowy.rodzaj, "oferta_link");
  assert.match(nowy.zdanie, /NASZA AKTYWNA OFERTA na kartotekę/);
  assert.match(nowy.zdanie, /https:\/\/allegro\.pl\/oferta\/12345/);
  /* Bez półpauzy: `copilot.anthropic.ts` przyznaje, że zakaz myślnika jest
     najsłabszą regułą, bo model czyta nasz tekst jako wzorzec. */
  assert.doesNotMatch(nowy.zdanie, /—/, "fakt uczy modelu półpauzy");
  assert.equal(String(z.tekstFaktow).includes(nowy.zdanie), true, "fakt ma dojechać do modelu");
});

test("brak linku to CISZA, nie zdanie zachęcające do zgadywania", () => {
  /* Pusta mapa nie dokłada niczego i oddaje ten sam obiekt. „Nie wiemy
     o aktywnej aukcji" nie ma prawa wyglądać jak zaproszenie. */
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.equal(S.dopiszLinkiOfert(k, new Map()), k);
  /* Kartoteka spoza białej listy też nic nie wnosi. */
  const obca = S.dopiszLinkiOfert(k, new Map([["czegotuniema", {
    symbol: "XX-0000", ofertaId: "1", nazwa: "n", link: "https://allegro.pl/oferta/1",
  }]]));
  assert.equal(obca.fakty.length, k.fakty.length);
});

test("odmowa Allegro przy linkach NIE przerywa szkicu", async () => {
  /* W testach konto Allegro jest niepołączone, więc `ofertyPoSygnaturze`
     odmawia przy każdym z tych wywołań — a szkic i tak ma powstać. To jest
     ta różnica wobec `dociagnijTresc`: tam limit przerywa, bo chroni przed
     drugim żądaniem, a tu żadnego drugiego już nie ma. */
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  assert.ok(s.tresc.length > 0);
  assert.equal(liczba("szkic_copilota"), 1);
});

/* ── Wiedza z oferty przestaje ginąć razem z rozmową (0.264.0) ───────────── */

const zOferty = (pasujeDo: string[], opis = "") => db().prepare(
  `UPDATE offer_snapshot SET pasuje_do_json=?, opis=?, tresc_synced_at='2026-09-10T10:00:00Z'
   WHERE external_id='of-1'`).run(JSON.stringify(pasujeDo), opis);

test("wiedza z oferty zostaje w bazie, choć dostawca ODMÓWIŁ — to cała treść wydania", async () => {
  /* Za nieudanym szkicem stoi jedno kliknięcie i agent kliknie ponownie.
     Za utratą tych numerów nie stoi nic: opis oferty jest cache'em na tydzień,
     nadpisywanym, a `przebudujIdentyfikatory` czyta opisy KARTOTEK. Dlatego
     zapis idzie PRZED wywołaniem modelu, nie po nim. */
  zOferty(["HONDA GX999"], "OEM: 16100-ZH8-W61");
  const odmowa: import("./copilot-szkic.js").NadawcaSzkicu =
    async () => { throw new Error("dostawca odmówił"); };

  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), odmowa, subiekt));

  const numer = db().prepare(
    "SELECT zrodlo, dodal, oferta_id FROM towar_identyfikator WHERE wartosc='16100-ZH8-W61'")
    .get() as Record<string, unknown> | undefined;
  assert.ok(numer, "numer z opisu oferty miał zostać mimo odmowy dostawcy");
  assert.equal(numer!.zrodlo, "oferta");
  assert.equal(numer!.oferta_id, "of-1");
  assert.equal(liczba("model_z_opisu"), 1, "pozycja zgodności miała trafić do kolejki Wiedzy");
  assert.equal(liczba("szkic_copilota"), 0, "szkic ma nie powstać — odmowa to odmowa");
});

test("numer zapisany przy pierwszym szkicu przestaje być luką przy drugim", async () => {
  /* Samowygaszanie zamiast paska postępu. Do 0.263.0 pasek liczył tę samą
     listę od zera przy każdym kliknięciu: system zauważał lukę za każdym
     razem i za każdym razem o niej zapominał. */
  zOferty(["HONDA GX999"], "OEM: 16100-ZH8-W61");
  const pierwszy = await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  assert.deepEqual(pierwszy.lukiKartoteki.numery, [{ rodzaj: "oem", wartosc: "16100-ZH8-W61" }]);
  assert.deepEqual(pierwszy.lukiKartoteki.modele, ["HONDA GX999"]);
  assert.equal(pierwszy.lukiKartoteki.symbol, "W09-0211", "pokwitowanie bez kartoteki jest zdaniem bez podmiotu");
  assert.equal(pierwszy.lukiKartoteki.czeka, 1);

  const drugi = await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  assert.deepEqual(drugi.lukiKartoteki.numery, [], "zapisane przestało być luką");
  assert.deepEqual(drugi.lukiKartoteki.modele, []);
  assert.equal(drugi.lukiKartoteki.czeka, 1, "licznik kolejki to stan, nie przyrost — widać go i tak");
  assert.equal(liczba("towar_identyfikator"), 1, "drugie kliknięcie nie mnoży wierszy");
});

test("bez PEWNEJ kartoteki oferty nie zapisujemy NIC", async () => {
  /* Numer wpisany do CUDZEJ kartoteki jest najdroższą awarią tego wydania,
     bo wraca do klienta jako zły towar. Domysł po nazwie wystarcza, żeby
     pokazać kartotekę obok oferty, ale nie żeby dopisać jej cudzy numer. */
  db().prepare("UPDATE offer_snapshot SET sku=NULL WHERE external_id='of-1'").run();
  zOferty(["HONDA GX999"], "OEM: 16100-ZH8-W61");

  /* Treść bez numeru kartoteki: bez SKU nie ma faktu o kartotece, więc
     domyślny szkic wywróciłby się na sprawdzeniu numerów, a nie na tym, o co
     tu chodzi. */
  const s = await S.ulozSzkic(rozmowa, KTO(),
    nadawca({ tresc: "Dzień dobry, proszę o numer z tabliczki (F1).", uzyteFakty: ["F1"] }), subiekt);

  assert.equal(liczba("towar_identyfikator"), 0, "oferta bez SKU nie wskazuje kartoteki");
  assert.equal(liczba("model_z_opisu"), 0);
  assert.deepEqual(s.lukiKartoteki, { symbol: null, numery: [], modele: [], wpisane: [], czeka: 0 });
});

test("szkic sprzed 0.264.0 czyta się jako lista MODELI, bez dorabiania rodzaju", () => {
  /* Gołą tablicę zostawiły szkice z 0.254.0 i była listą OZNACZEŃ. Dorobienie
     im `rodzaju` byłoby zmyśleniem danych o tym, czym te oznaczenia są. */
  db().prepare(`INSERT INTO szkic_copilota(conversation_id,tresc,zastrzezenia,uzyte_fakty,model,at,przez,
    przez_user_id,luki_kartoteki) VALUES (?,'x','[]','[]','m','2026-09-01T00:00:00Z','Ala',?,?)`)
    .run(rozmowa, biuro, JSON.stringify(["FS250", "FR450"]));
  const s = S.szkicCopilota(rozmowa)!;
  /* `wpisane` pusta i to jest o tamtych szkicach PRAWDA: wiedza z ofert
     zaczęła wchodzić od razu dopiero w 0.341.0. Dorobienie im niepustej listy
     byłoby zmyśleniem tak samo jak dorobienie rodzaju. */
  assert.deepEqual(s.lukiKartoteki,
    { symbol: null, numery: [], modele: ["FS250", "FR450"], wpisane: [], czeka: 0 });
});

test("odwołania (F…) znikają z treści PO sprawdzeniu, uzyteFakty zostaje", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Gaźnik W09-0211 pasuje (F1). Dziś dostępny (F1, F2) .", uzyteFakty: ["F1"],
  }), subiekt);
  assert.equal(s.tresc, "Gaźnik W09-0211 pasuje. Dziś dostępny.");
  assert.deepEqual(s.uzyteFakty, ["F1"]);
  assert.equal(S.bezZnacznikow("bez odwołań"), "bez odwołań");
});

/* ── Sprawdzenie deterministyczne ──────────────────────────────────────── */

test("ścieżka szczęśliwa: wiersz, księga „szkic”, zdarzenie bez treści, ślad na osi", async () => {
  zatwierdzPasowanie();
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Dzień dobry, do gaźnika W09-0211 pasuje uszczelka LC170430140-0001 (F3).", uzyteFakty: ["F1", "F3"],
  }), subiekt);
  assert.match(s.tresc, /LC170430140-0001/);
  assert.equal(s.messageId, pytanie);
  assert.equal(s.ocena, null);
  assert.equal(liczba("szkic_copilota"), 1);
  const ks = db().prepare("SELECT zadanie, wynik, tokeny_cache_odczyt FROM copilot_wywolanie").get() as Record<string, unknown>;
  assert.equal(ks.zadanie, "szkic");
  assert.equal(ks.wynik, "ok");
  assert.equal(Number(ks.tokeny_cache_odczyt), 1500);
  const zd = db().prepare("SELECT payload FROM events WHERE type='copilot_szkic'").get() as { payload: string };
  assert.equal(zd.payload.includes("Dzień dobry"), false, "treść szkicu w dzienniku (§19)");
  assert.match(zd.payload, /znakow/);
  const os = db().prepare("SELECT payload FROM conversation_event WHERE event_type='copilot_szkic'").get() as { payload: string };
  assert.equal(os.payload.includes("Dzień dobry"), false, "treść na osi — oś niesie tylko metadane");
  assert.deepEqual(S.szkicCopilota(rozmowa)?.uzyteFakty, ["F1", "F3"]);
});

test("numer BEZ deklaracji źródła odrzuca szkic: księga notuje błąd, wiersza nie ma", async () => {
  /* Do 0.252.0 odrzucał tu sam fakt, że numeru nie ma w bazie. Od 0.253.0
     odrzuca CISZA: model wolno sięgnąć do własnej wiedzy, ale nie wolno mu
     podać numeru, którego agent nie ma jak sprawdzić przed wysłaniem. */
  await assert.rejects(
    S.ulozSzkic(rozmowa, KTO(), nadawca({ tresc: "Pasuje uszczelka XYZ-9999 (F1)." }), subiekt),
    (e: Error) => /XYZ-9999/.test(e.message) && /odrzucony/.test(e.message));
  assert.equal(liczba("szkic_copilota"), 0);
  const ks = db().prepare("SELECT wynik, blad FROM copilot_wywolanie").get() as Record<string, string>;
  assert.equal(ks.wynik, "blad");
  assert.match(ks.blad, /^numer_niezadeklarowany: XYZ-9999/);
});

test("ten sam numer Z DEKLARACJĄ przechodzi i ląduje w oknie „skąd to wiem”", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Pasuje uszczelka XYZ-9999 (F1).",
    twierdzenia: [{
      teza: "Uszczelka XYZ-9999 bywa stosowana w tej serii gaźników",
      zrodlo: "model", odwolanie: null, pewnosc: "prawdopodobne",
    }],
  }), subiekt);
  assert.match(s.tresc, /XYZ-9999/);
  assert.equal(s.twierdzenia.length, 1);
  /* Model chciał „prawdopodobne", ale mówił z pamięci — serwer obniża. */
  assert.equal(s.twierdzenia[0].pewnosc, "niepewne");
  assert.equal(s.twierdzenia[0].obnizona, true);
});

test("pewność nie przeskoczy sufitu źródła, a w dół model może zawsze", () => {
  const f = S.ustalPewnosc({ teza: "W09-0211 jest na stanie", zrodlo: "fakty", odwolanie: "F1", pewnosc: "pewne" });
  assert.equal(f.pewnosc, "pewne");
  assert.equal(f.obnizona, false);

  /* Opis oferty to słowa sprzedawcy sprzed lat — najwyżej „prawdopodobne". */
  const o = S.ustalPewnosc({ teza: "Pasuje do 340", zrodlo: "oferta", odwolanie: "F4", pewnosc: "pewne" });
  assert.equal(o.pewnosc, "prawdopodobne");
  assert.equal(o.obnizona, true);

  /* Zejście niżej niż sufit to uczciwość, nie błąd — zostaje jak było. */
  const w = S.ustalPewnosc({ teza: "Zwykle ma gwint M10", zrodlo: "oferta", odwolanie: null, pewnosc: "niepewne" });
  assert.equal(w.pewnosc, "niepewne");
  assert.equal(w.obnizona, false);
});

test("twierdzenie bez tezy wypada, bo pusty wiersz wygląda na urwaną informację", () => {
  const l = S.ocenTwierdzenia([
    { teza: "  ", zrodlo: "fakty", odwolanie: "F1", pewnosc: "pewne" },
    { teza: "Gaźnik jest na stanie", zrodlo: "fakty", odwolanie: "F1", pewnosc: "pewne" },
  ]);
  assert.equal(l.length, 1);
  assert.equal(l[0].teza, "Gaźnik jest na stanie");
});

test("numer, który KLIENT napisał w rozmowie, wolno powtórzyć", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Numer ABC-1234, o którym Pan pisze, nie jest w naszej bazie; proszę o zdjęcie tabliczki (F1).",
  }), subiekt);
  assert.match(s.tresc, /ABC-1234/);
});

test("numery bez cyfr i miary nie są numerami — zwykłe słowa przechodzą", () => {
  assert.deepEqual(S.numerySpozaFaktow("Proszę o zdjęcie NOŻA i pomiar 148 mm — GX160 pasuje.", "F1: GX160"), []);
  assert.deepEqual(S.numerySpozaFaktow("Pasuje 17211-ZL8-023 i 5901234567890.", "F1: nic"), ["17211-ZL8-023", "5901234567890"]);
});

test("fakt spoza listy i za długi szkic też są odrzucane z zapisem w księdze", async () => {
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), nadawca({ uzyteFakty: ["F99"] }), subiekt), /F99/);
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), nadawca({ tresc: "x".repeat(2001), uzyteFakty: [] }), subiekt), /2000/);
  assert.equal(liczba("szkic_copilota"), 0);
  const b = db().prepare("SELECT blad FROM copilot_wywolanie ORDER BY id").all() as Array<{ blad: string }>;
  assert.match(b[0]!.blad, /^fakt_spoza_listy/);
  assert.match(b[1]!.blad, /^za_dlugi/);
});

test("odmowa dostawcy ląduje w księdze jako błąd i idzie dalej do trasy", async () => {
  const { BladPrzeciazeniaCopilota } = await import("../adapters/copilot.js");
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), async () => {
    throw new BladPrzeciazeniaCopilota("Anthropic jest chwilowo przeciążone (529).", 529, "overloaded_error 529 req_1");
  }, subiekt), BladPrzeciazeniaCopilota);
  const ks = db().prepare("SELECT wynik, blad FROM copilot_wywolanie").get() as Record<string, string>;
  assert.equal(ks.wynik, "blad");
  assert.match(ks.blad, /overloaded_error 529 req_1/, "do księgi idzie ślad, nie zdanie");
});

/* ── Cykl życia propozycji ─────────────────────────────────────────────── */

test("drugi szkic nadpisuje pierwszy i zeruje ocenę; ocena spoza listy odmawia", async () => {
  await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  assert.deepEqual(S.ocenSzkic(rozmowa, "wstawiony", KTO()), { ocena: "wstawiony" });
  assert.equal(S.szkicCopilota(rozmowa)?.ocena, "wstawiony");
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ tresc: "Druga wersja (F1)." }), subiekt);
  assert.equal(liczba("szkic_copilota"), 1, "jeden wiersz na rozmowę");
  assert.equal(S.szkicCopilota(rozmowa)?.ocena, null, "nowa propozycja — stara ocena jej nie dotyczy");
  assert.throws(() => S.ocenSzkic(rozmowa, "super", KTO()), /wstawiony/);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE type='copilot_szkic_ocena'").get());
});

test("szkic nie rusza statusu, wersji ani szkicu AGENTA", async () => {
  const { zapiszSzkic } = await import("./conversations.js");
  zapiszSzkic(rozmowa, biuro, "mój własny szkic", pytanie, null);
  const przed = db().prepare("SELECT status, version FROM conversation WHERE id=?").get(rozmowa);
  await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  assert.deepEqual(db().prepare("SELECT status, version FROM conversation WHERE id=?").get(rozmowa), przed);
  assert.equal((db().prepare("SELECT body FROM conversation_draft WHERE conversation_id=?").get(rozmowa) as { body: string }).body,
    "mój własny szkic", "propozycja modelu nie ma prawa dotknąć szkicu agenta");
});

test("pomiar rozbija księgę po zadaniu i liczy odrzucenia, nie wstawienia", async () => {
  await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  S.ocenSzkic(rozmowa, "zastapiony", KTO());
  const p = K.pomiarCopilota(db());
  const sz = p.wgZadania.find((z) => z.zadanie === "szkic");
  assert.ok(sz, "brak zadania „szkic” w rozbiciu");
  assert.equal(sz.wywolan, 1);
  assert.ok(sz.kosztUsd > 0);
  assert.deepEqual(p.szkice, {
    ile: 1, odrzuconych: 0,
    daneZaproponowane: 0, daneWpisane: 0, daneOdrzucone: 0,
    pasowaniaRozpoznane: 0, pasowaniaZaproponowane: 0, pasowaniaOdrzucone: 0, pasowaniaZatwierdzonePrzezBiuro: 0,
    /* Los przy wysyłce (22 września 2026) — tu nic nie wysłano. */
    wyslanychBezZmian: 0, wyslanychPoprawionych: 0,
  });
});

/* ── Dane doboru z rozmowy (przyrost trzeci) ───────────────────────────────
   Pytanie właściciela z 8.09.2026: „dlaczego dane wejściowe nie zostały
   wprowadzone automatycznie ze szkicu?". Pilnujemy czterech granic: wartość
   spoza rozmowy wypada (model nie może DOPISAĆ), wartość zamaskowana nie
   wraca, samo ułożenie NIE dotyka `dobor_rozmowy`, a kliknięcie wpisuje
   WYŁĄCZNIE w puste pola i idzie drogą ręcznego zapisu (wersja, 409). */

const DANE = (n: Partial<import("./dobor.js").DaneDoboru> = {}): import("./dobor.js").DaneDoboru => ({
  marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null,
  silnik: null, oem: null, nazwaCzesci: null, parametry: {}, ...n,
});

const dopiszKlienta = (tresc: string) => db().prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,?,'incoming',?,?)`)
  .run(rozmowa, konto, `m-${Date.now()}-${Math.random()}`, tresc, "2026-09-08T09:00:00Z");

test("wartość z rozmowy zostaje, zmyślona wypada — po zwinięciu numeru i po rdzeniu słowa", () => {
  const w = "KLIENT: Mam kosiarkę Faworyt GTV51N196L-4W1 z silnikiem Lonci v200, szukam śrubę do noża. OEM 532 19 93-77.";
  assert.equal(S.wartoscZRozmowy("Faworyt", w), true);
  assert.equal(S.wartoscZRozmowy("GTV51N196L-4W1", w), true);
  assert.equal(S.wartoscZRozmowy("Lonci v200", w), true);
  assert.equal(S.wartoscZRozmowy("śruba noża", w), true, "odmiana: „śrubę do noża” pokrywa „śruba noża”");
  assert.equal(S.wartoscZRozmowy("532199377", w), true, "„532 19 93-77” to ten sam numer po zwinięciu");
  /* Rdzeń czterech liter przepuszcza „Loncin" przy „Lonci" w rozmowie — to
     zapisana cena reguły odmiany, nie zaproszenie: instrukcja każe pisać
     dosłownie, a poprawia agent. */
  assert.equal(S.wartoscZRozmowy("Loncin", w), true);
  assert.equal(S.wartoscZRozmowy("Husqvarna", w), false, "marki nie ma w rozmowie");
  assert.equal(S.wartoscZRozmowy("GTV51N196L-4W2", w), false, "inny numer");
  assert.equal(S.wartoscZRozmowy("", w), false);
  const p = S.oczyscPropozycje(DANE({ marka: "Faworyt", model: "GX160", nazwaCzesci: "śruba noża",
    parametry: { "klucz": "16", "długość": "50 mm" } }), w + " Klucz 16.");
  assert.deepEqual(p.dane, DANE({ marka: "Faworyt", nazwaCzesci: "śruba noża", parametry: { klucz: "16" } }));
  assert.equal(p.odrzuconych, 2, "GX160 i „50 mm” nie stoją w rozmowie");
  assert.deepEqual(S.oczyscPropozycje(DANE({ model: "GX160" }), w), { dane: null, odrzuconych: 1 });
  assert.deepEqual(S.oczyscPropozycje(null, w), { dane: null, odrzuconych: 0 });
});

/* ── UMOWA ZMIENIŁA SIĘ W 0.341.0 ────────────────────────────────────────────
   Do 0.338.0 ten test nazywał się „…i NIE dotyka doboru", a `liczba(...)===0`
   była jego sednem: propozycja czekała na kliknięcie agenta. Właściciel:
   „dane wejściowe po rozpoznaniu powinny wchodzić automatycznie".

   Co z tamtej umowy ZOSTAŁO i dalej jest tu pilnowane: wartość spoza rozmowy
   nie wchodzi nigdzie, a dziennik nie niesie wartości.                      */
test("ułożenie WPISUJE rozpoznane dane do doboru, bez kliknięcia agenta", async () => {
  dopiszKlienta("Kosiarka Faworyt GTV51N196L-4W1, silnik Lonci v200, szukam śruby noża.");
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    daneDoboru: DANE({ marka: "Faworyt", model: "GTV51N196L-4W1", silnik: "Lonci v200",
      nazwaCzesci: "śruba noża", oem: "17211-ZL8-023" }),
  }), subiekt);
  assert.deepEqual(s.daneDoboru, DANE({ marka: "Faworyt", model: "GTV51N196L-4W1", silnik: "Lonci v200",
    nazwaCzesci: "śruba noża" }), "OEM spoza rozmowy wypadł, reszta została");
  assert.equal(s.daneOcena, "wpisane", "nie ma już czego klikać");
  assert.equal(liczba("dobor_rozmowy"), 1);

  const d = D.doborRozmowy(rozmowa);
  assert.deepEqual(d.dane, DANE({ marka: "Faworyt", model: "GTV51N196L-4W1", silnik: "Lonci v200",
    nazwaCzesci: "śruba noża" }), "OEM spoza rozmowy nie wszedł także tutaj");
  assert.equal(d.status, "searching", "wpis danych rusza dobór z miejsca, jak ręczny");
  /* Szkic pamięta wersję PO wpisie. Odwrotna kolejność dałaby szkic nieświeży
     w chwili narodzin — ekran mówiłby „ułóż ponownie" o własnej zmianie. */
  assert.equal(s.doborWersja, d.wersja);

  /* PODPIS MASZYNY: `updated_by` z nazwą automatu przy PUSTYM koncie. To
     jedyny znacznik, po którym agent pozna, skąd wzięła się wartość w polu. */
  const w = db().prepare(
    "SELECT updated_by, updated_user_id FROM dobor_rozmowy WHERE conversation_id=?")
    .get(rozmowa) as Record<string, unknown>;
  assert.equal(w.updated_by, "automat (szkic)");
  assert.equal(w.updated_user_id, null);
  const zd = db().prepare("SELECT payload FROM events WHERE type='copilot_szkic'").get() as { payload: string };
  assert.match(zd.payload, /"polDoboru":4/);
  assert.match(zd.payload, /"polOdrzuconych":1/);
  assert.equal(zd.payload.includes("Faworyt"), false, "wartość w dzienniku (§19)");
});

test("wartość zamaskowana nie wraca do danych — telefon podany jako numer seryjny wypada", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    daneDoboru: DANE({ nrSeryjny: "601 234 567", nazwaCzesci: "uszczelka" }),
  }), subiekt);
  assert.deepEqual(s.daneDoboru, DANE({ nazwaCzesci: "uszczelka" }));
});

test("automat wpisuje TYLKO w puste pola — słowo agenta zostaje nietknięte", async () => {
  dopiszKlienta("Kosiarka Faworyt GTV51N196L-4W1, silnik Lonci v200, klucz 16.");
  /* Agent wpisał model sam, inaczej niż widzi go model. To jest ta jedna
     rzecz, której automatowi nie wolno ruszyć: nadpisanie pola wpisanego ręką
     byłoby jedyną zmianą, której agent nie cofnie bez pamiętania, co tam było. */
  D.zapiszDane(rozmowa, { model: "GTV51" }, 1, biuro);
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    daneDoboru: DANE({ marka: "Faworyt", model: "GTV51N196L-4W1", silnik: "Lonci v200", parametry: { klucz: "16" } }),
  }), subiekt);

  const d = D.doborRozmowy(rozmowa);
  assert.deepEqual(d.dane,
    DANE({ marka: "Faworyt", model: "GTV51", silnik: "Lonci v200", parametry: { klucz: "16" } }),
    "model agenta zostaje, reszta dochodzi");
  assert.equal(s.daneOcena, "wpisane");
  assert.equal(s.doborWersja, d.wersja);

  /* Drugie kliknięcie nie ma już czego wpisać i mówi to wprost. */
  assert.throws(() => S.przyjmijDaneDoboru(rozmowa, d.wersja, KTO()), /już oceniona/);

  const typy = (db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>).map((e) => e.type);
  assert.ok(typy.includes("dobor_dane"), "wpis idzie tą samą drogą co ręczny, z dziennikiem");
  const zapis = db().prepare(
    "SELECT payload FROM events WHERE type='dobor_dane' ORDER BY id DESC").get() as { payload: string };
  assert.equal(zapis.payload.includes("GTV51N196L-4W1"), false, "wartości w dzienniku nie ma (§19)");
});

test("odrzucenie zostaje dla propozycji, której automat NIE miał gdzie wpisać", async () => {
  /* Po 0.341.0 odrzucenie ma sens wyłącznie wtedy, gdy nic nie weszło —
     czyli gdy wszystkie pola były już zajęte. Odrzucanie wartości, która stoi
     w doborze, byłoby przyciskiem obiecującym cofnięcie, którego nie robi;
     agent poprawia takie pole tam, gdzie ono stoi, w zakładce Dobór. */
  dopiszKlienta("Kosiarka Faworyt.");
  D.zapiszDane(rozmowa, { marka: "Stiga" }, 1, biuro);
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({ daneDoboru: DANE({ marka: "Faworyt" }) }), subiekt);
  assert.equal(s.daneOcena, null, "nic nie weszło, więc jest co ocenić");
  assert.equal(D.doborRozmowy(rozmowa).dane.marka, "Stiga");

  assert.equal(S.odrzucDaneDoboru(rozmowa, KTO()).daneOcena, "odrzucone");
  assert.equal(K.pomiarCopilota(db()).szkice.daneOdrzucone, 1);
  assert.throws(() => S.odrzucDaneDoboru(rozmowa + 1000, KTO()), /nie ma propozycji/);
});

/* ── Pasowanie z rozmowy (przyrost czwarty) ─────────────────────────────────
   Zapowiedź z 0.230.0. Pilnujemy trzech granic właściciela: oba końce pary
   muszą być kartotekami, które serwer SAM położył na stole (biała lista
   z kontekstu — nigdy symbol z treści wiadomości), para wypada bez szkody
   dla szkicu, a do kolejki wiedzy wchodzi dopiero na kliknięcie agenta,
   jako propozycja ze źródłem `copilot`, którą rozstrzyga biuro. */

const PARA = (n: Partial<import("./copilot-szkic.js").PasowanieZRozmowy> = {}) =>
  ({ czesc: "LC170430140-0001", doCzego: "W09-0211", rola: "uszczelka", pozycja: null, ...n });

test("biała lista kartotek: oferta zawsze, kotwica po wpisaniu symbolu przez agenta — kontekst nic nie zapisuje", () => {
  let k = S.kontekstSzkicu(rozmowa, subiekt);
  const ma = (sym: string) => [...k.kartoteki.values()].some((x) => x.symbol === sym);
  assert.equal(ma("W09-0211"), true, "kartoteka oferty stoi na liście");
  assert.equal(ma("LC170430140-0001"), false, "uszczelki nikt jeszcze nie wskazał");
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  const przed = liczba("events");
  k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.equal(ma("LC170430140-0001"), true, "symbol wpisany przez agenta jest kotwicą, więc i kartoteką z kontekstu");
  assert.equal(liczba("events"), przed, "kontekst niczego nie zapisuje");
});

test("sprawdzPasowanie: symbole po zwinięciu, cztery powody odrzucenia, pozycja tylko z rozmowy", () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const w = String(k.watek);
  const ok = S.sprawdzPasowanie(PARA({ czesc: "lc 170430140-0001", doCzego: "w09 0211" }), k.kartoteki, w);
  assert.equal(ok.powod, null);
  assert.equal(ok.propozycja!.czesc.twId, ID["LC170430140-0001"], "symbol trafia po zwinięciu, jak wszędzie");
  assert.equal(ok.propozycja!.doCzego.twId, ID["W09-0211"]);
  assert.equal(ok.propozycja!.rola, "uszczelka");
  assert.equal(S.sprawdzPasowanie(PARA({ czesc: "06-12038" }), k.kartoteki, w).powod, "symbol_spoza_kontekstu",
    "uszczelka z seedu, ale NIE z kontekstu — model nie ma jak jej nazwać");
  assert.equal(S.sprawdzPasowanie(PARA({ czesc: "W09-0211" }), k.kartoteki, w).powod, "ta_sama_kartoteka");
  assert.equal(S.sprawdzPasowanie(PARA({ rola: "kolo" }), k.kartoteki, w).powod, "zla_rola");
  assert.equal(S.sprawdzPasowanie(null, k.kartoteki, w).powod, null);
  /* Pozycja: „od strony filtra" stoi w fakcie intake, nie w rozmowie — wypada, para zostaje. */
  const bez = S.sprawdzPasowanie(PARA({ pozycja: "od strony filtra" }), k.kartoteki, w);
  assert.equal(bez.propozycja!.pozycja, null);
  dopiszKlienta("Chodzi o uszczelkę od strony filtra.");
  const z = S.sprawdzPasowanie(PARA({ pozycja: "od strony filtra" }), k.kartoteki, String(S.kontekstSzkicu(rozmowa, subiekt).watek));
  assert.equal(z.propozycja!.pozycja, "od strony filtra");
  /* Para już żywa w bazie — w dowolnej polaryzacji — wypada. */
  zatwierdzPasowanie();
  assert.equal(S.sprawdzPasowanie(PARA(), k.kartoteki, w).powod, "juz_jest");
});

test("ułożenie zapisuje parę przy szkicu i NIE dotyka pasowań; para spoza kontekstu wypada, szkic zostaje", async () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA() }), subiekt);
  assert.deepEqual(s.pasowanie, {
    czesc: { twId: ID["LC170430140-0001"], symbol: "LC170430140-0001", nazwa: "Uszczelka do gaźników GX160 (od strony filtra)" },
    doCzego: { twId: ID["W09-0211"], symbol: "W09-0211", nazwa: "Gaźnik do silników HONDA GX160 z kranikiem i odsto" },
    rola: "uszczelka", pozycja: null,
  });
  assert.equal(s.pasowanieOcena, null);
  assert.equal(liczba("pasowanie_czesci"), 0, "samo ułożenie nic nie wkłada do kolejki wiedzy");
  let zd = db().prepare("SELECT payload FROM events WHERE type='copilot_szkic' ORDER BY id DESC").get() as { payload: string };
  assert.match(zd.payload, /"pasowanie":1/);
  assert.match(zd.payload, /"pasowanieOdrzucone":null/);
  const bez = await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA({ czesc: "06-12038" }) }), subiekt);
  assert.equal(bez.pasowanie, null);
  assert.equal(bez.tresc.length > 0, true, "szkic jest wart pieniędzy sam w sobie");
  zd = db().prepare("SELECT payload FROM events WHERE type='copilot_szkic' ORDER BY id DESC").get() as { payload: string };
  assert.match(zd.payload, /"pasowanieOdrzucone":"symbol_spoza_kontekstu"/);
  assert.equal(zd.payload.includes("06-12038"), false, "symbol w dzienniku (§19)");
});

test("„Zaproponuj pasowanie”: propozycja ze źródłem copilot, dowodem rozmowa i podpisem agenta; rozstrzyga biuro", async () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  dopiszKlienta("Chodzi o uszczelkę od strony filtra.");
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA({ pozycja: "od strony filtra" }) }), subiekt);
  const po = S.przyjmijPasowanie(rozmowa, KTO());
  assert.equal(po.pasowanieOcena, "zaproponowane");
  const kolejka = P.kolejkaPasowan().propozycje;
  assert.equal(kolejka.length, 1);
  const z = kolejka[0]!;
  assert.equal(z.zrodlo, "copilot");
  assert.equal(z.rodzajDowodu, "rozmowa");
  assert.equal(z.pewnosc, "prawdopodobne", "ślad rozmowy nie jest dowodem technicznym");
  assert.equal(z.conversationId, rozmowa);
  assert.equal(z.zaproponowal, "A. Lewandowska", "autorem jest klikający, nie automat");
  assert.equal(z.pozycja, "od strony filtra");
  assert.match(z.dowodTresc, /^Copilot rozpoznał w rozmowie #\d+: LC170430140-0001 pasuje do W09-0211 \(od strony filtra\)/);
  const typy = (db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>).map((e) => e.type);
  assert.ok(typy.includes("pasowanie_propozycja") && typy.includes("copilot_pasowanie"));
  const los = db().prepare("SELECT payload FROM events WHERE type='copilot_pasowanie'").get() as { payload: string };
  assert.match(los.payload, /"dubel":false/);
  assert.throws(() => S.przyjmijPasowanie(rozmowa, KTO()), /już oceniona/);
  assert.throws(() => S.odrzucPasowanie(rozmowa, KTO()), /już oceniona/);
  let pomiar = K.pomiarCopilota(db()).szkice;
  assert.equal(pomiar.pasowaniaRozpoznane, 1);
  assert.equal(pomiar.pasowaniaZaproponowane, 1);
  assert.equal(pomiar.pasowaniaZatwierdzonePrzezBiuro, 0);
  P.rozstrzygnijPasowanie(z.id, "zatwierdz", null, biuro);
  pomiar = K.pomiarCopilota(db()).szkice;
  assert.equal(pomiar.pasowaniaZatwierdzonePrzezBiuro, 1, "właściwa miara: biuro zatwierdza to, co Copilot widzi");
});

test("dubel nie jest błędem: para wpisana ręcznie między szkicem a kliknięciem daje ocenę bez drugiego wiersza", async () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA() }), subiekt);
  P.zaproponujPasowanie({ twId: ID["LC170430140-0001"], doTwId: ID["W09-0211"], rola: "uszczelka",
    polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog", zrodlo: "reczne" },
    { userId: biuro, name: "A. Lewandowska" });
  const po = S.przyjmijPasowanie(rozmowa, KTO());
  assert.equal(po.pasowanieOcena, "zaproponowane");
  assert.equal(liczba("pasowanie_czesci"), 1, "drugiego wiersza nie ma");
  const los = db().prepare("SELECT payload FROM events WHERE type='copilot_pasowanie'").get() as { payload: string };
  assert.match(los.payload, /"dubel":true/);
});

test("odrzucenie pary zostawia wiersz dla pomiaru; nowy szkic zeruje ocenę pary", async () => {
  D.zapiszDane(rozmowa, { oem: "LC170430140-0001" }, 1, biuro);
  await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA() }), subiekt);
  assert.equal(S.odrzucPasowanie(rozmowa, KTO()).pasowanieOcena, "odrzucone");
  assert.equal(liczba("pasowanie_czesci"), 0);
  assert.equal(K.pomiarCopilota(db()).szkice.pasowaniaOdrzucone, 1);
  const znow = await S.ulozSzkic(rozmowa, KTO(), nadawca({ pasowanie: PARA() }), subiekt);
  assert.equal(znow.pasowanieOcena, null);
  assert.throws(() => S.przyjmijPasowanie(rozmowa + 1000, KTO()), /nie ma propozycji pasowania/);
});

test("rozmowa bez wiadomości nie ma na co odpowiadać", async () => {
  db().prepare("DELETE FROM message").run();
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt), /żadnej wiadomości/);
  assert.equal(liczba("copilot_wywolanie"), 0, "bez wiadomości nic nie kosztuje");
});

/* ── Zdjęcia z rozmowy idą do modelu ──────────────────────────────────────────
   Wydanie ma jeden fundament, bez którego reszta jest ozdobą: odczyt ze
   zdjęcia MUSI móc przejść przez `numerySpozaFaktow`. Tabliczka znamionowa to
   sama numeracja, więc gdyby odczyt nie był materiałem do cytowania, każde
   UDANE odczytanie kasowałoby własny szkic. Druga strona tej samej monety jest
   równie ważna: skoro odczyt otwiera drogę numerom, to numer zdjęcia musi być
   sprawdzony, inaczej pole jest furtką na dowolną liczbę.                    */

/* Prawdziwa sygnatura PNG — bramka czyta BAJTY, nie nazwę pliku. */
const PNG_BAJTY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Wiesza zdjęcie na ostatniej PRZYCHODZĄCEJ wiadomości badanej rozmowy. */
function powieszZdjecie(nazwa: string, status = "SAFE") {
  const m = db().prepare(
    `SELECT id FROM message WHERE conversation_id=? AND direction='incoming'
      ORDER BY sent_at DESC, id DESC LIMIT 1`).get(rozmowa) as { id: number };
  db().prepare(`INSERT INTO message_attachment(message_id,file_name,mime_type,url,status)
    VALUES (?,?,?,?,?)`).run(m.id, nazwa, "image/png", `https://allegro.pl/plik/${nazwa}`, status);
}

const pobierzPng = async () => PNG_BAJTY.buffer.slice(
  PNG_BAJTY.byteOffset, PNG_BAJTY.byteOffset + PNG_BAJTY.byteLength) as ArrayBuffer;

/** Nadawca, który zapamiętuje, co dostał. */
function szpieg(n: Partial<import("./copilot-szkic.js").OdpowiedzSzkicu> = {}) {
  const widziane: { zdjecia: unknown[]; fakty: string } = { zdjecia: [], fakty: "" };
  const nadaj: import("./copilot-szkic.js").NadawcaSzkicu = async (_w, fakty, zdjecia = []) => {
    widziane.zdjecia = zdjecia;
    widziane.fakty = String(fakty);
    return odpowiedz(n);
  };
  return { widziane, nadaj };
}

test("zdjęcie z rozmowy jedzie do modelu, a jego spis stoi w FAKTACH", async () => {
  powieszZdjecie("tabliczka.png");
  const s = szpieg();
  await S.ulozSzkic(rozmowa, KTO(), s.nadaj, subiekt, new Date(), pobierzPng);

  assert.equal(s.widziane.zdjecia.length, 1);
  assert.equal((s.widziane.zdjecia[0] as { numer: string }).numer, "Z1");
  /* Spis idzie do FAKTÓW, nie do wątku: wątek to tekst klienta i po to
     przeszedł przez maskowanie, żeby nic naszego się w nim nie znalazło. */
  assert.ok(s.widziane.fakty.includes("[Z1] plik: tabliczka.png"));
});

test("rozmowa bez zdjęć nie wychodzi po bajty i dostaje pusty spis", async () => {
  const s = szpieg();
  let pobran = 0;
  await S.ulozSzkic(rozmowa, KTO(), s.nadaj, subiekt, new Date(),
    async () => { pobran += 1; return pobierzPng(); });

  assert.equal(pobran, 0);
  assert.equal(s.widziane.zdjecia.length, 0);
  assert.ok(!s.widziane.fakty.includes("ZDJĘCIA"), "zdanie o niczym kosztuje tokeny");
});

/* Numer z tabliczki, który NAPRAWDĘ wpada w odsiew. `NUMER` wymaga czterech
   znaków i cyfry, więc „PBRM", „39" i „E4" mu się wymykają — sprawdzenie na
   nich byłoby testem, który przechodzi także bez poprawki. IAN ma sześć cyfr
   i jest dokładnie tym, o co tu chodzi: numerem, po którym szuka się części. */
const IAN = "508992";

test("numer ODCZYTANY z tabliczki przechodzi przez odsiew — to jest cały sens wydania", async () => {
  powieszZdjecie("tabliczka.png");
  const s = await S.ulozSzkic(rozmowa, KTO(), szpieg({
    tresc: `Dzień dobry, z tabliczki odczytujemy numer ${IAN} (F1).`,
    uzyteFakty: ["F1"],
    odczytZeZdjec: [{ zdjecie: "Z1", tekst: `PARKSIDE PBRM 39 E4, IAN ${IAN}_2507, 131 cm3` }],
    twierdzenia: [{
      teza: `Na tabliczce stoi numer ${IAN}`, zrodlo: "zdjecie",
      odwolanie: "Z1", pewnosc: "prawdopodobne",
    }],
  }).nadaj, subiekt, new Date(), pobierzPng);

  assert.ok(s.tresc.includes(IAN));
  assert.deepEqual(s.odczytZeZdjec, [
    { zdjecie: "Z1", tekst: `PARKSIDE PBRM 39 E4, IAN ${IAN}_2507, 131 cm3` },
  ]);
});

test("odczyt powołany na zdjęcie, którego NIE wysłaliśmy, wywraca cały szkic", async () => {
  powieszZdjecie("tabliczka.png");
  /* To jest jedyny znany sposób przemycenia numeru wziętego z niczego:
     dopisz zmyślony odczyt i schowaj w nim dowolną liczbę. Dlatego wywraca,
     a nie filtruje po cichu. */
  await assert.rejects(
    S.ulozSzkic(rozmowa, KTO(), szpieg({
      odczytZeZdjec: [{ zdjecie: "Z7", tekst: "numer katalogowy 99999999" }],
    }).nadaj, subiekt, new Date(), pobierzPng),
    /zdjęcie Z7/);
  assert.equal(liczba("szkic_copilota"), 0, "odrzucony szkic nie zostaje w bazie");
});

test("dane doboru wolno wziąć z tabliczki, ale tylko przez zadeklarowany odczyt", async () => {
  powieszZdjecie("tabliczka.png");
  const s = await S.ulozSzkic(rozmowa, KTO(), szpieg({
    tresc: "Dzień dobry, potwierdzamy (F1).", uzyteFakty: ["F1"],
    odczytZeZdjec: [{ zdjecie: "Z1", tekst: "PARKSIDE PBRM 39 E4" }],
    daneDoboru: {
      marka: "PARKSIDE", model: "PBRM 39 E4", wariant: null, rocznik: null,
      nrSeryjny: null, silnik: null, oem: null, nazwaCzesci: null, parametry: {},
    },
  }).nadaj, subiekt, new Date(), pobierzPng);

  assert.equal(s.daneDoboru?.model, "PBRM 39 E4");
  assert.equal(s.daneDoboru?.marka, "PARKSIDE");
});

test("wartość, której nie ma ANI w rozmowie, ANI w odczycie, dalej odpada", async () => {
  powieszZdjecie("tabliczka.png");
  /* Sprawdzenie zostaje deterministyczne. Zdjęcia poszerzyły materiał
     o odczyt, nie zniosły reguły — inaczej `daneDoboru` karmiłyby szczeble
     doboru wartościami, których nikt nigdy nie widział. */
  const s = await S.ulozSzkic(rozmowa, KTO(), szpieg({
    tresc: "Dzień dobry, potwierdzamy (F1).", uzyteFakty: ["F1"],
    odczytZeZdjec: [{ zdjecie: "Z1", tekst: "PARKSIDE PBRM 39 E4" }],
    daneDoboru: {
      marka: null, model: "STIGA COMBI 48", wariant: null, rocznik: null,
      nrSeryjny: null, silnik: null, oem: null, nazwaCzesci: null, parametry: {},
    },
  }).nadaj, subiekt, new Date(), pobierzPng);

  assert.equal(s.daneDoboru, null, "model spoza rozmowy i spoza odczytu nie przechodzi");
});

test("twierdzenie ze zdjęcia nie może być PEWNE — tabliczka to nie nasza baza", () => {
  /* Sufit ma dwa powody i żaden nie znika przy ostrym zdjęciu: litery mylą
     się z cyframi, a z tego, że tabliczkę widać, nie wynika, że to tabliczka
     maszyny, o którą klient pyta. */
  const t = S.ustalPewnosc({
    teza: "model to PBRM 39 E4", zrodlo: "zdjecie", odwolanie: "Z1", pewnosc: "pewne",
  });
  assert.equal(t.pewnosc, "prawdopodobne");
  assert.equal(t.obnizona, true);
});

test("załącznik UNSAFE nie jedzie do dostawcy nawet wtedy, gdy jest obrazem", async () => {
  powieszZdjecie("podejrzany.png", "UNSAFE");
  const s = szpieg();
  let pobran = 0;
  await S.ulozSzkic(rozmowa, KTO(), s.nadaj, subiekt, new Date(),
    async () => { pobran += 1; return pobierzPng(); });

  assert.equal(pobran, 0, "Allegro uznało plik za niebezpieczny — nie wiemy lepiej");
  assert.equal(s.widziane.zdjecia.length, 0);
});

test("ten sam numer BEZ zadeklarowanego odczytu dalej wywraca szkic", async () => {
  powieszZdjecie("tabliczka.png");
  /* Dowód, że test wyżej mierzy poprawkę, a nie pobożne życzenie: identyczna
     treść bez `odczytZeZdjec` ma paść na tym samym odsiewie, co przed tym
     wydaniem. Zdjęcia nie zniosły reguły „numer albo ze źródła, albo wcale" —
     dały jej jedno źródło więcej, sprawdzalne i widoczne dla agenta. */
  await assert.rejects(
    S.ulozSzkic(rozmowa, KTO(), szpieg({
      tresc: `Dzień dobry, z tabliczki odczytujemy numer ${IAN} (F1).`,
      uzyteFakty: ["F1"],
    }).nadaj, subiekt, new Date(), pobierzPng),
    /nie mówiąc, skąd go ma/);
});

/* ── Wiedza z ofert wskakuje bez agenta (0.341.0) ────────────────────────────
   Właściciel: „wiedza z ofert powinna wskakiwać bez potwierdzania przez
   agenta". Numery robiły to od 0.264.0; pozycje listy zgodności czekały
   w kolejce, bo w wierszu stoi goły tekst bez marki.

   Granica, która tu została i jest pilnowana niżej: automat NIE ZGADUJE
   MARKI. Wiersz, przy którym trzy źródła deterministyczne milczą, zostaje
   w kolejce — pusty klucz byłby gorszy od braku klucza.                     */

/* POZYCJA MUSI BYĆ LUKĄ, żeby w ogóle trafić do kolejki: `lukiZOferty` uznaje
   za lukę dopiero tę, która ma token z CYFRĄ I LITERĄ naraz. „NAC LS 46-450"
   nie ma takiego tokenu („46-450" to same cyfry) i nie dociera tu wcale —
   pierwsza wersja tych testów sprawdzała ścieżkę, w którą dane nie wchodzą.
   „STIHL FS450" ma „FS450" i jest właściwym materiałem. */
test("pozycja zgodności ze ZNANĄ marką wchodzi do wiedzy od razu, podpisana automatem", async () => {
  /* „STIHL" przeszło już przez człowieka przy innym modelu, więc odczytanie
     go z początku tekstu nie jest zgadywaniem. */
  W.upewnijModel({ rodzaj: "maszyna", marka: "STIHL", nazwa: "MS 170" },
    { userId: biuro, name: "A. Lewandowska" });
  zOferty(["STIHL FS450"]);

  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  assert.deepEqual(s.lukiKartoteki.wpisane, ["STIHL FS450"]);
  assert.deepEqual(s.lukiKartoteki.modele, [], "wiersz wpisany nie jest „odłożony do kolejki”");

  const z = db().prepare(
    `SELECT stan, zrodlo_propozycji, rozstrzygnal, rozstrzygnal_user_id FROM zastosowanie`)
    .get() as Record<string, unknown>;
  assert.equal(z.stan, "zatwierdzone", "wiedza z oferty nie czeka na kliknięcie");
  assert.equal(z.zrodlo_propozycji, "oferta");
  assert.equal(z.rozstrzygnal, "automat (oferta)");
  assert.equal(z.rozstrzygnal_user_id, null, "pusty user_id to znacznik wpisu maszyny");
});

test("pozycja bez rozpoznawalnej marki ZOSTAJE w kolejce — automat nie zgaduje", async () => {
  /* Żadnego modelu w bazie, więc lista znanych marek jest pusta i wszystkie
     trzy źródła milczą. Pusty klucz byłby gorszy od braku klucza. */
  zOferty(["FS450"]);
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);

  assert.deepEqual(s.lukiKartoteki.wpisane, []);
  assert.deepEqual(s.lukiKartoteki.modele, ["FS450"]);
  assert.equal(s.lukiKartoteki.czeka, 1);
  assert.equal(liczba("zastosowanie"), 0);
});

test("drugie ułożenie nie mnoży wiedzy z tej samej oferty", async () => {
  W.upewnijModel({ rodzaj: "maszyna", marka: "STIHL", nazwa: "MS 170" },
    { userId: biuro, name: "A. Lewandowska" });
  zOferty(["STIHL FS450"]);

  await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);
  const drugi = await S.ulozSzkic(rozmowa, KTO(), nadawca(), subiekt);

  assert.deepEqual(drugi.lukiKartoteki.wpisane, [], "drugi przebieg nie ma czego wpisać");
  assert.equal(liczba("zastosowanie"), 1, "jedna para, jeden wiersz");
});

/* ── Rozpoznanie w faktach szkicu (22 września 2026) ────────────────────────
   Szkic był szyty pod dobór i prosił o tabliczkę także klienta, który pytał
   o paczkę. Teraz dostaje rozpoznanie jako fakt — przypuszczenie, nie źródło. */

function rozpoznaj(kategoria: string, akcja: string, n: { wymaga?: number; brakZam?: number } = {}) {
  db().prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,status,
    kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,taksonomia_wersja,
    polityka_wersja,at,przez) VALUES (?,?,1,1,'MODEL','SUCCESS',?,?,?,?,0,'v2','p1','2026-09-07T10:01:00Z','automat')`)
    .run(rozmowa, pytanie, kategoria, akcja, n.wymaga ?? 0, n.brakZam ?? 0);
}

test("rozpoznanie wchodzi do faktów, a pytanie o paczkę nie dostaje intake o maszynę", () => {
  rozpoznaj("ORDER_STATUS", "GET_SHIPMENT", { wymaga: 1, brakZam: 1 });
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const r = k.fakty.find((f) => f.rodzaj === "rozpoznanie");
  assert.match(String(r?.zdanie), /ORDER_STATUS; następny krok: GET_SHIPMENT/);
  assert.match(String(r?.zdanie), /brakuje danych zamówienia/);
  assert.match(String(r?.zdanie), /nie obiecuj rozstrzygnięcia/);
  assert.equal(k.fakty.some((f) => f.rodzaj === "intake"), false);
});

test("przy doborze intake zostaje obok rozpoznania", () => {
  rozpoznaj("PRODUCT_COMPATIBILITY", "CHECK_COMPATIBILITY");
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.ok(k.fakty.some((f) => f.rodzaj === "rozpoznanie"));
  assert.ok(k.fakty.some((f) => f.rodzaj === "intake"));
});

test("rozpoznanie starszej wiadomości nie wchodzi — opisuje pytanie, którego już nie ma", () => {
  rozpoznaj("ORDER_STATUS", "GET_SHIPMENT");
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-2','incoming','A jednak pytam o uszczelkę','2026-09-07T11:00:00Z')`).run(rozmowa, konto);
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.equal(k.fakty.some((f) => f.rodzaj === "rozpoznanie"), false);
});

test("twierdzenie oparte na rozpoznaniu schodzi do „niepewne” ze źródłem model", () => {
  const fakty = [{ id: "F1", rodzaj: "kartoteka" as const, zdanie: "x" },
    { id: "F2", rodzaj: "rozpoznanie" as const, zdanie: "y" }];
  const [a, b] = S.zRozpoznaniaNiepewne([
    { teza: "towar jest", zrodlo: "fakty", odwolanie: "F1", pewnosc: "pewne", obnizona: false },
    { teza: "klient pyta o paczkę", zrodlo: "fakty", odwolanie: "F2", pewnosc: "pewne", obnizona: false },
  ], fakty);
  assert.equal(a.pewnosc, "pewne");
  assert.equal(b.pewnosc, "niepewne");
  assert.equal(b.zrodlo, "model");
  assert.equal(b.obnizona, true);
});
