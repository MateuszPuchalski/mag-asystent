import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kosze zwrotowe — serwis ─────────────────────────────────────────────────
   Trzy niezmienniki z cichym trybem awarii:

   1. KOSZ WIĄŻE SIĘ Z DOKUMENTEM. Przypięcie przed zleceniem korekty i MM
      albo zamknięcie, zanim dokumenty weszły do Subiekta, kończy się później
      cofnięciem bufora, na którym towaru nigdy nie było — ujemnym stanem.
   2. ADRES PRZED SPRZEDAWALNOŚCIĄ. Zapis lokalizacji z odkładania musi stanąć
      w kolejce PRZED zadaniem MM tego samego towaru.
   3. COFNIĘCIE BUFORA IDZIE SAMO — po zakończeniu każda pozycja ma zadanie
      MM ZWROTY→MAG, jednopozycyjne i z tw_id (przez wzgląd na guard).       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kosz-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zwroty.js");
let K: typeof import("./kosze.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zwroty.js");
  K = await import("./kosze.js");
});

beforeEach(() => {
  const d = db();
  for (const t of [
    "kosz_pozycja", "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot", "kosz",
    "sgt_sprzedaz_pozycja", "sgt_sprzedaz", "sgt_towar", "sfera_queue",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const ins = d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,?)"
  );
  ins.run(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta", "", "A01-02-03");
  ins.run(900_037, "TEST-LINIA-DONE", "Pozycja odłożona w całości", "5900000000037", "");
  ins.run(900_029, "TEST-ROTUJACY", "Szybkorotujący", "", "C01-01-01");
  d.prepare(
    "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, mag_id) VALUES (101,'FS','FS 101/08/2026','dev-ord-1',?, 'ALLEGRO', 1)"
  ).run(new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10));
  const poz = d.prepare("INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (101,?,?)");
  poz.run(900_036, 1);
  poz.run(900_037, 2);
});

/** Zwrot z wystawionymi dokumentami — punkt startu Etapu 3. */
async function zwrotZDokumentami(dokDone = true): Promise<number> {
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") throw new Error("oczekiwano utworzenia");
  for (const p of w.zwrot.pozycje) Z.zapiszDecyzje(w.zwrot.id, p.id, "pelnowartosciowy", null, "Test");
  const queueId = Z.wystawDokumenty(w.zwrot.id, "Test").dokumenty.queueId;
  if (dokDone) {
    db().prepare("UPDATE sfera_queue SET status='done', sgt_doc_number='KFS 1/08/2026' WHERE id=?").run(queueId);
  }
  return w.zwrot.id;
}

test("kosz nie przyjmie zwrotu bez zleconych dokumentów", async () => {
  const w = await Z.utworzZeSkanu("DEVWB0001", "Test");
  if (w.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  assert.throws(() => K.przypnijZwrot(w.zwrot.id, "KZ-01", "Test"), /korektę i MM/);
});

test("przypięcie tworzy kosz przy pierwszym skanie i jest idempotentne", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, " kz-01 ", "Test"); // trim + upper — skan i wpis się spotykają
  K.przypnijZwrot(id, "KZ-01", "Test");   // drugi skan tego samego kosza
  const kosze = K.listaKoszy();
  assert.equal(kosze.length, 1);
  assert.equal(kosze[0].kod, "KZ-01");
  assert.equal(kosze[0].zwrotow, 1);
  assert.throws(() => K.przypnijZwrot(id, "KZ-02", "Test"), /innym koszu/);
  K.odepnijZwrot(id, "Test");
  K.przypnijZwrot(id, "KZ-02", "Test");
});

test("zamknięcie czeka, aż dokumenty NAPRAWDĘ wejdą do Subiekta", async () => {
  const id = await zwrotZDokumentami(false); // zadanie korekty wciąż pending
  K.przypnijZwrot(id, "KZ-01", "Test");
  const koszId = K.listaKoszy()[0].id;
  assert.throws(() => K.zamknijKosz(koszId, "Test"), /nie weszły do Subiekta/);
});

test("snapshot przy zamknięciu: pozycje pełnowartościowe z symbolem i ilością", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
  assert.equal(kosz.status, "zamkniety");
  assert.equal(kosz.pozycje.length, 2);
  // sortowanie alejkowe: towar z adresem przed towarem bez adresu
  assert.equal(kosz.pozycje[0].symbol, "TEST-LINIA-TODO");
  assert.equal(kosz.pozycje[0].lokOczekiwana, "A01-02-03");
  assert.equal(kosz.pozycje[1].lokOczekiwana, null);
  assert.deepEqual(K.koszeDlaKolektora().map((k) => k.kod), ["KZ-01"]);
});

test("skan towaru wskazuje pozycję kosza; cudzy towar mówi „nie z tego kosza”", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
  const poEan = K.skanTowaruKosza(kosz.id, "5900000000037");
  assert.ok("pozycjaId" in poEan);
  const poSymbolu = K.skanTowaruKosza(kosz.id, "test-linia-todo");
  assert.ok("pozycjaId" in poSymbolu);
  db().prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1, 'OBCY', 'Obcy towar', '5901111111111', '')").run();
  assert.deepEqual(K.skanTowaruKosza(kosz.id, "5901111111111"), { poza: true, symbol: "OBCY" });
  assert.deepEqual(K.skanTowaruKosza(kosz.id, "0000000000000"), { nieznany: true });
});

test("odłożenie: zapis adresu tylko przy zmianie, zawsze PRZED zadaniem MM", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
  const [zAdresem, bezAdresu] = kosz.pozycje;

  // towar wraca na SWOJĄ półkę → zero zapisu lokalizacji
  const r1 = K.odlozPozycje(zAdresem.id, "A01-02-03", "Magazynier");
  assert.equal(r1.mismatch, false);
  // towar bez adresu w kartotece → zapis lokalizacji idzie do kolejki
  K.odlozPozycje(bezAdresu.id, "B02-01-01", "Magazynier");
  const setLoc = db()
    .prepare("SELECT id, tw_id FROM sfera_queue WHERE type='set_location'")
    .all() as Array<{ id: number; tw_id: number }>;
  assert.deepEqual(setLoc.map((s) => s.tw_id), [900_037]);

  assert.throws(() => K.odlozPozycje(zAdresem.id, "A01-02-03", "Magazynier"), /już odłożona/);
  assert.throws(() => K.zakonczKosz(0, "Magazynier"), /nie istnieje/);

  const rozlozony = K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal(rozlozony.status, "rozlozony");
  const mm = db()
    .prepare("SELECT id, tw_id, payload FROM sfera_queue WHERE type='mm' ORDER BY id")
    .all() as Array<{ id: number; tw_id: number; payload: string }>;
  assert.equal(mm.length, 2, "MM jednopozycyjne per pozycja kosza");
  for (const zadanie of mm) {
    const p = JSON.parse(zadanie.payload);
    assert.equal(p.magFrom, 3, "z bufora zwrotów");
    assert.equal(p.magTo, 1, "na magazyn główny");
    assert.ok(zadanie.tw_id, "tw_id ustawione — guard kolejności musi widzieć towar");
  }
  // niezmiennik: zapis adresu stoi w kolejce PRZED cofnięciem bufora tego towaru
  const mm37 = mm.find((z) => z.tw_id === 900_037)!;
  assert.ok(setLoc[0].id < mm37.id, "set_location przed mm dla tego samego towaru");

  // drugie kliknięcie ZAKOŃCZ nie dubluje dokumentów
  K.zakonczKosz(kosz.id, "Magazynier");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number }).n, 2);

  // kod wraca do obiegu: nowy kosz pod tym samym kodem (inny zwrot — DEVTW0002)
  const w2 = await Z.utworzZeSkanu("DEVTW0002", "Test");
  if (w2.rodzaj !== "utworzony") return assert.fail("oczekiwano utworzenia");
  for (const p of w2.zwrot.pozycje) Z.zapiszDecyzje(w2.zwrot.id, p.id, "pelnowartosciowy", null, "Test");
  Z.ustawDokument(w2.zwrot.id, 101, "Test");
  const q2 = Z.wystawDokumenty(w2.zwrot.id, "Test").dokumenty.queueId;
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(q2);
  K.przypnijZwrot(w2.zwrot.id, "KZ-01", "Test");
  assert.equal(K.listaKoszy().filter((k) => k.kod === "KZ-01" && k.status === "otwarty").length, 1);
});

test("zakończenie odmawia, dopóki cokolwiek leży w koszu", async () => {
  const id = await zwrotZDokumentami();
  K.przypnijZwrot(id, "KZ-01", "Test");
  const kosz = K.zamknijKosz(K.listaKoszy()[0].id, "Test");
  K.odlozPozycje(kosz.pozycje[0].id, "A01-02-03", "Magazynier");
  assert.throws(() => K.zakonczKosz(kosz.id, "Magazynier"), /Nieodłożone pozycje/);
});
