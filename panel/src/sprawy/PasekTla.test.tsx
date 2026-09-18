import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProgKolejki } from "../api/typy";
import { PasekTla, tloAlarmuje } from "./PasekTla";

/* ── Tło pracy: cisza jest cicha, alarm zostaje głośny (0.392.0) ─────────────
   Cała wartość tego pliku jest w drugiej połowie zdania. Zwinięcie paska do
   jednej linii kupuje piksele; zwinięcie ALARMU kupowałoby je za pracę,
   której nikt nie zobaczy — a dokładnie za to zapłacił próg w 0.385.0.     */

const prog = (n: Partial<ProgKolejki> = {}): ProgKolejki => ({
  od: "2026-06-30T22:00:00Z", ukrytych: 391, ukrytychZTerminem: 0, zdjety: false, ...n,
});

describe("kiedy tło alarmuje", () => {
  it("spokój: próg chowa samo archiwum, kanał działa, lista kompletna", () => {
    expect(tloAlarmuje({ prog: prog(), zlaSynchronizacja: false, pozostaloDoPobrania: 0 }))
      .toBe(false);
  });

  it("ALARM, gdy próg chowa sprawę z żywym terminem", () => {
    /* Zwykle to zero. Dzień, w którym nie jest, jest dokładnie tym dniem,
       dla którego tę liczbę liczymy. */
    expect(tloAlarmuje({ prog: prog({ ukrytychZTerminem: 2 }) })).toBe(true);
  });

  it("ALARM, gdy synchronizacja stoi albo lista jest niekompletna", () => {
    expect(tloAlarmuje({ zlaSynchronizacja: true })).toBe(true);
    expect(tloAlarmuje({ pozostaloDoPobrania: 12 })).toBe(true);
  });

  it("próg ZDJĘTY ręką nie jest alarmem — to świadomy wybór agenta", () => {
    expect(tloAlarmuje({ prog: prog({ zdjety: true, ukrytychZTerminem: 5 }) })).toBe(false);
  });
});

describe("cichy wiersz tła", () => {
  it("niesie obie rzeczy i obie akcje w jednej linii", async () => {
    const onProg = vi.fn();
    const onSync = vi.fn();
    render(<PasekTla prog={prog()} onPrzelaczProg={onProg}
      stanTekst="synchronizacja: działa" onSynchronizuj={onSync} />);

    expect(screen.getByText(/starszych/)).toBeInTheDocument();
    expect(screen.getByText("391")).toBeInTheDocument();
    expect(screen.getByText("synchronizacja: działa")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "pokaż starsze" }));
    expect(onProg).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "synchronizuj" }));
    expect(onSync).toHaveBeenCalled();
  });

  it("bez obsługi synchronizacji nie rysuje przycisku — obietnica bez pokrycia", () => {
    render(<PasekTla prog={prog()} onPrzelaczProg={vi.fn()} stanTekst="synchronizacja: działa" />);
    expect(screen.queryByRole("button", { name: "synchronizuj" })).not.toBeInTheDocument();
  });

  it("milczy, gdy nie ma czego powiedzieć", () => {
    const { container } = render(<PasekTla prog={prog({ od: null, ukrytych: 0 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("przy zdjętym progu mówi, że pokazuje wszystko — zniknięcie ma mieć uzasadnienie", () => {
    render(<PasekTla prog={prog({ zdjety: true })} onPrzelaczProg={vi.fn()} />);
    expect(screen.getByText(/wszystkie sprawy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "wróć do progu" })).toBeInTheDocument();
  });
});
