import { describe, expect, it } from "vitest";
import type { StanPrzesylki, Zamowienie } from "../api/typy";
import { stanZakupu } from "./zakup";

/* ── CO WIEMY O ZAKUPIE ─────────────────────────────────────────────────────
   Testy pilnują, że nie wymyślamy tego, czego Allegro nie podaje: „nadane"
   bez daty i „nieznane", gdy przesyłki nie sprawdzano. */

const zam = (n: Partial<Zamowienie> = {}): Zamowienie => ({
  externalId: "17147703077", status: "READY_FOR_PROCESSING", kupujacyLogin: "k",
  dostawaGrosze: null, dostawaMetoda: null, platnoscTyp: "ONLINE",
  platnoscAt: "2026-10-02T14:12:00.000Z", fakturaZadana: null, sumaGrosze: 8999, waluta: "PLN",
  kupionoAt: "2026-10-02T14:10:00.000Z", link: null, pozycje: [], ...n,
} as unknown as Zamowienie);

const przes = (n: Partial<StanPrzesylki> = {}): StanPrzesylki => ({
  waybill: null, przewoznik: null, status: null, dostarczonoAt: null,
  sprawdzonoAt: "2026-10-03T08:00:00.000Z", ...n,
});

const krok = (s: ReturnType<typeof stanZakupu>, k: string) => s.kroki.find((x) => x.klucz === k)!;

describe("stanZakupu", () => {
  it("złożone i opłacone mają daty z zamówienia", () => {
    const s = stanZakupu(zam(), null);
    expect(krok(s, "zlozone")).toMatchObject({ stan: "tak", at: "2026-10-02T14:10:00.000Z" });
    expect(krok(s, "oplacone")).toMatchObject({ stan: "tak", at: "2026-10-02T14:12:00.000Z" });
  });

  it("opłacone bez daty też jest opłacone, gdy Allegro mówi READY_FOR_PROCESSING", () => {
    expect(krok(stanZakupu(zam({ platnoscAt: null }), null), "oplacone")).toMatchObject({ stan: "tak", at: null });
  });

  it("zamówienie jeszcze nie opłacone nie udaje opłaconego", () => {
    const s = stanZakupu(zam({ platnoscAt: null, status: "FILLED_IN" }), null);
    expect(krok(s, "oplacone").stan).toBe("nie");
  });

  it("za pobraniem nie ma daty wpłaty i nie jest ani opłacone, ani nieopłacone", () => {
    const k = krok(stanZakupu(zam({ platnoscTyp: "CASH_ON_DELIVERY", platnoscAt: null }), null), "oplacone");
    expect(k).toMatchObject({ etykieta: "Za pobraniem", stan: "nieznane" });
  });

  it("bez sprawdzenia przesyłki „nadane” i „dostarczone” są NIEZNANE, nie „nie”", () => {
    /* „Nie sprawdzano" i „sprawdzono, nic nie ma" to dwa różne następne ruchy agenta. */
    for (const p of [null, przes({ sprawdzonoAt: null })]) {
      const s = stanZakupu(zam(), p);
      expect(krok(s, "nadane").stan).toBe("nieznane");
      expect(krok(s, "dostarczone").stan).toBe("nieznane");
      expect(s.przesylkaNieSprawdzona).toBe(true);
    }
  });

  it("sprawdzono i nie ma numeru: nadane NIE, dostarczone NIE", () => {
    const s = stanZakupu(zam(), przes());
    expect(krok(s, "nadane").stan).toBe("nie");
    expect(krok(s, "dostarczone").stan).toBe("nie");
    expect(s.przesylkaNieSprawdzona).toBe(false);
  });

  it("numer przesyłki znaczy nadane, ale bez daty, której Allegro nie podaje", () => {
    const k = krok(stanZakupu(zam(), przes({ waybill: "JJD0001", przewoznik: "dpd" })), "nadane");
    expect(k).toMatchObject({ stan: "tak", at: null });
    expect(k.uwaga).toMatch(/nie podaje daty/);
  });

  it("dostarczone ma datę z trackingu", () => {
    const s = stanZakupu(zam(), przes({ waybill: "JJD0001", dostarczonoAt: "2026-10-04T09:00:00.000Z" }));
    expect(krok(s, "dostarczone")).toMatchObject({ stan: "tak", at: "2026-10-04T09:00:00.000Z" });
  });

  it("anulowane zamówienie jest oznaczone", () => {
    expect(stanZakupu(zam({ status: "CANCELLED" }), null).anulowane).toBe(true);
    expect(stanZakupu(zam(), null).anulowane).toBe(false);
  });
});
