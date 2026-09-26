import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  _ustawKlienta, nadawcaAnthropic, nadawcaKluczaAnthropic, nadawcaPytaniaAnthropic, nadawcaSzkicuAnthropic,
  SUFIT_RUND_NARZEDZI, wspieraWysilek,
} from "./copilot.anthropic.js";
import type { KontekstPytania } from "../services/copilot-pytania.js";
import type { WynikNarzedzia, ZestawNarzedzi } from "../services/copilot-narzedzia.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladOdpowiedziCopilota, BladPrzeciazeniaCopilota,
} from "./copilot.js";
import type { TrescBezpieczna } from "../services/copilot-maskowanie.js";
import type { FaktyBezpieczne } from "../services/copilot-szkic.js";

/* ── Mapowanie błędów dostawcy (§14, etap F) ─────────────────────────────────
   Ten plik istnieje przez 529 z pierwszego kliknięcia na produkcji. Testy
   serwisu sprawdzają, co robi partia, gdy DOSTANIE daną klasę błędu — a to
   dowodzi wyłącznie poprawności własnej atrapy. Tutaj sprawdzamy krok
   wcześniej: czy prawdziwy błąd SDK w ogóle staje się tą klasą.

   Błędy budujemy fabryką SDK (`APIError.generate`), nie ręcznie, bo to ona
   wybiera podklasę i czyta `type` z ciała odpowiedzi. Ręcznie sklecony obiekt
   testowałby nasze wyobrażenie o SDK zamiast SDK.                            */

const TRESC = "Czy nóż pasuje?" as TrescBezpieczna;

/** Klient, którego jedyną umiejętnością jest wywrócić się tak, jak podano. */
function klientRzucajacy(e: unknown) {
  _ustawKlienta({ messages: { parse: async () => { throw e; } } } as unknown as Anthropic);
}

const odpowiedzDostawcy = (status: number, typ: string, komunikat: string) =>
  Anthropic.APIError.generate(
    status, { type: "error", error: { type: typ, message: komunikat } },
    undefined, new Headers({ "request-id": "req_011Ce" }));

test("529 overloaded_error staje się przeciążeniem, nie zwykłą odmową", async () => {
  klientRzucajacy(odpowiedzDostawcy(529, "overloaded_error", "Overloaded"));

  const e = await nadawcaAnthropic(TRESC).then(() => null, (b) => b);
  assert.ok(e instanceof BladPrzeciazeniaCopilota,
    `529 ma zatrzymać partię, a dostał klasę ${(e as Error)?.constructor.name}`);
  assert.equal((e as BladPrzeciazeniaCopilota).status, 529);
});

test("zdanie dla człowieka nie niesie surowej odpowiedzi dostawcy", async () => {
  klientRzucajacy(odpowiedzDostawcy(529, "overloaded_error", "Overloaded"));

  const e = await nadawcaAnthropic(TRESC).then(() => null, (b) => b) as Error;
  /* Blizna z 0.191.0: na ekran szło `529 {"type":"error",…}`. Agent czytający
     zrzut JSON-a uczy się, że w tym miejscu nic dla niego nie ma. */
  assert.doesNotMatch(e.message, /[{}]/, "żadnego JSON-a w zdaniu na ekran");
  assert.doesNotMatch(e.message, /req_011Ce/, "identyfikator żądania należy do księgi");
  assert.match(e.message, /spróbuj za chwilę/i, "zdanie ma powiedzieć, CO ZROBIĆ");
  assert.match((e as BladPrzeciazeniaCopilota).slad, /overloaded_error 529 req_011Ce/,
    "ślad do księgi ma nieść typ, status i identyfikator żądania");
});

test("500 bez nazwanego typu też jest przeciążeniem — to nadal nie wina rozmowy", async () => {
  klientRzucajacy(odpowiedzDostawcy(500, "api_error", "boom"));

  const e = await nadawcaAnthropic(TRESC).then(() => null, (b) => b);
  assert.ok(e instanceof BladPrzeciazeniaCopilota,
    "awaria po tamtej stronie powtórzy się na następnej rozmowie tak samo");
});

test("400 zostaje zwykłą odmową i NIE zatrzymuje partii", async () => {
  klientRzucajacy(odpowiedzDostawcy(400, "invalid_request_error", "zła prośba"));

  const e = await nadawcaAnthropic(TRESC).then(() => null, (b) => b);
  /* Rozdział jest sednem poprawki: 4xx bywa winą JEDNEGO żądania, więc partia
     leci dalej. 5xx opisuje dostawcę, więc partia staje. */
  assert.ok(e instanceof BladOdpowiedziCopilota);
  assert.ok(!(e instanceof BladPrzeciazeniaCopilota));
  assert.equal((e as BladOdpowiedziCopilota).status, 400);
});

test("429 i 401 dalej mają swoje klasy — poprawka ich nie przykryła", async () => {
  klientRzucajacy(odpowiedzDostawcy(429, "rate_limit_error", "za szybko"));
  const limit = await nadawcaAnthropic(TRESC).then(() => null, (b) => b);
  assert.ok(limit instanceof BladLimituCopilota);

  klientRzucajacy(odpowiedzDostawcy(401, "authentication_error", "zły klucz"));
  const klucz = await nadawcaAnthropic(TRESC).then(() => null, (b) => b);
  assert.ok(klucz instanceof BladKluczaCopilota);
});

test("brak sieci mówi o SIECI, choć SDK opakowuje go w APIError", async () => {
  klientRzucajacy(new Anthropic.APIConnectionError({ message: "getaddrinfo ENOTFOUND" }));

  const e = await nadawcaAnthropic(TRESC).then(() => null, (b) => b) as Error;
  /* Blizna z 0.191.0: `APIConnectionError` DZIEDZICZY po `APIError`, więc
     gałąź o braku internetu stojąca niżej była martwa, a zerwana sieć
     meldowała się jako „Anthropic odpowiedziało ?" — czyli twierdziła, że
     dostawca odpowiedział, choć nie został nawet zapytany. Ten test pilnuje
     KOLEJNOŚCI `instanceof`, która jest tu logiką, nie stylem. */
  assert.ok(e instanceof BladLacznosciCopilota,
    `zerwana sieć dostała klasę ${e?.constructor.name}`);
  assert.ok(!(e instanceof BladPrzeciazeniaCopilota),
    "reakcja jest inna: przy przeciążeniu się czeka, tu ktoś idzie do serwera");
  assert.match(e.message, /internet i zaporę na serwerze/);
  assert.match((e as BladLacznosciCopilota).slad, /ENOTFOUND/,
    "przyczyna techniczna należy do księgi, nie do zdania na ekranie");
});

/* ── Odpowiedź, której nie da się odczytać (blizna 0.253.1) ──────────────────
   Zgłoszenie właściciela: „Copilot wywrócił się przed wysyłką — to usterka po
   naszej stronie". Zdanie prawdziwe i bezużyteczne — nie mówiło ani co się
   stało, ani co zrobić.

   Mechanizm: `lib/parser.js` rzuca GOŁYM `AnthropicError`, gdy tekst modelu
   nie daje się sparsować. `APIError` dziedziczy po `AnthropicError`, więc
   sprawdzenie musi iść w tę stronę, a nie odwrotnie — i to jest cała pułapka
   tej poprawki.

   Przyczyną po tamtej stronie był sufit `max_tokens` zderzony z nową listą
   `twierdzenia` z 0.253.0: JSON urywał się w połowie.                       */

const FAKTY = "F1: Gaźnik W09-0211 dostępny dziś" as FaktyBezpieczne;

test("nieodczytana odpowiedź modelu mówi o LIMICIE, nie o usterce bez wskazówki", async () => {
  klientRzucajacy(new Anthropic.AnthropicError(
    "Failed to parse structured output: SyntaxError: Unexpected end of JSON input"));

  const e = await nadawcaSzkicuAnthropic(TRESC, FAKTY).then(() => null, (b) => b);
  assert.ok(e instanceof BladOdpowiedziCopilota,
    `dostał klasę ${(e as Error)?.constructor.name}`);
  const b = e as BladOdpowiedziCopilota;
  assert.match(b.message, /nie zmieścił się w limicie/);
  assert.equal(/usterka po naszej stronie/.test(b.message), false,
    "wróciło zdanie bez wskazówki, czyli blizna 0.253.1 od nowa");
  /* Surowy tekst do KSIĘGI, nie na ekran — tam się szuka przyczyny. */
  assert.match(b.slad, /^parsowanie: Failed to parse structured output/);
});

test("błąd SDK ze statusem dalej idzie swoją gałęzią, mimo wspólnego przodka", async () => {
  /* `APIError` też jest `AnthropicError`. Gdyby nowa gałąź stała bez wyjątku
     na `APIError`, przykryłaby wszystkie odmowy dostawcy naraz. */
  klientRzucajacy(odpowiedzDostawcy(529, "overloaded_error", "Overloaded"));
  const e = await nadawcaSzkicuAnthropic(TRESC, FAKTY).then(() => null, (b) => b);
  assert.ok(e instanceof BladPrzeciazeniaCopilota,
    `529 przykryte przez gałąź parsowania: ${(e as Error)?.constructor.name}`);
});

/* ── Model klasyfikacji i parametr wysiłku (22 września 2026) ───────────────
   Klasyfikacja idzie WŁASNYM modelem. Haiku 4.5 i Sonnet 4.5 odrzucają
   `effort` błędem 400 wg dokumentacji Anthropic — żądanie do nich idzie bez
   niego, reszta modeli dostaje wysiłek jak dotąd. */
test("wysiłek idzie tylko do modeli, które go przyjmują", () => {
  assert.equal(wspieraWysilek("claude-opus-5"), true);
  assert.equal(wspieraWysilek("claude-sonnet-5"), true);
  assert.equal(wspieraWysilek("claude-haiku-4-5"), false);
  assert.equal(wspieraWysilek("claude-sonnet-4-5"), false);
});

test("klasyfikacja wysyła model z modelKlasyfikacji i oddaje go w odpowiedzi", async () => {
  const { config } = await import("../config.js");
  const bylo = config.copilot.modelKlasyfikacji;
  (config.copilot as { modelKlasyfikacji: string }).modelKlasyfikacji = "claude-haiku-4-5";
  let wyslane: Record<string, unknown> = {};
  _ustawKlienta({ messages: { parse: async (p: Record<string, unknown>) => {
    wyslane = p;
    return { parsed_output: { kategoria: "OTHER" }, model: undefined, stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 } };
  } } } as unknown as Anthropic);
  try {
    const odp = await nadawcaAnthropic(TRESC);
    assert.equal(wyslane.model, "claude-haiku-4-5");
    assert.equal("effort" in (wyslane.output_config as object), false, "Haiku 4.5 odrzuca effort");
    assert.equal(odp.model, "claude-haiku-4-5", "księga ma zapisać model, którym naprawdę liczono");
  } finally {
    (config.copilot as { modelKlasyfikacji: string }).modelKlasyfikacji = bylo;
    _ustawKlienta(null);
  }
});

/* Ten sam warunek przy pozostałych zadaniach: `COPILOT_MODEL` na Haiku 4.5
   dawał 400 na każdym szkicu, dopytaniu, kluczu i karcie reklamacyjnej. */
test("szkic i klucz modelu też nie wysyłają wysiłku do Haiku 4.5", async () => {
  const { config } = await import("../config.js");
  const bylo = config.copilot.model;
  (config.copilot as { model: string }).model = "claude-haiku-4-5";
  const wyslane: Record<string, unknown>[] = [];
  _ustawKlienta({ messages: { parse: async (p: Record<string, unknown>) => {
    wyslane.push(p);
    return { parsed_output: null, model: undefined, stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 } };
  } } } as unknown as Anthropic);
  try {
    await nadawcaSzkicuAnthropic(TRESC, FAKTY).catch(() => null);
    await nadawcaKluczaAnthropic("FS450", { kartoteka: "Nóż", oferta: null, marki: [] });
    assert.equal(wyslane.length, 2);
    for (const p of wyslane) {
      assert.equal("effort" in (p.output_config as object), false, "Haiku 4.5 odrzuca effort");
    }
  } finally {
    (config.copilot as { model: string }).model = bylo;
    _ustawKlienta(null);
  }
});

/* ── Pętla narzędzi dopytania (0.507.0) ─────────────────────────────────────
   Atrapa klienta oddaje CIĄG odpowiedzi, jak dostawca w kolejnych rundach.
   Sprawdzamy to, czego nie sprawdzi test serwisu z atrapą nadawcy: że wyniki
   narzędzi wracają do modelu w jednej wiadomości, że zdanie wstępu przed
   wywołaniem nie wywraca parsowania, że tokeny sumują się po rundach i że
   sufit rund kończy pętlę wymuszoną odpowiedzią.                          */

const ODPOWIEDZ = JSON.stringify({ tresc: "Pasuje do MS 230 (WZ4).", twierdzenia: [] });
const zuzycieRundy = { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 };

function kontekstPytania(narzedzia: ZestawNarzedzi | null): KontekstPytania {
  return {
    watek: TRESC, fakty: FAKTY, zdjecia: [], szkic: null, historia: [],
    pytanie: "Pasuje do MS 230?", narzedzia,
  };
}

function atrapaNarzedzi() {
  const wywolania: Array<{ nazwa: string; wejscie: unknown }> = [];
  const zestaw: ZestawNarzedzi = {
    definicje: [{
      name: "karta_towaru", description: "karta", strict: true,
      input_schema: { type: "object", properties: { zapytanie: { type: "string", description: "s" } },
        required: ["zapytanie"], additionalProperties: false },
    }],
    wykonaj(nazwa, wejscie) {
      wywolania.push({ nazwa, wejscie });
      return { wynik: "Kartoteka GAZ-1: gaźnik" as WynikNarzedzia, blad: false };
    },
  };
  return { zestaw, wywolania };
}

/** Klient oddający kolejne odpowiedzi; zapamiętuje KOPIE żądań. */
function klientSekwencja(odpowiedzi: Array<(p: Record<string, unknown>) => Record<string, unknown>>) {
  const zadania: Array<Record<string, unknown>> = [];
  _ustawKlienta({ messages: { create: async (p: Record<string, unknown>) => {
    zadania.push(structuredClone({ ...p, output_config: { ...(p.output_config as object), format: "zod" } }));
    const nast = odpowiedzi[Math.min(zadania.length - 1, odpowiedzi.length - 1)]!;
    return nast(p);
  } } } as unknown as Anthropic);
  return zadania;
}

test("dopytanie: wynik narzędzia wraca do modelu, a wstęp przed wywołaniem nie wywraca parsowania", async () => {
  const { zestaw, wywolania } = atrapaNarzedzi();
  const zadania = klientSekwencja([
    () => ({
      stop_reason: "tool_use", model: "claude-opus-5", usage: zuzycieRundy,
      content: [
        { type: "text", text: "Sprawdzę kartotekę." },
        { type: "tool_use", id: "tu_1", name: "karta_towaru", input: { zapytanie: "GAZ-1" } },
      ],
    }),
    () => ({ stop_reason: "end_turn", model: "claude-opus-5", usage: zuzycieRundy,
      content: [{ type: "text", text: ODPOWIEDZ }] }),
  ]);
  try {
    const o = await nadawcaPytaniaAnthropic(kontekstPytania(zestaw));
    assert.equal(o.tresc, "Pasuje do MS 230 (WZ4).");
    assert.deepEqual(wywolania, [{ nazwa: "karta_towaru", wejscie: { zapytanie: "GAZ-1" } }]);
    assert.deepEqual(o.narzedzia, [{ nazwa: "karta_towaru", argument: "GAZ-1", znakow: 23 }]);
    assert.deepEqual([o.zuzycie.wej, o.zuzycie.wyj, o.zuzycie.cacheOdczyt], [200, 20, 100], "suma z obu rund");

    assert.equal(zadania.length, 2);
    const druga = zadania[1]!.messages as Array<{ role: string; content: unknown }>;
    assert.equal(druga.length, 3, "pytanie, tura modelu, wyniki narzędzi");
    assert.equal(druga[1]!.role, "assistant");
    const wyniki = druga[2]!.content as Array<Record<string, unknown>>;
    assert.deepEqual(wyniki.map((w) => [w.type, w.tool_use_id, w.is_error]), [["tool_result", "tu_1", false]]);
    assert.ok(Array.isArray(zadania[0]!.tools), "pierwsza runda niesie narzędzia");
    assert.equal(zadania[0]!.tool_choice, undefined, "model sam decyduje, czy sięgnąć");
  } finally {
    _ustawKlienta(null);
  }
});

test("dopytanie: sufit rund kończy pętlę rundą bez narzędzi", async () => {
  const { zestaw, wywolania } = atrapaNarzedzi();
  const zadania = klientSekwencja([(p) => (p.tool_choice
    ? { stop_reason: "end_turn", model: "m", usage: zuzycieRundy, content: [{ type: "text", text: ODPOWIEDZ }] }
    : { stop_reason: "tool_use", model: "m", usage: zuzycieRundy,
      content: [{ type: "tool_use", id: `tu_${Math.random()}`, name: "karta_towaru", input: { zapytanie: "X" } }] })]);
  try {
    const o = await nadawcaPytaniaAnthropic(kontekstPytania(zestaw));
    assert.equal(o.tresc, "Pasuje do MS 230 (WZ4).");
    assert.equal(wywolania.length, SUFIT_RUND_NARZEDZI, "tyle rund z narzędziami, ani jednej więcej");
    assert.equal(zadania.length, SUFIT_RUND_NARZEDZI + 1);
    assert.deepEqual(zadania.at(-1)!.tool_choice, { type: "none" });
  } finally {
    _ustawKlienta(null);
  }
});

test("dopytanie bez zestawu nie wysyła narzędzi, a ucięta odpowiedź niesie koszt rund", async () => {
  const zadania = klientSekwencja([() => ({
    stop_reason: "max_tokens", model: "m", usage: zuzycieRundy, content: [{ type: "text", text: "{\"tre" }],
  })]);
  try {
    const e = await nadawcaPytaniaAnthropic(kontekstPytania(null)).then(() => null, (x: unknown) => x);
    assert.ok(e instanceof BladOdpowiedziCopilota);
    assert.equal((e as { zuzycie?: { wej: number } }).zuzycie?.wej, 100, "koszt uciętej rundy idzie do księgi");
    assert.equal("tools" in zadania[0]!, false);
  } finally {
    _ustawKlienta(null);
  }
});

/* ── Pasowanie z sieci (0.507.0) ────────────────────────────────────────────
   Tu sprawdzamy to, czego nie widzi test serwisu: że Allegro jest zablokowane
   w OBU narzędziach serwerowych, że tekst przeczytanych stron wraca do sita,
   że `pause_turn` wznawia się bez nowej wiadomości i że wyszukiwania liczą się
   do kosztu. */

test("pasowanie z sieci: Allegro zablokowane w wyszukiwarce i w pobieraniu, strony wracają do sita", async () => {
  const { nadawcaPasowaniaSieciAnthropic } = await import("./copilot.anthropic.js");
  const wynik = JSON.stringify({ znaleziska: [{
    rodzaj: "maszyna", marka: "Stihl", model: "MS 250", wariant: null,
    url: "https://czesci.example.com/a", cytat: "Stihl MS 250", zrodloStrony: "sklep",
    rokOd: null, rokDo: null, seryjnyOd: null, seryjnyDo: null,
  }] });
  const uzycie = (wysz: number) => ({ ...zuzycieRundy, server_tool_use: { web_search_requests: wysz, web_fetch_requests: 1 } });
  const zadania = klientSekwencja([
    () => ({ stop_reason: "pause_turn", model: "m", usage: uzycie(2), content: [
      { type: "server_tool_use", id: "s1", name: "web_fetch", input: { url: "https://czesci.example.com/a" } },
      { type: "web_fetch_tool_result", tool_use_id: "s1", content: { type: "web_fetch_result",
        url: "https://czesci.example.com/a", retrieved_at: null,
        content: { type: "document", title: null, citations: null,
          source: { type: "text", media_type: "text/plain", data: "Nr 1123 120 0650. Stihl MS 250" } } } },
      { type: "web_fetch_tool_result", tool_use_id: "s2", content: { type: "web_fetch_result",
        url: "https://producent.example.com/ipl.pdf", retrieved_at: null,
        content: { type: "document", title: null, citations: null,
          source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } } } },
    ] }),
    () => ({ stop_reason: "end_turn", model: "m", usage: uzycie(1), content: [{ type: "text", text: wynik }] }),
  ]);
  try {
    const o = await nadawcaPasowaniaSieciAnthropic({ symbol: "GAZ-1", nazwa: "Gaźnik", numery: ["1123 120 0650"] });
    for (const t of zadania[0]!.tools as Array<{ name: string; blocked_domains?: string[] }>) {
      assert.ok(t.blocked_domains?.includes("allegro.pl"), `${t.name} bez blokady Allegro`);
    }
    assert.deepEqual(o.strony, [{ url: "https://czesci.example.com/a", tekst: "Nr 1123 120 0650. Stihl MS 250" }]);
    assert.deepEqual(o.pdfy, [{ url: "https://producent.example.com/ipl.pdf", base64: "JVBERi0=" }],
      "PDF wraca surowy — tekst wyciąga serwis, nie adapter");
    assert.equal(o.znaleziska.length, 1);
    assert.equal(o.wyszukiwan, 3, "wyszukiwania z obu tur — płatne od sztuki");
    assert.equal(zadania.length, 2);
    const druga = zadania[1]!.messages as Array<{ role: string }>;
    assert.deepEqual(druga.map((m) => m.role), ["user", "assistant"], "wznowienie bez nowej wiadomości");
    const tresc = String((zadania[0]!.messages as Array<{ content: string }>)[0]!.content);
    assert.ok(tresc.includes("1123 120 0650"), "numer OEM to klucz wyszukiwania");
    /* Właściciel (@wydanie): nasz symbol trafia najwyżej w naszą aukcję, więc
       nie idzie do dostawcy wcale — inaczej model wydaje na nim wyszukiwania. */
    assert.ok(!tresc.includes("GAZ-1"), "nasz symbol nie idzie do dostawcy");
  } finally {
    _ustawKlienta(null);
  }
});
