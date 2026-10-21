import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wejscie-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Wejście Copilota: zestaw testowy na 90 dni ──────────────────────────────
   Pilnujemy czterech rzeczy. Wejście stoi przy każdym wywołaniu, które
   poszło do dostawcy: udanym, odrzuconym sitem i zakończonym błędem. Stoi
   tam WYŁĄCZNIE wersja zamaskowana: telefon klienta z wiadomości i surowe
   pole agenta nie mają tu drogi. Retencja kasuje po 90 dniach i razem
   z rozmową. Porażka zapisu wejścia nie wywraca szkicu.                  */

let db: typeof import("../db/db.js").db;
let migrate: typeof import("../db/db.js").migrate;
let config: typeof import("../config.js").config;
let S: typeof import("./copilot-szkic.js");
let Q: typeof import("./copilot-pytania.js");
let W: typeof import("./copilot-wejscie.js");
let BladOdpowiedziCopilota: typeof import("../adapters/copilot.js").BladOdpowiedziCopilota;
let subiekt: typeof import("../context.js").subiekt;
let biuro = 0;
let konto = 0;
let rozmowa = 0;
let wiadomosc = 0;

const TELEFON = "601 234 567";

before(async () => {
  ({ db, migrate } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ subiekt } = await import("../context.js"));
  ({ BladOdpowiedziCopilota } = await import("../adapters/copilot.js"));
  S = await import("./copilot-szkic.js");
  Q = await import("./copilot-pytania.js");
  W = await import("./copilot-wejscie.js");
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
  for (const t of ["copilot_wejscie", "copilot_pytanie", "szkic_copilota", "copilot_wywolanie",
    "conversation_event", "message_attachment", "message", "conversation", "offer_snapshot",
    "allegro_inbox_thread", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  const n = "2026-09-07T10:00:00Z";
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES ('w-1',1,'zielony_ogrod','{}',?)`).run(n);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','Gaźnik Honda GX160 z kranikiem')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,'of-1','Gaźnik Honda GX160 z kranikiem','W09-0211',?)`).run(konto, n);
  wiadomosc = Number(d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at,related_object_type,related_object_id)
    VALUES (?,?,'m-1','incoming',?,?,'OFFER','of-1')`)
    .run(rozmowa, konto, `Dzień dobry, tu zielony_ogrod. Jaka uszczelka pod filtr? Tel ${TELEFON}`, n)
    .lastInsertRowid);
});

const KTO = () => ({ id: biuro, name: "A. Lewandowska" });
const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;
const wejscia = () => db().prepare("SELECT * FROM copilot_wejscie ORDER BY id").all() as Array<Record<string, unknown>>;

const odpowiedz = (n: Partial<import("./copilot-szkic.js").OdpowiedzSzkicu> = {}) => ({
  tresc: "Dzień dobry, gaźnik W09-0211 jest dziś dostępny (F1).",
  uzyteFakty: ["F1"], zastrzezenia: [], twierdzenia: [], odczytZeZdjec: [],
  model: "claude-opus-5", ms: 800, wersjaInstrukcji: "s1",
  zuzycie: { wej: 2000, wyj: 300, cacheZapis: 0, cacheOdczyt: 1500 }, ...n,
});

/** Nadawca, który zapamiętuje, co poszło do dostawcy. */
function szpieg(n: Partial<import("./copilot-szkic.js").OdpowiedzSzkicu> = {}) {
  const widziane = { watek: "", fakty: "" };
  const nadaj: import("./copilot-szkic.js").NadawcaSzkicu = async (w, f) => {
    widziane.watek = String(w);
    widziane.fakty = String(f);
    return odpowiedz(n);
  };
  return { widziane, nadaj };
}

/** Zmienia przełącznik na czas jednego testu. */
async function zPrzelacznikiem(wartosc: boolean, fn: () => Promise<void>) {
  const bylo = config.copilot.zapisWejscia;
  (config.copilot as { zapisWejscia: boolean }).zapisWejscia = wartosc;
  try { await fn(); } finally { (config.copilot as { zapisWejscia: boolean }).zapisWejscia = bylo; }
}

/* ── Szkic ─────────────────────────────────────────────────────────────── */

test("udany szkic zostawia wejście: zamaskowany wątek jak w żądaniu, z id wiersza księgi", async () => {
  const s = szpieg();
  await S.ulozSzkic(rozmowa, { ...KTO(), zrodlo: "klik" }, s.nadaj, subiekt);

  const [w] = wejscia();
  assert.ok(w, "brak wiersza wejścia");
  assert.equal(w.watek, s.widziane.watek, "wątek bit w bit jak w żądaniu");
  assert.equal(w.fakty, s.widziane.fakty, "fakty bit w bit jak w żądaniu");
  assert.equal(String(w.watek).includes(TELEFON), false, "telefon klienta w wejściu");
  assert.equal(String(w.watek).includes("zielony_ogrod"), false, "login klienta w wejściu");
  const ksiega = db().prepare("SELECT id FROM copilot_wywolanie").get() as { id: number };
  assert.equal(w.wywolanie_id, ksiega.id);
  assert.deepEqual([w.conversation_id, w.message_id, w.zadanie, w.zrodlo, w.wersja_instrukcji, w.model],
    [rozmowa, wiadomosc, "szkic", "klik", "s1", "claude-opus-5"]);
  assert.equal(w.wynik_sit, "ok");
  const wyj = JSON.parse(String(w.wyjscie)) as { tresc: string; uzyteFakty: string[] };
  assert.equal(wyj.tresc, "Dzień dobry, gaźnik W09-0211 jest dziś dostępny (F1).",
    "wyjście to odpowiedź PRZED sitami, ze znacznikami faktów");
  assert.deepEqual(wyj.uzyteFakty, ["F1"]);
});

test("szkic odrzucony sitem zostawia wejście z kodem sita i surową odpowiedzią", async () => {
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), szpieg({ tresc: "Pasuje uszczelka XYZ-9999 (F1)." }).nadaj,
    subiekt));
  const [w] = wejscia();
  assert.equal(w.wynik_sit, "numer_niezadeklarowany");
  assert.match(String(w.wyjscie), /XYZ-9999/);
  const ksiega = db().prepare("SELECT id, kod_bledu FROM copilot_wywolanie").get() as { id: number; kod_bledu: string };
  assert.equal(w.wywolanie_id, ksiega.id);
  assert.equal(ksiega.kod_bledu, "numer_niezadeklarowany");
});

test("błąd dostawcy po rundach narzędzi zostawia wejście z wynikami narzędzi i bez wyjścia", async () => {
  const wyniki = [{ id: "N1", nazwa: "karta_towaru", argument: "W09-0211", tresc: "Kartoteka W09-0211: gaźnik" }];
  const nadaj: import("./copilot-szkic.js").NadawcaSzkicu = async () => {
    throw Object.assign(new BladOdpowiedziCopilota("Model nie oddał szkicu", 200, "", "uciety"), {
      zuzycie: { wej: 300, wyj: 40, cacheZapis: 0, cacheOdczyt: 0 }, rund: 2, narzedzi: 1,
      wersjaInstrukcji: "s1", wynikiNarzedzi: wyniki,
    });
  };
  await assert.rejects(S.ulozSzkic(rozmowa, KTO(), nadaj, subiekt), /nie oddał/);

  const [w] = wejscia();
  assert.deepEqual(JSON.parse(String(w.wyniki_narzedzi)), wyniki);
  assert.equal(w.wyjscie, null);
  assert.equal(w.wynik_sit, null, "sita nie ruszyły");
  assert.equal(w.wersja_instrukcji, "s1");
  assert.equal(w.model, config.copilot.model, "rundy zapłacone, więc model z konfiguracji");
  const ksiega = db().prepare("SELECT id, kod_bledu FROM copilot_wywolanie").get() as { id: number; kod_bledu: string };
  assert.equal(w.wywolanie_id, ksiega.id);
  assert.equal(ksiega.kod_bledu, "uciety");
});

test("zdjęcia w wejściu: numer, załącznik, typ i rozmiar, bez bajtów i bez nazwy pliku", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  db().prepare(`INSERT INTO message_attachment(message_id,file_name,mime_type,url,status)
    VALUES (?,?,?,?,?)`).run(wiadomosc, "jan-kowalski-paragon.png", "image/png", "https://allegro.pl/plik/x", "SAFE");
  await S.ulozSzkic(rozmowa, KTO(), szpieg().nadaj, subiekt, new Date(),
    async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer);

  const [w] = wejscia();
  const zdjecia = JSON.parse(String(w.zdjecia)) as Array<Record<string, unknown>>;
  assert.equal(zdjecia.length, 1);
  assert.deepEqual(Object.keys(zdjecia[0]!).sort(), ["bajtow", "numer", "typ", "zalacznikId"]);
  assert.equal(zdjecia[0]!.numer, "Z1");
  assert.equal(zdjecia[0]!.typ, "image/png");
  assert.equal(zdjecia[0]!.bajtow, png.length);
  assert.equal(typeof zdjecia[0]!.zalacznikId, "number");
  assert.equal(String(w.zdjecia).includes("kowalski"), false, "nazwa pliku w liście zdjęć");
});

test("przełącznik 0: szkic powstaje, wejścia nie ma, księga stoi", async () => {
  await zPrzelacznikiem(false, async () => {
    await S.ulozSzkic(rozmowa, KTO(), szpieg().nadaj, subiekt);
  });
  assert.equal(liczba("szkic_copilota"), 1);
  assert.equal(liczba("copilot_wywolanie"), 1);
  assert.equal(liczba("copilot_wejscie"), 0);
});

test("błąd zapisu wejścia nie wywraca szkicu ani księgi", async () => {
  db().exec("DROP TABLE copilot_wejscie");
  const ostrzezenia: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { ostrzezenia.push(a.map(String).join(" ")); };
  try {
    const s = await S.ulozSzkic(rozmowa, KTO(), szpieg().nadaj, subiekt);
    assert.ok(s.tresc.length > 0);
  } finally {
    console.warn = warn;
    migrate(db());
  }
  assert.equal(liczba("szkic_copilota"), 1);
  assert.equal(liczba("copilot_wywolanie"), 1);
  assert.ok(ostrzezenia.some((m) => m.includes("[copilot-wejscie]")), "porażka zapisu mówi o sobie w logu");
  assert.ok(ostrzezenia.every((m) => !m.includes(TELEFON)), "log bez treści wątku");
});

/* ── Dopytanie ─────────────────────────────────────────────────────────── */

test("dopytanie zapisuje ZAMASKOWANE pole, pytanie agenta, historię i surową wersję", async () => {
  const pole = `Dzień dobry, oddzwonimy pod ${TELEFON}.`;
  const nadaj: import("./copilot-pytania.js").NadawcaPytania = async (k) => ({
    tresc: "Dodałem podziękowanie.", twierdzenia: [], model: "atrapa", ms: 5, narzedzia: [],
    zuzycie: { wej: 100, wyj: 20, cacheZapis: 0, cacheOdczyt: 0 }, wersjaInstrukcji: "p1",
    /* Model odsyła pole ze znacznikiem, tak jak je dostał. */
    szkic: { tresc: `${String(k.szkic)} Dziękujemy.`, uzyteFakty: [], zastrzezenia: [], twierdzenia: [],
      odczytZeZdjec: [] },
  });
  const wymiana = await Q.zadajPytanie(rozmowa, "Dodaj podziękowanie", KTO(), nadaj, subiekt, { szkic: pole });
  assert.ok(wymiana.szkicPo?.includes(TELEFON), "agent dostaje wersję z wartościami");

  const [w] = wejscia();
  assert.equal(w.pytanie, "Dodaj podziękowanie");
  assert.equal(String(w.szkic_wejscie).includes(TELEFON), false, "surowy telefon z pola w wejściu");
  assert.match(String(w.szkic_wejscie), /\[telefon 1\]/);
  assert.equal(String(w.wyjscie).includes(TELEFON), false, "odmaskowana poprawka w wejściu");
  assert.equal(String(w.watek).includes(TELEFON), false);
  assert.deepEqual(JSON.parse(String(w.historia)), []);
  assert.deepEqual([w.zadanie, w.zrodlo, w.wersja_instrukcji, w.wynik_sit], ["pytanie", "dopytanie", "p1", "ok"]);
  const ksiega = db().prepare("SELECT id FROM copilot_wywolanie").get() as { id: number };
  assert.equal(w.wywolanie_id, ksiega.id);
});

test("drugie dopytanie zapisuje historię, którą dostał model", async () => {
  const nadaj = (tresc: string): import("./copilot-pytania.js").NadawcaPytania => async () => ({
    tresc, twierdzenia: [], model: "atrapa", ms: 5, narzedzia: [],
    zuzycie: { wej: 100, wyj: 20, cacheZapis: 0, cacheOdczyt: 0 },
  });
  await Q.zadajPytanie(rozmowa, "Pytanie pierwsze", KTO(), nadaj("Odpowiedź pierwsza"), subiekt);
  await Q.zadajPytanie(rozmowa, "Pytanie drugie", KTO(), nadaj("Odpowiedź druga"), subiekt);
  const [, drugie] = wejscia();
  assert.deepEqual(JSON.parse(String(drugie!.historia)),
    [{ pytanie: "Pytanie pierwsze", odpowiedz: "Odpowiedź pierwsza", zdjecAgenta: 0 }]);
  assert.equal(drugie!.szkic_wejscie, null, "bez pola i bez szkicu nie ma czego poprawiać");
  assert.equal(drugie!.wynik_sit, null, "bez wersji sita nie miały czego sprawdzać");
});

test("błąd dostawcy przy dopytaniu zostawia wejście z wynikami narzędzi", async () => {
  const wyniki = [{ id: "N1", nazwa: "szukaj_towaru", argument: "gaźnik", tresc: "W09-0211 gaźnik" }];
  const nadaj: import("./copilot-pytania.js").NadawcaPytania = async () => {
    throw Object.assign(new BladOdpowiedziCopilota("Model nie oddał odpowiedzi", 200, "", "uciety"), {
      zuzycie: { wej: 100, wyj: 10, cacheZapis: 0, cacheOdczyt: 0 }, rund: 1, narzedzi: 1, wynikiNarzedzi: wyniki,
    });
  };
  await assert.rejects(Q.zadajPytanie(rozmowa, "Jaki gaźnik?", KTO(), nadaj, subiekt));
  const [w] = wejscia();
  assert.deepEqual(JSON.parse(String(w.wyniki_narzedzi)), wyniki);
  assert.equal(w.wyjscie, null);
  assert.equal(w.pytanie, "Jaki gaźnik?");
  assert.equal(liczba("copilot_pytanie"), 0, "nieudane wywołanie nie zostawia wymiany");
});

test("przełącznik 0 przy dopytaniu: wymiana stoi, wejścia nie ma", async () => {
  await zPrzelacznikiem(false, async () => {
    await Q.zadajPytanie(rozmowa, "Pasuje?", KTO(), async () => ({
      tresc: "Tak.", twierdzenia: [], model: "atrapa", ms: 5, narzedzia: [],
      zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0 },
    }), subiekt);
  });
  assert.equal(liczba("copilot_pytanie"), 1);
  assert.equal(liczba("copilot_wejscie"), 0);
});

/* ── Odmowa maskowania ─────────────────────────────────────────────────
   Najgroźniejsza ścieżka: wątek z daną klienta, której maskowanie nie
   zdjęło. Nic nie wychodzi do dostawcy, więc wejścia też nie ma.

   Jak ją wywołać bez atrapy modułu: login rozmówcy brzmi jak słowo, po
   którym telefon NIE jest maskowany („symbol”). Wzorzec zostawia numer,
   potem podmiana loginu zdejmuje słowo, a asercja widzi gołe cyfry. */

function watekNieDoMaskowania() {
  db().prepare("UPDATE allegro_inbox_thread SET interlocutor_login='symbol' WHERE id='w-1'").run();
  db().prepare("UPDATE message SET body=? WHERE id=?").run(`Proszę o symbol ${TELEFON}`, wiadomosc);
}

test("odmowa maskowania przy szkicu: nic do dostawcy i zero wierszy wejścia", async () => {
  watekNieDoMaskowania();
  let wyslano = 0;
  await assert.rejects(
    S.ulozSzkic(rozmowa, KTO(), async (w, f, z) => { wyslano += 1; return szpieg().nadaj(w, f, z); }, subiekt),
    /Maskowanie nie oczyściło/);
  assert.equal(wyslano, 0, "nadawca nie mógł zostać wywołany");
  assert.equal(liczba("copilot_wejscie"), 0);
  const ks = db().prepare("SELECT kod_bledu FROM copilot_wywolanie").get() as { kod_bledu: string };
  assert.equal(ks.kod_bledu, "maskowanie", "księga zna odmowę, wejście nie");
});

test("odmowa maskowania przy dopytaniu: nic do dostawcy i zero wierszy wejścia", async () => {
  watekNieDoMaskowania();
  let wyslano = 0;
  await assert.rejects(Q.zadajPytanie(rozmowa, "Pasuje?", KTO(), async () => {
    wyslano += 1;
    return { tresc: "Tak.", twierdzenia: [], model: "atrapa", ms: 5, narzedzia: [],
      zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0 } };
  }, subiekt), /Maskowanie nie oczyściło/);
  assert.equal(wyslano, 0);
  assert.equal(liczba("copilot_wejscie"), 0);
});

/* ── Retencja ──────────────────────────────────────────────────────────── */

function wejscieZ(at: string) {
  return W.zapiszWejscie(db(), {
    wywolanieId: null, conversationId: rozmowa, zadanie: "szkic", at: new Date(at),
    watek: "KLIENT: [telefon]" as import("./copilot-maskowanie.js").TrescBezpieczna,
    fakty: "F1: x" as import("./copilot-szkic.js").FaktyBezpieczne, zdjecia: [],
  });
}

test("sprzątanie kasuje starsze niż 90 dni, zostawia te na granicy i młodsze", () => {
  const teraz = new Date("2026-12-31T12:00:00.000Z");
  const stare = wejscieZ("2026-10-02T11:59:59.999Z");
  const granica = wejscieZ("2026-10-02T12:00:00.000Z");
  const mlode = wejscieZ("2026-12-30T12:00:00.000Z");

  assert.equal(W.sprzatnijWejscia(db(), teraz), 1);
  const zostaly = wejscia().map((w) => w.id);
  assert.deepEqual(zostaly, [granica, mlode]);
  assert.equal(zostaly.includes(stare), false);

  const ev = db().prepare("SELECT payload FROM events WHERE type='copilot_wejscie_retencja'").all() as Array<{ payload: string }>;
  assert.equal(ev.length, 1);
  assert.deepEqual(JSON.parse(ev[0]!.payload), { usunietych: 1, granica: "2026-10-02T12:00:00.000Z" });
});

test("sprzątanie bez niczego do skasowania nie pisze do dziennika", () => {
  wejscieZ("2026-12-30T12:00:00.000Z");
  assert.equal(W.sprzatnijWejscia(db(), new Date("2026-12-31T12:00:00.000Z")), 0);
  assert.equal(liczba("events"), 0);
});

test("sprzątanie chodzi także przy wyłączonym zapisie", async () => {
  wejscieZ("2026-01-01T00:00:00.000Z");
  await zPrzelacznikiem(false, async () => {
    assert.equal(W.sprzatnijWejscia(db(), new Date("2026-12-31T12:00:00.000Z")), 1);
  });
});

test("skasowanie rozmowy kasuje jej wejścia, a skasowanie księgi zostawia wejście bez wskazania", async () => {
  await S.ulozSzkic(rozmowa, KTO(), szpieg().nadaj, subiekt);
  assert.equal(liczba("copilot_wejscie"), 1);
  db().prepare("DELETE FROM copilot_wywolanie").run();
  assert.equal((wejscia()[0]!).wywolanie_id, null);

  for (const t of ["szkic_copilota", "conversation_event", "message"]) {
    db().prepare(`DELETE FROM ${t} WHERE conversation_id=?`).run(rozmowa);
  }
  db().prepare("DELETE FROM conversation WHERE id=?").run(rozmowa);
  assert.equal(liczba("copilot_wejscie"), 0);
});
