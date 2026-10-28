import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Rozmowa as EkranRozmowy } from "./Rozmowa";
import { Os, rozdziel } from "./Os";
import type { OsRozmowy, Rozmowa, WpisOsi } from "../api/typy";
import { ustawKadr } from "../test/kadr";

/* ── Zakup poza osią rozmowy ────────────────────────────────────────────────
   Złożone, opłacone, doręczone i inne sprawy zakupu mówi wyłącznie pasek
   drogi klienta w karcie. Oś zostaje chronologią rozmowy, więc testy pilnują,
   że takich linii na niej nie ma i że karta nadal stoi nad pierwszą wiadomością. */

void ustawKadr;

const wiadomosc = (id: string, at: string, n: Partial<WpisOsi> = {}): WpisOsi => ({
  id, rodzaj: "wiadomosc", autor: "k", odKlienta: true, tresc: `tekst ${id}`, at, ofertaId: null, ...n,
});
const status = (id: string, at: string): WpisOsi => ({
  id, rodzaj: "status", autor: "system", odKlienta: false, tresc: "status", at, ofertaId: null,
});

describe("rozdziel: oś bez linii zakupu", () => {
  it("wiadomości są wypowiedziami, a status zdarzeniem paska", () => {
    const wynik = rozdziel([
      wiadomosc("m1", "2026-10-03T10:00:00Z"), status("s1", "2026-10-03T11:00:00Z"),
    ]);
    expect(wynik.wypowiedzi.map((w) => w.id)).toEqual(["m1"]);
    expect(wynik.zdarzenia.map((z) => [z.id, z.cel])).toEqual([["s1", "m1"]]);
    expect(Object.keys(wynik).sort()).toEqual(["wypowiedzi", "zdarzenia"]);
  });
});

const os = (wpisy: WpisOsi[], mozeZlecac = false) => render(
  <MemoryRouter><Os wpisy={wpisy} rozmowaId={1} zrodloPomiaru={null} mozeZlecac={mozeZlecac}
    onZrodlo={() => {}} onWstawDoSzkicu={() => {}} /></MemoryRouter>);

describe("Os: tylko rozmowa", () => {
  it("oś rysuje wiadomości w kolejności i nie ma na niej linii zakupu", () => {
    const { container } = os([
      wiadomosc("m1", "2026-10-03T10:00:00Z"), wiadomosc("m2", "2026-10-03T11:00:00Z"),
    ]);
    const kolejnosc = Array.from(container.querySelectorAll("[data-wpis]"))
      .map((e) => (e as HTMLElement).dataset.wpis);
    expect(kolejnosc).toEqual(["m1", "m2"]);
    expect(container.querySelector("[data-zakup]")).toBeNull();
  });

  it("pytanie klienta zostaje ostatnią wypowiedzią, więc ma znacznik „bez odpowiedzi”", () => {
    /* „Zleć z tej wiadomości” jest stale widoczne tylko przy pytaniu, na które
       nikt nie odpowiedział; przy starszych wychodzi pod myszą (`opacity-0`). */
    os([wiadomosc("m0", "2026-10-03T09:00:00Z"), wiadomosc("m1", "2026-10-03T10:00:00Z")], true);
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
  rozmowa: rozmowa(n), os: [], szkicCopilota: null, ofertaWskazana: null, przeplyw: [],
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
    stan: undefined, szkic: null, nieswiezy: false, uklada: false, blad: "",
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
  nowychOdOdpowiedzi: 0, zadanieWToku: false, kopilot: null, ...n,
} as unknown as Rozmowa);

describe("Rozmowa: karta nad osią i oś bez zdarzeń zakupu", () => {
  it("składa kartę nad rozmową, a na osi zostają same wiadomości", () => {
    const d = {
      rozmowa: rozmowa(), szkicCopilota: null, ofertaWskazana: null, przeplyw: [],
      os: [wiadomosc("m1", "2026-10-03T10:00:00.000Z")],
      droga: [{ rodzaj: "reklamacja", id: 7, at: "2026-10-03T12:00:00.000Z", opis: null }],
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
    expect(kolejnosc).toEqual(["m1"]);
    expect(screen.queryByText(/Zamówienie 17147703077 złożone/)).toBeNull();
    expect(screen.queryByText(/Paczka dostarczona/)).toBeNull();
    expect(screen.queryByText(/Reklamacja otwarta/)).toBeNull();
  });
});
