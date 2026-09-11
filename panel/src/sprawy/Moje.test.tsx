import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PigulkaMoje, ZdanieOUkrytych, mojaSprawa, sprawSlowo, useMoje } from "./Moje";

/* ── Sito „Moje" (0.278.0) ───────────────────────────────────────────────────
   Cztery rzeczy warte testu, bo każda kosztowałaby to, o co właściciel prosił:

   1. SITO ZAWĘŻA PO TOŻSAMOŚCI, nie po imieniu. Imienniczka nie ma prawa
      zobaczyć cudzej sprawy jako własnej.
   2. NIEZNANA TOŻSAMOŚĆ ZNACZY BRAK PIGUŁKI. Filtr, który zawsze daje pustkę,
      jest gorszy od braku filtru.
   3. SITO MÓWI, CO CHOWA. Pamięta wybór między otwarciami, więc bez tego
      zdania sprawa nieprzypisana mogłaby nie pokazać się nikomu.
   4. ODMIANA LICZEBNIKA. „2 spraw" to nie literówka, tylko zdanie, które
      czyta się jak usterka — a polszczyzna ma tu trzy formy, nie dwie.      */

afterEach(() => { try { localStorage.clear(); } catch { /* prywatne okno */ } });

describe("Sito „Moje”", () => {
  it("moja jest sprawa o MOIM numerze, nie o moim imieniu", () => {
    expect(mojaSprawa(7, 7)).toBe(true);
    expect(mojaSprawa(3, 7)).toBe(false);
    expect(mojaSprawa(null, 7)).toBe(false);
  });

  it("przy nieznanej tożsamości żadna sprawa nie jest moja i pigułki NIE MA", () => {
    /* `mojeId === null` to „nie wiem, kim jestem" — zapytanie o konto jeszcze
       nie wróciło albo wróciło błędem. Pigułka obiecywałaby wtedy filtr,
       który zawsze daje pustą listę. */
    expect(mojaSprawa(7, null)).toBe(false);
    const { container } = render(
      <PigulkaMoje moje={false} mojeId={null} ile={0} onPrzelacz={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pigułka niesie licznik i przełącza się w obie strony", async () => {
    const onPrzelacz = vi.fn();
    const { rerender } = render(
      <PigulkaMoje moje={false} mojeId={7} ile={3} onPrzelacz={onPrzelacz} />);
    const p = screen.getByRole("button", { name: /Moje/ });
    expect(p).toHaveTextContent("3");
    expect(p).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(p);
    expect(onPrzelacz).toHaveBeenCalledWith(true);

    /* Kliknięcie we WYBRANE sito je zdejmuje — to zawężenie listy,
       a nie kubełek. */
    rerender(<PigulkaMoje moje={true} mojeId={7} ile={3} onPrzelacz={onPrzelacz} />);
    await userEvent.click(screen.getByRole("button", { name: /Moje/ }));
    expect(onPrzelacz).toHaveBeenLastCalledWith(false);
  });

  it("wybór PRZEŻYWA zamknięcie ekranu, bo to nawyk stanowiska", () => {
    const { result } = renderHook(() => useMoje());
    expect(result.current.moje).toBe(false);
    act(() => { result.current.przelacz(true); });
    expect(result.current.moje).toBe(true);

    const drugie = renderHook(() => useMoje());
    expect(drugie.result.current.moje).toBe(true);
  });

  it("zdanie o ukrytych sprawach pojawia się TYLKO wtedy, gdy sito coś chowa", async () => {
    const { container, rerender } = render(
      <ZdanieOUkrytych ile={0} onPokazWszystkie={() => {}} />);
    expect(container).toBeEmptyDOMElement();

    const pokaz = vi.fn();
    rerender(<ZdanieOUkrytych ile={7} onPokazWszystkie={pokaz} />);
    expect(screen.getByText(/chowa 7 spraw/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pokaż wszystkie" }));
    expect(pokaz).toHaveBeenCalledTimes(1);
  });

  it("liczebnik odmienia się na trzy formy, nie na dwie", () => {
    expect(sprawSlowo(1)).toBe("1 sprawę");
    expect(sprawSlowo(2)).toBe("2 sprawy");
    expect(sprawSlowo(4)).toBe("4 sprawy");
    expect(sprawSlowo(5)).toBe("5 spraw");
    /* Nastolatki wracają do „spraw" mimo końcówki 2, 3 i 4 — to jest ten
       wyjątek, o który potyka się każda odmiana pisana na oko. */
    expect(sprawSlowo(12)).toBe("12 spraw");
    expect(sprawSlowo(14)).toBe("14 spraw");
    expect(sprawSlowo(22)).toBe("22 sprawy");
  });
});
