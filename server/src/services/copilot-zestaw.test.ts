import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zestaw-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Zestaw testowy Copilota ─────────────────────────────────────────────────
   Wejścia powstają tu prawdziwą drogą szkicu (`ulozSzkic` z atrapą nadawcy),
   bo zestaw ma czytać to, co szkic naprawdę zapisuje, a nie wiersze ułożone
   pod test. Pilnujemy pięciu rzeczy: do modelu idzie wejście bit w bit,
   powtórka niczego nie zmienia w pracy biura, sita rozstrzygają „naprawione"
   i „zepsute", los szkicu czyta się z wysyłki i oceny, a treść rozmowy nie
   trafia do raportu.                                                       */

let db: typeof import("../db/db.js").db;
let config: typeof import("../config.js").config;
let S: typeof import("./copilot-szkic.js");
let Z: typeof import("./copilot-zestaw.js");
let N: typeof import("./copilot-narzedzia.js");
let A: typeof import("./copilot-auto-szkic.js");
let BladLimituCopilota: typeof import("../adapters/copilot.js").BladLimituCopilota;
let subiekt: typeof import("../context.js").subiekt;
let biuro = 0;
let konto = 0;

type Odp = import("./copilot-szkic.js").OdpowiedzSzkicu;
type Nadawca = import("./copilot-szkic.js").NadawcaSzkicu;
type Rozmowa = { id: number; wiadomosc: number };

const TELEFON = "601 234 567";
const DOBRY = "Dzień dobry, gaźnik W09-0211 jest dziś dostępny (F1).";
const ZMYSLONY = "Pasuje uszczelka XYZ-9999 (F1).";
const ZDJECIE = JSON.stringify([{ numer: "Z1", zalacznikId: 7, typ: "image/jpeg", bajtow: 1000 }]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ subiekt } = await import("../context.js"));
  ({ BladLimituCopilota } = await import("../adapters/copilot.js"));
  S = await import("./copilot-szkic.js");
  Z = await import("./copilot-zestaw.js");
  N = await import("./copilot-narzedzia.js");
  A = await import("./copilot-auto-szkic.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
});

beforeEach(() => {
  const d = db();
  /* Dziecko przed rodzicem, bo klucze obce. */
  for (const t of ["copilot_wejscie", "szkic_copilota", "copilot_wywolanie", "outbox",
    "conversation_event", "message_attachment", "message", "conversation", "offer_snapshot",
    "allegro_inbox_thread", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,'of-1','Gaźnik Honda GX160 z kranikiem','W09-0211','2026-09-07T10:00:00Z')`).run(konto);
});

const KTO = () => ({ id: biuro, name: "A. Lewandowska" });
const liczba = (t: string, gdzie = "1=1") =>
  (db().prepare(`SELECT count(*) n FROM ${t} WHERE ${gdzie}`).get() as { n: number }).n;

/** Rozmowa z jedną wiadomością klienta. Każda ma własny wątek Allegro. */
function rozmowa(nr: number): Rozmowa {
  const d = db();
  const n = "2026-09-07T10:00:00Z";
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES (?,1,'zielony_ogrod','{}',?)`).run(`w-${nr}`, n);
  const id = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,?,'Gaźnik Honda GX160 z kranikiem')`).run(konto, `w-${nr}`).lastInsertRowid);
  const wiadomosc = Number(d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at,related_object_type,related_object_id)
    VALUES (?,?,?,'incoming',?,?,'OFFER','of-1')`)
    .run(id, konto, `m-${nr}`, `Dzień dobry, tu zielony_ogrod. Jaka uszczelka pod filtr? Tel ${TELEFON}`, n)
    .lastInsertRowid);
  return { id, wiadomosc };
}

const odpowiedz = (n: Partial<Odp> = {}): Odp => ({
  tresc: DOBRY, uzyteFakty: ["F1"], zastrzezenia: [], twierdzenia: [], odczytZeZdjec: [],
  model: "claude-opus-5", ms: 800, wersjaInstrukcji: "s1",
  zuzycie: { wej: 2000, wyj: 300, cacheZapis: 0, cacheOdczyt: 1500 }, ...n,
});

const nadawca = (n: Partial<Odp> = {}): Nadawca => async () => odpowiedz(n);
const limit = () => new BladLimituCopilota("limit", null);

/** Szkic biura: zostawia wejście, wiersz księgi i szkic przy rozmowie. */
async function szkicBiura(r: Rozmowa, n: Partial<Odp> = {}): Promise<void> {
  await S.ulozSzkic(r.id, { ...KTO(), zrodlo: "klik" }, nadawca(n), subiekt).catch(() => undefined);
}

/** Wysłana odpowiedź na wiadomość rozmowy, z losem szkicu jak po prawdziwej wysyłce. */
function wyslano(r: Rozmowa, body: string, los: string | null): void {
  db().prepare(`INSERT INTO outbox
    (conversation_id,idempotency_key,body,expected_version,expected_last_message_id,status,created_by,szkic_los)
    VALUES (?,?,?,1,?,'sent',?,?)`).run(r.id, `k-${r.id}-${r.wiadomosc}`, body, r.wiadomosc, biuro, los);
}

const sprawy = () => Z.sprawyZestawu(db(), { limit: 50 });
const opcje = (nadaj: Nadawca, reszta: Partial<import("./copilot-zestaw.js").OpcjePrzebiegu> = {}) =>
  ({ nadaj, model: "claude-sonnet-5-5", zNarzedziami: false, ...reszta });

/* ── Wybór spraw ───────────────────────────────────────────────────────── */

test("trzy kliknięcia szkicu przy jednej wiadomości dają jedną sprawę, ostatnią", async () => {
  const r = rozmowa(1);
  await szkicBiura(r, { tresc: ZMYSLONY });
  await szkicBiura(r);
  await szkicBiura(r);
  assert.equal(liczba("copilot_wejscie"), 3);

  const lista = sprawy();
  assert.equal(lista.length, 1);
  const ostatnie = (db().prepare("SELECT MAX(id) id FROM copilot_wejscie").get() as { id: number }).id;
  assert.equal(lista[0]!.wejscie.id, ostatnie);
  assert.equal(lista[0]!.bazowy.stan, "ok");
  assert.equal(lista[0]!.bazowy.tresc, "Dzień dobry, gaźnik W09-0211 jest dziś dostępny.",
    "treść do porównania bez znaczników faktów");
  assert.equal(lista[0]!.bazowy.zuzycie?.wej, 2000, "rachunek szkicu biura z księgi");
});

test("szkic biura odrzucony sitem i szkic bez odpowiedzi dostawcy mają swój stan", async () => {
  const a = rozmowa(1);
  const b = rozmowa(2);
  await szkicBiura(a, { tresc: ZMYSLONY });
  await S.ulozSzkic(b.id, KTO(), async () => { throw limit(); }, subiekt).catch(() => undefined);

  const lista = sprawy();
  const bazowy = (id: number) => lista.find((s) => s.wejscie.conversationId === id)!.bazowy;
  assert.deepEqual([bazowy(a.id).stan, (bazowy(a.id) as { kod: string }).kod],
    ["sito", "numer_niezadeklarowany"]);
  assert.deepEqual([bazowy(b.id).stan, (bazowy(b.id) as { kod: string }).kod], ["blad", "limit"]);
  assert.equal(bazowy(b.id).tresc, null);
});

test("data początku i limit zawężają zestaw, od najnowszej sprawy", async () => {
  const a = rozmowa(1);
  const b = rozmowa(2);
  await szkicBiura(a);
  await szkicBiura(b);
  db().prepare("UPDATE copilot_wejscie SET at='2026-01-05T08:00:00.000Z' WHERE conversation_id=?").run(a.id);

  assert.deepEqual(Z.sprawyZestawu(db(), { limit: 1 }).map((s) => s.wejscie.conversationId), [b.id]);
  assert.deepEqual(Z.sprawyZestawu(db(), { limit: 50, od: "2026-06-01" }).map((s) => s.wejscie.conversationId),
    [b.id]);
});

/* ── Los szkicu ────────────────────────────────────────────────────────── */

test("los szkicu: bez zmian, po poprawce, odrzucony, bez tego szkicu i bez odpowiedzi", async () => {
  const [bz, pop, odrz, inny, nic] = [1, 2, 3, 4, 5].map(rozmowa) as [Rozmowa, Rozmowa, Rozmowa, Rozmowa, Rozmowa];
  for (const r of [bz, pop, odrz, inny, nic]) await szkicBiura(r);
  wyslano(bz, "Dzień dobry, gaźnik W09-0211 jest dziś dostępny.", "bez_zmian");
  wyslano(pop, "Dzień dobry, gaźnik jest dostępny, wyślemy jutro.", "poprawiony");
  S.ocenSzkic(odrz.id, "odrzucony", KTO());
  wyslano(odrz, "Proszę o zdjęcie tabliczki silnika.", "poprawiony");
  wyslano(inny, "Odpowiedź automatu.", null);

  const los = new Map(sprawy().map((s) => [s.wejscie.conversationId, s.los]));
  assert.deepEqual([bz, pop, odrz, inny, nic].map((r) => los.get(r.id)),
    ["bez_zmian", "poprawiony", "odrzucony", "wyslane_bez_szkicu", "bez_odpowiedzi"]);
});

test("odpowiedź na późniejszą wiadomość nie ocenia szkicu do wcześniejszej", async () => {
  const r = rozmowa(1);
  await szkicBiura(r);
  const pozniejsza = Number(db().prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-pozniej','incoming','A jednak inne pytanie','2026-09-08T10:00:00Z')`)
    .run(r.id, konto).lastInsertRowid);
  wyslano({ id: r.id, wiadomosc: pozniejsza }, "Odpowiedź na inne pytanie.", null);

  const [s] = sprawy();
  assert.equal(s!.los, "bez_odpowiedzi");
  assert.equal(s!.wyslane, null);
});

/* ── Przebieg ──────────────────────────────────────────────────────────── */

test("do modelu idzie zapisany wątek i fakty bit w bit, bez zdjęć", async () => {
  const r = rozmowa(1);
  await szkicBiura(r);
  const w = db().prepare("SELECT watek, fakty FROM copilot_wejscie").get() as { watek: string; fakty: string };
  const widziane: Array<{ watek: string; fakty: string; zdjec: number; narzedzia: unknown }> = [];

  await Z.przebiegZestawu(db(), sprawy(), opcje(async (watek, fakty, zdjecia, n) => {
    widziane.push({ watek: String(watek), fakty: String(fakty), zdjec: (zdjecia ?? []).length, narzedzia: n });
    return odpowiedz();
  }));

  assert.equal(widziane.length, 1);
  assert.equal(widziane[0]!.watek, w.watek);
  assert.equal(widziane[0]!.fakty, w.fakty);
  assert.equal(widziane[0]!.watek.includes(TELEFON), false, "telefon klienta w żądaniu powtórki");
  assert.equal(widziane[0]!.narzedzia, undefined, "bez narzędzi powtórka nie podaje zestawu");
});

test("powtórka zostawia wiersz księgi jako zestaw, a pracy biura nie rusza", async () => {
  const r = rozmowa(1);
  await szkicBiura(r);
  const szkicPrzed = JSON.stringify(db().prepare("SELECT * FROM szkic_copilota").all());
  const wejscPrzed = liczba("copilot_wejscie");

  await Z.przebiegZestawu(db(), sprawy(),
    opcje(nadawca({ model: "claude-sonnet-5-5", wersjaInstrukcji: "plik:abcd1234" })));

  const k = db().prepare("SELECT * FROM copilot_wywolanie WHERE zadanie=?").get(Z.ZADANIE_ZESTAWU) as
    Record<string, unknown>;
  assert.deepEqual([k.zrodlo, k.model, k.wersja_instrukcji, k.wynik, k.przez_user_id, k.conversation_id],
    ["eval", "claude-sonnet-5-5", "plik:abcd1234", "ok", null, r.id]);
  assert.equal(liczba("copilot_wejscie"), wejscPrzed, "powtórka nie dopisuje wejść do zestawu");
  assert.equal(JSON.stringify(db().prepare("SELECT * FROM szkic_copilota").all()), szkicPrzed,
    "szkic agenta przy rozmowie zostaje nietknięty");
  assert.equal(liczba("conversation_event", "event_type='copilot_szkic'"), 1, "oś rozmowy bez wpisu powtórki");
});

test("powtórka nie zjada sufitu godzinowego szkiców z automatu", async () => {
  await szkicBiura(rozmowa(1));
  const przed = A.zuzyteWGodzinie(db());
  await Z.przebiegZestawu(db(), sprawy(), opcje(nadawca()));
  assert.equal(A.zuzyteWGodzinie(db()), przed);
});

test("sita rozstrzygają: zepsute i naprawione", async () => {
  const dobra = rozmowa(1);
  const zla = rozmowa(2);
  await szkicBiura(dobra);
  await szkicBiura(zla, { tresc: ZMYSLONY });
  const lista = sprawy();
  const wejscie = (id: number) => lista.find((s) => s.wejscie.conversationId === id)!.wejscie.id;
  assert.deepEqual(lista.map((s) => s.wejscie.conversationId), [zla.id, dobra.id], "od najnowszej");

  /* Nowy model pisze dobrze tam, gdzie biuro dostało zmyślony numer, i odwrotnie. */
  const kolejne = [DOBRY, ZMYSLONY];
  const p = Z.podsumujZestaw(await Z.przebiegZestawu(db(), lista,
    opcje(async () => odpowiedz({ tresc: kolejne.shift()! }))));

  assert.deepEqual(p.naprawione, [wejscie(zla.id)]);
  assert.deepEqual(p.zepsute, [wejscie(dobra.id)]);
  assert.deepEqual(p.bazowy, { ok: 1, odpadlo: { "sito: numer_niezadeklarowany": 1 } });
  assert.deepEqual(p.nowy, { ok: 1, odpadlo: { "sito: numer_niezadeklarowany": 1 } });
  const k = db().prepare(`SELECT kod_bledu FROM copilot_wywolanie
    WHERE zadanie=? AND wynik='blad'`).get(Z.ZADANIE_ZESTAWU) as { kod_bledu: string };
  assert.equal(k.kod_bledu, "numer_niezadeklarowany", "odrzucenie sitem stoi w księdze z kodem sita");
});

test("sprawa ze zdjęciami jest pominięta i nie kosztuje wywołania", async () => {
  const zeZdjeciem = rozmowa(1);
  const bez = rozmowa(2);
  await szkicBiura(zeZdjeciem);
  await szkicBiura(bez);
  db().prepare("UPDATE copilot_wejscie SET zdjecia=? WHERE conversation_id=?").run(ZDJECIE, zeZdjeciem.id);
  let wywolan = 0;

  const p = await Z.przebiegZestawu(db(), sprawy(), opcje(async () => {
    wywolan += 1;
    return odpowiedz();
  }));

  assert.equal(wywolan, 1);
  assert.deepEqual(p.pominiete.map((s) => s.wejscie.conversationId), [zeZdjeciem.id]);
  assert.deepEqual(p.wyniki.map((w) => w.sprawa.wejscie.conversationId), [bez.id]);
});

test("limit dostawcy przerywa przebieg, a nieudane wywołanie stoi w księdze", async () => {
  for (const nr of [1, 2, 3]) await szkicBiura(rozmowa(nr));
  let wywolan = 0;

  const p = await Z.przebiegZestawu(db(), sprawy(), opcje(async () => {
    wywolan += 1;
    if (wywolan === 2) throw limit();
    return odpowiedz();
  }));

  assert.equal(wywolan, 2, "trzecia sprawa skończyłaby się tak samo, więc nie idzie");
  assert.deepEqual([p.przerwano, p.niepuszczonych, p.wyniki.length], ["limit", 1, 2]);
  assert.deepEqual(p.wyniki[1]!.nowy, { stan: "blad", kod: "limit" });
  const k = db().prepare("SELECT model, kod_bledu FROM copilot_wywolanie WHERE zadanie=? AND wynik='blad'")
    .get(Z.ZADANIE_ZESTAWU) as { model: string; kod_bledu: string };
  assert.deepEqual([k.model, k.kod_bledu], ["", "limit"], "błąd bez rachunku ma pusty model");
});

test("dziennik dostaje liczby przebiegu, bez treści rozmowy", async () => {
  await szkicBiura(rozmowa(1));
  await Z.przebiegZestawu(db(), sprawy(), opcje(nadawca()));

  const e = db().prepare("SELECT payload FROM events WHERE type='copilot_zestaw'").get() as { payload: string };
  const p = JSON.parse(e.payload) as Record<string, unknown>;
  assert.deepEqual([p.spraw, p.ok, p.zepsutych, p.model], [1, 1, 0, "claude-sonnet-5-5"]);
  assert.doesNotMatch(e.payload, /uszczelka|gaźnik|W09/i);
});

/* ── Narzędzia z zapisu ────────────────────────────────────────────────── */

test("narzędzie odpowiada z zapisu sprawy, a nowe pytanie idzie do dzisiejszej bazy", async () => {
  type Wynik = import("./copilot-narzedzia.js").WynikNarzedzia;
  const licznik = { zapis: 0, zywo: 0, brak: 0 };
  const naZywo: import("./copilot-narzedzia.js").ZestawNarzedzi = {
    definicje: N.DEFINICJE,
    wykonaj: async () => ({ wynik: "DZISIAJ" as Wynik, blad: false }),
  };
  const zapis = [{ id: "N1", nazwa: "karta_towaru", argument: "W09-0211", tresc: "WTEDY: stan 4" }];
  const z = N.narzedziaZZapisu(zapis, naZywo, (s) => { licznik[s] += 1; });

  assert.equal(String((await z.wykonaj("karta_towaru", { zapytanie: " w09 0211 " })).wynik), "WTEDY: stan 4",
    "to samo zapytanie w innym zapisie dostaje zapisany wynik");
  assert.equal(String((await z.wykonaj("karta_towaru", { zapytanie: "W10-0001" })).wynik), "DZISIAJ");
  assert.equal(String((await z.wykonaj("szukaj_towaru", { zapytanie: "W09-0211" })).wynik), "DZISIAJ",
    "inne narzędzie z tym samym argumentem to inne pytanie");
  assert.deepEqual(licznik, { zapis: 1, zywo: 2, brak: 0 });

  const bezBazy = N.narzedziaZZapisu(zapis, null, (s) => { licznik[s] += 1; });
  const w = await bezBazy.wykonaj("karta_towaru", { zapytanie: "W10-0001" });
  assert.equal(w.blad, true, "bez bazy nowe pytanie kończy się błędem narzędzia, nie zmyśleniem");
  assert.equal(licznik.brak, 1);
});

test("przebieg z narzędziami podaje zestaw i liczy, skąd przyszły odpowiedzi", async () => {
  await szkicBiura(rozmowa(1));
  db().prepare("UPDATE copilot_wejscie SET wyniki_narzedzi=?").run(JSON.stringify(
    [{ id: "N1", nazwa: "karta_towaru", argument: "W09-0211", tresc: "Karta W09-0211: stan 4" }]));

  const p = await Z.przebiegZestawu(db(), sprawy(), opcje(async (_w, _f, _z, narzedzia) => {
    const wynik = await narzedzia!.wykonaj("karta_towaru", { zapytanie: "W09-0211" });
    return odpowiedz({
      tresc: "Gaźnik W09-0211 mamy, stan 4 (N1).", uzyteFakty: ["N1"],
      wynikiNarzedzi: [{ id: "N1", nazwa: "karta_towaru", argument: "W09-0211", tresc: String(wynik.wynik) }],
    });
  }, { zNarzedziami: true }));

  assert.deepEqual(p.wyniki[0]!.nowy, { stan: "ok" }, "odwołanie N1 przechodzi sito faktów");
  assert.deepEqual(p.wyniki[0]!.narzedzia, { zapis: 1, zywo: 0, brak: 0 });
});

/* ── Liczby i raport ───────────────────────────────────────────────────── */

test("bliskość: ten sam tekst to 1, rozłączne to 0, pusty to brak liczby", () => {
  assert.equal(Z.bliskosc("Gaźnik jest dostępny.", "gaźnik JEST dostępny"), 1);
  assert.equal(Z.bliskosc("gaźnik dostępny", "proszę o zdjęcie"), 0);
  assert.equal(Z.bliskosc("gaźnik gaźnik", "gaźnik"), 2 / 3, "powtórzone słowo liczy się raz na parę");
  assert.equal(Z.bliskosc("", "gaźnik"), null);
  assert.equal(Z.bliskosc("...", "gaźnik"), null);
});

test("fakty z tekstu: numery, rozpoznanie po wstępie, spis zdjęć poza listą", () => {
  const tekst = [
    "F1: Oferta: Gaźnik Honda GX160",
    `F2: ${S.WSTEP_ROZPOZNANIA}PRODUCT_QUESTION; następny krok: GET_PRODUCT`,
    "",
    "ZDJĘCIA (obrazy stoją PRZED tym tekstem, w tej kolejności):",
    "[Z1] plik: F9: tabliczka.jpg",
  ].join("\n");
  assert.deepEqual(S.faktyZTekstu(tekst), [
    { id: "F1", rodzaj: "nieznany" }, { id: "F2", rodzaj: "rozpoznanie" },
  ]);
});

test("koszt porównuje tylko sprawy z rachunkiem po obu stronach", async () => {
  const a = rozmowa(1);
  const b = rozmowa(2);
  await szkicBiura(a);
  /* Szkic biura bez odpowiedzi dostawcy: bez rachunku. */
  await S.ulozSzkic(b.id, KTO(), async () => { throw limit(); }, subiekt).catch(() => undefined);

  const p = Z.podsumujZestaw(await Z.przebiegZestawu(db(), sprawy(),
    opcje(nadawca({ model: "claude-sonnet-5-5" }))));

  assert.equal(p.zRachunkiem, 1);
  assert.equal(p.spraw, 2);
  /* 2000 wej., 300 wyj., 1500 z cache: Opus 5 po 5/25/0,5, Sonnet 5.5 po 2/10/0,1. */
  assert.equal(p.usdBazowy, 0.01825);
  assert.equal(p.usdNowy, 0.00715);
  assert.deepEqual(p.naprawione, [], "limit u biura nie jest szkicem odrzuconym sitem");
  assert.equal(p.usdPrzebiegu, 0.0143, "koszt przebiegu liczy obie sprawy, także tę bez rachunku biura");
});

test("wycena przed puszczeniem liczy tokeny biura po stawce nowego modelu", async () => {
  const a = rozmowa(1);
  const b = rozmowa(2);
  await szkicBiura(a);
  await szkicBiura(b);
  db().prepare("UPDATE copilot_wejscie SET zdjecia=? WHERE conversation_id=?").run(ZDJECIE, b.id);

  assert.deepEqual(Z.wycenaZestawu(sprawy(), "claude-sonnet-5-5"),
    { spraw: 1, pominietych: 1, bezRachunku: 0, usd: 0.00715 });
  assert.equal(liczba("copilot_wywolanie", `zadanie='${Z.ZADANIE_ZESTAWU}'`), 0, "wycena nie woła modelu");
});

test("bliskość liczy się w parach i dzieli po losie szkicu", async () => {
  const bz = rozmowa(1);
  const odrz = rozmowa(2);
  await szkicBiura(bz);
  await szkicBiura(odrz);
  wyslano(bz, "Dzień dobry, gaźnik W09-0211 jest dziś dostępny.", "bez_zmian");
  S.ocenSzkic(odrz.id, "odrzucony", KTO());
  wyslano(odrz, "Proszę o zdjęcie tabliczki silnika.", "poprawiony");

  const p = Z.podsumujZestaw(await Z.przebiegZestawu(db(), sprawy(),
    opcje(nadawca({ tresc: "Proszę o zdjęcie tabliczki silnika (F1)." }))));

  const wg = new Map(p.bliskosc.map((b) => [b.los, b]));
  assert.deepEqual([wg.get("bez_zmian")!.par, wg.get("bez_zmian")!.bazowa], [1, 1]);
  assert.equal(wg.get("odrzucony")!.nowa, 1, "nowy szkic mówi to, co agent napisał sam");
  assert.ok(wg.get("odrzucony")!.bazowa! < 0.3);
});

test("raport niesie liczby i numery, a plik par zamaskowaną rozmowę bez wysłanej odpowiedzi", async () => {
  const r = rozmowa(1);
  await szkicBiura(r);
  wyslano(r, "Panie Kowalski, gaźnik W09-0211 jest dostępny.", "poprawiony");
  const p = await Z.przebiegZestawu(db(), sprawy(),
    opcje(nadawca({ tresc: "Gaźnik W09-0211 wyślemy jutro (F1)." })));

  const raport = Z.raportZestawu(p, { model: "claude-sonnet-5-5", wersja: "s2" });
  assert.match(raport, /Model powtórki: claude-sonnet-5-5\. Instrukcja: s2\./);
  assert.match(raport, /wysłany po poprawce/);
  assert.doesNotMatch(raport, /uszczelka|Kowalski|wyślemy jutro/, "raport bez treści rozmowy i szkiców");

  const pary = Z.paryZestawu(p);
  assert.match(pary, /Jaka uszczelka pod filtr/, "zamaskowana rozmowa do przeczytania");
  assert.match(pary, /Gaźnik W09-0211 wyślemy jutro\./, "nowy szkic bez znaczników");
  assert.match(pary, /jest dziś dostępny\./, "szkic zapisany");
  assert.equal(pary.includes(TELEFON), false, "telefon klienta w pliku par");
  assert.equal(pary.includes("zielony_ogrod"), false, "login klienta w pliku par");
  assert.doesNotMatch(pary, /Kowalski/, "wysłana odpowiedź nie ma maski, więc nie wchodzi do pliku");
});

test("przeciążenie dostawcy też przerywa przebieg", async () => {
  const { BladPrzeciazeniaCopilota } = await import("../adapters/copilot.js");
  for (const nr of [1, 2]) await szkicBiura(rozmowa(nr));
  const p = await Z.przebiegZestawu(db(), sprawy(),
    opcje(async () => { throw new BladPrzeciazeniaCopilota("Dostawca przeciążony", 529, ""); }));
  assert.deepEqual([p.przerwano, p.wyniki.length, p.niepuszczonych], ["przeciazenie", 1, 1]);
});

test("przerwany przebieg mówi o tym w raporcie", async () => {
  for (const nr of [1, 2]) await szkicBiura(rozmowa(nr));
  const p = await Z.przebiegZestawu(db(), sprawy(), opcje(async () => { throw limit(); }));
  assert.match(Z.raportZestawu(p, { model: "m", wersja: "s2" }),
    /Przebieg przerwany \(limit\)\.\*\* Nie poszło spraw: 1\./);
});

/* ── Przypadki, na których liczby zestawu kłamały ──────────────────────── */

test("dopytanie między szkicem a oceną nie odcina odrzucenia", async () => {
  const r = rozmowa(1);
  await szkicBiura(r);
  db().prepare(`INSERT INTO copilot_wejscie(conversation_id,message_id,zadanie,at,watek,fakty,pytanie)
    VALUES (?,?,'pytanie',?,'KLIENT: pytanie','F1: fakt','Skróć to')`).run(r.id, r.wiadomosc, new Date().toISOString());
  S.ocenSzkic(r.id, "odrzucony", KTO());

  assert.equal(sprawy()[0]!.los, "odrzucony");
});

test("po szkicu odrzuconym sitem sprawą zostaje ten, który agent widział i wysłał", async () => {
  const r = rozmowa(1);
  await szkicBiura(r);
  await szkicBiura(r, { tresc: ZMYSLONY });
  wyslano(r, "Dzień dobry, gaźnik W09-0211 jest dziś dostępny.", "bez_zmian");

  const [s] = sprawy();
  assert.deepEqual([s!.bazowy.stan, s!.los], ["ok", "bez_zmian"]);
  assert.equal(s!.bazowy.tresc, "Dzień dobry, gaźnik W09-0211 jest dziś dostępny.",
    "bliskość liczy się z tekstu, który poszedł do klienta, nie z odrzuconego");
});

test("ocena przy rozmowie nie przechodzi na wejście, które szkicu nie zostawiło", async () => {
  const r = rozmowa(1);
  /* Jedyny szkic do tej wiadomości odpadł na sicie, więc ocena w dzienniku
     dotyczyć może tylko starszego tekstu przy rozmowie. */
  await szkicBiura(r, { tresc: ZMYSLONY });
  db().prepare("INSERT INTO events(type,payload,user_id) VALUES ('copilot_szkic_ocena',?,'ala')")
    .run(JSON.stringify({ conversationId: r.id, ocena: "odrzucony" }));

  assert.equal(sprawy()[0]!.los, "bez_odpowiedzi");
});

test("szkic biura przesiewa dzisiejszy kod, nie wynik zapisany w dniu szkicu", async () => {
  const r = rozmowa(1);
  await szkicBiura(r);
  /* Zapis mówi „ok", ale treść nie przeszłaby dzisiejszych sit. */
  db().prepare("UPDATE copilot_wejscie SET wyjscie=?").run(JSON.stringify({
    tresc: ZMYSLONY, uzyteFakty: ["F1"], zastrzezenia: [], twierdzenia: [], odczytZeZdjec: [],
  }));

  const b = sprawy()[0]!.bazowy;
  assert.deepEqual([b.stan, (b as { kod: string }).kod], ["sito", "numer_niezadeklarowany"]);
});

test("wątek, który nie przechodzi dzisiejszej kontroli maskowania, nie idzie do modelu", async () => {
  const r = rozmowa(1);
  await szkicBiura(r);
  db().prepare("UPDATE copilot_wejscie SET watek = watek || ?").run(`\nKLIENT: dzwońcie ${TELEFON}`);
  let wywolan = 0;

  const p = await Z.przebiegZestawu(db(), sprawy(), opcje(async () => {
    wywolan += 1;
    return odpowiedz();
  }));

  assert.equal(wywolan, 0);
  assert.deepEqual(p.pominiete.map((s) => s.pominieta), ["maskowanie"]);
  assert.match(Z.raportZestawu(p, { model: "m", wersja: "s2" }), /kontroli maskowania: 1\./);
});

test("seria odrzuconych żądań przerywa przebieg i nie liczy się jako zepsute", async () => {
  const { BladOdpowiedziCopilota } = await import("../adapters/copilot.js");
  for (const nr of [1, 2, 3, 4, 5]) await szkicBiura(rozmowa(nr));
  let wywolan = 0;

  /* Literówka w nazwie modelu: dostawca odrzuca każde żądanie tak samo. */
  const p = await Z.przebiegZestawu(db(), sprawy(), opcje(async () => {
    wywolan += 1;
    throw new BladOdpowiedziCopilota("Dostawca odrzucił żądanie", 404, "not_found_error");
  }));

  assert.equal(wywolan, Z.SERIA_BLEDOW);
  assert.deepEqual([p.przerwano, p.niepuszczonych], ["seria_bledow", 2]);
  const s = Z.podsumujZestaw(p);
  assert.deepEqual(s.zepsute, [], "błąd dostawcy nic nie mówi o szkicu");
  const e = db().prepare("SELECT payload FROM events WHERE type='copilot_zestaw'").get() as { payload: string };
  assert.equal((JSON.parse(e.payload) as { zepsutych: number }).zepsutych, 0);
});

test("pojedynczy błąd między udanymi sprawami przebiegu nie przerywa", async () => {
  const { BladOdpowiedziCopilota } = await import("../adapters/copilot.js");
  for (const nr of [1, 2, 3, 4, 5]) await szkicBiura(rozmowa(nr));
  let wywolan = 0;

  const p = await Z.przebiegZestawu(db(), sprawy(), opcje(async () => {
    wywolan += 1;
    if (wywolan % 2 === 0) throw new BladOdpowiedziCopilota("Model nie oddał szkicu", 200, "", "uciety");
    return odpowiedz();
  }));

  assert.deepEqual([wywolan, p.przerwano, p.wyniki.length], [5, null, 5]);
});

test("nieudane powtórki nie są błędami Copilota w pomiarze biura ani w raporcie tygodnia", async () => {
  const K = await import("./copilot-klasyfikacja.js");
  const R = await import("./raport-tygodnia.js");
  for (const nr of [1, 2, 3]) await szkicBiura(rozmowa(nr));
  const przed = K.pomiarCopilota(db());
  assert.deepEqual([przed.wywolan, przed.bledow], [3, 0]);

  /* Wtorek tygodnia, w którym biuro nie pracowało: w raporcie stoją same powtórki. */
  await Z.przebiegZestawu(db(), sprawy(), opcje(nadawca({ tresc: ZMYSLONY, model: "claude-sonnet-5-5" }),
    { teraz: () => new Date("2026-09-08T10:00:00Z") }));

  const po = K.pomiarCopilota(db());
  assert.deepEqual([po.wywolan, po.bledow], [3, 0], "karta pomiaru liczy pracę biura");
  assert.ok(po.kosztUsd > przed.kosztUsd, "koszt powtórek jest na rachunku");
  const zestaw = po.wgZadania.find((z) => z.zadanie === Z.ZADANIE_ZESTAWU)!;
  assert.deepEqual([zestaw.wywolan, zestaw.bledow], [3, 3], "zestaw ma własny wiersz z własnymi liczbami");

  const tydzien = R.zbudujRaport("2026-09-07", db()).copilot;
  assert.deepEqual([tydzien.wywolan, tydzien.bledow], [0, 0]);
  assert.ok(tydzien.kosztUsd > 0);
});

test("czas porównuje się w parach, jak koszt", async () => {
  const a = rozmowa(1);
  const b = rozmowa(2);
  await szkicBiura(a, { ms: 4000 });
  await S.ulozSzkic(b.id, KTO(), async () => { throw limit(); }, subiekt).catch(() => undefined);

  /* Sprawa bez czasu biura idzie pierwsza i trwa długo. Mediana ze wszystkich
     nowych czasów dałaby 5000, a para jest tylko jedna. */
  const czasy = [9000, 1000];
  const p = Z.podsumujZestaw(await Z.przebiegZestawu(db(), sprawy(),
    opcje(async () => odpowiedz({ ms: czasy.shift()! }))));
  assert.deepEqual([p.medianaMsBazowa, p.medianaMsNowa], [4000, 1000]);
});
