import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Etapy } from "./Etapy";

/* Oś etapów (0.453.0) zastąpiła zdania o tym, gdzie jest zwrot. Pilnujemy
   trzech rzeczy: że bieżący przystanek jest oznaczony dla oka i dla czytnika,
   że pytanie kubełka nie zginęło, tylko przeszło do podpowiedzi, i że odmowa
   nie obiecuje kroków, na które sprawa już nie wejdzie. */
describe("Etapy zwrotu", () => {
  it("bieżący kubełek jest przystankiem `aria-current`, z pytaniem w podpowiedzi", () => {
    render(<Etapy kubelek="decyzja" />);
    const os = screen.getByRole("list", { name: "Etapy zwrotu" });
    expect(within(os).getAllByRole("listitem")).toHaveLength(5);
    const teraz = within(os).getByText("Decyzja");
    expect(teraz).toHaveAttribute("aria-current", "step");
    expect(teraz).toHaveAttribute("title", "Teraz: Przyjąć czy odrzucić?");
    expect(within(os).getByText("Ocena")).not.toHaveAttribute("aria-current");
  });

  it("przystanek w środku drogi: wcześniejsze za nami, dalsze przed nami", () => {
    render(<Etapy kubelek="zwrot" />);
    expect(screen.getByText("Zwrot")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Zwrot")).toHaveAttribute("title", "Teraz: Ile oddać?");
  });

  it("odrzucony pokazuje DWA przystanki — reszty ta sprawa nie zobaczy", () => {
    render(<Etapy kubelek="odrzucony" />);
    const os = screen.getByRole("list", { name: "Etapy zwrotu" });
    expect(within(os).getAllByRole("listitem")).toHaveLength(2);
    expect(within(os).getByText("Odrzucony")).toHaveAttribute("aria-current", "step");
    expect(within(os).queryByText("Korekta")).toBeNull();
  });
});
