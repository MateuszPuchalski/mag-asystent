import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { KrawedzSieci, SiecWiedzy } from "../api/typy";
import { Siec } from "./Siec";

/* ── Sieć wiedzy: wgląd bez zapisu ───────────────────────────────────────────
   Po prawdziwym `fetch`, nie po zamockowanym hooku: „zero zapisu przy
   patrzeniu" liczy ŻĄDANIA, a hook podmieniony w teście niczego nie wysyła.
   Pilnujemy też, że zdanie połączenia przychodzi z serwera, że łańcuch
   część → silnik → maszyna jest jedną wyspą, że otoczenie zawęża rysunek
   i że przejście do kartoteki niesie wskazaną część.                     */

const kr = (n: Partial<KrawedzSieci> & Pick<KrawedzSieci, "z" | "do" | "warstwa" | "rodzaj" | "zdanie">): KrawedzSieci =>
  ({ polaryzacja: null, wierszId: null, rola: null, pewnosc: "potwierdzone", obustronnie: false, ...n });

const SIEC: SiecWiedzy = {
  wezly: [
    { klucz: "tw:502", rodzaj: "kartoteka", twId: 502, etykieta: "W09-0211", nazwa: "Gaźnik GX160" },
    { klucz: "tw:811", rodzaj: "kartoteka", twId: 811, etykieta: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" },
    { klucz: "tw:812", rodzaj: "kartoteka", twId: 812, etykieta: "W53-0202", nazwa: "Uszczelka między dystansem" },
    { klucz: "tw:503", rodzaj: "kartoteka", twId: 503, etykieta: "EX055", nazwa: "Gaźnik GX160" },
    { klucz: "model:1", rodzaj: "silnik", twId: null, etykieta: "Honda GX160", nazwa: "silnik Honda GX160" },
    { klucz: "model:2", rodzaj: "maszyna", twId: null, etykieta: "NAC LS 46-450", nazwa: "NAC LS 46-450" },
    { klucz: "tw:900", rodzaj: "kartoteka", twId: 900, etykieta: "MEM-1", nazwa: "Membrana Walbro" },
    { klucz: "tw:901", rodzaj: "kartoteka", twId: 901, etykieta: "WALBRO-7", nazwa: "Gaźnik Walbro" },
  ],
  krawedzie: [
    kr({ z: "tw:811", do: "tw:502", warstwa: "pasowania", rodzaj: "pasuje", polaryzacja: "pasuje", wierszId: 5,
      zdanie: "uszczelka LC170430140-0001 pasuje do W09-0211 — katalog dostawcy, 7.09.2026, A. Lewandowska" }),
    kr({ z: "tw:812", do: "tw:502", warstwa: "pasowania", rodzaj: "nie_pasuje", polaryzacja: "nie_pasuje", wierszId: 6,
      zdanie: "uszczelka W53-0202 nie pasuje do W09-0211: inny wariant" }),
    kr({ z: "tw:502", do: "tw:503", warstwa: "zamienniki", rodzaj: "zamiennik", pewnosc: "prawdopodobne", obustronnie: true,
      zdanie: "W09-0211 i EX055 podają się nawzajem jako zamienniki w opisach" }),
    kr({ z: "tw:502", do: "model:1", warstwa: "zastosowania", rodzaj: "pasuje", polaryzacja: "pasuje", wierszId: 3,
      zdanie: "zastosowanie do silnik Honda GX160 — katalog dostawcy" }),
    kr({ z: "model:1", do: "model:2", warstwa: "zabudowy", rodzaj: "zabudowa", wierszId: 8,
      zdanie: "silnik Honda GX160 stoi w NAC LS 46-450 — producent" }),
    kr({ z: "tw:900", do: "tw:901", warstwa: "pasowania", rodzaj: "propozycja", polaryzacja: "pasuje", wierszId: 7,
      pewnosc: "prawdopodobne", zdanie: "membrany MEM-1 pasuje do WALBRO-7 — rozmowa, 8.09.2026, A. Lewandowska" }),
  ],
};

/* Wnioski przez zamiennik dla EX055 — z tej samej trasy co „Sprawdź kartotekę". */
const WIEDZA_EX055 = { potwierdzone: [], negatywne: [], propozycje: [], pasowania: {
  pasujeDo: [], negatywne: [], propozycje: [],
  pasujace: [{ przezZamiennik: "EX055 podaje W09-0211 jako zamiennik w opisie", pewnosc: "prawdopodobne",
    zdanie: "uszczelka LC170430140-0001 pasuje do W09-0211; EX055 podaje W09-0211 jako zamiennik w opisie",
    czesc: { twId: 811, symbol: "LC170430140-0001", nazwa: "x" }, doCzego: { twId: 503, symbol: "EX055", nazwa: "x" },
    pasowanie: {} }],
} };

let wyslane: string[] = [];
let odczyty: string[] = [];
let dane: SiecWiedzy = SIEC;

beforeEach(() => {
  wyslane = []; odczyty = []; dane = SIEC;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    const odp = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (metoda !== "GET") { wyslane.push(`${metoda} ${url}`); return odp({ ok: true }); }
    odczyty.push(url);
    if (url === "/api/obsluga/wiedza/siec") return odp(dane);
    if (url === "/api/obsluga/wiedza/towar/503") return odp(WIEDZA_EX055);
    if (url.startsWith("/api/obsluga/wiedza/towar/")) {
      return odp({ potwierdzone: [], negatywne: [], propozycje: [], pasowania: { pasujeDo: [], pasujace: [], negatywne: [], propozycje: [] } });
    }
    throw new Error(`nieoczekiwany adres w teście: ${metoda} ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const pokaz = (onOtworzKartoteke?: (k: { twId: number; symbol: string; nazwa: string }) => void) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Siec onOtworzKartoteke={onOtworzKartoteke} />
  </QueryClientProvider>);

describe("Sieć wiedzy", () => {
  it("otwarcie niczego nie zapisuje; łańcuch uszczelka → gaźnik → silnik → maszyna to jedna wyspa", async () => {
    pokaz();
    const wyspa = await screen.findByRole("group", { name: "Wyspa W09-0211" });
    for (const nazwa of [/^LC170430140-0001/, /^Honda GX160/, /^NAC LS 46-450/, /^EX055/]) {
      expect(within(wyspa).getByRole("button", { name: nazwa })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: "Wyspa WALBRO-7" })).toBeInTheDocument();
    expect(screen.getByText(/5 powiązań · 8 węzłów · 2 wyspy/)).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("klik w węzeł pokazuje jego połączenia zdaniem z serwera; drugi klik chowa", async () => {
    const u = userEvent.setup();
    pokaz();
    const wyspa = await screen.findByRole("group", { name: "Wyspa W09-0211" });
    const gaznik = within(wyspa).getByRole("button", { name: /^W09-0211/ });
    await u.click(gaznik);
    const lista = screen.getByRole("region", { name: "Połączenia W09-0211" });
    expect(within(lista).getByText(/LC170430140-0001 pasuje do W09-0211/)).toBeInTheDocument();
    expect(within(lista).getByText(/W53-0202 nie pasuje do W09-0211/)).toBeInTheDocument();
    expect(within(lista).getByText(/zastosowanie do silnik Honda GX160/)).toBeInTheDocument();
    expect(gaznik).toHaveAttribute("aria-pressed", "true");
    await u.click(gaznik);
    expect(screen.queryByRole("region", { name: "Połączenia W09-0211" })).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("wybrana kartoteka dostaje wnioski przez zamienniki jednym odczytem, bez zapisu", async () => {
    const u = userEvent.setup();
    pokaz();
    await u.click(await screen.findByRole("button", { name: /^EX055/ }));
    expect(await screen.findByText(/EX055 podaje W09-0211 jako zamiennik w opisie/)).toBeInTheDocument();
    expect(screen.getByText(/prawdopodobne, nie potwierdzone/)).toBeInTheDocument();
    expect(odczyty).toContain("/api/obsluga/wiedza/towar/503");
    expect(wyslane).toEqual([]);
  });

  it("maszyna nie pyta o wnioski kartoteki i nie ma przejścia do „Sprawdź kartotekę”", async () => {
    const u = userEvent.setup();
    pokaz(vi.fn());
    await u.click(await screen.findByRole("button", { name: /^NAC LS 46-450/ }));
    expect(screen.getByRole("region", { name: "Połączenia NAC LS 46-450" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Otwórz w/ })).toBeNull();
    expect(odczyty.filter((a) => a.includes("/towar/"))).toEqual([]);
  });

  it("przejście do „Sprawdź kartotekę” niesie wskazaną część", async () => {
    const u = userEvent.setup();
    const otworz = vi.fn();
    pokaz(otworz);
    await u.click(await screen.findByRole("button", { name: /^LC170430140-0001/ }));
    await u.click(screen.getByRole("button", { name: /Otwórz w „Sprawdź kartotekę"/ }));
    expect(otworz).toHaveBeenCalledWith({ twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" });
  });

  it("szukanie zawęża wyspy i daje skrót do otoczenia; kroki poszerzają, „Wróć” przywraca całość", async () => {
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("group", { name: "Wyspa W09-0211" });
    await u.type(screen.getByRole("textbox", { name: "Szukaj w sieci" }), "nac");
    const skroty = screen.getByRole("group", { name: "Pokaż otoczenie" });
    expect(screen.queryByRole("group", { name: "Wyspa WALBRO-7" })).toBeNull();
    await u.click(within(skroty).getByRole("button", { name: /NAC LS 46-450/ }));

    /* Dwa kroki od kosiarki: silnik i gaźnik — bez uszczelek, zamiennika i Walbro. */
    expect(screen.getByRole("button", { name: /^W09-0211/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^LC170430140-0001/ })).toBeNull();
    await u.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getByRole("button", { name: /^LC170430140-0001/ })).toBeInTheDocument();
    /* Powrót zdejmuje otoczenie, nie szukanie: fraza „nac" dalej zawęża wyspy
       i dalej daje skróty — człowiek ich nie wyczyścił. */
    await u.click(screen.getByRole("button", { name: "Wróć do całości" }));
    expect(screen.getByRole("group", { name: "Pokaż otoczenie" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^LC170430140-0001/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Wyspa WALBRO-7" })).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("zdjęcie warstw maszyn i silników zabiera je z rysunku", async () => {
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("group", { name: "Wyspa W09-0211" });
    await u.click(screen.getByRole("checkbox", { name: /Części do maszyn/ }));
    await u.click(screen.getByRole("checkbox", { name: /Silniki w maszynach/ }));
    expect(screen.queryByRole("button", { name: /^Honda GX160/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^NAC LS 46-450/ })).toBeNull();
    await u.click(screen.getByRole("checkbox", { name: /Zamienniki z opisów/ }));
    expect(screen.queryByRole("button", { name: /^EX055/ })).toBeNull();
  });

  it("wielka wyspa nie rysuje się sama, ale da się ją narysować", async () => {
    const u = userEvent.setup();
    const czesci = Array.from({ length: 130 }, (_, i) => i + 2000);
    dane = {
      wezly: [{ klucz: "model:9", rodzaj: "maszyna", twId: null, etykieta: "Kosiarka X", nazwa: "Kosiarka X" },
        ...czesci.map((n) => ({ klucz: `tw:${n}`, rodzaj: "kartoteka" as const, twId: n, etykieta: `C-${n}`, nazwa: `Część ${n}` }))],
      krawedzie: czesci.map((n) => kr({ z: `tw:${n}`, do: "model:9", warstwa: "zastosowania", rodzaj: "pasuje", zdanie: "x" })),
    };
    pokaz();
    expect(await screen.findByText(/na jednym rysunku nie da się jej przeczytać/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Wyspa Kosiarka X" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Narysuj mimo to" }));
    expect(screen.getByRole("group", { name: "Wyspa Kosiarka X" })).toBeInTheDocument();
  });

  it("pusta baza mówi, skąd biorą się powiązania", async () => {
    dane = { wezly: [], krawedzie: [] };
    pokaz();
    await waitFor(() => expect(screen.getByText(/Nie ma jeszcze żadnego pasowania ani zastosowania/)).toBeInTheDocument());
  });
});
