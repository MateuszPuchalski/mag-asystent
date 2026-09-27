import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dniRoboczeOd, najwazniejszaDosylka, opisDosylki, poDniachRoboczych, type DosylkaSprawy, type StanDosylki,
} from "./dosylka-opis.js";

/* ── Zdanie o dosyłce i dni robocze (@wydanie, S6) ───────────────────────────
   Zdanie składa serwer, panel tylko je drukuje — więc brzmienie z umowy
   z panelem pilnujemy tutaj, słowo po słowie. Dni robocze i „dziś” liczą
   się na zegarze magazynu: w UTC piątkowa noc byłaby jeszcze piątkiem. */

/* 25.09.2026 to piątek, 28.09 poniedziałek; czas letni, UTC+2. */
const stan = (s: Partial<StanDosylki>): StanDosylki => ({
  waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null,
  zalozonoAt: "2026-09-28T08:00:00.000Z", ...s,
});
const TERAZ = new Date("2026-09-29T12:30:00Z"); // wtorek 14:30 w magazynie

test("bez numeru: czekamy, potem stan z godziną, a z datą, gdy nie z dziś", () => {
  assert.deepEqual(opisDosylki(stan({}), TERAZ),
    { opis: "Czekamy na numer dosyłki z Allegro", ton: null, bezNumeru: false });
  assert.equal(opisDosylki(stan({ sprawdzonoAt: "2026-09-29T12:10:00.000Z" }), TERAZ).opis,
    "Allegro nie ma jeszcze numeru dosyłki (stan z 14:10)");
  assert.equal(opisDosylki(stan({ sprawdzonoAt: "2026-09-28T21:50:00.000Z" }), TERAZ).opis,
    "Allegro nie ma jeszcze numeru dosyłki (stan z 28.09 23:50)", "wczorajszy stan nie udaje dzisiejszego");
});

test("dwa dni robocze bez numeru: ton uwagi i prośba o numer z Sellasist", () => {
  const poniedzialek = stan({ sprawdzonoAt: "2026-09-30T09:00:00.000Z" });
  assert.equal(opisDosylki(poniedzialek, TERAZ).bezNumeru, false, "wtorek to jeden dzień roboczy");
  assert.deepEqual(opisDosylki(poniedzialek, new Date("2026-09-30T10:00:00Z")), {
    opis: "Allegro nie ma numeru dosyłki od 2 dni roboczych — wpisz go z Sellasist", ton: "uwaga", bezNumeru: true,
  });
  /* Weekend się nie liczy: z piątku na poniedziałek to jeden dzień. */
  const piatek = stan({ zalozonoAt: "2026-09-25T10:00:00.000Z" });
  assert.equal(opisDosylki(piatek, new Date("2026-09-28T10:00:00Z")).bezNumeru, false);
  assert.equal(opisDosylki(piatek, new Date("2026-09-29T10:00:00Z")).bezNumeru, true);
});

test("doba magazynu, nie UTC: piątek 23:30 i wtorek 00:30 to dwa dni robocze", () => {
  /* W UTC to piątek 21:30 i poniedziałek 22:30 — jeden dzień, więc „brak
     numeru” zapaliłby się dobę za późno. */
  assert.equal(dniRoboczeOd("2026-09-25T21:30:00.000Z", new Date("2026-09-28T22:30:00Z")), 2);
  assert.equal(dniRoboczeOd("nie-data", TERAZ), 0, "zepsuta data milczy");
  assert.equal(dniRoboczeOd("2026-09-30T10:00:00Z", TERAZ), 0, "przyszłość to zero, nie liczba ujemna");
});

test("z numerem: doręczona, kłopot, powrót, OTHER, w drodze, jeszcze niesprawdzona", () => {
  const z = (s: Partial<StanDosylki>) => opisDosylki(stan({ waybill: "AD1", przewoznik: "INPOST", ...s }), TERAZ);
  assert.deepEqual(z({ dostarczonoAt: "2026-09-30T08:00:00Z", status: "DELIVERED" }),
    { opis: "Dosyłka doręczona 30.09", ton: "ok", bezNumeru: false });
  assert.deepEqual(z({ status: "ISSUE", sprawdzonoAt: "2026-09-29T10:00:00Z" }),
    { opis: "Przewoźnik zgłosił problem z dosyłką", ton: "zle", bezNumeru: false });
  assert.deepEqual(z({ status: "RETURNED", sprawdzonoAt: "2026-09-29T10:00:00Z" }),
    { opis: "Dosyłka wraca do nadawcy", ton: "zle", bezNumeru: false });
  assert.equal(z({ przewoznik: "OTHER" }).opis, "Przewoźnik spoza Allegro — nie śledzimy");
  assert.equal(z({}).opis, "Dosyłka nadana — czekamy na pierwszy stan");
  assert.equal(z({ status: "IN_TRANSIT", sprawdzonoAt: "2026-09-29T12:00:00Z" }).opis, "Dosyłka w drodze (stan z 14:00)");
  assert.equal(z({ sprawdzonoAt: "2026-09-29T12:00:00Z" }).opis, "Dosyłka w drodze (stan z 14:00)",
    "przewoźnik bez statusu to też „w drodze” — numer jest, paczka jedzie");
  /* Numer z dawna, a dni robocze lecą — z numerem nie ma „brak numeru”. */
  assert.equal(z({ zalozonoAt: "2026-09-01T10:00:00Z" }).bezNumeru, false);
});

test("domyślny termin: trzy dni robocze o 8:00 w magazynie, także przez zmianę czasu", () => {
  /* Piątek 15:00 → środa 8:00 czasu letniego (6:00 UTC). */
  assert.equal(poDniachRoboczych(new Date("2026-09-25T13:00:00Z"), 3).toISOString(), "2026-09-30T06:00:00.000Z");
  /* Czwartek 22.10 → wtorek 27.10, już po zmianie na czas zimowy (7:00 UTC). */
  assert.equal(poDniachRoboczych(new Date("2026-10-22T13:00:00Z"), 3).toISOString(), "2026-10-27T07:00:00.000Z");
  /* Piątek 23:30 w magazynie (21:30 UTC): następny dzień roboczy to poniedziałek. */
  assert.equal(poDniachRoboczych(new Date("2026-09-25T21:30:00Z"), 1).toISOString(), "2026-09-28T06:00:00.000Z");
  /* Sobota 00:30 w magazynie (piątek 22:30 UTC): pierwszy roboczy to poniedziałek. */
  assert.equal(poDniachRoboczych(new Date("2026-09-25T22:30:00Z"), 1).toISOString(), "2026-09-28T06:00:00.000Z");
});

test("„Moje” mówi o dosyłce, która woła: kłopot, brak numeru, w drodze, doręczona", () => {
  const d = (zamowienie: string, s: Partial<DosylkaSprawy>): DosylkaSprawy => ({
    zamowienie, waybill: "W", przewoznik: "DPD", przewoznikZamowienia: null, zrodlo: "allegro", status: null,
    dostarczonoAt: null, sprawdzonoAt: null, zalozonoAt: "2026-09-28T08:00:00Z", bezNumeru: false,
    opis: zamowienie, ton: null, ...s,
  });
  const doreczona = d("doręczona", { dostarczonoAt: "2026-09-29T08:00:00Z", ton: "ok" });
  const wDrodze = d("w drodze", {});
  const bezNumeru = d("bez numeru", { waybill: null });
  const klopot = d("kłopot", { status: "ISSUE", ton: "zle" });
  assert.equal(najwazniejszaDosylka([doreczona, wDrodze, bezNumeru, klopot])?.opis, "kłopot");
  assert.equal(najwazniejszaDosylka([doreczona, wDrodze, bezNumeru])?.opis, "bez numeru");
  assert.equal(najwazniejszaDosylka([doreczona, wDrodze])?.opis, "w drodze");
  assert.equal(najwazniejszaDosylka([doreczona])?.opis, "doręczona");
  assert.equal(najwazniejszaDosylka([]), null);
});
