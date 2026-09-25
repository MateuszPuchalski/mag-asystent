import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pytania-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Dopytanie Copilota (0.332.0) ────────────────────────────────────────────
   Właściciel: „dodaj możliwość kontynuowania rozmowy z modelem".

   Testy pilnują granicy, która odróżnia to od szkicu: ODPOWIEDŹ IDZIE DO
   AGENTA, nie do klienta. Z tego wynika wszystko, co tu sprawdzamy.

   1. Odpowiedź NIE przechodzi przez sita szkicu. Model wolno nazwać numer
      spoza faktów — właśnie po to agent pyta. Gdyby sita działały, zdanie
      „tego numeru u nas nie ma" wywracałoby własną odpowiedź.
   2. NIE MA STĄD DROGI DO KLIENTA. Dopytanie nie rusza szkicu ani jednym
      znakiem; żeby cokolwiek poszło dalej, agent układa szkic od nowa.
   3. Nieudane wywołanie NIE zostawia wymiany, ale ZOSTAWIA ślad w księdze.
   4. Kontekst rośnie: drugie pytanie widzi pierwszą wymianę.
   5. Sufit pytań na rozmowę i limit długości pytania.                      */

let db: typeof import("../db/db.js").db;
let config: typeof import("../config.js").config;
let Q: typeof import("./copilot-pytania.js");
let S: typeof import("./copilot-szkic.js");
let subiekt: typeof import("../context.js").subiekt;
let biuro = 0;
let konto = 0;
let rozmowa = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ subiekt } = await import("../context.js"));
  Q = await import("./copilot-pytania.js");
  S = await import("./copilot-szkic.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
});

beforeEach(() => {
  const d = db();
  for (const t of ["copilot_pytanie", "szkic_copilota", "copilot_wywolanie", "message",
    "conversation", "offer_snapshot", "allegro_inbox_thread", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')").run().lastInsertRowid);
  const n = "2026-09-14T10:00:00Z";
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES ('w-1',1,'zielony_ogrod','{}',?)`).run(n);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','Gaźnik Honda GX160')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,?,'m-1','incoming',?,?)`)
    .run(rozmowa, konto, "Dzień dobry, jaka uszczelka pod filtr? Tel 601 234 567", n);
});

const KTO = () => ({ id: biuro, name: "A. Lewandowska" });
const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;

/** Nadawca-atrapa; zapamiętuje kontekst, który dostał. */
function nadawca(tresc = "Fakty tego nie rozstrzygają.", twierdzenia: import("./copilot-szkic.js").TwierdzenieSurowe[] = []) {
  const widziane: { ostatni: import("./copilot-pytania.js").KontekstPytania | null } = { ostatni: null };
  const nadaj: import("./copilot-pytania.js").NadawcaPytania = async (k) => {
    widziane.ostatni = k;
    return {
      tresc, twierdzenia, model: "atrapa",
      zuzycie: { wej: 100, wyj: 20, cacheZapis: 0, cacheOdczyt: 0 }, ms: 5, narzedzia: [],
    };
  };
  return { widziane, nadaj };
}

test("odpowiedź wolno oprzeć na numerze SPOZA faktów — po to agent pyta", async () => {
  /* To jest cała różnica wobec szkicu. Tam numer spoza faktów wywraca całość,
     bo tekst idzie do klienta. Tu zdanie „tego u nas nie ma" jest dokładnie
     tym, po co agent kliknął, i nie ma prawa wywrócić własnej odpowiedzi. */
  const n = nadawca("Numeru 17211-ZL8-023 nie mamy w kartotece. To numer Hondy do HRX537.", [
    { teza: "17211-ZL8-023 to filtr powietrza Hondy", zrodlo: "model", odwolanie: null, pewnosc: "niepewne" },
  ]);
  const w = await Q.zadajPytanie(rozmowa, "A numer 17211-ZL8-023?", KTO(), n.nadaj, subiekt);

  assert.ok(w.odpowiedz.includes("17211-ZL8-023"));
  assert.equal(w.twierdzenia.length, 1);
  assert.equal(w.twierdzenia[0]!.pewnosc, "niepewne", "sufit źródła `model` obowiązuje tak samo");
});

test("dopytanie NIE rusza szkicu ani jednym znakiem", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), async () => ({
    /* Treść bez numeru katalogowego: ta rozmowa nie ma faktu o kartotece,
       więc numer w szkicu wywróciłby go na odsiewie i test mierzyłby co
       innego, niż mówi jego nazwa. */
    tresc: "Dzień dobry, ta uszczelka pasuje.", uzyteFakty: [], zastrzezenia: [],
    daneDoboru: null, pasowanie: null, twierdzenia: [], odczytZeZdjec: [],
    model: "atrapa", zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0 }, ms: 1,
  }), subiekt);

  await Q.zadajPytanie(rozmowa, "Na pewno pasuje?", KTO(), nadawca().nadaj, subiekt);

  /* Żeby cokolwiek z wymiany trafiło do klienta, agent układa szkic OD NOWA
     i tamten przechodzi przez swoje sita. Jedna droga do klienta, ta sama. */
  assert.equal(S.szkicCopilota(rozmowa)!.tresc, s.tresc);
});

test("model widzi szkic i poprzednie wymiany, bo pyta się O NIE", async () => {
  await S.ulozSzkic(rozmowa, KTO(), async () => ({
    tresc: "Szkic pierwszy.", uzyteFakty: [], zastrzezenia: [],
    daneDoboru: null, pasowanie: null, twierdzenia: [], odczytZeZdjec: [],
    model: "atrapa", zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0 }, ms: 1,
  }), subiekt);

  await Q.zadajPytanie(rozmowa, "Pytanie pierwsze", KTO(), nadawca("Odpowiedź pierwsza").nadaj, subiekt);
  const drugi = nadawca();
  await Q.zadajPytanie(rozmowa, "Pytanie drugie", KTO(), drugi.nadaj, subiekt);

  const k = drugi.widziane.ostatni!;
  assert.equal(k.szkic, "Szkic pierwszy.");
  assert.deepEqual(k.historia, [{ pytanie: "Pytanie pierwsze", odpowiedz: "Odpowiedź pierwsza" }]);
  assert.equal(k.pytanie, "Pytanie drugie");
});

test("wątek do modelu jest ZAMASKOWANY, tak samo jak przy szkicu", async () => {
  const n = nadawca();
  await Q.zadajPytanie(rozmowa, "Co z tym telefonem?", KTO(), n.nadaj, subiekt);
  const watek = String(n.widziane.ostatni!.watek);
  assert.ok(!watek.includes("601 234 567"), "numer klienta nie ma prawa wyjść");
  assert.ok(watek.includes("[telefon]"));
});

test("nieudane wywołanie nie zostawia wymiany, ale zostawia ślad w księdze", async () => {
  const odmowa: import("./copilot-pytania.js").NadawcaPytania =
    async () => { throw new Error("dostawca odmówił"); };

  await assert.rejects(Q.zadajPytanie(rozmowa, "Pytanie", KTO(), odmowa, subiekt), /odmówił/);
  assert.equal(liczba("copilot_pytanie"), 0, "wymiana bez odpowiedzi nie znaczy nic");
  assert.equal(liczba("copilot_wywolanie"), 1, "ale koszt i tak poszedł");
  const k = db().prepare("SELECT zadanie, wynik FROM copilot_wywolanie").get() as Record<string, unknown>;
  assert.equal(k.zadanie, "pytanie");
  assert.equal(k.wynik, "blad");
});

test("puste pytanie i pytanie dłuższe od limitu odpadają PRZED siecią", async () => {
  let wywolan = 0;
  const licz: import("./copilot-pytania.js").NadawcaPytania = async () => {
    wywolan += 1;
    return { tresc: "x", twierdzenia: [], model: "a", zuzycie: { wej: 0, wyj: 0, cacheZapis: 0, cacheOdczyt: 0 }, ms: 1, narzedzia: [] };
  };

  await assert.rejects(Q.zadajPytanie(rozmowa, "   ", KTO(), licz, subiekt), /Puste pytanie/);
  await assert.rejects(
    Q.zadajPytanie(rozmowa, "a".repeat(Q.LIMIT_PYTANIA + 1), KTO(), licz, subiekt), /mieści się/);
  assert.equal(wywolan, 0, "za odrzucone pytanie nie płacimy");
  assert.equal(liczba("copilot_wywolanie"), 0);
});

test("sufit pytań na rozmowę mówi, co robić dalej, zamiast samego „nie”", async () => {
  const n = nadawca();
  for (let i = 0; i < Q.SUFIT_PYTAN; i += 1) {
    await Q.zadajPytanie(rozmowa, `Pytanie ${i}`, KTO(), n.nadaj, subiekt);
  }
  await assert.rejects(
    Q.zadajPytanie(rozmowa, "Jeszcze jedno", KTO(), n.nadaj, subiekt),
    /zapytaj klienta/);
  assert.equal(liczba("copilot_pytanie"), Q.SUFIT_PYTAN);
});

test("odczyt wymian niczego nie mutuje", async () => {
  await Q.zadajPytanie(rozmowa, "Pytanie", KTO(), nadawca().nadaj, subiekt);
  const przed = [liczba("copilot_pytanie"), liczba("copilot_wywolanie"), liczba("events")];
  Q.wymianyRozmowy(rozmowa);
  Q.wymianyRozmowy(rozmowa);
  assert.deepEqual([liczba("copilot_pytanie"), liczba("copilot_wywolanie"), liczba("events")], przed);
});

/* ── Narzędzia (0.507.0) ─────────────────────────────────────────────────
   Model dostaje zestaw narzędzi i sam sięga do bazy. Pilnujemy trzech
   rzeczy: zestaw dochodzi do nadawcy, ślad wywołań zostaje przy wymianie,
   a twierdzenie oparte na PROPOZYCJI nie wychodzi jako pewne.            */

test("model dostaje narzędzia, a wymiana pamięta, po co sięgnął", async () => {
  let wynik = "";
  const nadaj: import("./copilot-pytania.js").NadawcaPytania = async (k) => {
    assert.ok(k.narzedzia, "dopytanie idzie z zestawem narzędzi");
    assert.deepEqual(k.narzedzia!.definicje.map((d) => d.name),
      ["szukaj_towaru", "karta_towaru", "pasowanie_towaru", "czesci_do_maszyny", "tresc_oferty"]);
    wynik = String(k.narzedzia!.wykonaj("szukaj_towaru", { zapytanie: "gaźnik" }).wynik);
    return {
      tresc: "Sprawdziłem kartotekę.", twierdzenia: [], model: "atrapa",
      zuzycie: { wej: 300, wyj: 40, cacheZapis: 0, cacheOdczyt: 200 }, ms: 9,
      narzedzia: [{ nazwa: "szukaj_towaru", argument: "gaźnik", znakow: wynik.length }],
    };
  };
  const w = await Q.zadajPytanie(rozmowa, "Mamy gaźnik?", KTO(), nadaj, subiekt);

  assert.ok(wynik.length > 0, "narzędzie odpowiedziało z bazy");
  assert.deepEqual(w.narzedzia.map((n) => n.nazwa), ["szukaj_towaru"]);
  assert.deepEqual(Q.wymianyRozmowy(rozmowa)[0]!.narzedzia, w.narzedzia, "ślad przeżywa odczyt z bazy");
  const zd = db().prepare("SELECT payload FROM events WHERE type='copilot_pytanie'").get() as { payload: string };
  assert.ok(zd.payload.includes("szukaj_towaru"));
  assert.ok(!zd.payload.includes("gaźnik"), "argument narzędzia nie staje w dzienniku");
});

test("twierdzenie oparte na propozycji WP schodzi do „niepewne”, choć źródłem są fakty", async () => {
  const n = nadawca("Propozycja mówi, że pasuje do MS 250.", [
    { teza: "pasuje do Stihl MS 250", zrodlo: "fakty", odwolanie: "WP17", pewnosc: "pewne" },
    { teza: "pasuje do Stihl MS 230", zrodlo: "fakty", odwolanie: "WZ4", pewnosc: "pewne" },
  ]);
  const w = await Q.zadajPytanie(rozmowa, "Pasuje do MS 250?", KTO(), n.nadaj, subiekt);

  assert.equal(w.twierdzenia[0]!.pewnosc, "niepewne", "niezatwierdzona propozycja to nie baza");
  assert.equal(w.twierdzenia[0]!.obnizona, true);
  assert.equal(w.twierdzenia[1]!.pewnosc, "pewne", "zatwierdzone zastosowanie zostaje pewne");
});

test("błąd po zapłaconych rundach narzędzi zostawia ich koszt w księdze", async () => {
  const pad: import("./copilot-pytania.js").NadawcaPytania = async () => {
    throw Object.assign(new Error("ucięte"), { zuzycie: { wej: 900, wyj: 80, cacheZapis: 0, cacheOdczyt: 0 } });
  };
  await assert.rejects(Q.zadajPytanie(rozmowa, "Pytanie", KTO(), pad, subiekt), /ucięte/);
  const k = db().prepare("SELECT model, tokeny_wej, wynik FROM copilot_wywolanie").get() as Record<string, unknown>;
  assert.equal(k.wynik, "blad");
  assert.equal(k.tokeny_wej, 900, "rundy przed błędem kosztowały i pomiar ma to widzieć");
  assert.equal(k.model, config.copilot.model, "bez modelu pomiar pominąłby ten wiersz");
});

test("dziennik niesie DŁUGOŚCI, nigdy treści pytania", async () => {
  await Q.zadajPytanie(rozmowa, "Czy pan Kowalski z Poznania dostanie to jutro?", KTO(),
    nadawca().nadaj, subiekt);
  const zd = db().prepare("SELECT payload FROM events WHERE type='copilot_pytanie'").get() as
    { payload: string } | undefined;
  assert.ok(zd, "zdarzenie miało powstać");
  assert.ok(!zd!.payload.includes("Kowalski"), "treść pytania nie ma prawa stanąć w dzienniku");
  assert.ok(zd!.payload.includes("znakowPytania"));
});
