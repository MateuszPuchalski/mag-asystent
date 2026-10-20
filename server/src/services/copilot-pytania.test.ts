import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pytania-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Dopytanie Copilota ──────────────────────────────────────────────────────
   Właściciel: „dodaj możliwość kontynuowania rozmowy z modelem". I decyzja
   do tego: dopytanie poprawia szkic, zamiast mówić, co w nim poprawić.

   Testy pilnują granicy między dwoma tekstami jednej wymiany.

   1. NOTKA dla agenta NIE przechodzi przez sita szkicu. Model wolno nazwać
      numer spoza faktów — właśnie po to agent pyta. Gdyby sita działały,
      zdanie „tego numeru u nas nie ma" wywracałoby własną odpowiedź.
   2. NOWA WERSJA przechodzi przez WSZYSTKIE sita szkicu i wraca do pola
      agenta. `szkic_copilota` zostaje nietknięty, bo na nim stoi automat
      wysyłki. Do dostawcy tekst z pola idzie zamaskowany, z powrotem wraca
      z wartościami klienta.
   3. Nieudane wywołanie NIE zostawia wymiany, ale ZOSTAWIA ślad w księdze.
      Odrzucona wersja to udane wywołanie: wymiana stoi, księga mówi `ok`.
   4. Kontekst rośnie: drugie pytanie widzi pierwszą wymianę.
   5. Sufit pytań na rozmowę, limit długości pytania i sufit tekstu z pola. */

let db: typeof import("../db/db.js").db;
let config: typeof import("../config.js").config;
let Q: typeof import("./copilot-pytania.js");
let S: typeof import("./copilot-szkic.js");
let LIMIT_ZNAKOW = 0;
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
  ({ LIMIT_ZNAKOW } = await import("./wysylka.js"));
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

type Wersja = Partial<import("./copilot-szkic.js").SzkicSurowy> & { tresc: string };

/**
 * Nadawca-atrapa poprawki: notka plus wersja zbudowana z tego, co dostał.
 * `wersja` zwraca `null` przy czystym pytaniu.
 */
function poprawiacz(
  wersja: (k: import("./copilot-pytania.js").KontekstPytania) => Wersja | null,
  notka = "Dodałem jedno zdanie na końcu.",
  wynikiNarzedzi: import("./copilot-narzedzia.js").WynikWywolania[] = [],
) {
  const widziane: { ostatni: import("./copilot-pytania.js").KontekstPytania | null; wywolan: number } =
    { ostatni: null, wywolan: 0 };
  const nadaj: import("./copilot-pytania.js").NadawcaPytania = async (k) => {
    widziane.ostatni = k;
    widziane.wywolan += 1;
    const w = wersja(k);
    return {
      tresc: notka, twierdzenia: [], model: "atrapa",
      zuzycie: { wej: 100, wyj: 20, cacheZapis: 0, cacheOdczyt: 0 }, ms: 5, narzedzia: [],
      szkic: w ? { uzyteFakty: [], zastrzezenia: [], twierdzenia: [], odczytZeZdjec: [], ...w } : null,
      wynikiNarzedzi,
    };
  };
  return { widziane, nadaj };
}

/** Szkic Copilota pod rozmową, bez sieci i bez sit, żeby podstawa była znana co do znaku. */
function szkicCopilotaZ(tresc: string) {
  db().prepare(`INSERT INTO szkic_copilota(conversation_id,tresc,model,at,przez)
    VALUES (?,?,'atrapa','2026-09-14T10:05:00.000Z','automat')`).run(rozmowa, tresc);
}

const ksiegaPytania = () => db().prepare(
  "SELECT wynik, blad FROM copilot_wywolanie WHERE zadanie='pytanie' ORDER BY id DESC").get() as
  { wynik: string; blad: string | null };

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

test("poprawka NIE rusza szkicu Copilota ani jednym znakiem; wersja żyje w wymianie", async () => {
  const s = await S.ulozSzkic(rozmowa, KTO(), async () => ({
    /* Treść bez numeru katalogowego: ta rozmowa nie ma faktu o kartotece,
       więc numer w szkicu wywróciłby go na odsiewie i test mierzyłby co
       innego, niż mówi jego nazwa. */
    tresc: "Dzień dobry, ta uszczelka pasuje.", uzyteFakty: [], zastrzezenia: [],
    twierdzenia: [], odczytZeZdjec: [],
    model: "atrapa", zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0 }, ms: 1,
  }), subiekt);

  const w = await Q.zadajPytanie(rozmowa, "Dodaj podziękowanie", KTO(),
    poprawiacz((k) => ({ tresc: `${k.szkic} Dziękujemy za zakup.` })).nadaj, subiekt);

  /* Na `szkic_copilota` stoi automat wysyłki i pomiar losu szkicu. Wersja
     z dopytania jest pracą agenta: wraca do jego pola, nie do propozycji. */
  assert.equal(S.szkicCopilota(rozmowa)!.tresc, s.tresc);
  assert.equal(w.szkicPo, "Dzień dobry, ta uszczelka pasuje. Dziękujemy za zakup.");
});

test("model widzi szkic i poprzednie wymiany, bo pyta się O NIE", async () => {
  await S.ulozSzkic(rozmowa, KTO(), async () => ({
    tresc: "Szkic pierwszy.", uzyteFakty: [], zastrzezenia: [],
    twierdzenia: [], odczytZeZdjec: [],
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

test("dopytanie przy sześciu zdjęciach widzi wszystkie sześć, z najstarszym", async () => {
  /* Klient przysłał pięć zdjęć, a szkic bierze cztery najnowsze. Odpadła
     najstarsza kartka z wymiarami i agent pytał właśnie o nią. Dopytanie
     klika człowiek, więc ma własny, wyższy sufit. */
  const m = db().prepare("SELECT id FROM message WHERE conversation_id=?").get(rozmowa) as { id: number };
  const ins = db().prepare(`INSERT INTO message_attachment(message_id,file_name,mime_type,url,status)
    VALUES (?,?,'image/png',?,'SAFE')`);
  for (let i = 1; i <= 6; i += 1) ins.run(m.id, `z${i}.png`, `https://allegro.pl/plik/z${i}.png`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pobierzZdjecie = async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;

  const n = nadawca();
  await Q.zadajPytanie(rozmowa, "Jakie wymiary są na kartce?", KTO(), n.nadaj, subiekt, { pobierzZdjecie });

  const k = n.widziane.ostatni!;
  assert.equal(k.zdjecia.length, 6);
  assert.ok(String(k.fakty).includes("[Z1] plik: z1.png"), "najstarsze zdjęcie też jedzie");
  assert.ok(!String(k.fakty).includes("Starszych zdjęć nie pokazano"));
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
   rzeczy: zestaw dochodzi do nadawcy, a ślad wywołań zostaje przy wymianie. */

test("model dostaje narzędzia, a wymiana pamięta, po co sięgnął", async () => {
  let wynik = "";
  const nadaj: import("./copilot-pytania.js").NadawcaPytania = async (k) => {
    assert.ok(k.narzedzia, "dopytanie idzie z zestawem narzędzi");
    assert.deepEqual(k.narzedzia!.definicje.map((d) => d.name),
      ["szukaj_towaru", "karta_towaru", "tresc_oferty", "oferty_towaru"]);
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

/* ── Poprawka szkicu ─────────────────────────────────────────────────────────
   Agent pisze polecenie, model oddaje notkę i CAŁĄ nową wersję tekstu z pola.
   Wersja przechodzi przez wszystkie sita szkicu, a odrzucona zostawia pole
   bez zmian i zdanie dla agenta, czemu. */

test("poprawka: tekst z pola wygrywa ze szkicem Copilota", async () => {
  szkicCopilotaZ("Szkic Copilota.");
  const n = poprawiacz((k) => ({ tresc: `${k.szkic} Pozdrawiamy.` }));
  const w = await Q.zadajPytanie(rozmowa, "Dodaj pozdrowienie", KTO(), n.nadaj, subiekt,
    { szkic: "Tekst agenta z pola." });

  assert.equal(String(n.widziane.ostatni!.szkic), "Tekst agenta z pola.", "model poprawia pole, nie swój szkic");
  assert.equal(w.szkicPrzed, "Tekst agenta z pola.");
  assert.equal(w.szkicPo, "Tekst agenta z pola. Pozdrawiamy.");
  assert.equal(w.szkicOdrzucony, null);
  assert.equal(w.odpowiedz, "Dodałem jedno zdanie na końcu.", "notka zostaje notką");
  assert.deepEqual(Q.wymianyRozmowy(rozmowa)[0], w, "wersja przeżywa odczyt z bazy");
});

test("poprawka: puste pole znaczy „poprawiaj szkic Copilota”", async () => {
  szkicCopilotaZ("Szkic Copilota.");
  const n = poprawiacz((k) => ({ tresc: `${k.szkic} Pozdrawiamy.` }));
  const w = await Q.zadajPytanie(rozmowa, "Dodaj pozdrowienie", KTO(), n.nadaj, subiekt, { szkic: "  \n " });

  assert.equal(String(n.widziane.ostatni!.szkic), "Szkic Copilota.");
  assert.equal(w.szkicPrzed, "Szkic Copilota.");
  assert.equal(w.szkicPo, "Szkic Copilota. Pozdrawiamy.");
});

test("poprawka: do dostawcy idzie maska, do pola wracają wartości klienta", async () => {
  const pole = "Dzień dobry zielony_ogrod,\n\noddzwonimy pod 601 234 567 jutro.";
  const n = poprawiacz((k) => ({ tresc: `${k.szkic}\n\nPozdrawiamy.` }));
  const w = await Q.zadajPytanie(rozmowa, "Dodaj pozdrowienie", KTO(), n.nadaj, subiekt, { szkic: pole });

  const widzial = String(n.widziane.ostatni!.szkic);
  assert.equal(widzial, "Dzień dobry [login],\n\noddzwonimy pod [telefon 1] jutro.");
  assert.equal(w.szkicPrzed, pole, "historia trzyma oryginał, nie maskę");
  assert.equal(w.szkicPo, `${pole}\n\nPozdrawiamy.`);
});

test("poprawka: znacznik, którego nie wydaliśmy, odrzuca wersję, a wymiana i księga stoją", async () => {
  /* `[telefon]` goły pochodzi z wątku: jego wartości model nie widział. */
  const n = poprawiacz(() => ({ tresc: "Oddzwonimy pod [telefon] jutro." }));
  const w = await Q.zadajPytanie(rozmowa, "Dodaj telefon klienta", KTO(), n.nadaj, subiekt,
    { szkic: "Oddzwonimy jutro." });

  assert.equal(w.szkicPo, null);
  assert.equal(w.szkicPrzed, "Oddzwonimy jutro.", "była próba poprawki, więc podstawa stoi");
  assert.match(w.szkicOdrzucony!, /dane klienta, których nie widział/);
  assert.match(w.szkicOdrzucony!, /\[telefon\]/);
  assert.equal(liczba("copilot_pytanie"), 1, "notka jest użyteczna, wymiana zostaje");
  assert.deepEqual({ ...ksiegaPytania() }, { wynik: "ok", blad: null });
});

test("poprawka: numer niezadeklarowany odrzuca wersję i stoi w zdaniu dla agenta", async () => {
  const n = poprawiacz(() => ({ tresc: "Ta uszczelka pasuje, numer XYZ-9999." }));
  const w = await Q.zadajPytanie(rozmowa, "Dopisz numer uszczelki", KTO(), n.nadaj, subiekt,
    { szkic: "Ta uszczelka pasuje." });

  assert.equal(w.szkicPo, null);
  assert.match(w.szkicOdrzucony!, /XYZ-9999/);
  assert.match(w.szkicOdrzucony!, /bez zmian/);
  assert.deepEqual({ ...ksiegaPytania() }, { wynik: "ok", blad: null });
});

test("poprawka: numer zadeklarowany w twierdzeniu wersji przechodzi, z sufitem pewności", async () => {
  const n = poprawiacz(() => ({
    tresc: "Ta uszczelka pasuje, numer XYZ-9999.",
    twierdzenia: [{ teza: "Uszczelka ma numer XYZ-9999", zrodlo: "model", odwolanie: null, pewnosc: "pewne" }],
  }));
  const w = await Q.zadajPytanie(rozmowa, "Dopisz numer uszczelki", KTO(), n.nadaj, subiekt,
    { szkic: "Ta uszczelka pasuje." });

  assert.equal(w.szkicPo, "Ta uszczelka pasuje, numer XYZ-9999.");
  assert.equal(w.szkicTwierdzenia.length, 1);
  assert.equal(w.szkicTwierdzenia[0]!.pewnosc, "niepewne", "sufit źródła `model`, jak przy szkicu");
  assert.deepEqual(w.twierdzenia, [], "twierdzenia wersji nie mieszają się z twierdzeniami notki");
});

test("poprawka: numer z polecenia agenta i numer już stojący w polu przechodzą sita", async () => {
  const zPolecenia = await Q.zadajPytanie(rozmowa, "Dodaj numer 17211-ZL8-023", KTO(),
    poprawiacz((k) => ({ tresc: `${k.szkic} Numer katalogowy: 17211-ZL8-023.` })).nadaj, subiekt,
    { szkic: "Filtr pasuje." });
  assert.equal(zPolecenia.szkicPo, "Filtr pasuje. Numer katalogowy: 17211-ZL8-023.");

  /* Dziewięć cyfr bez „nr" to dla maski telefon: numer części chowa się pod
     `[telefon 1]` i ma się porównać z sobą samym po odmaskowaniu. */
  const wPolu = await Q.zadajPytanie(rozmowa, "Dodaj pozdrowienie", KTO(),
    poprawiacz((k) => ({ tresc: `${k.szkic} Pozdrawiamy.` })).nadaj, subiekt,
    { szkic: "Pasuje nóż 532199377 i pasek W09-0211." });
  assert.equal(wPolu.szkicPo, "Pasuje nóż 532199377 i pasek W09-0211. Pozdrawiamy.");
});

test("poprawka: odwołanie N# spoza wyników narzędzi odrzuca wersję", async () => {
  const n = poprawiacz(() => ({ tresc: "Mamy go na stanie (N3).", uzyteFakty: ["N3"] }));
  const w = await Q.zadajPytanie(rozmowa, "Dopisz, że mamy na stanie", KTO(), n.nadaj, subiekt,
    { szkic: "Dzień dobry." });
  assert.equal(w.szkicPo, null);
  assert.match(w.szkicOdrzucony!, /N3/);

  /* To samo odwołanie przechodzi, gdy narzędzie naprawdę oddało N3. */
  const wynik = (id: string) => ({ id, nazwa: "karta_towaru", argument: "GAZ-1", tresc: "Kartoteka GAZ-1" });
  const ok = await Q.zadajPytanie(rozmowa, "Dopisz, że mamy na stanie", KTO(),
    poprawiacz(() => ({ tresc: "Mamy go na stanie (N3).", uzyteFakty: ["N3"] }), "Dopisałem.",
      [wynik("N1"), wynik("N2"), wynik("N3")]).nadaj, subiekt, { szkic: "Dzień dobry." });
  assert.equal(ok.szkicPo, "Mamy go na stanie.", "znacznik N# zdjęty jak przy szkicu");
});

test("poprawka: znacznik faktu (F1) znika z wersji po sprawdzeniu", async () => {
  /* Ta rozmowa nie ma oferty ani rozpoznania, więc F1 to fakt intake. */
  const w = await Q.zadajPytanie(rozmowa, "Dopytaj o model kosiarki", KTO(),
    poprawiacz(() => ({ tresc: "Proszę o model kosiarki z tabliczki (F1).", uzyteFakty: ["F1"] })).nadaj,
    subiekt, { szkic: "Dzień dobry." });
  assert.equal(w.szkicPo, "Proszę o model kosiarki z tabliczki.");
});

test("poprawka: wersja ponad limit Allegro odrzucona, zdanie podaje obie długości", async () => {
  const dluga = "Bardzo długi tekst. ".repeat(Math.ceil((LIMIT_ZNAKOW + 1) / 20));
  const w = await Q.zadajPytanie(rozmowa, "Rozwiń", KTO(), poprawiacz(() => ({ tresc: dluga })).nadaj,
    subiekt, { szkic: "Krótko." });
  assert.equal(w.szkicPo, null);
  assert.match(w.szkicOdrzucony!, new RegExp(`${dluga.length} znaków`));
  assert.match(w.szkicOdrzucony!, new RegExp(String(LIMIT_ZNAKOW)));
  assert.match(w.szkicOdrzucony!, /miał 7/, "długość poprawianego tekstu");
});

test("poprawka: pole ponad sufit odpada PRZED siecią, bez wiersza w księdze", async () => {
  const n = poprawiacz(() => null);
  await assert.rejects(
    Q.zadajPytanie(rozmowa, "Skróć to", KTO(), n.nadaj, subiekt, { szkic: "a".repeat(Q.SUFIT_POLA + 1) }),
    /poprawia najwyżej/);
  assert.equal(n.widziane.wywolan, 0, "za odrzucone pole nie płacimy");
  assert.equal(liczba("copilot_wywolanie"), 0);
  assert.equal(liczba("copilot_pytanie"), 0);

  /* Szkic ponad limit Allegro, ale pod sufitem: „skróć to" ma na nim działać. */
  const w = await Q.zadajPytanie(rozmowa, "Skróć to", KTO(),
    poprawiacz(() => ({ tresc: "Krótko." })).nadaj, subiekt, { szkic: "a ".repeat(LIMIT_ZNAKOW) });
  assert.equal(w.szkicPo, "Krótko.");
});

test("czyste pytanie: bez wersji, `szkicPrzed` i `szkicPo` puste", async () => {
  const w = await Q.zadajPytanie(rozmowa, "Skąd to wiesz?", KTO(),
    poprawiacz(() => null, "Z faktu F1.").nadaj, subiekt, { szkic: "Ta uszczelka pasuje." });
  assert.equal(w.szkicPrzed, null);
  assert.equal(w.szkicPo, null);
  assert.equal(w.szkicOdrzucony, null);
  assert.deepEqual([w.szkicTwierdzenia, w.szkicZastrzezenia], [[], []]);
});

test("wersja równa podstawie po zwinięciu białych znaków to brak zmian, nie odrzucenie", async () => {
  const w = await Q.zadajPytanie(rozmowa, "Popraw literówki", KTO(),
    poprawiacz(() => ({ tresc: "Ta  uszczelka\n\npasuje. " })).nadaj, subiekt, { szkic: "Ta uszczelka pasuje." });
  assert.equal(w.szkicPrzed, "Ta uszczelka pasuje.");
  assert.equal(w.szkicPo, null);
  assert.equal(w.szkicOdrzucony, null);
});

test("wersja bez podstawy jest pomijana: od szkicu od zera jest przycisk szkicu", async () => {
  const w = await Q.zadajPytanie(rozmowa, "Napisz odpowiedź", KTO(),
    poprawiacz(() => ({ tresc: "Dzień dobry, pasuje." })).nadaj, subiekt);
  assert.deepEqual([w.szkicPrzed, w.szkicPo, w.szkicOdrzucony], [null, null, null]);
});

test("dziennik poprawki niesie długości i los, nigdy tekstu szkicu", async () => {
  await Q.zadajPytanie(rozmowa, "Dodaj pozdrowienie", KTO(),
    poprawiacz((k) => ({ tresc: `${k.szkic} Pozdrawiamy serdecznie.` })).nadaj, subiekt,
    { szkic: "Panie Kowalski, paczka wyszła." });
  await Q.zadajPytanie(rozmowa, "Dopisz numer", KTO(),
    poprawiacz(() => ({ tresc: "Panie Kowalski, numer XYZ-9999." })).nadaj, subiekt,
    { szkic: "Panie Kowalski, paczka wyszła." });
  const zd = (db().prepare("SELECT payload FROM events WHERE type='copilot_pytanie' ORDER BY id").all() as
    Array<{ payload: string }>).map((e) => e.payload);

  assert.deepEqual(JSON.parse(zd[0]!), { ...JSON.parse(zd[0]!),
    znakowPrzed: 30, znakowPo: 54, poprawka: "wersja", powod: null });
  assert.deepEqual(JSON.parse(zd[1]!), { ...JSON.parse(zd[1]!),
    znakowPrzed: 30, znakowPo: null, poprawka: "odrzucona", powod: "numer_niezadeklarowany" });
  for (const p of zd) {
    assert.ok(!p.includes("Kowalski"), "tekst szkicu nie ma prawa stanąć w dzienniku");
    assert.ok(!p.includes("XYZ-9999"), "ani numer z odrzuconej wersji");
  }
});
