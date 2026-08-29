import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/* Sam TYP — `import type` znika przy kompilacji, więc moduł nie ładuje się
   przed ustawieniem DB_PATH poniżej. */
import type { CzasyZwrotow } from "./czasy-zwrotow.js";

/* ── Czasy obsługi zwrotu ────────────────────────────────────────────────────
   Cztery rzeczy, na których ta karta może skłamać:

   1. OKNO. Liczymy to, co się w oknie SKOŃCZYŁO. Sprawa zaczęta dawno,
      a domknięta wczoraj, MA wejść do mediany — inaczej wolne przypadki
      znikałyby dokładnie wtedy, kiedy są najciekawsze.
   2. NIEDOKOŃCZONE NIE LICZY SIĘ JAKO SZYBKIE. Zwrot z pominiętą pozycją nie
      wrócił na półkę i nie ma prawa poprawiać statystyki.
   3. UJEMNY ODCINEK TO NIE ODCINEK. Po cofnięciu kroku znaczniki potrafią
      stanąć w odwrotnej kolejności; taka liczba ciągnęłaby medianę w dół.
   4. TEMPO CZŁOWIEKA. Mała próbka to szum, nie wynik.                        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-czasy-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let C: typeof import("./czasy-zwrotow.js");
/** Próg wiarygodności tempa jest wspólny z raportem wydajności — bierzemy stamtąd. */
let PROG: number;

before(async () => {
  ({ db } = await import("../db/db.js"));
  C = await import("./czasy-zwrotow.js");
  PROG = (await import("./raporty.js")).PROG_WIARYGODNOSCI;
});

beforeEach(() => {
  const d = db();
  /* Kolejność jest wymuszona kluczami obcymi: `zwrot.kosz_id` wskazuje na kosz,
     więc kosze schodzą jako ostatnie. */
  for (const t of ["sprawa_zrodlo", "sprawa", "kosz_pozycja", "zwrot_pozycja", "zwrot", "kosz"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

/** Znacznik `n` godzin temu, w formacie, którym pisze sama aplikacja. */
const godzinTemu = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

const odcinek = (s: CzasyZwrotow, klucz: string) =>
  s.odcinki.find((o) => o.klucz === klucz)!;

/**
 * Jeden zwrot z jedną pozycją, przechodzący drogę zadaną godzinami wstecz.
 * `null` na dowolnym etapie znaczy „tu się zatrzymał".
 */
function droga(opts: {
  waybill: string;
  przyjecie: number;
  decyzja?: number | null;
  zamkniecie?: number | null;
  odlozenie?: number | null;
  srodki?: number | null;
  kto?: string;
}): { zwrotId: number; koszId: number | null } {
  const d = db();
  const z = d
    .prepare(
      `INSERT INTO zwrot(waybill, status, utworzono_at, utworzono_przez, kosz_id, zwrot_srodkow_at)
       VALUES (?, 'nowy', ?, 'Test', NULL, ?)`
    )
    .run(opts.waybill, godzinTemu(opts.przyjecie), opts.srodki != null ? godzinTemu(opts.srodki) : null);
  const zwrotId = Number(z.lastInsertRowid);
  d.prepare(
    "INSERT INTO zwrot_pozycja(zwrot_id, nazwa, tw_id, ilosc, decyzja, decyzja_at) VALUES (?,?,?,?,?,?)"
  ).run(
    zwrotId,
    "Towar testowy",
    900_100,
    1,
    opts.decyzja != null ? "pelnowartosciowy" : null,
    opts.decyzja != null ? godzinTemu(opts.decyzja) : null
  );

  if (opts.zamkniecie == null) return { zwrotId, koszId: null };
  const k = d
    .prepare(
      `INSERT INTO kosz(kod, status, utworzono_at, utworzono_przez, zamknieto_at, zamknieto_przez)
       VALUES (?, 'zamkniety', ?, 'Test', ?, 'Test')`
    )
    .run(`K${opts.waybill}`, godzinTemu(opts.przyjecie), godzinTemu(opts.zamkniecie));
  const koszId = Number(k.lastInsertRowid);
  d.prepare("UPDATE zwrot SET kosz_id=? WHERE id=?").run(koszId, zwrotId);
  d.prepare(
    `INSERT INTO kosz_pozycja(kosz_id, zwrot_id, tw_id, symbol, nazwa, ilosc, status,
                              odlozono_at, odlozono_przez)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    koszId,
    zwrotId,
    900_100,
    "TEST-1",
    "Towar testowy",
    1,
    opts.odlozenie != null ? "done" : "todo",
    opts.odlozenie != null ? godzinTemu(opts.odlozenie) : null,
    opts.odlozenie != null ? opts.kto ?? "Magazynier" : null
  );
  return { zwrotId, koszId };
}

test("cała droga liczy się od przyjęcia do odłożenia ostatniej pozycji", () => {
  droga({ waybill: "A", przyjecie: 50, decyzja: 45, zamkniecie: 40, odlozenie: 20 });

  const o = odcinek(C.czasyZwrotow(30), "razem");
  assert.equal(o.ile, 1);
  assert.equal(o.medianaH, 30, "50 h temu przyszedł, 20 h temu stanął na półce");
  assert.equal(o.czemuPusto, null);
});

test("okno pyta o zdarzenie KOŃCZĄCE, więc stara sprawa domknięta wczoraj wchodzi", () => {
  /* Gdyby okno liczyło się od przyjęcia, ten zwrot — najwolniejszy z możliwych —
     wypadłby ze statystyki i proces wyglądałby na szybszy, niż jest. */
  droga({ waybill: "STARY", przyjecie: 24 * 60, decyzja: 24 * 59, zamkniecie: 24 * 58, odlozenie: 20 });

  const o = odcinek(C.czasyZwrotow(30), "razem");
  assert.equal(o.ile, 1, "domknięte w oknie, choć zaczęte przed nim");
  assert.ok(o.medianaH! > 1400, "pełna długość drogi, nie przycięta do okna");
});

test("zwrot z pominiętą pozycją nie wchodzi do całej drogi", () => {
  const { koszId } = droga({ waybill: "B", przyjecie: 30, decyzja: 28, zamkniecie: 26, odlozenie: 10 });
  /* Druga pozycja tego samego zwrotu — pominięta, więc towar NIE wrócił. */
  db()
    .prepare(
      `INSERT INTO kosz_pozycja(kosz_id, zwrot_id, tw_id, symbol, nazwa, ilosc, status, pominieto_at, powod)
       VALUES (?,(SELECT id FROM zwrot WHERE waybill='B'),?,?,?,?, 'skipped', ?, 'nie ma czego odłożyć')`
    )
    .run(koszId, 900_101, "TEST-2", "Drugi towar", 1, godzinTemu(10));

  const s = C.czasyZwrotow(30);
  assert.equal(odcinek(s, "razem").ile, 0, "niedokończone nie jest szybkie");
  assert.match(odcinek(s, "razem").czemuPusto!, /MM/, "pustka mówi, skąd się bierze");
  assert.equal(odcinek(s, "doPolki").ile, 1, "odłożona pozycja liczy się mimo to");
});

test("ujemny odcinek odpada zamiast ciągnąć medianę w dół", () => {
  /* Odłożenie ZANIM kosz został zamknięty — możliwe po cofnięciu i powtórzeniu
     kroku. To brak odcinka, nie odcinek o ujemnej długości. */
  droga({ waybill: "C", przyjecie: 30, decyzja: 28, zamkniecie: 5, odlozenie: 10 });
  droga({ waybill: "D", przyjecie: 30, decyzja: 28, zamkniecie: 26, odlozenie: 22 });

  const o = odcinek(C.czasyZwrotow(30), "doPolki");
  assert.equal(o.ile, 1, "została jedna sensowna para znaczników");
  assert.equal(o.medianaH, 4);
});

test("p90 pokazuje ogon, którego mediana nie widzi", () => {
  for (let i = 0; i < 8; i++) {
    droga({ waybill: `S${i}`, przyjecie: 30, decyzja: 29, zamkniecie: 28, odlozenie: 27 });
  }
  for (let i = 0; i < 2; i++) {
    droga({ waybill: `WOLNY${i}`, przyjecie: 200, decyzja: 199, zamkniecie: 198, odlozenie: 10 });
  }

  const o = odcinek(C.czasyZwrotow(30), "doPolki");
  assert.equal(o.medianaH, 1, "typowa pozycja schodzi w godzinę");
  assert.equal(o.p90H, 188, "dwie czekały ponad tydzień i to widać");
});

test("każdy pusty odcinek mówi, dlaczego jest pusty", () => {
  const s = C.czasyZwrotow(30);
  for (const o of s.odcinki) {
    assert.equal(o.ile, 0);
    assert.equal(o.medianaH, null);
    assert.ok(o.czemuPusto && o.czemuPusto.length > 10, `${o.klucz} milczy zamiast wyjaśnić`);
  }
});

test("tydzień bez zakończonych zwrotów zostaje na osi jako brak danych", () => {
  droga({ waybill: "A", przyjecie: 30, decyzja: 29, zamkniecie: 28, odlozenie: 27 });

  const t = C.czasyZwrotow(30).tygodnie;
  assert.ok(t.length >= 4, "okno 30 dni to co najmniej cztery tygodnie");
  assert.ok(t.some((x) => x.ile === 0 && x.medianaH === null), "cisza ma własny słupek");
  assert.equal(t.reduce((a, x) => a + x.ile, 0), 1);
  const klucze = t.map((x) => x.tydzien);
  assert.deepEqual(klucze, [...klucze].sort(), "oś idzie chronologicznie");
});

test("tempo magazyniera milczy przy małej próbce, a mówi przy dużej", () => {
  /* Jedna pozycja Anny, komplet pozycji Bartka rozłożonych co dwie minuty. */
  droga({ waybill: "MALO", przyjecie: 30, decyzja: 29, zamkniecie: 28, odlozenie: 27, kto: "Anna" });
  for (let i = 0; i < PROG; i++) {
    droga({
      waybill: `DUZO${i}`,
      przyjecie: 30,
      decyzja: 29,
      zamkniecie: 28,
      odlozenie: 27 - i * (2 / 60),
      kto: "Bartek",
    });
  }

  const ludzie = C.czasyZwrotow(30).ludzie;
  const anna = ludzie.find((l) => l.kto === "Anna")!;
  assert.equal(anna.pozycji, 1);
  assert.equal(anna.tempo, null, "tempo z jednej pozycji to szum");
  assert.equal(anna.wiarygodne, false);

  const bartek = ludzie.find((l) => l.kto === "Bartek")!;
  assert.ok(bartek.wiarygodne, "pełna próbka daje wynik");
  assert.ok(bartek.tempo! > 20 && bartek.tempo! < 40, `co dwie minuty to około 30/h, było ${bartek.tempo}`);
  assert.equal(ludzie[0].kto, "Bartek", "lista idzie od największej próbki");
});

test("raport niesie podstawę prawną monitoringu razem z danymi", () => {
  const s = C.czasyZwrotow(30);
  assert.match(s.podstawaPrawna, /22²/);
  assert.match(s.podstawaPrawna, /uprzedz/i);
});

test("co stoi teraz: najstarszy kosz i najstarszy zwrot z nazwanym etapem", () => {
  droga({ waybill: "NOWY", przyjecie: 2, decyzja: 1, zamkniecie: 1 });
  droga({ waybill: "STOI", przyjecie: 100 });

  const teraz = C.czasyZwrotow(30).teraz;
  assert.equal(teraz.kosze.length, 1);
  assert.equal(teraz.kosze[0].doZrobienia, 1, "pozycja czeka na odłożenie");
  assert.ok(teraz.kosze[0].godzin >= 1);

  assert.equal(teraz.zwroty[0].waybill, "STOI", "najstarszy idzie pierwszy");
  assert.equal(teraz.zwroty[0].etap, "czeka na ocenę");
  assert.ok(teraz.zwroty[0].godzin >= 99);
  const wKoszu = teraz.zwroty.find((z) => z.waybill === "NOWY")!;
  assert.equal(wKoszu.etap, "w koszu, nierozłożony");
});
