import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── Silniki: która maszyna z jakim silnikiem (§11.2) ────────────────────────
   Ten ekran ma jedną granicę, której nie wolno przekroczyć: automat układa
   kolejkę i pokazuje SUROWY tekst wpisany przez agentów, ale NIE rozbija go
   na markę i nazwę. Klik na czipie wstawia tekst do poprawki, nie wysyła.  */

const dane = vi.fn();
const zaproponuj = { mutate: vi.fn(), isPending: false };
const rozstrzygnij = { mutate: vi.fn(), isPending: false };
const wycofaj = { mutate: vi.fn(), isPending: false };
vi.mock("../api/wiedza", () => ({
  useSilniki: () => dane(),
  useZaproponujZabudowe: () => zaproponuj,
  useRozstrzygnijZabudowe: () => rozstrzygnij,
  useWycofajZabudowe: () => wycofaj,
  useModele: () => ({ data: undefined }),
}));

const { Silniki } = await import("./Silniki");

const para = (id: number, silnik: string) => ({
  id, stan: "propozycja", zrodlo: "reczne", rodzajDowodu: "producent",
  nazwaRodzajuDowodu: "producent", dowodTresc: "karta katalogowa", dowodLink: null, komentarz: null,
  conversationId: null, zastepujeId: null, zaproponowal: "Ala", zaproponowanoAt: "2026-09-07T10:00:00Z",
  rozstrzygnal: null, rozstrzygnietoAt: null, powodRozstrzygniecia: null, pewnosc: "potwierdzone",
  maszyna: { id: 1, rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450", wariant: null, lata: null,
    klucz: "maszyna|nacls46450", etykieta: "NAC LS 46-450" },
  silnik: { id, rodzaj: "silnik", marka: "Briggs & Stratton", nazwa: silnik, wariant: null, lata: null,
    klucz: `silnik|bs${silnik}`, etykieta: `silnik Briggs & Stratton ${silnik}` },
  zdanieZrodla: `silnik Briggs & Stratton ${silnik} stoi w NAC LS 46-450 — producent, 7.09.2026, Ala`,
});

const luka = (n: Record<string, unknown> = {}) => ({
  marka: "NAC", model: "LS 46-450", wariant: null, klucz: "maszyna|nacls46450", pytan: 14,
  wpisaneSilniki: [{ tekst: "B&S 450E", ile: 9 }, { tekst: "Loncin", ile: 2 }], zabudowy: [], ...n,
});

beforeEach(() => {
  vi.clearAllMocks();
  dane.mockReturnValue({ data: { propozycje: [], doRozstrzygniecia: 0, lukiRazem: 1, luki: [luka()], zatwierdzone: [] },
    isLoading: false, error: null });
});

describe("Silniki", () => {
  it("luka pokazuje częstość i SUROWE łańcuchy z licznikiem", () => {
    render(<Silniki />);
    expect(screen.getByText("NAC LS 46-450")).toBeInTheDocument();
    expect(screen.getByText("14 doborów")).toBeInTheDocument();
    expect(screen.getByText("brak silnika")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "B&S 450E ×9" })).toBeInTheDocument();
  });

  it("klik na czipie wstawia tekst DO POPRAWKI, a nie wysyła go", async () => {
    render(<Silniki />);
    await userEvent.click(screen.getByRole("button", { name: "B&S 450E ×9" }));
    /* Tekst ląduje w polu Model — markę i poprawną nazwę dopisuje człowiek. */
    expect(screen.getByLabelText("Model")).toHaveValue("B&S 450E");
    expect(zaproponuj.mutate).not.toHaveBeenCalled();
  });

  it("bez marki, nazwy i dowodu przycisk nie wysyła; z nimi leci pełna para", async () => {
    render(<Silniki />);
    await userEvent.click(screen.getByRole("button", { name: "Dopisz silnik" }));
    expect(screen.getByRole("button", { name: "Zaproponuj" })).toBeDisabled();
    /* Rodzaj zablokowany: na tej liście dopisuje się wyłącznie silniki. */
    expect(screen.getByLabelText("Rodzaj urządzenia")).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Marka"), "Briggs & Stratton");
    await userEvent.type(screen.getByLabelText("Model"), "450E");
    await userEvent.type(screen.getByLabelText("Dowód"), "tabliczka znamionowa");
    await userEvent.click(screen.getByRole("button", { name: "Zaproponuj" }));
    expect(zaproponuj.mutate).toHaveBeenCalledWith(expect.objectContaining({
      maszyna: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450", wariant: null },
      silnik: { rodzaj: "silnik", marka: "Briggs & Stratton", nazwa: "450E", wariant: null },
      rodzajDowodu: "producent", dowodTresc: "tabliczka znamionowa",
    }), expect.anything());
  });

  it("odrzucenie propozycji wymaga powodu", async () => {
    dane.mockReturnValue({ data: { propozycje: [para(7, "450E")], doRozstrzygniecia: 1, luki: [], lukiRazem: 0, zatwierdzone: [] },
      isLoading: false, error: null });
    render(<Silniki />);
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    expect(screen.getAllByRole("button", { name: "Odrzuć" })[0]).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Powód odrzucenia"), "to inna wersja");
    await userEvent.click(screen.getAllByRole("button", { name: "Odrzuć" })[0]);
    expect(rozstrzygnij.mutate).toHaveBeenCalledWith(
      { id: 7, decyzja: "odrzuc", powod: "to inna wersja" }, expect.anything());
  });

  it("wycofanie zatwierdzonej pary też wymaga powodu — gasi całą gałąź kandydatów", async () => {
    dane.mockReturnValue({ data: { propozycje: [], doRozstrzygniecia: 0, lukiRazem: 1, luki: [],
      zatwierdzone: [{ ...para(7, "450E"), stan: "zatwierdzone" }] }, isLoading: false, error: null });
    render(<Silniki />);
    await userEvent.click(screen.getByRole("button", { name: "Wycofaj" }));
    expect(screen.getAllByRole("button", { name: "Wycofaj" })[0]).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Powód wycofania"), "pomyłka");
    await userEvent.click(screen.getAllByRole("button", { name: "Wycofaj" })[0]);
    expect(wycofaj.mutate).toHaveBeenCalledWith({ id: 7, powod: "pomyłka" }, expect.anything());
  });

  it("maszyna ze znanym silnikiem nie krzyczy „brak silnika”", () => {
    dane.mockReturnValue({ data: { propozycje: [], doRozstrzygniecia: 0, lukiRazem: 1, zatwierdzone: [],
      luki: [luka({ pytan: 1, zabudowy: [{ ...para(7, "450E"), stan: "zatwierdzone" }] })] },
      isLoading: false, error: null });
    render(<Silniki />);
    expect(screen.queryByText("brak silnika")).toBeNull();
    expect(screen.getByText(/silniki: silnik Briggs & Stratton 450E/)).toBeInTheDocument();
    expect(screen.getByText("1 dobór")).toBeInTheDocument();
  });
});
