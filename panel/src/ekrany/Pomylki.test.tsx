import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Pomylki } from "./Pomylki";
import type { Pomylka } from "../api/pomylki";
import { lista, odczytPomylek, pomylka, zlapane } from "../test/pomylki";

/* Atrapa `fetch`, która trzyma ciała zapisów: test sprawdza, CO poszło na
   serwer po kliknięciu, a nie tylko, że coś poszło. Odpowiedź na zapis
   składa `zapis`, a lista po zapisie czyta stan z `biezace`. */
function atrapa(start: Pomylka[], zapis: (metoda: string, url: string, cialo: any, p: Pomylka) =>
  { status: number; cialo: unknown }) {
  const biezace = [...start];
  const wyslane: Array<{ metoda: string; url: string; cialo: any }> = [];
  const odczyt = odczytPomylek(biezace);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    if (metoda === "GET") {
      /* Serwer filtruje po stanie, więc atrapa też: inaczej nie widać, czy
         wiersz zszedł z listy po zwinięciu. */
      const stan = new URLSearchParams(url.split("?")[1] ?? "").get("stan");
      const pasuje = (p: Pomylka) => stan === "wszystkie" || (stan === "zakonczone" ? p.stan === "zakonczona" : p.stan === stan);
      const c = url.startsWith("/api/pomylki?") ? lista(biezace.filter(pasuje)) : odczyt(url);
      return new Response(JSON.stringify(c ?? { error: "nieznany" }), { status: c === undefined ? 404 : 200 });
    }
    const cialo = init?.body ? JSON.parse(String(init.body)) : undefined;
    wyslane.push({ metoda, url, cialo });
    const id = Number(url.split("/")[3]);
    const i = biezace.findIndex((p) => p.id === id);
    const o = zapis(metoda, url, cialo, biezace[i]);
    const nowa = (o.cialo as { pomylka?: Pomylka }).pomylka;
    /* 409 też niesie stan serwera, więc lista po nim czyta ten sam. */
    if (nowa && i >= 0) biezace[i] = nowa;
    return new Response(JSON.stringify(o.cialo), { status: o.status });
  }));
  return { wyslane, biezace };
}

/** Odpowiedź serwera na PATCH: pola z ciała wchodzą do pomyłki, wersja rośnie. */
const przyjmij = (_m: string, _u: string, c: any, p: Pomylka) => {
  const osoba = (id: number | null | undefined, stara: Pomylka["zbieral"]) =>
    id === undefined ? stara : id === null ? null : { userId: id, nazwa: id === 11 ? "Marek" : "Ewa" };
  const nowa: Pomylka = {
    ...p, wersja: p.wersja + 1,
    zbieral: osoba(c.zbieralUserId, p.zbieral), pakowal: osoba(c.pakowalUserId, p.pakowal),
    winaZbierajacego: c.winaZbierajacego ?? p.winaZbierajacego, winaPakujacego: c.winaPakujacego ?? p.winaPakujacego,
    coZamowil: "coZamowil" in c ? c.coZamowil : p.coZamowil, coDostal: "coDostal" in c ? c.coDostal : p.coDostal,
  };
  return { status: 200, cialo: { pomylka: nowa } };
};

const otworz = (adres = "/obsluga/pomylki") => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[adres]}>
    <Pomylki /></MemoryRouter></QueryClientProvider>);
  return qc;
};

afterEach(() => vi.unstubAllGlobals());

describe("rejestr pomyłek", () => {
  it("lista jak arkusz: klient prowadzi do profilu, fakty z kolejki mają dopisek „z Allegro”", async () => {
    atrapa([pomylka()], przyjmij);
    otworz();
    const klient = await screen.findByRole("link", { name: "jan_kowalski" });
    expect(klient).toHaveAttribute("href", "/obsluga/klient/jan_kowalski");
    const wiersz = klient.closest("tr")!;
    expect(within(wiersz).getByText("wysłany")).toBeInTheDocument();
    expect(within(wiersz).getAllByText("z Allegro")).toHaveLength(2);
    expect(within(wiersz).getByText("do uzupełnienia", { selector: "span.italic" })).toBeInTheDocument();
    /* Licznik filtra przy danych, z odpowiedzi serwera. */
    expect(screen.getByRole("button", { name: "Do uzupełnienia 1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("klik w wiersz rozwija uzupełnianie z pozycjami zamówienia jako przyciskami", async () => {
    atrapa([pomylka()], przyjmij);
    otworz();
    fireEvent.click(await screen.findByRole("link", { name: "jan_kowalski" }).then((l) => l.closest("tr")!));
    expect(await screen.findByRole("button", { name: /Lampa LED 24V/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Zbierał" })).toBeInTheDocument();
    /* Magazynierzy, bez konta biura: pomyłkę zbierała hala. */
    expect(within(screen.getByRole("group", { name: "Pakował" })).queryByText("Anna z biura")).toBeNull();
    /* Fakt z kolejki nie dostaje przełącznika. */
    expect(within(screen.getByRole("group", { name: "Nowy towar" })).queryByRole("button")).toBeNull();
    expect(within(screen.getByRole("group", { name: "Towar wrócił" })).getByRole("button", { name: "nie wraca" }))
      .toBeInTheDocument();
  });

  it("pozycja jednym kliknięciem zapisuje „co zamówił”", async () => {
    const { wyslane } = atrapa([pomylka()], przyjmij);
    otworz("/obsluga/pomylki?id=7&miesiac=2026-10");
    fireEvent.click(await screen.findByRole("button", { name: /Lampa LED 12V/ }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toEqual({ metoda: "PATCH", url: "/api/pomylki/7", cialo: { wersja: 3, coZamowil: "Lampa LED 12V" } });
  });

  it("imię: pierwszy klik wybiera, drugi robi winnym, trzeci odznacza — każdy z wersją z odpowiedzi", async () => {
    const { wyslane } = atrapa([pomylka()], przyjmij);
    otworz("/obsluga/pomylki?id=7&miesiac=2026-10");
    const zbieral = await screen.findByRole("group", { name: "Zbierał" });
    await within(zbieral).findByRole("button", { name: "Marek" });
    fireEvent.click(within(zbieral).getByRole("button", { name: "Marek" }));
    await waitFor(() => expect(within(zbieral).getByRole("button", { name: "Marek" }))
      .toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(within(zbieral).getByRole("button", { name: "Marek" }));
    await waitFor(() => expect(within(zbieral).getByRole("button", { name: /Marek.*winny/ })).toBeInTheDocument());
    fireEvent.click(within(zbieral).getByRole("button", { name: /Marek.*winny/ }));
    await waitFor(() => expect(wyslane).toHaveLength(3));
    expect(wyslane.map((w) => w.cialo)).toEqual([
      { wersja: 3, zbieralUserId: 11, winaZbierajacego: false },
      { wersja: 4, winaZbierajacego: true },
      { wersja: 5, zbieralUserId: null, winaZbierajacego: false },
    ]);
  });

  it("wiersz, który zapis wyprowadził poza filtr, zostaje do zwinięcia", async () => {
    atrapa([pomylka({ zbieral: { userId: 11, nazwa: "Marek" }, coDostal: "lampa 24V" })], (m, u, c, p) => {
      const o = przyjmij(m, u, c, p);
      return { ...o, cialo: { pomylka: { ...(o.cialo as { pomylka: Pomylka }).pomylka, stan: "w_toku" } } };
    });
    otworz();
    fireEvent.click(await screen.findByRole("button", { name: /Pomyłka z 12\.10\.2026/ }));
    fireEvent.click(await within(await screen.findByRole("group", { name: "Pakował" })).findByRole("button", { name: "Ewa" }));
    expect(await screen.findByText(/nie pasuje już do filtru „Do uzupełnienia”/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "jan_kowalski" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zwiń" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "jan_kowalski" })).toBeNull());
  });

  it("409 pokazuje krótką informację i świeży stan od serwera", async () => {
    const { wyslane } = atrapa([pomylka()], (_m, _u, _c, p) => ({ status: 409, cialo: {
      kod: "konflikt", error: "Konflikt wersji",
      pomylka: { ...p, wersja: 9, pakowal: { userId: 12, nazwa: "Ewa" } } } }));
    otworz("/obsluga/pomylki?id=7&miesiac=2026-10");
    fireEvent.click(await within(await screen.findByRole("group", { name: "Zbierał" })).findByRole("button", { name: "Marek" }));
    expect(await screen.findByText(/Ktoś zmienił tę pomyłkę w międzyczasie/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Pakował" }))
      .getByRole("button", { name: "Ewa" })).toHaveAttribute("aria-pressed", "true"));
    expect(wyslane).toHaveLength(1);
  });

  it("winny ma słowo, nie samą barwę; zestawienie osób tylko, gdy serwer je podał", async () => {
    const p = pomylka({ zbieral: { userId: 11, nazwa: "Marek" }, winaZbierajacego: true, stan: "w_toku" });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.startsWith("/api/pomylki?") ? lista([p]) : {}), { status: 200 })));
    otworz("/obsluga/pomylki");
    fireEvent.click(await screen.findByRole("button", { name: "Wszystkie" }));
    const wiersz = (await screen.findByRole("link", { name: "jan_kowalski" })).closest("tr")!;
    expect(within(wiersz).getByText("winny")).toBeInTheDocument();
    /* Bez zestawienia (rola inna niż admin) sama liczba, bez zdania o winnych. */
    const podsumowanie = screen.getByRole("region", { name: "Podsumowanie miesiąca" });
    expect(podsumowanie).toHaveTextContent("W miesiącu: 1 pomyłka");
    expect(podsumowanie).not.toHaveTextContent(/winn/);
  });

  it("paragon zakłada pomyłkę bez zamówienia trzema polami", async () => {
    const nowa = pomylka({ id: 9, login: "Pan Nowak", zamowienie: null, zwrotId: null, zrodlo: "recznie",
      nowyTowar: { wartosc: null, zKolejki: false }, odmowa: { wartosc: null, zKolejki: false, kod: null } });
    const { wyslane } = atrapa([], () => ({ status: 201, cialo: { pomylka: nowa } }));
    otworz();
    fireEvent.click(await screen.findByRole("button", { name: "Paragon" }));
    expect(screen.getByLabelText("Klient")).toHaveAccessibleDescription("Najkrótsza nazwa, po której poznasz klienta. Bez adresu i telefonu.");
    fireEvent.change(screen.getByLabelText("Klient"), { target: { value: "Pan Nowak" } });
    fireEvent.change(screen.getByLabelText("Co zamówił"), { target: { value: "Pompa" } });
    fireEvent.click(screen.getByRole("button", { name: "Załóż" }));
    await waitFor(() => expect(wyslane).toHaveLength(1));
    expect(wyslane[0]).toEqual({ metoda: "POST", url: "/api/pomylki",
      cialo: { login: "Pan Nowak", coZamowil: "Pompa", coDostal: null } });
    /* Nowa pomyłka staje rozwinięta, choć lista jej jeszcze nie zna. */
    expect(await screen.findByRole("group", { name: "Zbierał" })).toBeInTheDocument();
  });
});

/* Odczyty ekranu z podaną odpowiedzią na złapane przy pakowaniu. Status
   osobno, bo padnięta trasa ma dać błąd, a nie blok z zerami. */
function atrapaZlapanych(cialo: unknown, status = 200) {
  const odczyt = odczytPomylek([pomylka()]);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/pomylki/zlapane") return new Response(JSON.stringify(cialo), { status });
    const c = odczyt(url);
    return new Response(JSON.stringify(c ?? { error: "nieznany" }), { status: c === undefined ? 404 : 200 });
  }));
}

const ZLAPANE = { name: "Złapane przy pakowaniu" } as const;

describe("pomyłki złapane przy pakowaniu", () => {
  it("wyłączona integracja nie rysuje niczego, nawet gdy serwer podał doby", async () => {
    atrapaZlapanych(zlapane({ wlaczone: false }));
    const qc = otworz();
    await screen.findByText("jan_kowalski");
    /* Odpowiedź musi dojść i przejść przez render. Inaczej brak bloku
       znaczyłby tylko „jeszcze się wczytuje" i test przechodziłby zawsze. */
    await waitFor(() => expect(qc.getQueryState(["pomylki", "zlapane"])?.status).toBe("success"));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByRole("region", ZLAPANE)).toBeNull();
    expect(screen.queryByText(/złapan/i)).toBeNull();
  });

  it("zdanie z okresem i liczbą, obok przepuszczone z rejestru, pod nim doby — bez osób", async () => {
    atrapaZlapanych(zlapane());
    otworz();
    const blok = await screen.findByRole("region", ZLAPANE);
    expect(blok).toHaveTextContent(
      "Od 17.10 do 19.10 pakowanie złapało 5 pomyłek zbierania, zanim paczka wyszła do klienta.");
    expect(blok).toHaveTextContent(
      "W tych dniach rejestr niżej zapisał 1 pomyłkę przepuszczoną do klienta, więc pakowanie zatrzymało 5 z 6 wykrytych.");
    const doby = within(within(blok).getByRole("list", { name: "Złapane przy pakowaniu dzień po dniu" }))
      .getAllByRole("listitem");
    /* Czysta doba z Sellasist zostaje cyfrą: to dana, nie brak danych. */
    expect(doby.map((d) => d.textContent)).toEqual(["17.10: 2", "18.10: 0", "19.10: 3"]);
    expect(blok).not.toHaveTextContent(/Zbierał|Pakował|winn|Marek|Ewa/);
    /* Podsumowanie miesiąca liczy rejestr i nie wchłania złapanych. */
    expect(screen.getByRole("region", { name: "Podsumowanie miesiąca" })).toHaveTextContent("W miesiącu: 1 pomyłka");
  });

  /* Biernik, bo liczba jest dopełnieniem „złapało". Nastki biorą dopełniacz. */
  it.each([
    [[{ data: "2026-10-19", zlapanych: 1 }], "Dnia 19.10 pakowanie złapało 1 pomyłkę zbierania"],
    [[{ data: "2026-10-18", zlapanych: 20 }, { data: "2026-10-19", zlapanych: 2 }], "złapało 22 pomyłki zbierania"],
    [[{ data: "2026-10-18", zlapanych: 10 }, { data: "2026-10-19", zlapanych: 2 }], "złapało 12 pomyłek zbierania"],
  ])("odmiana liczby: %j", async (dni, zdanie) => {
    atrapaZlapanych(zlapane({ dni }));
    otworz();
    expect(await screen.findByRole("region", ZLAPANE)).toHaveTextContent(zdanie);
  });

  /* Przymiotnik zgadza się z rzeczownikiem, a proporcja „0 z 0" nie staje. */
  it.each([
    [{ doKlienta: 3 }, "zapisał 3 pomyłki przepuszczone do klienta, więc pakowanie zatrzymało 5 z 8 wykrytych."],
    [{ doKlienta: 0 }, "zapisał 0 pomyłek przepuszczonych do klienta, więc pakowanie zatrzymało 5 z 5 wykrytych."],
    [{ dni: [{ data: "2026-10-19", zlapanych: 0 }], doKlienta: 0 }, "zapisał 0 pomyłek przepuszczonych do klienta."],
  ])("przepuszczone do klienta: %j", async (n, zdanie) => {
    atrapaZlapanych(zlapane(n));
    otworz();
    const blok = await screen.findByRole("region", ZLAPANE);
    expect(blok).toHaveTextContent(zdanie);
    if (!zdanie.includes("zatrzymało")) expect(blok).not.toHaveTextContent("zatrzymało");
  });

  it("pusta lista dób mówi, że Sellasist nic nie podał — bez żadnej cyfry", async () => {
    atrapaZlapanych(zlapane({ dni: [] }));
    otworz();
    const blok = await screen.findByRole("region", ZLAPANE);
    expect(blok).toHaveTextContent("Sellasist nie podał jeszcze pełnego dnia");
    expect(blok.textContent).not.toMatch(/\d/);
    expect(within(blok).queryByRole("list")).toBeNull();
  });

  it("padnięte zapytanie pokazuje błąd zamiast bloku, nie zera", async () => {
    atrapaZlapanych({ error: "Sellasist nie odpowiada" }, 500);
    otworz();
    expect(await screen.findByText("Nie udało się wczytać pomyłek złapanych przy pakowaniu: Sellasist nie odpowiada"))
      .toBeInTheDocument();
    expect(screen.queryByRole("region", ZLAPANE)).toBeNull();
    /* Rejestr obok działa dalej: jedna padnięta trasa nie gasi ekranu. */
    expect(screen.getByRole("link", { name: "jan_kowalski" })).toBeInTheDocument();
  });
});
