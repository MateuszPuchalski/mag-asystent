import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/* ── Zgłoszenia pomiarów ze skrzynki (26 września 2026, @wydanie) ────────────
   Dwa wywołania, które okablowuje ekran Skrzynki, a które mieszkają tutaj.
   Pilnujemy trzech rzeczy: samo użycie haka niczego nie wysyła (zero zapisu
   przy patrzeniu), pominięcie przeżywa zamknięcie karty (`keepalive`), a
   cofnięcie bez czasu dalej idzie BEZ ciała — pusty JSON to 400 z Fastify. */

vi.mock("./klient", () => ({ api: vi.fn(async () => ({ ok: true })) }));
const { api } = await import("./klient");
const { useZglosPominiecie } = await import("./wglad");
const { zglosCofnietaWysylke } = await import("./rozmowy");

beforeEach(() => vi.mocked(api).mockClear());

describe("useZglosPominiecie", () => {
  it("nie wysyła niczego przy montażu — dopiero wywołanie przy wyjściu", () => {
    const { result } = renderHook(() => useZglosPominiecie());
    expect(api).not.toHaveBeenCalled();
    result.current("RETURN");
    expect(api).toHaveBeenCalledWith("/api/obsluga/pominiecie",
      { method: "POST", keepalive: true, body: JSON.stringify({ kategoria: "RETURN" }) });
  });

  it("bez kategorii wysyła pusty obiekt, nie puste ciało", () => {
    const { result } = renderHook(() => useZglosPominiecie());
    result.current(null);
    expect(vi.mocked(api).mock.calls[0]![1]).toMatchObject({ body: "{}" });
  });

  it("porażka zapisu jest cicha — agent już wyszedł", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("sieć"));
    const { result } = renderHook(() => useZglosPominiecie());
    expect(() => result.current("RETURN")).not.toThrow();
    await Promise.resolve();
  });
});

describe("zglosCofnietaWysylke", () => {
  it("bez czasu idzie bez ciała, z czasem — z `msOdKolejki`", () => {
    zglosCofnietaWysylke(7);
    expect(vi.mocked(api).mock.calls[0]).toEqual(["/api/conversations/7/wysylka-cofnieta", { method: "POST" }]);
    zglosCofnietaWysylke(7, 2_300);
    expect(vi.mocked(api).mock.calls[1]).toEqual(["/api/conversations/7/wysylka-cofnieta",
      { method: "POST", body: JSON.stringify({ msOdKolejki: 2_300 }) }]);
  });
});
