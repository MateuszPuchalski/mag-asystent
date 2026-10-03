import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNoweKlucze } from "./Ruch";

/* ── CO JEST NOWE, ŻEBY RUCH ZAGRAŁ RAZ ──────────────────────────────────────
   Haczyk decyduje, kiedy skrzynka błyska. Pilnujemy czterech granic: otwarcie
   ekranu nie błyska niczym, doszły elementy błyskają, element który wrócił
   błyska znowu, a oznaczenie gaśnie samo. */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Wej = { klucze: string[]; gotowe: boolean; kontekst: string };
const montuj = (poczatek: Wej) =>
  renderHook((w: Wej) => useNoweKlucze(w.klucze, w.gotowe, w.kontekst), { initialProps: poczatek });

describe("useNoweKlucze", () => {
  it("pierwszy odczyt nic nie błyska, nawet gdy lista jest długa", () => {
    const { result } = montuj({ klucze: ["1", "2", "3"], gotowe: true, kontekst: "a" });
    expect([...result.current]).toEqual([]);
  });

  it("dopóki dane nie są gotowe, nic nie jest zapamiętywane ani błyskane", () => {
    const { result, rerender } = montuj({ klucze: [], gotowe: false, kontekst: "a" });
    rerender({ klucze: ["1", "2"], gotowe: false, kontekst: "a" });
    expect([...result.current]).toEqual([]);
    /* Gotowość zapamiętuje to, co jest TERAZ: dwa wiersze to stan wyjściowy,
       nie nowość, więc start ekranu z danymi z pamięci podręcznej nie miga. */
    rerender({ klucze: ["1", "2"], gotowe: true, kontekst: "a" });
    expect([...result.current]).toEqual([]);
  });

  it("element dołożony po pierwszym odczycie błyska, stare nie", () => {
    const { result, rerender } = montuj({ klucze: ["1", "2"], gotowe: true, kontekst: "a" });
    rerender({ klucze: ["1", "2", "3"], gotowe: true, kontekst: "a" });
    expect([...result.current]).toEqual(["3"]);
  });

  it("oznaczenie gaśnie po czasie, więc ponowne zamontowanie wiersza nie odgrywa ruchu", () => {
    const { result, rerender } = montuj({ klucze: ["1"], gotowe: true, kontekst: "a" });
    rerender({ klucze: ["1", "2"], gotowe: true, kontekst: "a" });
    expect(result.current.has("2")).toBe(true);
    act(() => { vi.advanceTimersByTime(2100); });
    expect(result.current.has("2")).toBe(false);
  });

  it("element, który zniknął i wrócił, jest znowu nowy", () => {
    /* Wiersz wraca do „Do odpowiedzi" po kolejnym pytaniu klienta. „Znane" to
       ostatni zestaw, nie suma wszystkich, inaczej drugi powrót byłby cichy. */
    const { result, rerender } = montuj({ klucze: ["1", "2"], gotowe: true, kontekst: "a" });
    rerender({ klucze: ["1"], gotowe: true, kontekst: "a" });
    expect([...result.current]).toEqual([]);
    rerender({ klucze: ["1", "2"], gotowe: true, kontekst: "a" });
    expect([...result.current]).toEqual(["2"]);
  });

  it("zmiana kontekstu zaczyna od zera: inna rozmowa nie błyska całą treścią", () => {
    const { result, rerender } = montuj({ klucze: ["m1"], gotowe: true, kontekst: "rozmowa-1" });
    rerender({ klucze: ["x1", "x2", "x3"], gotowe: true, kontekst: "rozmowa-2" });
    expect([...result.current]).toEqual([]);
    rerender({ klucze: ["x1", "x2", "x3", "x4"], gotowe: true, kontekst: "rozmowa-2" });
    expect([...result.current]).toEqual(["x4"]);
  });

  it("zmiana kontekstu w trakcie błysku gasi go natychmiast", () => {
    const { result, rerender } = montuj({ klucze: ["1"], gotowe: true, kontekst: "a" });
    rerender({ klucze: ["1", "2"], gotowe: true, kontekst: "a" });
    expect(result.current.has("2")).toBe(true);
    rerender({ klucze: ["1", "2"], gotowe: true, kontekst: "b" });
    expect([...result.current]).toEqual([]);
  });
});
