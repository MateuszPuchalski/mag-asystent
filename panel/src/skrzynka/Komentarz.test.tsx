import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edytor } from "./Edytor";
import { Os } from "./Os";

/* ── Komentarz wewnętrzny w edytorze (0.157.0) ───────────────────────────────
   §6.4: komentarze „nie mogą przypadkiem trafić do klienta". §25 stawia to
   wśród kryteriów gotowości, a §10.4 żąda, żeby przycisk komentarza i przycisk
   wysyłki były JEDNOZNACZNIE ROZDZIELONE.

   Rozdzielenie robimy najmocniej, jak się da: w trybie komentarza przycisku
   wysyłki NIE MA W DRZEWIE. Wyłączony przycisk da się kliknąć po zmianie
   trybu o ułamek sekundy za późno; przycisku, którego nie ma, nie da się. */

const props = {
  szkic: "", cudza: false, wlasciciel: null as string | null, zapisuje: false, wysyla: false,
  onZmiana: vi.fn(), onZapisz: vi.fn(), onWyslij: vi.fn(),
  komentarz: "", onKomentarz: vi.fn(), onDodajKomentarz: vi.fn(),
  komentuje: false, agenci: [{ userId: 7, name: "Ala" }], wzmianki: [] as number[],
  onWzmianki: vi.fn(),
  zalaczniki: [] as import("../api/rozmowy").ZalacznikSzkicu[],
  dodajeZalacznik: false, bladZalacznika: "",
  onDodajZalacznik: vi.fn(), onUsunZalacznik: vi.fn(),
};

const edytor = (n: Partial<typeof props> = {}) => render(<Edytor {...props} {...n} />);

describe("Edytor — tryb komentarza wewnętrznego", () => {
  it("domyślnie jest trybem odpowiedzi do klienta", () => {
    edytor({ szkic: "Dzień dobry" });
    expect(screen.getByRole("button", { name: /WYŚLIJ DO KLIENTA/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /DODAJ KOMENTARZ/ })).toBeNull();
  });

  it("w trybie komentarza przycisku wysyłki NIE MA — nie da się go kliknąć", async () => {
    edytor({ szkic: "Dzień dobry" });
    await userEvent.click(screen.getByRole("button", { name: /Komentarz wewnętrzny/ }));

    expect(screen.queryByRole("button", { name: /WYŚLIJ DO KLIENTA/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ZAPISZ SZKIC/ })).toBeNull();
    expect(screen.getByRole("button", { name: /DODAJ KOMENTARZ/ })).toBeInTheDocument();
  });

  it("komentarz ma WŁASNE pole — przełączenie trybu nie przenosi tekstu do szkicu", async () => {
    /* Gdyby oba tryby dzieliły jedno pole, notatka „klient bywa trudny"
       zostawałaby w szkicu i czekała na kliknięcie WYŚLIJ. */
    const onZmiana = vi.fn();
    const onKomentarz = vi.fn();
    edytor({ szkic: "Odpowiedź dla klienta", komentarz: "Uwaga wewnętrzna",
      onZmiana, onKomentarz });

    await userEvent.click(screen.getByRole("button", { name: /Komentarz wewnętrzny/ }));
    const pole = screen.getByLabelText(/Komentarz wewnętrzny/) as HTMLTextAreaElement;
    expect(pole.value).toBe("Uwaga wewnętrzna");

    await userEvent.type(pole, "!");
    expect(onKomentarz).toHaveBeenCalled();
    expect(onZmiana).not.toHaveBeenCalled();
  });

  it("wzmianka wybiera się z listy kont, nie wpisuje z palca", async () => {
    const onWzmianki = vi.fn();
    edytor({ komentarz: "Zerknij proszę", onWzmianki });
    await userEvent.click(screen.getByRole("button", { name: /Komentarz wewnętrzny/ }));

    await userEvent.click(screen.getByRole("checkbox", { name: /Ala/ }));
    expect(onWzmianki).toHaveBeenCalledWith([7]);
  });

  it("pusty komentarz nie wychodzi", async () => {
    edytor({ komentarz: "   " });
    await userEvent.click(screen.getByRole("button", { name: /Komentarz wewnętrzny/ }));
    expect(screen.getByRole("button", { name: /DODAJ KOMENTARZ/ })).toBeDisabled();
  });

  it("cudza rozmowa nie blokuje komentowania — blokuje tylko odpowiedź", async () => {
    /* Komentarz jest notatką zespołu, nie odpowiedzią. Kolega ma prawo dopisać
       „to ten sam klient co wczoraj" bez przejmowania rozmowy. */
    edytor({ cudza: true, wlasciciel: "Ala", komentarz: "Uwaga" });
    await userEvent.click(screen.getByRole("button", { name: /Komentarz wewnętrzny/ }));
    expect(screen.getByRole("button", { name: /DODAJ KOMENTARZ/ })).toBeEnabled();
  });
});

describe("Komentarz na osi rozmowy", () => {
  it("wygląda inaczej niż wiadomość klienta i mówi, że klient go nie widzi", () => {
    render(<Os wpisy={[{
      id: "komentarz-1", rodzaj: "komentarz", autor: "Ala", odKlienta: false,
      tresc: "To ten sam klient co wczoraj.", at: "2026-09-01T10:00:00Z",
      ofertaId: null, wzmianki: [{ userId: 7, name: "Bogdan" }],
    }]} zrodloPomiaru={null} mozeZlecac={false} onZrodlo={() => {}}
      onWstawDoSzkicu={() => {}} />);

    expect(screen.getByText(/NOTATKA WEWNĘTRZNA/)).toBeInTheDocument();
    expect(screen.getByText(/Bogdan/)).toBeInTheDocument();
    expect(screen.getByText(/To ten sam klient co wczoraj/)).toBeInTheDocument();
  });

  it("nie proponuje zlecenia pomiaru — to nie jest pytanie klienta", () => {
    /* Zlecenie idzie z wiadomości KLIENTA, bo to ona niesie pytanie. Notatka
       zespołu nie ma czego zlecić, a przycisk sugerowałby, że ma. */
    render(<Os wpisy={[{
      id: "komentarz-2", rodzaj: "komentarz", autor: "Ala", odKlienta: false,
      tresc: "Uwaga", at: "2026-09-01T10:00:00Z", ofertaId: null,
    }]} zrodloPomiaru={null} mozeZlecac onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

    expect(screen.queryByText(/Zleć z tej wiadomości/)).toBeNull();
  });
});
