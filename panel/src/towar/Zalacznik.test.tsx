import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KartaZalacznika, ListaZalacznikow } from "./Zalacznik";

/* ── Wspólna powłoka załącznika ──────────────────────────────────────────────
   Testy SAMYCH PROPSÓW — bez haka i bez serwera — bo powłoka nie wie, skąd
   obraz przyszedł. Skrzynka i reklamacje mają własne testy opakowań; tu
   pilnujemy, żeby jedna odpowiedź na „co klient przysłał" wyglądała tak samo
   w obu miejscach: ramka w drodze, zdjęcie z powiększeniem, zdanie odmowy
   z ponowieniem, błąd pobrania pod nazwą, plik nie do pobrania widoczny.   */

const ponow = vi.fn();
const obraz = (url: string | null | undefined, blad: string | null = null) => ({ url, blad, ponow });
const karta = (p: Partial<React.ComponentProps<typeof KartaZalacznika>> = {}) =>
  render(<ListaZalacznikow>
    <KartaZalacznika nazwa="usterka.jpg" podglad obraz={obraz("blob:1")}
      pobierz={() => Promise.resolve()} {...p} />
  </ListaZalacznikow>);

describe("Wspólna powłoka załącznika", () => {
  it("w drodze stoi ramka, żeby oś nie skakała; bez `podglad` ramki nie ma", () => {
    karta({ obraz: obraz(undefined) });
    expect(screen.getByText(/wczytuję/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("plik bez podglądu to sama nazwa — ani ramki, ani pytania o obraz", () => {
    karta({ podglad: false, obraz: obraz(undefined) });
    expect(screen.queryByText(/wczytuję/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "usterka.jpg" })).toBeInTheDocument();
  });

  it("zdjęcie widać w linii, a kliknięcie je powiększa (Escape zamyka)", async () => {
    karta();
    const img = screen.getByRole("img", { name: "usterka.jpg" });
    expect(img).toHaveAttribute("src", "blob:1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Powiększ: usterka.jpg" }));
    expect(screen.getByRole("dialog", { name: "Zdjęcie: usterka.jpg" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("odmowa mówi zdaniem z serwera i daje „Spróbuj ponownie”", async () => {
    ponow.mockClear();
    karta({ obraz: obraz(null, "Konto Allegro niepołączone — połącz w STAN SYSTEMU.") });
    expect(screen.getByText(/Konto Allegro niepołączone/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/wczytuję/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));
    expect(ponow).toHaveBeenCalledTimes(1);
    /* Nazwa z pobraniem zostaje — plik na dysku to inne pytanie niż podgląd. */
    expect(screen.getByRole("button", { name: "usterka.jpg" })).toBeInTheDocument();
  });

  it("`null` bez zdania to odpowiedź „nie obraz” — nazwa bez ponowienia", () => {
    karta({ obraz: obraz(null) });
    expect(screen.queryByRole("button", { name: /Spróbuj ponownie/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/wczytuję/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "usterka.jpg" })).toBeInTheDocument();
  });

  it("nieudane pobranie mówi o sobie pod nazwą zamiast milczeć", async () => {
    karta({ obraz: obraz(null), pobierz: () => Promise.reject(new Error("Sesja wygasła — zaloguj się")) });
    await userEvent.click(screen.getByRole("button", { name: "usterka.jpg" }));
    expect(await screen.findByText(/Sesja wygasła/)).toBeInTheDocument();
  });

  it("plik nie do pobrania jest WIDOCZNY z powodem, ale bez przycisku", () => {
    karta({ podglad: false, obraz: obraz(undefined), pobierz: null,
      powodBrakuPobrania: "Allegro uznało plik za niebezpieczny" });
    expect(screen.getByText("usterka.jpg")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/niebezpieczny/)).toBeInTheDocument();
  });
});
