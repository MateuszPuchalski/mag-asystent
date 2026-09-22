import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decyzjaZModelu, decyzjaZastepcza, sprzecznosc, walidujOdpowiedz, type OdpowiedzKlasyfikatora,
} from "./klasyfikacja-polityka.js";

/* ── Polityka nad odpowiedzią klasyfikatora ──────────────────────────────────
   Każdy test nazywa JEDNĄ regułę ze specyfikacji. Reguła, której nie da się
   wskazać w tym pliku, nie powinna stać w polityce: to ona decyduje, kiedy
   rozmowa dostaje „wymaga człowieka", więc musi być czytelna bez kodu.     */

const odp = (n: Partial<OdpowiedzKlasyfikatora> = {}): OdpowiedzKlasyfikatora => ({
  kategoria: "ORDER_STATUS", dodatkowe: [], akcja: "GET_SHIPMENT",
  wymagaCzlowieka: false, prosiOCzlowieka: false,
  brakDanychZamowienia: false, brakDanychProduktu: false,
  pewnosc: "wysoka", powodInne: null, uzasadnienie: "pyta o paczkę", ...n,
});

test("walidacja: enumy, prawdy/fałsze i pewność sprawdzamy u siebie (AC3)", () => {
  assert.equal(walidujOdpowiedz(null).ok, false);
  assert.equal(walidujOdpowiedz({ ...odp(), kategoria: "dobor" }).ok, false);
  assert.equal(walidujOdpowiedz({ ...odp(), akcja: "REFUND" }).ok, false);
  assert.equal(walidujOdpowiedz({ ...odp(), dodatkowe: ["X"] }).ok, false);
  assert.equal(walidujOdpowiedz({ ...odp(), wymagaCzlowieka: "tak" }).ok, false);
  assert.equal(walidujOdpowiedz({ ...odp(), pewnosc: "0.9" }).ok, false);
  assert.equal(walidujOdpowiedz({ ...odp(), powodInne: "cokolwiek" }).ok, false);
  assert.equal(walidujOdpowiedz(odp()).ok, true);
});

test("dodatkowe: bez głównej, bez powtórzeń, najwyżej trzy", () => {
  const w = walidujOdpowiedz({ ...odp(), dodatkowe: [
    "ORDER_STATUS", "INVOICE", "INVOICE", "RETURN", "CANCEL_ORDER", "COMPLAINT"] });
  assert.ok(w.ok);
  if (w.ok) assert.deepEqual(w.odp.dodatkowe, ["INVOICE", "RETURN", "CANCEL_ORDER"]);
});

test("zwykła sprawa: SUCCESS, akcja modelu, bez kodów", () => {
  const d = decyzjaZModelu(odp());
  assert.equal(d.status, "SUCCESS");
  assert.equal(d.akcja, "GET_SHIPMENT");
  assert.equal(d.wymagaCzlowieka, false);
  assert.deepEqual(d.kody, []);
});

test("prośba o człowieka jest eskalowana ZAWSZE, bez progu", () => {
  const d = decyzjaZModelu(odp({ prosiOCzlowieka: true, pewnosc: "wysoka" }));
  assert.equal(d.wymagaCzlowieka, true);
  assert.equal(d.akcja, "HUMAN_REVIEW");
  assert.equal(d.akcjaModelu, "GET_SHIPMENT");
  assert.equal(d.status, "SUCCESS");
});

test("niska pewność: człowiek i status do przejrzenia, ale akcja modelu zostaje", () => {
  const d = decyzjaZModelu(odp({ pewnosc: "niska" }));
  assert.equal(d.wymagaCzlowieka, true);
  assert.equal(d.status, "NEEDS_REVIEW");
  assert.equal(d.akcja, "GET_SHIPMENT");
});

test("OTHER z brakiem działania to podziękowanie — człowiek niepotrzebny", () => {
  const d = decyzjaZModelu(odp({ kategoria: "OTHER", akcja: "NO_ACTION", powodInne: null }));
  assert.equal(d.wymagaCzlowieka, false);
  assert.equal(d.status, "SUCCESS");
});

test("OTHER z jakąkolwiek inną akcją woła człowieka", () => {
  const d = decyzjaZModelu(odp({ kategoria: "OTHER", akcja: "GET_ORDER", powodInne: "poza_slownikiem" }));
  assert.equal(d.wymagaCzlowieka, true);
  assert.equal(d.status, "NEEDS_REVIEW");
  assert.ok(d.kody.includes("KATEGORIA_OTHER"));
});

test("sprzeczność: brak działania przy sprawie wymagającej człowieka", () => {
  assert.ok(sprzecznosc(odp({ akcja: "NO_ACTION", wymagaCzlowieka: true })));
  const d = decyzjaZModelu(odp({ akcja: "NO_ACTION", wymagaCzlowieka: true }));
  assert.equal(d.akcja, "HUMAN_REVIEW");
  assert.equal(d.akcjaModelu, "NO_ACTION");
  assert.ok(d.kody.includes("NIESPOJNA_ODPOWIEDZ"));
});

test("sprzeczność: sprawdzanie pasowania przy fakturze", () => {
  assert.ok(sprzecznosc(odp({ kategoria: "INVOICE", akcja: "CHECK_COMPATIBILITY" })));
  assert.equal(sprzecznosc(odp({ kategoria: "PRODUCT_COMPATIBILITY", akcja: "CHECK_COMPATIBILITY" })), null);
});

test("zwrot i reklamacja zostają ręczne — kod mówi, że to ruch człowieka", () => {
  const d = decyzjaZModelu(odp({ kategoria: "COMPLAINT", akcja: "START_COMPLAINT" }));
  assert.equal(d.wymagaCzlowieka, true);
  assert.ok(d.kody.includes("AKCJA_RECZNA"));
  assert.equal(d.status, "SUCCESS", "reklamacja rozpoznana dobrze to nie niepewność");
});

test("szeroka wskazówka Allegro, z którą model się nie zgadza, to spór — rozstrzyga człowiek", () => {
  const d = decyzjaZModelu(odp({ kategoria: "PRODUCT_COMPATIBILITY", akcja: "CHECK_COMPATIBILITY" }),
    { kategoria: "WRONG_PRODUCT", waska: false });
  assert.equal(d.kategoriaAllegro, "WRONG_PRODUCT");
  assert.equal(d.status, "NEEDS_REVIEW");
  assert.ok(d.kody.includes("SPOR_Z_ALLEGRO"));
  const zgoda = decyzjaZModelu(odp({ kategoria: "WRONG_PRODUCT", akcja: "GET_ORDER" }),
    { kategoria: "WRONG_PRODUCT", waska: false });
  assert.equal(zgoda.status, "SUCCESS");
});

test("decyzja zastępcza: OTHER, przegląd, flagi zachowawcze na prawdzie", () => {
  const d = decyzjaZastepcza("BLAD_MODELU", "FAILED");
  assert.equal(d.kategoria, "OTHER");
  assert.equal(d.akcja, "HUMAN_REVIEW");
  assert.equal(d.kategoriaModelu, null, "model nic nie powiedział — nie udajemy, że powiedział");
  assert.equal(d.pewnosc, null, "brak pewności to NULL, nie syntetyczne zero");
  assert.equal(d.brakDanychZamowienia, true);
  assert.equal(d.brakDanychProduktu, true);
});
