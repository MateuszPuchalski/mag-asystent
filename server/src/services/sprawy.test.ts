import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Sprawy — jedna kolejka czterech rejestrów ───────────────────────────────
   Trzy rzeczy do upilnowania:

   1. KOMPLETNOŚĆ. Predykaty otwartości są przepisane z serwisów per-typ —
      test porównuje liczby z tamtymi serwisami, żeby status dopisany
      w jednym miejscu nie schował spraw z głównej kolejki.
   2. PILNOŚĆ. Ustawowy termin (reklamacja, CLAIM) bije wiek: przeterminowana
      reklamacja stoi przed najstarszym pytaniem bez terminu.
   3. POWIĄZANIA. To samo zamówienie łączy mocniej niż ten sam login —
      i nigdy nie pokazujemy sprawy samej sobie.                              */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-spr-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let S: typeof import("./sprawy.js");
let P: typeof import("./pytania.js");
let D: typeof import("./dyskusje.js");
let R: typeof import("./reklamacje.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./sprawy.js");
  P = await import("./pytania.js");
  D = await import("./dyskusje.js");
  R = await import("./reklamacje.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["sprawa_zrodlo", "sprawa", "dyskusja", "pytanie", "zwrot_pozycja", "zwrot"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

const teraz = () => new Date().toISOString();
const dniTemu = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function pytanie(login: string | null, status = "nowe", otrzymano = teraz()): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO pytanie(zrodlo, kupujacy_login, tresc, otrzymano_at, status,
           produkty_json, utworzono_at, utworzono_przez)
         VALUES ('allegro', ?, 'Czy pasuje?', ?, ?, '[]', ?, 'Test')`
      )
      .run(login, otrzymano, status, teraz()).lastInsertRowid
  );
}

function zwrot(login: string | null, status = "nowy", orderId: string | null = null): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO zwrot(kupujacy_login, waybill, status, allegro_order_id,
           utworzono_allegro, utworzono_at, utworzono_przez)
         VALUES (?, 'WB-1', ?, ?, ?, ?, 'Test')`
      )
      .run(login, status, orderId, teraz(), teraz()).lastInsertRowid
  );
}

function reklamacja(zwrotId: number, wynik: string | null = null): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO zwrot_pozycja(zwrot_id, nazwa, ilosc, decyzja, decyzja_at,
           decyzja_przez, rekl_wynik)
         VALUES (?, 'Pęknięty nóż', 1, 'reklamacja', ?, 'Test', ?)`
      )
      .run(zwrotId, teraz(), wynik).lastInsertRowid
  );
}

function dyskusja(
  login: string | null,
  opts: { typ?: string; status?: string; orderId?: string | null; od?: string } = {}
): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO dyskusja(allegro_id, typ, status, temat, kupujacy_login,
           order_id, utworzono_allegro, widziano_at, utworzono_at)
         VALUES (?, ?, ?, 'Temat', ?, ?, ?, ?, ?)`
      )
      .run(
        `iss-${Math.floor(Math.random() * 1e9)}`,
        opts.typ ?? "DISCUSSION",
        opts.status ?? "nowa",
        login,
        opts.orderId ?? null,
        opts.od ?? teraz(),
        teraz(),
        teraz()
      ).lastInsertRowid
  );
}

/* ── Kolejka ───────────────────────────────────────────────────────────────── */

test("kolejka widzi cztery rejestry i tylko sprawy otwarte", () => {
  pytanie("jan", "nowe");
  pytanie("jan", "wyslane"); // zamknięta — poza kolejką
  const z = zwrot("jan", "nowy");
  reklamacja(z);
  reklamacja(z, "uznana"); // rozpatrzona — poza kolejką
  dyskusja("jan", { status: "w_toku" });
  dyskusja("jan", { status: "zamknieta" });
  zwrot("ewa", "rozliczony"); // terminalna — poza kolejką

  const sprawy = S.listaSpraw();
  assert.deepEqual(
    sprawy.map((s) => s.rodzaj).sort(),
    ["dyskusja", "pytanie", "reklamacja", "zwrot"],
    "po jednej otwartej sprawie każdego rodzaju"
  );
  assert.ok(sprawy.every((s) => s.otwarta));
  // filtr rodzaju zawęża, nie przemyca innych typów
  assert.deepEqual(S.listaSpraw("pytanie").map((s) => s.rodzaj), ["pytanie"]);
});

test("liczby kolejki równe serwisom per-typ — predykaty nie mogą dryfować", () => {
  pytanie("jan", "nowe");
  pytanie("ala", "szkic");
  const z = zwrot("jan", "oceniony");
  reklamacja(z);
  dyskusja("ola", { typ: "CLAIM", status: "nowa" });

  /* Po 0.128.0 wiersz kolejki to sprawa, więc z licznikami per-typ mają się
     zgadzać ŹRÓDŁA spraw, nie wiersze — sklejenie po order_id celowo skraca
     kolejkę poniżej sumy rejestrów. */
  const sprawy = S.listaSpraw();
  const zrodel = (r: string) =>
    sprawy.flatMap((s) => s.zrodla ?? []).filter((z) => z.rodzaj === r).length;
  assert.equal(zrodel("pytanie"), P.licznikOtwartych());
  assert.equal(zrodel("dyskusja"), D.licznikDyskusji().nowe + D.licznikDyskusji().wToku);
  assert.equal(zrodel("reklamacja"), R.listaReklamacji().length);
  assert.equal(S.licznikSpraw().otwartych, sprawy.length, "pigułka = długość kolejki");
});

test("ustawowy termin bije wiek: przeterminowany CLAIM przed starym pytaniem", () => {
  pytanie("jan", "nowe", dniTemu(30)); // najstarsza sprawa, ale bez zegara
  dyskusja("ola", { typ: "CLAIM", status: "nowa", od: dniTemu(20) }); // po terminie 14 dni
  const z = zwrot("ewa", "nowy");
  reklamacja(z); // termin za ~14 dni

  const sprawy = S.listaSpraw();
  assert.equal(sprawy[0].rodzaj, "dyskusja", "przeterminowany CLAIM na szczycie");
  assert.equal(sprawy[0].poTerminie, true);
  assert.equal(sprawy[1].rodzaj, "reklamacja", "termin przyszły przed brakiem terminu");
  assert.equal(sprawy[2].rodzaj, "pytanie");
  assert.equal(sprawy[2].dniDoTerminu, null);
});

/* ── Klient 360 ────────────────────────────────────────────────────────────── */

test("Klient 360: aktywne po pilności, historia od najnowszej, kubełek bez loginu", () => {
  pytanie("jan", "nowe");
  pytanie("jan", "wyslane", dniTemu(5));
  pytanie("jan", "zamkniete", dniTemu(2));
  const z = zwrot("jan", "rozliczony");
  reklamacja(z, "odrzucona");
  // sprawy bez loginu — wklejka i zwrot ręczny
  pytanie(null, "nowe");
  zwrot(null, "nowy");

  const jan = S.sprawyKlienta("jan");
  assert.equal(jan.aktywne.length, 1);
  assert.equal(jan.historia.length, 4);
  assert.ok(
    Date.parse(jan.historia[0].kiedy!) >= Date.parse(jan.historia.at(-1)!.kiedy!),
    "historia od najnowszej"
  );

  const kubelek = S.sprawyKlienta(null);
  assert.deepEqual(
    kubelek.aktywne.map((s) => s.rodzaj).sort(),
    ["pytanie", "zwrot"],
    "sprawy bez klienta nie giną — mają wspólny kubełek"
  );
});

/* ── Powiązania ────────────────────────────────────────────────────────────── */

test("powiązania: to samo zamówienie mocniej niż ten sam login, bez samej siebie", () => {
  const z = zwrot("jan", "nowy", "zam-1");
  const rekl = reklamacja(z);
  const dysk = dyskusja("jan", { status: "w_toku", orderId: "zam-1" });
  pytanie("jan", "nowe"); // ten sam login, inne (nieznane) zamówienie
  dyskusja("jan", { status: "w_toku", orderId: "zam-2" }); // inny problem tego klienta
  dyskusja("obcy", { status: "w_toku", orderId: "zam-9" }); // cudza sprawa — niewidoczna

  const p = S.powiazaneSprawy("dyskusja", dysk);
  assert.deepEqual(
    p.zamowienie.map((s) => `${s.rodzaj}:${s.id}`).sort(),
    [`reklamacja:${rekl}`, `zwrot:${z}`],
    "ciąg jednego zamówienia: zwrot i jego reklamacja"
  );
  assert.ok(
    p.zamowienie.every((s) => !(s.rodzaj === "dyskusja" && s.id === dysk)),
    "sprawa nie jest powiązana sama ze sobą"
  );
  assert.deepEqual(
    p.klient.map((s) => s.rodzaj).sort(),
    ["dyskusja", "pytanie"],
    "reszta spraw loginu osobno, bez dubli z zamówienia"
  );

  /* Reklamacja nie pokazuje zwrotu-rodzica jako powiązania — UI i tak
     otwiera ją przez ten zwrot, więc to byłby link do samego siebie. */
  const zRekl = S.powiazaneSprawy("reklamacja", rekl);
  assert.ok(zRekl.zamowienie.every((s) => !(s.rodzaj === "zwrot" && s.id === z)));
});

/* ── Encja sprawy w kolejce (0.128.0) ────────────────────────────────────────
   Rekoncyliacja skleja po order_id; bez niej źródło stoi w kolejce jako
   pseudo-sprawa — brak przebudowy nie ma prawa niczego zgubić.               */

test("po rekoncyliacji obiekty jednego zamówienia to JEDEN wiersz kolejki", async () => {
  const E = await import("./sprawa.js");
  const z = zwrot("jan", "nowy");
  db().prepare("UPDATE zwrot SET allegro_order_id = 'zam-9' WHERE id = ?").run(z);
  reklamacja(z);
  const dy = dyskusja("jan", { status: "nowa" });
  db().prepare("UPDATE dyskusja SET order_id = 'zam-9' WHERE id = ?").run(dy);
  pytanie("jan", "nowe");

  /* Bez rekoncyliacji: cztery pseudo-sprawy (siatka bezpieczeństwa). */
  const przed = S.listaSpraw();
  assert.equal(przed.length, 4);
  assert.ok(przed.every((s) => s.sprawaId === null || s.sprawaId === undefined));

  E.przebudujSprawy();
  const po = S.listaSpraw();
  assert.equal(po.length, 2, "trzy obiekty zam-9 zlewają się w jedną sprawę");
  const zamowienie = po.find((s) => s.rodzaj !== "pytanie")!;
  assert.ok(zamowienie.sprawaId, "wiersz niesie id encji sprawy");
  assert.deepEqual(
    zamowienie.zrodla!.map((x) => x.rodzaj).sort(),
    ["dyskusja", "reklamacja", "zwrot"]
  );
  /* Filtr rodzaju = sprawy ZAWIERAJĄCE źródło tego rodzaju. */
  assert.equal(S.listaSpraw("zwrot").length, 1);
  assert.equal(S.listaSpraw("pytanie").length, 1);
});

test("podpowiedź po kupującym jest podpowiedzią, nie sklejeniem", async () => {
  const E = await import("./sprawa.js");
  /* Pytanie spod maski i zwrot tego samego kupującego: dwie sprawy — ale
     powiązania mają je sobie nawzajem pokazać (odmaskowanie, 0.128.0). */
  const p = pytanie("client:44300777", "nowe");
  db().prepare("UPDATE pytanie SET kupujacy_id = '44300777' WHERE id = ?").run(p);
  const z = zwrot("marek_m", "nowy");
  db().prepare("UPDATE zwrot SET kupujacy_id = '44300777' WHERE id = ?").run(z);
  E.przebudujSprawy();

  assert.equal(S.listaSpraw().length, 2, "kupujący NIE skleja automatem");
  const powiazania = S.powiazaneSprawy("pytanie", p);
  assert.deepEqual(
    powiazania.kupujacy.map((s) => s.rodzaj),
    ["zwrot"],
    "zwrot spod tego samego buyer.id wypływa jako podpowiedź"
  );
  assert.deepEqual(powiazania.klient, [], "po loginie maska nigdy nie trafia");
});

/* ── Piłka: kto ma ruch (0.129.0) ────────────────────────────────────────────
   Najważniejszy stan sprawy. Liczy się z rejestrów i metadanych wątku przy
   KAŻDYM odczycie, więc nie może się zestarzeć — testy pilnują reguł per
   rejestr, redukcji w sprawie wielźródłowej i tego, że piłka weszła do sortu
   NIŻEJ niż ustawowy termin.                                                 */

test("piłka pytania i zwrotu: otwarte czeka na nas, załatwione na nikogo", () => {
  pytanie("jan", "nowe");
  pytanie("ala", "wyslane");
  zwrot("ewa", "oceniony");
  zwrot("iza", "rozliczony");
  const pilka = (login: string) => {
    const { aktywne, historia } = S.sprawyKlienta(login);
    return [...aktywne, ...historia][0]?.pilka;
  };
  assert.equal(pilka("jan"), "my", "pytanie w skrzynce czeka na nas");
  assert.equal(pilka("ala"), "nikt", "po wysyłce sprawa jest zamknięta");
  assert.equal(pilka("ewa"), "my", "zwrot oceniony czeka na zwrot środków — nasza robota");
  assert.equal(pilka("iza"), "nikt", "rozliczony zwrot nie czeka na nikogo");
});

test("piłka dyskusji idzie za ostatnim głosem; głos Allegro liczy się jako nasz ruch", async () => {
  const M = await import("./watek-meta.js");
  const E = await import("./sprawa.js");
  const a = dyskusja("jan", { status: "nowa" });
  const b = dyskusja("ala", { status: "nowa" });
  const c = dyskusja("ola", { status: "nowa" });
  const idAllegro = (id: number) =>
    (db().prepare("SELECT allegro_id FROM dyskusja WHERE id = ?").get(id) as { allegro_id: string })
      .allegro_id;
  const wiad = (id: string, odNas: boolean, rola: string | null) => ({
    id, odNas, autorLogin: null, autorRola: rola, tresc: "x", at: "2026-08-20T10:00:00Z",
    zalacznik: null,
  });
  M.zapiszMetaDyskusji(idAllegro(a), [wiad("m1", false, "BUYER")], "sync");
  M.zapiszMetaDyskusji(idAllegro(b), [wiad("m1", true, "SELLER")], "sync");
  M.zapiszMetaDyskusji(idAllegro(c), [wiad("m1", false, "ALLEGRO_ADVISOR")], "sync");
  E.przebudujSprawy();

  const wg = new Map(S.listaSpraw().map((s) => [s.klient, s.pilka]));
  assert.equal(wg.get("jan"), "my", "ostatnie słowo klienta = nasz ruch");
  assert.equal(wg.get("ala"), "klient", "odpowiedzieliśmy — czekamy na klienta");
  assert.equal(wg.get("ola"), "my", "mediator Allegro zabrał głos — ktoś ma spojrzeć");
});

test("dyskusja bez metadanych spada na wyslano_at — nietknięta czeka na nas", () => {
  const nietknieta = dyskusja("jan", { status: "nowa" });
  const odpisana = dyskusja("ala", { status: "w_toku" });
  db().prepare("UPDATE dyskusja SET wyslano_at = ? WHERE id = ?").run(teraz(), odpisana);
  void nietknieta;
  const wg = new Map(S.listaSpraw().map((s) => [s.klient, s.pilka]));
  assert.equal(wg.get("jan"), "my", "nikt jej nie tknął — fallback stawia ją przed nami");
  assert.equal(wg.get("ala"), "klient", "nasza wysyłka to ostatni znany ruch");
});

test("piłka sprawy jest najostrzejsza z otwartych źródeł", async () => {
  const E = await import("./sprawa.js");
  const z = zwrot("jan", "rozliczony", "zam-p1");
  const d = dyskusja("jan", { status: "nowa", orderId: "zam-p1" });
  E.przebudujSprawy();
  void d;
  const sprawy = S.listaSpraw();
  assert.equal(sprawy.length, 1, "jedno zamówienie, jedna sprawa");
  assert.equal(sprawy[0].pilka, "my", "zamknięty zwrot nie wycisza otwartej dyskusji");
  void z;
});

test("piłka `nikt` wtedy i tylko wtedy, gdy sprawa zamknięta", async () => {
  const E = await import("./sprawa.js");
  pytanie("jan", "nowe");
  pytanie("jan", "zamkniete");
  const z = zwrot("ewa", "rozliczony");
  reklamacja(z, "uznana");
  dyskusja("ola", { status: "w_toku" });
  E.przebudujSprawy();
  for (const s of S.listaSpraw()) {
    assert.equal(s.pilka === "nikt", !s.otwarta, `${s.rodzaj}: piłka i otwartość muszą się zgadzać`);
    assert.equal(s.otwarta, true, "kolejka niesie tylko otwarte");
  }
  const { historia } = S.sprawyKlienta("ewa");
  for (const s of historia) assert.equal(s.pilka, "nikt", "historia ma piłkę u nikogo");
});

test("piłka bije wiek w ogonie kolejki, ale nie rusza spraw z terminem", async () => {
  const M = await import("./watek-meta.js");
  const E = await import("./sprawa.js");
  /* Dwie otwarte dyskusje bez ustawowego zegara: STARSZA czeka na klienta
     (odpisaliśmy), MŁODSZA na nas. Przed 0.129.0 kolejność rozstrzygał sam
     wiek, więc starsza stała pierwsza — a nie ma przy niej nic do zrobienia. */
  const stara = dyskusja("stary", { status: "w_toku", od: dniTemu(20) });
  const swieza = dyskusja("swiezy", { status: "nowa", od: dniTemu(3) });
  const idAllegro = (id: number) =>
    (db().prepare("SELECT allegro_id FROM dyskusja WHERE id = ?").get(id) as { allegro_id: string })
      .allegro_id;
  const wiad = (id: string, odNas: boolean) => ({
    id, odNas, autorLogin: null, autorRola: odNas ? "SELLER" : "BUYER",
    tresc: "x", at: dniTemu(1), zalacznik: null,
  });
  M.zapiszMetaDyskusji(idAllegro(stara), [wiad("m1", true)], "sync");
  M.zapiszMetaDyskusji(idAllegro(swieza), [wiad("m1", false)], "sync");
  E.przebudujSprawy();

  const sprawy = S.listaSpraw();
  assert.equal(sprawy[0].klient, "swiezy", "sprawa czekająca na nas idzie przed starszą");
  assert.equal(sprawy[0].pilka, "my");
  assert.equal(sprawy[1].pilka, "klient");
});
