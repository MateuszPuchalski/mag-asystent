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
  onZmiana: vi.fn(), onZapisz: vi.fn(), onWyslij: vi.fn(), onWyslijIZakoncz: undefined as (() => void) | undefined,
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
    expect(screen.getByRole("button", { name: /Wyślij do klienta/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj notatkę/ })).toBeNull();
  });

  it("w trybie komentarza przycisku wysyłki NIE MA — nie da się go kliknąć", async () => {
    edytor({ szkic: "Dzień dobry" });
    await userEvent.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));

    expect(screen.queryByRole("button", { name: /Wyślij do klienta/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Zapisz szkic/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Dodaj notatkę/ })).toBeInTheDocument();
  });

  it("komentarz ma WŁASNE pole — przełączenie trybu nie przenosi tekstu do szkicu", async () => {
    /* Gdyby oba tryby dzieliły jedno pole, notatka „klient bywa trudny"
       zostawałaby w szkicu i czekała na kliknięcie WYŚLIJ. */
    const onZmiana = vi.fn();
    const onKomentarz = vi.fn();
    edytor({ szkic: "Odpowiedź dla klienta", komentarz: "Uwaga wewnętrzna",
      onZmiana, onKomentarz });

    await userEvent.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));
    const pole = screen.getByLabelText(/Notatka wewnętrzna/) as HTMLTextAreaElement;
    expect(pole.value).toBe("Uwaga wewnętrzna");

    await userEvent.type(pole, "!");
    expect(onKomentarz).toHaveBeenCalled();
    expect(onZmiana).not.toHaveBeenCalled();
  });

  it("wzmianka wybiera się z listy kont, nie wpisuje z palca", async () => {
    const onWzmianki = vi.fn();
    edytor({ komentarz: "Zerknij proszę", onWzmianki });
    await userEvent.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));

    await userEvent.click(screen.getByRole("checkbox", { name: /Ala/ }));
    expect(onWzmianki).toHaveBeenCalledWith([7]);
  });

  it("pusty komentarz nie wychodzi", async () => {
    edytor({ komentarz: "   " });
    await userEvent.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));
    expect(screen.getByRole("button", { name: /Dodaj notatkę/ })).toBeDisabled();
  });

  it("cudza rozmowa nie blokuje komentowania — blokuje tylko odpowiedź", async () => {
    /* Komentarz jest notatką zespołu, nie odpowiedzią. Kolega ma prawo dopisać
       „to ten sam klient co wczoraj" bez przejmowania rozmowy. */
    edytor({ cudza: true, wlasciciel: "Ala", komentarz: "Uwaga" });
    await userEvent.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));
    expect(screen.getByRole("button", { name: /Dodaj notatkę/ })).toBeEnabled();
  });
});

describe("Komentarz na osi rozmowy", () => {
  it("wygląda inaczej niż wiadomość klienta i mówi, że klient go nie widzi", () => {
    render(<Os rozmowaId={1} wpisy={[{
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
    render(<Os rozmowaId={1} wpisy={[{
      id: "komentarz-2", rodzaj: "komentarz", autor: "Ala", odKlienta: false,
      tresc: "Uwaga", at: "2026-09-01T10:00:00Z", ofertaId: null,
    }]} zrodloPomiaru={null} mozeZlecac onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

    expect(screen.queryByText(/Zleć z tej wiadomości/)).toBeNull();
  });
});

/* ── Ctrl+Enter wysyła (23 września 2026) ────────────────────────────────────
   Skrót ma ten sam warunek co przycisk: cudza rozmowa i pusty szkic nie
   wysyłają. Sam Enter zostaje nową linią — odpowiedź ma akapity. */
describe("Ctrl+Enter w polu odpowiedzi", () => {
  it("wysyła z klawiatury, a sam Enter nie", async () => {
    const onWyslij = vi.fn();
    edytor({ szkic: "Dzień dobry", onWyslij });
    const pole = screen.getByLabelText("Szkic odpowiedzi");
    pole.focus();
    await userEvent.keyboard("{Enter}");
    expect(onWyslij).not.toHaveBeenCalled();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onWyslij).toHaveBeenCalledTimes(1);
  });

  it("cudza rozmowa i pusty szkic nie wysyłają skrótem", async () => {
    const onWyslij = vi.fn();
    const { unmount } = edytor({ szkic: "Dzień dobry", cudza: true, onWyslij });
    screen.getByLabelText("Szkic odpowiedzi").focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    unmount();
    edytor({ szkic: "   ", onWyslij });
    screen.getByLabelText("Szkic odpowiedzi").focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onWyslij).not.toHaveBeenCalled();
  });
});

/* ── Wyślij i zakończ (23 września 2026) ─────────────────────────────────────
   Większość spraw kończy się ostatnią odpowiedzią, więc werdykt jedzie z nią.
   Ctrl+Shift+Enter to ta sama droga co drugi przycisk — i ten sam warunek. */
describe("Wyślij i zakończ", () => {
  it("przycisk i Ctrl+Shift+Enter wołają wysyłkę z zakończeniem, a Ctrl+Enter — zwykłą", async () => {
    const onWyslij = vi.fn();
    const onWyslijIZakoncz = vi.fn();
    edytor({ szkic: "Dzień dobry", onWyslij, onWyslijIZakoncz });
    screen.getByLabelText("Szkic odpowiedzi").focus();
    await userEvent.keyboard("{Control>}{Shift>}{Enter}{/Shift}{/Control}");
    expect(onWyslijIZakoncz).toHaveBeenCalledTimes(1);
    expect(onWyslij).not.toHaveBeenCalled();
    /* Od 0.506.0 „Wyślij i zakończ" stoi pod „▾" obok wysyłki. */
    await userEvent.click(screen.getByRole("button", { name: "Inne sposoby wysłania" }));
    await userEvent.click(screen.getByRole("button", { name: /Wyślij i zakończ/ }));
    expect(onWyslijIZakoncz).toHaveBeenCalledTimes(2);
  });
});
