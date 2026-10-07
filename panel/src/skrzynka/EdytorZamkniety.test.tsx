import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edytor } from "./Edytor";
import { Edytor as EdytorSprawy } from "../reklamacje/Edytor";
import { ZAMKNIETY_PROBLEM_W_EDYTORZE } from "./statusy";

/* ── Zamknięty Problem z zakupem w edytorze skrzynki ─────────────────────────
   Allegro odrzuca wiadomość w zamkniętym Problemie (`422 THREAD_CLOSED`).
   Testy pilnują czterech rzeczy:

   1. Wysyłki nie ma w drzewie: ani „Wyślij”, ani „Wyślij i zakończ”, ani pola.
      Skróty Ctrl+Enter i Ctrl+Shift+Enter z tła też nic nie wysyłają.
   2. W miejscu pola stoi jedno zdanie, dlaczego.
   3. Notatka zespołu działa dalej, bo nie idzie do Allegro.
   4. Otwarty edytor i edytor spraw Allegro zachowują się jak dotąd. */

const props = {
  cudza: false, wlasciciel: null as string | null, zapisuje: false, wysyla: false,
  onZapisz: vi.fn(), onWyslij: vi.fn(), onWyslijIZakoncz: vi.fn(),
  komentarz: "", onKomentarz: vi.fn(), onDodajKomentarz: vi.fn(),
  komentuje: false, agenci: [] as Array<{ userId: number; name: string }>, wzmianki: [] as number[],
  onWzmianki: vi.fn(),
  zalaczniki: [] as import("../api/rozmowy").ZalacznikSzkicu[],
  dodajeZalacznik: false, bladZalacznika: "",
  onDodajZalacznik: vi.fn(), onUsunZalacznik: vi.fn(),
};

/** Edytor ze stanem notatki, bo test pisze w niej i klika „Dodaj notatkę”. */
function Sterowany({ zamkniete, onWyslij, onWyslijIZakoncz, onDodajKomentarz, szkic = "Szkic sprzed zamknięcia" }: {
  zamkniete: string | null; onWyslij: () => void; onWyslijIZakoncz: () => void;
  onDodajKomentarz: () => void; szkic?: string;
}) {
  const [notatka, setNotatka] = useState("");
  return <Edytor {...props} szkic={szkic} onZmiana={() => {}} zamkniete={zamkniete}
    onWyslij={onWyslij} onWyslijIZakoncz={onWyslijIZakoncz}
    komentarz={notatka} onKomentarz={setNotatka} onDodajKomentarz={onDodajKomentarz} />;
}

const wysylka = () => screen.queryAllByRole("button", { name: /Wyślij/ });

/** Skrót z tła strony, za zwłoką po otwarciu, żeby milczenie nie wynikało z niej. */
async function zTla(klawisze: string) {
  const zegar = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
  await userEvent.keyboard(klawisze);
  zegar.mockRestore();
}

describe("zamknięty Problem z zakupem", () => {
  it("nie ma pola ani żadnego przycisku wysyłki, jest zdanie dlaczego", () => {
    render(<Sterowany zamkniete={ZAMKNIETY_PROBLEM_W_EDYTORZE}
      onWyslij={vi.fn()} onWyslijIZakoncz={vi.fn()} onDodajKomentarz={vi.fn()} />);
    expect(screen.getByText("Allegro zamknęło ten Problem z zakupem i nie przyjmie tu odpowiedzi."))
      .toBeInTheDocument();
    expect(wysylka()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Inne sposoby wysłania" })).toBeNull();
    expect(screen.queryByLabelText("Szkic odpowiedzi")).toBeNull();
    expect(screen.queryByRole("group", { name: "Działania odpowiedzi" })).toBeNull();
  });

  it("Ctrl+Enter i Ctrl+Shift+Enter z tła nie wysyłają szkicu, który został w pamięci", async () => {
    const onWyslij = vi.fn();
    const onWyslijIZakoncz = vi.fn();
    render(<Sterowany zamkniete={ZAMKNIETY_PROBLEM_W_EDYTORZE}
      onWyslij={onWyslij} onWyslijIZakoncz={onWyslijIZakoncz} onDodajKomentarz={vi.fn()} />);
    await zTla("{Control>}{Enter}{/Control}");
    await zTla("{Control>}{Shift>}{Enter}{/Shift}{/Control}");
    expect(onWyslij).not.toHaveBeenCalled();
    expect(onWyslijIZakoncz).not.toHaveBeenCalled();
  });

  it("notatka działa: przycisk otwiera pole, a „Dodaj notatkę” ją zapisuje", async () => {
    const onDodajKomentarz = vi.fn();
    render(<Sterowany zamkniete={ZAMKNIETY_PROBLEM_W_EDYTORZE}
      onWyslij={vi.fn()} onWyslijIZakoncz={vi.fn()} onDodajKomentarz={onDodajKomentarz} />);
    await userEvent.click(screen.getByRole("button", { name: "Notatka wewnętrzna" }));
    const pole = screen.getByLabelText(/Notatka wewnętrzna — zobaczy ją tylko zespół/);
    expect(document.activeElement).toBe(pole);
    await userEvent.keyboard("klient pisze teraz przez dyskusję");
    await userEvent.click(screen.getByRole("button", { name: /Dodaj notatkę/ }));
    expect(onDodajKomentarz).toHaveBeenCalledTimes(1);
    /* W trybie notatki wysyłki i tak nie ma — tu ani w pasku działań. */
    expect(wysylka()).toEqual([]);
  });

  it("N z tła otwiera notatkę, a powrót do odpowiedzi pokazuje znów samo zdanie", async () => {
    render(<Sterowany zamkniete={ZAMKNIETY_PROBLEM_W_EDYTORZE}
      onWyslij={vi.fn()} onWyslijIZakoncz={vi.fn()} onDodajKomentarz={vi.fn()} />);
    await userEvent.keyboard("n");
    expect(document.activeElement).toBe(screen.getByLabelText(/Notatka wewnętrzna — zobaczy ją tylko zespół/));
    await userEvent.click(screen.getByRole("button", { name: "Odpowiedź do klienta" }));
    expect(screen.getByText(ZAMKNIETY_PROBLEM_W_EDYTORZE)).toBeInTheDocument();
    expect(screen.queryByLabelText("Szkic odpowiedzi")).toBeNull();
    expect(wysylka()).toEqual([]);
  });
});

describe("otwarty edytor bez zmian", () => {
  it("bez `zamkniete` szkic wychodzi przyciskiem i Ctrl+Enter, a zdania nie ma", async () => {
    const onWyslij = vi.fn();
    render(<Sterowany zamkniete={null}
      onWyslij={onWyslij} onWyslijIZakoncz={vi.fn()} onDodajKomentarz={vi.fn()} />);
    expect(screen.queryByText(ZAMKNIETY_PROBLEM_W_EDYTORZE)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    await zTla("{Control>}{Enter}{/Control}");
    expect(onWyslij).toHaveBeenCalledTimes(2);
  });

  it("pusty otwarty edytor to dalej jeden rząd z „Wyślij” i „Notatką”", () => {
    render(<Sterowany zamkniete={null} szkic=""
      onWyslij={vi.fn()} onWyslijIZakoncz={vi.fn()} onDodajKomentarz={vi.fn()} />);
    expect(screen.getByLabelText("Szkic odpowiedzi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wyślij do klienta/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Notatka wewnętrzna" })).toBeInTheDocument();
  });
});

describe("edytor spraw Allegro bez zmian", () => {
  /* Reklamacje i dyskusje nie mają notatki w edytorze. Zamknięty czat to
     tam dalej samo zdanie, bez przycisku „Notatka”, który by tam nic nie znaczył. */
  it("zamknięty czat: samo zdanie, bez notatki i bez wysyłki", () => {
    render(<EdytorSprawy tresc="Szkic" wysyla={false} blad="" czatAktywny={false}
      onZmiana={() => {}} onWyslij={vi.fn()} />);
    expect(screen.getByText(/Allegro zamknęło rozmowę w tej sprawie/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("otwarty czat: pole i wysyłka jak dotąd", () => {
    render(<EdytorSprawy tresc="Szkic" wysyla={false} blad="" czatAktywny
      onZmiana={() => {}} onWyslij={vi.fn()} />);
    expect(screen.getByLabelText("Odpowiedź w sprawie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wyślij odpowiedź/ })).toBeEnabled();
  });
});
