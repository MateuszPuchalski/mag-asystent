import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Dobor as DoborTyp, KandydaciDoboru } from "../api/typy";
import { atrapaZapisow } from "../test/zapisy";

/* ── Dobór od zera (`docs/dobor-od-zera.md` §6) ──────────────────────────────
   Testy patrzą na `fetch`, nie na haki: zapis wołany z pominięciem haka
   przeszedłby obok atrapy haka, a obok atrapy sieci nie przejdzie. Pilnują
   czterech odpowiedzi (część, nie mamy, dopytać, nie dotyczy), trzech grup
   kandydatów, wyścigu wersji i zera zapisów przy samym otwarciu.            */

/* Zdjęcia kartotek idą `fetch`em po blob; tu nie są przedmiotem testu. */
vi.mock("../towar/useZdjecie", () => ({ useZdjecie: () => null }));
/* Wyszukiwarka ma własne testy; tu liczy się tylko, co dobór zrobi z wyborem. */
vi.mock("../wyszukiwarka", () => ({
  Wyszukiwarka: ({ onWybierz }: { onWybierz: (t: unknown) => void }) =>
    <button type="button" onClick={() => onWybierz({ id: 77, sym: "GX-77", name: "Gaźnik", locs: [] })}>
      towar z wyszukiwarki</button>,
}));

const { Dobor } = await import("./Dobor");

const PUSTE_DANE = { marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null,
  oem: null, nazwaCzesci: null };
const dobor = (n: Partial<DoborTyp> = {}): DoborTyp => ({
  stan: "otwarty", wynik: null, wersja: 4, wybrany: null, dopytac: null,
  zmienil: "automat (szkic)", zmienilAutomat: true, zmienionoAt: "2026-09-29T08:00:00Z",
  dane: { ...PUSTE_DANE, marka: "NAC", model: "LS 46-450", wariant: "HS", rocznik: "2019", silnik: "B&S 450E",
    oem: "532 19 93-77", nazwaCzesci: "szarpak rozrusznika" },
  ...n,
});

const kandydat = (n: Partial<KandydaciDoboru["kandydaci"][number]>) => ({
  twId: 1, symbol: "S1", nazwa: "Część", stan: 1, grupa: "numer" as const, pewnosc: "prawdopodobne" as const,
  powod: "trafienie po numerze", takze: [], ostrzezenia: [], ...n,
});

const LISTA: KandydaciDoboru = {
  kandydaci: [
    kandydat({ twId: 14, symbol: "532199377", nazwa: "Szarpak rozrusznika NAC", stan: 28,
      powod: "trafienie po numerze z opisu kartoteki", takze: ["zastosowanie do NAC LS 46-450"] }),
    kandydat({ twId: 15, symbol: "WK-3", nazwa: "Linka rozrusznika", stan: 3, grupa: "wiedza",
      pewnosc: "potwierdzone", powod: "zatwierdzone zastosowanie do NAC LS 46-450",
      ostrzezenia: ["maszyna bywa z kilkoma silnikami — potwierdź z tabliczki"] }),
    kandydat({ twId: 16, symbol: "SZ-9", nazwa: "Szarpak uniwersalny", stan: 0, grupa: "podobne",
      pewnosc: "do_sprawdzenia", powod: "podobna nazwa" }),
  ],
  bezKartoteki: [{ numer: "532 19 93-78", zdanie: "numer klienta bez kartoteki u nas" }],
  negatywne: [{ twId: 20, symbol: "SZ-1", nazwa: "Szarpak MTD", powod: "inny rozstaw mocowania",
    zrodlo: "pomiar hali, 2.09.2026" }],
  brakuje: [],
};

type Zapis = { metoda: string; url: string; cialo: Record<string, unknown> };

/**
 * Sieć z zapisem ciał. `odpowiedz` pozwala testowi oddać 409 zamiast 200.
 * Nieznany GET trafia do `nieznane`, bo wyjątek połknęłoby zapytanie.
 */
function siec(kandydaci: KandydaciDoboru, odpowiedz: (z: Zapis) => { status: number; cialo: unknown } =
  () => ({ status: 200, cialo: dobor() })) {
  const stan = { zapisy: [] as Zapis[], odczyty: [] as string[], nieznane: [] as string[] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    if (metoda !== "GET") {
      const z = { metoda, url, cialo: JSON.parse(String(init?.body ?? "{}")) };
      stan.zapisy.push(z);
      const o = odpowiedz(z);
      return new Response(JSON.stringify(o.cialo), { status: o.status });
    }
    stan.odczyty.push(url);
    if (url.endsWith("/dobor/kandydaci")) return new Response(JSON.stringify(kandydaci), { status: 200 });
    stan.nieznane.push(url);
    return new Response("{}", { status: 404 });
  }));
  return stan;
}

const pokaz = (d: DoborTyp, uchwyty: { onWstawDoSzkicu?: (t: string) => void; onZlecPomiar?: () => void } = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Dobor dobor={d} rozmowaId={4821}
    onWstawDoSzkicu={uchwyty.onWstawDoSzkicu ?? vi.fn()} onZlecPomiar={uchwyty.onZlecPomiar ?? vi.fn()} />
  </QueryClientProvider>);
};

const zapisz = async (stan: { zapisy: Zapis[] }, ile = 1) => waitFor(() => expect(stan.zapisy).toHaveLength(ile));

afterEach(() => vi.unstubAllGlobals());

describe("dobór — zero zapisu przy patrzeniu", () => {
  it("otwarcie zakładki z listą i z wynikiem nie wysyła ani jednego zapisu", async () => {
    const stan = atrapaZapisow((url) => (url.endsWith("/dobor/kandydaci") ? LISTA : undefined));
    const { unmount } = pokaz(dobor());
    expect(await screen.findByText("Szarpak rozrusznika NAC")).toBeInTheDocument();
    unmount();
    pokaz(dobor({ stan: "czesc", wynik: "czesc",
      wybrany: { twId: 14, symbol: "532199377", podstawa: "numer", zdanieDoSzkicu: "Pasuje prawdopodobnie." } }));
    expect(screen.getByText("Pasuje prawdopodobnie.")).toBeInTheDocument();
    expect(stan.nieznane).toEqual([]);
    expect(stan.wyslane).toEqual([]);
  });
});

describe("dobór — nagłówek i dane", () => {
  it("zakładka nie powtarza stanu, który niesie streszczenie wiersza „Dobór”", async () => {
    siec(LISTA);
    pokaz(dobor());
    await screen.findByText("Szarpak rozrusznika NAC");
    expect(screen.queryByText("Otwarty")).toBeNull();
  });

  it("„Czego szuka klient” mówi maszynę i część dwoma wierszami", async () => {
    siec(LISTA);
    pokaz(dobor({ dane: { ...dobor().dane, nrSeryjny: "1234" } }));
    const sekcja = screen.getByRole("region", { name: "Czego szuka klient" });
    expect(within(sekcja).getByText("Maszyna").nextSibling)
      .toHaveTextContent("NAC LS 46-450 HS (2019) · silnik B&S 450E · nr seryjny 1234");
    expect(within(sekcja).getByText("Część").nextSibling).toHaveTextContent("szarpak rozrusznika · nr 532 19 93-77");
    await screen.findByText("Szarpak rozrusznika NAC");
  });

  it("„Popraw” otwiera osiem pól i zapisuje je z wersją", async () => {
    const stan = siec(LISTA);
    pokaz(dobor());
    await userEvent.click(screen.getByRole("button", { name: "Popraw" }));
    for (const pole of ["Marka", "Model", "Wariant", "Rocznik", "Nr seryjny", "Silnik", "Numer części", "Nazwa części"]) {
      expect(screen.getByLabelText(pole)).toBeInTheDocument();
    }
    await userEvent.clear(screen.getByLabelText("Silnik"));
    await userEvent.type(screen.getByLabelText("Silnik"), "B&S 500E");
    await userEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await zapisz(stan);
    expect(stan.zapisy[0]).toEqual({ metoda: "PUT", url: "/api/obsluga/rozmowy/4821/dobor/dane", cialo: {
      dane: { ...dobor().dane, silnik: "B&S 500E" }, expectedVersion: 4 } });
  });

  it("konflikt 409 mówi, kto zmienił, i NIE kasuje wpisanego", async () => {
    const stan = siec(LISTA, () => ({ status: 409,
      cialo: { error: "Nieaktualna wersja doboru", wersja: 5, zmienil: "O. Nowak", dobor: dobor({ wersja: 5 }) } }));
    pokaz(dobor());
    await userEvent.click(screen.getByRole("button", { name: "Popraw" }));
    await userEvent.clear(screen.getByLabelText("Wariant"));
    await userEvent.type(screen.getByLabelText("Wariant"), "HS PRO");
    await userEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await zapisz(stan);
    expect(await screen.findByRole("alert")).toHaveTextContent(/O\. Nowak zmienił dobór przed Twoim zapisem/);
    expect(screen.getByLabelText("Wariant")).toHaveValue("HS PRO");
  });

  it("przy wybranej części formularz uprzedza, że zmiana maszyny ją zdejmie", async () => {
    siec(LISTA);
    pokaz(dobor({ stan: "czesc", wynik: "czesc",
      wybrany: { twId: 14, symbol: "532199377", podstawa: "numer", zdanieDoSzkicu: "…" } }));
    await userEvent.click(screen.getByRole("button", { name: "Popraw" }));
    expect(screen.queryByText(/Zmiana maszyny zdejmie/)).toBeNull();
    await userEvent.type(screen.getByLabelText("Model"), "X");
    expect(screen.getByText(/Zmiana maszyny zdejmie wybraną część 532199377/)).toBeInTheDocument();
  });
});

describe("dobór — kandydaci", () => {
  it("stoją w trzech grupach; podobne zwinięte, gdy jest coś mocniejszego", async () => {
    siec(LISTA);
    pokaz(dobor());
    const numer = await screen.findByRole("region", { name: "Wskazane przez klienta" });
    expect(within(numer).getByRole("heading", { name: "Wskazane przez klienta" })).toBeInTheDocument();
    expect(within(numer).getByText("Szarpak rozrusznika NAC")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Z bazy wiedzy" })).getByText("Linka rozrusznika"))
      .toBeInTheDocument();
    const podobne = screen.getByText("Podobne po nazwie (1)").closest("details")!;
    expect(podobne).not.toHaveAttribute("open");
    expect(within(podobne).getByText("Szarpak uniwersalny")).not.toBeVisible();
  });

  it("same podobne stoją otwarte — zwinięcie schowałoby wszystko", async () => {
    siec({ ...LISTA, kandydaci: [LISTA.kandydaci[2]], bezKartoteki: [] });
    pokaz(dobor());
    const podobne = await screen.findByRole("region", { name: "Podobne po nazwie" });
    expect(within(podobne).getByText("Szarpak uniwersalny")).toBeVisible();
    expect(document.querySelector("details")).toBeNull();
  });

  it("karta: nazwa, dostępność w barwie, symbol, pewność, powód z resztą źródeł w dymku", async () => {
    siec(LISTA);
    pokaz(dobor());
    const karta = (await screen.findByText("Szarpak rozrusznika NAC")).closest("li")!;
    expect(within(karta).getByText("dostępne 28")).toHaveClass("text-emerald-700");
    expect(within(karta).getByText("532199377")).toBeInTheDocument();
    expect(within(karta).getByText("prawdopodobne")).toBeInTheDocument();
    const powod = within(karta).getByText(/trafienie po numerze z opisu kartoteki/);
    expect(powod).toHaveTextContent("+1 źródła");
    expect(powod).toHaveAttribute("title", expect.stringContaining("zastosowanie do NAC LS 46-450"));
    const linka = screen.getByText("Linka rozrusznika").closest("li")!;
    expect(within(linka).getByText(/kilkoma silnikami/)).toBeInTheDocument();
    const zero = screen.getByText("Szarpak uniwersalny").closest("li")!;
    expect(within(zero).getByText("dostępne 0")).toHaveClass("text-ranga-zle");
  });

  it("„Wybierz” wysyła wynik `czesc` z podstawą równą grupie i wersją", async () => {
    const stan = siec(LISTA);
    pokaz(dobor());
    const linka = (await screen.findByText("Linka rozrusznika")).closest("li")!;
    await userEvent.click(within(linka).getByRole("button", { name: "Wybierz" }));
    await zapisz(stan);
    expect(stan.zapisy[0]).toEqual({ metoda: "PUT", url: "/api/obsluga/rozmowy/4821/dobor/wynik",
      cialo: { wynik: "czesc", twId: 15, podstawa: "wiedza", expectedVersion: 4 } });
  });

  it("numer bez kartoteki stoi wierszem bez „Wybierz”, negatyw w sekcji „Nie pasuje”", async () => {
    siec(LISTA);
    pokaz(dobor());
    const numer = (await screen.findByText("532 19 93-78")).closest("li")!;
    expect(numer).toHaveTextContent("numer klienta bez kartoteki u nas");
    expect(within(numer).queryByRole("button")).toBeNull();
    const nie = screen.getByRole("region", { name: "Nie pasuje" });
    expect(within(nie).getByText("inny rozstaw mocowania")).toBeInTheDocument();
    expect(within(nie).queryByRole("button", { name: "Wybierz" })).toBeNull();
  });

  it("pusta lista mówi zdaniami, czego brakuje, i prowadzi do poprawy danych", async () => {
    siec({ kandydaci: [], bezKartoteki: [], negatywne: [],
      brakuje: ["nie wiadomo, jaki silnik stoi w NAC LS 46-450", "brak numeru części"] });
    pokaz(dobor());
    expect(await screen.findByText("nie wiadomo, jaki silnik stoi w NAC LS 46-450")).toBeInTheDocument();
    expect(screen.getByText("brak numeru części")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Popraw dane" }));
    expect(screen.getByLabelText("Marka")).toHaveValue("NAC");
  });

  it("lista i formularz przechodzą WCAG 2.2 AA w strukturze", async () => {
    siec(LISTA);
    pokaz(dobor());
    await screen.findByText("Szarpak rozrusznika NAC");
    await userEvent.click(screen.getByRole("button", { name: "Popraw" }));
    await userEvent.click(screen.getByRole("button", { name: /Dopytaj o/ }));
    const wynik = await axe.run(document.body, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(wynik.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("dobór — odpowiedzi bez kandydata", () => {
  it("„Nie mamy” i „Nie dotyczy” wysyłają wynik z wersją", async () => {
    const stan = siec(LISTA);
    pokaz(dobor());
    await userEvent.click(screen.getByRole("button", { name: "Nie mamy" }));
    await zapisz(stan);
    await userEvent.click(screen.getByRole("button", { name: "Nie dotyczy" }));
    await zapisz(stan, 2);
    expect(stan.zapisy.map((z) => z.cialo)).toEqual([
      { wynik: "brak", expectedVersion: 4 }, { wynik: "nie_dotyczy", expectedVersion: 4 }]);
  });

  it("„Dopytaj o…” pyta, o co, i bez tekstu nie zapisuje", async () => {
    const stan = siec(LISTA);
    pokaz(dobor());
    await userEvent.click(screen.getByRole("button", { name: /Dopytaj o/ }));
    const zapiszPytanie = screen.getByRole("button", { name: "Zapisz" });
    expect(zapiszPytanie).toBeDisabled();
    await userEvent.type(screen.getByLabelText("O co dopytać klienta"), "pełny numer seryjny");
    await userEvent.click(zapiszPytanie);
    await zapisz(stan);
    expect(stan.zapisy[0].cialo).toEqual({ wynik: "dopytac", dopytac: "pełny numer seryjny", expectedVersion: 4 });
  });

  it("wskazanie z wyszukiwarki to wynik `czesc` z podstawą `reczny`", async () => {
    const stan = siec(LISTA);
    pokaz(dobor());
    await userEvent.click(screen.getByRole("button", { name: "wskaż z wyszukiwarki" }));
    await userEvent.click(screen.getByRole("button", { name: "towar z wyszukiwarki" }));
    await zapisz(stan);
    expect(stan.zapisy[0].cialo).toEqual({ wynik: "czesc", twId: 77, podstawa: "reczny", expectedVersion: 4 });
  });

  it("konflikt przy wyniku jest nazwany zdaniem z nazwiskiem", async () => {
    siec(LISTA, () => ({ status: 409, cialo: { error: "x", wersja: 5, zmienil: "O. Nowak", dobor: dobor() } }));
    pokaz(dobor());
    await userEvent.click(screen.getByRole("button", { name: "Nie mamy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/O\. Nowak zmienił dobór/);
  });
});

describe("dobór — wynik zastępuje listę", () => {
  const zCzescia = dobor({ stan: "czesc", wynik: "czesc", zmienil: "A. Lewandowska", zmienilAutomat: false,
    wybrany: { twId: 14, symbol: "532199377", podstawa: "numer",
      zdanieDoSzkicu: "Szarpak 532199377 prawdopodobnie pasuje — numer z opisu kartoteki." } });

  it("rama z symbolem, podstawą i zdaniem serwera; lista i jej zapytanie znikają", async () => {
    const stan = siec(LISTA);
    const wstaw = vi.fn();
    const pomiar = vi.fn();
    pokaz(zCzescia, { onWstawDoSzkicu: wstaw, onZlecPomiar: pomiar });
    expect(screen.getByText("532199377")).toBeInTheDocument();
    expect(screen.getByText(/Wskazane przez klienta/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wybierz" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nie mamy" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Wstaw do odpowiedzi" }));
    expect(wstaw).toHaveBeenCalledWith("Szarpak 532199377 prawdopodobnie pasuje — numer z opisu kartoteki.");
    await userEvent.click(screen.getByRole("button", { name: "Zleć pomiar" }));
    expect(pomiar).toHaveBeenCalledWith({ id: 14, sym: "532199377", name: "532199377", locs: [] });
    expect(stan.odczyty).toEqual([]);
  });

  it("„Zmień” otwiera dobór ponownie wynikiem `null`", async () => {
    const stan = siec(LISTA);
    pokaz(zCzescia);
    await userEvent.click(screen.getByRole("button", { name: "Zmień" }));
    await zapisz(stan);
    expect(stan.zapisy[0]).toMatchObject({ url: "/api/obsluga/rozmowy/4821/dobor/wynik",
      cialo: { wynik: null, expectedVersion: 4 } });
  });

  it("„dopytać” wstawia pytanie do odpowiedzi tylko na kliknięcie", async () => {
    siec(LISTA);
    const wstaw = vi.fn();
    pokaz(dobor({ stan: "dopytac", wynik: "dopytac", dopytac: "pełny numer seryjny" }), { onWstawDoSzkicu: wstaw });
    expect(screen.getByText("pełny numer seryjny")).toBeInTheDocument();
    expect(wstaw).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Wstaw pytanie do odpowiedzi" }));
    expect(wstaw).toHaveBeenCalledWith("Proszę o pełny numer seryjny — wtedy dobiorę właściwą część.");
    expect(screen.getByRole("button", { name: "Zmień" })).toBeInTheDocument();
  });

  it("„nie mamy” i „nie dotyczy” mówią zdaniem i otwierają się ponownie", async () => {
    const stan = siec(LISTA);
    const { unmount } = pokaz(dobor({ stan: "brak", wynik: "brak" }));
    expect(screen.getByText(/Nie mamy tej części/)).toBeInTheDocument();
    unmount();
    pokaz(dobor({ stan: "nie_dotyczy", wynik: "nie_dotyczy" }));
    expect(screen.getByText(/nie jest pytaniem o dobór/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Otwórz ponownie" }));
    await zapisz(stan);
    expect(stan.zapisy[0].cialo).toEqual({ wynik: null, expectedVersion: 4 });
  });
});
