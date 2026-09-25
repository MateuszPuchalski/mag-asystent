import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Os, rozdziel } from "./Os";
import type { WpisOsi } from "../api/typy";

/* ── Zdarzenia sprawy: pasek pod oknem wiadomości (0.243.0) ──────────────────
   Do 0.242.0 zmiana statusu (§10.3, 0.158.0), sklejenie sprawy (0.161.0)
   i krok doboru stały na osi jako kreski między wypowiedziami. Zgłoszenie
   właściciela: przenieść je do jednego poziomego rzędu pod oknem wiadomości,
   a kliknięcie ma prowadzić do tego miejsca w rozmowie.

   Testy pilnują trzech rzeczy i każda odpowiada na inne pytanie: czy przebieg
   sprawy dalej widać, czy oś przestała nim być zaśmiecona, i czy kliknięcie
   naprawdę wraca na oś — bo bez tego rozdzielenie gubiłoby miejsce, w którym
   stan się zmienił.                                                         */

const wiadomosc = (n: Record<string, unknown> = {}): WpisOsi => ({
  id: "msg-1", rodzaj: "wiadomosc", autor: "klient", odKlienta: true,
  tresc: "Czy ta linka pasuje do T375?", at: "2026-09-01T09:00:00Z", ofertaId: null, ...n,
});

const status = (n: Record<string, unknown> = {}): WpisOsi => ({
  id: "status-9", rodzaj: "status", autor: "Ala", odKlienta: false,
  tresc: "resolved → open", at: "2026-09-01T10:00:00Z", ofertaId: null, ...n,
});

const pokaz = (wpisy: WpisOsi[]) => render(
  <Os rozmowaId={1} wpisy={wpisy} zrodloPomiaru={null} mozeZlecac={false}
    onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

/* Od @wydanie pasek mówi jedno zdanie, a czipy otwiera „przebieg (n)". */
const rozwin = () => fireEvent.click(screen.getByRole("button", { name: /przebieg \(/ }));

describe("Zdarzenia sprawy stoją w pasku, nie na osi", () => {
  it("przebieg sprawy dalej widać — z podpisem i godziną pod ręką", () => {
    /* Przeniesienie nie ma prawa skasować informacji. Przejście zostaje na
       wierzchu, a KTO je wywołał i KIEDY — w podpowiedzi, bo w rzędzie liczy
       się jedno spojrzenie, nie komplet danych naraz. */
    pokaz([wiadomosc(), status({ autor: "klient" })]);
    rozwin();
    const pasek = screen.getByRole("navigation", { name: /przebieg sprawy/i });
    const chip = within(pasek).getByRole("button", { name: /resolved → open/ });
    expect(chip).toBeInTheDocument();
    expect(chip.title).toMatch(/klient/);
  });

  it("oś przestała nieść kreski — zostają same wypowiedzi", () => {
    /* To jest cały powód zmiany: przy siedmiu zdarzeniach kreski zajmowały
       więcej miejsca niż rozmowa i dyktowały długość przewijania. */
    const { container } = render(
      <Os rozmowaId={1} wpisy={[wiadomosc(), status(), status({ id: "status-10", tresc: "open → closed" })]}
        zrodloPomiaru={null} mozeZlecac={false} onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    const lista = container.querySelector("[data-wpis]")!.parentElement!;
    expect(within(lista as HTMLElement).queryByText(/resolved → open/)).toBeNull();
    expect(lista.querySelectorAll("[data-wpis]")).toHaveLength(1);
  });

  it("kliknięcie prowadzi do miejsca w rozmowie", () => {
    /* Bez tego pasek byłby listą faktów oderwaną od wątku. Cel to pierwsza
       wypowiedź PO zdarzeniu — ta, której zdarzenie dotyczy. */
    const skoki: unknown[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element, o) {
      skoki.push([(this as HTMLElement).dataset.wpis, o]);
    });
    pokaz([wiadomosc(), status(), wiadomosc({ id: "msg-2", tresc: "Dziękuję" })]);
    rozwin();
    fireEvent.click(screen.getByRole("button", { name: /resolved → open/ }));
    expect(skoki).toHaveLength(1);
    expect((skoki[0] as unknown[])[0]).toBe("msg-2");
  });

  it("zdarzenie bez wypowiedzi po sobie celuje w ostatnią przed sobą", () => {
    /* Skok donikąd byłby przyciskiem bez skutku, a status zmieniony po
       ostatniej wiadomości jest przypadkiem częstym, nie brzegowym. */
    const { zdarzenia } = rozdziel([wiadomosc(), status()]);
    expect(zdarzenia).toHaveLength(1);
    expect(zdarzenia[0].cel).toBe("msg-1");
  });

  it("nie udaje wypowiedzi: bez zlecenia pomiaru i bez wstawiania do szkicu", () => {
    /* §10.3 żąda, żeby każdy rodzaj wpisu wyglądał inaczej. Zdarzenie ma
       jeden skutek — skok na oś — i żadnego z działań wypowiedzi. */
    pokaz([wiadomosc(), status()]);
    expect(screen.queryByRole("button", { name: /szkicu/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Zleć z tej wiadomości/i })).toBeNull();
    expect(screen.queryByText(/NOTATKA WEWNĘTRZNA/)).toBeNull();
  });
});

/* ── Zwrot na osi rozmowy (0.502.0) ────────────────────────────────────────
   Decyzja i pieniądze zwrotu stoją w pasku jako zdarzenie. Najgorszy wynik
   tej zmiany to wpis zwrotu narysowany jak wypowiedź — test pilnuje, że
   rodzaj „zwrot" nie trafia do rozmowy. */
describe("zwrot na osi rozmowy", () => {
  const zwrot = (co: string, id = "zwrot-1"): WpisOsi => ({
    id, rodzaj: "zwrot", autor: "Ala", odKlienta: false, tresc: `zwrot Z-7: ${co}`,
    at: "2026-09-02T09:00:00Z", ofertaId: null,
    zdarzenie: { rodzaj: "zwrot", co, zwrotId: 7, numer: "Z-7" },
  });

  it("jest zdarzeniem w pasku z nazwą z osi zwrotu, nie wypowiedzią", () => {
    const { wypowiedzi, zdarzenia } = rozdziel([wiadomosc(), zwrot("pieniadze")]);
    expect(wypowiedzi.map((w) => w.id)).toEqual(["msg-1"]);
    expect(zdarzenia.map((z) => z.id)).toEqual(["zwrot-1"]);
    pokaz([wiadomosc(), zwrot("pieniadze"), zwrot("przelew_cofniety", "zwrot-2")]);
    rozwin();
    const pasek = screen.getByRole("navigation", { name: /przebieg sprawy/i });
    expect(within(pasek).getByRole("button", { name: "zwrot: pieniądze" })).toBeInTheDocument();
    expect(within(pasek).getByRole("button", { name: "zwrot: przelew cofnięty" })).toBeInTheDocument();
  });
});

/* ── Spokojniejsza oś (@wydanie) ────────────────────────────────────────────
   Pasek zdarzeń mówi jedno zdanie o ostatniej zmianie; nasza długa
   wypowiedź zwija się do początku, a puste wiersze ściskają się tylko na
   ekranie; pytanie klienta bez odpowiedzi ma ramkę. */
describe("spokojniejsza oś", () => {
  it("pasek mówi ostatnią zmianę i liczbę, całość po kliknięciu", () => {
    pokaz([wiadomosc(), status({ id: "status-1", tresc: "open → resolved" }), status({ id: "status-2" })]);
    const pasek = screen.getByRole("navigation", { name: /przebieg sprawy/i });
    expect(pasek).toHaveTextContent(/Ostatnio:/);
    expect(within(pasek).getByRole("button", { name: "przebieg (2)" })).toBeInTheDocument();
    expect(within(pasek).queryByRole("button", { name: /open → resolved/ })).toBeNull();
  });

  it("nasza długa wypowiedź zwinięta, puste wiersze ściśnięte, całość na żądanie", () => {
    const dluga = "Po otrzymaniu potwierdzenia nadamy nową przesyłkę.\n\n\n\n\n\nZ poważaniem,\nNatalia\n" + "x".repeat(400);
    pokaz([wiadomosc({ id: "msg-9", odKlienta: false, autor: "Natalia", tresc: dluga })]);
    const tekst = screen.getByText(/Po otrzymaniu potwierdzenia/);
    expect(tekst.className).toMatch(/line-clamp-4/);
    expect(tekst.textContent).not.toMatch(/\n\n\n/);
    fireEvent.click(screen.getByRole("button", { name: "Pokaż całą wiadomość" }));
    expect(screen.getByText(/Po otrzymaniu potwierdzenia/).className).not.toMatch(/line-clamp-4/);
  });

  it("pytanie klienta bez odpowiedzi ma ramkę, odpowiedziane — nie", () => {
    const { container, unmount } = pokaz([wiadomosc()]);
    expect(container.querySelector("[data-wpis='msg-1'] article")?.className).toMatch(/border-amber-400/);
    unmount();
    const r = pokaz([wiadomosc(), wiadomosc({ id: "msg-2", odKlienta: false, autor: "Ala", tresc: "Już sprawdzam" })]);
    expect(r.container.querySelector("[data-wpis='msg-1'] article")?.className).not.toMatch(/border-amber-400/);
  });

  it("„Zleć” na wierzchu tylko przy pytaniu bez odpowiedzi, przy starszych czeka pod myszą", () => {
    /* Runda krytyki: ten sam napis stał pod każdą wiadomością klienta.
       Przy starszych zostaje w drzewie — Tab i czytnik ekranu go znajdą. */
    render(<Os rozmowaId={1} zrodloPomiaru={null} mozeZlecac onZrodlo={() => {}} onWstawDoSzkicu={() => {}}
      wpisy={[wiadomosc(), wiadomosc({ id: "msg-2", odKlienta: false, autor: "Ala", tresc: "Sprawdzam" }),
        wiadomosc({ id: "msg-3", messageId: 3, tresc: "A jednak inna?" })]} />);
    const [stare, nowe] = screen.getAllByRole("button", { name: "Zleć z tej wiadomości" });
    expect(stare.className).toMatch(/opacity-0/);
    expect(stare.className).toMatch(/group-hover:opacity-100/);
    expect(nowe.className).not.toMatch(/opacity-0/);
  });
});
