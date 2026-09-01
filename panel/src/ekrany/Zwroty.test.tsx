import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Kubelek, Zwrot } from "../api/typy";

/* Ten plik istnieje przez usterkę znalezioną OKIEM, nie testem: przełączenie
   kubełka zmieniało listę, ale zostawiało kursor na zwrocie z poprzedniego
   kubełka. Środkowa kolumna pokazywała wtedy pytanie nowego kubełka nad
   klawiszami starego, a operator musiał dokliknąć wiersz — czyli zrobić
   dokładnie to jedno kliknięcie, którego ten ekran ma nie mieć. */

const zwrot = (id: number, kubelek: Kubelek, numer: string): Zwrot => ({
  id, externalId: `zw-${id}`, numer, orderId: `ord-${id}`,
  utworzono: "2026-08-25T09:00:00.000Z", paczkaAt: "2026-08-28T09:00:00.000Z",
  kubelek, sygnaly: [], terminAt: "2026-09-08T09:00:00.000Z", dniDoTerminu: 7,
  sumaPozycjiGrosze: 4999, waluta: "PLN", werdykt: null, kwotaGrosze: null,
  kwotaWariant: null, korektaNumer: null, rejectionCode: null, wersja: 1,
  pozycje: [{ id, offerId: "1", nazwa: "Sekator", ilosc: 1, cenaGrosze: 4999,
    waluta: "PLN", powod: null, powodKomentarz: null, ocena: kubelek === "zwrot" ? "stan" : null }],
});

const ZWROTY = [zwrot(1, "decyzja", "ZW-1"), zwrot(2, "zwrot", "ZW-2")];

vi.mock("../api/zwroty", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/zwroty")>("../api/zwroty");
  return {
    ...rzeczywisty,
    useZwroty: () => ({
      data: { zwroty: ZWROTY, liczniki: { decyzja: 1, ocena: 0, zwrot: 1, korekta: 0,
        zamkniety: 0, odrzucony: 0 }, stan: {} },
      isLoading: false, error: null,
    }),
  };
});

const { Zwroty } = await import("./Zwroty");

const pokaz = (adres = "/obsluga/zwroty") =>
  render(<MemoryRouter initialEntries={[adres]}>
    <Routes>
      <Route path="/obsluga/zwroty" element={<Zwroty />} />
      <Route path="/obsluga/zwroty/:id" element={<Zwroty />} />
    </Routes>
  </MemoryRouter>);

describe("Ekran zwrotów", () => {
  it("kubełek niesie pytanie, a nie samą etykietę", () => {
    pokaz();
    expect(screen.getByText("Przyjąć czy odrzucić?")).toBeInTheDocument();
  });

  it("przełączenie kubełka przestawia też kursor na pierwszy zwrot", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Do zwrotu/ }));
    /* Nagłówek środkowej kolumny i klawisze mają opisywać TEN SAM zwrot. */
    expect(screen.getByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
    expect(screen.getByText("Kwota proponowana")).toBeInTheDocument();
    expect(screen.queryByText("Przyjmij")).not.toBeInTheDocument();
  });

  it("wejście z paska adresu na zwrot z innego kubełka przestawia kubełek", async () => {
    /* Adres jest źródłem prawdy: link do sprawy wklejony koledze ma pokazać
       tę sprawę, a nie pustą listę pod inną zakładką. */
    pokaz("/obsluga/zwroty/2");
    expect(await screen.findByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
    expect(screen.getAllByText("Ile oddać?").length).toBeGreaterThan(0);
  });

  it("bez wybranego zwrotu ekran prosi o wybór, zamiast pokazywać pustkę", () => {
    pokaz();
    expect(screen.getByText(/Wybierz zwrot z kolejki/)).toBeInTheDocument();
  });

  it("mówi wprost, że to wydanie tylko czyta", () => {
    /* Przycisk, który wygląda na działający i nie działa, jest gorszy od
       jego braku. Zdanie musi być na ekranie, nie tylko w CHANGELOG-u. */
    pokaz("/obsluga/zwroty/1");
    expect(screen.getByText(/To wydanie tylko czyta/)).toBeInTheDocument();
  });
});
