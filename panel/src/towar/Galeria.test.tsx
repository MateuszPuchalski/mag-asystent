import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Galeria } from "./Galeria";
import { KafelZalacznika } from "./Zalacznik";
import { Powiekszenie } from "./Powiekszenie";

/* ── Galeria zdjęć rozmowy i lupa ────────────────────────────────────────────
   Klient przysyła usterkę kilkoma zdjęciami. Powiększenie przełącza się
   strzałkami i przyciskami po zdjęciach całej rozmowy, w kolejności czytania,
   a lupa przybliża miejsce pod kursorem. */

const obraz = (url: string | null | undefined) => ({ url, blad: null, ponow: vi.fn() });
/** Bez `url` kafel ma wczytane zdjęcie; `{ url: undefined }` to zdjęcie w drodze. */
const kafel = (nazwa: string, stan: { url: string | null | undefined } = { url: `blob:${nazwa}` }) =>
  <KafelZalacznika key={nazwa} nazwa={nazwa} podglad obraz={obraz(stan.url)} pobierz={vi.fn(async () => {})} />;

const tytul = () => screen.getByRole("dialog").querySelector("h2")?.textContent;

describe("galeria zdjęć rozmowy", () => {
  it("strzałki i przyciski przełączają zdjęcia z kilku wiadomości, w kolejności czytania", async () => {
    render(<Galeria>
      <ul>{kafel("pierwsze.jpg")}{kafel("drugie.jpg")}</ul>
      <p>następna wiadomość</p>
      <ul>{kafel("trzecie.jpg")}</ul>
    </Galeria>);
    await userEvent.click(screen.getByRole("button", { name: "Powiększ: drugie.jpg" }));
    expect(tytul()).toBe("drugie.jpg");
    expect(screen.getByText("2 z 3")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(tytul()).toBe("trzecie.jpg");
    /* Na końcu strzałka zawija się na początek: licznik mówi, gdzie koniec. */
    await userEvent.click(screen.getByRole("button", { name: "Następne zdjęcie" }));
    expect(tytul()).toBe("pierwsze.jpg");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(tytul()).toBe("trzecie.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Poprzednie zdjęcie" }));
    expect(tytul()).toBe("drugie.jpg");
  });

  it("zdjęcie, które się nie wczytało, nie staje w kolejce", async () => {
    render(<Galeria><ul>{kafel("jest.jpg")}{kafel("w-drodze.jpg", { url: undefined })}{kafel("brak.jpg", { url: null })}</ul></Galeria>);
    await userEvent.click(screen.getByRole("button", { name: "Powiększ: jest.jpg" }));
    /* Jedno zdjęcie to nie galeria: bez strzałek i bez licznika. */
    expect(screen.queryByRole("button", { name: "Następne zdjęcie" })).toBeNull();
    expect(screen.queryByText(/z \d/)).toBeNull();
  });

  it("kafel bez galerii nad sobą powiększa pojedynczo", async () => {
    render(<ul>{kafel("samo.jpg")}</ul>);
    await userEvent.click(screen.getByRole("button", { name: "Powiększ: samo.jpg" }));
    expect(tytul()).toBe("samo.jpg");
    expect(screen.queryByRole("button", { name: "Następne zdjęcie" })).toBeNull();
  });
});

describe("lupa", () => {
  it("włączona pokazuje okrąg z tym samym zdjęciem pod kursorem", async () => {
    render(<Powiekszenie url="blob:gwint" nazwa="gwint.jpg" symbol={null} zamknij={vi.fn()} />);
    const zdjecie = screen.getByRole("img", { name: "gwint.jpg" }).parentElement!;
    fireEvent.pointerMove(zdjecie, { clientX: 10, clientY: 10 });
    expect(document.querySelector("[data-lupa]")).toBeNull();

    const przycisk = screen.getByRole("button", { name: "Lupa" });
    await userEvent.click(przycisk);
    expect(przycisk).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerMove(zdjecie, { clientX: 10, clientY: 10 });
    const lupa = document.querySelector<HTMLElement>("[data-lupa]");
    expect(lupa?.style.backgroundImage).toContain("blob:gwint");

    fireEvent.pointerLeave(zdjecie);
    expect(document.querySelector("[data-lupa]")).toBeNull();
  });

  it("bez zdjęcia lupy nie ma", () => {
    render(<Powiekszenie url={null} nazwa="brak" symbol={null} zamknij={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Lupa" })).toBeNull();
  });
});
