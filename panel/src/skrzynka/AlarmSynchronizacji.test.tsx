import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlarmSynchronizacji, wiek } from "./AlarmSynchronizacji";
import type { Zdrowie } from "../api/typy";

const zdrowie = (n: Partial<Zdrowie["allegroInbox"]> = {}): Zdrowie => ({
  allegroInbox: {
    status: "rate_limited", alarm: true,
    ostatniaProba: "2026-09-01T09:38:00.000Z",
    ostatniaUdanaSynchronizacja: "2026-09-01T07:05:00.000Z",
    kodOstatniegoBledu: 429, tekstOstatniegoBledu: null, liczbaBledow: 3, watkiZBledem: 2,
    opoznienieMs: 9_360_000, nastepnaProba: "2026-09-01T10:12:00.000Z",
    interwalMs: 60_000, ...n,
  },
  obsluga: { rozmowyOczekujace: 14, zadaniaTerenowe: 3, najstarszeZadanieMs: 4_320_000,
    kolejkaWysylek: "wysyłka wyłączona" },
});

describe("AlarmSynchronizacji", () => {
  it("milczy, dopóki nie ma alarmu", () => {
    /* §21 stawia próg na WIĘCEJ niż dwa nieudane przebiegi. Baner przy
       pierwszym potknięciu nauczyłby biuro go ignorować. */
    const { container } = render(<AlarmSynchronizacji zdrowie={zdrowie({ alarm: false })}
      synchronizuj={() => {}} trwa={false} blad="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mówi, ile przebiegów padło, dlaczego i jak stare są dane", () => {
    render(<AlarmSynchronizacji zdrowie={zdrowie()} synchronizuj={() => {}} trwa={false} blad="" />);
    expect(screen.getByText(/przez 3 przebiegi/)).toBeInTheDocument();
    expect(screen.getByText(/429/)).toBeInTheDocument();
    expect(screen.getByText(/2 g 36 min/)).toBeInTheDocument();
  });

  it("nie obiecuje, że ręczna synchronizacja ominie przerwę", () => {
    render(<AlarmSynchronizacji zdrowie={zdrowie()} synchronizuj={() => {}} trwa={false} blad="" />);
    expect(screen.getByText(/nie omija tej przerwy/)).toBeInTheDocument();
  });

  it("przycisk woła synchronizację i wyłącza się na czas próby", async () => {
    const klik = vi.fn();
    const { rerender } = render(<AlarmSynchronizacji zdrowie={zdrowie()}
      synchronizuj={klik} trwa={false} blad="" />);
    await userEvent.click(screen.getByRole("button", { name: /SYNCHRONIZUJ TERAZ/ }));
    expect(klik).toHaveBeenCalledOnce();
    rerender(<AlarmSynchronizacji zdrowie={zdrowie()} synchronizuj={klik} trwa blad="" />);
    expect(screen.getByRole("button", { name: /PRÓBA W TOKU/ })).toBeDisabled();
  });

  it("błąd konta mówi o koncie, nie o limicie", () => {
    render(<AlarmSynchronizacji zdrowie={zdrowie({ status: "authentication_error", kodOstatniegoBledu: 401 })}
      synchronizuj={() => {}} trwa={false} blad="" />);
    expect(screen.getByText(/sparować ponownie/)).toBeInTheDocument();
  });
});

describe("wiek()", () => {
  it("mówi po ludzku, ile danych brakuje", () => {
    expect(wiek(null)).toBe("—");
    expect(wiek(30_000)).toBe("poniżej minuty");
    expect(wiek(41 * 60_000)).toBe("41 min");
    expect(wiek(9_360_000)).toBe("2 g 36 min");
  });
});

describe("AlarmSynchronizacji — konto niepołączone (0.152.0)", () => {
  /* Przy niesparowanym koncie SYNCHRONIZUJ TERAZ wywołuje dokładnie ten sam
     błąd, na którym stoi skrzynka. Przycisk, który na pewno nie zadziała,
     jest gorszy niż jego brak: obiecuje naprawę i zabiera uwagę od tej
     jedynej rzeczy, która pomaga. */
  const nieSparowane = (): Zdrowie => ({
    ...zdrowie({ status: "failed", liczbaBledow: 62, kodOstatniegoBledu: null }),
    allegro: { stan: "niepolaczone" },
    problemy: ["ALLEGRO_CLIENT_ID ustawione, ale konto niepołączone — /biuro → " +
      "STAN SYSTEMU → KONTO ALLEGRO → POŁĄCZ (rola admin)."],
  });

  it("chowa przycisk synchronizacji i mówi, co zrobić zamiast niego", () => {
    render(<AlarmSynchronizacji zdrowie={nieSparowane()} synchronizuj={() => {}}
      trwa={false} blad="" />);

    expect(screen.queryByRole("button", { name: /SYNCHRONIZUJ/ })).toBeNull();
    expect(screen.getByText(/KONTO ALLEGRO/)).toBeTruthy();
  });

  it("przy sparowanym koncie przycisk zostaje", () => {
    render(<AlarmSynchronizacji zdrowie={zdrowie()} synchronizuj={() => {}}
      trwa={false} blad="" />);
    expect(screen.getByRole("button", { name: /SYNCHRONIZUJ/ })).toBeTruthy();
  });
});
