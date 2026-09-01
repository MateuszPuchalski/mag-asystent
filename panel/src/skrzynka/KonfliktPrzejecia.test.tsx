import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KonfliktPrzejecia } from "./KonfliktPrzejecia";

const props = {
  szczegoly: { assignedUserId: 7, assignedUserName: "M. Wójcik",
    assignedAt: "2026-09-01T09:47:12.000Z", version: 12 },
  mojaWersja: 11,
  czasPrzejecia: "09:47:12",
  mozeWymusic: false,
  wymusza: false,
  blad: "",
  onPoprosOPrzekazanie: () => {},
  onWymus: () => {},
  onZamknij: () => {},
};

describe("KonfliktPrzejecia", () => {
  it("pokazuje właściciela, czas przejęcia i OBIE wersje", () => {
    /* Bez tych trzech rzeczy zostaje goły komunikat błędu, a agent nie wie,
       czy poczekać, czy prosić o przekazanie. */
    render(<KonfliktPrzejecia {...props} />);
    expect(screen.getByText(/rozmowę prowadzi M. Wójcik/)).toBeInTheDocument();
    expect(screen.getByText("09:47:12")).toBeInTheDocument();
    expect(screen.getByText(/12 · Twoje żądanie niosło 11/)).toBeInTheDocument();
  });

  it("wymuszenia nie widzi ktoś bez uprawnienia", () => {
    render(<KonfliktPrzejecia {...props} />);
    expect(screen.queryByText(/WYMUŚ PRZEKAZANIE/)).not.toBeInTheDocument();
  });

  it("wymuszenie bez powodu jest martwe", async () => {
    const wymus = vi.fn();
    render(<KonfliktPrzejecia {...props} mozeWymusic onWymus={wymus} />);
    await userEvent.click(screen.getByRole("button", { name: /WYMUŚ PRZEKAZANIE/ }));
    const zapisz = screen.getByRole("button", { name: /WYMUŚ I ZAPISZ POWÓD/ });
    expect(zapisz).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Powód wymuszenia"), "Urlop od dziś");
    expect(zapisz).toBeEnabled();
    await userEvent.click(zapisz);
    expect(wymus).toHaveBeenCalledWith("Urlop od dziś");
  });

  it("mówi wprost, że powód idzie do dziennika", async () => {
    render(<KonfliktPrzejecia {...props} mozeWymusic />);
    await userEvent.click(screen.getByRole("button", { name: /WYMUŚ PRZEKAZANIE/ }));
    expect(screen.getByText(/trafia do dziennika/)).toBeInTheDocument();
  });
});
