import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Zdjecie } from "./Zdjecie";
import { _wyczyscPamiecZdjec } from "./useZdjecie";

/* Trzy lekcje z `biuro.html`, każda kupiona tam osobno. Ten plik pilnuje, żeby
   panel obsługi nie kupił ich drugi raz. */

let odpowiedzi: Array<{ url: string; rozwiaz: (ok: boolean) => void }> = [];

beforeEach(() => {
  _wyczyscPamiecZdjec();
  odpowiedzi = [];
  localStorage.setItem("wertis-panel-token", "t");
  /* URL.createObjectURL nie istnieje w jsdom. */
  (URL as any).createObjectURL = (b: Blob) => `blob:${(b as any).__id ?? "x"}`;
  vi.stubGlobal("fetch", (url: string) => new Promise((resolve) => {
    odpowiedzi.push({
      url,
      rozwiaz: (ok) => resolve({ ok, blob: async () => Object.assign(new Blob(), { __id: url }) } as any),
    });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("Zdjęcie kartoteki", () => {
  it("pobiera obraz nagłówkiem sesji, bo trasa nie wpuszcza gołego <img>", async () => {
    render(<Zdjecie twId={7} nazwa="Sekator" />);
    await waitFor(() => expect(odpowiedzi).toHaveLength(1));
    expect(odpowiedzi[0].url).toBe("/api/products/7/zdjecie");
    odpowiedzi[0].rozwiaz(true);
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("blob:")));
  });

  it("404 to potwierdzony brak, a nie awaria ekranu", async () => {
    /* Serwer nie zapisuje takiego 404 nawet w audycie — większość kartotek
       zdjęcia nie ma i to jest normalny stan. */
    render(<Zdjecie twId={7} />);
    await waitFor(() => expect(odpowiedzi).toHaveLength(1));
    odpowiedzi[0].rozwiaz(false);
    await waitFor(() => expect(screen.getByText("bez zdjęcia")).toBeInTheDocument());
  });

  it("o brak pytamy RAZ — pamięć negatywu", async () => {
    const { unmount } = render(<Zdjecie twId={7} />);
    await waitFor(() => expect(odpowiedzi).toHaveLength(1));
    odpowiedzi[0].rozwiaz(false);
    await waitFor(() => expect(screen.getByText("bez zdjęcia")).toBeInTheDocument());
    unmount();

    render(<Zdjecie twId={7} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(odpowiedzi).toHaveLength(1);
    expect(screen.getByText("bez zdjęcia")).toBeInTheDocument();
  });

  it("ten sam towar w dwóch miejscach to jedno pobranie", async () => {
    /* Wiersz kolejki i kolumna dowodów pokazują ten sam towar naraz. */
    render(<><Zdjecie twId={7} /><Zdjecie twId={7} rozmiar={56} /></>);
    await new Promise((r) => setTimeout(r, 20));
    expect(odpowiedzi).toHaveLength(1);
  });

  it("najwyżej trzy pobrania naraz", async () => {
    /* Przy pierwszym trafieniu serwer ciągnie plik z bazy firmy. Czterdzieści
       równoległych żądań zagłodziłoby kolektory stojące przy regale. */
    render(<>{[1, 2, 3, 4, 5, 6].map((n) => <Zdjecie key={n} twId={n} />)}</>);
    await waitFor(() => expect(odpowiedzi).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(odpowiedzi).toHaveLength(3);

    odpowiedzi[0].rozwiaz(false);
    await waitFor(() => expect(odpowiedzi).toHaveLength(4), { timeout: 1000 });
  });

  it("bez kartoteki nie pyta serwera i zaprasza do wskazania towaru", async () => {
    render(<Zdjecie twId={null} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(odpowiedzi).toHaveLength(0);
    expect(screen.getByTitle(/wskaż towar/)).toBeInTheDocument();
  });

  it("kafel trzyma rozmiar także bez zdjęcia i w trakcie ładowania", async () => {
    /* Kafel, który rośnie po doładowaniu, przesuwa wiersze pod kursorem
       i operator klika nie w ten zwrot, w który celował. */
    const { container } = render(<Zdjecie twId={7} rozmiar={44} />);
    const wTrakcie = container.firstElementChild as HTMLElement;
    expect(wTrakcie.style.width).toBe("44px");
    expect(wTrakcie.style.height).toBe("44px");

    await waitFor(() => expect(odpowiedzi).toHaveLength(1));
    odpowiedzi[0].rozwiaz(false);
    await waitFor(() => expect(screen.getByText("bez zdjęcia")).toBeInTheDocument());
    expect((container.firstElementChild as HTMLElement).style.width).toBe("44px");
  });
});
