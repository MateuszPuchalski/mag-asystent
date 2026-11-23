import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useZdjeciaWylaczone } from "./zdjecia";

/* Zakładka Zdjęcia znika z paska tylko wtedy, gdy serwer JAWNIE mówi, że
   dodawanie zdjęć jest wyłączone. Brak odpowiedzi albo błąd zostawia zakładkę:
   ukrycie jej po cichu byłoby gorsze niż pusta karta pod bezpośrednim linkiem. */

afterEach(() => vi.unstubAllGlobals());

function pytaj(odpowiedz: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async () => odpowiedz()));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useZdjeciaWylaczone(), {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

describe("useZdjeciaWylaczone", () => {
  it("dopóki odpowiedź nie przyszła, zakładka stoi", () => {
    const { result } = pytaj(() => new Response(JSON.stringify({ wlaczone: false, pozycje: [] })));
    expect(result.current).toBe(false);
  });

  it("wyłączona funkcja chowa zakładkę", async () => {
    const { result } = pytaj(() => new Response(JSON.stringify({ wlaczone: false, pozycje: [], powod: "wyłączone" })));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("włączona funkcja zostawia zakładkę", async () => {
    const { result } = pytaj(() => new Response(JSON.stringify({ wlaczone: true, pozycje: [] })));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe(false);
  });

  it("błąd serwera zostawia zakładkę", async () => {
    const { result } = pytaj(() => new Response(JSON.stringify({ error: "x" }), { status: 500 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe(false);
  });
});
