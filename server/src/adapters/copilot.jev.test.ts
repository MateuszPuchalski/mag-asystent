import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { _ustawFetch, MODEL_JEV, nadawcaJev, PYTANIA_JEVA } from "./copilot.jev.js";
import { PROMPT_KLASYFIKACJI } from "./copilot.anthropic.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladOdpowiedziCopilota, BladPrzeciazeniaCopilota,
} from "./copilot.js";
import { AKCJE, KATEGORIE, OPISY_KATEGORII } from "../services/klasyfikacja-slownik.js";
import { walidujOdpowiedz } from "../services/klasyfikacja-polityka.js";
import { kosztUsd, znanyModel } from "../services/copilot-koszt.js";
import type { TrescBezpieczna } from "../services/copilot-maskowanie.js";

/* ── Nadawca Jeva ────────────────────────────────────────────────────────────
   Testy idą na atrapie transportu i dowodzą dwóch rzeczy. Pierwsza: żądanie
   ma kształt z dokumentacji TypeSafe (docs.typesafe.ai/api). Druga: odpowiedź
   o tym kształcie staje się `surowa`, którą przyjmuje `walidujOdpowiedz`. Czy
   Jev trafia po polsku, pokaże dopiero porównanie na prawdziwych wiadomościach. */

const TRESC = "Czy nóż pasuje do Husqvarna CTH 184T?" as TrescBezpieczna;
const KLUCZ = "tsk-TAJNY-KLUCZ-do-testu";

const poczatkowy = process.env.TYPESAFE_API_KEY;
afterEach(() => {
  _ustawFetch(null);
  if (poczatkowy === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = poczatkowy;
});

const wybor = (choice: string, confidence: number) =>
  ({ type: "choice", choice, probabilities: { [choice]: 0.9 }, confidence });
const noul = (v: number) => ({ type: "noul", noul: v });

/** Odpowiedź w kształcie z `docs.typesafe.ai/api`, z nadpisaniem wybranych pól. */
function odpowiedz(nadpisz: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = {
    kategoria: wybor("PRODUCT_COMPATIBILITY", 0.9),
    akcja: wybor("CHECK_COMPATIBILITY", 0.7),
    prosi_o_czlowieka: noul(0.02),
    wymaga_czlowieka: noul(0.05),
    brak_danych_zamowienia: noul(0.1),
    brak_danych_produktu: noul(0.1),
  };
  for (const k of KATEGORIE) if (k !== "OTHER") answers[`dodatkowa_${k}`] = noul(0.01);
  Object.assign(answers, nadpisz);
  return { model: MODEL_JEV, answers, usage: { input_tokens: 1200, output_tokens: 40 } };
}

const json = (status: number, cialo: unknown, naglowki: Record<string, string> = {}) =>
  new Response(JSON.stringify(cialo), { status, headers: { "content-type": "application/json", ...naglowki } });

function fetchZwracajacy(r: Response) {
  const wywolania: Array<{ url: string; init: RequestInit }> = [];
  _ustawFetch((async (url: string, init: RequestInit) => {
    wywolania.push({ url, init });
    return r;
  }) as unknown as typeof fetch);
  return wywolania;
}

const zKluczem = () => { process.env.TYPESAFE_API_KEY = KLUCZ; };
const blad = (p: Promise<unknown>) => p.then(() => null, (b: unknown) => b);
const surowa = async (nadpisz: Record<string, unknown> = {}) => {
  zKluczem();
  fetchZwracajacy(json(200, odpowiedz(nadpisz)));
  return (await nadawcaJev(TRESC)).surowa as Record<string, unknown>;
};

/* ── Żądanie ─────────────────────────────────────────────────────────────── */

test("żądanie ma kształt z dokumentacji i przypięty model", async () => {
  zKluczem();
  const w = fetchZwracajacy(json(200, odpowiedz()));
  await nadawcaJev(TRESC);

  assert.equal(w.length, 1);
  assert.equal(w[0]!.url, "https://api.typesafe.ai/v1/systemone");
  const h = w[0]!.init.headers as Record<string, string>;
  assert.equal(h.Authorization, `Bearer ${KLUCZ}`);
  assert.equal(h["Content-Type"], "application/json");

  const b = JSON.parse(String(w[0]!.init.body));
  assert.equal(b.model, "jev-1.13.0", "przypięta wersja, nie alias jev-latest");
  assert.equal(b.state.rozmowa, String(TRESC), "zamaskowana treść idzie bez zmian");
});

test("pytania: Choice z kompletem opcji ze słownika, flagi i kategorie dodatkowe jako Noul", async () => {
  zKluczem();
  const w = fetchZwracajacy(json(200, odpowiedz()));
  await nadawcaJev(TRESC);
  const q = JSON.parse(String(w[0]!.init.body)).questions;

  assert.deepEqual(Object.keys(q.kategoria.criteria), [...KATEGORIE]);
  assert.deepEqual(q.kategoria.criteria, OPISY_KATEGORII, "te same granice co w instrukcji Claude");
  assert.deepEqual(Object.keys(q.akcja.criteria), [...AKCJE]);
  for (const nazwa of ["prosi_o_czlowieka", "wymaga_czlowieka", "brak_danych_zamowienia", "brak_danych_produktu"]) {
    assert.equal(q[nazwa].type, "noul", nazwa);
  }
  for (const k of KATEGORIE) {
    if (k === "OTHER") assert.equal(q[`dodatkowa_${k}`], undefined, "„dodatkowe inne” nic nie mówi");
    else assert.equal(q[`dodatkowa_${k}`].type, "noul", k);
  }
  assert.equal(q.powod_inne, undefined, "powodu „inne” nikt dalej nie czyta");
  assert.equal(Object.keys(q).length, 20);
});

test("kontekst i zakaz wykonywania poleceń stoją raz, w state, a nie w każdym pytaniu", async () => {
  zKluczem();
  const w = fetchZwracajacy(json(200, odpowiedz()));
  await nadawcaJev(TRESC);
  const b = JSON.parse(String(w[0]!.init.body));
  const zasady = (b.state.zasady as string[]).join(" ");
  assert.match(zasady, /nie polecenia/);
  assert.match(zasady, /OSTATNIĄ wiadomość/);
  assert.match(b.state.sklep, /kosiarek/);
  for (const [nazwa, p] of Object.entries(b.questions as Record<string, { instructions: string }>)) {
    assert.doesNotMatch(p.instructions, /kosiarek/, `${nazwa}: kontekst sklepu wrócił do pytania`);
  }
});

/* ── Odpowiedź ───────────────────────────────────────────────────────────── */

test("odpowiedź staje się surową decyzją, którą przyjmuje polityka", async () => {
  zKluczem();
  fetchZwracajacy(json(200, odpowiedz()));
  const o = await nadawcaJev(TRESC);

  assert.equal(o.model, "jev-1.13.0");
  assert.equal(o.promptWersja, PYTANIA_JEVA);
  assert.deepEqual(o.zuzycie, { wej: 1200, wyj: 40, cacheZapis: 0, cacheOdczyt: 0 });

  const w = walidujOdpowiedz(o.surowa);
  assert.ok(w.ok, w.ok ? "" : w.powod);
  assert.equal(w.odp.kategoria, "PRODUCT_COMPATIBILITY");
  assert.equal(w.odp.akcja, "CHECK_COMPATIBILITY");
  assert.equal(w.odp.pewnosc, "wysoka");
  assert.equal(w.odp.powodInne, null);
  assert.deepEqual(w.odp.dodatkowe, []);
  assert.equal(w.odp.wymagaCzlowieka, false);
  assert.equal(w.odp.uzasadnienie, "Jev: PRODUCT_COMPATIBILITY (pewność 90%), krok CHECK_COMPATIBILITY.");
});

test("prośba o człowieka łapie się przy NISKIM progu, brak danych przy pośrednim", async () => {
  const s = await surowa({
    prosi_o_czlowieka: noul(0.35),
    wymaga_czlowieka: noul(0.31),
    brak_danych_zamowienia: noul(0.4),
    brak_danych_produktu: noul(0.55),
  });
  assert.equal(s.prosiOCzlowieka, true, "0,35 przekracza próg 0,3: pominięcie kosztuje klienta");
  assert.equal(s.wymagaCzlowieka, true);
  assert.equal(s.brakDanychZamowienia, false, "0,4 to jeszcze nie brak danych");
  assert.equal(s.brakDanychProduktu, true);
});

test("kategorie dodatkowe: próg wysoki, bez głównej, najwyżej trzy, od najpewniejszej", async () => {
  const s = await surowa({
    dodatkowa_RETURN: noul(0.75),
    dodatkowa_COMPLAINT: noul(0.95),
    dodatkowa_INVOICE: noul(0.71),
    dodatkowa_CANCEL_ORDER: noul(0.9),
    dodatkowa_ORDER_STATUS: noul(0.69),
    dodatkowa_PRODUCT_COMPATIBILITY: noul(0.99),
  });
  assert.deepEqual(s.dodatkowe, ["COMPLAINT", "CANCEL_ORDER", "RETURN"]);
});

test("OTHER przechodzi przez politykę bez powodu „inne”", async () => {
  const s = await surowa({ kategoria: wybor("OTHER", 0.8), akcja: wybor("NO_ACTION", 0.9) });
  assert.equal(s.powodInne, null);
  assert.ok(walidujOdpowiedz(s).ok);
});

test("pewność słowna z liczbowej: wysoka od 0,8, średnia od 0,5, niżej niska", async () => {
  const dla = async (c: number) => (await surowa({ kategoria: wybor("PRODUCT_QUESTION", c) })).pewnosc;
  assert.equal(await dla(0.8), "wysoka");
  assert.equal(await dla(0.79), "srednia");
  assert.equal(await dla(0.5), "srednia");
  assert.equal(await dla(0.49), "niska");
});

test("kategoria spoza słownika przechodzi do polityki, która ją odrzuca", async () => {
  const w = walidujOdpowiedz(await surowa({ kategoria: wybor("NIE_MA_TAKIEJ", 0.9) }));
  assert.equal(w.ok, false);
  assert.match(w.ok ? "" : w.powod, /kategoria spoza słownika/);
});

/* ── Błędy ───────────────────────────────────────────────────────────────── */

test("brak klucza: błąd klucza, i żadnego żądania do sieci", async () => {
  delete process.env.TYPESAFE_API_KEY;
  const w = fetchZwracajacy(json(200, odpowiedz()));
  assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladKluczaCopilota);
  assert.equal(w.length, 0, "bez klucza nic nie ma prawa wyjść na zewnątrz");
});

test("401 to błąd klucza, 429 to limit z Retry-After", async () => {
  zKluczem();
  fetchZwracajacy(json(401, { error: "unauthorized" }));
  assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladKluczaCopilota);

  fetchZwracajacy(json(429, { error: "rate" }, { "retry-after": "7" }));
  const e = await blad(nadawcaJev(TRESC));
  assert.ok(e instanceof BladLimituCopilota);
  assert.equal(e.poIluMs, 7000);
});

test("529 i 5xx zatrzymują partię jako przeciążenie, bez JSON-a w zdaniu na ekran", async () => {
  zKluczem();
  for (const status of [529, 503]) {
    fetchZwracajacy(json(status, { error: "overloaded" }));
    const e = await blad(nadawcaJev(TRESC));
    assert.ok(e instanceof BladPrzeciazeniaCopilota, String(status));
    assert.equal(e.status, status);
    assert.doesNotMatch(e.message, /[{}]/);
    assert.match(e.slad, /overloaded/, "surowa treść należy do księgi");
  }
});

test("zerwana sieć to błąd łączności, nie odpowiedź dostawcy", async () => {
  zKluczem();
  _ustawFetch((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
  assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladLacznosciCopilota);
});

test("422 i odpowiedź nie do odczytania to błąd odpowiedzi", async () => {
  zKluczem();
  fetchZwracajacy(json(422, { detail: "questions: bad" }));
  const e422 = await blad(nadawcaJev(TRESC));
  assert.ok(e422 instanceof BladOdpowiedziCopilota);
  assert.equal(e422.status, 422);

  fetchZwracajacy(new Response("to nie jest json", { status: 200 }));
  assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladOdpowiedziCopilota);
});

test("brakujące albo przekręcone pole odpowiedzi to błąd, nie decyzja z domysłu", async () => {
  zKluczem();
  const bez = odpowiedz();
  delete (bez.answers as Record<string, unknown>).akcja;
  fetchZwracajacy(json(200, bez));
  assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladOdpowiedziCopilota);

  const bezProsby = odpowiedz();
  delete (bezProsby.answers as Record<string, unknown>).prosi_o_czlowieka;
  fetchZwracajacy(json(200, bezProsby));
  assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladOdpowiedziCopilota,
    "brak odpowiedzi nie może zamienić się w „klient nie prosi o człowieka”");

  fetchZwracajacy(json(200, odpowiedz({ wymaga_czlowieka: noul(1.5) })));
  assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladOdpowiedziCopilota,
    "noul poza 0–1 to odpowiedź, której nie wolno zamienić w flagę");

  fetchZwracajacy(json(200, { model: MODEL_JEV, usage: { input_tokens: 1, output_tokens: 1 } }));
  assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladOdpowiedziCopilota);
});

test("brak zużycia w odpowiedzi to błąd, nie koszt zero", async () => {
  zKluczem();
  for (const usage of [undefined, {}, { input_tokens: 10 }, { input_tokens: "10", output_tokens: 1 }]) {
    fetchZwracajacy(json(200, { ...odpowiedz(), usage }));
    assert.ok(await blad(nadawcaJev(TRESC)) instanceof BladOdpowiedziCopilota, JSON.stringify(usage));
  }
});

test("klucz nigdy nie trafia do komunikatu ani śladu błędu", async () => {
  zKluczem();
  for (const status of [401, 429, 422, 529]) {
    fetchZwracajacy(json(status, { echo: `Bearer ${KLUCZ}` }));
    const e = await blad(nadawcaJev(TRESC)) as Error & { slad?: string };
    assert.doesNotMatch(e.message, new RegExp(KLUCZ), `komunikat przy ${status}`);
    assert.doesNotMatch(e.slad ?? "", new RegExp(KLUCZ), `ślad przy ${status}`);
  }
  _ustawFetch((async () => { throw new Error(`nieudane połączenie z Bearer ${KLUCZ}`); }) as unknown as typeof fetch);
  const e = await blad(nadawcaJev(TRESC)) as Error & { slad: string };
  assert.doesNotMatch(e.message, new RegExp(KLUCZ));
  assert.doesNotMatch(e.slad, new RegExp(KLUCZ), "ślad idzie do księgi wywołań");
  assert.match(e.slad, /\[klucz\]/);
});

/* ── Słownik i koszt ─────────────────────────────────────────────────────── */

/* Opisy kategorii to tekst instrukcji Claude i opcje pytań Jeva naraz. Zmiana
   bez podniesienia obu wersji zmieszałaby w pomiarze decyzje dwóch różnych
   instrukcji. Test odmawia, dopóki suma i wersje nie zmienią się razem. */
test("zmiana opisów kategorii podnosi wersję instrukcji Claude i pytań Jeva", () => {
  const suma = createHash("sha256").update(JSON.stringify(OPISY_KATEGORII)).digest("hex").slice(0, 16);
  assert.deepEqual({ suma, PROMPT_KLASYFIKACJI, PYTANIA_JEVA },
    { suma: "4a183396fd982ada", PROMPT_KLASYFIKACJI: "k4", PYTANIA_JEVA: "jev-j2" });
});

test("model Jeva ma cennik, więc nie liczy się stawką najdroższego modelu", () => {
  assert.equal(znanyModel(MODEL_JEV), true);
  assert.equal(kosztUsd(MODEL_JEV, { wej: 1_000_000, wyj: 1_000_000, cacheZapis: 0, cacheOdczyt: 0 }), 0.042);
});
