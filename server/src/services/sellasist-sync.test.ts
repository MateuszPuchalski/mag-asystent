import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sellasist-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.STREFA_CZASU = "Europe/Warsaw";

/* ── Lustro zamówień Sellasist ───────────────────────────────────────────────
   Pilnujemy:
   - kursor dziennika: wpis z tej samej sekundy i niższym numerem nie wraca,
     strona pełna ciągnie następną, a kursor stoi nawet przy błędzie szczegółu;
   - szczegół: lustro bez adresów, etykieta z datą z listy przewozowej, 404
     kasuje zamówienie z lustra;
   - zebrane: status z ustawienia (z dziennika albo ze szczegółu), bez
     ustawienia pierwsza etykieta; daty nie przesuwają się w przód;
   - zbiórki: pozycje zebranych zamówień idą do `zbiorka` po numerze koszyka,
     a wiersz z pliku wygrywa;
   - 429 idzie wyżej, inny błąd zabiera jedno zamówienie, a po pięciu
     próbach zamówienie wypada z kolejki. */

let db: typeof import("../db/db.js").db;
let S: typeof import("./sellasist-sync.js");
let BladLimituSellasist: typeof import("../adapters/sellasist.http.js").BladLimituSellasist;
let BladSellasist: typeof import("../adapters/sellasist.http.js").BladSellasist;

const TERAZ = new Date("2026-10-13T10:00:00Z"); // wtorek, 12:00 w magazynie

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./sellasist-sync.js");
  ({ BladLimituSellasist, BladSellasist } = await import("../adapters/sellasist.http.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["sellasist_pozycja", "sellasist_przesylka", "sellasist_zamowienie", "sellasist_do_pobrania",
    "sellasist_sync_state", "sellasist_pomylka_zlapana", "zbiorka", "sgt_towar", "events"]) d.exec(`DELETE FROM ${t}`);
  d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean) VALUES (?,?,?,?)").run(11, "NOZ-01", "Nóż", "5901");
});

function zamowienie(id: number, nadpisz: Record<string, unknown> = {}) {
  return {
    id, is_copied: "0", date: "2026-10-12 09:00:00", last_status_change: "2026-10-13 09:30:00",
    status: { id: 2, name: "W realizacji" },
    external_data: { external_id: `allegro-${id}`, external_login: "Ogrodnik_77" },
    source: "allegro", email: "x@example.com",
    shipment_address: { street: "Dostawcza", city: "Wieliczka" },
    carts: [{ id: id * 10, symbol: "NOZ-01", ean: "", name: "Nóż", quantity: 2, quantityMissing: 0 },
      { id: id * 10 + 1, symbol: "OBCY", ean: "", name: "Spoza kartoteki", quantity: 1, quantityMissing: 1 }],
    shipments: [],
    ...nadpisz,
  };
}

type Odp = unknown | ((sciezka: string) => unknown);
/** Atrapa Sellasist: ścieżka (bez zapytania albo z nim) → odpowiedź. Niezapowiedziana ścieżka to błąd testu. */
function atrapa(odpowiedzi: Record<string, Odp>) {
  const wolania: string[] = [];
  const query = async (sciezka: string) => {
    wolania.push(sciezka);
    const klucz = sciezka in odpowiedzi ? sciezka : sciezka.split("?")[0];
    if (!(klucz in odpowiedzi)) throw new Error(`niezapowiedziane: ${sciezka}`);
    const o = odpowiedzi[klucz];
    return typeof o === "function" ? (o as (s: string) => unknown)(sciezka) : o;
  };
  return { query, wolania };
}

const przebieg = (query: (s: string) => Promise<unknown>, statusyZebrane: number[] = [], statusyPomylka: number[] = []) =>
  S.synchronizujSellasist(db(), { query, teraz: () => TERAZ, statusyZebrane, statusyPomylka });

test("pierwszy przebieg: dziennik dwa dni wstecz, szczegół do lustra bez adresów", async () => {
  const a = atrapa({
    "/orders_logs": [{ id: 5, order_id: 100, operation_tag: "order_create", date: "2026-10-13 09:00:00" }],
    "/orders/100": zamowienie(100),
  });
  const w = await przebieg(a.query);
  assert.deepEqual(w, { zmian: 1, pobranych: 1, zbiorek: 0 });
  assert.match(a.wolania[0], /date_from=2026-10-11%2012%3A00%3A00/);
  const z = db().prepare("SELECT * FROM sellasist_zamowienie WHERE id = 100").get() as Record<string, unknown>;
  assert.equal(z.external_id, "allegro-100");
  assert.equal(z.kupujacy_login, "Ogrodnik_77");
  assert.equal(z.status_nazwa, "W realizacji");
  assert.equal(z.zebrano_at, null);
  assert.ok(!JSON.stringify(z).includes("Dostawcza"));
  const s = db().prepare("SELECT kursor_at, kursor_id, blad FROM sellasist_sync_state").get() as Record<string, unknown>;
  assert.deepEqual({ ...s }, { kursor_at: "2026-10-13T07:00:00.000Z", kursor_id: 5, blad: null });
});

test("kursor: wpis z tej samej sekundy i niższym numerem nie wraca do kolejki", async () => {
  db().prepare("INSERT INTO sellasist_sync_state(id, kursor_at, kursor_id) VALUES (1, ?, 5)")
    .run("2026-10-13T07:00:00.000Z");
  const a = atrapa({
    "/orders_logs": [
      { id: 4, order_id: 99, operation_tag: "order_edit", date: "2026-10-13 09:00:00" },
      { id: 5, order_id: 100, operation_tag: "order_edit", date: "2026-10-13 09:00:00" },
      { id: 6, order_id: 101, operation_tag: "order_edit", date: "2026-10-13 09:00:00" },
    ],
    "/orders/101": zamowienie(101),
  });
  const w = await przebieg(a.query);
  assert.equal(w.zmian, 1);
  assert.ok(!a.wolania.includes("/orders/99") && !a.wolania.includes("/orders/100"));
});

test("pełna strona dziennika ciągnie następną z tym samym date_from", async () => {
  const strona = (od: number) => Array.from({ length: 100 }, (_, i) =>
    ({ id: od + i, order_id: 500, operation_tag: "order_edit", date: "2026-10-13 09:00:00" }));
  const a = atrapa({
    "/orders_logs": (s: string) => (s.endsWith("offset=0") ? strona(1) : strona(101).slice(0, 3)),
    "/orders/500": zamowienie(500),
  });
  const w = await przebieg(a.query);
  assert.equal(w.zmian, 103);
  const dz = a.wolania.filter((s) => s.startsWith("/orders_logs"));
  assert.equal(dz.length, 2);
  assert.equal(dz[0].split("&offset")[0], dz[1].split("&offset")[0]);
});

test("etykieta: data z listy przewozowej, pierwsza etykieta to dzień zebrania i spakowania", async () => {
  const a = atrapa({
    "/orders_logs": [{ id: 7, order_id: 200, operation_tag: "order_edit", date: "2026-10-13 11:00:00" }],
    "/orders/200": zamowienie(200, { shipments: [{ ordershipment_id: 1, service: "DPD Polska", tracking_number: "DPD1" }] }),
    "/ordersshipments": [{ tracking_number: "DPD1", created_date: "2026-10-13 10:15:00", file: "JVBER" }],
  });
  const w = await przebieg(a.query);
  assert.equal(w.zbiorek, 2);
  const z = db().prepare("SELECT zebrano_at, spakowano_at FROM sellasist_zamowienie WHERE id = 200")
    .get() as Record<string, unknown>;
  assert.deepEqual({ ...z }, { zebrano_at: "2026-10-13T08:15:00.000Z", spakowano_at: "2026-10-13T08:15:00.000Z" });
  const p = db().prepare("SELECT waybill, przewoznik, utworzono_at FROM sellasist_przesylka").get() as Record<string, unknown>;
  assert.deepEqual({ ...p }, { waybill: "DPD1", przewoznik: "DPD", utworzono_at: "2026-10-13T08:15:00.000Z" });
  const zb = db().prepare("SELECT koszyk_id, tw_id, data, ilosc FROM zbiorka ORDER BY koszyk_id").all();
  assert.deepEqual(zb.map((r) => ({ ...r })), [
    { koszyk_id: 2000, tw_id: 11, data: "2026-10-13", ilosc: 2 },
    { koszyk_id: 2001, tw_id: null, data: "2026-10-13", ilosc: 1 },
  ]);
  const e = db().prepare("SELECT type, payload FROM events WHERE type = 'zbiorki_z_sellasist'").get() as Record<string, unknown>;
  assert.deepEqual(JSON.parse(String(e.payload)), { nowych: 2 });
});

test("znana etykieta z datą nie pyta drugi raz o listę przewozową", async () => {
  const odp = {
    "/orders_logs": [{ id: 7, order_id: 200, operation_tag: "order_edit", date: "2026-10-13 11:00:00" }],
    "/orders/200": zamowienie(200, { shipments: [{ ordershipment_id: 1, service: "DPD", tracking_number: "DPD1" }] }),
    "/ordersshipments": [{ tracking_number: "DPD1", created_date: "2026-10-13 10:15:00" }],
  };
  await przebieg(atrapa(odp).query);
  db().exec("DELETE FROM sellasist_sync_state");
  const a = atrapa({ ...odp, "/orders_logs": [{ id: 8, order_id: 200, operation_tag: "order_edit",
    date: "2026-10-13 11:30:00" }] });
  await przebieg(a.query);
  assert.ok(!a.wolania.some((s) => s.startsWith("/ordersshipments")));
});

test("zebrane statusem z dziennika wygrywa z etykietą, a późniejsza data nie przesuwa wcześniejszej", async () => {
  const a = atrapa({
    "/orders_logs": [{ id: 9, order_id: 300, operation_tag: "order_status_change", object_id: 5,
      date: "2026-10-12 16:00:00" }],
    "/orders/300": zamowienie(300, { status: { id: 6, name: "Spakowane" },
      shipments: [{ ordershipment_id: 1, service: "InPost", tracking_number: "IN1" }] }),
    "/ordersshipments": [{ tracking_number: "IN1", created_date: "2026-10-13 08:00:00" }],
  });
  await przebieg(a.query, [5]);
  const z = () => ({ ...(db().prepare("SELECT zebrano_at, spakowano_at FROM sellasist_zamowienie WHERE id = 300")
    .get() as Record<string, unknown>) });
  assert.deepEqual(z(), { zebrano_at: "2026-10-12T14:00:00.000Z", spakowano_at: "2026-10-13T06:00:00.000Z" });
  assert.equal((db().prepare("SELECT data FROM zbiorka WHERE koszyk_id = 3000").get() as { data: string }).data,
    "2026-10-12");

  /* Nowa etykieta dzień później — dzień spakowania zostaje wtorkowy. */
  const b = atrapa({
    "/orders_logs": [{ id: 10, order_id: 300, operation_tag: "order_edit", date: "2026-10-13 11:00:00" }],
    "/orders/300": zamowienie(300, { shipments: [{ ordershipment_id: 1, service: "InPost", tracking_number: "IN2" }] }),
    "/ordersshipments": [{ tracking_number: "IN2", created_date: "2026-10-14 08:00:00" }],
  });
  await przebieg(b.query, [5]);
  assert.deepEqual(z(), { zebrano_at: "2026-10-12T14:00:00.000Z", spakowano_at: "2026-10-13T06:00:00.000Z" });
});

test("zebrane statusem ze szczegółu, gdy dziennika o tym nie było", async () => {
  const a = atrapa({
    "/orders_logs": [{ id: 11, order_id: 301, operation_tag: "order_edit", date: "2026-10-13 11:00:00" }],
    "/orders/301": zamowienie(301, { status: { id: 5, name: "Zebrane" } }),
  });
  await przebieg(a.query, [5]);
  assert.equal((db().prepare("SELECT zebrano_at FROM sellasist_zamowienie WHERE id = 301").get() as
    { zebrano_at: string }).zebrano_at, "2026-10-13T07:30:00.000Z");
});

test("wiersz zbiórki z pliku wygrywa — API go nie nadpisuje", async () => {
  db().prepare("INSERT INTO zbiorka(koszyk_id, tw_id, symbol_csv, data, ilosc) VALUES (2000, 11, 'NOZ-01', '2026-10-01', 2)").run();
  await przebieg(atrapa({
    "/orders_logs": [{ id: 7, order_id: 200, operation_tag: "order_edit", date: "2026-10-13 11:00:00" }],
    "/orders/200": zamowienie(200, { shipments: [{ ordershipment_id: 1, service: "DPD", tracking_number: "DPD1" }] }),
    "/ordersshipments": [{ tracking_number: "DPD1", created_date: "2026-10-13 10:15:00" }],
  }).query);
  assert.equal((db().prepare("SELECT data FROM zbiorka WHERE koszyk_id = 2000").get() as { data: string }).data,
    "2026-10-01");
});

test("404 kasuje zamówienie z lustra razem z pozycjami", async () => {
  await przebieg(atrapa({
    "/orders_logs": [{ id: 7, order_id: 400, operation_tag: "order_create", date: "2026-10-13 11:00:00" }],
    "/orders/400": zamowienie(400),
  }).query);
  await przebieg(atrapa({
    "/orders_logs": [{ id: 8, order_id: 400, operation_tag: "order_delete", date: "2026-10-13 11:05:00" }],
    "/orders/400": null,
  }).query);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM sellasist_zamowienie").get()!.n, 0);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM sellasist_pozycja").get()!.n, 0);
});

test("błąd szczegółu zabiera jedno zamówienie; kursor stoi, po pięciu próbach wypada", async () => {
  const odp = {
    "/orders_logs": [
      { id: 1, order_id: 600, operation_tag: "order_edit", date: "2026-10-13 11:00:00" },
      { id: 2, order_id: 601, operation_tag: "order_edit", date: "2026-10-13 11:00:01" },
    ],
    "/orders/600": () => { throw new BladSellasist("Sellasist odpowiedział błędem (500).", 500); },
    "/orders/601": zamowienie(601),
  };
  const w = await przebieg(atrapa(odp).query);
  assert.equal(w.pobranych, 1);
  assert.equal((db().prepare("SELECT kursor_id FROM sellasist_sync_state").get() as { kursor_id: number }).kursor_id, 2);
  for (let i = 0; i < 4; i++) await przebieg(atrapa({ ...odp, "/orders_logs": [] }).query);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM sellasist_do_pobrania").get()!.n, 0);
});

test("429 idzie wyżej i zostaje w stanie jako stałe zdanie", async () => {
  const a = atrapa({ "/orders_logs": () => { throw new BladLimituSellasist("Sellasist prosi o przerwę (429).", 5000); } });
  await assert.rejects(przebieg(a.query), BladLimituSellasist);
  const s = db().prepare("SELECT blad, blad_kod, last_attempt_at FROM sellasist_sync_state").get() as Record<string, unknown>;
  assert.deepEqual({ ...s }, { blad: "Sellasist prosi o przerwę (429).", blad_kod: 429,
    last_attempt_at: TERAZ.toISOString() });
});

test("stan przed pierwszym udanym przebiegiem nie ma dób — brak danych to nie zero", () => {
  assert.deepEqual(S.stanSellasist(db(), true, TERAZ).dni, []);
});

test("stan dla panelu: siedem dób magazynu, zamówienia zebrane i spakowane", async () => {
  await przebieg(atrapa({
    "/orders_logs": [{ id: 7, order_id: 200, operation_tag: "order_edit", date: "2026-10-13 11:00:00" }],
    "/orders/200": zamowienie(200, { shipments: [{ ordershipment_id: 1, service: "DPD", tracking_number: "DPD1" }] }),
    "/ordersshipments": [{ tracking_number: "DPD1", created_date: "2026-10-13 10:15:00" }],
  }).query);
  /* Lustro ruszyło dziś, więc doby sprzed dziś nie istnieją — nie są zerami. */
  const s = S.stanSellasist(db(), true, TERAZ);
  assert.deepEqual(s.dni, [{ data: "2026-10-13", zebranych: 1, spakowanych: 1 }]);
  db().prepare("UPDATE sellasist_sync_state SET pierwszy_sukces_at = '2026-10-01T00:00:00.000Z'").run();
  const tydzien = S.stanSellasist(db(), true, TERAZ);
  assert.equal(tydzien.dni.length, 7);
  assert.equal(tydzien.dni[0].data, "2026-10-07");
  assert.equal(s.blad, null);
  assert.equal(s.wKolejce, 0);
});

test("odświeżenie na żądanie: zamówienia numeru źródła do lustra, błąd degraduje", async () => {
  const a = atrapa({
    "/orders?external_id=allegro-700&limit=100": [{ id: 700 }],
    "/orders/700": zamowienie(700),
  });
  assert.equal(await S.odswiezZamowienieSellasist(db(), "allegro-700", { query: a.query, teraz: () => TERAZ }), true);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM sellasist_zamowienie WHERE id = 700").get()!.n, 1);
  const b = atrapa({ "/orders": () => { throw new BladSellasist("x", 500); } });
  assert.equal(await S.odswiezZamowienieSellasist(db(), "allegro-701", { query: b.query }), false);
});

test("etykieta z nowego serwisu wysyłek (ordershipment_id 0): bez pytania o pustą listę, dzień z chwili odczytu", async () => {
  const a = atrapa({
    "/orders_logs": [{ id: 7, order_id: 210, operation_tag: "order_edit", date: "2026-10-13 11:00:00" }],
    "/orders/210": zamowienie(210, { shipments: [{ ordershipment_id: 0, service: "allegroOneBox",
      tracking_number: "A00BOX1" }] }),
  });
  await przebieg(a.query);
  assert.ok(!a.wolania.some((w) => w.startsWith("/ordersshipments")), "pusta lista nie kosztuje żądania");
  const z = db().prepare("SELECT spakowano_at FROM sellasist_zamowienie WHERE id = 210").get() as { spakowano_at: string };
  assert.equal(z.spakowano_at, TERAZ.toISOString());
  const prz = db().prepare("SELECT przewoznik, utworzono_at FROM sellasist_przesylka WHERE zamowienie_id = 210").get();
  assert.deepEqual({ ...prz }, { przewoznik: "ALLEGRO", utworzono_at: null });
});

/* ── Pomyłki złapane przy pakowaniu ─────────────────────────────────────── */

test("wejście w status pomyłki liczy się raz na wpis dziennika — drugie wejście to druga pomyłka", async () => {
  const wpisy = [
    { id: 20, order_id: 800, operation_tag: "order_status_change", object_id: 30, date: "2026-10-13 09:00:00" },
    { id: 21, order_id: 800, operation_tag: "order_status_change", object_id: 13, date: "2026-10-13 09:05:00" },
    { id: 22, order_id: 800, operation_tag: "order_status_change", object_id: 30, date: "2026-10-13 09:20:00" },
    { id: 23, order_id: 801, operation_tag: "order_edit", object_id: 30, date: "2026-10-13 09:30:00" },
  ];
  await przebieg(atrapa({ "/orders_logs": wpisy, "/orders/800": zamowienie(800), "/orders/801": zamowienie(801) }).query,
    [], [30]);
  /* Ten sam dziennik drugi raz (kursor cofnięty) niczego nie dubluje. */
  db().exec("DELETE FROM sellasist_sync_state");
  await przebieg(atrapa({ "/orders_logs": wpisy, "/orders/800": zamowienie(800), "/orders/801": zamowienie(801) }).query,
    [], [30]);
  const w = db().prepare("SELECT log_id, zamowienie_id, at FROM sellasist_pomylka_zlapana ORDER BY log_id").all();
  assert.deepEqual(w.map((r) => ({ ...r })), [
    { log_id: 20, zamowienie_id: 800, at: "2026-10-13T07:00:00.000Z" },
    { log_id: 22, zamowienie_id: 800, at: "2026-10-13T07:20:00.000Z" },
  ], "edycja zamówienia z tym samym numerem obiektu to nie zmiana statusu");
});

test("bez ustawionego statusu pomyłki nic się nie liczy", async () => {
  await przebieg(atrapa({ "/orders_logs": [{ id: 20, order_id: 800, operation_tag: "order_status_change",
    object_id: 30, date: "2026-10-13 09:00:00" }], "/orders/800": zamowienie(800) }).query);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM sellasist_pomylka_zlapana").get()!.n, 0);
});

test("złapane na dobę: wyłączone i przed pierwszym przebiegiem puste, potem doby od startu lustra", () => {
  assert.deepEqual(S.zlapanePomylki(db(), false, TERAZ), { wlaczone: false, dni: [], razem: 0 });
  assert.deepEqual(S.zlapanePomylki(db(), true, TERAZ), { wlaczone: true, dni: [], razem: 0 },
    "przed pierwszym udanym przebiegiem nie ma dób — brak danych to nie zero");
  db().prepare("INSERT INTO sellasist_sync_state(id, pierwszy_sukces_at) VALUES (1, '2026-10-11T10:00:00.000Z')").run();
  const ins = db().prepare("INSERT INTO sellasist_pomylka_zlapana(log_id, zamowienie_id, at) VALUES (?,?,?)");
  ins.run(1, 1, "2026-10-11T08:00:00.000Z");
  ins.run(2, 2, "2026-10-13T07:00:00.000Z");
  ins.run(3, 3, "2026-10-13T08:00:00.000Z");
  /* 12 października 22:30 UTC to już 13 października w magazynie. */
  ins.run(4, 4, "2026-10-12T22:30:00.000Z");
  const z = S.zlapanePomylki(db(), true, TERAZ);
  assert.deepEqual(z.dni, [
    { data: "2026-10-11", zlapanych: 1 }, { data: "2026-10-12", zlapanych: 0 }, { data: "2026-10-13", zlapanych: 3 },
  ]);
  assert.equal(z.razem, 4);
});
