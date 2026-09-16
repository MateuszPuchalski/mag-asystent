import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-ean-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Kolizje kodów przestają być dziennikiem bez wyjścia (0.360.0) ───────────
   `ean_conflict` zapisuje każde spotkanie kodu w alejce od 0.37.0 i do 0.358.0
   nie miał ANI JEDNEJ kolumny mówiącej, czy ktokolwiek się tym zajął. Obie
   strony patrzyły na tę samą listę — biuro w `/biuro`, hala na ekranie
   wyjątków — i żadna nie mogła drugiej nic powiedzieć.

   Rozstrzygnięcie dotyczy KODU, nie pojedynczego trafienia, więc mieszka
   w osobnej tabeli. Dziennik zostaje dziennikiem.                           */

let db: typeof import("../db/db.js").db;
let E: typeof import("./ean.js");
let ala = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  E = await import("./ean.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["ean_rozstrzygniecie", "ean_conflict", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  ala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
});

const autor = () => ({ id: ala, name: "A. Lewandowska" });
const wiersz = (ean: string) => E.eanConflictReport().find((k) => k.ean === ean)!;

/** Trafienie z podstawionym czasem — inaczej test mierzyłby własny przebieg. */
function trafienie(ean: string, sekundTemu = 0) {
  E.recordEanConflict(ean, [900_001, 900_002], false);
  if (sekundTemu) {
    db().prepare("UPDATE ean_conflict SET seen_at=? WHERE id=(SELECT MAX(id) FROM ean_conflict)")
      .run(new Date(Date.now() - sekundTemu * 1000).toISOString());
  }
}

test("kolizja bez decyzji mówi to wprost, a nie milczy", () => {
  trafienie("5901234567890");
  const k = wiersz("5901234567890");
  assert.equal(k.hits, 1);
  assert.equal(k.rozstrzygniecie, null);
  assert.equal(k.trafienPoDecyzji, 0);
});

test("biuro zamyka sprawę kodu, a decyzja wraca w raporcie z nazwiskiem", () => {
  trafienie("5901234567890", 60);
  assert.deepEqual(
    E.rozstrzygnijKolizje("5901234567890", "dopuszczone", "Zestaw i sztuka luzem — wybieraj po symbolu.", autor()),
    { ok: true });

  const k = wiersz("5901234567890");
  assert.equal(k.rozstrzygniecie!.rodzaj, "dopuszczone");
  assert.equal(k.rozstrzygniecie!.przez, "A. Lewandowska");
  assert.match(k.rozstrzygniecie!.notatka!, /po symbolu/);
  assert.equal(k.trafienPoDecyzji, 0, "trafienie sprzed decyzji jej nie podważa");

  const e = db().prepare("SELECT count(*) n FROM events WHERE type='ean_kolizja_rozstrzygnieta'")
    .get() as { n: number };
  assert.equal(e.n, 1, "każda decyzja zostawia ślad w księdze");
});

test("NIEUDANA POPRAWKA UJAWNIA SIĘ SAMA — bez niczyjej oceny", () => {
  /* To jest sedno tej wersji. `poprawione` znaczy „kartoteki naprawione,
     kolizja zniknie". Kolejne trafienie jest więc DOWODEM, że nie zniknęła —
     i nikt nie musi tego oceniać ani pamiętać, żeby sprawdzić. */
  trafienie("5907654321098", 120);
  E.rozstrzygnijKolizje("5907654321098", "poprawione", "Zdjęty kod z kartoteki 900002.", autor());
  assert.equal(wiersz("5907654321098").trafienPoDecyzji, 0, "zaraz po decyzji jeszcze nic nie dowodzi");

  trafienie("5907654321098");
  const k = wiersz("5907654321098");
  assert.equal(k.rozstrzygniecie!.rodzaj, "poprawione");
  assert.equal(k.trafienPoDecyzji, 1, "kod zatrzymał kogoś PO obiecanej poprawce");
  assert.equal(k.hits, 2);
});

test("druga decyzja NADPISUJE pierwszą, a licznik liczy się od nowej", () => {
  /* Pytanie brzmi „co z tym kodem jest teraz", nie „co kiedykolwiek o nim
     myślano". Historia zostaje w księdze — i tam widać, że `poprawione`
     zamieniono na `dopuszczone`, bo poprawka nie zadziałała. */
  trafienie("5901111111111", 300);
  E.rozstrzygnijKolizje("5901111111111", "poprawione", undefined, autor());
  /* Trafienie PO decyzji. Pierwsza wersja tego testu podstawiała mu „120
     sekund temu" i oczekiwała jedynki — czyli żądała, żeby trafienie sprzed
     decyzji ją podważało; zły był test, nie kod. */
  trafienie("5901111111111");
  assert.equal(wiersz("5901111111111").trafienPoDecyzji, 1);

  E.rozstrzygnijKolizje("5901111111111", "dopuszczone", "Jednak zgodne z prawdą.", autor());
  const k = wiersz("5901111111111");
  assert.equal(k.rozstrzygniecie!.rodzaj, "dopuszczone");
  assert.equal(k.trafienPoDecyzji, 0, "licznik liczy od AKTUALNEJ decyzji, nie od pierwszej");
  assert.equal(
    (db().prepare("SELECT count(*) n FROM ean_rozstrzygniecie").get() as { n: number }).n, 1,
    "jedna decyzja na kod — nadpisanie, nie druga obok");
  assert.equal(
    (db().prepare("SELECT count(*) n FROM events WHERE type='ean_kolizja_rozstrzygnieta'")
      .get() as { n: number }).n, 2, "ale OBIE zostają w księdze");
});

test("REMIS MILISEKUNDY nie przekłamuje licznika — rozstrzyga `id`, nie znacznik", () => {
  /* Ten test istnieje, bo pierwsza wersja 0.360.0 liczyła „po decyzji"
     porównaniem `seen_at > at`. Oba znaczniki mają rozdzielczość milisekundy,
     więc trafienie zapisane w tej samej milisekundzie co decyzja wpadało po
     złej stronie — a padało to RAZ NA KILKA przebiegów całego zestawu, czyli
     najgorszym możliwym sposobem.

     To dokładnie ta blizna, którą 0.352.0 wyjęło z raportu skuteczności
     doboru, i to samo lekarstwo: `id` dziennika jest AUTOINCREMENT-em, więc
     rozstrzyga remis bez zgadywania.

     Remis WYMUSZAMY, zamiast na niego czekać: wszystkie znaczniki idą na tę
     samą wartość, wziętą z bazy, nie z zaszytej daty. */
  trafienie("5902222222222");
  E.rozstrzygnijKolizje("5902222222222", "poprawione", undefined, autor());
  trafienie("5902222222222");

  const d = db();
  const chwila = String((d.prepare("SELECT MIN(seen_at) v FROM ean_conflict").get() as { v: string }).v);
  d.prepare("UPDATE ean_conflict SET seen_at=? WHERE ean=?").run(chwila, "5902222222222");
  d.prepare("UPDATE ean_rozstrzygniecie SET at=? WHERE ean=?").run(chwila, "5902222222222");

  const k = wiersz("5902222222222");
  assert.equal(k.hits, 2);
  assert.equal(k.trafienPoDecyzji, 1,
    "drugie trafienie jest PO decyzji, choć znacznik tego nie rozstrzyga");
});

test("nie da się rozstrzygnąć kodu, którego nikt nie spotkał, ani wymyślić rodzaju", () => {
  trafienie("5901234567890");
  assert.deepEqual(E.rozstrzygnijKolizje("5900000000000", "poprawione", undefined, autor()),
    { error: "Ten kod nie zatrzymał jeszcze nikogo w alejce" });
  assert.match(
    (E.rozstrzygnijKolizje("5901234567890", "cokolwiek" as never, undefined, autor()) as { error: string }).error,
    /poprawione.*dopuszczone/);
  assert.equal(
    (db().prepare("SELECT count(*) n FROM ean_rozstrzygniecie").get() as { n: number }).n, 0);
});
