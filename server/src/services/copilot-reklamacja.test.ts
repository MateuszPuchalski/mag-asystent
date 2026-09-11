import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  kartaSprawy, ocenRekomendacje, odsiejBezPokrycia, ponumerujRozmowe, pustaKarta,
  rozpoznajSprawe, sugerujeWerdykt, trafnoscRad, type OdpowiedzRozpoznania,
} from "./copilot-reklamacja.js";

/* ── Copilot reklamacyjny (0.275.0) ──────────────────────────────────────────
   Trzy bramki, z których dwie są deterministyczne i dlatego w ogóle warte
   zaufania:

   1. MASZYNA NIE DOTYKA WERDYKTU. Uznanie i odrzucenie są nieodwracalne wobec
      kupującego, więc karta z sugestią rozstrzygnięcia leci w całości — i robi
      to kod, nie prompt. Prompt jest prośbą; bramka jest regułą.
   2. KAŻDE ZDANIE MA CYTAT. Pole z numerem wiadomości, której nie ma w tej
      rozmowie, znika przed zapisem.
   3. WYWOŁANIE ZOSTAWIA ŚLAD, także nieudane. Próba, która nie doszła, też
      bywa płatna, a brak wiersza gubiłby tę część rachunku.                 */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','Ala','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,kupujacy_login,otwarto_at,synced_at)
    VALUES (?,'i-1','kupujacy1','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto).lastInsertRowid);
  const wiadomosc = (n: number, rola: string, tresc: string) =>
    d.prepare(`INSERT INTO reklamacja_wiadomosc
      (reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
      VALUES (?,?,?,?,?)`).run(id, `w-${n}`, rola, tresc, `2026-09-0${n}T10:00:00Z`);
  wiadomosc(1, "BUYER", "Kosiarka przestała ciąć po tygodniu, proszę o wymianę");
  wiadomosc(2, "SELLER", "Proszę o zdjęcie noża");
  return { d, id };
}

const KTO = { id: 1, name: "Ala" };
const ZUZYCIE = { wej: 100, wyj: 50, cacheZapis: 0, cacheOdczyt: 0 };

const karta = (n: Partial<OdpowiedzRozpoznania> = {}): OdpowiedzRozpoznania => ({
  usterka: { tresc: "Kosiarka przestała ciąć", zrodlo: "W1" },
  kiedy: { tresc: "po tygodniu używania", zrodlo: "W1" },
  oczekiwanie: { tresc: "wymiana", zrodlo: "W1" },
  dowody: [],
  brakuje: ["zdjęcie noża", "data zakupu"],
  rada: {
    co: "POPROSIC_O_DOWODY", pewnosc: "srednia",
    uzasadnienie: { tresc: "Bez zdjęcia noża nie widać, czy usterka jest fabryczna", zrodlo: "W1" },
    czegoNieWiem: ["czy nóż był ostrzony"],
  },
  model: "claude-test", zuzycie: ZUZYCIE, ms: 120, ...n,
});

test("rozmowa idzie do modelu PONUMEROWANA, żeby dało się sprawdzić cytaty", () => {
  const { watek, numery } = ponumerujRozmowe([
    { odKlienta: true, tresc: "nie działa" },
    { odKlienta: false, tresc: "proszę o zdjęcie" },
  ]);
  assert.equal(watek[0].tresc, "[W1] nie działa");
  assert.equal(watek[1].tresc, "[W2] proszę o zdjęcie");
  assert.deepEqual([...numery], ["W1", "W2"]);
});

test("słowa werdyktu rozpoznajemy niezależnie od wielkości liter i odmiany", () => {
  assert.equal(sugerujeWerdykt("Reklamacja wygląda na zasadną"), true);
  assert.equal(sugerujeWerdykt("Proponuję uznać"), true);
  assert.equal(sugerujeWerdykt("ODRZUCIĆ"), true);
  assert.equal(sugerujeWerdykt("Brakuje zdjęcia tabliczki znamionowej"), false);
  assert.equal(sugerujeWerdykt("Klient chce wymiany towaru"), false);
});

test("pole z cytatem spoza rozmowy ZNIKA, a reszta karty zostaje", () => {
  /* Inaczej niż przy szkicu, gdzie wymyślony numer kasuje wszystko: tam liczba
     wchodzi do zdania wysyłanego kupującemu, tutaj karta jest notatką dla
     agenta, który ma rozmowę przed oczami. */
  const { karta: k, odsiano } = odsiejBezPokrycia(karta({
    kiedy: { tresc: "w marcu", zrodlo: "W9" },
    dowody: [{ tresc: "zdjęcie", zrodlo: "W1" }, { tresc: "paragon", zrodlo: "W7" }],
  }), new Set(["W1", "W2"]));

  assert.equal(k.kiedy, null, "cytat spoza rozmowy nie przechodzi");
  assert.ok(k.usterka, "reszta karty zostaje");
  assert.deepEqual(k.dowody.map((x) => x.tresc), ["zdjęcie"]);
  assert.equal(odsiano, 2);
  /* `brakuje` nie ma cytatu z natury rzeczy — mówi o tym, czego w rozmowie NIE MA. */
  assert.deepEqual(k.brakuje, ["zdjęcie noża", "data zakupu"]);
});

test("karta bez ani jednego pokrycia jest pusta i nie ma po co iść na ekran", () => {
  const { karta: k } = odsiejBezPokrycia({
    usterka: { tresc: "x", zrodlo: "W9" }, kiedy: null, oczekiwanie: null,
    dowody: [], brakuje: [], rada: null,
  }, new Set(["W1"]));
  assert.equal(pustaKarta(k), true);
});

test("RADA jest dozwolona (0.276.0) i zapisuje się razem z kartą", async () => {
  /* Do 0.275.0 ten moduł odrzucał każdą kartę z rozstrzygnięciem — moja
     decyzja. Właściciel odwrócił ją tego samego dnia: „copilot powinien też
     radzić w reklamacji". */
  const { d, id } = stanowisko();
  await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ rada: {
      co: "ACCEPTED_REFUND", pewnosc: "srednia",
      uzasadnienie: { tresc: "Usterka zgłoszona w pierwszym tygodniu", zrodlo: "W1" },
      czegoNieWiem: ["czy towar był używany zgodnie z instrukcją"],
    } }),
  });
  const k = kartaSprawy(d, id)!;
  assert.equal(k.rada?.co, "ACCEPTED_REFUND");
  assert.equal(k.rada?.uzasadnienie.zrodlo, "W1");
  assert.deepEqual(k.rada?.czegoNieWiem, ["czy towar był używany zgodnie z instrukcją"]);
});

test("werdykt w polu FAKTOGRAFICZNYM dalej odrzuca kartę", async () => {
  /* Cała różnica między 0.275.0 a 0.276.0: rada jest dozwolona, ale ma stać
     w swoim polu. W `usterka` wyglądałaby jak cytat z kupującego. */
  const { d, id } = stanowisko();
  await assert.rejects(() => rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({
      usterka: { tresc: "Reklamacja zasadna, kosiarka nie działa", zrodlo: "W1" },
    }),
  }), /rozstrzygnięcie w pole opisujące słowa klienta/);

  assert.equal(kartaSprawy(d, id), null, "odrzucona karta nie zapisuje się wcale");
  const w = d.prepare(
    "SELECT wynik, blad FROM copilot_wywolanie WHERE zadanie='rozpoznanie_reklamacji'")
    .get() as { wynik: string; blad: string };
  assert.equal(w.wynik, "blad");
  assert.match(w.blad, /werdykt w faktach/);
});

test("wysoka pewność BEZ nazwanej niewiedzy jest odrzucana", async () => {
  /* Model, który nie umie powiedzieć, co zmieniłoby jego zdanie, nie zważył
     sprawy — zgadł. To nie jest pewność, tylko brawura. */
  const { d, id } = stanowisko();
  await assert.rejects(() => rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ rada: {
      co: "REJECTED_OTHER", pewnosc: "wysoka",
      uzasadnienie: { tresc: "Klient sam przyznał, że upuścił", zrodlo: "W1" },
      czegoNieWiem: [],
    } }),
  }), /nie nazywając ani jednej rzeczy/);
  assert.equal(kartaSprawy(d, id), null);
});

test("rada z cytatem spoza rozmowy znika CAŁA, nie samo uzasadnienie", async () => {
  /* Rekomendacja bez podstawy to gołe „uznaj" — a takie zdanie wygląda
     na ugruntowane i jest gorsze od braku rady. */
  const { d, id } = stanowisko();
  await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ rada: {
      co: "ACCEPTED_EXCHANGE", pewnosc: "niska",
      uzasadnienie: { tresc: "Tak wynika z rozmowy", zrodlo: "W9" },
      czegoNieWiem: ["wszystko"],
    } }),
  });
  assert.equal(kartaSprawy(d, id)!.rada, null, "rada bez pokrycia nie trafia na ekran");
});

test("udane rozpoznanie zapisuje kartę, księgę i ślad BEZ treści", async () => {
  const { d, id } = stanowisko();
  const k = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d, nadaj: async () => karta(),
  });

  assert.equal(k.usterka?.tresc, "Kosiarka przestała ciąć");
  const zapisana = kartaSprawy(d, id)!;
  assert.equal(zapisana.oczekiwanie?.tresc, "wymiana");
  assert.deepEqual(zapisana.brakuje, ["zdjęcie noża", "data zakupu"]);
  assert.equal(zapisana.przez, "Ala");

  const ksiega = d.prepare(
    "SELECT wynik, model, tokeny_wej, reklamacja_id FROM copilot_wywolanie").get() as
    Record<string, unknown>;
  assert.equal(ksiega.wynik, "ok");
  assert.equal(ksiega.model, "claude-test");
  assert.equal(Number(ksiega.tokeny_wej), 100);
  assert.equal(Number(ksiega.reklamacja_id), id, "księga wie, o którą sprawę chodziło");

  /* Dziennik niesie LICZBY, nigdy słów klienta — `events` nie ma retencji. */
  const zdarzenie = d.prepare(
    "SELECT payload FROM events WHERE type='reklamacja_rozpoznanie'").get() as
    { payload: string };
  assert.ok(!zdarzenie.payload.includes("Kosiarka"), "treść karty nie idzie do dziennika");
  assert.equal(JSON.parse(zdarzenie.payload).brakuje, 2);
});

test("ponowne rozpoznanie NADPISUJE kartę, zamiast mnożyć wiersze", async () => {
  const { d, id } = stanowisko();
  await rozpoznajSprawe({ reklamacjaId: id, kto: KTO, database: d, nadaj: async () => karta() });
  await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ oczekiwanie: { tresc: "zwrot pieniędzy", zrodlo: "W1" } }),
  });
  assert.equal(kartaSprawy(d, id)!.oczekiwanie?.tresc, "zwrot pieniędzy");
  const ile = d.prepare("SELECT count(*) n FROM reklamacja_karta").get() as { n: number };
  assert.equal(Number(ile.n), 1);
});

test("sprawa bez rozmowy mówi to zdaniem i nie płaci za nic", async () => {
  const { d } = stanowisko();
  const pusta = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,otwarto_at,synced_at)
    VALUES (1,'i-2','2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`).run().lastInsertRowid);
  let strzalow = 0;
  await assert.rejects(() => rozpoznajSprawe({
    reklamacjaId: pusta, kto: KTO, database: d,
    nadaj: async () => { strzalow += 1; return karta(); },
  }), /nie ma jeszcze rozmowy/);
  assert.equal(strzalow, 0, "brak rozmowy rozstrzyga się u nas, nie u dostawcy");
});

test("trafność liczy się z FAKTU: rada kontra werdykt, który agent wysłał", async () => {
  /* Zdanie z krytyki właściciela stoi w `schema.sql` przy klasyfikacji:
     „confidence bez konsekwencji to…". Tutaj domyka się samo, bo rekomendacja
     jest typowana tym samym słownikiem co werdykt — porównanie to równość
     dwóch napisów, a nie ankieta dla agenta. */
  const { d, id } = stanowisko();
  const zRada = (co: string) => rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ rada: {
      co: co as never, pewnosc: "srednia",
      uzasadnienie: { tresc: "bo tak wynika ze zgłoszenia", zrodlo: "W1" },
      czegoNieWiem: ["data zakupu"],
    } }),
  });

  await zRada("ACCEPTED_REFUND");
  assert.equal(ocenRekomendacje(d, id, "ACCEPTED_REFUND"), "trafna");
  assert.equal(kartaSprawy(d, id)!.ocena, "trafna");

  await zRada("ACCEPTED_REFUND");
  assert.equal(kartaSprawy(d, id)!.ocena, null, "nowa rada kasuje ocenę starej");
  assert.equal(ocenRekomendacje(d, id, "REJECTED_OTHER"), "nietrafna");
});

test("rada „poproś o dowody” NIE jest porównywana z werdyktem — i to nie luka", async () => {
  /* Ta rada mówi „jeszcze nie rozstrzygaj", więc każdy późniejszy werdykt może
     być słuszny: zapadł na innym materiale. `null` znaczy „nie ma z czym
     porównać" i jest uczciwsze niż udawany pomiar. */
  const { d, id } = stanowisko();
  await rozpoznajSprawe({ reklamacjaId: id, kto: KTO, database: d, nadaj: async () => karta() });
  assert.equal(ocenRekomendacje(d, id, "ACCEPTED_REFUND"), null);
  assert.equal(kartaSprawy(d, id)!.ocena, null);
});

test("ocena BEZ karty jest cicha — werdykt nie zależy od Copilota", async () => {
  /* Najważniejsza asercja tego pliku. Copilot jest dodatkiem, a werdykt
     podstawową pracą biura: reklamacja rozstrzygnięta bez rady ma zapaść
     dokładnie tak samo. */
  const { d, id } = stanowisko();
  assert.equal(ocenRekomendacje(d, id, "ACCEPTED_REFUND"), null);
  assert.equal(ocenRekomendacje(d, 9999, "ACCEPTED_REFUND"), null);
});

test("licznik trafności oddziela rady OCENIONE od wszystkich", async () => {
  /* Sprawy bez werdyktu nie są ani sukcesem, ani porażką modelu — są
     niedokończone i nie mają prawa psuć ani poprawiać wyniku. */
  const { d, id } = stanowisko();
  await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ rada: {
      co: "ACCEPTED_REFUND", pewnosc: "niska",
      uzasadnienie: { tresc: "x", zrodlo: "W1" }, czegoNieWiem: ["y"],
    } }),
  });
  assert.deepEqual(trafnoscRad(d), { rad: 1, ocenionych: 0, trafnych: 0 });
  ocenRekomendacje(d, id, "ACCEPTED_REFUND");
  assert.deepEqual(trafnoscRad(d), { rad: 1, ocenionych: 1, trafnych: 1 });
});

test("do modelu idzie BLOK FAKTÓW przed rozmową, zamaskowany tak samo (0.282.0)", async () => {
  /* Karta z żywego panelu prosiła agenta o „datę zakupu / numer zamówienia" —
     o dane, które Allegro przysłało razem ze sprawą. Prosiła, bo model ich
     nie dostawał: widział wyłącznie czat. */
  const { d, id } = stanowisko();
  d.prepare(`UPDATE reklamacja_klienta SET order_id='ord-1',
    zamowienie_at='2026-03-14T09:12:00Z', oczekiwanie='EXCHANGE',
    powod_typ='DEFECT_FOUND_DURING_USE', opis='kontakt: jan@example.com' WHERE id=?`).run(id);

  let wyslane = "";
  await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async (tresc) => { wyslane = String(tresc); return karta(); },
  });

  assert.ok(wyslane.includes("FAKTY ZE SPRAWY [S]"), "blok stoi przed rozmową");
  assert.ok(wyslane.includes("Zamówienie złożone: 2026-03-14"));
  assert.ok(wyslane.includes("Numer zamówienia: ord-1"));
  assert.ok(wyslane.includes("Czego klient żąda: EXCHANGE"));
  assert.ok(wyslane.indexOf("FAKTY ZE SPRAWY") < wyslane.indexOf("KLIENT:"));

  /* Blok przechodzi przez maskowanie tą samą drogą co wątek: opis zgłoszenia
     bywa z adresem e-mail, pod który klient prosi o kontakt. */
  assert.ok(!wyslane.includes("jan@example.com"), "opis też jest maskowany");
  assert.ok(wyslane.includes("[e-mail]"));
});

test("fakt oparty na FORMULARZU przeżywa odsiew — blok ma własny numer `S`", async () => {
  /* Bez numeru `S` każde zdanie przepisane ze zgłoszenia wylatywałoby jako
     rzekomo niepokryte, a to są słowa klienta tak samo jak wiadomość. */
  const { d, id } = stanowisko();
  const wynik = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ usterka: { tresc: "Pękła obudowa", zrodlo: "S" } }),
  });
  assert.equal(wynik.usterka?.zrodlo, "S");
});

test("cytat W NAWIASACH przeżywa odsiew — dotąd znikał bez śladu", async () => {
  /* Model widzi w rozmowie `[W1]` i regularnie tak cytuje. `numery.has("[W1]")`
     było fałszem, więc fakt znikał jako niepokryty — poluzowanie doktryny
     przez literówkę, nie przez decyzję. */
  const { d, id } = stanowisko();
  const wynik = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ usterka: { tresc: "Kosiarka nie tnie", zrodlo: "[W1]" } }),
  });
  assert.equal(wynik.usterka?.tresc, "Kosiarka nie tnie");

  /* Ale sito NIE zostało poluzowane: dwa numery naraz dalej wypadają. */
  const drugi = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ usterka: { tresc: "Zmyślone", zrodlo: "W1, W2" } }),
  });
  assert.equal(drugi.usterka, null);
});

test("„brakuje” przestaje prosić o to, co podaliśmy, i ZOSTAWIA resztę", async () => {
  const { d, id } = stanowisko();
  d.prepare("UPDATE reklamacja_klienta SET zamowienie_at='2026-03-14T09:12:00Z' WHERE id=?")
    .run(id);

  const wynik = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ brakuje: ["data zakupu", "zdjęcie tabliczki znamionowej"] }),
  });
  assert.deepEqual(wynik.brakuje, ["zdjęcie tabliczki znamionowej"]);

  const slad = d.prepare(
    "SELECT payload FROM events WHERE type='reklamacja_rozpoznanie'").get() as
    { payload: string };
  const p = JSON.parse(slad.payload) as Record<string, unknown>;
  assert.equal(p.znane, 1, "licznik sita idzie do dziennika — heurystyka bez pomiaru to wiara");
});

test("zdjęcia jadą do nadawcy, a ich numery pokrywają cytat `Z` (0.283.0)", async () => {
  /* Bez własnej przestrzeni numerów każdy fakt odczytany ze zdjęcia wylatywałby
     w odsiewie — `zrodlo` nie pasowałoby do żadnego `W`. */
  const { d, id } = stanowisko();
  d.prepare(`INSERT INTO reklamacja_zalacznik (reklamacja_id,nazwa,url)
    VALUES (?,'tabliczka.png','https://allegro.pl/plik/tabliczka.png')`).run(id);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  let dostal: readonly { numer: string }[] = [];
  let wyslane = "";
  const wynik = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    pobierz: async () => PNG.buffer.slice(
      PNG.byteOffset, PNG.byteOffset + PNG.byteLength) as ArrayBuffer,
    nadaj: async (tresc, zdjecia = []) => {
      dostal = zdjecia; wyslane = String(tresc);
      return karta({ dowody: [{ tresc: "tabliczka NAC LS46-450", zrodlo: "Z1" }] });
    },
  });

  assert.deepEqual(dostal.map((z) => z.numer), ["Z1"]);
  assert.ok(wyslane.includes("[Z1] plik: tabliczka.png"), "spis mówi, który obraz to Z1");
  assert.deepEqual(wynik.dowody, [{ tresc: "tabliczka NAC LS46-450", zrodlo: "Z1" }]);

  /* Mapa zostaje PRZY KARCIE — numer bez nazwy pliku byłby cytatem,
     którego agent nie ma jak sprawdzić. */
  const zapisana = kartaSprawy(d, id)!;
  assert.deepEqual(zapisana.zdjecia.map((z) => [z.numer, z.nazwa]), [["Z1", "tabliczka.png"]]);
});

test("cytat ze zdjęcia, którego NIE MA, dalej wypada", async () => {
  const { d, id } = stanowisko();
  const wynik = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async () => karta({ dowody: [{ tresc: "zmyślone", zrodlo: "Z9" }] }),
  });
  assert.deepEqual(wynik.dowody, []);
});

test("sprawa bez zdjęć działa jak dotąd — to większość spraw", async () => {
  /* Ważniejsze od reszty testów tego wydania: zdjęcie jest dodatkiem,
     rozpoznanie podstawową pracą. */
  const { d, id } = stanowisko();
  let dostal: unknown = "nie wołano";
  const wynik = await rozpoznajSprawe({
    reklamacjaId: id, kto: KTO, database: d,
    nadaj: async (_t, zdjecia) => { dostal = zdjecia; return karta(); },
  });
  assert.deepEqual(dostal, []);
  assert.equal(wynik.usterka?.tresc, "Kosiarka przestała ciąć");

  const slad = d.prepare(
    "SELECT payload FROM events WHERE type='reklamacja_rozpoznanie'").get() as
    { payload: string };
  const p = JSON.parse(slad.payload) as Record<string, unknown>;
  assert.equal(p.zdjec, 0);
  /* Dziennik niesie LICZBY, nigdy nazw plików ani bajtów. */
  assert.ok(!JSON.stringify(p).includes("plik"));
});
