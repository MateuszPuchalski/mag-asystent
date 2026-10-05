import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StanPrzesylki, ZamowienieRozmowy } from "../api/typy";

/* ── Blok paczki zamówienia rozmowy ──────────────────────────────────────────
   Klient pod zamówieniem pyta najczęściej „gdzie paczka". Pilnujemy, że stan
   mówi po polsku i z perspektywy klienta, że próg „sprawdź" jest jeden dla
   całej kolumny, a Allegro pytamy wyłącznie kliknięciem — otwarcie rozmowy
   niczego nie woła. */

const sprawdz = { mutate: vi.fn(), isPending: false, error: null as Error | null };
vi.mock("../api/rozmowy", () => ({ useSprawdzPrzesylkeRozmowy: () => sprawdz }));

const { Paczka } = await import("./Paczka");

const stan = (n: Partial<StanPrzesylki> = {}): StanPrzesylki => ({
  waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null, ...n,
});
const minut = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const zamowienie = (przesylka: StanPrzesylki | null, dostawaMetoda: string | null = null): ZamowienieRozmowy => ({
  externalId: "2f8c1a3e-9b7d-4c1e-8a2b-000000000001", link: null, przesylka,
  pobrane: dostawaMetoda === null ? null : {
    externalId: "2f8c1a3e-9b7d-4c1e-8a2b-000000000001", status: "READY_FOR_PROCESSING", kupujacyLogin: null,
    dostawaGrosze: 1499, dostawaMetoda, platnoscTyp: null, platnoscAt: null, fakturaZadana: null,
    sumaGrosze: 6098, waluta: "PLN", kupionoAt: "2026-08-30T11:00:00Z", link: null, pozycje: [],
  },
});

const rysuj = (z: ZamowienieRozmowy, rozmowaId = 7) => render(<Paczka zamowienie={z} rozmowaId={rozmowaId} />);

beforeEach(() => { sprawdz.mutate.mockClear(); sprawdz.error = null; });

describe("blok paczki", () => {
  it("status słowem z perspektywy klienta, z przewoźnikiem i numerem", () => {
    rysuj(zamowienie(stan({ waybill: "620012345678", przewoznik: "INPOST", status: "IN_TRANSIT",
      sprawdzonoAt: minut(5) })));
    const blok = screen.getByLabelText("Paczka zamówienia");
    expect(blok).toHaveTextContent("Paczka: w drodze do klienta.");
    expect(blok).toHaveTextContent("INPOST");
    expect(blok).toHaveTextContent("620012345678");
  });

  it("metoda dostawy stoi w linii stanu", () => {
    rysuj(zamowienie(stan({ waybill: "X1", przewoznik: "INPOST", status: "IN_TRANSIT", sprawdzonoAt: minut(5) }),
      "Kurier InPost"));
    expect(screen.getByText(/Kurier InPost · stan z /)).toBeInTheDocument();
  });

  it("„nie pytaliśmy” i „Allegro nie ma numeru” to dwa różne zdania", () => {
    const { rerender } = rysuj(zamowienie(stan()));
    expect(screen.getByText("Nie pytaliśmy jeszcze Allegro o tę paczkę.")).toBeInTheDocument();
    expect(screen.queryByText(/Allegro nie ma numeru przesyłki/)).toBeNull();
    rerender(<Paczka rozmowaId={7} zamowienie={zamowienie(stan({ sprawdzonoAt: minut(90) }))} />);
    expect(screen.getByText(/Allegro nie ma numeru przesyłki/)).toBeInTheDocument();
    expect(screen.queryByText(/Nie pytaliśmy/)).toBeNull();
  });

  /* Jedna reguła progu w całej kolumnie: pełny przycisk przy stanie nieznanym
     albo starszym niż pół godziny, ciche „sprawdź" przy świeżym, a przy
     doręczonej paczce pełnego przycisku nie ma wcale. */
  it("świeży stan: ciche „sprawdź”, bez pełnego przycisku", () => {
    rysuj(zamowienie(stan({ waybill: "X1", przewoznik: "DPD", status: "IN_TRANSIT", sprawdzonoAt: minut(10) })));
    expect(screen.getByRole("button", { name: "sprawdź" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sprawdź/ })).toBeNull();
  });

  it("niesprawdzona: „Sprawdź paczkę”", () => {
    rysuj(zamowienie(stan()));
    expect(screen.getByRole("button", { name: "Sprawdź paczkę" })).toBeInTheDocument();
  });

  it("stan sprzed 45 minut: „Sprawdź ponownie”", () => {
    rysuj(zamowienie(stan({ waybill: "X1", przewoznik: "DPD", status: "IN_TRANSIT", sprawdzonoAt: minut(45) })));
    expect(screen.getByRole("button", { name: "Sprawdź ponownie" })).toBeInTheDocument();
  });

  it("doręczona: zdanie z datą, bez pełnego przycisku", () => {
    rysuj(zamowienie(stan({ waybill: "X1", przewoznik: "DPD", status: "IN_TRANSIT",
      dostarczonoAt: minut(3000), sprawdzonoAt: minut(2000) })));
    expect(screen.getByText(/^Paczka doręczona/)).toHaveClass("text-ranga-ok");
    expect(screen.queryByRole("button", { name: /^Sprawdź/ })).toBeNull();
  });

  it("awizo świeci barwą „uwaga”, zwykła droga — nie", () => {
    const { rerender } = rysuj(zamowienie(stan({ waybill: "X1", przewoznik: "DPD", status: "NOTICE_LEFT",
      sprawdzonoAt: minut(5) })));
    expect(screen.getByText(/^Paczka: awizo/)).toHaveClass("text-ranga-uwaga");
    rerender(<Paczka rozmowaId={7} zamowienie={zamowienie(stan({ waybill: "X1", przewoznik: "DPD",
      status: "IN_TRANSIT", sprawdzonoAt: minut(5) }))} />);
    expect(screen.getByText(/^Paczka: w drodze/)).not.toHaveClass("text-ranga-uwaga");
  });

  it("Allegro pytamy dopiero kliknięciem, z numerem rozmowy", async () => {
    rysuj(zamowienie(stan()), 4821);
    expect(sprawdz.mutate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sprawdź paczkę" }));
    expect(sprawdz.mutate).toHaveBeenCalledWith({ id: 4821 });
  });

  it("zamówienie spoza bazy: zdanie o synchronizacji i żadnego przycisku", () => {
    rysuj(zamowienie(null));
    expect(screen.getByLabelText("Paczka zamówienia")).toHaveTextContent(/Zamówienia jeszcze nie pobraliśmy/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("błąd sprawdzenia stoi zdaniem serwera, w barwie błędu", () => {
    sprawdz.error = new Error("Konto Allegro nie jest sparowane");
    rysuj(zamowienie(stan()));
    expect(screen.getByText("Konto Allegro nie jest sparowane")).toHaveClass("text-ranga-zle");
  });
});

/* ── Kopiowanie numeru przesyłki po zwykłym HTTP ─────────────────────────────
   Biuro pracuje pod `http://serwer:3001`, gdzie `navigator.clipboard` jest
   `undefined`. Klik ma pójść drogą zapasową albo powiedzieć, że się nie
   udało — nigdy nie milczeć. Wzór: `ui/kopiuj.test.tsx`. */
describe("kopiowanie numeru przesyłki", () => {
  const exec = (f: unknown) => { (document as unknown as { execCommand: unknown }).execCommand = f; };
  beforeEach(() => vi.stubGlobal("navigator", { ...navigator, clipboard: undefined }));
  afterEach(() => { vi.unstubAllGlobals(); exec(undefined); });
  const zNumerem = () => zamowienie(stan({ waybill: "620012345678", przewoznik: "INPOST", status: "IN_TRANSIT",
    sprawdzonoAt: minut(5) }));

  it("bez `navigator.clipboard` kopiuje drogą zapasową i mówi, że skopiował", async () => {
    const kopiuj = vi.fn().mockReturnValue(true);
    exec(kopiuj);
    rysuj(zNumerem());
    await userEvent.click(screen.getByTitle("Kopiuj numer przesyłki"));
    expect(kopiuj).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("Skopiowano")).toBeInTheDocument();
  });

  it("gdy nic nie działa, MÓWI o porażce zamiast udawać sukces albo milczeć", async () => {
    exec(undefined);
    rysuj(zNumerem());
    await userEvent.click(screen.getByTitle("Kopiuj numer przesyłki"));
    expect(await screen.findByText("Nie udało się skopiować")).toBeInTheDocument();
    expect(screen.queryByText("Skopiowano")).toBeNull();
  });
});
