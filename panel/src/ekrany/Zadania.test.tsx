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
  instrukcja: "Od środka do środka, w mm.", kontekst: null,
  twId: null, symbol: null, nazwaTowaru: null,
  lokalizacja: null, priorytet: "normalny", status: "nowe",
  utworzonoAt: "2026-09-15T08:00:00.000Z", utworzonoPrzez: "A. Lewandowska",
  przypisanoPrzez: null, wynik: null, wykonanoPrzez: null,
  odeslanoAt: null, odeslanoPrzez: null, powodKod: null, powod: null,
  zleconeOdMs: 42 * 60_000, zalaczniki: [], ...n,
});

const odeslane = (n: Partial<Zadanie> = {}) => zadanie({
  status: "odeslane", powodKod: "brak_towaru", powod: "Półka A01 pusta, w buforze też nie ma.",
  odeslanoAt: "2026-09-15T09:30:00.000Z", odeslanoPrzez: "M. Kowal", ...n,
});

vi.mock("../towar/useZdjecie", () => ({
  useZdjecieZadania: (_z: number, id: number | null) => ({
    url: id === 9 ? "blob:zdjecie" : null,
    blad: id === 9 ? null : "Serwer nie odpowiada.",
    ponow: () => {},
  }),
}));

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

describe("Zadania terenowe — nagłówek ekranu", () => {
  it("bez tytułu powtarzającego zakładkę; w rzędzie zostają sito i akcja główna", () => {
    /* Tytuł i podpis zeszły (@wydanie): nazwę ekranu niesie podświetlona
       zakładka, jak na każdym innym ekranie panelu. */
    LISTA = [];
    pokaz();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText(/wracają bezpośrednio z kolektorów/)).toBeNull();
    expect(screen.getByRole("button", { name: "Zadanie dla magazynu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Otwarte" })).toBeInTheDocument();
  });
});

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
    expect(screen.getByRole("button", { name: /Anuluj zadanie/ })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /Zleć ponownie/ }));
    const pole = screen.getByRole("textbox");
    expect(pole).toHaveValue("Od środka do środka, w mm.");
    await u.clear(pole);
    await u.type(pole, "Wałek leży w kartonie przy rampie.");
    await u.click(screen.getByRole("button", { name: /Zleć ponownie/ }));

    expect(ponow).toHaveBeenCalledWith(
      { id: 12, instrukcja: "Wałek leży w kartonie przy rampie." },
      expect.anything());
  });

  it("karta mówi, JAK STARE jest pytanie, a nie kiedy je zadano", () => {
    /* Sam znacznik wymaga odjęcia w głowie, a kartę ogląda się między jedną
       rozmową a drugą. Zadanie sprzed trzech dni wyglądało dokładnie tak samo
       jak sprzed trzech minut — i tak samo się o nim zapominało. */
    LISTA = [zadanie({ zleconeOdMs: 3 * 24 * 3600_000 })];
    pokaz();
    expect(screen.getByText(/3 dni temu/)).toBeInTheDocument();
  });

  it("zadanie zamknięte wraca do znacznika — wiek historii nie jest zaległością", async () => {
    /* Wykonane leży poza widokiem domyślnym, więc test przechodzi na jego
       zakładkę — tak samo jak człowiek szukający wyniku sprzed tygodnia. */
    LISTA = [zadanie({ status: "wykonane", wynik: "46 mm", wykonanoPrzez: "M. Kowal",
      zleconeOdMs: null })];
    pokaz();
    await userEvent.setup().click(screen.getByRole("button", { name: "Wykonane" }));
    expect(screen.getByText("46 mm")).toBeInTheDocument();
    expect(screen.queryByText(/temu/)).not.toBeInTheDocument();
    expect(screen.getByText(/A\. Lewandowska/)).toBeInTheDocument();
  });

  it("zdjęcie od hali stoi na karcie i ma opis w treści zastępczej", () => {
    /* Przy pytaniu „co jest na tabliczce" obraz JEST odpowiedzią. Do 0.351.0
       hala mogła odpowiedzieć wyłącznie tekstem, a agent przepisywał opis ze
       słów magazyniera i wysyłał go kupującemu jako własne ustalenie. */
    LISTA = [zadanie({ zalaczniki: [
      { id: 9, opis: "Tabliczka od spodu", at: "2026-09-15T09:00:00.000Z", przez: "M. Kowal" },
    ] })];
    pokaz();
    const obraz = screen.getByRole("img", { name: "Tabliczka od spodu" });
    expect(obraz).toHaveAttribute("src", "blob:zdjecie");
    expect(screen.getByText("Tabliczka od spodu")).toBeInTheDocument();
  });

  it("nieudane pobranie mówi DLACZEGO i daje ponowić", () => {
    /* Brak zdjęcia z powodu wygląda inaczej niż zdjęcie, którego nikt nie
       zrobił — a tu zdjęcie NA PEWNO jest, bo hala je przysłała. */
    LISTA = [zadanie({ zalaczniki: [
      { id: 4, opis: null, at: "2026-09-15T09:00:00.000Z", przez: "M. Kowal" },
    ] })];
    pokaz();
    expect(screen.getByRole("button", { name: /Serwer nie odpowiada.*ponownie/ })).toBeInTheDocument();
  });

  it("zadanie nieodesłane nie dostaje przycisków biura", () => {
    /* Ponowić można wyłącznie odesłane — serwer to odrzuca, a ekran nie ma
       prawa proponować czynności, która skończy się błędem. */
    LISTA = [zadanie({ status: "w_toku", przypisanoPrzez: "M. Kowal" })];
    pokaz();
    expect(screen.queryByRole("button", { name: /Zleć ponownie/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Hala odesłała/)).not.toBeInTheDocument();
  });
});
