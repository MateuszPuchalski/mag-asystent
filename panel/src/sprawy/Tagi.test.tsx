import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TagSprawy } from "../api/typy";
import { CzipTagu, FiltrTagow, tagiWgLiczby } from "./Tagi";

/* Dwie decyzje warte testu, bo każda jest decyzją, nie wyglądem:

   1. FILTR POKAZUJE TYLKO TAGI OBECNE W KUBEŁKU. Pigułka tagu, którego
      w kubełku nie ma, obiecywałaby zawężenie do pustki.
   2. KLIKNIĘCIE W WYBRANY TAG GO ZDEJMUJE. To zawężenie listy, nie kubełek. */

const t = (id: number, nazwa: string): TagSprawy => ({ id, nazwa });

describe("Czip i filtr tagów", () => {
  it("czip niesie nazwę i mówi, że to zdanie BIURA, nie Allegro", () => {
    render(<CzipTagu nazwa="czeka na część" />);
    const czip = screen.getByText("czeka na część");
    expect(czip).toBeInTheDocument();
    expect(czip.closest("span")).toHaveAttribute("title", "Tag biura: czeka na część");
  });

  it("liczy tagi malejąco, a przy remisie alfabetycznie", () => {
    const wynik = tagiWgLiczby([
      { tagi: [t(1, "u producenta"), t(2, "czeka na część")] },
      { tagi: [t(2, "czeka na część")] },
      { tagi: [t(3, "zebrać dowody")] },
    ]);
    expect(wynik.map(([tag, ile]) => [tag.nazwa, ile])).toEqual([
      ["czeka na część", 2], ["u producenta", 1], ["zebrać dowody", 1],
    ]);
  });

  it("pusty kubełek nie rysuje paska filtra wcale", () => {
    /* Pasek z zerem pigułek byłby pustym pasmem zjadającym wysokość kolumny,
       która ma pokazywać SPRAWY. */
    const { container } = render(
      <FiltrTagow wgLiczby={[]} wybrany={null} onWybierz={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("kliknięcie w WYBRANY tag go zdejmuje, bo to zawężenie, a nie kubełek", async () => {
    const onWybierz = vi.fn();
    render(<FiltrTagow wgLiczby={[[t(2, "czeka na część"), 3]]} wybrany={2}
      onWybierz={onWybierz} />);
    await userEvent.click(screen.getByRole("button", { name: /czeka na część/ }));
    expect(onWybierz).toHaveBeenCalledWith(null);
  });
});
