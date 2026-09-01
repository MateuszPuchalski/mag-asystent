import { describe, expect, it, vi, afterEach } from "vitest";
import { BrakSesji, Konflikt, api } from "./klient";

/* Klient HTTP rozdziela trzy rzeczy, które ekran musi narysować inaczej:
   wygasłą sesję, konflikt wersji i zwykły błąd. Zlanie ich w jeden `Error`
   kosztowałoby ekran konfliktu przejęcia — zostałby po nim goły komunikat. */

const odp = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe("api()", () => {
  it("zamienia 401 na BrakSesji, żeby panel wrócił do logowania", async () => {
    vi.stubGlobal("fetch", odp(401, { error: "Brak sesji — zaloguj się" }));
    await expect(api("/api/obsluga/rozmowy")).rejects.toBeInstanceOf(BrakSesji);
  });

  it("zamienia 409 na Konflikt i NIE gubi szczegółów", async () => {
    vi.stubGlobal("fetch", odp(409, {
      error: "Rozmowę przejął już inny agent",
      assignedUserId: 7, assignedUserName: "M. Wójcik", version: 12,
    }));
    try {
      await api("/api/conversations/4818/claim", { method: "POST" });
      expect.unreachable("konflikt miał polecieć wyżej");
    } catch (e) {
      expect(e).toBeInstanceOf(Konflikt);
      /* Te trzy pola rysują ekran przegranego wyścigu. */
      expect((e as Konflikt).szczegoly).toEqual({
        assignedUserId: 7, assignedUserName: "M. Wójcik", version: 12,
      });
      expect((e as Konflikt).message).toBe("Rozmowę przejął już inny agent");
    }
  });

  it("403 zostaje zwykłym błędem z komunikatem serwera", async () => {
    vi.stubGlobal("fetch", odp(403, { error: "Skrzynkę obsługuje biuro" }));
    await expect(api("/api/obsluga/rozmowy")).rejects.toThrow("Skrzynkę obsługuje biuro");
  });

  it("dokłada nagłówek sesji do każdego żądania", async () => {
    localStorage.setItem("wertis-panel-token", "t-42");
    const f = odp(200, { rozmowy: [] });
    vi.stubGlobal("fetch", f);
    await api("/api/obsluga/rozmowy");
    expect(f.mock.calls[0][1].headers["x-session"]).toBe("t-42");
    localStorage.clear();
  });
});
