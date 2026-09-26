import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Ustawienia } from "./Ustawienia";
import { _wyczyscPamiecZdjec } from "../towar/useZdjecie";
/* Źródło jako tekst (`?raw`) — Vite umie to podać bez typów Node'a. */
import zrodloSkrzynki from "./Skrzynka.tsx?raw";
import zrodloRamy from "../main.tsx?raw";
import zrodloStanu from "./Stan.tsx?raw";
import zrodloAnalizy from "./Analiza.tsx?raw";

/* ── USTAWIENIA w panelu (0.444.0) ─────────────────────────────────────
   Gwarancje przeniesione z testów widoku ustawień w
   `server/src/routes/biuro.test.ts` oraz te, które ekran miał wcześniej:

   1. ZERO ZAPISU PRZY PATRZENIU — także przeniesienie danych firmy
      z przeglądarki stoi za przyciskiem, nie dzieje się przy otwarciu.
   2. Przycisk przeniesienia TYLKO przy pustym serwerze i danych w przeglądarce.
   3. Akcje kont widzi admin; biuro widzi listę bez przycisków.
   4. Żądania bez ciała nie deklarują typu treści (WYLOGUJ WSZĘDZIE, USUŃ
      LOGO) — strażnik pustego ciała z `biuro.test.ts` przeszedł tu.
   5. Reguły strefy: pusty komplet nie wyjeżdża, zapis niesie komplet.
   6. Słownik tagów: wyłączone widać, kasowania nie ma, sufit jest widoczny.
   7. Miary obsługi i stan integracji mieszkają gdzie indziej. */

let wyslane: Array<{ metoda: string; url: string; body?: string; typ?: string }> = [];
let odczyty: string[] = [];

/* Serwer nie wysyła wartości sekretu ani domyślnej — atrapa też nie. */
const KONFIGURACJA = {
  plik: "C:\\wertis\\wertis.env",
  grupy: { subiekt: "Połączenie z Subiektem", zwroty: "Zwroty i reklamacje" },
  nieznane: ["ALEGRO_CLIENT_ID"],
  wiersze: [
    { klucz: "MSSQL_SERVER", grupa: "subiekt", kto: "instalator", opis: "Adres SQL Servera.", czyta: ["serwer"],
      tajny: false, zrodlo: "plik", wartosc: "serwer-subiekta", edycja: null },
    { klucz: "MSSQL_PASSWORD", grupa: "subiekt", kto: "instalator", opis: "Hasło loginu SQL.", czyta: ["serwer"],
      tajny: true, zrodlo: "plik", wartosc: null, edycja: null },
    { klucz: "MSSQL_SYNC_MS", grupa: "subiekt", kto: "zaawansowane", opis: "Takt odświeżania.", czyta: ["serwer"],
      tajny: false, zrodlo: "domyslna", wartosc: null, edycja: null },
    { klucz: "ZWROT_TERMIN_DNI", grupa: "zwroty", kto: "wlasciciel", opis: "Dni na obsłużenie zwrotu.", czyta: ["serwer"],
      tajny: false, zrodlo: "domyslna", wartosc: null, edycja: { rodzaj: "liczba" } },
    { klucz: "ANTHROPIC_API_KEY", grupa: "zwroty", kto: "wlasciciel", opis: "Klucz API.", czyta: ["serwer"],
      tajny: true, zrodlo: "plik", wartosc: null, edycja: { rodzaj: "tekst" } },
  ],
};
/* Dwa wydania z paczką; nowsze wymaga działania poza przyciskiem. */
let AKTUALIZACJA: Record<string, unknown>;
const AKTUALIZACJA_WZOR = {
  obecna: "0.492.0", sprawdzono: "2026-09-24T08:00:00.000Z", bladSprawdzenia: null,
  wydania: [
    { wersja: "0.494.0", opublikowano: "2026-09-25T10:00:00Z", maPaczke: true },
    { wersja: "0.493.0", opublikowano: "2026-09-24T12:00:00Z", maPaczke: true },
  ],
  zmiany: [
    { wersja: "0.494.0", tytul: "0.494.0 — 25 września 2026", tresc: "Nowy port kolektora.", wymagaDzialania: true },
    { wersja: "0.493.0", tytul: "0.493.0 — 24 września 2026", tresc: "Poprawka zwrotów.", wymagaDzialania: false },
  ],
  ostatnia: { etap: "gotowe", wersja: "0.492.0", kto: "Anna", od: "2026-09-24T07:00:00.000Z", do: "2026-09-24T07:03:00.000Z" },
  czekaZlecenie: false,
  blokada: null,
  auto: { tryb: "noc", okno: { od: 3, do: 5 }, dojrzaloscGodz: 6, kanarek: null,
    kandydat: "0.493.0", teraz: false, powod: "Wydanie 0.494.0 wymaga działania — zaktualizuj przyciskiem po przeczytaniu." },
};
let KOLEKTOR: { adresy: string[]; port: number; apk: { wersja: string } | null };
let rola = "admin";
let firmaNaSerwerze: { dane: Record<string, string>; zmieniono: { at: string; przez: string } | null };

const PUSTA_FIRMA = { nazwa: "", nip: "", adres: "", miejscowosc: "", osoba: "", telefon: "" };

beforeEach(() => {
  wyslane = []; odczyty = []; rola = "admin";
  AKTUALIZACJA = { ...AKTUALIZACJA_WZOR };
  KOLEKTOR = { adresy: ["192.168.1.49", "10.8.0.2"], port: 3001, apk: { wersja: "0.493.0" } };
  firmaNaSerwerze = { dane: { ...PUSTA_FIRMA }, zmieniono: null };
  localStorage.clear();
  /* Pamięć obrazów jest modułowa i żyje między testami. */
  _wyczyscPamiecZdjec();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    const odp = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (metoda !== "GET") {
      const naglowki = (init?.headers ?? {}) as Record<string, string>;
      wyslane.push({ metoda, url, body: init?.body as string | undefined, typ: naglowki["content-type"] });
      if (url === "/api/biuro/firma") {
        firmaNaSerwerze = { dane: JSON.parse(init!.body as string), zmieniono: { at: "2026-09-23T08:00:00.000Z", przez: "Anna" } };
        return odp(firmaNaSerwerze);
      }
      if (url === "/api/biuro/strefa") return odp({ ok: true, regul: JSON.parse(init!.body as string).reguly.length });
      if (url.endsWith("/wyloguj")) return odp({ ok: true, sesji: 2 });
      if (url === "/api/biuro/konfiguracja") {
        return odp({ ok: true, klucz: JSON.parse(init!.body as string).klucz, restart: "reczny" });
      }
      if (url === "/api/biuro/aktualizacja/sprawdz") return odp(AKTUALIZACJA);
      if (url === "/api/biuro/aktualizacja") return odp({ ok: true, wersja: JSON.parse(init!.body as string).wersja });
      if (url === "/api/users") {
        const b = JSON.parse(init!.body as string);
        return odp({ user: { userId: 9, login: b.login, name: b.name, role: b.role, active: true, maHaslo: true } });
      }
      return odp({ ok: true });
    }
    odczyty.push(url);
    if (url === "/api/auth/me") return odp({ user: { userId: 1, name: "Anna", role: rola } });
    if (url === "/api/biuro/konfiguracja") return odp(KONFIGURACJA);
    if (url === "/api/biuro/aktualizacja") return odp(AKTUALIZACJA);
    if (url === "/api/biuro/kolektor") return odp(KOLEKTOR);
    if (url === "/api/biuro/firma") return odp(firmaNaSerwerze);
    if (url === "/api/biuro/strefa") return odp({ reguly: [{ alejka: "A", od: "", do: "", poziomy: "2,3" }] });
    if (url === "/api/users") return odp({ users: [
      { userId: 1, login: "anna", name: "Anna", role: "admin", active: true, maHaslo: true },
      { userId: 2, login: "jan", name: "Jan Wrona", role: "magazynier", active: true, maHaslo: true },
    ] });
    if (url === "/api/users/2/sesje") return odp({ sesje: [
      { deviceId: "KOL-03", createdAt: "2026-09-22T06:00:00.000Z", lastSeen: "2026-09-23T07:00:00.000Z" }] });
    if (url === "/api/biuro/dostawcy") return odp({ dostawcy: [
      { khId: 5, nazwa: "Rosa-Pol", dokumentow: 11, maLogo: true },
      { khId: 6, nazwa: "Hydro-Mat", dokumentow: 3, maLogo: false }] });
    /* Obraz jako atrapa odpowiedzi, jak w `Dostawy.test.tsx`: `Response`
       z Node'a nie przyjmuje `Blob` z jsdom. */
    if (url === "/api/dostawcy/5/logo") return { ok: true, status: 200, blob: async () => new Blob() } as unknown as Response;
    if (url === "/api/obsluga/tagi") return odp({ tagi: [
      { id: 1, nazwa: "u producenta / u dostawcy", aktywny: true },
      { id: 2, nazwa: "stary tag", aktywny: false }] });
    throw new Error(`nieoczekiwany adres w teście: ${url}`);
  }));
  /* jsdom nie ma `URL.createObjectURL` — logo idzie przez `blob:`. */
  URL.createObjectURL = vi.fn(() => "blob:logo");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

function pokaz(adres = "/obsluga/ustawienia") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[adres]}><Ustawienia /></MemoryRouter></QueryClientProvider>);
}

const karta = (tytul: string) => screen.getByRole("heading", { name: tytul }).closest(".card") as HTMLElement;

describe("Ustawienia w panelu", () => {
  it("otwarcie to same odczyty — nawet z danymi firmy w przeglądarce", async () => {
    localStorage.setItem("wertis.firma", JSON.stringify({ Nazwa: "WERTIS", Nip: "123" }));
    pokaz();
    await screen.findByText("Rosa-Pol");
    expect(wyslane).toEqual([]);
    /* Na wejściu grupa Firma: to, co wychodzi na papier do dostawcy. */
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent))
      .toEqual(["Dane firmy do protokołów", "Logo dostawców"]);
    const grupy = within(screen.getByRole("navigation", { name: "Grupy ustawień" })).getAllByRole("button");
    expect(grupy.map((b) => b.querySelector("span")!.textContent))
      .toEqual(["Firma", "Magazyn", "Ludzie i urządzenia", "Obsługa klienta", "Serwer"]);
    expect(grupy[0]).toHaveAttribute("aria-current", "page");
    /* Zdania o innych ekranach i o dawnym wydaniu zeszły (0.521.0). */
    expect(screen.queryByText(/Pomiary obsługi są w Analizie/)).toBeNull();
    expect(screen.queryByText(/0\.87\.0/)).toBeNull();
  });

  /* Pięć grup (0.529.0): przejście przez wszystkie to same odczyty, a każda
     karta stoi w grupie, na którą wpływa — decyzje właściciela też. */
  it("przejście przez wszystkie grupy: karty na swoich miejscach, zero zapisu", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    const nav = screen.getByRole("navigation", { name: "Grupy ustawień" });
    const tytuly = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    await userEvent.click(within(nav).getByRole("button", { name: /^Magazyn/ }));
    await screen.findByDisplayValue("2,3");
    expect(tytuly()).toEqual(["Reguły strefy złotej"]);
    await userEvent.click(within(nav).getByRole("button", { name: /^Ludzie i urządzenia/ }));
    await screen.findByText("Jan Wrona");
    expect(tytuly()).toEqual(["Konta i sesje", "Nowy kolektor"]);
    await userEvent.click(within(nav).getByRole("button", { name: /^Obsługa klienta/ }));
    await screen.findByText("ZWROT_TERMIN_DNI");
    expect(tytuly()).toEqual(["Tagi spraw", "Zwroty i reklamacje"]);
    await userEvent.click(within(nav).getByRole("button", { name: /^Serwer/ }));
    await screen.findByText("serwer-subiekta");
    expect(tytuly()).toEqual(["Aktualizacja serwera", "Konfiguracja serwera"]);
    expect(wyslane).toEqual([]);
  });

  it("głęboki link do strefy złotej otwiera grupę Magazyn", async () => {
    pokaz("/obsluga/ustawienia?karta=strefa");
    expect(await screen.findByRole("heading", { name: "Reguły strefy złotej" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Grupy ustawień" }))
      .getByRole("button", { name: /^Magazyn/ })).toHaveAttribute("aria-current", "page");
  });

  it("przeniesienie z przeglądarki: tylko przy pustym serwerze, jednym kliknięciem", async () => {
    localStorage.setItem("wertis.firma", JSON.stringify({ Nazwa: "WERTIS", Nip: "123", Telefon: "600" }));
    pokaz();
    const przycisk = await screen.findByRole("button", { name: /Przenieś na serwer/ });
    await userEvent.click(przycisk);
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0].metoda).toBe("PUT");
    expect(JSON.parse(wyslane[0].body!)).toEqual({ ...PUSTA_FIRMA, nazwa: "WERTIS", nip: "123", telefon: "600" });
    /* Po zapisie serwer nie jest pusty — propozycja znika. */
    await waitFor(() => expect(screen.queryByRole("button", { name: /Przenieś na serwer/ })).toBeNull());
    expect(await within(karta("Dane firmy do protokołów")).findByText("WERTIS")).toBeInTheDocument();
  });

  it("serwer z danymi wygrywa — przeglądarka nie proponuje nadpisania", async () => {
    localStorage.setItem("wertis.firma", JSON.stringify({ Nazwa: "Stara nazwa" }));
    firmaNaSerwerze = { dane: { ...PUSTA_FIRMA, nazwa: "WERTIS Sp. z o.o." }, zmieniono: { at: "2026-09-20T10:00:00.000Z", przez: "Ola" } };
    pokaz();
    expect(await screen.findByText("WERTIS Sp. z o.o.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Przenieś na serwer/ })).toBeNull();
    expect(screen.getByText(/Ostatnio zmienił\(a\) Ola/)).toBeInTheDocument();
  });

  it("pusta przeglądarka i pusty serwer — nie ma czego przenosić", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    expect(screen.queryByRole("button", { name: /Przenieś na serwer/ })).toBeNull();
  });

  it("zapis danych firmy wysyła komplet sześciu pól", async () => {
    pokaz();
    const k = await waitFor(() => karta("Dane firmy do protokołów"));
    /* Formularz stoi za „Zmień" (0.521.0) — na wierzchu jest odczyt. */
    await userEvent.click(await within(k).findByRole("button", { name: "Zmień" }));
    await userEvent.type(within(k).getByRole("textbox", { name: "Miejscowość" }), "Kraków");
    await userEvent.click(within(k).getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(JSON.parse(wyslane[0].body!)).toEqual({ ...PUSTA_FIRMA, miejscowosc: "Kraków" });
    /* Po zapisie formularz się zamyka, a odczyt pokazuje nową wartość. */
    expect(await within(k).findByText("Kraków")).toBeInTheDocument();
    expect(within(k).queryByRole("textbox")).toBeNull();
  });

  it("dane firmy: na wierzchu odczyt, formularz jedno kliknięcie dalej, Anuluj nic nie wysyła", async () => {
    firmaNaSerwerze = { dane: { ...PUSTA_FIRMA, nazwa: "WERTIS", nip: "123" }, zmieniono: { at: "2026-09-20T10:00:00.000Z", przez: "Ola" } };
    pokaz();
    const k = await waitFor(() => karta("Dane firmy do protokołów"));
    expect(await within(k).findByText("WERTIS")).toBeInTheDocument();
    expect(within(k).queryByRole("textbox")).toBeNull();
    await userEvent.click(within(k).getByRole("button", { name: "Zmień" }));
    const nazwa = within(k).getByRole("textbox", { name: "Nazwa firmy" });
    expect(nazwa).toHaveValue("WERTIS");
    await userEvent.type(nazwa, " XYZ");
    await userEvent.click(within(k).getByRole("button", { name: "Anuluj" }));
    expect(within(k).queryByRole("textbox")).toBeNull();
    expect(within(k).queryByText("WERTIS XYZ")).toBeNull();
    /* Ponowne otwarcie zaczyna od stanu serwera, nie od porzuconej edycji. */
    await userEvent.click(within(k).getByRole("button", { name: "Zmień" }));
    expect(within(k).getByRole("textbox", { name: "Nazwa firmy" })).toHaveValue("WERTIS");
    expect(wyslane).toEqual([]);
  });

  it("reguły strefy: pusty komplet nie wyjeżdża, pełny idzie w całości", async () => {
    pokaz("/obsluga/ustawienia?grupa=magazyn");
    await screen.findByDisplayValue("2,3");
    const k = karta("Reguły strefy złotej");
    await userEvent.click(within(k).getByRole("button", { name: "Usuń regułę 1" }));
    expect(within(k).getByRole("button", { name: "Zapisz reguły" })).toBeDisabled();
    expect(within(k).getByText(/Bez reguł żaden towar/)).toBeInTheDocument();
    await userEvent.click(within(k).getByRole("button", { name: /Reguła/ }));
    await userEvent.type(within(k).getByRole("textbox", { name: "Alejka, reguła 1" }), "P");
    await userEvent.type(within(k).getByRole("textbox", { name: "Poziomy, reguła 1" }), "1");
    await userEvent.click(within(k).getByRole("button", { name: "Zapisz reguły" }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(JSON.parse(wyslane[0].body!)).toEqual({ reguly: [{ alejka: "P", od: "", do: "", poziomy: "1" }] });
  });

  it("konfiguracja: ustawione na wierzchu, sekret bez wartości, literówka na czerwono", async () => {
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Konfiguracja serwera"));
    expect(await within(k).findByText("serwer-subiekta")).toBeInTheDocument();
    expect(within(k).getAllByText("ustawione")).toHaveLength(1);
    expect(within(k).getByText(/ALEGRO_CLIENT_ID/)).toBeInTheDocument();
    /* Klucz instalatora bez przycisku — serwer by odmówił. */
    const wiersz = within(k).getByText("MSSQL_SERVER").closest("tr") as HTMLElement;
    expect(within(wiersz).queryByRole("button", { name: "Zmień" })).toBeNull();
    /* Decyzje właściciela mieszkają w swoich grupach, nie tutaj. */
    expect(within(k).queryByText("ZWROT_TERMIN_DNI")).toBeNull();
    /* Domyślne pokrętło dopiero po przełączniku. */
    expect(within(k).queryByText("MSSQL_SYNC_MS")).toBeNull();
    await userEvent.click(within(k).getByRole("button", { name: /Wszystkie \(3\)/ }));
    expect(within(k).getByText("MSSQL_SYNC_MS")).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("decyzje właściciela stoją w grupie, na którą wpływają — zwroty przy obsłudze", async () => {
    pokaz("/obsluga/ustawienia?grupa=obsluga");
    const k = await waitFor(() => karta("Zwroty i reklamacje"));
    expect(await within(k).findByText("ZWROT_TERMIN_DNI")).toBeInTheDocument();
    /* Klucz właściciela z wartością domyślną widać zawsze, sekret bez wartości. */
    expect(within(k).getAllByText("ustawione")).toHaveLength(1);
    expect(within(k).queryByText("MSSQL_SERVER")).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("zmiana ustawienia: jeden klucz w jednym żądaniu", async () => {
    pokaz("/obsluga/ustawienia?grupa=obsluga");
    const k = await waitFor(() => karta("Zwroty i reklamacje"));
    await within(k).findByText("ZWROT_TERMIN_DNI");
    const wiersz = (klucz: string) => within(k).getByText(klucz).closest("tr") as HTMLElement;
    await userEvent.click(within(wiersz("ZWROT_TERMIN_DNI")).getByRole("button", { name: "Zmień" }));
    expect(wyslane).toEqual([]);
    await userEvent.type(within(k).getByLabelText("ZWROT_TERMIN_DNI"), "10");
    await userEvent.click(within(k).getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toMatchObject({ metoda: "POST", url: "/api/biuro/konfiguracja" });
    expect(JSON.parse(wyslane[0].body!)).toEqual({ klucz: "ZWROT_TERMIN_DNI", wartosc: "10" });
    /* Poza NSSM restart zostaje człowiekowi — panel mówi to wprost. */
    expect(await within(k).findByText(/Zadziała po restarcie usług/)).toBeInTheDocument();
  });

  it("sekret: pole puste na start, pustego nie zapisze", async () => {
    pokaz("/obsluga/ustawienia?grupa=obsluga");
    const k = await waitFor(() => karta("Zwroty i reklamacje"));
    await within(k).findByText("ANTHROPIC_API_KEY");
    const wiersz = within(k).getByText("ANTHROPIC_API_KEY").closest("tr") as HTMLElement;
    await userEvent.click(within(wiersz).getByRole("button", { name: "Zmień" }));
    const pole = within(wiersz).getByLabelText("ANTHROPIC_API_KEY") as HTMLInputElement;
    expect(pole.type).toBe("password");
    expect(pole.value).toBe("");
    expect(within(wiersz).getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });

  it("aktualizacja: zmiany przed decyzją, bez hasła i odhaczenia nie ruszy", async () => {
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    expect(await within(k).findByText("Nowy port kolektora.")).toBeInTheDocument();
    expect(within(k).getByText("Poprawka zwrotów.")).toBeInTheDocument();
    const przycisk = within(k).getByRole("button", { name: "Zaktualizuj do 0.494.0" });
    expect(przycisk).toBeDisabled();
    await userEvent.type(within(k).getByLabelText("Twoje hasło"), "tajne");
    /* „wymaga działania" w zmianach — hasło nie wystarcza. */
    expect(przycisk).toBeDisabled();
    await userEvent.click(within(k).getByLabelText(/co wymaga działania/));
    expect(wyslane).toEqual([]);
    await userEvent.click(przycisk);
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toMatchObject({ metoda: "POST", url: "/api/biuro/aktualizacja", typ: "application/json" });
    expect(JSON.parse(wyslane[0].body!)).toEqual({ wersja: "0.494.0", haslo: "tajne" });
  });

  it("aktualizacja do starszego wydania: zmiany ucięte, odhaczenie niepotrzebne", async () => {
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    await userEvent.selectOptions(await within(k).findByLabelText("Wersja docelowa"), "0.493.0");
    expect(within(k).queryByText("Nowy port kolektora.")).toBeNull();
    expect(within(k).queryByLabelText(/co wymaga działania/)).toBeNull();
    await userEvent.type(within(k).getByLabelText("Twoje hasło"), "tajne");
    expect(within(k).getByRole("button", { name: "Zaktualizuj do 0.493.0" })).toBeEnabled();
  });

  it("nowy kolektor: kod do APK z adresu serwera, nie z paska przeglądarki", async () => {
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    const k = await waitFor(() => karta("Nowy kolektor"));
    /* Kod stoi za „Pokaż kod" (0.521.0); adres jest na wierzchu od razu. */
    await userEvent.click(await within(k).findByRole("button", { name: /Pokaż kod/ }));
    expect(await within(k).findByRole("img", { name: "Kod QR: http://192.168.1.49:3001/api/aktualizacja/apk" }))
      .toBeInTheDocument();
    expect(within(k).getByText("http://192.168.1.49:3001")).toBeInTheDocument();
    /* Kilka adresów — wybór przestawia i kod, i napis. */
    await userEvent.selectOptions(within(k).getByLabelText("Adres serwera"), "10.8.0.2");
    expect(within(k).getByRole("img", { name: "Kod QR: http://10.8.0.2:3001/api/aktualizacja/apk" })).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("nowy kolektor: kod schowany przy otwarciu, adres widać bez klikania", async () => {
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    const k = await waitFor(() => karta("Nowy kolektor"));
    expect(await within(k).findByText("http://192.168.1.49:3001")).toBeInTheDocument();
    expect(within(k).queryByRole("img")).toBeNull();
    await userEvent.click(within(k).getByRole("button", { name: /Pokaż kod/ }));
    await userEvent.click(within(k).getByRole("button", { name: "Schowaj kod" }));
    expect(within(k).queryByRole("img")).toBeNull();
  });

  it("nowy kolektor bez APK na serwerze: zdanie zamiast kodu", async () => {
    KOLEKTOR = { adresy: ["192.168.1.49"], port: 3001, apk: null };
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    const k = await waitFor(() => karta("Nowy kolektor"));
    expect(await within(k).findByText(/nie ma jeszcze APK/)).toBeInTheDocument();
    expect(within(k).queryByRole("img")).toBeNull();
    expect(within(k).queryByRole("button", { name: /Pokaż kod/ })).toBeNull();
    expect(within(k).queryByLabelText("Adres serwera")).toBeNull();
  });

  it("automat: tryb, okno i zdanie serwera, bez żadnego zapisu", async () => {
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    const linia = (await within(k).findByText(/Automatycznie:/)).closest("p") as HTMLElement;
    expect(linia.textContent).toMatch(/w nocy 3:00–5:00, wydanie starsze niż 6 h\./);
    expect(linia.textContent).toMatch(/0\.494\.0 wymaga działania/);
    /* Nazwa zmiennej nie stoi w zdaniu (0.521.0) — tylko w dymku. */
    expect(linia.textContent).not.toMatch(/AKTUALIZACJA_AUTO/);
    expect(within(linia).getByTitle("Klucz AKTUALIZACJA_AUTO")).toHaveTextContent("„Serwer i kopie”");
    expect(wyslane).toEqual([]);
  });

  it("nieudana aktualizacja: dziennik po ludzku, ścieżka pliku w dymku", async () => {
    AKTUALIZACJA = { ...AKTUALIZACJA_WZOR, ostatnia: { ...AKTUALIZACJA_WZOR.ostatnia, etap: "blad" } };
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    const linia = (await within(k).findByText(/Ostatnia aktualizacja/)).closest("p") as HTMLElement;
    expect(linia.textContent).toMatch(/serwer wrócił do poprzedniej wersji/);
    expect(linia.textContent).not.toMatch(/ostatnia\.log/);
    expect(within(linia).getByTitle(/ostatnia\.log$/)).toHaveTextContent("dzienniku aktualizacji na serwerze");
  });

  it("automat w trybie domyślnym: bez okna nocnego, z wiekiem wydania", async () => {
    AKTUALIZACJA = { ...AKTUALIZACJA_WZOR, auto: { ...AKTUALIZACJA_WZOR.auto, tryb: "zaraz", dojrzaloscGodz: 1 } };
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    const linia = (await within(k).findByText(/Automatycznie:/)).closest("p") as HTMLElement;
    expect(linia.textContent).toMatch(/gdy nikt nie pracuje, wydanie starsze niż 1 h\./);
    expect(linia.textContent).not.toMatch(/3:00/);
  });

  it("sprawdź teraz: POST bez ciała i bez typu treści", async () => {
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    await within(k).findByText("Poprawka zwrotów.");
    await userEvent.click(within(k).getByRole("button", { name: /Sprawdź teraz/ }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toEqual({ metoda: "POST", url: "/api/biuro/aktualizacja/sprawdz", body: undefined, typ: undefined });
  });

  it("blokada serwera: zdanie zamiast działającego przycisku", async () => {
    AKTUALIZACJA = { ...AKTUALIZACJA_WZOR, blokada: "Aktualizacja z panelu działa na serwerze uruchomionym jako usługa Windows." };
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    expect(await within(k).findByText(/jako usługa Windows/)).toBeInTheDocument();
    await userEvent.type(within(k).getByLabelText("Twoje hasło"), "tajne");
    await userEvent.click(within(k).getByLabelText(/co wymaga działania/));
    expect(within(k).getByRole("button", { name: "Zaktualizuj do 0.494.0" })).toBeDisabled();
  });

  /* Pasek postępu (0.504.0): kroki z instalatora, bez procentów z zegara;
     w trakcie nie ma formularza, a samo patrzenie nadal niczego nie zapisuje. */
  it("aktualizacja w toku: pasek z krokiem instalatora zamiast formularza", async () => {
    AKTUALIZACJA = { ...AKTUALIZACJA_WZOR, ostatnia: {
      etap: "trwa", wersja: "0.503.0", kto: "Administrator", od: new Date(Date.now() - 75_000).toISOString(),
      postep: { krok: 3, z: 4, nazwa: "Zamiana wersji, serwer na chwilę wyłączony", at: new Date().toISOString() } } };
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    const pasek = await within(k).findByRole("progressbar", { name: "Postęp aktualizacji" });
    expect(pasek).toHaveAttribute("aria-valuenow", "3");
    expect(pasek).toHaveAttribute("aria-valuemax", "4");
    expect(within(k).getByText(/Krok 3 z 4: Zamiana wersji, serwer na chwilę wyłączony/)).toBeInTheDocument();
    expect(within(k).getByText(/· 1:1\d/)).toBeInTheDocument();
    expect(within(k).queryByLabelText("Twoje hasło")).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("aktualizacja w toku bez kroku od instalatora: przygotowanie, pasek pusty", async () => {
    AKTUALIZACJA = { ...AKTUALIZACJA_WZOR, ostatnia: {
      etap: "trwa", wersja: "0.503.0", od: new Date().toISOString() } };
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    const pasek = await within(k).findByRole("progressbar", { name: "Postęp aktualizacji" });
    expect(pasek).toHaveAttribute("aria-valuenow", "0");
    expect(within(k).getByText(/Przygotowanie aktualizacji/)).toBeInTheDocument();
  });

  it("najnowsza wersja: bez formularza", async () => {
    AKTUALIZACJA = { ...AKTUALIZACJA_WZOR, wydania: [], zmiany: [] };
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    expect(await within(k).findByText("To najnowsza wersja.")).toBeInTheDocument();
    expect(within(k).queryByLabelText("Twoje hasło")).toBeNull();
  });

  it("przed pierwszym sprawdzeniem nie twierdzi, że to najnowsza wersja", async () => {
    AKTUALIZACJA = { ...AKTUALIZACJA_WZOR, sprawdzono: null, wydania: [], zmiany: [] };
    pokaz("/obsluga/ustawienia?grupa=serwer");
    const k = await waitFor(() => karta("Aktualizacja serwera"));
    expect(await within(k).findByText(/jeszcze nie sprawdzał wydań/)).toBeInTheDocument();
    expect(within(k).queryByText("To najnowsza wersja.")).toBeNull();
  });

  it("biuro nie widzi konfiguracji i nawet o nią nie pyta", async () => {
    rola = "biuro";
    /* Adres z grupą Serwer, której biuro nie ma — ekran wraca na Firmę. */
    pokaz("/obsluga/ustawienia?grupa=serwer");
    await screen.findByText("Rosa-Pol");
    const nav = screen.getByRole("navigation", { name: "Grupy ustawień" });
    expect(within(nav).queryByRole("button", { name: /^Serwer/ })).toBeNull();
    await userEvent.click(within(nav).getByRole("button", { name: /^Obsługa klienta/ }));
    await screen.findByText("u producenta / u dostawcy");
    await userEvent.click(within(nav).getByRole("button", { name: /^Ludzie i urządzenia/ }));
    await screen.findByText("Jan Wrona");
    expect(screen.queryByRole("heading", { name: "Konfiguracja serwera" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Zwroty i reklamacje" })).toBeNull();
    expect(odczyty).not.toContain("/api/biuro/konfiguracja");
    expect(screen.queryByRole("heading", { name: "Aktualizacja serwera" })).toBeNull();
    expect(odczyty).not.toContain("/api/biuro/aktualizacja");
  });

  it("biuro widzi konta bez przycisków, które serwer by odrzucił — zostaje tylko dodanie osoby", async () => {
    rola = "biuro";
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    await screen.findByText("Jan Wrona");
    const k = karta("Konta i sesje");
    /* Biuro zakłada magazynierów (0.490.0); reset, wyłączenie i sesje są
       adminowe i ich przyciski dalej nie istnieją. */
    expect(within(k).getAllByRole("button").map((b) => b.textContent)).toEqual(["Dodaj osobę"]);
    expect(within(k).getByText(/Reset hasła, wyłączenie konta i sesje są po stronie administratora/)).toBeInTheDocument();
  });

  it("biuro zakłada wyłącznie magazyniera — innej roli formularz nie proponuje", async () => {
    rola = "biuro";
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    await screen.findByText("Jan Wrona");
    await userEvent.click(within(karta("Konta i sesje")).getByRole("button", { name: "Dodaj osobę" }));
    const f = screen.getByRole("form", { name: "Nowa osoba" });
    expect(within(f).getAllByRole("option").map((o) => o.textContent)).toEqual(["magazynier"]);
  });

  it("admin zakłada konto: pełne dane w jednym żądaniu, hasła nie pokazuje", async () => {
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    await screen.findByText("Jan Wrona");
    await userEvent.click(within(karta("Konta i sesje")).getByRole("button", { name: "Dodaj osobę" }));
    const f = screen.getByRole("form", { name: "Nowa osoba" });
    expect(within(f).getAllByRole("option").map((o) => o.textContent)).toEqual(["magazynier", "biuro", "admin"]);
    const zaloz = within(f).getByRole("button", { name: "Załóż konto" });
    await userEvent.type(within(f).getByLabelText("Imię i nazwisko"), "Ewa Kos");
    await userEvent.type(within(f).getByLabelText("Login"), "EKos");
    await userEvent.type(within(f).getByLabelText("Hasło"), "krotko");
    /* Za krótkie hasło: przycisk nie świeci, bo serwer i tak by odmówił. */
    expect(zaloz).toBeDisabled();
    await userEvent.type(within(f).getByLabelText("Hasło"), "12");
    await userEvent.selectOptions(within(f).getByLabelText("Rola"), "biuro");
    await userEvent.click(zaloz);
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toMatchObject({ metoda: "POST", url: "/api/users" });
    expect(JSON.parse(wyslane[0].body!)).toEqual({ name: "Ewa Kos", login: "ekos", haslo: "krotko12", role: "biuro" });
    expect(await within(f).findByText(/Konto „ekos” założone/)).toBeInTheDocument();
    expect(within(f).queryByText(/krotko12/)).toBeNull();
  });

  it("admin: czynności konta za „⋯”, Escape zamyka bez zapisu", async () => {
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    await screen.findByText("Jan Wrona");
    const wiersz = screen.getByText("Jan Wrona").closest("tr") as HTMLElement;
    /* Wiersz na wierzchu niesie jeden przycisk, nie trzy (0.521.0). */
    expect(within(wiersz).getAllByRole("button").map((b) => b.getAttribute("aria-label")))
      .toEqual(["Czynności konta Jan Wrona"]);
    const menu = within(wiersz).getByRole("button", { name: "Czynności konta Jan Wrona" });
    await userEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    const grupa = within(wiersz).getByRole("group", { name: "Czynności: Jan Wrona" });
    expect(within(grupa).getAllByRole("button").map((b) => b.textContent)).toEqual(["Sesje", "Reset hasła", "Wyłącz"]);
    await userEvent.keyboard("{Escape}");
    expect(within(wiersz).queryByRole("group", { name: "Czynności: Jan Wrona" })).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("admin: reset hasła w polu hasła, minimum 8 znaków", async () => {
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    await screen.findByText("Jan Wrona");
    const wiersz = screen.getByText("Jan Wrona").closest("tr") as HTMLElement;
    await userEvent.click(within(wiersz).getByRole("button", { name: "Czynności konta Jan Wrona" }));
    await userEvent.click(within(wiersz).getByRole("button", { name: /Reset hasła/ }));
    const pole = within(wiersz).getByLabelText("Nowe hasło dla Jan Wrona");
    expect(pole.getAttribute("type")).toBe("password");
    await userEvent.type(pole, "krotkie");
    expect(within(wiersz).getByRole("button", { name: "Ustaw" })).toBeDisabled();
    await userEvent.type(pole, "8");
    await userEvent.click(within(wiersz).getByRole("button", { name: "Ustaw" }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toMatchObject({ metoda: "POST", url: "/api/users/2/haslo", body: JSON.stringify({ haslo: "krotkie8" }) });
  });

  it("admin: wyloguj wszędzie pyta, a potem idzie BEZ ciała i bez typu treści", async () => {
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    await screen.findByText("Jan Wrona");
    const wiersz = screen.getByText("Jan Wrona").closest("tr") as HTMLElement;
    await userEvent.click(within(wiersz).getByRole("button", { name: "Czynności konta Jan Wrona" }));
    await userEvent.click(within(wiersz).getByRole("button", { name: "Sesje" }));
    const sesje = await screen.findByRole("region", { name: "Sesje: Jan Wrona" });
    await within(sesje).findByText("KOL-03");
    await userEvent.click(within(sesje).getByRole("button", { name: /Wyloguj wszędzie/ }));
    expect(wyslane).toEqual([]);
    await userEvent.click(within(sesje).getByRole("button", { name: "Wyloguj" }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toEqual({ metoda: "POST", url: "/api/users/2/wyloguj", body: undefined, typ: undefined });
    expect(await within(sesje).findByText("Ucięto sesji: 2.")).toBeInTheDocument();
  });

  it("admin: wyłączenie konta za potwierdzeniem", async () => {
    pokaz("/obsluga/ustawienia?grupa=ludzie");
    await screen.findByText("Jan Wrona");
    const wiersz = screen.getByText("Jan Wrona").closest("tr") as HTMLElement;
    await userEvent.click(within(wiersz).getByRole("button", { name: "Czynności konta Jan Wrona" }));
    await userEvent.click(within(wiersz).getByRole("button", { name: /Wyłącz/ }));
    expect(wyslane).toEqual([]);
    await userEvent.click(within(wiersz).getByRole("button", { name: "Wyłącz konto" }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toMatchObject({ url: "/api/users/2/active", body: JSON.stringify({ active: false }) });
  });

  it("usunięcie logo pyta, idzie bez ciała i wyrzuca stary obraz z pamięci", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    const wiersz = screen.getByText("Rosa-Pol").closest("tr") as HTMLElement;
    /* `alt=""` robi z obrazu ozdobę bez roli — szukamy go po znaczniku. */
    await waitFor(() => expect(wiersz.querySelector("img")?.getAttribute("src")).toBe("blob:logo"));
    await userEvent.click(within(wiersz).getByRole("button", { name: /Usuń/ }));
    await userEvent.click(within(wiersz).getByRole("button", { name: "Usuń logo" }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toEqual({ metoda: "DELETE", url: "/api/biuro/dostawcy/5/logo", body: undefined, typ: undefined });
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:logo"));
    /* Dostawca bez logo ma „Wgraj", nie „Zmień" — i nie ma czego usuwać. */
    const bez = screen.getByText("Hydro-Mat").closest("tr") as HTMLElement;
    expect(within(bez).getByRole("button", { name: /Wgraj/ })).toBeInTheDocument();
    expect(within(bez).queryByRole("button", { name: /Usuń/ })).toBeNull();
  });

  it("słownik tagów pokazuje WYŁĄCZONE, mówi, że kasowania nie ma, i pokazuje sufit", async () => {
    /* Skasowany tag zniknąłby po cichu ze spraw historycznych, a odmowa przy
       dwudziestym pierwszym tagu byłaby ścianą w połowie czynności. */
    pokaz("/obsluga/ustawienia?grupa=obsluga");
    await screen.findByText("stary tag");
    /* Karta tej samej rangi co sąsiednie (0.521.0): nagłówek i przyciski. */
    expect(karta("Tagi spraw")).toBeInTheDocument();
    expect(within(karta("Tagi spraw")).getAllByRole("button", { name: "Zmień nazwę" })).toHaveLength(2);
    expect(screen.getByText("wyłączony")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Włącz z powrotem" })).toBeInTheDocument();
    expect(screen.getByText(/nie ma kasowania/)).toBeInTheDocument();
    expect(screen.getByText(/Aktywnych:/)).toBeInTheDocument();
    expect(screen.getByText(/z 20/)).toBeInTheDocument();
  });

  it("miary obsługi i stan integracji mieszkają gdzie indziej", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    expect(screen.queryByText("Sygnatura → kartoteka Subiekta")).toBeNull();
    expect(screen.queryByText("Stan integracji")).toBeNull();
    expect(zrodloAnalizy).toContain("<MiaryObslugi");
    expect(zrodloStanu).toContain("<StanIntegracji");
  });

  it("SKRZYNKA nie renderuje tabeli integracji, ale alarm na niej ZOSTAJE", () => {
    /* Sprawdzenie po źródle: pytanie jest o jedną rzecz — czy tabela ma
       dokładnie jedno miejsce w panelu. Zasada 10 projektu mówi „awaria
       integracji musi być widoczna", a §21 żąda trwałego alarmu. */
    expect(zrodloSkrzynki).not.toContain('from "../skrzynka/StanIntegracji"');
    expect(zrodloSkrzynki).not.toContain("<StanIntegracji");
    expect(zrodloSkrzynki).toContain("<AlarmSynchronizacji");
  });

  it("zębatka i trasa istnieją — ekran bez drzwi to ekran, którego nie ma", () => {
    expect(zrodloRamy).toContain('const USTAWIENIA = "/obsluga/ustawienia"');
    expect(zrodloRamy).toContain("<Route path={USTAWIENIA}");
    expect(zrodloRamy).toContain("<Link to={USTAWIENIA}");
    /* Zębatka NIE wchodzi na pasek zakładek: pasek niesie pracę. */
    const zakladki = zrodloRamy.slice(zrodloRamy.indexOf("const ZAKLADKI"),
      zrodloRamy.indexOf("]", zrodloRamy.indexOf("const ZAKLADKI")));
    expect(zakladki).not.toContain("ustawienia");
    expect(zakladki).toContain('"/obsluga/wiedza"');
  });
});
