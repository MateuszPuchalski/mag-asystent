import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sellasist-notatki-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.STREFA_CZASU = "Europe/Warsaw";

/* ── Wgląd i notatka do zamówienia w Sellasist ───────────────────────────────
   Pilnujemy:
   - wgląd niczego nie zapisuje: ani lustra, ani dziennika; notatek nie trzyma;
   - bez integracji nikt nie jest pytany;
   - notatka idzie do ORYGINAŁU, z podpisem autora, a dziennik nie niesie
     treści; pusta, za długa i do nieznanego zamówienia — odmowa ze zdaniem;
   - błąd Sellasist dochodzi stałym zdaniem, nie treścią odpowiedzi. */

let db: typeof import("../db/db.js").db;
let N: typeof import("./sellasist-notatki.js");
let BladSellasist: typeof import("../adapters/sellasist.http.js").BladSellasist;
const ala = { id: 7, name: "A. Lewandowska" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  N = await import("./sellasist-notatki.js");
  ({ BladSellasist } = await import("../adapters/sellasist.http.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["sellasist_pozycja", "sellasist_przesylka", "sellasist_zamowienie", "events"]) d.exec(`DELETE FROM ${t}`);
  d.prepare(`INSERT INTO sellasist_zamowienie(id, external_id, status_nazwa, spakowano_at, pobrano_at)
    VALUES (50, 'ord-1', 'Spakowane', '2026-10-13T08:00:00.000Z', '2026-10-13T08:01:00.000Z')`).run();
  d.prepare(`INSERT INTO sellasist_zamowienie(id, external_id, skopiowane_z, pobrano_at)
    VALUES (51, 'ord-1', 50, '2026-10-13T08:01:00.000Z')`).run();
  d.prepare(`INSERT INTO sellasist_przesylka(zamowienie_id, waybill, usluga, przewoznik, utworzono_at)
    VALUES (50, 'DPD1', 'DPD', 'DPD', '2026-10-13T08:00:00.000Z')`).run();
  d.prepare(`INSERT INTO sellasist_pozycja(koszyk_id, zamowienie_id, nazwa, ilosc, brakuje) VALUES (1, 50, 'Pasek', 2, 2)`).run();
});

function atrapa(odp: Record<string, unknown>) {
  const wolania: Array<{ sciezka: string; opcje?: unknown }> = [];
  return {
    wolania,
    query: async (sciezka: string, opcje?: unknown) => {
      wolania.push({ sciezka, opcje });
      const o = odp[sciezka];
      if (o instanceof Error) throw o;
      if (!(sciezka in odp)) throw new Error(`niezapowiedziane: ${sciezka}`);
      return o;
    },
  };
}

const zmiany = () => Number((db().prepare("SELECT total_changes() AS n").get() as { n: number }).n);

test("wgląd: stan z lustra, notatki na żywo, bez jednego zapisu", async () => {
  const a = atrapa({ "/notes/50": [{ id: 1, text: "Dosłać pasek", date: "2026-10-13 10:05:00" }, { id: 2, text: "" }] });
  const przed = zmiany();
  const w = await N.widokSellasist(db(), "ord-1", a.query, true);
  assert.equal(zmiany(), przed);
  assert.equal(w.zamowienie!.id, 50);
  assert.equal(w.zamowienie!.status, "Spakowane");
  assert.deepEqual(w.zamowienie!.kopie, [51]);
  assert.deepEqual(w.zamowienie!.braki, [{ nazwa: "Pasek", potrzeba: 2, jest: 0 }]);
  assert.deepEqual(w.zamowienie!.przesylki, [{ waybill: "DPD1", usluga: "DPD", utworzonoAt: "2026-10-13T08:00:00.000Z" }]);
  assert.deepEqual(w.notatki, [{ data: "2026-10-13T08:05:00.000Z", tekst: "Dosłać pasek" }]);
});

test("wgląd bez integracji nie pyta nikogo", async () => {
  const a = atrapa({});
  assert.deepEqual(await N.widokSellasist(db(), "ord-1", a.query, false),
    { wlaczony: false, zamowienie: null, notatki: [], notatkiBlad: null });
  assert.equal(a.wolania.length, 0);
});

test("wgląd: notatki, które nie doszły, zostawiają stan z lustra i stałe zdanie", async () => {
  const a = atrapa({ "/notes/50": new BladSellasist("Sellasist odpowiedział błędem (500).", 500) });
  const w = await N.widokSellasist(db(), "ord-1", a.query, true);
  assert.equal(w.zamowienie!.status, "Spakowane");
  assert.equal(w.notatkiBlad, "Sellasist odpowiedział błędem (500).");
});

test("notatka idzie do oryginału z podpisem autora; dziennik bez treści", async () => {
  const a = atrapa({ "/notes": { id: 9, order_id: 50 } });
  assert.equal(await N.dodajNotatkeSellasist(db(), "ord-1", "  Dosłać pasek do tej paczki ", ala, a.query, true), 50);
  assert.deepEqual(a.wolania, [{ sciezka: "/notes", opcje: { metoda: "POST",
    body: { order_id: 50, text: "Dosłać pasek do tej paczki\n(A. Lewandowska, WERTIS)" } } }]);
  const e = db().prepare("SELECT type, payload FROM events").all() as Array<{ type: string; payload: string }>;
  assert.deepEqual(e.map((x) => [x.type, JSON.parse(x.payload)]), [["sellasist_notatka", { zamowienieSellasist: 50 }]]);
  assert.doesNotMatch(JSON.stringify(e), /pasek/);
});

test("notatka do zamówienia spoza lustra szuka go po numerze źródła", async () => {
  const a = atrapa({
    "/orders?external_id=ord-2&limit=100": [{ id: 80 }, { id: 81 }],
    "/notes": { id: 9 },
  });
  assert.equal(await N.dodajNotatkeSellasist(db(), "ord-2", "x", ala, a.query, true), 80);
});

test("wgląd w zamówienie spoza lustra: stan nieznany, nie zerowy; notatki dalej są", async () => {
  const a = atrapa({ "/orders?external_id=ord-2&limit=100": [{ id: 80 }], "/notes/80": [{ text: "Stara", date: "2026-01-02 10:00:00" }] });
  const w = await N.widokSellasist(db(), "ord-2", a.query, true);
  assert.equal(w.zamowienie!.wLustrze, false);
  assert.equal(w.zamowienie!.id, 80);
  assert.equal(w.notatki.length, 1);
  assert.equal((await N.widokSellasist(db(), "ord-1", atrapa({ "/notes/50": [] }).query, true)).zamowienie!.wLustrze, true);
});

test("odmowy: wyłączona, pusta, za długa, nieznane zamówienie, błąd Sellasist stałym zdaniem", async () => {
  const kod = async (p: Promise<unknown>) => {
    try { await p; return null; } catch (e) { return [(e as { kod: number }).kod, (e as Error).message]; }
  };
  assert.deepEqual(await kod(N.dodajNotatkeSellasist(db(), "ord-1", "x", ala, atrapa({}).query, false)),
    [409, "Integracja z Sellasist nie jest włączona."]);
  assert.deepEqual((await kod(N.dodajNotatkeSellasist(db(), "ord-1", "   ", ala, atrapa({}).query, true)))![0], 400);
  assert.deepEqual((await kod(N.dodajNotatkeSellasist(db(), "ord-1", "x".repeat(N.LIMIT_NOTATKI + 1), ala,
    atrapa({}).query, true)))![0], 400);
  assert.deepEqual(await kod(N.dodajNotatkeSellasist(db(), "ord-9", "x", ala,
    atrapa({ "/orders?external_id=ord-9&limit=100": [] }).query, true)),
  [404, "Sellasist nie zna tego zamówienia."]);
  assert.deepEqual(await kod(N.dodajNotatkeSellasist(db(), "ord-1", "x", ala,
    atrapa({ "/notes": new Error("<html>stack trace</html>") }).query, true)), [502, "Sellasist nie odpowiedział."]);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM events").get()!.n, 0, "odmowa nie trafia do dziennika");
});

test("odpowiedź bez numeru notatki (także 404) to odmowa, bez wpisu w dzienniku", async () => {
  for (const odp of [null, {}, { id: "" }]) {
    await assert.rejects(N.dodajNotatkeSellasist(db(), "ord-1", "x", ala, atrapa({ "/notes": odp }).query, true),
      (e: unknown) => (e as { kod: number }).kod === 502 && (e as Error).message === "Sellasist nie przyjął notatki.");
  }
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM events").get()!.n, 0);
});
