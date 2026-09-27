import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { odpytajTracking, stanZHistorii, uzupelnijDoreczenia } from "./allegro-tracking.js";
import { TRACKING_NA_ZADANIE, urlTrackingu } from "../adapters/allegro.http.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";

/* ── Kiedy paczka zwrotna do nas dotarła (0.187.0) ───────────────────────────
   Do 0.186.0 panel twierdził, że „Allegro nie podaje daty doręczenia do nas".
   Podaje — w `/order/carriers/{id}/tracking`, gdzie każda zmiana statusu ma
   `occurredAt`. Zdanie wzięło się ze zbyt wąskiego czytania obiektu zwrotu.  */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-1','2026-08-29T09:00:00Z','2026-09-01T09:00:00Z')`).run();
  return d as unknown as Db;
}

const historia = (statusy: Array<{ occurredAt: string; code: string }>) =>
  ({ waybill: "AD1", trackingDetails: { statuses: statusy } });

test("moment doręczenia bierze się z wpisu DELIVERED, nie z ostatniego", () => {
  /* Po doręczeniu potrafią dojść kolejne zdarzenia, a specyfikacja nie
     obiecuje porządku listy. */
  const s = stanZHistorii(historia([
    { occurredAt: "2026-08-24T10:41:00Z", code: "DELIVERED" },
    { occurredAt: "2026-08-21T13:01:00Z", code: "IN_TRANSIT" },
    { occurredAt: "2026-08-25T08:00:00Z", code: "ISSUE" },
  ]));
  assert.equal(s.dostarczonoAt, "2026-08-24T10:41:00Z");
  assert.equal(s.status, "ISSUE", "ostatni status liczy się po czasie, nie po kolejności");
  assert.equal(s.ostatnioAt, "2026-08-25T08:00:00Z", "chwila ostatniego statusu — też po czasie");
});

test("paczka w drodze nie ma daty doręczenia", () => {
  const s = stanZHistorii(historia([
    { occurredAt: "2026-08-21T12:09:00Z", code: "PENDING" },
    { occurredAt: "2026-08-21T13:01:00Z", code: "IN_TRANSIT" },
  ]));
  assert.equal(s.dostarczonoAt, null);
  assert.equal(s.status, "IN_TRANSIT");
});

test("doręczona i zwrócona nadawcy — bierzemy PIERWSZE doręczenie", () => {
  /* Nas interesuje moment, w którym karton trafił do nas, a nie to, co
     działo się z przesyłką potem. */
  const s = stanZHistorii(historia([
    { occurredAt: "2026-08-24T10:41:00Z", code: "DELIVERED" },
    { occurredAt: "2026-08-30T09:00:00Z", code: "DELIVERED" },
  ]));
  assert.equal(s.dostarczonoAt, "2026-08-24T10:41:00Z");
});

test("brak historii nie udaje żadnej wiedzy", () => {
  assert.deepEqual(stanZHistorii(undefined), { dostarczonoAt: null, status: null, ostatnioAt: null });
  assert.deepEqual(stanZHistorii({ waybill: "AD1", trackingDetails: null }),
    { dostarczonoAt: null, status: null, ostatnioAt: null });
});

test("adres niesie przewoźnika w ścieżce i numery w zapytaniu", () => {
  const url = urlTrackingu("https://api", "INPOST", ["AD1", "AD2"]);
  assert.equal(url, "https://api/order/carriers/INPOST/tracking?waybill=AD1&waybill=AD2");
});

test("ponad dwadzieścia numerów to błąd buildera, nie 400 z Allegro", () => {
  /* `maxItems` w specyfikacji to reguła poprawności: dłuższa lista wraca
     błędem 400, więc partię tnie wołający. */
  const duzo = Array.from({ length: TRACKING_NA_ZADANIE + 1 }, (_, i) => `AD${i}`);
  assert.throws(() => urlTrackingu("https://api", "INPOST", duzo), /najwyżej 20/);
});

test("odpowiedź przewoźnika ląduje przy zwrocie", async () => {
  const d = stanowisko();
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta").get() as { id: number }).id);
  const dopisanych = await uzupelnijDoreczenia(d,
    [{ zwrotId: id, carrierId: "INPOST", waybill: "AD1" }],
    { apiUrl: "https://api", query: async () => ({
      carrierId: "INPOST",
      waybills: [historia([{ occurredAt: "2026-08-24T10:41:00Z", code: "DELIVERED" }])],
    }) });

  assert.equal(dopisanych, 1);
  const w = d.prepare("SELECT dostarczono_at, przesylka_status FROM zwrot_klienta WHERE id=?")
    .get(id) as { dostarczono_at: string; przesylka_status: string };
  assert.equal(w.dostarczono_at, "2026-08-24T10:41:00Z");
  assert.equal(w.przesylka_status, "DELIVERED");
});

test("awaria przewoźnika NIE wywraca przebiegu", async () => {
  /* Tracking jest wygodą biura, a synchronizacja zwrotów — pracą. Data
     doręczenia dojdzie przy następnym takcie. */
  const d = stanowisko();
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta").get() as { id: number }).id);
  const dopisanych = await uzupelnijDoreczenia(d,
    [{ zwrotId: id, carrierId: "INPOST", waybill: "AD1" }],
    { apiUrl: "https://api", query: async () => { throw new Error("503"); } });

  assert.equal(dopisanych, 0);
  const w = d.prepare("SELECT dostarczono_at FROM zwrot_klienta WHERE id=?")
    .get(id) as { dostarczono_at: string | null };
  assert.equal(w.dostarczono_at, null, "brak danych zostaje brakiem, nie zerem");
});

test("partie idą PO PRZEWOŹNIKU i po dwadzieścia numerów", async () => {
  const d = stanowisko();
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta").get() as { id: number }).id);
  const paczki = [
    ...Array.from({ length: 21 }, (_, i) => ({ zwrotId: id, carrierId: "INPOST", waybill: `A${i}` })),
    { zwrotId: id, carrierId: "DPD", waybill: "D1" },
  ];
  const adresy: string[] = [];
  await uzupelnijDoreczenia(d, paczki, {
    apiUrl: "https://api",
    query: async (u) => { adresy.push(u); return { waybills: [] }; },
  });

  assert.equal(adresy.length, 3, "21 InPostów to dwie partie, DPD to trzecia");
  assert.equal(adresy.filter((u) => u.includes("/INPOST/")).length, 2);
  assert.equal(adresy.filter((u) => u.includes("/DPD/")).length, 1);
});

/* ── Wspólne odpytanie dla zwrotów i dosyłki (0.536.0) ──────────────────────
   Jedna droga do końcówki trackingu, dwie polityki przy 429: zwroty idą
   dalej jak przed wydzieleniem, dosyłka oddaje limit taktowi. */

test("odpytanie oddaje stan po numerze; partia, która padła, nie ma wpisu", async () => {
  const stany = await odpytajTracking(async (u) => {
    if (u.includes("/DPD/")) throw new Error("503");
    return { waybills: [historia([{ occurredAt: "2026-08-24T10:41:00Z", code: "DELIVERED" }]),
      { waybill: "AD2", trackingDetails: null }] };
  }, "https://api", [{ carrierId: "INPOST", waybill: "AD1" }, { carrierId: "INPOST", waybill: "AD2" },
    { carrierId: "DPD", waybill: "D1" }]);
  assert.deepEqual(stany.get("AD1"),
    { dostarczonoAt: "2026-08-24T10:41:00Z", status: "DELIVERED", ostatnioAt: "2026-08-24T10:41:00Z" });
  assert.deepEqual(stany.get("AD2"), { dostarczonoAt: null, status: null, ostatnioAt: null },
    "„przewoźnik nic nie wie” to wpis — pytanie doszło");
  assert.equal(stany.has("D1"), false, "„nie udało się zapytać” to brak wpisu");
});

test("dziennik błędu trackingu: przewoźnik i kod HTTP, nigdy treść odpowiedzi Allegro", async () => {
  /* `BladOdpowiedziAllegro` niesie w komunikacie do 300 znaków ciała
     odpowiedzi — a ta bywa czymkolwiek, także adresem odbiorcy. */
  const ostrzezenia: unknown[] = [];
  const warn = console.warn;
  console.warn = (...x: unknown[]) => { ostrzezenia.push(x); };
  try {
    await odpytajTracking(async (u) => {
      if (u.includes("/DPD/")) throw new BladOdpowiedziAllegro("Allegro odpowiedziało 400: {\"adres\":\"ul. Tajna 1\"}", 400);
      throw new Error("Brak połączenia z Allegro (https://api) — fetch failed: ul. Tajna 2");
    }, "https://api", [{ carrierId: "DPD", waybill: "D1" }, { carrierId: "INPOST", waybill: "AD1" }]);
  } finally { console.warn = warn; }
  const log = JSON.stringify(ostrzezenia);
  assert.doesNotMatch(log, /Tajna|fetch failed/, "treść błędu nie trafia do logu");
  assert.match(log, /DPD: pytanie o 1 numer\(y\) nie doszło \(HTTP 400\)/);
  assert.match(log, /INPOST: pytanie o 1 numer\(y\) nie doszło \(bez odpowiedzi\)/);
});

test("dosyłka: partia, która padła, idzie jeszcze raz numer po numerze; zwroty — nie", async () => {
  /* Jeden źle wpisany numer potrafi wywrócić całą partię u przewoźnika. */
  const adresy: string[] = [];
  const query = async (u: string) => {
    adresy.push(u);
    if (u.includes("ZLY")) throw new BladOdpowiedziAllegro("Allegro odpowiedziało 400: zły numer", 400);
    return { waybills: new URL(u).searchParams.getAll("waybill").map((waybill) => ({ waybill, trackingDetails: null })) };
  };
  const paczki = [{ carrierId: "DPD", waybill: "D1" }, { carrierId: "DPD", waybill: "ZLY" },
    { carrierId: "DPD", waybill: "D2" }];
  const warn = console.warn;
  console.warn = () => {};
  try {
    const dosylka = await odpytajTracking(query, "https://api", paczki, { limitWyzej: true, pojedynczoPoBledzie: true });
    assert.deepEqual([dosylka.has("D1"), dosylka.has("ZLY"), dosylka.has("D2")], [true, false, true]);
    assert.equal(adresy.length, 4, "partia plus trzy pojedyncze pytania");
    adresy.length = 0;
    const zwroty = await odpytajTracking(query, "https://api", paczki);
    assert.deepEqual([zwroty.size, adresy.length], [0, 1], "zwroty zachowują się jak przed wydaniem");
  } finally { console.warn = warn; }
  /* 429 w pojedynczym pytaniu dalej idzie wyżej. */
  let n = 0;
  await assert.rejects(odpytajTracking(async () => {
    n++;
    if (n === 1) throw new BladOdpowiedziAllegro("Allegro odpowiedziało 400", 400);
    throw new BladLimituAllegro("limit", 900_000);
  }, "https://api", paczki, { limitWyzej: true, pojedynczoPoBledzie: true }), BladLimituAllegro);
});

test("429: zwroty idą dalej, dosyłka oddaje limit wyżej", async () => {
  const paczki = [{ carrierId: "INPOST", waybill: "AD1" }, { carrierId: "DPD", waybill: "D1" }];
  const adresy: string[] = [];
  const query = async (u: string) => {
    adresy.push(u);
    if (u.includes("/INPOST/")) throw new BladLimituAllegro("limit", 900_000);
    return { waybills: [] };
  };
  const stany = await odpytajTracking(query, "https://api", paczki);
  assert.deepEqual([adresy.length, stany.has("D1")], [2, true], "bez flagi — jak przed wydzieleniem");
  adresy.length = 0;
  await assert.rejects(odpytajTracking(query, "https://api", paczki, { limitWyzej: true }), BladLimituAllegro);
  assert.equal(adresy.length, 1, "po limicie dalsze partie tylko przedłużałyby blokadę");

  /* Zwroty z 429 w środku przebiegu: przebieg się nie wywraca. */
  const d = stanowisko();
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta").get() as { id: number }).id);
  assert.equal(await uzupelnijDoreczenia(d, [{ zwrotId: id, carrierId: "INPOST", waybill: "AD1" }],
    { apiUrl: "https://api", query }), 0);
});
