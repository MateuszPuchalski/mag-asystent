import { describe, expect, it, vi, afterEach } from "vitest";
import { BrakSesji, Konflikt, PrzerwaAllegro, api } from "./klient";

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

  it("zamienia 429 na PrzerwaAllegro z czasem przerwy — długa zbiórka ma czekać, nie pytać od razu", async () => {
    vi.stubGlobal("fetch", odp(429, { error: "Allegro prosi o przerwę", poIluMs: 30000 }));
    const blad = await api("/api/obsluga/wiedza/pasuje-do/zbierz", { method: "POST" }).catch((e) => e);
    expect(blad).toBeInstanceOf(PrzerwaAllegro);
    expect((blad as PrzerwaAllegro).poIluMs).toBe(30000);
  });

  it("403 zostaje zwykłym błędem z komunikatem serwera", async () => {
    vi.stubGlobal("fetch", odp(403, { error: "Skrzynkę obsługuje biuro" }));
    await expect(api("/api/obsluga/rozmowy")).rejects.toThrow("Skrzynkę obsługuje biuro");
  });

  /* ── Strażnik blizny z `biuro.html` ─────────────────────────────────────
     Panel magazynu nauczył się tego w bólach: `content-type` wysyłany zawsze
     wywracał KAŻDE żądanie bez ciała, bo domyślny parser Fastify odrzuca pustą
     treść zadeklarowaną jako JSON (FST_ERR_CTP_EMPTY_JSON_BODY, 400). Martwe
     były wtedy cztery czynności naraz. Kolektor zna tę regułę osobno —
     `ApiService.kt` wysyła `EMPTY_BODY` bez nagłówka typu.

     Panel obsługi kupił tę bliznę drugi raz w 0.146.0, bo strażnik tamtej
     reguły czyta ŹRÓDŁO `biuro.html` wyrażeniem regularnym i nie miał jak
     objąć drugiego frontu. Ten strażnik sprawdza ZACHOWANIE, bo tego klienta
     da się zaimportować — i przez to jest mocniejszy od tamtego. */
  const naglowki = (f: ReturnType<typeof odp>) => f.mock.calls[0][1].headers as Record<string, string>;

  it("żądanie BEZ ciała nie deklaruje typu treści", async () => {
    const f = odp(200, { ok: true });
    vi.stubGlobal("fetch", f);
    /* Dokładnie to wywołanie padało na produkcji: przycisk „Synchronizuj teraz”
       z banera awarii, czyli ten, który ma pomóc, gdy synchronizacja stoi. */
    await api("/api/obsluga/synchronizuj", { method: "POST" });
    expect(naglowki(f)["content-type"]).toBeUndefined();
  });

  it("żądanie z ciałem deklaruje typ treści", async () => {
    const f = odp(200, { ok: true });
    vi.stubGlobal("fetch", f);
    await api("/api/conversations/1/claim", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(naglowki(f)["content-type"]).toBe("application/json");
  });

  it("typ treści narzucony przez wołającego wygrywa", async () => {
    const f = odp(200, {});
    vi.stubGlobal("fetch", f);
    await api("/api/cos", { method: "POST", body: "a=1",
      headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(naglowki(f)["content-type"]).toBe("application/x-www-form-urlencoded");
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

describe("wygasła sesja wraca do logowania (0.431.0)", () => {
  it("BrakSesji wysyła zdarzenie do ramy, inne błędy — nie", async () => {
    const { zglosBrakSesji, SESJA_WYGASLA } = await import("./klient");
    let ile = 0;
    const licz = () => { ile++; };
    window.addEventListener(SESJA_WYGASLA, licz);
    zglosBrakSesji(new Error("500"));
    zglosBrakSesji(new Konflikt("409", {}));
    expect(ile).toBe(0);
    zglosBrakSesji(new BrakSesji("Sesja wygasła"));
    expect(ile).toBe(1);
    window.removeEventListener(SESJA_WYGASLA, licz);
  });
});

describe("brak połączenia z serwerem (0.546.0)", () => {
  /* Serwer bierze wydanie sam i na chwilę znika. Ekran ma dostać JEDEN typ
     błędu z polskim zdaniem, a nie „Failed to fetch" albo „Błąd 502". */
  it("zerwana sieć to BrakPolaczenia, nie angielski TypeError", async () => {
    const { BrakPolaczenia } = await import("./klient");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/api/obsluga/rozmowy")).rejects.toBeInstanceOf(BrakPolaczenia);
    await expect(api("/api/obsluga/rozmowy")).rejects.toThrow("Brak połączenia z serwerem.");
  });

  it("502, 503 i 504 bez naszego pola error to brama, czyli brak połączenia", async () => {
    const { BrakPolaczenia } = await import("./klient");
    for (const status of [502, 503, 504]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => { throw new Error("html"); } }));
      await expect(api("/api/obsluga/rozmowy")).rejects.toBeInstanceOf(BrakPolaczenia);
    }
  });

  it("502 Z polem error to nasza trasa o awarii Allegro — zdanie dochodzi bez zmian", async () => {
    const { BrakPolaczenia } = await import("./klient");
    vi.stubGlobal("fetch", odp(502, { error: "Allegro nie odpowiada — spróbuj za chwilę" }));
    const blad = await api("/api/obsluga/reklamacje/1/odswiez", { method: "POST" }).catch((e) => e);
    expect(blad).not.toBeInstanceOf(BrakPolaczenia);
    expect(blad.message).toBe("Allegro nie odpowiada — spróbuj za chwilę");
  });

  it("BrakPolaczenia wysyła zdarzenie do ramy, inne błędy — nie", async () => {
    const { BrakPolaczenia, zglosBrakPolaczenia, POLACZENIE_ZERWANE } = await import("./klient");
    let ile = 0;
    const licz = () => { ile++; };
    window.addEventListener(POLACZENIE_ZERWANE, licz);
    zglosBrakPolaczenia(new Error("500"));
    zglosBrakPolaczenia(new BrakSesji("Sesja wygasła"));
    expect(ile).toBe(0);
    zglosBrakPolaczenia(new BrakPolaczenia());
    expect(ile).toBe(1);
    window.removeEventListener(POLACZENIE_ZERWANE, licz);
  });
});
