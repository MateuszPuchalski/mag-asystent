import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Rozmowa as EkranRozmowy } from "./Rozmowa";
import type { OsRozmowy, Rozmowa } from "../api/typy";

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
  nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "not_started", kopilot: null, ...n,
} as unknown as Rozmowa);

const dane = (n: Partial<Rozmowa> = {}): OsRozmowy => ({
  rozmowa: rozmowa(n), os: [], dobor: { dane: {}, wersja: 1 },
  szkicCopilota: null, ofertaWskazana: null,
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
    stan: undefined, szkic: null, nieswiezy: false, doborWersja: null,
    nowePolaDoboru: [], paraPasowania: null, uklada: false, blad: "",
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

  it("mówi, że rozmowę przypisze PIERWSZA ODPOWIEDŹ", () => {
    /* To zdanie jest ceną zdjęcia przycisku: bez niego znika czynność i nie
       przychodzi nic, co by ją wytłumaczyło. */
    render(<EkranRozmowy {...props()} />);
    /* Od 23 września 2026 zdanie stoi w dymku kółka i dla czytnika ekranu —
       linia pod loginem odeszła z „za dużo tekstu". */
    expect(screen.getByTitle("Prowadzi nikt — przypisze pierwsza odpowiedź")).toBeInTheDocument();
  });

  it("przy cudzej rozmowie pokazuje IMIĘ prowadzącego", () => {
    render(<EkranRozmowy {...props({ wlascicielId: 9, wlasciciel: "M. Wójcik" })} />);
    expect(screen.getByTitle("Prowadzi M. Wójcik")).toHaveTextContent("M");
    expect(screen.queryByText(/przypisze pierwsza odpowiedź/)).not.toBeInTheDocument();
  });

  it("własną rozmowę podpisuje „Ty”, nie własnym imieniem", () => {
    render(<EkranRozmowy {...props({ wlascicielId: 7, wlasciciel: "Ja Sam" })} />);
    expect(screen.getByText("Ty")).toBeInTheDocument();
  });
});
