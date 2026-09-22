import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrakDostepu } from "./BrakDostepu";
import tsx from "../main.tsx?raw";

describe("konto magazyniera w biurze (0.431.0)", () => {
  it("mówi, kim jest, czego nie ma i daje wyjście", async () => {
    const wyloguj = vi.fn();
    render(<BrakDostepu login="Jan Wrona" rola="magazynier" wyloguj={wyloguj} />);
    expect(screen.getByText("To konto nie ma dostępu do biura")).toBeInTheDocument();
    expect(screen.getByText("Jan Wrona")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "WYLOGUJ" }));
    expect(wyloguj).toHaveBeenCalledOnce();
  });

  it("rama zatrzymuje magazyniera przed panelem", () => {
    expect(tsx).toContain('u.role === "magazynier"');
    expect(tsx).toContain("<BramkaRoli wyloguj={wyloguj}>");
  });
});
