import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { kopiujDoSchowka } from "./kopiuj";
import { LoginKlienta } from "./index";

/* ── Kopiowanie po zwykłym HTTP (0.228.0) ────────────────────────────────────
   `navigator.clipboard` istnieje TYLKO w bezpiecznym kontekście. Biuro pracuje
   pod `http://serwer:3001` (DEPLOY.md), więc na jego przeglądarce tego obiektu
   NIE MA — a do 0.227.0 przyciski kopiowania kończyły wtedy na `.catch(() => {})`
   i mrugały „skopiowano" nad pustym schowkiem.

   Te testy stawiają OBA światy: z `navigator.clipboard` i bez niego.        */

function bezSchowka() {
  /* `undefined`, nie atrapa: dokładnie tak wygląda okno po HTTP. */
  vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("kopiujDoSchowka", () => {
  it("po HTTPS idzie nowoczesną drogą", async () => {
    const pisz = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: pisz } });

    expect(await kopiujDoSchowka("bagslublin")).toBe(true);
    expect(pisz).toHaveBeenCalledWith("bagslublin");
  });

  it("BEZ `navigator.clipboard` schodzi na `execCommand` i kopiuje", async () => {
    bezSchowka();
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;

    expect(await kopiujDoSchowka("bagslublin")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    /* Pole pomocnicze ZNIKA — zostawione rosłoby z każdym kliknięciem. */
    expect(document.querySelectorAll("textarea").length).toBe(0);
  });

  it("odmowa schowka też schodzi na drogę zapasową", async () => {
    /* Przeglądarka potrafi odrzucić `writeText` (brak zgody), a to nie powód,
       żeby poddać się bez próby. */
    vi.stubGlobal("navigator", {
      ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("nie")) } });
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;

    expect(await kopiujDoSchowka("x")).toBe(true);
    expect(exec).toHaveBeenCalled();
  });

  it("gdy NIC nie działa, mówi FAŁSZ — nie udaje sukcesu", async () => {
    /* To jest cała różnica wobec wersji sprzed 0.228.0. */
    bezSchowka();
    (document as unknown as { execCommand: unknown }).execCommand = undefined;

    expect(await kopiujDoSchowka("x")).toBe(false);
  });
});

describe("LoginKlienta", () => {
  it("klik na loginie kopiuje i mówi, że skopiował", async () => {
    const pisz = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: pisz } });
    render(<LoginKlienta login="bagslublin" />);

    await userEvent.click(screen.getByRole("button", { name: /Kopiuj login/ }));
    expect(pisz).toHaveBeenCalledWith("bagslublin");
    expect(await screen.findByText("Skopiowano login")).toBeTruthy();
  });

  it("nieudane kopiowanie MÓWI o sobie zamiast udawać sukces", async () => {
    bezSchowka();
    (document as unknown as { execCommand: unknown }).execCommand = undefined;
    render(<LoginKlienta login="bagslublin" />);

    await userEvent.click(screen.getByRole("button", { name: /Kopiuj login/ }));
    expect(await screen.findByText("Nie udało się skopiować loginu")).toBeTruthy();
  });
});
