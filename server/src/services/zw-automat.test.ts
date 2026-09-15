import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { AUTOMAT_ZW, wpiszNumeryZw, zakolejkujZw, type OpcjeZw } from "./zw-automat.js";
import { cofnijKorekte, cofnijKwote, listaZwrotow, zapiszKorekte } from "./zwroty.js";

/* ── Automatyczny ZW do paragonu (0.349.0) ──────────────────────────────────
   Dokument fiskalny ze skutkiem magazynowym, więc strażnicy pilnują trzech
   rzeczy: ZW niesie PEŁNĄ wartość towaru (potrącenie jest wyłącznie
   w Allegro), nie powstaje dwa razy, a człowiek zawsze może automat
   wyprzedzić — bez drugiego dokumentu obok swojego.                        */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = new Date("2026-09-15T12:00:00Z");
const KTO = { id: 1, name: "Ala z biura" };
const WLACZONY: OpcjeZw = { wlaczony: true, twIdPrzesylki: 943 };
const PARAGON = 5000;

function stanowisko(): Db {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  d.prepare("INSERT INTO app_user(name,role) VALUES ('Ala z biura','biuro')").run();
  for (const [tw, symbol] of [[101, "SEKATOR"], [102, "FILTR"], [943, "PRZESYŁKA"]] as const) {
    d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(tw, symbol, `Towar ${symbol}`);
  }
  d.prepare(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,data_wyst)
    VALUES (?,'PA','PA 1/MAG/09/2026','2026-09-01')`).run(PARAGON);
  for (const [tw, ilosc] of [[101, 1], [102, 2], [943, 1]]) {
    d.prepare("INSERT INTO sgt_faktura_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)").run(PARAGON, tw, ilosc);
  }
  return d as unknown as Db;
}

let kolejny = 0;
type Poz = { twId: number | null; cena: number; ilosc?: number; zwrocona?: number;
  potracenie?: number; wZwrocie?: boolean };

/** Zwrot przyjęty, z zapisaną kwotą i paragonem — stan tuż po „zapisz kwotę". */
function zwrot(d: Db, pozycje: Poz[], pola: { typ?: string; dostawa?: number } = {}): number {
  const ext = `z${++kolejny}`;
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,created_at,synced_at,
    werdykt,kwota_grosze,kwota_dostawa_grosze,faktura_dok_id,faktura_numer,faktura_typ)
    VALUES (1,?,?,?,?,'przyjety',1,?,?,'PA 1/MAG/09/2026',?)`)
    .run(ext, `REF-${ext}`, TERAZ.toISOString(), TERAZ.toISOString(),
      pola.dostawa ?? 0, PARAGON, pola.typ ?? "PA");
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta WHERE external_id=?").get(ext) as { id: number }).id);
  pozycje.forEach((p, i) => {
    d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,nazwa,ilosc,ilosc_zwrocona,cena_grosze,waluta,
      tw_id,klucz,w_zwrocie,potracenie_grosze) VALUES (?,?,?,?,?,'PLN',?,?,?,?)`)
      .run(id, `Towar ${i}`, p.ilosc ?? 1, p.zwrocona ?? null, p.cena, p.twId, `k${i}`,
        p.wZwrocie === false ? 0 : 1, p.potracenie ?? null);
  });
  return id;
}

const zadanie = (d: Db, zwrotId: number) => d.prepare(
  `SELECT q.id, q.type, q.status, q.payload, q.tw_id FROM sfera_queue q
     JOIN zwrot_klienta z ON z.korekta_queue_id = q.id WHERE z.id=?`).get(zwrotId) as
  { id: number; type: string; status: string; payload: string; tw_id: number | null } | undefined;

const wersja = (d: Db, zwrotId: number) =>
  Number((d.prepare("SELECT wersja FROM zwrot_klienta WHERE id=?").get(zwrotId) as { wersja: number }).wersja);

const ustawStatus = (d: Db, queueId: number, status: string, numer: string | null = null) =>
  d.prepare("UPDATE sfera_queue SET status=?, sgt_doc_number=? WHERE id=?").run(status, numer, queueId);

test("wyłączony automat nie zleca niczego", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }]);
  assert.equal(zakolejkujZw(d, id, KTO, TERAZ, { wlaczony: false, twIdPrzesylki: 943 }), null);
  assert.equal(zadanie(d, id), undefined);
});

test("ZW do paragonu: kartoteki zsumowane, PEŁNA wartość bez potrącenia, przesyłka za dostawą", () => {
  /* Decyzja właściciela: „zw zawsze pełną wartość zwracanego towaru, jeśli towar
     był uszkodzony lub używany pomniejszamy w allegro". Potrącenie 10 zł przy
     sekatorze NIE schodzi z wartości ZW. Z dwóch filtrów wróciła jedna sztuka,
     więc ZW liczy jedną — tak samo jak kwota do oddania. */
  const d = stanowisko();
  const id = zwrot(d, [
    { twId: 101, cena: 4999, potracenie: 1000 },
    { twId: 102, cena: 1500, ilosc: 2, zwrocona: 1 },
  ], { dostawa: 1499 });

  const wynik = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY);
  assert.ok(wynik && "queueId" in wynik);
  const q = zadanie(d, id)!;
  assert.equal(q.type, "zw");
  assert.equal(q.status, "pending");
  assert.equal(q.tw_id, null, "zadanie wielopozycyjne — bez tw_id, jak MM koszyka");
  assert.deepEqual(JSON.parse(q.payload), {
    zwrotId: id, dokId: PARAGON, paragon: "PA 1/MAG/09/2026",
    pozycje: [{ twId: 101, qty: 1 }, { twId: 102, qty: 1 }],
    przesylkaTwId: 943, przesylkaZostaw: true,
    wartoscGrosze: 4999 + 1500 + 1499,
  });
  const os = d.prepare("SELECT rodzaj FROM zwrot_zdarzenie WHERE zwrot_id=?").all(id) as Array<{ rodzaj: string }>;
  assert.deepEqual(os.map((r) => r.rodzaj), ["zw_zlecony"]);
});

test("odznaczony koszt dostawy zeruje przesyłkę na ZW", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }], { dostawa: 0 });
  zakolejkujZw(d, id, KTO, TERAZ, WLACZONY);
  const p = JSON.parse(zadanie(d, id)!.payload);
  assert.equal(p.przesylkaZostaw, false);
  assert.equal(p.wartoscGrosze, 4999);
});

test("pozycja poza zaznaczeniem nie wchodzi ani do pozycji, ani do wartości", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }, { twId: 102, cena: 1500, wZwrocie: false }]);
  zakolejkujZw(d, id, KTO, TERAZ, WLACZONY);
  const p = JSON.parse(zadanie(d, id)!.payload);
  assert.deepEqual(p.pozycje, [{ twId: 101, qty: 1 }]);
  assert.equal(p.wartoscGrosze, 4999);
});

test("faktura zostaje ręczna — bez zlecenia i bez zdania w osi", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }], { typ: "FS" });
  assert.equal(zakolejkujZw(d, id, KTO, TERAZ, WLACZONY), null);
  assert.equal(zadanie(d, id), undefined);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM zwrot_zdarzenie WHERE zwrot_id=?").get(id) as { n: number }).n, 0);
});

test("pozycja bez kartoteki: zdanie w osi zamiast zgadniętego ZW", () => {
  /* Biuro widzi zwrot w DO KOREKTY. Bez zdania czekałoby na numer, który nie
     przyjdzie — a automat nie ma prawa zgadywać, co wróciło na półkę. */
  const d = stanowisko();
  const id = zwrot(d, [{ twId: null, cena: 4999 }]);
  const wynik = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY);
  assert.ok(wynik && "pominiety" in wynik);
  assert.equal(zadanie(d, id), undefined);
  const z = d.prepare("SELECT tresc FROM zwrot_zdarzenie WHERE zwrot_id=? AND rodzaj='zw_pominiety'").get(id) as { tresc: string };
  assert.match(z.tresc, /ZW wystawia biuro/);
});

test("drugiego ZW nie ma, póki pierwszy żyje albo powstał — po błędzie wraca", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }]);
  const pierwszy = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY) as { queueId: number };
  assert.equal(zakolejkujZw(d, id, KTO, TERAZ, WLACZONY), null, "czekający blokuje");
  ustawStatus(d, pierwszy.queueId, "done", "ZW 1/MAG/09/2026");
  assert.equal(zakolejkujZw(d, id, KTO, TERAZ, WLACZONY), null, "wykonany blokuje — drugi dokument byłby dublem");
  ustawStatus(d, pierwszy.queueId, "error");
  const drugi = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY);
  assert.ok(drugi && "queueId" in drugi && drugi.queueId !== pierwszy.queueId);
});

test("ręczny numer ANULUJE czekający ZW — bez drugiego dokumentu obok", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }]);
  const { queueId } = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY) as { queueId: number };
  zapiszKorekte(d, id, "ZW 5/MAG/09/2026", wersja(d, id), KTO, TERAZ);
  const q = d.prepare("SELECT status FROM sfera_queue WHERE id=?").get(queueId) as { status: string };
  assert.equal(q.status, "cancelled");
  assert.equal(zadanie(d, id), undefined, "zwrot nie wskazuje już zadania");
});

test("ręczny numer odmawia, gdy automat pisze albo już wystawił ZW", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }]);
  const { queueId } = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY) as { queueId: number };
  ustawStatus(d, queueId, "processing");
  assert.throws(() => zapiszKorekte(d, id, "ZW 5/MAG/09/2026", wersja(d, id), KTO, TERAZ),
    /właśnie wystawia ZW/);
  ustawStatus(d, queueId, "done", "ZW 7/MAG/09/2026");
  assert.throws(() => zapiszKorekte(d, id, "ZW 5/MAG/09/2026", wersja(d, id), KTO, TERAZ),
    /ZW 7\/MAG\/09\/2026 — numer wpisze się sam/);
});

test("cofnięcie kwoty anuluje czekający ZW, a wystawiony je zatrzymuje", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }]);
  const pierwszy = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY) as { queueId: number };
  cofnijKwote(d, id, wersja(d, id), KTO, TERAZ);
  assert.equal((d.prepare("SELECT status FROM sfera_queue WHERE id=?").get(pierwszy.queueId) as { status: string }).status,
    "cancelled");

  d.prepare("UPDATE zwrot_klienta SET kwota_grosze=4999 WHERE id=?").run(id);
  d.prepare("UPDATE zwrot_klienta_pozycja SET w_zwrocie=1 WHERE zwrot_id=?").run(id);
  const drugi = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY) as { queueId: number };
  ustawStatus(d, drugi.queueId, "done", "ZW 8/MAG/09/2026");
  assert.throws(() => cofnijKwote(d, id, wersja(d, id), KTO, TERAZ), /już stoi w Subiekcie/);
});

test("numer wystawionego ZW trafia do zwrotu RAZ, podpisany automatem", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }]);
  const { queueId } = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY) as { queueId: number };
  const przed = wersja(d, id);

  assert.equal(wpiszNumeryZw(d, TERAZ), 0, "czekające zadanie nie ma numeru");
  ustawStatus(d, queueId, "done", "ZW 9/MAG/09/2026");
  assert.equal(wpiszNumeryZw(d, TERAZ), 1);
  assert.equal(wpiszNumeryZw(d, TERAZ), 0, "idempotentne");

  const z = d.prepare("SELECT korekta_numer, korekta_zrodlo, zamkniety_at FROM zwrot_klienta WHERE id=?")
    .get(id) as { korekta_numer: string; korekta_zrodlo: string; zamkniety_at: string };
  assert.equal(z.korekta_numer, "ZW 9/MAG/09/2026");
  assert.equal(z.korekta_zrodlo, "sfera");
  assert.ok(z.zamkniety_at);
  assert.equal(wersja(d, id), przed + 1, "panel ze starą wersją ma dostać konflikt");
  const wpis = d.prepare("SELECT kto FROM zwrot_zdarzenie WHERE zwrot_id=? AND rodzaj='korekta'").get(id) as { kto: string };
  assert.equal(wpis.kto, AUTOMAT_ZW);
});

test("cofnięta korekta z automatu nie wraca sama po minucie", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }]);
  const { queueId } = zakolejkujZw(d, id, KTO, TERAZ, WLACZONY) as { queueId: number };
  ustawStatus(d, queueId, "done", "ZW 9/MAG/09/2026");
  wpiszNumeryZw(d, TERAZ);

  cofnijKorekte(d, id, wersja(d, id), KTO, TERAZ);
  assert.equal(wpiszNumeryZw(d, TERAZ), 0);
  const z = d.prepare("SELECT korekta_numer FROM zwrot_klienta WHERE id=?").get(id) as { korekta_numer: string | null };
  assert.equal(z.korekta_numer, null);
});

test("lista zwrotów niesie stan ZW — panel mówi po nim, kto wystawia", () => {
  const d = stanowisko();
  const id = zwrot(d, [{ twId: 101, cena: 4999 }]);
  assert.equal(listaZwrotow(d, TERAZ.getTime(), { id })[0].zw, null);
  zakolejkujZw(d, id, KTO, TERAZ, WLACZONY);
  assert.deepEqual(listaZwrotow(d, TERAZ.getTime(), { id })[0].zw,
    { status: "pending", numer: null, blad: null });
});
