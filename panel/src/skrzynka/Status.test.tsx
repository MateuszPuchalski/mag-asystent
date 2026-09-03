import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Status } from "./Status";
import type { Rozmowa } from "../api/typy";

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 4821, klient: "Kupujący 44300444",
  ostatniaWiadomosc: "Czy ten szarpak pasuje do NAC LS 46-450?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "new", odlozoneDo: null, poTerminie: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "not_started",
  kopilot: null, ...n,
});

describe("Status rozmowy", () => {
  it("pokazuje stan bieżący po polsku, także gdy nikt go nie ruszył", () => {
    /* „Nowa" jest informacją, nie brakiem informacji: znaczy, że sprawy nikt
       nie tknął. Pole musi mieć opcję dla wartości, którą pokazuje. */
    render(<Status rozmowa={rozmowa()} zapisuje={false} blad="" onZmien={() => {}} onPriorytet={() => {}} zapisujePriorytet={false} />);
    expect(screen.getByRole("combobox", { name: /Status rozmowy/ })).toHaveValue("new");
    expect(screen.getAllByText("Nowa").length).toBeGreaterThan(0);
  });

  it("zwykła zmiana idzie od razu, bez terminu", async () => {
    const zmien = vi.fn();
    render(<Status rozmowa={rozmowa({ status: "open" })} zapisuje={false} blad=""
      onZmien={zmien} onPriorytet={() => {}} zapisujePriorytet={false} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Status rozmowy/ }),
      "resolved");
    expect(zmien).toHaveBeenCalledWith("resolved", null);
  });

  it("odłożenie pyta o termin PRZED wysłaniem, a nie po odmowie serwera", async () => {
    /* Serwer odrzuca `snoozed` bez terminu — §7 nie zna rozmowy odłożonej na
       zawsze. Agent nie ma się dowiadywać o tej regule z komunikatu błędu. */
    const zmien = vi.fn();
    render(<Status rozmowa={rozmowa({ status: "open" })} zapisuje={false} blad=""
      onZmien={zmien} onPriorytet={() => {}} zapisujePriorytet={false} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Status rozmowy/ }),
      "snoozed");
    expect(zmien).not.toHaveBeenCalled();

    const przycisk = screen.getByRole("button", { name: "ODŁÓŻ" });
    expect(przycisk).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Termin odłożenia/), "2026-09-08T07:00");
    await userEvent.click(przycisk);
    expect(zmien).toHaveBeenCalledTimes(1);
    const [status, doKiedy] = zmien.mock.calls[0];
    expect(status).toBe("snoozed");
    /* Pole oddaje czas lokalny bez strefy; do serwera ma dojechać ISO. */
    expect(doKiedy).toBe(new Date("2026-09-08T07:00").toISOString());
  });

  it("miniony termin odłożenia jest widoczny, bo wiersz wygląda jak zwykły otwarty", () => {
    render(<Status rozmowa={rozmowa({ status: "open", poTerminie: true,
      odlozoneDo: "2026-08-30T06:00:00.000Z" })} zapisuje={false} blad="" onZmien={() => {}} onPriorytet={() => {}} zapisujePriorytet={false} />);
    expect(screen.getByText(/termin odłożenia minął/)).toBeInTheDocument();
  });

  it("odmowa serwera ląduje przy przełączniku, nie w ogólnym pasku błędów", () => {
    render(<Status rozmowa={rozmowa()} zapisuje={false}
      blad="Odłożenie wymaga terminu" onZmien={() => {}} onPriorytet={() => {}} zapisujePriorytet={false} />);
    expect(screen.getByText(/Odłożenie wymaga terminu/)).toBeInTheDocument();
  });
});

/* ── Priorytet (§10.2, 0.181.0) ──────────────────────────────────────────── */

describe("ręczna flaga „pilne”", () => {
  it("przełącznik pokazuje stan i podnosi flagę", async () => {
    const onPriorytet = vi.fn();
    render(<Status rozmowa={rozmowa()} zapisuje={false} blad="" onZmien={() => {}}
      onPriorytet={onPriorytet} zapisujePriorytet={false} />);
    const p = screen.getByRole("button", { name: /Oznacz jako pilne/ });
    expect(p).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(p);
    expect(onPriorytet).toHaveBeenCalledWith("pilny");
  });

  it("podniesiona flaga daje się opuścić tym samym przyciskiem", async () => {
    const onPriorytet = vi.fn();
    render(<Status rozmowa={rozmowa({ priorytet: "pilny" })} zapisuje={false} blad=""
      onZmien={() => {}} onPriorytet={onPriorytet} zapisujePriorytet={false} />);
    const p = screen.getByRole("button", { name: "PILNE" });
    expect(p).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(p);
    expect(onPriorytet).toHaveBeenCalledWith("normalny");
  });
});

/* ── Stan raz, nie dwa (0.192.0) ─────────────────────────────────────────────
   Do 0.191.1 pasek statusu rysował plakietkę ze stanem, a obok pole wyboru
   z TĄ SAMĄ wartością: jedno pasmo nagłówka mówiło „OTWARTA" dwukrotnie.
   §7 żąda, żeby nagłówek pokazywał stan zawsze — pokazuje, w rzeczy, którą
   się go zmienia.                                                            */
describe("Stan rozmowy stoi w nagłówku raz", () => {
  it("nazwa stanu bieżącego pada dokładnie jeden raz", () => {
    render(<Status rozmowa={rozmowa({ status: "open" })} zapisuje={false} blad=""
      onZmien={() => {}} onPriorytet={() => {}} zapisujePriorytet={false} />);
    /* Jedyne wystąpienie to opcja w polu wyboru — plakietki obok już nie ma. */
    expect(screen.getAllByText("Otwarta")).toHaveLength(1);
  });

  it("pole wyboru niesie barwę stanu, więc stan dalej czyta się rzutem oka", () => {
    /* Barwa była wcześniej na plakietce. Znikła plakietka, nie barwa —
       inaczej „pokazuj stan zawsze" zamieniłoby się w listę rozwijaną
       nie do odróżnienia od każdej innej. */
    render(<Status rozmowa={rozmowa({ status: "open" })} zapisuje={false} blad=""
      onZmien={() => {}} onPriorytet={() => {}} zapisujePriorytet={false} />);
    expect(screen.getByRole("combobox", { name: /Status rozmowy/ }).className)
      .toMatch(/bg-stan-open/);
  });
});
