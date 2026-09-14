import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { WiedzaAutomat } from "./WiedzaAutomat";
import type { WpisAutomatu } from "../api/typy";

/* ── Co automat dopisał (0.331.0) ────────────────────────────────────────────
   Karta jest drugą połową decyzji „kolejka opróżnia się sama". Testy pilnują
   trzech rzeczy, bo każda decyduje o tym, czy da się to prostować:

   1. PUSTA LISTA NIE UDAJE SUKCESU. „Automat nic nie dopisał" to zdanie
      o automacie, nie pochwała — bo najczęstszy powód pustki to wyłączony takt.
   2. WIDAĆ SYMBOL I CZEGO WPIS DOTYCZY. Bez symbolu nie ma czego sprawdzić.
   3. RODZAJ JEST WIDOCZNY. Zastosowanie i pasowanie cofa się gdzie indziej.  */

const w = (n: Partial<WpisAutomatu> = {}): WpisAutomatu => ({
  rodzaj: "zastosowanie", id: 1, symbol: "SZR-148/82",
  etykieta: "NAC LS 46-450", at: "2026-09-14T08:00:00.000Z", ...n,
});

describe("karta wpisów automatu wiedzy", () => {
  test("bez danych karty nie ma — pusta ramka to obietnica, że coś się liczy", () => {
    const { container } = render(<WiedzaAutomat wpisy={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  test("pusta lista mówi, co znaczy, zamiast rysować sukces", () => {
    render(<WiedzaAutomat wpisy={[]} />);
    expect(screen.getByText(/Automat nic nie dopisał/)).toBeTruthy();
  });

  test("wpis niesie symbol, czego dotyczy i swój rodzaj", () => {
    render(<WiedzaAutomat wpisy={[
      w(),
      w({ rodzaj: "pasowanie", id: 2, symbol: "USZ-0042", etykieta: "pasuje do GLO-0001" }),
    ]} />);

    expect(screen.getByText("SZR-148/82")).toBeTruthy();
    expect(screen.getByText("NAC LS 46-450")).toBeTruthy();
    expect(screen.getByText("zastosowanie")).toBeTruthy();
    expect(screen.getByText("pasowanie")).toBeTruthy();
  });

  test("karta prowadzi o krok dalej — mówi, że to jest do sprawdzenia", () => {
    render(<WiedzaAutomat wpisy={[w()]} />);
    expect(screen.getByText(/zatwierdzone bez człowieka/i)).toBeTruthy();
  });
});
