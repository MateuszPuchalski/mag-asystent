import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Logowanie } from "./Logowanie";

/* ── Logowanie i pierwsze konto (0.496.0) ─────────────────────────────
   1. Otwarcie to same odczyty — także na pustej instalacji.
   2. Pusta baza: formularz pierwszego konta zamiast logowania; jeden zapis
      (konto) i od razu logowanie tym samym hasłem.
   3. Hasła, które się różnią, nie wychodzą z przeglądarki.
   4. Serwer, który nie mówi, czy baza jest pusta, dostaje zwykłe logowanie. */

let wyslane: Array<{ url: string; body: Record<string, string> }> = [];
let setup: { potrzebne: boolean } | "blad" = { potrzebne: false };

beforeEach(() => {
  wyslane = [];
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const odp = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
    if ((init?.method ?? "GET") !== "GET") {
      wyslane.push({ url, body: JSON.parse(init!.body as string) });
      if (url === "/api/users") return odp({ user: { userId: 1, login: "anna", role: "admin" } });
      if (url === "/api/auth/login") return odp({ token: "tok-1" });
      return odp({ ok: true });
    }
    if (url === "/api/setup") return setup === "blad" ? odp({ error: "x" }, 500) : odp(setup);
    throw new Error(`nieoczekiwany adres: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("Logowanie", () => {
  it("zwykła instalacja: logowanie, bez żadnego zapisu przy otwarciu", async () => {
    render(<Logowanie zalogowano={() => {}} />);
    expect(await screen.findByRole("form", { name: "Logowanie" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Pierwsze konto" })).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("pusta baza: pierwsze konto, potem od razu zalogowany", async () => {
    setup = { potrzebne: true };
    const zalogowano = vi.fn();
    render(<Logowanie zalogowano={zalogowano} />);
    await screen.findByRole("form", { name: "Pierwsze konto" });
    expect(wyslane).toEqual([]);
    await userEvent.type(screen.getByLabelText("Imię i nazwisko"), "Anna Nowak");
    await userEvent.type(screen.getByLabelText("Login"), "anna");
    await userEvent.type(screen.getByLabelText("Hasło"), "tajnehaslo");
    await userEvent.type(screen.getByLabelText("Powtórz hasło"), "tajnehaslo");
    await userEvent.click(screen.getByRole("button", { name: /ZAŁÓŻ KONTO/ }));
    await waitFor(() => expect(zalogowano).toHaveBeenCalled());
    expect(wyslane).toEqual([
      { url: "/api/users", body: { name: "Anna Nowak", login: "anna", haslo: "tajnehaslo" } },
      { url: "/api/auth/login", body: { login: "anna", haslo: "tajnehaslo" } },
    ]);
    expect(localStorage.length).toBeGreaterThan(0);
  });

  it("różne hasła nie wychodzą z przeglądarki", async () => {
    setup = { potrzebne: true };
    render(<Logowanie zalogowano={() => {}} />);
    await screen.findByRole("form", { name: "Pierwsze konto" });
    await userEvent.type(screen.getByLabelText("Imię i nazwisko"), "Anna Nowak");
    await userEvent.type(screen.getByLabelText("Login"), "anna");
    await userEvent.type(screen.getByLabelText("Hasło"), "tajnehaslo");
    await userEvent.type(screen.getByLabelText("Powtórz hasło"), "innehaslo");
    await userEvent.click(screen.getByRole("button", { name: /ZAŁÓŻ KONTO/ }));
    expect(await screen.findByText("Hasła się różnią")).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("serwer nie mówi, czy baza jest pusta — zwykłe logowanie", async () => {
    setup = "blad";
    render(<Logowanie zalogowano={() => {}} />);
    expect(await screen.findByRole("form", { name: "Logowanie" })).toBeInTheDocument();
  });
});
