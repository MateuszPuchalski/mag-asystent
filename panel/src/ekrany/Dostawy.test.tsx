import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dostawy } from "./Dostawy";
import { kubelekDokumentu } from "../dostawy/Kolejka";
import type { Dokument, DokumentDostawy, Wyjatek } from "../api/dostawy";
import { _wyczyscPamiecZdjec } from "../towar/useZdjecie";

/* ── Ekran dostaw (0.435.0) ────────────────────────────────────────────────
   Pierwszy widok przeniesiony z `biuro.html`. Tamtejsze strażnice pilnowały
   go po ŹRÓDLE (liczniki `method:` w `routes/biuro.test.ts`); tu pilnujemy
   po ZACHOWANIU — co ekran naprawdę wysyła. Gwarancje, które przeszły razem
   z widokiem:

   1. ZERO ZAPISU PRZY PATRZENIU. Otwarcie ekranu i wejście w dokument to
      same odczyty — podgląd dokumentu nie otwiera dostawy i nie zabiera
      nikomu blokad.
   2. DO DECYZJI PRZEBIJA STAN. Faktura „zamknięta" z otwartym wyjątkiem
      dalej czeka na biuro.
   3. WYJĄTEK SPOZA OKNA NIE GINIE. W biurze stał w karcie REKLAMACJE;
      tu dostaje wiersz, bo lista dostaw go nie zna.
   4. ROZWIĄŻ działa i niesie notatkę do protokołu.

   Od 0.435.0 ten plik przejmuje też gwarancje strażników `biuro.html`,
   które odeszły z widokiem (`routes/biuro.test.ts`): sygnał wyjątku
   w wierszu, kto odłożył pozycję, archiwum szukane przez SERWER z uczciwą
   stopką i powiększenie dowodu zamykane kliknięciem albo Escape. */

const dok = (dokId: number, o: Partial<DokumentDostawy> = {}): DokumentDostawy => ({
  dokId, typ: "FZ", nrPelny: `FZ ${dokId}/MAG/09/2026`, dataWyst: "2026-09-20",
  dostawca: "Rosa-Pol", khId: null, wyjatkiOtwarte: 0, maLogo: false, positions: 4,
  wBuforze: false, wPrzyjeciach: false, linesTotal: 4, linesDone: 2, status: "open", ...o,
});

const wyj = (id: number, o: Partial<Wyjatek> = {}): Wyjatek => ({
  id, deliveryId: 50, lineId: 1, typ: "damaged", typLabel: "uszkodzone", qty: 4, symObcy: null,
  zamiastIlosc: null, qtyDok: 6, opis: "pęknięta", hasPhoto: false,
  createdAt: "2026-09-21T14:02:00.000Z", createdBy: "m.nowak", resolvedAt: null,
  resolvedNote: null, resolvedBy: null, docNumber: "FZ 802/MAG/09/2026", dokId: 802,
  sym: "RP-2210", name: "Donica 30 cm", unit: "szt.", ...o,
});

/* Dowód z hali ze zdjęciem — do testu powiększenia. */
const DOKUMENT_ZE_ZDJECIEM = (): Dokument => ({
  ...DOKUMENT, lines: DOKUMENT.lines.map((l) =>
    ({ ...l, problemy: l.problemy.map((p) => ({ ...p, hasPhoto: true })) })),
});

const DOKUMENT: Dokument = {
  dokId: 802, deliveryId: 50, nrPelny: "FZ 802/MAG/09/2026", typ: "FZ", dostawca: "Rosa-Pol",
  khId: null, maLogo: false, dataWyst: "2026-09-20", wBuforze: false, wPrzyjeciach: false,
  status: "open", zamkniecie: null, dostawcaStat: null, notatki: [], archiwalny: false,
  zrodlo: "snapshot", progress: { total: 2, done: 1, remaining: 1, problems: 1 },
  lines: [
    { lineId: 1, twId: 7, sym: "RP-2210", name: "Donica 30 cm", qtyDoc: 6, qtyDone: 4,
      locExpected: "R-07-1", locActual: null, status: "problem", mismatch: false,
      bezLokalizacji: false, doneBy: null, doneAt: null, problemy: [wyj(1)] },
    { lineId: 2, twId: 8, sym: "RP-2201", name: "Donica 20 cm", qtyDoc: 12, qtyDone: 12,
      locExpected: "R-07-1", locActual: "R-07-1", status: "done", mismatch: false,
      bezLokalizacji: false, doneBy: "m.nowak", doneAt: "2026-09-21T13:48:00.000Z", problemy: [] },
  ],
  problemyBezLinii: [],
};

let wyslane: string[] = [];
let archiwumPytania: string[] = [];
/* Czy instalacja ma zdjęcia kartotek — tak mówi o tym `/api/health`. */
let zdjeciaWHealth = false;
let pytaniaOObrazy: string[] = [];

function odpowiedz(url: string, init?: RequestInit): unknown {
  const metoda = init?.method ?? "GET";
  if (metoda !== "GET") { wyslane.push(`${metoda} ${url} ${init?.body ?? ""}`); return { ok: true }; }
  if (url === "/api/delivery/documents") {
    return { documents: [
      /* Rosa-Pol ma logo (khId 5) — wiersz listy ma je pokazać. */
      dok(802, { wyjatkiOtwarte: 1, khId: 5, maLogo: true }),
      /* „Zamknięta" z otwartym wyjątkiem — gwarancja 2. */
      dok(803, { status: "done", linesDone: 4, wyjatkiOtwarte: 1 }),
      dok(804), dok(805, { status: null, linesDone: 0 }),
    ], dniWstecz: 14 };
  }
  if (url === "/api/problems/unresolved") {
    return { problems: [wyj(1), wyj(2, { deliveryId: 60, dokId: 700, docNumber: "FZ 700/MAG/07/2026" }),
      wyj(3, { deliveryId: null, dokId: null, docNumber: null, sym: null, symObcy: "OBCY-1" })] };
  }
  if (url === "/api/biuro/zamkniete-poza") return { documents: [] };
  if (url === "/api/health") return zdjeciaWHealth ? { zdjecia: { plikow: 3 } } : {};
  if (url === "/api/biuro/notatki/odpowiedzi") return { odpowiedzi: [] };
  if (url === "/api/biuro/dokument/802") return DOKUMENT;
  if (url === "/api/biuro/dokument/806") return { ...DOKUMENT_ZE_ZDJECIEM(), dokId: 806 };
  if (url.startsWith("/api/biuro/dostawy/archiwum?q=")) {
    archiwumPytania.push(decodeURIComponent(url.split("q=")[1]));
    /* Serwer odcina listę na dwustu — ekran ma to POWIEDZIEĆ. */
    return { documents: [dok(501, { status: "done", linesDone: 4 })], ile: 350, limit: 200 };
  }
  throw new Error(`nieoczekiwany adres w teście: ${url}`);
}

beforeEach(() => {
  wyslane = [];
  archiwumPytania = [];
  zdjeciaWHealth = false;
  pytaniaOObrazy = [];
  _wyczyscPamiecZdjec();
  /* `URL.createObjectURL` nie istnieje w jsdom — ten sam zastępnik co w `useZdjecie.test.tsx`. */
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:dowod";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    /* Zdjęcia kartotek i dowodów — brak jest ODPOWIEDZIĄ (404), nie awarią. */
    /* Obiekt zamiast `Response`: `Blob` z jsdom nie wchodzi do `Response` z Node
       (brak `stream()`) — ten sam kształt, co w `useZdjecie.test.tsx`. */
    if (/\/(zdjecie|photo|logo)$/.test(url)) pytaniaOObrazy.push(url);
    if (url === "/api/problems/1/photo") return { ok: true, status: 200, blob: async () => new Blob() };
    if (url === "/api/dostawcy/5/logo") return { ok: true, status: 200, blob: async () => new Blob() };
    if (/\/(zdjecie|photo|logo)$/.test(url)) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(odpowiedz(url, init)), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz(adres = "/obsluga/dostawy") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={[adres]}>
      <Routes>
        <Route path="/obsluga/dostawy" element={<Dostawy />} />
        <Route path="/obsluga/dostawy/:id" element={<Dostawy />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

/* ── Logo w liście i zdjęcia pozycji (0.449.0) ───────────────────────────
   Zgłoszenie właściciela ze zrzutem nietkniętej faktury: ani jednego zdjęcia
   towaru, a logo dostawcy dopiero po wejściu w dokument. Pilnujemy trzech
   rzeczy: logo stoi w wierszu listy (i nie pytamy o logo, którego nie ma),
   zdjęcia pozycji idą wtedy, gdy instalacja je ma, a bez źródła — wcale. */
describe("Obrazy na ekranie dostaw", () => {
  it("wiersz listy niesie logo dostawcy, a o brakujące logo nie pyta", async () => {
    pokaz();
    const wiersz = await screen.findByRole("button", { name: /FZ 802\/MAG\/09\/2026/ });
    await waitFor(() => expect(wiersz.querySelector("img")?.getAttribute("src")).toBe("blob:dowod"));
    expect(pytaniaOObrazy.filter((u) => u.endsWith("/logo"))).toEqual(["/api/dostawcy/5/logo"]);
    /* Wiersz bez logo trzyma to samo miejsce — nazwy zaczynają się w jednej kolumnie. */
    const bez = screen.getByRole("button", { name: /FZ 803\/MAG/ });
    expect(bez.querySelector("img")).toBeNull();
    expect(bez.querySelector("span.w-14")).not.toBeNull();
  });

  it("instalacja ze zdjęciami: każda pozycja dokumentu pyta o swoje zdjęcie", async () => {
    zdjeciaWHealth = true;
    pokaz("/obsluga/dostawy/802");
    await screen.findByRole("heading", { name: "FZ 802/MAG/09/2026" });
    await waitFor(() => expect(pytaniaOObrazy).toContain("/api/products/8/zdjecie"));
    expect(pytaniaOObrazy).toContain("/api/products/7/zdjecie");
    expect(screen.getByRole("columnheader", { name: "Zdjęcie" })).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("instalacja bez zdjęć: tabela bez kolumny zdjęć i bez pytań o nie", async () => {
    pokaz("/obsluga/dostawy/802");
    await screen.findByRole("heading", { name: "FZ 802/MAG/09/2026" });
    await screen.findByText("RP-2201");
    expect(screen.queryByRole("columnheader", { name: "Zdjęcie" })).toBeNull();
    /* Pozycja z wyjątkiem ma swoje zdjęcie od 0.435.0 — ono zostaje. */
    expect(pytaniaOObrazy.filter((u) => u.endsWith("/zdjecie"))).toEqual(["/api/products/7/zdjecie"]);
  });
});

describe("Ekran dostaw", () => {
  it("otwarcie ekranu i wejście w dokument nie wysyłają ani jednego zapisu", async () => {
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /FZ 802\/MAG\/09\/2026/ }));
    expect(await screen.findByRole("heading", { name: "FZ 802/MAG/09/2026" })).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("DO DECYZJI niesie fakturę zamkniętą z otwartym wyjątkiem i wyjątki spoza listy", async () => {
    pokaz();
    const kolejka = (await screen.findByRole("button", { name: /FZ 803\/MAG/ })).closest("ul")!.parentElement!;
    expect(within(kolejka).getByRole("button", { name: /FZ 802\/MAG/ })).toBeInTheDocument();
    /* Nietknięta i w toku bez sygnału NIE stoją w DO DECYZJI. */
    expect(within(kolejka).queryByRole("button", { name: /FZ 804\/MAG/ })).toBeNull();
    /* Gwarancja 3: dokument spoza okna importu i towar bez dostawy. */
    expect(within(kolejka).getByRole("button", { name: /FZ 700\/MAG\/07\/2026/ })).toBeInTheDocument();
    expect(within(kolejka).getByRole("button", { name: /Towar spoza dokumentu/ })).toBeInTheDocument();
  });

  it("kolejka bez tytułu „Dostawy” — nazwę niesie nawigacja nad ekranem (0.525.0)", async () => {
    pokaz();
    await screen.findByRole("button", { name: /FZ 802\/MAG/ });
    expect(screen.queryByText("Dostawy", { selector: "b" })).toBeNull();
    /* Pytanie kubełka i granica okna importu dzielą jedno pasmo. */
    const pytanie = screen.getByText("Reklamować u dostawcy czy zamknąć wyjątki?");
    expect(pytanie.parentElement).toHaveTextContent(/okno importu: ostatnie \d+ dni/);
  });

  it("kubełek liczy się z sygnału przed stanem", () => {
    const zOdp = new Set([900]);
    expect(kubelekDokumentu(dok(1, { status: "done", wyjatkiOtwarte: 2 }), new Set())).toBe("decyzja");
    expect(kubelekDokumentu(dok(900, { status: null }), zOdp)).toBe("decyzja");
    expect(kubelekDokumentu(dok(2, { status: "done" }), new Set())).toBe("zamkniete");
    expect(kubelekDokumentu(dok(3, { status: "open" }), new Set())).toBe("toku");
    expect(kubelekDokumentu(dok(4, { status: null }), new Set())).toBe("nietkniete");
  });

  it("ROZWIĄŻ wysyła notatkę do protokołu — i tylko to", async () => {
    pokaz("/obsluga/dostawy/802");
    await userEvent.click(await screen.findByRole("button", { name: "Rozwiąż" }));
    await userEvent.type(screen.getByLabelText("Jak załatwiono wyjątek"), "dosłali 2 szt.");
    await userEvent.click(screen.getByRole("button", { name: "Zamknij wyjątek" }));
    await waitFor(() => expect(wyslane).toEqual(
      ['POST /api/problems/1/resolve {"note":"dosłali 2 szt."}']));
  });

  it("protokół dla dostawcy prowadzi do druku po numerze dokumentu", async () => {
    pokaz("/obsluga/dostawy/802");
    const link = await screen.findByRole("link", { name: /Protokół dla dostawcy/ });
    expect(link).toHaveAttribute("href", "/obsluga/druk/protokol/802");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("zamknięcie poza WERTIS żąda powodu, zanim cokolwiek wyśle", async () => {
    pokaz("/obsluga/dostawy/802");
    await userEvent.click(await screen.findByRole("button", { name: /Rozłożone poza WERTIS/ }));
    const zamknij = screen.getByRole("button", { name: "Zamknij dostawę" });
    expect(zamknij).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Powód"), "stara aplikacja");
    await userEvent.click(zamknij);
    await waitFor(() => expect(wyslane).toEqual(
      ['POST /api/biuro/dokument/802/zamknij {"powod":"stara aplikacja"}']));
  });

  it("wiersz niesie sygnał wyjątku — pasek 100% by go nie powiedział", async () => {
    /* Wyjątek liczy się jako pozycja domknięta (D8), więc bez osobnego sygnału
       faktura z reklamacją wygląda jak bezproblemowa. */
    pokaz();
    const wiersz = await screen.findByRole("button", { name: /FZ 803\/MAG/ });
    expect(within(wiersz).getByText("1 wyjątek")).toBeInTheDocument();
  });

  it("pozycja mówi, kto ją odłożył i gdzie", async () => {
    /* `done_by` leżało w bazie od 0.17.0 bez czytelnika — biuro dzwoniło na
       halę po rzecz, którą miało na ekranie. */
    pokaz("/obsluga/dostawy/802");
    expect(await screen.findByRole("columnheader", { name: /kto odłożył/i })).toBeInTheDocument();
    /* W wierszu tabeli, nie gdziekolwiek: to samo nazwisko stoi też przy
       wyjątku jako zgłaszający, a to inna informacja. */
    const wiersz = screen.getByRole("row", { name: /RP-2201/ });
    expect(within(wiersz).getByText(/m\.nowak · /)).toBeInTheDocument();
    expect(within(wiersz).getByText("R-07-1")).toBeInTheDocument();
  });

  it("kubełki do przeglądania stoją pod „Więcej”, praca na wierzchu", async () => {
    pokaz();
    await screen.findByRole("button", { name: /FZ 802\/MAG/ });
    for (const n of [/^Zamknięte/, /^Poza WERTIS/, /^Archiwum/]) {
      expect(screen.queryByRole("button", { name: n })).toBeNull();
      expect(screen.getByRole("option", { name: n })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /^Do decyzji/ })).toBeInTheDocument();
  });

  it("archiwum szuka SERWER, pobiera się dopiero na życzenie i mówi, że jest obcięte", async () => {
    pokaz();
    await screen.findByRole("button", { name: /FZ 802\/MAG/ });
    expect(archiwumPytania).toEqual([]);
    /* Od 0.526.0 „Archiwum" stoi pod „Więcej" — wybór z listy, nie pigułka. */
    await userEvent.selectOptions(screen.getByLabelText("Więcej kubełków"),
      screen.getByRole("option", { name: /Archiwum/ }));
    const granica = await screen.findByText(/pokazano 1 z 350 — zawęź wyszukiwaniem/);
    /* Granica okna stoi w paśmie pytania, NAD listą (0.525.0) — ucięte
       archiwum widać, zanim zacznie się czytać wiersze. */
    expect(granica.parentElement).toHaveTextContent(/Tylko wgląd — dostawy spoza okna importu/);
    await userEvent.type(screen.getByLabelText("Szukaj dostawy"), "FZ 5");
    /* Filtrowanie w przeglądarce zawężałoby stronę wyników, nie zbiór —
       faktura sprzed roku nie znalazłaby się mimo poprawnego numeru. */
    await waitFor(() => expect(archiwumPytania).toContain("FZ 5"));
  });

  it("dowód z hali powiększa się i zamyka kliknięciem albo Escape", async () => {
    pokaz("/obsluga/dostawy/806");
    /* Nazwa przycisku to opis obrazu (`alt`), nie `title` — tak słyszy go czytnik. */
    const miniatura = await screen.findByRole("button", { name: /Zdjęcie z hali: RP-2210/ });
    await userEvent.click(miniatura);
    await userEvent.click(screen.getByRole("button", { name: "Zamknij powiększenie" }));
    expect(screen.queryByRole("button", { name: "Zamknij powiększenie" })).toBeNull();
    await userEvent.click(miniatura);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Zamknij powiększenie" })).toBeNull();
  });
});

/* ── Wejście z Analizy (0.502.0) ──────────────────────────────────────────
   Wiersz dostawcy w Analizie prowadzi tu z kubełkiem archiwum i nazwą
   dostawcy. Adres czyta się raz, przy wejściu, i od razu pyta archiwum. */
describe("adres z kubełkiem i frazą", () => {
  it("otwiera archiwum z frazą dostawcy", async () => {
    pokaz("/obsluga/dostawy?kubelek=archiwum&q=Rosa-Pol");
    await waitFor(() => expect(archiwumPytania).toContain("Rosa-Pol"));
    expect(screen.getByDisplayValue("Rosa-Pol")).toBeInTheDocument();
  });
});
