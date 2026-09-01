import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KUBELKI, Kubelki, wKubelku } from "./Kubelki";
import type { Rozmowa, StatusRozmowy } from "../api/typy";

/* Kubełki są jedynym miejscem, w którym panel decyduje, gdzie rozmowa stoi.
   Te testy pilnują dwóch rzeczy: że reguła jest ta sama dla licznika i dla
   listy ORAZ że żadna rozmowa nie wypada poza ekran. */

const JA = 7;

const rozmowa = (status: StatusRozmowy, wlascicielId: number | null = null): Rozmowa => ({
  id: 1, klient: "Kupujący", ostatniaWiadomosc: "…", ostatniaWiadomoscAt: "2026-09-02T08:00:00.000Z",
  nieprzeczytana: false, wlascicielId, wlasciciel: wlascicielId ? "Ala" : null, wersja: 1,
  status, statusZapisany: status, snoozeDo: null, wrocilaPoZamknieciu: false, oglada: null,
});

describe("Kubełki skrzynki", () => {
  it("rozmowa w toku trafia do MOICH albo do NIEPRZYPISANYCH, nie do obu", () => {
    const moja = rozmowa("open", JA);
    expect(wKubelku(moja, "moje", JA)).toBe(true);
    expect(wKubelku(moja, "nieprzypisane", JA)).toBe(false);

    const niczyja = rozmowa("new");
    expect(wKubelku(niczyja, "nieprzypisane", JA)).toBe(true);
    expect(wKubelku(niczyja, "moje", JA)).toBe(false);

    /* Cudza rozmowa w toku nie jest moją pracą — i właśnie dlatego kubełek
       „Wszystkie" musi istnieć, żeby dało się ją w ogóle znaleźć. */
    const cudza = rozmowa("open", 99);
    expect(wKubelku(cudza, "moje", JA)).toBe(false);
    expect(wKubelku(cudza, "nieprzypisane", JA)).toBe(false);
    expect(wKubelku(cudza, "wszystkie", JA)).toBe(true);
  });

  it("każdy z ośmiu statusów ma gdzie stanąć", () => {
    /* Rozmowa, która nie trafiłaby do żadnego kubełka, znika operatorowi
       z oczu bez jednego objawu. To najgorszy rodzaj usterki w kolejce. */
    const statusy: StatusRozmowy[] = ["new", "open", "waiting_for_customer",
      "waiting_for_internal", "snoozed", "resolved", "closed", "spam"];
    for (const s of statusy) {
      const gdzie = KUBELKI.filter((k) => k.id !== "wszystkie")
        .filter((k) => wKubelku(rozmowa(s, JA), k.id, JA));
      expect(gdzie.length, `status ${s} nie ma kubełka`).toBeGreaterThan(0);
    }
  });

  it("czekanie na klienta i na nas to dwa różne kubełki", () => {
    expect(wKubelku(rozmowa("waiting_for_customer", JA), "klient", JA)).toBe(true);
    expect(wKubelku(rozmowa("waiting_for_customer", JA), "my", JA)).toBe(false);
    expect(wKubelku(rozmowa("waiting_for_internal", JA), "my", JA)).toBe(true);
  });

  it("pasek liczy tak samo, jak filtruje lista", () => {
    const rozmowy = [rozmowa("open", JA), { ...rozmowa("new"), id: 2 },
      { ...rozmowa("spam", JA), id: 3 }];
    const onWybierz = vi.fn();
    render(<Kubelki rozmowy={rozmowy} mojeId={JA} wybrany="moje" onWybierz={onWybierz} />);
    expect(screen.getByRole("button", { name: /Moje\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nieprzypisane\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Załatwione\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wszystkie\s*3/ })).toBeInTheDocument();
  });

  it("kliknięcie w kubełek go wybiera", async () => {
    const onWybierz = vi.fn();
    render(<Kubelki rozmowy={[]} mojeId={JA} wybrany="moje" onWybierz={onWybierz} />);
    await userEvent.click(screen.getByRole("button", { name: /Odłożone/ }));
    expect(onWybierz).toHaveBeenCalledWith("odlozone");
  });
});
