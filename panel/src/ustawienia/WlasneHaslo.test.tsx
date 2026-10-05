import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SESJA_WYGASLA } from "../api/klient";
import { atrapaZapisow } from "../test/zapisy";
import { naruszeniaWcag } from "../test/dostepnosc";
import { przeszkodaHasla, WlasneHaslo } from "./WlasneHaslo";

/* ── Własne hasło ──────────────────────────────────────────────────────────
   Pilnuje czterech rzeczy, w kolejności, w jakiej człowiek je przechodzi:

   1. Otwarcie karty i formularza nic nie wysyła — zapis stoi za przyciskiem.
   2. Przycisk nie świeci przy haśle za krótkim albo niepowtórzonym, a zdanie
      mówi dlaczego. Literówka w nowym haśle zamknęłaby człowieka poza kontem.
   3. Wysyłka niesie dokładnie `{ stare, nowe }`, a sukces czyści pola.
   4. Odmowa serwera dochodzi bez zmian i nie wylogowuje (400, nie 401). */

const JA = { user: { userId: 7, login: "ola", name: "Ola Nowak", role: "biuro" } };

let wyslane: Array<{ metoda: string; url: string; body?: string; typ?: string }> = [];
/** Odpowiedź serwera na zmianę hasła; test podmienia ją przed kliknięciem. */
let odpowiedz: { status: number; cialo: unknown };

function atrapaSerwera() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    if (metoda !== "GET") {
      const naglowki = (init?.headers ?? {}) as Record<string, string>;
      wyslane.push({ metoda, url, body: init?.body as string | undefined, typ: naglowki["content-type"] });
      return new Response(JSON.stringify(odpowiedz.cialo), { status: odpowiedz.status });
    }
    if (url === "/api/auth/me") return new Response(JSON.stringify(JA), { status: 200 });
    return new Response(JSON.stringify({ error: "nieznany adres w teście" }), { status: 404 });
  }));
}

beforeEach(() => {
  wyslane = [];
  odpowiedz = { status: 200, cialo: { ok: true } };
  atrapaSerwera();
});
afterEach(() => vi.unstubAllGlobals());

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><WlasneHaslo /></QueryClientProvider>);
}

const karta = () => screen.getByRole("heading", { name: "Twoje hasło" }).closest(".card") as HTMLElement;
const otworz = () => userEvent.click(within(karta()).getByRole("button", { name: "Zmień hasło" }));
const formularz = () => screen.getByRole("form", { name: "Zmiana hasła" });
const wyslij = () => within(formularz()).getByRole("button", { name: "Zmień hasło" });

async function wpisz(stare: string, nowe: string, powtorzone: string) {
  const f = formularz();
  if (stare) await userEvent.type(within(f).getByLabelText("Obecne hasło"), stare);
  if (nowe) await userEvent.type(within(f).getByLabelText("Nowe hasło"), nowe);
  if (powtorzone) await userEvent.type(within(f).getByLabelText("Powtórz nowe hasło"), powtorzone);
}

describe("Twoje hasło", () => {
  it("otwarcie karty i formularza to zero zapisu", async () => {
    const stan = atrapaZapisow((url) => (url === "/api/auth/me" ? JA : undefined));
    pokaz();
    /* Na wierzchu jeden przycisk, pól hasła nie ma — formularz jest klik dalej. */
    expect(within(karta()).queryByLabelText("Obecne hasło")).toBeNull();
    await otworz();
    expect(within(formularz()).getByLabelText("Obecne hasło")).toHaveFocus();
    await waitFor(() => expect(stan.nieznane).toEqual([]));
    expect(stan.wyslane).toEqual([]);
  });

  it("pola mówią menedżerowi haseł, które jest które, a login stoi obok", async () => {
    pokaz();
    await otworz();
    const f = formularz();
    expect(within(f).getByLabelText("Obecne hasło")).toHaveAttribute("autocomplete", "current-password");
    expect(within(f).getByLabelText("Nowe hasło")).toHaveAttribute("autocomplete", "new-password");
    expect(within(f).getByLabelText("Powtórz nowe hasło")).toHaveAttribute("autocomplete", "new-password");
    for (const p of within(f).getAllByLabelText(/hasło/)) expect(p).toHaveAttribute("type", "password");
    await waitFor(() => expect(f.querySelector('input[autocomplete="username"]')).toHaveValue("ola"));
  });

  it("przycisk nie świeci przy pustym, za krótkim i niepowtórzonym haśle — zdanie mówi dlaczego", async () => {
    pokaz();
    await otworz();
    const f = formularz();
    const przycisk = wyslij();
    const powod = () => document.getElementById(przycisk.getAttribute("aria-describedby")!)?.textContent;

    expect(przycisk).toBeDisabled();
    expect(powod()).toBe("Wpisz obecne hasło.");

    await userEvent.type(within(f).getByLabelText("Obecne hasło"), "stare-haslo");
    expect(powod()).toBe("Wpisz nowe hasło, co najmniej 8 znaków.");

    await userEvent.type(within(f).getByLabelText("Nowe hasło"), "krotk");
    expect(przycisk).toBeDisabled();
    expect(powod()).toBe("Nowe hasło ma 5 znaków, a potrzeba co najmniej 8.");

    await userEvent.type(within(f).getByLabelText("Nowe hasło"), "ie12");
    expect(powod()).toBe("Powtórz nowe hasło w trzecim polu.");

    /* Literówka w powtórzeniu — dokładnie ten przypadek, dla którego jest. */
    await userEvent.type(within(f).getByLabelText("Powtórz nowe hasło"), "krotkie13");
    expect(przycisk).toBeDisabled();
    expect(powod()).toBe("Powtórzone hasło różni się od nowego. Wpisz je jeszcze raz.");

    await userEvent.clear(within(f).getByLabelText("Powtórz nowe hasło"));
    await userEvent.type(within(f).getByLabelText("Powtórz nowe hasło"), "krotkie12");
    expect(przycisk).toBeEnabled();
    expect(przycisk).not.toHaveAttribute("aria-describedby");
    expect(wyslane).toEqual([]);
  });

  it("wysyłka niesie { stare, nowe } na POST /api/auth/haslo, a sukces czyści pola", async () => {
    pokaz();
    await otworz();
    await wpisz("stare-haslo", "nowe-haslo-1", "nowe-haslo-1");
    await userEvent.click(wyslij());

    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toMatchObject({ metoda: "POST", url: "/api/auth/haslo", typ: "application/json" });
    expect(JSON.parse(wyslane[0].body!)).toEqual({ stare: "stare-haslo", nowe: "nowe-haslo-1" });

    expect(await screen.findByText("Hasło zmienione.")).toHaveAttribute("role", "status");
    /* Formularz się zamyka, a fokus wraca tam, skąd człowiek przyszedł. */
    expect(screen.queryByRole("form", { name: "Zmiana hasła" })).toBeNull();
    expect(within(karta()).getByRole("button", { name: "Zmień hasło" })).toHaveFocus();

    /* Ponowne otwarcie zaczyna od pustych pól, a stary wynik schodzi. */
    await otworz();
    for (const p of within(formularz()).getAllByLabelText(/hasło/)) expect(p).toHaveValue("");
    expect(screen.queryByText("Hasło zmienione.")).toBeNull();
  });

  it("błąd 400 pokazuje zdanie serwera bez zmian i nie wylogowuje", async () => {
    odpowiedz = { status: 400, cialo: { error: "Błędne hasło" } };
    const wylogowanie = vi.fn();
    window.addEventListener(SESJA_WYGASLA, wylogowanie);
    try {
      pokaz();
      await otworz();
      await wpisz("pomylka", "nowe-haslo-1", "nowe-haslo-1");
      await userEvent.click(wyslij());

      expect(await within(formularz()).findByText("Błędne hasło")).toBeInTheDocument();
      expect(screen.queryByText("Hasło zmienione.")).toBeNull();
      /* Formularz zostaje z wpisanym tekstem: poprawia się jedno pole. */
      expect(within(formularz()).getByLabelText("Nowe hasło")).toHaveValue("nowe-haslo-1");
      expect(wylogowanie).not.toHaveBeenCalled();
      /* Formularz z błędem na wierzchu przechodzi WCAG 2.2 AA w strukturze. */
      expect(await naruszeniaWcag()).toBe("");
    } finally {
      window.removeEventListener(SESJA_WYGASLA, wylogowanie);
    }
  });

  it("Anuluj czyści pola i nic nie wysyła", async () => {
    pokaz();
    await otworz();
    await wpisz("stare-haslo", "nowe-haslo-1", "nowe-haslo-1");
    await userEvent.click(within(formularz()).getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByRole("form", { name: "Zmiana hasła" })).toBeNull();
    await otworz();
    for (const p of within(formularz()).getAllByLabelText(/hasło/)) expect(p).toHaveValue("");
    expect(wyslane).toEqual([]);
  });
});

describe("przeszkodaHasla", () => {
  it("liczy znaki z odmianą: 1 znak, 3 znaki, 5 znaków", () => {
    expect(przeszkodaHasla("x", "a", "")).toBe("Nowe hasło ma 1 znak, a potrzeba co najmniej 8.");
    expect(przeszkodaHasla("x", "abc", "")).toBe("Nowe hasło ma 3 znaki, a potrzeba co najmniej 8.");
    expect(przeszkodaHasla("x", "abcde", "")).toBe("Nowe hasło ma 5 znaków, a potrzeba co najmniej 8.");
  });

  it("dokładnie osiem znaków i zgodne powtórzenie przepuszcza", () => {
    expect(przeszkodaHasla("x", "12345678", "12345678")).toBeNull();
  });
});
