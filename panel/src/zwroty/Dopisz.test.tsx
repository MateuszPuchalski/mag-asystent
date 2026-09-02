import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dopisz } from "./Dopisz";
import type { DoDopisania } from "../api/typy";

/* ── Produkt, którego klient nie zgłosił (0.184.0) ───────────────────────────
   Te testy pilnują trzech punktów dekalogu ergonomii, które obowiązują panel
   biura: 5 (mniej decyzji), 6 (ograniczenie zamiast komunikatu) i 2 (tylko to,
   co potrzebne teraz).                                                       */

const KANDYDAT = (n: Partial<DoDopisania> = {}): DoDopisania => ({
  zamPozycjaId: 7, offerId: "222", nazwa: "Łopata", ilosc: 1,
  cenaGrosze: 2999, waluta: "PLN", ...n,
});

const pokaz = (kandydaci: DoDopisania[], onDopisz = vi.fn()) => {
  render(<Dopisz kandydaci={kandydaci} trwa={false} blad="" onDopisz={onDopisz} />);
  return onDopisz;
};

describe("Dopisanie produktu do zwrotu", () => {
  it("bez kandydatów ekran MILCZY — nie ma czego dopisać", () => {
    /* Punkt 5: rozwijanie pustej listy to decyzja bez treści. Tak samo zwrot
       bez pobranego zamówienia — lista nie ma wtedy skąd powstać. */
    const { container } = render(
      <Dopisz kandydaci={[]} trwa={false} blad="" onDopisz={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lista otwiera się DOPIERO na żądanie", () => {
    /* Punkt 2: dopisanie jest wyjątkiem, nie codziennością. Stała lista pod
       każdym zwrotem byłaby ścianą pytań o rzecz raz na kilkanaście paczek. */
    pokaz([KANDYDAT()]);
    expect(screen.queryByRole("button", { name: /Łopata/ })).toBeNull();
    expect(screen.getByRole("button", { name: /przysłał więcej, niż zgłosił/ }))
      .toBeInTheDocument();
  });

  it("wybiera się Z LISTY, a nie z pola tekstowego", async () => {
    /* Punkt 6: ograniczenie jest tańsze od komunikatu. Klient może odesłać
       wyłącznie to, co kupił, więc zamówienie jest granicą naturalną. */
    const onDopisz = pokaz([
      KANDYDAT({ zamPozycjaId: 7, nazwa: "Łopata" }),
      KANDYDAT({ zamPozycjaId: 9, nazwa: "Grabie", cenaGrosze: 1999 }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: /przysłał więcej/ }));

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/zostały jeszcze 2 pozycje/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Grabie/ }));
    expect(onDopisz).toHaveBeenCalledWith(9);
  });

  it("cena idzie z zamówienia i widać ją przed kliknięciem", async () => {
    pokaz([KANDYDAT()]);
    await userEvent.click(screen.getByRole("button", { name: /przysłał więcej/ }));
    expect(screen.getByText("29,99 PLN")).toBeInTheDocument();
  });

  it("ekran mówi, czym stanie się dopisana pozycja", async () => {
    /* §4.3: wybór człowieka nie ma udawać faktu z Allegro — i operator ma to
       wiedzieć ZANIM kliknie, nie po. */
    pokaz([KANDYDAT()]);
    await userEvent.click(screen.getByRole("button", { name: /przysłał więcej/ }));
    expect(screen.getByText(/oznaczona jako zapis biura/)).toBeInTheDocument();
    expect(screen.getByText(/wchodzi do kwoty do oddania/)).toBeInTheDocument();
  });

  it("odmowa serwera ląduje przy liście, a nie w konsoli", async () => {
    render(<Dopisz kandydaci={[KANDYDAT()]} trwa={false}
      blad="Zwrot zmienił się w innej karcie" onDopisz={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /przysłał więcej/ }));
    expect(screen.getByText(/zmienił się w innej karcie/)).toBeInTheDocument();
  });
});
