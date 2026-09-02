import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MIN_DLUGOSC, PRZERWA_MS, ZWLOKA_MS, useSkaner } from "./skaner";

/* Czytnik i człowiek piszą tą samą klawiaturą, a ekran zwrotów ma pod cyframi
   przełączanie kubełków. Te testy pilnują granicy między jednym a drugim —
   bo pomyłka w tę stronę znaczy kubełki skaczące przy każdym skanie, a w tamtą
   skróty, które przestały działać. */

const ETYKIETA = "600000367616070023174201";

/** Czytnik: znak co 5 ms, na końcu Enter. */
function skanuj(kod: string, odstep = 5) {
  for (const znak of kod) {
    vi.advanceTimersByTime(odstep);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: znak }));
  }
  vi.advanceTimersByTime(odstep);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

describe("Czytnik kodów w panelu", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cała etykieta wchodzi jako JEDEN kod, a skróty milczą", () => {
    /* Sedno sprawy: `600000367616070023174201` zawiera cyfry 1–6, czyli
       wszystkie klawisze kubełków ekranu zwrotów. */
    const onSkan = vi.fn();
    const onZnak = vi.fn();
    renderHook(() => useSkaner(onSkan, onZnak));

    skanuj(ETYKIETA);

    expect(onSkan).toHaveBeenCalledTimes(1);
    expect(onSkan).toHaveBeenCalledWith(ETYKIETA);
    expect(onZnak).not.toHaveBeenCalled();
  });

  it("pojedynczy klawisz człowieka dalej jest skrótem", () => {
    const onSkan = vi.fn();
    const onZnak = vi.fn();
    renderHook(() => useSkaner(onSkan, onZnak));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" }));
    /* Nikt nie wciska drugiego klawisza w czterdzieści milisekund. */
    vi.advanceTimersByTime(ZWLOKA_MS + 1);

    expect(onZnak).toHaveBeenCalledTimes(1);
    expect((onZnak.mock.calls[0][0] as KeyboardEvent).key).toBe("3");
    expect(onSkan).not.toHaveBeenCalled();
  });

  it("człowiek piszący wolno nie jest czytnikiem", () => {
    const onSkan = vi.fn();
    const onZnak = vi.fn();
    renderHook(() => useSkaner(onSkan, onZnak));

    for (const znak of "123") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: znak }));
      vi.advanceTimersByTime(PRZERWA_MS + 10);
    }
    expect(onSkan).not.toHaveBeenCalled();
    expect(onZnak).toHaveBeenCalledTimes(3);
  });

  it("krótka seria zakończona Enterem to nie kod", () => {
    /* Żaden numer listu ani zwrotu nie ma pięciu znaków; taka seria to raczej
       zabłąkane stuknięcie niż skan. */
    const onSkan = vi.fn();
    renderHook(() => useSkaner(onSkan));
    skanuj("12345");
    expect(onSkan).not.toHaveBeenCalled();
    expect(MIN_DLUGOSC).toBe(6);
  });

  it("hook milczy, gdy kursor stoi w polu tekstowym", () => {
    /* Pole obsługuje wpisywanie i Enter samo — inaczej ręcznie wpisany numer
       poleciałby dwiema drogami naraz. */
    const onSkan = vi.fn();
    const onZnak = vi.fn();
    renderHook(() => useSkaner(onSkan, onZnak));

    const pole = document.createElement("input");
    document.body.appendChild(pole);
    for (const znak of ETYKIETA) {
      vi.advanceTimersByTime(5);
      pole.dispatchEvent(new KeyboardEvent("keydown", { key: znak, bubbles: true }));
    }
    pole.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onSkan).not.toHaveBeenCalled();
    expect(onZnak).not.toHaveBeenCalled();
    pole.remove();
  });

  it("skrót z klawiszem modyfikującym nie jest ani skanem, ani znakiem", () => {
    /* Ctrl+F należy do przeglądarki i panel nie ma prawa go przechwytywać. */
    const onSkan = vi.fn();
    const onZnak = vi.fn();
    renderHook(() => useSkaner(onSkan, onZnak));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
    vi.advanceTimersByTime(ZWLOKA_MS + 1);
    expect(onSkan).not.toHaveBeenCalled();
    expect(onZnak).not.toHaveBeenCalled();
  });

  it("dwa skany pod rząd czyta jako dwa kody", () => {
    const onSkan = vi.fn();
    renderHook(() => useSkaner(onSkan));
    skanuj(ETYKIETA);
    vi.advanceTimersByTime(PRZERWA_MS + 10);
    skanuj("1234/Z04A");
    expect(onSkan.mock.calls.map((c) => c[0])).toEqual([ETYKIETA, "1234/Z04A"]);
  });
});
