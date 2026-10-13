import { after, test } from "node:test";
import assert from "node:assert/strict";

process.env.STREFA_CZASU = "Europe/Warsaw";
process.env.SELLASIST_KONTO = "firma";
process.env.SELLASIST_API_KEY = "klucz-testowy-123";

const S = await import("./sellasist.http.js");
const { BladLimitu } = await import("./limit.js");

/* ── Sellasist HTTP: połączenie i mapowanie ──────────────────────────────────
   Pilnujemy trzech rzeczy:
   - z zamówienia przechodzi z kupującego wyłącznie login — adres z faktury,
     adres dostawy, e-mail, NIP i telefon nie mają czym przejść;
   - daty Sellasist (czas konta, bez strefy) lądują w UTC;
   - klucz idzie nagłówkiem `apiKey` i nie trafia do żadnego komunikatu.
   Fixtura stoi na polach ze schematu `docs/sellasist/api.yaml` (`GET
   /orders/{order_id}`), nie na wyobrażeniu odpowiedzi. */

const ZAMOWIENIE = {
  id: 1025, is_copied: "0", copied_order_id: 0, creator: "sklep", date: "2026-07-29 08:45:00",
  last_status_change: "2026-07-29 12:00:00", deadline: "2026-07-30",
  status: { id: 4, name: "Spakowane" },
  external_data: { external_id: "29a1c2b0-0000-11ef-9a00-1234567890ab", external_login: "Ogrodnik_77",
    external_user_id: "4455", external_account: 1 },
  source: "allegro", email: "kupujacy@example.com", tracking_number: "",
  bill_address: { name: "Jan", surname: "Kowalski", street: "Fakturowa", home_number: "7", city: "Kraków",
    postcode: "30-001", phone: "600700800", company_nip: "9876543219" },
  shipment_address: { name: "Jan", surname: "Kowalski", street: "Dostawcza", home_number: "9",
    city: "Wieliczka", postcode: "32-020", phone: "600700800" },
  carts: [
    { id: 142393, symbol: "NOZ-01", ean: "5901234123457", name: "Nóż do kosiarki", quantity: 2, quantityMissing: 0 },
    { id: 142394, symbol: "PAS-9", ean: "", name: "Pasek", quantity: 1, quantityMissing: 1 },
    { name: "pozycja bez numeru koszyka", quantity: 1 },
  ],
  shipments: [{ ordershipment_id: 7, service: "InPost Paczkomaty", tracking_number: "6032, 6033" },
    { ordershipment_id: 8, service: "Kurier XYZ", tracking_number: "XYZ1" }],
};

test("zamówienie: z kupującego wyłącznie login, adresów i e-maila nie ma w wyniku", () => {
  const z = S.mapujZamowienie(ZAMOWIENIE)!;
  const tekst = JSON.stringify(z);
  for (const zakazane of ["Kowalski", "Fakturowa", "Dostawcza", "600700800", "9876543219", "example.com", "Wieliczka"]) {
    assert.ok(!tekst.includes(zakazane), `mapowanie przepuściło ${zakazane}`);
  }
  assert.equal(z.login, "Ogrodnik_77");
  assert.equal(z.externalId, "29a1c2b0-0000-11ef-9a00-1234567890ab");
});

test("zamówienie: daty w UTC, termin-dzień zostaje dniem, oryginał nie jest kopią", () => {
  const z = S.mapujZamowienie(ZAMOWIENIE)!;
  assert.equal(z.utworzonoAt, "2026-07-29T06:45:00.000Z");
  assert.equal(z.statusAt, "2026-07-29T10:00:00.000Z");
  assert.equal(z.termin, "2026-07-30");
  assert.equal(z.skopiowaneZ, null);
  assert.equal(S.mapujZamowienie({ ...ZAMOWIENIE, is_copied: "1", copied_order_id: 1000 })!.skopiowaneZ, 1000);
});

test("zamówienie: pozycje bez numeru koszyka odpadają, brak liczy się z quantityMissing", () => {
  const z = S.mapujZamowienie(ZAMOWIENIE)!;
  assert.deepEqual(z.pozycje.map((p) => [p.koszykId, p.symbol, p.ilosc, p.brakuje]),
    [[142393, "NOZ-01", 2, 0], [142394, "PAS-9", 1, 1]]);
  assert.equal(z.pozycje[1].ean, null);
});

test("zamówienie: numery połączone przecinkiem to osobne paczki, przewoźnik z nazwy usługi", () => {
  const z = S.mapujZamowienie(ZAMOWIENIE)!;
  assert.deepEqual(z.przesylki.map((p) => [p.waybill, p.przewoznik]),
    [["6032", "INPOST"], ["6033", "INPOST"], ["XYZ1", "OTHER"]]);
});

test("zamówienie bez numeru i odpowiedź nie-obiekt to null, nie wymyślony wiersz", () => {
  assert.equal(S.mapujZamowienie({ ...ZAMOWIENIE, id: undefined }), null);
  assert.equal(S.mapujZamowienie([ZAMOWIENIE]), null);
  assert.equal(S.mapujZamowienie(null), null);
});

test("przewoźnik: znane nazwy na carrierId Allegro, reszta OTHER", () => {
  assert.equal(S.przewoznikAllegro("DPD Polska"), "DPD");
  assert.equal(S.przewoznikAllegro("Pocztex Kurier48"), "POCZTA_POLSKA");
  assert.equal(S.przewoznikAllegro("Allegro One Box"), "ALLEGRO");
  assert.equal(S.przewoznikAllegro(null), "OTHER");
});

test("dziennik: bez numeru pracownika, wpis bez zamówienia odpada", () => {
  const w = S.mapujDziennik([
    { id: 121, order_id: 56, operation_tag: "order_status_change", object_id: 4, date: "2026-07-20 17:13:55", user_id: 2 },
    { id: 122, operation_tag: "order_edit" },
  ]);
  assert.deepEqual(w, [{ id: 121, zamowienieId: 56, tag: "order_status_change", obiekt: 4,
    at: "2026-07-20T15:13:55.000Z" }]);
  assert.ok(!JSON.stringify(w).includes("user"));
});

test("listy przewozowe: data w UTC, plik etykiety nie przechodzi", () => {
  const l = S.mapujListyPrzewozowe([{ id: 1, order_id: 56, tracking_number: "6032", created_date: "2026-07-20 15:20:07",
    file: "JVBERi0xLjQK" }]);
  assert.deepEqual(l, [{ waybill: "6032", utworzonoAt: "2026-07-20T13:20:07.000Z" }]);
});

test("ścieżki: wartości kodowane, adres z konta", () => {
  assert.equal(S.apiUrlSellasist(), "https://firma.sellasist.pl/api/v1");
  assert.equal(S.sciezkaZamowienPoNumerze("a/b c"), "/orders?external_id=a%2Fb%20c&limit=100");
  assert.match(S.sciezkaDziennika("2026-10-13 08:00:00", 200), /date_from=2026-10-13%2008%3A00%3A00&sort=asc&limit=100&offset=200$/);
});

/* ── Połączenie, na podstawionym `fetch` ─────────────────────────────────── */

const fetchBylo = globalThis.fetch;
after(() => { globalThis.fetch = fetchBylo; });

function podstaw(status: number, cialo = "", naglowki: Record<string, string> = {}) {
  const wolania: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    wolania.push({ url, init });
    return new Response(cialo, { status, headers: naglowki });
  }) as typeof fetch;
  return wolania;
}

test("klucz idzie nagłówkiem apiKey, żądanie bez ciała nie deklaruje typu treści", async () => {
  const w = podstaw(200, "[]");
  assert.deepEqual(await S.zapytajSellasist("/statuses"), []);
  const h = w[0].init.headers as Record<string, string>;
  assert.equal(w[0].url, "https://firma.sellasist.pl/api/v1/statuses");
  assert.equal(h.apiKey, "klucz-testowy-123");
  assert.equal(h["content-type"], undefined);
});

test("zapis z ciałem deklaruje JSON", async () => {
  const w = podstaw(200, '{"id":1}');
  await S.zapytajSellasist("/notes", { metoda: "POST", body: { order_id: 1, text: "x" } });
  assert.equal((w[0].init.headers as Record<string, string>)["content-type"], "application/json");
  assert.equal(w[0].init.body, '{"order_id":1,"text":"x"}');
});

test("404 to null, 429 to błąd limitu z Retry-After, 401 nie zdradza klucza", async () => {
  podstaw(404);
  assert.equal(await S.zapytajSellasist("/orders/1"), null);
  podstaw(429, "", { "retry-after": "30" });
  await assert.rejects(S.zapytajSellasist("/orders/1"), (e: unknown) =>
    e instanceof BladLimitu && e.poIluMs === 30_000);
  podstaw(401, "klucz-testowy-123 is invalid");
  await assert.rejects(S.zapytajSellasist("/orders/1"), (e: unknown) =>
    e instanceof S.BladSellasist && e.kod === 401 && !e.message.includes("klucz-testowy-123"));
});

test("błąd 500 niesie stałe zdanie, nie treść odpowiedzi", async () => {
  podstaw(500, "Fatal error in /var/www/firma/secret.php");
  await assert.rejects(S.zapytajSellasist("/orders/1"), (e: unknown) =>
    e instanceof S.BladSellasist && e.kod === 500 && !e.message.includes("secret"));
});
