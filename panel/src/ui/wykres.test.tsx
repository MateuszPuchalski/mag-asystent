import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { PasekUdzialu, Slupki } from "./wykres";

describe("pasek proporcji (z `komorkaSlupka` biura)", () => {
  const szerokosc = (c: HTMLElement) => (c.querySelector("[style]") as HTMLElement).style.width;

  it("mała, niezerowa wartość rysuje kreskę, zero — pusty tor", () => {
    expect(szerokosc(render(<PasekUdzialu ile={1} max={500} />).container)).toBe("2%");
    expect(szerokosc(render(<PasekUdzialu ile={0} max={500} />).container)).toBe("0%");
    expect(szerokosc(render(<PasekUdzialu ile={500} max={500} />).container)).toBe("100%");
  });

  it("liczba zostaje obok paska — tabela bez wartości przestaje być tabelą", () => {
    render(<PasekUdzialu ile={7} max={10} etykieta="7%" />);
    expect(screen.getByText("7%")).toBeTruthy();
  });
});

describe("słupki jednej serii", () => {
  const dane = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ ile: i === 3 ? 40 : 5, podpis: String(i), tytul: `dzień ${i}` }));

  it("pusta seria mówi zdaniem, nie pustym obrazkiem", () => {
    render(<Slupki dane={[]} co={1} opis="x" />);
    expect(screen.getByText("Brak danych w tym oknie.")).toBeTruthy();
  });

  it("przy krótkiej serii każdy słupek niesie wartość", () => {
    const { container } = render(<Slupki dane={dane(7)} co={1} opis="tydzień" />);
    const wartosci = [...container.querySelectorAll("svg text[font-weight]")].map((t) => t.textContent);
    expect(wartosci).toHaveLength(7);
  });

  it("przy 90 słupkach podpisany jest tylko szczyt — podpisy zlałyby się w pasek", () => {
    const { container } = render(<Slupki dane={dane(90)} co={14} opis="kwartał" />);
    const wartosci = [...container.querySelectorAll("svg text[font-weight]")].map((t) => t.textContent);
    expect(wartosci).toEqual(["40"]);
  });

  it("liczby są osiągalne bez wzroku — tabela dla czytnika", () => {
    render(<Slupki dane={dane(3)} co={1} opis="próbka" />);
    expect(screen.getByRole("table", { name: "próbka" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "próbka" })).toBeTruthy();
  });
});
