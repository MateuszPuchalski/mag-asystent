import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dowody } from "./Dowody";
import type { Zwrot } from "../api/typy";

/* ── Notatka biura przy zwrocie (0.285.0) ────────────────────────────────────
   Kolumna `notatka` stała w bazie od 0.172.0 i wypełniała ją WYŁĄCZNIE
   rejestracja paczki nieodebranej. Przy zwrocie z Allegro nie było gdzie
   zapisać ustalenia — wracało ono do panelu Allegro albo do niczyjej pamięci.

   Reklamacje dostały to samo w 0.280.0 i stoi tam w tej samej kolumnie, więc
   dwa ekrany obsługi mają jeden nawyk, nie dwa.

   Cztery rzeczy warte testu:

   1. ZAPIS JAWNYM PRZYCISKIEM, nie przy każdym znaku: zapis po literze
      podnosiłby wersję zwrotu i wywracał kontrolę świeżości u kolegi.
   2. NIE MA ZMIANY → PRZYCISK NIEAKTYWNY. Zapis tego samego zdania kosztuje
      wersję i nie mówi nic nowego.
   3. NIE MA CZEGO COFAĆ → NIE MA PRZYCISKU. Pierwsza notatka nie ma dokąd
      wracać, a przycisk bez działania kłamie.
   4. AUTOR I GODZINA STOJĄ PRZY NOTATCE, nie w osobnej sekcji.             */

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, externalId: "zw-1", numer: "N4QZ/2026", orderId: "ord-1",
  utworzono: "2026-08-20T07:28:12.000Z", paczkaAt: null, dostarczonoAt: null,
  przesylkaStatus: null, kubelek: "zamkniety", sygnaly: [],
  terminAt: "2026-09-03T07:28:12.000Z", dniDoTerminu: 7,
  sumaPozycjiGrosze: 3798, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, zamowienie: null,
  werdykt: "przyjety", werdyktPowod: null, kwotaGrosze: null, kwotaWariant: null,
  korektaNumer: null, korektaZrodlo: null,
  zrodlo: "allegro", notatka: null, notatkaAt: null, notatkaPrzez: null,
  maPoprzedniaNotatke: false,
  kupujacyLogin: null, przewoznik: null, rozmowy: [],
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  rejectionCode: null, wersja: 1, pozycje: [],
  ...n,
});

const pokaz = (z: Zwrot, opcje: Partial<React.ComponentProps<typeof Dowody>> = {}) =>
  render(<QueryClientProvider client={new QueryClient()}>
    <Dowody zwrot={z} {...opcje} />
  </QueryClientProvider>);

describe("Notatka biura przy zwrocie", () => {
  it("bez obsługi zapisu pola w ogóle nie ma", () => {
    /* Ten sam wzorzec co przy wskazaniu dokumentu: czego nie da się zrobić,
       tego nie ma na ekranie. */
    pokaz(zwrot());
    expect(screen.queryByLabelText("Notatka biura")).toBeNull();
  });

  it("zapisuje dopiero po kliknięciu, i tylko gdy treść się zmieniła", async () => {
    const onNotatka = vi.fn();
    pokaz(zwrot(), { onNotatka });
    const zapisz = screen.getByRole("button", { name: /Zapisz notatkę/ });
    expect(zapisz).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Notatka biura"), "klient prosi o telefon");
    expect(onNotatka).not.toHaveBeenCalled();
    await userEvent.click(zapisz);
    expect(onNotatka).toHaveBeenCalledWith("klient prosi o telefon");
  });

  it("autor i godzina stoją przy notatce, a cofnięcie jest zdaniem", async () => {
    const onCofnijNotatke = vi.fn();
    pokaz(zwrot({
      notatka: "jednak napisał sam", notatkaPrzez: "Ala z biura",
      notatkaAt: "2026-09-05T10:00:00.000Z", maPoprzedniaNotatke: true,
    }), { onNotatka: vi.fn(), onCofnijNotatke });

    expect(screen.getByText(/Ala z biura/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "cofnij zmianę" }));
    expect(onCofnijNotatke).toHaveBeenCalled();
  });

  it("pierwsza notatka nie dostaje cofnięcia — nie ma dokąd wracać", () => {
    pokaz(zwrot({
      notatka: "pierwsza", notatkaPrzez: "Ala z biura",
      notatkaAt: "2026-09-05T10:00:00.000Z", maPoprzedniaNotatke: false,
    }), { onNotatka: vi.fn(), onCofnijNotatke: vi.fn() });
    expect(screen.queryByRole("button", { name: "cofnij zmianę" })).toBeNull();
  });
});
