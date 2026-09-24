import { describe, expect, it } from "vitest";
import { koszeKubelka } from "./Kolejka";
import type { WierszKosza } from "../api/kosze";

const KOSZ = (n: Partial<WierszKosza>): WierszKosza => ({
  id: 1, kod: "K-1", status: "rozlozony", pozycji: 3, odlozonych: 3, pominietych: 0,
  mmNumer: null, utworzonoAt: "2026-09-20T08:00:00Z", zamknietoAt: null, zamknietoPrzez: null,
  rozlozonoAt: null, rozlozonoPrzez: null, rodzaj: "zwroty", anulowanoAt: null,
  anulowanoPrzez: null, zwrotow: 1, brakujeKorekt: 0, mmStan: "brak" as WierszKosza["mmStan"],
  wirtualny: false, ...n,
});

/* ── Rozłożone po chwili rozłożenia (0.486.4) ────────────────────────────────
   Zgłoszenie właściciela: „rozłożone koszyki układaj kolejnością rozłożenia".
   Kosz założony wcześniej bywa rozłożony później — porządek serwera (po
   założeniu) mieszał dzień pracy hali. */
describe("kolejność koszy w kubełku", () => {
  it("rozłożone: najświeżej rozłożony na górze, bez chwili — na końcu", () => {
    const lista = [
      KOSZ({ id: 1, kod: "K-1", rozlozonoAt: "2026-09-24T09:00:00Z" }),
      KOSZ({ id: 2, kod: "K-2", rozlozonoAt: null }),
      KOSZ({ id: 3, kod: "K-3", rozlozonoAt: "2026-09-24T11:30:00Z" }),
      KOSZ({ id: 4, kod: "K-4", status: "zamkniety", rozlozonoAt: null }),
      KOSZ({ id: 5, kod: "K-5", rozlozonoAt: "2026-09-23T15:00:00Z" }),
    ];
    expect(koszeKubelka(lista, "rozlozone").map((k) => k.kod)).toEqual(["K-3", "K-1", "K-5", "K-2"]);
  });

  it("pozostałe kubełki zostają w porządku serwera", () => {
    const lista = [KOSZ({ id: 9, kod: "K-9", status: "zamkniety" }),
      KOSZ({ id: 8, kod: "K-8", status: "otwarty" })];
    expect(koszeKubelka(lista, "praca").map((k) => k.kod)).toEqual(["K-9", "K-8"]);
  });
});
