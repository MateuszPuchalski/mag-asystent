import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { KLUCZ_ZWINIETEGO, useZwinietyPasek } from "./ZwinietyPasek";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("zwinięcie paska bocznego", () => {
  it("domyślnie pasek jest rozwinięty", () => {
    const { result } = renderHook(() => useZwinietyPasek());
    expect(result.current[0]).toBe(false);
  });

  it("przełączenie zapisuje wybór i przeżywa nowe wejście", () => {
    const { result } = renderHook(() => useZwinietyPasek());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(KLUCZ_ZWINIETEGO)).toBe("1");
    expect(renderHook(() => useZwinietyPasek()).result.current[0]).toBe(true);
    act(() => result.current[1]());
    expect(localStorage.getItem(KLUCZ_ZWINIETEGO)).toBe("0");
  });

  it("bez dostępu do pamięci przeglądarki dalej się przełącza", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("zablokowane"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("zablokowane"); });
    const { result } = renderHook(() => useZwinietyPasek());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
  });
});
