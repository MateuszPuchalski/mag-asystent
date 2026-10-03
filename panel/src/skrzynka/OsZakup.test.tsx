import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Rozmowa as EkranRozmowy } from "./Rozmowa";
import { Os, rozdziel } from "./Os";
import type { OsRozmowy, Rozmowa, WpisOsi } from "../api/typy";
import { ustawKadr } from "../test/kadr";

/* ── Zakup w osi rozmowy ─────────────────────────────────────────────────────
   Karta nad rozmową i linie zakupu między wiadomościami. Najważniejsze: linia
   zakupu NIE jest wypowiedzią. Gdyby była, „Paczka dostarczona" po pytaniu
   klienta zdjęłaby z pytania znacznik „bez odpowiedzi", a skok z paska
   przebiegu trafiłby w wpis, którego nie ma w DOM. */

void ustawKadr;

const wiadomosc = (id: string, at: string, n: Partial<WpisOsi> = {}): WpisOsi => ({
  id, rodzaj: "wiadomosc", autor: "k", odKlienta: true, tresc: `tekst ${id}`, at, ofertaId: null, ...n,
});
const zakup = (id: string, at: string, n: Partial<WpisOsi> = {}): WpisOsi => ({
  id: `zakup:${id}`, rodzaj: "zakup", autor: "", odKlienta: false, tresc: `Zdarzenie ${id}`, at, ofertaId: null, ...n,
});
const status = (id: string, at: string): WpisOsi => ({
  id, rodzaj: "status", autor: "system", odKlienta: false, tresc: "status", at, ofertaId: null,
});

describe("rozdziel: linie zakupu", () => {
  it("linia zakupu nie jest ani wypowiedzią, ani zdarzeniem paska", () => {
    const { wypowiedzi, zdarzenia, linie } = rozdziel([
      zakup("a", "2026-10-02T10:00:00Z"), wiadomosc("m1", "2026-10-03T10:00:00Z"),
    ]);
    expect(wypowiedzi.map((w) => w.id)).toEqual(["m1"]);
    expect(zdarzenia).toEqual([]);
    expect(linie.map((l) => [l.id, l.przed])).toEqual([["zakup:a", "m1"]]);
  });

  it("linia po ostatniej wypowiedzi stoi na końcu, a pytanie dalej jest ostatnią wypowiedzią", () => {
    const { wypowiedzi, linie } = rozdziel([
      wiadomosc("m1", "2026-10-03T10:00:00Z"), zakup("dostarczone", "2026-10-04T10:00:00Z"),
    ]);
    expect(wypowiedzi[wypowiedzi.length - 1].id).toBe("m1");
    expect(linie[0].przed).toBeNull();
  });

  it("skok z paska przebiegu nie trafia w linię zakupu", () => {
    const { zdarzenia } = rozdziel([
      wiadomosc("m1", "2026-10-03T10:00:00Z"), zakup("a", "2026-10-03T11:00:00Z"), status("s1", "2026-10-03T12:00:00Z"),
    ]);
    expect(zdarzenia[0].cel).toBe("m1");
  });
});

const os = (wpisy: WpisOsi[], mozeZlecac = false) => render(
  <MemoryRouter><Os wpisy={wpisy} rozmowaId={1} zrodloPomiaru={null} mozeZlecac={mozeZlecac}
    onZrodlo={() => {}} onWstawDoSzkicu={() => {}} /></MemoryRouter>);

describe("Os: linie zakupu w czasie", () => {
  it("linia stoi między wiadomościami w kolejności czasu", () => {
    const { container } = os([
      wiadomosc("m1", "2026-10-03T10:00:00Z"), zakup("a", "2026-10-03T10:30:00Z"), wiadomosc("m2", "2026-10-03T11:00:00Z"),
    ]);
    const kolejnosc = Array.from(container.querySelectorAll("[data-wpis], [data-zakup]"))
      .map((e) => (e as HTMLElement).dataset.wpis ?? (e as HTMLElement).dataset.zakup);
    expect(kolejnosc).toEqual(["m1", "zakup:a", "m2"]);
  });

  it("linia z adresem jest odnośnikiem do ekranu sprawy, a bez adresu zwykłym zdaniem", () => {
    os([wiadomosc("m1", "2026-10-03T10:00:00Z"),
      zakup("zwrot", "2026-10-03T10:30:00Z", { adres: "/obsluga/zwroty/5", tresc: "Zwrot zgłoszony" }),
      zakup("zlozone", "2026-10-03T10:40:00Z", { tresc: "Zamówienie złożone" })]);
    expect(screen.getByRole("link", { name: "Zwrot zgłoszony" })).toHaveAttribute("href", "/obsluga/zwroty/5");
    expect(screen.queryByRole("link", { name: "Zamówienie złożone" })).toBeNull();
    expect(screen.getByText("Zamówienie złożone")).toBeInTheDocument();
  });

  it("linia po pytaniu klienta NIE zdejmuje znacznika pytania bez odpowiedzi", () => {
    /* „Zleć z tej wiadomości" jest stale widoczne tylko przy pytaniu, na które
       nikt nie odpowiedział; przy starszych wychodzi pod myszą (`opacity-0`). */
    os([wiadomosc("m0", "2026-10-03T09:00:00Z"), wiadomosc("m1", "2026-10-03T10:00:00Z"),
      zakup("dostarczone", "2026-10-04T10:00:00Z")], true);
    const przyciski = screen.getAllByRole("button", { name: /Zleć z tej wiadomości/ });
    expect(przyciski).toHaveLength(2);
    expect(przyciski[0].className).toContain("opacity-0");
    expect(przyciski[1].className).not.toContain("opacity-0");
  });

  it("karta z `naGorze` stoi przed pierwszą wiadomością w tym samym przewijaniu", () => {
    const { container } = render(<MemoryRouter><Os wpisy={[wiadomosc("m1", "2026-10-03T10:00:00Z")]} rozmowaId={1}
      zrodloPomiaru={null} mozeZlecac={false} onZrodlo={() => {}} onWstawDoSzkicu={() => {}}
      naGorze={<div data-testid="karta">karta</div>} /></MemoryRouter>);
    const lista = container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(lista.firstElementChild).toBe(screen.getByTestId("karta"));
    expect(within(lista).getByTestId("karta")).toBeInTheDocument();
  });
});

const dane = (n: Partial<Rozmowa> = {}): OsRozmowy => ({
  rozmowa: rozmowa(n), os: [], dobor: { dane: {}, wersja: 1 }, szkicCopilota: null, ofertaWskazana: null,
} as unknown as OsRozmowy);

/* Atrapa pełnego kształtu: ekran rozmowy bierze ponad czterdzieści rekwizytów,
   a ten plik pyta tylko o kartę i oś. Procedury są puste z rozmysłem. */
const props = (n: Partial<Rozmowa> = {}) => ({
  dane: dane(n), mojeId: 7, obecni: [], nowaWiadomosc: false,
  szkic: "", zapisuje: false, zrodloPomiaru: null, wskazowka: "", towar: null,
  onPokazNowa: vi.fn(), onSzkic: vi.fn(), onZapiszSzkic: vi.fn(), onZrodlo: vi.fn(),
  onWskazowka: vi.fn(), onTowar: vi.fn(), onZlec: vi.fn(),
  wysyla: false, onWyslij: vi.fn(),
  komentarz: "", onKomentarz: vi.fn(), onDodajKomentarz: vi.fn(), komentuje: false,
  agenci: [], wzmianki: [], onWzmianki: vi.fn(),
  zalaczniki: [], dodajeZalacznik: false, bladZalacznika: "",
  onDodajZalacznik: vi.fn(), onUsunZalacznik: vi.fn(),
  copilot: {
    stan: undefined, szkic: null, nieswiezy: false, doborWersja: null,
    paraPasowania: null, uklada: false, blad: "",
    maSzkicAgenta: false, wylaczony: false,
  } as never,
  konflikt: null, mozeWymusic: false, wymusza: false, bladKonfliktu: "",
  zapisujeOferte: false, bladOferty: "",
  onZamknijKonflikt: vi.fn(), onPoprosOPrzekazanie: vi.fn(), onWymus: vi.fn(),
  onWskazOferte: vi.fn(), onDopytajOOferte: vi.fn(), onOtworzRozmowe: vi.fn(),
  zapisujeStatus: false, onPriorytet: vi.fn(), zapisujePriorytet: false,
  bladStatusu: "", onZmienStatus: vi.fn(),
});

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 4821, klient: "Andrzej8216A", ostatniaWiadomosc: "Czy pasuje?",
  ostatniaWiadomoscAt: "2026-10-03T10:00:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "waiting_for_us", odlozoneDo: null, poTerminie: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, reklamacyjna: false,
  nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "pusty", kopilot: null, ...n,
} as unknown as Rozmowa);

describe("Rozmowa: karta i zdarzenia zakupu", () => {
  it("składa kartę nad rozmową i wsuwa zdarzenia zakupu między wiadomości", () => {
    const d = {
      rozmowa: rozmowa(), dobor: { dane: {}, wersja: 1 }, szkicCopilota: null, ofertaWskazana: null,
      os: [wiadomosc("m1", "2026-10-03T10:00:00.000Z")],
      droga: [{ rodzaj: "dyskusja", id: 7, at: "2026-10-03T12:00:00.000Z", opis: null }],
      oferta: null,
      zamowienie: { externalId: "17147703077", link: null, przesylka: null, pobrane: {
        externalId: "17147703077", status: "READY_FOR_PROCESSING", platnoscTyp: "ONLINE",
        platnoscAt: "2026-10-02T14:12:00.000Z", kupionoAt: "2026-10-02T14:10:00.000Z", sumaGrosze: 8999, waluta: "PLN",
        pozycje: [{ offerId: "o1", nazwa: "NÓŻ DO MTD", sku: "W27", ilosc: 1, cenaGrosze: 8999, waluta: "PLN",
          zwracana: false, wracaIlosc: 0, twId: null, twSymbol: null, twZrodlo: null, ofertaZdjecie: "brak" }] } },
    } as unknown as OsRozmowy;
    const { container } = render(
      <MemoryRouter><QueryClientProvider client={new QueryClient()}>
        <EkranRozmowy {...props()} dane={d} /></QueryClientProvider></MemoryRouter>);
    expect(screen.getByRole("region", { name: "Kontekst zakupu" })).toHaveTextContent("NÓŻ DO MTD");
    const kolejnosc = Array.from(container.querySelectorAll("[data-wpis], [data-zakup]"))
      .map((e) => (e as HTMLElement).dataset.wpis ?? (e as HTMLElement).dataset.zakup);
    expect(kolejnosc).toEqual(["zakup:zlozone", "zakup:oplacone", "m1", "zakup:dyskusja-7"]);
  });
});
