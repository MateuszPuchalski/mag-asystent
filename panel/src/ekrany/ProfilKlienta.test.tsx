import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfilKlienta } from "./ProfilKlienta";
import type { ProfilKlienta as Profil, SprawaKlienta } from "../api/spoiwo";
import { dataLokalna } from "../ui";

/* ── PROFIL KLIENTA (24 września 2026) ───────────────────────────────────────
   Pilnujemy: otwarcie niczego nie zapisuje; sygnał „źle" prowadzi do sprawy;
   zamówienie rozwija się do pozycji; notatka zapisuje się na kliknięcie,
   a cofnięcie idzie bez ciała (reguła klienta HTTP); nieznany login to
   zdanie, nie pusty profil.

   SPRAWA KLIENTA (S6, @wydanie) dokłada swoje: otwarcie z prowadzoną sprawą
   dalej wysyła same GET-y; karta bez sprawy to jedna linijka; gotowy termin
   zapisuje krok jednym kliknięciem; zakończenie niesie wersję i odcisk,
   a „Cofnij" — wersję i odcisk z ODPOWIEDZI; „Przejmij" widać tylko przy
   cudzej sprawie i niesie odcisk; konflikt świeżości zostawia wpisany krok,
   a ponowna próba idzie ze świeżą sprawą; przyciski czekają na świeży profil;
   obudzoną zakończoną kończy się znów bez paska; stan karty nie przechodzi
   na innego klienta; granice kalendarza trzymają ósmą rano. */

const PROFIL: Profil = {
  login: "Chrzanowski1234",
  liczby: { zamowien: 2, wydanoGrosze: 15000, waluta: "PLN", zwrotow: 1, reklamacji: 1, dyskusji: 0,
    rozmow: 1, pierwszyZakup: "2026-08-15T10:00:00Z", ostatniZakup: "2026-09-19T10:00:00Z" },
  sygnaly: [{ ton: "zle", tekst: "Otwarta reklamacja, termin 30.09.2026", cel: "/obsluga/reklamacje/3" }],
  otwarte: [{ rodzaj: "rozmowa", id: 41, opis: "Czy pasuje?", od: "2026-09-23T10:00:00Z",
    stan: "czeka na nas", cel: "/obsluga/skrzynka/41" }],
  zamowienia: [{ id: "z-1", kupionoAt: "2026-09-19T10:00:00Z", status: "READY_FOR_PROCESSING",
    sumaGrosze: 5000, waluta: "PLN", przesylka: "w drodze do klienta", link: "https://allegro.pl/z-1",
    pozycje: [{ nazwa: "Nóż kosiarki HECHT 1803S", ilosc: 1, cenaGrosze: 5000 }] }],
  maszyny: [], os: [], notatka: { tresc: "Prosi o fakturę", at: "2026-09-20T10:00:00Z", przez: "Ola", cofalna: true },
  sprawa: null, podpowiedzZakonczenia: false,
};

/* Sprawę prowadzi Bartek (id 2); zalogowana jest Ola (id 1), chyba że test
   powie inaczej — tak widać „Przejmij". */
const SPRAWA: SprawaKlienta = {
  id: 5, login: "Chrzanowski1234", wersja: 3, stan: "w_toku",
  krok: "czekamy na zwrot", krokDo: "2026-09-25T06:00:00Z", dzis: false, poTerminie: true,
  prowadzi: "Bartek", prowadziId: 2, zakonczonoAt: null, zakonczyl: null,
  nowe: [{ rodzaj: "zwrot_dotarl", tekst: "Zwrot dotarł", at: null, cel: "/obsluga/zwroty/11" }],
  odcisk: "{\"m\":null,\"z\":1,\"d\":1}",
};

/* Sprawa po cudzym ruchu i nowej wiadomości — inna wersja i inny odcisk niż
   na ekranie. Tak przychodzi w 409 i w odświeżonym profilu po nim. */
const SWIEZA: SprawaKlienta = {
  ...SPRAWA, wersja: 7, odcisk: "{\"m\":\"2026-09-26T12:00:00Z\",\"z\":1,\"d\":1}",
  nowe: [{ rodzaj: "rozmowa", tekst: "Klient napisał 26.09 14:00", at: null, cel: "/obsluga/skrzynka/41" }],
};

let zadania: Array<{ metoda: string; url: string; body: string | null }> = [];
let odpowiedz404 = false;
let konflikt = false;
let profil: Profil = PROFIL;
/* Profile po loginie — dla przejścia między dwoma klientami. */
let profile: Record<string, Profil> = {};
/* Wstrzymuje odczyt profilu: tak widać, co karta robi, zanim świeży dojdzie. */
let wstrzymanie: Promise<void> | null = null;
let jaId = 1;
beforeEach(() => {
  zadania = []; odpowiedz404 = false; konflikt = false; profil = PROFIL; profile = {}; wstrzymanie = null; jaId = 1;
  localStorage.setItem("wertis-panel-token", "t");
  /* Atrapa ROZDZIELA po adresie: karta sprawy pyta o zalogowanego
     (`/api/auth/me`), a zapisy sprawy oddają `{ sprawa }` z nową wersją
     i nowym odciskiem — i tę sprawę oddaje potem odświeżony profil, jak
     prawdziwy serwer. Konflikt oddaje SWIEZA raz, a profil przejmuje ją. */
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    zadania.push({ metoda, url, body: (init?.body as string) ?? null });
    if (odpowiedz404) return new Response(JSON.stringify({ error: "Nie znamy klienta o takim loginie" }), { status: 404 });
    if (url === "/api/auth/me") {
      return new Response(JSON.stringify({ user: { userId: jaId, name: jaId === 1 ? "Ola" : "Bartek", role: "biuro" } }));
    }
    const sprawa = /\/sprawa\/(krok|zakoncz|wznow|przejmij)$/.exec(url)?.[1];
    if (sprawa && konflikt) {
      konflikt = false;
      profil = { ...profil, sprawa: SWIEZA };
      return new Response(JSON.stringify({ error: "Klient dopisał coś po otwarciu ekranu", sprawa: SWIEZA }),
        { status: 409 });
    }
    if (sprawa) {
      const cialo = JSON.parse((init?.body as string) ?? "{}") as { wersja: number };
      const po: SprawaKlienta = { ...(profil.sprawa ?? SPRAWA), wersja: cialo.wersja + 1,
        odcisk: `odcisk-${cialo.wersja + 1}`, nowe: [], stan: sprawa === "zakoncz" ? "zakonczona" : "w_toku",
        ...(sprawa === "przejmij" ? { prowadzi: "Ola", prowadziId: 1 } : {}) };
      profil = { ...profil, sprawa: po };
      return new Response(JSON.stringify({ sprawa: po }));
    }
    if (metoda !== "GET") return new Response(JSON.stringify({ ok: true }));
    if (wstrzymanie) await wstrzymanie;
    const login = /\/api\/obsluga\/klient\/([^/?]+)$/.exec(url)?.[1]?.toLowerCase() ?? "";
    return new Response(JSON.stringify(profile[login] ?? profil));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

/* Przyciski przejścia poza trasą — jak pasek przeglądarki: do klienta A i wstecz. */
function Nawigacja() {
  const idz = useNavigate();
  return <>
    <button type="button" onClick={() => idz("/obsluga/klient/chrzanowski1234")}>do A</button>
    <button type="button" onClick={() => idz(-1)}>wstecz</button>
  </>;
}

function pokaz(login = "chrzanowski1234") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/obsluga/klient/${login}`]}>
    <Nawigacja />
    <Routes><Route path="/obsluga/klient/:login" element={<ProfilKlienta />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}

const zapisy = () => zadania.filter((z) => z.metoda !== "GET");
const odczytyProfilu = () => zadania.filter((z) => z.metoda === "GET" && z.url === "/api/obsluga/klient/chrzanowski1234");
const karta = () => screen.getByRole("region", { name: "Sprawa klienta" });
/** Dzień kalendarza `n` dni po `od`, w strefie przeglądarki — tak liczy formularz. */
const dzienPo = (od: Date, n: number) => { const d = new Date(od); d.setDate(d.getDate() + n); return dataLokalna(d.toISOString()); };

describe("PROFIL KLIENTA", () => {
  it("otwarcie niczego nie zapisuje i pokazuje całego klienta", async () => {
    pokaz();
    expect(await screen.findByText("Chrzanowski1234")).toBeTruthy();
    expect(zadania.every((z) => z.metoda === "GET")).toBe(true);
    expect(zadania[0].url).toBe("/api/obsluga/klient/chrzanowski1234");
    expect(screen.getByRole("link", { name: /Otwarta reklamacja/ })).toHaveAttribute("href", "/obsluga/reklamacje/3");
    /* „Otwarte w kolejkach", nie „Otwarte sprawy" (@wydanie): słowo „sprawa"
       znaczy na tym ekranie już tylko sprawę klienta. */
    expect(within(screen.getByRole("region", { name: "Otwarte w kolejkach" })).getByText("czeka na nas")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Otwarte sprawy" })).toBeNull();
  });

  it("zamówienie rozwija się do pozycji i linku do Allegro", async () => {
    pokaz();
    const z = await screen.findByRole("button", { name: /Nóż kosiarki HECHT 1803S/ });
    await userEvent.click(z);
    expect(screen.getByText("1×")).toBeTruthy();
    expect(screen.getByRole("link", { name: /zamówienie z-1 w Allegro/ })).toBeTruthy();
  });

  it("notatka zapisuje się na kliknięcie, a cofnięcie idzie bez ciała", async () => {
    pokaz();
    const pole = await screen.findByLabelText("Notatka o kliencie", { selector: "textarea" });
    expect(screen.getByRole("button", { name: "ZAPISZ" })).toBeDisabled();
    await userEvent.clear(pole);
    await userEvent.type(pole, "Prosi o fakturę na firmę");
    await userEvent.click(screen.getByRole("button", { name: "ZAPISZ" }));
    const zapis = zadania.find((z) => z.metoda === "POST" && z.url.endsWith("/notatka"));
    expect(JSON.parse(zapis!.body!)).toEqual({ tresc: "Prosi o fakturę na firmę" });
    await userEvent.click(screen.getByRole("button", { name: "Cofnij" }));
    const cofniecie = zadania.find((z) => z.url.endsWith("/notatka/cofnij"));
    expect(cofniecie?.body).toBeNull();
  });

  it("nieznany login mówi to zdaniem", async () => {
    odpowiedz404 = true;
    pokaz("nikt");
    expect(await screen.findByText(/Nie znamy klienta/)).toBeTruthy();
  });
});

describe("SPRAWA KLIENTA na profilu", () => {
  it("otwarcie z prowadzoną sprawą dalej wysyła same GET-y", async () => {
    profil = { ...PROFIL, sprawa: SPRAWA };
    pokaz();
    /* „Przejmij" zależy od `/api/auth/me` — czekamy na nie, żeby policzyć
       żądania PO ostatnim odczycie, który otwarcie wywołuje. */
    expect(await screen.findByRole("button", { name: "Przejmij" })).toBeInTheDocument();
    expect(zadania.map((z) => z.url)).toContain("/api/auth/me");
    expect(zapisy()).toEqual([]);
  });

  it("bez sprawy karta jest jedną linijką, a formularz rozwija się dopiero na kliknięcie", async () => {
    pokaz();
    expect(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByText("Brak sprawy klienta")).toBeInTheDocument();
    expect(screen.queryByLabelText("Następny krok", { selector: "input" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zakończ sprawę" })).toBeNull();

    await userEvent.click(within(karta()).getByRole("button", { name: "Ustaw krok" }));
    const pole = screen.getByLabelText("Następny krok", { selector: "input" });
    expect(pole).toHaveFocus();
    expect(pole).toHaveAttribute("maxLength", "200");
  });

  it("podpowiedź wypełnia pole, a gotowy termin ZAPISUJE krok jednym kliknięciem", async () => {
    pokaz();
    await userEvent.click(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByRole("button", { name: "Ustaw krok" }));
    /* Pusty krok nie ma czego zapisać — gotowe terminy czekają na tekst. */
    const jutro = screen.getByRole("button", { name: /następny dzień roboczy/ });
    expect(jutro).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "dosłać" }));
    expect(screen.getByLabelText("Następny krok", { selector: "input" })).toHaveValue("dosłać");
    expect(zapisy()).toEqual([]);

    await userEvent.click(jutro);
    await waitFor(() => expect(zapisy()).toHaveLength(1));
    const [zapis] = zapisy();
    expect(zapis.metoda).toBe("POST");
    expect(zapis.url).toBe("/api/obsluga/klient/Chrzanowski1234/sprawa/krok");
    const cialo = JSON.parse(zapis.body!);
    /* `wersja: 0` — wiersza jeszcze nie ma; odcisk jedzie zawsze, bo trasa
       wymaga każdego klucza (blizna 0.224.1). */
    expect(cialo).toEqual({ krok: "dosłać", krokDo: expect.any(String), wersja: 0, odcisk: "" });
    expect(Date.parse(cialo.krokDo)).toBeGreaterThan(Date.now());
    expect(new Date(cialo.krokDo).getHours()).toBe(8);
  });

  it("kalendarz zapisuje dopiero dzień z dozwolonego okna", async () => {
    pokaz();
    await userEvent.click(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByRole("button", { name: "Ustaw krok" }));
    await userEvent.type(screen.getByLabelText("Następny krok", { selector: "input" }), "czekamy na dostawcę");
    const zapisz = screen.getByRole("button", { name: "Zapisz krok" });
    const kalendarz = screen.getByLabelText("Termin kroku");
    expect(zapisz).toBeDisabled();

    /* Dziewięćdziesiąt dni to już nie krok — serwer i tak by odmówił. */
    const zaDaleko = new Date(); zaDaleko.setDate(zaDaleko.getDate() + 90);
    fireEvent.change(kalendarz, { target: { value: dataLokalna(zaDaleko.toISOString()) } });
    expect(zapisz).toBeDisabled();

    const zaDziesiec = new Date(); zaDziesiec.setDate(zaDziesiec.getDate() + 10);
    const dzien = dataLokalna(zaDziesiec.toISOString());
    fireEvent.change(kalendarz, { target: { value: dzien } });
    await userEvent.click(zapisz);
    await waitFor(() => expect(zapisy()).toHaveLength(1));
    const cialo = JSON.parse(zapisy()[0].body!);
    expect(cialo.krok).toBe("czekamy na dostawcę");
    expect(dataLokalna(cialo.krokDo)).toBe(dzien);
  });

  it("sprawa w toku mówi krok, termin, kto prowadzi i co klient dopisał", async () => {
    profil = { ...PROFIL, sprawa: SPRAWA, podpowiedzZakonczenia: true };
    pokaz();
    const k = await screen.findByRole("region", { name: "Sprawa klienta" });
    expect(within(k).getByText("czekamy na zwrot")).toBeInTheDocument();
    expect(within(k).getByText("po terminie")).toBeInTheDocument();
    expect(within(k).getByText(/prowadzi Bartek/)).toBeInTheDocument();
    expect(within(k).getByRole("link", { name: "Zwrot dotarł" })).toHaveAttribute("href", "/obsluga/zwroty/11");
    expect(within(k).getByText(/Nic nie czeka w kolejkach, a termin kroku „czekamy na zwrot” minął/))
      .toBeInTheDocument();
    /* Formularz zwinięty; „Zmień krok" rozwija go z bieżącym krokiem. */
    expect(screen.queryByLabelText("Następny krok", { selector: "input" })).toBeNull();
    await userEvent.click(within(k).getByRole("button", { name: "Zmień krok" }));
    expect(screen.getByLabelText("Następny krok", { selector: "input" })).toHaveValue("czekamy na zwrot");
  });

  it("„Zakończ sprawę” niesie wersję i odcisk, a „Cofnij” — wersję z odpowiedzi", async () => {
    profil = { ...PROFIL, sprawa: SPRAWA };
    pokaz();
    await userEvent.click(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByRole("button", { name: "Zakończ sprawę" }));
    await waitFor(() => expect(zapisy()).toHaveLength(1));
    expect(zapisy()[0].url).toBe("/api/obsluga/klient/Chrzanowski1234/sprawa/zakoncz");
    expect(JSON.parse(zapisy()[0].body!)).toEqual({ wersja: 3, odcisk: SPRAWA.odcisk });

    /* Pasek „Cofnij" — ten sam co w skrzynce; notatka ma swoje „Cofnij",
       więc szukamy w pasku, nie na całym ekranie. */
    const pasek = await screen.findByRole("status");
    expect(within(pasek).getByText("Sprawa zakończona")).toBeInTheDocument();
    await userEvent.click(within(pasek).getByRole("button", { name: "Cofnij" }));
    await waitFor(() => expect(zapisy()).toHaveLength(2));
    expect(zapisy()[1].url).toBe("/api/obsluga/klient/Chrzanowski1234/sprawa/wznow");
    /* Odcisk też z odpowiedzi: wiadomość z tych ośmiu sekund da 409. */
    expect(JSON.parse(zapisy()[1].body!)).toEqual({ wersja: 4, odcisk: "odcisk-4" });
  });

  it("„Przejmij” przejmuje cudzą sprawę z jej wersją", async () => {
    profil = { ...PROFIL, sprawa: SPRAWA };
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: "Przejmij" }));
    await waitFor(() => expect(zapisy()).toHaveLength(1));
    expect(zapisy()[0].url).toBe("/api/obsluga/klient/Chrzanowski1234/sprawa/przejmij");
    expect(JSON.parse(zapisy()[0].body!)).toEqual({ wersja: 3, odcisk: SPRAWA.odcisk });
  });

  it("po zapisie przyciski czekają na świeży profil — drugi klik nie idzie ze starą wersją", async () => {
    profil = { ...PROFIL, sprawa: SPRAWA };
    pokaz();
    const przejmij = await screen.findByRole("button", { name: "Przejmij" });
    let pusc = () => {};
    wstrzymanie = new Promise<void>((r) => { pusc = r; });
    await userEvent.click(przejmij);
    await waitFor(() => expect(odczytyProfilu()).toHaveLength(2));
    /* Zapis przeszedł, profil jeszcze nie doszedł: karta rysuje starą sprawę,
       więc jej przyciski nie mają prawa być czynne. */
    expect(przejmij).toBeDisabled();
    expect(within(karta()).getByRole("button", { name: "Zakończ sprawę" })).toBeDisabled();
    pusc();
    await waitFor(() => expect(within(karta()).queryByRole("button", { name: "Przejmij" })).toBeNull());
    expect(within(karta()).getByText(/prowadzisz/)).toBeInTheDocument();
    expect(zapisy()).toHaveLength(1);
  });

  it("własnej sprawy nie da się przejąć — karta mówi „prowadzisz”", async () => {
    jaId = 2;
    profil = { ...PROFIL, sprawa: SPRAWA };
    pokaz();
    const k = await screen.findByRole("region", { name: "Sprawa klienta" });
    expect(await within(k).findByText(/prowadzisz/)).toBeInTheDocument();
    expect(within(k).queryByRole("button", { name: "Przejmij" })).toBeNull();
  });

  it("konflikt świeżości mówi, co się stało, zostawia krok, a ponowna próba niesie świeżą sprawę", async () => {
    profil = { ...PROFIL, sprawa: SPRAWA };
    konflikt = true;
    pokaz();
    await userEvent.click(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByRole("button", { name: "Zmień krok" }));
    const pole = screen.getByLabelText("Następny krok", { selector: "input" });
    await userEvent.clear(pole);
    await userEvent.type(pole, "dosłać sprężynę");
    await userEvent.click(screen.getByRole("button", { name: /następny dzień roboczy/ }));
    expect(await screen.findByText("Klient dopisał coś po otwarciu ekranu")).toBeInTheDocument();
    /* Zdanie staje DOPIERO po świeżym profilu: agent widzi, co klient dopisał,
       zanim spróbuje znowu. */
    expect(odczytyProfilu()).toHaveLength(2);
    expect(within(karta()).getByRole("link", { name: "Klient napisał 26.09 14:00" })).toBeInTheDocument();
    expect(screen.getByLabelText("Następny krok", { selector: "input" })).toHaveValue("dosłać sprężynę");

    await userEvent.click(screen.getByRole("button", { name: /następny dzień roboczy/ }));
    await waitFor(() => expect(zapisy()).toHaveLength(2));
    expect(JSON.parse(zapisy()[1].body!)).toMatchObject(
      { krok: "dosłać sprężynę", wersja: SWIEZA.wersja, odcisk: SWIEZA.odcisk });
  });

  it("zakończona sprawa pozwala ustawić krok od nowa, z ostatnim krokiem w polu", async () => {
    profil = { ...PROFIL, sprawa: { ...SPRAWA, stan: "zakonczona", poTerminie: false, nowe: [],
      zakonczonoAt: "2026-09-24T12:00:00Z", zakonczyl: "Bartek" } };
    pokaz();
    const k = await screen.findByRole("region", { name: "Sprawa klienta" });
    expect(within(k).getByText(/Sprawa zakończona/)).toBeInTheDocument();
    expect(within(k).queryByRole("button", { name: "Zakończ sprawę" })).toBeNull();
    expect(within(k).queryByRole("button", { name: "Przejmij" })).toBeNull();
    await userEvent.click(within(k).getByRole("button", { name: "Ustaw krok" }));
    expect(screen.getByLabelText("Następny krok", { selector: "input" })).toHaveValue("czekamy na zwrot");
  });

  it("obudzoną zakończoną kończy się znów jednym kliknięciem, bez paska „Cofnij”", async () => {
    /* SPRAWA niesie „Zwrot dotarł" — zakończona sprawa jest obudzona. */
    profil = { ...PROFIL, sprawa: { ...SPRAWA, stan: "zakonczona", poTerminie: false,
      zakonczonoAt: "2026-09-24T12:00:00Z", zakonczyl: "Bartek" } };
    pokaz();
    const k = await screen.findByRole("region", { name: "Sprawa klienta" });
    expect(within(k).getByRole("button", { name: "Ustaw krok" })).toBeInTheDocument();
    await userEvent.click(within(k).getByRole("button", { name: "Zakończ sprawę" }));
    await waitFor(() => expect(zapisy()).toHaveLength(1));
    expect(zapisy()[0].url).toBe("/api/obsluga/klient/Chrzanowski1234/sprawa/zakoncz");
    expect(JSON.parse(zapisy()[0].body!)).toEqual({ wersja: 3, odcisk: SPRAWA.odcisk });
    await waitFor(() => expect(within(k).queryByRole("button", { name: "Zakończ sprawę" })).toBeNull());
    /* Cofnięcie otworzyłoby sprawę z krokiem po terminie — paska nie ma. */
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("nowy krok zdejmuje pasek „Cofnij” — jego wersja jest już stara", async () => {
    profil = { ...PROFIL, sprawa: SPRAWA };
    pokaz();
    await userEvent.click(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByRole("button", { name: "Zakończ sprawę" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    await userEvent.click(await within(karta()).findByRole("button", { name: "Ustaw krok" }));
    await userEvent.click(screen.getByRole("button", { name: /następny dzień roboczy/ }));
    await waitFor(() => expect(zapisy()).toHaveLength(2));
    expect(zapisy()[1].url).toMatch(/\/sprawa\/krok$/);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("przejście na innego klienta nie przenosi stanu karty: ani formularza, ani paska „Cofnij”", async () => {
    const B: Profil = { ...PROFIL, login: "Kowalski_B",
      sprawa: { ...SPRAWA, id: 9, login: "Kowalski_B", stan: "zakonczona", nowe: [], poTerminie: false,
        zakonczonoAt: "2026-09-24T12:00:00Z", zakonczyl: "Bartek" } };
    profile = { kowalski_b: B, chrzanowski1234: { ...PROFIL, sprawa: { ...SPRAWA, wersja: 2 } } };
    pokaz("kowalski_b");
    expect(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByText(/Sprawa zakończona/)).toBeInTheDocument();

    /* Formularz otwarty u A nie otwiera się u B z krokiem A w polu. */
    await userEvent.click(screen.getByRole("button", { name: "do A" }));
    await userEvent.click(await within(karta()).findByRole("button", { name: "Zmień krok" }));
    await userEvent.clear(screen.getByLabelText("Następny krok", { selector: "input" }));
    await userEvent.type(screen.getByLabelText("Następny krok", { selector: "input" }), "krok A");
    await userEvent.click(screen.getByRole("button", { name: "wstecz" }));
    expect(await within(karta()).findByText(/Sprawa zakończona/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Następny krok", { selector: "input" })).toBeNull();

    /* Pasek „Cofnij" zakończenia A nie zostaje nad profilem B. */
    await userEvent.click(screen.getByRole("button", { name: "do A" }));
    await userEvent.click(await within(karta()).findByRole("button", { name: "Zakończ sprawę" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "wstecz" }));
    expect(await within(karta()).findByText(/Sprawa zakończona/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(zapisy().map((z) => z.url)).toEqual(["/api/obsluga/klient/Chrzanowski1234/sprawa/zakoncz"]);
  });

  it("gotowe terminy stoją w grupie „Zapisz z terminem”, a fokus wraca na przycisk karty", async () => {
    profil = { ...PROFIL, sprawa: SPRAWA };
    pokaz();
    await userEvent.click(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByRole("button", { name: "Zmień krok" }));
    /* Nazwa grupy mówi czytnikowi ekranu, że te przyciski ZAPISUJĄ. */
    const grupa = screen.getByRole("group", { name: "Zapisz z terminem:" });
    expect(within(grupa).getByRole("button", { name: /następny dzień roboczy/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Podpowiedzi kroku" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(within(karta()).getByRole("button", { name: "Zmień krok" })).toHaveFocus();

    await userEvent.click(within(karta()).getByRole("button", { name: "Zmień krok" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Zapisz z terminem:" }))
      .getByRole("button", { name: /następny dzień roboczy/ }));
    await waitFor(() => expect(within(karta()).getByRole("button", { name: "Zmień krok" })).toHaveFocus());
  });
});

/* ── Granice kalendarza kroku ──────────────────────────────────────────────
   Serwer odrzuca termin dalszy niż sześćdziesiąt dni od TERAZ, co do
   milisekundy, a kalendarz daje dzień na 8:00. Przed ósmą rano 8:00
   sześćdziesiątego dnia leży więc już za sufitem. Czas udajemy SAM Date:
   zegary React Query i userEvent zostają prawdziwe. Czerwiec, bo przez
   następne sześćdziesiąt dni żadna popularna strefa nie zmienia czasu. */
describe("granice kalendarza kroku", () => {
  it.each([
    { godzina: 7, ostatni: 59 },
    { godzina: 8, ostatni: 60 },
  ])("o $godzina:30 ostatnim dniem jest dzień $ostatni", async ({ godzina, ostatni }) => {
    const teraz = new Date(2026, 5, 1, godzina, 30);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(teraz);
    pokaz();
    await userEvent.click(await within(await screen.findByRole("region", { name: "Sprawa klienta" }))
      .findByRole("button", { name: "Ustaw krok" }));
    await userEvent.type(screen.getByLabelText("Następny krok", { selector: "input" }), "czekamy na dostawcę");
    const kalendarz = screen.getByLabelText("Termin kroku");
    const zapisz = screen.getByRole("button", { name: "Zapisz krok" });
    expect(kalendarz).toHaveAttribute("max", dzienPo(teraz, ostatni));

    fireEvent.change(kalendarz, { target: { value: dzienPo(teraz, 60) } });
    if (ostatni === 60) expect(zapisz).toBeEnabled(); else expect(zapisz).toBeDisabled();
    fireEvent.change(kalendarz, { target: { value: dzienPo(teraz, 59) } });
    expect(zapisz).toBeEnabled();
  });
});
