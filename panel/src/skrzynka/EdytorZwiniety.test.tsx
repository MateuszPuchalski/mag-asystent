import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edytor } from "./Edytor";

/* ── Wątek pierwszy: pusty edytor to jedna linijka (@wydanie) ────────────────
   Wariant C, decyzja właściciela z 28 września. Testy pilnują czterech rzeczy:

   1. Pusty edytor to jeden rząd: pole, „Notatka”, spinacz i martwe „Wyślij”.
      Bez zakładek i bez pływającego paska.
   2. Pierwsza litera rozwija edytor, a pole NIE traci fokusu. Inny rodzic
      przemontowałby je i zabrał kursor w pół słowa.
   3. Szkic zespołu (niepusty na starcie) otwiera edytor rozwinięty.
   4. N z tła strony otwiera notatkę z kursorem w jej polu; N w polu to litera. */

const props = {
  cudza: false, wlasciciel: null as string | null, zapisuje: false, wysyla: false,
  onZapisz: vi.fn(), onWyslij: vi.fn(),
  komentarz: "", onKomentarz: vi.fn(), onDodajKomentarz: vi.fn(),
  komentuje: false, agenci: [] as Array<{ userId: number; name: string }>, wzmianki: [] as number[],
  onWzmianki: vi.fn(),
  zalaczniki: [] as import("../api/rozmowy").ZalacznikSzkicu[],
  dodajeZalacznik: false, bladZalacznika: "",
  onDodajZalacznik: vi.fn(), onUsunZalacznik: vi.fn(),
};

function Sterowany({ start = "" }: { start?: string }) {
  const [szkic, setSzkic] = useState(start);
  const [notatka, setNotatka] = useState("");
  return <Edytor {...props} szkic={szkic} onZmiana={setSzkic} komentarz={notatka} onKomentarz={setNotatka} />;
}

const zakladka = () => screen.queryByRole("button", { name: "Odpowiedź do klienta" });
const pasek = () => screen.queryByRole("group", { name: "Działania odpowiedzi" });

describe("pusty edytor to jedna linijka", () => {
  it("pusty: jeden rząd z martwym „Wyślij”, bez zakładek i pływającego paska", () => {
    render(<Sterowany />);
    expect(zakladka()).toBeNull();
    expect(pasek()).toBeNull();
    expect(screen.getByRole("button", { name: /Wyślij do klienta/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Notatka wewnętrzna" })).toBeInTheDocument();
    expect(screen.getByLabelText("Szkic odpowiedzi")).toHaveAttribute("placeholder",
      expect.stringMatching(/^Odpowiedz klientowi…/));
  });

  it("pierwsza litera rozwija edytor, a pole zostaje tym samym elementem z kursorem", async () => {
    render(<Sterowany />);
    const pole = screen.getByLabelText("Szkic odpowiedzi");
    await userEvent.click(pole);
    await userEvent.keyboard("Dzień dobry");
    expect(screen.getByLabelText("Szkic odpowiedzi")).toBe(pole);
    expect(document.activeElement).toBe(pole);
    expect(pole).toHaveValue("Dzień dobry");
    expect(zakladka()).toBeInTheDocument();
    expect(pasek()).toBeInTheDocument();
  });

  it("szkic zespołu na starcie otwiera edytor rozwinięty", () => {
    render(<Sterowany start="Szkic kolegi" />);
    expect(zakladka()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wyślij do klienta/ })).toBeEnabled();
  });

  it("N z tła strony otwiera notatkę z kursorem w jej polu, a w polu odpowiedzi jest literą", async () => {
    render(<Sterowany />);
    await userEvent.keyboard("n");
    const notatka = screen.getByLabelText(/Notatka wewnętrzna — zobaczy ją tylko zespół/);
    expect(document.activeElement).toBe(notatka);
    await userEvent.keyboard("to ten sam klient");
    expect(notatka).toHaveValue("to ten sam klient");
  });

  it("N w polu odpowiedzi pisze literę, nie przełącza trybu", async () => {
    render(<Sterowany />);
    await userEvent.click(screen.getByLabelText("Szkic odpowiedzi"));
    await userEvent.keyboard("Nóż");
    expect(screen.getByLabelText("Szkic odpowiedzi")).toHaveValue("Nóż");
    expect(screen.queryByLabelText(/Notatka wewnętrzna — zobaczy/)).toBeNull();
  });
});
