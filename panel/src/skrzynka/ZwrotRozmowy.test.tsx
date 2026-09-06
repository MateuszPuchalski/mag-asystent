import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Zwrot } from "../api/typy";
import { ZwrotRozmowy } from "./ZwrotRozmowy";

/* ── Zwrot tego zamówienia przy rozmowie (0.221.0) ──────────────────────────
   Klient pyta pod zamówieniem o zwrot, którego dokonał. Blok ma odpowiadać na
   trzy pytania bez wychodzenia z rozmowy: co z paczką, jaka decyzja i kwota,
   ile zostało do terminu — tym samym słownikiem, co kolejka zwrotów.       */

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 5, externalId: "zwrot-1", numer: "1111/Z04A", orderId: "zam-77",
  utworzono: "2026-09-01T10:00:00.000Z", paczkaAt: null, dostarczonoAt: null, przesylkaStatus: null,
  kubelek: "decyzja", sygnaly: ["brak_dowodu"], terminAt: "2026-09-15T10:00:00.000Z", dniDoTerminu: 9,
  sumaPozycjiGrosze: 4599, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: "https://salescenter.allegro.com/returns/zwrot-1", zamowienie: null,
  werdykt: null, werdyktPowod: null, kwotaGrosze: null, kwotaWariant: null, korektaNumer: null, korektaZrodlo: null,
  rejectionCode: null, zrodlo: "allegro", notatka: null, kupujacyLogin: "kupujacy_44", przewoznik: null,
  rozmowy: [], faktura: { dokId: null, numer: null, typ: null, dataWyst: null, zrodlo: null } as never,
  wersja: 1,
  pozycje: [{
    id: 1, offerId: "oferta-9", nazwa: "Szarpak do NAC LS 46-450", ilosc: 1, cenaGrosze: 4599, waluta: "PLN",
    powod: "DAMAGED", powodKomentarz: null, ocena: null, wKoszyku: false, url: null, twId: 501,
    twSymbol: "SZR-NAC-46", twZrodlo: "sku", sku: "SZR-NAC-46", ofertaZamowienia: null, ofertaZdjecie: "nieznane",
    ean: null, zrodlo: "allegro", iloscZwrocona: null, potracenieGrosze: null, potraceniePowod: null,
    propozycja: null, rabat: { stan: "brak" } as never,
  } as never],
  ...n,
});

const pokaz = (z: Zwrot) => render(<MemoryRouter><ZwrotRozmowy zwrot={z} /></MemoryRouter>);

describe("zwrot przy rozmowie", () => {
  it("mówi, że paczki jeszcze nie ma, i prowadzi do zwrotu w panelu i w Allegro", () => {
    pokaz(zwrot());
    expect(screen.getByText("1111/Z04A")).toBeInTheDocument();
    expect(screen.getByText("Do decyzji")).toBeInTheDocument();
    expect(screen.getByText(/klient jeszcze nie nadał paczki/)).toBeInTheDocument();
    expect(screen.getByText(/za 9 dni/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Otwórz w Zwrotach" })).toHaveAttribute("href", "/obsluga/zwroty/5");
    expect(screen.getByRole("link", { name: /Otwórz w Allegro/ }))
      .toHaveAttribute("href", "https://salescenter.allegro.com/returns/zwrot-1");
    expect(screen.getByText("Szarpak do NAC LS 46-450")).toBeInTheDocument();
    expect(screen.getByText("SZR-NAC-46")).toBeInTheDocument();
  });

  it("paczka, decyzja i kwota czytają się jednym spojrzeniem", () => {
    pokaz(zwrot({
      paczkaAt: "2026-09-03T08:00:00.000Z", dostarczonoAt: "2026-09-05T12:00:00.000Z", przewoznik: "INPOST",
      kubelek: "korekta", sygnaly: [], werdykt: "przyjety", kwotaGrosze: 4599, kwotaWariant: "bez_wysylki",
      korektaNumer: "KFS 12/09/2026", dniDoTerminu: -2,
    }));
    expect(screen.getByText(/nadana 3\.09\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/INPOST/)).toBeInTheDocument();
    expect(screen.getByText(/dotarła 5\.09\.2026/)).toBeInTheDocument();
    expect(screen.getByText("przyjęty")).toBeInTheDocument();
    /* Kwota zwrotu i cena pozycji to dwie liczby, które akurat są równe. */
    expect(screen.getAllByText(/45,99/)).toHaveLength(2);
    expect(screen.getByText(/bez wysyłki/)).toBeInTheDocument();
    expect(screen.getByText(/korekta KFS 12\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/minął 2 dni temu/)).toBeInTheDocument();
  });

  it("paczka nieodebrana nie ma odnośnika do Allegro — nie ma tam zwrotu", () => {
    pokaz(zwrot({ zrodlo: "nieodebrana", linkZwrotu: null, numer: null }));
    expect(screen.getByText("paczka nieodebrana")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Otwórz w Allegro/ })).toBeNull();
  });
});
