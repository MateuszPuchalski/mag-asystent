import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DoDecyzji } from "./DoDecyzji";
import type { PozycjaDecyzji } from "../api/decyzje";

/* ── DO DECYZJI (0.435.0) ──────────────────────────────────────────────────
   Trzy gwarancje ekranu startowego biura:

   1. ZERO ZAPISU. To ekran, na który się WCHODZI — co rano i po każdej
      przerwie. Umowa „zero zapisu przy patrzeniu" obowiązuje go bardziej
      niż każdy inny.
   2. WIERSZ PROWADZI DO ŹRÓDŁA. Ekran przeniesiony ma adres panelu, a ten,
      który jeszcze mieszka w biurze, otwiera się mostem — z tokenem, żeby
      człowiek nie logował się drugi raz.
   3. KOLEJNOŚĆ JEST SERWERA. Panel jej nie przestawia — dwie reguły
      sortowania rozjechałyby się przy pierwszej poprawce jednej z nich.
      Od @wydanie sprawy tego samego pytania stoją w jednej grupie. Grupa
      staje tam, gdzie serwer postawił jej pierwszą sprawę — to podział
      listy, nie drugie sortowanie. */

const POZYCJE: PozycjaDecyzji[] = [
  { klucz: "zapis:1", obszar: "magazyn", zrodlo: "zapisy", pytanie: "Ponowić czy anulować zapis do Subiekta?",
    co: "RP-2201 → R-07-1 · brak stanu", od: "2026-09-21T10:00:00.000Z", pilne: true, cel: { panel: "/obsluga/stan?karta=kolejka" } },
  { klucz: "dostawa:802", obszar: "magazyn", zrodlo: "dostawy", pytanie: "Reklamować u dostawcy czy zamknąć wyjątki?",
    co: "FZ 802/MAG/09/2026 · Rosa-Pol · 2 wyjątki", od: "2026-09-20T10:00:00.000Z", pilne: false,
    cel: { panel: "/obsluga/dostawy/802" } },
  { klucz: "kolejka:reklamacje", obszar: "obsluga", zrodlo: "reklamacje", pytanie: "Uznać czy odrzucić?",
    co: "3 reklamacje czekają na werdykt", od: "2026-09-19T10:00:00.000Z", pilne: false,
    cel: { panel: "/obsluga/reklamacje" } },
];

let wyslane: string[] = [];
/* Scalona lista „Moje” — domyślnie pusta; test dosyłki wkłada tu sprawę klienta. */
let moje: unknown[] = [];
/* Wzmianki — domyślnie żadnej; testy sekcji pełnych wkładają tu prośbę. */
let wzmianki: unknown[] = [];
/* Pozycje „Do decyzji” — test wiersza dosyłki podmienia je na własne. */
let pozycje: PozycjaDecyzji[] = POZYCJE;
/* Ciało i typ treści żądań zapisu — reguła klienta HTTP z `CLAUDE.md`. */
let ciala: Array<{ body: unknown; typ: string | null }> = [];
/* Krok, który założenie dosyłki zastąpiło — odpowiedź serwera trasy zwrotu. */
let zastapil: string | null = null;

beforeEach(() => {
  wyslane = [];
  moje = [];
  wzmianki = [];
  pozycje = POZYCJE;
  ciala = [];
  zastapil = null;
  localStorage.clear();
  localStorage.setItem("wertis-panel-token", "tok-biura");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") {
      wyslane.push(`${init?.method} ${url}`);
      ciala.push({ body: init?.body ?? null, typ: new Headers(init?.headers).get("content-type") });
    }
    if (url === "/api/biuro/do-decyzji") {
      return new Response(JSON.stringify({ pozycje,
        liczniki: { wszystko: pozycje.length, magazyn: 2, obsluga: 1 } }));
    }
    if (url === "/api/obsluga/zwroty/77/dosylka") {
      pozycje = POZYCJE;
      return new Response(JSON.stringify({ zalozona: true, login: "Kowalski_Jan",
        krokDo: "2026-10-01T06:00:00Z", krok: "Dosłać nowy towar (etykieta w Sellasist)", zastapil }));
    }
    if (url === "/api/obsluga/moje") return new Response(JSON.stringify({ sprawy: [], lista: moje }));
    if (url === "/api/obsluga/wzmianki") {
      return new Response(JSON.stringify({ wzmianki,
        nowe: wzmianki.filter((w) => !(w as { odhaczona: boolean }).odhaczona).length }));
    }
    if (url === "/api/obsluga/ja") {
      return new Response(JSON.stringify({ user: { userId: 1, name: "Ola Biuro", role: "biuro" } }));
    }
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={["/obsluga/"]}><DoDecyzji /></MemoryRouter>
  </QueryClientProvider>);
}

describe("DO DECYZJI", () => {
  it("otwarcie ekranu niczego nie zapisuje", async () => {
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    expect(wyslane).toEqual([]);
  });

  it("kolejność wierszy jest kolejnością serwera", async () => {
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    const decyzje = screen.getByRole("region", { name: "Do decyzji biura" });
    const pytania = within(decyzje).getAllByRole("heading", { level: 4 }).map((h) => h.querySelector("b")?.textContent);
    expect(pytania).toEqual(POZYCJE.map((p) => p.pytanie));
  });

  /* Wariant B (@wydanie): pytanie raz, sprawy pod nim. Druga sprawa pytania
     dołącza do grupy pierwszej, choć serwer postawił ją niżej — kolejność
     grup i spraw w grupie to dalej kolejność serwera. */
  it("sprawy jednego pytania stoją pod nim raz, w kolejności serwera", async () => {
    const druga: PozycjaDecyzji = { klucz: "dostawa:803", obszar: "magazyn", zrodlo: "dostawy",
      pytanie: "Reklamować u dostawcy czy zamknąć wyjątki?", co: "FZ 803/MAG/09/2026 · Hydro-Mat · 1 wyjątek",
      od: "2026-09-22T10:00:00.000Z", pilne: false, cel: { panel: "/obsluga/dostawy/803" } };
    pozycje = [...POZYCJE, druga];
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    const decyzje = screen.getByRole("region", { name: "Do decyzji biura" });
    expect(within(decyzje).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Ponowić czy anulować zapis do Subiekta?Zapis do Subiekta · 1",
      "Reklamować u dostawcy czy zamknąć wyjątki?Dostawy · 2",
      "Uznać czy odrzucić?Reklamacje · 1",
    ]);
    const grupa = within(decyzje).getByText("Dostawy · 2").closest("li") as HTMLElement;
    expect(within(grupa).getAllByRole("link").map((a) => a.getAttribute("href")))
      .toEqual(["/obsluga/dostawy/802", "/obsluga/dostawy/803"]);
    /* Pytanie nie powtarza się w wierszu — stoi raz, w nagłówku grupy. */
    expect(within(decyzje).getAllByText("Reklamować u dostawcy czy zamknąć wyjątki?")).toHaveLength(1);
    expect(wyslane).toEqual([]);
  });

  it("każdy wiersz prowadzi do ekranu panelu — zapis w błędzie wprost do karty kolejki (0.441.0)", async () => {
    /* Do 0.441.0 zapis w błędzie prowadził mostem do `/biuro`, na STAN
       SYSTEMU. Stan przeszedł do panelu, a wiersz trafia wprost do karty,
       na której rozstrzyga się jego sprawa. */
    pokaz();
    const dostawa = await screen.findByRole("link", { name: /Reklamować u dostawcy/ });
    expect(dostawa).toHaveAttribute("href", "/obsluga/dostawy/802");
    const zapis = screen.getByRole("link", { name: /Ponowić czy anulować/ });
    expect(zapis).toHaveAttribute("href", "/obsluga/stan?karta=kolejka");
    expect(screen.queryAllByRole("link").filter((a) => a.getAttribute("href") === "/biuro")).toEqual([]);
  });

  it("sito obszaru zawęża listę i niesie liczniki", async () => {
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    await userEvent.click(screen.getByRole("button", { name: /Obsługa klienta/ }));
    expect(screen.queryByText("Reklamować u dostawcy czy zamknąć wyjątki?")).toBeNull();
    expect(screen.getByText("Uznać czy odrzucić?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Magazyn 2/ })).toBeInTheDocument();
    /* Suma stoi w nagłówku sekcji (0.524.0), więc „Wszystko" nie powtarza jej
       w pigułce — jeden fakt, jedno miejsce. */
    expect(screen.getByRole("heading", { name: "Do decyzji biura · 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wszystko" })).toBeInTheDocument();
  });
});

/* ── Jedna lista „Do zrobienia" (23 września 2026) ───────────────────────────
   Wzmianki i moje sprawy stoją na tym samym ekranie co decyzje, w tej
   kolejności — i ich dojście niczego nie zapisuje. */
describe("DO ZROBIENIA — trzy sekcje na jednym ekranie", () => {
  it("wzmianki, moje sprawy i decyzje biura, w tej kolejności, bez zapisu", async () => {
    moje = [{ kolejka: "reklamacja", id: 9, opis: "Nowak: pompa cieknie", at: "2026-09-26T10:00:00Z", terminDo: null }];
    wzmianki = [{ commentId: 3, conversationId: 12, autor: "Ola", klient: "Nowak", at: "2026-09-27T08:00:00Z",
      fragment: "@Ty zerknij na zdjęcia", odhaczona: false, odhaczonaAt: null }];
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    await screen.findByText(/zerknij na zdjęcia/);
    await screen.findByText(/pompa cieknie/);
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")))
      .toEqual(["Wspomniano o mnie", "Moje sprawy", "Do decyzji biura"]);
    expect(wyslane).toEqual([]);
  });

  /* Wariant B (@wydanie): pusta sekcja nie jest kartą z nagłówkiem, tylko
     linijką nad decyzjami — 170 px na „nic" oddane liście decyzji. */
  it("puste sekcje schodzą do jednej linijki, decyzje zostają sekcją", async () => {
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    await screen.findByText(/nic nie prowadzisz/);
    expect(screen.getByText(/nikt Cię nie wzmiankował/)).toBeInTheDocument();
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Do decyzji biura"]);
    expect(wyslane).toEqual([]);
  });

  it("odhaczone wzmianki: linijka mówi „wszystko odhaczone” i otwiera historię jednym kliknięciem", async () => {
    wzmianki = [{ commentId: 3, conversationId: 12, autor: "Ola", klient: "Nowak", at: "2026-09-25T08:00:00Z",
      fragment: "@Ty pisałam o tym w środę", odhaczona: true, odhaczonaAt: "2026-09-25T09:00:00Z" }];
    pokaz();
    await screen.findByText(/wszystko odhaczone/);
    expect(screen.queryByText(/pisałam o tym w środę/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "pokaż odhaczone (1)" }));
    expect(await screen.findByText(/pisałam o tym w środę/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Wspomniano o mnie" })).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("sprawa klienta z dosyłką stoi w „Moje” i otwarcie dalej niczego nie zapisuje (0.536.0)", async () => {
    moje = [{ kolejka: "klient", id: 5, opis: "zielony: dosłać", at: "2026-09-26T10:00:00Z",
      terminDo: "2026-09-30T06:00:00Z", login: "zielony", cel: "/obsluga/klient/zielony", dzis: true,
      dosylka: "Allegro nie ma numeru dosyłki od 2 dni roboczych — wpisz go z Sellasist" }];
    pokaz();
    expect(await screen.findByText(/wpisz go z Sellasist/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Moje sprawy" })).toBeInTheDocument();
    await screen.findByText("Uznać czy odrzucić?");
    expect(wyslane).toEqual([]);
  });

  /* ── Odmowa z panelu Allegro (0.541.0) ──────────────────────────────────
     Biuro odmawia w panelu Allegro (fakt właściciela z 27 września 2026).
     Wiersz „Śledzić dosyłkę?” ma jedyny przycisk tej listy — decyzja
     właściciela z tego samego dnia. Otwarcie dalej niczego nie zapisuje. */
  const DOSYLKA: PozycjaDecyzji = { klucz: "dosylka:77", obszar: "obsluga", zrodlo: "dosylki",
    pytanie: "Śledzić dosyłkę?", co: "Kowalski_Jan: odmowa „Wysłaliśmy nowy towar” przy zamówieniu 3f2a9c1e",
    od: "2026-09-27T09:00:00Z", pilne: false, cel: { panel: "/obsluga/zwroty/77" },
    akcja: { rodzaj: "sledz_dosylke", zwrotId: 77 } };

  it("odmowa z panelu Allegro: wiersz prowadzi do zwrotu, a otwarcie niczego nie zapisuje", async () => {
    pozycje = [DOSYLKA, ...POZYCJE];
    pokaz();
    const wiersz = await screen.findByRole("link", { name: /^Śledzić dosyłkę\? — Kowalski_Jan/ });
    expect(wiersz).toHaveAttribute("href", "/obsluga/zwroty/77");
    expect(screen.getByRole("button", { name: /^Śledź dosyłkę — Kowalski_Jan/ })).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("„Śledź dosyłkę” idzie bez ciała, a wiersz schodzi po odświeżeniu listy", async () => {
    pozycje = [DOSYLKA, ...POZYCJE];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /^Śledź dosyłkę — / }));
    await vi.waitFor(() => expect(screen.queryByText("Śledzić dosyłkę?")).toBeNull());
    expect(wyslane).toEqual(["POST /api/obsluga/zwroty/77/dosylka"]);
    /* Reguła klienta HTTP: żądanie bez ciała nie deklaruje typu treści. */
    expect(ciala).toEqual([{ body: null, typ: null }]);
  });

  it("krok zastąpiony kliknięciem zostaje na ekranie, choć wiersz już zszedł", async () => {
    /* Sprawa klienta miała krok ustawiony ręką. Dziennik niesie tylko jego
       długość, więc to zdanie jest jedynym śladem, co się stało. */
    zastapil = "Oddzwonić w sprawie faktury";
    pozycje = [DOSYLKA, ...POZYCJE];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /^Śledź dosyłkę — / }));
    await vi.waitFor(() => expect(screen.queryByText("Śledzić dosyłkę?")).toBeNull());
    const zdanie = await screen.findByText(
      "Krok sprawy klienta Kowalski_Jan: „Dosłać nowy towar (etykieta w Sellasist)” zamiast „Oddzwonić w sprawie faktury”");
    expect(within(zdanie.parentElement!).getByRole("link", { name: "profil klienta" }))
      .toHaveAttribute("href", "/obsluga/klient/Kowalski_Jan");
  });

  it("bez tytułu nad sekcjami; trzy nagłówki mają jeden kształt licznika (0.524.0)", async () => {
    /* Tytuł „Do zrobienia" powtarzał podświetloną zakładkę. Liczniki miały
       trzy zapisy; teraz każdy stoi po kropce w nagłówku sekcji. Sekcje
       pełne — puste schodzą do linijki (@wydanie). */
    moje = [{ kolejka: "reklamacja", id: 9, opis: "Nowak: pompa cieknie", at: "2026-09-26T10:00:00Z", terminDo: null }];
    wzmianki = [{ commentId: 3, conversationId: 12, autor: "Ola", klient: "Nowak", at: "2026-09-27T08:00:00Z",
      fragment: "@Ty zerknij", odhaczona: false, odhaczonaAt: null }];
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    await screen.findByText(/pompa cieknie/);
    await screen.findByText(/zerknij/);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText(/najpilniejsze pierwsze/)).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent))
      .toEqual(["Wspomniano o mnie · 1", "Moje sprawy · 1", "Do decyzji biura · 3"]);
  });
});
