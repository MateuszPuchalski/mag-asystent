import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Reklamacja, WiadomoscReklamacji } from "../api/typy";

/* ── Załączniki w czacie reklamacji — opakowanie na wspólnej powłoce ─────────
   OSOBNY PLIK od `Czat.test.tsx` celowo: tamten pilnuje rozmowy (role,
   niepełny czat, edytor), ten — tego, czego czat reklamacji do tego wydania
   NIE robił: porażka podglądu milczała (spadała na przycisk), a błąd
   pobrania był połykany. Skrzynka miała oba zdania od 0.244.0; teraz mają
   je oba miejsca z jednej powłoki.                                          */

const scena = vi.hoisted(() => ({
  haki: [] as Array<[number, number | null]>,
  wynik: { url: undefined as string | null | undefined, blad: null as string | null },
  ponow: () => {},
}));
vi.mock("../towar/useZdjecie", () => ({
  useZdjecieZalacznikaReklamacji: (r: number, id: number | null) => {
    scena.haki.push([r, id]);
    return { url: scena.wynik.url, blad: scena.wynik.blad, ponow: scena.ponow };
  },
}));
const pobranie = vi.hoisted(() => ({ wynik: Promise.resolve() as Promise<void> }));
vi.mock("../api/reklamacje", () => ({
  pobierzZalacznik: () => pobranie.wynik,
}));

const { Czat } = await import("./Czat");

const rek = (): Reklamacja => ({
  id: 3, externalId: "i-1", numer: "123/2026", orderId: null, offerId: null,
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT", powodTyp: "DEFECT_FOUND_DURING_USE",
  powodOpis: "Pękła obudowa", temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 1,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", prowadzi: null, prowadziAt: null,
  notatka: null, wersja: 1, kubelek: "decyzja", sygnaly: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: null, ofertaZdjecie: "nieznane", twId: null, twSymbol: null,
  werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktWiadomosc: null,
  werdyktKwotaGrosze: null, werdyktAt: null, werdyktPrzez: null, werdyktBlad: null,
  zwrotTowaru: null, zwrotTowaruAt: null, ilosc: 1,
});
const wiad = (zalaczniki: WiadomoscReklamacji["zalaczniki"]): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "kupujacy1", autorRola: "BUYER",
  tresc: "Kosiarka przestała ciąć", utworzonoAt: "2026-09-06T10:01:00.000Z", zalaczniki,
});
const czat = (podglad: boolean) => render(<Czat reklamacja={rek()} zalaczniki={[]}
  czat={[wiad([{ id: 9, wiadomoscId: 1, nazwa: "usterka.jpg", podglad }])]} />);

describe("Załączniki w czacie reklamacji", () => {
  it("hak reklamacji dostaje numer sprawy i załącznika; bez podglądu — `null`", () => {
    scena.haki = []; scena.wynik = { url: undefined, blad: null };
    czat(true);
    expect(scena.haki).toContainEqual([3, 9]);
    scena.haki = [];
    czat(false);
    expect(scena.haki).toContainEqual([3, null]);
  });

  it("odmowa Allegro stoi pod nazwą zdaniem z serwera i daje „Spróbuj ponownie”", async () => {
    const ponow = vi.fn();
    scena.ponow = ponow;
    scena.wynik = { url: null, blad: "Allegro nie oddało załącznika (403). Sprawdź uprawnienie…" };
    czat(true);
    expect(screen.getByText(/Allegro nie oddało załącznika/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));
    expect(ponow).toHaveBeenCalledTimes(1);
  });

  it("nieudane pobranie mówi o sobie — do tego wydania było połykane", async () => {
    scena.wynik = { url: null, blad: null };
    pobranie.wynik = Promise.reject(new Error("Nie udało się pobrać załącznika z Allegro — sprawdź internet na serwerze."));
    pobranie.wynik.catch(() => {});
    czat(true);
    await userEvent.click(screen.getByRole("button", { name: "usterka.jpg" }));
    expect(await screen.findByText(/sprawdź internet na serwerze/)).toBeInTheDocument();
  });

  it("zdjęcie widać w linii i da się je powiększyć — jak w skrzynce", async () => {
    scena.wynik = { url: "blob:usterka", blad: null };
    czat(true);
    expect(screen.getByRole("img", { name: "usterka.jpg" })).toHaveAttribute("src", "blob:usterka");
    await userEvent.click(screen.getByRole("button", { name: "Powiększ: usterka.jpg" }));
    expect(screen.getByRole("dialog", { name: "Zdjęcie: usterka.jpg" })).toBeInTheDocument();
  });
});
