import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { _ustawKlienta, nadawcaAnthropic } from "./copilot.anthropic.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladOdpowiedziCopilota, BladPrzeciazeniaCopilota,
} from "./copilot.js";
import type { TrescBezpieczna } from "../services/copilot-maskowanie.js";

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
