import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WiadomoscReklamacji, WpisOsi } from "../api/typy";
import { atrapaZapisow } from "../test/zapisy";
import { ustawKadr } from "../test/kadr";
import { naruszeniaWcag } from "../test/dostepnosc";

/* ── PDF w czacie: miniatura pierwszej strony i cały dokument w panelu ──────
   jsdom nie ma płótna, więc `pdfjs-dist` stoi tu atrapą. Test pilnuje tego,
   co zależy od NAS, a nie od pdf.js:

   1. Bajty idą GET-em z trasy podglądu, z sesją i bez typu treści.
      Otwarcie czatu z PDF-em niczego nie zapisuje.
   2. Miniatura i okno czytają jeden wpis zapytania: klik nie pobiera drugi raz.
   3. pdf.js dostaje KOPIĘ bajtów, bo przekazanie bufora do workera zeruje go
      w wołającym, a z tego samego wpisu czyta potem okno.
   4. Porażka nie zostawia pustego prostokąta: zostaje nazwa z pobraniem,
      a zdanie mówi tylko tam, gdzie jest co powiedzieć.
   5. Strony okna rysują się po kolei i dopiero przy zbliżeniu do kadru. */

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  render: vi.fn(),
  getPage: vi.fn(),
  dane: [] as Uint8Array[],
  opcje: [] as Record<string, unknown>[],
  stron: 3,
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (o: Record<string, unknown>) => pdf.getDocument(o),
}));

const strona = (numer: number) => ({
  numer,
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  render: (p: { canvas: HTMLCanvasElement }) => pdf.render(numer, p),
});

beforeEach(() => {
  pdf.dane = [];
  pdf.opcje = [];
  pdf.stron = 3;
  pdf.render.mockReset().mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  pdf.getPage.mockReset().mockImplementation(async (n: number) => strona(n));
  pdf.getDocument.mockReset().mockImplementation((o: { data: Uint8Array } & Record<string, unknown>) => {
    pdf.dane.push(o.data);
    pdf.opcje.push(o);
    return {
      promise: Promise.resolve({ numPages: pdf.stron, getPage: pdf.getPage }),
      destroy: vi.fn(async () => {}),
    };
  });
});

afterEach(() => vi.unstubAllGlobals());

const { KafelZalacznika, KartaZalacznika, ListaZalacznikow } = await import("./Zalacznik");
const { Czat } = await import("../reklamacje/Czat");
const { Os } = await import("../skrzynka/Os");

const SCIEZKA = "/api/obsluga/reklamacje/3/zalaczniki/9/podglad";
const nicZObrazu = { url: undefined, blad: null, ponow: () => {} };

function zKlientem(ui: React.ReactNode) {
  const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={klient}>{ui}</QueryClientProvider>);
}

const kafel = (pobierz: () => Promise<void> = () => Promise.resolve()) => zKlientem(<ul>
  <KafelZalacznika nazwa="faktura.pdf" podglad={false} obraz={nicZObrazu} pdf={SCIEZKA} pobierz={pobierz} />
</ul>);

/** `fetch` z odpowiedzią o zadanym kodzie dla trasy podglądu; liczy wywołania. */
function odpowiedz(status: number, cialo: unknown = {}) {
  const wolania: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    wolania.push([url, init]);
    return new Response(JSON.stringify(cialo), { status });
  }));
  return wolania;
}

describe("Miniatura PDF-a w kaflu czatu", () => {
  it("rysuje pierwszą stronę z bajtów trasy podglądu — GET-em, bez zapisu", async () => {
    const stan = atrapaZapisow((url) => (url === SCIEZKA ? "%PDF-1.7" : undefined));
    kafel();
    const przycisk = await screen.findByRole("button", { name: "Otwórz PDF: faktura.pdf" });
    expect(within(przycisk).getByText("PDF")).toBeInTheDocument();
    expect(pdf.getPage).toHaveBeenCalledWith(1);
    expect(pdf.render).toHaveBeenCalledWith(1, expect.objectContaining({ canvas: expect.any(HTMLCanvasElement) }));
    /* Płótno ma szerokość kafla (112 px przy gęstości 1), wysokość z proporcji strony. */
    const plotno = pdf.render.mock.calls[0]![1].canvas as HTMLCanvasElement;
    expect(plotno.width).toBe(112);
    expect(plotno.height).toBe(149);
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
    /* Reguła klienta HTTP: żądanie bez ciała nie deklaruje typu treści. */
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("content-type");
    expect(init.headers).toHaveProperty("x-session");
  });

  it("pdf.js dostaje kopię bajtów i nie dostaje XFA", async () => {
    atrapaZapisow((url) => (url === SCIEZKA ? "%PDF-1.7" : undefined));
    kafel();
    await userEvent.click(await screen.findByRole("button", { name: "Otwórz PDF: faktura.pdf" }));
    await screen.findByRole("img", { name: "Strona 1 z 3" });
    expect(pdf.getDocument).toHaveBeenCalledTimes(2);
    /* Dwa otwarcia, dwie RÓŻNE tablice o tej samej treści: oryginał zostaje w zapytaniu. */
    expect(pdf.dane[0]).not.toBe(pdf.dane[1]);
    expect([...pdf.dane[1]!]).toEqual([...pdf.dane[0]!]);
    expect(pdf.dane[0]!.length).toBeGreaterThan(0);
    for (const o of pdf.opcje) expect(o.enableXfa).toBe(false);
  });

  it("klik otwiera cały dokument w oknie bez drugiego pobrania; Escape zamyka", async () => {
    const stan = atrapaZapisow((url) => (url === SCIEZKA ? "%PDF-1.7" : undefined));
    kafel();
    await userEvent.click(await screen.findByRole("button", { name: "Otwórz PDF: faktura.pdf" }));
    const okno = await screen.findByRole("dialog", { name: "Dokument: faktura.pdf" });
    expect(within(okno).getByRole("heading", { name: "faktura.pdf" })).toBeInTheDocument();
    expect(await within(okno).findByText("Strona 1 z 3")).toBeInTheDocument();
    /* Jeden GET na miniaturę i okno razem — ten sam wpis zapytania. */
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stan.wyslane).toEqual([]);
    expect(await naruszeniaWcag()).toBe("");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("strony rysują się po kolei i dopiero przy zbliżeniu do kadru", async () => {
    atrapaZapisow((url) => (url === SCIEZKA ? "%PDF-1.7" : undefined));
    kafel();
    await userEvent.click(await screen.findByRole("button", { name: "Otwórz PDF: faktura.pdf" }));
    await screen.findByRole("img", { name: "Strona 1 z 3" });
    /* Miniatura i pierwsza strona okna — reszta czeka na kadr. */
    await waitFor(() => expect(pdf.render.mock.calls.map((c) => c[0])).toEqual([1, 1]));
    act(() => ustawKadr(true));
    await waitFor(() => expect(pdf.render.mock.calls.map((c) => c[0])).toEqual([1, 1, 2, 3]));
  });

  it("„Pobierz” w oknie woła tę samą funkcję co pasek nazwy", async () => {
    atrapaZapisow((url) => (url === SCIEZKA ? "%PDF-1.7" : undefined));
    const pobierz = vi.fn(() => Promise.resolve());
    kafel(pobierz);
    await userEvent.click(await screen.findByRole("button", { name: "Otwórz PDF: faktura.pdf" }));
    const okno = await screen.findByRole("dialog");
    await userEvent.click(within(okno).getByRole("button", { name: "Pobierz" }));
    expect(pobierz).toHaveBeenCalledTimes(1);
  });

  it("nieudane pobranie z okna mówi o sobie w oknie", async () => {
    atrapaZapisow((url) => (url === SCIEZKA ? "%PDF-1.7" : undefined));
    kafel(() => Promise.reject(new Error("Sesja wygasła — zaloguj się")));
    await userEvent.click(await screen.findByRole("button", { name: "Otwórz PDF: faktura.pdf" }));
    const okno = await screen.findByRole("dialog");
    await userEvent.click(within(okno).getByRole("button", { name: "Pobierz" }));
    expect(await within(okno).findByText("Sesja wygasła — zaloguj się")).toBeInTheDocument();
  });
});

describe("Porażka podglądu zostawia kafel z nazwą", () => {
  it("415 to odpowiedź „to nie PDF”: sama nazwa z pobraniem, bez zdania", async () => {
    odpowiedz(415, { error: "To nie jest obraz ani PDF." });
    kafel();
    await waitFor(() => expect(screen.queryByText("wczytuję…")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Otwórz PDF/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/To nie jest/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "faktura.pdf" })).toBeInTheDocument();
    expect(pdf.getDocument).not.toHaveBeenCalled();
  });

  it("413 mówi zdaniem serwera, ale bez „Spróbuj ponownie” — druga próba da to samo", async () => {
    odpowiedz(413, { error: "Plik ma ponad 20 MB — pobierz go na dysk." });
    kafel();
    expect(await screen.findByText(/ponad 20 MB/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Spróbuj ponownie/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "faktura.pdf" })).toBeInTheDocument();
  });

  it("awaria drogi mówi zdaniem i daje ponowienie, które pyta serwer jeszcze raz", async () => {
    const wolania = odpowiedz(502, { error: "Allegro nie oddało załącznika (500)." });
    kafel();
    expect(await screen.findByText(/Allegro nie oddało/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));
    await waitFor(() => expect(wolania).toHaveLength(2));
  });

  it("plik, którego pdf.js nie otworzy, mówi po polsku i zostawia pobranie", async () => {
    atrapaZapisow((url) => (url === SCIEZKA ? "%PDF-1.7" : undefined));
    pdf.getDocument.mockImplementation(() => ({
      promise: Promise.reject(Object.assign(new Error("Invalid PDF structure."), { name: "InvalidPDFException" })),
      destroy: vi.fn(async () => {}),
    }));
    kafel();
    expect(await screen.findByText(/Nie umiem otworzyć tego PDF-a/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid PDF/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Otwórz PDF/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "faktura.pdf" })).toBeInTheDocument();
  });
});

describe("PDF w karcie skrzynki", () => {
  it("ta sama miniatura nad nazwą z pobraniem, a klik otwiera okno", async () => {
    const sciezka = "/api/obsluga/zalaczniki/7/podglad";
    const stan = atrapaZapisow((url) => (url === sciezka ? "%PDF-1.7" : undefined));
    zKlientem(<ListaZalacznikow>
      <KartaZalacznika nazwa="protokol.pdf" podglad={false} obraz={nicZObrazu} pdf={sciezka}
        pobierz={() => Promise.resolve()} />
    </ListaZalacznikow>);
    await userEvent.click(await screen.findByRole("button", { name: "Otwórz PDF: protokol.pdf" }));
    expect(await screen.findByRole("dialog", { name: "Dokument: protokol.pdf" })).toBeInTheDocument();
    /* Miniatura karty ma 144 px szerokości. */
    expect((pdf.render.mock.calls[0]![1].canvas as HTMLCanvasElement).width).toBe(144);
    expect(stan.wyslane).toEqual([]);
    expect(await naruszeniaWcag()).toBe("");
  });

  it("oś skrzynki podaje trasę podglądu i nie pyta o PDF kolejki obrazów", async () => {
    const stan = atrapaZapisow((url) => (url === "/api/obsluga/zalaczniki/7/podglad" ? "%PDF-1.7" : undefined));
    const w: WpisOsi = {
      id: "msg-1", rodzaj: "wiadomosc", autor: "klient", odKlienta: true,
      tresc: "W załączniku protokół", at: "2026-09-01T10:00:00Z", ofertaId: null, messageId: 1,
      zalaczniki: [{ id: 7, nazwa: "protokol.pdf", typ: "application/pdf", status: "SAFE",
        doPobrania: true, podglad: false, pdf: true }],
    };
    zKlientem(<Os rozmowaId={1} wpisy={[w]} zrodloPomiaru={null} mozeZlecac={false}
      onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    expect(await screen.findByRole("button", { name: "Otwórz PDF: protokol.pdf" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stan.nieznane).toEqual([]);
    expect(stan.wyslane).toEqual([]);
  });
});

describe("PDF w czacie reklamacji i dyskusji", () => {
  it("czat podaje trasę podglądu sprawy, a pole `pdf` z serwera decyduje o układzie", async () => {
    const stan = atrapaZapisow((url) => (url === SCIEZKA ? "%PDF-1.7" : undefined));
    const wiad: WiadomoscReklamacji = {
      id: 1, externalId: "w-1", autorLogin: "kupujacy1", autorRola: "BUYER",
      tresc: "Faktura w załączniku", utworzonoAt: "2026-09-06T10:01:00.000Z",
      zalaczniki: [{ id: 9, wiadomoscId: 1, nazwa: "faktura.pdf", podglad: false, pdf: true }],
    } as WiadomoscReklamacji;
    zKlientem(<Czat sprawa={{ id: 3, opisZgloszenia: null, czatAktywny: true, wiadomosciIle: 1 }}
      zalaczniki={[]} czat={[wiad]} />);
    expect(await screen.findByRole("button", { name: "Otwórz PDF: faktura.pdf" })).toBeInTheDocument();
    expect(stan.nieznane).toEqual([]);
    expect(stan.wyslane).toEqual([]);
  });

  it("bez `pdf` czat nie pyta trasy o dokument — zostaje kafel z nazwą", async () => {
    const stan = atrapaZapisow(() => undefined);
    const wiad = {
      id: 1, externalId: "w-1", autorLogin: "kupujacy1", autorRola: "BUYER",
      tresc: "Faktura w załączniku", utworzonoAt: "2026-09-06T10:01:00.000Z",
      zalaczniki: [{ id: 9, wiadomoscId: 1, nazwa: "faktura.pdf", podglad: false, pdf: false }],
    } as WiadomoscReklamacji;
    zKlientem(<Czat sprawa={{ id: 3, opisZgloszenia: null, czatAktywny: true, wiadomosciIle: 1 }}
      zalaczniki={[]} czat={[wiad]} />);
    expect(screen.getByRole("button", { name: /faktura\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Otwórz PDF/ })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(stan.wyslane).toEqual([]);
  });
});
