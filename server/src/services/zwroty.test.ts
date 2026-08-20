import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Zwroty Allegro — serwis ─────────────────────────────────────────────────
   Trzy rzeczy z cichym trybem awarii:

   1. DOPASOWANIE DOKUMENTU. Fałszywe auto-dopasowanie to w Etapie 2 korekta
      do cudzego dokumentu — próg musi przepuszczać wyłącznie jednoznaczne.
   2. MASZYNA STANÓW. `oceniony` dopiero po decyzji przy KAŻDEJ pozycji,
      `rozliczony` zamyka edycję — środki oddano na podstawie tych decyzji.
   3. IDEMPOTENCJA SKANU. Druga osoba skanująca tę samą paczkę ma dostać
      istniejący zwrot, nie duplikat.

   Adapter Allegro w testach to dev (fikcyjne zwroty DEVWB…), granica taka
   sama jak przy Sferze — bez mockowania fetch.                               */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zwr-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zwroty.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zwroty.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["zwrot_zam_pozycja", "zwrot_pozycja", "zwrot", "sgt_sprzedaz_pozycja", "sgt_sprzedaz", "sgt_towar", "sfera_queue"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

function towar(twId: number, sym: string, ean = ""): void {
  db()
    .prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?, '')")
    .run(twId, sym, `Towar ${sym}`, ean);
}

function dokument(
  dokId: number,
  typ: string,
  dniTemu: number,
  opcje: {
    nrOryg?: string;
    kontrahent?: string;
    uwagi?: string;
    magId?: number | null;
    pozycje: Array<[number, number]>;
  }
): void {
  const data = new Date(Date.now() - dniTemu * 86_400_000).toISOString().slice(0, 10);
  db()
    .prepare(
      "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, uwagi, mag_id) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(
      dokId,
      typ,
      `${typ} ${dokId}/08/2026`,
      opcje.nrOryg ?? null,
      data,
      opcje.kontrahent ?? "",
      opcje.uwagi ?? null,
      opcje.magId === undefined ? 1 : opcje.magId
    );
  const ins = db().prepare("INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)");
  for (const [tw, il] of opcje.pozycje) ins.run(dokId, tw, il);
}

/** Kartoteki zestrojone z adapterem dev (TEST-LINIA-TODO itd.). */
function kartotekiDev(): void {
  towar(900_036, "TEST-LINIA-TODO");
  towar(900_037, "TEST-LINIA-DONE");
  towar(900_029, "TEST-ROTUJACY");
}

// ── Utworzenie ze skanu ─────────────────────────────────────────────────────

test("skan znanej etykiety zakłada zwrot z pozycjami i sygnaturami z zamówienia", async () => {
  kartotekiDev();
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  assert.equal(w.rodzaj, "utworzony");
  if (w.rodzaj !== "utworzony") return;
  assert.equal(w.zwrot.waybill, "DEVWB0001");
  assert.equal(w.zwrot.kupujacyLogin, "jan_wraca");
  assert.equal(w.zwrot.status, "nowy");
  assert.equal(w.zwrot.pozycje.length, 2);
  // sygnatura przyszła z checkout-form i dopasowała kartotekę
  assert.equal(w.zwrot.pozycje[0].externalId, "TEST-LINIA-TODO");
  assert.equal(w.zwrot.pozycje[0].twId, 900_036);
});

test("drugi skan tej samej paczki zwraca ISTNIEJĄCY zwrot, nie duplikat", async () => {
  kartotekiDev();
  const pierwszy = await Z.utworzZeSkanu("DEVWB0001", "Jan");
  const drugi = await Z.utworzZeSkanu("DEVWB0001", "Ewa");
  assert.equal(drugi.rodzaj, "istniejacy");
  if (pierwszy.rodzaj !== "utworzony" || drugi.rodzaj !== "istniejacy") return;
  assert.equal(drugi.zwrot.id, pierwszy.zwrot.id);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM zwrot").get()!.n, 1);
});

test("etykieta przewoźnika doręczającego (transportingWaybill) też znajduje zwrot", async () => {
  kartotekiDev();
  const w = await Z.utworzZeSkanu("DEVTW0002", "Test");
  assert.equal(w.rodzaj, "utworzony");
  if (w.rodzaj !== "utworzony") return;
  assert.equal(w.zwrot.allegroReturnId, "dev-ret-2");
  // waybill = co ZESKANOWANO, nie co stoi w parcels[]
  assert.equal(w.zwrot.waybill, "DEVTW0002");
});

test("etykieta nieznana Allegro → rodzaj brak; zwrot ręczny przejmuje pałeczkę", async () => {
  const w = await Z.utworzZeSkanu("NIEZNANA-123", "Test");
  assert.equal(w.rodzaj, "brak");
  towar(1, "SYM-1");
  const reczny = Z.utworzReczny("NIEZNANA-123", "Test");
  assert.equal(reczny.status, "nowy");
  assert.equal(reczny.pozycje.length, 0);
  const zPozycja = Z.dodajPozycjeReczna(reczny.id, 1, 2, "Test");
  assert.equal(zPozycja.pozycje.length, 1);
  assert.equal(zPozycja.pozycje[0].twId, 1);
});

test("pozycja z sygnaturą spoza kartoteki dostaje twId NULL — uczciwy brak", async () => {
  const w = await Z.utworzZeSkanu("DEVWB0003", "Test");
  assert.equal(w.rodzaj, "utworzony");
  if (w.rodzaj !== "utworzony") return;
  assert.equal(w.zwrot.pozycje[0].externalId, "SPOZA-KATALOGU");
  assert.equal(w.zwrot.pozycje[0].twId, null);
});

// ── Dopasowanie dokumentu ───────────────────────────────────────────────────

test("numer zamówienia w nr_oryg daje jednoznaczne dopasowanie auto", async () => {
  kartotekiDev();
  dokument(101, "FS", 10, { nrOryg: "dev-ord-1", pozycje: [[900_036, 1], [900_037, 2]] });
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.ok(w.zwrot.dokument, "dokument miał się dopasować sam");
  assert.equal(w.zwrot.dokument!.dokId, 101);
  assert.equal(w.zwrot.dokument!.dopasowanie, "auto");
});

test("numer zamówienia w UWAGACH też wygrywa — z nakładką pozycji na innym dokumencie", async () => {
  kartotekiDev();
  // dokument z samą nakładką pozycji…
  dokument(102, "PA", 5, { pozycje: [[900_036, 1], [900_037, 2]] });
  // …i drugi z numerem zamówienia w uwagach, ale bez pełnej nakładki
  dokument(103, "FS", 30, { uwagi: "Allegro dev-ord-1, wysyłka InPost", pozycje: [[900_036, 1]] });
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.equal(w.zwrot.dokument?.dokId, 103, "numer zamówienia bije nakładkę pozycji");
});

test("dwa podobne dokumenty bez numeru zamówienia → kandydaci i wybór ręczny", async () => {
  kartotekiDev();
  dokument(201, "PA", 3, { pozycje: [[900_029, 1]] });
  dokument(202, "PA", 20, { pozycje: [[900_029, 1]] });
  const w = await Z.utworzZeSkanu("DEVTW0002", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.equal(w.zwrot.dokument, null, "bez sygnału rozstrzygającego nie ma auto");
  const kandydaci = w.zwrot.kandydaciDokumentu ?? [];
  assert.equal(kandydaci.length, 2);
  assert.ok(kandydaci[0].powody.length > 0, "kandydat ma pokazywać, skąd punkty");

  const poWyborze = Z.ustawDokument(w.zwrot.id, 202, "Test");
  assert.equal(poWyborze.dokument?.dopasowanie, "reczne");
  const cofniety = Z.zdejmijDokument(w.zwrot.id, "Test");
  assert.equal(cofniety.dokument, null);
});

test("dokument spoza okna dopasowania nie kandyduje", async () => {
  kartotekiDev();
  dokument(301, "FS", 200, { nrOryg: "dev-ord-1", pozycje: [[900_036, 1], [900_037, 2]] });
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.equal(w.zwrot.dokument, null);
  assert.deepEqual(w.zwrot.kandydaciDokumentu, []);
});

// ── Maszyna stanów ──────────────────────────────────────────────────────────

test("oceniony dopiero po decyzji przy KAŻDEJ pozycji; rozliczony zamyka edycję", async () => {
  kartotekiDev();
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  const z = w.zwrot;

  let stan = Z.zapiszDecyzje(z.id, z.pozycje[0].id, "pelnowartosciowy", null, "Jan");
  assert.equal(stan.status, "nowy", "jedna decyzja z dwóch to jeszcze nie oceniony");

  // środki przed oceną — odmowa z konkretnym zdaniem
  assert.throws(() => Z.oznaczZwrotSrodkow(z.id, "Jan"), /Najpierw decyzje/);

  stan = Z.zapiszDecyzje(z.id, z.pozycje[1].id, "reklamacja", "rysa na obudowie", "Jan");
  assert.equal(stan.status, "oceniony");

  // decyzję MOŻNA zmienić przed rozliczeniem
  stan = Z.zapiszDecyzje(z.id, z.pozycje[1].id, "do_zniszczenia", null, "Ewa");
  assert.equal(stan.pozycje[1].decyzja, "do_zniszczenia");

  stan = Z.oznaczZwrotSrodkow(z.id, "Ewa");
  assert.equal(stan.status, "rozliczony");
  assert.ok(stan.zwrotSrodkow);

  // po rozliczeniu decyzje są zamknięte
  assert.throws(() => Z.zapiszDecyzje(z.id, z.pozycje[0].id, "reklamacja", null, "Jan"), /rozliczony/);
  // stempel jest idempotentny — drugi klik niczego nie psuje
  assert.equal(Z.oznaczZwrotSrodkow(z.id, "Ewa").status, "rozliczony");
});

test("nieznana decyzja i cudza pozycja są odrzucane jako błąd wołającego", async () => {
  kartotekiDev();
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.throws(() => Z.zapiszDecyzje(w.zwrot.id, w.zwrot.pozycje[0].id, "wyrzucic", null, "X"), /Nieznana decyzja/);
  assert.throws(() => Z.zapiszDecyzje(w.zwrot.id, 999_999, "reklamacja", null, "X"), /nie należy/);
});

// ── Lista ───────────────────────────────────────────────────────────────────

test("lista filtruje po statusie i szuka po waybill/loginie", async () => {
  kartotekiDev();
  await Z.utworzZeSkanu("DEVWB0001", "Test");
  await Z.utworzZeSkanu("DEVWB0003", "Test");
  assert.equal(Z.listaZwrotow({}).length, 2);
  assert.equal(Z.listaZwrotow({ status: "nowy" }).length, 2);
  assert.equal(Z.listaZwrotow({ szukaj: "jan_wraca" }).length, 1);
  assert.equal(Z.listaZwrotow({ szukaj: "DEVWB0003" }).length, 1);
  const wiersz = Z.listaZwrotow({ szukaj: "DEVWB0001" })[0];
  assert.equal(wiersz.pozycji, 2);
  assert.equal(wiersz.ocenionych, 0);
});

// ── Całe zamówienie na karcie zwrotu (0.56.4) ──────────────────────────────

test("karta zwrotu niesie CAŁE zamówienie ze znacznikiem, co wraca", async () => {
  kartotekiDev();
  const w = await Z.utworzZeSkanu("DEVTW0002", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");

  const zam = w.zwrot.pozycjeZamowienia;
  assert.equal(zam.length, 2, "zamówienie miało dwie pozycje, wraca jedna");
  const wracajaca = zam.find((p) => p.zwracana);
  const zostajaca = zam.find((p) => !p.zwracana);
  assert.equal(wracajaca?.symbol, "TEST-ROTUJACY");
  assert.equal(zostajaca?.externalId, "TEST-LINIA-DONE");
  // kartoteka dopasowana tak samo jak przy pozycjach zwrotu
  assert.equal(zostajaca?.twId, 900_037);
  assert.equal(zostajaca?.ilosc, 3);
});

test("zwrot ręczny nie ma zamówienia — sekcja zostaje pusta, nie zmyślona", () => {
  const reczny = Z.utworzReczny("BEZ-ZAMOWIENIA-1", "Test");
  assert.deepEqual(reczny.pozycjeZamowienia, []);
});

// ── Powód zwrotu i rozmowa z klientem (0.56.5) ─────────────────────────────

test("skan dociąga SZCZEGÓŁ zwrotu — powód i komentarz klienta trafiają na kartę", async () => {
  /* Lista zwrotów jest streszczeniem bez powodów; bez dociągnięcia szczegółu
     kolumna POWÓD była pusta przy każdym prawdziwym zwrocie. */
  kartotekiDev();
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.equal(w.zwrot.pozycje[0].powod, "Niezgodny z opisem");
  assert.equal(w.zwrot.pozycje[0].powodOpis, "Miała być końcówka 3/8, jest 1/4");
});

test("wątek wiadomości: szukany po identyfikatorze kupującego, nie po loginie", async () => {
  /* Lista wątków Allegro maskuje rozmówcę (`client:44300444`), więc wątek
     dev też stoi pod identyfikatorem. Gdyby serwis szukał samym loginem —
     jak przed 0.56.6 — ten test pokazałby „brak korespondencji". */
  kartotekiDev();
  const zJanem = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (zJanem.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  const w1 = await Z.watekZwrotu(zJanem.zwrot.id);
  assert.equal(w1.login, "jan_wraca");
  assert.equal(w1.szukanie?.watek?.wiadomosci.length, 3);
  assert.equal(w1.szukanie?.watek?.wiadomosci[0].odKupujacego, true);

  const zEwa = await Z.utworzZeSkanu("DEVTW0002", "Test");
  if (zEwa.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  const w2 = await Z.watekZwrotu(zEwa.zwrot.id);
  assert.equal(w2.szukanie?.watek, null, "brak rozmowy to poprawna odpowiedź, nie błąd");
  assert.ok((w2.szukanie?.przejrzanych ?? 0) > 0, "licznik mówi, ile rozmów przejrzano");

  // zwrot ręczny nie ma kupującego — pytanie o wątek nie ma kogo dotyczyć
  const reczny = Z.utworzReczny("BEZ-KLIENTA-1", "Test");
  const w3 = await Z.watekZwrotu(reczny.id);
  assert.deepEqual(w3, { login: null, szukanie: null });
});

// ── Etap 2: korekta + MM na bufor ───────────────────────────────────────────

/** Zwrot dev-ret-1 doprowadzony do stanu „można wystawić dokumenty". */
async function zwrotGotowyDoKorekty(): Promise<number> {
  kartotekiDev();
  dokument(101, "FS", 5, { nrOryg: "dev-ord-1", magId: 7, pozycje: [[900_036, 1], [900_037, 2]] });
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") throw new Error("oczekiwano utworzenia");
  for (const p of w.zwrot.pozycje) Z.zapiszDecyzje(w.zwrot.id, p.id, "pelnowartosciowy", null, "Test");
  return w.zwrot.id;
}

test("korekta idzie na dokument sprzedaży, MM z magazynu sprzedaży na bufor", async () => {
  /* Magazyn ŹRÓDŁOWY bierze się z dokumentu, nie z „głównego": sprzedaż nie
     zawsze wychodzi z jedynki, a MM z niewłaściwego magazynu to brak stanu
     i zadanie w błędzie. */
  const id = await zwrotGotowyDoKorekty();
  const z = Z.wystawDokumenty(id, "Test");
  assert.equal(z.dokumenty.stan, "w_kolejce");

  const zadanie = db()
    .prepare("SELECT type, payload, source_doc_id FROM sfera_queue WHERE id = ?")
    .get(z.dokumenty.queueId) as { type: string; payload: string; source_doc_id: number };
  assert.equal(zadanie.type, "korekta_zwrot");
  assert.equal(zadanie.source_doc_id, 101);
  const p = JSON.parse(zadanie.payload);
  assert.equal(p.dokId, 101);
  assert.equal(p.typ, "FS");
  assert.equal(p.magZrodlowy, 7);
  assert.equal(p.magZwrotow, 3);
  assert.deepEqual(p.pozycje, [{ twId: 900_036, qty: 1 }, { twId: 900_037, qty: 2 }]);
  /* Bez pozycji zniszczonych klucza w payloadzie NIE MA — zadanie wygląda
     jak sprzed 0.66.0 i starszy worker Sfery wykona je bez zmian. */
  assert.ok(!("pozycjeZniszczone" in p));
});

test("drugie kliknięcie NIE zleca drugiej korekty", async () => {
  /* Dubel korekty to pieniądze oddane dwa razy — dwa okna biura albo dwa
     kliknięcia w to samo miejsce nie mogą go zrobić. */
  const id = await zwrotGotowyDoKorekty();
  const pierwszy = Z.wystawDokumenty(id, "Test").dokumenty.queueId;
  const drugi = Z.wystawDokumenty(id, "Test").dokumenty.queueId;
  assert.equal(drugi, pierwszy);
  const ile = db()
    .prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='korekta_zwrot'")
    .get() as { n: number };
  assert.equal(ile.n, 1);
});

test("zniszczone jadą OSOBNĄ sekcją payloadu: korekta + RW, bez MM na bufor", async () => {
  /* Do 0.66.0 zniszczenie wypadało z dokumentów w ogóle — towar znikał bez
     śladu magazynowego. Teraz wchodzi na korektę (klient oddał towar) i od
     razu schodzi RW; na bufor zwrotowy dalej NIE jedzie. */
  kartotekiDev();
  dokument(101, "FS", 5, { nrOryg: "dev-ord-1", pozycje: [[900_036, 1], [900_037, 2]] });
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  Z.zapiszDecyzje(w.zwrot.id, w.zwrot.pozycje[0].id, "pelnowartosciowy", null, "Test");
  Z.zapiszDecyzje(w.zwrot.id, w.zwrot.pozycje[1].id, "do_zniszczenia", null, "Test");

  const z = Z.wystawDokumenty(w.zwrot.id, "Test");
  const p = JSON.parse(
    (db().prepare("SELECT payload FROM sfera_queue WHERE id = ?").get(z.dokumenty.queueId) as
      { payload: string }).payload
  );
  assert.deepEqual(p.pozycje, [{ twId: 900_036, qty: 1 }], "na bufor tylko pełnowartościowe");
  assert.deepEqual(p.pozycjeZniszczone, [{ twId: 900_037, qty: 2 }], "zniszczone na korektę i RW");
  assert.equal(z.dokumenty.pozycjeZniszczone.length, 1, "karta widzi, co pójdzie na RW");
});

test("zwrot w całości zniszczony też wystawia dokumenty", async () => {
  /* Przed 0.66.0 taki zwrot był ślepym zaułkiem: przycisk mówił „żadna
     pozycja nie jest pełnowartościowa" i korekta nie powstawała wcale. */
  kartotekiDev();
  dokument(101, "FS", 5, { nrOryg: "dev-ord-1", pozycje: [[900_036, 1], [900_037, 2]] });
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  for (const poz of w.zwrot.pozycje) Z.zapiszDecyzje(w.zwrot.id, poz.id, "do_zniszczenia", null, "Test");

  const z = Z.wystawDokumenty(w.zwrot.id, "Test");
  assert.equal(z.dokumenty.stan, "w_kolejce");
  const p = JSON.parse(
    (db().prepare("SELECT payload FROM sfera_queue WHERE id = ?").get(z.dokumenty.queueId) as
      { payload: string }).payload
  );
  assert.deepEqual(p.pozycje, []);
  assert.equal(p.pozycjeZniszczone.length, 2);
});

test("bez dokumentu, bez decyzji i bez kartoteki — przycisk mówi CZEGO brakuje", async () => {
  kartotekiDev();
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.match(w.zwrot.dokumenty.przeszkoda ?? "", /decyzja/i);
  assert.throws(() => Z.wystawDokumenty(w.zwrot.id, "Test"), /decyzja/i);

  for (const p of w.zwrot.pozycje) Z.zapiszDecyzje(w.zwrot.id, p.id, "pelnowartosciowy", null, "Test");
  assert.match(Z.szczegolZwrotu(w.zwrot.id).dokumenty.przeszkoda ?? "", /dokument sprzedaży/i);
});

test("pozycja pełnowartościowa bez kartoteki ZATRZYMUJE całość", async () => {
  /* Korekta na część zwrotu i pieniądze za całość to najgorszy możliwy wynik,
     bo nikt tego później nie zauważy — więc brakująca kartoteka blokuje. */
  kartotekiDev();
  dokument(101, "FS", 5, { nrOryg: "dev-ord-3", pozycje: [[900_036, 1]] });
  const w = await Z.utworzZeSkanu("DEVWB0003", "Test"); // sygnatura spoza kartoteki
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  Z.zapiszDecyzje(w.zwrot.id, w.zwrot.pozycje[0].id, "pelnowartosciowy", null, "Test");
  Z.ustawDokument(w.zwrot.id, 101, "Test");

  assert.match(Z.szczegolZwrotu(w.zwrot.id).dokumenty.przeszkoda ?? "", /kartotek/i);
  assert.throws(() => Z.wystawDokumenty(w.zwrot.id, "Test"), /kartotek/i);
});

test("po zleceniu dokumentów decyzji i dokumentu już się nie zmienia", async () => {
  const id = await zwrotGotowyDoKorekty();
  const pozycjaId = Z.szczegolZwrotu(id).pozycje[0].id;
  Z.wystawDokumenty(id, "Test");
  assert.throws(() => Z.zapiszDecyzje(id, pozycjaId, "reklamacja", null, "Test"), /zlecone/i);
  assert.throws(() => Z.zdejmijDokument(id, "Test"), /zlecone/i);
});

test("numery obu dokumentów wracają na kartę z wiersza kolejki", async () => {
  /* Karta czyta stan PRZEZ kolejkę, nie z kopii na zwrocie — inaczej po
     ponowieniu miałaby drugą, nieaktualną prawdę. */
  const id = await zwrotGotowyDoKorekty();
  const queueId = Z.wystawDokumenty(id, "Test").dokumenty.queueId;
  db()
    .prepare("UPDATE sfera_queue SET status='done', sgt_doc_number=?, wynik_json=? WHERE id=?")
    .run(
      "KFS 9/08/2026",
      JSON.stringify({ korektaNumer: "KFS 9/08/2026", mmNumer: "MM 77/08/2026", rwNumer: "RW 4/08/2026" }),
      queueId
    );

  const d = Z.szczegolZwrotu(id).dokumenty;
  assert.equal(d.stan, "wystawione");
  assert.equal(d.korektaNumer, "KFS 9/08/2026");
  assert.equal(d.mmNumer, "MM 77/08/2026");
  assert.equal(d.rwNumer, "RW 4/08/2026");

  db().prepare("UPDATE sfera_queue SET status='error', error_msg=? WHERE id=?").run("Kartoteka w edycji", queueId);
  const bledny = Z.szczegolZwrotu(id).dokumenty;
  assert.equal(bledny.stan, "blad");
  assert.equal(bledny.blad, "Kartoteka w edycji");
});
