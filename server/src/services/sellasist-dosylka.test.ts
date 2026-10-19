import { test } from "node:test";
import assert from "node:assert/strict";

process.env.STREFA_CZASU = "Europe/Warsaw";
const { przesylkiDosylkiSellasist } = await import("./sellasist-dosylka.js");

/* ── Numer dosyłki z Sellasist ───────────────────────────────────────────────
   Etykieta dosyłki stoi przy oryginale albo przy KOPII zamówienia. Kopia to
   zamówienie kupującego po zgłoszeniu zwrotu z `copied_order_id` oryginału.
   Inne jego zamówienia nie są dosyłką i ich etykiet nie zbieramy. */

const zam = (id: number, n: Record<string, unknown> = {}) => ({
  id, is_copied: "0", external_data: { external_id: "allegro-1", external_login: "kl" }, carts: [], shipments: [], ...n,
});

function atrapa(odp: Record<string, unknown>) {
  const wolania: string[] = [];
  return {
    wolania,
    query: async (s: string) => {
      wolania.push(s);
      const k = Object.keys(odp).find((p) => s.startsWith(p));
      if (k === undefined) throw new Error(`niezapowiedziane: ${s}`);
      return odp[k];
    },
  };
}

test("etykiety oryginału i kopii z datą; cudze zamówienie kupującego odpada", async () => {
  const a = atrapa({
    "/orders?external_id=": [{ id: 10 }],
    "/orders?external_user=kl&date_from=2026-09-22%2012%3A00%3A00": [{ id: 10 }, { id: 11 }, { id: 12 }],
    "/orders/10": zam(10, { shipments: [{ ordershipment_id: 3, service: "DPD", tracking_number: "ORYG" }] }),
    "/orders/11": zam(11, { is_copied: "1", copied_order_id: 10, external_data: {},
      shipments: [{ ordershipment_id: 4, service: "InPost Paczkomaty", tracking_number: "KOPIA" }] }),
    "/orders/12": zam(12, { external_data: { external_id: "allegro-2" },
      shipments: [{ service: "DPD", tracking_number: "CUDZE" }] }),
    "/ordersshipments?order_id=10": [{ tracking_number: "ORYG", created_date: "2026-09-10 12:00:00" }],
    "/ordersshipments?order_id=11": [{ tracking_number: "KOPIA", created_date: "2026-09-28 10:30:00" }],
  });
  const p = await przesylkiDosylkiSellasist("allegro-1", "kl", "2026-09-22T10:00:00.000Z", a.query);
  assert.deepEqual(p.sort((x, y) => x.waybill.localeCompare(y.waybill)), [
    { waybill: "KOPIA", carrierId: "INPOST", createdAt: "2026-09-28T08:30:00.000Z" },
    { waybill: "ORYG", carrierId: "DPD", createdAt: "2026-09-10T10:00:00.000Z" },
  ]);
  assert.ok(!a.wolania.some((s) => s.includes("order_id=12")), "o etykiety cudzego zamówienia nie pytamy");
});

test("Sellasist nie zna zamówienia — pusta lista po jednym żądaniu", async () => {
  const a = atrapa({ "/orders?external_id=": [] });
  assert.deepEqual(await przesylkiDosylkiSellasist("allegro-9", "kl", "2026-09-22T10:00:00.000Z", a.query), []);
  assert.equal(a.wolania.length, 1);
});

test("numer ze szczegółu bez listu przewozowego zostaje bez daty", async () => {
  const a = atrapa({
    "/orders?external_id=": [{ id: 10 }],
    "/orders?external_user=": [],
    "/orders/10": zam(10, { shipments: [{ service: "GLS", tracking_number: "BEZ-DATY" }] }),
    "/ordersshipments": [],
  });
  assert.deepEqual(await przesylkiDosylkiSellasist("allegro-1", "kl", "2026-09-22T10:00:00.000Z", a.query),
    [{ waybill: "BEZ-DATY", carrierId: "GLS", createdAt: null }]);
});

test("etykieta z nowego serwisu wysyłek: numer bez daty i bez pytania o listę przewozową", async () => {
  const a = atrapa({
    "/orders?external_id=": [{ id: 10 }],
    "/orders?external_user=": [],
    "/orders/10": zam(10, { shipments: [{ ordershipment_id: 0, service: "allegroOneBox", tracking_number: "A00BOX" }] }),
  });
  assert.deepEqual(await przesylkiDosylkiSellasist("allegro-1", "kl", "2026-09-22T10:00:00.000Z", a.query),
    [{ waybill: "A00BOX", carrierId: "ALLEGRO", createdAt: null }]);
  assert.ok(!a.wolania.some((w) => w.startsWith("/ordersshipments")));
});
