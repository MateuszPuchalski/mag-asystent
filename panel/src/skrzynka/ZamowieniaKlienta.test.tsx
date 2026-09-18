import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { KandydatZamowienia } from "../api/typy";

const wskaz = vi.fn();
vi.mock("../api/rozmowy", () => ({
  useWskazZamowienie: () => ({ mutate: wskaz, isPending: false }),
}));

const { ZamowieniaKlienta } = await import("./ZamowieniaKlienta");

/* ── Zakupy tego klienta przy rozmowie (0.397.0) ─────────────────────────────
   Zgłoszenie właściciela ze zrzutem: klient napisał pod OFERTĄ „otrzymałem
   paczkę, ale nie było w zestawie świecy" — a rozmowa nie miała zamówienia
   wcale, bo wątek Allegro niesie JEDEN obiekt powiązany.

   Testy pilnują czterech rzeczy, bo każda jest decyzją:

   1. BLOK MÓWI POWÓD, gdy powiązania nie ma. „Brak zamówienia" bez zdania
      wygląda jak usterka panelu, a to jest kształt danych z Allegro.
   2. WIĄŻE KLIKNIĘCIE, nie automat. Ten sam login nie znaczy „ta paczka".
   3. PLAKIETKA TŁUMACZY KOLEJNOŚĆ. Bez niej pierwszeństwo byłoby magią.
   4. PRZY ZWIĄZANEJ ROZMOWIE blok schodzi pod przycisk — poprawka jest wtedy
      możliwa, ale nie jest główną czynnością ekranu.                        */

const kandydat = (n: Partial<KandydatZamowienia> = {}): KandydatZamowienia => ({
  externalId: "4e3b1f20-aaaa-bbbb-cccc-000000000001", link: null, status: "READY_FOR_PROCESSING",
  kupionoAt: "2026-09-15T08:00:00.000Z", sumaGrosze: 5500, waluta: "PLN",
  pozycje: "Filtr powietrza DOV+OLEJ", maTeOferte: false, ...n,
});

describe("zakupy tego klienta", () => {
  it("bez powiązania mówi, DLACZEGO zamówienia nie ma", () => {
    render(<ZamowieniaKlienta kandydaci={[kandydat()]} rozmowaId={1} maZamowienie={false} />);
    expect(screen.getByText(/Klient napisał pod ofertą/)).toBeInTheDocument();
    expect(screen.getByText("Filtr powietrza DOV+OLEJ")).toBeInTheDocument();
  });

  it("wiąże dopiero KLIKNIĘCIE, z numerem wskazanego zakupu", async () => {
    render(<ZamowieniaKlienta kandydaci={[kandydat()]} rozmowaId={42} maZamowienie={false} />);
    expect(wskaz).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /to ta paczka/ }));
    expect(wskaz).toHaveBeenCalledWith(
      { id: 42, externalId: "4e3b1f20-aaaa-bbbb-cccc-000000000001" },
      expect.anything(),
    );
  });

  it("zakup z OFERTĄ Z ROZMOWY nosi plakietkę, która tłumaczy kolejność", () => {
    render(<ZamowieniaKlienta maZamowienie={false} rozmowaId={1} kandydaci={[
      kandydat({ externalId: "z-oferta", maTeOferte: true }),
      kandydat({ externalId: "bez-oferty" }),
    ]} />);
    expect(screen.getAllByText("ta oferta")).toHaveLength(1);
  });

  it("przy ZWIĄZANEJ rozmowie lista chowa się pod przyciskiem", async () => {
    /* Klient miewa kilka paczek, więc droga do poprawki zostaje — ale nie
       zabiera miejsca odpowiedzi, którą agent właśnie pisze. */
    render(<ZamowieniaKlienta kandydaci={[kandydat()]} rozmowaId={1} maZamowienie />);
    expect(screen.queryByRole("button", { name: /to ta paczka/ })).toBeNull();
    expect(screen.queryByText(/Klient napisał pod ofertą/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /to nie ta paczka/ }));
    expect(screen.getByRole("button", { name: /to ta paczka/ })).toBeInTheDocument();
  });

  it("bez kandydatów nie rysuje pustej sekcji", () => {
    /* Klient bez ani jednego zakupu u nas: pusty blok byłby obietnicą, że coś
       da się tu wskazać. */
    const { container } = render(
      <ZamowieniaKlienta kandydaci={[]} rozmowaId={1} maZamowienie={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
