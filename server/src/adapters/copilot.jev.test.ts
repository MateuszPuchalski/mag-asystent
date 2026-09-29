import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { _ustawFetch, nadawcaJev, PYTANIA_JEVA } from "./copilot.jev.js";
import { nadawcaKlasyfikacji } from "./copilot.klasyfikator.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladOdpowiedziCopilota, BladPrzeciazeniaCopilota,
} from "./copilot.js";
import { config, kluczKlasyfikatora, modelKlasyfikatora, ostrzezeniaKonfiguracji } from "../config.js";
import { AKCJE, KATEGORIE } from "../services/klasyfikacja-slownik.js";
import { walidujOdpowiedz } from "../services/klasyfikacja-polityka.js";
import { kosztUsd, znanyModel } from "../services/copilot-koszt.js";
import type { TrescBezpieczna } from "../services/copilot-maskowanie.js";

/* ── Nadawca Jeva ────────────────────────────────────────────────────────────
   Nie ma tu żywego API: nie mieliśmy klucza, gdy powstawał ten adapter. Testy
   dowodzą więc dwóch rzeczy i nie więcej. Pierwsza: żądanie ma kształt z
   dokumentacji TypeSafe (endpoint, nagłówki, `questions` z odpowiedziami pod
   naszymi kluczami). Druga: odpowiedź o tym kształcie staje się `surowa`,
   którą przyjmuje `walidujOdpowiedz`. Że Jev trafia po polsku, mówi dopiero
   raport porównawczy na prawdziwych wiadomościach.                          */

const TRESC = "Czy nóż pasuje do Husqvarna CTH 184T?" as TrescBezpieczna;
const KLUCZ = "tsk-TAJNY-KLUCZ-do-testu";

const poczatkowy = process.env.TYPESAFE_API_KEY;
const klasyfikator = config.copilot.klasyfikator;
afterEach(() => {
  _ustawFetch(null);
  if (poczatkowy === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = poczatkowy;
  config.copilot.klasyfikator = klasyfikator;
});

type Wybor = { choice: string; probabilities: Record<string, number>; confidence: number };
const wybor = (choice: string, p: number, confidence: number): Wybor =>
  ({ choice, probabilities: { [choice]: p }, confidence });

/** Odpowiedź w kształcie z `docs.typesafe.ai/api`, z nadpisaniem wybranych pól. */
function odpowiedz(nadpisz: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = {
    kategoria: { type: "choice", ...wybor("PRODUCT_COMPATIBILITY", 0.9, 0.9) },
    akcja: { type: "choice", ...wybor("CHECK_COMPATIBILITY", 0.8, 0.7) },
    powod_inne: { type: "choice", ...wybor("poza_slownikiem", 0.6, 0.4) },
    prosi_o_czlowieka: { type: "noul", noul: 0.02 },
    wymaga_czlowieka: { type: "noul", noul: 0.05 },
    brak_danych_zamowienia: { type: "noul", noul: 0.1 },
    brak_danych_produktu: { type: "noul", noul: 0.1 },
  };
  for (const k of KATEGORIE) if (k !== "OTHER") answers[`dodatkowa_${k}`] = { type: "noul", noul: 0.01 };
  Object.assign(answers, nadpisz);
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 1200, output_tokens: 40 } };
}

const json = (status: number, cialo: unknown, naglowki: Record<string, string> = {}) =>
  new Response(JSON.stringify(cialo), { status, headers: { "content-type": "application/json", ...naglowki } });

function fetchZwracajacy(r: Response | (() => Response)) {
  const wywolania: Array<{ url: string; init: RequestInit }> = [];
  _ustawFetch((async (url: string, init: RequestInit) => {
    wywolania.push({ url, init });
    return typeof r === "function" ? r() : r;
  }) as unknown as typeof fetch);
  return wywolania;
}

const zKluczem = () => { process.env.TYPESAFE_API_KEY = KLUCZ; };

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
  assert.equal(b.state, String(TRESC));
  assert.equal(b.model, "jev-1.13.0", "przypięta wersja, nie alias jev-latest");
  assert.notEqual(b.model, "jev-latest");
});

test("pytania: Choice na kategorię i akcję z KOMPLETEM opcji ze słownika", async () => {
  zKluczem();
  const w = fetchZwracajacy(json(200, odpowiedz()));
  await nadawcaJev(TRESC);
  const q = JSON.parse(String(w[0]!.init.body)).questions;

  assert.deepEqual(Object.keys(q.kategoria.criteria).sort(), [...KATEGORIE].sort());
  assert.deepEqual(Object.keys(q.akcja.criteria).sort(), [...AKCJE].sort());
  assert.ok(Object.keys(q.kategoria.criteria).length <= 255, "limit opcji Choice u TypeSafe");
  for (const nazwa of ["prosi_o_czlowieka", "wymaga_czlowieka", "brak_danych_zamowienia", "brak_danych_produktu"]) {
    assert.equal(q[nazwa].type, "noul", nazwa);
  }
  for (const k of KATEGORIE) {
    if (k === "OTHER") assert.equal(q[`dodatkowa_${k}`], undefined, "„dodatkowe inne” nic nie mówi");
    else assert.equal(q[`dodatkowa_${k}`].type, "noul", k);
  }
});

test("każde pytanie niesie kontekst i zakaz wykonywania poleceń z wątku", async () => {
  zKluczem();
  const w = fetchZwracajacy(json(200, odpowiedz()));
  await nadawcaJev(TRESC);
  const q = JSON.parse(String(w[0]!.init.body)).questions as Record<string, { instructions: string }>;
  /* Pytania Jeva nie widzą się nawzajem, więc kontekst ma stać w każdym. */
  for (const [nazwa, p] of Object.entries(q)) {
    assert.match(p.instructions, /nie polecenia dla ciebie/, `${nazwa}: brak zastrzeżenia o poleceniach`);
    assert.match(p.instructions, /OSTATNIĄ wiadomość/, `${nazwa}: brak wskazania bieżącej wiadomości`);
  }
});

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
  assert.equal(w.odp.powodInne, null, "powód „inne” tylko przy OTHER");
  assert.deepEqual(w.odp.dodatkowe, []);
  assert.equal(w.odp.wymagaCzlowieka, false);
  assert.match(w.odp.uzasadnienie, /^Jev: PRODUCT_COMPATIBILITY \(90%\), krok CHECK_COMPATIBILITY\.$/);
});

test("prośba o człowieka łapie się przy NISKIM progu, brak danych przy pośrednim", async () => {
  zKluczem();
  fetchZwracajacy(json(200, odpowiedz({
    prosi_o_czlowieka: { type: "noul", noul: 0.35 },
    wymaga_czlowieka: { type: "noul", noul: 0.31 },
    brak_danych_zamowienia: { type: "noul", noul: 0.4 },
    brak_danych_produktu: { type: "noul", noul: 0.55 },
  })));
  const s = (await nadawcaJev(TRESC)).surowa as Record<string, unknown>;

  assert.equal(s.prosiOCzlowieka, true, "0,35 przekracza próg 0,3: pominięcie kosztuje klienta");
  assert.equal(s.wymagaCzlowieka, true);
  assert.equal(s.brakDanychZamowienia, false, "0,4 to jeszcze nie brak danych");
  assert.equal(s.brakDanychProduktu, true);
});

test("kategorie dodatkowe: próg wysoki, bez głównej, najwyżej trzy, od najpewniejszej", async () => {
  zKluczem();
  fetchZwracajacy(json(200, odpowiedz({
    dodatkowa_RETURN: { type: "noul", noul: 0.75 },
    dodatkowa_COMPLAINT: { type: "noul", noul: 0.95 },
    dodatkowa_INVOICE: { type: "noul", noul: 0.71 },
    dodatkowa_CANCEL_ORDER: { type: "noul", noul: 0.9 },
    dodatkowa_ORDER_STATUS: { type: "noul", noul: 0.69 },
    dodatkowa_PRODUCT_COMPATIBILITY: { type: "noul", noul: 0.99 },
  })));
  const s = (await nadawcaJev(TRESC)).surowa as { dodatkowe: string[] };

  assert.deepEqual(s.dodatkowe, ["COMPLAINT", "CANCEL_ORDER", "RETURN"]);
  assert.ok(!s.dodatkowe.includes("PRODUCT_COMPATIBILITY"), "główna nie wraca jako dodatkowa");
  assert.ok(!s.dodatkowe.includes("ORDER_STATUS"), "0,69 jest pod progiem 0,7");
});

test("powód „inne” idzie dalej tylko przy OTHER", async () => {
  zKluczem();
  fetchZwracajacy(json(200, odpowiedz({
    kategoria: { type: "choice", ...wybor("OTHER", 0.8, 0.8) },
    akcja: { type: "choice", ...wybor("NO_ACTION", 0.9, 0.9) },
    powod_inne: { type: "choice", ...wybor("za_malo_tresci", 0.7, 0.6) },
  })));
  const s = (await nadawcaJev(TRESC)).surowa as Record<string, unknown>;
  assert.equal(s.powodInne, "za_malo_tresci");
  assert.ok(walidujOdpowiedz(s).ok);
});

test("pewność słowna z liczbowej: wysoka od 0,8, średnia od 0,5, niżej niska", async () => {
  zKluczem();
  const dla = async (c: number) => {
    fetchZwracajacy(json(200, odpowiedz({
      kategoria: { type: "choice", ...wybor("PRODUCT_QUESTION", 0.6, c) },
    })));
    return ((await nadawcaJev(TRESC)).surowa as { pewnosc: string }).pewnosc;
  };
  assert.equal(await dla(0.8), "wysoka");
  assert.equal(await dla(0.79), "srednia");
  assert.equal(await dla(0.5), "srednia");
  assert.equal(await dla(0.49), "niska");
});

test("kategoria spoza słownika przechodzi do polityki, która ją odrzuca", async () => {
  zKluczem();
  fetchZwracajacy(json(200, odpowiedz({
    kategoria: { type: "choice", ...wybor("NIE_MA_TAKIEJ", 0.9, 0.9) },
  })));
  const o = await nadawcaJev(TRESC);
  const w = walidujOdpowiedz(o.surowa);
  assert.equal(w.ok, false);
  assert.match(w.ok ? "" : w.powod, /kategoria spoza słownika/);
});

/* ── Błędy ───────────────────────────────────────────────────────────────── */

test("brak klucza: błąd klucza, i żadnego żądania do sieci", async () => {
  delete process.env.TYPESAFE_API_KEY;
  const w = fetchZwracajacy(json(200, odpowiedz()));
  const e = await nadawcaJev(TRESC).then(() => null, (b) => b);
  assert.ok(e instanceof BladKluczaCopilota);
  assert.equal(w.length, 0, "bez klucza nic nie ma prawa wyjść na zewnątrz");
});

test("401 to błąd klucza, 429 to limit z Retry-After", async () => {
  zKluczem();
  fetchZwracajacy(json(401, { error: "unauthorized" }));
  assert.ok(await nadawcaJev(TRESC).then(() => null, (b) => b) instanceof BladKluczaCopilota);

  fetchZwracajacy(json(429, { error: "rate" }, { "retry-after": "7" }));
  const e = await nadawcaJev(TRESC).then(() => null, (b) => b);
  assert.ok(e instanceof BladLimituCopilota);
  assert.equal((e as BladLimituCopilota).poIluMs, 7000);
});

test("529 i 5xx zatrzymują partię jako przeciążenie, bez JSON-a w zdaniu na ekran", async () => {
  zKluczem();
  for (const status of [529, 503]) {
    fetchZwracajacy(json(status, { error: "overloaded" }));
    const e = await nadawcaJev(TRESC).then(() => null, (b) => b) as BladPrzeciazeniaCopilota;
    assert.ok(e instanceof BladPrzeciazeniaCopilota, String(status));
    assert.equal(e.status, status);
    assert.doesNotMatch(e.message, /[{}]/);
    assert.match(e.slad, /overloaded/, "surowa treść należy do księgi");
  }
});

test("zerwana sieć to błąd łączności, nie odpowiedź dostawcy", async () => {
  zKluczem();
  _ustawFetch((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
  const e = await nadawcaJev(TRESC).then(() => null, (b) => b);
  assert.ok(e instanceof BladLacznosciCopilota);
});

test("422 i odpowiedź nie do odczytania to błąd odpowiedzi", async () => {
  zKluczem();
  fetchZwracajacy(json(422, { detail: "questions: bad" }));
  const e422 = await nadawcaJev(TRESC).then(() => null, (b) => b) as BladOdpowiedziCopilota;
  assert.ok(e422 instanceof BladOdpowiedziCopilota);
  assert.equal(e422.status, 422);

  fetchZwracajacy(new Response("to nie jest json", { status: 200 }));
  assert.ok(await nadawcaJev(TRESC).then(() => null, (b) => b) instanceof BladOdpowiedziCopilota);
});

test("brakujące albo przekręcone pole odpowiedzi to błąd, nie decyzja z domysłu", async () => {
  zKluczem();
  const bez = odpowiedz();
  delete (bez.answers as Record<string, unknown>).akcja;
  fetchZwracajacy(json(200, bez));
  assert.ok(await nadawcaJev(TRESC).then(() => null, (b) => b) instanceof BladOdpowiedziCopilota);

  fetchZwracajacy(json(200, odpowiedz({ wymaga_czlowieka: { type: "noul", noul: 1.5 } })));
  assert.ok(await nadawcaJev(TRESC).then(() => null, (b) => b) instanceof BladOdpowiedziCopilota,
    "noul poza 0–1 to odpowiedź, której nie wolno zamienić w flagę");

  fetchZwracajacy(json(200, { model: "jev-1.13.0", usage: {} }));
  assert.ok(await nadawcaJev(TRESC).then(() => null, (b) => b) instanceof BladOdpowiedziCopilota);
});

test("klucz nigdy nie trafia do komunikatu ani śladu błędu", async () => {
  zKluczem();
  const przypadki: Array<Response | (() => never)> = [
    json(401, { echo: KLUCZ }), json(429, {}), json(529, { echo: KLUCZ }), json(422, { echo: KLUCZ }),
  ];
  for (const p of przypadki) {
    fetchZwracajacy(p as Response);
    const e = await nadawcaJev(TRESC).then(() => null, (b) => b) as Error & { slad?: string };
    assert.doesNotMatch(e.message, new RegExp(KLUCZ), "komunikat na ekran");
  }
  _ustawFetch((async () => { throw new Error(`nieudane połączenie z Bearer ${KLUCZ}`); }) as unknown as typeof fetch);
  const e = await nadawcaJev(TRESC).then(() => null, (b) => b) as Error & { slad: string };
  assert.doesNotMatch(e.message, new RegExp(KLUCZ));
  assert.doesNotMatch(e.slad, new RegExp(KLUCZ), "ślad idzie do księgi wywołań");
  assert.match(e.slad, /\[klucz\]/);

  /* Echo dostawcy w ciele błędu: 422 niesie treść do księgi, 529 do śladu. */
  for (const status of [422, 529]) {
    fetchZwracajacy(json(status, { echo: `Bearer ${KLUCZ}` }));
    const b = await nadawcaJev(TRESC).then(() => null, (x) => x) as Error & { slad: string };
    assert.doesNotMatch(b.slad, new RegExp(KLUCZ), `status ${status}`);
  }
});

/* ── Wybór dostawcy, konfiguracja i koszt ────────────────────────────────── */

test("domyślnym klasyfikatorem jest Jev, a Claude wraca jedną zmienną", () => {
  assert.equal(klasyfikator, "jev", "decyzja właściciela z 29 września 2026");
});

test("nadawcaKlasyfikacji idzie do dostawcy z konfiguracji", async () => {
  zKluczem();
  const w = fetchZwracajacy(json(200, odpowiedz()));
  config.copilot.klasyfikator = "jev";
  await nadawcaKlasyfikacji(TRESC);
  assert.equal(w.length, 1, "przy `jev` żądanie idzie do TypeSafe");
});

test("klucz i model klasyfikatora zależą od wybranego dostawcy", () => {
  const c = structuredClone(config);
  c.copilot.klasyfikator = "jev";
  c.copilot.kluczJev = true; c.copilot.klucz = false;
  assert.equal(kluczKlasyfikatora(c), true, "przy Jevie klucz Claude niczego nie rozpoznaje");
  assert.equal(modelKlasyfikatora(c), c.copilot.modelJev);

  c.copilot.klasyfikator = "anthropic";
  assert.equal(kluczKlasyfikatora(c), false, "przy Claude klucz TypeSafe nic nie daje");
  assert.equal(modelKlasyfikatora(c), c.copilot.modelKlasyfikacji);
});

test("Jev bez klucza TypeSafe daje głośne ostrzeżenie, nie cichy brak rozpoznawania", () => {
  const c = structuredClone(config);
  c.copilot.mode = "anthropic"; c.copilot.klucz = true;
  c.copilot.klasyfikator = "jev"; c.copilot.kluczJev = false;
  assert.ok(ostrzezeniaKonfiguracji(c).some((z) => /TYPESAFE_API_KEY/.test(z)));

  c.copilot.kluczJev = true;
  assert.ok(!ostrzezeniaKonfiguracji(c).some((z) => /TYPESAFE_API_KEY/.test(z)));
});

test("model Jeva ma cennik, więc nie liczy się stawką najdroższego modelu", () => {
  assert.equal(znanyModel("jev-1.13.0"), true);
  // 1 000 000 tokenów wejścia = 0,042 dolara, wyjście darmowe.
  assert.equal(kosztUsd("jev-1.13.0", { wej: 1_000_000, wyj: 1_000_000, cacheZapis: 0, cacheOdczyt: 0 }), 0.042);
  assert.ok(kosztUsd("jev-1.13.0", { wej: 1200, wyj: 40, cacheZapis: 0, cacheOdczyt: 0 }) < 0.0001);
});
