import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Zadanie } from "../api/typy";

/* ── Droga powrotna z hali (0.352.0) ─────────────────────────────────────────
   Do 0.351.0 zadanie terenowe miało z magazynu jedno wyjście: wynik. Ekran
   biura nie znał więc stanu „hala odpowiedziała, ale nie wynikiem" i nie miał
   czym na niego odpowiedzieć.

   Ten plik pilnuje TRZECH rzeczy, bo każda z nich zamieniłaby odesłanie
   z powrotem w ciszę:
     1. odesłane widać w widoku DOMYŚLNYM, nie tylko w swojej zakładce,
     2. powód stoi na karcie zdaniem po polsku, nie kodem z API,
     3. karta ma OBA wyjścia biura — ponowienie i anulowanie.               */

const zadanie = (n: Partial<Zadanie> = {}): Zadanie => ({
  id: 12, rodzaj: "pomiar", tytul: "Zmierz rozstaw otworów",
  instrukcja: "Od środka do środka, w mm.", twId: null, symbol: null, nazwaTowaru: null,
  lokalizacja: null, priorytet: "normalny", status: "nowe",
  utworzonoAt: "2026-09-15T08:00:00.000Z", utworzonoPrzez: "A. Lewandowska",
  przypisanoPrzez: null, wynik: null, wykonanoPrzez: null,
  odeslanoAt: null, odeslanoPrzez: null, powodKod: null, powod: null, ...n,
});

const odeslane = (n: Partial<Zadanie> = {}) => zadanie({
  status: "odeslane", powodKod: "brak_towaru", powod: "Półka A01 pusta, w buforze też nie ma.",
  odeslanoAt: "2026-09-15T09:30:00.000Z", odeslanoPrzez: "M. Kowal", ...n,
});

const ponow = vi.fn();
const anuluj = vi.fn();
let LISTA: Zadanie[] = [];

vi.mock("../api/rozmowy", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/rozmowy")>("../api/rozmowy");
  return {
    ...rzeczywisty,
    useZadania: () => ({ data: { zadania: LISTA }, isLoading: false, error: null }),
    useNoweZadanie: () => ({ mutate: vi.fn(), isPending: false }),
    usePonowZadanie: () => ({ mutate: ponow, isPending: false }),
    useAnulujZadanie: () => ({ mutate: anuluj, isPending: false }),
  };
});

const { Zadania } = await import("./Zadania");

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Zadania />
  </QueryClientProvider>);

describe("Zadania terenowe — droga powrotna z hali", () => {
  it("odesłane stoi w widoku DOMYŚLNYM, nie tylko w swojej zakładce", () => {
    /* Zakładka jest skrótem dla kogoś, kto przyszedł po nie. Gdyby odesłane
       wypadło z „Otwartych", gubiłoby się dokładnie tak samo jak przed tą
       wersją — tyle że z ładniejszą nazwą. */
    LISTA = [odeslane()];
    pokaz();
    expect(screen.getByText("Zmierz rozstaw otworów")).toBeInTheDocument();
    expect(screen.getByText(/Odesłane \(1\)/)).toBeInTheDocument();
  });

  it("powód idzie po polsku, a dopisek hali stoi obok niego", () => {
    LISTA = [odeslane()];
    pokaz();
    expect(screen.getByText(/Hala odesłała: Brak towaru/)).toBeInTheDocument();
    expect(screen.getByText(/Półka A01 pusta/)).toBeInTheDocument();
    expect(screen.getByText(/M\. Kowal/)).toBeInTheDocument();
  });

  it("odesłanie bez dopisku nadal niesie powód — dopisek jest nieobowiązkowy", () => {
    LISTA = [odeslane({ powodKod: "nie_da_sie", powod: null })];
    pokaz();
    expect(screen.getByText(/Hala odesłała: Nie da się wykonać/)).toBeInTheDocument();
  });

  it("biuro ma OBA wyjścia, a ponowienie pozwala poprawić instrukcję", async () => {
    LISTA = [odeslane()];
    pokaz();
    const u = userEvent.setup();

    /* Anulowanie jest dostępne od razu — to jedna z dwóch odpowiedzi. */
    expect(screen.getByRole("button", { name: /ANULUJ ZADANIE/ })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /ZLEĆ PONOWNIE/ }));
    const pole = screen.getByRole("textbox");
    expect(pole).toHaveValue("Od środka do środka, w mm.");
    await u.clear(pole);
    await u.type(pole, "Wałek leży w kartonie przy rampie.");
    await u.click(screen.getByRole("button", { name: /ZLEĆ PONOWNIE/ }));

    expect(ponow).toHaveBeenCalledWith(
      { id: 12, instrukcja: "Wałek leży w kartonie przy rampie." },
      expect.anything());
  });

  it("zadanie nieodesłane nie dostaje przycisków biura", () => {
    /* Ponowić można wyłącznie odesłane — serwer to odrzuca, a ekran nie ma
       prawa proponować czynności, która skończy się błędem. */
    LISTA = [zadanie({ status: "w_toku", przypisanoPrzez: "M. Kowal" })];
    pokaz();
    expect(screen.queryByRole("button", { name: /ZLEĆ PONOWNIE/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Hala odesłała/)).not.toBeInTheDocument();
  });
});
