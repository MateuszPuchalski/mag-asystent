import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edytor } from "./Edytor";
import { useOkno } from "../nawigacja/fokus";

/* ── Wątek pierwszy: pusty edytor to jedna linijka (0.548.0) ────────────────
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

  it("błąd załącznika rozwija pusty edytor i staje zdaniem, nie ginie", () => {
    /* Recenzja (0.548.0): zwinięty rząd nie rysował `ZalacznikiWysylki`, więc
       odmowa serwera przy pustym polu kończyła się ciszą. */
    render(<Edytor {...props} szkic="" onZmiana={() => {}} bladZalacznika="Plik ma więcej niż 4 MB" />);
    expect(zakladka()).toBeInTheDocument();
    expect(screen.getByText("Plik ma więcej niż 4 MB")).toBeInTheDocument();
  });

  it("pod oknem modalnym N milczy — notatki nie otwiera", async () => {
    function Okno() {
      const okno = useOkno<HTMLDivElement>({});
      return <div role="dialog" {...okno} aria-label="Historia klienta"><button type="button">x</button></div>;
    }
    render(<><Sterowany /><Okno /></>);
    await userEvent.keyboard("n");
    expect(screen.queryByLabelText(/Notatka wewnętrzna — zobaczy/)).toBeNull();
  });

  it("za sufitem 2000 znaków wysyłka jest martwa, a licznik mówi, ile skrócić", () => {
    /* Sufit Centrum Wiadomości pilnował sam serwer, więc agent dowiadywał się
       o nim po kliknięciu. Wspólny edytor zna sufit i blokuje przed wysyłką. */
    render(<Edytor {...props} szkic={"x".repeat(2003)} onZmiana={() => {}} />);
    expect(screen.getByRole("button", { name: /Wyślij do klienta/ })).toBeDisabled();
    expect(screen.getByText(/o 3 za dużo/)).toBeInTheDocument();
  });

  it("licznik mówi pełną liczbą przy suficie skrzynki: „5 / 2000”", () => {
    render(<Edytor {...props} szkic="Dzień" onZmiana={() => {}} />);
    expect(screen.getByText("5 / 2000")).toBeInTheDocument();
  });

  it("podpis nad dymkiem mówi, że szkic widzi zespół, a zwinięty rząd go nie ma", () => {
    const { rerender } = render(<Edytor {...props} szkic="" onZmiana={() => {}} />);
    expect(screen.queryByText("Twoja odpowiedź")).toBeNull();
    rerender(<Edytor {...props} szkic="Dzień dobry" onZmiana={() => {}} />);
    expect(screen.getByText("Twoja odpowiedź").parentElement)
      .toHaveTextContent(/^Twoja odpowiedź · szkic, widzi go zespół$/);
  });

  it("zwinięty rząd ma kształt dymka: ta sama ramka i ogonek co rozwinięty", () => {
    render(<Sterowany />);
    const dymek = screen.getByRole("article", { name: "Twoja odpowiedź" });
    expect(dymek).toHaveClass("border-blue-300", "rounded-br");
    expect(dymek.parentElement).toHaveClass("sticky");
  });

  it("Enter z wybranego wiersza kolejki idzie do pola, z innego otwiera ten wiersz", async () => {
    const otworz = vi.fn();
    render(<>
      <button type="button" data-wiersz-kolejki="" aria-current="true">wybrana</button>
      <button type="button" data-wiersz-kolejki="" aria-current="false" onClick={otworz}>inna</button>
      <Sterowany />
    </>);
    screen.getByRole("button", { name: "inna" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(otworz).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "inna" }));
    screen.getByRole("button", { name: "wybrana" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Szkic odpowiedzi"));
  });

  it("N w polu odpowiedzi pisze literę, nie przełącza trybu", async () => {
    render(<Sterowany />);
    await userEvent.click(screen.getByLabelText("Szkic odpowiedzi"));
    await userEvent.keyboard("Nóż");
    expect(screen.getByLabelText("Szkic odpowiedzi")).toHaveValue("Nóż");
    expect(screen.queryByLabelText(/Notatka wewnętrzna — zobaczy/)).toBeNull();
  });
});
