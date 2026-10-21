import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Galeria } from "./Galeria";
import { KafelZalacznika } from "./Zalacznik";
import { Powiekszenie } from "./Powiekszenie";

/* ── Obrót zdjęcia w powiększeniu ────────────────────────────────────────────
   Zdjęcie z telefonu przychodzi bokiem. Przyciski obracają je o ćwierć
   obrotu, osobno dla każdego zdjęcia galerii. Płótna jsdom nie narysuje,
   więc obrót oddaje adres, z którego widać kąt. */

const obroconeZdjecie = vi.fn(async (url: string, obrot: number) => `${url}@${obrot}`);
vi.mock("./obrotZdjecia", () => ({
  obroconeZdjecie: (url: string, obrot: number) => obroconeZdjecie(url, obrot),
}));

beforeEach(() => {
  obroconeZdjecie.mockClear();
  /* Adresy z atrapy nie są prawdziwymi `blob:`, więc zwolnienie tylko liczymy. */
  URL.revokeObjectURL = vi.fn();
});

/** Zdjęcie w oknie, nie miniatura kafla o tej samej nazwie. */
const zdjecie = (nazwa: string) => within(screen.getByRole("dialog")).getByRole("img", { name: nazwa });

describe("obrót zdjęcia w powiększeniu", () => {
  it("w prawo i w lewo o ćwierć obrotu, pełne koło wraca do oryginału", async () => {
    render(<Powiekszenie url="blob:bokiem" nazwa="bokiem.jpg" symbol={null} zamknij={vi.fn()} />);
    const wPrawo = screen.getByRole("button", { name: "Obróć w prawo" });

    await userEvent.click(wPrawo);
    await waitFor(() => expect(zdjecie("bokiem.jpg")).toHaveAttribute("src", "blob:bokiem@90"));
    await userEvent.click(wPrawo);
    await waitFor(() => expect(zdjecie("bokiem.jpg")).toHaveAttribute("src", "blob:bokiem@180"));
    /* Poprzedni obrócony plik zwalnia się, zanim stanie następny. */
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:bokiem@90");

    await userEvent.click(screen.getByRole("button", { name: "Obróć w lewo" }));
    await userEvent.click(screen.getByRole("button", { name: "Obróć w lewo" }));
    expect(zdjecie("bokiem.jpg")).toHaveAttribute("src", "blob:bokiem");
    await userEvent.click(screen.getByRole("button", { name: "Obróć w lewo" }));
    await waitFor(() => expect(zdjecie("bokiem.jpg")).toHaveAttribute("src", "blob:bokiem@270"));
  });

  it("obrót należy do zdjęcia: następne w galerii stoi prosto, powrót pamięta obrót", async () => {
    render(<Galeria><ul>
      {["a.jpg", "b.jpg"].map((n) => <KafelZalacznika key={n} nazwa={n} podglad
        obraz={{ url: `blob:${n}`, blad: null, ponow: vi.fn() }} pobierz={vi.fn(async () => {})} />)}
    </ul></Galeria>);
    await userEvent.click(screen.getByRole("button", { name: "Powiększ: a.jpg" }));
    await userEvent.click(screen.getByRole("button", { name: "Obróć w prawo" }));
    await waitFor(() => expect(zdjecie("a.jpg")).toHaveAttribute("src", "blob:a.jpg@90"));

    await userEvent.click(screen.getByRole("button", { name: "Następne zdjęcie" }));
    expect(zdjecie("b.jpg")).toHaveAttribute("src", "blob:b.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Poprzednie zdjęcie" }));
    await waitFor(() => expect(zdjecie("a.jpg")).toHaveAttribute("src", "blob:a.jpg@90"));
  });

  it("nieudany obrót mówi o sobie i zostawia zdjęcie bez obrotu", async () => {
    obroconeZdjecie.mockRejectedValueOnce(new Error("płótno"));
    render(<Powiekszenie url="blob:x" nazwa="x.jpg" symbol={null} zamknij={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Obróć w prawo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się obrócić zdjęcia");
    expect(zdjecie("x.jpg")).toHaveAttribute("src", "blob:x");
  });

  it("bez zdjęcia nie ma czego obracać", () => {
    render(<Powiekszenie url={null} nazwa="brak" symbol={null} zamknij={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Obróć w prawo" })).toBeNull();
  });
});
