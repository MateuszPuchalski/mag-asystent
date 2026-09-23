import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFirmaDruku } from "./firma";

/* ── Dane firmy dla druku (0.444.0) ────────────────────────────────────────
   Zapas z przeglądarki działa WYŁĄCZNIE, dopóki serwer jest pusty. Potem
   serwer wygrywa zawsze — także pustym polem, bo puste pole zapisał człowiek.
   Druk czeka na odpowiedź serwera, żeby nie wyjść raz tak, raz inaczej. */

let odpowiedz: unknown;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(odpowiedz))));
});
afterEach(() => vi.unstubAllGlobals());

const opakowanie = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const PUSTE = { nazwa: "", nip: "", adres: "", miejscowosc: "", osoba: "", telefon: "" };

describe("useFirmaDruku", () => {
  it("pusty serwer → dane z tej przeglądarki (dzień wdrożenia)", async () => {
    localStorage.setItem("wertis.firma", JSON.stringify({ Nazwa: "Z przeglądarki" }));
    odpowiedz = { dane: PUSTE, zmieniono: null };
    const { result } = renderHook(() => useFirmaDruku(), { wrapper: opakowanie });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual({ Nazwa: "Z przeglądarki" }));
  });

  it("zapisany serwer wygrywa, także pustym polem", async () => {
    localStorage.setItem("wertis.firma", JSON.stringify({ Nazwa: "Stara", Nip: "999" }));
    odpowiedz = { dane: { ...PUSTE, nazwa: "WERTIS" }, zmieniono: { at: "2026-09-23T08:00:00Z", przez: "Ala" } };
    const { result } = renderHook(() => useFirmaDruku(), { wrapper: opakowanie });
    await waitFor(() => expect(result.current?.Nazwa).toBe("WERTIS"));
    expect(result.current?.Nip).toBe("");
  });
});
