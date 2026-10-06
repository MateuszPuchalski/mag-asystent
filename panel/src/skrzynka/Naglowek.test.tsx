import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Rozmowa as EkranRozmowy } from "./Rozmowa";
import type { OsRozmowy, PropozycjaPrzeplywu, Rozmowa } from "../api/typy";
import { atrapaZapisow } from "../test/zapisy";

/* ── Nagłówek rozmowy w skrzynce (0.395.0) ───────────────────────────────────
   Zgłoszenie właściciela ze zrzutem: „usuń guzik przejmuję rozmowę, to powinno
   dziać się automatycznie". Testy pilnują trzech rzeczy:

   1. GUZIKA NIE MA. Wysyłka odpowiedzi przypisuje rozmowę niczyją od 0.159.0,
      w tej samej transakcji, co wiadomość — przycisk prosił o kliknięcie,
      które i tak padało minutę później.
   2. ZDANIE ZOSTAJE. Po zniknięciu przycisku agent nie ma skąd wiedzieć, kiedy
      rozmowa stanie się jego; pustka byłaby gorsza od guzika.
   3. PROWADZĄCEGO WIDAĆ DALEJ. Zdjęto czynność, nie informację — „kto to ma"
      jest pierwszym pytaniem przy cudzej rozmowie.                          */

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 4821, klient: "Andrzej8216A",
  ostatniaWiadomosc: "Czy ten szarpak pasuje do NAC LS 46-450?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "waiting_for_us", odlozoneDo: null, poTerminie: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, reklamacyjna: false,
  nowychOdOdpowiedzi: 0, zadanieWToku: false, kopilot: null, ...n,
} as unknown as Rozmowa);

const dane = (n: Partial<Rozmowa> = {}): OsRozmowy => ({
  rozmowa: rozmowa(n), os: [],
  szkicCopilota: null, ofertaWskazana: null, przeplyw: [],
} as unknown as OsRozmowy);

/* Atrapa pełnego kształtu: ekran rozmowy bierze ponad czterdzieści rekwizytów,
   a ten plik pyta wyłącznie o nagłówek. Procedury są puste z rozmysłem —
   klikanie w nic innego tu nie należy do pytania. */
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

describe("Nagłówek rozmowy", () => {
  it("NIE MA przycisku przejęcia — przypisuje odpowiedź", () => {
    render(<EkranRozmowy {...props()} />);
    expect(screen.queryByRole("button", { name: /PRZEJMIJ ROZMOWĘ/i })).not.toBeInTheDocument();
  });

  it("mówi, że rozmowę przypisze PIERWSZA ODPOWIEDŹ", async () => {
    /* To zdanie jest ceną zdjęcia przycisku: bez niego znika czynność i nie
       przychodzi nic, co by ją wytłumaczyło. Od 0.506.0 „nikt" i „Ty" stoją
       w menu „⋯" — na wierzchu zostaje wyjątek, czyli cudza rozmowa. */
    render(<EkranRozmowy {...props()} />);
    expect(screen.queryByTitle("Prowadzi nikt — przypisze pierwsza odpowiedź")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Więcej czynności rozmowy" }));
    expect(screen.getByText("nikt — przypisze pierwsza odpowiedź")).toBeInTheDocument();
  });

  it("przy cudzej rozmowie pokazuje IMIĘ prowadzącego", () => {
    render(<EkranRozmowy {...props({ wlascicielId: 9, wlasciciel: "M. Wójcik" })} />);
    expect(screen.getByTitle("Prowadzi M. Wójcik")).toHaveTextContent("M");
    expect(screen.queryByText(/przypisze pierwsza odpowiedź/)).not.toBeInTheDocument();
  });

  it("własną rozmowę podpisuje „Ty”, nie własnym imieniem", async () => {
    render(<EkranRozmowy {...props({ wlascicielId: 7, wlasciciel: "Ja Sam" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Więcej czynności rozmowy" }));
    expect(screen.getByText("Ty")).toBeInTheDocument();
  });
});

/* ── Brakujący zakup nad polem odpowiedzi — wpięcie w ekran (0.547.0) ──────
   Komponent ma własne testy. Te pilnują wpięcia: pasek stoi w ekranie rozmowy
   bez zamówienia, dopisuje pytanie do szkicu, a błąd wiązania nie przechodzi
   do następnej rozmowy. */
describe("Brakujący zakup w ekranie rozmowy", () => {
  const kandydat = { externalId: "4e3b1f20-zakup", link: null, status: null,
    kupionoAt: "2026-09-21T08:00:00.000Z", sumaGrosze: 12900, waluta: "PLN",
    pozycje: "Nóż do kosiarki NAC LS 46", maTeOferte: false };
  const zPaskiem = (id: number, szkic = "") => {
    const p = props({ id });
    return { ...p, szkic, dane: { ...p.dane, zamowienie: null, kandydaciZamowien: [kandydat] } as OsRozmowy };
  };
  const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  it("stoi nad polem i dopisuje pytanie o numer do istniejącego szkicu", async () => {
    const p = zPaskiem(4821, "Dzień dobry.");
    render(<QueryClientProvider client={qc()}><EkranRozmowy {...p} /></QueryClientProvider>);
    expect(screen.getByRole("region", { name: "Rozmowa bez zamówienia" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wstaw pytanie o numer zamówienia" }));
    expect(p.onSzkic).toHaveBeenCalledWith("Dzień dobry.\nProszę podać numer zamówienia, którego dotyczy wiadomość.");
  });

  it("nie stoi przy rozmowie z zamówieniem", () => {
    const p = zPaskiem(4821);
    render(<QueryClientProvider client={qc()}><EkranRozmowy {...p}
      dane={{ ...p.dane, zamowienie: { externalId: "z" } } as unknown as OsRozmowy} /></QueryClientProvider>);
    expect(screen.queryByRole("region", { name: "Rozmowa bez zamówienia" })).toBeNull();
  });

  it("błąd wiązania z jednej rozmowy nie stoi w pasku następnej", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Zakup należy do innego loginu" }),
      { status: 400, headers: { "content-type": "application/json" } })));
    try {
      const klient = qc();
      const { rerender } = render(<QueryClientProvider client={klient}><EkranRozmowy {...zPaskiem(4821)} /></QueryClientProvider>);
      await userEvent.click(screen.getByRole("button", { name: /Powiąż ten zakup/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Zakup należy do innego loginu");
      rerender(<QueryClientProvider client={klient}><EkranRozmowy {...zPaskiem(4822)} /></QueryClientProvider>);
      expect(screen.getByRole("region", { name: "Rozmowa bez zamówienia" })).toBeInTheDocument();
      expect(screen.queryByText("Zakup należy do innego loginu")).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});

/* ── „Automat by…" — wpięcie w ekran rozmowy (tryb cienia) ────────────────
   Komponent ma własne testy. Te pilnują wpięcia: karta stoi przed polem
   odpowiedzi, otwarcie rozmowy z propozycjami nic nie zapisuje, a rozmowa
   bez propozycji nie ma karty wcale. */
describe("Propozycje przepływu w ekranie rozmowy", () => {
  const pilne: PropozycjaPrzeplywu = { id: 41, rodzaj: "pilne", kategoria: "COMPLAINT",
    instrukcja: null, at: "2026-10-06T08:00:00.000Z", werdykt: null, werdyktZrodlo: null,
    werdyktPrzez: null, werdyktAt: null, wykonanaAt: null, wykonanieBlad: null };
  const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  it("stoi przed polem odpowiedzi, a otwarcie rozmowy nic nie zapisuje", () => {
    const zapisy = atrapaZapisow(() => undefined);
    try {
      const p = props({ id: 4821 });
      render(<QueryClientProvider client={qc()}>
        <EkranRozmowy {...p} dane={{ ...p.dane, przeplyw: [pilne] }} /></QueryClientProvider>);
      const karta = screen.getByRole("region", { name: "Automat by" });
      expect(karta).toHaveTextContent("oznaczył jako pilne");
      const pole = screen.getAllByRole("textbox").at(-1)!;
      expect(karta.compareDocumentPosition(pole) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(zapisy.wyslane).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("rozmowa bez propozycji nie ma karty", () => {
    render(<EkranRozmowy {...props()} />);
    expect(screen.queryByRole("region", { name: "Automat by" })).toBeNull();
  });
});
