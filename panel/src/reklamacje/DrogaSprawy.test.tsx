import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";
import { dzienMiesiac } from "../ui";
import { DrogaSprawy, krokiDrogi } from "./DrogaSprawy";

/* ── Droga sprawy ────────────────────────────────────────────────────────────
   Pilnujemy kolejności sześciu kroków, stanu każdego z nich i tego, że brak
   danych zostaje brakiem: krok bez daty nie dostaje daty zgadniętej z innej. */

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  kupionoAt: "2026-09-18T10:00:00.000Z", otwartoAt: "2026-09-28T12:32:00.000Z", zgloszonoPoDniach: 10,
  wiadomosciIle: 5, ostatniaWiadomoscAt: "2026-10-08T09:05:00.000Z",
  decyzjaDo: "2026-10-12T10:00:00.000Z", dniDoTerminu: 3, poTerminie: false,
  oczekiwanie: "EXCHANGE", statusAllegro: "CLAIM_SUBMITTED",
  werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktAt: null, ...n,
}) as Reklamacja;

const szczegol = (r: Partial<Reklamacja> = {}, reszta: Partial<SzczegolReklamacji> = {}) => ({
  reklamacja: rek(r),
  zamowienie: { kupionoAt: "2026-09-18T10:00:00.000Z", platnoscAt: "2026-09-18T10:02:00.000Z" },
  przesylka: { waybill: null, przewoznik: "InPost", status: "DELIVERED",
    dostarczonoAt: "2026-09-20T09:00:00.000Z", sprawdzonoAt: "2026-09-20T10:00:00.000Z" },
  ...reszta,
}) as unknown as SzczegolReklamacji;

const krok = (s: SzczegolReklamacji, klucz: string) => krokiDrogi(s).find((k) => k.klucz === klucz)!;

describe("Droga sprawy", () => {
  it("sześć kroków w kolejności makiety, jako lista z nazwą", () => {
    render(<DrogaSprawy szczegol={szczegol()} />);
    const lista = screen.getByRole("list", { name: "Droga sprawy" });
    const nazwy = within(lista).getAllByRole("listitem").map((li) => li.textContent ?? "");
    ["Zakup", "Doręczono", "Zgłoszenie", "Rozmowa", "Decyzja", "Rozliczenie"]
      .forEach((n, i) => expect(nazwy[i]).toContain(n));
    /* Wąski ekran przewija rząd, zamiast go łamać. */
    expect(lista.className).toContain("overflow-x-auto");
  });

  it("przed werdyktem bieżąca jest decyzja, z terminem i liczbą dni", () => {
    render(<DrogaSprawy szczegol={szczegol()} />);
    const biezacy = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
    expect(biezacy).toHaveLength(1);
    expect(biezacy[0]).toHaveTextContent("Decyzja");
    expect(biezacy[0]).toHaveTextContent(`do ${dzienMiesiac("2026-10-12T10:00:00.000Z")} · 3 dni`);
    expect(krok(szczegol(), "zakup").stan).toBe("zrobiony");
    expect(krok(szczegol(), "rozliczenie").stan).toBe("przyszly");
  });

  it("podpisy mówią fakty: opłacono, przewoźnik, po ilu dniach, ile wiadomości", () => {
    const s = szczegol();
    expect(krok(s, "zakup").podpis).toBe(`${dzienMiesiac("2026-09-18T10:00:00.000Z")} · opłacono`);
    expect(krok(s, "doreczono").podpis).toBe(`${dzienMiesiac("2026-09-20T09:00:00.000Z")} · InPost`);
    expect(krok(s, "zgloszenie").podpis).toContain("po 10 dniach");
    expect(krok(s, "rozmowa").podpis).toContain("5 wiadomości");
    expect(krok(szczegol({ zgloszonoPoDniach: 1 }), "zgloszenie").podpis).toContain("po 1 dniu");
  });

  it("brak danych to krok bez daty, nie data zgadnięta z innego kroku", () => {
    const s = szczegol({}, {
      przesylka: { waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null },
    });
    expect(krok(s, "doreczono").podpis).toBe("");
    const bezTerminu = szczegol({ decyzjaDo: null, dniDoTerminu: null });
    expect(krok(bezTerminu, "decyzja").podpis).toBe("");
  });

  it("rozmowa bez wiadomości nie udaje, że się odbyła", () => {
    const k = krok(szczegol({ wiadomosciIle: 0, ostatniaWiadomoscAt: null }), "rozmowa");
    expect(k.stan).toBe("przyszly");
    expect(k.podpis).toBe("bez wiadomości");
  });

  it("po naszym uznaniu decyzja jest za nami, a bieżące jest rozliczenie", () => {
    const s = szczegol({ werdykt: "ACCEPTED_EXCHANGE", werdyktNazwa: "Uznana — wymiana",
      werdyktStatus: "sent", werdyktAt: "2026-10-09T11:42:00.000Z" });
    expect(krok(s, "decyzja")).toMatchObject({ stan: "zrobiony",
      podpis: `${dzienMiesiac("2026-10-09T11:42:00.000Z")} · Uznana — wymiana` });
    expect(krok(s, "rozliczenie")).toMatchObject({ stan: "biezacy", podpis: "wymiana" });
  });

  it("nieudany werdykt nie zamyka decyzji — dalej czeka", () => {
    const s = szczegol({ werdykt: "ACCEPTED_EXCHANGE", werdyktStatus: "send_failed" });
    expect(krok(s, "decyzja").stan).toBe("biezacy");
  });

  it("po odrzuceniu nic nie jest bieżące, a rozliczenia nie ma", () => {
    const s = szczegol({ statusAllegro: "CLAIM_REJECTED" });
    expect(krok(s, "decyzja")).toMatchObject({ stan: "zrobiony", podpis: "odrzucona poza panelem" });
    expect(krok(s, "rozliczenie")).toMatchObject({ stan: "przyszly", podpis: "bez rozliczenia" });
    render(<DrogaSprawy szczegol={s} />);
    expect(screen.getAllByRole("listitem").some((li) => li.hasAttribute("aria-current"))).toBe(false);
  });

  it("po terminie decyzja mówi, kiedy termin minął", () => {
    const k = krok(szczegol({ poTerminie: true, dniDoTerminu: -1 }), "decyzja");
    expect(k.podpis).toBe(`termin minął ${dzienMiesiac("2026-10-12T10:00:00.000Z")}`);
  });

  it("stan kroku słyszy też czytnik — kropka sama nie mówi nic", () => {
    render(<DrogaSprawy szczegol={szczegol()} />);
    const decyzja = screen.getAllByRole("listitem")[4];
    expect(decyzja).toHaveTextContent("Decyzja, teraz");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Zakup, zrobione");
  });
});
