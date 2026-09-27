import { describe, expect, it } from "vitest";
import rejestr from "../../../server/src/services/zdarzenia-rejestr.ts?raw";
import { NAZWA_ZDARZENIA, TECHNICZNE, nazwaZdarzenia } from "./nazwy";
import { opisZdarzenia } from "./opis";

/* ── Każdy typ z rejestru serwera ma polską nazwę (@wydanie) ─────────────
   Rejestr `services/zdarzenia-rejestr.ts` pilnuje na serwerze, że każdy
   `logEvent` jest w nim wpisany. Ten test domyka łańcuch po stronie panelu:
   typ dopisany do rejestru bez polskiej nazwy wróciłby na ekran surowym
   kluczem, czyli dokładnie tym, co wariant C z makiet usunął. */
const typyRejestru = (() => {
  const lista = rejestr.slice(rejestr.indexOf("ZDARZENIA"), rejestr.indexOf("];", rejestr.indexOf("ZDARZENIA")));
  return [...lista.matchAll(/"([a-z_0-9.]+)"/g)].map((m) => m[1]);
})();

describe("nazwy zdarzeń dziennika", () => {
  it("strażnik widzi rejestr — pusta lista przepuściłaby wszystko", () => {
    expect(typyRejestru.length).toBeGreaterThan(250);
  });

  it("każdy typ z rejestru ma polską nazwę", () => {
    expect(typyRejestru.filter((t) => !NAZWA_ZDARZENIA[t])).toEqual([]);
  });

  it("pomiary techniczne to typy z rejestru, nie literówki", () => {
    expect(TECHNICZNE.filter((t) => !typyRejestru.includes(t))).toEqual([]);
  });

  it("typ spoza słownika wraca surowym kluczem, nie znika", () => {
    expect(nazwaZdarzenia("typ_z_przyszlosci")).toBe("typ_z_przyszlosci");
  });
});

describe("opis zdarzenia", () => {
  it("typy magazynu mówią zdaniem, nie JSON-em", () => {
    expect(opisZdarzenia("queue_failed", '{"queueId":8,"typ":"set_location","proby":3,"blad":"Kartoteka w edycji"}'))
      .toBe("3 próby · „Kartoteka w edycji”");
    expect(opisZdarzenia("location_mismatch", '{"expected":"G01-02-03","actual":"G01-02-07"}'))
      .toBe("miała być G01-02-03, jest G01-02-07");
    expect(opisZdarzenia("przesuniecie", '{"qty":40,"kodFrom":"MGP","kodTo":"MAG","location":"J02-02-03"}'))
      .toBe("40 szt. · MGP → MAG · J02-02-03");
  });

  it("typ bez własnego zdania dostaje pary z danych — nic nie ginie", () => {
    expect(opisZdarzenia("zwrot_kwota", '{"zwrotId":12,"kwota":49.9,"uwaga":""}')).toBe("zwrotId 12 · kwota 49.9");
  });

  it("brak danych i dane nie w JSON-ie nie wywracają opisu", () => {
    expect(opisZdarzenia("scan", null)).toBe("");
    expect(opisZdarzenia("scan", "nie-json")).toBe("nie-json");
    expect(opisZdarzenia("scan", "[1,2]")).toBe("[1,2]");
  });

  it("długi opis jest przycięty, a całość zostaje w dymku", () => {
    const dlugi = JSON.stringify({ tekst: "x".repeat(400) });
    expect(opisZdarzenia("zwrot_notatka", dlugi).length).toBeLessThanOrEqual(160);
  });
});
