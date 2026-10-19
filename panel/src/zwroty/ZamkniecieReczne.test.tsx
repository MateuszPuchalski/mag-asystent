import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Zwrot } from "../api/typy";
import { ZamkniecieReczne } from "./ZamkniecieReczne";

/* Zamknięcie ręczne dotyczy tylko nas. Test pilnuje, kiedy przycisk w ogóle
   istnieje (zwrot żywy, nie odrzucony, nie zamknięty), co mówi okno i co
   dokładnie wychodzi do ekranu po kliknięciu. */

const zwrot = (n: Partial<Zwrot> = {}) =>
  ({ id: 5, kubelek: "zwrot", wersja: 4, zamknietyRecznie: null, ...n }) as Zwrot;

const pokaz = (z: Zwrot, o: { czekaja?: boolean; blad?: string } = {}) => {
  const onZamknij = vi.fn((_p: string | undefined, poSukcesie: () => void) => poSukcesie());
  const onOtworz = vi.fn();
  render(<ZamkniecieReczne zwrot={z} pieniadzeCzekaja={o.czekaja ?? false} trwa={false}
    blad={o.blad ?? ""} onZamknij={onZamknij} onOtworz={onOtworz} />);
  return { onZamknij, onOtworz };
};

const PRZYCISK = { name: "Zamknij ręcznie" };

describe("Zamknięcie ręczne zwrotu", () => {
  it.each(["decyzja", "ocena", "zwrot", "korekta"] as const)(
    "przycisk stoi przy zwrocie w kubełku %s", (kubelek) => {
      pokaz(zwrot({ kubelek }));
      expect(screen.getByRole("button", PRZYCISK)).toBeInTheDocument();
    });

  it("przy zamkniętym korektą i odrzuconym przycisku nie ma", () => {
    const { container } = render(<ZamkniecieReczne zwrot={zwrot({ kubelek: "zamkniety" })}
      pieniadzeCzekaja={false} trwa={false} blad="" onZamknij={vi.fn()} onOtworz={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    const drugi = render(<ZamkniecieReczne zwrot={zwrot({ kubelek: "odrzucony" })}
      pieniadzeCzekaja={false} trwa={false} blad="" onZamknij={vi.fn()} onOtworz={vi.fn()} />);
    expect(drugi.container).toBeEmptyDOMElement();
  });

  it("okno mówi, że zamyka tylko u nas, i stawia fokus na powodzie", async () => {
    pokaz(zwrot());
    await userEvent.click(screen.getByRole("button", PRZYCISK));
    const okno = screen.getByRole("dialog");
    expect(okno).toHaveTextContent("Zamyka tylko u nas. Allegro i Subiekt bez zmian.");
    expect(screen.getByLabelText("Powód (opcjonalnie)")).toHaveFocus();
    expect(okno).not.toHaveTextContent("jeszcze nie wyszły");
  });

  it("ostrzega, gdy pieniądze jeszcze nie wyszły — bez dodatkowego kroku", async () => {
    const { onZamknij } = pokaz(zwrot(), { czekaja: true });
    await userEvent.click(screen.getByRole("button", PRZYCISK));
    expect(screen.getByRole("dialog"))
      .toHaveTextContent("Pieniądze za ten zwrot jeszcze nie wyszły.");
    await userEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    expect(onZamknij).toHaveBeenCalledTimes(1);
  });

  it("Zamknij oddaje powód, a puste pole oddaje undefined", async () => {
    const { onZamknij } = pokaz(zwrot());
    await userEvent.click(screen.getByRole("button", PRZYCISK));
    await userEvent.type(screen.getByLabelText("Powód (opcjonalnie)"), "  oddane przelewem ");
    await userEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    expect(onZamknij.mock.calls[0][0]).toBe("oddane przelewem");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", PRZYCISK));
    await userEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    expect(onZamknij.mock.calls[1][0]).toBeUndefined();
  });

  it("Anuluj i Escape zamykają okno niczego nie wysyłając", async () => {
    const { onZamknij } = pokaz(zwrot());
    await userEvent.click(screen.getByRole("button", PRZYCISK));
    await userEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", PRZYCISK));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onZamknij).not.toHaveBeenCalled();
  });

  it("błąd serwera stoi w oknie, które zostaje otwarte", async () => {
    pokaz(zwrot(), { blad: "Towar z tego zwrotu leży w koszyku." });
    await userEvent.click(screen.getByRole("button", PRZYCISK));
    expect(screen.getByRole("dialog")).toHaveTextContent("Towar z tego zwrotu leży w koszyku.");
  });

  it("zwrot zamknięty ręcznie: kto, kiedy, powód i Otwórz ponownie bez potwierdzenia", async () => {
    const { onOtworz } = pokaz(zwrot({ kubelek: "zamkniety",
      zamknietyRecznie: { kiedy: "2026-09-20T10:00:00Z", przez: "Ewa", powod: "oddane przelewem" } }));
    expect(screen.queryByRole("button", PRZYCISK)).toBeNull();
    expect(screen.getByText(/Zamknięty ręcznie przez Ewa, /)).toBeInTheDocument();
    expect(screen.getByText(/oddane przelewem/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Otwórz ponownie" }));
    expect(onOtworz).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
