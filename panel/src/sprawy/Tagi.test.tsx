import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Tag, TagSprawy } from "../api/typy";
import { CzipTagu, FiltrTagow, TagiSprawy, tagiWgLiczby } from "./Tagi";

/* ── Tagi spraw (0.279.0) ────────────────────────────────────────────────────
   Cztery rzeczy warte testu, bo każda jest decyzją, nie wyglądem:

   1. FILTR POKAZUJE TYLKO TAGI OBECNE W KUBEŁKU. Pigułka tagu, którego
      w kubełku nie ma, obiecywałaby zawężenie do pustki.
   2. KLIKNIĘCIE W WYBRANY TAG GO ZDEJMUJE. To zawężenie listy, nie kubełek.
   3. ZDJĘCIE JEDNYM KLIKNIĘCIEM JEST CAŁYM COFNIĘCIEM — stąd brak „cofnij".
   4. WYŁĄCZONY TAG WIDAĆ NA SPRAWIE, ale nie ma go wśród podpowiedzi.       */

const t = (id: number, nazwa: string): TagSprawy => ({ id, nazwa });
const st = (id: number, nazwa: string, aktywny = true): Tag => ({ id, nazwa, aktywny });

const SLOWNIK: Tag[] = [
  st(1, "u producenta"), st(2, "czeka na część"), st(3, "stary tag", false),
];

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

describe("Tagi przy otwartej sprawie", () => {
  const props = (przypiete: TagSprawy[], n = {}) => ({
    przypiete, slownik: SLOWNIK, trwa: false, blad: "",
    onPrzypnij: vi.fn(), onOdepnij: vi.fn(), onNowy: vi.fn(), ...n,
  });

  it("zdjęcie jednym kliknięciem JEST cofnięciem — osobnego „cofnij” nie ma", async () => {
    /* §25a.5 mówi o cofnięciu zamiast potwierdzenia, a nie obok istniejącej
       drogi powrotnej. Przypięcie i zdjęcie kosztują po jednym ruchu. */
    const onOdepnij = vi.fn();
    render(<TagiSprawy {...props([t(2, "czeka na część")], { onOdepnij })} />);
    expect(screen.queryByRole("button", { name: /cofnij/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Zdejmij tag czeka na część" }));
    expect(onOdepnij).toHaveBeenCalledWith(2);
  });

  it("wyłączony tag WIDAĆ na sprawie, ale nie ma go w podpowiedziach", () => {
    render(<TagiSprawy {...props([t(3, "stary tag")])} />);
    expect(screen.getByText("stary tag")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ stary tag" })).not.toBeInTheDocument();
  });

  it("podpowiedzi pomijają to, co już jest przypięte", async () => {
    const onPrzypnij = vi.fn();
    render(<TagiSprawy {...props([t(1, "u producenta")], { onPrzypnij })} />);
    expect(screen.queryByRole("button", { name: "+ u producenta" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ czeka na część" }));
    expect(onPrzypnij).toHaveBeenCalledWith(2);
  });

  it("nowy tag powstaje JEDNYM ruchem: nazwa wchodzi do słownika i na sprawę", async () => {
    /* Rozbicie na „dodaj do słownika", a potem „przypnij" kazałoby zrobić dwie
       czynności tam, gdzie agent ma jeden zamiar (Dekalog p. 1). */
    const onNowy = vi.fn();
    render(<TagiSprawy {...props([], { onNowy })} />);
    await userEvent.click(screen.getByRole("button", { name: "+ nowy tag" }));
    await userEvent.type(screen.getByLabelText("Nazwa nowego tagu"), "u serwisu{Enter}");
    expect(onNowy).toHaveBeenCalledWith("u serwisu");
  });

  it("sprawa bez tagów mówi o tym słowem, a nie pustym miejscem", () => {
    render(<TagiSprawy {...props([])} />);
    expect(screen.getByText("Bez tagów.")).toBeInTheDocument();
  });
});
