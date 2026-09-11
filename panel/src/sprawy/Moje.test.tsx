import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PasekSita, ZdanieOUkrytych, mojaSprawa, sprawSlowo, useSito, wSicie,
} from "./Moje";

/* ── Sito spraw (0.278.0, „Niczyje" od 0.281.0) ──────────────────────────────
   Pięć rzeczy warte testu, bo każda kosztowałaby to, o co właściciel prosił:

   1. SITO ZAWĘŻA PO TOŻSAMOŚCI, nie po imieniu. Imienniczka nie ma prawa
      zobaczyć cudzej sprawy jako własnej.
   2. NIEZNANA TOŻSAMOŚĆ ZNACZY BRAK „MOJE". Filtr, który zawsze daje pustkę,
      jest gorszy od braku filtru. „Niczyje" zostaje — do jego policzenia
      tożsamość nie jest potrzebna.
   3. TRZY STANY, NIE DWA PRZEŁĄCZNIKI. „Moje i niczyje naraz" nie znaczy nic.
   4. SITO MÓWI, CO CHOWA, i nazywa SIEBIE. Pamięta wybór między otwarciami,
      więc bez tego zdania sprawa spoza sita mogłaby nie pokazać się nikomu.
   5. ODMIANA LICZEBNIKA. „2 spraw" to nie literówka, tylko zdanie, które
      czyta się jak usterka — a polszczyzna ma tu trzy formy, nie dwie.     */

afterEach(() => { try { localStorage.clear(); } catch { /* prywatne okno */ } });

describe("Sito spraw", () => {
  it("moja jest sprawa o MOIM numerze, nie o moim imieniu", () => {
    expect(mojaSprawa(7, 7)).toBe(true);
    expect(mojaSprawa(3, 7)).toBe(false);
    expect(mojaSprawa(null, 7)).toBe(false);
  });

  it("„Niczyje” to sprawy BEZ prowadzącego, nie sprawy cudze", () => {
    expect(wSicie(null, 7, "niczyje")).toBe(true);
    expect(wSicie(9, 7, "niczyje")).toBe(false);
    expect(wSicie(7, 7, "niczyje")).toBe(false);
    expect(wSicie(7, 7, "moje")).toBe(true);
    expect(wSicie(9, 7, "moje")).toBe(false);
    /* Bez sita przechodzi wszystko — także sprawa bez prowadzącego. */
    expect(wSicie(null, 7, null)).toBe(true);
    expect(wSicie(9, 7, null)).toBe(true);
  });

  it("przy nieznanej tożsamości „Moje” NIE MA, ale „Niczyje” zostaje", () => {
    /* `mojeId === null` to „nie wiem, kim jestem" — zapytanie o konto jeszcze
       nie wróciło albo wróciło błędem. */
    expect(mojaSprawa(7, null)).toBe(false);
    render(<PasekSita sito={null} mojeId={null} moich={0} niczyich={2}
      onPrzelacz={() => {}} />);
    expect(screen.queryByRole("button", { name: /Moje/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Niczyje/ })).toBeInTheDocument();
  });

  it("pigułka niesie licznik, a kliknięcie w WYBRANĄ zdejmuje sito", async () => {
    const onPrzelacz = vi.fn();
    const { rerender } = render(
      <PasekSita sito={null} mojeId={7} moich={3} niczyich={2} onPrzelacz={onPrzelacz} />);
    const p = screen.getByRole("button", { name: /Moje/ });
    expect(p).toHaveTextContent("3");
    expect(p).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(p);
    expect(onPrzelacz).toHaveBeenCalledWith("moje");

    rerender(<PasekSita sito="moje" mojeId={7} moich={3} niczyich={2}
      onPrzelacz={onPrzelacz} />);
    await userEvent.click(screen.getByRole("button", { name: /Moje/ }));
    expect(onPrzelacz).toHaveBeenLastCalledWith(null);
  });

  it("sito ma TRZY stany, nie dwa przełączniki", async () => {
    /* Dwie osobne pigułki dałyby stan „moje i niczyje naraz", który nie znaczy
       nic, oraz „ani moje, ani niczyje", czyli „cudze" — a o cudze nikt tu
       nie pyta. */
    const onPrzelacz = vi.fn();
    render(<PasekSita sito="moje" mojeId={7} moich={3} niczyich={2} onPrzelacz={onPrzelacz} />);
    expect(screen.getByRole("button", { name: /Moje/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Niczyje/ })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: /Niczyje/ }));
    expect(onPrzelacz).toHaveBeenCalledWith("niczyje");
  });

  it("wybór PRZEŻYWA zamknięcie ekranu, bo to nawyk stanowiska", () => {
    const { result } = renderHook(() => useSito());
    expect(result.current.sito).toBe(null);
    act(() => { result.current.przelacz("niczyje"); });
    expect(result.current.sito).toBe("niczyje");

    expect(renderHook(() => useSito()).result.current.sito).toBe("niczyje");

    /* Zdjęcie sita KASUJE wpis, zamiast zapisywać „nic" — inaczej stan
       domyślny zależałby od tego, czy ktoś kiedyś kliknął. */
    act(() => { result.current.przelacz(null); });
    expect(renderHook(() => useSito()).result.current.sito).toBe(null);
  });

  it("zdanie o ukrytych sprawach NAZYWA sito, które je chowa", async () => {
    const { container, rerender } = render(
      <ZdanieOUkrytych ile={0} nazwa="Moje" onPokazWszystkie={() => {}} />);
    expect(container).toBeEmptyDOMElement();

    const pokaz = vi.fn();
    rerender(<ZdanieOUkrytych ile={7} nazwa="Niczyje" onPokazWszystkie={pokaz} />);
    /* „Jakiś filtr" kazałby szukać przełącznika po całym ekranie. */
    expect(screen.getByText(/Niczyje.*chowa 7 spraw/)).toBeInTheDocument();
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
