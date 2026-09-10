import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Os, dogonicDol } from "./Os";
import { ustawKadr } from "../test/kadr";
import type { WpisOsi } from "../api/typy";

/* ── OŚ ZJEŻDŻA NA DÓŁ I PRZYPINA PYTANIE (0.260.0) ──────────────────────────
   Dwie usterki jednego ekranu, znalezione przy audycie wizualnym.

   PIERWSZA: oś nie przewijała się nigdy. Serwer oddaje wpisy od najstarszego
   (`services/skrzynka.ts`, `ORDER BY m.id`), a w całym `panel/src` nie było ani
   jednego `scrollTop`. Otwarcie rozmowy dłuższej niż okno stawiało agenta na
   jej najstarszej wiadomości. Przycisk „Pokaż" pod banerem nowej wiadomości
   odświeżał dane i nie ruszał widoku — obiecywał pokazanie i nie pokazywał.

   DRUGA: pytanie klienta mieszka w części przewijanej, a edytor stoi
   nieruchomo pod nią. Przy rozepchniętym edytorze albo po przewinięciu w górę
   agent pisze odpowiedź, nie widząc zdania, na które odpowiada.

   CZEGO TEN PLIK NIE SPRAWDZA. Prawdziwego układu: jsdom nie liczy wysokości,
   więc `scrollHeight` jest tu podstawione, a przecięcie mówi atrapa
   z `test/kadr.ts`. Sprawdzamy DECYZJE — kiedy zjechać i kiedy pokazać pasek —
   a nie piksele. Piksele mierzy się w przeglądarce, tak samo jak przy
   `scrollIntoView` w kolejce zwrotów.                                        */

const WYSOKOSC = 900;

const pytanie = (n: Partial<WpisOsi> = {}): WpisOsi => ({
  id: "msg-1", rodzaj: "wiadomosc", autor: "kupujacy_7", odKlienta: true,
  tresc: "Czy ten szarpak pasuje do NAC LS 46-450?",
  at: "2026-09-01T10:00:00Z", ofertaId: null, ...n,
});

const nasza = (n: Partial<WpisOsi> = {}): WpisOsi => ({
  id: "msg-2", rodzaj: "wiadomosc", autor: "Mateusz", odKlienta: false,
  tresc: "Sprawdzam i wracam.", at: "2026-09-01T11:00:00Z", ofertaId: null, ...n,
});

const os = (wpisy: WpisOsi[], n: { rozmowaId?: number; skokNaDol?: number } = {}) =>
  render(<Os wpisy={wpisy} rozmowaId={n.rozmowaId ?? 1} skokNaDol={n.skokNaDol ?? 0}
    zrodloPomiaru={null} mozeZlecac={false}
    onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

const lista = (c: HTMLElement) => c.querySelector(".overflow-y-auto") as HTMLElement;
const pasek = (c: HTMLElement) => c.querySelector('aside[aria-label="Pytanie klienta"]');

describe("Reguła doganiania dołu", () => {
  it("agent stojący na dole dogania nowy wpis", () => {
    expect(dogonicDol({ scrollHeight: 900, scrollTop: 900, clientHeight: 0 })).toBe(true);
  });

  it("kilkadziesiąt pikseli od dołu to wciąż dół", () => {
    /* Próg istnieje, bo dokładne zero trafia się rzadko: przewijanie kółkiem
       zatrzymuje się parę pikseli przed krawędzią, a `scrollTop` bywa ułamkiem. */
    expect(dogonicDol({ scrollHeight: 900, scrollTop: 830, clientHeight: 0 })).toBe(true);
  });

  it("agent przewinięty w górę NIE jest doganiany", () => {
    /* To jest cała treść tej reguły. Ściąganie czytającego na dół przy każdej
       nowej wiadomości gubiłoby miejsce, w którym był. */
    expect(dogonicDol({ scrollHeight: 900, scrollTop: 0, clientHeight: 300 })).toBe(false);
  });
});

describe("Oś zjeżdża na dół sama", () => {
  beforeEach(() => {
    /* jsdom oddaje zera na każdą miarę układu. Podstawiamy jedną wysokość na
       prototypie, bo elementu listy nie ma jeszcze w chwili renderu — a to
       właśnie render odpala efekt, który mamy sprawdzić. */
    Object.defineProperty(HTMLElement.prototype, "scrollHeight",
      { configurable: true, get: () => WYSOKOSC });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  });

  it("otwarcie rozmowy stawia agenta na najświeższym wpisie", () => {
    const { container } = os([pytanie(), nasza()]);
    expect(lista(container).scrollTop).toBe(WYSOKOSC);
  });

  it("przełączenie na inną rozmowę zjeżdża ponownie", () => {
    const { container, rerender } = os([pytanie(), nasza()]);
    const el = lista(container);
    el.scrollTop = 0;
    fireEvent.scroll(el);

    rerender(<Os wpisy={[pytanie(), nasza()]} rozmowaId={2} skokNaDol={0}
      zrodloPomiaru={null} mozeZlecac={false}
      onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    expect(el.scrollTop).toBe(WYSOKOSC);
  });

  it('„Pokaż” zjeżdża, choć agent stoi wysoko', () => {
    /* Bez tego licznika przycisk pod banerem nowej wiadomości nie robiłby nic
       widocznego: sam nowy wpis nie dogania agenta przewiniętego w górę. */
    const { container, rerender } = os([pytanie()]);
    const el = lista(container);
    el.scrollTop = 0;
    fireEvent.scroll(el);

    rerender(<Os wpisy={[pytanie()]} rozmowaId={1} skokNaDol={1}
      zrodloPomiaru={null} mozeZlecac={false}
      onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    expect(el.scrollTop).toBe(WYSOKOSC);
  });

  it("nowy wpis NIE ściąga agenta, który przewinął w górę", () => {
    const { container, rerender } = os([pytanie()]);
    const el = lista(container);
    el.scrollTop = 0;
    fireEvent.scroll(el);

    rerender(<Os wpisy={[pytanie(), nasza()]} rozmowaId={1} skokNaDol={0}
      zrodloPomiaru={null} mozeZlecac={false}
      onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    expect(el.scrollTop).toBe(0);
  });

  it("nowy wpis dogania agenta, który stał na dole", () => {
    const { container, rerender } = os([pytanie()]);
    const el = lista(container);
    el.scrollTop = WYSOKOSC;
    fireEvent.scroll(el);
    /* Zerujemy BEZ zdarzenia: tak wygląda dorośnięcie listy o nowy wpis —
       pozycja zapamiętana zostaje ta z ostatniego ruchu agenta. */
    el.scrollTop = 0;

    rerender(<Os wpisy={[pytanie(), nasza()]} rozmowaId={1} skokNaDol={0}
      zrodloPomiaru={null} mozeZlecac={false}
      onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    expect(el.scrollTop).toBe(WYSOKOSC);
  });
});

describe("Pytanie klienta przypięte nad edytorem", () => {
  it("w kadrze — paska NIE MA, bo dublowałby zdanie o krok wyżej", () => {
    const { container } = os([pytanie()]);
    expect(pasek(container)).toBeNull();
  });

  it("poza kadrem — pasek się pokazuje", () => {
    const { container } = os([pytanie()]);
    act(() => ustawKadr(false));
    expect(pasek(container)).not.toBeNull();
    expect(pasek(container)!.textContent).toContain("Czy ten szarpak pasuje");
  });

  it("pasek niesie OSTATNIE pytanie klienta, nie ostatni wpis osi", () => {
    /* Dół osi bywa naszą odpowiedzią, notatką kolegi albo wynikiem z hali.
       Agent odpowiada na ostatnią wypowiedź KLIENTA i to ona ma być przypięta. */
    const { container } = os([
      pytanie({ id: "msg-1", tresc: "Pierwsze pytanie." }),
      pytanie({ id: "msg-3", tresc: "A jednak drugie pytanie." }),
      nasza({ id: "msg-4" }),
      { id: "kom-1", rodzaj: "komentarz", autor: "Ala", odKlienta: false,
        tresc: "Trudny klient.", at: "2026-09-01T12:00:00Z", ofertaId: null },
    ]);
    act(() => ustawKadr(false));
    const t = pasek(container)!.textContent ?? "";
    expect(t).toContain("A jednak drugie pytanie.");
    expect(t).not.toContain("Pierwsze pytanie.");
    expect(t).not.toContain("Trudny klient.");
  });

  it("rozmowa bez wypowiedzi klienta nie ma czego przypiąć", () => {
    const { container } = os([nasza()]);
    act(() => ustawKadr(false));
    expect(pasek(container)).toBeNull();
  });

  it("powrót pytania do kadru zdejmuje pasek", () => {
    const { container } = os([pytanie()]);
    act(() => ustawKadr(false));
    expect(pasek(container)).not.toBeNull();
    act(() => ustawKadr(true));
    expect(pasek(container)).toBeNull();
  });

  it('„Pokaż w rozmowie” prowadzi na oś, a nie tylko odsłania pasek', () => {
    /* Pasek jest PRZYPOMNIENIEM przyciętym do dwóch wierszy. Pełne zdanie,
       załączniki i „Zleć z tej wiadomości" zostają na osi — przycisk ma tam
       zaprowadzić, bo inaczej pasek stałby się drugim miejscem do czytania. */
    const skok = vi.spyOn(Element.prototype, "scrollIntoView");
    const { container } = os([pytanie()]);
    act(() => ustawKadr(false));
    skok.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Pokaż w rozmowie" }));
    expect(skok).toHaveBeenCalled();
    skok.mockRestore();
  });
});
