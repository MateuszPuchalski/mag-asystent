import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WpisOsi } from "../api/typy";

/* ── Załączniki na osi (0.155.0, naprawione w 0.219.1) ───────────────────────
   Sonda z żywego konta: 7 z 39 wiadomości ma załącznik, a agent go nie
   widział. W sklepie z częściami do maszyn ogrodniczych zdjęcie pękniętego
   elementu bywa całą treścią pytania.

   TESTY MOCKUJĄ OBIE DROGI DO SERWERA, bo obie są tu istotą rzeczy: sesja
   jedzie nagłówkiem `x-session`, więc ani `<img src>`, ani `<a href>` jej nie
   uniosą. Do 0.219.1 nazwa pliku była zwykłym odnośnikiem i pobranie NIGDY nie
   działało — na ekranie właściciela wyszedł surowy JSON „Brak sesji".         */

const zdjecie = vi.fn();
const pobierz = vi.fn();
vi.mock("../towar/useZdjecie", () => ({
  useZdjecieZalacznika: (id: number | null) => zdjecie(id),
}));
vi.mock("../api/klient", () => ({ pobierzPlik: (...a: unknown[]) => pobierz(...a) }));

const { Os } = await import("./Os");

const wiadomosc = (zalaczniki: WpisOsi["zalaczniki"]): WpisOsi => ({
  id: "msg-1", rodzaj: "wiadomosc", autor: "klient", odKlienta: true,
  tresc: "Załączam zdjęcie", at: "2026-09-01T10:00:00Z", ofertaId: null,
  messageId: 1, zalaczniki,
});

const os = (w: WpisOsi) => render(<Os wpisy={[w]} zrodloPomiaru={null} mozeZlecac={false}
  onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

/* Hak oddaje OBIEKT: adres, zdanie porażki i ponowienie. */
const ponow = vi.fn();
const wynikHaka = (url: string | null | undefined, blad: string | null = null) => ({ url, blad, ponow });

beforeEach(() => {
  vi.clearAllMocks();
  zdjecie.mockReturnValue(wynikHaka(null));
  pobierz.mockResolvedValue(undefined);
});

describe("Załączniki na osi rozmowy", () => {
  it("nazwa pliku pobiera przez NASZ serwer, z sesją — nie gołym odnośnikiem", async () => {
    /* Adres Allegro nie ma prawa trafić do przeglądarki: pobranie wymaga
       tokena konta firmy, a ten zostaje po stronie serwera. */
    os(wiadomosc([{ id: 7, nazwa: "szarpak.jpeg", typ: "image/jpeg",
      status: "SAFE", doPobrania: true, podglad: true }]));

    /* PRZYCISK, nie odnośnik: `<a href>` nie niesie nagłówka `x-session`. */
    expect(screen.queryByRole("link", { name: /szarpak\.jpeg/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /szarpak\.jpeg/ }));
    expect(pobierz).toHaveBeenCalledWith("/api/obsluga/zalaczniki/7", "szarpak.jpeg");
    expect(pobierz.mock.calls[0]![0]).not.toContain("allegro.pl");
  });

  it("nieudane pobranie mówi o sobie zamiast milczeć", async () => {
    pobierz.mockRejectedValue(new Error("Sesja wygasła — zaloguj się"));
    os(wiadomosc([{ id: 7, nazwa: "szarpak.jpeg", typ: "image/jpeg",
      status: "SAFE", doPobrania: true, podglad: false }]));

    await userEvent.click(screen.getByRole("button", { name: /szarpak\.jpeg/ }));
    expect(await screen.findByText(/Sesja wygasła/)).toBeTruthy();
  });

  it("załącznik niebezpieczny jest WIDOCZNY, ale nie do pobrania", () => {
    /* Ukrycie kłamałoby, że klient nic nie przysłał. Allegro uznało plik za
       niebezpieczny i nie mamy powodu wiedzieć lepiej. */
    os(wiadomosc([{ id: 8, nazwa: "faktura.exe", typ: null,
      status: "UNSAFE", doPobrania: false, podglad: false }]));

    expect(screen.getByText(/faktura\.exe/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /faktura\.exe/ })).toBeNull();
    expect(screen.getByText(/UNSAFE|niebezpieczn/i)).toBeTruthy();
  });

  it("wiadomość bez załączników wygląda jak dotąd", () => {
    const { container } = os(wiadomosc(undefined));
    expect(container.querySelectorAll("img").length).toBe(0);
  });

  /* ── Zdjęcie widać, nie trzeba klikać (0.218.0) ────────────────────────────
     Właściciel: „gdy klient wysyła zdjęcie, wyświetlaj w czacie, nie każ mi
     w nie klikać".                                                          */
  it("zdjęcie klienta rysuje się na osi z pobranego obrazu", () => {
    zdjecie.mockReturnValue(wynikHaka("blob:podglad-7"));
    os(wiadomosc([{ id: 7, nazwa: "szarpak.jpeg", typ: "image/jpeg",
      status: "SAFE", doPobrania: true, podglad: true }]));

    /* `alt` to nazwa pliku: czytnik ekranu ma powiedzieć, co tu stoi. */
    const obraz = screen.getByRole("img", { name: "szarpak.jpeg" });
    expect(obraz.getAttribute("src")).toBe("blob:podglad-7");
    expect(zdjecie).toHaveBeenCalledWith(7);
  });

  it("kliknięcie w zdjęcie powiększa je — skrzynka dostała lupę z reklamacji", async () => {
    /* Wspólna powłoka (`towar/Zalacznik.tsx`): pęknięcie na zdjęciu z telefonu
       bywa niewidoczne w 256 px, a agent nie ma po co zapisywać pliku na dysk. */
    zdjecie.mockReturnValue(wynikHaka("blob:podglad-7"));
    os(wiadomosc([{ id: 7, nazwa: "szarpak.jpeg", typ: "image/jpeg",
      status: "SAFE", doPobrania: true, podglad: true }]));
    await userEvent.click(screen.getByRole("button", { name: "Powiększ: szarpak.jpeg" }));
    expect(screen.getByRole("dialog", { name: "Zdjęcie: szarpak.jpeg" })).toBeTruthy();
  });

  it("plik, którego nie umiemy pokazać, w ogóle nie pyta o obraz", () => {
    /* `podglad` liczy SERWER. Panel nie zgaduje po typie i nie dobija trasy
       podglądu o PDF, którego ona i tak nie odda. */
    os(wiadomosc([{ id: 9, nazwa: "gwarancja.pdf", typ: "application/pdf",
      status: "SAFE", doPobrania: true, podglad: false }]));

    expect(zdjecie).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: /gwarancja\.pdf/ })).toBeTruthy();
  });
  /* ── Porażka podglądu MÓWI (przyrost „zdjęcia w rozmowach") ────────────────
     Do tego wydania nieudany podgląd rysował nic: agent widział samą nazwę
     pliku i nie miał jak zgadnąć, że zdjęcie w ogóle było spodziewane.     */
  it("w trakcie pobierania stoi ramka, żeby oś nie skakała", () => {
    zdjecie.mockReturnValue(wynikHaka(undefined));
    os(wiadomosc([{ id: 7, nazwa: "szarpak.jpeg", typ: "image/jpeg",
      status: "SAFE", doPobrania: true, podglad: true }]));
    expect(screen.getByText(/wczytuję/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("odmowa Allegro stoi pod nazwą pliku zdaniem z serwera i daje „Spróbuj ponownie”", async () => {
    zdjecie.mockReturnValue(wynikHaka(null, "Allegro nie oddało załącznika — końcówka API: 403; zapisany adres: 403."));
    os(wiadomosc([{ id: 7, nazwa: "szarpak.jpeg", typ: "image/jpeg",
      status: "SAFE", doPobrania: true, podglad: true }]));
    expect(screen.getByText(/Allegro nie oddało załącznika/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/wczytuję/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));
    expect(ponow).toHaveBeenCalledTimes(1);
    /* Nazwa z pobraniem zostaje — to inne pytanie niż podgląd. */
    expect(screen.getByRole("button", { name: /szarpak\.jpeg/ })).toBeTruthy();
  });

  it("`null` bez zdania to odpowiedź „nie obraz” — sama nazwa, bez ponowienia", () => {
    zdjecie.mockReturnValue(wynikHaka(null));
    os(wiadomosc([{ id: 7, nazwa: "usterka.jpg", typ: null,
      status: "SAFE", doPobrania: true, podglad: true }]));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/wczytuję/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Spróbuj ponownie/ })).toBeNull();
    expect(screen.getByRole("button", { name: /usterka\.jpg/ })).toBeTruthy();
  });
});
