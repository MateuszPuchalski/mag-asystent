import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-przesylka-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Gdzie jest paczka do klienta (0.393.0) ──────────────────────────────────
   Przy reklamacji to pytanie pierwsze: „czy on to w ogóle dostał". Testy
   pilnują czterech rzeczy, z których każda jest decyzją, a nie kształtem:

   1. DWA ŻĄDANIA, BO TAK MÓWI SPECYFIKACJA. Numer stoi pod `/shipments`,
      status pod `/tracking` — ładunek zamówienia nie ma ani jednego.
   2. BRAK NUMERU TO NIE AWARIA, tylko paczka jeszcze nienadana. Zapisujemy
      `sprawdzono_at`, żeby ekran odróżnił to od „nie pytaliśmy".
   3. DORĘCZONA PRZEBIJA. Zamówienie bywa w kilku paczkach; pytanie brzmi
      „czy doszło", więc wygrywa ta, która doszła.
   4. WAYBILL NIE WCHODZI DO DZIENNIKA — prowadzi do adresu odbiorcy,
      a `events` nie ma retencji.                                            */

let db: typeof import("../db/db.js").db;
let sprawdzPrzesylke: typeof import("./przesylka-zamowienia.js").sprawdzPrzesylke;
let przesylkaZamowienia: typeof import("./przesylka-zamowienia.js").przesylkaZamowienia;

let zamowienie = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ sprawdzPrzesylke, przesylkaZamowienia } = await import("./przesylka-zamowienia.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["zamowienie_klienta", "channel_account", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a')")
    .run().lastInsertRowid);
  zamowienie = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,
    synced_at) VALUES (?,'ord-1','2026-09-18T00:00:00Z')`).run(konto).lastInsertRowid);
});

const doreczona = (waybill: string) => ({
  waybills: [{ waybill, trackingDetails: { statuses: [
    { code: "IN_TRANSIT", occurredAt: "2026-09-10T08:00:00Z" },
    { code: "DELIVERED", occurredAt: "2026-09-12T09:00:00Z" },
  ] } }],
});

const wDrodze = (waybill: string) => ({
  waybills: [{ waybill, trackingDetails: { statuses: [
    { code: "IN_TRANSIT", occurredAt: "2026-09-10T08:00:00Z" },
  ] } }],
});

test("dwa żądania: najpierw numer przesyłki, potem jego status", async () => {
  const wolane: string[] = [];
  const stan = await sprawdzPrzesylke(db(), zamowienie, {
    apiUrl: "https://api.test",
    teraz: () => "2026-09-18T10:00:00Z",
    query: async (url) => {
      wolane.push(url);
      if (url.includes("/shipments")) return { shipments: [{ waybill: "AD-1", carrierId: "INPOST" }] };
      return doreczona("AD-1");
    },
  });

  assert.equal(wolane.length, 2);
  assert.match(wolane[0]!, /\/order\/checkout-forms\/ord-1\/shipments$/);
  assert.match(wolane[1]!, /\/order\/carriers\/INPOST\/tracking\?waybill=AD-1$/);
  assert.deepEqual(stan, {
    waybill: "AD-1", przewoznik: "INPOST", status: "DELIVERED",
    dostarczonoAt: "2026-09-12T09:00:00Z", sprawdzonoAt: "2026-09-18T10:00:00Z",
  });
});

test("brak numeru to NIE awaria — zapisujemy sam moment sprawdzenia", async () => {
  /* Paczka bywa jeszcze nienadana. Ekran ma odróżnić „pytaliśmy, Allegro nic
     nie ma" od „nie pytaliśmy" — stąd `sprawdzonoAt` bez reszty. */
  const stan = await sprawdzPrzesylke(db(), zamowienie, {
    apiUrl: "https://api.test", teraz: () => "2026-09-18T10:00:00Z",
    query: async () => ({ shipments: [] }),
  });

  assert.deepEqual(stan, {
    waybill: null, przewoznik: null, status: null, dostarczonoAt: null,
    sprawdzonoAt: "2026-09-18T10:00:00Z",
  });
  assert.equal(przesylkaZamowienia(db(), zamowienie).sprawdzonoAt, "2026-09-18T10:00:00Z");
});

test("paczka DORĘCZONA przebija tę w drodze — pytanie brzmi „czy doszło”", async () => {
  const stan = await sprawdzPrzesylke(db(), zamowienie, {
    apiUrl: "https://api.test", teraz: () => "2026-09-18T10:00:00Z",
    query: async (url) => {
      if (url.includes("/shipments")) {
        return { shipments: [
          { waybill: "W-DRODZE", carrierId: "DPD" },
          { waybill: "DOSZLA", carrierId: "INPOST" },
        ] };
      }
      return url.includes("DOSZLA") ? doreczona("DOSZLA") : wDrodze("W-DRODZE");
    },
  });

  assert.equal(stan.waybill, "DOSZLA");
  assert.equal(stan.dostarczonoAt, "2026-09-12T09:00:00Z");
});

test("odmowa przewoźnika nie wywraca odczytu — numer zostaje, status milczy", async () => {
  /* Degraduje, nie przerywa: ta sama zasada co przy trackingu zwrotów. */
  const stan = await sprawdzPrzesylke(db(), zamowienie, {
    apiUrl: "https://api.test", teraz: () => "2026-09-18T10:00:00Z",
    query: async (url) => {
      if (url.includes("/shipments")) return { shipments: [{ waybill: "AD-1", carrierId: "INPOST" }] };
      throw new Error("503 od przewoźnika");
    },
  });

  assert.equal(stan.waybill, "AD-1");
  assert.equal(stan.status, null);
});

test("numer przesyłki NIE wchodzi do dziennika — prowadzi do adresu odbiorcy", async () => {
  await sprawdzPrzesylke(db(), zamowienie, {
    apiUrl: "https://api.test", teraz: () => "2026-09-18T10:00:00Z",
    query: async (url) => (url.includes("/shipments")
      ? { shipments: [{ waybill: "AD-TAJNY", carrierId: "INPOST" }] }
      : doreczona("AD-TAJNY")),
  });

  const wpisy = db().prepare("SELECT payload FROM events WHERE type='zamowienie_przesylka'")
    .all() as Array<{ payload: string }>;
  assert.equal(wpisy.length, 1);
  assert.doesNotMatch(wpisy[0]!.payload, /AD-TAJNY/);
});

test("odczyt bez pytania Allegro niczego nie mutuje", () => {
  const przed = Number(db().prepare("SELECT COUNT(*) AS n FROM events").get()!.n);
  assert.equal(przesylkaZamowienia(db(), zamowienie).sprawdzonoAt, null);
  assert.equal(Number(db().prepare("SELECT COUNT(*) AS n FROM events").get()!.n), przed);
});
