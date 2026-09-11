import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";
import { Dowody } from "./Dowody";

/* ── Notatka z drogą powrotną (0.280.0) ──────────────────────────────────────
   §25a.5 mówi: cofnięcie zamiast potwierdzenia, wszędzie, gdzie da się cofnąć.
   Notatka jest w tym module JEDYNYM zapisem, który zostaje wyłącznie u nas
   i niczego nie obiecuje kupującemu — więc jako jedyna drogę powrotną dostaje.

   Cztery rzeczy warte testu:

   1. ZDANIE, NIE RAMKA. Cofnięcie to jedno zdanie pod polem, tak jak przy
      cofnięciu przyjęcia w zwrotach.
   2. NIE MA CZEGO COFAĆ → NIE MA PRZYCISKU. Wiersz sprzed 0.280.0 nie zna
      swojej poprzedniej treści, bo nikt jej nie zapisywał.
   3. AUTOR I GODZINA STOJĄ PRZY NOTATCE. Pytanie „kto to napisał" zadaje się
      patrząc na notatkę, nie szukając jej autora w osobnej sekcji.
   4. WERDYKT COFNIĘCIA NIE DOSTAJE i to jest granica, nie przeoczenie.     */

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 1, externalId: "i-1", numer: "123/2026", orderId: null, offerId: null,
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT", powodTyp: "DEFECT_FOUND_DURING_USE",
  powodOpis: "Pękła obudowa", temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 2, czatUrwany: false,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z",
  kupionoAt: null, kupionoZrodlo: null,
  prowadzi: null, prowadziId: null, tagi: [], prowadziAt: null,
  notatka: "ustalono wymianę", notatkaAt: "2026-09-11T10:04:00.000Z",
  notatkaPrzez: "A. Lewandowska", maPoprzedniaNotatke: true,
  wersja: 1, kubelek: "decyzja", sygnaly: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: null, ofertaZdjecie: "nieznane", twId: null, twSymbol: null,
  ...n,
} as unknown as Reklamacja);

const props = (r: Reklamacja, n = {}) => ({
  szczegol: {
    reklamacja: r, czat: [], zalaczniki: [], zwroty: [], rozmowy: [],
    kartoteka: null, karta: null,
  } as unknown as SzczegolReklamacji,
  trwa: false, bladZapisu: "",
  onProwadze: vi.fn(), onNotatka: vi.fn(), ...n,
});

describe("Notatka i jej droga powrotna", () => {
  it("mówi, KTO zmienił i kiedy — dotąd nie mówiła tego nikt", () => {
    render(<Dowody {...props(rek())} />);
    expect(screen.getByText(/A\. Lewandowska/)).toBeInTheDocument();
  });

  it("cofnięcie jest ZDANIEM pod polem, nie ramką z decyzją", async () => {
    const onCofnijNotatke = vi.fn();
    render(<Dowody {...props(rek(), { onCofnijNotatke })} />);
    const cofnij = screen.getByRole("button", { name: "cofnij zmianę" });
    expect(cofnij).toBeInTheDocument();
    /* Żadnego dialogu potwierdzenia: to jest właśnie ta zamiana z §25a.5. */
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(cofnij);
    expect(onCofnijNotatke).toHaveBeenCalledTimes(1);
  });

  it("bez poprzedniej wersji przycisku NIE MA w drzewie", () => {
    /* Wiersz sprzed 0.280.0 nie zna swojej poprzedniej treści. Martwy przycisk
       obiecywałby drogę, której nie ma. */
    render(<Dowody {...props(rek({ maPoprzedniaNotatke: false }),
      { onCofnijNotatke: vi.fn() })} />);
    expect(screen.queryByRole("button", { name: "cofnij zmianę" })).not.toBeInTheDocument();
  });

  it("bez obsługi cofnięcia też go nie ma — ta sama zasada co przy tagach", () => {
    render(<Dowody {...props(rek())} />);
    expect(screen.queryByRole("button", { name: "cofnij zmianę" })).not.toBeInTheDocument();
  });

  it("notatka nigdy nietknięta milczy o autorze, zamiast pisać kreski", () => {
    render(<Dowody {...props(rek({ notatka: null, notatkaPrzez: null, notatkaAt: null,
      maPoprzedniaNotatke: false }))} />);
    expect(screen.queryByText(/^Zmiana:/)).not.toBeInTheDocument();
  });

  it("WERDYKT cofnięcia nie dostaje i to jest granica, nie przeoczenie", () => {
    /* Allegro nie przyjmie drugiego werdyktu w sprawie (§25b.8), więc przycisk
       „cofnij" przy nim byłby obietnicą bez pokrycia. Cofnięcie należy się
       temu, co zostaje u nas. */
    render(<Dowody {...props(rek({ werdykt: "ACCEPTED_REFUND" } as Partial<Reklamacja>),
      { onCofnijNotatke: vi.fn() })} />);
    const cofniecia = screen.getAllByRole("button", { name: /cofnij/i });
    expect(cofniecia).toHaveLength(1);
    expect(cofniecia[0]).toHaveAccessibleName("cofnij zmianę");
  });

  it("data zakupu STOI NA EKRANIE i mówi, który to zegar (0.282.0)", () => {
    /* Agent też jej dotąd nie widział. „Kupiono" bierze się z pozycji
       zamówienia, „Zamówienie złożone" z ładunku sprawy i bywa wcześniejsze —
       nazwanie jednego drugim to blizna 0.121.0. */
    const { rerender } = render(<Dowody {...props(rek({
      orderId: "ord-1", kupionoAt: "2026-03-15T07:00:00.000Z",
      kupionoZrodlo: "zamowienie",
    } as Partial<Reklamacja>))} />);
    expect(screen.getByText("Kupiono")).toBeInTheDocument();

    rerender(<Dowody {...props(rek({
      orderId: "ord-1", kupionoAt: "2026-03-14T09:12:00.000Z", kupionoZrodlo: "sprawa",
    } as Partial<Reklamacja>))} />);
    expect(screen.getByText("Zamówienie złożone")).toBeInTheDocument();
    expect(screen.queryByText("Kupiono")).not.toBeInTheDocument();
  });

  it("bez daty wiersza NIE MA — pusty nie mówi nic, a zajmuje kolumnę", () => {
    render(<Dowody {...props(rek({ orderId: "ord-1" }))} />);
    expect(screen.queryByText("Kupiono")).not.toBeInTheDocument();
    expect(screen.queryByText("Zamówienie złożone")).not.toBeInTheDocument();
  });
});
