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
  for (const t of ["zwrot_pozycja", "zwrot", "sgt_sprzedaz_pozycja", "sgt_sprzedaz", "sgt_towar"]) {
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
  opcje: { nrOryg?: string; kontrahent?: string; uwagi?: string; pozycje: Array<[number, number]> }
): void {
  const data = new Date(Date.now() - dniTemu * 86_400_000).toISOString().slice(0, 10);
  db()
    .prepare(
      "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, uwagi) VALUES (?,?,?,?,?,?,?)"
    )
    .run(dokId, typ, `${typ} ${dokId}/08/2026`, opcje.nrOryg ?? null, data, opcje.kontrahent ?? "", opcje.uwagi ?? null);
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
