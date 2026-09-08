import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Kubelek, Zwrot } from "../api/typy";

/* Ten plik istnieje przez usterkę znalezioną OKIEM, nie testem: przełączenie
   kubełka zmieniało listę, ale zostawiało kursor na zwrocie z poprzedniego
   kubełka. Środkowa kolumna pokazywała wtedy pytanie nowego kubełka nad
   klawiszami starego, a operator musiał dokliknąć wiersz — czyli zrobić
   dokładnie to jedno kliknięcie, którego ten ekran ma nie mieć. */

const zwrot = (id: number, kubelek: Kubelek, numer: string): Zwrot => ({
  id, externalId: `zw-${id}`, numer, orderId: `ord-${id}`,
  utworzono: "2026-08-25T09:00:00.000Z", paczkaAt: "2026-08-28T09:00:00.000Z", dostarczonoAt: null, przesylkaStatus: null,
  kubelek, sygnaly: [], terminAt: "2026-09-08T09:00:00.000Z", dniDoTerminu: 7,
  sumaPozycjiGrosze: 4999, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, zamowienie: null, werdykt: null, werdyktPowod: null, kwotaGrosze: null,
  kwotaWariant: null, korektaNumer: null, korektaZrodlo: null, rejectionCode: null, wersja: 1,
  zrodlo: "allegro", notatka: null, kupujacyLogin: null, przewoznik: null, rozmowy: [],
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  pozycje: [{ id, zrodlo: "allegro", offerId: "1", ofertaZamowienia: null, ofertaZdjecie: "nieznane" as const, nazwa: "Sekator", ilosc: 1, cenaGrosze: 4999,
    waluta: "PLN", powod: null, powodKomentarz: null, ocena: kubelek === "zwrot" ? "stan" : null,
    wKoszyku: false, iloscZwrocona: null, url: null, twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
      rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
      prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null } }],
});

const ZWROTY = [
  { ...zwrot(1, "decyzja", "ZW-1"), przewoznik: "INPOST", paczkaAt: "2026-08-28T09:00:00.000Z" },
  { ...zwrot(2, "zwrot", "ZW-2"), przewoznik: "DPD", paczkaAt: "2026-08-20T09:00:00.000Z",
    dniDoTerminu: 9 },
];

/* Bilans i stan synchronizacji są ZMIENNE, bo pasek mówi co innego przy
   działającej synchronizacji, a co innego przy stojącej. `vi.hoisted`, bo
   fabryka `vi.mock` jedzie przed resztą pliku. */
const scena = vi.hoisted(() => ({
  kartoteki: { bez: 3, wszystkie: 8, powody: { oferta_bez_sku: 2, jakis_nowy_kod: 1 } } as
    { bez: number; wszystkie: number; powody: Record<string, number> },
  stan: {} as Record<string, unknown>,
  /* Ręczna synchronizacja jedzie do Allegro, więc w teście stoi atrapa:
     inaczej kliknięcie strzelałoby `fetch`-em w nieistniejący serwer. */
  synchronizuj: { wolano: 0, blad: "" as string },
}));

vi.mock("../api/zwroty", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/zwroty")>("../api/zwroty");
  return {
    ...rzeczywisty,
    useSynchronizujZwroty: () => ({
      isPending: false,
      mutate: (_v: unknown, opcje?: { onError?: (e: Error) => void }) => {
        scena.synchronizuj.wolano++;
        if (scena.synchronizuj.blad) opcje?.onError?.(new Error(scena.synchronizuj.blad));
      },
    }),
    useZwroty: () => ({
      data: { zwroty: ZWROTY, liczniki: { decyzja: 1, ocena: 0, zwrot: 1, korekta: 0,
        zamkniety: 0, odrzucony: 0 },
        kartoteki: scena.kartoteki, stan: scena.stan },
      isLoading: false, error: null,
    }),
  };
});

const { Zwroty } = await import("./Zwroty");

const pokaz = (adres = "/obsluga/zwroty") =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[adres]}>
    <Routes>
      <Route path="/obsluga/zwroty" element={<Zwroty />} />
      <Route path="/obsluga/zwroty/:id" element={<Zwroty />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);

const szukajka = () => screen.getByPlaceholderText(/Zeskanuj etykietę/);

describe("Ekran zwrotów", () => {
  it("kubełek niesie pytanie, a nie samą etykietę", () => {
    pokaz();
    expect(screen.getByText("Przyjąć czy odrzucić?")).toBeInTheDocument();
  });

  it("przełączenie kubełka przestawia też kursor na pierwszy zwrot", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Do zwrotu/ }));
    /* Nagłówek środkowej kolumny i klawisze mają opisywać TEN SAM zwrot. */
    expect(screen.getByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
    /* Etykieta zmieniła się w 0.156.0 razem z modelem: zamiast wyboru
       wariantu jest zaznaczanie pozycji i jeden zapis. */
    expect(screen.getByRole("button", { name: /Zapisz kwotę/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Przyjmij/ })).not.toBeInTheDocument();
  });

  it("wejście z paska adresu na zwrot z innego kubełka przestawia kubełek", async () => {
    /* Adres jest źródłem prawdy: link do sprawy wklejony koledze ma pokazać
       tę sprawę, a nie pustą listę pod inną zakładką. */
    pokaz("/obsluga/zwroty/2");
    expect(await screen.findByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
    expect(screen.getAllByText("Ile oddać?").length).toBeGreaterThan(0);
  });

  it("bez wybranego zwrotu ekran prosi o wybór, zamiast pokazywać pustkę", () => {
    pokaz();
    expect(screen.getByText(/Wybierz zwrot z kolejki/)).toBeInTheDocument();
  });

  it("pasek decyzji DZIAŁA — zdanie o czytaniu zeszło razem z 0.156.0", () => {
    /* Do 0.155.0 stało tu „To wydanie tylko czyta", bo przycisk wyglądający
       na działający i niedziałający jest gorszy od jego braku. Teraz działa,
       więc to zdanie byłoby kłamstwem w drugą stronę. */
    pokaz("/obsluga/zwroty/1");
    expect(screen.queryByText(/To wydanie tylko czyta/)).toBeNull();
    expect(screen.getByRole("button", { name: /Przyjmij/ })).toBeEnabled();
  });

  it("fragment kodu zawęża kolejkę i sięga POZA wybrany kubełek", async () => {
    /* Bez przebicia kubełka operator wpisuje numer, widzi „ten kubełek jest
       pusty" i nie ma jak się dowiedzieć, że zwrot stoi gdzie indziej. */
    pokaz();
    await userEvent.type(szukajka(), "ZW-");
    /* Oba zwroty pasują, choć kursor stoi w kubełku, w którym leży jeden. */
    expect(screen.getByText(/2 pasujących zwrotów — szukam po wszystkich kubełkach/))
      .toBeInTheDocument();
  });

  it("fragment pokazuje zwrot z CUDZEGO kubełka razem z jego etykietą", async () => {
    pokaz();
    /* Kursor stoi w kubełku DO DECYZJI, a `ZW-2` leży w DO ZWROTU. */
    await userEvent.type(szukajka(), "ZW-2");
    expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    expect(screen.getAllByText("Do zwrotu").length).toBeGreaterThan(0);
  });

  it("CAŁY numer otwiera zwrot, sam fragment nigdy", async () => {
    /* Ekran sam otwiera przy jednym wyniku, więc dopasowanie przybliżone
       prowadziłoby do cudzej sprawy — cudzego klienta i cudzych pieniędzy. */
    pokaz();
    await userEvent.type(szukajka(), "ZW-");
    expect(screen.queryByRole("heading", { name: "ZW-2" })).toBeNull();
    await userEvent.type(szukajka(), "2");
    expect(await screen.findByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
  });

  it("kliknięcie w kubełek zdejmuje filtr, bo jest prośbą o TEN kubełek", async () => {
    pokaz();
    await userEvent.type(szukajka(), "ZW-2");
    await userEvent.click(screen.getByRole("button", { name: /Do decyzji/ }));
    expect(screen.queryByText(/szukam po wszystkich kubełkach/)).toBeNull();
    expect(screen.getAllByText("Przyjąć czy odrzucić?").length).toBeGreaterThan(0);
  });

  it("zakładka WSZYSTKIE pokazuje oba kubełki naraz, z plakietką przy wierszu", async () => {
    /* To zakładka do SZUKANIA, nie siódmy kubełek: kubełki zostają silnikiem
       pracy, bo rejestr mieszający jedno z drugim skasowaliśmy w 0.140.0. */
    pokaz();
    expect(screen.queryByText("ZW-2")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Wszystkie/ }));
    expect(screen.getAllByText("ZW-2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Do zwrotu").length).toBeGreaterThan(0);
    /* Pytanie nad LISTĄ milczy — nie ma czyje zadać. Od 0.214.0 nie ma go też
       w nagłówku środkowej kolumny: stało tam nad przyciskami PRZYJMIJ
       i ODRZUĆ, czyli pytało o to, na co odpowiedź była pod spodem. */
    expect(screen.queryByText("Przyjąć czy odrzucić?")).toBeNull();
  });

  it("filtr przewoźnika zna tylko firmy, które naprawdę przyjechały", () => {
    /* Allegro nie publikuje zamkniętej listy przewoźników, a sonda złapała
       `UNKNOWN`. Filtr ze słownika uczyłby klikać na próżno. */
    pokaz();
    const wybor = screen.getByLabelText("Przewoźnik");
    expect(wybor).toHaveTextContent("Każdy przewoźnik");
    expect(wybor).toHaveTextContent("INPOST");
    expect(wybor).not.toHaveTextContent("DHL");
  });

  it("przewoźnik zawęża kolejkę, a domyślnie nie zawęża niczego", async () => {
    pokaz();
    expect(screen.getAllByText("ZW-1").length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByLabelText("Przewoźnik"), "DPD");
    expect(screen.queryByText("ZW-1")).toBeNull();
  });

  it("kolejność domyślna zostaje po terminie ustawowym", async () => {
    /* Blizna 0.121.0: termin steruje kolejnością pracy. Data nadania jest
       PRZEŁĄCZNIKIEM, bo odpowiada na inne pytanie. */
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Wszystkie/ }));
    const przed = screen.getAllByRole("button").map((b) => b.textContent ?? "")
      .filter((t) => t.includes("ZW-"));
    expect(przed[0]).toContain("ZW-1");

    await userEvent.click(screen.getByLabelText(/Od daty nadania/));
    const po = screen.getAllByRole("button").map((b) => b.textContent ?? "")
      .filter((t) => t.includes("ZW-"));
    expect(po[0]).toContain("ZW-2");
  });

  it("licznik kartotek mówi ILE i DLACZEGO, a nieznanego powodu nie gubi", () => {
    /* Bez liczb nie da się powiedzieć, czy problem jest w kodzie, czy
       w danych Allegro: jedna pozycja bez SKU to sprzedawca, czterdzieści
       z tym samym powodem to usterka. Kod, którego panel nie zna, pokazuje
       się surowy — licznik, który cicho gubi część liczb, jest gorszy od
       jego braku. */
    pokaz();
    expect(screen.getByText(/Bez kartoteki: 3 z 8 pozycji w pracy/)).toBeInTheDocument();
    expect(screen.getByText(/oferta bez SKU/)).toBeInTheDocument();
    expect(screen.getByText(/jakis_nowy_kod/)).toBeInTheDocument();
  });

  it("czekanie na automat nazywa się inaczej niż czekanie na człowieka", () => {
    /* Pozycja z pewnością `sku` wiąże się sama. Gdy stoi w liczniku, to jest
       usterka, a nie praca do zrobienia — jedna liczba na oba przypadki
       kazała szukać winy nie tam, gdzie trzeba. */
    scena.kartoteki = { bez: 5, wszystkie: 9,
      powody: { do_zwiazania: 4, do_zatwierdzenia: 1 } };
    scena.stan = {};
    pokaz();
    expect(screen.getByText(/czeka na automat/)).toBeInTheDocument();
    expect(screen.getByText(/czeka na zatwierdzenie/)).toBeInTheDocument();
  });

  it("stojąca synchronizacja mówi o sobie przy pozycjach czekających na automat", () => {
    /* Wiązanie jedzie taktem synchronizacji. Gdy takt stoi, ekran ma to
       powiedzieć — inaczej operator klika „Zatwierdź" siedemset razy zamiast
       naprawić jedną rzecz. */
    scena.kartoteki = { bez: 4, wszystkie: 9, powody: { do_zwiazania: 4 } };
    scena.stan = { status: "authentication_error", kodOstatniegoBledu: 401,
      pozostaloDoPobrania: null };
    pokaz();
    expect(screen.getByText(/odmowa logowania do Allegro/)).toBeInTheDocument();
    expect(screen.getByText(/kod 401/)).toBeInTheDocument();
  });

  it("przycisk synchronizacji woła Allegro i pokazuje jego odmowę", async () => {
    /* Takt zwrotów chodzi rzadko, bo zwrot ma termin w dniach. Biuro, które
       właśnie przyjęło paczkę, wie o zwrocie wcześniej niż panel — i do
       0.231.0 nie miało jak go poprosić o pobranie.

       Odmowa Allegro jedzie na ekran CAŁYM zdaniem: mówi, co naprawić,
       a sam kod HTTP nie mówi nic. */
    scena.synchronizuj.wolano = 0;
    scena.synchronizuj.blad = "Allegro prosi o przerwę — synchronizacja czeka";
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Synchronizuj/ }));
    expect(scena.synchronizuj.wolano).toBe(1);
    expect(screen.getByText(/prosi o przerwę/)).toBeInTheDocument();
    scena.synchronizuj.blad = "";
  });

  it("działająca synchronizacja NIE dopisuje zdania o sobie", () => {
    /* Zdanie wypisywane zawsze przestaje być czytane po tygodniu. */
    scena.kartoteki = { bez: 4, wszystkie: 9, powody: { do_zwiazania: 4 } };
    scena.stan = { status: "current", kodOstatniegoBledu: null, pozostaloDoPobrania: null };
    pokaz();
    expect(screen.queryByText(/Wiązanie idzie taktem/)).not.toBeInTheDocument();
  });
});
