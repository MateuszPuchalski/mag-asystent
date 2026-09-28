import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { KandydatZamowienia } from "../api/typy";

const wskaz = vi.fn();
vi.mock("../api/rozmowy", () => ({
  useWskazZamowienie: () => ({ mutate: wskaz, isPending: false }),
}));

const { BrakZakupu, PYTANIE_O_ZAMOWIENIE } = await import("./BrakZakupu");

/* ── Brakujący zakup nad polem odpowiedzi (0.547.0) ─────────────────────────
   Pasek istnieje po to, żeby odpowiedź nie powstawała na domysłach. Testy
   pilnują czterech decyzji:

   1. Pasek stoi TYLKO przy rozmowie bez zamówienia i z kandydatem. Przy
      związanej rozmowie mówiłby o czymś, co się już nie dzieje.
   2. Wiąże KLIKNIĘCIE, tym samym `wskaz` co kolumna, z numerem pokazanego zakupu.
   3. Drugie wyjście dopisuje pytanie o numer, raz, bez dublowania.
   4. Przy kilku zakupach pasek nie udaje, że pierwszy jest jedyny.        */

const kandydat = (n: Partial<KandydatZamowienia> = {}): KandydatZamowienia => ({
  externalId: "4e3b1f20-aaaa-bbbb-cccc-000000000001", link: null, status: "READY_FOR_PROCESSING",
  kupionoAt: "2026-09-21T08:00:00.000Z", sumaGrosze: 12900, waluta: "PLN",
  pozycje: "Nóż do kosiarki NAC LS 46", maTeOferte: false, ...n,
});

beforeEach(() => { wskaz.mockReset(); });

function pokaz(n: Partial<React.ComponentProps<typeof BrakZakupu>> = {}) {
  const wstaw = vi.fn();
  render(<BrakZakupu kandydaci={[kandydat()]} rozmowaId={42} maZamowienie={false} szkic=""
    onWstawDoSzkicu={wstaw} {...n} />);
  return wstaw;
}

describe("brakujący zakup nad polem odpowiedzi", () => {
  it("mówi, że rozmowa nie ma zamówienia, i pokazuje zakup tego loginu", () => {
    pokaz();
    expect(screen.getByText("Rozmowa nie ma zamówienia.")).toBeInTheDocument();
    expect(screen.getByText("Ten login kupił:")).toBeInTheDocument();
    expect(screen.getByText("Nóż do kosiarki NAC LS 46")).toBeInTheDocument();
    expect(screen.getByText(/129,00/)).toBeInTheDocument();
  });

  it("nie stoi przy związanej rozmowie ani bez kandydata", () => {
    const { container } = render(<BrakZakupu kandydaci={[kandydat()]} rozmowaId={1} maZamowienie
      szkic="" onWstawDoSzkicu={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    const drugi = render(<BrakZakupu kandydaci={[]} rozmowaId={1} maZamowienie={false}
      szkic="" onWstawDoSzkicu={() => {}} />);
    expect(drugi.container).toBeEmptyDOMElement();
  });

  it("wiąże dopiero kliknięcie, z numerem pokazanego zakupu", async () => {
    pokaz();
    expect(wskaz).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Powiąż ten zakup/ }));
    expect(wskaz).toHaveBeenCalledWith(
      { id: 42, externalId: "4e3b1f20-aaaa-bbbb-cccc-000000000001" }, expect.anything());
  });

  it("błąd wiązania staje w pasku zdaniem, nie ginie", async () => {
    wskaz.mockImplementation((_v, o: { onError: (e: Error) => void }) =>
      o.onError(new Error("Zamówienie należy do innego loginu")));
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Powiąż ten zakup/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Zamówienie należy do innego loginu");
  });

  it("„Wstaw pytanie” dopisuje zdanie o numer do odpowiedzi", async () => {
    const wstaw = pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Wstaw pytanie o numer zamówienia/ }));
    expect(wstaw).toHaveBeenCalledWith(PYTANIE_O_ZAMOWIENIE);
  });

  it("pytania już w odpowiedzi nie da się dopisać drugi raz", () => {
    pokaz({ szkic: `Dzień dobry. ${PYTANIE_O_ZAMOWIENIE}` });
    expect(screen.queryByRole("button", { name: /Wstaw pytanie/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Powiąż ten zakup/ })).toBeInTheDocument();
  });

  it("przy kilku zakupach mówi ile i gdzie reszta, z plakietką oferty", () => {
    pokaz({ kandydaci: [kandydat({ externalId: "z-oferta", maTeOferte: true }), kandydat({ externalId: "b" }),
      kandydat({ externalId: "c" })] });
    expect(screen.getByText("Ten login ma 3 zakupy, pierwszy:")).toBeInTheDocument();
    expect(screen.getByText("ta oferta")).toBeInTheDocument();
    expect(screen.getByText(/Pozostałe w kolumnie kontekstu/)).toBeInTheDocument();
  });
});
