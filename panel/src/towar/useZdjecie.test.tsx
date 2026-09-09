import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Zdjecie } from "./Zdjecie";
import { _wyczyscPamiecZdjec, useZdjecieZalacznika, useZdjecieZalacznikaReklamacji } from "./useZdjecie";

/* Trzy lekcje z `biuro.html`, każda kupiona tam osobno. Ten plik pilnuje, żeby
   panel obsługi nie kupił ich drugi raz. */

let odpowiedzi: Array<{ url: string; rozwiaz: (ok: boolean, status?: number, tresc?: unknown) => void }> = [];

beforeEach(() => {
  _wyczyscPamiecZdjec();
  odpowiedzi = [];
  localStorage.setItem("wertis-panel-token", "t");
  /* URL.createObjectURL nie istnieje w jsdom. */
  (URL as any).createObjectURL = (b: Blob) => `blob:${(b as any).__id ?? "x"}`;
  vi.stubGlobal("fetch", (url: string) => new Promise((resolve) => {
    odpowiedzi.push({
      url,
      /* Atrapa mówi PRAWDĘ o kodzie: `ok:false` bez statusu było do tego
         wydania „jakąś porażką", a hak od dziś rozróżnia 404 od 503. */
      rozwiaz: (ok, status = ok ? 200 : 404, tresc = {}) => resolve({
        ok, status, blob: async () => Object.assign(new Blob(), { __id: url }), json: async () => tresc,
      } as any),
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

/* ── Porażka z powodem, nie pamięć negatywu (przyrost „zdjęcia w rozmowach") ──
   Do tego wydania 503 z serwera lądowało w pamięci jako „na pewno brak" do
   końca życia karty. Załącznik w skrzynce ma dostać ZDANIE i ponowienie. */
function Zalacznik({ id }: { id: number }) {
  const { url, blad, ponow } = useZdjecieZalacznika(id);
  return <div>
    {url === undefined && <span>wczytuję</span>}
    {url && <img src={url} alt="z" />}
    {blad && <p>{blad}<button onClick={ponow}>ponów</button></p>}
    {url === null && !blad && <span>brak</span>}
  </div>;
}

describe("Załącznik wiadomości — zdanie i ponowienie", () => {
  it("503 daje zdanie z serwera i NIE zatruwa pamięci; „ponów” pyta od razu", async () => {
    render(<Zalacznik id={7} />);
    await waitFor(() => expect(odpowiedzi).toHaveLength(1));
    expect(odpowiedzi[0].url).toBe("/api/obsluga/zalaczniki/7/podglad");
    odpowiedzi[0].rozwiaz(false, 503, { error: "Konto Allegro niepołączone — połącz w STAN SYSTEMU." });
    await waitFor(() => expect(screen.getByText(/Konto Allegro niepołączone/)).toBeInTheDocument());
    expect(screen.queryByText("brak")).not.toBeInTheDocument();

    const { click } = await import("@testing-library/user-event").then((m) => m.default);
    await click(screen.getByText("ponów"));
    await waitFor(() => expect(odpowiedzi).toHaveLength(2));
    odpowiedzi[1].rozwiaz(true);
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("blob:")));
  });

  it("415 to odpowiedź „nie obraz”: brak bez zdania, zapamiętany jak 404", async () => {
    const { unmount } = render(<Zalacznik id={8} />);
    await waitFor(() => expect(odpowiedzi).toHaveLength(1));
    odpowiedzi[0].rozwiaz(false, 415, { error: "nie jest obrazem" });
    await waitFor(() => expect(screen.getByText("brak")).toBeInTheDocument());
    unmount();
    render(<Zalacznik id={8} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(odpowiedzi).toHaveLength(1);
  });

  it("401 mówi o sesji, a urwana sieć o serwerze", async () => {
    render(<Zalacznik id={9} />);
    await waitFor(() => expect(odpowiedzi).toHaveLength(1));
    odpowiedzi[0].rozwiaz(false, 401);
    await waitFor(() => expect(screen.getByText(/Sesja wygasła/)).toBeInTheDocument());
  });
});

/* ── Załącznik reklamacji — ten sam kształt, co w skrzynce (wspólny załącznik) ──
   Do tego wydania hak oddawał sam adres, więc 503 „konto niepołączone"
   wyglądało w czacie reklamacji jak 415 „to nie obraz". */
function ZalacznikReklamacji({ id }: { id: number | null }) {
  const { url, blad, ponow } = useZdjecieZalacznikaReklamacji(3, id);
  return <div>
    {url === undefined && <span>wczytuję</span>}
    {url && <img src={url} alt="z" />}
    {blad && <p>{blad}<button onClick={ponow}>ponów</button></p>}
    {url === null && !blad && <span>brak</span>}
  </div>;
}

describe("Załącznik reklamacji — zdanie i ponowienie", () => {
  it("pyta trasę reklamacji, 503 daje zdanie, „ponów” pyta drugi raz", async () => {
    render(<ZalacznikReklamacji id={9} />);
    await waitFor(() => expect(odpowiedzi).toHaveLength(1));
    expect(odpowiedzi[0].url).toBe("/api/obsluga/reklamacje/3/zalaczniki/9/podglad");
    odpowiedzi[0].rozwiaz(false, 503, { error: "Konto Allegro niepołączone — połącz w STAN SYSTEMU." });
    await waitFor(() => expect(screen.getByText(/Konto Allegro niepołączone/)).toBeInTheDocument());
    expect(screen.queryByText("brak")).not.toBeInTheDocument();
    const { click } = await import("@testing-library/user-event").then((m) => m.default);
    await click(screen.getByText("ponów"));
    await waitFor(() => expect(odpowiedzi).toHaveLength(2));
  });

  it("`null` w identyfikatorze znaczy „nie pytaj” — zero żądań", async () => {
    render(<ZalacznikReklamacji id={null} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(odpowiedzi).toHaveLength(0);
  });
});
