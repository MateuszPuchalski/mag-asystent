import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szkic-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Copilot: szkic odpowiedzi z faktów (§14.6) ──────────────────────────────
   Na SEEDZIE: scenariusz GX160 jest w nim kompletny.
   Pilnujemy czterech rzeczy: co idzie do dostawcy (i czego NIE), że model nie
   ma jak przemycić numeru spoza faktów, że zapis jest jedną transakcją bez
   treści w dzienniku, i że odczyt niczego nie mutuje.                        */

let db: typeof import("../db/db.js").db;
let config: typeof import("../config.js").config;
let S: typeof import("./copilot-szkic.js");
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
  /* Kolejność to dziecko przed rodzicem, bo klucze obce. */
  for (const t of ["szkic_copilota", "copilot_wywolanie", "towar_identyfikator",
    "conversation_event", "message", "conversation", "offer_snapshot", "allegro_inbox_thread",
    "zamowienie_klienta", "channel_account", "events", "app_user"]) {
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
  uzyteFakty: ["F1"], zastrzezenia: [], twierdzenia: [],
  odczytZeZdjec: [],
  model: "claude-opus-5", ms: 800,
  zuzycie: { wej: 2000, wyj: 300, cacheZapis: 0, cacheOdczyt: 1500 }, ...n,
});
const nadawca = (n: Partial<import("./copilot-szkic.js").OdpowiedzSzkicu> = {}): import("./copilot-szkic.js").NadawcaSzkicu =>
  async () => odpowiedz(n);
const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;

/* ── Co idzie do dostawcy ──────────────────────────────────────────────── */

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

test("fakty niosą kartotekę oferty z dostępnością i intake — bez nazwiska i loginu", () => {
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const f = String(k.tekstFaktow);
  assert.match(f, /Kartoteka oferty: W09-0211/);
  assert.match(f, /dostępne dziś: 4/, "stan minus rezerwacja, jak w wstawce parametrów");
  assert.equal(f.includes("A. Lewandowska"), false, "nazwisko pracownika wyszło w faktach");
  assert.equal(f.includes("Lewandowska"), false);
  assert.equal(/zielony_ogrod/i.test(f), false, "login w faktach");
  assert.equal(/rezerwac|półk|regał/i.test(f), false, "półka albo rezerwacje w faktach (§10.4)");
  assert.ok(k.fakty.some((x) => x.rodzaj === "intake"), "pytanie pod ofertą niesie pytania intake");
  assert.deepEqual([...new Set(k.fakty.map((x) => x.rodzaj))].sort(),
    ["intake", "kartoteka", "oferta"], "fakty mówią wyłącznie o tym, co serwer wie");
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

test("intake dobiera pytania po typie części z tytułu NASZEJ oferty, nie z treści pytania", () => {
  /* Klient pisze o uszczelce pod gaźnikiem z oferty; typ bierze się z tytułu
     oferty, bo to jedyna nazwa części, którą zna serwer, a nie klient. */
  let i = S.kontekstSzkicu(rozmowa, subiekt).fakty.find((x) => x.rodzaj === "intake")!;
  assert.match(i.zdanie, /\(gaźnik lub uszczelka\)/);
  db().prepare("UPDATE offer_snapshot SET nazwa='Nóż do kosiarki 46 cm' WHERE external_id='of-1'").run();
  i = S.kontekstSzkicu(rozmowa, subiekt).fakty.find((x) => x.rodzaj === "intake")!;
  assert.match(i.zdanie, /\(nóż\)/);
  assert.match(i.zdanie, /otworu centralnego/);
  assert.deepEqual(S.pytaniaIntake("filtr powietrza").typ, "filtr");
  assert.deepEqual(S.pytaniaIntake(null).typ, "część");
});

test("kontekst niczego nie zapisuje", () => {
  /* Kontekst składa się przy otwarciu rozmowy, a otwarcie niczego nie
     mutuje. Zapisy wiszą na `ulozSzkic`, czyli na kliknięciu. */
  db().prepare("UPDATE offer_snapshot SET pasuje_do_json=?, tresc_synced_at='2026-09-10T10:00:00Z' WHERE external_id='of-1'")
    .run(JSON.stringify(["HONDA GX999"]));
  const przed = [liczba("events"), liczba("copilot_wywolanie"), liczba("szkic_copilota"),
    liczba("conversation_event"), liczba("towar_identyfikator")];
  S.kontekstSzkicu(rozmowa, subiekt);
  S.kontekstSzkicu(rozmowa, subiekt);
  assert.deepEqual([liczba("events"), liczba("copilot_wywolanie"), liczba("szkic_copilota"),
    liczba("conversation_event"), liczba("towar_identyfikator")], przed);
});

test("rozmowa z nienadanym zamówieniem dostaje fakt o realizacji z werdyktem „wyślemy dziś”", () => {
  /* Klient pyta „czy wyjdzie dziś?". Bez tego faktu szkic znał tylko
     „Allegro nie ma numeru przesyłki" i odpowiadał „sprawdzamy". */
  db().prepare("UPDATE message SET related_order_id='ord-1' WHERE id=?").run(pytanie);
  db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,realizacja_status,
    nadanie_do,synced_at) VALUES (?,'ord-1','READY_FOR_PROCESSING','PROCESSING','2026-10-06T15:00:00Z',
    '2026-10-06T07:00:00Z')`).run(konto);
  const k = S.kontekstSzkicu(rozmowa, subiekt, new Date("2026-10-06T08:00:00Z"));
  const fakt = k.fakty.find((f) => f.rodzaj === "realizacja");
  assert.ok(fakt, "brak faktu o realizacji");
  assert.match(fakt.zdanie, /wyślemy ją dziś/);
});

test("ułożenie szkicu odświeża stare zamówienie, zanim złoży fakty", async () => {
  /* Ticker czyta zamówienie raz, przy pierwszej wiadomości. Bez odświeżenia
     szkic stałby na płatności i terminie sprzed godzin. */
  db().prepare("UPDATE message SET related_order_id='ord-1' WHERE id=?").run(pytanie);
  db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,synced_at)
    VALUES (?,'ord-1','FILLED_IN','2026-10-05T07:00:00Z')`).run(konto);
  const wolane: string[] = [];
  let fakty = "";
  await S.ulozSzkic(rozmowa, KTO(), async (w, f, z) => { fakty = String(f); return nadawca()(w, f, z); },
    subiekt, new Date("2026-10-06T08:00:00Z"), undefined, {
      apiUrl: "https://api.test", teraz: () => "2026-10-06T08:00:00Z",
      query: async (url) => {
        wolane.push(url);
        if (url.endsWith("/order/checkout-forms/ord-1")) {
          return { id: "ord-1", status: "READY_FOR_PROCESSING",
            delivery: { time: { dispatch: { to: "2026-10-06T15:00:00Z" } } }, lineItems: [] };
        }
        return { shipments: [] };
      },
    });
  assert.ok(wolane.some((u) => u.endsWith("/order/checkout-forms/ord-1")), "zamówienie nieodświeżone");
  assert.match(fakty, /wyślemy ją dziś/);
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
  const s = await S.ulozSzkic(rozmowa, KTO(), nadawca({
    tresc: "Dzień dobry, gaźnik W09-0211 jest dziś dostępny (F2).", uzyteFakty: ["F1", "F2"],
  }), subiekt);
  assert.match(s.tresc, /W09-0211/);
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
  assert.deepEqual(S.szkicCopilota(rozmowa)?.uzyteFakty, ["F1", "F2"]);
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
    /* Los przy wysyłce (22 września 2026) — tu nic nie wysłano. */
    wyslanychBezZmian: 0, wyslanychPoprawionych: 0,
  });
});

test("pomiar podaje czas czekania na model: mediana i p90 po zadaniu, błąd bez czasu odpada", () => {
  /* 0.532.0. Księga zapisywała `ms` od początku, a nikt go nie czytał. */
  db().prepare("DELETE FROM copilot_wywolanie").run();
  const wpisz = db().prepare(`INSERT INTO copilot_wywolanie(zadanie,model,ms,wynik) VALUES (?,'m',?,?)`);
  for (const ms of [1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 30_000]) wpisz.run("szkic", ms, "ok");
  wpisz.run("szkic", null, "blad");
  wpisz.run("klasyfikacja", 800, "ok");
  const p = K.pomiarCopilota(db());
  const sz = p.wgZadania.find((z) => z.zadanie === "szkic")!;
  assert.equal(sz.wywolan, 11);
  assert.equal(sz.medianaMs, 5_500);
  assert.equal(sz.p90Ms, 9_000, "najbliższa ranga: dziewiąta z dziesięciu");
  assert.equal(p.wgZadania.find((z) => z.zadanie === "klasyfikacja")!.p90Ms, 800);
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
  /* Wzorzec odpowiedzi dla kategorii (23 września 2026) stoi w tym samym fakcie. */
  assert.match(String(r?.zdanie), /jak odpowiedzieć: podaj stan zamówienia i przesyłki/);
  assert.equal(k.fakty.some((f) => f.rodzaj === "intake"), false);
});

test("przy pytaniu o towar intake zostaje obok rozpoznania", () => {
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

/* ── Przesyłka w faktach szkicu (23 września 2026) ──────────────────────────
   Klient pytający pod zamówieniem pyta najczęściej „gdzie paczka". Pilnujemy
   trzech decyzji: fakt stoi tylko po sprawdzeniu (milczenie zamiast zgadywania),
   numer przesyłki NIE idzie do dostawcy modelu, a Allegro pytamy wyłącznie
   z układania szkicu — kontekst zostaje czystym odczytem. */

function podZamowieniem(stan: Record<string, string | null> = {}) {
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    sent_at,related_order_id) VALUES (?,?,'m-z','incoming','Kiedy dojdzie paczka?','2026-09-07T12:00:00Z','ord-9')`)
    .run(rozmowa, konto);
  return Number(db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at,
    przesylka_waybill,przesylka_przewoznik,przesylka_status,przesylka_dostarczono_at,przesylka_sprawdzono_at)
    VALUES (?,'ord-9','2026-09-07T00:00:00Z',?,?,?,?,?)`).run(konto, stan.waybill ?? null,
    stan.przewoznik ?? null, stan.status ?? null, stan.dostarczono ?? null, stan.sprawdzono ?? null)
    .lastInsertRowid);
}

test("przesyłka wchodzi do faktów po polsku i bez numeru przesyłki", () => {
  podZamowieniem({ waybill: "620012345678", przewoznik: "INPOST", status: "AVAILABLE_FOR_PICKUP",
    sprawdzono: "2026-09-07T12:05:00Z" });
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  const f = k.fakty.find((x) => x.rodzaj === "przesylka");
  assert.match(String(f?.zdanie), /czeka na klienta w punkcie odbioru; przewoźnik INPOST/);
  assert.match(String(f?.zdanie), /numer przesyłki klient widzi w Allegro/);
  assert.equal(k.tekstFaktow.includes("620012345678"), false, "numer przesyłki prowadzi do adresu odbiorcy");
});

test("bez sprawdzenia fakt milczy, a kontekst nie pyta Allegro", () => {
  podZamowieniem();
  const przed = liczba("events");
  const k = S.kontekstSzkicu(rozmowa, subiekt);
  assert.equal(k.fakty.some((x) => x.rodzaj === "przesylka"), false);
  assert.equal(liczba("events"), przed, "kontekst szkicu jest czystym odczytem");
});

test("przed szkicem pytamy Allegro o stan pusty albo stary, o doręczoną już nie", async () => {
  const id = podZamowieniem();
  const wolane: string[] = [];
  const deps = {
    apiUrl: "https://api.test", teraz: () => "2026-09-07T12:10:00Z",
    query: async (url: string) => {
      wolane.push(url);
      return url.includes("/shipments")
        ? { shipments: [{ waybill: "W1", carrierId: "DPD" }] }
        : { waybills: [{ waybill: "W1", trackingDetails: { statuses: [
            { code: "IN_TRANSIT", occurredAt: "2026-09-07T09:00:00Z" }] } }] };
    },
  };
  await S.odswiezPrzesylke(rozmowa, deps, Date.parse("2026-09-07T12:10:00Z"));
  assert.equal(wolane.length, 2, "numer, potem status");
  assert.match(String(S.kontekstSzkicu(rozmowa, subiekt).fakty
    .find((x) => x.rodzaj === "przesylka")?.zdanie), /w drodze do klienta; przewoźnik DPD/);

  wolane.length = 0;
  await S.odswiezPrzesylke(rozmowa, deps, Date.parse("2026-09-07T12:20:00Z"));
  assert.equal(wolane.length, 0, "stan sprzed dziesięciu minut wystarcza");

  db().prepare("UPDATE zamowienie_klienta SET przesylka_dostarczono_at='2026-09-07T11:00:00Z' WHERE id=?").run(id);
  await S.odswiezPrzesylke(rozmowa, deps, Date.parse("2026-09-08T12:00:00Z"));
  assert.equal(wolane.length, 0, "doręczona już się nie zmieni");
});

/* ── „Kiedy będzie" przy braku na stanie (0.502.0) ─────────────────────────
   Fakt stoi tylko przy braku, nie niesie dostawcy ani numeru dokumentu
   i mówi wprost, że termin jest terminem dostawcy. */
test("kiedy będzie: tylko przy braku, bez dostawcy, termin nazwany terminem dostawcy", () => {
  const zam = (termin: string | null, ilosc: number, szacunek = false) => ({ termin, ilosc, szacunek });
  assert.equal(S.kiedyBedzie({ mag: { avail: 3 }, unit: "szt.", zamowione: [zam("2026-10-01", 5)] }), null);
  const zdanie = S.kiedyBedzie({ mag: { avail: 0 }, unit: "szt.",
    zamowione: [zam("2026-10-01T00:00:00", 5), zam(null, 2)] })!;
  assert.match(zdanie, /zamówione u dostawcy: 7 szt\., najbliższy termin dostawcy 2026-10-01/);
  assert.match(zdanie, /nie obietnica dla klienta/);
  assert.match(S.kiedyBedzie({ mag: { avail: 0 }, unit: null, zamowione: [zam(null, 4, true)] })!,
    /do 4 szt\., dostawca nie podał terminu/);
  assert.equal(S.kiedyBedzie({ mag: { avail: -1 }, unit: null, zamowione: [] }),
    "brak otwartych zamówień u dostawcy — terminu nie znamy");
});
