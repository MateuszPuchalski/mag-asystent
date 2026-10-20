import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Edytor } from "./Edytor";

/* ── Zdjęcie do odpowiedzi przez Ctrl+V ──────────────────────────────────────
   Zrzut ekranu wklejony w pole odpowiedzi dołącza się jak plik ze spinacza.
   Testy pilnują trzech rzeczy:

   1. Obraz idzie do `onDodajZalacznik`, a w polu nie zostaje nic.
   2. Tekst wygrywa z obrazem: Word kładzie obok akapitu jego obrazek.
   3. Blokady spinacza obowiązują też wklejenie — cudza rozmowa i wysyłka. */

const props = {
  szkic: "", onZmiana: vi.fn(), cudza: false, wlasciciel: null as string | null,
  zapisuje: false, wysyla: false, onZapisz: vi.fn(), onWyslij: vi.fn(),
  zalaczniki: [] as import("../api/rozmowy").ZalacznikSzkicu[],
  dodajeZalacznik: false, bladZalacznika: "", onUsunZalacznik: vi.fn(),
};

/** Schowek tak, jak widzi go zdarzenie `paste`. jsdom nie ma `DataTransfer`. */
function schowek({ tekst = "", obraz = null as File | null } = {}) {
  return {
    getData: (typ: string) => (typ === "text/plain" ? tekst : ""),
    items: obraz ? [{ kind: "file", type: obraz.type, getAsFile: () => obraz }] : [],
  };
}

const zrzut = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });

function wklej(n: Partial<typeof props>, dane: ReturnType<typeof schowek>) {
  const onDodajZalacznik = vi.fn();
  const { unmount } = render(<Edytor {...props} {...n} onDodajZalacznik={onDodajZalacznik} />);
  const zdarzenie = fireEvent.paste(screen.getByLabelText("Szkic odpowiedzi"), { clipboardData: dane });
  unmount();
  return { onDodajZalacznik, przejete: !zdarzenie };
}

describe("wklejenie obrazu w pole odpowiedzi", () => {
  it("obraz ze schowka idzie jak plik ze spinacza", () => {
    const obraz = zrzut();
    const { onDodajZalacznik, przejete } = wklej({}, schowek({ obraz }));
    expect(onDodajZalacznik).toHaveBeenCalledWith(obraz);
    expect(przejete).toBe(true);
  });

  it("tekst z obrazkiem obok wkleja się jako tekst", () => {
    const { onDodajZalacznik, przejete } = wklej({}, schowek({ tekst: "akapit z Worda", obraz: zrzut() }));
    expect(onDodajZalacznik).not.toHaveBeenCalled();
    expect(przejete).toBe(false);
  });

  it("w cudzej rozmowie, w trakcie wysyłki i wgrywania obraz nie wchodzi", () => {
    for (const blokada of [{ cudza: true }, { wysyla: true }, { dodajeZalacznik: true }]) {
      const { onDodajZalacznik } = wklej(blokada, schowek({ obraz: zrzut() }));
      expect(onDodajZalacznik).not.toHaveBeenCalled();
    }
  });
});
