import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DolozTowar } from "./DolozTowar";
import type { TowarDoKosza } from "../api/zwroty";

/* ── Dołożenie towaru do koszyka: skan albo kartoteka (0.365.0) ──────────────
   Zgłoszenie właściciela, z granicą wypowiedzianą zaraz po nim: „tylko
   z poziomu obsługi zwrotów, jak jeszcze nie jest zamknięty".

   Dwie rzeczy są tu warte testu, bo ich pomyłka kosztuje cudzy towar
   w pudle: skan ma dokładać BEZ wybierania z listy, a ekran ma mówić, czego
   to dołożenie NIE robi — pieniędzy nie rusza. */

const wynik: { towary: TowarDoKosza[]; dokladne: boolean; przyblizone: boolean } = {
  towary: [], dokladne: false, przyblizone: false,
};
const doloz = vi.fn();

vi.mock("../api/zwroty", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTowaryDoKosza: (q: string) => ({
    data: q.trim() ? wynik : undefined, isFetching: false,
  }),
  useDolozTowar: () => ({ mutate: doloz, isPending: false }),
}));

const TOWAR = (n: Partial<TowarDoKosza> = {}): TowarDoKosza => ({
  twId: 21, symbol: "SEK-01", nazwa: "Sekator ogrodowy", ean: "5900000000001", stanMag: 4, ...n,
});

beforeEach(() => {
  wynik.towary = []; wynik.dokladne = false; wynik.przyblizone = false;
  doloz.mockClear();
});

const otworz = async () => {
  render(<DolozTowar />);
  await userEvent.click(screen.getByRole("button", { name: /Dołóż towar do koszyka/ }));
};

describe("Dołożenie towaru do koszyka", () => {
  it("do pierwszego kliknięcia zajmuje JEDEN przycisk", () => {
    /* Pole szukania stojące otworem byłoby stałym elementem ekranu, który
       przy większości zwrotów nie jest do niczego potrzebny. */
    render(<DolozTowar />);
    expect(screen.queryByLabelText("Towar do koszyka")).toBeNull();
    expect(screen.getByRole("button", { name: /Dołóż towar do koszyka/ })).toBeInTheDocument();
  });

  it("wybranie z listy dokłada JEDNĄ sztukę wskazanego towaru", async () => {
    wynik.towary = [TOWAR(), TOWAR({ twId: 22, symbol: "LOP-02", nazwa: "Łopata" })];
    await otworz();
    await userEvent.type(screen.getByLabelText("Towar do koszyka"), "sekator");
    await userEvent.click(screen.getByRole("button", { name: /SEK-01/ }));
    expect(doloz).toHaveBeenCalledWith(
      { twId: 21, ilosc: 1, rodzaj: "zwroty" }, expect.anything());
  });

  it("Enter przy JEDNYM wyniku dokłada bez klikania w listę", async () => {
    /* Skan zwraca jedno trafienie i jest wskazaniem, nie pytaniem. Kazanie
       operatorowi potwierdzać je kliknięciem byłoby pytaniem o to, co czytnik
       już powiedział (dekalog, punkt 3). */
    wynik.towary = [TOWAR()];
    wynik.dokladne = true;
    await otworz();
    await userEvent.type(screen.getByLabelText("Towar do koszyka"), "5900000000001{Enter}");
    expect(doloz).toHaveBeenCalledTimes(1);
    expect(doloz.mock.calls[0][0]).toEqual({ twId: 21, ilosc: 1, rodzaj: "zwroty" });
  });

  it("przy KILKU wynikach Enter nie zgaduje", async () => {
    /* Dwa trafienia to brak trafienia — wybiera człowiek, patrząc na oba.
       Ta sama zasada co przy szukaniu zwrotu. */
    wynik.towary = [TOWAR(), TOWAR({ twId: 22, symbol: "LOP-02" })];
    await otworz();
    await userEvent.type(screen.getByLabelText("Towar do koszyka"), "ogrod{Enter}");
    expect(doloz).not.toHaveBeenCalled();
  });

  it("mówi WPROST, czego to dołożenie nie robi", async () => {
    /* Bez tego zdania „dołóż towar" przy karcie zwrotu czyta się jak dopisanie
       pozycji do rozliczenia — a zwrot wycenia się z tego, co klient zgłosił
       i co potwierdza dokument sprzedaży. */
    await otworz();
    expect(screen.getByText(/nie do rozliczenia z klientem/)).toBeInTheDocument();
  });

  it("nietrafiona fraza mówi to wprost, zamiast milczeć", async () => {
    await otworz();
    await userEvent.type(screen.getByLabelText("Towar do koszyka"), "czegoś takiego nie ma");
    expect(screen.getByText(/Nie znam takiego towaru/)).toBeInTheDocument();
  });
});
