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
  <Os wpisy={wpisy} zrodloPomiaru={null} mozeZlecac={false}
    onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

describe("Zdarzenia sprawy stoją w pasku, nie na osi", () => {
  it("przebieg sprawy dalej widać — z podpisem i godziną pod ręką", () => {
    /* Przeniesienie nie ma prawa skasować informacji. Przejście zostaje na
       wierzchu, a KTO je wywołał i KIEDY — w podpowiedzi, bo w rzędzie liczy
       się jedno spojrzenie, nie komplet danych naraz. */
    pokaz([wiadomosc(), status({ autor: "klient" })]);
    const pasek = screen.getByRole("navigation", { name: /przebieg sprawy/i });
    const chip = within(pasek).getByRole("button", { name: /resolved → open/ });
    expect(chip).toBeInTheDocument();
    expect(chip.title).toMatch(/klient/);
  });

  it("oś przestała nieść kreski — zostają same wypowiedzi", () => {
    /* To jest cały powód zmiany: przy siedmiu zdarzeniach kreski zajmowały
       więcej miejsca niż rozmowa i dyktowały długość przewijania. */
    const { container } = render(
      <Os wpisy={[wiadomosc(), status(), status({ id: "status-10", tresc: "open → closed" })]}
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
