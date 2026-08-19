import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Notatki biura do dostawy ────────────────────────────────────────────────
   Sedno: notatka bez odpowiedzi TRZYMA DOSTAWĘ OTWARTĄ, i to na obu drogach
   domknięcia. Przycisk „ZAKOŃCZ DOSTAWĘ" jest tą oczywistą; drugą, znacznie
   groźniejszą, jest samoczynne domknięcie po odłożeniu ostatniej pozycji —
   czyli najczęstsza ścieżka w całej aplikacji. Reguła pilnowana wyłącznie przy
   przycisku nie pilnowałaby niczego: wystarczyłoby normalnie rozłożyć towar.  */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-not-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let N: typeof import("./notatki.js");
let D: typeof import("./delivery.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  N = await import("./notatki.js");
  D = await import("./delivery.js");
});

const DOK = 800;

beforeEach(() => {
  for (const t of ["delivery_note", "problem", "delivery_line", "delivery", "events"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

/** Dostawa z jedną pozycją; `odlozone` decyduje, czy da się ją domknąć. */
function dostawa(odlozone: number): number {
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?,?, 'open', ?, 1)`
      )
      .run(DOK, `FZ ${DOK}/MAG/08/2026`, new Date().toISOString()).lastInsertRowid
  );
  db()
    .prepare(
      `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona, status)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(id, 101, "W32-0203", "Kosa", 10, odlozone, odlozone >= 10 ? "done" : "todo");
  return id;
}

const stan = (id: number): string =>
  (db().prepare("SELECT status FROM delivery WHERE id = ?").get(id) as { status: string }).status;

/* ── zapis notatki ────────────────────────────────────────────────────────── */

test("notatka wisi na DOKUMENCIE, więc powstaje przed otwarciem rozkładania", () => {
  /* Biuro pisze ją z maila od dostawcy — lokalnego wiersza `delivery` zwykle
     jeszcze nie ma i nie ma na co czekać. */
  const r = N.dodajNotatke(DOK, "Dosyłają brakujące 3 szt W32-0203 — sprawdź paczkę", "Ewa z biura");
  assert.ok("id" in r);
  const [n] = N.notatkiDokumentu(DOK);
  assert.equal(n.createdBy, "Ewa z biura");
  assert.equal(n.odpowiedz, null, "świeża notatka czeka na odpowiedź");
});

test("pusta notatka nie przechodzi", () => {
  assert.ok("error" in N.dodajNotatke(DOK, "   ", "Ewa z biura"));
  assert.deepEqual(N.notatkiDokumentu(DOK), []);
});

test("pusta odpowiedź nie zdejmuje blokady", () => {
  const r = N.dodajNotatke(DOK, "Sprawdź, czy dosłali", "Ewa z biura") as { id: number };
  assert.ok("error" in N.odpowiedzNaNotatke(r.id, "  ", "Jan z hali"));
  assert.equal(N.czekaNaOdpowiedz(DOK), true);
});

test("odpowiedzi nie da się nadpisać — nowe ustalenie to nowa notatka", () => {
  /* Odpowiedź zdjęła blokadę z dokumentu; podmieniona po fakcie zmieniałaby
     powód decyzji, która już zapadła. */
  const r = N.dodajNotatke(DOK, "Dosłali?", "Ewa z biura") as { id: number };
  N.odpowiedzNaNotatke(r.id, "Tak, były w drugim kartonie", "Jan z hali");
  const drugie = N.odpowiedzNaNotatke(r.id, "jednak nie", "Ktoś inny");
  assert.ok("error" in drugie);
  assert.equal(N.notatkiDokumentu(DOK)[0].odpowiedz, "Tak, były w drugim kartonie");
});

test("odpowiedź niesie nazwisko i czas", () => {
  const r = N.dodajNotatke(DOK, "Dosłali?", "Ewa z biura") as { id: number };
  N.odpowiedzNaNotatke(r.id, "Nie ma w paczce", "Jan z hali");
  const [n] = N.notatkiDokumentu(DOK);
  assert.equal(n.odpBy, "Jan z hali");
  assert.ok(n.odpAt && n.odpAt.length > 0);
});

/* ── bramka domknięcia: przycisk ──────────────────────────────────────────── */

test("ZAKOŃCZ DOSTAWĘ odmawia i CYTUJE pytanie", () => {
  // „nie można zamknąć" bez treści kazałoby szukać notatki gdzie indziej —
  // a szuka się jej wtedy, gdy człowiek stoi przy palecie i chce skończyć
  const id = dostawa(10);
  N.dodajNotatke(DOK, "Dosyłają brakujące 3 szt — sprawdź", "Ewa z biura");
  const r = D.zakonczDostawe(id, "Jan z hali");
  assert.ok("error" in r);
  assert.match(r.error, /Dosyłają brakujące 3 szt/);
});

test("po odpowiedzi zakończenie przechodzi", () => {
  const id = dostawa(10);
  const n = N.dodajNotatke(DOK, "Dosłali?", "Ewa z biura") as { id: number };
  N.odpowiedzNaNotatke(n.id, "Tak, dosłali", "Jan z hali");
  const r = D.zakonczDostawe(id, "Jan z hali");
  assert.ok(!("error" in r));
  assert.equal(stan(id), "done");
});

test("kilka notatek — odmowa mówi, ile jeszcze czeka", () => {
  const id = dostawa(10);
  N.dodajNotatke(DOK, "Pierwsza", "Ewa z biura");
  N.dodajNotatke(DOK, "Druga", "Ewa z biura");
  const r = D.zakonczDostawe(id, "Jan z hali") as { error: string };
  assert.match(r.error, /Pierwsza/);
  assert.match(r.error, /1 kolejne/);
});

/* ── bramka domknięcia: droga samoczynna ──────────────────────────────────── */

test("odłożenie OSTATNIEJ pozycji nie domyka dostawy z otwartą notatką", () => {
  /* NAJWAŻNIEJSZY test tego pliku. Bez bramki w `closeIfComplete` regułę
     obchodziłoby się przez zwykłe rozłożenie towaru — czyli przez najczęstszą
     czynność w aplikacji, bez żadnej złej woli. */
  const id = dostawa(10);
  N.dodajNotatke(DOK, "Dosłali?", "Ewa z biura");
  D.closeIfComplete(id, "Jan z hali");
  assert.equal(stan(id), "open", "notatka trzyma dostawę otwartą");
});

test("po odpowiedzi samoczynne domknięcie znów działa", () => {
  const id = dostawa(10);
  const n = N.dodajNotatke(DOK, "Dosłali?", "Ewa z biura") as { id: number };
  D.closeIfComplete(id, "Jan z hali");
  assert.equal(stan(id), "open");
  N.odpowiedzNaNotatke(n.id, "Tak", "Jan z hali");
  D.closeIfComplete(id, "Jan z hali");
  assert.equal(stan(id), "done");
});

test("dostawa bez notatek domyka się jak dotąd", () => {
  // bramka nie ma prawa zmienić zachowania tam, gdzie notatek nie ma
  const id = dostawa(10);
  D.closeIfComplete(id, "Jan z hali");
  assert.equal(stan(id), "done");
});

/* ── widok dla kolektora ──────────────────────────────────────────────────── */

test("notatki jadą z widokiem dostawy, bez osobnego żądania", () => {
  const id = dostawa(0);
  N.dodajNotatke(DOK, "Sprawdź drugi karton", "Ewa z biura");
  const v = D.getDelivery(id);
  assert.equal(v?.notatki.length, 1);
  assert.equal(v?.notatki[0].tresc, "Sprawdź drugi karton");
});

test("ślad w audycie po obu stronach rozmowy", () => {
  const n = N.dodajNotatke(DOK, "Dosłali?", "Ewa z biura") as { id: number };
  N.odpowiedzNaNotatke(n.id, "Tak", "Jan z hali");
  const typy = (
    db()
      .prepare("SELECT type, user_id FROM events ORDER BY id")
      .all() as Array<{ type: string; user_id: string }>
  );
  assert.deepEqual(typy.map((t) => t.type), ["delivery_note_added", "delivery_note_answered"]);
  assert.deepEqual(typy.map((t) => t.user_id), ["Ewa z biura", "Jan z hali"]);
});

/* ── Odpowiedź wraca do biura (0.57.0) ────────────────────────────────────────
   Notatka wymusza odpowiedź, żeby pytanie nie zginęło. Ten sygnał domyka tę
   samą pętlę z drugiej strony: do 0.57.0 odpowiedź widać było wyłącznie po
   wejściu w tę konkretną dostawę, a biuro nie miało powodu tam wracać.       */

test("notatka BEZ odpowiedzi nie trafia do biura", () => {
  // czeka na magazyniera, nie na biuro — mieszanie tych dwóch kolejek
  // zamieniłoby sygnał w listę wszystkiego, co otwarte
  N.dodajNotatke(DOK, "Dosłali?", "Ewa z biura");
  assert.equal(N.odpowiedziNieprzeczytane().length, 0);
});

test("odpowiedź czeka na oczy biura i gaśnie po przeczytaniu", () => {
  const n = N.dodajNotatke(DOK, "Dosłali?", "Ewa z biura") as { id: number };
  N.odpowiedzNaNotatke(n.id, "Tak, dwie sztuki", "Jan z hali");

  const czekaja = N.odpowiedziNieprzeczytane();
  assert.equal(czekaja.length, 1);
  assert.equal(czekaja[0].odpowiedz, "Tak, dwie sztuki");
  assert.equal(czekaja[0].tresc, "Dosłali?", "pytanie jedzie razem z odpowiedzią");

  assert.equal(N.oznaczOdpowiedzPrzeczytana(n.id, "Ewa z biura"), true);
  assert.equal(N.odpowiedziNieprzeczytane().length, 0);
});

test("powtórne oznaczenie to spóźnienie, nie błąd — i nie dubluje audytu", () => {
  // dwa biurka patrzą na ten sam licznik; drugie kliknięcie ma być nieszkodliwe
  const n = N.dodajNotatke(DOK, "Sprawdź?", "Ewa z biura") as { id: number };
  N.odpowiedzNaNotatke(n.id, "Sprawdzone", "Jan z hali");
  assert.equal(N.oznaczOdpowiedzPrzeczytana(n.id, "Ewa z biura"), true);
  assert.equal(N.oznaczOdpowiedzPrzeczytana(n.id, "Ala z biura"), false);

  const ile = (
    db()
      .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'notatka_odpowiedz_przeczytana'")
      .get() as { n: number }
  ).n;
  assert.equal(ile, 1, "jeden odczyt, jeden wpis");
});

test("najdłużej czekająca odpowiedź jest pierwsza", () => {
  // lista ma się czytać jak kolejka, nie jak dziennik
  const a = N.dodajNotatke(DOK, "Pierwsze", "Ewa z biura") as { id: number };
  const b = N.dodajNotatke(DOK, "Drugie", "Ewa z biura") as { id: number };
  N.odpowiedzNaNotatke(b.id, "Odpowiedź na drugie", "Jan z hali");
  db()
    .prepare("UPDATE delivery_note SET odp_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
    .run(a.id);
  N.odpowiedzNaNotatke(a.id, "Odpowiedź na pierwsze", "Jan z hali");
  db()
    .prepare("UPDATE delivery_note SET odp_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
    .run(a.id);

  assert.deepEqual(
    N.odpowiedziNieprzeczytane().map((o) => o.tresc),
    ["Pierwsze", "Drugie"]
  );
});
